/**
 * Chunk geometry builder — runs in a Web Worker so the main thread stays free.
 *
 * No Three.js, no Vue.  Receives plain block data and emits typed arrays that
 * the main thread assembles into BufferGeometry objects.
 */

// ─── Protocol types ───────────────────────────────────────────────────────────

export interface SerializedBlock {
  name: string;
  metadata?: number;
}

export interface MaterialMeta {
  transparent: boolean;
  liquid: boolean;
  nonOccluding: boolean;
  /** 'cube' | 'cross' | 'flat' | 'slab_bottom' | 'slab_top' | 'box' (fallback) */
  geomType: string;
}

export interface GroupEntry {
  start: number;    // index offset into the index buffer
  count: number;    // number of indices in this group
  materialIndex: number;
}

export interface GeometryBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  groups: GroupEntry[];
}

export interface BuildRequest {
  chunkKey: string;
  buildId: number;
  /** Blocks that belong to this chunk. */
  blocks: Record<string, SerializedBlock>;
  /** One-block-thick border from each of the 6 neighboring chunks, for cross-chunk face culling. */
  borderBlocks: Record<string, SerializedBlock>;
  /** blockKey ("name" or "name:metadata") → local material index for this chunk's mesh. */
  matIndices: Record<string, number>;
  /** local material index → metadata the builder needs for culling decisions. */
  matMeta: Record<number, MaterialMeta>;
  /** Block names that are on the transparency (hidden) list — skip them entirely. */
  hiddenNames: string[];
  yMin: number;
  yMax: number;
}

export interface BuildResult {
  chunkKey: string;
  buildId: number;
  opaque: GeometryBuffers | null;
  transparent: GeometryBuffers | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 16;

// Each face direction: neighbour offset + the 4 vertex offsets relative to the
// block centre, the face normal, and UV coordinates.
// Vertex order produces counter-clockwise winding when viewed from outside.
const FACES = [
  // +X
  {
    dx: 1, dy: 0, dz: 0,
    verts: [
      [0.5, -0.5, -0.5], [0.5,  0.5, -0.5], [0.5,  0.5,  0.5], [0.5, -0.5,  0.5],
    ],
    normal: [1, 0, 0],
    uvs: [[0,0],[0,1],[1,1],[1,0]],
  },
  // -X
  {
    dx: -1, dy: 0, dz: 0,
    verts: [
      [-0.5, -0.5,  0.5], [-0.5,  0.5,  0.5], [-0.5,  0.5, -0.5], [-0.5, -0.5, -0.5],
    ],
    normal: [-1, 0, 0],
    uvs: [[0,0],[0,1],[1,1],[1,0]],
  },
  // +Y
  {
    dx: 0, dy: 1, dz: 0,
    verts: [
      [-0.5, 0.5, -0.5], [-0.5, 0.5,  0.5], [0.5, 0.5,  0.5], [0.5, 0.5, -0.5],
    ],
    normal: [0, 1, 0],
    uvs: [[0,0],[0,1],[1,1],[1,0]],
  },
  // -Y
  {
    dx: 0, dy: -1, dz: 0,
    verts: [
      [-0.5, -0.5,  0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5,  0.5],
    ],
    normal: [0, -1, 0],
    uvs: [[0,0],[0,1],[1,1],[1,0]],
  },
  // +Z
  {
    dx: 0, dy: 0, dz: 1,
    verts: [
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5,  0.5, 0.5], [-0.5,  0.5, 0.5],
    ],
    normal: [0, 0, 1],
    uvs: [[0,0],[1,0],[1,1],[0,1]],
  },
  // -Z
  {
    dx: 0, dy: 0, dz: -1,
    verts: [
      [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5,  0.5, -0.5], [0.5,  0.5, -0.5],
    ],
    normal: [0, 0, -1],
    uvs: [[0,0],[1,0],[1,1],[0,1]],
  },
] as const;

// ─── Geometry accumulators ────────────────────────────────────────────────────

