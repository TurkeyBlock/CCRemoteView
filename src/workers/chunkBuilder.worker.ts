/**
 * Chunk geometry builder — runs in a Web Worker so the main thread stays free.
 *
 * No Three.js, no Vue.  Receives plain block data and emits typed arrays that
 * the main thread assembles into BufferGeometry objects.
 */

import { GEOMETRY } from '../utils/blockMaps'
import { parseTransparencyList } from '../utils/parseTransparencyList'

// ─── Protocol types ───────────────────────────────────────────────────────────

export interface SerializedBlock {
  name: string;
  metadata?: number;
}

export interface MaterialMeta {
  transparent: boolean;
  liquid: boolean;
  nonOccluding: boolean;
  geomType: GEOMETRY;
  /** Connection-group memberships. Cable geometry connects when any of its groups overlap a neighbour's. */
  connectionGroups?: string[];
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
  /** Per-vertex originating block integer coords [bx, by, bz, …]. Used for raycasting. */
  blockCoords: Int16Array;
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
  /** When true, skip neighbour face-culling so all 6 faces of every block are emitted (mining mode). */
  skipCulling: boolean;
  /** When true, alpha-cutout blocks (e.g. leaves) are treated as occluders, like solid cubes. */
  simpleOcclusion: boolean;
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
  blockCoords: number[];
}

function makeAccumulator(): Accumulator {
  return { positions: [], normals: [], uvs: [], indices: [], vertexCount: 0, blockCoords: [] };
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
    acc.blockCoords.push(bx, by, bz);
  }
  // Two triangles: (0,1,2) and (0,2,3)
  acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  acc.vertexCount += 4;
}

/** Append a cross (two perpendicular vertical quads, double-sided), rotated 45° so edges point toward corners. */
function pushCross(acc: Accumulator, bx: number, by: number, bz: number) {
  const yBot = -0.5;
  const yTop =  0.5;
  const D = 0.45; // slightly inside block corners to avoid Z-fighting where the two planes intersect
  const uv4: [number,number][] = [[0,0],[1,0],[1,1],[0,1]];

  // Single quad per plane — material uses THREE.DoubleSide so no back-face quad needed.
  // Duplicate back-face quads caused Z-fighting with the DoubleSide back face.
  const up: [number,number,number] = [0, 1, 0];

  // Plane 1: runs NW→SE (+X,+Z diagonal)
  const p1v = [
    [-D, yBot, -D], [D, yBot, D], [D, yTop, D], [-D, yTop, -D],
  ] as [number,number,number][];
  pushQuad(acc, p1v as any, up, uv4 as any, bx, by, bz);

  // Plane 2: runs NE→SW (+X,-Z diagonal)
  const p2v = [
    [D, yBot, -D], [-D, yBot, D], [-D, yTop, D], [D, yTop, -D],
  ] as [number,number,number][];
  pushQuad(acc, p2v as any, up, uv4 as any, bx, by, bz);
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
  // UV conventions match the cube FACES definition:
  //   +X/-X faces: U follows Z, V follows Y  → "vertical" layout
  //   +Z/-Z faces: U follows X, V follows Y  → "horizontal" layout  (same as cube)
  //   +Y/-Y faces: U follows X, V follows Z  → matches cube top/bottom
  const uvSideV: [number,number][] = [[0,vLo],[0,vHi],[1,vHi],[1,vLo]]; // +X, -X
  const uvSideH: [number,number][] = [[0,vLo],[1,vLo],[1,vHi],[0,vHi]]; // +Z, -Z
  const uvFull:  [number,number][] = [[0,0],[0,1],[1,1],[1,0]];           // +Y, -Y

  const slabFaces = [
    // +X: verts step yMin→yMax then -z→+z; U=Z, V=Y
    { verts: [[0.5, yMin, -0.5],[0.5, yMax, -0.5],[0.5, yMax,  0.5],[0.5, yMin,  0.5]], n: [1,0,0],  uv: uvSideV },
    // -X: verts step yMin→yMax then +z→-z; U=(-Z), V=Y
    { verts: [[-0.5, yMin,  0.5],[-0.5, yMax,  0.5],[-0.5, yMax, -0.5],[-0.5, yMin, -0.5]], n: [-1,0,0], uv: uvSideV },
    // +Y: verts step -z→+z then -x→+x; U=X, V=Z
    { verts: [[-0.5, yMax, -0.5],[-0.5, yMax,  0.5],[0.5, yMax,  0.5],[0.5, yMax, -0.5]], n: [0,1,0],  uv: uvFull },
    // -Y: verts step +z→-z then -x→+x; U=X, V=(-Z)
    { verts: [[-0.5, yMin,  0.5],[-0.5, yMin, -0.5],[0.5, yMin, -0.5],[0.5, yMin,  0.5]], n: [0,-1,0], uv: uvFull },
    // +Z: verts step -x→+x then yMin→yMax; U=X, V=Y
    { verts: [[-0.5, yMin, 0.5],[0.5, yMin, 0.5],[0.5, yMax, 0.5],[-0.5, yMax, 0.5]], n: [0,0,1],   uv: uvSideH },
    // -Z: verts step +x→-x then yMin→yMax; U=(-X), V=Y
    { verts: [[0.5, yMin, -0.5],[-0.5, yMin, -0.5],[-0.5, yMax, -0.5],[0.5, yMax, -0.5]], n: [0,0,-1],  uv: uvSideH },
  ];
  for (const f of slabFaces) {
    pushQuad(acc, f.verts as any, f.n as [number,number,number], f.uv as any, bx, by, bz);
  }
}

