'use strict';

const express    = require('express');
const compression = require('compression');
const { SAVE_GZ_PATH, IS_PROD, DEV_NO_AUTH } = require('../config');
const fs = require('fs');

function createBrowserRoutes({ worldState, auth, log, userManagement, computerIpManager, computerIdManager, operatorManager, config }) {
  const router = express.Router();
  const { state, cmds, safeId, saveStateToDisk, guestStateLastTime } = worldState;
  const { requireAuth, requireAdmin, isAdmin, isOperator, getSession } = auth;
  const { GUEST_STATE_MIN_INTERVAL_MS, SIGNIN_URL, DEV_AUTH_URL } = config;

  const HOME_URL = IS_PROD ? process.env.NEXTAUTH_URL : DEV_AUTH_URL;
  router.get('/api/signin', (_req, res) => res.redirect(SIGNIN_URL));
  router.get('/api/home',   (_req, res) => res.redirect(HOME_URL));

  router.get('/api/state', compression(), async (req, res) => {
    const token = await getSession(req);
    if (!token) {
      const ip  = req.ip;
      const now = Date.now();
      if (guestStateLastTime[ip] && now - guestStateLastTime[ip] < GUEST_STATE_MIN_INTERVAL_MS) {
        const retryAfter = Math.ceil((guestStateLastTime[ip] + GUEST_STATE_MIN_INTERVAL_MS - now) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'rate limited', retryAfter });
      }
      guestStateLastTime[ip] = now;
    }
    res.send(state);
  });

  router.post('/api/saveState', requireAuth, (_req, res) => {
    saveStateToDisk();
    res.sendStatus(200);
  });

  router.get('/api/me', async (req, res) => {
    if (DEV_NO_AUTH && !IS_PROD) {
      let savedFileSizeBytes = null;
      try { savedFileSizeBytes = fs.statSync(SAVE_GZ_PATH).size; } catch {}
      return res.json({ isLoggedIn: true, username: 'dev', email: 'dev@localhost', isAdmin: true, isOperator: true, savedFileSizeBytes });
    }
    const token = await getSession(req);
    if (!token) return res.json({ isLoggedIn: false, isAdmin: false, isOperator: false });
    let savedFileSizeBytes = null;
    try { savedFileSizeBytes = fs.statSync(SAVE_GZ_PATH).size; } catch {}
    userManagement.updateLastActive(token.sub, token.username);
    res.json({
      isLoggedIn:  true,
      username:    token.username ?? token.name ?? null,
      email:       token.email ?? null,
      isAdmin:     isAdmin(token.sub),
      isOperator:  isOperator(token.sub),
      savedFileSizeBytes,
    });
  });

  router.post('/api/requestOperator', requireAuth, (req, res) => {
    const email = req.token.email ?? null;
    if (!email) return res.status(400).json({ error: 'No email in session token.' });
    const result = operatorManager.addRequest(req.token.sub, email);
    res.json({ result });
  });

  // ─── Admin endpoints ──────────────────────────────────────────────────────

  router.get('/api/admin/computerIps', requireAdmin, (_req, res) => res.json(computerIpManager.getAll()));

  router.post('/api/admin/denyComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    computerIpManager.deny(ip);
    log.info(`Turtle IP denied: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/approveComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    computerIpManager.approve(ip);
    log.info(`Turtle IP approved: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/revokeComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    computerIpManager.revoke(ip);
    log.info(`Turtle IP revoked: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.get('/api/admin/operatorRequests', requireAdmin, (_req, res) => res.json(operatorManager.getRequests()));
  router.get('/api/admin/operators',        requireAdmin, (_req, res) => res.json(operatorManager.getOperators()));

  router.post('/api/admin/approveOperator', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (!sub) return res.status(400).json({ error: 'sub required' });
    operatorManager.approveRequest(sub);
    log.info(`Operator approved: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/denyOperatorRequest', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (!sub) return res.status(400).json({ error: 'sub required' });
    operatorManager.denyRequest(sub);
    log.info(`Operator request denied: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/revokeOperator', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (!sub) return res.status(400).json({ error: 'sub required' });
    operatorManager.revokeOperator(sub);
    log.info(`Operator revoked: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.get('/api/admin/computerIds', requireAdmin, (_req, res) => res.json(computerIdManager.getAll()));

  router.post('/api/admin/approveComputerId', requireAdmin, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'id required' });
    computerIdManager.approve(Number(id));
    log.info(`Turtle ID approved: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/denyComputerId', requireAdmin, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'id required' });
    computerIdManager.deny(Number(id));
    log.info(`Turtle ID denied: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/revokeComputerId', requireAdmin, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'id required' });
    computerIdManager.revoke(Number(id));
    log.info(`Turtle ID revoked: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/setAllowByIp', requireAdmin, (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
    computerIdManager.setAllowByIp(enabled);
    log.info(`allowByIp set to ${enabled} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/deleteComputer', requireAdmin, (req, res) => {
    const id = safeId(req.body.id);
    if (id === null) return res.status(400).json({ error: 'id required' });
    delete state.computers[id];
    cmds[id] = [];
    log.info(`Computer ${id} deleted by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/clearWorld', requireAdmin, (req, res) => {
    state.world.blocks = {};
    log.info(`World cleared by ${req.token.sub}`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createBrowserRoutes };
