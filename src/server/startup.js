'use strict';

const fs   = require('fs');
const path = require('path');
const { parse } = require('url');
const { WebSocketServer } = require('ws');
const httpTerminator = require('http-terminator');

const config = require('./config');
const { saveStateToDisk, startAutoSave } = require('./state/persistence');
const worldState = require('./worldState');
const { createComputerRoutes } = require('./routes/computerRoutes');
const { createBrowserRoutes  } = require('./routes/browserRoutes');
const { attachComputerWs }     = require('./ws/computerWs');
const { attachBrowserWs  }     = require('./ws/browserWs');

const { IS_PROD, DEV_AUTH_URL, BYPASS_AUTH, BIND_HOST, PORT,
        MAX_BROWSER_WS_PAYLOAD_BYTES, MAX_COMPUTER_WS_PAYLOAD_BYTES, GRACEFUL_SHUTDOWN_MS } = config;

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function mountRoutes(app, { auth, log, managers }) {
  const { userManagement, computerIpManager, computerIdManager, operatorManager } = managers;
  const LUA_DIR = path.join(PROJECT_ROOT, 'lua');

  app.use('/assets', require('express').static(path.join(PROJECT_ROOT, 'assets'), { maxAge: '1d' }));
  app.use('/lua', (req, res, next) => {
    const safe     = path.normalize(req.path).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.resolve(LUA_DIR, safe.slice(1));
    if (!filePath.startsWith(path.resolve(LUA_DIR) + path.sep)) return res.sendStatus(403);
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return err.code === 'ENOENT' ? res.sendStatus(404) : next(err);
      res.type('text/plain').send(
        data
          .replaceAll('%%APP_URL%%', process.env.APP_URL || config.APP_URL)
          .replaceAll('%%COMPUTER_POLL_INTERVAL_S%%', String(config.COMPUTER_POLL_INTERVAL_S))
          .replaceAll('%%SCAN_INCLUDE_METADATA%%', String(config.SCAN_INCLUDE_METADATA))
          .replaceAll('%%SCAN_INCLUDE_STATE%%',    String(config.SCAN_INCLUDE_STATE))
      );
    });
  });

  const deps = { worldState, auth, log, userManagement, computerIpManager, computerIdManager, operatorManager, config };
  app.use(createComputerRoutes(deps));
  app.use(createBrowserRoutes(deps));

  app.get('/health', (req, res) => {
    const remote = req.socket.remoteAddress;
    if (remote !== '127.0.0.1' && remote !== '::1') return res.sendStatus(403);
    const { state } = worldState;
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      computers: Object.keys(state.computers).length,
      worldBlocks: Object.keys(state.world.blocks).length,
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    log.error({ err, method: req.method, url: req.url }, '[express] Unhandled route error');
    if (res.headersSent) return;
    res.status(err.status ?? err.statusCode ?? 500).json({ error: 'Internal server error' });
  });
}

function mountWebSockets(server, { auth, log, managers }) {
  const { userManagement, computerIpManager, computerIdManager } = managers;

  const wss         = new WebSocketServer({ noServer: true, maxPayload: MAX_BROWSER_WS_PAYLOAD_BYTES, perMessageDeflate: { threshold: 1024 } });
  const computerWss = new WebSocketServer({ noServer: true, maxPayload: MAX_COMPUTER_WS_PAYLOAD_BYTES });

  attachComputerWs(computerWss, { worldState, computerIpManager, computerIdManager, log });
  attachBrowserWs(wss,          { worldState, auth, log, userManagement });

  const allowedOrigins = new Set(
    [IS_PROD ? process.env.APP_URL : config.DEV_APP_URL, process.env.NEXTAUTH_URL].filter(Boolean)
  );

  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/ws') {
      if (!BYPASS_AUTH) {
        const origin = req.headers.origin;
        if (!origin || !allowedOrigins.has(origin)) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (pathname.startsWith('/ws/computer')) {
      // ComputerCraft HTTP clients don't send Origin — skip origin check here.
      computerWss.handleUpgrade(req, socket, head, (ws) => computerWss.emit('connection', ws, req));
    }
  });
}

function registerShutdown(server, { userManagement }) {
  const terminator = httpTerminator.createHttpTerminator({ gracefulTerminationTimeout: GRACEFUL_SHUTDOWN_MS, server });
  process.on('SIGINT', async () => {
    await terminator.terminate();
    try {
      saveStateToDisk();
    } catch (err) {
      console.error('[shutdown] Sync world save failed:', err);
    }
    try {
      userManagement.save();
    } catch (err) {
      console.error('[shutdown] User save failed:', err);
    }
    process.exit(0);
  });
}

function setupNextJs(app, handle) {
  app.all('*', (req, res) => handle(req, res, parse(req.url, true)));
}

function configureExpress(app) {
  const cors        = require('cors');
  const compression = require('compression');
  const express     = require('express');
  const helmet      = require('helmet');
  app.set('trust proxy', 'loopback');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        // 'unsafe-eval' is required in dev: React reconstructs call stacks via eval() for
        // debugging. It is never used in production builds, so we omit it there.
        scriptSrc:   ["'self'", "'unsafe-inline'", ...(!IS_PROD ? ["'unsafe-eval'"] : [])],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", 'data:', 'blob:'],
        connectSrc:  ["'self'", 'ws:', 'wss:', 'blob:'],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }));
  app.use(compression());
  app.use(cors({
    origin: IS_PROD ? process.env.APP_URL : DEV_AUTH_URL,
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.setTimeout(15_000, () => {
      if (!res.headersSent) res.status(503).json({ error: 'Request timeout' });
    });
    next();
  });
}

function logStartup(log) {
  log.info(`Turtle remote controller server listening on ${BIND_HOST}:${PORT}.`);
  console.log(`[server] Listening on ${BIND_HOST}:${PORT}${BYPASS_AUTH ? ' (local-only mode — no auth enforced)' : ''}`);
}

module.exports = { mountRoutes, mountWebSockets, registerShutdown, setupNextJs, configureExpress, logStartup };
