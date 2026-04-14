import { BoxGeometry, BufferGeometry, Mesh, Object3D, PlaneGeometry } from "three";
import { useWorldStore } from "../store/useWorld";
import { useWorldViewStore } from "../store/useWorldView";
import { Block } from "../types/types";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import DynamicInstancedMesh from "./DynamicInstancedMesh";
import { geometryMap, isNonOccluding } from "../store/blockMaps";

// The 6 axis-aligned face directions and their neighbour offsets
const FACE_DIRS = [
  { key: 'px', dx:  1, dy:  0, dz:  0 },
  { key: 'nx', dx: -1, dy:  0, dz:  0 },
  { key: 'py', dx:  0, dy:  1, dz:  0 },
  { key: 'ny', dx:  0, dy: -1, dz:  0 },
  { key: 'pz', dx:  0, dy:  0, dz:  1 },
  { key: 'nz', dx:  0, dy:  0, dz: -1 },
] as const;

const OPPOSITE_FACE: Record<string, string> = {
  px: 'nx', nx: 'px',
  py: 'ny', ny: 'py',
  pz: 'nz', nz: 'pz',
};

class BlockRenderStructure {
  meshArray: DynamicInstancedMesh[];
  blockToMeshIdxMap = {} as { [key: string]: number };
  defaultInstanceCount = 16;

  // Geometries
  boxGeometry: BoxGeometry;
  /** One PlaneGeometry per face direction, offset ±0.5 from block centre */
  faceGeometries: Record<string, PlaneGeometry>;
  flatGeometry: PlaneGeometry;
  bottomSlabGeometry: BoxGeometry;
  topSlabGeometry: BoxGeometry;
  geometryCache = {} as { [geometryId: string]: BufferGeometry | Promise<void> | null };

  constructor(parentSceneObject: Object3D) {
    this.meshArray = parentSceneObject.children as DynamicInstancedMesh[];
    this.boxGeometry = new BoxGeometry();

    // Build six face-plane geometries.
    // PlaneGeometry default: 1×1, normal facing +Z, centred at origin.
    const px = new PlaneGeometry(1, 1); px.rotateY( Math.PI / 2);  px.translate( 0.5,  0,    0);
    const nx = new PlaneGeometry(1, 1); nx.rotateY(-Math.PI / 2);  nx.translate(-0.5,  0,    0);
    const py = new PlaneGeometry(1, 1); py.rotateX(-Math.PI / 2);  py.translate( 0,    0.5,  0);
    const ny = new PlaneGeometry(1, 1); ny.rotateX( Math.PI / 2);  ny.translate( 0,   -0.5,  0);
    const pz = new PlaneGeometry(1, 1);                             pz.translate( 0,    0,    0.5);
    const nz = new PlaneGeometry(1, 1); nz.rotateY( Math.PI);      nz.translate( 0,    0,   -0.5);
    this.faceGeometries = { px, nx, py, ny, pz, nz };

    this.flatGeometry = new PlaneGeometry(1, 1);
    this.flatGeometry.rotateX(-Math.PI / 2);
    this.flatGeometry.translate(0, -0.5, 0);
    this.bottomSlabGeometry = new BoxGeometry(1, 0.5, 1);
    this.bottomSlabGeometry.translate(0, -0.25, 0);
    this.topSlabGeometry = new BoxGeometry(1, 0.5, 1);
    this.topSlabGeometry.translate(0, 0.25, 0);
  }

  blockKey(block: Block): string {
    return block.metadata ? `${block.name}:${block.metadata}` : block.name;
  }

  // Returns true if this block type should use per-face culled rendering.
  // Only full cubes qualify; slabs, plants, custom GLTFs etc. use the legacy path.
  private isCubeBlock(block: Block): boolean {
    const key = this.blockKey(block);
    const geomId = geometryMap[key] ?? geometryMap[block.name];
    return !geomId || geomId === 'cube';
  }

  // Returns true if the block at locString is a solid cube that occludes adjacent faces.
  private isSolid(locString: string): boolean {
    const world = useWorldStore();
    const block = world.blocks[locString];
    if (!block) return false;
    if (!this.isCubeBlock(block) || isNonOccluding(block.name)) return false;
    const worldView = useWorldViewStore();
    if (worldView.transparencyList.includes(block.name) && worldView.transparencyOpacity < 1) return false;
    return true;
  }

  // Returns (and if necessary creates) the DynamicInstancedMesh for a block+face pair.
  private getFaceMesh(block: Block, faceKey: string): DynamicInstancedMesh {
    const worldView = useWorldViewStore();
    const meshKey = `${this.blockKey(block)}:${faceKey}`;

    let idx = this.blockToMeshIdxMap[meshKey];
    if (idx === undefined) {
      const mesh = new DynamicInstancedMesh(
        this.faceGeometries[faceKey],
        worldView.getBlockMaterial(block.name, block.metadata),
      );
      idx = this.meshArray.push(mesh) - 1;
      this.blockToMeshIdxMap[meshKey] = idx;
    }

    // Grow the instanced mesh if it is full
    let mesh = this.meshArray[idx];
    if (mesh.count === mesh.maxInstanceCount) {
      const old = mesh;
      mesh = new DynamicInstancedMesh(
        old.geometry,
        worldView.getBlockMaterial(block.name, block.metadata),
        old.count * 2,
      );
      mesh.setFromDynamicInstancedMesh(old);
      this.meshArray[idx] = mesh;
    }
    return this.meshArray[idx];
  }

