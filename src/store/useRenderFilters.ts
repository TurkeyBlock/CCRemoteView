import { create } from 'zustand'
import { lookupBlock } from './useWorld'
import { sceneBridge } from './sceneBridge'

interface RenderFiltersState {
  transparencyList: string[]
  yMin: number
  yMax: number
  blockMapsLoaded: boolean
  blockPickMode: boolean
  pendingFilterBlocks: string[]
  miningMode: boolean
  miningOpacityMap: Record<string, number>

  isBlockVisible: (locString: string) => boolean
  addToTransparencyList: (blockName: string) => void
  removeFromTransparencyList: (blockName: string) => void
  setBlockPickMode: (on: boolean) => void
  addPendingFilterBlock: (name: string) => void
  removePendingFilterBlock: (name: string) => void
  confirmPendingFilterBlocks: () => void
  cancelPendingFilterBlocks: () => void
  setMiningOpacity: (name: string, opacity: number) => void
  removeMiningOpacity: (name: string) => void
}

export const useRenderFiltersStore = create<RenderFiltersState>()((set, get) => ({
  transparencyList: [],
  yMin: 0,
  yMax: 255,
  blockMapsLoaded: false,
  blockPickMode: false,
  pendingFilterBlocks: [],
  miningMode: false,
  miningOpacityMap: {},

  isBlockVisible: (locString) => {
    const { yMin, yMax, transparencyList, miningMode } = get()
    const y = +locString.split(',')[1]
    if (y < yMin || y > yMax) return false
    if (!miningMode) {
      const block = lookupBlock(locString)
      if (block && transparencyList.includes(block.name)) return false
    }
    return true
  },

  addToTransparencyList: (blockName) => {
    const name = blockName.trim()
    if (!name || get().transparencyList.includes(name)) return
    set((s) => ({
      transparencyList: [...s.transparencyList, name],
      miningOpacityMap: s.miningMode && !(name in s.miningOpacityMap)
        ? { ...s.miningOpacityMap, [name]: 0.3 }
        : s.miningOpacityMap,
    }))
    sceneBridge.regenerateSceneFromBlocks()
  },

  removeFromTransparencyList: (blockName) => {
    set((s) => {
      const next = { ...s.miningOpacityMap }
      delete next[blockName]
      return { transparencyList: s.transparencyList.filter((n) => n !== blockName), miningOpacityMap: next }
    })
    sceneBridge.regenerateSceneFromBlocks()
  },

  setBlockPickMode: (on) => {
    set({ blockPickMode: on, pendingFilterBlocks: on ? get().pendingFilterBlocks : [] })
  },

  addPendingFilterBlock: (name) => {
    const { transparencyList, pendingFilterBlocks } = get()
    if (transparencyList.includes(name) || pendingFilterBlocks.includes(name)) return
    set((s) => ({ pendingFilterBlocks: [...s.pendingFilterBlocks, name] }))
  },

  confirmPendingFilterBlocks: () => {
    const { pendingFilterBlocks, transparencyList, miningMode, miningOpacityMap } = get()
    const toAdd = pendingFilterBlocks.filter(n => !transparencyList.includes(n))
    if (toAdd.length === 0) { set({ blockPickMode: false, pendingFilterBlocks: [] }); return }
    const newOpacityMap = miningMode
      ? toAdd.reduce((acc, n) => ({ ...acc, [n]: miningOpacityMap[n] ?? 0.3 }), { ...miningOpacityMap })
      : miningOpacityMap
    set({ transparencyList: [...transparencyList, ...toAdd], pendingFilterBlocks: [], blockPickMode: false, miningOpacityMap: newOpacityMap })
    sceneBridge.regenerateSceneFromBlocks()
  },

  removePendingFilterBlock: (name) => {
    set((s) => ({ pendingFilterBlocks: s.pendingFilterBlocks.filter((n) => n !== name) }))
  },

  cancelPendingFilterBlocks: () => {
    set({ pendingFilterBlocks: [], blockPickMode: false })
  },

  setMiningOpacity: (name, opacity) => {
    set((s) => ({ miningOpacityMap: { ...s.miningOpacityMap, [name]: opacity } }))
  },

  removeMiningOpacity: (name) => {
    set((s) => {
      const next = { ...s.miningOpacityMap }
      delete next[name]
      return { miningOpacityMap: next }
    })
  },
}))
