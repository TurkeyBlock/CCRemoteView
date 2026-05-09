import { GEOMETRY } from './geometry';

// Blocks with an alpha-punched texture (alphaTest = 0.5) — rendered in the
// transparent pass so they sort correctly against water / leaves.
// Pattern-matched so modded variants are covered automatically.
// All alpha-glass blocks are also non-occluding (see below).
//
// For extracted blocks, geomType === GEOMETRY.GLASS is checked first (set by
// the texture extractor from model inheritance). Name patterns are the fallback
// for blocks not present in block-name-map.json.
const ALPHA_GLASS_PATTERNS: readonly string[] = [
  "glass",   // minecraft:glass, stained_glass, chisel:glass, …
  "tank",    // irontanks:obsidian_tank, etc.
];

const ALPHA_GLASS_EXCLUDE = new Set<string>([
  // e.g. "yourmod:looking_glass" — name contains "glass" but texture is fully opaque.
  // Excluding here also excludes from isNonOccluding (no need to add to NON_OCCLUDING_EXCLUDE).
]);

export function isAlphaGlass(blockName: string, geomType?: GEOMETRY): boolean {
  if (geomType === GEOMETRY.GLASS) return true;
  if (ALPHA_GLASS_EXCLUDE.has(blockName)) return false;
  for (const pat of ALPHA_GLASS_PATTERNS) {
    if (blockName.includes(pat)) return true;
  }
  return false;
}

// Full-cube blocks that must NOT hide the faces of adjacent blocks.
// isAlphaGlass is checked first, so ALPHA_GLASS_EXCLUDE is respected automatically.
// NON_OCCLUDING_PATTERNS covers the remaining transparent types that don't need
// alpha-punching. Add explicit one-offs to NON_OCCLUDING_EXACT below.
//
// For extracted blocks, geomType === GEOMETRY.LEAVES or GEOMETRY.GLASS is checked
// first. Name patterns are the fallback for blocks not in block-name-map.json.
const NON_OCCLUDING_PATTERNS: readonly string[] = [
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

const NON_OCCLUDING_EXCLUDE = new Set<string>([
  // Use for blocks that incorrectly match an occluding (but non-alpha-glass) pattern (leaves, water, ice).
  // For blocks matching an ALPHA_GLASS_PATTERN, use ALPHA_GLASS_EXCLUDE instead.
]);

export function isNonOccluding(blockName: string, geomType?: GEOMETRY): boolean {
  if (geomType === GEOMETRY.LEAVES || geomType === GEOMETRY.GLASS) return true;
  if (NON_OCCLUDING_EXCLUDE.has(blockName)) return false;
  if (isAlphaGlass(blockName)) return true;
  if (NON_OCCLUDING_EXACT.has(blockName)) return true;
  for (const pat of NON_OCCLUDING_PATTERNS) {
    if (blockName.includes(pat)) return true;
  }
  return false;
}

const LIQUID_EXCLUDE = new Set<string>([
  // e.g. "yourmod:lava_lamp" — name contains "lava" but is not a flowing liquid
]);

export function isLiquid(blockName: string): boolean {
  if (LIQUID_EXCLUDE.has(blockName)) return false;
  return blockName.includes('water') || blockName.includes('lava');
}
