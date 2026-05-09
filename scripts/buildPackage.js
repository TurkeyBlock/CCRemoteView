// Standalone package builder.
//
// Produces a zip under packaged/ containing:
//   - The custom Express server (server.js + src/server/)
//   - The Next.js standalone build (.next/, public/)
//   - All server-side npm dependencies (node_modules/)
//   - Runtime assets (computers/, textures/ if present)
//   - Blank starter saved data (src/server/saved/)
//   - A Node.js binary, two start scripts, README, and .env template
//
// Usage: npm run pkg
//   (which runs: npm run build && node scripts/buildPackage.js)
//
// Requires a fresh `npm run build` first — the Next.js standalone output
// (.next/standalone/) must exist before this script runs.

'use strict';
const { execSync } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const archiver = require('archiver');

const pkg           = require('../package.json');
const platform      = process.platform;
const isWin         = platform === 'win32';
const nodeExt       = isWin ? '.exe' : '';
const rootDir       = path.resolve(__dirname, '..');
const standaloneDir = path.resolve(rootDir, '.next', 'standalone');
const outDir        = path.resolve(rootDir, 'packaged');
const zipPath       = path.join(outDir, `${pkg.name}-v${pkg.version}.zip`);

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: rootDir, ...opts });
}

function copyDir(src, dest, exclude = new Set()) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(srcPath, destPath) : fs.copyFileSync(srcPath, destPath);
  }
}

// ── [1/5] Verify standalone output ───────────────────────────────────────────
console.log('\n[1/5] Verifying Next.js standalone output…');
if (!fs.existsSync(standaloneDir)) {
  console.error('[error] .next/standalone/ not found — run `npm run build` first');
  process.exit(1);
}

// ── [2/5] Overlay custom server into standalone ───────────────────────────────
console.log('\n[2/5] Overlaying custom server files…');

// Replace Next.js's generated server.js with our custom Express + WebSocket server.
fs.copyFileSync(path.join(rootDir, 'server.js'), path.join(standaloneDir, 'server.js'));

// Copy src/server/ — exclude saved/ so the developer's persisted world state,
// approved IPs, and usernames do not ship in the package.
copyDir(
  path.join(rootDir, 'src', 'server'),
  path.join(standaloneDir, 'src', 'server'),
  new Set(['saved'])
);

// Ship blank starter data so users get the right directory structure on first run.
copyDir(
  path.join(rootDir, 'src', 'server', 'saved.example'),
  path.join(standaloneDir, 'src', 'server', 'saved')
);

// ── [3/5] Install server-side dependencies ────────────────────────────────────
console.log('\n[3/5] Installing server-side dependencies into standalone…');

// Next.js standalone traces and copies its own runtime deps. Our custom Express
// server needs additional packages that aren't part of the Next.js dep graph.
const serverDeps = [
  '@auth/core', 'compression', 'cors', 'dotenv',
  'express', 'http-terminator', 'pino', 'ws',
  // Texture extractor
  'sharp', 'unzipper',
];
const missing = serverDeps.filter(name => !pkg.dependencies?.[name]);
if (missing.length) {
  console.error(`[error] Server deps not found in package.json dependencies: ${missing.join(', ')}`);
  process.exit(1);
}

// Write a minimal package.json into the standalone dir so npm resolves the
// right versions, then clean it up once the install is done.
fs.writeFileSync(
  path.join(standaloneDir, 'package.json'),
  JSON.stringify({
    name: 'standalone-server',
    version: '1.0.0',
    private: true,
    dependencies: Object.fromEntries(serverDeps.map(n => [n, pkg.dependencies[n]])),
  }, null, 2)
);
run('npm install --omit=dev --ignore-scripts', { cwd: standaloneDir });
fs.rmSync(path.join(standaloneDir, 'package.json'),      { force: true });
fs.rmSync(path.join(standaloneDir, 'package-lock.json'), { force: true });

// ── [4/5] Copy runtime assets ─────────────────────────────────────────────────
console.log('\n[4/5] Copying runtime assets…');

// Texture extractor — needed so end users can extract textures from their JAR.
copyDir(path.join(rootDir, 'scripts', 'textureExtractor'), path.join(standaloneDir, 'scripts', 'textureExtractor'));

// Lua scripts served to ComputerCraft computers.
if (fs.existsSync(path.join(rootDir, 'computers')))
  copyDir(path.join(rootDir, 'computers'), path.join(standaloneDir, 'computers'));

// Block textures — absent until the user runs build-textures; that's fine.
if (fs.existsSync(path.join(rootDir, 'textures')))
  copyDir(path.join(rootDir, 'textures'), path.join(standaloneDir, 'textures'));

// public/ is already copied into standalone by Next.js — no action needed.

// ── [5/5] Create zip ──────────────────────────────────────────────────────────
console.log('\n[5/5] Creating zip archive…');
fs.mkdirSync(outDir, { recursive: true });

const output  = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('warning', err => { if (err.code !== 'ENOENT') throw err; });
archive.on('error',   err => { throw err; });
archive.pipe(output);

// All standalone content at the zip root (server.js, .next/, node_modules/,
// public/, src/server/, computers/, textures/).
archive.directory(standaloneDir, false);

// Ship a copy of the Node.js binary so the package runs without a system install.
archive.file(process.execPath, { name: `node${nodeExt}` });

// Local mode: binds to 127.0.0.1, no auth — safe for personal use on one machine.
archive.append(
  isWin
    ? `@echo off\r\nset NODE_ENV=production\r\nset APP_LOCAL_ONLY=true\r\n.\\node.exe server.js\r\n`
    : `#!/bin/sh\nNODE_ENV=production APP_LOCAL_ONLY=true ./node server.js\n`,
  { name: isWin ? 'start-local.bat' : 'start-local.sh', mode: isWin ? undefined : 0o755 }
);

// Production mode: binds to all interfaces, auth required — needs .env.local configured.
archive.append(
  isWin
    ? `@echo off\r\nset NODE_ENV=production\r\n.\\node.exe server.js\r\n`
    : `#!/bin/sh\nNODE_ENV=production ./node server.js\n`,
  { name: isWin ? 'start.bat' : 'start.sh', mode: isWin ? undefined : 0o755 }
);

// Texture extractor wrapper — passes all arguments through to server.js.
archive.append(
  isWin
    ? `@echo off\r\n.\\node.exe server.js --build-textures %*\r\n`
    : `#!/bin/sh\n./node server.js --build-textures "$@"\n`,
  { name: isWin ? 'build-textures.bat' : 'build-textures.sh', mode: isWin ? undefined : 0o755 }
);

archive.file(path.join(rootDir, 'README.md'), { name: 'README.md' });
if (fs.existsSync(path.join(rootDir, '.env.local.example')))
  archive.file(path.join(rootDir, '.env.local.example'), { name: '.env.local.example' });

output.on('close', () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(1);
  console.log(`\nPackage ready: packaged/${pkg.name}-v${pkg.version}.zip (${mb} MB)`);
});

archive.finalize();
