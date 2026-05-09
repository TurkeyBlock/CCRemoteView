// Maps block IDs (or "name:metadata" keys) to their texture file path
// (relative to the blocks/ folder, without .png extension).

// Sprite-sheet UV overrides — blocks whose texture is a sprite sheet requiring
// a sub-region UV. Each top-level key is the shared texture path; the nested
// object maps block IDs to pixel-coordinate UV rects [x1, y1, x2, y2].
// Both the texture alias AND the UV override are derived from this automatically.
const uvSources: Record<string, Record<string, [number, number, number, number]>> = {
  // brick_infernal.png — 96×16 sheet of 6 tiles; tile index = metadata.
  'railcraft/brick_infernal': {
    'railcraft:infernal:0': [ 0,  0, 16, 16],
    'railcraft:infernal:1': [16,  0, 32, 16],
    'railcraft:infernal:2': [32,  0, 48, 16],
    'railcraft:infernal:3': [48,  0, 64, 16],
    'railcraft:infernal:4': [64,  0, 80, 16],
    'railcraft:infernal:5': [80,  0, 96, 16],
  },

  // brick_sandy.png — 96×16 sheet of 6 tiles; tile index = metadata.
  'railcraft/brick_sandy': {
    'railcraft:sandy:0': [ 0,  0, 16, 16],
    'railcraft:sandy:1': [16,  0, 32, 16],
    'railcraft:sandy:2': [32,  0, 48, 16],
    'railcraft:sandy:3': [48,  0, 64, 16],
    'railcraft:sandy:4': [64,  0, 80, 16],
    'railcraft:sandy:5': [80,  0, 96, 16],
  },

  // coke_oven_red.png — 48×16 sheet of 3 tiles.
  // Map references _0/_1 split files that don't exist; meta :0 uses tile 1, :1 uses tile 0.
  'railcraft/coke_oven_red': {
    'railcraft:coke_oven_red:0': [16,  0, 32, 16],
    'railcraft:coke_oven_red:1': [ 0,  0, 16, 16],
  },

  // ── IC2 sprite sheets ─────────────────────────────────────────────────────
  // To add an IC2 block: uncomment the entry under the matching sprite sheet
  // and replace REPLACE_ME with the real block ID (e.g. 'ic2:blockmachinelv:3').

  // sprites_block_0.png (256×256 — 16×16 tile grid, 16px tiles)
  // 'ic2/sprites_block_0': {
  //   'REPLACE_ME': [176,  0, 192, 16],  // col=11 row=0
  //   'REPLACE_ME': [208,  0, 224, 16],  // col=13 row=0
  //   'REPLACE_ME': [ 80, 32,  96, 48],  // col= 5 row=2
  //   'REPLACE_ME': [ 96, 32, 112, 48],  // col= 6 row=2
  //   'REPLACE_ME': [144, 32, 160, 48],  // col= 9 row=2
  //   'REPLACE_ME': [160, 32, 176, 48],  // col=10 row=2
  //   'REPLACE_ME': [ 64,112,  80,128],  // col= 4 row=7
  //   'REPLACE_ME': [ 64,128,  80,144],  // col= 4 row=8
  // },

  // sprites_block_cable.png (272×272 — 17×17 tile grid, 16px tiles)
  // 'ic2/sprites_block_cable': {
  //   'REPLACE_ME': [  0, 16, 16, 32],   // col= 0 row= 1
  //   'REPLACE_ME': [  0, 48, 16, 64],   // col= 0 row= 3
  //   'REPLACE_ME': [  0, 64, 16, 80],   // col= 0 row= 4
  //   'REPLACE_ME': [  0, 80, 16, 96],   // col= 0 row= 5
  //   'REPLACE_ME': [  0, 96, 16,112],   // col= 0 row= 6
  //   'REPLACE_ME': [  0,112, 16,128],   // col= 0 row= 7
  //   'REPLACE_ME': [  0,128, 16,144],   // col= 0 row= 8
  //   'REPLACE_ME': [  0,144, 16,160],   // col= 0 row= 9
  //   'REPLACE_ME': [ 16,144, 32,160],   // col= 1 row= 9
  //   'REPLACE_ME': [ 32,144, 48,160],   // col= 2 row= 9
  //   'REPLACE_ME': [ 48,144, 64,160],   // col= 3 row= 9
  //   'REPLACE_ME': [ 64,144, 80,160],   // col= 4 row= 9
  //   'REPLACE_ME': [ 80,144, 96,160],   // col= 5 row= 9
  //   'REPLACE_ME': [ 96,144,112,160],   // col= 6 row= 9
  //   'REPLACE_ME': [112,144,128,160],   // col= 7 row= 9
  //   'REPLACE_ME': [128,144,144,160],   // col= 8 row= 9
  //   'REPLACE_ME': [144,144,160,160],   // col= 9 row= 9
  //   'REPLACE_ME': [160,144,176,160],   // col=10 row= 9
  //   'REPLACE_ME': [176,144,192,160],   // col=11 row= 9
  //   'REPLACE_ME': [192,144,208,160],   // col=12 row= 9
  //   'REPLACE_ME': [208,144,224,160],   // col=13 row= 9
  //   'REPLACE_ME': [224,144,240,160],   // col=14 row= 9
  //   'REPLACE_ME': [240,144,256,160],   // col=15 row= 9
  //   'REPLACE_ME': [256,144,272,160],   // col=16 row= 9
  //   'REPLACE_ME': [256,192,272,208],   // col=16 row=12
  //   'REPLACE_ME': [  0,224, 16,240],   // col= 0 row=14
  //   'REPLACE_ME': [  0,240, 16,256],   // col= 0 row=15
  // },

  // sprites_block_machine_hv.png (256×192 — 16×12 tile grid, 16px tiles)
  // 'ic2/sprites_block_machine_hv': {
  //   'REPLACE_ME': [ 80, 48, 96, 64],   // col= 5 row= 3
  //   'REPLACE_ME': [ 80,144, 96,160],   // col= 5 row= 9
  // },
};

