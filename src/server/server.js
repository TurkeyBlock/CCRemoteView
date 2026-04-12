require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const compression = require('compression')
const { Vector3 } = require('math3d');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const app = express();
const httpTerminator = require('http-terminator');
const simpleNodeLogger = require('simple-node-logger');
const { WebSocketServer } = require('ws');
let _jwtDecode = null;
async function jwtDecode(params) {
  if (!_jwtDecode) _jwtDecode = (await import('@auth/core/jwt')).decode;
  return _jwtDecode(params);
}
const UserManagement = require('./utils/userManagement.js');
const TurtleIpManager = require('./utils/turtleIpManager.js');
const OperatorManager = require('./utils/operatorManager.js');
const ComputerIdManager = require('./utils/computerIdManager.js');
const CommandLineInterface = require('./utils/cmdLineInterface.js');

const AUTOSAVE_INTERVAL_MIN = 1;
const TRANSACTION_CACHE_COUNT = 10000;
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_NAME = IS_PROD ? '__Secure-authjs.session-token' : 'authjs.session-token';
const APP_URL = IS_PROD ? process.env.APP_URL : 'http://localhost:3001';
const SIGNIN_URL = `${IS_PROD ? process.env.NEXTAUTH_URL : 'http://localhost:3000'}/auth/signin?callbackUrl=${encodeURIComponent(APP_URL)}`;

fs.mkdirSync('logs', { recursive: true });
const log = simpleNodeLogger.createSimpleLogger({
  logFilePath: 'logs/server_log.log',
  timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
});

app.use(cors({
  origin: IS_PROD ? process.env.APP_URL : 'http://localhost:3000'
}));
app.use(express.json({ limit: '10mb' }));

app.use(express.static('dist'));
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

const HOME_URL = IS_PROD ? process.env.NEXTAUTH_URL : 'http://localhost:3000';

app.get('/api/signin', (_req, res) => res.redirect(SIGNIN_URL));
app.get('/api/home', (_req, res) => res.redirect(HOME_URL));

// --- State ---
let state = {
  computers: {},
  world: { blocks: {} },
  lastTransactionId: 0,
  lastReadyTransactionId: 0,
}
let transactionCache = {}
let commandResultCache = {}
let cmds = {}
let stopSignal = {}
let sideCommands = {}
let modemServerId = null;
let modemServerIp = null;
let lastModemStateUpdate = 0;

// --- Browser WebSocket clients ---
const browserClients = new Set();

