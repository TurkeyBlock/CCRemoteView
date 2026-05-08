import { create } from 'zustand'
import * as THREE from 'three'
import type { Block, EntitySighting } from '../types/world'
import { geometryMap, textureAliases, uvOverrides, blockTint, BIOME_TINT, isLiquid } from './blockMaps'

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

function ensureBlockMapsLoaded(textureURL: string, onReady: () => void) {
  if (blockMapsReady) { onReady(); return }
  if (!blockMapsLoading) {
    blockMapsLoading = true
    Promise.all([
      fetch(textureURL + 'block-name-map.json').then(r => r.ok ? r.json() : {}),
    ]).then(([nameMap]) => {
      blockNameMap = nameMap
      blockMapsReady = true
      onReady()
      // Rebuild chunks once so any built before the map loaded get correct geometry.
      useWorldViewStore.getState().regenerateSceneFromBlocks()
    }).catch(() => { blockMapsReady = true; onReady() })
  }
}

// Converts a map entry's texture path to the format loadTexture expects ("mod/texture").
function mapToTexturePath(entry: BlockMapEntry): string {
  return entry.texture.replace(/^blocks\//, '').replace(/\.png$/, '')
}

// Name-based geometry fallbacks — match before the map is loaded so chunks
// built during startup get the right shape immediately.
const CROSS_BY_NAME = /reeds|tallgrass|double_plant|dead.*bush|(?:^|_)fern|flower|sapling|mushroom|crop|wheat|carrot|potato|beetroot|nether_wart|waterlily|vine|cobweb|torch|fire/
const FLAT_BY_NAME  = /snow_layer|lily_pad|carpet/

export function getBlockGeometry(name: string, metadata = 0): string {
  const id = metadata ? `${name}:${metadata}` : name
  const blockName = name.includes(':') ? name.split(':')[1] : name
  const raw = geometryMap[id] ?? geometryMap[name]
    ?? blockNameMap[`${name}:${metadata}`]?.geometry
    ?? blockNameMap[`${name}:0`]?.geometry
    ?? blockNameMap[name]?.geometry
    ?? (isLiquid(name)               ? 'liquid' : null)
    ?? (CROSS_BY_NAME.test(blockName) ? 'cross'  : null)
    ?? (FLAT_BY_NAME.test(blockName)  ? 'flat'   : null)
    ?? 'cube'
  // Resolve slab top/bottom from metadata.
  // "slab" is the legacy extractor output; "slab_bottom" is the current one.
  // In 1.12, metadata bit 3 (≥ 8) means top slab.
  // In 1.13+, the extractor emits "slab_top" directly for top-slab model variants,
  // so those entries are already correct and this branch is never reached.
  if (raw === 'slab' || raw === 'slab_bottom') {
    if (blockName.includes('double')) return 'cube'
    return metadata >= 8 ? 'slab_top' : 'slab_bottom'
  }
  return raw
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

type SceneCallback<T extends unknown[] = []> = (...args: T) => void

interface WorldViewState {
  // Scene callbacks registered by the Scene component on mount
  regenerateSceneFromBlocks: SceneCallback
  render: SceneCallback
  setCameraFocus: SceneCallback<[THREE.Vector3]>
  focusOnComputer: SceneCallback<[number]>
  addBlock: SceneCallback<[string, Block]>
  removeBlock: SceneCallback<[string]>
  clearAllBlocks: SceneCallback
  updateComputer: SceneCallback<[string]>
  updateEntities: SceneCallback<[string]>
  removeComputerModel: SceneCallback<[string]>
  addAnimatedTexture: SceneCallback<[THREE.Texture]>
  updateChunkVisibility: SceneCallback

  followedComputer: { computerId: number; lastPos: { x: number; y: number; z: number } }
  hoveredBlock: Block | null
  hoveredBlockPos: THREE.Vector3 | null
  hoveredEntity: (EntitySighting & { worldPos: THREE.Vector3 }) | null
  gotoBlockPos: THREE.Vector3 | null
  selectedComputerId: number
  computerModels: Record<string, THREE.Object3D>
  selectedInventoryPos: { x: number; y: number; z: number } | null
  transparencyList: string[]
  yMin: number
  yMax: number
  renderDistance: number
  fastRender: boolean
  skipLoadYield: boolean
  lockChunks: boolean
  showOrbitMarker: boolean
  lockBlockInfo: boolean

  // Actions
  setSelectedComputerId: (id: number) => void
  isBlockVisible: (locString: string) => boolean
  addToTransparencyList: (blockName: string) => void
  removeFromTransparencyList: (blockName: string) => void
  getBlockMaterial: (name: string, metadata?: number) => THREE.MeshPhongMaterial
  followComputer: (computerId: number) => void
}

export const useWorldViewStore = create<WorldViewState>()((set, get) => ({
  regenerateSceneFromBlocks: () => {},
  render: () => {},
  setCameraFocus: () => {},
  focusOnComputer: () => {},
  addBlock: () => {},
  removeBlock: () => {},
  clearAllBlocks: () => {},
  updateComputer: () => {},
  updateEntities: () => {},
  removeComputerModel: () => {},
  addAnimatedTexture: () => {},
  updateChunkVisibility: () => {},

  followedComputer: { computerId: -1, lastPos: { x: 0, y: 0, z: 0 } },
  hoveredBlock: null,
  hoveredBlockPos: null,
  hoveredEntity: null,
  gotoBlockPos: null,
  selectedComputerId: -1,
  computerModels: {},
  selectedInventoryPos: null,
  transparencyList: [],
  yMin: 0,
  yMax: 255,
  renderDistance: 12,
  fastRender: false,
  skipLoadYield: false,
  lockChunks: false,
  showOrbitMarker: false,
  lockBlockInfo: true,

  setSelectedComputerId: (id) => set({ selectedComputerId: id }),

  isBlockVisible: (locString) => {
    const { yMin, yMax, transparencyList } = get()
    const y = +locString.split(',')[1]
    if (y < yMin || y > yMax) return false
    const { worldBlocks } = require('./useWorld') as typeof import('./useWorld')
    const block = worldBlocks[locString]
    if (block && transparencyList.includes(block.name)) return false
    return true
  },

  addToTransparencyList: (blockName) => {
    const name = blockName.trim()
    if (!name || get().transparencyList.includes(name)) return
    set((s) => ({ transparencyList: [...s.transparencyList, name] }))
    get().regenerateSceneFromBlocks()
  },

  removeFromTransparencyList: (blockName) => {
    set((s) => ({ transparencyList: s.transparencyList.filter((n) => n !== blockName) }))
    get().regenerateSceneFromBlocks()
  },

  getBlockMaterial: (name, metadata = 0) => {
    const id = metadata ? `${name}:${metadata}` : name
    if (materialsCache[id]) return materialsCache[id]

    const mat = new THREE.MeshPhongMaterial({ color: Math.floor(Math.random() * 0xff00ff) })
    materialsCache[id] = mat

    const { useWorldStore } = require('./useWorld') as typeof import('./useWorld')
    const textureURL = useWorldStore.getState().textureURL

    const applyTexture = (texture: THREE.Texture) => {
      textureCache[id] = texture
      texture.minFilter = THREE.NearestFilter
      texture.magFilter = THREE.NearestFilter
      mat.map = texture
      mat.color.setHex(0xffffff)
      const tint = blockTint[id] ?? blockTint[name]
      if (tint) mat.color.setHex(tint)
      else if (name.includes('leaves')) mat.color.setHex(BIOME_TINT)

      const geomId = getBlockGeometry(name, metadata)

      if (geomId === 'cross' || geomId === 'flat' || geomId === 'leaves' ||
          name.includes('sapling') || name.includes('kelp') || name.includes('seagrass'))
        mat.alphaTest = 1
      if (geomId === 'cross' || geomId === 'flat' ||
          name.includes('sapling') || name.includes('kelp') || name.includes('seagrass'))
        mat.side = THREE.DoubleSide
      if (geomId === 'liquid') {
        mat.transparent = true
        mat.opacity = 0.55
        mat.depthWrite = false
      }
      if (geomId === 'glass' || geomId === 'pane') {
        mat.transparent = true
        mat.alphaTest = 0.5
      }
      if (geomId === 'flat') {
        mat.polygonOffset = true
        mat.polygonOffsetFactor = -1
        mat.polygonOffsetUnits = -4
      }
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
      if (!blockUV && img.width !== img.height && geomId !== 'cube6') get().addAnimatedTexture(texture)
      mat.needsUpdate = true
    }


    const loadTexture = (texturePath: string) => {
      const loader = new THREE.TextureLoader()
      loader.load(
        textureURL + `blocks/${texturePath}.png`,
        applyTexture,
        undefined,
        () => { console.log(`No block texture found for ${id} (${texturePath})`) },
        // onError was: if textureIndex empty → push to textureIndexPending, else tryFuzzyMatch()
      )
    }


    if (textureCache[id]) {
      applyTexture(textureCache[id])
      return mat
    }

    // Resolution order:
    //   1. textureAliases — manual overrides (highest priority)
    //   2. block-name-map.json — generated from blockstate/model chain
    //   3. naive name→path guess (mod:block → mod/block)
    //   4. name→path guess (mod:block → blocks/mod/block.png) on load failure
    const alias = textureAliases[id] ?? textureAliases[`${name}:0`] ?? textureAliases[name]

    ensureBlockMapsLoaded(textureURL, () => {
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

        // Update the existing material in-place so scene geometry referencing it
        // automatically reflects the corrected texture without needing a re-render.
        new THREE.TextureLoader().load(
          textureURL + `blocks/${mapToTexturePath(mapped)}.png`,
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

    if (alias) {
      loadTexture(alias)
    } else if (!blockMapsReady) {
      // Maps still loading — queue for retry, show random colour in the meantime.
      blockMapsPending.push(id)
    } else {
      // Also try :0 as a fallback, and bare name for blocks with metadata baked in (e.g. name="chisel:marble:8", meta=0).
      const mapped = blockNameMap[`${name}:${metadata}`] ?? blockNameMap[`${name}:0`] ?? blockNameMap[name]
      if (mapped) {
        loadTexture(mapToTexturePath(mapped))
      } else {
        console.log(`No map entry for ${id} (map has ${Object.keys(blockNameMap).length} entries, tried: ${name}:${metadata}, ${name}:0, ${name})`)
      }
    }
    return mat
  },

  followComputer: (computerId) => {
    const current = get().followedComputer.computerId
    const nextId = current === computerId ? -1 : computerId
    set((s) => ({ followedComputer: { ...s.followedComputer, computerId: nextId } }))
    if (nextId === -1) return
    const { useWorldStore } = require('./useWorld') as typeof import('./useWorld')
    const loc = useWorldStore.getState().computers[computerId]?.loc
    if (loc) {
      set((s) => ({ followedComputer: { ...s.followedComputer, lastPos: loc } }))
      get().focusOnComputer(computerId)
    }
  },
}))
