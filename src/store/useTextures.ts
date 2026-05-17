import { create } from 'zustand'
import * as THREE from 'three'
import { GEOMETRY, geometryMap, CROSS_BY_NAME, FLAT_BY_NAME, textureAliases, uvOverrides, blockTint, BIOME_TINT, hasBiomeTint, isLiquid, isAlphaGlass, itemTextureAliases } from '../utils/blockMaps'
import { useWorldStore } from './useWorld'
import { sceneBridge } from './sceneBridge'
import { useRenderFiltersStore } from './useRenderFilters'

// Materials and texture caches live outside Zustand — no re-renders on load.
const materialsCache: Record<string, THREE.MeshPhongMaterial> = {}
const textureCache: Record<string, THREE.Texture> = {}

// Generated block→texture+geometry maps from the texture extractor.
// block-name-map.json keys: "mod:blockname:meta" → { texture: "blocks/mod/texture.png", geometry: "cube" }
// Served at ~100KB under compression. Fetched once on load, held in memory for the session.
type BlockMapEntry = { texture: string; geometry: string; uv?: [number, number, number, number] }
let blockNameMap: Record<string, BlockMapEntry> = {}
let blockMapsReady = false
let blockMapsLoading = false
let blockMapsPending: string[] = [] // blocks requested before maps finished loading
let itemNameMap: Record<string, { texture: string }> = {}

function ensureBlockMapsLoaded(assetURL: string, onReady: () => void) {
  if (blockMapsReady) { onReady(); return }
  if (!blockMapsLoading) {
    blockMapsLoading = true
    Promise.all([
      fetch(assetURL + 'block-name-map.json').then(r => r.ok ? r.json() : {}),
      fetch(assetURL + 'item-name-map.json').then(r => r.ok ? r.json() : {}),
    ]).then(([nameMap, itemMap]) => {
      blockNameMap = nameMap
      itemNameMap = itemMap
      blockMapsReady = true
      useRenderFiltersStore.setState({ blockMapsLoaded: true })
      onReady()
      // Rebuild chunks once so any built before the map loaded get correct geometry.
      sceneBridge.regenerateSceneFromBlocks()
    }).catch(() => {
      blockMapsReady = true
      useRenderFiltersStore.setState({ blockMapsLoaded: true })
      onReady()
    })
  }
}