interface Accumulator {
  positions: number[];
  normals: number[];
  uvs: number[];
  /** Raw index values (offset by base vertex count before merging). */
  indices: number[];
  vertexCount: number;
}

function makeAccumulator(): Accumulator {
  return { positions: [], normals: [], uvs: [], indices: [], vertexCount: 0 };
}

/** Append a quad (4 vertices, 2 triangles) to an accumulator. */
function pushQuad(
  acc: Accumulator,
  verts: readonly (readonly [number, number, number])[],
  normal: readonly [number, number, number],
  uvCoords: readonly (readonly [number, number])[],
  bx: number, by: number, bz: number,
) {
  const base = acc.vertexCount;
  for (let i = 0; i < 4; i++) {
    acc.positions.push(bx + verts[i][0], by + verts[i][1], bz + verts[i][2]);
    acc.normals.push(normal[0], normal[1], normal[2]);
    acc.uvs.push(uvCoords[i][0], uvCoords[i][1]);
  }
  // Two triangles: (0,1,2) and (0,2,3)
  acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  acc.vertexCount += 4;
}

/** Append a cross (two perpendicular vertical quads, double-sided). */
function pushCross(acc: Accumulator, bx: number, by: number, bz: number) {
  const H = 0.5;
  // Plane 1: along X axis (facing ±Z)
  const p1v = [
    [-H, -H, 0], [H, -H, 0], [H, H, 0], [-H, H, 0],
  ] as [number,number,number][];
  const p1n: [number,number,number] = [0, 0, 1];
  const uv4: [number,number][] = [[0,0],[1,0],[1,1],[0,1]];
  const uv4flip: [number,number][] = [[0,1],[1,1],[1,0],[0,0]];
  // front winding
  pushQuad(acc, p1v as any, p1n, uv4 as any, bx, by, bz);
  // back winding (reverse vertices + flip UVs vertically so texture isn't upside-down)
  pushQuad(acc, [p1v[3], p1v[2], p1v[1], p1v[0]] as any, [-p1n[0], -p1n[1], -p1n[2]], uv4flip as any, bx, by, bz);

  // Plane 2: along Z axis (facing ±X)
  const p2v = [
    [0, -H, -H], [0, -H, H], [0, H, H], [0, H, -H],
  ] as [number,number,number][];
  const p2n: [number,number,number] = [1, 0, 0];
  pushQuad(acc, p2v as any, p2n, uv4 as any, bx, by, bz);
  pushQuad(acc, [p2v[3], p2v[2], p2v[1], p2v[0]] as any, [-p2n[0], -p2n[1], -p2n[2]], uv4flip as any, bx, by, bz);
}

/** Append a flat horizontal quad (snow layer, carpet, rail) sitting at the block's base. */
function pushFlat(acc: Accumulator, bx: number, by: number, bz: number) {
  const flatVerts = [
    [-0.5, -0.5, -0.5], [-0.5, -0.5,  0.5], [0.5, -0.5,  0.5], [0.5, -0.5, -0.5],
  ] as [number,number,number][];
  const n: [number,number,number] = [0, 1, 0];
  const uv: [number,number][] = [[0,0],[0,1],[1,1],[1,0]];
  pushQuad(acc, flatVerts as any, n, uv as any, bx, by, bz);
}

