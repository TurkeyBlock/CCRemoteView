import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useWorldStore, useChatStore, replaceWorldBlocks } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import { sceneBridge } from '@/store/sceneBridge'
import type { ServerMessage } from '@/types/wsMessages'

type PendingChunks = {
  total: number
  lastTransactionId: number
  palette: string[]
  computers: Record<string, unknown>
  chatLog: unknown[]
  chunks: number[][]
  received: number
}

export interface WsRefs {
  pendingChunksRef: MutableRefObject<PendingChunks | null>
  bufferedTransactionsRef: MutableRefObject<Array<Record<string, unknown>>>
  idbHydratedRef: MutableRefObject<boolean>
  catchupLoggedRef: MutableRefObject<boolean>
  setTabOrder: Dispatch<SetStateAction<number[]>>
  persistWorldToCache: () => void
  recordToTypedArray: (blocks: Record<string, { name: string; metadata?: number }>) => {
    pal: string[]
    data: Int32Array
    len: number
  }
}

function hasCoords(c: { loc?: { x?: unknown; y?: unknown; z?: unknown } | null } | undefined): boolean {
  return c?.loc != null && c.loc.x != null && c.loc.y != null && c.loc.z != null
}

export function selectFirstComputerWithCoords(
  setTabOrder: Dispatch<SetStateAction<number[]>>,
): void {
  const view = useWorldViewStore.getState()
  const freshComputers = useWorldStore.getState().computers
  if (hasCoords(freshComputers[view.selectedComputerId])) return
  const entry = Object.entries(freshComputers).find(([, c]) => hasCoords(c as any))
  if (entry) {
    const autoId = Number(entry[0])
    useWorldViewStore.setState({ selectedComputerId: autoId })
    setTabOrder(prev => prev.includes(autoId) ? prev : [...prev, autoId])
  }
}

type ServerErrorMessage = Extract<ServerMessage, { type: 'error' }>
type ServerCommandResultMessage = Extract<ServerMessage, { commandResult: any }>
type ServerStateMessage = Extract<ServerMessage, { state: any }>
type ServerStateChunkMessage = Extract<ServerMessage, { stateChunk: any }>
type ServerCanvasUpdateMessage = Extract<ServerMessage, { canvasUpdate: any }>
type ServerTransactionsMessage = Extract<ServerMessage, { transactions: any }>

export function handleErrorMessage(data: ServerErrorMessage): void {
  useWorldStore.setState(s => ({ commandResult: { ...s.commandResult, [data.computerId]: data.message } }))
}

export function handleCommandResultMessage(data: ServerCommandResultMessage): void {
  const { computerId, result } = data.commandResult
  useWorldStore.setState(s => ({ commandResult: { ...s.commandResult, [computerId]: result.ret } }))
}

export function handleStateMessage(data: ServerStateMessage, refs: WsRefs): void {
  const world = useWorldStore.getState()
  if (refs.idbHydratedRef.current && !refs.catchupLoggedRef.current) {
    refs.catchupLoggedRef.current = true
    console.log(`[cache] Server sent full state (cache txId=${world.lastTransactionId} too stale or unrecognised) — ${Object.keys(data.state.world.blocks ?? {}).length} blocks, txId=${data.state.lastTransactionId}`)
  }
  if (data.state.lastTransactionId === world.lastTransactionId) return

  world.setComputerStatus(data.state.computers as Record<string, any>)
  const { pal: palette, data: blockData, len: blockCount } = refs.recordToTypedArray(data.state.world.blocks as Record<string, { name: string; metadata?: number }>)
  replaceWorldBlocks(palette, blockData, blockCount)
  if (data.state.chatLog?.length) useChatStore.setState({ chatLog: data.state.chatLog as any })
  useWorldStore.setState({ lastTransactionId: data.state.lastTransactionId })
  selectFirstComputerWithCoords(refs.setTabOrder)
  sceneBridge.regenerateSceneFromBlocks()
}

