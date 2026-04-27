require('dotenv').config({ path: '.env.local' });

const { parse }         = require('url');
const next              = require('next');
const express           = require('express');
const cors              = require('cors');
const fs                = require('fs');
const path              = require('path');
const pino              = require('pino');
const httpTerminator    = require('http-terminator');
const { WebSocketServer } = require('ws');

const config            = require('./src/server/config');
const worldState        = require('./src/server/worldState');
const { createAuth }    = require('./src/server/auth');
const { createComputerRoutes } = require('./src/server/routes/computerRoutes');
const { createBrowserRoutes  } = require('./src/server/routes/browserRoutes');
const { attachComputerWs }     = require('./src/server/ws/computerWs');
const { attachBrowserWs  }     = require('./src/server/ws/browserWs');

const UserManagement    = require('./src/server/utils/userManagement.js');
const ComputerIpManager = require('./src/server/utils/computerIpManager.js');
const ComputerIdManager = require('./src/server/utils/computerIdManager.js');
const OperatorManager   = require('./src/server/utils/operatorManager.js');
const CommandLineInterface = require('./src/server/utils/cmdLineInterface.js');

const { IS_PROD, DEV_NO_AUTH, DEV_AUTH_URL, PORT } = config;

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

const userManagement    = new UserManagement();
const computerIpManager = new ComputerIpManager();
const computerIdManager = new ComputerIdManager();
const operatorManager   = new OperatorManager();
const cmdLineInterface  = new CommandLineInterface();
cmdLineInterface.on('users',          () => console.log(userManagement.getUserDataString()));
cmdLineInterface.on('deleteComputer', (id) => delete worldState.state.computers[id]);

// ─── Auth ─────────────────────────────────────────────────────────────────────

const auth = createAuth({ userManagement, computerIpManager, computerIdManager, operatorManager });

// ─── Next.js ──────────────────────────────────────────────────────────────────

const nextApp = next({ dev: !IS_PROD, hostname: 'localhost', port: PORT });

nextApp.prepare().then(() => {
  const handle = nextApp.getRequestHandler();
  const app    = express();

  app.set('trust proxy', 'loopback');
  app.use(cors({ origin: IS_PROD ? process.env.APP_URL : DEV_AUTH_URL }));
  app.use(express.json({ limit: '2mb' }));

  // Static assets served directly by Express (accessible to CC computers too)
  app.use('/textures', express.static('textures', { maxAge: '1d' }));
  app.use('/computers', (req, res, next) => {
    const safe     = path.normalize(req.path).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.resolve('computers', safe.slice(1));
    if (!filePath.startsWith(path.resolve('computers'))) return res.sendStatus(403);
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return next();
      res.type('text/plain').send(data.replaceAll('%%APP_URL%%', process.env.APP_URL));
    });
  });

  // ─── Routes ─────────────────────────────────────────────────────────────────

  const deps = { worldState, auth, log, userManagement, computerIpManager, computerIdManager, operatorManager, config };
  app.use(createComputerRoutes(deps));
  app.use(createBrowserRoutes(deps));

  // Next.js handles all remaining routes (pages, _next/static, etc.)
  app.all('*', (req, res) => handle(req, res, parse(req.url, true)));

  // ─── Server ──────────────────────────────────────────────────────────────────

  const server = app.listen(PORT, () => {
    log.info(`Turtle remote controller server listening on port ${PORT}.`);
    console.log(`[server] Listening on port ${PORT}${DEV_NO_AUTH && !IS_PROD ? ' (DEV_NO_AUTH — no auth enforced)' : ''}`);
  });

  worldState.startAutoSave(() => userManagement.save());

  // ─── WebSocket servers ───────────────────────────────────────────────────────

  const wss         = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 1024 } });
  const computerWss = new WebSocketServer({ noServer: true });

  attachComputerWs(computerWss, { worldState, computerIpManager, computerIdManager, log });
  attachBrowserWs(wss,          { worldState, auth, log, userManagement });

  // Route upgrade requests: /ws → browser WS, /ws/computer → computer WS.
  // All other upgrades (/_next/webpack-hmr etc.) are left for Next.js.
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (req.url.startsWith('/ws/computer')) {
      computerWss.handleUpgrade(req, socket, head, (ws) => computerWss.emit('connection', ws, req));
    }
  });

  // ─── Shutdown ────────────────────────────────────────────────────────────────

  const terminator = httpTerminator.createHttpTerminator({ gracefulTerminationTimeout: 200, server });
  process.on('SIGINT', async () => {
    await terminator.terminate();
    worldState.saveStateToDisk();
    userManagement.save();
    process.exit(0);
  });
});
