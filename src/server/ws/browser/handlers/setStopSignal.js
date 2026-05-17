'use strict';

const { LOG_BROWSER_CMDS } = require('../../../config');

module.exports = function setStopSignal(msg, ctx) {
  const { computerWs, stopSignal, safeId, clearCommandQueue, userSub, log, userManagement } = ctx;
  const id = safeId(msg.id);
  if (!id) return;
  clearCommandQueue(id);
  if (LOG_BROWSER_CMDS) log.info(`[ws] setStopSignal id=${id} user=${userSub}`);
  userManagement.incrementActionCount(userSub);
  if (computerWs[id]?.readyState === 1) {
    computerWs[id].send(JSON.stringify({ type: 'stopSignal' }));
  } else {
    stopSignal[id] = true;
  }
};
