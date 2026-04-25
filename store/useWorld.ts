import { create } from 'zustand'
import type { ComputerState, Block } from '../types/types'

export let worldBlocks: Record<string, Block> = {}

export function replaceWorldBlocks(newBlocks: Record<string, Block>) {
  worldBlocks = newBlocks
}

// Resolved at runtime so there is no circular-import between stores.
// worldView actions (addBlock, removeBlock, etc.) are called via this getter.
function worldView() {
  return (require('./useWorldView') as typeof import('./useWorldView')).useWorldViewStore.getState()
}

// Per-computer high-water mark for actionSeq numbers.
// Module-level (not Zustand) so updates never cause re-renders.
const maxActionSeqPerComputer: Record<string, number> = {}

interface WorldState {
  computers: Record<string, ComputerState>
  commandResult: Record<string, string>
  URL: string
  apiURL: string
  textureURL: string
  lastTransactionId: number
  isLoading: boolean
  isUnauthorized: boolean
  getComputerIds: () => number[]
  setComputerStatus: (remoteComputerState: Record<string, any>) => void
  transactionRemoveBlock: (locString: string) => void
  transactionAddBlock: (locString: string, block: Block) => void
  transactionSetComputerState: (computerState: Record<string, any>) => void
  applyTransactions: (transactions: Record<string, any>) => void
  wsSend: ((msg: object) => void) | null
  sendCommand: (computerId: number, cmd: string) => void
  sendSideCommand: (computerId: number, cmd: string) => void
  sendChatMessage: (computerId: number, message: string) => void
  sendStopSignal: (computerId: number) => void
  clearCommandQueue: (computerId: number) => void
  removeComputer: (id: string | number) => void
  clearBlocks: () => void
}

export const useWorldStore = create<WorldState>()((set, get) => ({
  computers: {},
  commandResult: {},
  URL: '',
  apiURL: 'api/',
  textureURL: 'textures/',
  lastTransactionId: -1,
  isLoading: true,
  isUnauthorized: false,
  wsSend: null,

  getComputerIds: () => Object.keys(get().computers).map(Number),

  setComputerStatus: (remoteComputerState) => {
    const state = get()
    let firstNewId: number | null = null
    const updates: Record<string, any> = {}

    for (const id in remoteComputerState) {
      const computerState = remoteComputerState[id]
      const existing = state.computers[id]
      if (!existing) firstNewId = parseInt(id)

      // Out-of-order state filtering: discard state updates whose actionSeq is
      // below the highest we have already applied for this computer.
      const incomingSeq = typeof computerState.actionSeq === 'number' ? computerState.actionSeq : undefined
      if (incomingSeq !== undefined) {
        if (incomingSeq === 0) {
          delete maxActionSeqPerComputer[id]  // computer rebooted — reset tracking
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

      // Lua-sent transactions don't include server-managed connection fields.
      // Fall back to existing values so they are never clobbered by undefined.
      const ws_connected  = computerState.ws_connected  !== undefined ? computerState.ws_connected  : existing?.ws_connected
      const ws_request_at = computerState.ws_request_at !== undefined ? computerState.ws_request_at : existing?.ws_request_at

      const loc = computerState.loc
      const locChanged = !existing?.loc !== !loc
        || (loc && (existing.loc?.x !== loc.x || existing.loc?.y !== loc.y || existing.loc?.z !== loc.z))
      const invChanged = JSON.stringify(existing?.inv) !== JSON.stringify(inv)
      const entitiesChanged = JSON.stringify(existing?.entities) !== JSON.stringify(entities)
      const chatLogChanged = JSON.stringify(existing?.chatLog) !== JSON.stringify(computerState.chatLog)
      const adjInvChanged = JSON.stringify(computerState.adjacentInventory ?? {}) !== JSON.stringify((existing as any)?.adjacentInventory ?? {})
      const changed = !existing
        || existing.fuelLevel !== computerState.fuelLevel
        || existing.label !== computerState.label
        || existing.type !== computerState.type
        || existing.ws_connected !== ws_connected
        || existing.ws_request_at !== ws_request_at
        || existing.rot !== computerState.rot
        || existing.selectedSlot !== computerState.selectedSlot
        || locChanged
        || invChanged
        || entitiesChanged
        || chatLogChanged
        || adjInvChanged

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
    delete worldBlocks[locString]
  },

  transactionAddBlock: (locString, block) => {
    worldView().removeBlock(locString)
    worldBlocks[locString] = block
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

    for (const [id, t] of sorted) {
      if (!t) continue
      if (id > maxId) maxId = id
      for (const [locString, block] of Object.entries(t.blocks ?? {})) {
        if (block) adds.push([locString, block as Block])
        else removes.push(locString)
      }
      get().transactionSetComputerState(t.computers ?? {})
    }

    if (removes.length > 0 || adds.length > 0) {
      const wv = worldView()
      for (const loc of removes) wv.removeBlock(loc)
      for (const [loc] of adds) wv.removeBlock(loc)
      for (const loc of removes) delete worldBlocks[loc]
      for (const [loc, block] of adds) worldBlocks[loc] = block
      for (const [loc, block] of adds) wv.addBlock(loc, block)
    }

    set({ lastTransactionId: maxId })
  },

  sendCommand: (computerId, cmd) => {
    get().wsSend?.({ type: 'setCommand', id: computerId, cmd })
  },

  sendSideCommand: (computerId, cmd) => {
    get().wsSend?.({ type: 'setSideCommand', id: computerId, cmd })
  },

  sendChatMessage: (computerId, message) => {
    const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    get().wsSend?.({ type: 'setCommand', id: computerId, cmd: `sapi.say("${escaped}")` })
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
    worldBlocks = {}
  },
}))