export const uvOverrides: Record<string, [number, number, number, number]> =
  Object.fromEntries(
    Object.entries(uvSources).flatMap(([, blocks]) => Object.entries(blocks))
  );

const manualAliases: { [id: string]: string } = {
  // Hand-authored textures for blocks the extractor can't resolve (block-entity renderers).
  "minecraft:chest":         "chest/chest_faces",
  "minecraft:trapped_chest": "chest/chest_faces",
  "ironchest:iron_chest":    "chest/chest_faces",

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

  // IC2 — blockstates are in a really annoying spritemap.
  // Using closest vanilla equivalents as visual fallbacks for now.
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

  // tallgrass:1 (tall grass plant) was misclassified by the alias system in the extractor
  // when run against a 1.12 JAR (where minecraft:grass = solid block → grass_top texture).
  "minecraft:tallgrass:1": "minecraft/tallgrass",

  // chisel:antiblock — follows standard 1.12 dye metadata order (0=black … 15=white).
  "chisel:antiblock:0":  "chisel/antiblock_black",
  "chisel:antiblock:1":  "chisel/antiblock_red",
  "chisel:antiblock:2":  "chisel/antiblock_green",
  "chisel:antiblock:3":  "chisel/antiblock_brown",
  "chisel:antiblock:4":  "chisel/antiblock_blue",
  "chisel:antiblock:5":  "chisel/antiblock_purple",
  "chisel:antiblock:6":  "chisel/antiblock_cyan",
  "chisel:antiblock:7":  "chisel/antiblock_silver",
  "chisel:antiblock:8":  "chisel/antiblock_gray",
  "chisel:antiblock:9":  "chisel/antiblock_pink",
  "chisel:antiblock:10": "chisel/antiblock_lime",
  "chisel:antiblock:11": "chisel/antiblock_yellow",
  "chisel:antiblock:12": "chisel/antiblock_light_blue",
  "chisel:antiblock:13": "chisel/antiblock_magenta",
  "chisel:antiblock:14": "chisel/antiblock_orange",
  "chisel:antiblock:15": "chisel/antiblock_white",

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
};

// Aliases derived from uvSources are merged in so sprite-sheet blocks don't need
// a separate entry here.
export const textureAliases: { [id: string]: string } = {
  ...Object.fromEntries(
    Object.entries(uvSources).flatMap(([texture, blocks]) =>
      Object.keys(blocks).map(id => [id, texture])
    )
  ),
  ...manualAliases,
};
