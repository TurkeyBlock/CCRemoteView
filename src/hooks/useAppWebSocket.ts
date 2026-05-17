'use client'

import { useEffect, useRef } from 'react'
import { useWorldStore, useChatStore, replaceWorldBlocks, worldPalette, worldData, worldDataLen } from '@/store/useWorld'
import { useUserStore } from '@/store/useUser'
import { loadWorldFromCache } from '@/store/worldCache'
import { sceneBridge } from '@/store/sceneBridge'
import { ServerMessage } from '@/types/wsMessages'
import { dispatchServerMessage, type WsRefs } from '@/hooks/wsMessageHandlers'

function recordToTypedArray(blocks: Record<string, { name: string; metadata?: number }>) {
  const entries = Object.entries(blocks)
  const data = new Int32Array(entries.length * 5)
  const pal: string[] = []
  const palMap = new Map<string, number>()
  let off = 0
  for (const [locStr, block] of entries) {
    let ni = palMap.get(block.name)
    if (ni === undefined) { ni = pal.length; pal.push(block.name); palMap.set(block.name, ni) }
    const c1 = locStr.indexOf(','), c2 = locStr.indexOf(',', c1 + 1)
    data[off]   = +locStr.slice(0, c1);     data[off+1] = +locStr.slice(c1+1, c2)
    data[off+2] = +locStr.slice(c2+1);      data[off+3] = ni; data[off+4] = block.metadata ?? 0
    off += 5
  }
  return { pal, data, len: entries.length * 5 }
}

export function useAppWebSocket(opts: {
  setCapBlocked: (v: boolean) => void
  setWsConnected: (v: boolean) => void
  setTabOrder: React.Dispatch<React.SetStateAction<number[]>>
}) {
  const { setCapBlocked, setWsConnected, setTabOrder } = opts

  const wsRef               = useRef<WebSocket | null>(null)
  const wsBackoffRef        = useRef(1000)
  const wsReconnectRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsFailureCountRef   = useRef(0)
  const wsCircuitOpenUntil  = useRef(0)
  const WS_FAILURE_THRESHOLD = 5
  const WS_CIRCUIT_OPEN_MS   = 30_000
  const wsInitialStateLoadedRef = useRef(false)
  const idbHydratedRef      = useRef(false)
  const catchupLoggedRef    = useRef(false)
  const pendingChunksRef    = useRef<{
    total: number; lastTransactionId: number; palette: string[]
    computers: Record<string, unknown>; chatLog: unknown[]
    chunks: number[][]; received: number
  } | null>(null)
  const bufferedTransactionsRef = useRef<Array<Record<string, unknown>>>([])
  const cacheWorkerRef      = useRef<Worker | null>(null)

  function persistWorldToCache() {
    const w = useWorldStore.getState()
    if (w.lastTransactionId < 0) return
    let liveCount = 0
    for (let i = 3; i < worldDataLen; i += 5) if (worldData[i] !== -1) liveCount++
    const compact = new Int32Array(liveCount * 5)
    let out = 0
    for (let i = 0; i < worldDataLen; i += 5) {
      if (worldData[i + 3] !== -1) {
        compact[out]     = worldData[i];     compact[out + 1] = worldData[i + 1]
        compact[out + 2] = worldData[i + 2]; compact[out + 3] = worldData[i + 3]
        compact[out + 4] = worldData[i + 4]; out += 5
      }
    }
    cacheWorkerRef.current?.postMessage(
      { lastTransactionId: w.lastTransactionId, computers: w.computers, chatLog: useChatStore.getState().chatLog, palette: worldPalette, dataBuffer: compact.buffer, dataLen: compact.length },
      [compact.buffer],
    )
  }

  function connectWebSocket() {
    const w = useWorldStore.getState()
    const base = w.URL
      ? w.URL.replace(/^http/, 'ws')
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
    const lastTx = w.lastTransactionId
    const wsUrl = lastTx >= 0 ? `${base}?lastTx=${lastTx}` : base
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      pendingChunksRef.current = null
      bufferedTransactionsRef.current = []
      wsBackoffRef.current = 1000
      wsFailureCountRef.current = 0
      wsCircuitOpenUntil.current = 0
      setCapBlocked(false)
      setWsConnected(true)
      useWorldStore.setState({ wsSend: (msg: object) => ws.send(JSON.stringify(msg)) })
      if (!wsInitialStateLoadedRef.current) {
        wsInitialStateLoadedRef.current = true
      }
    }

    ws.onmessage = (event) => {
      let raw: unknown
      try { raw = JSON.parse(event.data) } catch { return }
      const parsed = ServerMessage.safeParse(raw)
      if (!parsed.success) return

      const refs: WsRefs = {
        pendingChunksRef,
        bufferedTransactionsRef,
        idbHydratedRef,
        catchupLoggedRef,
        setTabOrder,
        persistWorldToCache,
        recordToTypedArray,
      }
      dispatchServerMessage(parsed.data, refs)

      sceneBridge.render()
      if (useWorldStore.getState().isLoading) useWorldStore.setState({ isLoading: false })
    }

    ws.onclose = (event) => {
      setWsConnected(false)
      useWorldStore.setState({ wsSend: null })
      if (event.code === 4429) {
        setCapBlocked(true); return
      }
      wsFailureCountRef.current++
      if (wsFailureCountRef.current >= WS_FAILURE_THRESHOLD) {
        wsCircuitOpenUntil.current = Date.now() + WS_CIRCUIT_OPEN_MS
        wsFailureCountRef.current = 0
        console.warn('[WS] Circuit open — pausing reconnects for 30s')
      }
      const backoff = wsBackoffRef.current
      wsBackoffRef.current = Math.min(wsBackoffRef.current * 2, 10000)
      const cooldown = Math.max(0, wsCircuitOpenUntil.current - Date.now())
      wsReconnectRef.current = setTimeout(connectWebSocket, Math.max(backoff, cooldown))
    }

    ws.onerror = () => ws.close()
  }

  useEffect(() => {
    cacheWorkerRef.current = new Worker(new URL('../workers/worldCache.worker.ts', import.meta.url))
    useUserStore.getState().startPolling()

    let mounted = true
    loadWorldFromCache().then(cached => {
      if (!mounted) return
      if (cached) {
        console.log(`[cache] Loaded: ${cached.dataLen / 5} blocks, ${Object.keys(cached.computers).length} computers, txId=${cached.lastTransactionId}`)
        const w = useWorldStore.getState()
        w.setComputerStatus(cached.computers as Record<string, any>)
        replaceWorldBlocks(cached.palette, cached.data, cached.dataLen)
        if (cached.chatLog?.length) useChatStore.setState({ chatLog: cached.chatLog as any })
        useWorldStore.setState({ lastTransactionId: cached.lastTransactionId, isLoading: false })
        idbHydratedRef.current = true
        sceneBridge.regenerateSceneFromBlocks()
        sceneBridge.render()
      } else {
        console.log('[cache] No cached world found — waiting for server state')
      }
    }).catch(() => {}).finally(() => {
      if (mounted) connectWebSocket()
    })

    function onHide() { if (document.visibilityState === 'hidden') persistWorldToCache() }
    document.addEventListener('visibilitychange', onHide)

    return () => {
      mounted = false
      useUserStore.getState().stopPolling()
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close() }
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      cacheWorkerRef.current?.terminate()
      document.removeEventListener('visibilitychange', onHide)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { connectWebSocket }
}
