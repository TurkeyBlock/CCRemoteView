'use strict';

const { LOG_BROWSER_CMDS } = require('../../../config');

module.exports = function clearCommandQueue(msg, ctx) {
  const { safeId, clearCommandQueue: clearQueue, userSub, log, userManagement } = ctx;
  const id = safeId(msg.id);
  if (!id) return;
  userManagement.incrementActionCount(userSub);
  clearQueue(id);
  if (LOG_BROWSER_CMDS) log.info(`[ws] clearCommandQueue id=${id} user=${userSub}`);
};
