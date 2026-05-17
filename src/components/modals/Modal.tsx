'use client'

import React from 'react'

type Z = 'panel' | 'dialog' | 'confirm' | 'editor' | 'confirmTop'

const Z_INDEX: Record<Z, number> = {
  panel: 200,
  dialog: 999,
  confirm: 2000,
  editor: 9000,
  confirmTop: 10000,
}

interface ModalProps {
  layer?: Z
  /** Backdrop dim alpha (0 = fully transparent). Default 0.55. */
  dim?: number
  /** Called when backdrop itself is clicked (target === currentTarget). */
  onBackdropClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  /** Use pointerdown instead of click for backdrop dismissal. */
  onBackdropPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
  /** Use mousedown instead of click for backdrop dismissal. */
  onBackdropMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void
  /** When true, centers children via flex. Default true. */
  center?: boolean
  children?: React.ReactNode
  style?: React.CSSProperties
}

export function Modal({
  layer = 'dialog',
  dim = 0.55,
  onBackdropClick,
  onBackdropPointerDown,
  onBackdropMouseDown,
  center = true,
  children,
  style,
}: ModalProps) {
  const handleClick = onBackdropClick
    ? (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onBackdropClick(e)
      }
    : undefined
  const handlePointerDown = onBackdropPointerDown
    ? (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onBackdropPointerDown(e)
      }
    : undefined
  const handleMouseDown = onBackdropMouseDown
    ? (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onBackdropMouseDown(e)
      }
    : undefined

  const baseStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: Z_INDEX[layer],
    background: `rgba(0,0,0,${dim})`,
    ...(center ? { display: 'flex', alignItems: 'center', justifyContent: 'center' } : null),
    ...style,
  }

  return (
    <div
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onMouseDown={handleMouseDown}
      style={baseStyle}
    >
      {children}
    </div>
  )
}

export { Z_INDEX }