function broadcastTransaction(transaction) {
  if (browserClients.size === 0) return;
  const msg = JSON.stringify({ transactions: { [transaction.id]: transaction } });
  for (const ws of browserClients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

const userManagement = new UserManagement();
const turtleIpManager = new TurtleIpManager();
const computerIdManager = new ComputerIdManager();
const operatorManager = new OperatorManager();
const cmdLineInterface = new CommandLineInterface();
cmdLineInterface.on('users', () => console.log(userManagement.getUserDataString()));
cmdLineInterface.on('deleteComputer', (id) => delete state.computers[id]);

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
} catch { }

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

function isAdmin(sub) {
  return loadAdmins().includes(sub);
}

function isOperator(sub) {
  return operatorManager.isOperator(sub);
}

// Middleware: require valid session (API routes — returns 401 JSON, not redirect)
async function requireAuth(req, res, next) {
  const token = await getSession(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  req.token = token;
  userManagement.updateLastActive(token.sub, token.username);
  next();
}

// Middleware: require valid session and operator role
async function requireOperator(req, res, next) {
  const token = await getSession(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!isOperator(token.sub)) return res.status(403).json({ error: 'Forbidden' });
  req.token = token;
  userManagement.updateLastActive(token.sub, token.username);
  next();
}

// Middleware: require valid session and admin role
async function requireAdmin(req, res, next) {
  const token = await getSession(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  if (!isAdmin(token.sub)) return res.status(403).json({ error: 'Forbidden' });
  req.token = token;
  userManagement.updateLastActive(token.sub, token.username);
  next();
}

// Middleware: require approved turtle IP, then (if allowByIp is off) approved turtle ID
function requireApprovedComputer(req, res, next) {
  const ip = req.ip;

  // Stage 1: IP must be approved first
  if (!turtleIpManager.isApproved(ip)) {
    if (!turtleIpManager.isPending(ip)) {
      turtleIpManager.addPending(ip);
      log.info(`New turtle IP pending approval: ${ip}`);
    }
    return res.status(403).json({ status: 'pending_ip', message: 'Turtle IP is awaiting admin approval.' });
  }

  // Stage 2: individual turtle ID (skipped when allowByIp override is on)
  const id = req.body?.id ?? req.body?.computerId;
  if (!computerIdManager.allowByIp && id !== undefined) {
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

function Vec3toString(vec) {
  return vec.x + "," + vec.y + "," + vec.z;
}

function extractState(computerState, state) {
  let loc = new Vector3(computerState.loc.x, computerState.loc.y, computerState.loc.z);
  let transaction = { id: ++state.lastTransactionId, blocks: {}, computers: {} };

  // Minecarts have no view or rotation — skip block extraction for them
  if (computerState.view) {
    transaction.blocks[Vec3toString(loc.add(Vector3.up))] = computerState.view.top || null;
    transaction.blocks[Vec3toString(loc.add(Vector3.down))] = computerState.view.bottom || null;

    let locString;
    switch (computerState.rot) {
      case 3: locString = Vec3toString(loc.add(Vector3.forward)); break;
      case 2: locString = Vec3toString(loc.add(Vector3.right)); break;
      case 1: locString = Vec3toString(loc.add(Vector3.back)); break;
      case 0: locString = Vec3toString(loc.add(Vector3.left)); break;
      default: log.warn(`error in extractBlockState: rot is invalid (${computerState.rot})`);
    }
    if (locString) transaction.blocks[locString] = computerState.view.front || null;
  }

  transaction.computers[computerState.id] = computerState;
  state.lastReadyTransactionId++;
  return transaction;
}

// --- Scan rate limiting ---
const SCAN_MIN_INTERVAL_MS = 1000;
const scanLastTime = {};

// --- Computer endpoints (IP allowlist gated) ---
app.post('/api/state', requireApprovedComputer, (req, res) => {
  // Tag the state with how it arrived so the frontend can show modem vs HTTP
  req.body.via_modem = modemServerIp !== null && req.ip === modemServerIp;
  const t = extractState(req.body, state);
  applyTransaction(t, state, transactionCache);
  if (state.computers[req.body.id]) state.computers[req.body.id].lastSeen = Date.now();
  broadcastTransaction(t);
  res.sendStatus(200);
});

const SCAN_INCLUDE_METADATA = true;  // store raw 1.12 integer metadata if provided
const SCAN_INCLUDE_STATE    = false;  // store blockstate property table if provided

app.post('/api/scan', requireApprovedComputer, (req, res) => {
  const { id, blocks } = req.body;
  if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks must be an array' });

  const now = Date.now();
  if (scanLastTime[id] && now - scanLastTime[id] < SCAN_MIN_INTERVAL_MS)
    return res.status(429).json({ error: 'rate limited' });
  scanLastTime[id] = now;

  const computer = state.computers[String(id)];
  if (!computer?.loc) return res.status(400).json({ error: 'computer position unknown — send a state update first' });

  const origin = req.body.origin ?? computer.loc;
  const { x: tx, y: ty, z: tz } = origin;
  const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: {} };

  for (const block of blocks) {
    const locString = `${tx + block.x},${ty + block.y},${tz + block.z}`;
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
  const { id, entities } = req.body;
  if (!Array.isArray(entities)) return res.status(400).json({ error: 'entities must be an array' });
  const computer = state.computers[String(id)];
  if (!computer) return res.status(400).json({ error: 'computer unknown — send a state update first' });
  // Full replace: entities are temporary, tied to this computer only
  state.computers[String(id)].entities = entities;
  const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: state.computers[String(id)] } };
  applyTransaction(transaction, state, transactionCache);
  state.lastReadyTransactionId++;
  broadcastTransaction(transaction);
  log.info(`/api/sense id=${id} reported ${entities.length} entities`);
  res.json({ ok: true });
});

app.post('/api/chat', requireApprovedComputer, (req, res) => {
  const { id, player, message, uuid } = req.body;
  if (!player || !message) return res.status(400).json({ error: 'player and message required' });
  const computer = state.computers[String(id)];
  if (!computer) return res.status(400).json({ error: 'computer unknown — send a state update first' });
  if (!state.computers[String(id)].chatLog) state.computers[String(id)].chatLog = [];
  state.computers[String(id)].chatLog.push({ player, message, uuid: uuid || '', timestamp: Date.now() });
  // Keep last 100 messages
  if (state.computers[String(id)].chatLog.length > 100) state.computers[String(id)].chatLog.shift();
  const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: state.computers[String(id)] } };
  applyTransaction(transaction, state, transactionCache);
  state.lastReadyTransactionId++;
  broadcastTransaction(transaction);
  log.info(`/api/chat id=${id} player=${player} message=${message}`);
  res.json({ ok: true });
});

// Lightweight state update used by player and stationary computers.
// Payload: { id, type, sleep, loc } — loc may be null if GPS is unavailable.
// Merges with existing computer state so a temporary GPS failure does not
// wipe a previously known location.
app.post('/api/statusUpdate', requireApprovedComputer, (req, res) => {
  const body = req.body;
  body.via_modem = modemServerIp !== null && req.ip === modemServerIp;
  const id = String(body.id);
  const existing = state.computers[id] || {};
  const merged = { ...existing, ...body };
  if (!merged.loc && existing.loc) merged.loc = existing.loc;
  const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [body.id]: merged } };
  applyTransaction(transaction, state, transactionCache);
  state.lastReadyTransactionId++;
  if (state.computers[id]) state.computers[id].lastSeen = Date.now();
  broadcastTransaction(transaction);
  res.sendStatus(200);
});

