'use strict';

// Validates a computer ID: non-negative integer ≤ 1 000 000.
// Returns the numeric string form, or null if invalid.
// Guards against prototype-pollution keys (__proto__, constructor, prototype).
function safeId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_000) return null;
  return String(n);
}

// Strip control characters before logging to prevent log-injection.
function sanitizeForLog(val) {
  return String(val ?? '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 500);
}

module.exports = { safeId, sanitizeForLog };
