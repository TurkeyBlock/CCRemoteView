'use strict';

const path = require('path');
const fs   = require('fs');
const { requireOperator } = require('./authGuard');

module.exports = requireOperator(function runProgram(msg, ctx) {
  const { ws, safeId, sendOrQueue, userSub, userManagement } = ctx;
  const id = safeId(msg.id);
  if (!id) return;
  const programName = msg.program;
  if (!programName || typeof programName !== 'string' || !/^[a-zA-Z0-9_]+$/.test(programName)) {
    ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: 'Invalid program name' }));
    return;
  }
  const programPath = path.resolve('lua', 'turtle', 'programs', programName + '.lua');
  if (!programPath.startsWith(path.resolve('lua', 'turtle', 'programs') + path.sep)) {
    ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: 'Invalid program path' }));
    return;
  }
  fs.readFile(programPath, 'utf8', (err, code) => {
    if (err) {
      ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: `Program not found: ${programName}` }));
      return;
    }
    userManagement.incrementActionCount(userSub);
    sendOrQueue(id, code, false,
      `[ws] runProgram id=${id} user=${userSub} program=${programName}`);
  });
});
