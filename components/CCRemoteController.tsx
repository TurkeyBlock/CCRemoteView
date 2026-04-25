'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useWorldStore, replaceWorldBlocks } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import { useUserStore } from '@/store/useUser'
import ComputerPanel from './computers/ComputerPanel'
import InventoryView from './Inventory'
import BlockNameDisplay from './staticGui/BlockNameDisplay'
import Scene from './Scene'
import KeyboardBindings from './computers/turtles/KeyboardBindings'
import AdminPanel from './staticGui/AdminPanel'
import OperatorRequest from './staticGui/OperatorRequest'
import BlockTransparency from './staticGui/BlockTransparency'
import RenderFilters from './staticGui/RenderFilters'
import { Led } from './ui'
import { connLedKind } from './computers/PollTimers'

const ComputerLed = memo(function ComputerLed({ computerId }: { computerId: number }) {
  const kind = useWorldStore(s => connLedKind(!!s.computers[computerId]?.ws_connected, s.computers[computerId]?.ws_request_at))
  return <Led kind={kind} />
})

interface FloatingPanel { id: number; x: number; y: number }

const TYPE_SHORT: Record<string, string> = {
  minecart: 'MC', turtle: 'T', player: 'Ply', stationary: 'Sta',
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
  const isOperator = useUserStore(s => s.isOperator)
  const isAdmin = useUserStore(s => s.isAdmin)

  const [isGuest, setIsGuest] = useState(false)
  const [guestRefreshDisabled, setGuestRefreshDisabled] = useState(false)
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
  const guestRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  function startGuestCooldown(seconds: number) {
    setGuestRefreshDisabled(true)
    if (guestRefreshTimerRef.current) clearTimeout(guestRefreshTimerRef.current)
    guestRefreshTimerRef.current = setTimeout(() => { setGuestRefreshDisabled(false); guestRefreshTimerRef.current = null }, seconds * 1000)
  }

  async function loadGuestState() {
    const w = useWorldStore.getState()
    const res = await fetch('/api/state').catch(() => null)
    if (!res) return
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}))
      startGuestCooldown(data.retryAfter ?? 30); return
    }
    const data = await res.json().catch(() => null)
    if (!data) return
    w.setComputerStatus(data.computers)
    replaceWorldBlocks(data.world.blocks)
    const freshComputers = useWorldStore.getState().computers
    const selId = useWorldViewStore.getState().selectedComputerId
    const hasCoords = (c: { loc?: { x?: unknown; y?: unknown; z?: unknown } | null } | undefined) =>
      c?.loc != null && c.loc.x != null && c.loc.y != null && c.loc.z != null
    if (!hasCoords(freshComputers[selId])) {
      const entry = Object.entries(freshComputers).find(([, c]) => hasCoords(c))
      if (entry) {
        const autoId = Number(entry[0])
        useWorldViewStore.setState({ selectedComputerId: autoId })
        setTabOrder(prev => prev.includes(autoId) ? prev : [...prev, autoId])
      }
    }
    const view = useWorldViewStore.getState()
    view.regenerateSceneFromBlocks(); view.render()
    useWorldStore.setState({ isLoading: false })
    startGuestCooldown(30)
  }

  function connectWebSocket() {
    const w = useWorldStore.getState()
    const wsUrl = w.URL
      ? w.URL.replace(/^http/, 'ws')
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      wsBackoffRef.current = 1000
      setWsConnected(true)
      useWorldStore.setState({ wsSend: (msg: object) => ws.send(JSON.stringify(msg)) })
      if (!wsInitialStateLoadedRef.current) { wsInitialStateLoadedRef.current = true; loadGuestState() }
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const w = useWorldStore.getState(); const view = useWorldViewStore.getState()
      if (data.commandResult) {
        const { computerId, result } = data.commandResult
        if (result != null) useWorldStore.setState(s => ({ commandResult: { ...s.commandResult, [computerId]: result.ret } }))
      }
      if (data.state) {
        const alreadyCurrent = data.state.lastTransactionId === w.lastTransactionId
        if (!alreadyCurrent) {
          w.setComputerStatus(data.state.computers)
          replaceWorldBlocks(data.state.world.blocks)
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
      } else if (data.transactions) { w.applyTransactions(data.transactions) }
      view.render()
      if (w.isLoading) useWorldStore.setState({ isLoading: false })
    }

    ws.onclose = (event) => {
      setWsConnected(false)
      useWorldStore.setState({ wsSend: null })
      if (event.code === 4401) {
        setIsGuest(true); useUserStore.getState().stopPolling(); loadGuestState(); return
      }
      const delay = wsBackoffRef.current
      wsBackoffRef.current = Math.min(wsBackoffRef.current * 2, 10000)
      wsReconnectRef.current = setTimeout(connectWebSocket, delay)
    }

    ws.onerror = () => ws.close()
  }

  useEffect(() => {
    useUserStore.getState().startPolling()
    connectWebSocket()
    return () => {
      useUserStore.getState().stopPolling()
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close() }
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      if (guestRefreshTimerRef.current) clearTimeout(guestRefreshTimerRef.current)
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
          {isGuest && (
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
          {isGuest && (
            <button
              className={`btn btn-compact${guestRefreshDisabled ? ' btn-toggled' : ''}`}
              disabled={guestRefreshDisabled}
              onClick={() => !guestRefreshDisabled && loadGuestState()}
            >
              {guestRefreshDisabled ? 'Refreshed ✓' : 'Refresh'}
            </button>
          )}
          {userLoaded && !isOperator && !isGuest && <OperatorRequest />}
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

          {isLoading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 20 }}>
              <div className="canvas-overlay" style={{ minWidth: 'unset', padding: '14px 24px' }}>
                <div className="overlay-value">Loading world…</div>
              </div>
            </div>
          )}
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