export function handleStateChunkMessage(data: ServerStateChunkMessage, refs: WsRefs): void {
  const { index, total, lastTransactionId, blockData: rawChunk, palette: chunkPalette, computers } = data.stateChunk
  const blockDataArr = rawChunk as number[]

  if (index === 0) {
    refs.pendingChunksRef.current = {
      total,
      lastTransactionId,
      palette: chunkPalette!,
      computers: computers!,
      chatLog: (data.stateChunk.chatLog as unknown[] | undefined) ?? [],
      chunks: [blockDataArr],
      received: 1,
    }
    refs.bufferedTransactionsRef.current = []
  } else if (refs.pendingChunksRef.current) {
    refs.pendingChunksRef.current.chunks.push(blockDataArr)
    refs.pendingChunksRef.current.received++
  }

  const pending = refs.pendingChunksRef.current
  if (!pending || pending.received < pending.total) return

  refs.pendingChunksRef.current = null
  const { palette, computers: comps, chatLog: cl, chunks, lastTransactionId: txId } = pending

  let totalLen = 0
  for (const chunk of chunks) totalLen += chunk.length
  const blockData = new Int32Array(totalLen)
  let off = 0
  for (const chunk of chunks) { for (let i = 0; i < chunk.length; i++) blockData[off++] = chunk[i] }

  if (refs.idbHydratedRef.current && !refs.catchupLoggedRef.current) {
    refs.catchupLoggedRef.current = true
    console.log(`[cache] Server sent full state in ${chunks.length} chunk(s) — ${totalLen / 5} blocks, txId=${txId}`)
  }

  const world = useWorldStore.getState()
  world.setComputerStatus(comps as Record<string, any>)
  replaceWorldBlocks(palette, blockData, totalLen)
  if (cl?.length) useChatStore.setState({ chatLog: cl as any })
  useWorldStore.setState({ lastTransactionId: txId })
  selectFirstComputerWithCoords(refs.setTabOrder)
  sceneBridge.regenerateSceneFromBlocks()

  const buffered = refs.bufferedTransactionsRef.current
  refs.bufferedTransactionsRef.current = []
  for (const txns of buffered) useWorldStore.getState().applyTransactions(txns as Record<string, any>)

  refs.persistWorldToCache()
}

export function handleCanvasUpdateMessage(data: ServerCanvasUpdateMessage): void {
  const { computerId, scene } = data.canvasUpdate
  useWorldStore.getState().setCanvasScene(computerId, scene as unknown[])
}

export function handleTransactionsMessage(data: ServerTransactionsMessage, refs: WsRefs): void {
  if (refs.pendingChunksRef.current) {
    refs.bufferedTransactionsRef.current.push(data.transactions as Record<string, unknown>)
    return
  }
  const world = useWorldStore.getState()
  if (refs.idbHydratedRef.current && !refs.catchupLoggedRef.current) {
    refs.catchupLoggedRef.current = true
    const txKeys = Object.keys(data.transactions)
    if (txKeys.length === 0) {
      console.log(`[cache] Cache hit — already current at txId=${world.lastTransactionId}`)
    } else {
      const txList = Object.values(data.transactions) as Array<{ blocks?: Record<string, unknown>; computers?: Record<string, unknown> }>
      let blockAdds = 0, blockRemoves = 0, computerUpdates = 0
      for (const t of txList) {
        for (const v of Object.values(t.blocks ?? {})) { if (v) blockAdds++; else blockRemoves++ }
        computerUpdates += Object.keys(t.computers ?? {}).length
      }
      const maxTx = Math.max(...txKeys.map(Number))
      console.log(`[cache] Catchup: ${txList.length} transaction(s), +${blockAdds}/-${blockRemoves} blocks, ${computerUpdates} computer update(s), txId=${world.lastTransactionId} → ${maxTx}`)
    }
  }
  world.applyTransactions(data.transactions as Record<string, any>)
}

export function dispatchServerMessage(data: ServerMessage, refs: WsRefs): void {
  if ('type' in data) {
    handleErrorMessage(data)
  } else if ('commandResult' in data) {
    handleCommandResultMessage(data)
  } else if ('state' in data) {
    handleStateMessage(data, refs)
  } else if ('stateChunk' in data) {
    handleStateChunkMessage(data, refs)
  } else if ('canvasUpdate' in data) {
    handleCanvasUpdateMessage(data)
  } else {
    handleTransactionsMessage(data, refs)
  }
}
