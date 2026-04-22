import { create } from 'zustand'
import type { ComputerState, Block } from '../types/types'

// Resolved at runtime so there is no circular-import between stores.
// worldView actions (addBlock, removeBlock, etc.) are called via this getter.
function worldView() {
  return (require('./useWorldView') as typeof import('./useWorldView')).useWorldViewStore.getState()
}

// Per-computer high-water mark for actionSeq numbers.
// Module-level (not Zustand) so updates never cause re-renders.
// Exported so CCRemoteController can advance it from commandResult broadcasts
// before the matching state transaction arrives, preventing even a brief flash
// of the stale position.
export const maxActionSeqPerComputer: Record<string, number> = {}

interface WorldState {
  computers: Record<string, ComputerState>
  blocks: Record<string, Block>
  commandResult: Record<string, string>
  URL: string
  apiURL: string
  textureURL: string
  lastTransactionId: number
  isLoading: boolean
  isUnauthorized: boolean
  modemServerId: number | null
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
  blocks: {},
  commandResult: {},
  URL: '',
  apiURL: 'api/',
  textureURL: 'textures/',
  lastTransactionId: -1,
  isLoading: true,
  isUnauthorized: false,
  modemServerId: null,
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

      const loc = computerState.loc
      const locChanged = !existing?.loc !== !loc
        || (loc && (existing.loc?.x !== loc.x || existing.loc?.y !== loc.y || existing.loc?.z !== loc.z))
      const invChanged = JSON.stringify(existing?.inv) !== JSON.stringify(inv)
      const entitiesChanged = JSON.stringify(existing?.entities) !== JSON.stringify(entities)
      const changed = !existing
        || existing.fuelLevel !== computerState.fuelLevel
        || existing.label !== computerState.label
        || existing.type !== computerState.type
        || existing.sleep_mode !== computerState.sleep_mode
        || existing.via_modem !== computerState.via_modem
        || existing.rot !== computerState.rot
        || existing.selectedSlot !== computerState.selectedSlot
        || locChanged
        || invChanged
        || entitiesChanged

      if (changed) updates[id] = { ...computerState, entities, inv, modified: Date.now() }
    }

    if (Object.keys(updates).length === 0 && firstNewId === null) return
    if (firstNewId !== null) worldView().setSelectedComputerId(firstNewId)
    set(s => ({ computers: { ...s.computers, ...updates } }))
  },

  transactionRemoveBlock: (locString) => {
    worldView().removeBlock(locString)
    set((state) => {
      const blocks = { ...state.blocks }
      delete blocks[locString]
      return { blocks }
    })
  },

  transactionAddBlock: (locString, block) => {
    worldView().removeBlock(locString)
    set((state) => ({ blocks: { ...state.blocks, [locString]: block } }))
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

    // Single Zustand update for all block changes — avoids O(n²) object spreading
    // when many blocks change across a batch of transactions.
    if (removes.length > 0 || adds.length > 0) {
      const wv = worldView()
      for (const loc of removes) wv.removeBlock(loc)
      for (const [loc] of adds) wv.removeBlock(loc)
      set((state) => {
        const blocks = { ...state.blocks }
        for (const loc of removes) delete blocks[loc]
        for (const [loc, block] of adds) blocks[loc] = block
        return { blocks }
      })
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
    fetch(get().apiURL + 'sendChat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: computerId, message }),
    }).catch(console.error)
  },

  sendStopSignal: (computerId) => {
    get().wsSend?.({ type: 'setStopSignal', id: computerId })
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
    set({ blocks: {} })
  },
}))
