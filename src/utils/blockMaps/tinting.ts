export const BIOME_TINT = 0x88C149;

// Catches modded and legacy metadata leaf blocks not listed in blockTint.
export function hasBiomeTint(blockName: string): boolean {
  return blockName.includes('leaves')
}

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

// Maps block IDs (or names) to a hex colour multiplier applied to the material.
// A white base texture (e.g. wool_colored_white) will render as exactly this colour.
export const blockTint: { [id: string]: number } = {
  "minecraft:water":                        0x1e97f2,
  "minecraft:grass":                        BIOME_TINT,
  "grass":                                  BIOME_TINT,
  "minecraft:tall_grass":                   BIOME_TINT,
  "minecraft:tallgrass:1":                  BIOME_TINT,
  "minecraft:tallgrass:2":                  BIOME_TINT,
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
