'use strict';

const fs   = require('fs');
const zlib = require('zlib');
const {
  AUTOSAVE_INTERVAL_MIN, TRANSACTION_CACHE_COUNT,
  SAVE_GZ_PATH, SAVE_JSON_PATH,
  SCAN_MIN_INTERVAL_MS, SCAN_INCLUDE_METADATA, SCAN_INCLUDE_STATE,
  CMD_RESULT_CACHE_MAX,
} = require('./config');

// ─── Mutable state ───────────────────────────────────────────────────────────
// Use a stable object reference so modules that import `state` always see the
// current value — we never reassign the variable, only mutate properties.
const state = {
  computers: {},
  world: { blocks: {} },
  lastTransactionId: 0,
  lastReadyTransactionId: 0,
};
const transactionCache    = {};
const commandResultCache  = {};
const cmds                = {};
const stopSignal          = {};
const wsRequests          = {};
const computerWs          = {};
const browserClients      = new Set();
const scanLastTime        = {};
const guestStateLastTime  = {};

// ─── Utilities ───────────────────────────────────────────────────────────────

// Validates a computer ID: non-negative integer ≤ 1 000 000.
// Returns the numeric string form, or null if invalid.
// Guards against prototype-pollution keys (__proto__, constructor, prototype).
function safeId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_000) return null;
  return String(n);
}

// Strip control characters before logging to prevent log-injection.
function sanitizeForLog(val) {
  return String(val ?? '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 500);
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function serializeState(s) {
  const palette   = [];
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
    const { entities: _e, ...rest } = c;
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
  fs.mkdirSync('./src/server/data', { recursive: true });
  const target = SAVE_GZ_PATH;
  const tmp    = `${SAVE_GZ_PATH}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(serializeState(state)));
  fs.renameSync(tmp, target);
}

function startAutoSave(onSave) {
  function tick() {
    saveStateToDisk();
    onSave?.();
    setTimeout(tick, AUTOSAVE_INTERVAL_MIN * 60 * 1000);
  }
  tick();
}

// ─── Load saved state ────────────────────────────────────────────────────────

try {
  let raw;
  let sourceFile = SAVE_GZ_PATH;
  try {
    raw = zlib.gunzipSync(fs.readFileSync(SAVE_GZ_PATH)).toString('utf8');
  } catch {
    sourceFile = SAVE_JSON_PATH;
    raw = fs.readFileSync(SAVE_JSON_PATH, 'utf8');
  }
  try {
    const loaded = deserializeState(raw);
    Object.assign(state, loaded);
    state.lastTransactionId      = 0;
    state.lastReadyTransactionId = 0;
  } catch (e) {
    const corruptedPath = `${sourceFile}.${Date.now()}.corrupted`;
    fs.renameSync(sourceFile, corruptedPath);
    console.error(`[startup] Corrupted save file — renamed to ${corruptedPath}. Starting with empty state.`);
    console.error(`[startup] Parse error: ${e.message}`);
  }
} catch { /* file missing on first run — expected */ }

// ─── Broadcasting ────────────────────────────────────────────────────────────

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

// ─── Core logic ──────────────────────────────────────────────────────────────

function applyTransaction(transaction) {
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

function extractState(computerState) {
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
    }

    function blockOnly(b) {
      if (!b) return null;
      const { inventory, inventorySize, ...rest } = b;
      return Object.keys(rest).length ? rest : null;
    }
    transaction.blocks[topKey]    = blockOnly(computerState.view.top);
    transaction.blocks[bottomKey] = blockOnly(computerState.view.bottom);
    if (frontKey) transaction.blocks[frontKey] = blockOnly(computerState.view.front);

    const adjacentInventory = {};
    const viewPairs = [[topKey, computerState.view.top], [bottomKey, computerState.view.bottom]];
    if (frontKey) viewPairs.push([frontKey, computerState.view.front]);
    for (const [key, block] of viewPairs) {
      if (block?.inventory) adjacentInventory[key] = { inventory: block.inventory, inventorySize: block.inventorySize };
    }
    computerState.adjacentInventory = adjacentInventory;
  }

  const existing = state.computers[computerState.id];
  transaction.computers[computerState.id] = {
    ...computerState,
    ws_connected:  existing?.ws_connected,
    ws_request_at: existing?.ws_request_at,
  };
  state.lastReadyTransactionId++;
  return transaction;
}

// Create a computer-only transaction, apply it, and broadcast it to all browser clients.
function transactComputer(id, computerState, blockUpdates = {}) {
  const t = { id: ++state.lastTransactionId, blocks: blockUpdates, computers: { [id]: computerState } };
  applyTransaction(t);
  state.lastReadyTransactionId++;
  broadcastTransaction(t);
  return t;
}

// Run extractState (which increments lastReadyTransactionId internally), then apply + broadcast.
function applyExtractedState(mergedData) {
  const t = extractState(mergedData);
  applyTransaction(t);
  broadcastTransaction(t);
  return t;
}

// Build a scan transaction, and if it has any block changes apply + broadcast it.
// Returns the number of changed blocks.
function commitScan(id, blocks, origin) {
  const t = processScanBlocks(id, blocks, origin);
  const count = Object.keys(t.blocks).length;
  if (count > 0) {
    applyTransaction(t);
    state.lastReadyTransactionId++;
    broadcastTransaction(t);
  }
  return count;
}

function setWsRequest(id) {
  wsRequests[id] = true;
  if (state.computers[id]) {
    state.computers[id].ws_request_at = Date.now();
    const t = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: { ...state.computers[id] } } };
    applyTransaction(t);
    state.lastReadyTransactionId++;
    broadcastTransaction(t);
  }
}

function clearCommandQueue(id) {
  cmds[id] = [];
}

// ─── Scan rate-limit helpers (used by routes and WS handlers) ────────────────

function isScanRateLimited(id) {
  const now = Date.now();
  if (scanLastTime[id] && now - scanLastTime[id] < SCAN_MIN_INTERVAL_MS) return true;
  scanLastTime[id] = now;
  return false;
}

function processScanBlocks(id, blocks, origin) {
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
  return transaction;
}

module.exports = {
  state,
  transactionCache, commandResultCache, cmds, stopSignal, wsRequests, computerWs,
  browserClients, scanLastTime, guestStateLastTime,
  safeId, sanitizeForLog,
  saveStateToDisk, startAutoSave,
  broadcastToClients,
  setWsRequest, clearCommandQueue,
  transactComputer, applyExtractedState, commitScan,
  isScanRateLimited,
  CMD_RESULT_CACHE_MAX,
};
