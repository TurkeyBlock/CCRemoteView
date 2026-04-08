require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const compression = require('compression')
const { Vector3 } = require('math3d');
const fs = require('fs');
const app = express();
const httpTerminator = require('http-terminator');
const simpleNodeLogger = require('simple-node-logger');
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
  origin: IS_PROD
    ? /turkeyblock\.org$/
    : 'http://localhost:3000'
}));
app.use(express.json({ limit: '10mb' }));
// Gate the SPA entry point — browser navigations redirect to sign-in if no session
app.get('/', async (req, res, next) => {
  const token = await getSession(req);
  if (!token) return res.redirect(SIGNIN_URL);
  next();
});

app.use(express.static('dist'));
app.use('/textures', express.static('textures'));
app.use('/turtle', express.static('turtle'));
app.use('/computers', express.static('computers'));

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
let modemServerId = null;

const userManagement = new UserManagement();
const turtleIpManager = new TurtleIpManager();
const computerIdManager = new ComputerIdManager();
const operatorManager = new OperatorManager();
const cmdLineInterface = new CommandLineInterface();
cmdLineInterface.on('users', () => console.log(userManagement.getUserDataString()));
cmdLineInterface.on('deleteComputer', (id) => delete state.computers[id]);

try {
  state = deserializeState(fs.readFileSync('./src/server/saved/saved_state.json', 'utf8'));
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
  applyTransaction(extractState(req.body, state), state, transactionCache);
  if (state.computers[req.body.id]) state.computers[req.body.id].lastSeen = Date.now();
  res.sendStatus(200);
});

app.post('/api/scan', requireApprovedComputer, (req, res) => {
  const { id, blocks } = req.body;
  if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks must be an array' });

  const now = Date.now();
  if (scanLastTime[id] && now - scanLastTime[id] < SCAN_MIN_INTERVAL_MS)
    return res.status(429).json({ error: 'rate limited' });
  scanLastTime[id] = now;

  const computer = state.computers[String(id)];
  if (!computer?.loc) return res.status(400).json({ error: 'computer position unknown — send a state update first' });

  // Minecarts send a fresh GPS fix as `origin` — prefer that over stale state loc
  const origin = req.body.origin ?? computer.loc;
  const { x: tx, y: ty, z: tz } = origin;
  const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: {} };

  for (const block of blocks) {
    const locString = `${tx + block.x},${ty + block.y},${tz + block.z}`;
    if (!block.name || block.name === 'minecraft:air') {
      if (state.world.blocks[locString]) transaction.blocks[locString] = null;
    } else {
      transaction.blocks[locString] = { name: block.name };
    }
  }

  if (Object.keys(transaction.blocks).length > 0) {
    applyTransaction(transaction, state, transactionCache);
    state.lastReadyTransactionId++;
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
  log.info(`/api/chat id=${id} player=${player} message=${message}`);
  res.json({ ok: true });
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

// Modem server registration — modem server calls this on startup so clients can discover it.
// When a new modem ID registers, queues os.reboot() for all known computers so they
// reload, discover the modem, and switch to modem mode automatically.
app.post('/api/modem/register', requireApprovedComputer, (req, res) => {
  const { id } = req.body;
  if (id === undefined) return res.status(400).json({ error: 'id required' });
  if (modemServerId !== id) {
    modemServerId = id;
    log.info(`Modem server registered: ID ${id} — queuing reboot for all computers`);
    for (const computerId of Object.keys(state.computers)) {
      if (!cmds[computerId]) cmds[computerId] = [];
      cmds[computerId].push('os.reboot()');
    }
  }
  res.json({ ok: true });
});

// Open endpoint — computers query this on boot to discover the modem server ID
app.get('/api/modem/id', (_req, res) => {
  res.json({ id: modemServerId });
});

// Batch endpoints used by the modem proxy server
app.post('/api/getCommands', requireApprovedComputer, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const result = {};
  for (const id of ids) {
    if (cmds[id] && cmds[id].length > 0) {
      result[String(id)] = cmds[id].shift();
    }
  }
  res.json(result);
});

app.post('/api/getStopSignals', requireApprovedComputer, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const result = {};
  for (const id of ids) {
    if (stopSignal[id]) {
      result[String(id)] = true;
      delete stopSignal[id];
    }
  }
  res.json(result);
});

