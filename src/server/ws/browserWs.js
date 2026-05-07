'use strict';

const path = require('path');
const fs   = require('fs');
const { IS_PROD, DEV_NO_AUTH, DEV_TOKEN, LOG_BROWSER_CMDS, MAX_CMD_LENGTH, TRANSACTION_CACHE_COUNT } = require('../config');
const { commandRouting, validateArgs, buildLuaCommand, isConcurrentCommand } = require('../commandRouting');

function getClientIp(req) {
  return req.headers['cf-connecting-ip']
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress;
}

function attachBrowserWs(wss, { worldState, auth, log, userManagement }) {
  const {
    state, cmds, stopSignal, computerWs, browserClients,
    safeId, sanitizeForLog,
    setWsRequest, clearCommandQueue,
    transactionCache,
  } = worldState;
  const { getSession, isAdmin, isOperator } = auth;

  function sendOrQueue(id, luaCmd, concurrent, logLabel) {
    if (concurrent) {
      if (computerWs[id]?.readyState === 1) {
        if (LOG_BROWSER_CMDS) log.info(`${logLabel} (concurrent)`);
        computerWs[id].send(JSON.stringify({ type: 'command', command: luaCmd, concurrent: true }));
      }
      // concurrent commands are not queued — they're fire-and-forget
    } else if (computerWs[id]?.readyState === 1) {
      if (LOG_BROWSER_CMDS) log.info(logLabel);
      computerWs[id].send(JSON.stringify({ type: 'command', command: luaCmd }));
    } else {
      if (!cmds[id]) cmds[id] = [];
      cmds[id].push(luaCmd);
      log.info(`${logLabel} — WS offline, queued depth=${cmds[id].length}`);
      setWsRequest(id);
    }
  }

  wss.on('connection', async (ws, req) => {
    let userSub, userName, wsIsOperator, wsIsAdmin;

    if (!DEV_NO_AUTH || IS_PROD) {
      const token = await getSession(req);
      if (!token) { ws.close(4401, 'Unauthorized'); return; }
      userSub     = token.sub;
      userName    = token.username ?? token.name ?? userSub;
      wsIsOperator = isOperator(userSub);
      wsIsAdmin    = isAdmin(userSub);
    } else {
      userSub     = DEV_TOKEN.sub;
      userName    = DEV_TOKEN.username;
      wsIsOperator = true;
      wsIsAdmin    = true;
    }

    const clientIp = getClientIp(req);
    console.log(`[ws] Browser client connected from ${clientIp} (total: ${browserClients.size + 1})`);
    browserClients.add(ws);

    const qs           = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const clientLastTx = parseInt(new URLSearchParams(qs).get('lastTx') ?? '', 10);
    const serverLastTx = state.lastTransactionId;
    const cacheFloor   = serverLastTx - TRANSACTION_CACHE_COUNT;

    if (Number.isInteger(clientLastTx) && clientLastTx >= 0 && clientLastTx >= cacheFloor && clientLastTx <= serverLastTx) {
      const delta = {};
      for (let i = clientLastTx + 1; i <= serverLastTx; i++) {
        if (transactionCache[i]) delta[i] = transactionCache[i];
      }
      ws.send(JSON.stringify({ transactions: delta }));
    } else {
      ws.send(JSON.stringify({ state }));
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!wsIsOperator) return;

      switch (msg.type) {
        case 'invokeCommand': {
          const id = safeId(msg.id);
          if (!id) return;
          const commandName = msg.command;
          if (!commandName || typeof commandName !== 'string' || commandName.length > 100) return;
          const computerType = state.computers[id]?.type;
          const commandDef   = commandRouting[computerType]?.commands?.[commandName];
          if (!commandDef) {
            ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: `Unknown command: ${sanitizeForLog(commandName)}` }));
            log.warn(`[ws] invokeCommand rejected — unknown command=${sanitizeForLog(commandName)} id=${id} user=${userSub}`);
            return;
          }
          const args = Array.isArray(msg.args) ? msg.args : [];
          const validationError = validateArgs(commandDef.args, args);
          if (validationError) {
            ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: `Invalid args: ${validationError}` }));
            log.warn(`[ws] invokeCommand rejected — ${validationError} command=${commandName} id=${id} user=${userSub}`);
            return;
          }
          const luaCmd = buildLuaCommand(computerType, commandName, commandDef.args, args);
          userManagement.incrementActionCount(userSub);
          sendOrQueue(id, luaCmd, commandDef.concurrent,
            `[ws] invokeCommand id=${id} user=${userSub} command=${commandName}`);
          break;
        }

        case 'runProgram': {
          const id = safeId(msg.id);
          if (!id) return;
          const programName = msg.program;
          if (!programName || typeof programName !== 'string' || !/^[a-zA-Z0-9_]+$/.test(programName)) {
            ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: 'Invalid program name' }));
            return;
          }
          const programPath = path.resolve('turtlePrograms', programName + '.lua');
          if (!programPath.startsWith(path.resolve('turtlePrograms') + path.sep)) {
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
          break;
        }

        case 'setCommand': {
          const id = safeId(msg.id);
          if (!id || !msg.cmd || typeof msg.cmd !== 'string' || msg.cmd.length > MAX_CMD_LENGTH) return;
          if (!wsIsAdmin) {
            ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: 'Admin required for raw Lua commands' }));
            log.warn(`[ws] setCommand rejected — admin required id=${id} user=${userSub} <${sanitizeForLog(msg.cmd)}>`);
            return;
          }
          userManagement.incrementActionCount(userSub);
          const concurrent = msg.concurrent !== undefined
            ? Boolean(msg.concurrent)
            : isConcurrentCommand(state.computers[id]?.type, msg.cmd);
          sendOrQueue(id, msg.cmd, concurrent,
            `[ws] setCommand id=${id} user=${userSub} <${sanitizeForLog(msg.cmd)}>`);
          break;
        }

        case 'setStopSignal': {
          const id = safeId(msg.id);
          if (!id) return;
          clearCommandQueue(id);
          if (LOG_BROWSER_CMDS) log.info(`[ws] setStopSignal id=${id} user=${userSub}`);
          userManagement.incrementActionCount(userSub);
          if (computerWs[id]?.readyState === 1) {
            computerWs[id].send(JSON.stringify({ type: 'stopSignal' }));
          } else {
            stopSignal[id] = true;
          }
          break;
        }

        case 'clearCommandQueue': {
          const id = safeId(msg.id);
          if (!id) return;
          userManagement.incrementActionCount(userSub);
          clearCommandQueue(id);
          if (LOG_BROWSER_CMDS) log.info(`[ws] clearCommandQueue id=${id} user=${userSub}`);
          break;
        }
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[ws] Browser client disconnected — code: ${code}, reason: ${reason?.toString() || '(none)'}`);
      browserClients.delete(ws);
    });
    ws.on('error', (err) => {
      console.log(`[ws] Browser client error: ${err.message}`);
      browserClients.delete(ws);
      ws.terminate();
    });
  });
}

module.exports = { attachBrowserWs };
