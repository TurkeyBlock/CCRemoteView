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
