'use strict';

// Escapes a JS string for safe embedding inside a Lua double-quoted string literal.
function escapeLuaStringArg(s) {
  return String(s)
    .replace(/\\/g,   '\\\\')
    .replace(/"/g,    '\\"')
    .replace(/\0/g,   '\\0')
    .replace(/\r/g,   '\\r')
    .replace(/\n/g,   '\\n')
    .replace(/\x1a/g, '\\26');
}

module.exports = { escapeLuaStringArg };
