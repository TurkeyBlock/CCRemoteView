'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useWorldStore } from '@/store/useWorld'
import type { GlassesObject, GlassesRect, GlassesText, GlassesLine, GlassesPolygon, GlassesLines, GlassesItem } from '@/types/glasses'
import { loadMinecraftFont, isFontLoaded, measureMinecraftText, renderMinecraftTextToCanvas } from '@/utils/minecraftFont'

// ─── Utilities ────────────────────────────────────────────────────────────────

const intToHex = (n: number) => '#' + Math.max(0, Math.min(0xffffff, n | 0)).toString(16).padStart(6, '0')
const hexToInt = (h: string) => parseInt(h.replace('#', ''), 16) || 0
const uid = () => Math.random().toString(36).slice(2, 11)

// rgba packing helpers — rgba is (rgb24 * 256) + alpha, matching GlassesObject.rgba.
const rgbOfRgba   = (rgba: number) => Math.floor(rgba / 256)
const alphaOfRgba = (rgba: number) => rgba % 256
const packRgba    = (rgb24: number, alpha: number) => rgb24 * 256 + alpha

// ─── RDP stroke simplification ────────────────────────────────────────────────

function rdpSimplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts
  const perpDistSq = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    if (dx === 0 && dy === 0) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
    return (p[0] - (a[0] + t * dx)) ** 2 + (p[1] - (a[1] + t * dy)) ** 2
  }
  let maxD = 0, maxI = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistSq(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxD) { maxD = d; maxI = i }
  }
  if (maxD > tol * tol) {
    const l = rdpSimplify(pts.slice(0, maxI + 1), tol)
    const r = rdpSimplify(pts.slice(maxI), tol)
    return [...l.slice(0, -1), ...r]
  }
  return [pts[0], pts[pts.length - 1]]
}

// ─── Draw tool config ─────────────────────────────────────────────────────────

type DrawMode = 'rect' | 'text' | 'line' | 'poly' | 'lines' | 'item'

const DRAW_TOOLS: { mode: DrawMode; label: string }[] = [
  { mode: 'rect',  label: 'Rect'    },
  { mode: 'poly',  label: 'Poly'    },
  { mode: 'lines', label: 'Drawing' },
  { mode: 'line',  label: 'Line'    },
  { mode: 'text',  label: 'Text'    },
  { mode: 'item',  label: 'Item'    },
]

// ─── Drag state ───────────────────────────────────────────────────────────────

type DragInfo =
  | { kind: 'move';     id: string; mx0: number; my0: number; ox: number; oy: number }
  | { kind: 'move-pts';    id: string; mx0: number; my0: number; origPoints: [number, number][] }
  | { kind: 'move-vertex'; id: string; vertIdx: number; mx0: number; my0: number; origPts: [number, number][] }
  | { kind: 'resize';      id: string; corner: 'nw'|'ne'|'sw'|'se'; mx0: number; my0: number; ox: number; oy: number; ow: number; oh: number }
  | { kind: 'endpoint'; id: string; pt: 1|2; mx0: number; my0: number; ox: number; oy: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Override = { id: string; props: Record<string, any> }

// Plethora canvas dimensions confirmed via papi.getCanvasSize() — do not change.
const CANVAS_W = 512
const CANVAS_H = 288

const EMPTY_SCENE: GlassesObject[] = []
// Must match maxLength on glassesSetCanvas in command_routing.json.
const JSON_CAP = 16_000

// ─── Shared input styles ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: 56, background: 'var(--surface-3)', border: '1px solid var(--line)',
  borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: 11,
}
const labelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-mute)',
}

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

interface TextObjProps {
  t: GlassesText; sel: boolean; SEL: string; fontReady: boolean
  onPointerDown: (e: React.PointerEvent) => void
}

function MinecraftTextObj({ t, sel, SEL, fontReady, onPointerDown }: TextObjProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const offscreen = useRef(typeof document !== 'undefined' ? document.createElement('canvas') : null)
  const numLines  = t.content.split('\n').length

  useEffect(() => {
    if (!fontReady || !offscreen.current || !t.content) { setDataUrl(null); return }
    renderMinecraftTextToCanvas(offscreen.current, t.content, t.size, rgbOfRgba(t.rgba), alphaOfRgba(t.rgba))
    setDataUrl(offscreen.current.toDataURL())
  }, [t.content, t.size, t.rgba, fontReady])

  const textW   = fontReady ? measureMinecraftText(t.content, t.size) : Math.max(10, t.content.split('\n').reduce((m, l) => Math.max(m, l.length), 0) * t.size * 6)
  const textH   = numLines * t.size * 9
  const fill    = intToHex(rgbOfRgba(t.rgba))
  const opacity = alphaOfRgba(t.rgba) / 255

  return (
    <g>
      {dataUrl
        ? <image href={dataUrl} x={t.x} y={t.y - textH} width={Math.max(1, textW)} height={textH}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style={{ pointerEvents: 'none', imageRendering: 'pixelated' } as any} />
        : t.content.split('\n').map((line, li) => (
            <text key={li} x={t.x}
              y={t.y - (numLines - 1 - li) * t.size * 9 - t.size * 1.8}
              fill={fill} opacity={opacity} fontSize={t.size * 8}
              style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {line || ' '}
            </text>
          ))
      }
      {/* Transparent hit target for drag — covers the full text block height */}
      <rect x={t.x} y={t.y - textH} width={Math.max(10, textW)} height={Math.max(9, textH)}
        fill="transparent" style={{ cursor: 'move' }} onPointerDown={onPointerDown} />
      {sel && <rect x={t.x - 1} y={t.y - textH - 1} width={Math.max(10, textW) + 2} height={textH + 2}
        fill="none" stroke={SEL} strokeWidth={0.8} style={{ pointerEvents: 'none' }} />}
    </g>
  )
}