/** Append a bottom or top half-slab. */
function pushSlab(acc: Accumulator, bx: number, by: number, bz: number, isTop: boolean) {
  const yOff = isTop ? 0.25 : -0.25;
  const yMin = yOff - 0.25;
  const yMax = yOff + 0.25;
  // Side faces show only the matching half of the texture (bottom half for bottom slab, top half for top).
  const vLo = isTop ? 0.5 : 0;
  const vHi = isTop ? 1.0 : 0.5;
  const uvSide: [number,number][] = [[0,vLo],[1,vLo],[1,vHi],[0,vHi]];
  const uvFull: [number,number][] = [[0,0],[1,0],[1,1],[0,1]];

  const slabFaces = [
    // +X
    { verts: [[0.5, yMin, -0.5],[0.5, yMax, -0.5],[0.5, yMax,  0.5],[0.5, yMin,  0.5]], n: [1,0,0], uv: uvSide },
    // -X
    { verts: [[-0.5, yMin,  0.5],[-0.5, yMax,  0.5],[-0.5, yMax, -0.5],[-0.5, yMin, -0.5]], n: [-1,0,0], uv: uvSide },
    // +Y
    { verts: [[-0.5, yMax, -0.5],[-0.5, yMax,  0.5],[0.5, yMax,  0.5],[0.5, yMax, -0.5]], n: [0,1,0], uv: uvFull },
    // -Y
    { verts: [[-0.5, yMin,  0.5],[-0.5, yMin, -0.5],[0.5, yMin, -0.5],[0.5, yMin,  0.5]], n: [0,-1,0], uv: uvFull },
    // +Z
    { verts: [[-0.5, yMin, 0.5],[0.5, yMin, 0.5],[0.5, yMax, 0.5],[-0.5, yMax, 0.5]], n: [0,0,1], uv: uvSide },
    // -Z
    { verts: [[0.5, yMin, -0.5],[-0.5, yMin, -0.5],[-0.5, yMax, -0.5],[0.5, yMax, -0.5]], n: [0,0,-1], uv: uvSide },
  ];
  for (const f of slabFaces) {
    pushQuad(acc, f.verts as any, f.n as [number,number,number], f.uv as any, bx, by, bz);
  }
}

// ─── Solid-block test ─────────────────────────────────────────────────────────

