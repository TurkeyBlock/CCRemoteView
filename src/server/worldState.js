'use strict';

// Barrel — the state module was split into src/server/state/ in 2026-05.
// Keep this file's export shape stable so consumers (routes/, ws/, index.js)
// continue to receive a single `worldState` object via destructured imports.

const { CMD_RESULT_CACHE_MAX } = require('./config');
const {
  state,
  transactionCache, commandResultCache, cmds, stopSignal, wsRequests, computerWs,
  glassesNeedsSync, browserClients, scanLastTime,
} = require('./state/state');
const { safeId, sanitizeForLog } = require('./state/validation');
const { saveStateToDisk, startAutoSave } = require('./state/persistence');
const { broadcastToClients } = require('./state/broadcast');
const {
  applyTransaction, extractState,
  transactComputer, transactComputerDelta, applyExtractedState,
  commitScan, setWsRequest, clearCommandQueue, recordCommandResult,
  getTransactionCacheFloor,
} = require('./state/transactions');
const { addChatMessage, transactChat } = require('./state/chat');
const { isScanRateLimited } = require('./state/scanRateLimit');

module.exports = {
  state,
  transactionCache, commandResultCache, cmds, stopSignal, wsRequests, computerWs,
  glassesNeedsSync, browserClients, scanLastTime,
  safeId, sanitizeForLog,
  saveStateToDisk, startAutoSave, getTransactionCacheFloor,
  broadcastToClients,
  setWsRequest, clearCommandQueue, recordCommandResult,
  transactComputer, transactComputerDelta, applyExtractedState, commitScan,
  addChatMessage, transactChat,
  isScanRateLimited,
  // Less-commonly used but referenced internally; keep exported for compat.
  applyTransaction, extractState,
  CMD_RESULT_CACHE_MAX,
};
