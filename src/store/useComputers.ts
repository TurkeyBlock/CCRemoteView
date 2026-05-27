import { create } from 'zustand'
import type { ComputerState, Block, ChatMessage } from '../types/world'
import type { ClientMessage } from '../types/wsMessages'
import { useWorldViewStore } from './useWorldView'
import { sceneBridge } from './sceneBridge'
import { _addBlockToWorldData, _removeBlockFromWorldData, useBlockWorldStore } from './useBlockWorld'
import { useChatStore } from './useChat'

// Shallow-compare two inventory-like arrays (slots). Returns true if they differ.
// Used for `inv`, `entities`, `inventory`, `equipment`, `enderChest` — avoids
// JSON.stringify garbage on every ~10 Hz status update.
function inventoryChanged(a?: any[], b?: any[]): boolean {
  if (a === b) return false
  if (!a || !b) return true
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    if (x === y) continue
    if (!x || !y) return true
    if (x.name !== y.name || x.count !== y.count || x.damage !== y.damage) return true
  }
  return false
}

// Compare adjacentInventory maps: Record<locString, { inventory, inventorySize }>.
// Shallow key compare + inventory-array compare per entry.
function adjacentInventoryChanged(a?: Record<string, any>, b?: Record<string, any>): boolean {
  if (a === b) return false
  const ao = a ?? {}, bo = b ?? {}
  const ak = Object.keys(ao), bk = Object.keys(bo)
  if (ak.length !== bk.length) return true
  for (const k of ak) {
    const av = ao[k], bv = bo[k]
    if (av === bv) continue
    if (!av || !bv) return true
    if (av.inventorySize !== bv.inventorySize) return true
    if (inventoryChanged(av.inventory, bv.inventory)) return true
  }
  return false
}

// Per-computer high-water mark for actionSeq numbers.
const maxActionSeqPerComputer: Record<string, number> = {}

// Tracks applied transaction IDs to deduplicate re-delivered transactions
// (e.g. from reconnect during flush). Server keeps ~10k; set grows unbounded
// but stays small relative to monotonically increasing IDs.
const appliedTxIds = new Set<number>()

interface ComputersStoreState {
  computers: Record<string, ComputerState>
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
  // Block-mutation passthroughs — implemented on useBlockWorldStore but
  // re-exposed here so callers using `useWorldStore(s => s.clearBlocks)` etc.
  // keep working after the store split. New code should call useBlockWorldStore directly.
  transactionAddBlock: (locString: string, block: Block) => void
  transactionRemoveBlock: (locString: string) => void
  clearBlocks: () => void
}

