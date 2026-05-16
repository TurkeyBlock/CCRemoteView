'use strict';

const path = require('path');
const fs   = require('fs');
const { BYPASS_AUTH, DEV_TOKEN, LOG_BROWSER_CMDS, MAX_CMD_LENGTH, MAX_UNAUTHED_WS, MAX_AUTHED_GUEST_WS } = require('../config');
const { commandRouting, validateArgs, buildLuaCommand, isConcurrentCommand } = require('../commandRouting');

const CHUNK_BLOCKS = 20_000;

// Per-type allowlist for partial-update ops ('update', 'groupChildUpdate').
// Only listed keys are merged into stored objects; arbitrary client keys are dropped.
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

const GLASSES_TYPES = new Set(['rect','text','line','dot','polygon','lines','item','group']);

function _isFinNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function _isPointsArray(arr, min, max) {
  if (!Array.isArray(arr) || arr.length < min || arr.length > max) return false;
  return arr.every(p => Array.isArray(p) && p.length >= 2 && _isFinNum(p[0]) && _isFinNum(p[1]));
}

// Returns true only if obj is a structurally valid GlassesObject.
// depth=0 for top-level objects; depth=1 inside a group's children (groups cannot nest).
function validateGlassesObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.id !== 'string' || obj.id.length === 0 || obj.id.length > 64) return false;
  if (!GLASSES_TYPES.has(obj.type)) return false;
  const n = _isFinNum;
  switch (obj.type) {
    case 'rect':
      return n(obj.x) && n(obj.y) && n(obj.w) && n(obj.h) && n(obj.rgba);
    case 'text':
      return n(obj.x) && n(obj.y) && typeof obj.content === 'string' && obj.content.length <= 512
          && n(obj.rgba) && n(obj.size) && typeof obj.shadow === 'boolean';
    case 'line':
      return n(obj.x1) && n(obj.y1) && n(obj.x2) && n(obj.y2) && n(obj.rgba) && n(obj.thickness);
    case 'dot':
      return n(obj.x) && n(obj.y) && n(obj.rgba) && n(obj.size);
    case 'polygon':
      return _isPointsArray(obj.points, 3, 32) && n(obj.rgba);
    case 'lines':
      return _isPointsArray(obj.points, 2, 64) && n(obj.rgba) && n(obj.thickness);
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

// Strip glassesScene from a computers map. Canvas state is subscription-only;
// it is never sent in bulk state loads or transactions.
function stripCanvas(computers) {
  const out = {};
  for (const id of Object.keys(computers)) {
    const c = computers[id];
    if (!c?.glassesScene) { out[id] = c; continue; }
    const { glassesScene: _, ...rest } = c;
    out[id] = rest;
  }
  return out;
}

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
  const { lastTransactionId } = state;
  const computers = stripCanvas(state.computers);
  let index = 0;

  function sendNext() {
    if (ws.readyState !== ws.OPEN) return;
    const start = index * CHUNK_BLOCKS * 5;
    const end   = Math.min(start + CHUNK_BLOCKS * 5, allBlockData.length);
    const msg   = index === 0
      ? { stateChunk: { index, total, lastTransactionId, palette, computers, chatLog: state.chatLog, blockData: allBlockData.slice(start, end) } }
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
    state, cmds, stopSignal, computerWs, glassesNeedsSync, browserClients,
    safeId, sanitizeForLog,
    setWsRequest, clearCommandQueue,
    transactComputer,
    transactionCache, getTransactionCacheFloor,
  } = worldState;
  const { getSession, isAdmin, isOperator } = auth;

  // Per-type guest connection counters — scoped to this server instance.
  let unauthedWsCount    = 0;
  let authedGuestWsCount = 0;

  // computerId → Set of browser ws connections subscribed to that computer's canvas updates.
  // Canvas state (glassesScene) is never sent in bulk transactions; subscribers receive it
  // via targeted canvasUpdate messages so uninterested clients aren't spammed.
  const canvasSubscriptions = {};

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
    let canvasOpCount = 0;
    let canvasOpWindowStart = Date.now();

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
        const t = transactionCache[i];
        if (!t) continue;
        // Strip glassesScene from cached transactions — canvas is subscription-only.
        const hasCanvas = Object.values(t.computers || {}).some(c => c?.glassesScene);
        delta[i] = hasCanvas ? { ...t, computers: stripCanvas(t.computers) } : t;
      }
      ws.send(JSON.stringify({ transactions: delta }));
    } else {
      sendChunkedState(ws, state);
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!wsIsOperator) return;

      try {
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
          { const _now = Date.now(); if (_now - canvasOpWindowStart > 1000) { canvasOpCount = 0; canvasOpWindowStart = _now; } if (++canvasOpCount > 10) return; }
          const id = safeId(msg.computerId);
          if (!id) return;
          const current = state.computers[id];
          if (!current) return;
          if (!computerWs[id] || computerWs[id].readyState !== 1) { setWsRequest(id); return; }
          glassesNeedsSync.delete(id);
          const scene = Array.isArray(msg.scene)
            ? msg.scene.filter(o => validateGlassesObject(o)).slice(0, 512)
            : [];
          const sceneJson = JSON.stringify(scene);
          // 16 000 chars matches the maxLength on the glassesSetCanvas command arg in
          // command_routing.json. Storing a larger scene would make "Send to Glasses"
          // permanently broken for this computer without any obvious explanation.
          if (sceneJson.length > 16000) {
            ws.send(JSON.stringify({ type: 'error', computerId: Number(id), message: 'Scene JSON exceeds 16,000 character limit' }));
            return;
          }
          state.computers[id] = { ...current, glassesScene: scene };
          log.info(`[ws] setGlassesScene id=${id} user=${userSub} count=${scene.length}`);
          // Push full scene to the Lua computer (baseline sync for wholesale replacements).
          const escaped = sceneJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          sendOrQueue(id, `return papi.glassesSetCanvas("${escaped}")`, true, `[ws] glassesSetCanvas id=${id}`);
          // Notify subscribed browsers.
          const canvasMsg = JSON.stringify({ canvasUpdate: { computerId: Number(id), scene } });
          for (const sub of canvasSubscriptions[id] ?? []) {
            if (sub.readyState === 1) sub.send(canvasMsg);
          }
          break;
        }

        case 'glassesSceneOp': {
          { const _now = Date.now(); if (_now - canvasOpWindowStart > 1000) { canvasOpCount = 0; canvasOpWindowStart = _now; } if (++canvasOpCount > 10) return; }
          const id = safeId(msg.computerId);
          if (!id) return;
          const current = state.computers[id];
          if (!current) return;
          if (!computerWs[id] || computerWs[id].readyState !== 1) { setWsRequest(id); return; }
          if (glassesNeedsSync.has(id)) {
            glassesNeedsSync.delete(id);
            const existing = Array.isArray(current.glassesScene) ? current.glassesScene : [];
            if (existing.length > 0) {
              const sj = JSON.stringify(existing);
              if (sj.length <= 16000) {
                const esc = sj.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                computerWs[id].send(JSON.stringify({ type: 'command', command: `return papi.glassesSetCanvas("${esc}")`, concurrent: true }));
                log.info(`[ws] glassesNeedsSync id=${id} — sent full scene before first op (${sj.length} chars)`);
              }
            }
          }
          const scene = Array.isArray(current.glassesScene) ? [...current.glassesScene] : [];

          // liveBatch accumulates the wire-format batch to send to the Lua computer when
          // live mode is active. Built per-op; null means this op should not be dispatched.
          let liveBatch = null;

          switch (msg.op) {
            case 'add': {
              if (!validateGlassesObject(msg.object)) return;
              if (scene.length >= 512) return;
              // Reject if the new object would push the scene past the glassesSetCanvas payload cap.
              if (JSON.stringify([...scene, msg.object]).length > 16000) return;
              scene.push(msg.object);
              liveBatch = { add: { [msg.object.type]: [msg.object] } };
              break;
            }
            case 'update': {
              if (typeof msg.objectId !== 'string') return;
              const idx = scene.findIndex(o => o.id === msg.objectId);
              if (idx === -1) return;
              const existingType = scene[idx].type;
              const allowed = ALLOWED_UPDATE_FIELDS[existingType];
              if (!allowed) return;
              if (!msg.object || typeof msg.object !== 'object' || Array.isArray(msg.object)) return;
              const patch = {};
              for (const key of allowed) {
                if (Object.prototype.hasOwnProperty.call(msg.object, key)) patch[key] = msg.object[key];
              }
              const merged = { ...scene[idx], ...patch, id: scene[idx].id, type: scene[idx].type };
              if (!validateGlassesObject(merged)) return;
              const candidate = [...scene]; candidate[idx] = merged;
              // Updates can also blow the cap — text content in particular has no inherent length limit.
              if (JSON.stringify(candidate).length > 16000) return;
              scene[idx] = merged;
              if (Object.keys(patch).length > 0) {
                liveBatch = { upd: { [msg.objectId]: patch } };
              }
              break;
            }
            case 'remove': {
              if (typeof msg.objectId !== 'string') return;
              const idx = scene.findIndex(o => o.id === msg.objectId);
              if (idx === -1) return;
              scene.splice(idx, 1);
              liveBatch = { rm: [msg.objectId] };
              break;
            }
            case 'clear': {
              scene.length = 0;
              liveBatch = { clear: true };
              break;
            }
            case 'reorder': {
              const { fromIdx, toIdx } = msg;
              if (fromIdx == null || toIdx == null || fromIdx < 0 || toIdx < 0 || fromIdx >= scene.length || toIdx >= scene.length) return;
              const minIdx = Math.min(fromIdx, toIdx);
              const [item] = scene.splice(fromIdx, 1);
              scene.splice(toIdx, 0, item);
              // reorder batch: just the new suffix ID order. The Lua reorder handler
              // removes handles itself (without clearing glassesProps) before re-adding.
              liveBatch = { reorder: scene.slice(minIdx).map(o => o.id) };
              break;
            }
            case 'groupChildUpdate': {
              if (typeof msg.groupId !== 'string' || typeof msg.childId !== 'string') return;
              if (!msg.delta || typeof msg.delta !== 'object' || Array.isArray(msg.delta)) return;
              const gIdx = scene.findIndex(o => o.id === msg.groupId);
              if (gIdx === -1 || scene[gIdx].type !== 'group') return;
              const group = scene[gIdx];
              const cIdx = (group.children || []).findIndex(c => c.id === msg.childId);
              if (cIdx === -1) return;
              const childType = group.children[cIdx].type;
              const allowedChild = ALLOWED_UPDATE_FIELDS[childType];
              if (!allowedChild) return;
              const childPatch = {};
              for (const key of allowedChild) {
                if (Object.prototype.hasOwnProperty.call(msg.delta, key)) childPatch[key] = msg.delta[key];
              }
              const newChildren = [...group.children];
              const mergedChild = { ...newChildren[cIdx], ...childPatch, id: newChildren[cIdx].id, type: newChildren[cIdx].type };
              if (!validateGlassesObject(mergedChild, 1)) return;
              newChildren[cIdx] = mergedChild;
              const updatedGroup = { ...group, children: newChildren };
              const candidate = [...scene]; candidate[gIdx] = updatedGroup;
              if (JSON.stringify(candidate).length > 16000) return;
              scene[gIdx] = updatedGroup;
              liveBatch = { child_upd: { [msg.groupId]: { [msg.childId]: childPatch } } };
              break;
            }
            case 'group': {
              if (!Array.isArray(msg.objectIds) || msg.objectIds.length < 2) return;
              if (!validateGlassesObject(msg.groupObject)) return;
              if (!msg.objectIds.every(oid => typeof oid === 'string' && scene.some(o => o.id === oid))) return;
              const idSet = new Set(msg.objectIds);
              const next = [...scene.filter(o => !idSet.has(o.id)), msg.groupObject];
              if (JSON.stringify(next).length > 16000) return;
              scene.splice(0, scene.length, ...next);
              liveBatch = { rm: msg.objectIds, add: { group: [msg.groupObject] } };
              break;
            }
            case 'ungroup': {
              if (typeof msg.objectId !== 'string') return;
              const idx = scene.findIndex(o => o.id === msg.objectId);
              if (idx === -1 || scene[idx].type !== 'group') return;
              const g = scene[idx];
              const flat = (g.children || []).map(child => {
                if (child.type === 'line') return { ...child, x1: child.x1 + g.x, y1: child.y1 + g.y, x2: child.x2 + g.x, y2: child.y2 + g.y };
                if ((child.type === 'polygon' || child.type === 'lines') && Array.isArray(child.points))
                  return { ...child, points: child.points.map(([x, y]) => [x + g.x, y + g.y]) };
                return { ...child, x: (child.x ?? 0) + g.x, y: (child.y ?? 0) + g.y };
              });
              scene.splice(idx, 1, ...flat);
              const addMap = {};
              for (const child of flat) {
                if (!addMap[child.type]) addMap[child.type] = [];
                addMap[child.type].push(child);
              }
              liveBatch = { rm: [msg.objectId], add: addMap };
              break;
            }
            default: return;
          }
          state.computers[id] = { ...current, glassesScene: scene };

          // Always dispatch the incremental op to the Lua computer.
          if (liveBatch) {
            const opsJson = JSON.stringify(liveBatch);
            if (opsJson.length <= 8000) {
              const escaped = opsJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              sendOrQueue(id, `return papi.glassesApplyOps("${escaped}")`, true, `[ws] glassesApplyOps id=${id}`);
            } else {
              log.warn(`[ws] glassesApplyOps batch too large (${opsJson.length} chars), skipping dispatch for id=${id}`);
            }
          }
          // Notify subscribed browsers with the full updated scene.
          const canvasMsg = JSON.stringify({ canvasUpdate: { computerId: Number(id), scene } });
          for (const sub of canvasSubscriptions[id] ?? []) {
            if (sub.readyState === 1) sub.send(canvasMsg);
          }
          break;
        }

        case 'subscribeCanvas': {
          const id = safeId(msg.computerId);
          if (!id) return;
          if (msg.subscribe) {
            if (!canvasSubscriptions[id]) canvasSubscriptions[id] = new Set();
            canvasSubscriptions[id].add(ws);
            // Send the current scene immediately so the subscriber is in sync.
            const scene = state.computers[id]?.glassesScene ?? [];
            ws.send(JSON.stringify({ canvasUpdate: { computerId: Number(id), scene } }));
            log.info(`[ws] subscribeCanvas id=${id} user=${userSub} (${canvasSubscriptions[id].size} subscribers)`);
          } else {
            canvasSubscriptions[id]?.delete(ws);
            if (canvasSubscriptions[id]?.size === 0) delete canvasSubscriptions[id];
            log.info(`[ws] unsubscribeCanvas id=${id} user=${userSub}`);
          }
          break;
        }
      }
      } catch (err) {
        log.error({ err }, '[ws] Unhandled error in message handler');
      }
    });

    ws.on('close', (code, reason) => {
      if (isUnauthedGuest) unauthedWsCount--;
      if (isAuthedGuest)   authedGuestWsCount--;
      // Remove this connection from any canvas subscriptions it held.
      for (const id of Object.keys(canvasSubscriptions)) {
        if (!canvasSubscriptions[id].has(ws)) continue;
        canvasSubscriptions[id].delete(ws);
        if (canvasSubscriptions[id].size === 0) delete canvasSubscriptions[id];
      }
      console.log(`[ws] Browser client disconnected — code: ${code}, reason: ${reason?.toString() || '(none)'}`);
      browserClients.delete(ws);
    });
    ws.on('error', (err) => {
      if (err.message === 'Max payload size exceeded') {
        log.warn(`[ws] Browser client from ${clientIp} rejected — message exceeded 32 KB limit (user=${userSub ?? 'unauthed'})`);
      } else {
        console.log(`[ws] Browser client error: ${err.message}`);
      }
      browserClients.delete(ws);
      ws.terminate();
    });
  });
}

module.exports = { attachBrowserWs };
