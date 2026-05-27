'use strict';

const { SCENE_CAP_CHARS } = require('./glassesConstants');
const { sceneOps } = require('./glassesSceneOps');
const { escapeLuaStringArg } = require('../../../utils/luaEscape');
const { requireOperator } = require('./authGuard');

module.exports = requireOperator(function glassesSceneOp(msg, ctx) {
  const { state, computerWs, safeId, setWsRequest, sendOrQueue, canvasSubscriptions, canvasRateLimit, log } = ctx;
  if (canvasRateLimit()) return;
  const id = safeId(msg.computerId);
  if (!id) return;
  const current = state.computers[id];
  if (!current) return;
  if (!computerWs[id] || computerWs[id].readyState !== 1) { setWsRequest(id); return; }

  if (ctx.glassesNeedsSync.has(id)) {
    ctx.glassesNeedsSync.delete(id);
    const existing = Array.isArray(current.glassesScene) ? current.glassesScene : [];
    if (existing.length > 0) {
      const sj = JSON.stringify(existing);
      if (sj.length <= SCENE_CAP_CHARS) {
        const esc = escapeLuaStringArg(sj);
        computerWs[id].send(JSON.stringify({ type: 'command', command: `return papi.glassesSetCanvas("${esc}")`, concurrent: true }));
        log.info(`[ws] glassesNeedsSync id=${id} — sent full scene before first op (${sj.length} chars)`);
      }
    }
  }

  const scene = Array.isArray(current.glassesScene) ? [...current.glassesScene] : [];
  const handler = sceneOps[msg.op];
  if (!handler) return;
  const out = handler(scene, msg);
  if (!out) return;

  state.computers[id] = { ...current, glassesScene: out.next };

  if (out.batch) {
    const opsJson = JSON.stringify(out.batch);
    if (opsJson.length <= 8000) {
      const escaped = escapeLuaStringArg(opsJson);
      sendOrQueue(id, `return papi.glassesApplyOps("${escaped}")`, true, `[ws] glassesApplyOps id=${id}`);
    } else {
      log.warn(`[ws] glassesApplyOps batch too large (${opsJson.length} chars), skipping dispatch for id=${id}`);
    }
  }

  const canvasMsg = JSON.stringify({ canvasUpdate: { computerId: Number(id), scene: out.next } });
  for (const sub of canvasSubscriptions[id] ?? []) {
    if (sub.readyState === 1) sub.send(canvasMsg);
  }
});