function isSolid(
  locString: string,
  allBlocks: Record<string, SerializedBlock>,
  matIndices: Record<string, number>,
  matMeta: Record<number, MaterialMeta>,
  hiddenSet: Set<string>,
): boolean {
  const b = allBlocks[locString];
  if (!b) return false;
  if (hiddenSet.has(b.name)) return false;
  const key = b.metadata ? `${b.name}:${b.metadata}` : b.name;
  const idx = matIndices[key] ?? matIndices[b.name];
  if (idx === undefined) return false;
  const meta = matMeta[idx];
  if (!meta) return false;
  const geom = meta.geomType;
  // Cross, flat, and non-full-cube custom shapes don't occlude neighbours.
  if (geom === 'cross' || geom === 'flat') return false;
  return !meta.nonOccluding;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

function buildGeometry(req: BuildRequest): BuildResult {
  const { chunkKey, blocks, borderBlocks, matIndices, matMeta, hiddenNames, yMin, yMax } = req;
  const hiddenSet = new Set(hiddenNames);

  // Combined lookup: chunk blocks + border blocks for face culling.
  const allBlocks: Record<string, SerializedBlock> = { ...borderBlocks, ...blocks };

  // One accumulator per local material index, split by opaque/transparent.
  const opaqueAccs  = new Map<number, Accumulator>();
  const transAccs   = new Map<number, Accumulator>();

  function getAcc(matIdx: number, transparent: boolean): Accumulator {
    const map = transparent ? transAccs : opaqueAccs;
    if (!map.has(matIdx)) map.set(matIdx, makeAccumulator());
    return map.get(matIdx)!;
  }

  for (const [locString, block] of Object.entries(blocks)) {
    if (hiddenSet.has(block.name)) continue;

    const [x, y, z] = locString.split(',').map(Number);
    if (y < yMin || y > yMax) continue;

    const blockKey = block.metadata ? `${block.name}:${block.metadata}` : block.name;
    const matIdx = matIndices[blockKey] ?? matIndices[block.name];
    if (matIdx === undefined) continue;

    const meta = matMeta[matIdx];
    if (!meta) continue;

    const geomType = meta.geomType;
    const isTransparent = meta.transparent;
    const isLiquid = meta.liquid;
    const acc = getAcc(matIdx, isTransparent);

    // ── Non-cube geometry ──────────────────────────────────────────────────
    if (geomType === 'cross') {
      pushCross(acc, x, y, z);
      continue;
    }
    if (geomType === 'flat') {
      pushFlat(acc, x, y, z);
      continue;
    }
    if (geomType === 'slab_bottom' || geomType === 'slab_top') {
      pushSlab(acc, x, y, z, geomType === 'slab_top');
      continue;
    }

    // ── Cube face culling ──────────────────────────────────────────────────
    for (const face of FACES) {
      const nx = x + face.dx, ny = y + face.dy, nz = z + face.dz;
      const nLoc = `${nx},${ny},${nz}`;
      const nb = allBlocks[nLoc];

      // Skip if neighbour occludes this face.
      if (nb && !hiddenSet.has(nb.name)) {
        const nbKey = nb.metadata ? `${nb.name}:${nb.metadata}` : nb.name;
        const nbIdx = matIndices[nbKey] ?? matIndices[nb.name];
        if (nbIdx !== undefined) {
          const nbMeta = matMeta[nbIdx];
          if (nbMeta) {
            const nbGeom = nbMeta.geomType;
            // Slabs are partial blocks and must not occlude adjacent faces.
            const nbIsFullCube = nbGeom !== 'cross' && nbGeom !== 'flat'
              && nbGeom !== 'slab_bottom' && nbGeom !== 'slab_top';

            if (nbIsFullCube && !nbMeta.nonOccluding) {
              // Solid full-cube neighbour hides any non-liquid face.
              if (!isLiquid) continue;
              // Liquid side faces are hidden by solid neighbours (water into ground).
              // The top face always renders so the water surface is visible.
              if (face.dy !== 1) continue;
            }

            // Liquid-to-liquid: suppress all side faces regardless of nonOccluding flag.
            if (isLiquid && nbMeta.liquid && face.dy !== 1) continue;
          }
        }
      }

      pushQuad(acc, face.verts, face.normal, face.uvs, x, y, z);
    }
  }

  function finalize(accs: Map<number, Accumulator>): GeometryBuffers | null {
    if (accs.size === 0) return null;

    // Sort by material index for deterministic output.
    const entries = [...accs.entries()].sort(([a], [b]) => a - b);

    let totalVerts = 0;
    let totalIndices = 0;
    for (const [, acc] of entries) {
      totalVerts += acc.vertexCount;
      totalIndices += acc.indices.length;
    }

    const positions = new Float32Array(totalVerts * 3);
    const normals   = new Float32Array(totalVerts * 3);
    const uvs       = new Float32Array(totalVerts * 2);
    const indices   = new Uint32Array(totalIndices);
    const groups: GroupEntry[] = [];

    let vOffset = 0;
    let iOffset = 0;
    let baseVertex = 0;

    for (const [matIdx, acc] of entries) {
      const groupStart = iOffset;
      // Positions / normals / UVs
      positions.set(acc.positions, vOffset * 3);
      normals.set(acc.normals, vOffset * 3);
      uvs.set(acc.uvs, vOffset * 2);
      // Indices — offset to account for vertices already written
      for (let i = 0; i < acc.indices.length; i++) {
        indices[iOffset++] = acc.indices[i] + baseVertex;
      }
      groups.push({ start: groupStart, count: acc.indices.length, materialIndex: matIdx });
      baseVertex += acc.vertexCount;
      vOffset += acc.vertexCount;
    }

    return { positions, normals, uvs, indices, groups };
  }

  return {
    chunkKey,
    buildId: req.buildId,
    opaque: finalize(opaqueAccs),
    transparent: finalize(transAccs),
  };
}

// ─── Worker message handler ───────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const result = buildGeometry(e.data);

  // Transfer typed arrays back to main thread without copying.
  const transferables: Transferable[] = [];
  if (result.opaque) {
    transferables.push(
      result.opaque.positions.buffer,
      result.opaque.normals.buffer,
      result.opaque.uvs.buffer,
      result.opaque.indices.buffer,
    );
  }
  if (result.transparent) {
    transferables.push(
      result.transparent.positions.buffer,
      result.transparent.normals.buffer,
      result.transparent.uvs.buffer,
      result.transparent.indices.buffer,
    );
  }

  (self as any).postMessage(result, transferables);
};
