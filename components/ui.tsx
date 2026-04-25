'use client'

import { useState, useEffect, useRef, forwardRef } from 'react'

// ── LED indicator ────────────────────────────────────────────
export type LedKind = 'on' | 'amber' | 'red' | 'info' | 'off'
export function Led({ kind = 'on', title }: { kind?: LedKind; title?: string }) {
  const cls: Record<LedKind, string> = {
    on: 'led led-on', amber: 'led led-amber', red: 'led led-red', info: 'led led-info', off: 'led',
  }
  return <span className={cls[kind]} title={title} />
}

// ── Panel header ─────────────────────────────────────────────
export function PanelHeader({
  title, right, leds,
}: { title: React.ReactNode; right?: React.ReactNode; leds?: React.ReactNode }) {
  return (
    <div className="panel-header">
      <div className="panel-header-title">
        {leds}
        <span>{title}</span>
      </div>
      {right}
    </div>
  )
}

// ── Section ──────────────────────────────────────────────────
export function Section({
  label, right, children,
}: { label: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-label">
        <span>{label}</span>
        {right && <span className="section-label-right">{right}</span>}
      </div>
      <div className="section-body">{children}</div>
    </div>
  )
}

// ── Meter row ────────────────────────────────────────────────
export function MeterRow({
  label, value, max, amber, solid, solidLabel, valueLabel, title,
}: { label: string; value: number; max: number; amber?: boolean; solid?: boolean; solidLabel?: string; valueLabel?: string; title?: string }) {
  const pct = solid ? 100 : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className="meter-row" title={title}>
      <span className="meter-row-label">{label}</span>
      <div className="meter">
        <div className={`meter-fill${amber ? ' meter-fill-amber' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="meter-row-value">
        {solid ? (solidLabel ?? 'active') : (valueLabel ?? `${value.toFixed(1)}s / ${max}s`)}
      </span>
    </div>
  )
}

// ── Flashable button ─────────────────────────────────────────
export const Btn = forwardRef<HTMLButtonElement, {
  children: React.ReactNode
  variant?: 'primary' | 'danger' | 'ghost'
  toggled?: boolean
  onClick?: (e: React.MouseEvent) => void
  disabled?: boolean
  title?: string
  style?: React.CSSProperties
  className?: string
}>(function Btn({ children, variant, toggled, onClick, disabled, title, style, className = '' }, ref) {
  const [flash, setFlash] = useState(false)
  const cls = [
    'btn',
    variant === 'primary' ? 'btn-primary' : '',
    variant === 'danger' ? 'btn-danger' : '',
    variant === 'ghost' ? 'btn-ghost' : '',
    toggled ? 'btn-toggled' : '',
    flash ? 'btn-flash' : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <button
      ref={ref}
      className={cls}
      disabled={disabled}
      title={title}
      style={style}
      onClick={e => {
        if (variant !== 'primary') {
          setFlash(false)
          requestAnimationFrame(() => setFlash(true))
          setTimeout(() => setFlash(false), 300)
        }
        onClick?.(e)
      }}
    >
      {children}
    </button>
  )
})

// ── Checkbox with description ────────────────────────────────
export function Checkbox({
  label, desc, checked, onChange,
}: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <label className="checkbox">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="checkbox-box" />
        <span className="checkbox-label">{label}</span>
      </label>
      {desc && <div className="checkbox-desc">{desc}</div>}
    </div>
  )
}

// ── Fixed-position dropdown menu (avoids overflow clipping) ──
export function HeaderMenu({
  label, children, align = 'right', compact,
}: { label: string; children: React.ReactNode; align?: 'left' | 'right'; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 })

  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({
      top: r.bottom + 4,
      left: align === 'left' ? r.left : undefined,
      right: align === 'right' ? window.innerWidth - r.right : undefined,
    })
  }, [open, align])

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className={`btn${compact ? ' btn-compact' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {label} <span style={{ marginLeft: 5, opacity: 0.55, fontSize: 9 }}>▼</span>
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setOpen(false)} />
          <div className="dropdown" style={{ top: pos.top, left: pos.left, right: pos.right }}>
            {children}
          </div>
        </>
      )}
    </div>
  )
}

// ── Live clock ───────────────────────────────────────────────
export function LiveClock() {
  const [t, setT] = useState(new Date())
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return <span className="mono">{t.toLocaleTimeString()}</span>
}