// ─── Item renderer ────────────────────────────────────────────────────────────

interface ItemObjProps {
  obj: GlassesItem; sel: boolean; SEL: string
  onPointerDown: (e: React.PointerEvent) => void
}

function ItemObj({ obj, sel, SEL, onPointerDown }: ItemObjProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const namePart = obj.item.includes(':') ? obj.item.split(':')[1] : obj.item

  useEffect(() => {
    const src = `assets/items/${obj.item.replace(':', '/')}.png`
    const img = new Image()
    img.onload = () => setImgSrc(src)
    img.onerror = () => setImgSrc(null)
    img.src = src
  }, [obj.item])

  const w = Math.max(4, Math.round(16 * obj.scale))
  const opacity = obj.alpha / 255

  return (
    <g>
      {imgSrc
        ? <image href={imgSrc} x={obj.x} y={obj.y} width={w} height={w} opacity={opacity}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style={{ cursor: 'move', imageRendering: 'pixelated' } as any}
            onPointerDown={onPointerDown} />
        : <>
            <rect x={obj.x} y={obj.y} width={w} height={w}
              fill="rgba(40,40,60,0.7)" stroke="rgba(180,180,255,0.5)" strokeWidth={0.8} strokeDasharray="3 2"
              opacity={opacity} style={{ cursor: 'move' }} onPointerDown={onPointerDown} />
            <text x={obj.x + w / 2} y={obj.y + w / 2 + 3} fill="white" fontSize={Math.max(4, w / 5)}
              textAnchor="middle" opacity={opacity * 0.85}
              style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {namePart.slice(0, 10)}
            </text>
          </>
      }
      {sel && <rect x={obj.x - 1} y={obj.y - 1} width={w + 2} height={w + 2}
        fill="none" stroke={SEL} strokeWidth={0.8} style={{ pointerEvents: 'none' }} />}
    </g>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { computerId: number }

export default function GlassesEditor({ computerId }: Props) {
  const objects        = useWorldStore(s => (s.computers[computerId]?.glassesScene ?? EMPTY_SCENE) as GlassesObject[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serverLiveMode = useWorldStore(s => Boolean((s.computers[computerId] as any)?.glassesLiveMode))
  const wsSend         = useWorldStore(s => s.wsSend)
  const invokeCommand  = useWorldStore(s => s.invokeCommand)

  const [liveMode, setLiveMode]       = useState(false)
  useEffect(() => { setLiveMode(serverLiveMode) }, [serverLiveMode])

  const [open, setOpen]               = useState(false)
  const [fontReady, setFontReady]     = useState(isFontLoaded)
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [editObj, setEditObj]         = useState<GlassesObject | null>(null)
  const [override, setOverride]       = useState<Override | null>(null)
  const [listDragIdx, setListDragIdx] = useState<number | null>(null)
  const [listOverIdx, setListOverIdx] = useState<number | null>(null)
  // Color + alpha for newly-created objects.
  const [drawRgba, setDrawRgba]         = useState(packRgba(0xffffff, 255))
  const [drawThickness, setDrawThickness] = useState(1)

  const svgRef            = useRef<SVGSVGElement>(null)
  const textareaRef       = useRef<HTMLTextAreaElement>(null)
  const dragRef           = useRef<DragInfo | null>(null)
  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawAnchorRef     = useRef<[number, number] | null>(null)
  const pendingCaptureRef = useRef<number | null>(null)
  // In-progress polygon vertices (ref so mutations don't trigger React; setPolyTick forces re-render).
  const polyPointsRef     = useRef<[number, number][]>([])
  // Raw freehand stroke points collected during a lines drag (never stored in React state).
  const rawPointsRef      = useRef<[number, number][]>([])

  const [drawMode, setDrawMode]       = useState<DrawMode | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<[number, number] | null>(null)
  const [, setPolyTick]               = useState(0)

  const jsonLen = JSON.stringify(objects).length
  const atCap   = objects.length >= 512 || jsonLen > JSON_CAP - 100

  useEffect(() => {
    if (fontReady) return
    loadMinecraftFont('assets/').then(ok => { if (ok) setFontReady(true) })
  }, [fontReady])

  // Sync editObj when selection changes — skip if object not yet in store (pending server echo).
  useEffect(() => {
    if (!selectedId) { setEditObj(null); return }
    const found = objects.find(o => o.id === selectedId)
    if (found) setEditObj(found)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus textarea after a fresh text object is placed.
  useEffect(() => {
    if (!editObj || editObj.type !== 'text') return
    if (!objects.some(o => o.id === editObj.id)) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [editObj?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      dragRef.current = null; setOverride(null)
      drawAnchorRef.current = null; rawPointsRef.current = []; setDrawCurrent(null); setDrawMode(null)
      polyPointsRef.current = []; setPolyTick(0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      // Enter closes an in-progress polygon.
      if (e.key === 'Enter' && drawMode === 'poly' && polyPointsRef.current.length >= 3) {
        e.preventDefault()
        const pts = [...polyPointsRef.current]
        polyPointsRef.current = []; setPolyTick(t => t + 1); setDrawCurrent(null)
        commitPolygon(pts)
        return
      }
      if (e.key !== 'Escape') return
      if (drawAnchorRef.current || drawMode || polyPointsRef.current.length > 0) {
        drawAnchorRef.current = null; rawPointsRef.current = []
        polyPointsRef.current = []; setPolyTick(t => t + 1)
        setDrawCurrent(null); setDrawMode(null)
      } else {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, drawMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── WS helpers ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendOp = (op: string, extra: Record<string, any> = {}) =>
    wsSend?.({ type: 'glassesSceneOp', computerId, op, ...extra } as any)

  const sendUpdateDebounced = (id: string, props: Partial<GlassesObject>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => sendOp('update', { objectId: id, object: props }), 150)
  }

  // ─── Toolbar actions ───────────────────────────────────────────────────────

  const toggleDraw = (mode: DrawMode) => {
    drawAnchorRef.current = null; rawPointsRef.current = []
    polyPointsRef.current = []; setPolyTick(t => t + 1); setDrawCurrent(null)
    setDrawMode(prev => prev === mode ? null : mode)
  }

  const handleClearEditor  = () => { sendOp('clear'); setSelectedId(null) }
  const handleClearGlasses = () => { sendOp('clear'); setSelectedId(null); invokeCommand(computerId, 'glassesClear') }

  const handleSend = () => {
    wsSend?.({ type: 'setGlassesScene', computerId, scene: objects } as any)
    invokeCommand(computerId, 'glassesSetCanvas', [JSON.stringify(objects)])
  }

  const handleToggleLive = () => {
    const enabling = !liveMode
    setLiveMode(enabling)
    wsSend?.({ type: 'setGlassesLiveMode', computerId, enabled: enabling } as any)
    if (enabling) {
      wsSend?.({ type: 'setGlassesScene', computerId, scene: objects } as any)
      invokeCommand(computerId, 'glassesSetCanvas', [JSON.stringify(objects)])
    }
  }

  // ─── Commit helpers ────────────────────────────────────────────────────────

  const commitPolygon = (pts: [number, number][]) => {
    if (pts.length < 3) return
    const obj: GlassesPolygon = { id: uid(), type: 'polygon', points: pts, rgba: drawRgba }
    if (objects.length < 512 && JSON.stringify([...objects, obj]).length <= JSON_CAP) {
      sendOp('add', { object: obj }); setSelectedId(obj.id); setEditObj(obj)
    }
    setDrawMode(null)
  }

  const commitItem = (x: number, y: number) => {
    const obj: GlassesItem = {
      id: uid(), type: 'item', x, y,
      item: 'minecraft:stone', damage: 0, scale: 1, alpha: alphaOfRgba(drawRgba),
    }
    if (objects.length < 512 && JSON.stringify([...objects, obj]).length <= JSON_CAP) {
      sendOp('add', { object: obj }); setSelectedId(obj.id); setEditObj(obj)
    }
    setDrawMode(null)
  }

  // ─── SVG coordinate conversion ─────────────────────────────────────────────

  const toSvg = (e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return [0, 0]
    const p = pt.matrixTransform(ctm.inverse())
    return [p.x, p.y]
  }

  // ─── Drag ──────────────────────────────────────────────────────────────────

  const startDrag = (e: React.PointerEvent, info: DragInfo) => {
    e.stopPropagation()
    pendingCaptureRef.current = e.pointerId
    dragRef.current = info
    setSelectedId(info.id)
  }

  const handleSvgPointerMove = (e: React.PointerEvent) => {
    if (pendingCaptureRef.current !== null) {
      svgRef.current?.setPointerCapture(pendingCaptureRef.current)
      pendingCaptureRef.current = null
    }

    // Polygon: track cursor for trailing-line preview (no drag in poly mode).
    if (drawMode === 'poly' && polyPointsRef.current.length > 0) {
      const [mx, my] = toSvg(e)
      setDrawCurrent([Math.round(mx), Math.round(my)])
      return
    }
    // Item: track cursor for ghost preview.
    if (drawMode === 'item') {
      const [mx, my] = toSvg(e)
      setDrawCurrent([Math.round(mx), Math.round(my)])
    }

    if (drawAnchorRef.current) {
      const [mx, my] = toSvg(e)
      if (drawMode === 'lines') {
        const last = rawPointsRef.current[rawPointsRef.current.length - 1]
        if (last) {
          const dx = Math.round(mx) - last[0], dy = Math.round(my) - last[1]
          if (dx * dx + dy * dy >= 4) rawPointsRef.current.push([Math.round(mx), Math.round(my)])
        }
      }
      setDrawCurrent([Math.round(mx), Math.round(my)])
      return
    }

    const d = dragRef.current
    if (!d) return
    const [mx, my] = toSvg(e)
    if (d.kind === 'move') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverride({ id: d.id, props: { x: d.ox + dx, y: d.oy + dy } as any })
    } else if (d.kind === 'move-pts') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverride({ id: d.id, props: { points: d.origPoints.map(([px, py]) => [px + dx, py + dy] as [number, number]) } as any })
    } else if (d.kind === 'move-vertex') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverride({ id: d.id, props: { points: d.origPts.map((p, i) => i === d.vertIdx ? [p[0] + dx, p[1] + dy] as [number, number] : p) } as any })
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
    pendingCaptureRef.current = null
    const anchor = drawAnchorRef.current

    // Freehand lines: finalise stroke on release.
    if (anchor && drawMode === 'lines') {
      drawAnchorRef.current = null; setDrawCurrent(null)
      const raw = rawPointsRef.current; rawPointsRef.current = []
      if (raw.length < 2) return
      let tol = 3
      let simplified = rdpSimplify(raw, tol)
      while (simplified.length > 64 && tol < 200) { tol *= 2; simplified = rdpSimplify(raw, tol) }
      if (simplified.length < 2) return
      const obj: GlassesLines = { id: uid(), type: 'lines', points: simplified, rgba: drawRgba, thickness: drawThickness }
      if (objects.length < 512 && JSON.stringify([...objects, obj]).length <= JSON_CAP) {
        sendOp('add', { object: obj }); setSelectedId(obj.id); setEditObj(obj)
      }
      return
    }

    if (anchor && drawMode && drawMode !== 'poly' && drawMode !== 'item') {
      const [x1, y1] = anchor
      const [x2, y2] = toSvg(e)
      drawAnchorRef.current = null; setDrawCurrent(null)

      let obj: GlassesObject
      if (drawMode === 'rect') {
        obj = { id: uid(), type: 'rect',
          x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)),
          w: Math.max(4, Math.round(Math.abs(x2 - x1))), h: Math.max(4, Math.round(Math.abs(y2 - y1))),
          rgba: drawRgba }
      } else if (drawMode === 'text') {
        const h = Math.max(9, Math.abs(y2 - y1))
        obj = { id: uid(), type: 'text',
          x: Math.round(Math.min(x1, x2)), y: Math.round(Math.max(y1, y2)),
          content: 'Text', rgba: drawRgba, size: Math.max(1, Math.round(h / 9)), shadow: false }
      } else {
        obj = { id: uid(), type: 'line',
          x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2),
          rgba: drawRgba, thickness: drawThickness }
      }

      if (objects.length < 512 && JSON.stringify([...objects, obj]).length <= JSON_CAP) {
        sendOp('add', { object: obj }); setSelectedId(obj.id); setEditObj(obj)
      }
      return
    }

    const d = dragRef.current
    dragRef.current = null
    if (d && override?.id === d.id) {
      sendOp('update', { objectId: d.id, object: override.props })
      setEditObj(prev => prev?.id === d.id ? { ...prev, ...override.props } as GlassesObject : prev)
    }
  }

  // Clear override once the server broadcast confirms the new value.
  useEffect(() => {
    if (!override) return
    const obj = objects.find(o => o.id === override.id)
    if (!obj) { setOverride(null); return }
    const confirmed = Object.entries(override.props).every(([k, v]) => {
      const cur = (obj as any)[k]
      // Points arrays require structural equality, not reference equality.
      if (typeof v === 'object' && v !== null) return JSON.stringify(v) === JSON.stringify(cur)
      return cur === v
    })
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
    if (JSON.stringify(objects.map(o => o.id === editObj.id ? updated : o)).length > JSON_CAP) return
    setEditObj(updated)
    sendUpdateDebounced(editObj.id, { [key]: val } as any)
  }

  // ─── SVG rendering ─────────────────────────────────────────────────────────

  const resolved = (obj: GlassesObject): GlassesObject =>
    override?.id === obj.id ? { ...obj, ...override.props } as GlassesObject : obj

  const SEL = '#3b82f6'
  const HR  = 3

  const renderObj = (raw: GlassesObject) => {
    const obj     = resolved(raw)
    const sel     = selectedId === obj.id
    const hasRgba = obj.type !== 'item'
    const opacity = hasRgba ? alphaOfRgba((obj as any).rgba) / 255 : 1
    const fill    = hasRgba ? intToHex(rgbOfRgba((obj as any).rgba)) : '#fff'

    if (obj.type === 'rect') {
      const r = obj as GlassesRect
      return (
        <g key={r.id}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} opacity={opacity}
            style={{ cursor: 'move' }}
            onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move', id: r.id, mx0: mx, my0: my, ox: r.x, oy: r.y }) }} />
          {sel && <>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={SEL} strokeWidth={0.8} style={{ pointerEvents: 'none' }} />
            {(['nw', 'ne', 'sw', 'se'] as const).map(c => {
              const hx = c.includes('e') ? r.x + r.w : r.x
              const hy = c.includes('s') ? r.y + r.h : r.y
              return <rect key={c} x={hx - HR} y={hy - HR} width={HR * 2} height={HR * 2} fill={SEL}
                style={{ cursor: `${c}-resize` }}
                onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'resize', id: r.id, corner: c, mx0: mx, my0: my, ox: r.x, oy: r.y, ow: r.w, oh: r.h }) }} />
            })}
          </>}
        </g>
      )
    }

    if (obj.type === 'text') {
      const t = obj as GlassesText
      return (
        <MinecraftTextObj key={t.id} t={t} sel={sel} SEL={SEL} fontReady={fontReady}
          onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move', id: t.id, mx0: mx, my0: my, ox: t.x, oy: t.y }) }} />
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
            <circle cx={l.x1} cy={l.y1} r={HR + 1} fill={SEL} style={{ cursor: 'move' }}
              onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'endpoint', id: l.id, pt: 1, mx0: mx, my0: my, ox: l.x1, oy: l.y1 }) }} />
            <circle cx={l.x2} cy={l.y2} r={HR + 1} fill={SEL} style={{ cursor: 'move' }}
              onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'endpoint', id: l.id, pt: 2, mx0: mx, my0: my, ox: l.x2, oy: l.y2 }) }} />
          </>}
        </g>
      )
    }

    if (obj.type === 'polygon') {
      const p = obj as GlassesPolygon
      const rawPts = p.points
      const outlinePts = rawPts.map(([x, y]) => `${x},${y}`).join(' ')
      const dragHandler = (e: React.PointerEvent) => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move-pts', id: p.id, mx0: mx, my0: my, origPoints: p.points }) }
      return (
        <g key={p.id}>
          {/* Triangle fan from rawPts[0] — matches Plethora Polygon2d.draw() */}
          <g opacity={opacity} style={{ cursor: 'move' }} onPointerDown={dragHandler}>
            {rawPts.length >= 3 && Array.from({ length: rawPts.length - 2 }, (_, i) => (
              <polygon key={i}
                points={`${rawPts[0][0]},${rawPts[0][1]} ${rawPts[i+1][0]},${rawPts[i+1][1]} ${rawPts[i+2][0]},${rawPts[i+2][1]}`}
                fill={fill} />
            ))}
          </g>
          {sel && <>
            <polygon points={outlinePts} fill="none" stroke={SEL} strokeWidth={0.8} style={{ pointerEvents: 'none' }} />
            {p.points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={HR + 1} fill={SEL} style={{ cursor: 'move' }}
                onPointerDown={e => { e.stopPropagation(); const [mx, my] = toSvg(e); startDrag(e, { kind: 'move-vertex', id: p.id, vertIdx: i, mx0: mx, my0: my, origPts: p.points }) }} />
            ))}
          </>}
        </g>
      )
    }

    if (obj.type === 'lines') {
      const l = obj as GlassesLines
      const pts = l.points.map(([x, y]) => `${x},${y}`).join(' ')
      return (
        <g key={l.id}>
          {/* Dark halo rendered behind the line so white dashes remain visible regardless of line colour */}
          {sel && <polyline points={pts} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={l.thickness + 4}
            vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />}
          <polyline points={pts} fill="none" stroke={fill} strokeWidth={l.thickness} opacity={opacity}
            vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
          <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(8, l.thickness + 4)}
            style={{ cursor: 'move' }}
            onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move-pts', id: l.id, mx0: mx, my0: my, origPoints: l.points }) }} />
          {sel && <>
            <polyline points={pts} fill="none" stroke="white" strokeWidth={1} strokeDasharray="5 3"
              vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
            {l.points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={HR + 1} fill={SEL} style={{ cursor: 'move' }}
                onPointerDown={e => { e.stopPropagation(); const [mx, my] = toSvg(e); startDrag(e, { kind: 'move-vertex', id: l.id, vertIdx: i, mx0: mx, my0: my, origPts: l.points }) }} />
            ))}
          </>}
        </g>
      )
    }

    if (obj.type === 'item') {
      const itm = obj as GlassesItem
      return (
        <ItemObj key={itm.id} obj={itm} sel={sel} SEL={SEL}
          onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move', id: itm.id, mx0: mx, my0: my, ox: itm.x, oy: itm.y }) }} />
      )
    }

    return null
  }

  // ─── Draw preview ──────────────────────────────────────────────────────────

  const renderDrawPreview = () => {
    const anchor    = drawAnchorRef.current
    const ghost: React.CSSProperties = { pointerEvents: 'none', opacity: 0.75 }
    const drawFill  = intToHex(rgbOfRgba(drawRgba))

    if (drawMode === 'poly') {
      const pts = polyPointsRef.current
      if (pts.length === 0) return null
      const ptStr = pts.map(([x, y]) => `${x},${y}`).join(' ')
      return (
        <g style={{ pointerEvents: 'none' }}>
          {pts.length >= 3 && (
            <g opacity={0.2}>
              {Array.from({ length: pts.length - 2 }, (_, i) => (
                <polygon key={i}
                  points={`${pts[0][0]},${pts[0][1]} ${pts[i+1][0]},${pts[i+1][1]} ${pts[i+2][0]},${pts[i+2][1]}`}
                  fill={drawFill} />
              ))}
            </g>
          )}
          {pts.length >= 2 && <polyline points={ptStr} fill="none" stroke={SEL} strokeWidth={1} strokeDasharray="4 2" />}
          {drawCurrent && (
            <line x1={pts[pts.length - 1][0]} y1={pts[pts.length - 1][1]}
              x2={drawCurrent[0]} y2={drawCurrent[1]} stroke={SEL} strokeWidth={1} strokeDasharray="4 2" />
          )}
          {pts.map(([x, y], i) => {
            const isFirst = i === 0
            const canClose = isFirst && pts.length >= 3 && drawCurrent !== null &&
              (drawCurrent[0] - x) ** 2 + (drawCurrent[1] - y) ** 2 <= 64
            return (
              <circle key={i} cx={x} cy={y}
                r={canClose ? 5 : (isFirst ? 4 : 2.5)}
                fill={canClose ? '#22c55e' : (isFirst ? drawFill : SEL)}
                stroke={canClose ? '#16a34a' : SEL} strokeWidth={0.5} />
            )
          })}
        </g>
      )
    }

    if (drawMode === 'lines' && anchor) {
      const pts = rawPointsRef.current
      if (pts.length < 2) return null
      return <polyline points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none" stroke={drawFill} strokeWidth={1.5} strokeDasharray="4 2" style={ghost} />
    }

    if (drawMode === 'item' && drawCurrent) {
      return <rect x={drawCurrent[0]} y={drawCurrent[1]} width={16} height={16}
        fill="rgba(255,255,255,0.08)" stroke={SEL} strokeWidth={1} strokeDasharray="3 2" style={ghost} />
    }

    if (!anchor || !drawCurrent || !drawMode) return null
    const [x1, y1] = anchor, [x2, y2] = drawCurrent

    if (drawMode === 'rect') {
      return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)}
        width={Math.max(4, Math.abs(x2 - x1))} height={Math.max(4, Math.abs(y2 - y1))}
        fill={drawFill} fillOpacity={0.15} stroke={SEL} strokeWidth={1} strokeDasharray="4 2" style={ghost} />
    }
    if (drawMode === 'text') {
      const fs = Math.max(9, Math.max(1, Math.round(Math.abs(y2 - y1) / 9)) * 9)
      return <text x={Math.min(x1, x2)} y={Math.max(y1, y2) - fs * 0.2}
        fill={drawFill} fontSize={fs} style={ghost}>Text</text>
    }
    return <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={drawFill} strokeWidth={1.5} strokeDasharray="4 2" style={ghost} />
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

    if (editObj.type === 'polygon' || editObj.type === 'lines') {
      const pts = (editObj as GlassesPolygon | GlassesLines).points
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
            {editObj.type} · {pts.length} pts
          </div>
          <div style={{ maxHeight: 120, overflowY: 'auto', background: 'var(--surface-3)', borderRadius: 2, padding: '2px 4px' }}>
            {pts.map(([x, y], i) => (
              <div key={i} style={{ display: 'flex', gap: 4, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--fg-mute)', minWidth: 18, textAlign: 'right' }}>{i}:</span>
                <span>{x}, {y}</span>
              </div>
            ))}
          </div>
          {editObj.type === 'lines' && (
            <NumInput label="th" value={e.thickness} onChange={v => updateProp('thickness', Math.max(1, v | 0))} min={1} />
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={labelStyle}>
              <span>col</span>
              <input type="color" value={intToHex(rgbOfRgba(editObj.rgba))}
                style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                onChange={ev => updateProp('rgba', packRgba(hexToInt(ev.target.value), alphaOfRgba(editObj.rgba)))} />
            </label>
            <NumInput label="α" value={alphaOfRgba(editObj.rgba)}
              onChange={v => updateProp('rgba', packRgba(rgbOfRgba(editObj.rgba), Math.max(0, Math.min(255, v))))}
              min={0} max={255} />
          </div>
        </div>
      )
    }

    if (editObj.type === 'item') {
      const itm = editObj as GlassesItem
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>item</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <NumInput label="x" value={itm.x} onChange={up('x')} />
            <NumInput label="y" value={itm.y} onChange={up('y')} />
          </div>
          <label style={{ ...labelStyle, gap: 6 }}>
            <span style={{ width: 22, textAlign: 'right', flexShrink: 0 }}>id</span>
            <input type="text" style={{ ...inputStyle, width: 130 }}
              value={itm.item} placeholder="minecraft:stone"
              onChange={ev => updateProp('item', ev.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <NumInput label="dmg" value={itm.damage} onChange={v => updateProp('damage', Math.max(0, v | 0))} min={0} />
            <NumInput label="sc" value={itm.scale} onChange={v => updateProp('scale', Math.max(0.1, v))} min={0.1} />
          </div>
          <NumInput label="α" value={itm.alpha}
            onChange={v => updateProp('alpha', Math.max(0, Math.min(255, v | 0)))} min={0} max={255} />
        </div>
      )
    }

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
            <NumInput label="w" value={e.w} onChange={up('w')} min={1} />
            <NumInput label="h" value={e.h} onChange={up('h')} min={1} />
          </div>
        )}
        {(editObj.type === 'text' || editObj.type === 'dot') && (
          <NumInput label="sz" value={e.size} onChange={up('size')} min={0} />
        )}
        {editObj.type === 'line' && (
          <NumInput label="th" value={e.thickness} onChange={up('thickness')} min={1} />
        )}

        {editObj.type === 'text' && (
          <>
            <textarea ref={textareaRef}
              style={{ width: '100%', background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '3px 5px', fontSize: 11, resize: 'vertical', minHeight: 44, fontFamily: 'var(--font-mono)' }}
              value={(editObj as GlassesText).content}
              onChange={ev => updateProp('content', ev.target.value)} />
            <label style={{ ...labelStyle, gap: 6 }}>
              <input type="checkbox" checked={(editObj as GlassesText).shadow}
                onChange={ev => updateProp('shadow', ev.target.checked)} />
              shadow
            </label>
          </>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={labelStyle}>
            <span>col</span>
            <input type="color" value={intToHex(rgbOfRgba(editObj.rgba))}
              style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              onChange={ev => updateProp('rgba', packRgba(hexToInt(ev.target.value), alphaOfRgba(editObj.rgba)))} />
          </label>
          <NumInput label="α" value={alphaOfRgba(editObj.rgba)}
            onChange={v => updateProp('rgba', packRgba(rgbOfRgba(editObj.rgba), Math.max(0, Math.min(255, v))))}
            min={0} max={255} />
        </div>
      </div>
    )
  }

  // ─── Compact trigger ───────────────────────────────────────────────────────

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

  // ─── Modal ─────────────────────────────────────────────────────────────────

  const modal = open && typeof document !== 'undefined' && createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onPointerDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>

      <div style={{ width: 'min(1600px, 98vw)', height: '95vh', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'var(--surface-3)', borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Glasses Canvas Editor</span>
          <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>{CANVAS_W}×{CANVAS_H}</span>
          <span style={{ flex: 1 }} />
          {/* Draw color + alpha for new objects */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Color / alpha for new objects">
            <input type="color" value={intToHex(rgbOfRgba(drawRgba))}
              style={{ width: 26, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              onChange={ev => setDrawRgba(packRgba(hexToInt(ev.target.value), alphaOfRgba(drawRgba)))} />
            <input type="number" value={alphaOfRgba(drawRgba)} min={0} max={255} step={1}
              title="Alpha for new objects"
              style={{ width: 46, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: 11 }}
              onChange={ev => { const v = Number(ev.target.value); if (!isNaN(v)) setDrawRgba(packRgba(rgbOfRgba(drawRgba), Math.max(0, Math.min(255, v)))) }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Thickness for new line/drawing objects">
            <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>th</span>
            <input type="number" value={drawThickness} min={1} step={1}
              style={{ width: 38, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: 11 }}
              onChange={ev => { const v = Number(ev.target.value); if (!isNaN(v)) setDrawThickness(Math.max(1, v | 0)) }} />
          </label>
          <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 2px' }} />
          {DRAW_TOOLS.map(({ mode, label }) => (
            <button key={mode} className="btn btn-compact"
              style={drawMode === mode ? { background: 'var(--accent)', color: 'var(--bg, #fff)' } : undefined}
              title={
                mode === 'poly'  ? 'Click to add vertices; click first vertex again to close (min 3); Enter also closes; Esc cancels' :
                mode === 'lines' ? 'Click and drag to draw a freehand stroke (auto-simplified)' :
                mode === 'item'  ? 'Click to place an item; set ID in properties' :
                drawMode === mode ? `${label}: click and drag on canvas to place` : `Draw ${label}`
              }
              onClick={() => toggleDraw(mode)} disabled={atCap}>
              + {label}
            </button>
          ))}
          <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 2px' }} />
          {!liveMode && <button className="btn btn-compact" onClick={handleClearEditor}>Clear Editor</button>}
          <button className="btn btn-compact btn-danger" onClick={handleClearGlasses}>Clear Glasses</button>
          <button className="btn btn-compact btn-primary" onClick={handleSend}
            title={liveMode ? 'Force full-scene sync (live mode is on)' : 'Push current scene to glasses'}>
            {liveMode ? 'Force Sync' : 'Send to Glasses'}
          </button>
          <button className="btn btn-compact"
            style={liveMode ? { background: 'var(--accent)', color: 'var(--bg, #fff)' } : undefined}
            title={liveMode ? 'Live mode on — edits stream to glasses in real time. Click to disable.' : 'Enable live mode — each edit streams to glasses immediately.'}
            onClick={handleToggleLive}>
            Live
          </button>
          <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 2px' }} />
          <button className="btn btn-compact" onClick={() => setOpen(false)} title="Close (Esc)">✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>

          {/* SVG Viewport */}
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
              {/* Transparent overlay intercepts all pointer events when a draw tool is armed */}
              {drawMode && (
                <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="transparent"
                  style={{ cursor: 'crosshair' }}
                  onPointerDown={e => {
                    const [mx, my] = toSvg(e)
                    const pt: [number, number] = [Math.round(mx), Math.round(my)]

                    if (drawMode === 'poly') {
                      const pts = polyPointsRef.current
                      if (pts.length >= 3) {
                        // Check proximity to first vertex (8px radius in canvas coords).
                        const [fx, fy] = pts[0]
                        const dx = pt[0] - fx, dy = pt[1] - fy
                        if (dx * dx + dy * dy <= 64) {
                          polyPointsRef.current = []; setPolyTick(t => t + 1)
                          setDrawCurrent(null); commitPolygon(pts)
                          return
                        }
                      }
                      if (pts.length < 32) {
                        polyPointsRef.current = [...pts, pt]; setPolyTick(t => t + 1)
                      }
                      return
                    }

                    if (drawMode === 'item') {
                      if (e.detail >= 2) return  // ignore double-click
                      commitItem(pt[0], pt[1])
                      return
                    }

                    // Drag-based tools: rect, text, line, lines.
                    svgRef.current?.setPointerCapture(e.pointerId)
                    drawAnchorRef.current = pt
                    if (drawMode === 'lines') rawPointsRef.current = [pt]
                    setDrawCurrent(pt)
                  }} />
              )}
              {/* Canvas boundary indicator */}
              <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="none"
                stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} style={{ pointerEvents: 'none' }} />
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
                        display: 'flex', alignItems: 'center', gap: 2, padding: '3px 6px', cursor: 'pointer',
                        background: listDragIdx === i ? 'var(--surface-3)' : selectedId === obj.id ? 'var(--accent-soft)' : 'transparent',
                        borderLeft: selectedId === obj.id ? '2px solid var(--accent)' : '2px solid transparent',
                        borderTop: listOverIdx === i && listDragIdx !== i ? '2px solid var(--accent)' : '2px solid transparent',
                        opacity: listDragIdx === i ? 0.4 : 1,
                      }}
                      onClick={() => setSelectedId(obj.id)}>
                      <span style={{ color: 'var(--fg-dim)', fontSize: 10, cursor: 'grab', padding: '0 2px', userSelect: 'none' }}>⠿</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: selectedId === obj.id ? 'var(--accent)' : 'var(--fg)' }}>
                        {obj.type === 'text'    ? `text "${(obj as GlassesText).content.slice(0, 10)}"` :
                         obj.type === 'item'    ? `item ${(obj as GlassesItem).item.split(':')[1] ?? ''}` :
                         obj.type === 'lines'   ? `lines (${(obj as GlassesLines).points.length}pts)` :
                         obj.type === 'polygon' ? `poly (${(obj as GlassesPolygon).points.length}pts)` :
                         obj.type}
                      </span>
                      <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20 }}
                        onClick={ev => { ev.stopPropagation(); handleReorder(i, -1) }} disabled={i === 0}>↑</button>
                      <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20 }}
                        onClick={ev => { ev.stopPropagation(); handleReorder(i, 1) }} disabled={i === objects.length - 1}>↓</button>
                      <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20, color: 'var(--red)' }}
                        onClick={ev => { ev.stopPropagation(); handleDelete(obj.id) }}>×</button>
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
              <div style={{ flex: 1, padding: 10, overflowY: 'auto', background: 'var(--surface-2)' }}>
                {renderProps()}
              </div>
            </div>

            {/* Usage hint */}
            <div style={{ borderTop: '1px solid var(--line)', padding: '8px 10px', background: 'var(--surface-3)', fontSize: 10, color: 'var(--fg-dim)', lineHeight: 1.6 }}>
              <b style={{ color: 'var(--fg-mute)' }}>Color/α</b> — sets color for new objects.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Rect/Text/Line</b> — click+drag to place.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Poly</b> — click to add vertices; click first vertex (turns green) to close (min 3); Enter also closes; Esc cancels.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Drawing</b> — click+drag freehand stroke (auto-simplified).<br />
              <b style={{ color: 'var(--fg-mute)' }}>Item</b> — click to place; set item ID in properties.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Move/resize</b> — drag shapes, rect corners, or poly/line vertices.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Live</b> — streams edits to glasses. Enabling sends a baseline sync first.
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
