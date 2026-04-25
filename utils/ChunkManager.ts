import * as THREE from 'three';
import { Block } from '@/types/types';
import { useWorldViewStore } from '@/store/useWorldView';
import { WorldChunk, CHUNK_SIZE, locToChunkKey } from './WorldChunk';
import type { BuildRequest, BuildResult, MaterialMeta, SerializedBlock } from '@/workers/chunkBuilder.worker';
import { geometryMap, isNonOccluding, isLiquid } from '@/store/blockMaps';

/**
 * Manages the full lifecycle of spatial chunks:
 *   - Partitions the world block map into 16³ WorldChunks
 *   - Fires geometry builds on a Web Worker when a chunk is loaded or dirty
 *   - Loads / unloads chunks based on frustum intersection + render-distance cap
 *   - Debounces incremental block changes so a burst of updates triggers one rebuild
 *
 * The chunk meshes are added directly to `parent` (the `blocks` THREE.Group in Scene.tsx).
 */
export class ChunkManager {
  private readonly parent: THREE.Object3D;
  private readonly workers: Worker[];
  private readonly workerBusy: boolean[];
  private readonly maxConcurrent: number;
  private readonly onChunkReady?: () => void;

  /** All known chunks keyed by "cx,cy,cz". */
  private chunks = new Map<string, WorldChunk>();

  /** Keys of chunks currently added to the scene. */
  private loadedKeys = new Set<string>();

  /** Keys that need a geometry rebuild. */
  private dirtyKeys = new Set<string>();

  /** Keys currently being built by the worker pool. */
  private buildingKeys = new Set<string>();

  /** Pending build requests queued while all workers are busy. */
  private buildQueue: string[] = [];
  /** Set mirror of buildQueue for O(1) deduplication. */
  private buildQueueSet = new Set<string>();

  /** Whether a dirty-chunk sweep has been scheduled. */
  private sweepPending = false;

  /** Worker results waiting to be applied to the scene. */
  private pendingResults: BuildResult[] = [];

  /** Materials for each in-flight build, keyed by buildId. */
  private readonly _buildMaterials = new Map<number, THREE.Material[]>();
  private _nextBuildId = 0;

  /** Debounce timer for chunk load/unload — avoids thrashing during camera rotation. */
  private _visibilityDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastVisibilityArgs: {
    camera: THREE.PerspectiveCamera;
    cameraTarget: THREE.Vector3;
    renderDistanceBlocks: number;
    lockChunks: boolean;
  } | null = null;

  // Reusable objects for updateVisibility — allocated once, mutated each call.
  private readonly _frustum = new THREE.Frustum();
  private readonly _projScreen = new THREE.Matrix4();

