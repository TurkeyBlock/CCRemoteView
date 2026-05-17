'use strict';

const { TRANSACTION_CACHE_TTL_MS, TRANSACTION_CACHE_MAX_COUNT } = require('../config');
const { state, transactionCache, txTimestamps, txTimestampsRef } = require('./state');
const { broadcastTransaction } = require('./broadcast');
const { processScanBlocks } = require('./scanRateLimit');

function applyTransaction(transaction) {
  for (const [locString, block] of Object.entries(transaction.blocks)) {
    if (block) state.world.blocks[locString] = block;
    else delete state.world.blocks[locString];
  }
  for (const [id, computerState] of Object.entries(transaction.computers)) {
    state.computers[id] = computerState;
  }
  const now = Date.now();
  transactionCache[transaction.id] = transaction;
  txTimestamps.push([transaction.id, now]);

  // Evict entries that exceed the time window or the count cap.
  while (txTimestampsRef.head < txTimestamps.length) {
    const age   = now - txTimestamps[txTimestampsRef.head][1];
    const count = txTimestamps.length - txTimestampsRef.head;
    if (age < TRANSACTION_CACHE_TTL_MS && count <= TRANSACTION_CACHE_MAX_COUNT) break;
    delete transactionCache[txTimestamps[txTimestampsRef.head][0]];
    txTimestampsRef.head++;
  }
  // Compact the timestamps array to prevent unbounded growth.
  if (txTimestampsRef.head > 10_000) {
    txTimestamps.splice(0, txTimestampsRef.head);
    txTimestampsRef.head = 0;
  }
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
    wsConnected:  existing?.wsConnected,
    wsRequestAt: existing?.wsRequestAt,
  };
  state.lastReadyTransactionId++;
  return transaction;
}

// Create a computer-only transaction, apply it, and broadcast it to all browser clients.
function transactComputer(id, computerState, blockUpdates = {}) {
  const transaction = { id: ++state.lastTransactionId, blocks: blockUpdates, computers: { [id]: computerState } };
  applyTransaction(transaction);
  state.lastReadyTransactionId++;
  broadcastTransaction(transaction);
  return transaction;
}

// Like transactComputer but for sparse statusUpdate deltas. Merges delta into the
// server-side authoritative state, then broadcasts ONLY the delta fields (not full state).
// Browsers that receive a transaction with _delta:true merge it instead of replacing.
function transactComputerDelta(id, delta) {
  const existing = state.computers[id] || {};
  const merged = { ...existing, ...delta };
  if (!merged.loc && existing.loc) merged.loc = existing.loc;
  state.computers[id] = merged;
  const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: { ...delta, _delta: true } } };
  // Apply only updates the in-memory cache; browsers merge rather than replace.
  transactionCache[transaction.id] = transaction;
  txTimestamps.push([transaction.id, Date.now()]);
  state.lastReadyTransactionId++;
  broadcastTransaction(transaction);
  return transaction;
}

// Run extractState (which increments lastReadyTransactionId internally), then apply + broadcast.
function applyExtractedState(mergedData) {
  const transaction = extractState(mergedData);
  applyTransaction(transaction);
  broadcastTransaction(transaction);
  return transaction;
}

// Build a scan transaction, and if it has any block changes apply + broadcast it.
// Returns the number of changed blocks.
function commitScan(id, blocks, origin) {
  const transaction = processScanBlocks(id, blocks, origin);
  const count = Object.keys(transaction.blocks).length;
  if (count > 0) {
    applyTransaction(transaction);
    state.lastReadyTransactionId++;
    broadcastTransaction(transaction);
  }
  return count;
}

function setWsRequest(id) {
  const { wsRequests } = require('./state');
  wsRequests[id] = true;
  if (state.computers[id]) {
    state.computers[id].wsRequestAt = Date.now();
    const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: { [id]: { ...state.computers[id] } } };
    applyTransaction(transaction);
    state.lastReadyTransactionId++;
    broadcastTransaction(transaction);
  }
}

function clearCommandQueue(id) {
  const { cmds } = require('./state');
  cmds[id] = [];
}

function recordCommandResult(cid, result) {
  const { commandResultCache } = require('./state');
  const { CMD_RESULT_CACHE_MAX } = require('../config');
  const bucket = commandResultCache[cid] ??= [];
  bucket.push(result);
  if (bucket.length > CMD_RESULT_CACHE_MAX) bucket.shift();
}

// Returns the highest transaction ID that is no longer in the cache.
// Any client whose lastTx is above this value can catch up via delta.
function getTransactionCacheFloor() {
  return txTimestampsRef.head < txTimestamps.length
    ? txTimestamps[txTimestampsRef.head][0] - 1
    : state.lastTransactionId;
}

module.exports = {
  applyTransaction, extractState,
  transactComputer, transactComputerDelta, applyExtractedState,
  commitScan, setWsRequest, clearCommandQueue, recordCommandResult,
  getTransactionCacheFloor,
};