  addBlock(locString: string, block: Block) {
    if (!block || !locString) throw new Error(`Given block is ${block}`);

    if (!this.isCubeBlock(block)) {
      this.addNonCubeBlock(locString, block);
      return;
    }

    const [x, y, z] = locString.split(',').map(Number);

    // Add only the faces that are not occluded by a solid neighbour
    for (const { key, dx, dy, dz } of FACE_DIRS) {
      const neighbourLoc = `${x + dx},${y + dy},${z + dz}`;
      if (!this.isSolid(neighbourLoc)) {
        this.getFaceMesh(block, key).addBlock(locString, block);
      }
    }

    // Only hide neighbour faces when this block itself occludes
    if (this.isSolid(locString)) {
      const world = useWorldStore();
      for (const { key, dx, dy, dz } of FACE_DIRS) {
        const neighbourLoc = `${x + dx},${y + dy},${z + dz}`;
        const neighbour = world.blocks[neighbourLoc];
        if (neighbour && this.isCubeBlock(neighbour) && !isNonOccluding(neighbour.name)) {
          const oppFace = OPPOSITE_FACE[key];
          const meshIdx = this.blockToMeshIdxMap[`${this.blockKey(neighbour)}:${oppFace}`];
          if (meshIdx !== undefined) this.meshArray[meshIdx].removeBlock(neighbourLoc);
        }
      }
    }
  }

  removeBlock(locString: string) {
    const world = useWorldStore();
    const block = world.blocks[locString];
    if (!block) return;

    if (!this.isCubeBlock(block)) {
      const idx = this.blockToMeshIdxMap[this.blockKey(block)];
      if (idx !== undefined) this.meshArray[idx].removeBlock(locString);
      return;
    }

    // Remove all six face instances for this block
    for (const { key } of FACE_DIRS) {
      const meshIdx = this.blockToMeshIdxMap[`${this.blockKey(block)}:${key}`];
      if (meshIdx !== undefined) this.meshArray[meshIdx].removeBlock(locString);
    }

    // Re-expose neighbour faces that were hidden behind this block
    const [x, y, z] = locString.split(',').map(Number);
    for (const { key, dx, dy, dz } of FACE_DIRS) {
      const neighbourLoc = `${x + dx},${y + dy},${z + dz}`;
      const neighbour = world.blocks[neighbourLoc];
      if (neighbour && this.isCubeBlock(neighbour)) {
        this.getFaceMesh(neighbour, OPPOSITE_FACE[key]).addBlock(neighbourLoc, neighbour);
      }
    }
  }

  // Legacy full-geometry rendering for non-cube blocks (slabs, plants, custom GLTFs…)
  private addNonCubeBlock(locString: string, block: Block) {
    const worldView = useWorldViewStore();
    const key = this.blockKey(block);

    let idx = this.blockToMeshIdxMap[key];
    if (idx === undefined) {
      const mesh = new DynamicInstancedMesh(
        this.getBlockGeometry(block),
        worldView.getBlockMaterial(block.name, block.metadata),
      );
      idx = this.meshArray.push(mesh) - 1;
      this.blockToMeshIdxMap[key] = idx;
    }
    idx = this.blockToMeshIdxMap[key];
    let mesh = this.meshArray[idx];
    if (mesh.count === mesh.maxInstanceCount) {
      const old = mesh;
      mesh = new DynamicInstancedMesh(
        old.geometry,
        worldView.getBlockMaterial(block.name, block.metadata),
        old.count * 2,
      );
      mesh.setFromDynamicInstancedMesh(old);
      this.meshArray[idx] = mesh;
    }
    mesh.addBlock(locString, block);
  }

