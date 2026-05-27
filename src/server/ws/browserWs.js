'use strict';

const { BYPASS_AUTH, DEV_TOKEN, LOG_BROWSER_CMDS, MAX_UNAUTHED_WS, MAX_AUTHED_GUEST_WS, MAX_BROWSER_WS_PAYLOAD_BYTES, MAX_CMD_QUEUE_DEPTH, CMD_QUEUE_TTL_MS } = require('../config');
const { getClientIp } = require('../utils/clientIp');
const browserMessageHandlers = require('./browser/handlers/index');

const CHUNK_BLOCKS = 20_000;

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

/**
 * @param {object} wss - WebSocketServer instance for browser connections
 * @param {object} deps
 * @param {{ state: object, cmds: object, stopSignal: object, computerWs: object, glassesNeedsSync: Set, browserClients: Set, safeId: Function, sanitizeForLog: Function, setWsRequest: Function, clearCommandQueue: Function, transactComputer: Function, transactionCache: object, getTransactionCacheFloor: Function }} deps.worldState
 * @param {{ getSession: Function, isAdmin: Function, isOperator: Function }} deps.auth
 * @param {object} deps.log
 * @param {object} deps.userManagement
 */
function attachBrowserWs(wss, { worldState, auth, log, userManagement }) {
  const {
    state, cmds, stopSignal, computerWs, glassesNeedsSync, browserClients,
    safeId, sanitizeForLog,
    setWsRequest, clearCommandQueue,
    transactComputer,
    transactionCache, getTransactionCacheFloor,
  } = worldState;
  const { getSession, isAdmin, isOperator } = auth;

  // Per-process connection counters. If this server is ever run in cluster mode or
  // behind a multi-instance load balancer, replace these with a shared Redis counter
  // to prevent cap bypass by rotating between instances.
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
      if (cmds[id].length >= MAX_CMD_QUEUE_DEPTH) {
        throw Object.assign(new Error('Command queue full'), { status: 429 });
      }
      cmds[id].push({ cmd: luaCmd, enqueuedAt: Date.now() });
      log.info(`${logLabel} — WS offline, queued depth=${cmds[id].length}`);
      setWsRequest(id);
    }
  }

  wss.on('connection', async (ws, req) => {
    let userSub, userName, wsIsOperator, wsIsAdmin;
    let isUnauthedGuest = false;
    let isAuthedGuest   = false;

    // Returns true if this op is over the rate-limit budget (10 ops/sec) and should be dropped.
    const canvasRateLimit = (() => {
      let count = 0, windowStart = Date.now();
      return () => {
        const now = Date.now();
        if (now - windowStart > 1000) { count = 0; windowStart = now; }
        return ++count > 10;
      };
    })();

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
    log.info(`[ws] Browser client connected from ${clientIp}${guestTag} (total: ${browserClients.size + 1}, unauthed: ${unauthedWsCount}, authed-guest: ${authedGuestWsCount})`);
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
      try { msg = JSON.parse(raw); } catch {
        log.warn({ ip: clientIp, user: userSub ?? 'unauthed' }, '[ws] Malformed JSON from client');
        return;
      }
      if (!wsIsOperator) return;

      const handler = browserMessageHandlers[msg.type];
      if (!handler) return;
      try {
        handler(msg, {
          ws, state, computerWs, cmds, stopSignal, glassesNeedsSync,
          safeId, sanitizeForLog, setWsRequest, clearCommandQueue, sendOrQueue,
          canvasSubscriptions, canvasRateLimit,
          userSub, wsIsAdmin, log, userManagement,
        });
      } catch (err) {
        log.error({ err }, '[ws] Unhandled error in message handler');
      }
    });

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (isUnauthedGuest) unauthedWsCount--;
      if (isAuthedGuest)   authedGuestWsCount--;
      for (const id of Object.keys(canvasSubscriptions)) {
        if (!canvasSubscriptions[id].has(ws)) continue;
        canvasSubscriptions[id].delete(ws);
        if (canvasSubscriptions[id].size === 0) delete canvasSubscriptions[id];
      }
      browserClients.delete(ws);
    }

    ws.on('close', (code, reason) => {
      cleanup();
      log.info(`[ws] Browser client disconnected — code: ${code}, reason: ${reason?.toString() || '(none)'}`);
    });
    ws.on('error', (err) => {
      if (err.message === 'Max payload size exceeded') {
        log.warn(`[ws] Browser client from ${clientIp} rejected — message exceeded ${MAX_BROWSER_WS_PAYLOAD_BYTES / 1024} KB limit (user=${userSub ?? 'unauthed'})`);
      } else {
        log.warn(`[ws] Browser client error: ${err.message}`);
      }
      cleanup();
      ws.terminate();
    });
  });
}

module.exports = { attachBrowserWs };
