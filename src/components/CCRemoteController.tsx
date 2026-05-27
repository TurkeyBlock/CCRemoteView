'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { FS } from '@/utils/fontSize'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore, useEditorStateStore } from '@/store/useWorldView'
import { sceneBridge } from '@/store/sceneBridge'
import { useUserStore } from '@/store/useUser'
import ComputerPanel from './computers/ComputerPanel'
import ChatPanel from './computers/chat/ChatPanel'
import InventoryView from './inventory/Inventory'
import BlockNameDisplay from './overlay/BlockNameDisplay'
import Scene from './Scene'
import GlassesEditorLayout from './computers/player/GlassesEditorLayout'
import GlassesSvgCanvas from './computers/player/GlassesSvgCanvas'
import { liveEditorRef } from './computers/player/useGlassesEditor'
import KeyboardBindings from './computers/turtles/KeyboardBindings'
import AdminPanel from './overlay/AdminPanel'
import OperatorRequest from './overlay/OperatorRequest'
import BlockTransparency from './overlay/BlockTransparency'
import RenderFilters from './overlay/RenderFilters'
import { Led, HeaderMenu } from './ui'
import ModalOverlay from './modals/ModalOverlay'
import { connLedKind, POLL_INTERVAL_MS } from './computers/PollTimers'
import type { GlassesObject } from '@/types/glasses'
import { useAppWebSocket } from '@/hooks/useAppWebSocket'
import { useFloatingPanels } from '@/hooks/useFloatingPanels'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useTheme } from '@/hooks/useTheme'

const ComputerLed = memo(function ComputerLed({ computerId }: { computerId: number }) {
  const wsConnected  = useWorldStore(s => s.computers[computerId]?.wsConnected)
  const wsRequestAt = useWorldStore(s => s.computers[computerId]?.wsRequestAt)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!wsRequestAt) return
    const remaining = POLL_INTERVAL_MS - (Date.now() - wsRequestAt)
    if (remaining <= 0) { setNow(Date.now()); return }
    const id = setTimeout(() => setNow(Date.now()), remaining + 100)
    return () => clearTimeout(id)
  }, [wsRequestAt])

  return <Led kind={connLedKind(!!wsConnected, wsRequestAt, now)} />
})

const EMPTY_GLASSES: GlassesObject[] = []

const TYPE_SHORT: Record<string, string> = {
  minecart: 'MC', turtle: 'T', player: 'Ply', stationary: 'Sta',
}

const CHAT_TAB_ID = -2

const TEXT_SIZES = ['sm', 'md', 'lg', 'xl'] as const
type TextSize = typeof TEXT_SIZES[number]

const TEXT_SIZE_LABELS: Record<TextSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large', xl: 'Extra Large' }
const TEXT_SIZE_PX: Record<TextSize, number> = { sm: 12, md: 14, lg: 16, xl: 18 }

