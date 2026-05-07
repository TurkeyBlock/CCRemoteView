// Node.js SEA (Single Executable Application) builder.
// Replaces the old pkg workflow.
//
// Prerequisites (installed automatically via npx):
//   @vercel/ncc  — bundles server.js + deps into one CJS file
//   postject     — injects the SEA blob into the node binary
//
// Usage: npm run pkg
//   (which runs: npm run build && node scripts/buildSea.js)

'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const pkg = require('../package.json');
const platform = process.platform;
const ext = platform === 'win32' ? '.exe' : '';
const binaryName = `${pkg.name}${ext}`;
const outDir = path.resolve(__dirname, '..', 'packaged');
const binaryPath = path.join(outDir, binaryName);
const zipPath = path.join(outDir, `${pkg.name}-v${pkg.version}.zip`);
const bundleDir = path.resolve(__dirname, '..', 'sea-bundle');
const seaConfigPath = path.resolve(__dirname, '..', 'sea-config.json');
const blobPath = path.resolve(__dirname, '..', 'sea-prep.blob');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: path.resolve(__dirname, '..'), ...opts });
}

// ── Step 1: Bundle server.js with ncc ────────────────────────────────────────
console.log('\n[1/5] Bundling server.js with @vercel/ncc…');
fs.rmSync(bundleDir, { recursive: true, force: true });
run(`npx --yes @vercel/ncc build server.js -o sea-bundle --no-cache`);

// ── Step 2: Write sea-config.json ────────────────────────────────────────────
console.log('\n[2/5] Writing sea-config.json…');
const seaConfig = {
  main: 'sea-bundle/index.js',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
};
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

// ── Step 3: Generate SEA blob ─────────────────────────────────────────────────
console.log('\n[3/5] Generating SEA blob (node --experimental-sea-config)…');
run('node --experimental-sea-config sea-config.json');

// ── Step 4: Copy node binary and inject blob ──────────────────────────────────
console.log('\n[4/5] Injecting blob into node binary…');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(process.execPath, binaryPath);

// Remove codesign on macOS so postject can modify the binary
if (platform === 'darwin') {
  try { execSync(`codesign --remove-signature "${binaryPath}"`, { stdio: 'pipe' }); } catch {}
}
// On Windows, signtool.exe can remove the signature; silently skip if unavailable
if (platform === 'win32') {
  try { execSync(`signtool remove /s "${binaryPath}"`, { stdio: 'pipe' }); } catch {}
}

run(
  `npx --yes postject "${binaryPath}" NODE_SEA_BLOB "${blobPath}" ` +
  `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` +
  (platform === 'darwin' ? ' --macho-segment-name NODE_SEA' : '')
);

// Re-sign on macOS
if (platform === 'darwin') {
  try { execSync(`codesign --sign - "${binaryPath}"`, { stdio: 'pipe' }); } catch {}
}

// ── Step 5: Zip runtime assets ────────────────────────────────────────────────
console.log('\n[5/5] Creating zip archive…');
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.on('warning', err => { if (err.code !== 'ENOENT') throw err; });
archive.on('error', err => { throw err; });
archive.pipe(output);

// The SEA binary
archive.file(binaryPath, { name: binaryName });

// Next.js build output (required at runtime — SEA contains only the server bootstrap)
archive.directory('.next', '.next');

// Static assets served by Express
if (fs.existsSync('textures')) archive.directory('textures', 'textures');
if (fs.existsSync('computers')) archive.directory('computers', 'computers');
if (fs.existsSync('public')) archive.directory('public', 'public');

// Saved world + server data
if (fs.existsSync('src/server/saved')) archive.directory('src/server/saved', 'src/server/saved');
if (fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true });
archive.directory('logs', 'logs');

// Start script so the user can also launch with node if preferred
const startScript = platform === 'win32' ? 'start.bat' : 'start.sh';
const startContent = platform === 'win32'
  ? `@echo off\r\n.\\${binaryName}\r\n`
  : `#!/bin/sh\n./${binaryName}\n`;
archive.append(startContent, { name: startScript, mode: platform !== 'win32' ? 0o755 : undefined });

output.on('close', () => {
  console.log(`\nPackage ready: packaged/${pkg.name}-v${pkg.version}.zip (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB)`);
  // Cleanup intermediates
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.rmSync(seaConfigPath, { force: true });
  fs.rmSync(blobPath, { force: true });
});

archive.finalize();
