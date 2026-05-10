'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useWorldStore, replaceWorldBlocks, worldPalette, worldData, worldDataLen } from '@/store/useWorld'
import { loadWorldFromCache } from '@/store/worldCache'
import { useWorldViewStore } from '@/store/useWorldView'
import { useUserStore } from '@/store/useUser'
import ComputerPanel from './computers/ComputerPanel'
import InventoryView from './inventory/Inventory'
import BlockNameDisplay from './overlay/BlockNameDisplay'
import Scene from './Scene'
import KeyboardBindings from './computers/turtles/KeyboardBindings'
import AdminPanel from './overlay/AdminPanel'
import OperatorRequest from './overlay/OperatorRequest'
import BlockTransparency from './overlay/BlockTransparency'
import RenderFilters from './overlay/RenderFilters'
import { Led } from './ui'
import ModalOverlay from './ModalOverlay'
import { connLedKind } from './computers/PollTimers'
import { ServerMessage } from '@/types/wsMessages'

const ComputerLed = memo(function ComputerLed({ computerId }: { computerId: number }) {
  const kind = useWorldStore(s => connLedKind(!!s.computers[computerId]?.ws_connected, s.computers[computerId]?.ws_request_at))
  return <Led kind={kind} />
})

interface FloatingPanel { id: number; x: number; y: number }

const TYPE_SHORT: Record<string, string> = {
  minecart: 'MC', turtle: 'T', player: 'Ply', stationary: 'Sta',
}

// Converts legacy ServerState block map (Record<string,Block>) to typed array for replaceWorldBlocks.
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

