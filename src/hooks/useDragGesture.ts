import { useCallback } from 'react'

export interface DragGestureOptions {
  onMove: (dx: number, dy: number, ev: MouseEvent) => void
  onUp?: (ev: MouseEvent) => void
}

export function useDragGesture(): (e: React.MouseEvent, opts: DragGestureOptions) => void {
  return useCallback((e: React.MouseEvent, opts: DragGestureOptions) => {
    const startX = e.clientX
    const startY = e.clientY
    function onMove(ev: MouseEvent) {
      opts.onMove(ev.clientX - startX, ev.clientY - startY, ev)
    }
    function onUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      opts.onUp?.(ev)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])
}
