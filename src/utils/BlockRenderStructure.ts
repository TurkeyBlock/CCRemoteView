import { BoxGeometry, BufferGeometry, Mesh, Object3D, PlaneGeometry } from "three";
import { useWorldStore } from "../store/useWorld";
import { useWorldViewStore } from "../store/useWorldView";
import { Block } from "../types/types";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import DynamicInstancedMesh from "./DynamicInstancedMesh";

class BlockRenderStructure {
  meshArray: DynamicInstancedMesh[];
  blockToMeshIdxMap = {} as { [blockId: string]: number };
  defaultInstanceCount = 16;
  boxGeometry: BoxGeometry;
  flatGeometry: PlaneGeometry;
  bottomSlabGeometry: BoxGeometry;
  topSlabGeometry: BoxGeometry;
  geometryCache = {} as { [geometryId: string]: BufferGeometry | Promise<void> | null };

  constructor(parentSceneObject: Object3D) {
    this.meshArray = parentSceneObject.children as DynamicInstancedMesh[];
    this.boxGeometry = new BoxGeometry();
    this.flatGeometry = new PlaneGeometry(1, 1);
    this.flatGeometry.rotateX(-Math.PI / 2); // Lie flat in XZ plane
    this.flatGeometry.translate(0, -0.5, 0); // Sit at the bottom of the block space
    this.bottomSlabGeometry = new BoxGeometry(1, 0.5, 1);
    this.bottomSlabGeometry.translate(0, -0.25, 0); // Occupies the lower half of the block space
    this.topSlabGeometry = new BoxGeometry(1, 0.5, 1);
    this.topSlabGeometry.translate(0, 0.25, 0); // Occupies the upper half of the block space
  }

  addBlock(locString: string, block: Block) {
    if (!block || !locString) throw new Error(`Given block is ${block}`);
    const worldView = useWorldViewStore();

    let instMeshIdx = this.blockToMeshIdxMap[block.name];
    if (instMeshIdx === undefined) {
      let newMesh = new DynamicInstancedMesh(this.getBlockGeometry(block), worldView.getBlockMaterial(block.name));
      instMeshIdx = this.meshArray.push(newMesh) - 1;
      this.blockToMeshIdxMap[block.name] = instMeshIdx;
    }
    instMeshIdx = this.blockToMeshIdxMap[block.name];
    let mesh = this.meshArray[instMeshIdx];

    if (mesh.count == mesh.maxInstanceCount) {
      const oldMesh = mesh;
      mesh = new DynamicInstancedMesh(oldMesh.geometry, worldView.getBlockMaterial(block.name), oldMesh.count * 2);
      mesh.setFromDynamicInstancedMesh(oldMesh);
      this.meshArray[instMeshIdx] = mesh;
    }

    mesh.addBlock(locString, block);
  }

  removeBlock(locString: string) {
    const world = useWorldStore();
    const block = world.blocks[locString];
    if (!block) return;
    let instMeshIdx = this.blockToMeshIdxMap[block.name];
    if (instMeshIdx === undefined) return;
    this.meshArray[instMeshIdx].removeBlock(locString);
  }

  clearAll() {
    for (const mesh of this.meshArray) {
      mesh.clearAll();
    }
  }

  getBlockGeometry(block: Block): BufferGeometry {
    const worldView = useWorldViewStore();
    let geometryId = worldView.geometryMap[block.name];
    if (!geometryId && (block.name.includes("sapling") || block.name.includes("kelp") || block.name.includes("seagrass") || block.name.includes("magrove_root"))) geometryId = "cross";
    if (!geometryId || geometryId === "cube") return this.boxGeometry;
    if (geometryId === "flat") return this.flatGeometry;
    if (geometryId === "slab_bottom") return this.bottomSlabGeometry;
    if (geometryId === "slab_top") return this.topSlabGeometry;

    if (!this.geometryCache[geometryId]) {
      const loader = new GLTFLoader();
      const blockName = block.name; // capture for closure

      const promise = loader.loadAsync(`textures/turtle/${geometryId}.glb`)
        .then((gltf) => gltf.scene.traverse((child) => {
          /* @ts-ignore */
          if (child.isMesh) {
            this.geometryCache[geometryId] = (child as Mesh).geometry;
            console.log("geometry request response:", this.geometryCache);
          }
        }))
      promise.catch((error) => {
        console.error(error);
        this.geometryCache[geometryId] = null;
      });
      this.geometryCache[geometryId] = promise;
    }

    let geometryOrPromise: BufferGeometry | Promise<void> | null = this.geometryCache[geometryId];
    if (geometryOrPromise === null) return this.boxGeometry;

    /* @ts-ignore */
    if (geometryOrPromise.catch) {
      console.log("geometry is being requested - returning box geometry");
      /* @ts-ignore */
      geometryOrPromise.then(() => {
        const geometry = this.geometryCache[geometryId];
        console.log(`geometry request done — geometryId=${geometryId} block=${block.name}`);
        if (geometry) {
          const meshIdx = this.blockToMeshIdxMap[block.name];
          if (meshIdx !== undefined) {
            console.log(`geometry swap: geometryId=${geometryId} block=${block.name}`);
            this.meshArray[meshIdx].geometry = geometry as BufferGeometry;
          }
        }
      });
      return this.boxGeometry;
    } else {
      console.log("geometry is already cached");
      return geometryOrPromise as BufferGeometry;
    }
  }
}

export default BlockRenderStructure;