export const useComputersStore = create<ComputersStoreState>()((set, get) => ({
  computers: {},
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

      const wsConnected  = computerState.wsConnected  !== undefined ? computerState.wsConnected  : existing?.wsConnected
      const wsRequestAt = computerState.wsRequestAt !== undefined ? computerState.wsRequestAt : existing?.wsRequestAt

      let changed: boolean
      let nextState: Record<string, any>

      if (computerState._delta) {
        // ── Delta path: only the fields that actually changed are in computerState ──
        // Check only those fields; merge over existing for the update object.
        const { _delta: _, ...fields } = computerState as any
        const deltaInv = fields.inv ? [...fields.inv].map((v: any) => v === 0 ? undefined : v) : undefined
        const deltaEntities = fields.entities ? [...fields.entities] : undefined

        const existingAny = existing as any
        changed = !existing || Object.keys(fields).some(k => {
          if (k === 'inv')              return inventoryChanged(existingAny?.inv,       deltaInv)
          if (k === 'entities')         return inventoryChanged(existingAny?.entities,  deltaEntities)
          if (k === 'inventory')        return inventoryChanged((existing as any)?.inventory,  (fields as any).inventory)
          if (k === 'equipment')        return inventoryChanged((existing as any)?.equipment,  (fields as any).equipment)
          if (k === 'enderChest')       return inventoryChanged((existing as any)?.enderChest, (fields as any).enderChest)
          if (k === 'adjacentInventory') return adjacentInventoryChanged((existing as any)?.adjacentInventory, (fields as any).adjacentInventory)
          if (k === 'glassesScene')     return false  // canvas state flows via canvas-subscription channel, not status updates
          if (k === 'loc') {
            const l = fields.loc
            return !existing?.loc !== !l || (l && (existing.loc?.x !== l.x || existing.loc?.y !== l.y || existing.loc?.z !== l.z))
          }
          const a = existingAny[k], b = (fields as any)[k]
          return typeof b === 'object' && b !== null ? JSON.stringify(a) !== JSON.stringify(b) : a !== b
        })

        if (changed) {
          nextState = { ...existing, ...fields, wsConnected, wsRequestAt, modified: Date.now() }
          if (deltaInv      !== undefined) nextState.inv      = deltaInv
          if (deltaEntities !== undefined) nextState.entities = deltaEntities
        }
      } else {
        // ── Full-state path: existing behavior ────────────────────────────────────
        const csAny = computerState as any
        const exAny = existing as any
        const inv = csAny.inv ? [...csAny.inv] : undefined
        if (inv) for (let i = 0; i < inv.length; i++) if (inv[i] === 0) inv[i] = undefined
        const entities = computerState.entities ? [...computerState.entities] : undefined

        const loc = computerState.loc
        const locChanged = !existing?.loc !== !loc
          || (loc && (existing.loc?.x !== loc.x || existing.loc?.y !== loc.y || existing.loc?.z !== loc.z))
        changed = !existing
          || exAny.fuelLevel !== csAny.fuelLevel
          || existing.label !== computerState.label
          || existing.type !== computerState.type
          || existing.wsConnected !== wsConnected
          || existing.wsRequestAt !== wsRequestAt
          || existing.rot !== computerState.rot
          || exAny.selectedSlot !== csAny.selectedSlot
          || exAny.yaw !== csAny.yaw
          || exAny.pitch !== csAny.pitch
          || locChanged
          || inventoryChanged(exAny?.inv, inv)
          || inventoryChanged(existing?.entities, entities)
          || adjacentInventoryChanged(exAny?.adjacentInventory, csAny.adjacentInventory)
          || inventoryChanged(exAny?.inventory, csAny.inventory)
          || inventoryChanged(exAny?.equipment, csAny.equipment)
          || inventoryChanged(exAny?.enderChest, csAny.enderChest)
          || exAny?.playerName !== csAny.playerName

        nextState = { ...computerState, wsConnected, wsRequestAt, entities, inv, modified: Date.now() }
      }

      if (changed) {
        if (existing?.wsConnected && !wsConnected) {
          console.warn(
            `[useWorld] wsConnected dropped for computer ${id}`,
            {
              prev_wsConnected: existing.wsConnected,
              next_wsConnected: wsConnected,
              raw_wsConnected: computerState.wsConnected,
              prev_wsRequestAt: existing.wsRequestAt,
              next_wsRequestAt: wsRequestAt,
              prev_actionSeq: existing.actionSeq,
              next_actionSeq: computerState.actionSeq,
              stack: new Error().stack,
            }
          )
        }
        updates[id] = nextState!
      }
    }

    if (Object.keys(updates).length === 0 && firstNewId === null) return
    if (firstNewId !== null) useWorldViewStore.getState().setSelectedComputerId(firstNewId)
    set(s => ({ computers: { ...s.computers, ...updates } }))
  },

  transactionSetComputerState: (computerState) => {
    get().setComputerStatus(computerState)
    for (const id of Object.keys(computerState)) {
      sceneBridge.updateComputer(id)
      if (computerState[id].entities !== undefined) sceneBridge.updateEntities(id)
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
      if (appliedTxIds.has(id)) continue
      appliedTxIds.add(id)
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
      useChatStore.setState(s => {
        const merged = [...s.chatLog, ...newChatEntries]
        return { chatLog: merged.length > 500 ? merged.slice(merged.length - 500) : merged }
      })
    }

    if (removes.length > 0 || adds.length > 0) {
      for (const loc of removes) sceneBridge.removeBlock(loc)
      for (const [loc] of adds) sceneBridge.removeBlock(loc)

      for (const loc of removes) _removeBlockFromWorldData(loc)
      for (const [loc, block] of adds) _addBlockToWorldData(loc, block)

      for (const [loc, block] of adds) sceneBridge.addBlock(loc, block)
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
    const wv = useWorldViewStore.getState()
    set((state) => {
      const computers = { ...state.computers }
      delete computers[sid]
      return { computers }
    })
    if (wv.selectedComputerId === Number(id)) wv.setSelectedComputerId(-1)
    sceneBridge.updateEntities(sid)
    sceneBridge.removeComputerModel(sid)
  },

  // Backward-compat proxies — delegate to useBlockWorldStore.
  transactionAddBlock: (locString, block) => useBlockWorldStore.getState().transactionAddBlock(locString, block),
  transactionRemoveBlock: (locString) => useBlockWorldStore.getState().transactionRemoveBlock(locString),
  clearBlocks: () => useBlockWorldStore.getState().clearBlocks(),
}))
