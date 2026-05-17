'use strict';

const { MAX_CMD_LENGTH } = require('../../../config');
const { isConcurrentCommand } = require('../../../commandRouting');

module.exports = function setCommand(msg, ctx) {
  const { ws, state, safeId, sanitizeForLog, sendOrQueue, userSub, wsIsAdmin, log, userManagement } = ctx;
  const id = safeId(msg.id);
  if (!id || !msg.cmd || typeof msg.cmd !== 'string' || msg.cmd.length > MAX_CMD_LENGTH) return;
  if (!wsIsAdmin) {
    ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: 'Admin required for raw Lua commands' }));
    log.warn(`[ws] setCommand rejected — admin required id=${id} user=${userSub} <${sanitizeForLog(msg.cmd)}>`);
    return;
  }
  userManagement.incrementActionCount(userSub);
  const concurrent = msg.concurrent !== undefined
    ? Boolean(msg.concurrent)
    : isConcurrentCommand(state.computers[id]?.type, msg.cmd);
  sendOrQueue(id, msg.cmd, concurrent,
    `[ws] setCommand id=${id} user=${userSub} <${sanitizeForLog(msg.cmd)}>`);
};
