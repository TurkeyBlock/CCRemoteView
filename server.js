require('dotenv').config({ path: '.env.local' });

const { parse } = require('url');
const next = require('next');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const httpTerminator = require('http-terminator');
const pino = require('pino');
const { WebSocketServer } = require('ws');
let _jwtDecode = null;
async function jwtDecode(params) {
  if (!_jwtDecode) _jwtDecode = (await import('@auth/core/jwt')).decode;
  return _jwtDecode(params);
}
const UserManagement = require('./src/server/utils/userManagement.js');
const ComputerIpManager = require('./src/server/utils/computerIpManager.js');
const OperatorManager = require('./src/server/utils/operatorManager.js');
const ComputerIdManager = require('./src/server/utils/computerIdManager.js');
const CommandLineInterface = require('./src/server/utils/cmdLineInterface.js');

const AUTOSAVE_INTERVAL_MIN = 5;
const TRANSACTION_CACHE_COUNT = 10000;
const GUEST_STATE_MIN_INTERVAL_MS = 30_000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL DEV NO-AUTH MODE
// Set to `true` when running locally without production NextAuth credentials.
// ONLY takes effect when IS_PROD is false. Never set this in production.
// When active: WebSocket connections are admitted without a session token, and
// all user-facing middleware (requireAuth/requireOperator/requireAdmin) treats
// every caller as a logged-in admin+operator. /api/me returns full access.
// ─────────────────────────────────────────────────────────────────────────────
const DEV_NO_AUTH = true; // ← flip to `true` for local dev without NextAuth — I'll even do it for you.

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER COMMAND LOGGING
// When true, every incoming browser command request (setCommand, setSideCommand,
// setStopSignal, clearCommandQueue) is logged with its computer id, user, and
// queue depth after insertion. Flip to false to silence.
// ─────────────────────────────────────────────────────────────────────────────
const LOG_BROWSER_CMDS = true;

// ─────────────────────────────────────────────────────────────────────────────
// DEV URL CONSTANTS
// Base URLs used when running locally. Not used in production — set APP_URL
// and NEXTAUTH_URL in your environment instead.
// ─────────────────────────────────────────────────────────────────────────────
const DEV_APP_URL  = 'http://localhost:8081'; // This Express server, for browser clients (websocket included) and computercraft HTTP requests/responses
const DEV_AUTH_URL = 'http://localhost:3000'; // NextAuth / primary domain which provides signin and tokens.

const COOKIE_NAME = IS_PROD ? '__Secure-authjs.session-token' : 'authjs.session-token';
const APP_URL = IS_PROD ? process.env.APP_URL : DEV_APP_URL;
const SIGNIN_URL = `${IS_PROD ? process.env.NEXTAUTH_URL : DEV_AUTH_URL}/auth/signin?callbackUrl=${encodeURIComponent(APP_URL)}`;
const PORT = parseInt(process.env.APP_PORT || '8081', 10);

const log = pino({ level: 'info' }, pino.destination({ dest: 1, sync: true })); // dest: 1 = stdout

const dev = !IS_PROD;
const nextApp = next({ dev, hostname: 'localhost', port: PORT });
const handle = nextApp.getRequestHandler();

// --- State ---
let state = {
  computers: {},
  world: { blocks: {} },
  lastTransactionId: 0,
  lastReadyTransactionId: 0,
};
let transactionCache = {};
let commandResultCache = {};
let cmds = {};
let stopSignal = {};
let sideCommands = {};
let chatQueue = {};
let modemServerId = null;
let modemServerIp = null;
let lastKnownModemId = null; // persists through stale-clears so same modem reconnecting isn't treated as new
let modemEnabled = {}; // { [id: string]: boolean } — auto-enabled when modem peripheral detected
let lastModemLastSeenBroadcast = 0;
let wsRequests = {};      // { [id]: true } — computer should open a WebSocket
let computerWs = {};      // { [id]: WebSocket } — live computer WebSocket connections
const commandInFlight = new Set(); // computer IDs with a command currently in flight over WS

// Validate a computer ID: must be a non-negative integer ≤ 1 000 000.
// Returns the numeric string form, or null if invalid.
// Guards against prototype pollution (__proto__, constructor, prototype as keys)
// and non-numeric junk sneaking into ID-keyed caches.
function safeId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_000) return null;
  return String(n);
}

