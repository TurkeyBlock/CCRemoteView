'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useWorldStore } from '@/store/useWorld'
import type { GlassesObject, GlassesRect, GlassesText, GlassesLine } from '@/types/glasses'
import { loadMinecraftFont, isFontLoaded, measureMinecraftText, renderMinecraftTextToCanvas } from '@/utils/minecraftFont'

// ─── Utilities ────────────────────────────────────────────────────────────────

const intToHex = (n: number) => '#' + Math.max(0, Math.min(0xffffff, n | 0)).toString(16).padStart(6, '0')
const hexToInt = (h: string) => parseInt(h.replace('#', ''), 16) || 0
const uid = () => Math.random().toString(36).slice(2, 11)

// ─── Draw tool defaults ───────────────────────────────────────────────────────

const D_COLOR = 0xffffff
const D_ALPHA = 255

// ─── Drag state ───────────────────────────────────────────────────────────────

type DragInfo =
  | { kind: 'move';     id: string; mx0: number; my0: number; ox: number; oy: number }
  | { kind: 'resize';   id: string; corner: 'nw'|'ne'|'sw'|'se'; mx0: number; my0: number; ox: number; oy: number; ow: number; oh: number }
  | { kind: 'endpoint'; id: string; pt: 1|2; mx0: number; my0: number; ox: number; oy: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Override = { id: string; props: Record<string, any> }

// Plethora canvas dimensions confirmed via papi.getCanvasSize() — do not change.
const CANVAS_W = 512
const CANVAS_H = 288

const EMPTY_SCENE: GlassesObject[] = []
// Must match maxLength on glassesSetCanvas in command_routing.json — scenes larger than
// this cannot be sent to the glasses, so we refuse to store them in the first place.
const JSON_CAP = 16_000

// ─── Shared input styles ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: 56, background: 'var(--surface-3)', border: '1px solid var(--line)',
  borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: 11,
}
const labelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-mute)',
}

// Module-level so React never sees a new component type between renders,
// which would cause remount → lost focus → flicker.
function NumInput({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number
}) {
  return (
    <label style={labelStyle}>
      <span style={{ width: 22, textAlign: 'right' }}>{label}</span>
      <input type="number" style={inputStyle}
        value={value ?? ''} min={min} max={max} step={1}
        onChange={e => { const v = Number(e.target.value); if (!isNaN(v)) onChange(v) }} />
    </label>
  )
}

// ─── Minecraft bitmap text renderer ──────────────────────────────────────────
// Rendered as a separate component so it can hold its own canvas/dataUrl state.
// When the font isn't available yet it falls back to an SVG <text> element.

interface TextObjProps {
  t: GlassesText
  sel: boolean
  SEL: string
  fontReady: boolean
  onPointerDown: (e: React.PointerEvent) => void
}

