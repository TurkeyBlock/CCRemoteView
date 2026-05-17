import { create } from 'zustand'
import type { Block } from '../types/world'
import { sceneBridge } from './sceneBridge'

// ─── World Block Store ─────────────────────────────────────────────────────────
// Palette + Int32Array, stride-5: [x, y, z, nameIdx, meta].
// nameIdx = -1 is a tombstone (removed block, not yet compacted).
// worldIndex maps "x,y,z" → int offset of the entry's first element.
// Compaction happens automatically on replaceWorldBlocks (full-state reload).

const INITIAL_CAPACITY = 131_072  // int32 elements (≈ 26k entries, ~512 KB)

export let worldPalette: string[]          = []
let   worldPaletteMap: Map<string, number> = new Map()
export let worldData: Int32Array           = new Int32Array(INITIAL_CAPACITY)
export let worldDataLen: number            = 0   // int32 elements used (always multiple of 5)
let   worldIndex: Map<string, number>      = new Map()  // "x,y,z" → int offset

function growWorldData() {
  const next = new Int32Array(worldData.length * 2)
  next.set(worldData)
  worldData = next
}

function getOrAddPaletteEntry(name: string): number {
  let idx = worldPaletteMap.get(name)
  if (idx === undefined) {
    idx = worldPalette.length
    worldPalette.push(name)
    worldPaletteMap.set(name, idx)
  }
  return idx
}

export function lookupBlock(locString: string): Block | undefined {
  const off = worldIndex.get(locString)
  if (off === undefined) return undefined
  return { name: worldPalette[worldData[off + 3]], metadata: worldData[off + 4] }
}

export function replaceWorldBlocks(palette: string[], data: Int32Array, len: number): void {
  worldPalette    = palette.slice()
  worldPaletteMap = new Map(palette.map((n, i) => [n, i]))
  worldData       = data
  worldDataLen    = len
  worldIndex      = new Map()
  for (let i = 0; i < len; i += 5) {
    worldIndex.set(`${data[i]},${data[i + 1]},${data[i + 2]}`, i)
  }
}

// Internal helpers shared with applyTransactions in useComputers.ts.
// Exported so the orchestrating store can perform batched block writes
// without going through the per-call sceneBridge dance.
export function _addBlockToWorldData(locString: string, block: Block): void {
  const nameIdx = getOrAddPaletteEntry(block.name)
  const meta    = block.metadata ?? 0
  const existing = worldIndex.get(locString)
  if (existing !== undefined) {
    worldData[existing + 3] = nameIdx
    worldData[existing + 4] = meta
  } else {
    if (worldDataLen + 5 > worldData.length) growWorldData()
    const c1 = locString.indexOf(',')
    const c2 = locString.indexOf(',', c1 + 1)
    worldData[worldDataLen]     = +locString.slice(0, c1)
    worldData[worldDataLen + 1] = +locString.slice(c1 + 1, c2)
    worldData[worldDataLen + 2] = +locString.slice(c2 + 1)
    worldData[worldDataLen + 3] = nameIdx
    worldData[worldDataLen + 4] = meta
    worldIndex.set(locString, worldDataLen)
    worldDataLen += 5
  }
}

export function _removeBlockFromWorldData(locString: string): void {
  const off = worldIndex.get(locString)
  if (off !== undefined) {
    worldData[off + 3] = -1
    worldIndex.delete(locString)
  }
}

// ─── Zustand store ────────────────────────────────────────────────────────────
// The actual block data lives in the module-level mutable globals above for
// performance (Int32Array, no copy-on-write). This store exposes the same
// mutation actions as before and is intentionally state-less — components
// reading block data should call `lookupBlock(...)` directly.

interface BlockWorldState {
  transactionAddBlock: (locString: string, block: Block) => void
  transactionRemoveBlock: (locString: string) => void
  clearBlocks: () => void
}

export const useBlockWorldStore = create<BlockWorldState>()(() => ({
  transactionAddBlock: (locString, block) => {
    sceneBridge.removeBlock(locString)
    _addBlockToWorldData(locString, block)
    sceneBridge.addBlock(locString, block)
  },

  transactionRemoveBlock: (locString) => {
    sceneBridge.removeBlock(locString)
    _removeBlockFromWorldData(locString)
  },

  clearBlocks: () => {
    sceneBridge.clearAllBlocks()
    worldPalette    = []
    worldPaletteMap = new Map()
    worldData       = new Int32Array(INITIAL_CAPACITY)
    worldDataLen    = 0
    worldIndex      = new Map()
  },
}))
