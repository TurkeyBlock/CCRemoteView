'use strict';

const { MAX_SCENE_OBJECTS, MAX_SCENE_TEXT_LENGTH,
        POLYGON_MIN_POINTS, POLYGON_MAX_POINTS, LINE_MIN_POINTS, LINE_MAX_POINTS } = require('../../../config');

const SCENE_CAP_CHARS = 16000;

const GLASSES_TYPES = new Set(['rect','text','line','dot','polygon','lines','item','group']);

// Per-type allowlist for partial-update ops ('update', 'groupChildUpdate').
const ALLOWED_UPDATE_FIELDS = {
  rect:    ['x','y','w','h','rgba'],
  text:    ['x','y','content','rgba','size','shadow'],
  line:    ['x1','y1','x2','y2','rgba','thickness'],
  dot:     ['x','y','rgba','size'],
  polygon: ['points','rgba'],
  lines:   ['points','rgba','thickness'],
  item:    ['x','y','item','damage','scale','alpha'],
  group:   ['x','y','alpha'],
};

module.exports = {
  SCENE_CAP_CHARS,
  MAX_SCENE_OBJECTS,
  MAX_SCENE_TEXT_LENGTH,
  POLYGON_MIN_POINTS,
  POLYGON_MAX_POINTS,
  LINE_MIN_POINTS,
  LINE_MAX_POINTS,
  GLASSES_TYPES,
  ALLOWED_UPDATE_FIELDS,
};
