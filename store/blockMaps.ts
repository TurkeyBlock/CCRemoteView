// ─── Block Tint ──────────────────────────────────────────────────────────────
// Maps block IDs (or names) to a hex colour multiplier applied to the material.
// A white base texture (e.g. wool_colored_white) will render as exactly this colour.

export const BIOME_TINT = 0x88C149;

// Minecraft's 16 dye colours in metadata order (0 = White … 15 = Black).
// Use dyedBlock() to expand any metadata-dyed block into its 16 tint entries.
export const MC_DYE_COLORS: readonly [string, number][] = [
  ["White",      0xFFFFFF],
  ["Orange",     0xD87F33],
  ["Magenta",    0xB24CD8],
  ["Light Blue", 0x6699D8],
  ["Yellow",     0xE5E533],
  ["Lime",       0x7FCC19],
  ["Pink",       0xF27FA5],
  ["Gray",       0x4C4C4C],
  ["Light Gray", 0x999999],
  ["Cyan",       0x4C7F99],
  ["Purple",     0x7F3FB2],
  ["Blue",       0x334CB2],
  ["Brown",      0x664C33],
  ["Green",      0x667F33],
  ["Red",        0x993333],
  ["Black",      0x191919],
];

/** Generates blockTint entries for all 16 dye metadata values of a block. */
function dyedBlock(block: string): { [id: string]: number } {
  return Object.fromEntries(
    MC_DYE_COLORS.map(([, color], i) => [`${block}:${i}`, color])
  );
}

export const blockTint: { [id: string]: number } = {
  "minecraft:water":                        0x1e97f2,
  "minecraft:grass":                        BIOME_TINT,
  "grass":                                  BIOME_TINT,
  "minecraft:tall_grass":                   BIOME_TINT,
  "minecraft:grass_block":                  BIOME_TINT,
  "minecraft:acacia_leaves":                BIOME_TINT,
  "minecraft:birch_leaves":                 0x80a755,
  "minecraft:dark_oak_leaves":              BIOME_TINT,
  "minecraft:jungle_leaves":                BIOME_TINT,
  "minecraft:oak_leaves":                   BIOME_TINT,
  "minecraft:spruce_leaves":                0x619961,
  "minecraft:fern":                         BIOME_TINT,
  "minecraft:large_fern":                   BIOME_TINT,
  "minecraft:vine":                         BIOME_TINT,
  "minecraft:lily_pad":                     BIOME_TINT,
  "biomesoplenty:bush":                     BIOME_TINT,
  "biomesoplenty:clover":                   BIOME_TINT,
  "biomesoplenty:sprout":                   BIOME_TINT,
  "biomesoplenty:flowering_oak_leaves":     BIOME_TINT,
  "biomesoplenty:mahogany_leaves":          BIOME_TINT,
  "biomesoplenty:willow_leaves":            BIOME_TINT,
  "biomesoplenty:willow_vine":              BIOME_TINT,
  "minecraft:leaves2":                      BIOME_TINT,

  // Metadata-dyed blocks (e.g. wool, stained glass) are tinted according to their dye colour:
  ...dyedBlock("minecraft:concrete_powder"),
  ...dyedBlock("minecraft:concrete"),
  ...dyedBlock("minecraft:stained_hardened_clay"),
  ...dyedBlock("minecraft:wool"),
  ...dyedBlock("minecraft:carpet"),
  ...dyedBlock("minecraft:stained_glass"),
  ...dyedBlock("minecraft:stained_glass_pane"),
  ...dyedBlock("minecraft:dye"),
};

// ─── Geometry Map ────────────────────────────────────────────────────────────
// Maps block IDs to their render geometry type.
// Manual geometry overrides — only needed when the auto-generated map gets it wrong.
// These take priority over block-name-map.json.
const cross: string[] = [
  // "quark:root",
  // tallgrass:1 and :2 are grass plants (cross), but the alias system in the extractor
  // can misclassify them as cube when run against a 1.12 JAR (where minecraft:grass = solid block).
  "minecraft:tallgrass:1",
  "minecraft:tallgrass:2",
];