// --- Browser endpoints (session gated) ---
app.get('/api/state', requireAuth, compression(), (_req, res) => {
  res.send(state);
});

app.post('/api/getStateUpdate', requireAuth, compression(), (req, res) => {
  if (!req.body.lastTransactionId == -1) {
    res.send({ state });
    log.info(`/api/getStateUpdate : sent full state to ${req.token.sub}`);
    return;
  }
  if (req.body.lastTransactionId > state.lastReadyTransactionId) {
    res.send({ state });
    log.info(`/api/getStateUpdate : sent full state to ${req.token.sub} (server restarted)`);
    return;
  }
  let newTransactionId = req.body.lastTransactionId + 1;
  let resJson = { transactions: {} };
  if (newTransactionId > state.lastTransactionId) { res.send(resJson); return; }
  if (!transactionCache[newTransactionId]) {
    res.send({ state });
    log.info(`/api/getStateUpdate : sent full state to ${req.token.sub} (transactions not cached)`);
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

app.post('/api/setStopSignal', requireOperator, (req, res) => {
  const json = req.body;
  if (isNaN(json.id)) { res.sendStatus(400); return; }
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

app.get('/api/turtleFileNames', requireApprovedComputer, (_req, res) => {
  res.send(fs.readdirSync('turtle'));
});

app.post('/api/saveState', requireAuth, (_req, res) => {
  saveStateToDisk();
  res.sendStatus(200);
});

app.get('/api/me', requireAuth, (req, res) => {
  let savedFileSizeBytes = null;
  try { savedFileSizeBytes = fs.statSync('./src/server/saved/saved_state.json').size; } catch {}
  res.json({
    username: req.token.username ?? req.token.name ?? null,
    email: req.token.email ?? null,
    isAdmin: isAdmin(req.token.sub),
    isOperator: isOperator(req.token.sub),
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

app.post('/api/admin/deleteTurtle', requireAdmin, (req, res) => {
  const { id } = req.body;
  if (id === undefined) return res.status(400).json({ error: 'id required' });
  delete state.computers[id];
  cmds[id] = [];
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
  const blocks = {};
  for (const [locString, block] of Object.entries(s.world.blocks)) {
    const name = block.name;
    if (nameToIdx[name] === undefined) {
      nameToIdx[name] = palette.length;
      palette.push(name);
    }
    blocks[locString] = nameToIdx[name];
  }
  return JSON.stringify({ computers: s.computers, world: { palette, blocks } });
}

function deserializeState(raw) {
  const parsed = JSON.parse(raw);
  if (parsed.world && Array.isArray(parsed.world.palette)) {
    const { palette, blocks: indexed } = parsed.world;
    const blocks = {};
    for (const [locString, idx] of Object.entries(indexed)) {
      blocks[locString] = { name: palette[idx] };
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
  const target = './src/server/saved/saved_state.json';
  const tmp    = './src/server/saved/saved_state.tmp.json';
  fs.writeFileSync(tmp, serializeState(state));
  fs.renameSync(tmp, target);
}

function autoSave() {
  saveStateToDisk();
  userManagement.save();
  setTimeout(autoSave, AUTOSAVE_INTERVAL_MIN * 60 * 1000);
}

const server = app.listen(8081, () => log.info('Turtle remote controller server listening on port 8081.'));
autoSave();

const terminator = httpTerminator.createHttpTerminator({ gracefulTerminationTimeout: 200, server });
process.on('SIGINT', async () => {
  await terminator.terminate();
  saveStateToDisk();
  userManagement.save();
  process.exit(0);
});