'use strict';

const { SCENE_CAP_CHARS, MAX_SCENE_OBJECTS } = require('./glassesConstants');
const { validateGlassesObject } = require('./glassesValidation');
const { escapeLuaStringArg } = require('../../../utils/luaEscape');

module.exports = function setGlassesScene(msg, ctx) {
  const { ws, state, computerWs, safeId, setWsRequest, sendOrQueue, canvasSubscriptions, canvasRateLimit, userSub, log } = ctx;
  if (canvasRateLimit()) return;
  const id = safeId(msg.computerId);
  if (!id) return;
  const current = state.computers[id];
  if (!current) return;
  if (!computerWs[id] || computerWs[id].readyState !== 1) { setWsRequest(id); return; }
  ctx.glassesNeedsSync.delete(id);
  const scene = Array.isArray(msg.scene)
    ? msg.scene.filter(o => validateGlassesObject(o)).slice(0, MAX_SCENE_OBJECTS)
    : [];
  const sceneJson = JSON.stringify(scene);
  if (sceneJson.length > SCENE_CAP_CHARS) {
    ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: 'Scene JSON exceeds 16,000 character limit' }));
    return;
  }
  state.computers[id] = { ...current, glassesScene: scene };
  log.info(`[ws] setGlassesScene id=${id} user=${userSub} count=${scene.length}`);
  const escaped = escapeLuaStringArg(sceneJson);
  sendOrQueue(id, `return papi.glassesSetCanvas("${escaped}")`, true, `[ws] glassesSetCanvas id=${id}`);
  const canvasMsg = JSON.stringify({ canvasUpdate: { computerId: Number(id), scene } });
  for (const sub of canvasSubscriptions[id] ?? []) {
    if (sub.readyState === 1) sub.send(canvasMsg);
  }
};
