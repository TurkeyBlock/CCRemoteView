// Maps item IDs (including "name:meta" variants) to their texture file path
// (relative to the items/ directory, without .png extension).
// Covers vanilla 1.12 items where the same registry ID carries sub-items
// distinguished by damage/metadata — cases the naive name→path lookup can't handle.

export const itemTextureAliases: Record<string, string> = {
  // ── Dye (minecraft:dye, meta 0–15) ────────────────────────────────────────
  'minecraft:dye:0':  'minecraft/dye_powder_black',
  'minecraft:dye:1':  'minecraft/dye_powder_red',
  'minecraft:dye:2':  'minecraft/dye_powder_green',
  'minecraft:dye:3':  'minecraft/dye_powder_brown',
  'minecraft:dye:4':  'minecraft/dye_powder_blue',
  'minecraft:dye:5':  'minecraft/dye_powder_purple',
  'minecraft:dye:6':  'minecraft/dye_powder_cyan',
  'minecraft:dye:7':  'minecraft/dye_powder_silver',
  'minecraft:dye:8':  'minecraft/dye_powder_gray',
  'minecraft:dye:9':  'minecraft/dye_powder_pink',
  'minecraft:dye:10': 'minecraft/dye_powder_lime',
  'minecraft:dye:11': 'minecraft/dye_powder_yellow',
  'minecraft:dye:12': 'minecraft/dye_powder_light_blue',
  'minecraft:dye:13': 'minecraft/dye_powder_magenta',
  'minecraft:dye:14': 'minecraft/dye_powder_orange',
  'minecraft:dye:15': 'minecraft/dye_powder_white',

  // ── Raw fish (minecraft:fish, meta 0–3) ───────────────────────────────────
  'minecraft:fish:0': 'minecraft/fish_cod_raw',
  'minecraft:fish:1': 'minecraft/fish_salmon_raw',
  'minecraft:fish:2': 'minecraft/fish_clownfish_raw',
  'minecraft:fish:3': 'minecraft/fish_pufferfish_raw',

  // ── Cooked fish (minecraft:cooked_fish, meta 0–1) ─────────────────────────
  'minecraft:cooked_fish:0': 'minecraft/fish_cod_cooked',
  'minecraft:cooked_fish:1': 'minecraft/fish_salmon_cooked',

  // ── Boats (minecraft:boat, meta 0–5) ──────────────────────────────────────
  'minecraft:boat:0': 'minecraft/boat_oak',
  'minecraft:boat:1': 'minecraft/boat_spruce',
  'minecraft:boat:2': 'minecraft/boat_birch',
  'minecraft:boat:3': 'minecraft/boat_jungle',
  'minecraft:boat:4': 'minecraft/boat_acacia',
  'minecraft:boat:5': 'minecraft/boat_dark_oak',

  // ── Skulls (minecraft:skull, meta 0–5) ────────────────────────────────────
  'minecraft:skull:0': 'minecraft/skull_skeleton',
  'minecraft:skull:1': 'minecraft/skull_wither',
  'minecraft:skull:2': 'minecraft/skull_zombie',
  'minecraft:skull:3': 'minecraft/skull_char',
  'minecraft:skull:4': 'minecraft/skull_creeper',
  'minecraft:skull:5': 'minecraft/skull_dragon',

  // ── Golden apple (minecraft:golden_apple, meta 0–1) ───────────────────────
  'minecraft:golden_apple:0': 'minecraft/apple_golden',
  'minecraft:golden_apple:1': 'minecraft/apple_golden_gleam',
};
