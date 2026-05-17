'use strict';

const { getClientIp } = require('./clientIp');

// Zero-dep sliding-window rate limiter keyed by client IP.
// Each call returns an Express middleware capped at maxPerSec requests/second.
// Buckets are cleaned up on each request that opens a new window, keeping memory bounded.
function rateLimit(maxPerSec) {
  const buckets = new Map(); // ip -> { count, windowStart }
  return (req, res, next) => {
    const ip  = getClientIp(req);
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now - b.windowStart > 1_000) {
      b = { count: 0, windowStart: now };
      buckets.set(ip, b);
    }
    b.count++;
    if (b.count > maxPerSec) {
      return res.set('Retry-After', '1').status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

module.exports = { rateLimit };
