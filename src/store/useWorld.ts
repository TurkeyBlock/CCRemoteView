import { create } from 'zustand'
import type { ComputerState, Block, ChatMessage } from '../types/world'
import type { ClientMessage } from '../types/wsMessages'

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


// ─── Zustand store ────────────────────────────────────────────────────────────

// Resolved at runtime so there is no circular-import between stores.
function worldView() {
  return (require('./useWorldView') as typeof import('./useWorldView')).useWorldViewStore.getState()
}

// Per-computer high-water mark for actionSeq numbers.
const maxActionSeqPerComputer: Record<string, number> = {}

interface WorldState {
  computers: Record<string, ComputerState>
  chatLog: ChatMessage[]
  commandResult: Record<string, string>
  canvasScenes: Record<number, unknown[]>
  URL: string
  apiURL: string
  assetURL: string
  lastTransactionId: number
  isLoading: boolean
  isUnauthorized: boolean
  getComputerIds: () => number[]
  setComputerStatus: (remoteComputerState: Record<string, any>) => void
  transactionRemoveBlock: (locString: string) => void
  transactionAddBlock: (locString: string, block: Block) => void
  transactionSetComputerState: (computerState: Record<string, any>) => void
  applyTransactions: (transactions: Record<string, any>) => void
  setCanvasScene: (computerId: number, scene: unknown[]) => void
  wsSend: ((msg: ClientMessage) => void) | null
  invokeCommand: (computerId: number, command: string, args?: (string | number | boolean | null | undefined)[]) => void
  runProgram: (computerId: number, programName: string) => void
  sendCommand: (computerId: number, cmd: string, concurrent?: boolean) => void
  sendChatMessage: (computerId: number, message: string) => void
  sendStopSignal: (computerId: number) => void
  clearCommandQueue: (computerId: number) => void
  removeComputer: (id: string | number) => void
  clearBlocks: () => void
}

