// Lists of blocks that participate in a given connection group. Cable / pipe
// geometry checks for group overlap with neighbours: an RF cable connects to
// any block in the "rf" group (other RF cables AND RF-accepting machines).
//
// Both the cable itself AND its acceptors live in the same list — the geometry
// (cube vs. cable) is decided separately by geometryMap in geometry.ts.
//
// Per-metadata exceptions can be added in CONNECTION_GROUPS_OVERRIDES below
// when a block accepts multiple types at one specific metadata only.

// Each top-level group can be subdivided into sub-protocols. Blocks in
// different named sub-protocols within the same group do NOT connect to each
// other — e.g. IC2 EU cables and Galacticraft aluminium wires are both "eu"
// but visually wouldn't merge into one network.
//
// The "_" key has two meanings depending on context:
//   • When named subgroups exist alongside "_" (e.g. EU below): blocks under
//     "_" are UNIVERSAL ACCEPTORS — they get every named sibling's tag and
//     therefore connect to all sub-protocols. Use this for machines that
//     accept any flavour of the parent group.
//   • When "_" is the only key (e.g. LIQUID, ITEM below): the group has no
//     subdivision; "_" entries simply get the bare prefix tag and all entries
//     connect to each other.
//
// Tags emitted:
//   • Named subgroup → `<prefix>_<subgroup>`  (e.g. "eu_ic2", "eu_galactic")
//   • "_" with named siblings → all named-sibling tags
//   • "_" alone → just `<prefix>`              (e.g. "liquid", "item")
//
// In CONNECTION_GROUPS_OVERRIDES you may use either the resolved tag name
// (e.g. "eu_ic2") or the bare prefix (e.g. "eu"), which expands to all
// sub-protocol tags for that group — equivalent to listing every named sibling.
//
// Multi-group entries in CONNECTION_GROUPS_OVERRIDES may use either resolved
// tag names (e.g. "eu_ic2") or a bare prefix (e.g. "eu") which expands to all
// sub-protocol tags for that group at build time.

const RF: Record<string, string[]> = {
};

const EU: Record<string, string[]> = {
  ic2: [
    "ic2:blockcable",
  ],
  galactic: [
    "galacticraftcore:aluminum_wire",
  ],

  //Note that most EU machines are universal acceptors, connecting to both IC2 and Galacticraft cables.
  _: [
    //galacticraft machines - convenience organization
    "galacticraftcore:machine:0",

    //IC2 machines
    "ic2:blockelectric",
    "ic2:blockgenerator",
    "ic2:blockcompactedgenerator",
    "ic2:blockmachinelv",
    "ic2:blockmachinelv2",
    "ic2:blockmachinemv",
    "ic2:blockmachinehv",
  ],
};

const LIQUID: Record<string, string[]> = {
  _: [
    // pipes
    "galacticraftcore:fluid_pipe",
    "galacticraftcore:fluid_pipe_pull",

    // tanks / fluid-accepting machines
    "irontanks:obsidian_tank",
  ],
};

const ITEM: Record<string, string[]> = {
  _: [
    // pipes
    "buildcrafttransport:pipe_holder",

    // chests accept item pipes
    "minecraft:chest",
    "minecraft:trapped_chest",
    "ironchest:iron_chest",
  ],
};

// Per-metadata multi-group entries. Use the resolved tag names from the
// subgroup definitions above (e.g. "eu_ic2", not "eu"). These take priority
// over bare-name lookups.
const CONNECTION_GROUPS_OVERRIDES: Record<string, string[]> = {
  "ic2:blockmachinehv:1":           ["eu", "item"],
  "galacticraftcore:fuel_loader:0": ["eu", "liquid"],
  "galacticraftcore:fuel_loader:1": ["eu", "liquid"],
  "galacticraftcore:refinery:1":    ["eu", "liquid"],
};

function buildConnectionGroups(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  // Maps bare prefix → all resolved sub-protocol tags (used to expand override shorthands).
  const prefixTags: Record<string, string[]> = {};

  const addNamespaced = (prefix: string, subgroups: Record<string, string[]>) => {
    const namedSubs = Object.keys(subgroups).filter(s => s !== "_");
    const universalTags = namedSubs.length > 0
      ? namedSubs.map(s => `${prefix}_${s}`)
      : [prefix];

    prefixTags[prefix] = universalTags;

    for (const [sub, ids] of Object.entries(subgroups)) {
      const tags = sub === "_" ? universalTags : [`${prefix}_${sub}`];
      for (const id of ids) {
        for (const t of tags) (out[id] ??= []).push(t);
      }
    }
  };
  addNamespaced("rf",     RF);
  addNamespaced("eu",     EU);
  addNamespaced("liquid", LIQUID);
  addNamespaced("item",   ITEM);
  // Overrides last; bare prefixes (e.g. "eu") expand to all sub-protocol tags.
  for (const [id, groups] of Object.entries(CONNECTION_GROUPS_OVERRIDES)) {
    out[id] = groups.flatMap(g => prefixTags[g] ?? [g]);
  }
  return out;
}

const connectionGroups: Record<string, string[]> = buildConnectionGroups();

/**
 * Returns the connection groups a block belongs to. Tries the metadata-specific
 * key first, falls back to the bare name. Empty array means "no groups".
 */
export function getConnectionGroups(name: string, metadata: number = 0): string[] {
  return connectionGroups[`${name}:${metadata}`] ?? connectionGroups[name] ?? [];
}
