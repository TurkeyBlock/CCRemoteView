'use strict';

const { MAX_SCENE_OBJECTS, ALLOWED_UPDATE_FIELDS } = require('./glassesConstants');
const { validateGlassesObject, isSceneWithinCharLimit } = require('./glassesValidation');

// Per-op handlers for `glassesSceneOp`. Each takes the current scene (an array copy
// the caller already made) and the raw msg, and returns either null (invalid / no-op,
// caller should skip) or { next: <new scene array>, batch: <live-batch payload | null> }.
// Validation, cap checks, and mutation semantics are preserved exactly.
const sceneOps = {
  add(scene, msg) {
    if (!validateGlassesObject(msg.object)) return null;
    if (scene.length >= MAX_SCENE_OBJECTS) return null;
    const next = [...scene, msg.object];
    if (!isSceneWithinCharLimit(next)) return null;
    return { next, batch: { add: { [msg.object.type]: [msg.object] } } };
  },
  update(scene, msg) {
    if (typeof msg.objectId !== 'string') return null;
    const idx = scene.findIndex(o => o.id === msg.objectId);
    if (idx === -1) return null;
    const existingType = scene[idx].type;
    const allowed = ALLOWED_UPDATE_FIELDS[existingType];
    if (!allowed) return null;
    if (!msg.object || typeof msg.object !== 'object' || Array.isArray(msg.object)) return null;
    const patch = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(msg.object, key)) patch[key] = msg.object[key];
    }
    const merged = { ...scene[idx], ...patch, id: scene[idx].id, type: scene[idx].type };
    if (!validateGlassesObject(merged)) return null;
    const next = [...scene]; next[idx] = merged;
    // Updates can also blow the cap — text content in particular has no inherent length limit.
    if (!isSceneWithinCharLimit(next)) return null;
    const batch = Object.keys(patch).length > 0 ? { upd: { [msg.objectId]: patch } } : null;
    return { next, batch };
  },
  remove(scene, msg) {
    if (typeof msg.objectId !== 'string') return null;
    const idx = scene.findIndex(o => o.id === msg.objectId);
    if (idx === -1) return null;
    const next = [...scene]; next.splice(idx, 1);
    return { next, batch: { rm: [msg.objectId] } };
  },
  clear(scene, _msg) {
    return { next: [], batch: { clear: true } };
  },
  reorder(scene, msg) {
    const { fromIdx, toIdx } = msg;
    if (fromIdx == null || toIdx == null || fromIdx < 0 || toIdx < 0 || fromIdx >= scene.length || toIdx >= scene.length) return null;
    const minIdx = Math.min(fromIdx, toIdx);
    const next = [...scene];
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);
    // reorder batch: just the new suffix ID order. The Lua reorder handler
    // removes handles itself (without clearing glassesProps) before re-adding.
    return { next, batch: { reorder: next.slice(minIdx).map(o => o.id) } };
  },
  groupChildUpdate(scene, msg) {
    if (typeof msg.groupId !== 'string' || typeof msg.childId !== 'string') return null;
    if (!msg.delta || typeof msg.delta !== 'object' || Array.isArray(msg.delta)) return null;
    const gIdx = scene.findIndex(o => o.id === msg.groupId);
    if (gIdx === -1 || scene[gIdx].type !== 'group') return null;
    const group = scene[gIdx];
    const cIdx = (group.children || []).findIndex(c => c.id === msg.childId);
    if (cIdx === -1) return null;
    const childType = group.children[cIdx].type;
    const allowedChild = ALLOWED_UPDATE_FIELDS[childType];
    if (!allowedChild) return null;
    const childPatch = {};
    for (const key of allowedChild) {
      if (Object.prototype.hasOwnProperty.call(msg.delta, key)) childPatch[key] = msg.delta[key];
    }
    const newChildren = [...group.children];
    const mergedChild = { ...newChildren[cIdx], ...childPatch, id: newChildren[cIdx].id, type: newChildren[cIdx].type };
    if (!validateGlassesObject(mergedChild, 1)) return null;
    newChildren[cIdx] = mergedChild;
    const updatedGroup = { ...group, children: newChildren };
    const next = [...scene]; next[gIdx] = updatedGroup;
    if (!isSceneWithinCharLimit(next)) return null;
    return { next, batch: { child_upd: { [msg.groupId]: { [msg.childId]: childPatch } } } };
  },
  group(scene, msg) {
    if (!Array.isArray(msg.objectIds) || msg.objectIds.length < 2) return null;
    if (!validateGlassesObject(msg.groupObject)) return null;
    if (!msg.objectIds.every(oid => typeof oid === 'string' && scene.some(o => o.id === oid))) return null;
    if (msg.objectIds.some(oid => scene.find(o => o.id === oid)?.type === 'group')) return null;
    const idSet = new Set(msg.objectIds);
    const next = [...scene.filter(o => !idSet.has(o.id)), msg.groupObject];
    if (!isSceneWithinCharLimit(next)) return null;
    return { next, batch: { rm: msg.objectIds, add: { group: [msg.groupObject] } } };
  },
  ungroup(scene, msg) {
    if (typeof msg.objectId !== 'string') return null;
    const idx = scene.findIndex(o => o.id === msg.objectId);
    if (idx === -1 || scene[idx].type !== 'group') return null;
    const g = scene[idx];
    const flat = (g.children || []).map(child => {
      if (child.type === 'line') return { ...child, x1: child.x1 + g.x, y1: child.y1 + g.y, x2: child.x2 + g.x, y2: child.y2 + g.y };
      if ((child.type === 'polygon' || child.type === 'lines') && Array.isArray(child.points))
        return { ...child, points: child.points.map(([x, y]) => [x + g.x, y + g.y]) };
      return { ...child, x: (child.x ?? 0) + g.x, y: (child.y ?? 0) + g.y };
    });
    const next = [...scene];
    next.splice(idx, 1, ...flat);
    const addMap = {};
    for (const child of flat) {
      if (!addMap[child.type]) addMap[child.type] = [];
      addMap[child.type].push(child);
    }
    return { next, batch: { rm: [msg.objectId], add: addMap } };
  },
};

module.exports = { sceneOps };
