import * as THREE from 'three';
import { Block } from '../types/types';
import { useWorldViewStore } from '../store/useWorldView';
import { toRaw } from 'vue';
import { WorldChunk, CHUNK_SIZE, locToChunkKey } from './WorldChunk';
import type { BuildRequest, BuildResult, MaterialMeta, SerializedBlock } from '../workers/chunkBuilder.worker';
import ChunkBuilderWorker from '../workers/chunkBuilder.worker?worker';
import { geometryMap, isNonOccluding, isLiquid } from '../store/blockMaps';

/**
 * Manages the full lifecycle of spatial chunks:
 *   - Partitions the world block map into 16³ WorldChunks
 *   - Fires geometry builds on a Web Worker when a chunk is loaded or dirty
 *   - Loads / unloads chunks based on frustum intersection + render-distance cap
 *   - Debounces incremental block changes so a burst of updates triggers one rebuild
 *
 * The chunk meshes are added directly to `parent` (the `blocks` THREE.Group in Scene.vue).
 */
export class ChunkManager {
  private readonly parent: THREE.Object3D;
  private readonly worker: Worker;

  /** All known chunks keyed by "cx,cy,cz". */
  private chunks = new Map<string, WorldChunk>();

  /** Keys of chunks currently added to the scene. */
  private loadedKeys = new Set<string>();

  /** Keys that need a geometry rebuild. */
  private dirtyKeys = new Set<string>();

  /** Keys currently being built by the worker. */
  private buildingKeys = new Set<string>();

  /** Pending build requests queued while the worker is busy. */
  private buildQueue: string[] = [];

  /** Whether a dirty-chunk sweep has been scheduled. */
  private sweepPending = false;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
    this.worker = new ChunkBuilderWorker();
    this.worker.onmessage = (e: MessageEvent<BuildResult>) => this.onWorkerResult(e.data);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Register a newly placed / received block. Marks the chunk dirty. */
  addBlock(locString: string, block: Block): void {
    const chunk = this.getOrCreate(locToChunkKey(locString));
    chunk.blocks.set(locString, block);
    this.markDirty(chunk.key);
  }

  /** Remove a block and mark the chunk dirty. */
  removeBlock(locString: string): void {
    const key = locToChunkKey(locString);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    chunk.blocks.delete(locString);
    this.markDirty(key);
  }

  /**
   * Partition all world blocks into chunks and kick off an initial build for
   * every chunk that passes the visibility filter.  Yields to the browser
   * between chunk batches so the UI stays responsive.
   */
  async bulkLoad(
    allBlocks: Record<string, Block>,
    isVisible: (locString: string) => boolean,
  ): Promise<void> {
    // Distribute blocks into chunks — pure JS, no Three.js calls.
    for (const [locString, block] of Object.entries(allBlocks)) {
      if (!isVisible(locString)) continue;
      const chunk = this.getOrCreate(locToChunkKey(locString));
      chunk.blocks.set(locString, block);
    }

    // Yield once before kicking off builds.
    await new Promise<void>(r => setTimeout(r, 0));

    // Kick off builds for all non-empty chunks.  The worker queue ensures
    // only one build runs at a time; the rest are queued automatically.
    for (const chunk of this.chunks.values()) {
      if (chunk.blocks.size > 0) {
        this.scheduleBuild(chunk.key);
      }
    }
  }

  /**
   * Called whenever the camera changes.
   *
   * Determines which chunks should be in the scene based on:
   *   1. Distance from the camera target ≤ renderDistanceBlocks
   *   2. The chunk's AABB intersects the camera frustum
   *
   * Chunks entering the set are loaded (built if needed); chunks leaving
   * the set are unloaded (GPU memory freed).
   *
   * @param camera            The active perspective camera.
   * @param cameraTarget      The orbit target (not the camera position itself).
   * @param renderDistanceBlocks  Maximum block-distance from target to load.
   */
  updateVisibility(
    camera: THREE.PerspectiveCamera,
    cameraTarget: THREE.Vector3,
    renderDistanceBlocks: number,
  ): void {
    // Build the current frustum.
    const frustum = new THREE.Frustum();
    const projScreen = new THREE.Matrix4();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);

    const desiredKeys = new Set<string>();