app.post('/api/getCommand', requireApprovedComputer, (req, res) => {
  const s = req.body;
  console.log(`Computer ${s.id} requested command (size: ${JSON.stringify(req.body).length} bytes)`);
  if (!cmds[s.id]) { res.send(); return; }
  res.send(cmds[s.id].shift());
});

app.post('/api/commandResult', requireApprovedComputer, (req, res) => {
  const computerId = req.body.computerId;
  console.log(`Computer ${computerId} sent command result (size: ${JSON.stringify(req.body).length} bytes):`, req.body.result);
  if (!commandResultCache[computerId]) commandResultCache[computerId] = [];
  commandResultCache[computerId].push(req.body.result);
  res.sendStatus(200);
});

app.post('/api/getStopSignal', requireApprovedComputer, (req, res) => {
  const json = req.body;
  console.log(`Computer ${json.id} checked for stop signal (size: ${JSON.stringify(req.body).length} bytes)`);
  if (isNaN(json.id)) { res.sendStatus(400); return; }
  res.send(stopSignal[json.id] ? true : false);
  delete stopSignal[json.id];
});

app.post('/api/getSideCommand', requireApprovedComputer, (req, res) => {
  const s = req.body;
  if (!sideCommands[s.id] || sideCommands[s.id].length === 0) { res.send(''); return; }
  res.send(sideCommands[s.id].shift());
});

// Modem server registration — modem server calls this on startup so clients can discover it.
// When a new modem ID registers, queues os.reboot() for all known computers so they
// reload, discover the modem, and switch to modem mode automatically.
app.post('/api/modem/register', requireApprovedComputer, (req, res) => {
  const { id } = req.body;
  if (id === undefined) return res.status(400).json({ error: 'id required' });
  const isNew = modemServerId !== id;
  const now = Date.now();
  if (isNew) {
    log.info(`Modem server registered: ID ${id} — queuing reboot for all computers`);
    for (const computerId of Object.keys(state.computers)) {
      if (String(computerId) === String(id)) continue; // don't reboot the modem itself
      if (!cmds[computerId]) cmds[computerId] = [];
      cmds[computerId].push('os.reboot()');
    }
  }
  modemServerId = id;
  modemServerIp = req.ip;
  // Push modem state to the frontend at most every 20s to avoid flooding transactions
  if (isNew || now - lastModemStateUpdate > 20_000) {
    lastModemStateUpdate = now;
    // Preserve loc: use the newly reported loc if present, otherwise keep any
    // previously known loc so a re-registration without GPS doesn't clear the map pin.
    const prevLoc = state.computers[String(id)]?.loc;
    const loc = req.body.loc || prevLoc || undefined;
    const modemState = { id: Number(id), type: 'modem', label: `Modem ${id}`, lastSeen: now, ...(loc && { loc }) };
    const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: modemState } };
    applyTransaction(transaction, state, transactionCache);
    state.lastReadyTransactionId++;
    broadcastTransaction(transaction);
  }
  res.json({ ok: true });
});

