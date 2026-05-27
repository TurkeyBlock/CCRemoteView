'use strict';

const { state, transactionCache, txTimestamps } = require('./state');
const { broadcastTransaction } = require('./broadcast');
const { CHAT_DEDUP_WINDOW_MS, MAX_CHAT_LOG_SIZE } = require('../config');

// Append a chat message to the global log with cross-computer dedup.
// Multiple computers can report the same chat event; suppress if a different
// computer already logged the same player+message within 30 s. A repeat from
// the SAME computer is never a dup — it means the player said it again.
// Returns the new entry on success, null if it was a duplicate.
function addChatMessage(player, message, uuid, computerId) {
  const now    = Date.now();
  const cutoff = now - CHAT_DEDUP_WINDOW_MS;
  const log    = state.chatLog;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].timestamp < cutoff) break;
    if (log[i].player === player && log[i].message === message && log[i].computerId !== computerId) return null;
  }
  const entry = { player, message, uuid: uuid || '', timestamp: now, computerId };
  log.push(entry);
  if (log.length > MAX_CHAT_LOG_SIZE) log.shift();
  return entry;
}

// Create a chat-only transaction, add it to the broadcast cache, and push
// it to all connected browser clients. Does NOT touch state.computers or
// state.world — chat lives entirely in state.chatLog.
function transactChat(newMsg) {
  const transaction = { id: ++state.lastTransactionId, blocks: {}, computers: {}, chatLog: [newMsg] };
  transactionCache[transaction.id] = transaction;
  txTimestamps.push([transaction.id, Date.now()]);
  state.lastReadyTransactionId++;
  broadcastTransaction(transaction);
}

module.exports = { addChatMessage, transactChat };
