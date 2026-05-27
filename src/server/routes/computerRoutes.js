'use strict';

const express = require('express');
const { requireValidId } = require('../utils/validateId');
const { filterStateUpdate } = require('../../types/computerMessages');
const { MAX_BLOCKS_PER_REQUEST, MAX_ENTITIES_PER_REQUEST, MAX_PLAYER_NAME_LENGTH,
        MAX_CHAT_MESSAGE_LENGTH, MAX_COMMAND_RESULT_LENGTH } = require('../config');
// No rate limiting on computer endpoints: approved ComputerCraft IPs are trusted.
// IP spoofing is not a practical concern — CF-Connecting-IP is set by Cloudflare
// and cannot be forged by external clients given the loopback-only bind.

/**
 * @param {object} deps
 * @param {{ state: object, cmds: object, stopSignal: object, safeId: Function, sanitizeForLog: Function, transactComputer: Function, transactComputerDelta: Function, applyExtractedState: Function, commitScan: Function, setWsRequest: Function, addChatMessage: Function, transactChat: Function, isScanRateLimited: Function, recordCommandResult: Function, broadcastToClients: Function, wsRequests: object }} deps.worldState
 * @param {{ requireApprovedComputer: Function }} deps.auth
 * @param {object} deps.log
 */
function createComputerRoutes({ worldState, auth, log }) {
  const router = express.Router();
  const {
    state, cmds, stopSignal,
    safeId, sanitizeForLog,
    transactComputer, transactComputerDelta, applyExtractedState, commitScan, setWsRequest,
    addChatMessage, transactChat,
    isScanRateLimited,
    recordCommandResult,
  } = worldState;
  const { requireApprovedComputer } = auth;

  router.post('/api/state', requireApprovedComputer, requireValidId, (req, res) => {
    const id = req.cid;
    const filtered = filterStateUpdate(req.body);
    filtered.id = Number(id);
    const existing = state.computers[id] || {};
    const merged = { ...existing, ...filtered };
    applyExtractedState(merged);
    res.sendStatus(200);
  });

  router.post('/api/scan', requireApprovedComputer, requireValidId, (req, res) => {
    const { blocks } = req.body;
    const id = req.cid;
    if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks must be an array' });
    if (blocks.length > MAX_BLOCKS_PER_REQUEST) return res.status(400).json({ error: 'blocks array too large' });
    if (isScanRateLimited(id)) return res.status(429).json({ error: 'rate limited' });

    const computer = state.computers[id];
    const origin = req.body.origin ?? computer?.loc;
    if (!origin) return res.status(400).json({ error: 'computer position unknown — send origin in request or a state update first' });

    const changed = commitScan(id, blocks, origin);
    if (changed > 0) log.info(`/api/scan id=${id} mapped ${changed} block changes`);
    res.json({ ok: true });
  });

  router.post('/api/sense', requireApprovedComputer, requireValidId, (req, res) => {
    const { entities } = req.body;
    const id = req.cid;
    if (!Array.isArray(entities)) return res.status(400).json({ error: 'entities must be an array' });
    if (entities.length > MAX_ENTITIES_PER_REQUEST) return res.status(400).json({ error: 'entities array too large' });
    const computer = state.computers[id];
    if (!computer) return res.status(400).json({ error: 'computer unknown — send a state update first' });
    state.computers[id].entities = entities;
    transactComputer(id, state.computers[id]);
    log.info(`/api/sense id=${id} reported ${entities.length} entities`);
    res.json({ ok: true });
  });

  router.post('/api/chat', requireApprovedComputer, requireValidId, (req, res) => {
    const { player, message, uuid } = req.body;
    const id = req.cid;
    if (!player || !message) return res.status(400).json({ error: 'player and message required' });
    if (typeof player !== 'string' || player.length > MAX_PLAYER_NAME_LENGTH) return res.status(400).json({ error: 'player name too long' });
    if (typeof message !== 'string' || message.length > MAX_CHAT_MESSAGE_LENGTH) return res.status(400).json({ error: 'message too long' });
    if (!state.computers[id]) return res.status(400).json({ error: 'computer unknown — send a state update first' });
    const safeUuid = typeof uuid === 'string' && /^[0-9a-f-]{8,36}$/i.test(uuid) ? uuid : null;
    const newMsg = addChatMessage(player, message, safeUuid, Number(id));
    if (newMsg) {
      transactChat(newMsg);
      log.info(`/api/chat id=${id} player=${sanitizeForLog(player)} message=${sanitizeForLog(message)}`);
    }
    res.json({ ok: true });
  });

  router.post('/api/statusUpdate', requireApprovedComputer, requireValidId, (req, res) => {
    const id = req.cid;
    const filtered = filterStateUpdate(req.body);
    filtered.id = Number(id);
    transactComputerDelta(id, filtered);
    res.sendStatus(200);
  });

  router.post('/api/commandResult', requireApprovedComputer, (req, res) => {
    const computerId = safeId(req.body.computerId);
    if (computerId === null) return res.status(400).json({ error: 'invalid computerId' });
    const result = req.body.result;
    if (JSON.stringify(result).length > MAX_COMMAND_RESULT_LENGTH) return res.status(400).json({ error: 'result too large' });
    log.info({ result }, `Computer ${computerId} sent command result`);
    recordCommandResult(computerId, result);
    worldState.broadcastToClients({ commandResult: { computerId, result } });
    res.sendStatus(200);
  });

  router.post('/api/getStopSignal', express.text({ type: '*/*', limit: '1kb' }), requireApprovedComputer, (req, res) => {
    const rawId = typeof req.body === 'string' ? req.body : (req.body?.id ?? req.body?.computerId);
    const id = safeId(rawId);
    if (id === null) {
      log.warn({ ip: sanitizeForLog(req.ip) }, 'getStopSignal: invalid id');
      return res.sendStatus(400);
    }
    log.info({ id, ip: sanitizeForLog(req.ip) }, `Computer ${id} checked for stop signal`);
    res.send(stopSignal[id] ? true : false);
    delete stopSignal[id];
  });

  router.post('/api/getWsRequest', express.text({ type: '*/*', limit: '1kb' }), requireApprovedComputer, (req, res) => {
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
