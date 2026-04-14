import { defineStore } from 'pinia'
import * as THREE from "three";
import { Block, Inventory, EntitySighting } from '../types/types';
import { useWorldStore } from './useWorld';
import { geometryMap, textureAliases, blockTint, BIOME_TINT } from './blockMaps';

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
    yMin: 0 as number,
    yMax: 255 as number,
    computerRangeXZ: null as number | null,
    textureIndex: [] as string[],
    textureIndexLoading: false as boolean,
    textureIndexPending: [] as string[],
  }),
  getters: {

  },
  actions: {
    isBlockVisible(locString: string): boolean {
      const [x, y, z] = locString.split(',').map(Number);
      if (y < this.yMin || y > this.yMax) return false;
      const world = useWorldStore();
      const block = world.blocks[locString];
      if (block && this.transparencyList.includes(block.name)) return false;
      if (this.computerRangeXZ !== null) {
        let cx: number | null = null, cz: number | null = null;
        if (this.selectedComputerId !== -1) {
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
      this.regenerateSceneFromBlocks();
    },
    removeFromTransparencyList(blockName: string) {
      const idx = this.transparencyList.indexOf(blockName);
      if (idx === -1) return;
      this.transparencyList.splice(idx, 1);
      this.regenerateSceneFromBlocks();
    },
    getBlockMaterial(name: string, metadata: number = 0) {
      // Cache key includes metadata when non-zero: "minecraft:wool:1"
      const id = metadata ? `${name}:${metadata}` : name;
      if (!this.materials[id]) {
        this.materials[id] = new THREE.MeshPhongMaterial({
          color: Math.floor(Math.random() * 0xff00ff),
        });

        const world = useWorldStore();


        const applyTexture = (texture: THREE.Texture) => {
          texture.minFilter = THREE.NearestFilter;
          texture.magFilter = THREE.NearestFilter;
          this.materials[id].map = texture;
          this.materials[id].color.setHex(0xffffff);
          // Check tint by full key first, then by name
          const tint = blockTint[id] ?? blockTint[name];
          if (tint) this.materials[id].color.setHex(tint);
          else if (name.includes('leaves')) this.materials[id].color.setHex(BIOME_TINT);
          // Check geometry type by full key first, then by name
          const geomId = geometryMap[id] ?? geometryMap[name];
          if (geomId === "cross" || geomId === "flat" || name.includes("leaves") || name.includes("sapling") || name.includes("kelp") || name.includes("seagrass"))
            this.materials[id].alphaTest = 1;
          if (geomId === "cross" || geomId === "flat" || name.includes("sapling") || name.includes("kelp") || name.includes("seagrass"))
            this.materials[id].side = THREE.DoubleSide;
          if (name.includes("water")) {
            this.materials[id].transparent = true;
            this.materials[id].opacity = 0.55;
            this.materials[id].depthWrite = false;
          }
          if (geomId === "flat") {
            // Flat geometry sits coplanar with the top face of the block below.
            // polygonOffset nudges the depth value toward the camera so the flat
            // block consistently wins the depth test without visually moving.
            this.materials[id].polygonOffset = true;
            this.materials[id].polygonOffsetFactor = -1;
            this.materials[id].polygonOffsetUnits = -4;
          }
          if (texture.image.width !== texture.image.height)
            this.addAnimatedTexture(texture);
          this.materials[id].needsUpdate = true;
        };

        const tryFuzzyMatch = () => {
          // Always fuzzy-match on the block name, not the metadata key
          const mod = name.split(':')[0];
          const blockName = name.split(':')[1];
          const fuzzy = this.textureIndex.find(f =>
            f.startsWith(mod + '/') && f.includes(blockName)
          );
          if (fuzzy) {
            console.log(`Fuzzy match for ${id}: ${fuzzy}`);
            loadTexture(fuzzy.replace('.png', ''));
          } else {
            console.log(`No block texture found for ${id}`);
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
                tryFuzzyMatch();
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
                // Parse "name:metadata" key back into separate args
                const lastColon = failedId.lastIndexOf(':');
                const afterColon = failedId.slice(lastColon + 1);
                if (lastColon !== -1 && !isNaN(Number(afterColon))) {
                  this.getBlockMaterial(failedId.slice(0, lastColon), Number(afterColon));
                } else {
                  this.getBlockMaterial(failedId);
                }
              }
              this.textureIndexPending = [];
            });
        }

        // Try alias by full key (e.g. "minecraft:wool:1") then by name, then derive from name
        const texturePath = textureAliases[id] ?? textureAliases[name] ?? name.replace(':', '/');
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