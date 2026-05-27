'use client'

import { useEffect, useRef, useState } from 'react'

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

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

  return { contextMenu, setContextMenu, contextMenuRef }
}
