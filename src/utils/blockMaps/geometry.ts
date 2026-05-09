// Manual geometry overrides — only needed when the auto-generated map gets it wrong.
// These take priority over block-name-map.json.

export enum GEOMETRY {
  CUBE        = 'cube',
  CROSS       = 'cross',
  FLAT        = 'flat',
  SLAB_BOTTOM = 'slab_bottom',
  SLAB_TOP    = 'slab_top',
  FENCE       = 'fence',
  PANE        = 'pane',
  CABLE       = 'cable',
  CUBE6       = 'cube6',
  LIQUID      = 'liquid',
  STAIRS      = 'stairs',
  // Emitted by the texture extractor when a block's model chain inherits from a
  // glass or leaves parent. Interpreted at runtime as isAlphaGlass / isNonOccluding
  // rather than as distinct render shapes — both render as CUBE geometry.
  GLASS       = 'glass',
  LEAVES      = 'leaves',
}

const cross: string[] = [
  // "quark:root",
  // tallgrass:1 and :2 are grass plants (cross), but the alias system in the extractor
  // can misclassify them as cube when run against a 1.12 JAR (where minecraft:grass = solid block).
  "minecraft:tallgrass:1",
  "minecraft:tallgrass:2",
];

const flat: string[] = [
  "galacticraftcore:block_multi:2",
  "galacticraftcore:landing_pad_full",
];

const slab_bottom: string[] = [
  // "minecraft:stone_slab",
];

const slab_top: string[] = [
  // "minecraft:stone_slab:8",
];

const pane: string[] = [
  "chisel:ironpane",
  "minecraft:iron_bars",
  "minecraft:glass_pane",
  "minecraft:stained_glass_pane",
];

// Fences also covers walls per project convention — both render as a thin centre
// post with up to 4 connector rails toward adjacent fences and solid full cubes.
const fence: string[] = [
  "ic2:blockfenceiron",
];

// NOTE: stair geometry is not yet implemented — blocks render as cubes.
// They are excluded from face occlusion so adjacent faces remain visible.
const stairs: string[] = [
  // "yourmod:yourstairs",
];

// cube6: cube whose 6 faces each draw from a distinct tile in a horizontal
// 6-tile texture strip. Tile order: +X, -X, +Y, -Y, +Z, -Z.
const cube6: string[] = [
  "minecraft:chest",
  "minecraft:trapped_chest",
  "ironchest:iron_chest",
];

// cable: 6-directional thin cuboid (small centre cube + arms toward connected
// neighbours). Connection is decided by connectionGroups overlap, not geomType —
// see connections.ts.
const cable: string[] = [
  // EU
  "ic2:blockcable",
  "galacticraftcore:aluminum_wire",
  // RF (fill in when present)
  // Liquid pipes
  "galacticraftcore:fluid_pipe",
  "galacticraftcore:fluid_pipe_pull",
  // Item pipes
  "buildcrafttransport:pipe_holder",
];

// Name-based geometry fallbacks — match before block-name-map.json loads so
// chunks built during startup get the right shape immediately.
export const CROSS_BY_NAME = /reeds|tallgrass|double_plant|dead.*bush|(?:^|_)fern|flower|sapling|mushroom|crop|wheat|carrot|potato|beetroot|nether_wart|waterlily|vine|cobweb|torch|fire|kelp|seagrass/
export const FLAT_BY_NAME  = /snow_layer|lily_pad|carpet/

export const geometryMap: Record<string, GEOMETRY> = {
  ...Object.fromEntries(cross.map(id       => [id, GEOMETRY.CROSS])),
  ...Object.fromEntries(flat.map(id        => [id, GEOMETRY.FLAT])),
  ...Object.fromEntries(slab_bottom.map(id => [id, GEOMETRY.SLAB_BOTTOM])),
  ...Object.fromEntries(slab_top.map(id    => [id, GEOMETRY.SLAB_TOP])),
  ...Object.fromEntries(pane.map(id        => [id, GEOMETRY.PANE])),
  ...Object.fromEntries(fence.map(id       => [id, GEOMETRY.FENCE])),
  ...Object.fromEntries(cable.map(id       => [id, GEOMETRY.CABLE])),
  ...Object.fromEntries(stairs.map(id      => [id, GEOMETRY.STAIRS])),
  ...Object.fromEntries(cube6.map(id       => [id, GEOMETRY.CUBE6])),
};