const flat: string[] = [
  // "minecraft:snow_layer",
];

const slab_bottom: string[] = [
  // "minecraft:stone_slab",
];

export const geometryMap: { [blockId: string]: string } = {
  ...Object.fromEntries(cross.map(id => [id, "cross"])),
  ...Object.fromEntries(flat.map(id => [id, "flat"])),
  ...Object.fromEntries(slab_bottom.map(id => [id, "slab_bottom"])),
  "chisel:ironpane": "pane",
};

// ─── Non-occluding blocks ─────────────────────────────────────────────────────
// Full-cube blocks that are transparent or semi-transparent and therefore must
// NOT hide the faces of adjacent blocks.
//
// Pattern-matched so modded variants (e.g. "botania:mana_glass") are covered
// automatically.  Add explicit names at the bottom for one-offs.

const NON_OCCLUDING_PATTERNS: readonly string[] = [
  "glass",    // minecraft:glass, stained_glass, glass_pane, tinted_glass, …
  "leaves",   // minecraft:leaves, oak_leaves, birch_leaves, …
  "water",    // minecraft:water, flowing_water
  "ice",      // minecraft:ice, packed_ice, blue_ice, frosted_ice
];

const NON_OCCLUDING_EXACT = new Set<string>([
  "minecraft:slime",
  "minecraft:beacon",
  "minecraft:end_portal",
  "minecraft:end_gateway",
  "chisel:ironpane",
]);

/**
 * Returns true if this block is full-cube shaped but should not occlude
 * the faces of neighbouring blocks (i.e. it is transparent or semi-transparent).
 */
export function isNonOccluding(blockName: string): boolean {
  if (NON_OCCLUDING_EXACT.has(blockName)) return true;
  for (const pat of NON_OCCLUDING_PATTERNS) {
    if (blockName.includes(pat)) return true;
  }
  return false;
}

export function isLiquid(blockName: string): boolean {
  return blockName.includes('water') || blockName.includes('lava');
}

// ─── Texture Aliases ─────────────────────────────────────────────────────────
// Maps block IDs (or "name:metadata" keys) to their texture file path
// (relative to the blocks/ folder, without .png extension).

