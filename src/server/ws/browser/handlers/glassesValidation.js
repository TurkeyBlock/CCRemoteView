'use strict';

const { GLASSES_TYPES, MAX_SCENE_TEXT_LENGTH,
        POLYGON_MIN_POINTS, POLYGON_MAX_POINTS, LINE_MIN_POINTS, LINE_MAX_POINTS,
        SCENE_CAP_CHARS } = require('./glassesConstants');

function isFinNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function isValidPointsArray(arr, min, max) {
  if (!Array.isArray(arr) || arr.length < min || arr.length > max) return false;
  return arr.every(p => Array.isArray(p) && p.length >= 2 && isFinNum(p[0]) && isFinNum(p[1]));
}

// Returns true only if obj is a structurally valid GlassesObject.
// depth=0 for top-level objects; depth=1 inside a group's children (groups cannot nest).
function validateGlassesObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.id !== 'string' || obj.id.length === 0 || obj.id.length > 64) return false;
  if (!GLASSES_TYPES.has(obj.type)) return false;
  const n = isFinNum;
  switch (obj.type) {
    case 'rect':
      return n(obj.x) && n(obj.y) && n(obj.w) && n(obj.h) && n(obj.rgba);
    case 'text':
      return n(obj.x) && n(obj.y) && typeof obj.content === 'string' && obj.content.length <= MAX_SCENE_TEXT_LENGTH
          && n(obj.rgba) && n(obj.size) && typeof obj.shadow === 'boolean';
    case 'line':
      return n(obj.x1) && n(obj.y1) && n(obj.x2) && n(obj.y2) && n(obj.rgba) && n(obj.thickness);
    case 'dot':
      return n(obj.x) && n(obj.y) && n(obj.rgba) && n(obj.size);
    case 'polygon':
      return isValidPointsArray(obj.points, POLYGON_MIN_POINTS, POLYGON_MAX_POINTS) && n(obj.rgba);
    case 'lines':
      return isValidPointsArray(obj.points, LINE_MIN_POINTS, LINE_MAX_POINTS) && n(obj.rgba) && n(obj.thickness);
    case 'item':
      return n(obj.x) && n(obj.y) && typeof obj.item === 'string'
          && n(obj.damage) && n(obj.scale) && n(obj.alpha);
    case 'group':
      if (!n(obj.x) || !n(obj.y)) return false;
      if (obj.alpha !== undefined && !n(obj.alpha)) return false;
      if (depth > 0) return false; // groups cannot nest in Plethora
      if (!Array.isArray(obj.children)) return false;
      return obj.children.every(c => validateGlassesObject(c, 1));
    default:
      return false;
  }
}

function isSceneWithinCharLimit(scene) { return JSON.stringify(scene).length <= SCENE_CAP_CHARS; }

module.exports = { isFinNum, isValidPointsArray, validateGlassesObject, isSceneWithinCharLimit };