  /**
   * Efficient initial load for a large block set.
   *
   * Instead of the per-block addBlock path (which adds then immediately removes
   * neighbour faces as interior blocks arrive), this does two cheap passes:
   *   1. A synchronous forward pass over every visible block to collect which
   *      faces are exposed.  No Three.js calls, just hash lookups.
   *   2. An async mesh-building pass that creates each DynamicInstancedMesh at
   *      the correct pre-allocated size and populates it, yielding to the browser
   *      every CHUNK_SIZE instances so the UI stays responsive.
   *
   * @param blocks   The full world block dictionary (world.blocks).
   * @param isVisible  Visibility filter — same predicate used by the scene loop.
   */
  async bulkLoadBlocks(
    blocks: { [locString: string]: Block },
    isVisible: (locString: string) => boolean,
  ) {
    const worldView = useWorldViewStore();
    const CHUNK_SIZE = 3000;

    // Yield immediately so the caller's isLoading = false fires and the
    // browser repaints before any work starts.  Without this, Phase 1 runs
    // synchronously inside the caller's stack frame — the loading overlay
    // stays up until the first await deep in Phase 2.
    await new Promise<void>(r => setTimeout(r, 0));

    // ── Phase 1: collect face instances per mesh key (no Three.js calls) ──────
    // meshKey → array of locStrings that need an instance in that mesh
    const facesByKey = new Map<string, string[]>();
    // meshKey → {block, optional faceDir} for geometry/material lookup
    const keyMeta   = new Map<string, { block: Block; faceDir?: string }>();

    let phase1Count = 0;
    for (const locString in blocks) {
      if (!isVisible(locString)) continue;
      const block = blocks[locString];

      // Yield periodically so the render loop can fire between chunks.
      if (++phase1Count % CHUNK_SIZE === 0) {
        await new Promise<void>(r => setTimeout(r, 0));
      }

      if (!this.isCubeBlock(block)) {
        // Non-cube blocks use a single legacy mesh, keyed by block type only.
        const key = this.blockKey(block);
        if (!facesByKey.has(key)) { facesByKey.set(key, []); keyMeta.set(key, { block }); }
        facesByKey.get(key)!.push(locString);
        continue;
      }

      const parts = locString.split(',');
      const x = +parts[0], y = +parts[1], z = +parts[2];

      for (const { key: faceDir, dx, dy, dz } of FACE_DIRS) {
        const nLoc = `${x + dx},${y + dy},${z + dz}`;
        // Occluded if a solid opaque cube occupies the neighbour slot.
        if (this.isSolid(nLoc)) continue;

        const meshKey = `${this.blockKey(block)}:${faceDir}`;
        if (!facesByKey.has(meshKey)) { facesByKey.set(meshKey, []); keyMeta.set(meshKey, { block, faceDir }); }
        facesByKey.get(meshKey)!.push(locString);
      }
    }

    // ── Phase 2: build meshes in async chunks ─────────────────────────────────
    let instancesThisChunk = 0;

    for (const [meshKey, locStrings] of facesByKey) {
      const { block, faceDir } = keyMeta.get(meshKey)!;
      const geometry = faceDir
        ? this.faceGeometries[faceDir]
        : this.getBlockGeometry(block);
      const material = worldView.getBlockMaterial(block.name, block.metadata);

      // Pre-allocate at exact capacity — no doubling during bulk load.
      const mesh = new DynamicInstancedMesh(geometry, material, Math.max(locStrings.length, 1));
      const idx = this.meshArray.push(mesh) - 1;
      this.blockToMeshIdxMap[meshKey] = idx;

      for (const loc of locStrings) {
        mesh.addBlock(loc, blocks[loc]);
        instancesThisChunk++;
        if (instancesThisChunk >= CHUNK_SIZE) {
          instancesThisChunk = 0;
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }
    }
  }

  clearAll() {
    for (const mesh of this.meshArray) {
      mesh.clearAll();
    }
  }

  getBlockGeometry(block: Block): BufferGeometry {
    const key = this.blockKey(block);
    let geometryId = geometryMap[key] ?? geometryMap[block.name];
    if (!geometryId && (
      block.name.includes("sapling") ||
      block.name.includes("kelp") ||
      block.name.includes("seagrass") ||
      block.name.includes("magrove_root")
    )) geometryId = "cross";
    if (!geometryId || geometryId === "cube") return this.boxGeometry;
    if (geometryId === "flat") return this.flatGeometry;
    if (geometryId === "slab_bottom") return (block.metadata ?? 0) >= 8 ? this.topSlabGeometry : this.bottomSlabGeometry;
    if (geometryId === "slab_top") return this.topSlabGeometry;

    if (!this.geometryCache[geometryId]) {
      const loader = new GLTFLoader();
      const promise = loader.loadAsync(`textures/turtle/${geometryId}.glb`)
        .then((gltf) => gltf.scene.traverse((child) => {
          /* @ts-ignore */
          if (child.isMesh) {
            this.geometryCache[geometryId] = (child as Mesh).geometry;
            console.log("geometry request response:", this.geometryCache);
          }
        }));
      promise.catch((error) => {
        console.error(error);
        this.geometryCache[geometryId] = null;
      });
      this.geometryCache[geometryId] = promise;
    }

    const geometryOrPromise: BufferGeometry | Promise<void> | null = this.geometryCache[geometryId];
    if (geometryOrPromise === null) return this.boxGeometry;

    /* @ts-ignore */
    if (geometryOrPromise.catch) {
      console.log("geometry is being requested - returning box geometry");
      /* @ts-ignore */
      geometryOrPromise.then(() => {
        const geometry = this.geometryCache[geometryId];
        console.log(`geometry request done — geometryId=${geometryId} block=${key}`);
        if (geometry) {
          const meshIdx = this.blockToMeshIdxMap[key];
          if (meshIdx !== undefined) {
            console.log(`geometry swap: geometryId=${geometryId} block=${key}`);
            this.meshArray[meshIdx].geometry = geometry as BufferGeometry;
          }
        }
      });
      return this.boxGeometry;
    }
    return geometryOrPromise as BufferGeometry;
  }
}

export default BlockRenderStructure;