interface BoxSpec {
  bx: number; by: number; bz: number;
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}

/**
 * Append all 6 faces of an axis-aligned cuboid defined by min/max corners in
 * block-local coords (block centre = origin, full cube spans -0.5..0.5 on each axis).
 * UVs are sized proportionally to each face's dimensions so a fractional-width
 * cuboid takes a matching fractional slice of its texture (no stretching).
 */
function pushBox(acc: Accumulator, box: BoxSpec): void {
  const { bx, by, bz, x0, y0, z0, x1, y1, z1 } = box;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const faces = [
    // +X: U=Z, V=Y
    { v: [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]], n: [1,0,0],  uv: [[0,0],[0,dy],[dz,dy],[dz,0]] },
    // -X
    { v: [[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0]], n: [-1,0,0], uv: [[0,0],[0,dy],[dz,dy],[dz,0]] },
    // +Y: U=X, V=Z
    { v: [[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]], n: [0,1,0],  uv: [[0,0],[0,dz],[dx,dz],[dx,0]] },
    // -Y
    { v: [[x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]], n: [0,-1,0], uv: [[0,0],[0,dz],[dx,dz],[dx,0]] },
    // +Z: U=X, V=Y
    { v: [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], n: [0,0,1],  uv: [[0,0],[dx,0],[dx,dy],[0,dy]] },
    // -Z
    { v: [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]], n: [0,0,-1], uv: [[0,0],[dx,0],[dx,dy],[0,dy]] },
  ];
  for (const f of faces) {
    pushQuad(acc, f.v as any, f.n as [number,number,number], f.uv as any, bx, by, bz);
  }
}

/**
 * Append a fence: a thin centre post plus up to 4 connector rails (top + bottom
 * pair per direction). Connections are decided by the caller — typically true
 * when the neighbour is another fence or a solid full cube.
 *
 * Direction convention follows FACES: connN = -Z, connS = +Z, connE = +X, connW = -X.
 */
