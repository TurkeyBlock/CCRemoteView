'use strict';

const commandRouting = require('../../lua/command_routing.json');

function extractFunctionName(cmd) {
  const m = cmd.match(/(?:return\s+)?(?:\w+\.)?(\w+)\s*\(/);
  return m ? m[1] : null;
}

function isConcurrentCommand(computerType, cmd) {
  if (!computerType) return false;
  const fn = extractFunctionName(cmd);
  if (!fn) return false;
  return commandRouting[computerType]?.commands?.[fn]?.concurrent === true;
}

// Validates invokeCommand args against the schema in command_routing.json.
// Returns null on success, or an error string.
function validateArgs(argSchemas, argValues) {
  if (!Array.isArray(argValues)) return 'args must be an array';
  if (argValues.length > argSchemas.length) return `too many args: expected ${argSchemas.length}, got ${argValues.length}`;
  for (let i = 0; i < argSchemas.length; i++) {
    const schema = argSchemas[i];
    const val = argValues[i];
    if (val == null) {
      if (schema.required) return `arg ${i} is required`;
      continue;
    }
    if (schema.type === 'number') {
      if (typeof val !== 'number' || !isFinite(val)) return `arg ${i} must be a finite number`;
      if (schema.integer && !Number.isInteger(val)) return `arg ${i} must be an integer`;
      if (schema.min != null && val < schema.min) return `arg ${i} must be >= ${schema.min}`;
      if (schema.max != null && val > schema.max) return `arg ${i} must be <= ${schema.max}`;
    } else if (schema.type === 'string') {
      if (typeof val !== 'string') return `arg ${i} must be a string`;
      if (schema.maxLength && val.length > schema.maxLength) return `arg ${i} exceeds max length`;
      if (schema.enum && !schema.enum.includes(val)) return `arg ${i} must be one of: ${schema.enum.join(', ')}`;
    } else if (schema.type === 'boolean') {
      if (typeof val !== 'boolean') return `arg ${i} must be a boolean`;
    }
  }
  return null;
}

// Constructs the Lua command string from validated args.
// Handles both standard module.function(args) and compound multi-statement commands.
function buildLuaCommand(computerType, commandName, argSchemas, argValues) {
  if (commandName === 'dropToChest') {
    const [slot, side, count] = argValues;
    const dropFn = side === 'top' ? 'dropUp' : side === 'bottom' ? 'dropDown' : 'drop';
    return `tapi.select(${slot}); turtle.${dropFn}(${count}); tapi.send_status_update()`;
  }
  if (commandName === 'transferSlot') {
    const [fromSlot, toSlot, count] = argValues;
    return `local s=turtle.getSelectedSlot(); tapi.select(${fromSlot}); turtle.transferTo(${toSlot},${count}); tapi.select(s); tapi.send_status_update()`;
  }
  if (commandName === 'glassesSetCanvas') {
    const escaped = String(argValues[0]).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `return papi.glassesSetCanvas("${escaped}")`;
  }
  const module = commandRouting[computerType].module;
  const luaArgs = argSchemas
    .map((schema, i) => {
      const val = argValues[i];
      if (val == null) return null;
      if (schema.type === 'string') return `"${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      if (schema.type === 'number') return String(Number(val));
      if (schema.type === 'boolean') return val ? 'true' : 'false';
      return null;
    })
    .filter(v => v !== null);
  return `return ${module}.${commandName}(${luaArgs.join(', ')})`;
}

module.exports = { commandRouting, validateArgs, buildLuaCommand, isConcurrentCommand };
