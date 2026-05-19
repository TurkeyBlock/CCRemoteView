'use strict';

const express    = require('express');
const { SAVE_GZ_PATH, BYPASS_AUTH } = require('../config');
const { requireValidId } = require('../utils/validateId');
const { rateLimit } = require('../utils/simpleRateLimit');
const fs = require('fs');

const adminApiLimiter = rateLimit(5);

/**
 * @param {object} deps
 * @param {{ state: object, cmds: object }} deps.worldState
 * @param {{ requireAuth: Function, requireAdmin: Function, isAdmin: Function, isOperator: Function, getSession: Function }} deps.auth
 * @param {object} deps.log
 * @param {object} deps.userManagement
 * @param {object} deps.computerIpManager
 * @param {object} deps.computerIdManager
 * @param {object} deps.operatorManager
 * @param {{ SIGNIN_URL: string, DEV_AUTH_URL: string, IS_PROD: boolean }} deps.config
 */
function createBrowserRoutes({ worldState, auth, log, userManagement, computerIpManager, computerIdManager, operatorManager, config }) {
  const router = express.Router();
  const { state, cmds } = worldState;
  const { requireAuth, requireAdmin, isAdmin, isOperator, getSession } = auth;
  const { SIGNIN_URL, DEV_AUTH_URL, IS_PROD } = config;

  const badIp  = (ip)  => !ip  || typeof ip  !== 'string' || ip.length  > 45;
  const badSub = (sub) => !sub || typeof sub !== 'string' || sub.length > 256;

  const HOME_URL = IS_PROD ? process.env.NEXTAUTH_URL : DEV_AUTH_URL;
  router.get('/api/signin', (_req, res) => res.redirect(SIGNIN_URL));
  router.get('/api/home',   (_req, res) => res.redirect(HOME_URL));

  router.get('/api/me', async (req, res, next) => {
    try {
      if (BYPASS_AUTH) {
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
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/requestOperator', requireAuth, (req, res) => {
    const email = req.token.email ?? null;
    if (!email) return res.status(400).json({ error: 'No email in session token.' });
    const result = operatorManager.addRequest(req.token.sub, email);
    res.json({ result });
  });

  // ─── Admin endpoints ──────────────────────────────────────────────────────
  // Non-admins get 404 so route existence isn't enumerable via 403 vs 401.
  // Rate limiter applied here covers all admin routes uniformly.
  router.use('/api/admin', adminApiLimiter, async (req, res, next) => {
    if (BYPASS_AUTH) return next();
    const token = await auth.getSession(req);
    if (!token || !isAdmin(token.sub)) return res.status(404).end();
    next();
  });

  router.get('/api/admin/computerIps', requireAdmin, (_req, res) => res.json(computerIpManager.getAll()));

  router.post('/api/admin/denyComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (badIp(ip)) return res.status(400).json({ error: 'ip required' });
    computerIpManager.deny(ip);
    log.info(`Turtle IP denied: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/approveComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (badIp(ip)) return res.status(400).json({ error: 'ip required' });
    computerIpManager.approve(ip);
    log.info(`Turtle IP approved: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/revokeComputer', requireAdmin, (req, res) => {
    const { ip } = req.body;
    if (badIp(ip)) return res.status(400).json({ error: 'ip required' });
    computerIpManager.revoke(ip);
    log.info(`Turtle IP revoked: ${ip} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.get('/api/admin/operatorRequests', requireAdmin, (_req, res) => res.json(operatorManager.getRequests()));
  router.get('/api/admin/operators',        requireAdmin, (_req, res) => res.json(operatorManager.getOperators()));

  router.post('/api/admin/approveOperator', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (badSub(sub)) return res.status(400).json({ error: 'sub required' });
    operatorManager.approveRequest(sub);
    log.info(`Operator approved: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/denyOperatorRequest', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (badSub(sub)) return res.status(400).json({ error: 'sub required' });
    operatorManager.denyRequest(sub);
    log.info(`Operator request denied: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/revokeOperator', requireAdmin, (req, res) => {
    const { sub } = req.body;
    if (badSub(sub)) return res.status(400).json({ error: 'sub required' });
    operatorManager.revokeOperator(sub);
    log.info(`Operator revoked: ${sub} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.get('/api/admin/computerIds', requireAdmin, (_req, res) => res.json(computerIdManager.getAll()));

  router.post('/api/admin/approveComputerId', requireAdmin, requireValidId, (req, res) => {
    const id = req.cid;
    computerIdManager.approve(Number(id));
    log.info(`Turtle ID approved: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/denyComputerId', requireAdmin, requireValidId, (req, res) => {
    const id = req.cid;
    computerIdManager.deny(Number(id));
    log.info(`Turtle ID denied: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/revokeComputerId', requireAdmin, requireValidId, (req, res) => {
    const id = req.cid;
    computerIdManager.revoke(Number(id));
    log.info(`Turtle ID revoked: ${id} by ${req.token.sub}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/setAllowByIp', requireAdmin, (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });
    computerIdManager.setAllowByIp(enabled);
    log.warn(`[SECURITY] allowByIp set to ${enabled} by ${req.token.sub} — computer ID approval ${enabled ? 'DISABLED' : 'enabled'}`);
    res.json({ ok: true });
  });

  router.post('/api/admin/deleteComputer', requireAdmin, requireValidId, (req, res) => {
    const id = req.cid;
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
