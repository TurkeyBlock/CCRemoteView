import { saveWorldToCache } from '../store/worldCache'

export interface CacheSaveRequest {
  lastTransactionId: number
  computers: Record<string, unknown>
  palette: string[]
  dataBuffer: ArrayBuffer  // transferred — zero-copy from main thread
  dataLen: number          // Int32 elements (blockData.length)
  chatLog?: unknown[]
}

self.onmessage = async (e: MessageEvent<CacheSaveRequest>) => {
  const { lastTransactionId, computers, palette, dataBuffer, dataLen, chatLog } = e.data
  const blockData = new Int32Array(dataBuffer, 0, dataLen)
  try {
    await saveWorldToCache(lastTransactionId, computers, palette, blockData, chatLog)
    console.log(`[cache] Saved: ${dataLen / 5} blocks, ${Object.keys(computers).length} computers, txId=${lastTransactionId}`)
  } catch (err) {
    console.warn('[cache] Save failed:', err)
  }
}
