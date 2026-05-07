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

const TECHNIC_BASE = path.join(os.homedir(), 'AppData', 'Roaming', '.technic');
const DEFAULT_JAR = path.join(TECHNIC_BASE, 'cache', 'minecraft_1.12.2.jar');
const DEFAULT_MODS = path.join(TECHNIC_BASE, 'modpacks', 'tekkit-2', 'mods');

const MC_FILE = (process.argv[2] ?? DEFAULT_JAR).replaceAll('\\\\', '/').replaceAll('\\', '/');
const MOD_DIR = (process.argv[3] ?? DEFAULT_MODS).replaceAll('\\\\', '/').replaceAll('\\', '/');

// In-memory stores built while streaming JARs. Populated before the mapping phase.
const blockstates = new Map(); // "mod:blockname"      → parsed blockstate JSON
const models      = new Map(); // "mod:block/modelname" → parsed model JSON

// ── Extraction helpers ────────────────────────────────────────────────────────

// Buffers a streaming unzipper entry into memory so small JSON files can be parsed.
function collectEntry(entry) {
  return new Promise((resolve) => {
    const chunks = [];
    entry.on('data', d => chunks.push(d));
    entry.on('end', () => resolve(Buffer.concat(chunks)));
    entry.on('error', () => resolve(null));
  });
}

function extractFromJar(fileName) {
  return new Promise((resolve, reject) => {
    // Track async JSON parses so we don't resolve until all are done.
    const pending = [];

    fs.createReadStream(fileName)
      .pipe(unzipper.Parse())
      .on('entry', entry => {
        const p = entry.path;

        // ── Texture PNG ──────────────────────────────────────────────────────
        // assets/{mod}/textures/{blocks|items}/{any/depth/.../file}.png
        // Subdirectories (e.g. Chisel's blocks/cobblestone/cobblestone1.png) are
        // flattened into the filename with underscores.
        const texMatch = /assets\/(?<mod>[^/]+)\/textures\/(?<type>blocks|items)\/(?<rest>.+\.png)$/.exec(p);
        if (texMatch) {
          const { mod, type, rest } = texMatch.groups;
          const outDir = `textures/${type}/${mod}`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/${rest.replaceAll('/', '_')}`));
          return;
        }

        // ── Sprite-sheet PNGs (IC2 and similar mods) ─────────────────────────
        // assets/{mod}/textures/sprites/{name}.png → textures/blocks/{mod}/sprites_{name}.png
        const spriteMatch = /assets\/(?<mod>[^/]+)\/textures\/sprites\/(?<name>[^/]+\.png)$/.exec(p);
        if (spriteMatch) {
          const { mod, name } = spriteMatch.groups;
          const outDir = `textures/blocks/${mod}`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/sprites_${name}`));
          return;
        }

        // ── Blockstate JSON ──────────────────────────────────────────────────
        // assets/{mod}/blockstates/{blockname}.json
        // Maps block state property combos to model file references.
        const bsMatch = /assets\/(?<mod>[^/]+)\/blockstates\/(?<name>[^/]+)\.json$/.exec(p);
        if (bsMatch) {
          const { mod, name } = bsMatch.groups;
          pending.push(collectEntry(entry).then(buf => {
            if (!buf) return;
            try { blockstates.set(`${mod}:${name}`, JSON.parse(buf.toString())); } catch {}
          }));
          return;
        }

        // ── Block model JSON ─────────────────────────────────────────────────
        // assets/{mod}/models/block/{name}.json
        // Maps texture variable names to actual texture paths.
        const modelMatch = /assets\/(?<mod>[^/]+)\/models\/block\/(?<name>.+)\.json$/.exec(p);
        if (modelMatch) {
          const { mod, name } = modelMatch.groups;
          pending.push(collectEntry(entry).then(buf => {
            if (!buf) return;
            try { models.set(`${mod}:block/${name}`, JSON.parse(buf.toString())); } catch {}
          }));
          return;
        }

        entry.autodrain();
      })
      // Wait for all buffered JSON entries to finish parsing before resolving.
      .on('finish', () => Promise.all(pending).then(resolve, reject))
      .on('error', reject);
  });
}