export default function CCRemoteController() {
  const isLoading = useWorldStore(s => s.isLoading)
  // Re-render only when fields the tab strip or inventory panel actually use change.
  // Volatile fields (loc, inv, rot, entities, chatLog, fuelLevel, selectedSlot)
  // are handled by child components with their own narrow subscriptions.
  const computers = useStoreWithEqualityFn(useWorldStore, s => s.computers, (prev, next) => {
    const prevIds = Object.keys(prev)
    const nextIds = Object.keys(next)
    if (prevIds.length !== nextIds.length) return false
    for (const id of nextIds) {
      if (!prev[id]) return false
      const p = prev[id], n = next[id]
      if (p.ws_connected !== n.ws_connected ||
          p.ws_request_at !== n.ws_request_at ||
          p.type !== n.type ||
          p.label !== n.label ||
          (p as any).adjacentInventory !== (n as any).adjacentInventory) return false
    }
    return true
  })
  const selectedInventoryPos = useWorldViewStore(s => s.selectedInventoryPos)
  // Derive inventory live from world state so it updates after suck/drop and auto-closes when removed
  const derivedInventory = useMemo(() => {
    if (!selectedInventoryPos) return null
    const locStr = `${selectedInventoryPos.x},${selectedInventoryPos.y},${selectedInventoryPos.z}`
    for (const [id, c] of Object.entries(computers)) {
      const entry = (c as any).adjacentInventory?.[locStr]
      if (entry) return { inventory: entry.inventory, inventorySize: entry.inventorySize, computerId: Number(id) }
    }
    return null
  }, [selectedInventoryPos, computers])
  const userLoaded = useUserStore(s => s.loaded)
  const isLoggedIn = useUserStore(s => s.isLoggedIn)
  const isOperator = useUserStore(s => s.isOperator)
  const isAdmin = useUserStore(s => s.isAdmin)

  const [capBlocked, setCapBlocked] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [dockCollapsed, setDockCollapsed] = useState(false)
  const [tabOrder, setTabOrder] = useState<number[]>([])
  const [floatingPanels, setFloatingPanels] = useState<FloatingPanel[]>([])
  const [panelZIndexes, setPanelZIndexes] = useState<Record<number, number>>({})
  const topZRef = useRef(200)
  const draggedIdxRef = useRef<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const addRef = useRef<HTMLDivElement>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const [addPos, setAddPos] = useState({ top: 0, left: 0 })
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const wsBackoffRef = useRef(1000)
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsInitialStateLoadedRef = useRef(false)
  const idbHydratedRef = useRef(false)
  const catchupLoggedRef = useRef(false)
  const pendingChunksRef = useRef<{
    total: number;
    lastTransactionId: number;
    palette: string[];
    computers: Record<string, unknown>;
    chunks: number[][];
    received: number;
  } | null>(null)
  const bufferedTransactionsRef = useRef<Array<Record<string, unknown>>>([]);
  const cacheWorkerRef = useRef<Worker | null>(null)
  const renderFiltersRef = useRef<{ setOpen: (v: boolean) => void } | null>(null)
  const blockTransparencyRef = useRef<{ setOpen: (v: boolean) => void } | null>(null)
  const adminPanelRef = useRef<{ setOpen: (v: boolean) => void } | null>(null)

  const selectedComputerId = useWorldViewStore(s => s.selectedComputerId)
  const prevSelectedIdRef = useRef(selectedComputerId)
  useEffect(() => {
    if (selectedComputerId === prevSelectedIdRef.current) return
    prevSelectedIdRef.current = selectedComputerId
    if (selectedComputerId === -1) return
    useWorldViewStore.getState().focusOnComputer(selectedComputerId)
  }, [selectedComputerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close chest inventory panel when the turtle moves away and data is gone
  useEffect(() => {
    if (selectedInventoryPos && !derivedInventory) {
      useWorldViewStore.setState({ selectedInventoryPos: null })
    }
  }, [derivedInventory, selectedInventoryPos])

  const computerIds = Object.keys(computers).map(Number).sort((a, b) => a - b)

  useEffect(() => {
    const currSet = new Set(computerIds)
    setTabOrder(prev => prev.filter(id => currSet.has(id)))
    setFloatingPanels(prev => prev.filter(p => computerIds.includes(p.id)))
  }, [JSON.stringify(computerIds)]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!addOpen) return
    function handleClick(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false); setAddSearch('')
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [addOpen])

  useEffect(() => {
    if (!contextMenu) return
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => { window.removeEventListener('mousedown', handleClick); window.removeEventListener('keydown', handleKey) }
  }, [contextMenu])

  function onTabDragStart(idx: number) { draggedIdxRef.current = idx }
  function onTabDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    if (draggedIdxRef.current === null || draggedIdxRef.current === idx) return
    setTabOrder(prev => {
      const next = [...prev]
      const [removed] = next.splice(draggedIdxRef.current!, 1)
      next.splice(idx, 0, removed)
      draggedIdxRef.current = idx
      return next
    })
  }
  function onTabDragEnd() { draggedIdxRef.current = null }

  function detachTab(id: number) {
    setFloatingPanels(prev => {
      if (prev.some(p => p.id === id)) return prev
      const offset = prev.length * 24
      return [...prev, { id, x: 380 + offset, y: 60 + offset }]
    })
    topZRef.current += 1
    setPanelZIndexes(prev => ({ ...prev, [id]: topZRef.current }))
    if (selectedComputerId === id) useWorldViewStore.setState({ selectedComputerId: -1 })
  }

  function dockPanel(id: number) { setFloatingPanels(prev => prev.filter(p => p.id !== id)) }

  function bringToFront(id: number) {
    topZRef.current += 1
    setPanelZIndexes(prev => ({ ...prev, [id]: topZRef.current }))
    useWorldViewStore.setState({ selectedComputerId: id })
  }

  function addTab(id: number) {
    setTabOrder(prev => prev.includes(id) ? prev : [...prev, id])
    setAddOpen(false); setAddSearch('')
    useWorldViewStore.setState({ selectedComputerId: id })
  }

  function closeTab(id: number) {
    setTabOrder(prev => prev.filter(t => t !== id))
    setFloatingPanels(prev => prev.filter(p => p.id !== id))
    if (selectedComputerId === id) useWorldViewStore.setState({ selectedComputerId: -1 })
  }

  function startPanelDrag(e: React.MouseEvent, panelId: number) {
    e.preventDefault()
    const startX = e.clientX; const startY = e.clientY
    const panel = floatingPanels.find(p => p.id === panelId)
    if (!panel) return
    const initX = panel.x; const initY = panel.y
    function onMove(ev: MouseEvent) {
      setFloatingPanels(prev => prev.map(p =>
        p.id === panelId ? { ...p, x: initX + ev.clientX - startX, y: initY + ev.clientY - startY } : p
      ))
    }
    function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
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
      const data = parsed.data

      const w = useWorldStore.getState()
      const view = useWorldViewStore.getState()

      if ('type' in data) {
        // ServerError
        useWorldStore.setState(s => ({ commandResult: { ...s.commandResult, [data.computerId]: data.message } }))
      } else if ('commandResult' in data) {
        // ServerCommandResult
        const { computerId, result } = data.commandResult
        useWorldStore.setState(s => ({ commandResult: { ...s.commandResult, [computerId]: result.ret } }))
      } else if ('state' in data) {
        // ServerState — initial full load
        if (idbHydratedRef.current && !catchupLoggedRef.current) {
          catchupLoggedRef.current = true
          console.log(`[cache] Server sent full state (cache txId=${w.lastTransactionId} too stale or unrecognised) — ${Object.keys(data.state.world.blocks ?? {}).length} blocks, txId=${data.state.lastTransactionId}`)
        }
        if (data.state.lastTransactionId !== w.lastTransactionId) {
          w.setComputerStatus(data.state.computers)
          const { pal: sp, data: sd, len: sl } = recordToTypedArray(data.state.world.blocks as Record<string, { name: string; metadata?: number }>)
          replaceWorldBlocks(sp, sd, sl)
          useWorldStore.setState({ lastTransactionId: data.state.lastTransactionId })
          const freshComputers = useWorldStore.getState().computers
          const hasCoords = (c: { loc?: { x?: unknown; y?: unknown; z?: unknown } | null } | undefined) =>
            c?.loc != null && c.loc.x != null && c.loc.y != null && c.loc.z != null
          if (!hasCoords(freshComputers[view.selectedComputerId])) {
            const entry = Object.entries(freshComputers).find(([, c]) => hasCoords(c))
            if (entry) {
              const autoId = Number(entry[0])
              useWorldViewStore.setState({ selectedComputerId: autoId })
              setTabOrder(prev => prev.includes(autoId) ? prev : [...prev, autoId])
            }
          }
          view.regenerateSceneFromBlocks()
        }
      } else if ('stateChunk' in data) {
        // Chunked full-state delivery — palette + flat blockData across multiple messages.
        const { index, total, lastTransactionId, blockData: rawChunk, palette, computers } = data.stateChunk
        const blockDataArr = rawChunk as number[]

        if (index === 0) {
          pendingChunksRef.current = { total, lastTransactionId, palette: palette!, computers: computers!, chunks: [blockDataArr], received: 1 }
          bufferedTransactionsRef.current = []
        } else if (pendingChunksRef.current) {
          pendingChunksRef.current.chunks.push(blockDataArr)
          pendingChunksRef.current.received++
        }

        const pending = pendingChunksRef.current
        if (!pending || pending.received < pending.total) return // more chunks coming — skip render

        // All chunks received — reconstruct and apply.
        pendingChunksRef.current = null
        const { palette: pal, computers: comps, chunks, lastTransactionId: txId } = pending

        let totalLen = 0
        for (const chunk of chunks) totalLen += chunk.length
        const blockData = new Int32Array(totalLen)
        let off = 0
        for (const chunk of chunks) { for (let i = 0; i < chunk.length; i++) blockData[off++] = chunk[i] }

        if (idbHydratedRef.current && !catchupLoggedRef.current) {
          catchupLoggedRef.current = true
          console.log(`[cache] Server sent full state in ${chunks.length} chunk(s) — ${totalLen / 5} blocks, txId=${txId}`)
        }

        w.setComputerStatus(comps as Record<string, any>)
        replaceWorldBlocks(pal, blockData, totalLen)
        useWorldStore.setState({ lastTransactionId: txId })
        const freshComputers = useWorldStore.getState().computers
        const hasCoords = (c: { loc?: { x?: unknown; y?: unknown; z?: unknown } | null } | undefined) =>
          c?.loc != null && c.loc.x != null && c.loc.y != null && c.loc.z != null
        if (!hasCoords(freshComputers[view.selectedComputerId])) {
          const entry = Object.entries(freshComputers).find(([, c]) => hasCoords(c))
          if (entry) {
            const autoId = Number(entry[0])
            useWorldViewStore.setState({ selectedComputerId: autoId })
            setTabOrder(prev => prev.includes(autoId) ? prev : [...prev, autoId])
          }
        }
        view.regenerateSceneFromBlocks()

        // Replay any transactions that arrived during chunk delivery.
        const buffered = bufferedTransactionsRef.current
        bufferedTransactionsRef.current = []
        for (const txns of buffered) w.applyTransactions(txns as Record<string, any>)

        persistWorldToCache()

      } else {
        // ServerTransactions — buffer while chunk assembly is in progress.
        if (pendingChunksRef.current) {
          bufferedTransactionsRef.current.push(data.transactions as Record<string, unknown>)
          return
        }
        if (idbHydratedRef.current && !catchupLoggedRef.current) {
          catchupLoggedRef.current = true
          const txKeys = Object.keys(data.transactions)
          if (txKeys.length === 0) {
            console.log(`[cache] Cache hit — already current at txId=${w.lastTransactionId}`)
          } else {
            const txList = Object.values(data.transactions) as Array<{ blocks?: Record<string, unknown>; computers?: Record<string, unknown> }>
            let blockAdds = 0, blockRemoves = 0, computerUpdates = 0
            for (const t of txList) {
              for (const v of Object.values(t.blocks ?? {})) { if (v) blockAdds++; else blockRemoves++ }
              computerUpdates += Object.keys(t.computers ?? {}).length
            }
            const maxTx = Math.max(...txKeys.map(Number))
            console.log(`[cache] Catchup: ${txList.length} transaction(s), +${blockAdds}/-${blockRemoves} blocks, ${computerUpdates} computer update(s), txId=${w.lastTransactionId} → ${maxTx}`)
          }
        }
        w.applyTransactions(data.transactions)
      }

      view.render()
      if (w.isLoading) useWorldStore.setState({ isLoading: false })
    }

    ws.onclose = (event) => {
      setWsConnected(false)
      useWorldStore.setState({ wsSend: null })
      if (event.code === 4429) {
        setCapBlocked(true); return
      }
      const delay = wsBackoffRef.current
      wsBackoffRef.current = Math.min(wsBackoffRef.current * 2, 10000)
      wsReconnectRef.current = setTimeout(connectWebSocket, delay)
    }

    ws.onerror = () => ws.close()
  }

  function persistWorldToCache() {
    const w = useWorldStore.getState()
    if (w.lastTransactionId < 0) return
    // Compact: skip tombstones (nameIdx === -1) before transferring to the worker.
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
      { lastTransactionId: w.lastTransactionId, computers: w.computers, palette: worldPalette, dataBuffer: compact.buffer, dataLen: compact.length },
      [compact.buffer],
    )
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
        useWorldStore.setState({ lastTransactionId: cached.lastTransactionId, isLoading: false })
        idbHydratedRef.current = true
        const view = useWorldViewStore.getState()
        view.regenerateSceneFromBlocks()
        view.render()
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

  const floatingIds = new Set(floatingPanels.map(p => p.id))
  const dockedSelectedId = floatingIds.has(selectedComputerId) ? -1 : selectedComputerId
  function computerName(id: number) {
    const c = computers[id]
    return c?.label ? c.label : `#${id}`
  }

  function computerTitle(id: number) {
    const c = computers[id]
    if (!c) return `#${id}`
    const type = c.type ?? 'turtle'
    return `${type.charAt(0).toUpperCase()}${type.slice(1)} #${id}${c.label ? ` · ${c.label}` : ''}`
  }

  return (
    <div className="app">
      {/* ── Top bar ───────────────────────────────────────── */}
      <div className="panel topbar">
        <a className="brand" href="/api/home" title="turkeyblock.org">
          <span className="brand-mark">T</span>
          <span className="brand-text">
            <span className="brand-text-primary">turkeyblock.org</span>
            <span className="brand-text-secondary">CC Remote</span>
          </span>
        </a>

        <button
          onClick={() => setDockCollapsed(d => !d)}
          title={dockCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          style={{
            background: 'none', border: 'none', borderRight: 'var(--border)',
            color: 'var(--fg-dim)', cursor: 'pointer', padding: '0 8px',
            fontSize: 13, lineHeight: 1, alignSelf: 'stretch',
            display: 'flex', alignItems: 'center',
          }}
        >{dockCollapsed ? '›' : '‹'}</button>

        <div className="topbar-section sys-stats">
          <div className="sys-stat">
            <Led kind={wsConnected ? 'on' : 'amber'} />
            <span className="sys-stat-k">WebSocket</span>
            <span className="sys-stat-v">{wsConnected ? 'connected' : 'reconnecting…'}</span>
          </div>
          {userLoaded && !isLoggedIn && (
            <div className="sys-stat">
              <Led kind="amber" />
              <span className="sys-stat-k">Guest</span>
              <a href="/api/signin" style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'none' }}>Sign in</a>
            </div>
          )}
          {userLoaded && isOperator && !isAdmin && (
            <div className="sys-stat">
              <Led kind="info" />
              <span className="sys-stat-v" style={{ color: 'var(--cyan)' }}>Operator</span>
            </div>
          )}
        </div>

        <div className="topbar-actions">
          {userLoaded && isLoggedIn && !isOperator && <OperatorRequest />}
          <RenderFilters ref={renderFiltersRef} onOpened={() => { blockTransparencyRef.current?.setOpen(false); adminPanelRef.current?.setOpen(false) }} />
          <BlockTransparency ref={blockTransparencyRef} onOpened={() => { renderFiltersRef.current?.setOpen(false); adminPanelRef.current?.setOpen(false) }} />
          {isAdmin && <AdminPanel ref={adminPanelRef} onOpened={() => { renderFiltersRef.current?.setOpen(false); blockTransparencyRef.current?.setOpen(false) }} />}
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────── */}
      <div className="main" style={dockCollapsed ? { gridTemplateColumns: '0 1fr', columnGap: 0 } : undefined}>

        {/* Left dock */}
        <div className="dock" style={dockCollapsed ? { overflow: 'hidden', minWidth: 0 } : undefined}>
          {/* Connected computers panel */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-header-title">
                <Led kind="on" />
                <span>Connected Computers</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>{computerIds.length} online</span>
            </div>
            <div style={{ padding: 10, position: 'relative' }}>
              {/* Tab strip */}
              <div className="tab-strip">
                {tabOrder.map((id, idx) => {
                  const c = computers[id]
                  const isFloating = floatingIds.has(id)
                  const isSelected = selectedComputerId === id && !isFloating
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => onTabDragStart(idx)}
                      onDragOver={e => onTabDragOver(e, idx)}
                      onDragEnd={onTabDragEnd}
                      className={`tab ${isSelected ? 'tab-active' : ''} ${isFloating ? 'tab-floating' : ''}`}
                      onClick={() => {
                        if (isFloating) { bringToFront(id) }
                        else { useWorldViewStore.setState({ selectedComputerId: isSelected ? -1 : id }) }
                      }}
                      onContextMenu={e => { e.preventDefault(); setContextMenu({ id, x: e.clientX, y: e.clientY }) }}
                      title={`${computerTitle(id)} · right-click for options`}
                    >
                      <ComputerLed computerId={id} />
                      <span className="tab-type">{TYPE_SHORT[c?.type ?? ''] ?? '?'}</span>
                      <span className="tab-label">{computerName(id)}</span>
                      {isFloating && <span className="tab-float-mark">↗</span>}
                    </div>
                  )
                })}

                {/* Add tab button */}
                <div ref={addRef} style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    ref={addBtnRef}
                    className="btn tab-add"
                    onClick={() => {
                      if (addBtnRef.current) {
                        const r = addBtnRef.current.getBoundingClientRect()
                        setAddPos({ top: r.bottom + 4, left: r.left })
                      }
                      setAddOpen(o => !o)
                    }}
                    title="Add computer tab"
                  >+</button>
                  {addOpen && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => { setAddOpen(false); setAddSearch('') }} />
                      <div className="dropdown" style={{ position: 'fixed', top: addPos.top, left: addPos.left, minWidth: 220, zIndex: 500 }}>
                        <input
                          autoFocus
                          className="input input-mono"
                          style={{ fontSize: 12 }}
                          value={addSearch}
                          onChange={e => setAddSearch(e.target.value)}
                          placeholder="Search computers…"
                        />
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {(() => {
                            const tabSet = new Set(tabOrder)
                            const available = computerIds.filter(id => !tabSet.has(id))
                            const filtered = available.filter(id =>
                              !addSearch || computerTitle(id).toLowerCase().includes(addSearch.toLowerCase()) || String(id).includes(addSearch)
                            )
                            if (available.length === 0) return <div className="explainer" style={{ padding: '4px 0' }}>All computers added.</div>
                            if (filtered.length === 0) return <div className="explainer" style={{ padding: '4px 0' }}>No matches.</div>
                            return filtered.map(id => (
                              <div key={id} className="ctx-item" onClick={() => addTab(id)}>
                                <ComputerLed computerId={id} />
                                <span className="mono" style={{ color: 'var(--fg-mute)', fontSize: 11 }}>#{id}</span>
                                <span>{computerName(id)}</span>
                              </div>
                            ))
                          })()}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="explainer" style={{ marginTop: 8 }}>
                Click to view · <b>right-click</b> to detach or close.
              </div>
            </div>
          </div>

          {/* Active computer panel */}
          {dockedSelectedId !== -1 ? (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-header-title">
                  <ComputerLed computerId={dockedSelectedId} />
                  <span>{computerTitle(dockedSelectedId)}</span>
                </div>
              </div>
              <div className="panel-body">
                <ComputerPanel computerId={dockedSelectedId} />
              </div>
            </div>
          ) : (
            <div className="panel" style={{ padding: 14, color: 'var(--fg-mute)', fontSize: 12 }}>
              Select a tab above to open its control panel.
            </div>
          )}
        </div>

        {/* World canvas */}
        <div className="panel canvas">
          <Scene />

          {/* Canvas overlays */}
          <div className="canvas-overlay" style={{ top: 12, left: 12 }}>
            <div className="overlay-title">Focus</div>
            <div className="overlay-body">
              <div className="overlay-value">
                {dockedSelectedId !== -1 ? computerTitle(dockedSelectedId) : '—'}
              </div>
            </div>
          </div>

          <BlockNameDisplay />

          {derivedInventory && selectedInventoryPos && (
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 5 }}>
              <InventoryView
                inventory={derivedInventory.inventory}
                inventorySize={derivedInventory.inventorySize}
                computerId={derivedInventory.computerId}
                blockPos={selectedInventoryPos}
              />
            </div>
          )}

          {capBlocked
            ? <ModalOverlay
                message="Viewer limit reached"
                subMessage="Too many concurrent viewers. Try again when a slot opens."
                action={{ label: 'Try again', onClick: () => { setCapBlocked(false); connectWebSocket() } }}
              />
            : isLoading && <ModalOverlay message="Loading world…" />
          }
        </div>
      </div>

      {/* ── Floating panels ───────────────────────────────── */}
      {floatingPanels.map(panel => {
        const c = computers[panel.id]
        if (!c) return null
        return (
          <div
            key={panel.id}
            className="floating-panel"
            style={{ left: panel.x, top: panel.y, zIndex: panelZIndexes[panel.id] ?? 200 }}
            onMouseDown={() => bringToFront(panel.id)}
          >
            <div className="floating-titlebar" onMouseDown={e => startPanelDrag(e, panel.id)}>
              <span className="floating-title">
                <ComputerLed computerId={panel.id} />
                {computerTitle(panel.id)}
              </span>
              <button className="floating-close" onMouseDown={e => e.stopPropagation()} onClick={() => dockPanel(panel.id)} title="Dock">×</button>
            </div>
            <div className="floating-body">
              <ComputerPanel computerId={panel.id} />
            </div>
          </div>
        )
      })}

      {/* ── Context menu ─────────────────────────────────── */}
      {contextMenu && (
        <div ref={contextMenuRef} className="ctx-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {floatingIds.has(contextMenu.id) ? (
            <div className="ctx-item" onClick={() => { dockPanel(contextMenu.id); setContextMenu(null) }}>
              ↙ Dock panel
            </div>
          ) : (
            <div className="ctx-item" onClick={() => { detachTab(contextMenu.id); setContextMenu(null) }}>
              ↗ Detach to float
            </div>
          )}
          <div className="ctx-item ctx-item-danger" onClick={() => { closeTab(contextMenu.id); setContextMenu(null) }}>
            × Close tab
          </div>
        </div>
      )}

      <KeyboardBindings />
    </div>
  )
}
