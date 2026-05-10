'use strict';

const path    = require('path');
const IS_PROD = process.env.NODE_ENV !== 'development';

// LOCAL_ONLY: true when running in dev (NODE_ENV !== 'production') or when the
// packaged binary's local start script sets APP_LOCAL_ONLY=true. Controls
// network binding — the server always binds to 127.0.0.1 in this mode so it
// is unreachable from the network at the OS level regardless of auth state.
const LOCAL_ONLY = !IS_PROD || process.env.APP_LOCAL_ONLY === 'true';

// Flip to true to require authentication even while LOCAL_ONLY is active —
// useful for testing the auth flow during development. Has no effect in
// production: auth is always enforced when LOCAL_ONLY is false.
const LOCAL_REQUIRE_AUTH = false;

// BYPASS_AUTH: the single source of truth for whether auth checks are skipped.
// True only when explicitly in local mode AND auth has not been turned on via
// LOCAL_REQUIRE_AUTH. Can never be true in production.
const BYPASS_AUTH = LOCAL_ONLY && !LOCAL_REQUIRE_AUTH;

// Log every browser command request (setCommand, setStopSignal, etc.)
const LOG_BROWSER_CMDS = true;

// BIND_HOST is derived from LOCAL_ONLY and is not independently overridable in
// local mode — the loopback binding is part of the LOCAL_ONLY guarantee.
const BIND_HOST = LOCAL_ONLY ? '127.0.0.1' : (process.env.BIND_HOST || '0.0.0.0');

const PORT        = parseInt(process.env.APP_PORT || '8081', 10);
const DEV_APP_URL = `http://localhost:${PORT}`;
const DEV_AUTH_URL = 'http://localhost:3000';

const COOKIE_NAME = IS_PROD ? '__Secure-authjs.session-token' : 'authjs.session-token';
const APP_URL     = IS_PROD ? process.env.APP_URL : DEV_APP_URL;
const SIGNIN_URL  = `${IS_PROD ? process.env.NEXTAUTH_URL : DEV_AUTH_URL}/auth/signin?callbackUrl=${encodeURIComponent(APP_URL)}`;

const AUTOSAVE_INTERVAL_MIN          = 5;
const TRANSACTION_CACHE_TTL_MS       = 24 * 60 * 60 * 1000;  // 24 hours
const TRANSACTION_CACHE_MAX_COUNT    = 200_000;               // safety cap against runaway memory
const SCAN_MIN_INTERVAL_MS      = 1_000;

// Maximum concurrent WebSocket connections for read-only viewers.
// Unauthed: no session token at all (fully anonymous).
// Authed guest: valid session token but not an operator or admin.
// Each new connection receives the full world state on join — on a slow uplink
// the dominant cost is bandwidth, not CPU.  Tune these to your upload capacity.
const MAX_UNAUTHED_WS     = 5;
const MAX_AUTHED_GUEST_WS = 10;
const SCAN_INCLUDE_METADATA     = true;
const SCAN_INCLUDE_STATE        = false;
const CMD_RESULT_CACHE_MAX      = 100;
const MAX_CMD_LENGTH            = 10_000;

const SAVE_GZ_PATH   = path.join(__dirname, 'data/saved_state.json.gz');
const SAVE_JSON_PATH = path.join(__dirname, 'data/saved_state.json');

const DEV_TOKEN = { sub: 'dev', username: 'dev', email: 'dev@localhost' };

module.exports = {
  IS_PROD, LOCAL_ONLY, LOCAL_REQUIRE_AUTH, BYPASS_AUTH, LOG_BROWSER_CMDS,
  DEV_APP_URL, DEV_AUTH_URL,
  BIND_HOST, COOKIE_NAME, APP_URL, SIGNIN_URL, PORT,
  AUTOSAVE_INTERVAL_MIN, TRANSACTION_CACHE_TTL_MS, TRANSACTION_CACHE_MAX_COUNT,
  SCAN_MIN_INTERVAL_MS, SCAN_INCLUDE_METADATA, SCAN_INCLUDE_STATE,
  CMD_RESULT_CACHE_MAX, MAX_CMD_LENGTH,
  MAX_UNAUTHED_WS, MAX_AUTHED_GUEST_WS,
  SAVE_GZ_PATH, SAVE_JSON_PATH,
  DEV_TOKEN,
};
