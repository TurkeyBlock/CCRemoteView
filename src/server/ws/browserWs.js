'use strict';

const path = require('path');
const fs   = require('fs');
const { BYPASS_AUTH, DEV_TOKEN, LOG_BROWSER_CMDS, MAX_CMD_LENGTH, MAX_UNAUTHED_WS, MAX_AUTHED_GUEST_WS } = require('../config');
const { commandRouting, validateArgs, buildLuaCommand, isConcurrentCommand } = require('../commandRouting');

const CHUNK_BLOCKS = 20_000;

// Serialize world state using palette + flat array format, then stream it to
// the client in CHUNK_BLOCKS-sized pieces with setImmediate between each so
// the event loop stays free to handle other requests during delivery.
function sendChunkedState(ws, state) {
  const palette   = [];
  const nameToIdx = {};
  const allBlockData = [];

  for (const locString in state.world.blocks) {
    const block = state.world.blocks[locString];
    if (nameToIdx[block.name] === undefined) {
      nameToIdx[block.name] = palette.length;
      palette.push(block.name);
    }
    const c1 = locString.indexOf(',');
    const c2 = locString.indexOf(',', c1 + 1);
    allBlockData.push(
      +locString.slice(0, c1),
      +locString.slice(c1 + 1, c2),
      +locString.slice(c2 + 1),
      nameToIdx[block.name],
      block.metadata ?? 0,
    );
  }

  const total = Math.max(1, Math.ceil(allBlockData.length / (CHUNK_BLOCKS * 5)));
  const { lastTransactionId, computers } = state;
  let index = 0;

  function sendNext() {
    if (ws.readyState !== ws.OPEN) return;
    const start = index * CHUNK_BLOCKS * 5;
    const end   = Math.min(start + CHUNK_BLOCKS * 5, allBlockData.length);
    const msg   = index === 0
      ? { stateChunk: { index, total, lastTransactionId, palette, computers, blockData: allBlockData.slice(start, end) } }
      : { stateChunk: { index, total, lastTransactionId,                      blockData: allBlockData.slice(start, end) } };
    ws.send(JSON.stringify(msg));
    index++;
    if (index < total) setImmediate(sendNext);
  }

  sendNext();
}

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
    transactComputer,
    transactionCache, getTransactionCacheFloor,
  } = worldState;
  const { getSession, isAdmin, isOperator } = auth;

  // Per-type guest connection counters — scoped to this server instance.
  let unauthedWsCount    = 0;
  let authedGuestWsCount = 0;

  function sendOrQueue(id, luaCmd, concurrent, logLabel) {
    if (concurrent) {
      if (computerWs[id]?.readyState === 1) {
        if (LOG_BROWSER_CMDS) log.info(`${logLabel} (concurrent)`);
        computerWs[id].send(JSON.stringify({ type: 'command', command: luaCmd, concurrent: true }));
      } else {
        // Concurrent commands are not queued — they're fire-and-forget.
        // Still wake the computer so the user can retry once it reconnects.
        setWsRequest(id);
        log.info(`${logLabel} — WS offline, concurrent cmd dropped, wsRequest set`);
      }
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
    let isUnauthedGuest = false;
    let isAuthedGuest   = false;

    if (!BYPASS_AUTH) {
      const token = await getSession(req);
      if (token) {
        userSub      = token.sub;
        userName     = token.username ?? token.name ?? userSub;
        wsIsOperator = isOperator(userSub);
        wsIsAdmin    = isAdmin(userSub);
        if (!wsIsOperator && !wsIsAdmin) {
          // Authenticated but unprivileged — read-only guest.
          if (authedGuestWsCount >= MAX_AUTHED_GUEST_WS) {
            ws.close(4429, 'Too many guests');
            return;
          }
          isAuthedGuest = true;
          authedGuestWsCount++;
        }
      } else {
        // No token (or invalid token) — fully anonymous read-only guest.
        if (unauthedWsCount >= MAX_UNAUTHED_WS) {
          ws.close(4429, 'Too many guests');
          return;
        }
        isUnauthedGuest = true;
        unauthedWsCount++;
        wsIsOperator = false;
        wsIsAdmin    = false;
      }
    } else {
      userSub      = DEV_TOKEN.sub;
      userName     = DEV_TOKEN.username;
      wsIsOperator = true;
      wsIsAdmin    = true;
    }

    const clientIp = getClientIp(req);
    const guestTag = isUnauthedGuest ? ' [unauthed-guest]' : isAuthedGuest ? ' [authed-guest]' : '';
    console.log(`[ws] Browser client connected from ${clientIp}${guestTag} (total: ${browserClients.size + 1}, unauthed: ${unauthedWsCount}, authed-guest: ${authedGuestWsCount})`);
    browserClients.add(ws);

    const qs           = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const clientLastTx = parseInt(new URLSearchParams(qs).get('lastTx') ?? '', 10);
    const serverLastTx = state.lastTransactionId;
    const cacheFloor   = getTransactionCacheFloor();

    if (Number.isInteger(clientLastTx) && clientLastTx >= 0 && clientLastTx >= cacheFloor && clientLastTx <= serverLastTx) {
      const delta = {};
      for (let i = clientLastTx + 1; i <= serverLastTx; i++) {
        if (transactionCache[i]) delta[i] = transactionCache[i];
      }
      ws.send(JSON.stringify({ transactions: delta }));
    } else {
      sendChunkedState(ws, state);
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

        case 'setGlassesScene': {
          const id = safeId(msg.computerId);
          if (!id) return;
          const current = state.computers[id];
          if (!current) return;
          const scene = Array.isArray(msg.scene)
            ? msg.scene.filter(o => o && typeof o.type === 'string' && typeof o.id === 'string').slice(0, 512)
            : [];
          // 16 000 chars matches the maxLength on the glassesSetCanvas command arg in
          // command_routing.json. Storing a larger scene would make "Send to Glasses"
          // permanently broken for this computer without any obvious explanation.
          if (JSON.stringify(scene).length > 16000) {
            ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: 'Scene JSON exceeds 16,000 character limit' }));
            return;
          }
          transactComputer(id, { ...current, glassesScene: scene });
          log.info(`[ws] setGlassesScene id=${id} user=${userSub} count=${scene.length}`);
          break;
        }

        case 'glassesSceneOp': {
          const id = safeId(msg.computerId);
          if (!id) return;
          const current = state.computers[id];
          if (!current) return;
          const scene = Array.isArray(current.glassesScene) ? [...current.glassesScene] : [];
          switch (msg.op) {
            case 'add': {
              if (!msg.object || typeof msg.object.id !== 'string' || typeof msg.object.type !== 'string') return;
              if (scene.length >= 512) return;
              // Reject if the new object would push the scene past the glassesSetCanvas payload cap.
              if (JSON.stringify([...scene, msg.object]).length > 16000) return;
              scene.push(msg.object);
              break;
            }
            case 'update': {
              if (typeof msg.objectId !== 'string') return;
              const idx = scene.findIndex(o => o.id === msg.objectId);
              if (idx === -1) return;
              const merged = { ...scene[idx], ...msg.object, id: scene[idx].id, type: scene[idx].type };
              const candidate = [...scene]; candidate[idx] = merged;
              // Updates can also blow the cap — text content in particular has no inherent length limit.
              if (JSON.stringify(candidate).length > 16000) return;
              scene[idx] = merged;
              break;
            }
            case 'remove': {
              if (typeof msg.objectId !== 'string') return;
              const idx = scene.findIndex(o => o.id === msg.objectId);
              if (idx === -1) return;
              scene.splice(idx, 1);
              break;
            }
            case 'clear': {
              scene.length = 0;
              break;
            }
            case 'reorder': {
              const { fromIdx, toIdx } = msg;
              if (fromIdx == null || toIdx == null || fromIdx < 0 || toIdx < 0 || fromIdx >= scene.length || toIdx >= scene.length) return;
              const [item] = scene.splice(fromIdx, 1);
              scene.splice(toIdx, 0, item);
              break;
            }
            default: return;
          }
          transactComputer(id, { ...current, glassesScene: scene });
          break;
        }
      }
    });

    ws.on('close', (code, reason) => {
      if (isUnauthedGuest) unauthedWsCount--;
      if (isAuthedGuest)   authedGuestWsCount--;
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
