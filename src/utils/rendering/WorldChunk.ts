import * as THREE from 'three';
import { Block } from '@/types/world';

export const CHUNK_SIZE = 16;

/** Converts a block locString to its chunk key "cx,cy,cz". */
export function locToChunkKey(locString: string): string {
  const [x, y, z] = locString.split(',').map(Number);
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}

/** Converts chunk coords back to the world-space minimum corner of that chunk. */
export function chunkKeyToWorldMin(key: string): THREE.Vector3 {
  const [cx, cy, cz] = key.split(',').map(Number);
  return new THREE.Vector3(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
}

export type ChunkState = 'empty' | 'building' | 'ready' | 'dirty';

/** Per-face direction layers — one Map per chunk face. */
export interface FaceLayers {
  px: Map<string, Block>;
  nx: Map<string, Block>;
  py: Map<string, Block>;
  ny: Map<string, Block>;
  pz: Map<string, Block>;
  nz: Map<string, Block>;
}

/**
 * Holds the render state for one 16×16×16 region of the world.
 *
 * Blocks are stored in a plain Map so the build worker can serialise them
 * without touching React reactivity.  The Three.js meshes are owned here so
 * disposal is co-located with the data.
 */
export class WorldChunk {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly bounds: THREE.Box3;
  /** Expanded column bounds used for frustum culling — pre-computed once at construction. */
  readonly columnBounds: THREE.Box3;

  state: ChunkState = 'empty';

  /** All blocks that fall inside this chunk's world-space volume. */
  blocks = new Map<string, Block>();

  /**
   * Per-face subsets of `blocks` — the single-block-thick layer along each face
   * of the chunk. A corner block may appear in up to 3 face maps. Kept in sync
   * with `blocks` via `setBlock`/`deleteBlock`. Used by ChunkManager to gather
   * neighbour border blocks without scanning the neighbour's full block map.
   */
  readonly faceLayers: FaceLayers = {
    px: new Map<string, Block>(),
    nx: new Map<string, Block>(),
    py: new Map<string, Block>(),
    ny: new Map<string, Block>(),
    pz: new Map<string, Block>(),
    nz: new Map<string, Block>(),
  };

  /** Merged opaque-face geometry — one Mesh, one material group per block type. */
  opaqueMesh: THREE.Mesh | null = null;

  /** Merged transparent-face geometry (water, etc.) */
  transparentMesh: THREE.Mesh | null = null;

  constructor(key: string) {
    this.key = key;
    const [cx, cy, cz] = key.split(',').map(Number);
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    const min = new THREE.Vector3(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
    const max = min.clone().addScalar(CHUNK_SIZE);
    this.bounds = new THREE.Box3(min, max);
    const m = CHUNK_SIZE / 2;
    this.columnBounds = new THREE.Box3(
      new THREE.Vector3(min.x - m, -512, min.z - m),
      new THREE.Vector3(max.x + m,  512, max.z + m),
    );
  }

  /**
   * Insert or update a block. Maintains `blocks` and `faceLayers` together —
   * all writes to chunk block storage must go through this (or `deleteBlock`).
   */
  setBlock(locString: string, block: Block): void {
    this.blocks.set(locString, block);
    // Parse local coords. Use the same modulo-normalisation as locToChunkKey so
    // negative world coords map to [0, CHUNK_SIZE-1] consistently.
    const comma1 = locString.indexOf(',');
    const comma2 = locString.indexOf(',', comma1 + 1);
    const x = +locString.slice(0, comma1);
    const y = +locString.slice(comma1 + 1, comma2);
    const z = +locString.slice(comma2 + 1);
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const fl = this.faceLayers;
    // A corner can land in up to 3 face maps. Always set (covers update path).
    if (lx === 0)              fl.nx.set(locString, block); else fl.nx.delete(locString);
    if (lx === CHUNK_SIZE - 1) fl.px.set(locString, block); else fl.px.delete(locString);
    if (ly === 0)              fl.ny.set(locString, block); else fl.ny.delete(locString);
    if (ly === CHUNK_SIZE - 1) fl.py.set(locString, block); else fl.py.delete(locString);
    if (lz === 0)              fl.nz.set(locString, block); else fl.nz.delete(locString);
    if (lz === CHUNK_SIZE - 1) fl.pz.set(locString, block); else fl.pz.delete(locString);
  }

  /** Remove a block from `blocks` and from any face layers that contained it. */
  deleteBlock(locString: string): void {
    if (!this.blocks.delete(locString)) return;
    const fl = this.faceLayers;
    fl.px.delete(locString);
    fl.nx.delete(locString);
    fl.py.delete(locString);
    fl.ny.delete(locString);
    fl.pz.delete(locString);
    fl.nz.delete(locString);
  }

  /** Remove meshes from the scene and free GPU memory. */
  dispose(parent: THREE.Object3D): void {
    if (this.opaqueMesh) {
      parent.remove(this.opaqueMesh);
      this.opaqueMesh.geometry.dispose();
      this.opaqueMesh = null;
    }
    if (this.transparentMesh) {
      parent.remove(this.transparentMesh);
      this.transparentMesh.geometry.dispose();
      this.transparentMesh = null;
    }
    this.state = 'empty';
  }
}
