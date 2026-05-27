'use client'

import { useRef, useState } from 'react'
import { useWorldViewStore } from '@/store/useWorldView'
import { useDragGesture } from '@/hooks/useDragGesture'

export interface FloatingPanel { id: number; x: number; y: number; height?: number }

export function useFloatingPanels(opts: {
  selectedComputerId: number
  CHAT_TAB_ID: number
  setChatTabSelected: (v: boolean) => void
}) {
  const { selectedComputerId, CHAT_TAB_ID, setChatTabSelected } = opts

  const [floatingPanels, setFloatingPanels] = useState<FloatingPanel[]>([])
  const [panelZIndexes, setPanelZIndexes]   = useState<Record<number, number>>({})
  const topZRef = useRef(200)
  const startDrag = useDragGesture()

  function detachTab(id: number) {
    setFloatingPanels(prev => {
      if (prev.some(p => p.id === id)) return prev
      const offset = prev.length * 24
      return [...prev, { id, x: 380 + offset, y: 60 + offset }]
    })
    topZRef.current += 1
    setPanelZIndexes(prev => ({ ...prev, [id]: topZRef.current }))
    if (id === CHAT_TAB_ID) { setChatTabSelected(false) }
    else if (selectedComputerId === id) { useWorldViewStore.setState({ selectedComputerId: -1 }) }
  }

  function dockPanel(id: number) { setFloatingPanels(prev => prev.filter(p => p.id !== id)) }

  function bringToFront(id: number) {
    topZRef.current += 1
    setPanelZIndexes(prev => ({ ...prev, [id]: topZRef.current }))
    if (id !== CHAT_TAB_ID) useWorldViewStore.setState({ selectedComputerId: id })
  }

  function startPanelDrag(e: React.MouseEvent, panelId: number) {
    e.preventDefault()
    const panel = floatingPanels.find(p => p.id === panelId)
    if (!panel) return
    const initX = panel.x; const initY = panel.y
    startDrag(e, {
      onMove: (dx, dy) => setFloatingPanels(prev => prev.map(p =>
        p.id === panelId ? { ...p, x: initX + dx, y: initY + dy } : p
      )),
    })
  }

  function startPanelResize(e: React.MouseEvent, panelId: number) {
    e.preventDefault()
    e.stopPropagation()
    const panel = floatingPanels.find(p => p.id === panelId)
    if (!panel) return
    const initH = panel.height ?? (e.currentTarget.closest('.floating-panel') as HTMLElement | null)?.offsetHeight ?? 400
    startDrag(e, {
      onMove: (_dx, dy) => {
        const newH = Math.max(150, initH + dy)
        setFloatingPanels(prev => prev.map(p => p.id === panelId ? { ...p, height: newH } : p))
      },
    })
  }

  return { floatingPanels, setFloatingPanels, panelZIndexes, detachTab, dockPanel, bringToFront, startPanelDrag, startPanelResize }
}
