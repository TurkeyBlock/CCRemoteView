'use strict';

const { commandRouting, validateArgs, buildLuaCommand } = require('../../../commandRouting');
const { requireOperator } = require('./authGuard');

module.exports = requireOperator(function invokeCommand(msg, ctx) {
  const { ws, state, safeId, sanitizeForLog, sendOrQueue, userSub, log, userManagement } = ctx;
  const id = safeId(msg.id);
  if (!id) return;
  const commandName = msg.command;
  if (!commandName || typeof commandName !== 'string' || commandName.length > 100) return;
  const computerType = state.computers[id]?.type;
  const commandDef   = commandRouting[computerType]?.commands?.[commandName];
  if (!commandDef) {
    ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: `Unknown command: ${sanitizeForLog(commandName)}` }));
    log.warn(`[ws] invokeCommand rejected — unknown command=${sanitizeForLog(commandName)} id=${id} user=${userSub}`);
    return;
  }
  const args = Array.isArray(msg.args) ? msg.args : [];
  const validationError = validateArgs(commandDef.args, args);
  if (validationError) {
    ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: `Invalid args: ${validationError}` }));
    log.warn(`[ws] invokeCommand rejected — ${validationError} command=${commandName} id=${id} user=${userSub}`);
    return;
  }
  const luaCmd = buildLuaCommand(computerType, commandName, commandDef.args, args);
  userManagement.incrementActionCount(userSub);
  sendOrQueue(id, luaCmd, commandDef.concurrent,
    `[ws] invokeCommand id=${id} user=${userSub} command=${commandName}`);
});
