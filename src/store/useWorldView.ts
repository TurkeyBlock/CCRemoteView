import { defineStore } from 'pinia'
import * as THREE from "three";
import { Block, Inventory, EntitySighting } from '../types/types';
import { useWorldStore } from './useWorld';

const BIOME_TINT = 0x88C149;

export const useWorldViewStore = defineStore('worldView', {
  state: () => ({
    regenerateSceneFromBlocks: () => { },
    render: () => { },
    setCameraFocus: (target: THREE.Vector3) => { },
    focusOnComputer: (computerId: number) => { },
    addBlock: (locString: string, block: Block) => { },
    removeBlock: (locString: string) => { },
    clearAllBlocks: () => { },
    updateComputer: (computerId: string) => { },
    updateEntities: (computerId: string) => { },
    removeComputerModel: (computerId: string) => { },
    addAnimatedTexture: (texture: THREE.Texture) => { },
    manualCenter: null as { x: number, z: number } | null,
    followedComputer: {
      computerId: -1 as number,
      lastPos: {} as { x: number, y: number, z: number }
    },
    materials: {} as { [id: string]: THREE.MeshPhongMaterial; },
    hoveredBlock: null as Block | null,
    hoveredBlockPos: null as THREE.Vector3 | null,
    hoveredEntity: null as (EntitySighting & { worldPos: THREE.Vector3 }) | null,
    gotoBlockPos: null as THREE.Vector3 | null,
    entityMeshes: {} as { [key: string]: THREE.Mesh },
    selectedComputerId: -1 as number,
    computerModels: {} as { [id: string]: THREE.Object3D; },
    selectedInventory: null as Inventory | null,
    selectedInventorySize: 0 as number,
    transparencyList: [] as string[],
    transparencyOpacity: 0.3 as number,
    yMin: 0 as number,
    yMax: 255 as number,
    computerRangeXZ: null as number | null,
    textureIndex: [] as string[],
    textureIndexLoading: false as boolean,
    textureIndexPending: [] as string[],
    blockTint: {
      "minecraft:water": 0x1e97f2,
      "minecraft:grass": BIOME_TINT,
      "grass": BIOME_TINT,
      "minecraft:tall_grass": BIOME_TINT,
      "minecraft:grass_block": BIOME_TINT,
      "minecraft:acacia_leaves": BIOME_TINT,
      "minecraft:birch_leaves": 0x80a755,
      "minecraft:dark_oak_leaves": BIOME_TINT,
      "minecraft:jungle_leaves": BIOME_TINT,
      "minecraft:oak_leaves": BIOME_TINT,
      "minecraft:spruce_leaves": 0x619961,
      "minecraft:fern": BIOME_TINT,
      "minecraft:large_fern": BIOME_TINT,
      "minecraft:vine": BIOME_TINT,
      "minecraft:lily_pad": BIOME_TINT,
      "biomesoplenty:bush": BIOME_TINT,
      "biomesoplenty:clover": BIOME_TINT,
      "biomesoplenty:sprout": BIOME_TINT,
      "biomesoplenty:flowering_oak_leaves": BIOME_TINT,
      "biomesoplenty:mahogany_leaves": BIOME_TINT,
      "biomesoplenty:willow_leaves": BIOME_TINT,
      "biomesoplenty:willow_vine": BIOME_TINT,
      "minecraft:leaves2": BIOME_TINT
    } as { [id: string]: number; },
    geometryMap: {
      "minecraft:crops_wheat": "cross",
      "minecraft:fire": "cross",
      "minecraft:torch": "cross",
      "minecraft:tallgrass": "cross",
      "minecraft:reeds": "cross",
      "minecraft:red_flower": "cross",
      "biomesoplenty:bush": "cross",
      "biomesoplenty:toadstool": "cross",
      "biomesoplenty:reed": "cross",
      "biomesoplenty:clover": "cross",
      "biomesoplenty:goldenrod": "cross",
      "biomesoplenty:sprout": "cross",
      "biomesoplenty:mangrove_root": "cross",
      "biomesoplenty:spanish_moss": "cross",
      "biomesoplenty:cattail": "cross",
      "biomesoplenty:willow_vine": "cross",
      "biomesoplenty:glowshroom": "cross",
      "biomesoplenty:orange_cosmos": "cross",
      "biomesoplenty:pink_daffodil": "cross",
      "minecraft:cobweb": "cross",
      "minecraft:oak_sapling": "cross",
      "minecraft:brown_mushroom": "cross",
      "minecraft:red_mushroom": "cross",
      "minecraft:sugar_cane": "cross",
      "minecraft:dead_bush": "cross",
      "minecraft:fern": "cross",
      "minecraft:large_fern": "cross",
      "minecraft:grass": "cube",
      "grass": "cube",
      "minecraft:tall_grass": "cross",
      "minecraft:vine": "cross",
      "minecraft:dandelion": "cross",
      "minecraft:lilac": "cross",
      "minecraft:poppy": "cross",
      "minecraft:allium": "cross",
      "minecraft:rose": "cross",
      "minecraft:rose_bush": "cross",
      "minecraft:lily_of_the_valley": "cross",
      "minecraft:azure_bluet": "cross",
      "minecraft:blue_orchid": "cross",
      "minecraft:oxeye_daisy": "cross",
      "minecraft:white_tulip": "cross",
      "minecraft:sunflower": "cross",
      "minecraft:cornflower": "cross",
      "minecraft:peony": "cross",
      "quark:root": "cross",
    } as { [blockId: string]: string },
  }),
  getters: {

  },
  actions: {
    isBlockVisible(locString: string): boolean {
      const [x, y, z] = locString.split(',').map(Number);
      if (y < this.yMin || y > this.yMax) return false;
      if (this.computerRangeXZ !== null) {
        let cx: number | null = null, cz: number | null = null;
        if (this.selectedComputerId !== -1) {
          const world = useWorldStore();
          const turtle = world.computers[this.selectedComputerId];
          if (turtle?.loc) { cx = turtle.loc.x; cz = turtle.loc.z; }
        } else if (this.manualCenter) {
          cx = this.manualCenter.x;
          cz = this.manualCenter.z;
        }
        if (cx !== null && cz !== null) {
          if (Math.abs(x - cx) > this.computerRangeXZ) return false;
          if (Math.abs(z - cz) > this.computerRangeXZ) return false;
        }
      }
      const world = useWorldStore();
      for (const id in world.computers) {
        const c = world.computers[id];
        if (c.type === 'minecart' && c.loc?.x === x && c.loc?.y === y && c.loc?.z === z) return false;
      }
      return true;
    },
    addToTransparencyList(blockName: string) {
      const name = blockName.trim();
      if (!name || this.transparencyList.includes(name)) return;
      this.transparencyList.push(name);
      if (this.materials[name]) {
        this.materials[name].transparent = true;
        this.materials[name].opacity = this.transparencyOpacity;
        this.materials[name].needsUpdate = true;
      }
    },
    removeFromTransparencyList(blockName: string) {
      const idx = this.transparencyList.indexOf(blockName);
      if (idx === -1) return;
      this.transparencyList.splice(idx, 1);
      if (this.materials[blockName]) {
        this.materials[blockName].transparent = false;
        this.materials[blockName].opacity = 1;
        this.materials[blockName].needsUpdate = true;
      }
    },
    setTransparencyOpacity(value: number) {
      this.transparencyOpacity = value;
      for (const name of this.transparencyList) {
        if (this.materials[name]) {
          this.materials[name].opacity = value;
          this.materials[name].needsUpdate = true;
        }
      }
    },
    getBlockMaterial(id: string) {
      if (!this.materials[id]) {
        this.materials[id] = new THREE.MeshPhongMaterial({
          color: Math.floor(Math.random() * 0xff00ff),
        });

        const world = useWorldStore();

        const blockTextureAliases: { [id: string]: string } = {
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

          "minecraft:double_stone_slab": "minecraft/stone_slab",
        };

        const applyTexture = (texture: THREE.Texture) => {
          texture.minFilter = THREE.NearestFilter;
          texture.magFilter = THREE.NearestFilter;
          this.materials[id].map = texture;
          this.materials[id].color.setHex(0xffffff);
          const tint = this.blockTint[id];
          if (tint) this.materials[id].color.setHex(tint);
          else if (id.includes('leaves')) this.materials[id].color.setHex(BIOME_TINT);
          if (this.geometryMap[id] === "cross" || id.includes("leaves") || id.includes("sapling") || id.includes("kelp") || id.includes("seagrass"))
            this.materials[id].alphaTest = 1;
          if (this.geometryMap[id] === "cross" || id.includes("sapling") || id.includes("kelp") || id.includes("seagrass"))
            this.materials[id].side = THREE.DoubleSide;
          if (texture.image.width !== texture.image.height)
            this.addAnimatedTexture(texture);
          if (this.transparencyList.includes(id)) {
            this.materials[id].transparent = true;
            this.materials[id].opacity = this.transparencyOpacity;
          }
          this.materials[id].needsUpdate = true;
        };

        const tryFuzzyMatch = (blockId: string) => {
          const mod = blockId.split(':')[0];
          const blockName = blockId.split(':')[1];
          const fuzzy = this.textureIndex.find(f =>
            f.startsWith(mod + '/') && f.includes(blockName)
          );
          if (fuzzy) {
            console.log(`Fuzzy match for ${blockId}: ${fuzzy}`);
            loadTexture(fuzzy.replace('.png', ''));
          } else {
            console.log(`No block texture found for ${blockId}`);
          }
        };

        const loadTexture = (texturePath: string) => {
          const loader = new THREE.TextureLoader();
          const textureUrl = world.textureURL + `blocks/${texturePath}.png`;
          console.log('Loading texture:', textureUrl);
          loader.load(
            textureUrl,
            applyTexture,
            undefined,
            (_err) => {
              if (this.textureIndex.length === 0) {
                // Index not ready yet, queue for retry
                if (!this.textureIndexPending.includes(id))
                  this.textureIndexPending.push(id);
              } else {
                tryFuzzyMatch(id);
              }
            }
          );
        };

        // Load texture index once
        if (this.textureIndex.length === 0 && !this.textureIndexLoading) {
          this.textureIndexLoading = true;
          fetch(world.textureURL + 'texture-index.json')
            .then(r => r.json())
            .then((index: string[]) => {
              this.textureIndex = index;
              // Retry any blocks that failed before index was ready
              for (const failedId of this.textureIndexPending) {
                delete this.materials[failedId];
                this.getBlockMaterial(failedId);
              }
              this.textureIndexPending = [];
            });
        }

        const texturePath = blockTextureAliases[id] ?? id.replace(':', '/');
        loadTexture(texturePath);
      }
      return this.materials[id];
    },
    followComputer(computerId: number) {
      if (computerId === this.followedComputer.computerId) computerId = -1;
      this.followedComputer.computerId = computerId;
      if (computerId === -1) return;
      const world = useWorldStore();
      this.followedComputer.lastPos = world.computers[computerId].loc;
      this.focusOnComputer(computerId);
    },
  },
})