    for (const [key, chunk] of this.chunks) {
      if (chunk.blocks.size === 0) continue;

      // Distance test: use distance from target to the nearest point on the chunk AABB.
      const nearest = new THREE.Vector3();
      chunk.bounds.clampPoint(cameraTarget, nearest);
      if (nearest.distanceTo(cameraTarget) > renderDistanceBlocks) continue;

      // Frustum test: expand the chunk bounds slightly to avoid edge-case pop-in.
      const expandedBounds = chunk.bounds.clone().expandByScalar(CHUNK_SIZE * 0.5);
      if (!frustum.intersectsBox(expandedBounds)) continue;

      desiredKeys.add(key);
    }

    // Unload chunks that are no longer desired.
    for (const key of this.loadedKeys) {
      if (!desiredKeys.has(key)) {
        const chunk = this.chunks.get(key);
        if (chunk) chunk.dispose(this.parent);
        this.loadedKeys.delete(key);
      }
    }

    // Load chunks that just entered the desired set.
    for (const key of desiredKeys) {
      if (!this.loadedKeys.has(key)) {
        this.loadedKeys.add(key);
        const chunk = this.chunks.get(key);
        if (chunk && chunk.state === 'empty') {
          // First time this chunk is becoming visible — build it.
          this.scheduleBuild(key);
        } else if (chunk && chunk.state === 'dirty') {
          this.scheduleBuild(key);
        } else if (chunk) {
          // Already built — just re-add meshes to the scene.
          this.attachMeshes(chunk);
        }
      }
    }
  }

  /** Mark all loaded chunks dirty and trigger a rebuild sweep. */
  invalidateAll(): void {
    for (const key of this.chunks.keys()) {
      this.dirtyKeys.add(key);
    }
    this.scheduleSweep();
  }

  /** Remove all block data and dispose every chunk. */
  clearAll(): void {
    for (const chunk of this.chunks.values()) {
      chunk.dispose(this.parent);
    }
    this.chunks.clear();
    this.loadedKeys.clear();
    this.dirtyKeys.clear();
    this.buildingKeys.clear();
    this.buildQueue.length = 0;
  }

  dispose(): void {
    this.clearAll();
    this.worker.terminate();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private getOrCreate(key: string): WorldChunk {
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new WorldChunk(key);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  private markDirty(key: string): void {
    this.dirtyKeys.add(key);
    this.scheduleSweep();
  }

  private scheduleSweep(): void {
    if (this.sweepPending) return;
    this.sweepPending = true;
    // 50 ms debounce — a burst of block changes collapses into one rebuild pass.
    setTimeout(() => {
      this.sweepPending = false;
      for (const key of this.dirtyKeys) {
        // Only rebuild chunks that are currently loaded/visible.
        if (this.loadedKeys.has(key)) this.scheduleBuild(key);
      }
      this.dirtyKeys.clear();
    }, 50);
  }

  private scheduleBuild(key: string): void {
    if (this.buildingKeys.has(key)) return;
    if (this.buildQueue.includes(key)) return;
    this.buildQueue.push(key);
    this.drainQueue();
  }

  private drainQueue(): void {
    // Simple single-worker model: one build at a time.
    // Extend to a pool by tracking worker-per-key if throughput demands it.
    if (this.buildingKeys.size > 0) return;
    const key = this.buildQueue.shift();
    if (!key) return;
    const chunk = this.chunks.get(key);
    if (!chunk || chunk.blocks.size === 0) {
      this.drainQueue();  // skip empty, try next
      return;
    }
    this.buildingKeys.add(key);
    chunk.state = 'building';
    this.sendBuildRequest(chunk);
  }

  private sendBuildRequest(chunk: WorldChunk): void {
    const worldView = toRaw(useWorldViewStore());

    // ── Build the block-key → local material index map ────────────────────
    // Each unique block type in this chunk gets a sequential local index.
    const matIndices: Record<string, number> = {};
    const matMeta: Record<number, MaterialMeta> = {};
    const localMaterials: THREE.Material[] = [];
    let nextIdx = 0;

    const ensureMat = (name: string, metadata?: number): number => {
      const key = metadata ? `${name}:${metadata}` : name;
      if (matIndices[key] !== undefined) return matIndices[key];
      const idx = nextIdx++;
      matIndices[key] = idx;
      const geomKey = metadata ? key : name;
      const rawGeomId = geometryMap[geomKey] ?? geometryMap[name] ?? 'cube';
      let geomType = rawGeomId;
      if (!geomType || geomType === 'cube') geomType = 'cube';
      // Slab metadata: values ≥ 8 are top slabs
      if (geomType === 'slab_bottom' && (metadata ?? 0) >= 8) geomType = 'slab_top';
      const meta: MaterialMeta = {
        transparent: name.includes('water') || name.includes('glass') || name.includes('ice'),
        liquid: isLiquid(name),
        nonOccluding: isNonOccluding(name),
        geomType,
      };
      matMeta[idx] = meta;
      localMaterials[idx] = worldView.getBlockMaterial(name, metadata ?? 0);
      return idx;
    };

    for (const block of chunk.blocks.values()) {
      ensureMat(block.name, block.metadata);
    }

    // ── Extract border blocks from adjacent chunks ─────────────────────────
    const borderBlocks: Record<string, SerializedBlock> = {};
    const offsets = [
      [1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1],
    ];
    for (const [odx, ody, odz] of offsets) {
      const nKey = `${chunk.cx + odx},${chunk.cy + ody},${chunk.cz + odz}`;
      const neighbor = this.chunks.get(nKey);
      if (!neighbor) continue;
      // Extract only the single-block-thick layer adjacent to this chunk.
      for (const [locString, block] of neighbor.blocks) {
        const [bx, by, bz] = locString.split(',').map(Number);
        // Is this block on the face of its chunk that borders our chunk?
        const lx = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((by % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const lz = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const onFace =
          (odx === 1 && lx === 0) || (odx === -1 && lx === CHUNK_SIZE - 1) ||
          (ody === 1 && ly === 0) || (ody === -1 && ly === CHUNK_SIZE - 1) ||
          (odz === 1 && lz === 0) || (odz === -1 && lz === CHUNK_SIZE - 1);
        if (!onFace) continue;
        borderBlocks[locString] = { name: block.name, metadata: block.metadata };
        ensureMat(block.name, block.metadata);
      }
    }

    // Serialise chunk blocks (plain objects for structured clone / transfer).
    const serializedBlocks: Record<string, SerializedBlock> = {};
    for (const [loc, block] of chunk.blocks) {
      serializedBlocks[loc] = { name: block.name, metadata: block.metadata };
    }

    // Store material array on the chunk so we can use it when applying results.
    (chunk as any).__localMaterials = localMaterials;

    const request: BuildRequest = {
      chunkKey: chunk.key,
      blocks: serializedBlocks,
      borderBlocks,
      matIndices,
      matMeta,
      hiddenNames: worldView.transparencyList,
      yMin: worldView.yMin,
      yMax: worldView.yMax,
    };

    this.worker.postMessage(request);
  }

  private onWorkerResult(result: BuildResult): void {
    const key = result.chunkKey;
    this.buildingKeys.delete(key);

    const chunk = this.chunks.get(key);
    if (!chunk) {
      this.drainQueue();
      return;
    }

    const localMaterials: THREE.Material[] = (chunk as any).__localMaterials ?? [];
    delete (chunk as any).__localMaterials;

    // Dispose old meshes before replacing.
    chunk.dispose(this.parent);

    if (result.opaque) {
      chunk.opaqueMesh = this.buildMesh(result.opaque, localMaterials);
    }
    if (result.transparent) {
      chunk.transparentMesh = this.buildMesh(result.transparent, localMaterials);
    }

    chunk.state = 'ready';

    // Only add to scene if this chunk is in the loaded set.
    if (this.loadedKeys.has(key)) {
      this.attachMeshes(chunk);
    }

    this.drainQueue();
  }

  private buildMesh(
    geo: BuildResult['opaque'],
    materials: THREE.Material[],
  ): THREE.Mesh {
    if (!geo) throw new Error('buildMesh called with null geometry');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
    geometry.setAttribute('normal',   new THREE.BufferAttribute(geo.normals,   3));
    geometry.setAttribute('uv',       new THREE.BufferAttribute(geo.uvs,       2));
    geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));
    for (const g of geo.groups) {
      geometry.addGroup(g.start, g.count, g.materialIndex);
    }
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.frustumCulled = true;  // bounding sphere is now correct
    return mesh;
  }

  private attachMeshes(chunk: WorldChunk): void {
    if (chunk.opaqueMesh && !chunk.opaqueMesh.parent) {
      this.parent.add(chunk.opaqueMesh);
    }
    if (chunk.transparentMesh && !chunk.transparentMesh.parent) {
      this.parent.add(chunk.transparentMesh);
    }
  }
}
