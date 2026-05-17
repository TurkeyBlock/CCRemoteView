'use strict';

// Escapes a JS string for safe embedding inside a Lua double-quoted string literal.
// Doubles backslashes and escapes embedded double quotes.
function escapeLuaStringArg(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

module.exports = { escapeLuaStringArg };
