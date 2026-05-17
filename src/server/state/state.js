'use strict';

const fs   = require('fs');
const zlib = require('zlib');
const { SAVE_GZ_PATH, SAVE_JSON_PATH } = require('../config');

// Stable object reference so modules that import `state` always see the
// current value — we never reassign the variable, only mutate properties.
const state = {
  computers: {},
  world: { blocks: {} },
  chatLog: [],
  lastTransactionId: 0,
  lastReadyTransactionId: 0,
};

const transactionCache    = {};
const txTimestamps        = [];  // [id, timestampMs] tuples, oldest-first
const txTimestampsRef     = { head: 0 };  // mutable head index shared with transactions.js
const commandResultCache  = {};
const cmds                = {};
const stopSignal          = {};
const wsRequests          = {};
const computerWs          = {};
const glassesNeedsSync    = new Set();
const browserClients      = new Set();
const scanLastTime        = {};

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
  if (!Array.isArray(parsed.chatLog)) parsed.chatLog = [];
  return parsed;
}

// Load saved state on startup
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
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error('[startup] Unexpected error reading save file:', err);
  }
}

module.exports = {
  state,
  transactionCache, txTimestamps, txTimestampsRef,
  commandResultCache, cmds, stopSignal, wsRequests, computerWs,
  glassesNeedsSync, browserClients, scanLastTime,
  deserializeState,
};