function pushFence(
  acc: Accumulator,
  bx: number, by: number, bz: number,
  connN: boolean, connS: boolean, connE: boolean, connW: boolean,
) {
  // Centre post: 4/16 wide on X/Z, full block height. Always rendered.
  const POST = 2/16;
  pushBox(acc, { bx, by, bz, x0: -POST, y0: -0.5, z0: -POST, x1: POST, y1: 0.5, z1: POST });

  // Connector rails: 2/16 thick perpendicular to length, 3/16 tall.
  // Block-local Y: top rail at 12..15/16, bottom rail at 6..9/16 (Y origin = block centre).
  const RAIL_T = 1/16;
  const tY0 = 12/16 - 0.5, tY1 = 15/16 - 0.5;
  const bY0 =  6/16 - 0.5, bY1 =  9/16 - 0.5;

  if (connN) {
    pushBox(acc, { bx, by, bz, x0: -RAIL_T, y0: tY0, z0: -0.5,  x1: RAIL_T, y1: tY1, z1: -POST });
    pushBox(acc, { bx, by, bz, x0: -RAIL_T, y0: bY0, z0: -0.5,  x1: RAIL_T, y1: bY1, z1: -POST });
  }
  if (connS) {
    pushBox(acc, { bx, by, bz, x0: -RAIL_T, y0: tY0, z0: POST,  x1: RAIL_T, y1: tY1, z1: 0.5 });
    pushBox(acc, { bx, by, bz, x0: -RAIL_T, y0: bY0, z0: POST,  x1: RAIL_T, y1: bY1, z1: 0.5 });
  }
  if (connE) {
    pushBox(acc, { bx, by, bz, x0: POST, y0: tY0, z0: -RAIL_T,  x1: 0.5, y1: tY1, z1: RAIL_T });
    pushBox(acc, { bx, by, bz, x0: POST, y0: bY0, z0: -RAIL_T,  x1: 0.5, y1: bY1, z1: RAIL_T });
  }
  if (connW) {
    pushBox(acc, { bx, by, bz, x0: -0.5, y0: tY0, z0: -RAIL_T, x1: -POST, y1: tY1, z1: RAIL_T });
    pushBox(acc, { bx, by, bz, x0: -0.5, y0: bY0, z0: -RAIL_T, x1: -POST, y1: bY1, z1: RAIL_T });
  }
}

/**
 * Returns true if `nb` is something a connecting block (fence/pane/iron bars)
 * should extend an arm toward. Connects to other blocks of the same matchType,
 * plus any solid full cube.
 */
function isConnection(
  matchType: string,
  nb: SerializedBlock | undefined,
  isHidden: (name: string, meta: number | undefined) => boolean,
  matIndices: Record<string, number>,
  matMeta: Record<number, MaterialMeta>,
): boolean {
  if (!nb || isHidden(nb.name, nb.metadata)) return false;
  const key = nb.metadata ? `${nb.name}:${nb.metadata}` : nb.name;
  const idx = matIndices[key] ?? matIndices[nb.name];
  if (idx === undefined) return false;
  const meta = matMeta[idx];
  if (!meta) return false;
  if (meta.geomType === matchType) return true;
  // Connect to solid full cubes (excludes glass/leaves/etc. via nonOccluding flag).
  return meta.geomType === GEOMETRY.CUBE && !meta.nonOccluding;
}

/**
 * Append a pane / iron-bars block: a thin vertical centre column plus up to 4
 * full-height arms extending toward connecting neighbours. Same connection rules
 * as a fence, but the arms are full-height flat panels rather than top/bottom rails.
 */
function pushPane(
  acc: Accumulator,
  bx: number, by: number, bz: number,
  connN: boolean, connS: boolean, connE: boolean, connW: boolean,
) {
  const T = 1/16;  // half-thickness — pane is 2/16 thick total
  // Centre column — always rendered.
  pushBox(acc, { bx, by, bz, x0: -T, y0: -0.5, z0: -T, x1: T, y1: 0.5, z1: T });

  if (connN) pushBox(acc, { bx, by, bz, x0: -T, y0: -0.5, z0: -0.5, x1: T,   y1: 0.5, z1: -T  });
  if (connS) pushBox(acc, { bx, by, bz, x0: -T, y0: -0.5, z0: T,    x1: T,   y1: 0.5, z1: 0.5 });
  if (connE) pushBox(acc, { bx, by, bz, x0: T,  y0: -0.5, z0: -T,   x1: 0.5, y1: 0.5, z1: T   });
  if (connW) pushBox(acc, { bx, by, bz, x0: -0.5, y0: -0.5, z0: -T, x1: -T,  y1: 0.5, z1: T   });
}

