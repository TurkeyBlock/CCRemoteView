'use strict';

const express = require('express');

function createComputerRoutes({ worldState, auth, log }) {
  const router = express.Router();
  const {
    state, cmds, stopSignal, commandResultCache,
    safeId, sanitizeForLog,
    transactComputer, applyExtractedState, commitScan, setWsRequest,
    isScanRateLimited,
    CMD_RESULT_CACHE_MAX,
  } = worldState;
  const { requireApprovedComputer } = auth;

  router.post('/api/state', requireApprovedComputer, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    req.body.id = Number(id);
    const existing = state.computers[id] || {};
    const merged = { ...existing, ...req.body };
    applyExtractedState(merged);
    res.sendStatus(200);
  });

  router.post('/api/scan', requireApprovedComputer, (req, res) => {
    const { blocks } = req.body;
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks must be an array' });
    if (blocks.length > 50_000) return res.status(400).json({ error: 'blocks array too large' });
    if (isScanRateLimited(id)) return res.status(429).json({ error: 'rate limited' });

    const computer = state.computers[id];
    const origin = req.body.origin ?? computer?.loc;
    if (!origin) return res.status(400).json({ error: 'computer position unknown — send origin in request or a state update first' });

    const changed = commitScan(id, blocks, origin);
    if (changed > 0) log.info(`/api/scan id=${id} mapped ${changed} block changes`);
    res.json({ ok: true });
  });

  router.post('/api/sense', requireApprovedComputer, (req, res) => {
    const { entities } = req.body;
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    if (!Array.isArray(entities)) return res.status(400).json({ error: 'entities must be an array' });
    if (entities.length > 1_000) return res.status(400).json({ error: 'entities array too large' });
    const computer = state.computers[id];
    if (!computer) return res.status(400).json({ error: 'computer unknown — send a state update first' });
    state.computers[id].entities = entities;
    transactComputer(id, state.computers[id]);
    log.info(`/api/sense id=${id} reported ${entities.length} entities`);
    res.json({ ok: true });
  });

  router.post('/api/chat', requireApprovedComputer, (req, res) => {
    const { player, message, uuid } = req.body;
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    if (!player || !message) return res.status(400).json({ error: 'player and message required' });
    if (typeof player !== 'string' || player.length > 100) return res.status(400).json({ error: 'player name too long' });
    if (typeof message !== 'string' || message.length > 2_000) return res.status(400).json({ error: 'message too long' });
    const computer = state.computers[id];
    if (!computer) return res.status(400).json({ error: 'computer unknown — send a state update first' });
    if (!state.computers[id].chatLog) state.computers[id].chatLog = [];
    state.computers[id].chatLog.push({ player, message, uuid: uuid || '', timestamp: Date.now() });
    if (state.computers[id].chatLog.length > 100) state.computers[id].chatLog.shift();
    transactComputer(id, state.computers[id]);
    log.info(`/api/chat id=${id} player=${sanitizeForLog(player)} message=${sanitizeForLog(message)}`);
    res.json({ ok: true });
  });

  router.post('/api/statusUpdate', requireApprovedComputer, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const body = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => !BLOCKED_KEYS.has(k))
    );
    body.id = Number(id);
    const existing = state.computers[id] || {};
    const merged = { ...existing, ...body };
    if (!merged.loc && existing.loc) merged.loc = existing.loc;
    transactComputer(id, merged);
    res.sendStatus(200);
  });

  router.post('/api/commandResult', requireApprovedComputer, (req, res) => {
    const computerId = safeId(req.body.computerId);
    if (computerId === null) return res.status(400).json({ error: 'invalid computerId' });
    const result = req.body.result;
    if (JSON.stringify(result).length > 100_000) return res.status(400).json({ error: 'result too large' });
    console.log(`[${new Date().toISOString()}] Computer ${computerId} sent command result:`, result);
    if (!commandResultCache[computerId]) commandResultCache[computerId] = [];
    commandResultCache[computerId].push(result);
    if (commandResultCache[computerId].length > CMD_RESULT_CACHE_MAX) commandResultCache[computerId].shift();
    worldState.broadcastToClients({ commandResult: { computerId, result } });
    res.sendStatus(200);
  });

  router.post('/api/getStopSignal', express.text({ type: '*/*' }), requireApprovedComputer, (req, res) => {
    const rawId = typeof req.body === 'string' ? req.body : (req.body?.id ?? req.body?.computerId);
    const id = safeId(rawId);
    const ts = new Date().toISOString();
    if (id === null) {
      console.log(`[${ts}] getStopSignal: invalid id from ${req.ip}`);
      return res.sendStatus(400);
    }
    console.log(`[${ts}] Computer ${id} checked for stop signal from ${req.ip}`);
    res.send(stopSignal[id] ? true : false);
    delete stopSignal[id];
  });

  router.post('/api/getWsRequest', express.text({ type: '*/*' }), requireApprovedComputer, (req, res) => {
    const rawId = typeof req.body === 'string' ? req.body : (req.body?.id ?? req.body?.computerId);
    const id = safeId(rawId);
    if (id === null) return res.status(400).json({ error: 'invalid id' });
    if (state.computers[id]) {
      state.computers[id].lastPoll = Date.now();
      transactComputer(id, { ...state.computers[id] });
    }
    res.json({ open: worldState.wsRequests[id] === true });
  });

  return router;
}

module.exports = { createComputerRoutes };
