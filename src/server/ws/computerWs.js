'use strict';

const { BYPASS_AUTH, SUPPRESS_UPDATE_LOGS } = require('../config');

function getClientIp(req) {
  return req.headers['cf-connecting-ip']
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress;
}

function attachComputerWs(wss, { worldState, computerIpManager, computerIdManager, log }) {
  const {
    state, cmds, stopSignal, commandResultCache, computerWs,
    glassesNeedsSync,
    safeId,
    transactComputer, transactComputerDelta, applyExtractedState, commitScan,
    broadcastToClients,
    isScanRateLimited,
    CMD_RESULT_CACHE_MAX,
  } = worldState;

  wss.on('connection', (ws, req) => {
    const ip = getClientIp(req);

    if (!BYPASS_AUTH) {
      if (!computerIpManager.isApproved(ip)) {
        if (!computerIpManager.isPending(ip)) computerIpManager.addPending(ip);
        ws.close(4403, 'Forbidden');
        return;
      }
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const id = safeId(urlObj.searchParams.get('id'));
    if (!id) { ws.close(4400, 'Bad Request'); return; }

    if (!BYPASS_AUTH && !computerIdManager.allowByIp && !computerIdManager.isApproved(Number(id))) {
      if (!computerIdManager.isPending(Number(id))) computerIdManager.addPending(Number(id), ip);
      ws.close(4403, 'Forbidden');
      return;
    }

    console.log(`[ws/computer] Computer ${id} connected from ${ip} — queueDepth=${cmds[id]?.length ?? 0}`);
    if (computerWs[id] && computerWs[id] !== ws) computerWs[id].terminate();
    delete worldState.wsRequests[id];
    computerWs[id] = ws;

    if (state.computers[id]) {
      state.computers[id].ws_connected  = true;
      state.computers[id].ws_request_at = null;
      transactComputer(id, { ...state.computers[id] });
    }

    glassesNeedsSync.add(id);

    if (cmds[id]?.length > 0) {
      log.info(`[ws/computer] id=${id} — flushing ${cmds[id].length} offline-queued cmd(s)`);
      for (const cmd of cmds[id]) ws.send(JSON.stringify({ type: 'command', command: cmd }));
      cmds[id] = [];
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch {
        log.info(`[ws/computer] id=${id} unparseable message: ${String(raw).slice(0, 200)}`);
        return;
      }
      if (!SUPPRESS_UPDATE_LOGS || (msg.type !== 'statusUpdate' && msg.type !== 'commandResult')) {
        log.info(`[ws/computer] id=${id} received msg type=${msg.type ?? '(none)'}`);
      }

      try {

      if (msg.type === 'commandResult') {
        const cid = safeId(msg.computerId) ?? id;
        if (!SUPPRESS_UPDATE_LOGS) if (!SUPPRESS_UPDATE_LOGS) log.info(`[ws/computer] id=${id} commandResult cid=${cid}`);
        const result = msg.result;
        if (result !== undefined) {
          if (!SUPPRESS_UPDATE_LOGS) console.log(`[ws/computer] Computer ${cid} result:`, result);
          if (!commandResultCache[cid]) commandResultCache[cid] = [];
          commandResultCache[cid].push(result);
          if (commandResultCache[cid].length > CMD_RESULT_CACHE_MAX) commandResultCache[cid].shift();
          broadcastToClients({ commandResult: { computerId: Number(cid), result } });
        }

      } else if (msg.type === 'scan') {
        const data   = msg.data || {};
        const blocks = data.blocks;
        if (!Array.isArray(blocks) || blocks.length > 50_000) return;
        if (isScanRateLimited(id)) return;
        const origin = data.origin ?? state.computers[id]?.loc;
        if (!origin) return;
        const changed = commitScan(id, blocks, origin);
        if (changed > 0) log.info(`[ws/computer] scan id=${id} mapped ${changed} block changes`);

      } else if (msg.type === 'statusUpdate') {
        const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
        const data = Object.fromEntries(
          Object.entries(msg.data || {}).filter(([k]) => !BLOCKED_KEYS.has(k))
        );
        data.id = Number(id);
        transactComputerDelta(id, data);

      } else if (msg.type === 'state') {
        const data = msg.data || {};
        data.id = Number(id);
        const existing = state.computers[id] || {};
        const merged = { ...existing, ...data };
        applyExtractedState(merged);

      } else if (msg.type === 'sense') {
        const data     = msg.data || {};
        const entities = data.entities;
        if (!Array.isArray(entities) || entities.length > 1_000) return;
        if (!state.computers[id]) return;
        state.computers[id].entities = entities;
        transactComputer(id, state.computers[id]);
        log.info(`[ws/computer] sense id=${id} reported ${entities.length} entities`);
      }

      } catch (err) {
        log.error({ err }, `[ws/computer] Unhandled error in message handler id=${id}`);
      }
    });

    function onDisconnect(label, code) {
      console.log(`[ws/computer] Computer ${id} ${label} — code: ${code}`);
      if (computerWs[id] !== ws) return;
      delete computerWs[id];
      glassesNeedsSync.delete(id);
      if (cmds[id]?.length > 0) worldState.wsRequests[id] = true;
      if (state.computers[id]) {
        state.computers[id].ws_connected  = false;
        state.computers[id].ws_request_at = null;
        transactComputer(id, { ...state.computers[id] });
      }
    }

    ws.on('close', (code) => onDisconnect('disconnected', code));
    ws.on('error', (err) => {
      onDisconnect('error', err.message);
      ws.terminate();
    });
  });
}

module.exports = { attachComputerWs };