/**
 * Append a cable / pipe: a small centre cube plus up to 6 arms toward connected
 * neighbours (one per axis direction). Connection is decided by group overlap, NOT
 * geomType — RF cables connect to RF machines, EU cables to EU machines, etc.
 */
function pushCable(
  acc: Accumulator,
  bx: number, by: number, bz: number,
  Xp: boolean, Xn: boolean, Yp: boolean, Yn: boolean, Zp: boolean, Zn: boolean,
) {
  const T = 2/16;  // half-thickness — cable is 4/16 wide
  // Centre cube — always rendered.
  pushBox(acc, { bx, by, bz, x0: -T,   y0: -T,   z0: -T,   x1: T,   y1: T,   z1: T   });
  if (Xp) pushBox(acc, { bx, by, bz, x0: T,    y0: -T,   z0: -T,   x1: 0.5,  y1: T,   z1: T   });
  if (Xn) pushBox(acc, { bx, by, bz, x0: -0.5, y0: -T,   z0: -T,   x1: -T,   y1: T,   z1: T   });
  if (Yp) pushBox(acc, { bx, by, bz, x0: -T,   y0: T,    z0: -T,   x1: T,    y1: 0.5, z1: T   });
  if (Yn) pushBox(acc, { bx, by, bz, x0: -T,   y0: -0.5, z0: -T,   x1: T,    y1: -T,  z1: T   });
  if (Zp) pushBox(acc, { bx, by, bz, x0: -T,   y0: -T,   z0: T,    x1: T,    y1: T,   z1: 0.5 });
  if (Zn) pushBox(acc, { bx, by, bz, x0: -T,   y0: -T,   z0: -0.5, x1: T,    y1: T,   z1: -T  });
}

/**
 * Returns true if `nb`'s connection groups overlap with `myGroups`. Used by cable
 * geometry to decide whether to extend an arm toward a neighbour.
 */
