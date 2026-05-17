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
      if (SCAN_INCLUDE_METADATA && block.metadata != null) entry.metadata = block.metadata;
      if (SCAN_INCLUDE_STATE && block.state != null && Object.keys(block.state).length > 0) entry.state = block.state;
      transaction.blocks[locString] = entry;
    }
  }
  return transaction;
}

module.exports = { isScanRateLimited, processScanBlocks };