// Converts a map entry's texture path to the format loadTexture expects ("mod/texture").
function mapToTexturePath(entry: BlockMapEntry): string {
  return entry.texture.replace(/^blocks\//, '').replace(/\.png$/, '')
}

// Returns the texture URL and optional UV crop for a block item icon, using the same
// resolution priority as getBlockMaterial (aliases > block-name-map > null).
// Returns null if maps are not yet loaded or the name is not a known block.
export function getBlockIconInfo(
  assetURL: string,
  name: string,
  meta = 0
): { url: string; uv?: [number, number, number, number] } | null {
  if (!blockMapsReady) return null
  const id = meta ? `${name}:${meta}` : name
  const alias = textureAliases[id] ?? textureAliases[`${name}:0`] ?? textureAliases[name]
  const manualUV = (uvOverrides[id] ?? uvOverrides[`${name}:0`] ?? uvOverrides[name]) ?? undefined
  if (alias) return { url: assetURL + `blocks/${alias}.png`, uv: manualUV }
  const entry = blockNameMap[`${name}:${meta}`] ?? blockNameMap[`${name}:0`] ?? blockNameMap[name]
  if (entry) return { url: assetURL + entry.texture, uv: manualUV }
  return null
}

// Returns the texture URL for a pure item icon, using itemTextureAliases (manual overrides)
// then item-name-map.json (extractor output). Returns null if the item is unknown.
export function getItemIconInfo(
  assetURL: string,
  name: string,
  meta = 0
): { url: string } | null {
  if (!blockMapsReady) return null
  const id = meta ? `${name}:${meta}` : name
  const alias = itemTextureAliases[id] ?? itemTextureAliases[`${name}:0`] ?? itemTextureAliases[name]
  if (alias) return { url: assetURL + `items/${alias}.png` }
  const entry = itemNameMap[id] ?? itemNameMap[`${name}:0`] ?? itemNameMap[name]
  if (entry) return { url: assetURL + entry.texture }
  return null
}


// Resolves the texture path for a block, applying alias → block-name-map fallback.
// Returns:
//   { kind: 'alias', path }    — manual override texture (loadable immediately)
//   { kind: 'mapped', path }   — resolved via block-name-map (loadable immediately)
//   { kind: 'pending' }        — block maps not yet loaded; caller should queue retry
//   { kind: 'missing' }        — maps loaded but no entry; caller should log/skip
function resolveTextureUrl(
  name: string,
  metadata: number,
  id: string
): { kind: 'alias' | 'mapped'; path: string } | { kind: 'pending' | 'missing' } {
  const alias = textureAliases[id] ?? textureAliases[`${name}:0`] ?? textureAliases[name]
  if (alias) return { kind: 'alias', path: alias }
  if (!blockMapsReady) return { kind: 'pending' }
  const mapped = blockNameMap[`${name}:${metadata}`] ?? blockNameMap[`${name}:0`] ?? blockNameMap[name]
  if (mapped) return { kind: 'mapped', path: mapToTexturePath(mapped) }
  return { kind: 'missing' }
}

// Applies geometry-specific tuning to a material (transparency, alphaTest, polygon offset, etc.).
function applyMaterialForGeometry(
  mat: THREE.MeshPhongMaterial,
  geomId: GEOMETRY,
  name: string
): void {
  if (geomId === GEOMETRY.CROSS || geomId === GEOMETRY.FLAT) {
    mat.alphaTest = 1
    mat.side = THREE.DoubleSide
  }
  if (geomId === GEOMETRY.LIQUID) {
    mat.transparent = true
    mat.opacity = 0.55
    mat.depthWrite = false
  }
  if (geomId === GEOMETRY.PANE || isAlphaGlass(name, geomId)) {
    mat.transparent = true
    mat.alphaTest = 0.5
  }
  if (geomId === GEOMETRY.LEAVES) {
    mat.alphaTest = 0.5
  }
  if (geomId === GEOMETRY.FLAT) {
    mat.polygonOffset = true
    mat.polygonOffsetFactor = -1
    mat.polygonOffsetUnits = -4
  }
}

// Wires a loaded texture into the material:
//   - nearest-neighbour filtering
//   - biome/manual tint colour
//   - geometry-specific material tuning (via applyMaterialForGeometry)
//   - UV sub-region (manual override > extracted map UV for non-square images)
//   - animated-texture registration for non-square sprite sheets (except cube6)
function applyTextureToMaterial(
  mat: THREE.MeshPhongMaterial,
  texture: THREE.Texture,
  id: string,
  name: string,
  metadata: number
): void {
  textureCache[id] = texture
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  mat.map = texture
  mat.color.setHex(0xffffff)
  const tint = blockTint[id] ?? blockTint[name]
  if (tint) mat.color.setHex(tint)
  else if (hasBiomeTint(name)) mat.color.setHex(BIOME_TINT)

  const geomId = getBlockGeometry(name, metadata)
  applyMaterialForGeometry(mat, geomId, name)

  const img = texture.image as { width: number; height: number }

  // UV sub-region for sprite-sheet textures.
  // Coordinates are in pixels matching the actual PNG dimensions.
  // Priority: uvOverrides (manual, always trusted) > block-name-map UV (only for
  // non-square images — square images are single sprites, not sprite sheets, so
  // any UV in the map was wrongly extracted from model element geometry).
  const manualUV = uvOverrides[id] ?? uvOverrides[`${name}:0`] ?? uvOverrides[name] ?? null
  const mapUV = blockNameMap[`${name}:${metadata}`]?.uv ?? blockNameMap[`${name}:0`]?.uv ?? blockNameMap[name]?.uv ?? null
  const blockUV = manualUV ?? (mapUV && img.width !== img.height ? mapUV : null)
  if (blockUV) {
    const [u1, v1, u2, v2] = blockUV
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set((u2 - u1) / img.width, (v2 - v1) / img.height)
    texture.offset.set(u1 / img.width, v1 / img.height)
    texture.needsUpdate = true
  }

  // Non-square textures default to "animated sprite sheet" (fire, water, etc.).
  // cube6 geometry uses a 96×16 face strip whose UVs are picked per-face by
  // the chunk builder, so it must NOT be animated.
  if (!blockUV && img.width !== img.height && geomId !== GEOMETRY.CUBE6) sceneBridge.addAnimatedTexture(texture)
  mat.needsUpdate = true
}

// Loads a texture by URL and on success applies it to the material via applyTextureToMaterial.
function loadTextureAndTune(
  mat: THREE.MeshPhongMaterial,
  url: string,
  id: string,
  name: string,
  metadata: number
): void {
  const loader = new THREE.TextureLoader()
  loader.load(
    url,
    (texture) => applyTextureToMaterial(mat, texture, id, name, metadata),
    undefined,
    () => { console.log(`No block texture found for ${id} (${url})`) },
  )
}

export function getBlockGeometry(name: string, metadata = 0): GEOMETRY {
  const id = metadata ? `${name}:${metadata}` : name
  const blockName = name.includes(':') ? name.split(':')[1] : name
  const raw: string = geometryMap[id] ?? geometryMap[name]
    ?? blockNameMap[`${name}:${metadata}`]?.geometry
    ?? blockNameMap[`${name}:0`]?.geometry
    ?? blockNameMap[name]?.geometry
    ?? (isLiquid(name)               ? GEOMETRY.LIQUID : undefined)
    ?? (CROSS_BY_NAME.test(blockName) ? GEOMETRY.CROSS  : undefined)
    ?? (FLAT_BY_NAME.test(blockName)  ? GEOMETRY.FLAT   : undefined)
    ?? GEOMETRY.CUBE
  // Resolve slab top/bottom from metadata.
  // "slab" is the legacy extractor output; "slab_bottom" is the current one.
  // In 1.12, metadata bit 3 (≥ 8) means top slab.
  // In 1.13+, the extractor emits "slab_top" directly for top-slab model variants,
  // so those entries are already correct and this branch is never reached.
  if (raw === 'slab' || raw === GEOMETRY.SLAB_BOTTOM) {
    if (blockName.includes('double')) return GEOMETRY.CUBE
    return metadata >= 8 ? GEOMETRY.SLAB_TOP : GEOMETRY.SLAB_BOTTOM
  }
  return raw as GEOMETRY
}

/**
 * Dispose all cached materials and clear the cache.
 * Textures are kept in textureCache so they are reused without re-fetching.
 * Call before a full scene regeneration.
 */
export function clearMaterialsCache(): void {
  for (const mat of Object.values(materialsCache)) mat.dispose()
  for (const key of Object.keys(materialsCache)) delete materialsCache[key]
}

interface TexturesState {
  getBlockMaterial: (name: string, metadata?: number) => THREE.MeshPhongMaterial
  loadBlockMaps: () => void
}

export const useTexturesStore = create<TexturesState>()(() => ({
  getBlockMaterial: (name, metadata = 0) => {
    const id = metadata ? `${name}:${metadata}` : name
    if (materialsCache[id]) return materialsCache[id]

    const mat = new THREE.MeshPhongMaterial({ color: Math.floor(Math.random() * 0xff00ff) })
    materialsCache[id] = mat

    const assetURL = useWorldStore.getState().assetURL

    if (textureCache[id]) {
      applyTextureToMaterial(mat, textureCache[id], id, name, metadata)
      return mat
    }

    // Drain pending retry queue once block maps finish loading. Materials created
    // before the maps were ready got a random colour; this re-resolves and applies
    // the correct texture in-place so scene geometry picks it up without re-render.
    ensureBlockMapsLoaded(assetURL, () => {
      const pending = blockMapsPending
      blockMapsPending = []
      for (const pendingId of pending) {
        const existingMat = materialsCache[pendingId]
        if (!existingMat) continue

        const lastColon = pendingId.lastIndexOf(':')
        const afterColon = pendingId.slice(lastColon + 1)
        const hasNumericSuffix = lastColon !== -1 && !isNaN(Number(afterColon))
        const retryName = hasNumericSuffix ? pendingId.slice(0, lastColon) : pendingId
        const retryMeta = hasNumericSuffix ? Number(afterColon) : 0

        const mapped = blockNameMap[`${retryName}:${retryMeta}`]
        if (!mapped) continue

        new THREE.TextureLoader().load(
          assetURL + `blocks/${mapToTexturePath(mapped)}.png`,
          (texture) => {
            textureCache[pendingId] = texture
            texture.minFilter = THREE.NearestFilter
            texture.magFilter = THREE.NearestFilter
            existingMat.map = texture
            existingMat.color.setHex(0xffffff)
            const tint = blockTint[pendingId] ?? blockTint[retryName]
            if (tint) existingMat.color.setHex(tint)
            else if (retryName.includes('leaves')) existingMat.color.setHex(BIOME_TINT)
            existingMat.needsUpdate = true
          }
        )
      }
    })

    // Resolution order:
    //   1. textureAliases — manual overrides (highest priority)
    //   2. block-name-map.json — generated from blockstate/model chain
    //   3. queue for retry if maps not yet loaded
    const resolved = resolveTextureUrl(name, metadata, id)
    if (resolved.kind === 'alias' || resolved.kind === 'mapped') {
      loadTextureAndTune(mat, assetURL + `blocks/${resolved.path}.png`, id, name, metadata)
    } else if (resolved.kind === 'pending') {
      // Maps still loading — queue for retry, show random colour in the meantime.
      blockMapsPending.push(id)
    } else {
      console.log(`No map entry for ${id} (map has ${Object.keys(blockNameMap).length} entries, tried: ${name}:${metadata}, ${name}:0, ${name})`)
    }
    return mat
  },

  loadBlockMaps: () => {
    const assetURL = useWorldStore.getState().assetURL
    ensureBlockMapsLoaded(assetURL, () => {})
  },
}))

/**
 * Convenience export — most callers want the materializer function directly.
 */
export function getBlockMaterial(name: string, metadata = 0): THREE.MeshPhongMaterial {
  return useTexturesStore.getState().getBlockMaterial(name, metadata)
}