function isCableConnection(
  myGroups: readonly string[] | undefined,
  nb: SerializedBlock | undefined,
  isHidden: (name: string, meta: number | undefined) => boolean,
  matIndices: Record<string, number>,
  matMeta: Record<number, MaterialMeta>,
): boolean {
  if (!myGroups || myGroups.length === 0) return false;
  if (!nb || isHidden(nb.name, nb.metadata)) return false;
  const key = nb.metadata ? `${nb.name}:${nb.metadata}` : nb.name;
  const idx = matIndices[key] ?? matIndices[nb.name];
  if (idx === undefined) return false;
  const meta = matMeta[idx];
  if (!meta?.connectionGroups) return false;
  for (const g of myGroups) if (meta.connectionGroups.includes(g)) return true;
  return false;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

function neighborOccludesFace(nbGeom: GEOMETRY, faceDy: number): boolean {
  const nbIsFullCube = nbGeom !== GEOMETRY.CROSS && nbGeom !== GEOMETRY.FLAT
    && nbGeom !== GEOMETRY.SLAB_BOTTOM && nbGeom !== GEOMETRY.SLAB_TOP
    && nbGeom !== GEOMETRY.FENCE && nbGeom !== GEOMETRY.PANE && nbGeom !== GEOMETRY.CABLE
  // GEOMETRY.STAIRS is intentionally absent — stairs render as full cubes until
  // a proper stair push function exists. Add it here when that lands, or it will
  // generate coplanar faces that z-fight with the stair cube.
  const slabOccludes = (nbGeom === GEOMETRY.SLAB_BOTTOM && faceDy === 1)
                    || (nbGeom === GEOMETRY.SLAB_TOP    && faceDy === -1)
  const flatOccludes = nbGeom === GEOMETRY.FLAT && faceDy === 1
  return nbIsFullCube || slabOccludes || flatOccludes
}

function shouldCullCubeFace(
  faceDy: number,
  blockName: string,
  blockMeta: number | undefined,
  isLiquid: boolean,
  isSeamBlock: boolean,
  nb: SerializedBlock | undefined,
  isHidden: (name: string, meta: number | undefined) => boolean,
  matIndices: Record<string, number>,
  matMeta: Record<number, MaterialMeta>,
): boolean {
  if (!nb) return false
  const isSameType = !isLiquid && nb.name === blockName && (nb.metadata ?? 0) === (blockMeta ?? 0)
  if (isSeamBlock && isSameType && !isHidden(nb.name, nb.metadata)) return true

  if (isHidden(nb.name, nb.metadata)) return false
  const nbKey = nb.metadata ? `${nb.name}:${nb.metadata}` : nb.name
  const nbIdx = matIndices[nbKey] ?? matIndices[nb.name]
  if (nbIdx === undefined) return false
  const nbMeta = matMeta[nbIdx]
  if (!nbMeta) return false

  if (neighborOccludesFace(nbMeta.geomType, faceDy) && !nbMeta.nonOccluding) {
    if (!isLiquid) return true
    if (faceDy !== 1) return true
  }
  if (isLiquid && nbMeta.liquid && faceDy !== 1) return true
  return false
}

function shouldCullCubeFaceMining(
  faceDy: number,
  blockName: string,
  blockMeta: number | undefined,
  isLiquid: boolean,
  nb: SerializedBlock | undefined,
  matIndices: Record<string, number>,
  matMeta: Record<number, MaterialMeta>,
): boolean {
  if (!nb) return false
  const isSameType = !isLiquid && nb.name === blockName && (nb.metadata ?? 0) === (blockMeta ?? 0)
  if (isSameType) return true
  if (isLiquid) {
    const nbKey = nb.metadata ? `${nb.name}:${nb.metadata}` : nb.name
    const nbIdx = matIndices[nbKey] ?? matIndices[nb.name]
    if (nbIdx !== undefined && matMeta[nbIdx]?.liquid && faceDy !== 1) return true
  }
  return false
}

function buildGeometry(req: BuildRequest): BuildResult {
  const { chunkKey, blocks, borderBlocks, matIndices, matMeta, hiddenNames, yMin, yMax, skipCulling, simpleOcclusion } = req;
  const { all: hiddenAllMeta, specific: hiddenSpecificMeta } = parseTransparencyList(hiddenNames);
  const isHidden = (name: string, meta: number | undefined): boolean =>
    hiddenAllMeta.has(name) || hiddenSpecificMeta.has(`${name}:${meta ?? 0}`);

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
    if (isHidden(block.name, block.metadata)) continue;

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
    if (geomType === GEOMETRY.CROSS) {
      pushCross(acc, x, y, z);
      continue;
    }
    if (geomType === GEOMETRY.FLAT) {
      pushFlat(acc, x, y, z);
      continue;
    }
    if (geomType === GEOMETRY.SLAB_BOTTOM || geomType === GEOMETRY.SLAB_TOP) {
      pushSlab(acc, x, y, z, geomType === GEOMETRY.SLAB_TOP);
      continue;
    }
    if (geomType === GEOMETRY.FENCE || geomType === GEOMETRY.PANE) {
      const connN = isConnection(geomType, allBlocks[`${x},${y},${z-1}`], isHidden, matIndices, matMeta);
      const connS = isConnection(geomType, allBlocks[`${x},${y},${z+1}`], isHidden, matIndices, matMeta);
      const connE = isConnection(geomType, allBlocks[`${x+1},${y},${z}`], isHidden, matIndices, matMeta);
      const connW = isConnection(geomType, allBlocks[`${x-1},${y},${z}`], isHidden, matIndices, matMeta);
      if (geomType === GEOMETRY.FENCE) pushFence(acc, x, y, z, connN, connS, connE, connW);
      else                             pushPane(acc, x, y, z, connN, connS, connE, connW);
      continue;
    }
    if (geomType === GEOMETRY.CABLE) {
      const myGroups = meta.connectionGroups;
      const Xp = isCableConnection(myGroups, allBlocks[`${x+1},${y},${z}`], isHidden, matIndices, matMeta);
      const Xn = isCableConnection(myGroups, allBlocks[`${x-1},${y},${z}`], isHidden, matIndices, matMeta);
      const Yp = isCableConnection(myGroups, allBlocks[`${x},${y+1},${z}`], isHidden, matIndices, matMeta);
      const Yn = isCableConnection(myGroups, allBlocks[`${x},${y-1},${z}`], isHidden, matIndices, matMeta);
      const Zp = isCableConnection(myGroups, allBlocks[`${x},${y},${z+1}`], isHidden, matIndices, matMeta);
      const Zn = isCableConnection(myGroups, allBlocks[`${x},${y},${z-1}`], isHidden, matIndices, matMeta);
      pushCable(acc, x, y, z, Xp, Xn, Yp, Yn, Zp, Zn);
      continue;
    }

    // ── Cube face culling ──────────────────────────────────────────────────
    const isCube6 = geomType === GEOMETRY.CUBE6;
    const isSeamBlock = meta.transparent || (simpleOcclusion && meta.nonOccluding && !meta.transparent);
    for (let fi = 0; fi < FACES.length; fi++) {
      const face = FACES[fi];
      const nb = allBlocks[`${x + face.dx},${y + face.dy},${z + face.dz}`];

      if (skipCulling) {
        if (shouldCullCubeFaceMining(face.dy, block.name, block.metadata, isLiquid, nb, matIndices, matMeta)) continue;
      } else {
        if (shouldCullCubeFace(face.dy, block.name, block.metadata, isLiquid, isSeamBlock, nb, isHidden, matIndices, matMeta)) continue;
      }

      // cube6: texture is a 96x16 strip of 6 distinct face tiles (one per cube face).
      // Face index fi matches the FACES order: +X,-X,+Y,-Y,+Z,-Z.
      const uvCoords = isCube6
        ? face.uvs.map(([u, v]) => [(fi + u) / 6, v] as const)
        : face.uvs;
      pushQuad(acc, face.verts, face.normal, uvCoords, x, y, z);
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

    const positions   = new Float32Array(totalVerts * 3);
    const normals     = new Float32Array(totalVerts * 3);
    const uvs         = new Float32Array(totalVerts * 2);
    const indices     = new Uint32Array(totalIndices);
    const blockCoords = new Int16Array(totalVerts * 3);
    const groups: GroupEntry[] = [];

    let vOffset = 0;
    let iOffset = 0;
    let baseVertex = 0;

    for (const [matIdx, acc] of entries) {
      const groupStart = iOffset;
      // Positions / normals / UVs / block coords
      positions.set(acc.positions, vOffset * 3);
      normals.set(acc.normals, vOffset * 3);
      uvs.set(acc.uvs, vOffset * 2);
      blockCoords.set(acc.blockCoords, vOffset * 3);
      // Indices — offset to account for vertices already written
      for (let i = 0; i < acc.indices.length; i++) {
        indices[iOffset++] = acc.indices[i] + baseVertex;
      }
      groups.push({ start: groupStart, count: acc.indices.length, materialIndex: matIdx });
      baseVertex += acc.vertexCount;
      vOffset += acc.vertexCount;
    }

    return { positions, normals, uvs, indices, groups, blockCoords };
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
  try {
    const result = buildGeometry(e.data);

    // Transfer typed arrays back to main thread without copying.
    const transferables: Transferable[] = [];
    if (result.opaque) {
      transferables.push(
        result.opaque.positions.buffer,
        result.opaque.normals.buffer,
        result.opaque.uvs.buffer,
        result.opaque.indices.buffer,
        result.opaque.blockCoords.buffer,
      );
    }
    if (result.transparent) {
      transferables.push(
        result.transparent.positions.buffer,
        result.transparent.normals.buffer,
        result.transparent.uvs.buffer,
        result.transparent.indices.buffer,
        result.transparent.blockCoords.buffer,
      );
    }

    (self as any).postMessage(result, transferables);
  } catch (err) {
    (self as any).postMessage({ chunkKey: e.data.chunkKey, buildId: e.data.buildId, error: String(err) });
  }
};
