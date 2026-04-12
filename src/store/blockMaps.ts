// ─── Geometry Map ────────────────────────────────────────────────────────────
// Maps block IDs to their render geometry type.

const cross = [
  "minecraft:crops_wheat",
  "minecraft:fire",
  "minecraft:torch",
  "minecraft:tallgrass",
  "minecraft:reeds",
  "minecraft:red_flower",
  "minecraft:cobweb",
  "minecraft:oak_sapling",
  "minecraft:brown_mushroom",
  "minecraft:red_mushroom",
  "minecraft:sugar_cane",
  "minecraft:dead_bush",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:tall_grass",
  "minecraft:vine",
  "minecraft:dandelion",
  "minecraft:lilac",
  "minecraft:poppy",
  "minecraft:allium",
  "minecraft:rose",
  "minecraft:rose_bush",
  "minecraft:lily_of_the_valley",
  "minecraft:azure_bluet",
  "minecraft:blue_orchid",
  "minecraft:oxeye_daisy",
  "minecraft:white_tulip",
  "minecraft:sunflower",
  "minecraft:cornflower",
  "minecraft:peony",
  "minecraft:brewing_stand",
  "minecraft:wheat",
  "quark:root",
  "projecte:interdiction_torch",
  "biomesoplenty:bush",
  "biomesoplenty:toadstool",
  "biomesoplenty:reed",
  "biomesoplenty:clover",
  "biomesoplenty:goldenrod",
  "biomesoplenty:sprout",
  "biomesoplenty:mangrove_root",
  "biomesoplenty:spanish_moss",
  "biomesoplenty:cattail",
  "biomesoplenty:willow_vine",
  "biomesoplenty:glowshroom",
  "biomesoplenty:orange_cosmos",
  "biomesoplenty:pink_daffodil",
];

const flat = [
  "minecraft:rail",
  "minecraft:golden_rail",
  "minecraft:detector_rail",
  "minecraft:activator_rail",
  "minecraft:snow_layer",
  "minecraft:carpet",
];

const slab_bottom = [
  "minecraft:stone_slab",
  "minecraft:wooden_slab",
  "minecraft:stone_slab2",
  "minecraft:purpur_slab",
  "minecraft:brick_slab",
  "minecraft:sandstone_slab",
  "minecraft:red_sandstone_slab",
  "minecraft:nether_brick_slab",
  "minecraft:quartz_slab",
  "minecraft:cobblestone_slab",
];

export const geometryMap: { [blockId: string]: string } = {
  ...Object.fromEntries(cross.map(id => [id, "cross"])),
  ...Object.fromEntries(flat.map(id => [id, "flat"])),
  ...Object.fromEntries(slab_bottom.map(id => [id, "slab_bottom"])),
};

// ─── Texture Aliases ─────────────────────────────────────────────────────────
// Maps block IDs (or "name:metadata" keys) to their texture file path
// (relative to the blocks/ folder, without .png extension).

export const textureAliases: { [id: string]: string } = {
  "minecraft:rail": "minecraft/rail_normal",
  "minecraft:golden_rail": "minecraft/rail_golden",
  "minecraft:red_flower": "minecraft/flower_rose",
  "minecraft:leaves2": "minecraft/leaves_acacia",
  "minecraft:leaves": "minecraft/leaves_oak",
  "minecraft:torch": "minecraft/torch_on",
  "minecraft:bed": "minecraft/bed_head_top",
  "minecraft:wooden_slab": "minecraft/planks_oak",
  "minecraft:log2": "minecraft/log_acacia",
  "minecraft:log": "minecraft/log_oak",
  "minecraft:wheat": "minecraft/crops_wheat",
  "minecraft:snow_layer": "minecraft/snow",
  "minecraft:brick_block": "minecraft/brick",
  "minecraft:carpet": "minecraft/wool_colored_white",
  "minecraft:double_stone_slab": "minecraft/stone_slab",
  "buildcrafttransport:pipe_holder": "buildcraftcore/item_hatch",
  "quark:polished_stone": "minecraft/stone_slab",
};
