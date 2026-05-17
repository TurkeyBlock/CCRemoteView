'use strict';

module.exports = function subscribeCanvas(msg, ctx) {
  const { ws, state, safeId, canvasSubscriptions, userSub, log } = ctx;
  const id = safeId(msg.computerId);
  if (!id) return;
  if (msg.subscribe) {
    if (!canvasSubscriptions[id]) canvasSubscriptions[id] = new Set();
    canvasSubscriptions[id].add(ws);
    const scene = state.computers[id]?.glassesScene ?? [];
    ws.send(JSON.stringify({ canvasUpdate: { computerId: Number(id), scene } }));
    log.info(`[ws] subscribeCanvas id=${id} user=${userSub} (${canvasSubscriptions[id].size} subscribers)`);
  } else {
    canvasSubscriptions[id]?.delete(ws);
    if (canvasSubscriptions[id]?.size === 0) delete canvasSubscriptions[id];
    log.info(`[ws] unsubscribeCanvas id=${id} user=${userSub}`);
  }
};