export const useWorldStore = create<WorldState>()((set, get) => ({
  computers: {},
  chatLog: [],
  commandResult: {},
  canvasScenes: {},
  URL: '',
  apiURL: 'api/',
  assetURL: 'assets/',
  lastTransactionId: -1,
  isLoading: true,
  isUnauthorized: false,
  wsSend: null,

  setCanvasScene: (computerId, scene) => set(s => ({ canvasScenes: { ...s.canvasScenes, [computerId]: scene } })),

  getComputerIds: () => Object.keys(get().computers).map(Number),

  setComputerStatus: (remoteComputerState) => {
    const state = get()
    let firstNewId: number | null = null
    const updates: Record<string, any> = {}

    for (const id in remoteComputerState) {
      const computerState = remoteComputerState[id]
      const existing = state.computers[id]
      if (!existing) firstNewId = parseInt(id)

      const incomingSeq = typeof computerState.actionSeq === 'number' ? computerState.actionSeq : undefined
      if (incomingSeq !== undefined) {
        if (incomingSeq === 0) {
          delete maxActionSeqPerComputer[id]
        } else {
          const maxSeq = maxActionSeqPerComputer[id] ?? 0
          if (incomingSeq < maxSeq) {
            console.warn(
              `[actionSeq] Discarding out-of-order state for computer ${id}: ` +
              `seq=${incomingSeq} arrived after seq=${maxSeq}`,
              { loc: computerState.loc, rot: computerState.rot, actionSeq: incomingSeq }
            )
            continue
          }
          maxActionSeqPerComputer[id] = incomingSeq
        }
      }

      const inv = computerState.inv ? [...computerState.inv] : undefined
      if (inv) for (let i = 0; i < inv.length; i++) if (inv[i] === 0) inv[i] = undefined
      const entities = computerState.entities ? [...computerState.entities] : undefined

      const ws_connected  = computerState.ws_connected  !== undefined ? computerState.ws_connected  : existing?.ws_connected
      const ws_request_at = computerState.ws_request_at !== undefined ? computerState.ws_request_at : existing?.ws_request_at

      const loc = computerState.loc
      const locChanged = !existing?.loc !== !loc
        || (loc && (existing.loc?.x !== loc.x || existing.loc?.y !== loc.y || existing.loc?.z !== loc.z))
      const invChanged = JSON.stringify(existing?.inv) !== JSON.stringify(inv)
      const entitiesChanged = JSON.stringify(existing?.entities) !== JSON.stringify(entities)
      const adjInvChanged = JSON.stringify(computerState.adjacentInventory ?? {}) !== JSON.stringify((existing as any)?.adjacentInventory ?? {})
      const playerInventoryChanged = JSON.stringify(existing?.inventory) !== JSON.stringify(computerState.inventory)
      const playerEquipmentChanged = JSON.stringify(existing?.equipment) !== JSON.stringify(computerState.equipment)
      const playerEnderChanged = JSON.stringify(existing?.enderChest) !== JSON.stringify(computerState.enderChest)
      const playerNameChanged = existing?.playerName !== computerState.playerName
      const glassesSceneChanged = JSON.stringify(existing?.glassesScene) !== JSON.stringify(computerState.glassesScene)
      const changed = !existing
        || existing.fuelLevel !== computerState.fuelLevel
        || existing.label !== computerState.label
        || existing.type !== computerState.type
        || existing.ws_connected !== ws_connected
        || existing.ws_request_at !== ws_request_at
        || existing.rot !== computerState.rot
        || existing.selectedSlot !== computerState.selectedSlot
        || existing.yaw !== computerState.yaw
        || existing.pitch !== computerState.pitch
        || locChanged
        || invChanged
        || entitiesChanged
        || adjInvChanged
        || playerInventoryChanged
        || playerEquipmentChanged
        || playerEnderChanged
        || playerNameChanged
        || glassesSceneChanged

      if (changed) {
        if (existing?.ws_connected && !ws_connected) {
          console.warn(
            `[useWorld] ws_connected dropped for computer ${id}`,
            {
              prev_ws_connected: existing.ws_connected,
              next_ws_connected: ws_connected,
              raw_ws_connected: computerState.ws_connected,
              prev_ws_request_at: existing.ws_request_at,
              next_ws_request_at: ws_request_at,
              prev_actionSeq: existing.actionSeq,
              next_actionSeq: computerState.actionSeq,
              stack: new Error().stack,
            }
          )
        }
        updates[id] = { ...computerState, ws_connected, ws_request_at, entities, inv, modified: Date.now() }
      }
    }

    if (Object.keys(updates).length === 0 && firstNewId === null) return
    if (firstNewId !== null) worldView().setSelectedComputerId(firstNewId)
    set(s => ({ computers: { ...s.computers, ...updates } }))
  },

  transactionRemoveBlock: (locString) => {
    worldView().removeBlock(locString)
    const off = worldIndex.get(locString)
    if (off !== undefined) {
      worldData[off + 3] = -1
      worldIndex.delete(locString)
    }
  },

  transactionAddBlock: (locString, block) => {
    const nameIdx = getOrAddPaletteEntry(block.name)
    const meta    = block.metadata ?? 0
    const existing = worldIndex.get(locString)
    worldView().removeBlock(locString)
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
    worldView().addBlock(locString, block)
  },

  transactionSetComputerState: (computerState) => {
    get().setComputerStatus(computerState)
    const wv = worldView()
    for (const id of Object.keys(computerState)) {
      wv.updateComputer(id)
      if (computerState[id].entities !== undefined) wv.updateEntities(id)
    }
  },

  applyTransactions: (transactions) => {
    let maxId = get().lastTransactionId
    const removes: string[] = []
    const adds: Array<[string, Block]> = []

    const sorted = Object.entries(transactions)
      .map(([k, v]) => [Number(k), v] as [number, any])
      .sort(([a], [b]) => a - b)

    const newChatEntries: ChatMessage[] = []
    for (const [id, t] of sorted) {
      if (!t) continue
      if (id > maxId) maxId = id
      for (const [locString, block] of Object.entries(t.blocks ?? {})) {
        if (block) adds.push([locString, block as Block])
        else removes.push(locString)
      }
      get().transactionSetComputerState(t.computers ?? {})
      if (Array.isArray(t.chatLog)) newChatEntries.push(...t.chatLog)
    }
    if (newChatEntries.length > 0) {
      set(s => {
        const merged = [...s.chatLog, ...newChatEntries]
        return { chatLog: merged.length > 500 ? merged.slice(merged.length - 500) : merged }
      })
    }

    if (removes.length > 0 || adds.length > 0) {
      const wv = worldView()
      for (const loc of removes) wv.removeBlock(loc)
      for (const [loc] of adds) wv.removeBlock(loc)

      for (const loc of removes) {
        const off = worldIndex.get(loc)
        if (off !== undefined) {
          worldData[off + 3] = -1
          worldIndex.delete(loc)
        }
      }

      for (const [loc, block] of adds) {
        const nameIdx  = getOrAddPaletteEntry(block.name)
        const meta     = block.metadata ?? 0
        const existing = worldIndex.get(loc)
        if (existing !== undefined) {
          worldData[existing + 3] = nameIdx
          worldData[existing + 4] = meta
        } else {
          if (worldDataLen + 5 > worldData.length) growWorldData()
          const c1 = loc.indexOf(',')
          const c2 = loc.indexOf(',', c1 + 1)
          worldData[worldDataLen]     = +loc.slice(0, c1)
          worldData[worldDataLen + 1] = +loc.slice(c1 + 1, c2)
          worldData[worldDataLen + 2] = +loc.slice(c2 + 1)
          worldData[worldDataLen + 3] = nameIdx
          worldData[worldDataLen + 4] = meta
          worldIndex.set(loc, worldDataLen)
          worldDataLen += 5
        }
      }

      for (const [loc, block] of adds) wv.addBlock(loc, block)
    }

    set({ lastTransactionId: maxId })
  },

  invokeCommand: (computerId, command, args) => {
    const cleanArgs = args?.map(a => a === undefined ? null : a)
    const msg: ClientMessage = cleanArgs && cleanArgs.length > 0
      ? { type: 'invokeCommand', id: computerId, command, args: cleanArgs }
      : { type: 'invokeCommand', id: computerId, command }
    get().wsSend?.(msg)
  },

  runProgram: (computerId, programName) => {
    get().wsSend?.({ type: 'runProgram', id: computerId, program: programName })
  },

  sendCommand: (computerId, cmd, concurrent) => {
    const msg: ClientMessage = concurrent !== undefined
      ? { type: 'setCommand', id: computerId, cmd, concurrent }
      : { type: 'setCommand', id: computerId, cmd }
    get().wsSend?.(msg)
  },

  sendChatMessage: (computerId, message) => {
    get().invokeCommand(computerId, 'say', [message])
  },

  sendStopSignal: (computerId) => {
    get().wsSend?.({ type: 'setStopSignal', id: computerId })
    get().wsSend?.({ type: 'clearCommandQueue', id: computerId })
  },

  clearCommandQueue: (computerId) => {
    get().wsSend?.({ type: 'clearCommandQueue', id: computerId })
  },

  removeComputer: (id) => {
    const sid = String(id)
    const wv = worldView()
    set((state) => {
      const computers = { ...state.computers }
      delete computers[sid]
      return { computers }
    })
    if (wv.selectedComputerId === Number(id)) wv.setSelectedComputerId(-1)
    wv.updateEntities(sid)
    wv.removeComputerModel(sid)
  },

  clearBlocks: () => {
    worldView().clearAllBlocks()
    worldPalette    = []
    worldPaletteMap = new Map()
    worldData       = new Int32Array(INITIAL_CAPACITY)
    worldDataLen    = 0
    worldIndex      = new Map()
  },
}))