function extractFromZip(zipPath) {
  return new Promise((resolve, reject) => {
    const pending = [];

    fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', entry => {
        const p = entry.path;
        let m;

        // Try the same asset-namespaced path as JARs first.
        const texMatch = /assets\/(?<mod>[^/]+)\/textures\/(?<type>blocks|items)\/(?<rest>.+\.png)$/.exec(p);
        if (texMatch) {
          const { mod, type, rest } = texMatch.groups;
          const outDir = `textures/${type}/${mod}`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/${rest.replaceAll('/', '_')}`));
          return;
        }

        const spriteMatch = /assets\/(?<mod>[^/]+)\/textures\/sprites\/(?<name>[^/]+\.png)$/.exec(p);
        if (spriteMatch) {
          const { mod, name } = spriteMatch.groups;
          const outDir = `textures/blocks/${mod}`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/sprites_${name}`));
          return;
        }

        // Fallback: bare textures/blocks/stone.png (some vanilla zip layouts).
        m = /textures\/(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(p);
        if (m) {
          const outDir = `textures/${m.groups.type}/minecraft`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/${m.groups.f}`));
          return;
        }

        // Fallback: blocks/stone.png at root.
        m = /^(?<type>blocks|items)\/(?<f>[^/]+\.png)$/.exec(p);
        if (m) {
          const outDir = `textures/${m.groups.type}/minecraft`;
          fs.mkdirSync(outDir, { recursive: true });
          entry.pipe(fs.createWriteStream(`${outDir}/${m.groups.f}`));
          return;
        }

        const bsMatch = /assets\/(?<mod>[^/]+)\/blockstates\/(?<name>[^/]+)\.json$/.exec(p);
        if (bsMatch) {
          const { mod, name } = bsMatch.groups;
          pending.push(collectEntry(entry).then(buf => {
            if (!buf) return;
            try { blockstates.set(`${mod}:${name}`, JSON.parse(buf.toString())); } catch {}
          }));
          return;
        }

        const modelMatch = /assets\/(?<mod>[^/]+)\/models\/block\/(?<name>.+)\.json$/.exec(p);
        if (modelMatch) {
          const { mod, name } = modelMatch.groups;
          pending.push(collectEntry(entry).then(buf => {
            if (!buf) return;
            try { models.set(`${mod}:block/${name}`, JSON.parse(buf.toString())); } catch {}
          }));
          return;
        }

        entry.autodrain();
      })
      .on('finish', () => Promise.all(pending).then(resolve, reject))
      .on('error', reject);
  });
}

function createBlockItemTextures() {
  // For blocks that don't have a dedicated item sprite in the JAR, copy the
  // flat block face texture so inventory shows a simple 2D image.
  // Real item sprites already extracted from the JAR are left untouched.
  const blockBase = 'textures/blocks';
  const mods = fs.readdirSync(blockBase).filter(n => fs.lstatSync(path.join(blockBase, n)).isDirectory());
  mods.forEach((modName, i) => {
    const modDir = path.join(blockBase, modName);
    const outDir = `textures/items/${modName}`;
    fs.mkdirSync(outDir, { recursive: true });

    for (const file of fs.readdirSync(modDir).filter(f => f.endsWith('.png'))) {
      const itemOut = path.join(outDir, file);
      if (fs.existsSync(itemOut)) continue; // real item sprite already present
      try { fs.copyFileSync(path.join(modDir, file), itemOut); } catch {}
    }

    process.stdout.write(`\rCopying block→item textures (flat) ${i + 1}/${mods.length}\x1b[K`);
  });
  process.stdout.write('\n');
}

function pickMultiFaceBlockDisplaySide() {
  const blockBase = 'textures/blocks';
  const mods = fs.readdirSync(blockBase).filter(n => fs.lstatSync(path.join(blockBase, n)).isDirectory());
  mods.forEach((modName, i) => {
    const modDir = path.join(blockBase, modName);
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
    process.stdout.write(`\rSelecting canonical face for multi-face blocks ${i + 1}/${mods.length}\x1b[K`);
  });
  process.stdout.write('\n');
}


// ── Block → texture + geometry mapping ───────────────────────────────────────

// Converts a texture reference from a model JSON to the path we write on disk.
// Model refs look like "blocks/stone", "minecraft:blocks/stone", or
// "chisel:blocks/cobblestone/cobblestone1". The output matches the flat filenames
// produced during extraction: "blocks/{mod}/{underscored_subpath}.png".
function normalizeTexRef(texRef, defaultMod = 'minecraft') {
  let mod = defaultMod;
  let ref = texRef;
  if (ref.includes(':')) [mod, ref] = ref.split(':', 2);

  // ref is like "blocks/stone" or "blocks/cobblestone/cobblestone1"
  const slash = ref.indexOf('/');
  if (slash === -1) return null;
  const type = ref.slice(0, slash);           // "blocks" or "items"
  const rest = ref.slice(slash + 1);          // everything after the type dir
  return `${type}/${mod}/${rest.replaceAll('/', '_')}.png`;
}

// Walks a model's texture declarations, following #variable references and
// ascending the parent chain, until a concrete texture path is found.
// modelKey format: "mod:block/name" (matches how we stored them during extraction).
// texVars accumulates texture variable values as we descend from child → parent,
// so a child's concrete values are available when resolving a parent's #variables.
function resolveModelTexture(modelKey, texVars = {}, visited = new Set()) {
  if (visited.has(modelKey)) return null;
  visited.add(modelKey);

  const model = models.get(modelKey);
  if (!model) return null;

  // Child texture declarations override parent ones — merge child on top.
  const localVars = { ...texVars, ...(model.textures || {}) };

  // Dereference a #variable chain until we reach a concrete path or give up.
  function resolveVar(val, depth = 0) {
    if (!val || depth > 8) return null;
    if (val.startsWith('#')) return resolveVar(localVars[val.slice(1)], depth + 1);
    return val;
  }

  // Prefer textures that represent a visible face over utility/particle slots.
  const priority = ['all', 'top', 'front', 'texture', 'side', 'bottom', 'inner', 'outer'];
  for (const key of priority) {
    const v = resolveVar(localVars[key]);
    if (v) return v;
  }
  for (const [k, v] of Object.entries(localVars)) {
    if (k === 'particle') continue;
    const resolved = resolveVar(v);
    if (resolved) return resolved;
  }
  const particleResolved = resolveVar(localVars.particle);
  if (particleResolved) return particleResolved;

  // No texture found in this model — climb to the parent and try again.
  if (model.parent) {
    let parentKey = model.parent;
    if (!parentKey.includes(':')) parentKey = `minecraft:${parentKey}`;
    const [pMod, pPath] = parentKey.split(':', 2);
    // Blockstate model refs omit the "block/" segment; add it if missing.
    const normalizedParentKey = (pPath.startsWith('block/') || pPath.startsWith('item/') || pPath.startsWith('builtin/'))
      ? parentKey
      : `${pMod}:block/${pPath}`;
    return resolveModelTexture(normalizedParentKey, localVars, visited);
  }

  return null;
}

// Maps model key path segments to geometry type strings.
// Checked bottom-up through the parent chain; first match wins.
// No word boundaries — model names use underscores (e.g. half_slab, tinted_cross)
// which are word characters and would silently block \b matches.
const GEOMETRY_PATTERNS = [
  [/builtin\/(water|lava)/,  'liquid'],
  [/builtin\/entity/,        'entity'],
  [/stair/,                  'stairs'],
  [/slab/,                   'slab'],
  [/cross|torch/,            'cross'],
  [/carpet|rail/,            'flat'],
  [/fence/,                  'fence'],
  [/pane/,                   'pane'],
  [/glass/,                  'glass'],
  [/leaves/,                 'leaves'],
  [/double.*slab/,           'cube'],         // double slabs fill a full block — before /slab/
  [/slab_top/,               'slab_top'],    // more specific — must come before /slab/
  [/slab/,                   'slab_bottom'],
  [/cube|orientable/,        'cube'],
];

// Fallback geometry classification by block registry name, for blocks whose model
// parent chain doesn't contain a recognizable geometry keyword (e.g. reeds defines
// its cross geometry inline without inheriting from minecraft:block/cross).
const CROSS_BY_NAME  = /reeds|tallgrass|double_plant|dead.*bush|(?:^|_)fern|flower|sapling|mushroom|crop|wheat|carrot|potato|beetroot|nether_wart|waterlily|vine|cobweb|torch|fire/;
const FLAT_BY_NAME   = /snow_layer|lily_pad/;

// Returns the geometry type for a model key by checking the key path against
// known parent model name patterns, without loading the model itself.
function classifyGeometry(modelKey) {
  const path = modelKey.includes(':') ? modelKey.split(':')[1] : modelKey;
  for (const [pattern, type] of GEOMETRY_PATTERNS) {
    if (pattern.test(path)) return type;
  }
  return null;
}

// Walks the parent chain of a model upward until it finds a key whose name
// matches a known geometry pattern. Falls back to "cube" if none matches.
function resolveGeometry(modelKey, visited = new Set()) {
  if (visited.has(modelKey)) return null;
  visited.add(modelKey);

  const geo = classifyGeometry(modelKey);
  if (geo) return geo;

  const model = models.get(modelKey);
  if (!model?.parent) return null;

  let parentKey = model.parent;
  if (!parentKey.includes(':')) parentKey = `minecraft:${parentKey}`;
  const [pMod, pPath] = parentKey.split(':', 2);
  const normalizedParentKey = (pPath.startsWith('block/') || pPath.startsWith('item/') || pPath.startsWith('builtin/'))
    ? parentKey
    : `${pMod}:block/${pPath}`;

  return resolveGeometry(normalizedParentKey, visited);
}

// Walks a model's element list (ascending the parent chain if the leaf model
// defines none) and returns the UV [u1, v1, u2, v2] from the first face that
// carries an explicit UV that isn't the full-texture default [0, 0, 16, 16].
// Returns null when no non-trivial UV is found (i.e. use the full texture).
function resolveModelElementUV(modelKey, visited = new Set()) {
  if (visited.has(modelKey)) return null;
  visited.add(modelKey);

  const model = models.get(modelKey);
  if (!model) return null;

  if (model.elements && model.elements.length > 0) {
    for (const element of model.elements) {
      const faces = element.faces || {};
      for (const faceName of ['up', 'north', 'south', 'east', 'west', 'down']) {
        const face = faces[faceName];
        if (!face?.uv) continue;
        const [u1, v1, u2, v2] = face.uv;
        if (u1 === 0 && v1 === 0 && u2 === 16 && v2 === 16) return null;
        return face.uv;
      }
    }
    return null; // elements exist but all faces use auto/default UV
  }

  if (!model.parent) return null;
  let parentKey = model.parent;
  if (!parentKey.includes(':')) parentKey = `minecraft:${parentKey}`;
  const [pMod, pPath] = parentKey.split(':', 2);
  const normalizedParentKey = (pPath.startsWith('block/') || pPath.startsWith('item/') || pPath.startsWith('builtin/'))
    ? parentKey
    : `${pMod}:block/${pPath}`;
  return resolveModelElementUV(normalizedParentKey, visited);
}

// Manual UV overrides for blocks where the auto-detected UV from model elements
// is wrong or absent. Coordinates are PIXEL offsets into the PNG, matching the
// actual image dimensions (same convention as uvOverrides in store/blockMaps.ts).
// Use this when a sprite-sheet texture is mis-detected or uses an odd layout.
const UV_OVERRIDES = {
  // Example — railcraft:infernal 6-tile horizontal sheet (96×16):
  // 'railcraft:infernal:1': [16, 0, 32, 16],
};

// Iterates every blockstate we collected and resolves each variant's display
// texture and geometry, returning a map keyed by "mod:blockname:meta" (meta = variant index).
// For simple single-property blocks the variant order matches metadata 0..N.
// Complex multi-property blocks (stairs, slabs) use the same sequential heuristic,
// which may not match every metadata value exactly for those edge cases.
function buildNameTextureMap() {
  const result = {};
  const entries = [...blockstates.entries()];

  for (const [i, [blockKey, bsData]] of entries.entries()) {
    process.stdout.write(`\rResolving block textures ${i + 1}/${entries.length}\x1b[K`);
    const [mod] = blockKey.split(':');

    if (bsData.variants) {
      // Each key in variants is a property combo like "variant=stone" or "normal".
      // We assign metadata values 0, 1, 2... in the order the keys appear.
      // Forge blockstate format (forge_marker: 1) may store the model in bsData.defaults
      // and/or inline textures per-variant rather than a separate model JSON file.
      const defaults = bsData.defaults || {};
      Object.entries(bsData.variants).forEach(([, variantData], meta) => {
        // Variants can be a single object or a weighted-random array; take the first.
        const entry = Array.isArray(variantData) ? variantData[0] : variantData;

        // Fall back to defaults.model when the variant has no model of its own.
        const rawModelRef = entry?.model || defaults.model;
        if (!rawModelRef) return;

        // Blockstate model refs use "mod:name" without "block/"; normalize to our key format.
        let modelRef = rawModelRef.includes(':') ? rawModelRef : `minecraft:${rawModelRef}`;
        const [mMod, mPath] = modelRef.split(':', 2);
        const modelKey = mPath.startsWith('block/') ? modelRef : `${mMod}:block/${mPath}`;

        // Inline textures from defaults and variant entry (variant takes priority).
        // Passed as texVars so resolveModelTexture can resolve #variable references against them.
        const inlineTexVars = { ...(defaults.textures || {}), ...(entry?.textures || {}) };

        const texRef = resolveModelTexture(modelKey, inlineTexVars);
        const blockName = blockKey.split(':')[1];
        const geometry = resolveGeometry(modelKey)
          ?? (CROSS_BY_NAME.test(blockName) ? 'cross' : null)
          ?? (FLAT_BY_NAME.test(blockName)  ? 'flat'  : null)
          ?? 'cube';
        const normalized = texRef ? normalizeTexRef(texRef, mod) : null;
        if (normalized) {
          result[`${blockKey}:${meta}`] = { texture: normalized, geometry };
        }
      });

    } else if (bsData.multipart) {
      // Multipart blockstates (fences, walls, etc.) don't map cleanly to metadata.
      // Store just the first part's texture under meta 0 as a canonical stand-in.
      const firstApply = bsData.multipart[0]?.apply;
      const entry = Array.isArray(firstApply) ? firstApply[0] : firstApply;
      if (!entry?.model) continue;

      let modelRef = entry.model.includes(':') ? entry.model : `minecraft:${entry.model}`;
      const [mMod, mPath] = modelRef.split(':', 2);
      const modelKey = mPath.startsWith('block/') ? modelRef : `${mMod}:block/${mPath}`;

      const texRef = resolveModelTexture(modelKey);
      const blockName = blockKey.split(':')[1];
      const geometry = resolveGeometry(modelKey)
        ?? (CROSS_BY_NAME.test(blockName) ? 'cross' : null)
        ?? (FLAT_BY_NAME.test(blockName)  ? 'flat'  : null)
        ?? 'cube';
      const normalized = texRef ? normalizeTexRef(texRef, mod) : null;
      if (normalized) {
        result[`${blockKey}:0`] = { texture: normalized, geometry };
      }
    }
  }

  process.stdout.write('\n');
  return result;
}

// ── Legacy 1.12 block name aliases ───────────────────────────────────────────
// The 1.12.2 JAR's blockstate files use 1.13-style per-species names
// (e.g. birch_log.json) even though the game registry and turtle reports use
// old metadata-based names (minecraft:log metadata 2 = birch). This table maps
// 1.12 block:meta IDs to the 1.13 block names that the extractor already keyed,
// so the browser can find textures using the names turtles actually report.
//
// Applied via snapshot: all lookups read the original extractor output before
// any entry is overwritten. This handles the minecraft:grass collision —
// grass block in 1.12, short-grass plant in 1.13 — correctly:
//   tallgrass:1 → reads snapshot['minecraft:grass:0'] = short-grass texture ✓
//   grass:0     → overwritten with grass_block texture for 1.12 lookups   ✓

const DYE_NAMES_1_12 = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime',
  'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue',
  'brown', 'green', 'red', 'black',
];

// All 16 metadata values alias to the white/base 1.13 variant; blockTint in
// blockMaps.ts multiplies in the correct colour, avoiding double-tinting.
function dyedToBase(block1_12, base1_13) {
  return Object.fromEntries(
    DYE_NAMES_1_12.map((_, i) => [`minecraft:${block1_12}:${i}`, `minecraft:${base1_13}`])
  );
}

// Low bits of metadata select the type; higher bits are flags (log axis, leaves
// decay). typeMask isolates the type bits; types1_13 maps index → 1.13 name.
function metaTyped(block1_12, types1_13, typeMask) {
  const out = {};
  for (let meta = 0; meta < 16; meta++) {
    const idx = meta & typeMask;
    if (idx < types1_13.length) out[`minecraft:${block1_12}:${meta}`] = `minecraft:${types1_13[idx]}`;
  }
  return out;
}

const LEGACY_1_12_ALIASES = {
  // Logs: bits 0-1 = wood type, bits 2-3 = axis (texture identical across axes)
  ...metaTyped('log',  ['oak_log','spruce_log','birch_log','jungle_log'], 0b0011),
  ...metaTyped('log2', ['acacia_log','dark_oak_log'],                     0b0001),

  // Planks
  'minecraft:planks:0': 'minecraft:oak_planks',
  'minecraft:planks:1': 'minecraft:spruce_planks',
  'minecraft:planks:2': 'minecraft:birch_planks',
  'minecraft:planks:3': 'minecraft:jungle_planks',
  'minecraft:planks:4': 'minecraft:acacia_planks',
  'minecraft:planks:5': 'minecraft:dark_oak_planks',

  // Leaves: bits 0-1 = type, bits 2-3 = decay flags
  ...metaTyped('leaves',  ['oak_leaves','spruce_leaves','birch_leaves','jungle_leaves'], 0b0011),
  ...metaTyped('leaves2', ['acacia_leaves','dark_oak_leaves'],                           0b0001),

  // Stone variants
  'minecraft:stone:0': 'minecraft:stone',
  'minecraft:stone:1': 'minecraft:granite',
  'minecraft:stone:2': 'minecraft:polished_granite',
  'minecraft:stone:3': 'minecraft:diorite',
  'minecraft:stone:4': 'minecraft:polished_diorite',
  'minecraft:stone:5': 'minecraft:andesite',
  'minecraft:stone:6': 'minecraft:polished_andesite',

  // Grass block (1.12 minecraft:grass = dirt+grass block; 1.13 renamed to grass_block)
  'minecraft:grass:0': 'minecraft:grass_block',

  // Dirt
  'minecraft:dirt:0': 'minecraft:dirt',
  'minecraft:dirt:1': 'minecraft:coarse_dirt',
  'minecraft:dirt:2': 'minecraft:podzol',

  // Sand
  'minecraft:sand:0': 'minecraft:sand',
  'minecraft:sand:1': 'minecraft:red_sand',

  // Sandstone
  'minecraft:sandstone:0': 'minecraft:sandstone',
  'minecraft:sandstone:1': 'minecraft:chiseled_sandstone',
  'minecraft:sandstone:2': 'minecraft:cut_sandstone',
  'minecraft:red_sandstone:0': 'minecraft:red_sandstone',
  'minecraft:red_sandstone:1': 'minecraft:chiseled_red_sandstone',
  'minecraft:red_sandstone:2': 'minecraft:cut_red_sandstone',

  // Stone bricks (1.12 block name: stonebrick)
  'minecraft:stonebrick:0': 'minecraft:stone_bricks',
  'minecraft:stonebrick:1': 'minecraft:mossy_stone_bricks',
  'minecraft:stonebrick:2': 'minecraft:cracked_stone_bricks',
  'minecraft:stonebrick:3': 'minecraft:chiseled_stone_bricks',

  // Saplings
  'minecraft:sapling:0': 'minecraft:oak_sapling',
  'minecraft:sapling:1': 'minecraft:spruce_sapling',
  'minecraft:sapling:2': 'minecraft:birch_sapling',
  'minecraft:sapling:3': 'minecraft:jungle_sapling',
  'minecraft:sapling:4': 'minecraft:acacia_sapling',
  'minecraft:sapling:5': 'minecraft:dark_oak_sapling',

  // Flowers
  'minecraft:yellow_flower:0': 'minecraft:dandelion',
  'minecraft:red_flower:0':    'minecraft:poppy',
  'minecraft:red_flower:1':    'minecraft:blue_orchid',
  'minecraft:red_flower:2':    'minecraft:allium',
  'minecraft:red_flower:3':    'minecraft:azure_bluet',
  'minecraft:red_flower:4':    'minecraft:red_tulip',
  'minecraft:red_flower:5':    'minecraft:orange_tulip',
  'minecraft:red_flower:6':    'minecraft:white_tulip',
  'minecraft:red_flower:7':    'minecraft:pink_tulip',
  'minecraft:red_flower:8':    'minecraft:oxeye_daisy',

  // Tall grass (1.12 tallgrass). tallgrass:1 → 'grass' reads the snapshot
  // value (short-grass plant), not the overwritten grass-block value.
  'minecraft:tallgrass:0': 'minecraft:dead_bush',
  'minecraft:tallgrass:1': 'minecraft:grass',
  'minecraft:tallgrass:2': 'minecraft:fern',

  // Double plants
  'minecraft:double_plant:0': 'minecraft:sunflower',
  'minecraft:double_plant:1': 'minecraft:lilac',
  'minecraft:double_plant:2': 'minecraft:tall_grass',
  'minecraft:double_plant:3': 'minecraft:large_fern',
  'minecraft:double_plant:4': 'minecraft:rose_bush',
  'minecraft:double_plant:5': 'minecraft:peony',

  // Quartz block variants
  'minecraft:quartz_block:0': 'minecraft:quartz_block',
  'minecraft:quartz_block:1': 'minecraft:chiseled_quartz_block',
  'minecraft:quartz_block:2': 'minecraft:quartz_pillar',
  'minecraft:quartz_block:3': 'minecraft:quartz_pillar',
  'minecraft:quartz_block:4': 'minecraft:quartz_pillar',

  // Prismarine
  'minecraft:prismarine:0': 'minecraft:prismarine',
  'minecraft:prismarine:1': 'minecraft:prismarine_bricks',
  'minecraft:prismarine:2': 'minecraft:dark_prismarine',

  // Sponge
  'minecraft:sponge:0': 'minecraft:sponge',
  'minecraft:sponge:1': 'minecraft:wet_sponge',

  // Dyed blocks: all metadata → white/base variant; blockTint handles colour
  ...dyedToBase('wool',                  'white_wool'),
  ...dyedToBase('carpet',                'white_carpet'),
  ...dyedToBase('stained_glass',         'white_stained_glass'),
  ...dyedToBase('stained_glass_pane',    'white_stained_glass_pane'),
  ...dyedToBase('stained_hardened_clay', 'white_terracotta'),
  'minecraft:hardened_clay:0':           'minecraft:terracotta',
  ...dyedToBase('concrete',              'white_concrete'),
  ...dyedToBase('concrete_powder',       'white_concrete_powder'),

  // Stone slabs: meta 0-7 lower half, 8-15 upper half — same texture per type
  'minecraft:stone_slab:0':  'minecraft:smooth_stone_slab',
  'minecraft:stone_slab:1':  'minecraft:sandstone_slab',
  'minecraft:stone_slab:3':  'minecraft:cobblestone_slab',
  'minecraft:stone_slab:4':  'minecraft:brick_slab',
  'minecraft:stone_slab:5':  'minecraft:stone_brick_slab',
  'minecraft:stone_slab:6':  'minecraft:nether_brick_slab',
  'minecraft:stone_slab:7':  'minecraft:quartz_slab',
  'minecraft:stone_slab:8':  'minecraft:smooth_stone_slab',
  'minecraft:stone_slab:9':  'minecraft:sandstone_slab',
  'minecraft:stone_slab:11': 'minecraft:cobblestone_slab',
  'minecraft:stone_slab:12': 'minecraft:brick_slab',
  'minecraft:stone_slab:13': 'minecraft:stone_brick_slab',
  'minecraft:stone_slab:14': 'minecraft:nether_brick_slab',
  'minecraft:stone_slab:15': 'minecraft:quartz_slab',

  // Wooden slabs: meta 0-5 lower, 8-13 upper
  'minecraft:wooden_slab:0':  'minecraft:oak_slab',
  'minecraft:wooden_slab:1':  'minecraft:spruce_slab',
  'minecraft:wooden_slab:2':  'minecraft:birch_slab',
  'minecraft:wooden_slab:3':  'minecraft:jungle_slab',
  'minecraft:wooden_slab:4':  'minecraft:acacia_slab',
  'minecraft:wooden_slab:5':  'minecraft:dark_oak_slab',
  'minecraft:wooden_slab:8':  'minecraft:oak_slab',
  'minecraft:wooden_slab:9':  'minecraft:spruce_slab',
  'minecraft:wooden_slab:10': 'minecraft:birch_slab',
  'minecraft:wooden_slab:11': 'minecraft:jungle_slab',
  'minecraft:wooden_slab:12': 'minecraft:acacia_slab',
  'minecraft:wooden_slab:13': 'minecraft:dark_oak_slab',

  // Double slabs (1.12 only — 1.13 unified these into the slab block)
  'minecraft:double_stone_slab:0': 'minecraft:smooth_stone_slab',
  'minecraft:double_stone_slab:1': 'minecraft:sandstone_slab',
  'minecraft:double_stone_slab:3': 'minecraft:cobblestone_slab',
  'minecraft:double_stone_slab:4': 'minecraft:brick_slab',
  'minecraft:double_stone_slab:5': 'minecraft:stone_brick_slab',
  'minecraft:double_stone_slab:6': 'minecraft:nether_brick_slab',
  'minecraft:double_stone_slab:7': 'minecraft:quartz_slab',
  'minecraft:double_wooden_slab:0': 'minecraft:oak_slab',
  'minecraft:double_wooden_slab:1': 'minecraft:spruce_slab',
  'minecraft:double_wooden_slab:2': 'minecraft:birch_slab',
  'minecraft:double_wooden_slab:3': 'minecraft:jungle_slab',
  'minecraft:double_wooden_slab:4': 'minecraft:acacia_slab',
  'minecraft:double_wooden_slab:5': 'minecraft:dark_oak_slab',
};

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  process.stdout.write('Clearing existing texture output...');
  for (const dir of ['textures/blocks', 'textures/items']) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync('textures/block-name-map.json')) fs.rmSync('textures/block-name-map.json');
  console.log('DONE');

  const modJars = MOD_DIR ? fs.readdirSync(MOD_DIR).filter(f => f.endsWith('.jar')) : [];
  const allJars = [MC_FILE, ...modJars.map(f => path.join(MOD_DIR, f))];
  for (const [i, jar] of allJars.entries()) {
    process.stdout.write(`\rGathering textures, blockstates, and models ${i + 1}/${allJars.length} (${path.basename(jar)})\x1b[K`);
    if (jar === MC_FILE && !MC_FILE.endsWith('.jar')) {
      await extractFromZip(jar);
    } else {
      await extractFromJar(jar);
    }
  }
  process.stdout.write('\n');

  createBlockItemTextures();

  pickMultiFaceBlockDisplaySide();

const nameTextureMap = buildNameTextureMap();

  // Apply legacy 1.12 name aliases. Snapshot first so collision entries
  // (minecraft:grass = grass block in 1.12, short-grass plant in 1.13) resolve
  // correctly: each alias reads the original extractor output, then all results
  // are merged — overwriting as needed.
  const aliasSnapshot = { ...nameTextureMap };
  let aliasCount = 0;
  for (const [legacyKey, newBlock] of Object.entries(LEGACY_1_12_ALIASES)) {
    const sourceKey = `${newBlock}:0`;
    if (aliasSnapshot[sourceKey]) {
      // Skip aliases that would overwrite a cross-shaped block with a cube entry.
      // Happens with tallgrass:1 → minecraft:grass when running against a 1.12 JAR,
      // where minecraft:grass is the solid grass block (cube) rather than the plant (cross).
      const resolved = aliasSnapshot[sourceKey];
      const blockName = legacyKey.includes(':') ? legacyKey.split(':')[1] : legacyKey;
      const shouldBeCross = CROSS_BY_NAME.test(blockName);
      if (shouldBeCross && resolved.geometry !== 'cross') continue;
      nameTextureMap[legacyKey] = resolved;
      aliasCount++;
    }
  }
  console.log(`${aliasCount} legacy 1.12 block name aliases applied`);

  // Apply manual UV overrides — highest priority, wins over both extraction and aliases.
  for (const [key, uv] of Object.entries(UV_OVERRIDES)) {
    if (nameTextureMap[key]) nameTextureMap[key] = { ...nameTextureMap[key], uv };
    else console.warn(`UV_OVERRIDES: no map entry for '${key}' — check the key spelling`);
  }

  fs.mkdirSync('textures', { recursive: true });
  fs.writeFileSync('textures/block-name-map.json', JSON.stringify(nameTextureMap, null, 2));
  console.log(`${Object.keys(nameTextureMap).length} entries → textures/block-name-map.json`);

})().catch(err => { console.error(err); process.exit(1); });