// Manual UV overrides for blocks whose auto-extracted UV is wrong or missing.
// Coordinates are PIXEL offsets into the PNG (same units as the image dimensions).
// For a 6-tile horizontal sprite sheet (96×16), tile index N starts at x = N*16.
// Wins over block-name-map.json UV.
export const uvOverrides: Record<string, [number, number, number, number]> = {
  // railcraft:infernal — brick_infernal.png, 96×16 sheet of 6 tiles; tile index = metadata.
  'railcraft:infernal:0': [ 0,  0, 16, 16],
  'railcraft:infernal:1': [16,  0, 32, 16],
  'railcraft:infernal:2': [32,  0, 48, 16],
  'railcraft:infernal:3': [48,  0, 64, 16],
  'railcraft:infernal:4': [64,  0, 80, 16],
  'railcraft:infernal:5': [80,  0, 96, 16],

  // railcraft:sandy — brick_sandy.png, 96×16 sheet of 6 tiles; tile index = metadata.
  'railcraft:sandy:0': [ 0,  0, 16, 16],
  'railcraft:sandy:1': [16,  0, 32, 16],
  'railcraft:sandy:2': [32,  0, 48, 16],
  'railcraft:sandy:3': [48,  0, 64, 16],
  'railcraft:sandy:4': [64,  0, 80, 16],
  'railcraft:sandy:5': [80,  0, 96, 16],

  // railcraft:coke_oven_red — coke_oven_red.png, 48×16 sheet of 3 tiles.
  // Map references _0/_1 split files that don't exist; meta :0 uses tile 1, :1 uses tile 0.
  'railcraft:coke_oven_red:0': [16,  0, 32, 16],
  'railcraft:coke_oven_red:1': [ 0,  0, 16, 16],

  // ── IC2 sprite sheets ─────────────────────────────────────────────────────
  // To use: replace REPLACE_ME with ic2:blockname:metadata, then uncomment
  // BOTH this uvOverrides entry AND the matching textureAliases entry below.
  //
  // sprites_block_0.png (256×256 — 16×16 tile grid, 16px tiles)
  // 'REPLACE_ME': [176,  0, 192, 16],  // col=11 row=0
  // 'REPLACE_ME': [208,  0, 224, 16],  // col=13 row=0
  // 'REPLACE_ME': [ 80, 32,  96, 48],  // col= 5 row=2
  // 'REPLACE_ME': [ 96, 32, 112, 48],  // col= 6 row=2
  // 'REPLACE_ME': [144, 32, 160, 48],  // col= 9 row=2
  // 'REPLACE_ME': [160, 32, 176, 48],  // col=10 row=2
  // 'REPLACE_ME': [ 64,112,  80,128],  // col= 4 row=7
  // 'REPLACE_ME': [ 64,128,  80,144],  // col= 4 row=8
  //
  // sprites_block_cable.png (272×272 — 17×17 tile grid, 16px tiles)
  // 'REPLACE_ME': [  0, 16, 16, 32],   // col= 0 row= 1
  // 'REPLACE_ME': [  0, 48, 16, 64],   // col= 0 row= 3
  // 'REPLACE_ME': [  0, 64, 16, 80],   // col= 0 row= 4
  // 'REPLACE_ME': [  0, 80, 16, 96],   // col= 0 row= 5
  // 'REPLACE_ME': [  0, 96, 16,112],   // col= 0 row= 6
  // 'REPLACE_ME': [  0,112, 16,128],   // col= 0 row= 7
  // 'REPLACE_ME': [  0,128, 16,144],   // col= 0 row= 8
  // 'REPLACE_ME': [  0,144, 16,160],   // col= 0 row= 9
  // 'REPLACE_ME': [ 16,144, 32,160],   // col= 1 row= 9
  // 'REPLACE_ME': [ 32,144, 48,160],   // col= 2 row= 9
  // 'REPLACE_ME': [ 48,144, 64,160],   // col= 3 row= 9
  // 'REPLACE_ME': [ 64,144, 80,160],   // col= 4 row= 9
  // 'REPLACE_ME': [ 80,144, 96,160],   // col= 5 row= 9
  // 'REPLACE_ME': [ 96,144,112,160],   // col= 6 row= 9
  // 'REPLACE_ME': [112,144,128,160],   // col= 7 row= 9
  // 'REPLACE_ME': [128,144,144,160],   // col= 8 row= 9
  // 'REPLACE_ME': [144,144,160,160],   // col= 9 row= 9
  // 'REPLACE_ME': [160,144,176,160],   // col=10 row= 9
  // 'REPLACE_ME': [176,144,192,160],   // col=11 row= 9
  // 'REPLACE_ME': [192,144,208,160],   // col=12 row= 9
  // 'REPLACE_ME': [208,144,224,160],   // col=13 row= 9
  // 'REPLACE_ME': [224,144,240,160],   // col=14 row= 9
  // 'REPLACE_ME': [240,144,256,160],   // col=15 row= 9
  // 'REPLACE_ME': [256,144,272,160],   // col=16 row= 9
  // 'REPLACE_ME': [256,192,272,208],   // col=16 row=12
  // 'REPLACE_ME': [  0,224, 16,240],   // col= 0 row=14
  // 'REPLACE_ME': [  0,240, 16,256],   // col= 0 row=15
  //
  // sprites_block_machine_hv.png (256×192 — 16×12 tile grid, 16px tiles)
  // 'REPLACE_ME': [ 80, 48, 96, 64],   // col= 5 row= 3
  // 'REPLACE_ME': [ 80,144, 96,160],   // col= 5 row= 9
};