// Open endpoint — computers query this on boot to discover the modem server ID.
// Returns null if the modem hasn't checked in within the last 2 minutes so that
// rebooted computers don't route through a dead modem.
const MODEM_STALE_MS = 120_000;
app.get('/api/modem/id', (_req, res) => {
  if (modemServerId !== null) {
    const modem = state.computers[modemServerId];
    if (!modem || Date.now() - (modem.lastSeen ?? 0) > MODEM_STALE_MS) {
      modemServerId = null;
      modemServerIp = null;
    }
  }
  res.json({ id: modemServerId });
});

// Returns all known computer IDs — modem server queries this on startup to seed its served list
app.get('/api/modem/computers', requireApprovedComputer, (_req, res) => {
  const ids = Object.keys(state.computers).map(Number).filter(n => !isNaN(n));
  res.json({ ids });
});

// Batch endpoint used by the modem proxy server.
// Returns commands and stop signals atomically so a stop signal for computer X
// is never delivered in a different poll cycle from the command it was meant to cancel.
// If a stop signal and a command are both pending for the same computer, the stop signal
// takes priority and the command is left in the queue for the next cycle.
app.post('/api/poll', requireApprovedComputer, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const commands = {};
  const stops = {};
  const sides = {};
  for (const id of ids) {
    if (stopSignal[id]) {
      stops[String(id)] = true;
      delete stopSignal[id];
      log.info(`Modem: delivering stop signal to computer ${id}`);
    } else if (cmds[id] && cmds[id].length > 0) {
      commands[String(id)] = cmds[id].shift();
      log.info(`Modem: delivering cmd to computer ${id}`);
    }
    if (sideCommands[id] && sideCommands[id].length > 0) {
      sides[String(id)] = sideCommands[id].shift();
      log.info(`Modem: delivering side command to computer ${id}`);
    }
  }
  log.info(`Modem: poll (${ids.length} computers, ${Object.keys(commands).length} cmds, ${Object.keys(stops).length} stops, ${Object.keys(sides).length} sides)`);
  res.json({ commands, stops, sides });
});

// --- Browser endpoints ---
app.get('/api/state', compression(), (_req, res) => {
  res.send(state);
});

app.post('/api/getStateUpdate', compression(), (req, res) => {
  if (!req.body.lastTransactionId == -1) {
    res.send({ state });
    return;
  }
  if (req.body.lastTransactionId > state.lastReadyTransactionId) {
    res.send({ state });
    return;
  }
  let newTransactionId = req.body.lastTransactionId + 1;
  let resJson = { transactions: {} };
  if (newTransactionId > state.lastTransactionId) { res.send(resJson); return; }
  if (!transactionCache[newTransactionId]) {
    res.send({ state });
    return;
  }
  for (let i = newTransactionId; i <= state.lastReadyTransactionId; i++) {
    resJson.transactions[transactionCache[i].id] = transactionCache[i];
  }
  res.send(resJson);
});

app.post('/api/setCommand', requireOperator, (req, res) => {
  const s = req.body;
  if (!cmds[s.id]) cmds[s.id] = [];
  cmds[s.id].push(s.cmd);
  log.info(`/api/setCommand id=${s.id} user=${req.token.sub} <${s.cmd}>`);
  userManagement.incrementActionCount(req.token.sub);
  res.send({ response: 'command set' });
});

app.post('/api/setSideCommand', requireOperator, (req, res) => {
  const s = req.body;
  if (!sideCommands[s.id]) sideCommands[s.id] = [];
  sideCommands[s.id].push(s.cmd);
  log.info(`/api/setSideCommand id=${s.id} user=${req.token.sub} <${s.cmd}>`);
  userManagement.incrementActionCount(req.token.sub);
  res.send({ response: 'side command set' });
});

app.post('/api/setStopSignal', requireOperator, (req, res) => {
  const json = req.body;
  if (isNaN(json.id)) { res.sendStatus(400); return; }
  stopSignal[json.id] = true;
  clearCommandQueue(json.id, req.token.sub);
  log.info(`/api/setStopSignal id=${json.id} user=${req.token.sub}`);
  userManagement.incrementActionCount(req.token.sub);
  res.sendStatus(200);
});

app.post('/api/clearCommandQueue', requireOperator, (req, res) => {
  const s = req.body;
  clearCommandQueue(s.id, req.token.sub);
  res.send({ response: 'command queue cleared' });
});

