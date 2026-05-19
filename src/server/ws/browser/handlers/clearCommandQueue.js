'use strict';

const { LOG_BROWSER_CMDS } = require('../../../config');
const { requireOperator } = require('./authGuard');

module.exports = requireOperator(function clearCommandQueue(msg, ctx) {
  const { safeId, clearCommandQueue: clearQueue, userSub, log, userManagement } = ctx;
  const id = safeId(msg.id);
  if (!id) return;
  userManagement.incrementActionCount(userSub);
  clearQueue(id);
  if (LOG_BROWSER_CMDS) log.info(`[ws] clearCommandQueue id=${id} user=${userSub}`);
});