export const textureAliases: { [id: string]: string } = {
  "projecte:interdiction_torch": "projecte/interdiction_torch",

  // chisel:ironpane — no blockstate extracted; textures follow chisel alphabetical ordering.
  // Geometry: pane (non-occluding, transparent with alphaTest).
  "chisel:ironpane:0":  "chisel/ironpane_barbedwire",
  "chisel:ironpane:1":  "chisel/ironpane_bars",
  "chisel:ironpane:7":  "chisel/ironpane_fence",
  "chisel:ironpane:12": "chisel/ironpane_thingrid",

  // chisel:stonebrick2 — no blockstate extracted; no dedicated textures found.
  // Mapped to available stone_bricks-* variants. Exact per-metadata match is uncertain.
  "chisel:stonebrick2:0": "chisel/stone_bricks-solid",
  "chisel:stonebrick2:7": "chisel/stone_bricks-cracked",
  "chisel:stonebrick2:8": "chisel/stone_bricks-triple",
  "chisel:stonebrick2:9": "chisel/stone_bricks-chaotic",

  // IC2 — blockstate format not processed by the extractor; no block textures were extracted.
  // Using closest vanilla equivalents as visual fallbacks (IC2 textures not extracted).
  "ic2:leaves":       "minecraft/leaves_oak",     // rubber tree leaves
  "ic2:blockrubwood": "minecraft/log_oak",         // rubber tree log
  "ic2:blockutility": "minecraft/stonebrick",      // reinforced stone (:2=4070, :3=49 in world)
  "ic2:blockmetal":   "minecraft/iron_block",      // metal block variants
  "ic2:blockwall":    "minecraft/stonebrick",      // reinforced wall variants
  "ic2:blockscaffold": "minecraft/planks_oak",     // scaffold
  "ic2:blockcable":   "minecraft/iron_block",      // cable block (no good visual match)
  "ic2:blockfoam":    "minecraft/wool_colored_white", // foam block
  "ic2:blockelectric": "minecraft/iron_block",     // electric storage blocks
  "ic2:blockgenerator": "minecraft/iron_block",    // generators
  "ic2:blockcompactedgenerator": "minecraft/iron_block",
  "ic2:blockmachinelv": "minecraft/iron_block",
  "ic2:blockmachinelv2": "minecraft/iron_block",
  "ic2:blockmachinehv": "minecraft/iron_block",
  "ic2:blockmachinemv": "minecraft/iron_block",
  "ic2:blockbarrel":  "minecraft/planks_oak",
  "ic2:blockchambers": "minecraft/iron_block",
  "ic2:blockdooralloy": "minecraft/door_steel_lower",
  "ic2:blockfenceiron": "minecraft/iron_bars",
  "ic2:blockironscaffold": "minecraft/iron_block",
  "ic2:blockcrop":    "minecraft/farmland",

  // ProjectRed Exploration — no map entries extracted.
  // stone: meta 0 = marble, meta 1 = basalt (covers all variants via bare-name fallback for :0).
  "projectred-exploration:stone:0": "projectred/world_marble",
  "projectred-exploration:stone:1": "projectred/world_basalt",

  // railcraft sprite-sheet blocks — UV sub-regions handled in uvOverrides above.
  "railcraft:sandy:0": "railcraft/brick_sandy",
  "railcraft:sandy:1": "railcraft/brick_sandy",
  "railcraft:sandy:2": "railcraft/brick_sandy",
  "railcraft:sandy:3": "railcraft/brick_sandy",
  "railcraft:sandy:4": "railcraft/brick_sandy",
  "railcraft:sandy:5": "railcraft/brick_sandy",
  "railcraft:coke_oven_red:0": "railcraft/coke_oven_red",
  "railcraft:coke_oven_red:1": "railcraft/coke_oven_red",
  "railcraft:infernal:0": "railcraft/brick_infernal",
  "railcraft:infernal:1": "railcraft/brick_infernal",
  "railcraft:infernal:2": "railcraft/brick_infernal",
  "railcraft:infernal:3": "railcraft/brick_infernal",
  "railcraft:infernal:4": "railcraft/brick_infernal",
  "railcraft:infernal:5": "railcraft/brick_infernal",

  // tallgrass:1 (tall grass plant) was misclassified by the alias system in the extractor
  // when run against a 1.12 JAR (where minecraft:grass = solid block → grass_top texture).
  "minecraft:tallgrass:1": "minecraft/tallgrass",

  // chisel:antiblock — Forge blockstate format with per-color inline textures; extractor
  // skips variants that lack a per-variant model reference (model lives in blockstate defaults).
  // Color order follows MC dye metadata (0=white … 15=black); light gray uses old name "silver".
  "chisel:antiblock:0":  "chisel/antiblock_white",
  "chisel:antiblock:1":  "chisel/antiblock_orange",
  "chisel:antiblock:2":  "chisel/antiblock_magenta",
  "chisel:antiblock:3":  "chisel/antiblock_light_blue",
  "chisel:antiblock:4":  "chisel/antiblock_yellow",
  "chisel:antiblock:5":  "chisel/antiblock_lime",
  "chisel:antiblock:6":  "chisel/antiblock_pink",
  "chisel:antiblock:7":  "chisel/antiblock_gray",
  "chisel:antiblock:8":  "chisel/antiblock_silver",
  "chisel:antiblock:9":  "chisel/antiblock_cyan",
  "chisel:antiblock:10": "chisel/antiblock_purple",
  "chisel:antiblock:11": "chisel/antiblock_blue",
  "chisel:antiblock:12": "chisel/antiblock_brown",
  "chisel:antiblock:13": "chisel/antiblock_green",
  "chisel:antiblock:14": "chisel/antiblock_red",
  "chisel:antiblock:15": "chisel/antiblock_black",

  // chisel:carpet_* — per-color blocks (color in name, metadata = pattern variant).
  // No dedicated carpet textures; chisel carpets reuse wool_legacy_* textures.
  "chisel:carpet_white":     "chisel/wool_legacy_white",
  "chisel:carpet_orange":    "chisel/wool_legacy_orange",
  "chisel:carpet_magenta":   "chisel/wool_legacy_magenta",
  "chisel:carpet_lightblue": "chisel/wool_legacy_lightblue",
  "chisel:carpet_yellow":    "chisel/wool_legacy_yellow",
  "chisel:carpet_lime":      "chisel/wool_legacy_lime",
  "chisel:carpet_pink":      "chisel/wool_legacy_pink",
  "chisel:carpet_gray":      "chisel/wool_legacy_gray",
  "chisel:carpet_lightgray": "chisel/wool_legacy_lightgray",
  "chisel:carpet_cyan":      "chisel/wool_legacy_cyan",
  "chisel:carpet_purple":    "chisel/wool_legacy_purple",
  "chisel:carpet_blue":      "chisel/wool_legacy_blue",
  "chisel:carpet_brown":     "chisel/wool_legacy_brown",
  "chisel:carpet_green":     "chisel/wool_legacy_green",
  "chisel:carpet_red":       "chisel/wool_legacy_red",
  "chisel:carpet_black":     "chisel/wool_legacy_black",

  // Polished stone variants (1.12 metadata 2/4/6) — the smooth model files don't resolve
  // in the 1.12 JAR, and the LEGACY_1_12_ALIASES target 1.13 names that don't exist there.
  "minecraft:stone:2": "minecraft/stone_granite_smooth",
  "minecraft:stone:4": "minecraft/stone_diorite_smooth",
  "minecraft:stone:6": "minecraft/stone_andesite_smooth",

  // Water and lava use builtin renderer models — not resolvable from the JAR.
  "minecraft:water":         "minecraft/water_still",
  "minecraft:flowing_water": "minecraft/water_flow",
  "minecraft:lava":          "minecraft/lava_still",
  "minecraft:flowing_lava":  "minecraft/lava_flow",

  // ── IC2 sprite sheets ─────────────────────────────────────────────────────
  // To use: replace REPLACE_ME with ic2:blockname:metadata, then uncomment
  // BOTH this textureAliases entry AND the matching uvOverrides entry above.
  //
  // sprites_block_0.png (256×256 — 16×16 tile grid, 16px tiles)
  // 'REPLACE_ME': 'ic2/sprites_block_0',       // col=11 row=0  uv=[176,  0, 192, 16]
  // 'REPLACE_ME': 'ic2/sprites_block_0',       // col=13 row=0  uv=[208,  0, 224, 16]
  // 'REPLACE_ME': 'ic2/sprites_block_0',       // col= 5 row=2  uv=[ 80, 32,  96, 48]
  // 'REPLACE_ME': 'ic2/sprites_block_0',       // col= 6 row=2  uv=[ 96, 32, 112, 48]
  // 'REPLACE_ME': 'ic2/sprites_block_0',       // col= 9 row=2  uv=[144, 32, 160, 48]
  // 'REPLACE_ME': 'ic2/sprites_block_0',       // col=10 row=2  uv=[160, 32, 176, 48]
  // 'REPLACE_ME': 'ic2/sprites_block_0',       // col= 4 row=7  uv=[ 64,112,  80,128]
  // 'REPLACE_ME': 'ic2/sprites_block_0',       // col= 4 row=8  uv=[ 64,128,  80,144]
  //
  // sprites_block_cable.png (272×272 — 17×17 tile grid, 16px tiles)
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row= 1  uv=[  0, 16, 16, 32]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row= 3  uv=[  0, 48, 16, 64]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row= 4  uv=[  0, 64, 16, 80]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row= 5  uv=[  0, 80, 16, 96]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row= 6  uv=[  0, 96, 16,112]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row= 7  uv=[  0,112, 16,128]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row= 8  uv=[  0,128, 16,144]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row= 9  uv=[  0,144, 16,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 1 row= 9  uv=[ 16,144, 32,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 2 row= 9  uv=[ 32,144, 48,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 3 row= 9  uv=[ 48,144, 64,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 4 row= 9  uv=[ 64,144, 80,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 5 row= 9  uv=[ 80,144, 96,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 6 row= 9  uv=[ 96,144,112,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 7 row= 9  uv=[112,144,128,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 8 row= 9  uv=[128,144,144,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 9 row= 9  uv=[144,144,160,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col=10 row= 9  uv=[160,144,176,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col=11 row= 9  uv=[176,144,192,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col=12 row= 9  uv=[192,144,208,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col=13 row= 9  uv=[208,144,224,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col=14 row= 9  uv=[224,144,240,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col=15 row= 9  uv=[240,144,256,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col=16 row= 9  uv=[256,144,272,160]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col=16 row=12  uv=[256,192,272,208]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row=14  uv=[  0,224, 16,240]
  // 'REPLACE_ME': 'ic2/sprites_block_cable',   // col= 0 row=15  uv=[  0,240, 16,256]
  //
  // sprites_block_machine_hv.png (256×192 — 16×12 tile grid, 16px tiles)
  // 'REPLACE_ME': 'ic2/sprites_block_machine_hv',  // col= 5 row= 3  uv=[ 80, 48, 96, 64]
  // 'REPLACE_ME': 'ic2/sprites_block_machine_hv',  // col= 5 row= 9  uv=[ 80,144, 96,160]
};
