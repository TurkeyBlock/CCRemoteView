import { create } from 'zustand'
import * as THREE from 'three'
import type { Block, EntitySighting } from '../types/types'
import { geometryMap, textureAliases, blockTint, BIOME_TINT } from './blockMaps'

// Materials and texture caches live outside Zustand — no re-renders on load.
const materialsCache: Record<string, THREE.MeshPhongMaterial> = {}
const textureCache: Record<string, THREE.Texture> = {}
let textureIndex: string[] = []
let textureIndexLoading = false
let textureIndexPending: string[] = []

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
    const [x, y, z] = locString.split(',').map(Number)
    if (y < yMin || y > yMax) return false
    const { useWorldStore, worldBlocks } = require('./useWorld') as typeof import('./useWorld')
    const world = useWorldStore.getState()
    const block = worldBlocks[locString]
    if (block && transparencyList.includes(block.name)) return false
    for (const id in world.computers) {
      const c = world.computers[id]
      if (c.type === 'minecart' && c.loc?.x === x && c.loc?.y === y && c.loc?.z === z) return false
    }
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
      const geomId = geometryMap[id] ?? geometryMap[name]
      if (geomId === 'cross' || geomId === 'flat' || name.includes('leaves') || name.includes('sapling') || name.includes('kelp') || name.includes('seagrass'))
        mat.alphaTest = 1
      if (geomId === 'cross' || geomId === 'flat' || name.includes('sapling') || name.includes('kelp') || name.includes('seagrass'))
        mat.side = THREE.DoubleSide
      if (name.includes('water')) {
        mat.transparent = true
        mat.opacity = 0.55
        mat.depthWrite = false
      }
      if (name.includes('glass')) {
        mat.transparent = true
        mat.alphaTest = 0.5
      }
      if (geomId === 'flat') {
        mat.polygonOffset = true
        mat.polygonOffsetFactor = -1
        mat.polygonOffsetUnits = -4
      }
      const img = texture.image as { width: number; height: number }
      if (img.width !== img.height) get().addAnimatedTexture(texture)
      mat.needsUpdate = true
    }

    const tryFuzzyMatch = () => {
      const mod = name.split(':')[0]
      const blockName = name.split(':')[1]
      const fuzzy = textureIndex.find((f) => f.startsWith(mod + '/') && f.includes(blockName))
      if (fuzzy) {
        console.log(`Fuzzy match for ${id}: ${fuzzy}`)
        loadTexture(fuzzy.replace('.png', ''), () => {
          console.log(`No block texture found for ${id} (fuzzy match also failed)`)
        })
      } else {
        console.log(`No block texture found for ${id}`)
      }
    }

    const loadTexture = (texturePath: string, onError?: () => void) => {
      const loader = new THREE.TextureLoader()
      loader.load(
        textureURL + `blocks/${texturePath}.png`,
        applyTexture,
        undefined,
        onError ?? (() => {
          if (textureIndex.length === 0) {
            if (!textureIndexPending.includes(id)) textureIndexPending.push(id)
          } else {
            tryFuzzyMatch()
          }
        }),
      )
    }

    if (textureIndex.length === 0 && !textureIndexLoading) {
      textureIndexLoading = true
      fetch(textureURL + 'texture-index.json')
        .then((r) => r.json())
        .then((index: string[]) => {
          textureIndex = index
          for (const failedId of textureIndexPending) {
            delete materialsCache[failedId]
            const lastColon = failedId.lastIndexOf(':')
            const afterColon = failedId.slice(lastColon + 1)
            if (lastColon !== -1 && !isNaN(Number(afterColon))) {
              get().getBlockMaterial(failedId.slice(0, lastColon), Number(afterColon))
            } else {
              get().getBlockMaterial(failedId)
            }
          }
          textureIndexPending = []
        })
    }

    if (textureCache[id]) {
      applyTexture(textureCache[id])
    } else {
      const texturePath = textureAliases[id] ?? textureAliases[name] ?? name.replace(':', '/')
      loadTexture(texturePath)
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
