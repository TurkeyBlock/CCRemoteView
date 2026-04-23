// Texture extractor — replaces minecraft-blocks-render/canvas with Sharp.
//
// Usage:
//   node build-utils/textureExtractor/textureExtractor.js <mcJarOrZip> [modJarsDir]
//
// Example:
//   node build-utils/textureExtractor/textureExtractor.js "C:/mc/1.20.jar" "C:/mc/mods"

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const unzipper = require('unzipper');

const TECHNIC_BASE = path.join(os.homedir(), 'AppData', 'Roaming', '.technic', 'modpacks', 'tekkit-2');
const DEFAULT_JAR = path.join(TECHNIC_BASE, 'bin', 'minecraft.jar');
const DEFAULT_MODS = path.join(TECHNIC_BASE, 'mods');

const MC_FILE = (process.argv[2] ?? DEFAULT_JAR).replaceAll('\\\\', '/').replaceAll('\\', '/');
const MOD_DIR = (process.argv[3] ?? DEFAULT_MODS).replaceAll('\\\\', '/').replaceAll('\\', '/');

// ── Extraction helpers ────────────────────────────────────────────────────────

function extractTexturesFromJar(fileName) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(fileName)
      .pipe(unzipper.Parse())
      .on('entry', entry => {
        const entryPath = entry.path;
        const m = /assets\/(?<mod>[^/]+)\/textures\/(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(entryPath);
        if (m) {
          const outDir = `textures/${m.groups.type}/${m.groups.mod}`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/${m.groups.f}`));
        } else {
          entry.autodrain();
        }
      })
      .on('finish', resolve)
      .on('error', reject);
  });
}

function extractTexturesFromZip(zipPath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', entry => {
        const entryPath = entry.path;
        let m;

        // assets/mod/textures/blocks/stone.png
        m = /assets\/(?<mod>[^/]+)\/textures\/(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(entryPath);
        if (!m) {
          // textures/blocks/stone.png
          m = /textures\/(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(entryPath);
          if (m) m = { groups: { ...m.groups, mod: 'minecraft' } };
        }
        if (!m) {
          // blocks/stone.png or items/stone.png
          m = /^(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(entryPath);
          if (m) m = { groups: { ...m.groups, mod: 'minecraft' } };
        }

        if (m?.groups.type && m.groups.f) {
          const outDir = `textures/${m.groups.type}/${m.groups.mod}`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/${m.groups.f}`));
        } else {
          entry.autodrain();
        }
      })
      .on('finish', resolve)
      .on('error', reject);
  });
}

function createBlockItemTextures() {
  // For blocks that don't have a dedicated item sprite in the JAR, copy the
  // flat block face texture so inventory shows a simple 2D image.
  // Real item sprites already extracted from the JAR are left untouched.
  const blockBase = 'textures/blocks';
  for (const modName of fs.readdirSync(blockBase)) {
    const modDir = path.join(blockBase, modName);
    if (!fs.lstatSync(modDir).isDirectory()) continue;

    const outDir = `textures/items/${modName}`;
    fs.mkdirSync(outDir, { recursive: true });

    for (const file of fs.readdirSync(modDir).filter(f => f.endsWith('.png'))) {
      const itemOut = path.join(outDir, file);
      if (fs.existsSync(itemOut)) continue; // real item sprite already present
      try { fs.copyFileSync(path.join(modDir, file), itemOut); } catch {}
    }

    process.stdout.write('.');
  }
  process.stdout.write('\n');
}

function pickMultiFaceBlockDisplaySide() {
  const blockBase = 'textures/blocks';
  for (const modName of fs.readdirSync(blockBase)) {
    const modDir = path.join(blockBase, modName);
    if (!fs.lstatSync(modDir).isDirectory()) continue;
    for (const file of fs.readdirSync(modDir)) {
      const filePath = path.join(modDir, file);
      const noSuffix = name => path.join(modDir, name);
      if (file.endsWith('_front.png') && !fs.existsSync(noSuffix(file.replace('_front', ''))))
        fs.copyFileSync(filePath, noSuffix(file.replace('_front', '')));
      else if (file.endsWith('_top.png') && !fs.existsSync(noSuffix(file.replace('_top', ''))))
        fs.copyFileSync(filePath, noSuffix(file.replace('_top', '')));
      else if (file.endsWith('_still.png') && !fs.existsSync(noSuffix(file.replace('_still', ''))))
        fs.copyFileSync(filePath, noSuffix(file.replace('_still', '')));
    }
  }
}

function buildTextureIndex() {
  const index = [];
  function walk(dir, base) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.lstatSync(full).isDirectory()) {
        walk(full, base ? `${base}/${entry}` : entry);
      } else if (entry.endsWith('.png')) {
        index.push(base ? `${base}/${entry}` : entry);
      }
    }
  }
  walk('textures/blocks', '');
  fs.writeFileSync('textures/texture-index.json', JSON.stringify(index));
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  process.stdout.write('Gathering textures from MC jar/zip...');
  if (MC_FILE.endsWith('.jar')) {
    await extractTexturesFromJar(MC_FILE);
  } else {
    await extractTexturesFromZip(MC_FILE);
  }

  if (MOD_DIR) {
    const modJars = fs.readdirSync(MOD_DIR).filter(f => f.endsWith('.jar'));
    for (const fileName of modJars) {
      await extractTexturesFromJar(path.join(MOD_DIR, fileName));
    }
  }
  console.log('DONE');

  process.stdout.write('Copying block→item textures (flat)');
  createBlockItemTextures();
  console.log('DONE');

  process.stdout.write('Selecting canonical face for multi-face blocks...');
  pickMultiFaceBlockDisplaySide();
  console.log('DONE');

  process.stdout.write('Building texture index...');
  buildTextureIndex();
  console.log('DONE');

  console.log('\n\x1b[33mTip: Run this command twice to pick up multi-face block variants (furnace, etc.).\x1b[0m');
})().catch(err => { console.error(err); process.exit(1); });
