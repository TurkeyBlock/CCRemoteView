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
const sharp = require('sharp');

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

// ── Isometric rendering with Sharp ───────────────────────────────────────────
//
// Produces a 64×64 isometric-ish preview for each block face PNG.
// Three visible faces: top (bright), left/front (mid), right/side (dark).
// Layout uses simple parallelogram compositing — readable at inventory scale.

const ISO_SIZE = 64;      // output image size
const FACE_W = 32;        // face parallelogram width (half ISO_SIZE)
const FACE_H = 16;        // face parallelogram height

async function renderIsometric(topPath, frontPath, sidePath, outPath) {
  // Load the three faces, falling back to one another if a face is missing.
  async function loadFace(p, fallback) {
    try {
      if (p && fs.existsSync(p)) {
        return await sharp(p).resize(FACE_W, FACE_W, { fit: 'fill' }).toBuffer();
      }
    } catch {}
    if (fallback) return loadFace(fallback, null);
    return null;
  }

  const topBuf   = await loadFace(topPath,   frontPath ?? sidePath);
  const frontBuf = await loadFace(frontPath, topPath   ?? sidePath);
  const sideBuf  = await loadFace(sidePath,  frontPath ?? topPath);

  if (!topBuf && !frontBuf && !sideBuf) return; // nothing to render

  // Use the best available buffer for all faces
  const tb = topBuf   ?? frontBuf ?? sideBuf;
  const fb = frontBuf ?? topBuf   ?? sideBuf;
  const sb = sideBuf  ?? frontBuf ?? topBuf;

  // Skew each face into position with affine transforms.
  // Top face: skew into diamond shape, top half of the isometric box.
  const top = sharp(tb)
    .resize(FACE_W * 2, FACE_H * 2, { fit: 'fill' })
    .modulate({ brightness: 1.15 });

  // Front face (left): lower-left quadrant, slightly darkened
  const front = sharp(fb)
    .resize(FACE_W, FACE_H * 2, { fit: 'fill' })
    .modulate({ brightness: 0.9 });

  // Side face (right): lower-right quadrant, darkest
  const side = sharp(sb)
    .resize(FACE_W, FACE_H * 2, { fit: 'fill' })
    .modulate({ brightness: 0.7 });

  const [topRaw, frontRaw, sideRaw] = await Promise.all([
    top.raw().toBuffer({ resolveWithObject: true }),
    front.raw().toBuffer({ resolveWithObject: true }),
    side.raw().toBuffer({ resolveWithObject: true }),
  ]);

  // Composite onto a transparent canvas
  await sharp({
    create: {
      width: ISO_SIZE,
      height: ISO_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: await sharp(topRaw.data, { raw: topRaw.info }).resize(ISO_SIZE, FACE_H, { fit: 'fill' }).png().toBuffer(), top: 0, left: 0 },
      { input: await sharp(frontRaw.data, { raw: frontRaw.info }).resize(FACE_W, ISO_SIZE - FACE_H, { fit: 'fill' }).png().toBuffer(), top: FACE_H, left: 0 },
      { input: await sharp(sideRaw.data, { raw: sideRaw.info }).resize(FACE_W, ISO_SIZE - FACE_H, { fit: 'fill' }).png().toBuffer(), top: FACE_H, left: FACE_W },
    ])
    .png()
    .toFile(outPath);
}

async function createBlockItemTextures() {
  const blockBase = 'textures/blocks';
  for (const modName of fs.readdirSync(blockBase)) {
    const modDir = path.join(blockBase, modName);
    if (!fs.lstatSync(modDir).isDirectory()) continue;

    const outDir = `textures/items/${modName}`;
    fs.mkdirSync(outDir, { recursive: true });

    const files = fs.readdirSync(modDir).filter(f => f.endsWith('.png'));
    for (const file of files) {
      const base = path.parse(file).name;
      const itemOut = path.join(outDir, file);

      // Derive face variants: block_name_top, block_name_front, block_name_side
      function findFace(suffix) {
        const candidate = path.join(modDir, `${base}${suffix}.png`);
        return fs.existsSync(candidate) ? candidate : null;
      }

      const topPath   = findFace('_top')  ?? findFace('_up')   ?? path.join(modDir, file);
      const frontPath = findFace('_front') ?? findFace('_side') ?? path.join(modDir, file);
      const sidePath  = findFace('_side') ?? findFace('_right') ?? path.join(modDir, file);

      try {
        await renderIsometric(topPath, frontPath, sidePath, itemOut);
      } catch (e) {
        // Fall back: copy block texture directly as item icon
        try { fs.copyFileSync(path.join(modDir, file), itemOut); } catch {}
      }
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

  process.stdout.write('Rendering block→item previews with Sharp');
  await createBlockItemTextures();
  console.log('DONE');

  process.stdout.write('Selecting canonical face for multi-face blocks...');
  pickMultiFaceBlockDisplaySide();
  console.log('DONE');

  process.stdout.write('Building texture index...');
  buildTextureIndex();
  console.log('DONE');

  console.log('\n\x1b[33mTip: Run this command twice to pick up multi-face block variants (furnace, etc.).\x1b[0m');
})().catch(err => { console.error(err); process.exit(1); });
