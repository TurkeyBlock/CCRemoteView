import type { Block } from '../types/types'

const DB_NAME = 'turtleHost'
const STORE_NAME = 'worldCache'
const CACHE_KEY = 'state'

interface CachedWorld {
  lastTransactionId: number
  computers: Record<string, unknown>
  palette: string[]
  blockData: number[]
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveWorldToCache(
  lastTransactionId: number,
  computers: Record<string, unknown>,
  blocks: Record<string, Block>
): Promise<void> {
  const palette: string[] = []
  const nameToIdx: Record<string, number> = {}
  const blockData: number[] = []

  for (const [locString, block] of Object.entries(blocks)) {
    if (nameToIdx[block.name] === undefined) {
      nameToIdx[block.name] = palette.length
      palette.push(block.name)
    }
    const [x, y, z] = locString.split(',').map(Number)
    blockData.push(x, y, z, nameToIdx[block.name], block.metadata ?? 0)
  }

  // Strip entities — ephemeral and potentially large
  const computersForCache: Record<string, unknown> = {}
  for (const [id, c] of Object.entries(computers)) {
    const { entities: _e, ...rest } = c as Record<string, unknown>
    computersForCache[id] = rest
  }

  const entry: CachedWorld = { lastTransactionId, computers: computersForCache, palette, blockData }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(entry, CACHE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadWorldFromCache(): Promise<{
  lastTransactionId: number
  computers: Record<string, unknown>
  blocks: Record<string, Block>
} | null> {
  const db = await openDb()
  const entry: CachedWorld | undefined = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(CACHE_KEY)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  db.close()

  if (!entry) return null

  const blocks: Record<string, Block> = {}
  const { palette, blockData } = entry
  for (let i = 0; i < blockData.length; i += 5) {
    const locString = `${blockData[i]},${blockData[i + 1]},${blockData[i + 2]}`
    const block = { name: palette[blockData[i + 3]], metadata: blockData[i + 4] ?? 0 }
    blocks[locString] = block
  }

  return { lastTransactionId: entry.lastTransactionId, computers: entry.computers, blocks }
}