// Strip control characters (newlines, ANSI escapes, etc.) from strings before logging
// to prevent log-injection / audit-trail forgery.
function sanitizeForLog(val) {
  return String(val ?? '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 500);
}

try {
  let raw;
  try {
    raw = zlib.gunzipSync(fs.readFileSync('./src/server/saved/saved_state.json.gz')).toString('utf8');
  } catch {
    raw = fs.readFileSync('./src/server/saved/saved_state.json', 'utf8');
  }
  state = deserializeState(raw);
  state.lastTransactionId = 0;
  state.lastReadyTransactionId = 0;
  for (const [id, c] of Object.entries(state.computers || {})) {
    if (c.has_modem_peripheral === true) modemEnabled[id] = true;
  }
} catch { }

function serializeState(s) {
  const palette = [];
  const nameToIdx = {};
  const blockData = [];
  for (const [locString, block] of Object.entries(s.world.blocks)) {
    const name = block.name;
    if (nameToIdx[name] === undefined) {
      nameToIdx[name] = palette.length;
      palette.push(name);
    }
    const [x, y, z] = locString.split(',').map(Number);
    blockData.push(x, y, z, nameToIdx[name], block.metadata ?? 0);
  }
  const computers = {};
  for (const [id, c] of Object.entries(s.computers)) {
    const { entities: _e, lastSeen: _ls, ...rest } = c;
    computers[id] = rest;
  }
  return JSON.stringify({ computers, world: { palette, blockData, blockDataStride: 5 } });
}

function deserializeState(raw) {
  const parsed = JSON.parse(raw);
  if (parsed.world && Array.isArray(parsed.world.palette)) {
    const { palette, blockData, blockDataStride, blocks: indexed } = parsed.world;
    const stride = blockDataStride ?? 4;
    const blocks = {};
    if (blockData) {
      for (let i = 0; i < blockData.length; i += stride) {
        const locString = `${blockData[i]},${blockData[i + 1]},${blockData[i + 2]}`;
        const block = { name: palette[blockData[i + 3]] };
        if (stride >= 5 && blockData[i + 4]) block.metadata = blockData[i + 4];
        blocks[locString] = block;
      }
    } else if (indexed) {
      for (const [locString, idx] of Object.entries(indexed)) {
        blocks[locString] = { name: palette[idx] };
      }
    }
    parsed.world = { blocks };
  }
  if (parsed.turtle && !parsed.computers) {
    parsed.computers = parsed.turtle;
    delete parsed.turtle;
  }
  return parsed;
}

function saveStateToDisk() {
  fs.mkdirSync('./src/server/saved', { recursive: true });
  const target = './src/server/saved/saved_state.json.gz';
  const tmp    = './src/server/saved/saved_state.tmp.json.gz';
  fs.writeFileSync(tmp, zlib.gzipSync(serializeState(state)));
  fs.renameSync(tmp, target);
}

function autoSave() {
  saveStateToDisk();
  userManagement.save();
  setTimeout(autoSave, AUTOSAVE_INTERVAL_MIN * 60 * 1000);
}

const userManagement = new UserManagement();
const computerIpManager = new ComputerIpManager();
const computerIdManager = new ComputerIdManager();
const operatorManager = new OperatorManager();
const cmdLineInterface = new CommandLineInterface();
cmdLineInterface.on('users', () => console.log(userManagement.getUserDataString()));
cmdLineInterface.on('deleteComputer', (id) => delete state.computers[id]);

// --- Auth helpers ---
function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    })
  );
}

async function getSession(req) {
  try {
    const cookies = parseCookies(req);
    const raw = cookies[COOKIE_NAME];
    if (!raw) return null;
    return await jwtDecode({
      token: raw,
      secret: process.env.NEXTAUTH_SECRET,
      salt: COOKIE_NAME,
    });
  } catch {
    return null;
  }
}

function loadAdmins() {
  try {
    return JSON.parse(fs.readFileSync('./src/server/saved/admins.json', 'utf8'));
  } catch {
    return [];
  }
}

function isAdmin(sub) { return loadAdmins().includes(sub); }
function isOperator(sub) { return operatorManager.isOperator(sub); }

// Synthetic token used when DEV_NO_AUTH bypasses real session validation.
const DEV_TOKEN = { sub: 'dev', username: 'dev', email: 'dev@localhost' };
const devBypass = (req, next) => { req.token = DEV_TOKEN; next(); };

