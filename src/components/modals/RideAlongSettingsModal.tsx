'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from '@/components/modals/Modal'
import { useWorldViewStore } from '@/store/useWorldView'

const ASPECT_PRESETS: { label: string; value: number | null }[] = [
  { label: 'Window', value: null },
  { label: '4:3',   value: 4 / 3 },
  { label: '16:9',  value: 16 / 9 },
  { label: '21:9',  value: 21 / 9 },
]

interface Props {
  onClose: () => void
}

export default function RideAlongSettingsModal({ onClose }: Props) {
  const fov    = useWorldViewStore(s => s.rideAlongFov)
  const aspect = useWorldViewStore(s => s.rideAlongAspect)
  const set    = useWorldViewStore(s => s.setRideAlongSettings)

  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragOrigin = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null)

  function onTitleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    dragOrigin.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      if (!dragOrigin.current) return
      setOffset({
        x: dragOrigin.current.ox + ev.clientX - dragOrigin.current.mx,
        y: dragOrigin.current.oy + ev.clientY - dragOrigin.current.my,
      })
    }
    const onUp = () => {
      dragOrigin.current = null
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const modal = (
    <Modal layer="panel" dim={0} center={false} onBackdropMouseDown={onClose}>
      <div
        className="canvas-overlay"
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
          minWidth: 240,
          padding: '10px 14px',
          userSelect: 'none',
          zIndex: 201,
        }}
      >
        <div
          onMouseDown={onTitleMouseDown}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, cursor: dragging ? 'grabbing' : 'grab' }}
        >
          <span className="overlay-title" style={{ padding: 0 }}>Ride-along Camera</span>
          <button
            className="btn btn-compact"
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{ padding: '2px 7px', minHeight: 20, cursor: 'default' }}
          >✕</button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span className="overlay-title" style={{ padding: 0 }}>FOV</span>
            <span className="overlay-value" style={{ fontSize: 12 }}>{fov}°</span>
          </div>
          <input
            type="range" min={20} max={120} step={1} value={fov}
            style={{ width: '100%' }}
            onChange={e => set(Number(e.target.value), aspect)}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="overlay-title" style={{ padding: 0 }}>20°</span>
            <span className="overlay-title" style={{ padding: 0 }}>120°</span>
          </div>
        </div>

        <div>
          <span className="overlay-title" style={{ padding: 0, display: 'block', marginBottom: 6 }}>Aspect Ratio</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ASPECT_PRESETS.map(p => (
              <button
                key={p.label}
                className={`btn btn-compact${aspect === p.value ? ' btn-toggled' : ''}`}
                onClick={() => set(fov, p.value)}
              >{p.label}</button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )

  return createPortal(modal, document.body)
}
