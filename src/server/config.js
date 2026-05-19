'use strict';

const path    = require('path');
const IS_PROD = process.env.NODE_ENV !== 'development';

// LOCAL_ONLY: true when running in dev (NODE_ENV !== 'production') or when the
// packaged binary's local start script sets APP_LOCAL_ONLY=true. Controls
// auth enforcement only — network binding is always loopback regardless.
const LOCAL_ONLY = !IS_PROD || process.env.APP_LOCAL_ONLY === 'true';

// Flip to true to require authentication even while LOCAL_ONLY is active —
// useful for testing the auth flow during development. Has no effect in
// production: auth is always enforced when LOCAL_ONLY is false.
const LOCAL_REQUIRE_AUTH = false;

// BYPASS_AUTH: the single source of truth for whether auth checks are skipped.
// True only when explicitly in local mode AND auth has not been turned on via
// LOCAL_REQUIRE_AUTH. Can never be true in production.
const BYPASS_AUTH = LOCAL_ONLY && !LOCAL_REQUIRE_AUTH;

// Suppress verbose update logs or autosave logs in production by default.
// Override with SUPPRESS_UPDATE_LOGS/SUPPRESS_SAVE_LOGS env vars.
const SUPPRESS_UPDATE_LOGS = process.env.SUPPRESS_UPDATE_LOGS === 'false'
  ? false
  : process.env.SUPPRESS_UPDATE_LOGS === 'true'
    ? true
    : IS_PROD;
const SUPPRESS_SAVE_LOGS = process.env.SUPPRESS_SAVE_LOGS === 'false'
  ? false
  : process.env.SUPPRESS_SAVE_LOGS === 'true'
    ? true
    : IS_PROD;

// Log every browser command request (setCommand, setStopSignal, etc.)
const LOG_BROWSER_CMDS = !SUPPRESS_UPDATE_LOGS;

// Always bind to loopback — external traffic must come through a reverse proxy
// (e.g. Cloudflare Tunnel). This prevents CF-Connecting-IP spoofing from direct
// connections to the origin port.
const BIND_HOST = '127.0.0.1';

const PORT        = parseInt(process.env.APP_PORT || '8081', 10);
const DEV_APP_URL = `http://localhost:${PORT}`;
const DEV_AUTH_URL = 'http://localhost:3000';

const COOKIE_NAME = IS_PROD ? '__Secure-authjs.session-token' : 'authjs.session-token';
const APP_URL     = IS_PROD ? process.env.APP_URL : DEV_APP_URL;
const SIGNIN_URL  = `${IS_PROD ? process.env.NEXTAUTH_URL : DEV_AUTH_URL}/auth/signin?callbackUrl=${encodeURIComponent(APP_URL)}`;

const COMPUTER_POLL_INTERVAL_S       = 30;
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
const MAX_CMD_QUEUE_DEPTH       = 100;
const CMD_QUEUE_TTL_MS          = 5 * 60 * 1000;  // 5 min — drop stale cmds for offline computers

const SAVE_GZ_PATH   = path.join(__dirname, 'data/saved_state.json.gz');
const SAVE_JSON_PATH = path.join(__dirname, 'data/saved_state.json');

const DEV_TOKEN = { sub: 'dev', username: 'dev', email: 'dev@localhost' };

const MAX_BROWSER_WS_PAYLOAD_BYTES  = 32 * 1024;
const MAX_COMPUTER_WS_PAYLOAD_BYTES = 5 * 1024 * 1024;
const GRACEFUL_SHUTDOWN_MS          = 200;
const MAX_SCENE_OBJECTS             = 512;
const MAX_SCENE_TEXT_LENGTH         = 512;
const POLYGON_MIN_POINTS            = 3;
const POLYGON_MAX_POINTS            = 32;
const LINE_MIN_POINTS               = 2;
const LINE_MAX_POINTS               = 64;
const CHAT_DEDUP_WINDOW_MS          = 30_000;
const MAX_CHAT_LOG_SIZE             = 500;
const SECONDS_PER_HOUR             = 3600;
const SECONDS_PER_DAY              = 86400;
const MAX_BLOCKS_PER_REQUEST        = 50_000;
const MAX_ENTITIES_PER_REQUEST      = 1_000;
const MAX_PLAYER_NAME_LENGTH        = 100;
const MAX_CHAT_MESSAGE_LENGTH       = 2_000;
const MAX_COMMAND_RESULT_LENGTH     = 100_000;

module.exports = {
  IS_PROD, LOCAL_ONLY, LOCAL_REQUIRE_AUTH, BYPASS_AUTH, LOG_BROWSER_CMDS,
  SUPPRESS_UPDATE_LOGS, SUPPRESS_SAVE_LOGS,
  DEV_APP_URL, DEV_AUTH_URL,
  BIND_HOST, COOKIE_NAME, APP_URL, SIGNIN_URL, PORT,
  COMPUTER_POLL_INTERVAL_S,
  AUTOSAVE_INTERVAL_MIN, TRANSACTION_CACHE_TTL_MS, TRANSACTION_CACHE_MAX_COUNT,
  SCAN_MIN_INTERVAL_MS, SCAN_INCLUDE_METADATA, SCAN_INCLUDE_STATE,
  CMD_RESULT_CACHE_MAX, MAX_CMD_LENGTH, MAX_CMD_QUEUE_DEPTH, CMD_QUEUE_TTL_MS,
  MAX_UNAUTHED_WS, MAX_AUTHED_GUEST_WS,
  SAVE_GZ_PATH, SAVE_JSON_PATH,
  DEV_TOKEN,
  MAX_BROWSER_WS_PAYLOAD_BYTES, MAX_COMPUTER_WS_PAYLOAD_BYTES, GRACEFUL_SHUTDOWN_MS,
  MAX_SCENE_OBJECTS, MAX_SCENE_TEXT_LENGTH,
  POLYGON_MIN_POINTS, POLYGON_MAX_POINTS, LINE_MIN_POINTS, LINE_MAX_POINTS,
  CHAT_DEDUP_WINDOW_MS, MAX_CHAT_LOG_SIZE,
  SECONDS_PER_HOUR, SECONDS_PER_DAY,
  MAX_BLOCKS_PER_REQUEST, MAX_ENTITIES_PER_REQUEST,
  MAX_PLAYER_NAME_LENGTH, MAX_CHAT_MESSAGE_LENGTH, MAX_COMMAND_RESULT_LENGTH,
};