async function requireAuth(req, res, next) {
  if (DEV_NO_AUTH && !IS_PROD) return devBypass(req, next);
  const token = await getSession(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  req.token = token;
  userManagement.updateLastActive(token.sub, token.username);
  next();
}

async function requireOperator(req, res, next) {
  if (DEV_NO_AUTH && !IS_PROD) return devBypass(req, next);
  const token = await getSession(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!isOperator(token.sub)) return res.status(403).json({ error: 'Forbidden' });
  req.token = token;
  userManagement.updateLastActive(token.sub, token.username);
  next();
}

async function requireAdmin(req, res, next) {
  if (DEV_NO_AUTH && !IS_PROD) return devBypass(req, next);
  const token = await getSession(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdmin(token.sub)) return res.status(403).json({ error: 'Forbidden' });
  req.token = token;
  userManagement.updateLastActive(token.sub, token.username);
  next();
}

function requireApprovedComputer(req, res, next) {
  const ip = req.ip;
  if (!computerIpManager.isApproved(ip)) {
    if (!computerIpManager.isPending(ip)) {
      computerIpManager.addPending(ip);
      log.info(`New turtle IP pending approval: ${ip}`);
    }
    return res.status(403).json({ status: 'pending_ip', message: 'Turtle IP is awaiting admin approval.' });
  }
  const id = typeof req.body === 'string' ? Number(req.body) : (req.body?.id ?? req.body?.computerId);
  if (!computerIdManager.allowByIp && id !== undefined && !isNaN(id)) {
    if (!computerIdManager.isApproved(id)) {
      if (!computerIdManager.isPending(id)) {
        computerIdManager.addPending(id, ip);
        log.info(`New turtle ID pending approval: ${id} from ${ip}`);
      }
      return res.status(403).json({ status: 'pending_id', message: 'Turtle ID is awaiting admin approval.' });
    }
  }
  next();
}

// --- Browser WebSocket clients ---
const browserClients = new Set();

function broadcastToClients(data) {
  if (browserClients.size === 0) return;
  const msg = JSON.stringify(data);
  for (const ws of browserClients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function broadcastTransaction(transaction) {
  broadcastToClients({ transactions: { [transaction.id]: transaction } });
}

function sendNextCommandToWs(id) {
  if (commandInFlight.has(id)) return;
  const ws = computerWs[id];
  if (!ws || ws.readyState !== 1) return; // 1 = OPEN
  if (!cmds[id] || cmds[id].length === 0) return;
  const cmd = cmds[id].shift();
  commandInFlight.add(id);
  ws.send(JSON.stringify({ type: 'command', command: cmd }));
  if (LOG_BROWSER_CMDS) log.info(`[ws/computer] sent cmd to ${id} <${sanitizeForLog(cmd)}>`);
}


// --- Core logic ---
function applyTransaction(transaction, state, transactionCache) {
  for (const [locString, block] of Object.entries(transaction.blocks)) {
    if (block) state.world.blocks[locString] = block;
    else delete state.world.blocks[locString];
  }
  for (const [id, computerState] of Object.entries(transaction.computers)) {
    state.computers[id] = computerState;
  }
  transactionCache[transaction.id] = transaction;
  if (transactionCache[transaction.id - TRANSACTION_CACHE_COUNT])
    delete transactionCache[transaction.id - TRANSACTION_CACHE_COUNT];
}

function extractState(computerState, state) {
  const { x, y, z } = computerState.loc;
  const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: {} };

  if (computerState.view) {
    const topKey    = `${x},${y+1},${z}`;
    const bottomKey = `${x},${y-1},${z}`;
    let frontKey;
    switch (computerState.rot) {
      case 3: frontKey = `${x},${y},${z+1}`; break;
      case 2: frontKey = `${x+1},${y},${z}`; break;
      case 1: frontKey = `${x},${y},${z-1}`; break;
      case 0: frontKey = `${x-1},${y},${z}`; break;
      default: log.warn(`error in extractBlockState: rot is invalid (${computerState.rot})`);
    }

    // Write block identity to the world, but strip inventory — inventory is ephemeral
    // to the turtle's current view and must never persist in the block map.
    function blockOnly(b) {
      if (!b) return null;
      const { inventory, inventorySize, ...rest } = b;
      return Object.keys(rest).length ? rest : null;
    }
    transaction.blocks[topKey]    = blockOnly(computerState.view.top);
    transaction.blocks[bottomKey] = blockOnly(computerState.view.bottom);
    if (frontKey) transaction.blocks[frontKey] = blockOnly(computerState.view.front);

    // Collect inventory data onto the computer state, keyed by world position.
    // This is fully replaced on every update so there are no ghost inventories.
    const adjacentInventory = {};
    const viewPairs = [[topKey, computerState.view.top], [bottomKey, computerState.view.bottom]];
    if (frontKey) viewPairs.push([frontKey, computerState.view.front]);
    for (const [key, block] of viewPairs) {
      if (block?.inventory) adjacentInventory[key] = { inventory: block.inventory, inventorySize: block.inventorySize };
    }
    computerState.adjacentInventory = adjacentInventory;
  }

  transaction.computers[computerState.id] = computerState;
  state.lastReadyTransactionId++;
  return transaction;
}

// --- Scan rate limiting ---
const SCAN_MIN_INTERVAL_MS = 1000;
const scanLastTime = {};
const guestStateLastTime = {};

function clearCommandQueue(id, sub) {
  cmds[id] = [];
  log.info(`/api/clearCommandQueue id=${id} user=${sub}`);
  userManagement.incrementActionCount(sub);
}

nextApp.prepare().then(() => {
  const app = express();

  // Proxy fix: traffic arrives via Cloudflare tunnel
  app.set('trust proxy', 'loopback');

  // For WebSocket upgrade requests (raw Node IncomingMessage, not Express), req.ip is unavailable.
  // Read CF-Connecting-IP (set by Cloudflare) so we get the real client IP, not the tunnel loopback.
  function getClientIp(req) {
    return req.headers['cf-connecting-ip']
      || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress;
  }

  app.use(cors({
    origin: IS_PROD ? process.env.APP_URL : DEV_AUTH_URL,
  }));
  app.use(express.json({ limit: '2mb' }));

  // Static assets served by Express (not Next.js) — accessible to turtle computers too
  app.use('/textures', express.static('textures'));
  app.use('/computers', (req, res, next) => {
    const safe = path.normalize(req.path).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.resolve('computers', safe.slice(1));
    if (!filePath.startsWith(path.resolve('computers'))) return res.sendStatus(403);
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return next();
      res.type('text/plain').send(data.replaceAll('%%APP_URL%%', process.env.APP_URL));
    });
  });

  const HOME_URL = IS_PROD ? process.env.NEXTAUTH_URL : DEV_AUTH_URL;
  app.get('/api/signin', (_req, res) => res.redirect(SIGNIN_URL));
  app.get('/api/home', (_req, res) => res.redirect(HOME_URL));

  // --- Computer endpoints ---
  app.post('/api/state', requireApprovedComputer, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    req.body.id = Number(id);
    req.body.via_modem = modemServerIp !== null && req.ip === modemServerIp;
    req.body.lastSeen = Date.now();
    const t = extractState(req.body, state);
    applyTransaction(t, state, transactionCache);
    broadcastTransaction(t);
    res.sendStatus(200);
  });

  const SCAN_INCLUDE_METADATA = true;
  const SCAN_INCLUDE_STATE    = false;

  app.post('/api/scan', requireApprovedComputer, (req, res) => {
    const { blocks } = req.body;
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks must be an array' });
    if (blocks.length > 50_000) return res.status(400).json({ error: 'blocks array too large' });

    const now = Date.now();
    if (scanLastTime[id] && now - scanLastTime[id] < SCAN_MIN_INTERVAL_MS)
      return res.status(429).json({ error: 'rate limited' });
    scanLastTime[id] = now;

    const computer = state.computers[id];
    const origin = req.body.origin ?? computer?.loc;
    if (!origin) return res.status(400).json({ error: 'computer position unknown — send origin in request or a state update first' });

    const { x: tx, y: ty, z: tz } = origin;
    const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: {} };

    for (const block of blocks) {
      const locString = `${Math.round(tx + block.x)},${Math.round(ty + block.y)},${Math.round(tz + block.z)}`;
      if (!block.name || block.name === 'minecraft:air') {
        if (state.world.blocks[locString]) transaction.blocks[locString] = null;
      } else {
        const entry = { name: block.name };
        if (SCAN_INCLUDE_METADATA && block.metadata != null) entry.metadata = block.metadata;
        if (SCAN_INCLUDE_STATE && block.state != null && Object.keys(block.state).length > 0) entry.state = block.state;
        transaction.blocks[locString] = entry;
      }
    }

    if (Object.keys(transaction.blocks).length > 0) {
      applyTransaction(transaction, state, transactionCache);
      state.lastReadyTransactionId++;
      broadcastTransaction(transaction);
      log.info(`/api/scan id=${id} mapped ${Object.keys(transaction.blocks).length} block changes`);
    }
    res.json({ ok: true });
  });

  app.post('/api/sense', requireApprovedComputer, (req, res) => {
    const { entities } = req.body;
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    if (!Array.isArray(entities)) return res.status(400).json({ error: 'entities must be an array' });
    if (entities.length > 1_000) return res.status(400).json({ error: 'entities array too large' });
    const computer = state.computers[id];
    if (!computer) return res.status(400).json({ error: 'computer unknown — send a state update first' });
    state.computers[id].entities = entities;
    const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: state.computers[id] } };
    applyTransaction(transaction, state, transactionCache);
    state.lastReadyTransactionId++;
    broadcastTransaction(transaction);
    log.info(`/api/sense id=${id} reported ${entities.length} entities`);
    res.json({ ok: true });
  });

  app.post('/api/chat', requireApprovedComputer, (req, res) => {
    const { player, message, uuid } = req.body;
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    if (!player || !message) return res.status(400).json({ error: 'player and message required' });
    if (typeof player !== 'string' || player.length > 100) return res.status(400).json({ error: 'player name too long' });
    if (typeof message !== 'string' || message.length > 2_000) return res.status(400).json({ error: 'message too long' });
    const computer = state.computers[id];
    if (!computer) return res.status(400).json({ error: 'computer unknown — send a state update first' });
    if (!state.computers[id].chatLog) state.computers[id].chatLog = [];
    state.computers[id].chatLog.push({ player, message, uuid: uuid || '', timestamp: Date.now() });
    if (state.computers[id].chatLog.length > 100) state.computers[id].chatLog.shift();
    const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: state.computers[id] } };
    applyTransaction(transaction, state, transactionCache);
    state.lastReadyTransactionId++;
    broadcastTransaction(transaction);
    log.info(`/api/chat id=${id} player=${sanitizeForLog(player)} message=${sanitizeForLog(message)}`);
    res.json({ ok: true });
  });

  app.post('/api/sendChat', requireOperator, (req, res) => {
    const { message } = req.body;
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    if (!message) return res.status(400).json({ error: 'message required' });
    if (typeof message !== 'string' || message.length > 2_000) return res.status(400).json({ error: 'message too long' });
    if (!chatQueue[id]) chatQueue[id] = [];
    chatQueue[id].push(message);
    log.info(`/api/sendChat id=${id} user=${req.token.sub} <${sanitizeForLog(message)}>`);
    userManagement.incrementActionCount(req.token.sub);
    res.json({ ok: true });
  });

  app.post('/api/getChatMessage', requireApprovedComputer, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) { res.send(''); return; }
    if (!chatQueue[id] || chatQueue[id].length === 0) { res.send(''); return; }
    res.send(chatQueue[id].shift());
  });

  app.post('/api/statusUpdate', requireApprovedComputer, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    // Strip prototype-polluting keys before merging into server state.
    const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const body = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => !BLOCKED_KEYS.has(k))
    );
    body.id = Number(id);
    body.via_modem = modemServerIp !== null && req.ip === modemServerIp;
    delete body.modem_enabled; // server-controlled; never trust from computer
    // Default modem_enabled to true for computers that report a modem peripheral
    if (body.has_modem_peripheral === true && modemEnabled[id] === undefined) {
      modemEnabled[id] = true;
    }
    if (modemEnabled[id] !== undefined) body.modem_enabled = modemEnabled[id];
    const existing = state.computers[id] || {};
    const merged = { ...existing, ...body, lastSeen: Date.now() };
    if (!merged.loc && existing.loc) merged.loc = existing.loc;
    const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: merged } };
    applyTransaction(transaction, state, transactionCache);
    state.lastReadyTransactionId++;
    broadcastTransaction(transaction);
    res.sendStatus(200);
  });

  const CMD_RESULT_CACHE_MAX = 100;

  app.post('/api/commandResult', requireApprovedComputer, (req, res) => {
    const computerId = safeId(req.body.computerId);
    if (computerId === null) return res.status(400).json({ error: 'invalid computerId' });
    const result = req.body.result;
    if (JSON.stringify(result).length > 100_000) return res.status(400).json({ error: 'result too large' });
    const actionSeq = typeof req.body.actionSeq === 'number' ? req.body.actionSeq : undefined;
    console.log(`[${new Date().toISOString()}] Computer ${computerId} sent command result (seq=${actionSeq ?? '?'}):`, result);
    if (!commandResultCache[computerId]) commandResultCache[computerId] = [];
    commandResultCache[computerId].push(result);
    if (commandResultCache[computerId].length > CMD_RESULT_CACHE_MAX) commandResultCache[computerId].shift();
    const broadcast = { computerId, result };
    if (actionSeq !== undefined) broadcast.actionSeq = actionSeq;
    broadcastToClients({ commandResult: broadcast });
    res.sendStatus(200);
  });

  app.post('/api/getStopSignal', express.text({ type: '*/*' }), requireApprovedComputer, (req, res) => {
    const rawId = typeof req.body === 'string' ? req.body : (req.body?.id ?? req.body?.computerId);
    const id = safeId(rawId);
    const ts = new Date().toISOString();
    if (id === null) {
      console.log(`[${ts}] getStopSignal: invalid id from ${req.ip}`);
      return res.sendStatus(400);
    }
    console.log(`[${ts}] Computer ${id} checked for stop signal from ${req.ip}`);
    res.send(stopSignal[id] ? true : false);
    delete stopSignal[id];
  });

  app.post('/api/getWsRequest', express.text({ type: '*/*' }), requireApprovedComputer, (req, res) => {
    const rawId = typeof req.body === 'string' ? req.body : (req.body?.id ?? req.body?.computerId);
    const id = safeId(rawId);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    res.json({ open: wsRequests[id] === true });
  });

  app.post('/api/getSideCommand', requireApprovedComputer, (req, res) => {
    const s = req.body;
    if (!sideCommands[s.id] || sideCommands[s.id].length === 0) { res.send(''); return; }
    res.send(sideCommands[s.id].shift());
  });

  app.post('/api/modem/register', requireApprovedComputer, (req, res) => {
    const { id } = req.body;
    if (id === undefined) return res.status(400).json({ error: 'id required' });
    const isNew = String(lastKnownModemId) !== String(id);
    const now = Date.now();
    if (isNew) {
      log.info(`Modem server registered: ID ${id} — queuing reboot for modem-enabled computers`);
      for (const computerId of Object.keys(state.computers)) {
        if (String(computerId) === String(id)) continue;
        if (modemEnabled[computerId] === false) continue; // respect opt-out
        if (!cmds[computerId]) cmds[computerId] = [];
        cmds[computerId].push('os.reboot()');
      }
    }
    modemServerId = id;
    modemServerIp = req.ip;
    lastKnownModemId = id;
    const pollInterval = typeof req.body.poll_interval === 'number' ? req.body.poll_interval : undefined;
    if (isNew) {
      const prevLoc = state.computers[String(id)]?.loc;
      const loc = req.body.loc || prevLoc || undefined;
      const modemState = { id: Number(id), type: 'modem', label: `Modem ${id}`, lastSeen: now, ...(loc && { loc }), ...(pollInterval !== undefined && { poll_interval: pollInterval }) };
      const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: modemState } };
      applyTransaction(transaction, state, transactionCache);
      state.lastReadyTransactionId++;
      broadcastTransaction(transaction);
    } else if (pollInterval !== undefined && state.computers[String(id)]) {
      const sid = String(id);
      if (state.computers[sid].poll_interval !== pollInterval) {
        state.computers[sid].poll_interval = pollInterval;
        const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [sid]: { ...state.computers[sid] } } };
        applyTransaction(transaction, state, transactionCache);
        state.lastReadyTransactionId++;
        broadcastTransaction(transaction);
      }
    }
    res.json({ ok: true });
  });

  const MODEM_STALE_MS = 120_000;
  app.get('/api/modem/id', (req, res) => {
    if (modemServerId !== null) {
      const modem = state.computers[modemServerId];
      if (!modem || Date.now() - (modem.lastSeen ?? 0) > MODEM_STALE_MS) {
        modemServerId = null;
        modemServerIp = null;
      }
    }
    const computerId = req.query.computerId ? safeId(req.query.computerId) : null;
    const enabled = computerId === null ? true : modemEnabled[computerId] !== false;
    res.json({ id: modemServerId, enabled });
  });

  app.get('/api/modem/computers', requireApprovedComputer, (_req, res) => {
    const ids = Object.keys(state.computers)
      .map(Number)
      .filter(n => {
        if (isNaN(n)) return false;
        const id = String(n);
        return state.computers[id]?.has_modem_peripheral === true
          && modemEnabled[id] !== false;
      });
    res.json({ ids });
  });

  app.post('/api/poll', express.text({ type: '*/*' }), requireApprovedComputer, (req, res) => {
    if (typeof req.body !== 'string') return res.status(400).json({ error: 'body must be a comma-separated list of ids' });
    if (modemServerId !== null && state.computers[modemServerId]) {
      const now = Date.now();
      state.computers[modemServerId].lastSeen = now;
      if (now - lastModemLastSeenBroadcast > 15_000) {
        lastModemLastSeenBroadcast = now;
        const sid = String(modemServerId);
        const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [sid]: { ...state.computers[sid], lastSeen: now } } };
        applyTransaction(transaction, state, transactionCache);
        state.lastReadyTransactionId++;
        broadcastTransaction(transaction);
      }
    }
    const ids = req.body.length > 0 ? req.body.split(',').map(Number).filter(n => !isNaN(n)) : [];
    const commands = {};
    const stops = {};
    const sides = {};
    const chats = {};
    for (const id of ids) {
      const sid = String(id);
      if (modemEnabled[sid] === false) continue; // computer opted out of modem; it polls HTTP directly
      if (stopSignal[id]) {
        stops[sid] = true;
        delete stopSignal[id];
        log.info(`Modem: delivering stop signal to computer ${id}`);
      } else if (cmds[id] && cmds[id].length > 0) {
        commands[sid] = cmds[id].shift();
        log.info(`Modem: delivering cmd to computer ${id}`);
      }
      if (sideCommands[id] && sideCommands[id].length > 0) {
        sides[sid] = sideCommands[id].shift();
        log.info(`Modem: delivering side command to computer ${id}`);
      }
      if (chatQueue[id] && chatQueue[id].length > 0) {
        chats[sid] = chatQueue[id].shift();
        log.info(`Modem: delivering chat to computer ${id}`);
      }
    }
    const wsReqs = {};
    for (const id of ids) {
      const sid = String(id);
      if (wsRequests[sid] && !computerWs[sid]) wsReqs[sid] = true;
    }
    log.info(`Modem: poll (${ids.length} computers, ${Object.keys(commands).length} cmds, ${Object.keys(stops).length} stops, ${Object.keys(sides).length} sides, ${Object.keys(chats).length} chats, ${Object.keys(wsReqs).length} wsReqs, size: ${req.body.length} bytes)`);
    res.json({ commands, stops, sides, chats, wsRequests: wsReqs });
  });

  // --- Browser endpoints ---
  app.get('/api/state', compression(), async (req, res) => {
    const token = await getSession(req);
    if (!token) {
      const ip = req.ip;
      const now = Date.now();
      if (guestStateLastTime[ip] && now - guestStateLastTime[ip] < GUEST_STATE_MIN_INTERVAL_MS) {
        const retryAfter = Math.ceil((guestStateLastTime[ip] + GUEST_STATE_MIN_INTERVAL_MS - now) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'rate limited', retryAfter });
      }
      guestStateLastTime[ip] = now;
    }
    res.send(state);
  });


  // DEAD CODE — HTTP-based delta sync, predates WebSocket. Authed users receive live updates via WebSocket;
  // guests use GET /api/state with a 30s rate limit and are not permitted state updates. This endpoint may no longer function correctly.
  // app.post('/api/getStateUpdate', compression(), (req, res) => {
  //   if (req.body.lastTransactionId === -1) { res.send({ state }); return; }
  //   if (req.body.lastTransactionId > state.lastReadyTransactionId) { res.send({ state }); return; }
  //   let newTransactionId = req.body.lastTransactionId + 1;
  //   let resJson = { transactions: {} };
  //   if (newTransactionId > state.lastTransactionId) { res.send(resJson); return; }
  //   if (!transactionCache[newTransactionId]) { res.send({ state }); return; }
  //   for (let i = newTransactionId; i <= state.lastReadyTransactionId; i++) {
  //     resJson.transactions[transactionCache[i].id] = transactionCache[i];
  //   }
  //   res.send(resJson);
  // });

  const MAX_CMD_LENGTH = 10_000;

  // DEAD CODE — transferred to WebSocket (ws.on('message') handler above).
  // Browser clients send these as { type, id, cmd/enabled } messages over the existing WS connection.
  // app.post('/api/setCommand', requireOperator, (req, res) => { ... });
  // app.post('/api/setSideCommand', requireOperator, (req, res) => { ... });
  // app.post('/api/setStopSignal', requireOperator, (req, res) => { ... });
  // app.post('/api/clearCommandQueue', requireOperator, (req, res) => { ... });
  // app.post('/api/setModemEnabled', requireOperator, (req, res) => { ... });
  // app.post('/api/getCommandResult', requireAuth, compression(), (req, res) => { ... });
  //   ^ results are now pushed to browser clients via broadcastToClients({ commandResult }) in /api/commandResult.

  app.post('/api/saveState', requireAuth, (_req, res) => {
    saveStateToDisk();
    res.sendStatus(200);
  });

  app.get('/api/me', async (req, res) => {
    if (DEV_NO_AUTH && !IS_PROD) {
      let savedFileSizeBytes = null;
      try { savedFileSizeBytes = fs.statSync('./src/server/saved/saved_state.json.gz').size; } catch {}
      return res.json({ isLoggedIn: true, username: 'dev', email: 'dev@localhost', isAdmin: true, isOperator: true, savedFileSizeBytes });
    }
    const token = await getSession(req);
    if (!token) return res.json({ isLoggedIn: false, isAdmin: false, isOperator: false });
    let savedFileSizeBytes = null;
    try { savedFileSizeBytes = fs.statSync('./src/server/saved/saved_state.json.gz').size; } catch {}
    userManagement.updateLastActive(token.sub, token.username);
    res.json({
      isLoggedIn: true,
      username: token.username ?? token.name ?? null,
      email: token.email ?? null,
      isAdmin: isAdmin(token.sub),
      isOperator: isOperator(token.sub),
      savedFileSizeBytes,
    });
  });

  app.post('/api/requestOperator', requireAuth, (req, res) => {
    const email = req.token.email ?? null;
    if (!email) return res.status(400).json({ error: 'No email in session token.' });
    const result = operatorManager.addRequest(req.token.sub, email);
    res.json({ result });
  });

  // --- Admin endpoints ---
  app.get('/api/admin/computerIps', requireAdmin, (_req, res) => res.json(computerIpManager.getAll()));
  app.post('/api/admin/denyComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    computerIpManager.deny(ip);
    log.info(`Turtle IP denied: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/approveComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    computerIpManager.approve(ip);
    log.info(`Turtle IP approved: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/revokeComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    computerIpManager.revoke(ip);
    log.info(`Turtle IP revoked: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.get('/api/admin/operatorRequests', requireAdmin, (_req, res) => res.json(operatorManager.getRequests()));
  app.get('/api/admin/operators', requireAdmin, (_req, res) => res.json(operatorManager.getOperators()));
  app.post('/api/admin/approveOperator', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (!sub) return res.status(400).json({ error: 'sub required' });
    operatorManager.approveRequest(sub);
    log.info(`Operator approved: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/denyOperatorRequest', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (!sub) return res.status(400).json({ error: 'sub required' });
    operatorManager.denyRequest(sub);
    log.info(`Operator request denied: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/revokeOperator', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (!sub) return res.status(400).json({ error: 'sub required' });
    operatorManager.revokeOperator(sub);
    log.info(`Operator revoked: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.get('/api/admin/computerIds', requireAdmin, (_req, res) => res.json(computerIdManager.getAll()));
  app.post('/api/admin/approveComputerId', requireAdmin, (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    computerIdManager.approve(id);
    log.info(`Turtle ID approved: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/denyComputerId', requireAdmin, (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    computerIdManager.deny(id);
    log.info(`Turtle ID denied: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/revokeComputerId', requireAdmin, (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    computerIdManager.revoke(id);
    log.info(`Turtle ID revoked: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/setAllowByIp', requireAdmin, (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
    computerIdManager.setAllowByIp(enabled);
    log.info(`allowByIp set to ${enabled} by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/deleteComputer', requireAdmin, (req, res) => {
    const { id } = req.body;
    if (id === undefined) return res.status(400).json({ error: 'id required' });
    delete state.computers[id];
    cmds[id] = [];
    if (String(id) === String(modemServerId)) {
      modemServerId = null;
      modemServerIp = null;
      log.info(`Modem server ${id} deleted — clearing modem state and queuing reboot for all computers`);
      for (const computerId of Object.keys(state.computers)) {
        if (!cmds[computerId]) cmds[computerId] = [];
        cmds[computerId].push('os.reboot()');
      }
    }
    log.info(`Computer ${id} deleted by ${req.token.sub}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/clearWorld', requireAdmin, (req, res) => {
    state.world.blocks = {};
    log.info(`World cleared by ${req.token.sub}`);
    res.json({ ok: true });
  });

  // Next.js handles all remaining routes (pages, _next/static, etc.)
  app.all('*', (req, res) => handle(req, res, parse(req.url, true)));

  const server = app.listen(PORT, () => {
    log.info(`Turtle remote controller server listening on port ${PORT}.`);
    console.log(`[server] Listening on port ${PORT}${DEV_NO_AUTH && !IS_PROD ? ' (DEV_NO_AUTH — no auth enforced)' : ''}`);
  });
  autoSave();

  // --- Browser WebSocket server ---
  // Use noServer mode so we can filter out Next.js HMR upgrade requests
  // (/_next/webpack-hmr) before they reach our custom ws handler.
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: { threshold: 1024 }, // compress messages > 1 KB
  });
  // --- Computer WebSocket server ---
  const computerWss = new WebSocketServer({ noServer: true });
  computerWss.on('connection', (ws, req) => {
    const ip = getClientIp(req);
    if (IS_PROD || !DEV_NO_AUTH) {
      if (!computerIpManager.isApproved(ip)) {
        if (!computerIpManager.isPending(ip)) computerIpManager.addPending(ip);
        ws.close(4403, 'Forbidden');
        return;
      }
    }
    const urlObj = new URL(req.url, 'http://localhost');
    const id = safeId(urlObj.searchParams.get('id'));
    if (!id) { ws.close(4400, 'Bad Request'); return; }
    if ((IS_PROD || !DEV_NO_AUTH) && !computerIdManager.allowByIp && !computerIdManager.isApproved(Number(id))) {
      if (!computerIdManager.isPending(Number(id))) computerIdManager.addPending(Number(id), ip);
      ws.close(4403, 'Forbidden');
      return;
    }
    console.log(`[ws/computer] Computer ${id} connected from ${ip}`);
    if (computerWs[id] && computerWs[id] !== ws) computerWs[id].terminate();
    commandInFlight.delete(id);
    delete wsRequests[id];
    computerWs[id] = ws;
    if (state.computers[id]) {
      state.computers[id].ws_connected = true;
      const t = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: { ...state.computers[id] } } };
      applyTransaction(t, state, transactionCache);
      state.lastReadyTransactionId++;
      broadcastTransaction(t);
    }
    sendNextCommandToWs(id);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'commandResult') {
        const cid = safeId(msg.computerId) ?? id;
        commandInFlight.delete(id);
        const result = msg.result;
        if (result !== undefined) {
          console.log(`[ws/computer] Computer ${cid} result (seq=${msg.actionSeq ?? '?'}):`, result);
          if (!commandResultCache[cid]) commandResultCache[cid] = [];
          commandResultCache[cid].push(result);
          if (commandResultCache[cid].length > CMD_RESULT_CACHE_MAX) commandResultCache[cid].shift();
          const broadcast = { computerId: cid, result };
          if (msg.actionSeq !== undefined) broadcast.actionSeq = msg.actionSeq;
          broadcastToClients({ commandResult: broadcast });
        }
        sendNextCommandToWs(id);
      }
    });
    ws.on('close', (code) => {
      console.log(`[ws/computer] Computer ${id} disconnected — code: ${code}`);
      if (computerWs[id] === ws) {
        delete computerWs[id];
        commandInFlight.delete(id);
        if (cmds[id] && cmds[id].length > 0) wsRequests[id] = true;
        if (state.computers[id]) {
          state.computers[id].ws_connected = false;
          const t = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: { ...state.computers[id] } } };
          applyTransaction(t, state, transactionCache);
          state.lastReadyTransactionId++;
          broadcastTransaction(t);
        }
      }
    });
    ws.on('error', (err) => {
      console.log(`[ws/computer] Computer ${id} error: ${err.message}`);
      if (computerWs[id] === ws) {
        delete computerWs[id];
        commandInFlight.delete(id);
        if (cmds[id] && cmds[id].length > 0) wsRequests[id] = true;
        if (state.computers[id]) {
          state.computers[id].ws_connected = false;
          const t = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: { ...state.computers[id] } } };
          applyTransaction(t, state, transactionCache);
          state.lastReadyTransactionId++;
          broadcastTransaction(t);
        }
      }
      ws.terminate();
    });
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (req.url.startsWith('/ws/computer')) {
      computerWss.handleUpgrade(req, socket, head, (ws) => computerWss.emit('connection', ws, req));
    }
    // All other upgrades (/_next/webpack-hmr etc.) are left for Next.js to handle.
  });
  wss.on('connection', async (ws, req) => {
    let userSub, userName, wsIsOperator;
    if (!DEV_NO_AUTH || IS_PROD) {
      const token = await getSession(req);
      if (!token) { ws.close(4401, 'Unauthorized'); return; }
      userSub = token.sub;
      userName = token.username ?? token.name ?? userSub;
      wsIsOperator = isOperator(userSub);
    } else {
      userSub = DEV_TOKEN.sub;
      userName = DEV_TOKEN.username;
      wsIsOperator = true;
    }
    const clientIp = getClientIp(req);
    console.log(`[ws] Browser client connected from ${clientIp} (total: ${browserClients.size + 1})`);
    browserClients.add(ws);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!wsIsOperator) return;
      switch (msg.type) {
        case 'setCommand': {
          const id = safeId(msg.id);
          if (!id || !msg.cmd || typeof msg.cmd !== 'string' || msg.cmd.length > MAX_CMD_LENGTH) return;
          if (!cmds[id]) cmds[id] = [];
          cmds[id].push(msg.cmd);
          if (LOG_BROWSER_CMDS) log.info(`[ws] setCommand id=${id} user=${userSub} queueDepth=${cmds[id].length} <${sanitizeForLog(msg.cmd)}>`);
          userManagement.incrementActionCount(userSub);
          if (computerWs[id]?.readyState === 1) {
            sendNextCommandToWs(id);
          } else {
            wsRequests[id] = true;
          }
          break;
        }
        case 'setSideCommand': {
          const id = safeId(msg.id);
          if (!id || !msg.cmd || typeof msg.cmd !== 'string' || msg.cmd.length > MAX_CMD_LENGTH) return;
          if (LOG_BROWSER_CMDS) log.info(`[ws] setSideCommand id=${id} user=${userSub} <${sanitizeForLog(msg.cmd)}>`);
          userManagement.incrementActionCount(userSub);
          if (computerWs[id]?.readyState === 1) {
            computerWs[id].send(JSON.stringify({ type: 'sideCommand', command: msg.cmd }));
          } else {
            if (!sideCommands[id]) sideCommands[id] = [];
            sideCommands[id].push(msg.cmd);
          }
          break;
        }
        case 'setStopSignal': {
          const id = safeId(msg.id);
          if (!id) return;
          clearCommandQueue(id, userSub);
          commandInFlight.delete(id);
          if (LOG_BROWSER_CMDS) log.info(`[ws] setStopSignal id=${id} user=${userSub}`);
          userManagement.incrementActionCount(userSub);
          if (computerWs[id]?.readyState === 1) {
            computerWs[id].send(JSON.stringify({ type: 'stopSignal' }));
          } else {
            stopSignal[id] = true;
          }
          break;
        }
        case 'clearCommandQueue': {
          const id = safeId(msg.id);
          if (!id) return;
          clearCommandQueue(id, userSub);
          if (LOG_BROWSER_CMDS) log.info(`[ws] clearCommandQueue id=${id} user=${userSub}`);
          break;
        }
      }
    });
    // Register handlers BEFORE sending so errors during send are caught.
    ws.on('close', (code, reason) => {
      console.log(`[ws] Browser client disconnected — code: ${code}, reason: ${reason?.toString() || '(none)'}`);
      browserClients.delete(ws);
    });
    ws.on('error', (err) => {
      console.log(`[ws] Browser client error: ${err.message}`);
      browserClients.delete(ws);
      ws.terminate();
    });
  });

  const terminator = httpTerminator.createHttpTerminator({ gracefulTerminationTimeout: 200, server });
  process.on('SIGINT', async () => {
    await terminator.terminate();
    saveStateToDisk();
    userManagement.save();
    process.exit(0);
  });
});