function MinecraftTextObj({ t, sel, SEL, fontReady, onPointerDown }: TextObjProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const offscreen = useRef(typeof document !== 'undefined' ? document.createElement('canvas') : null)

  useEffect(() => {
    if (!fontReady || !offscreen.current || !t.content) { setDataUrl(null); return }
    renderMinecraftTextToCanvas(offscreen.current, t.content, t.size, t.color, t.alpha)
    setDataUrl(offscreen.current.toDataURL())
  }, [t.content, t.size, t.color, t.alpha, fontReady])

  const textW = fontReady ? measureMinecraftText(t.content, t.size) : Math.max(10, t.content.length * t.size * 6)
  const textH = t.size * 9
  const fill  = intToHex(t.color)
  const opacity = t.alpha / 255

  return (
    <g>
      {dataUrl
        ? <image href={dataUrl} x={t.x} y={t.y - textH} width={textW} height={textH}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style={{ cursor: 'move', imageRendering: 'pixelated' } as any}
            onPointerDown={onPointerDown} />
        : <text x={t.x} y={t.y - textH * 0.2} fill={fill} opacity={opacity} fontSize={textH}
            style={{ cursor: 'move', userSelect: 'none' }} onPointerDown={onPointerDown}>
            {t.content}
          </text>
      }
      {sel && <rect x={t.x - 1} y={t.y - textH - 1} width={Math.max(10, textW) + 2} height={textH + 2}
        fill="none" stroke={SEL} strokeWidth={0.8} style={{ pointerEvents: 'none' }} />}
    </g>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { computerId: number }

export default function GlassesEditor({ computerId }: Props) {
  const objects       = useWorldStore(s => (s.computers[computerId]?.glassesScene ?? EMPTY_SCENE) as GlassesObject[])
  const wsSend        = useWorldStore(s => s.wsSend)
  const invokeCommand = useWorldStore(s => s.invokeCommand)

  const [open, setOpen]           = useState(false)
  const [fontReady, setFontReady] = useState(isFontLoaded)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Local working copy for the properties panel. Intentionally not re-synced on
  // server broadcasts — last-write-wins. Only resets when selectedId changes.
  const [editObj, setEditObj]     = useState<GlassesObject | null>(null)
  const [override, setOverride]   = useState<Override | null>(null)
  const [listDragIdx, setListDragIdx] = useState<number | null>(null)
  const [listOverIdx, setListOverIdx] = useState<number | null>(null)

  const svgRef           = useRef<SVGSVGElement>(null)
  const textareaRef      = useRef<HTMLTextAreaElement>(null)
  const dragRef          = useRef<DragInfo | null>(null)
  const debounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stores pointer-down position while a draw gesture is in progress (ref so
  // handleSvgPointerUp reads the value without closure-staleness issues).
  const drawAnchorRef    = useRef<[number, number] | null>(null)
  // Pointer ID waiting to be captured on first move. Set on pointerdown, applied
  // on first pointermove, cleared on pointerup. Deferring capture means a plain
  // click on a canvas object never steals pointer focus from the sidebar textarea.
  const pendingCaptureRef = useRef<number | null>(null)

  const [drawMode, setDrawMode]       = useState<'rect' | 'text' | 'line' | null>(null)
  // Live cursor position during a draw gesture — used only for preview rendering.
  const [drawCurrent, setDrawCurrent] = useState<[number, number] | null>(null)

  const jsonLen = JSON.stringify(objects).length
  // -100 leaves headroom for the smallest possible new object so buttons grey out
  // before the cap is exactly hit. The precise check happens at finalization time.
  const atCap   = objects.length >= 512 || jsonLen > JSON_CAP - 100

  // Attempt to load the Minecraft bitmap font (no-op if already loaded or not extracted).
  useEffect(() => {
    if (fontReady) return
    loadMinecraftFont('assets/').then(ok => { if (ok) setFontReady(true) })
  }, [fontReady])

  // Sync editObj when selection changes.
  // If the object isn't in the store yet (pending server echo after draw), leave editObj
  // as-is — it was set optimistically by the draw handler and clearing it empties the panel.
  useEffect(() => {
    if (!selectedId) { setEditObj(null); return }
    const found = objects.find(o => o.id === selectedId)
    if (found) setEditObj(found)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus the textarea immediately after a text object is placed.
  // Only fires for freshly-placed objects (not yet in the server store), so re-selecting
  // an existing text object in the canvas doesn't hijack focus unexpectedly.
  useEffect(() => {
    if (!editObj || editObj.type !== 'text') return
    if (!objects.some(o => o.id === editObj.id)) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [editObj?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel any in-flight drag or draw when the modal closes
  useEffect(() => {
    if (!open) {
      dragRef.current = null; setOverride(null)
      drawAnchorRef.current = null; setDrawCurrent(null); setDrawMode(null)
    }
  }, [open])

  // Escape cancels an active draw first; a second Escape closes the modal.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (drawAnchorRef.current || drawMode) {
        drawAnchorRef.current = null
        setDrawCurrent(null)
        setDrawMode(null)
      } else {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, drawMode])

  // ─── WS helpers ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendOp = (op: string, extra: Record<string, any> = {}) =>
    wsSend?.({ type: 'glassesSceneOp', computerId, op, ...extra } as any)

  const sendUpdateDebounced = (id: string, props: Partial<GlassesObject>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => sendOp('update', { objectId: id, object: props }), 150)
  }

  // ─── Toolbar actions ───────────────────────────────────────────────────────

  const toggleDraw = (mode: 'rect' | 'text' | 'line') => {
    // Cancel any in-progress gesture when switching tools.
    drawAnchorRef.current = null
    setDrawCurrent(null)
    setDrawMode(prev => prev === mode ? null : mode)
  }

  const handleClearEditor  = () => { sendOp('clear'); setSelectedId(null) }

  const handleClearGlasses = () => {
    invokeCommand(computerId, 'glassesClear')
  }

  const handleSend = () => {
    wsSend?.({ type: 'setGlassesScene', computerId, scene: objects } as any)
    invokeCommand(computerId, 'glassesSetCanvas', [JSON.stringify(objects)])
  }

  // ─── SVG coordinate conversion ─────────────────────────────────────────────

  const toSvg = (e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return [0, 0]
    const p = pt.matrixTransform(ctm.inverse())
    return [p.x, p.y]
  }

  // ─── Drag ──────────────────────────────────────────────────────────────────

  const startDrag = (e: React.PointerEvent, info: DragInfo) => {
    e.stopPropagation()
    // Defer pointer capture to the first pointermove so a plain click never
    // grabs the pointer — without this, clicking an object blocks focus on
    // the sidebar textarea until the pointer is released.
    pendingCaptureRef.current = e.pointerId
    dragRef.current = info
    setSelectedId(info.id)
  }

  const handleSvgPointerMove = (e: React.PointerEvent) => {
    if (pendingCaptureRef.current !== null) {
      svgRef.current?.setPointerCapture(pendingCaptureRef.current)
      pendingCaptureRef.current = null
    }
    if (drawAnchorRef.current) {
      const [mx, my] = toSvg(e)
      setDrawCurrent([Math.round(mx), Math.round(my)])
      return
    }
    const d = dragRef.current
    if (!d) return
    const [mx, my] = toSvg(e)
    if (d.kind === 'move') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverride({ id: d.id, props: { x: d.ox + dx, y: d.oy + dy } as any })
    } else if (d.kind === 'resize') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      let x = d.ox, y = d.oy, w = d.ow, h = d.oh
      if (d.corner === 'se') { w = Math.max(4, d.ow + dx); h = Math.max(4, d.oh + dy) }
      if (d.corner === 'sw') { x = d.ox + dx; w = Math.max(4, d.ow - dx); h = Math.max(4, d.oh + dy) }
      if (d.corner === 'ne') { w = Math.max(4, d.ow + dx); y = d.oy + dy; h = Math.max(4, d.oh - dy) }
      if (d.corner === 'nw') { x = d.ox + dx; w = Math.max(4, d.ow - dx); y = d.oy + dy; h = Math.max(4, d.oh - dy) }
      setOverride({ id: d.id, props: { x, y, w, h } as any })
    } else if (d.kind === 'endpoint') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverride({ id: d.id, props: (d.pt === 1 ? { x1: d.ox + dx, y1: d.oy + dy } : { x2: d.ox + dx, y2: d.oy + dy }) as any })
    }
  }

  const handleSvgPointerUp = (e: React.PointerEvent) => {
    pendingCaptureRef.current = null  // cancel capture if click ended without a drag
    const anchor = drawAnchorRef.current
    if (anchor && drawMode) {
      const [x1, y1] = anchor
      const [x2, y2] = toSvg(e) // read from event directly to avoid stale state
      drawAnchorRef.current = null
      setDrawCurrent(null)

      let obj: GlassesObject
      if (drawMode === 'rect') {
        obj = { id: uid(), type: 'rect',
          x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)),
          w: Math.max(4, Math.round(Math.abs(x2 - x1))), h: Math.max(4, Math.round(Math.abs(y2 - y1))),
          color: D_COLOR, alpha: D_ALPHA }
      } else if (drawMode === 'text') {
        // Baseline sits at the bottom of the drag rect; size = round(height / 9)
        // matching the SVG renderer which uses fontSize = size * 9.
        const h = Math.max(9, Math.abs(y2 - y1))
        obj = { id: uid(), type: 'text',
          x: Math.round(Math.min(x1, x2)), y: Math.round(Math.max(y1, y2)),
          content: 'Text', color: D_COLOR, alpha: D_ALPHA,
          size: Math.max(1, Math.round(h / 9)), shadow: false }
      } else {
        obj = { id: uid(), type: 'line',
          x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2),
          color: D_COLOR, alpha: D_ALPHA, thickness: 1 }
      }

      // Exact pre-check: server drops the op silently if over-cap, giving no feedback.
      if (objects.length < 512 && JSON.stringify([...objects, obj]).length <= JSON_CAP) {
        sendOp('add', { object: obj })
        setSelectedId(obj.id)
        setEditObj(obj)
      }
      return
    }

    const d = dragRef.current
    dragRef.current = null
    if (d && override?.id === d.id) {
      sendOp('update', { objectId: d.id, object: override.props })
      setEditObj(prev => prev?.id === d.id ? { ...prev, ...override.props } as GlassesObject : prev)
      // Keep override alive — cleared below once the server broadcast confirms the value.
      // Without this, the SVG snaps back to the stale Zustand position for one frame.
    }
  }

  // Clear the post-drag override once the server's broadcast has caught up to it.
  useEffect(() => {
    if (!override) return
    const obj = objects.find(o => o.id === override.id)
    if (!obj) { setOverride(null); return }
    const confirmed = Object.entries(override.props).every(([k, v]) => (obj as any)[k] === v)
    if (confirmed) setOverride(null)
  }, [objects]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Object list ───────────────────────────────────────────────────────────

  const handleDelete = (id: string) => {
    sendOp('remove', { objectId: id })
    if (selectedId === id) setSelectedId(null)
  }

  const handleReorder = (fromIdx: number, dir: -1 | 1) => {
    const toIdx = fromIdx + dir
    if (toIdx < 0 || toIdx >= objects.length) return
    sendOp('reorder', { fromIdx, toIdx })
  }

  const handleListDragStart = (e: React.DragEvent, i: number) => {
    setListDragIdx(i); e.dataTransfer.effectAllowed = 'move'
  }
  const handleListDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setListOverIdx(i)
  }
  const handleListDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault()
    if (listDragIdx !== null && listDragIdx !== toIdx) sendOp('reorder', { fromIdx: listDragIdx, toIdx })
    setListDragIdx(null); setListOverIdx(null)
  }
  const handleListDragEnd = () => { setListDragIdx(null); setListOverIdx(null) }

  // ─── Properties ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateProp = (key: string, val: any) => {
    if (!editObj) return
    const updated = { ...editObj, [key]: val } as GlassesObject
    // Pre-check the full candidate scene so we never optimistically show an edit
    // that the server would drop. Without this, text edits near the cap appear to
    // work but silently revert when the user deselects the object.
    if (JSON.stringify(objects.map(o => o.id === editObj.id ? updated : o)).length > JSON_CAP) return
    setEditObj(updated)
    sendUpdateDebounced(editObj.id, { [key]: val } as any)
  }

  // ─── SVG rendering ─────────────────────────────────────────────────────────

  const resolved = (obj: GlassesObject): GlassesObject =>
    override?.id === obj.id ? { ...obj, ...override.props } as GlassesObject : obj

  const SEL = '#3b82f6'
  const HR = 3 // handle radius

  const renderObj = (raw: GlassesObject) => {
    const obj = resolved(raw)
    const sel = selectedId === obj.id
    const opacity = obj.alpha / 255
    const fill = intToHex(obj.color)

    if (obj.type === 'rect') {
      const r = obj as GlassesRect
      return (
        <g key={r.id}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} opacity={opacity}
            style={{ cursor: 'move' }}
            onPointerDown={e => { const [mx,my]=toSvg(e); startDrag(e,{kind:'move',id:r.id,mx0:mx,my0:my,ox:r.x,oy:r.y}) }} />
          {sel && <>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={SEL} strokeWidth={0.8} style={{pointerEvents:'none'}} />
            {(['nw','ne','sw','se'] as const).map(c => {
              const hx = c.includes('e') ? r.x + r.w : r.x
              const hy = c.includes('s') ? r.y + r.h : r.y
              return <rect key={c} x={hx-HR} y={hy-HR} width={HR*2} height={HR*2} fill={SEL}
                style={{ cursor: `${c}-resize` }}
                onPointerDown={e => { const [mx,my]=toSvg(e); startDrag(e,{kind:'resize',id:r.id,corner:c,mx0:mx,my0:my,ox:r.x,oy:r.y,ow:r.w,oh:r.h}) }} />
            })}
          </>}
        </g>
      )
    }

    if (obj.type === 'text') {
      const t = obj as GlassesText
      return (
        <MinecraftTextObj key={t.id} t={t} sel={sel} SEL={SEL} fontReady={fontReady}
          onPointerDown={e => { const [mx,my]=toSvg(e); startDrag(e,{kind:'move',id:t.id,mx0:mx,my0:my,ox:t.x,oy:t.y}) }} />
      )
    }

    if (obj.type === 'line') {
      const l = obj as GlassesLine
      return (
        <g key={l.id}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={fill} strokeWidth={l.thickness} opacity={opacity}
            vectorEffect="non-scaling-stroke" />
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="transparent" strokeWidth={8}
            style={{ cursor: 'pointer' }}
            onPointerDown={e => { e.stopPropagation(); setSelectedId(l.id) }} />
          {sel && <>
            <circle cx={l.x1} cy={l.y1} r={HR+1} fill={SEL} style={{cursor:'move'}}
              onPointerDown={e => { const [mx,my]=toSvg(e); startDrag(e,{kind:'endpoint',id:l.id,pt:1,mx0:mx,my0:my,ox:l.x1,oy:l.y1}) }} />
            <circle cx={l.x2} cy={l.y2} r={HR+1} fill={SEL} style={{cursor:'move'}}
              onPointerDown={e => { const [mx,my]=toSvg(e); startDrag(e,{kind:'endpoint',id:l.id,pt:2,mx0:mx,my0:my,ox:l.x2,oy:l.y2}) }} />
          </>}
        </g>
      )
    }

    return null
  }

  // ─── Draw preview ──────────────────────────────────────────────────────────

  const renderDrawPreview = () => {
    const anchor = drawAnchorRef.current
    if (!anchor || !drawCurrent || !drawMode) return null
    const [x1, y1] = anchor
    const [x2, y2] = drawCurrent
    const ghost: React.CSSProperties = { pointerEvents: 'none', opacity: 0.75 }
    const fill = intToHex(D_COLOR)

    if (drawMode === 'rect') {
      return <rect x={Math.min(x1,x2)} y={Math.min(y1,y2)}
        width={Math.max(4, Math.abs(x2-x1))} height={Math.max(4, Math.abs(y2-y1))}
        fill={fill} fillOpacity={0.15} stroke={SEL} strokeWidth={1} strokeDasharray="4 2" style={ghost} />
    }
    if (drawMode === 'text') {
      const fs = Math.max(9, Math.max(1, Math.round(Math.abs(y2-y1) / 9)) * 9)
      return <text x={Math.min(x1,x2)} y={Math.max(y1,y2) - fs * 0.2} fill={fill} fontSize={fs} style={ghost}>Text</text>
    }
    // line
    return <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={fill} strokeWidth={1.5} strokeDasharray="4 2" style={ghost} />
  }

  // ─── Properties panel ──────────────────────────────────────────────────────

  const renderProps = () => {
    if (!editObj) return (
      <div style={{ fontSize: 11, color: 'var(--fg-dim)', lineHeight: 1.6 }}>
        Select an object from the list or click one in the canvas to edit its properties.
      </div>
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = editObj as any
    const up = (key: string) => (v: number) => updateProp(key, v)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{editObj.type}</div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {editObj.type !== 'line'
            ? <><NumInput label="x" value={e.x} onChange={up('x')} /><NumInput label="y" value={e.y} onChange={up('y')} /></>
            : <><NumInput label="x1" value={e.x1} onChange={up('x1')} /><NumInput label="y1" value={e.y1} onChange={up('y1')} /><NumInput label="x2" value={e.x2} onChange={up('x2')} /><NumInput label="y2" value={e.y2} onChange={up('y2')} /></>}
        </div>

        {editObj.type === 'rect' && (
          <div style={{ display: 'flex', gap: 4 }}>
            <NumInput label="w" value={e.w} onChange={up('w')} min={1} /><NumInput label="h" value={e.h} onChange={up('h')} min={1} />
          </div>
        )}
        {(editObj.type === 'text' || editObj.type === 'dot') && <NumInput label="sz" value={e.size} onChange={up('size')} min={0} />}
        {editObj.type === 'line' && <NumInput label="th" value={e.thickness} onChange={up('thickness')} min={1} />}

        {editObj.type === 'text' && (
          <>
            <textarea
              ref={textareaRef}
              style={{ width: '100%', background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '3px 5px', fontSize: 11, resize: 'vertical', minHeight: 44, fontFamily: 'var(--font-mono)' }}
              value={(editObj as GlassesText).content}
              onChange={e => updateProp('content', e.target.value)} />
            <label style={{ ...labelStyle, gap: 6 }}>
              <input type="checkbox" checked={(editObj as GlassesText).shadow}
                onChange={e => updateProp('shadow', e.target.checked)} />
              shadow
            </label>
          </>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={labelStyle}>
            <span>col</span>
            <input type="color" value={intToHex(editObj.color)}
              style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              onChange={e => updateProp('color', hexToInt(e.target.value))} />
          </label>
          <NumInput label="α" value={e.alpha} onChange={up('alpha')} min={0} max={255} />
        </div>
      </div>
    )
  }

  // ─── Compact trigger (shown in the panel) ──────────────────────────────────

  const meterColor = jsonLen > JSON_CAP * 0.94 ? 'var(--red)' : jsonLen > JSON_CAP * 0.75 ? '#f5a623' : 'var(--fg-dim)'
  const trigger = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>
        {objects.length === 0
          ? 'No objects in scene.'
          : <>{objects.length} object{objects.length !== 1 ? 's' : ''} · <span style={{ color: meterColor }}>{jsonLen.toLocaleString()}/{JSON_CAP.toLocaleString()} chars</span></>}
      </span>
      <button className="btn btn-compact" onClick={() => setOpen(true)}>Open Editor</button>
    </div>
  )

  // ─── Modal content ─────────────────────────────────────────────────────────

  const modal = open && typeof document !== 'undefined' && createPortal(
    // Backdrop
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onPointerDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>

      {/* Modal panel */}
      <div style={{ width: 'min(1600px, 98vw)', height: '95vh', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface-3)', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Glasses Canvas Editor</span>
          <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>{CANVAS_W}×{CANVAS_H}</span>
          <span style={{ flex: 1 }} />
          {/* Draw mode toggles — click to arm, then click+drag on the canvas to place */}
          {(['rect', 'text', 'line'] as const).map(m => (
            <button key={m} className="btn btn-compact"
              style={drawMode === m ? { background: 'var(--accent)', color: 'var(--bg, #fff)' } : undefined}
              title={drawMode === m ? `${m}: click and drag on canvas to place` : `Draw ${m}`}
              onClick={() => toggleDraw(m)} disabled={atCap}>
              + {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
          <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 4px' }} />
          <button className="btn btn-compact" onClick={handleClearEditor}>Clear Editor</button>
          <button className="btn btn-compact btn-danger" onClick={handleClearGlasses}>Clear Glasses</button>
          <button className="btn btn-compact btn-primary" onClick={handleSend}>Send to Glasses</button>
          <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 4px' }} />
          <button className="btn btn-compact" onClick={() => setOpen(false)} title="Close (Esc)">✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>

          {/* SVG Viewport — SVG fills the flex area; viewBox+preserveAspectRatio letterboxes to 512×288 */}
          <div style={{ flex: 1, background: '#0e0e0e', overflow: 'hidden' }}>
            <svg ref={svgRef} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              preserveAspectRatio="xMidYMid meet"
              width="100%" height="100%"
              style={{ display: 'block', cursor: drawMode ? 'crosshair' : 'default' }}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={handleSvgPointerUp}>
              {/* Canvas fill + click-to-deselect */}
              <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#111"
                onPointerDown={() => { if (!drawMode) setSelectedId(null) }} />
              {objects.map(renderObj)}
              {renderDrawPreview()}
              {/* Transparent overlay sits above all objects when a draw tool is armed */}
              {drawMode && (
                <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="transparent"
                  style={{ cursor: 'crosshair' }}
                  onPointerDown={e => {
                    svgRef.current?.setPointerCapture(e.pointerId)
                    const [mx, my] = toSvg(e)
                    drawAnchorRef.current = [Math.round(mx), Math.round(my)]
                    setDrawCurrent([Math.round(mx), Math.round(my)])
                  }} />
              )}
              {/* Canvas boundary indicator */}
              <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="none"
                stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} style={{pointerEvents:'none'}} />
            </svg>
          </div>

          {/* Sidebar */}
          <div style={{ width: 230, flexShrink: 0, borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Object list */}
            <div style={{ borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              <div style={{ background: 'var(--surface-3)', borderBottom: '1px solid var(--line)', padding: '5px 10px', fontSize: 10, color: 'var(--fg-mute)', textTransform: 'uppercase', letterSpacing: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Objects ({objects.length})</span>
                <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 9, fontFamily: 'var(--font-mono)', color: jsonLen > JSON_CAP * 0.94 ? 'var(--red)' : jsonLen > JSON_CAP * 0.75 ? '#f5a623' : 'var(--fg-dim)' }}>
                  {jsonLen.toLocaleString()}/{JSON_CAP.toLocaleString()}
                </span>
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', background: 'var(--surface-2)' }}>
                {objects.length === 0
                  ? <div style={{ fontSize: 11, color: 'var(--fg-dim)', padding: 10, textAlign: 'center' }}>
                      Use + buttons above to add objects.
                    </div>
                  : objects.map((obj, i) => (
                    <div key={obj.id}
                      draggable
                      onDragStart={e => handleListDragStart(e, i)}
                      onDragOver={e => handleListDragOver(e, i)}
                      onDrop={e => handleListDrop(e, i)}
                      onDragEnd={handleListDragEnd}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 2, padding: '3px 6px',
                        cursor: 'pointer',
                        background: listDragIdx === i ? 'var(--surface-3)' : selectedId === obj.id ? 'var(--accent-soft)' : 'transparent',
                        borderLeft: selectedId === obj.id ? '2px solid var(--accent)' : '2px solid transparent',
                        borderTop: listOverIdx === i && listDragIdx !== i ? '2px solid var(--accent)' : '2px solid transparent',
                        opacity: listDragIdx === i ? 0.4 : 1,
                      }}
                      onClick={() => setSelectedId(obj.id)}>
                      <span style={{ color: 'var(--fg-dim)', fontSize: 10, cursor: 'grab', padding: '0 2px', userSelect: 'none' }}>⠿</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: selectedId === obj.id ? 'var(--accent)' : 'var(--fg)' }}>
                        {obj.type}{obj.type === 'text' ? ` "${(obj as GlassesText).content.slice(0, 10)}"` : ''}
                      </span>
                      <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20 }}
                        onClick={e => { e.stopPropagation(); handleReorder(i, -1) }} disabled={i === 0}>↑</button>
                      <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20 }}
                        onClick={e => { e.stopPropagation(); handleReorder(i, 1) }} disabled={i === objects.length - 1}>↓</button>
                      <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20, color: 'var(--red)' }}
                        onClick={e => { e.stopPropagation(); handleDelete(obj.id) }}>×</button>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* Properties */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ background: 'var(--surface-3)', borderBottom: '1px solid var(--line)', padding: '5px 10px', fontSize: 10, color: 'var(--fg-mute)', textTransform: 'uppercase', letterSpacing: 1 }}>
                Properties
              </div>
              <div style={{ flex: 1, padding: 10, overflowY: 'auto', background: 'var(--surface-2)' }}>{renderProps()}</div>
            </div>

            {/* Usage hint */}
            <div style={{ borderTop: '1px solid var(--line)', padding: '8px 10px', background: 'var(--surface-3)', fontSize: 10, color: 'var(--fg-dim)', lineHeight: 1.6 }}>
              <b style={{ color: 'var(--fg-mute)' }}>+ buttons</b> — click to arm a draw tool (highlighted), click again to disarm. Esc cancels.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Draw</b> — click+drag on canvas to place. Rect/text: drag bounding box. Line: drag endpoints.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Move/resize</b> — drag objects, rect corners, or line endpoints when no tool is armed.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Send to Glasses</b> — pushes the current scene to the player&apos;s HUD.
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )

  return (
    <>
      {trigger}
      {modal}
    </>
  )
}