export default function CCRemoteController() {
  const isLoading = useWorldStore(s => s.isLoading)
  const computers = useStoreWithEqualityFn(useWorldStore, s => s.computers, (prev, next) => {
    const prevIds = Object.keys(prev)
    const nextIds = Object.keys(next)
    if (prevIds.length !== nextIds.length) return false
    for (const id of nextIds) {
      if (!prev[id]) return false
      const p = prev[id], n = next[id]
      if (p.type !== n.type ||
          p.label !== n.label ||
          (p as any).adjacentInventory !== (n as any).adjacentInventory) return false
    }
    return true
  })
  const selectedInventoryPos = useWorldViewStore(s => s.selectedInventoryPos)
  const liveViewComputerId   = useWorldViewStore(s => s.liveViewComputerId)
  const isLiveView           = liveViewComputerId !== -1
  const liveEditorMutable    = useEditorStateStore(s => liveViewComputerId !== -1 ? s.glassesEditorMutable[liveViewComputerId] : undefined)
  const liveViewLiveObjects  = useWorldStore(s => (liveViewComputerId !== -1 ? s.canvasScenes[liveViewComputerId] ?? EMPTY_GLASSES : EMPTY_GLASSES) as GlassesObject[])

  const liveEditorForLayout = useMemo(() => {
    if (!liveEditorRef.current || !liveEditorMutable) return null
    const activeScene = liveEditorMutable.editorMode === 'live'
      ? liveViewLiveObjects
      : liveEditorMutable.draftScene
    return {
      ...liveEditorRef.current,
      ...liveEditorMutable,
      liveObjects: liveViewLiveObjects,
      activeScene,
    }
  }, [liveEditorMutable, liveViewLiveObjects])

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

  const { theme, toggle: toggleTheme } = useTheme()
  const [textSize, setTextSize] = useState<TextSize>('md')

  useEffect(() => {
    const saved = localStorage.getItem('cc-text-size') as TextSize | null
    if (saved && (TEXT_SIZES as readonly string[]).includes(saved)) {
      setTextSize(saved)
      document.documentElement.setAttribute('data-text-size', saved)
    }
  }, [])

  function applyTextSize(size: TextSize) {
    setTextSize(size)
    localStorage.setItem('cc-text-size', size)
    document.documentElement.setAttribute('data-text-size', size)
  }

  const [capBlocked, setCapBlocked] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [dockCollapsed, setDockCollapsed] = useState(false)
  const [chatTabSelected, setChatTabSelected] = useState(false)
  const [tabOrder, setTabOrder] = useState<number[]>([])

  const { connectWebSocket } = useAppWebSocket({ setCapBlocked, setWsConnected, setTabOrder })

  const {
    floatingPanels, setFloatingPanels, panelZIndexes,
    detachTab, dockPanel, bringToFront, startPanelDrag, startPanelResize,
  } = useFloatingPanels({ selectedComputerId: useWorldViewStore.getState().selectedComputerId, CHAT_TAB_ID, setChatTabSelected })

  const { contextMenu, setContextMenu, contextMenuRef } = useContextMenu()

  const draggedIdxRef = useRef<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const addRef = useRef<HTMLDivElement>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const [addPos, setAddPos] = useState({ top: 0, left: 0 })
  const renderFiltersRef     = useRef<{ setOpen: (v: boolean) => void } | null>(null)
  const blockTransparencyRef = useRef<{ setOpen: (v: boolean) => void } | null>(null)
  const adminPanelRef        = useRef<{ setOpen: (v: boolean) => void } | null>(null)

  const selectedComputerId = useWorldViewStore(s => s.selectedComputerId)
  const prevSelectedIdRef = useRef(selectedComputerId)
  useEffect(() => {
    if (selectedComputerId === prevSelectedIdRef.current) return
    prevSelectedIdRef.current = selectedComputerId
    if (selectedComputerId === -1) return
    sceneBridge.focusOnComputer(selectedComputerId)
  }, [selectedComputerId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedInventoryPos && !derivedInventory) {
      useWorldViewStore.setState({ selectedInventoryPos: null })
    }
  }, [derivedInventory, selectedInventoryPos])

  const computerIds = Object.keys(computers).map(Number).sort((a, b) => a - b)

  useEffect(() => {
    const currSet = new Set(computerIds)
    setTabOrder(prev => prev.filter(id => currSet.has(id)))
    setFloatingPanels(prev => prev.filter(p => p.id === CHAT_TAB_ID || computerIds.includes(p.id)))
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

  function addTab(id: number) {
    setTabOrder(prev => prev.includes(id) ? prev : [...prev, id])
    setAddOpen(false); setAddSearch('')
    setChatTabSelected(false)
    useWorldViewStore.setState({ selectedComputerId: id })
  }

  function closeTab(id: number) {
    setTabOrder(prev => prev.filter(t => t !== id))
    setFloatingPanels(prev => prev.filter(p => p.id !== id))
    if (selectedComputerId === id) useWorldViewStore.setState({ selectedComputerId: -1 })
  }

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
            color: 'var(--fg-mute)', cursor: 'pointer', padding: '0 8px',
            fontSize: FS['13'], lineHeight: 1, alignSelf: 'stretch',
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
              <a href="/api/signin" style={{ color: 'var(--accent)', fontSize: FS['12'], textDecoration: 'none' }}>Sign in</a>
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
          <button
            className="btn btn-compact"
            onClick={toggleTheme}
            title={theme === 'organic' ? 'Switch to dark theme' : 'Switch to light theme'}
            style={{ minWidth: 32, fontSize: 15 }}
            suppressHydrationWarning
          >{theme === 'organic' ? '☾' : '☀'}</button>
          <HeaderMenu
            compact
            label={<><span style={{ fontSize: FS['12'], fontWeight: 600, fontFamily: 'var(--font-mono)' }}>T</span><span style={{ fontSize: FS['10'], color: 'var(--fg-mute)', fontFamily: 'var(--font-mono)', marginLeft: 2 }}>{textSize.toUpperCase()}</span></>}
          >
            {TEXT_SIZES.map(s => (
              <div
                key={s}
                className="ctx-item"
                onClick={() => applyTextSize(s)}
                style={{ color: s === textSize ? 'var(--accent)' : undefined, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 20 }}
              >
                <span>{TEXT_SIZE_LABELS[s]}</span>
                <span style={{ fontSize: TEXT_SIZE_PX[s], color: 'var(--fg-mute)', fontFamily: 'var(--font-mono)' }}>The quick brown fox</span>
              </div>
            ))}
          </HeaderMenu>
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
              <span style={{ fontSize: FS['11'], color: 'var(--fg-mute)' }}>{computerIds.length} online</span>
            </div>
            <div style={{ padding: 10, position: 'relative' }}>
              {/* Tab strip */}
              <div className="tab-strip">
                {/* Chat log tab — always present */}
                <div
                  className={`tab ${chatTabSelected && !floatingIds.has(CHAT_TAB_ID) ? 'tab-active' : ''} ${floatingIds.has(CHAT_TAB_ID) ? 'tab-floating' : ''}`}
                  onClick={() => {
                    if (floatingIds.has(CHAT_TAB_ID)) { bringToFront(CHAT_TAB_ID) }
                    else { setChatTabSelected(c => !c); useWorldViewStore.setState({ selectedComputerId: -1 }) }
                  }}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ id: CHAT_TAB_ID, x: e.clientX, y: e.clientY }) }}
                  title="Global chat log · right-click for options"
                >
                  <span className="tab-type">Ch</span>
                  <span className="tab-label">Chat</span>
                  {floatingIds.has(CHAT_TAB_ID) && <span className="tab-float-mark">↗</span>}
                </div>

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
                        setChatTabSelected(false)
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
                          style={{ fontSize: FS['12'] }}
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
                                <span className="mono" style={{ color: 'var(--fg-mute)', fontSize: FS['11'] }}>#{id}</span>
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
          {chatTabSelected ? (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-header-title">
                  <span>Chat Log</span>
                </div>
              </div>
              <div className="panel-body">
                <ChatPanel />
              </div>
            </div>
          ) : dockedSelectedId !== -1 ? (
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
            <div className="panel" style={{ padding: 14, color: 'var(--fg-mute)', fontSize: FS['12'] }}>
              Select a tab above to open its control panel.
            </div>
          )}
        </div>

        {/* World canvas */}
        <div className="panel canvas">
          {isLiveView && liveEditorForLayout ? (
            <GlassesEditorLayout
              editor={liveEditorForLayout}
              canvasArea={
                <div className="live-view-bars">
                  <div className="live-view-viewport">
                    <Scene />
                    <div className="live-view-overlay">
                      <GlassesSvgCanvas editor={liveEditorForLayout} bgFill="transparent" />
                      <svg className="live-view-crosshair" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                        <line x1="10" y1="3"  x2="10" y2="17" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                        <line x1="3"  y1="10" x2="17" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                      </svg>
                    </div>
                  </div>
                </div>
              }
            />
          ) : (
            <div className={isLiveView ? 'live-view-bars' : 'live-view-fill'}>
              <div className={isLiveView ? 'live-view-viewport' : 'live-view-fill'}>
                <Scene />
              </div>
            </div>
          )}

          {!isLiveView && <div className="canvas-overlay" style={{ top: 12, left: 12 }}>
            <div className="overlay-title">Focus</div>
            <div className="overlay-body">
              <div className="overlay-value">
                {dockedSelectedId !== -1 ? computerTitle(dockedSelectedId) : '—'}
              </div>
            </div>
          </div>}

          {!isLiveView && <BlockNameDisplay />}

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
        if (panel.id === CHAT_TAB_ID) {
          return (
            <div
              key="chat"
              className="floating-panel"
              style={{ left: panel.x, top: panel.y, zIndex: panelZIndexes[CHAT_TAB_ID] ?? 200, ...(panel.height ? { height: panel.height } : { maxHeight: '90vh' }) }}
              onMouseDown={() => bringToFront(CHAT_TAB_ID)}
            >
              <div className="floating-titlebar" onMouseDown={e => startPanelDrag(e, CHAT_TAB_ID)}>
                <span className="floating-title">Chat Log</span>
                <button className="floating-close" onMouseDown={e => e.stopPropagation()} onClick={() => dockPanel(CHAT_TAB_ID)} title="Dock">×</button>
              </div>
              <div className="floating-body">
                <ChatPanel />
              </div>
              <div className="floating-resize-handle" onMouseDown={e => startPanelResize(e, CHAT_TAB_ID)} />
            </div>
          )
        }
        const c = computers[panel.id]
        if (!c) return null
        return (
          <div
            key={panel.id}
            className="floating-panel"
            style={{ left: panel.x, top: panel.y, zIndex: panelZIndexes[panel.id] ?? 200, ...(panel.height ? { height: panel.height } : { maxHeight: '90vh' }) }}
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
            <div className="floating-resize-handle" onMouseDown={e => startPanelResize(e, panel.id)} />
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
          {contextMenu.id !== CHAT_TAB_ID && (
            <div className="ctx-item ctx-item-danger" onClick={() => { closeTab(contextMenu.id); setContextMenu(null) }}>
              × Close tab
            </div>
          )}
        </div>
      )}

      <KeyboardBindings />
    </div>
  )
}
