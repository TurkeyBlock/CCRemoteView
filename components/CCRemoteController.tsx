'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useWorldStore, maxActionSeqPerComputer } from '@/store/useWorld'
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

interface FloatingPanel { id: number; x: number; y: number }

export default function CCRemoteController() {
  const isLoading = useWorldStore(s => s.isLoading)
  const computers = useWorldStore(s => s.computers)
  const modemServerId = useWorldStore(s => s.modemServerId)
  const selectedInventory = useWorldViewStore(s => s.selectedInventory)
  const selectedInventorySize = useWorldViewStore(s => s.selectedInventorySize)
  const selectedInventoryPos = useWorldViewStore(s => s.selectedInventoryPos)
  const computerRangeXZ = useWorldViewStore(s => s.computerRangeXZ)
  const userLoaded = useUserStore(s => s.loaded)
  const isOperator = useUserStore(s => s.isOperator)
  const isAdmin = useUserStore(s => s.isAdmin)

  const [manualX, setManualX] = useState<number | null>(null)
  const [manualZ, setManualZ] = useState<number | null>(null)
  const [isGuest, setIsGuest] = useState(false)
  const [guestRefreshDisabled, setGuestRefreshDisabled] = useState(false)

  const [tabOrder, setTabOrder] = useState<number[]>([])
  const [floatingPanels, setFloatingPanels] = useState<FloatingPanel[]>([])
  const [panelZIndexes, setPanelZIndexes] = useState<Record<number, number>>({})
  const topZRef = useRef(200)
  const draggedIdxRef = useRef<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const addRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const wsBackoffRef = useRef(1000)
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsInitialStateLoadedRef = useRef(false)
  const modemStatusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
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
    useWorldViewStore.setState({ manualCenter: null })
    const wv = useWorldViewStore.getState()
    if (computerRangeXZ !== null) {
      wv.regenerateSceneFromBlocks()
    } else {
      wv.focusOnComputer(selectedComputerId)
    }
  }, [selectedComputerId, computerRangeXZ]) // eslint-disable-line react-hooks/exhaustive-deps

  const computerIds = Object.keys(computers).map(Number).sort((a, b) => a - b)

  // Keep tabOrder in sync with computerIds: remove stale only, never auto-add
  useEffect(() => {
    const currSet = new Set(computerIds)
    setTabOrder(prev => prev.filter(id => currSet.has(id)))
    setFloatingPanels(prev => prev.filter(p => computerIds.includes(p.id)))
  }, [JSON.stringify(computerIds)]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close add-dropdown on outside click
  useEffect(() => {
    if (!addOpen) return
    function handleClick(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false)
        setAddSearch('')
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [addOpen])

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  function onTabDragStart(idx: number) {
    draggedIdxRef.current = idx
  }

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

  function onTabDragEnd() {
    draggedIdxRef.current = null
  }

  function detachTab(id: number) {
    setFloatingPanels(prev => {
      if (prev.some(p => p.id === id)) return prev
      const offset = prev.length * 24
      return [...prev, { id, x: 320 + offset, y: 60 + offset }]
    })
    topZRef.current += 1
    setPanelZIndexes(prev => ({ ...prev, [id]: topZRef.current }))
    if (selectedComputerId === id) {
      useWorldViewStore.setState({ selectedComputerId: -1 })
    }
  }

  function dockPanel(id: number) {
    setFloatingPanels(prev => prev.filter(p => p.id !== id))
  }

  function bringToFront(id: number) {
    topZRef.current += 1
    setPanelZIndexes(prev => ({ ...prev, [id]: topZRef.current }))
    useWorldViewStore.setState({ selectedComputerId: id })
  }

  function addTab(id: number) {
    setTabOrder(prev => prev.includes(id) ? prev : [...prev, id])
    setAddOpen(false)
    setAddSearch('')
    useWorldViewStore.setState({ selectedComputerId: id })
  }

  function closeTab(id: number) {
    setTabOrder(prev => prev.filter(t => t !== id))
    setFloatingPanels(prev => prev.filter(p => p.id !== id))
    if (selectedComputerId === id) useWorldViewStore.setState({ selectedComputerId: -1 })
  }

  function startPanelDrag(e: React.MouseEvent, panelId: number) {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const panel = floatingPanels.find(p => p.id === panelId)
    if (!panel) return
    const initX = panel.x
    const initY = panel.y
    function onMove(ev: MouseEvent) {
      setFloatingPanels(prev => prev.map(p =>
        p.id === panelId ? { ...p, x: initX + ev.clientX - startX, y: initY + ev.clientY - startY } : p
      ))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function applyManualCenter() {
    const wv = useWorldViewStore.getState()
    if (manualX !== null && manualZ !== null) {
      useWorldViewStore.setState({ manualCenter: { x: manualX, z: manualZ } })
      wv.setCameraFocus(new THREE.Vector3(manualX, 64, manualZ))
    } else {
      useWorldViewStore.setState({ manualCenter: null })
    }
    wv.regenerateSceneFromBlocks()
  }

  async function pollModemStatus() {
    const w = useWorldStore.getState()
    const res = await fetch(w.apiURL + 'modem/id').catch(() => null)
    if (!res || !res.ok) return
    const data = await res.json().catch(() => null)
    if (data) {
      const newId = data.id ?? null
      if (useWorldStore.getState().modemServerId !== newId) useWorldStore.setState({ modemServerId: newId })
    }
  }

  function startGuestCooldown(seconds: number) {
    setGuestRefreshDisabled(true)
    if (guestRefreshTimerRef.current) clearTimeout(guestRefreshTimerRef.current)
    guestRefreshTimerRef.current = setTimeout(() => {
      setGuestRefreshDisabled(false)
      guestRefreshTimerRef.current = null
    }, seconds * 1000)
  }

  async function loadGuestState() {
    const w = useWorldStore.getState()
    const res = await fetch('/api/state').catch(() => null)
    if (!res) return
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}))
      startGuestCooldown(data.retryAfter ?? 30)
      return
    }
    const data = await res.json().catch(() => null)
    if (!data) return
    w.setComputerStatus(data.computers)
    useWorldStore.setState({ blocks: data.world.blocks })
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
    // Get a fresh reference so we call the real Scene callbacks, not the initial no-ops.
    const view = useWorldViewStore.getState()
    view.regenerateSceneFromBlocks()
    view.render()
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
      console.log('[ws] WebSocket connected to', wsUrl)
      useWorldStore.setState({ wsSend: (msg: object) => ws.send(JSON.stringify(msg)) })
      if (!wsInitialStateLoadedRef.current) {
        wsInitialStateLoadedRef.current = true
        loadGuestState()
      }
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const w = useWorldStore.getState()
      const view = useWorldViewStore.getState()
      if (data.commandResult) {
        const { computerId, result, actionSeq } = data.commandResult
        // Advance the high-water mark immediately so any state transaction that
        // arrives between now and the matching /api/state update is already
        // recognised as stale before setComputerStatus sees it.
        if (typeof actionSeq === 'number' && actionSeq > 0) {
          const cid = String(computerId)
          if ((maxActionSeqPerComputer[cid] ?? 0) < actionSeq) maxActionSeqPerComputer[cid] = actionSeq
        }
        if (result != null)
          useWorldStore.setState(s => ({ commandResult: { ...s.commandResult, [computerId]: result.ret } }))
      }
      if (data.state) {
        const alreadyCurrent = data.state.lastTransactionId === w.lastTransactionId
        if (!alreadyCurrent) {
          w.setComputerStatus(data.state.computers)
          useWorldStore.setState({ blocks: data.state.world.blocks, lastTransactionId: data.state.lastTransactionId })
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
      } else if (data.transactions) {
        w.applyTransactions(data.transactions)
      }
      view.render()
      if (w.isLoading) useWorldStore.setState({ isLoading: false })
    }

    ws.onclose = (event) => {
      console.log(`[ws] WebSocket closed — code: ${event.code}, reason: '${event.reason}', wasClean: ${event.wasClean}`)
      useWorldStore.setState({ wsSend: null })
      if (event.code === 4401) {
        console.log("Guest Mode");
        setIsGuest(true)
        useUserStore.getState().stopPolling()
        loadGuestState()
        return
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
    pollModemStatus()
    modemStatusIntervalRef.current = setInterval(pollModemStatus, 15000)
    return () => {
      useUserStore.getState().stopPolling()
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close() }
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current)
      if (modemStatusIntervalRef.current) clearInterval(modemStatusIntervalRef.current)
      if (guestRefreshTimerRef.current) clearTimeout(guestRefreshTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const modemOnline = modemServerId !== null

  function computerLabel(id: number) {
    const c = computers[id]
    if (!c) return String(id)
    const typeLabel = c.type === 'minecart' ? 'Minecart' : c.type === 'modem' ? 'Modem' : 'Turtle'
    const modemSuffix = c.type === 'modem' ? (modemOnline ? ' [online]' : ' [offline]') : ''
    const statusSuffix = c.type !== 'modem' ? `${c.via_modem ? ' 📡' : ''}${c.sleep_mode ? ' 💤' : ''}` : ''
    return `${typeLabel} ${id}${modemSuffix}${statusSuffix} : ${c.label ?? ''}`
  }

  function tabLabel(id: number) {
    const c = computers[id]
    if (!c) return `#${id}`
    const typeLabel = c.type === 'minecart' ? 'MC' : c.type === 'modem' ? 'Mdm' : 'T'
    const name = c.label ? ` ${c.label}` : ` #${id}`
    return `${typeLabel}${name}`
  }

  const floatingIds = new Set(floatingPanels.map(p => p.id))
  const dockedSelectedId = floatingIds.has(selectedComputerId) ? -1 : selectedComputerId

  return (
    <div style={{ position: 'absolute', display: 'grid', userSelect: 'none', pointerEvents: 'none' }}>
      {isLoading && (
        <h1 style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: 'white' }}>
          LOADING ... (depending on the number of blocks this might take some seconds)
        </h1>
      )}

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, position: 'relative', zIndex: 1 }}>
        {/* Panel Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240, background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px', pointerEvents: 'auto' }}>
          <a href="/api/home" style={{ color: 'darkgray', fontSize: '0.85em', textDecoration: 'none' }}>← turkeyblock.org</a>
          <div style={{ fontSize: '0.75em', letterSpacing: '0.03em', color: modemOnline ? 'rgb(80,200,80)' : 'rgb(120,120,120)' }}>
            📡 Modem: {modemOnline ? `online (id ${modemServerId})` : 'offline'}
          </div>

          {/* Tab strip */}
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 2, alignItems: 'flex-start' }}>
            {tabOrder.map((id, idx) => {
              const isFloating = floatingIds.has(id)
              const isSelected = selectedComputerId === id && !isFloating
              return (
                <div
                  key={id}
                  draggable
                  onDragStart={() => onTabDragStart(idx)}
                  onDragOver={e => onTabDragOver(e, idx)}
                  onDragEnd={onTabDragEnd}
                  onClick={() => {
                    if (isFloating) {
                      bringToFront(id)
                    } else {
                      useWorldViewStore.setState({ selectedComputerId: isSelected ? -1 : id })
                    }
                  }}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ id, x: e.clientX, y: e.clientY }) }}
                  title={computerLabel(id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    padding: '0 7px', borderRadius: 4, height: 22, boxSizing: 'border-box',
                    background: isSelected ? 'rgb(60,60,60)' : isFloating ? 'rgb(35,45,55)' : 'rgb(42,42,42)',
                    border: isSelected
                      ? '1px solid rgb(100,100,100)'
                      : isFloating
                        ? '1px solid rgb(60,90,120)'
                        : '1px solid rgb(58,58,58)',
                    cursor: 'pointer', fontSize: '0.72em',
                    color: isSelected ? 'rgb(220,220,220)' : isFloating ? 'rgb(100,150,200)' : 'rgb(140,140,140)',
                    whiteSpace: 'nowrap', userSelect: 'none',
                    maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{tabLabel(id)}</span>
                  {isFloating && <span style={{ flexShrink: 0, opacity: 0.7, fontSize: '0.85em' }}>↗</span>}
                </div>
              )
            })}

            {/* Add-tab button + searchable dropdown */}
            {(() => {
              const tabSet = new Set(tabOrder)
              const available = computerIds.filter(id => !tabSet.has(id))
              const filtered = available.filter(id => {
                if (!addSearch) return true
                return computerLabel(id).toLowerCase().includes(addSearch.toLowerCase()) || String(id).includes(addSearch)
              })
              return (
                <div ref={addRef} style={{ position: 'relative', flexShrink: 0 }}>
                  <div
                    onClick={() => setAddOpen(o => !o)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 22, height: 22, boxSizing: 'border-box', borderRadius: 4,
                      background: addOpen ? 'rgb(55,55,55)' : 'rgb(42,42,42)',
                      border: '1px solid rgb(58,58,58)',
                      cursor: 'pointer', fontSize: '1em', color: 'rgb(140,140,140)', userSelect: 'none',
                    }}
                    title="Add computer tab"
                  >+</div>
                  {addOpen && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, marginTop: 2,
                      background: 'rgb(35,35,35)', border: '1px solid rgb(70,70,70)',
                      borderRadius: 4, zIndex: 500, minWidth: 210,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    }}>
                      <input
                        autoFocus
                        value={addSearch}
                        onChange={e => setAddSearch(e.target.value)}
                        placeholder="Search computers..."
                        style={{
                          width: '100%', padding: '5px 8px', boxSizing: 'border-box',
                          background: 'rgb(42,42,42)', border: 'none',
                          borderBottom: '1px solid rgb(55,55,55)',
                          color: 'darkgray', fontSize: '0.78em', outline: 'none',
                          borderRadius: '4px 4px 0 0',
                        }}
                      />
                      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {filtered.length === 0 && (
                          <div style={{ padding: '6px 8px', fontSize: '0.75em', color: 'gray' }}>
                            {available.length === 0 ? 'All computers added' : 'No matches'}
                          </div>
                        )}
                        {filtered.map(id => (
                          <div
                            key={id}
                            onClick={() => addTab(id)}
                            style={{ padding: '5px 8px', fontSize: '0.78em', color: 'darkgray', cursor: 'pointer', borderBottom: '1px solid rgb(45,45,45)' }}
                            onMouseOver={e => (e.currentTarget.style.background = 'rgb(50,50,50)')}
                            onMouseOut={e => (e.currentTarget.style.background = '')}
                          >{computerLabel(id)}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          {dockedSelectedId === -1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: '0.75em', color: 'gray', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Center</span>
              <input type="number" placeholder="X" value={manualX ?? ''} onChange={e => setManualX(e.target.value ? Number(e.target.value) : null)} onBlur={applyManualCenter}
                style={{ width: 64, padding: '2px 4px', borderRadius: 4, border: '1px solid rgb(70,70,70)', background: 'rgb(40,40,40)', color: 'darkgray', fontSize: '0.85em', textAlign: 'center' }} />
              <input type="number" placeholder="Z" value={manualZ ?? ''} onChange={e => setManualZ(e.target.value ? Number(e.target.value) : null)} onBlur={applyManualCenter}
                style={{ width: 64, padding: '2px 4px', borderRadius: 4, border: '1px solid rgb(70,70,70)', background: 'rgb(40,40,40)', color: 'darkgray', fontSize: '0.85em', textAlign: 'center' }} />
            </div>
          )}

          {dockedSelectedId !== -1 && <ComputerPanel computerId={dockedSelectedId} />}
        </div>

        {/* Panel Right */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <RenderFilters ref={renderFiltersRef} onOpened={() => { blockTransparencyRef.current?.setOpen(false); adminPanelRef.current?.setOpen(false) }} />
          <BlockTransparency ref={blockTransparencyRef} onOpened={() => { renderFiltersRef.current?.setOpen(false); adminPanelRef.current?.setOpen(false) }} />
          {isGuest && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '6px 10px' }}>
              <a href="/api/signin" style={{ color: 'darkgray', fontSize: '0.85em', textDecoration: 'none' }}>Sign in</a>
              <button
                disabled={guestRefreshDisabled}
                onClick={() => !guestRefreshDisabled && loadGuestState()}
                style={{ padding: '3px 10px', borderRadius: 4, border: 'none', background: 'rgb(52,52,52)', color: 'darkgray', cursor: 'pointer', fontSize: '0.85em', opacity: guestRefreshDisabled ? 0.5 : 1 }}
              >
                {guestRefreshDisabled ? 'Refreshed ✓' : 'Refresh'}
              </button>
            </div>
          )}
          {userLoaded && isOperator && !isAdmin && (
            <span style={{ fontSize: '0.75em', color: 'rgb(80,180,80)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Operator</span>
          )}
          {userLoaded && !isOperator && !isGuest && <OperatorRequest />}
          {isAdmin && <AdminPanel ref={adminPanelRef} onOpened={() => { renderFiltersRef.current?.setOpen(false); blockTransparencyRef.current?.setOpen(false) }} />}
        </div>
      </div>

      {selectedInventory && (
        <div style={{ position: 'relative', zIndex: 1, pointerEvents: 'auto' }}>
          <InventoryView
            inventory={selectedInventory}
            inventorySize={selectedInventorySize}
            computerId={selectedComputerId}
            blockPos={selectedInventoryPos}
          />
        </div>
      )}

      <Scene />
      <KeyboardBindings />
      <BlockNameDisplay />

      {/* Tab right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: 'rgb(35,35,35)', border: '1px solid rgb(70,70,70)',
            borderRadius: 4, zIndex: 1000, minWidth: 150,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)', pointerEvents: 'auto',
          }}
        >
          {(() => {
            const isFloating = floatingIds.has(contextMenu.id)
            const menuItem = (label: string, onClick: () => void, danger = false) => (
              <div
                onClick={onClick}
                style={{ padding: '6px 10px', fontSize: '0.78em', cursor: 'pointer', color: danger ? 'rgb(200,100,100)' : 'darkgray', borderBottom: '1px solid rgb(45,45,45)' }}
                onMouseOver={e => (e.currentTarget.style.background = 'rgb(50,50,50)')}
                onMouseOut={e => (e.currentTarget.style.background = '')}
              >{label}</div>
            )
            return <>
              {!isFloating && menuItem('↗ Detach to float', () => { detachTab(contextMenu.id); setContextMenu(null) })}
              {isFloating && menuItem('↙ Dock panel', () => { dockPanel(contextMenu.id); setContextMenu(null) })}
              {menuItem('× Close tab', () => { closeTab(contextMenu.id); setContextMenu(null) }, true)}
            </>
          })()}
        </div>
      )}

      {/* Floating panels */}
      {floatingPanels.map(panel => (
        <div
          key={panel.id}
          onMouseDown={() => bringToFront(panel.id)}
          style={{
            position: 'fixed', left: panel.x, top: panel.y,
            background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)',
            borderRadius: 6, padding: '0 12px 10px',
            zIndex: panelZIndexes[panel.id] ?? 200,
            pointerEvents: 'auto', userSelect: 'none',
            minWidth: 240, maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
          }}
        >
          {/* Drag handle / title bar */}
          <div
            onMouseDown={e => startPanelDrag(e, panel.id)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0 6px', marginBottom: 6,
              borderBottom: '1px solid rgb(50,50,50)',
              cursor: 'grab',
            }}
          >
            <span style={{ fontSize: '0.75em', color: 'darkgray', fontWeight: 'bold', pointerEvents: 'none' }}>
              {computerLabel(panel.id)}
            </span>
            <span
              onMouseDown={e => e.stopPropagation()}
              onClick={() => dockPanel(panel.id)}
              title="Dock (close floating panel)"
              style={{ fontSize: '1.1em', color: 'gray', cursor: 'pointer', lineHeight: 1, paddingLeft: 10, flexShrink: 0 }}
            >×</span>
          </div>
          <ComputerPanel computerId={panel.id} />
        </div>
      ))}
    </div>
  )
}