  /**
   * @param parent     The Three.js group to attach chunk meshes to.
   * @param fastRender When true, spawns one worker per logical CPU core
   *                   (minus one reserved for the main thread) so chunks
   *                   build in parallel.  Faster load at the cost of higher
   *                   CPU usage during the initial build burst.
   */
  constructor(parent: THREE.Object3D, fastRender = false, onChunkReady?: () => void) {
    this.parent = parent;
    this.onChunkReady = onChunkReady;
    this.maxConcurrent = fastRender
      ? Math.max(2, (navigator.hardwareConcurrency ?? 4) - 1)
      : 1;
    this.workers = [];
    this.workerBusy = [];
    for (let i = 0; i < this.maxConcurrent; i++) {
      const w = new Worker(new URL('../workers/chunkBuilder.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<BuildResult>) => this.onWorkerResult(e.data);
      this.workers.push(w);
      this.workerBusy.push(false);
    }
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
   * every chunk that passes the visibility filter.
   *
   * @param skipYield When false (default) a single `setTimeout(0)` yield is
   *                  inserted before dispatching builds so the browser can
   *                  paint a frame and stay interactive.  Set to true to skip
   *                  that pause for the fastest possible load at the cost of a
   *                  brief UI freeze.
   */
  async bulkLoad(
    allBlocks: Record<string, Block>,
    isVisible: (locString: string) => boolean,
    skipYield = false,
  ): Promise<void> {
    // Distribute blocks into chunks — pure JS, no Three.js calls.
    // for...in avoids materialising a full Object.entries() array for large worlds.
    for (const locString in allBlocks) {
      if (!isVisible(locString)) continue;
      const chunk = this.getOrCreate(locToChunkKey(locString));
      chunk.blocks.set(locString, allBlocks[locString]);
    }

    // Yield once so the browser can paint before the build queue fires.
    // Skipping this makes loads faster but briefly freezes the UI.
    if (!skipYield) await new Promise<void>(r => setTimeout(r, 0));

    // Don't pre-build everything here.  updateVisibility() triggers builds
    // only for chunks that are actually within the render distance and frustum,
    // so distant chunks never waste worker time until the camera approaches them.
  }

  /**
   * Called whenever the camera changes.
   *
   * Determines which chunks should be in the scene based on:
   *   1. Distance from the camera target ≤ renderDistanceBlocks
   *   2. The chunk's AABB intersects the camera frustum
   *
   * Chunks entering the set are loaded (built if needed); chunks leaving
   * the set are unloaded (GPU memory freed) unless lockChunks is true.
   *
   * @param camera            The active perspective camera.
   * @param cameraTarget      The orbit target (not the camera position itself).
   * @param renderDistanceBlocks  Maximum block-distance from target to load.
   * @param lockChunks        When true, skip the unload pass so loaded chunks
   *                          accumulate permanently for the session.
   */
  updateVisibility(
    camera: THREE.PerspectiveCamera,
    cameraTarget: THREE.Vector3,
    renderDistanceBlocks: number,
    lockChunks = false,
  ): void {
    // Always capture the latest args — if multiple calls arrive while the timer
    // is pending, the debounced apply will use the most recent camera state.
    this._lastVisibilityArgs = { camera, cameraTarget, renderDistanceBlocks, lockChunks };
    if (this._visibilityDebounceTimer !== null) return;
    this._visibilityDebounceTimer = setTimeout(() => {
      this._visibilityDebounceTimer = null;
      if (this._lastVisibilityArgs) this._applyVisibility(this._lastVisibilityArgs);
    }, 150);
  }

  private _applyVisibility({
    camera,
    cameraTarget,
    renderDistanceBlocks,
    lockChunks,
  }: NonNullable<ChunkManager['_lastVisibilityArgs']>): void {
    // Force-update camera matrices before building the frustum.
    // camera-controls fires its 'update' event before Three.js's render pass
    // recomputes matrixWorldInverse, so without this the frustum lags one
    // frame behind the actual camera orientation.
    camera.updateMatrixWorld();

    // Build the current frustum — reuse cached objects to avoid per-frame GC.
    this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const desiredKeys = new Set<string>();
    const distSq = renderDistanceBlocks * renderDistanceBlocks;

    for (const [key, chunk] of this.chunks) {
      if (chunk.blocks.size === 0) continue;

      // XZ-only distance test.
      const nearestX = Math.max(chunk.bounds.min.x, Math.min(cameraTarget.x, chunk.bounds.max.x));
      const nearestZ = Math.max(chunk.bounds.min.z, Math.min(cameraTarget.z, chunk.bounds.max.z));
      const dx = nearestX - cameraTarget.x;
      const dz = nearestZ - cameraTarget.z;
      if (dx * dx + dz * dz > distSq) continue;

      // Frustum test using pre-computed column bounds (no allocation).
      if (!this._frustum.intersectsBox(chunk.columnBounds)) continue;

      desiredKeys.add(key);
    }

    // Unload chunks that are no longer desired (skipped when chunks are locked).
    // Snapshot loadedKeys before iterating — deleting from a Set mid-walk
    // causes the iterator to skip entries that follow a deleted one.
    if (!lockChunks) {
      for (const key of [...this.loadedKeys]) {
        if (!desiredKeys.has(key)) {
          const chunk = this.chunks.get(key);
          if (chunk) chunk.dispose(this.parent);
          this.loadedKeys.delete(key);
        }
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
    if (this._visibilityDebounceTimer !== null) {
      clearTimeout(this._visibilityDebounceTimer);
      this._visibilityDebounceTimer = null;
    }
    this.pendingResults.length = 0;
    this.resultFlushPending = false;
    this._buildMaterials.clear();
    for (const chunk of this.chunks.values()) {
      chunk.dispose(this.parent);
    }
    this.chunks.clear();
    this.loadedKeys.clear();
    this.dirtyKeys.clear();
    this.buildingKeys.clear();
    this.buildQueue.length = 0;
    this.buildQueueSet.clear();
  }

  dispose(): void {
    this.clearAll();
    for (const w of this.workers) w.terminate();
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
    // Defer to next task so all blocks from one transaction are marked dirty before sweeping.
    setTimeout(() => {
      this.sweepPending = false;
      for (const key of this.dirtyKeys) {
        // Only rebuild chunks that are currently loaded/visible.
        if (this.loadedKeys.has(key)) this.scheduleBuild(key);
      }
      this.dirtyKeys.clear();
    }, 0);
  }

  private scheduleBuild(key: string): void {
    if (this.buildingKeys.has(key)) return;
    if (this.buildQueueSet.has(key)) return;
    this.buildQueueSet.add(key);
    this.buildQueue.push(key);
    this.drainQueue();
  }

  private drainQueue(): void {
    // Fill up to maxConcurrent parallel builds.
    while (this.buildingKeys.size < this.maxConcurrent) {
      const workerIdx = this.workerBusy.indexOf(false);
      if (workerIdx === -1) break; // all workers busy

      const key = this.buildQueue.shift();
      if (key === undefined) break;
      this.buildQueueSet.delete(key);

      const chunk = this.chunks.get(key);
      if (!chunk || chunk.blocks.size === 0) continue; // skip empty, try next

      this.buildingKeys.add(key);
      chunk.state = 'building';
      this.workerBusy[workerIdx] = true;
      this.sendBuildRequest(chunk, workerIdx);
    }
  }

  private sendBuildRequest(chunk: WorldChunk, workerIdx: number): void {
    (chunk as any).__workerIdx = workerIdx;
    const worldView = useWorldViewStore.getState();

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

    const buildId = ++this._nextBuildId;
    this._buildMaterials.set(buildId, localMaterials);

    const request: BuildRequest = {
      chunkKey: chunk.key,
      buildId,
      blocks: serializedBlocks,
      borderBlocks,
      matIndices,
      matMeta,
      hiddenNames: [...worldView.transparencyList],
      yMin: worldView.yMin,
      yMax: worldView.yMax,
    };

    this.workers[workerIdx].postMessage(request);
  }

  private onWorkerResult(result: BuildResult): void {
    const key = result.chunkKey;
    this.buildingKeys.delete(key);

    const chunk = this.chunks.get(key);
    if (chunk) {
      const workerIdx: number = (chunk as any).__workerIdx ?? 0;
      this.workerBusy[workerIdx] = false;
      delete (chunk as any).__workerIdx;
    }

    // Release the worker and start the next build immediately — mesh
    // application is deferred so it doesn't block an in-progress render frame.
    this.drainQueue();

    if (!chunk) {
      this._buildMaterials.delete(result.buildId);
      return;
    }

    if (useWorldViewStore.getState().skipLoadYield) {
      this._applyResult(chunk, result);
    } else {
      this.pendingResults.push(result);
      this.onChunkReady?.(); // kick the R3F frame loop to call flushFrame()
    }
  }

  /**
   * Called by Scene.tsx's useFrame each animation frame.
   * Applies pending worker results within a time budget so GPU uploads are
   * always aligned to the render cycle, keeping input and camera events
   * responsive between frames.
   */
  public flushFrame(budgetMs: number): void {
    const deadline = performance.now() + budgetMs;
    while (this.pendingResults.length > 0 && performance.now() < deadline) {
      const result = this.pendingResults.shift()!;
      const chunk = this.chunks.get(result.chunkKey);
      if (chunk) this._applyResult(chunk, result);
    }
    // If the budget ran out, _applyResult will have called onChunkReady (→ invalidate),
    // which schedules another frame — no extra scheduling needed.
  }

  private _applyResult(chunk: WorldChunk, result: BuildResult): void {
    const localMaterials: THREE.Material[] = this._buildMaterials.get(result.buildId) ?? [];
    this._buildMaterials.delete(result.buildId);
    chunk.dispose(this.parent);
    if (result.opaque) chunk.opaqueMesh = this.buildMesh(result.opaque, localMaterials);
    if (result.transparent) chunk.transparentMesh = this.buildMesh(result.transparent, localMaterials);
    chunk.state = 'ready';
    if (this.loadedKeys.has(result.chunkKey)) {
      this.attachMeshes(chunk);
      this.onChunkReady?.();
    }
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