app.post('/api/getCommandResult', requireAuth, compression(), (req, res) => {
  const computerId = req.body.computerId;
  if (!commandResultCache[computerId]) { res.send({}); return; }
  if (req.body.getOnlyLatest) {
    res.send({ computerId, result: commandResultCache[computerId].at(-1) });
    return;
  }
  const startIndex = req.body.lastReceivedIndex ? req.body.lastReceivedIndex + 1 : 0;
  res.send({ computerId, cmdResults: commandResultCache[computerId].slice(startIndex) });
});


app.post('/api/saveState', requireAuth, (_req, res) => {
  saveStateToDisk();
  res.sendStatus(200);
});

app.get('/api/me', async (req, res) => {
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
app.get('/api/admin/turtleIps', requireAdmin, (_req, res) => {
  res.json(turtleIpManager.getAll());
});

app.post('/api/admin/denyTurtle', requireAdmin, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  turtleIpManager.deny(ip);
  log.info(`Turtle IP denied: ${ip} by ${req.token.sub}`);
  res.json({ ok: true });
});

app.post('/api/admin/approveTurtle', requireAdmin, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  turtleIpManager.approve(ip);
  log.info(`Turtle IP approved: ${ip} by ${req.token.sub}`);
  res.json({ ok: true });
});

app.post('/api/admin/revokeTurtle', requireAdmin, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  turtleIpManager.revoke(ip);
  log.info(`Turtle IP revoked: ${ip} by ${req.token.sub}`);
  res.json({ ok: true });
});

app.get('/api/admin/operatorRequests', requireAdmin, (_req, res) => {
  res.json(operatorManager.getRequests());
});

app.get('/api/admin/operators', requireAdmin, (_req, res) => {
  res.json(operatorManager.getOperators());
});

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

app.get('/api/admin/computerIds', requireAdmin, (_req, res) => {
  res.json(computerIdManager.getAll());
});

app.post('/api/admin/approveTurtleId', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  computerIdManager.approve(id);
  log.info(`Turtle ID approved: ${id} by ${req.token.sub}`);
  res.json({ ok: true });
});

app.post('/api/admin/denyTurtleId', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  computerIdManager.deny(id);
  log.info(`Turtle ID denied: ${id} by ${req.token.sub}`);
  res.json({ ok: true });
});

app.post('/api/admin/revokeTurtleId', requireAdmin, (req, res) => {
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
  // If the deleted computer was the modem server, clear modem state and reboot
  // all remaining computers so they stop routing through the now-dead modem.
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

// --- Helpers ---
function clearCommandQueue(id, sub) {
  cmds[id] = [];
  log.info(`/api/clearCommandQueue id=${id} user=${sub}`);
  userManagement.incrementActionCount(sub);
}

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
      // Compact format: flat array [x,y,z,nameIdx] (stride=4) or [x,y,z,nameIdx,metadata] (stride=5)
      for (let i = 0; i < blockData.length; i += stride) {
        const locString = `${blockData[i]},${blockData[i + 1]},${blockData[i + 2]}`;
        const block = { name: palette[blockData[i + 3]] };
        if (stride >= 5 && blockData[i + 4]) block.metadata = blockData[i + 4];
        blocks[locString] = block;
      }
    } else if (indexed) {
      // Legacy format: {"x,y,z": idx}
      for (const [locString, idx] of Object.entries(indexed)) {
        blocks[locString] = { name: palette[idx] };
      }
    }
    parsed.world = { blocks };
  }
  // Migrate old saved files that used `turtle` key
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

const PORT = parseInt(process.env.APP_PORT || '8081', 10);
const server = app.listen(PORT, () => log.info(`Turtle remote controller server listening on port ${PORT}.`));
autoSave();

// --- Browser WebSocket server ---
const wss = new WebSocketServer({ server });
wss.on('connection', async (ws, req) => {
  const token = await getSession(req);
  if (!token) { ws.close(4401, 'Unauthorized'); return; }
  browserClients.add(ws);
  ws.send(JSON.stringify({ state }));
  ws.on('close', () => browserClients.delete(ws));
  ws.on('error', () => { browserClients.delete(ws); ws.terminate(); });
});

const terminator = httpTerminator.createHttpTerminator({ gracefulTerminationTimeout: 200, server });
process.on('SIGINT', async () => {
  await terminator.terminate();
  saveStateToDisk();
  userManagement.save();
  process.exit(0);
});