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

export const textureAliases: { [id: string]: string } = {
  "projecte:interdiction_torch": "projecte/interdiction_torch",

  // Water and lava use builtin renderer models — not resolvable from the JAR.
  "minecraft:water":         "minecraft/water_still",
  "minecraft:flowing_water": "minecraft/water_flow",
  "minecraft:lava":          "minecraft/lava_still",
  "minecraft:flowing_lava":  "minecraft/lava_flow",
};
