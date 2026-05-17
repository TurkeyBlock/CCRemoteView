'use strict';

const fs = require('fs');
const { COOKIE_NAME, BYPASS_AUTH, DEV_TOKEN } = require('./config');
const { getClientIp } = require('./utils/clientIp');

let _jwtDecode = null;
async function jwtDecode(params) {
  if (!_jwtDecode) _jwtDecode = (await import('@auth/core/jwt')).decode;
  return _jwtDecode(params);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    })
  );
}

async function getSession(req) {
  try {
    const cookies = parseCookies(req);
    const raw = cookies[COOKIE_NAME];
    if (!raw) return null;
    return await jwtDecode({
      token: raw,
      secret: process.env.NEXTAUTH_SECRET,
      salt: COOKIE_NAME,
    });
  } catch (err) {
    if (err.code !== 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' && err.name !== 'JWTExpired') {
      console.error('[auth] getSession unexpected error:', err.message);
    }
    return null;
  }
}

let _adminsCache = null;
function loadAdmins() {
  if (_adminsCache !== null) return _adminsCache;
  try {
    _adminsCache = JSON.parse(fs.readFileSync('./src/server/data/admins.json', 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[auth] Failed to load admins.json:', err);
    _adminsCache = [];
  }
  return _adminsCache;
}

// Factory — call once with manager instances, get back middleware functions.
function createAuth({ userManagement, computerIpManager, computerIdManager, operatorManager }) {
  function isAdmin(sub)    { return loadAdmins().includes(sub); }
  function isOperator(sub) { return operatorManager.isOperator(sub); }

  const devBypass = (req, next) => { req.token = DEV_TOKEN; next(); };

  function makeAuthGate(check) {
    return async (req, res, next) => {
      try {
        if (BYPASS_AUTH) return devBypass(req, next);
        const token = await getSession(req);
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        if (check && !check(token)) return res.status(403).json({ error: 'Forbidden' });
        req.token = token;
        userManagement.updateLastActive(token.sub, token.username);
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  const requireAuth     = makeAuthGate(null);
  const requireOperator = makeAuthGate(t => isOperator(t.sub));
  const requireAdmin    = makeAuthGate(t => isAdmin(t.sub));

  function requireApprovedComputer(req, res, next) {
    const ip = getClientIp(req);
    if (!computerIpManager.isApproved(ip)) {
      if (!computerIpManager.isPending(ip)) computerIpManager.addPending(ip);
      return res.status(403).json({ status: 'pending_ip', message: 'Turtle IP is awaiting admin approval.' });
    }
    const id = typeof req.body === 'string' ? Number(req.body) : (req.body?.id ?? req.body?.computerId);
    if (!computerIdManager.allowByIp && id !== undefined && !isNaN(id)) {
      if (!computerIdManager.isApproved(id)) {
        if (!computerIdManager.isPending(id)) computerIdManager.addPending(id, ip);
        return res.status(403).json({ status: 'pending_id', message: 'Turtle ID is awaiting admin approval.' });
      }
    }
    next();
  }

  return { isAdmin, isOperator, getSession, requireAuth, requireOperator, requireAdmin, requireApprovedComputer };
}

module.exports = { createAuth, getSession };
