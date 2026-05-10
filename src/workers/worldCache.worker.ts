import type { Block } from '../types/world'
import { saveWorldToCache } from '../store/worldCache'

export interface CacheSaveRequest {
  lastTransactionId: number
  computers: Record<string, unknown>
  blocks: Record<string, Block>
}

self.onmessage = async (e: MessageEvent<CacheSaveRequest>) => {
  const { lastTransactionId, computers, blocks } = e.data
  try {
    await saveWorldToCache(lastTransactionId, computers, blocks)
    console.log(`[cache] Saved: ${Object.keys(blocks).length} blocks, ${Object.keys(computers).length} computers, txId=${lastTransactionId}`)
  } catch (err) {
    console.warn('[cache] Save failed:', err)
  }
}
