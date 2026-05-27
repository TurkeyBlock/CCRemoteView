'use strict';

const { SCAN_MIN_INTERVAL_MS, SCAN_INCLUDE_METADATA, SCAN_INCLUDE_STATE } = require('../config');
const { state, scanLastTime } = require('./state');

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
      if (SCAN_INCLUDE_METADATA && typeof block.metadata === 'number' && block.metadata >= 0 && block.metadata <= 15) {
        entry.metadata = block.metadata;
      }
      if (SCAN_INCLUDE_STATE && block.state != null && typeof block.state === 'object' && !Array.isArray(block.state)) {
        const stateKeys = Object.keys(block.state);
        if (stateKeys.length > 0 && stateKeys.length <= 16) {
          const safeState = {};
          for (const k of stateKeys) {
            if (typeof k !== 'string' || k.length > 32) continue;
            const v = block.state[k];
            if (typeof v === 'string' && v.length <= 64) safeState[k] = v;
            else if (typeof v === 'boolean') safeState[k] = v;
            else if (typeof v === 'number' && Number.isFinite(v)) safeState[k] = v;
          }
          if (Object.keys(safeState).length > 0) entry.state = safeState;
        }
      }
      transaction.blocks[locString] = entry;
    }
  }
  return transaction;
}

module.exports = { isScanRateLimited, processScanBlocks };
