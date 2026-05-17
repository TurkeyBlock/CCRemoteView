require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.local') });

if (process.argv[2] === '--build-textures') {
  const { run } = require('../../scripts/textureExtractor/textureExtractor');
  run(process.argv[3], process.argv[4])
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
} else {

const path  = require('path');
const next  = require('next');
const express = require('express');
const pino  = require('pino');

const config = require('./config');
const { state } = require('./state/state');
const { startAutoSave } = require('./state/persistence');
const { createAuth }    = require('./auth');
const { buildManagers } = require('./managers.js');
const CommandLineInterface = require('./utils/cmdLineInterface.js');
const { mountRoutes, mountWebSockets, registerShutdown, setupNextJs, configureExpress, logStartup } = require('./startup.js');

const { IS_PROD, LOCAL_ONLY, PORT, BIND_HOST } = config;

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err);
  process.exit(1);
});

const log = pino({
  level: 'info',
  timestamp: () => {
    const d = new Date();
    return `,"time":"${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}"`;
  },
  base: null,
  formatters: { level: (label) => ({ level: label }) },
}, pino.destination({ dest: 1, sync: true }));

// ─── Managers ─────────────────────────────────────────────────────────────────

const managers = buildManagers();
const { userManagement } = managers;
const cmdLineInterface = new CommandLineInterface();
cmdLineInterface.on('users',          () => console.log(userManagement.getUserDataString()));
cmdLineInterface.on('deleteComputer', (id) => delete state.computers[id]);

// ─── Auth ─────────────────────────────────────────────────────────────────────

const auth = createAuth(managers);

// ─── Startup validation ───────────────────────────────────────────────────────

if (!LOCAL_ONLY) {
  const missing = ['APP_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[error] Production mode requires APP_URL, NEXTAUTH_URL, and NEXTAUTH_SECRET in .env.local`);
    console.error(`[error] Missing: ${missing.join(', ')}`);
    console.error(`[error] Did you mean to run start-local?`);
    process.exit(1);
  }
}

// ─── Next.js ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const nextApp = next({ dev: !IS_PROD, hostname: 'localhost', port: PORT, dir: PROJECT_ROOT });

nextApp.prepare()
  .then(() => {
    const handle = nextApp.getRequestHandler();
    const app    = express();

    configureExpress(app);
    mountRoutes(app, { auth, log, managers });
    setupNextJs(app, handle);

    const server = app.listen(PORT, BIND_HOST, () => logStartup(log));

    startAutoSave(() => userManagement.save());
    mountWebSockets(server, { auth, log, managers });
    registerShutdown(server, { userManagement });
  })
  .catch(err => {
    console.error('[startup] Next.js init failed:', err);
    process.exit(1);
  });

}
