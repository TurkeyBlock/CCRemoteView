const DB_NAME    = 'turtleHost'
const STORE_NAME = 'worldCache'
const CACHE_KEY  = 'state'
const DB_VERSION = 2  // v2: blockData is Int32Array, not number[]

interface CachedWorld {
  lastTransactionId: number
  computers: Record<string, unknown>
  palette: string[]
  blockData: Int32Array
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME)
      db.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveWorldToCache(
  lastTransactionId: number,
  computers: Record<string, unknown>,
  palette: string[],
  blockData: Int32Array,
): Promise<void> {
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
  palette: string[]
  data: Int32Array
  dataLen: number
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

  const raw = entry.blockData as Int32Array | ArrayBuffer
  const data = raw instanceof Int32Array ? raw : new Int32Array(raw)

  return {
    lastTransactionId: entry.lastTransactionId,
    computers: entry.computers,
    palette: entry.palette,
    data,
    dataLen: data.length,
  }
}
