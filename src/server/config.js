'use strict';

const IS_PROD = process.env.NODE_ENV === 'production';

// Flip to true for local dev without NextAuth credentials.
// Only takes effect when IS_PROD is false.
const DEV_NO_AUTH = true;

// Log every browser command request (setCommand, setStopSignal, etc.)
const LOG_BROWSER_CMDS = true;

const DEV_APP_URL  = 'http://localhost:8081';
const DEV_AUTH_URL = 'http://localhost:3000';

const COOKIE_NAME = IS_PROD ? '__Secure-authjs.session-token' : 'authjs.session-token';
const APP_URL     = IS_PROD ? process.env.APP_URL : DEV_APP_URL;
const SIGNIN_URL  = `${IS_PROD ? process.env.NEXTAUTH_URL : DEV_AUTH_URL}/auth/signin?callbackUrl=${encodeURIComponent(APP_URL)}`;
const PORT        = parseInt(process.env.APP_PORT || '8081', 10);

const AUTOSAVE_INTERVAL_MIN     = 5;
const TRANSACTION_CACHE_COUNT   = 10_000;
const GUEST_STATE_MIN_INTERVAL_MS = 30_000;
const SCAN_MIN_INTERVAL_MS      = 1_000;
const SCAN_INCLUDE_METADATA     = true;
const SCAN_INCLUDE_STATE        = false;
const CMD_RESULT_CACHE_MAX      = 100;
const MAX_CMD_LENGTH            = 10_000;

const SAVE_GZ_PATH   = './src/server/saved/saved_state.json.gz';
const SAVE_JSON_PATH = './src/server/saved/saved_state.json';

const DEV_TOKEN = { sub: 'dev', username: 'dev', email: 'dev@localhost' };

module.exports = {
  IS_PROD, DEV_NO_AUTH, LOG_BROWSER_CMDS,
  DEV_APP_URL, DEV_AUTH_URL,
  COOKIE_NAME, APP_URL, SIGNIN_URL, PORT,
  AUTOSAVE_INTERVAL_MIN, TRANSACTION_CACHE_COUNT, GUEST_STATE_MIN_INTERVAL_MS,
  SCAN_MIN_INTERVAL_MS, SCAN_INCLUDE_METADATA, SCAN_INCLUDE_STATE,
  CMD_RESULT_CACHE_MAX, MAX_CMD_LENGTH,
  SAVE_GZ_PATH, SAVE_JSON_PATH,
  DEV_TOKEN,
};
