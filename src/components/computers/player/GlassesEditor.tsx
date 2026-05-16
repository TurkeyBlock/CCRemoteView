'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useWorldStore } from '@/store/useWorld'
import type { GlassesObject, GlassesRect, GlassesText, GlassesLine, GlassesPolygon, GlassesLines, GlassesItem, GlassesGroup } from '@/types/glasses'
import { loadMinecraftFont, isFontLoaded, measureMinecraftText, renderMinecraftTextToCanvas } from '@/utils/minecraftFont'

// ─── Utilities ────────────────────────────────────────────────────────────────

const intToHex = (n: number) => '#' + Math.max(0, Math.min(0xffffff, n | 0)).toString(16).padStart(6, '0')
const hexToInt = (h: string) => parseInt(h.replace('#', ''), 16) || 0
const uid = () => Math.random().toString(36).slice(2, 11)

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

// ─── Object bounding box ──────────────────────────────────────────────────────

function objBounds(obj: GlassesObject): [number, number, number, number] {
  if (obj.type === 'rect')    return [obj.x, obj.y, obj.x + obj.w, obj.y + obj.h]
  if (obj.type === 'text')    return [obj.x, obj.y - obj.size * 9, obj.x + 80, obj.y]
  if (obj.type === 'line')    return [Math.min(obj.x1, obj.x2), Math.min(obj.y1, obj.y2), Math.max(obj.x1, obj.x2), Math.max(obj.y1, obj.y2)]
  if (obj.type === 'dot')     return [obj.x - obj.size, obj.y - obj.size, obj.x + obj.size, obj.y + obj.size]
  if (obj.type === 'item')    { const w = Math.round(16 * obj.scale); return [obj.x, obj.y, obj.x + w, obj.y + w] }
  if (obj.type === 'polygon' || obj.type === 'lines') {
    const xs = obj.points.map(p => p[0]), ys = obj.points.map(p => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  }
  if (obj.type === 'group') {
    if (obj.children.length === 0) return [obj.x, obj.y, obj.x + 10, obj.y + 10]
    const cb = obj.children.map(objBounds)
    return [
      Math.min(...cb.map(b => b[0])) + obj.x,
      Math.min(...cb.map(b => b[1])) + obj.y,
      Math.max(...cb.map(b => b[2])) + obj.x,
      Math.max(...cb.map(b => b[3])) + obj.y,
    ]
  }
  return [0, 0, 0, 0]
}

function objInBox(obj: GlassesObject, bx0: number, by0: number, bx1: number, by1: number): boolean {
  const [ox0, oy0, ox1, oy1] = objBounds(obj)
  return ox0 < bx1 && ox1 > bx0 && oy0 < by1 && oy1 > by0
}

function nudgeObj(obj: GlassesObject, dx: number, dy: number): GlassesObject {
  if (obj.type === 'line')    return { ...obj, x1: obj.x1+dx, y1: obj.y1+dy, x2: obj.x2+dx, y2: obj.y2+dy }
  if (obj.type === 'polygon' || obj.type === 'lines') return { ...obj, points: obj.points.map(([x,y]) => [x+dx, y+dy] as [number,number]) }
  if ('x' in obj && 'y' in obj) return { ...obj, x: (obj as any).x+dx, y: (obj as any).y+dy } as GlassesObject
  return obj
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
  | { kind: 'move';        id: string; mx0: number; my0: number; ox: number; oy: number }
  | { kind: 'multi-move';  anchors: { id: string; ox: number; oy: number; origPoints?: [number,number][] }[]; mx0: number; my0: number }
  | { kind: 'move-pts';    id: string; mx0: number; my0: number; origPoints: [number, number][] }
  | { kind: 'move-vertex'; id: string; vertIdx: number; mx0: number; my0: number; origPts: [number, number][] }
  | { kind: 'resize';      id: string; corner: 'nw'|'ne'|'sw'|'se'; mx0: number; my0: number; ox: number; oy: number; ow: number; oh: number }
  | { kind: 'endpoint';    id: string; pt: 1|2; mx0: number; my0: number; ox: number; oy: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'move-child';  groupId: string; childId: string; mx0: number; my0: number; origProps: Record<string, any> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Override = { id: string; props: Record<string, any> }

const CANVAS_W = 512
const CANVAS_H = 288
const EMPTY_SCENE: GlassesObject[] = []
const JSON_CAP = 16_000
const HISTORY_CAP = 50

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
  const liveObjects    = useWorldStore(s => (s.canvasScenes[computerId] ?? EMPTY_SCENE) as GlassesObject[])
  const wsSend         = useWorldStore(s => s.wsSend)
  const invokeCommand  = useWorldStore(s => s.invokeCommand)

  // ─── Mode & draft state ──────────────────────────────────────────────────
  const [editorMode, setEditorMode] = useState<'live' | 'draft'>('live')
  const [draftScene,  setDraftScene]  = useState<GlassesObject[]>([])
  const [undoStack,   setUndoStack]   = useState<GlassesObject[][]>([])
  const [redoStack,   setRedoStack]   = useState<GlassesObject[][]>([])

  const activeScene = editorMode === 'live' ? liveObjects : draftScene

  const draftPushHistory = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-(HISTORY_CAP - 1)), draftScene])
    setRedoStack([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScene])

  const undo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev
      const top = prev[prev.length - 1]
      setRedoStack(r => [draftScene, ...r.slice(0, HISTORY_CAP - 1)])
      setDraftScene(top)
      return prev.slice(0, -1)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScene])

  const redo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev
      const top = prev[0]
      setUndoStack(u => [...u.slice(-(HISTORY_CAP - 1)), draftScene])
      setDraftScene(top)
      return prev.slice(1)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScene])

  // ─── UI state ────────────────────────────────────────────────────────────
  const [open, setOpen]               = useState(false)
  const [fontReady, setFontReady]     = useState(isFontLoaded)
  const [selectedIds, setSelectedIds]         = useState<string[]>([])
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [editObj,  setEditObj]                = useState<GlassesObject | null>(null)
  const [overrides, setOverrides]     = useState<Override[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [childOverride, setChildOverride] = useState<{ groupId: string; childId: string; props: Record<string, any> } | null>(null)
  const [listDragIdx, setListDragIdx] = useState<number | null>(null)
  const [listOverIdx, setListOverIdx] = useState<number | null>(null)
  const [drawRgba, setDrawRgba]         = useState(packRgba(0xffffff, 255))
  const [drawThickness, setDrawThickness] = useState(1)
  const [boxSelect, setBoxSelect]     = useState<{x0:number;y0:number;x1:number;y1:number} | null>(null)
  const [importOpen, setImportOpen]   = useState(false)
  const [importText, setImportText]   = useState('')

  const svgRef            = useRef<SVGSVGElement>(null)
  const textareaRef       = useRef<HTMLTextAreaElement>(null)
  const dragRef           = useRef<DragInfo | null>(null)
  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const childDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawAnchorRef     = useRef<[number, number] | null>(null)
  const pendingCaptureRef = useRef<number | null>(null)
  const polyPointsRef     = useRef<[number, number][]>([])
  const rawPointsRef      = useRef<[number, number][]>([])

  const [drawMode, setDrawMode]       = useState<DrawMode | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<[number, number] | null>(null)
  const [, setPolyTick]               = useState(0)

  const jsonLen = JSON.stringify(activeScene).length
  const atCap   = activeScene.length >= 512 || jsonLen > JSON_CAP - 100

  useEffect(() => {
    if (fontReady) return
    loadMinecraftFont('assets/').then(ok => { if (ok) setFontReady(true) })
  }, [fontReady])

  // Sync editObj when top-level selection changes.
  // If a child is already selected (selectedChildId set), don't override editObj — the child
  // click handler owns it. Including selectedChildId in deps so the effect re-evaluates when
  // the child is cleared (e.g. "Back to group" button).
  useEffect(() => {
    if (selectedIds.length !== 1) { setEditObj(null); setSelectedChildId(null); return }
    if (selectedChildId) return   // child click handler already set editObj correctly
    const found = activeScene.find(o => o.id === selectedIds[0])
    if (found) setEditObj(found)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectedChildId])

  // Auto-focus textarea after a fresh text object is placed
  useEffect(() => {
    if (!editObj || editObj.type !== 'text') return
    if (!activeScene.some(o => o.id === editObj.id)) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editObj?.id])

  // Subscribe to canvas updates when the Live tab is open; unsubscribe otherwise.
  // The server sends a canvasUpdate immediately on subscribe so liveObjects populates.
  useEffect(() => {
    if (open && editorMode === 'live') {
      wsSend?.({ type: 'subscribeCanvas', computerId, subscribe: true } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      return () => { wsSend?.({ type: 'subscribeCanvas', computerId, subscribe: false } as any) } // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    wsSend?.({ type: 'subscribeCanvas', computerId, subscribe: false } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
  }, [open, editorMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      dragRef.current = null; setOverrides([]); setBoxSelect(null); setChildOverride(null)
      drawAnchorRef.current = null; rawPointsRef.current = []; setDrawCurrent(null); setDrawMode(null)
      polyPointsRef.current = []; setPolyTick(0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && drawMode === 'poly' && polyPointsRef.current.length >= 3) {
        e.preventDefault()
        const pts = [...polyPointsRef.current]
        polyPointsRef.current = []; setPolyTick(t => t + 1); setDrawCurrent(null)
        commitPolygon(pts); return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && editorMode === 'draft') {
        e.preventDefault(); undo(); return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && editorMode === 'draft') {
        e.preventDefault(); redo(); return
      }
      if (e.key !== 'Escape') return
      if (drawAnchorRef.current || drawMode || polyPointsRef.current.length > 0) {
        drawAnchorRef.current = null; rawPointsRef.current = []
        polyPointsRef.current = []; setPolyTick(t => t + 1)
        setDrawCurrent(null); setDrawMode(null)
      } else { setOpen(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, drawMode, editorMode, undo, redo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── WS helpers ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendOp = (op: string, extra: Record<string, any> = {}) =>
    wsSend?.({ type: 'glassesSceneOp', computerId, op, ...extra } as any)

  const sendUpdateDebounced = (id: string, props: Partial<GlassesObject>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => sendOp('update', { objectId: id, object: props }), 250)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendChildUpdateDebounced = (groupId: string, childId: string, delta: Record<string, any>) => {
    if (childDebounceRef.current) clearTimeout(childDebounceRef.current)
    childDebounceRef.current = setTimeout(() => sendOp('groupChildUpdate', { groupId, childId, delta }), 250)
  }

  // ─── Unified scene operations ──────────────────────────────────────────────

  const activeAdd = (obj: GlassesObject) => {
    if (editorMode === 'live') { sendOp('add', { object: obj }) }
    else { draftPushHistory(); setDraftScene(s => [...s, obj]) }
    setSelectedIds([obj.id]); setEditObj(obj)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeUpdate = (id: string, props: Record<string, any>, debounce = false) => {
    if (editorMode === 'live') {
      if (debounce) sendUpdateDebounced(id, props as Partial<GlassesObject>)
      else sendOp('update', { objectId: id, object: props })
    } else {
      setDraftScene(s => s.map(o => o.id === id ? { ...o, ...props } as GlassesObject : o))
    }
  }

  const activeRemove = (id: string) => {
    if (editorMode === 'live') sendOp('remove', { objectId: id })
    else { draftPushHistory(); setDraftScene(s => s.filter(o => o.id !== id)) }
    setSelectedIds(ids => ids.filter(i => i !== id))
    if (editObj?.id === id) setEditObj(null)
  }

  const activeClear = () => {
    if (editorMode === 'live') sendOp('clear')
    else { draftPushHistory(); setDraftScene([]) }
    setSelectedIds([]); setEditObj(null)
  }

  const activeReorder = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= activeScene.length) return
    if (editorMode === 'live') { sendOp('reorder', { fromIdx, toIdx }) }
    else { draftPushHistory(); setDraftScene(s => { const n = [...s]; const [item] = n.splice(fromIdx, 1); n.splice(toIdx, 0, item); return n }) }
  }

  // ─── Toolbar actions ───────────────────────────────────────────────────────

  const toggleDraw = (mode: DrawMode) => {
    drawAnchorRef.current = null; rawPointsRef.current = []
    polyPointsRef.current = []; setPolyTick(t => t + 1); setDrawCurrent(null)
    setDrawMode(prev => prev === mode ? null : mode)
  }

  const handleClearGlasses = () => { activeClear(); invokeCommand(computerId, 'glassesClear') }

  const handlePublishToLive = () => {
    wsSend?.({ type: 'setGlassesScene', computerId, scene: draftScene } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    invokeCommand(computerId, 'glassesSetCanvas', [JSON.stringify(draftScene)])
  }

  const handleExport = () => {
    navigator.clipboard.writeText(JSON.stringify(activeScene, null, 2))
  }

  const handleImportConfirm = () => {
    try {
      const parsed = JSON.parse(importText)
      if (!Array.isArray(parsed)) return
      if (editorMode === 'live') {
        wsSend?.({ type: 'setGlassesScene', computerId, scene: parsed } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      } else {
        draftPushHistory(); setDraftScene(parsed)
      }
    } catch { /* invalid JSON */ }
    setImportOpen(false); setImportText('')
  }

  // ─── Group / ungroup ──────────────────────────────────────────────────────

  const handleGroup = () => {
    if (selectedIds.length < 2) return
    const selected = activeScene.filter(o => selectedIds.includes(o.id))
    const bounds = selected.map(objBounds)
    const minX = Math.min(...bounds.map(b => b[0]))
    const minY = Math.min(...bounds.map(b => b[1]))

    const children: GlassesObject[] = selected.map(obj => {
      if (obj.type === 'line')    return { ...obj, x1: obj.x1-minX, y1: obj.y1-minY, x2: obj.x2-minX, y2: obj.y2-minY }
      if (obj.type === 'polygon' || obj.type === 'lines') return { ...obj, points: obj.points.map(([x,y]) => [x-minX, y-minY] as [number,number]) }
      if ('x' in obj && 'y' in obj) return { ...obj, x: (obj as any).x-minX, y: (obj as any).y-minY } as GlassesObject // eslint-disable-line @typescript-eslint/no-explicit-any
      return obj
    })

    const group: GlassesGroup = { id: uid(), type: 'group', x: minX, y: minY, children }
    if (editorMode === 'draft') {
      draftPushHistory()
      setDraftScene(s => [...s.filter(o => !selectedIds.includes(o.id)), group])
    } else {
      sendOp('group', { objectIds: selectedIds, groupObject: group })
    }
    setSelectedIds([group.id])
  }

  const handleUngroup = () => {
    if (selectedIds.length !== 1) return
    const group = activeScene.find(o => o.id === selectedIds[0])
    if (!group || group.type !== 'group') return
    const g = group as GlassesGroup

    const ungrouped: GlassesObject[] = g.children.map(child => {
      const newId = uid()
      if (child.type === 'line')    return { ...child, id: newId, x1: child.x1+g.x, y1: child.y1+g.y, x2: child.x2+g.x, y2: child.y2+g.y }
      if (child.type === 'polygon' || child.type === 'lines') return { ...child, id: newId, points: child.points.map(([x,y]) => [x+g.x, y+g.y] as [number,number]) }
      // All remaining types (rect, text, dot, item, group) have x/y
      return { ...child, id: newId, x: (child as any).x+g.x, y: (child as any).y+g.y } as GlassesObject // eslint-disable-line @typescript-eslint/no-explicit-any
    })

    if (editorMode === 'draft') {
      draftPushHistory()
      setDraftScene(s => { const idx = s.findIndex(o => o.id === g.id); const n = [...s]; n.splice(idx, 1, ...ungrouped); return n })
    } else {
      sendOp('ungroup', { objectId: g.id })
    }
    setSelectedChildId(null)
    setSelectedIds(ungrouped.map(o => o.id))
  }

  const handleRemoveFromGroup = (groupId: string, childId: string) => {
    const group = activeScene.find(o => o.id === groupId) as GlassesGroup | undefined
    if (!group || group.type !== 'group') return
    const child = group.children.find(c => c.id === childId)
    if (!child) return

    // Convert child's relative coords to absolute so it lands in the right place
    let extracted: GlassesObject
    if (child.type === 'line') {
      extracted = { ...child, x1: child.x1+group.x, y1: child.y1+group.y, x2: child.x2+group.x, y2: child.y2+group.y }
    } else if (child.type === 'polygon' || child.type === 'lines') {
      extracted = { ...child, points: child.points.map(([x,y]) => [x+group.x, y+group.y] as [number,number]) }
    } else {
      extracted = { ...child, x: (child as any).x+group.x, y: (child as any).y+group.y } as GlassesObject // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    const newChildren = group.children.filter(c => c.id !== childId)

    if (editorMode === 'draft') {
      draftPushHistory()
      if (newChildren.length === 0) {
        // Group now empty — replace it with the extracted child in the same z-slot
        setDraftScene(s => s.map(o => o.id === groupId ? extracted : o))
      } else {
        setDraftScene(s => [...s.map(o => o.id === groupId ? { ...group, children: newChildren } : o), extracted])
      }
    } else {
      if (newChildren.length === 0) sendOp('remove', { objectId: groupId })
      else activeUpdate(groupId, { children: newChildren })
      sendOp('add', { object: extracted })
    }

    setSelectedChildId(null)
    setEditObj(extracted)
    setSelectedIds([extracted.id])
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleGroupChildUpdate = (groupId: string, childId: string, delta: Record<string, any>) => {
    if (editorMode === 'draft') {
      setDraftScene(s => s.map(o => {
        if (o.id !== groupId || o.type !== 'group') return o
        const g = o as GlassesGroup
        return { ...g, children: g.children.map(c => c.id === childId ? { ...c, ...delta } as GlassesObject : c) }
      }))
    } else {
      sendOp('groupChildUpdate', { groupId, childId, delta })
    }
  }

  // ─── Commit helpers ────────────────────────────────────────────────────────

  const commitPolygon = (pts: [number, number][]) => {
    if (pts.length < 3) return
    const obj: GlassesPolygon = { id: uid(), type: 'polygon', points: pts, rgba: drawRgba }
    if (!atCap) activeAdd(obj)
    setDrawMode(null)
  }

  const commitItem = (x: number, y: number) => {
    const obj: GlassesItem = { id: uid(), type: 'item', x, y, item: 'minecraft:stone', damage: 0, scale: 1, alpha: alphaOfRgba(drawRgba) }
    if (!atCap) activeAdd(obj)
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
    if ('id' in info && e.shiftKey) {
      // Shift-click: toggle in selection, don't start drag
      setSelectedIds(prev => prev.includes(info.id) ? prev.filter(i => i !== info.id) : [...prev, info.id])
      return
    }
    pendingCaptureRef.current = e.pointerId

    // Multi-move: clicking a selected object when multiple are selected
    if (info.kind === 'move' && selectedIds.length > 1 && selectedIds.includes(info.id)) {
      const [mx0, my0] = toSvg(e)
      const anchors = activeScene.filter(o => selectedIds.includes(o.id)).map(o => {
        if (o.type === 'line')    return { id: o.id, ox: o.x1, oy: o.y1 }
        if (o.type === 'polygon' || o.type === 'lines') return { id: o.id, ox: 0, oy: 0, origPoints: o.points }
        // All remaining types (rect, text, dot, item, group) have x/y
        return { id: o.id, ox: (o as any).x as number, oy: (o as any).y as number } // eslint-disable-line @typescript-eslint/no-explicit-any
      })
      dragRef.current = { kind: 'multi-move', anchors, mx0, my0 }
      return
    }

    dragRef.current = info
    if ('id' in info) setSelectedIds([info.id])
  }

  const handleSvgPointerMove = (e: React.PointerEvent) => {
    if (pendingCaptureRef.current !== null) {
      svgRef.current?.setPointerCapture(pendingCaptureRef.current)
      pendingCaptureRef.current = null
    }

    // Box select drag
    if (boxSelect) {
      const [mx, my] = toSvg(e)
      setBoxSelect(b => b ? { ...b, x1: Math.round(mx), y1: Math.round(my) } : null)
      return
    }

    if (drawMode === 'poly' && polyPointsRef.current.length > 0) {
      const [mx, my] = toSvg(e); setDrawCurrent([Math.round(mx), Math.round(my)]); return
    }
    if (drawMode === 'item') {
      const [mx, my] = toSvg(e); setDrawCurrent([Math.round(mx), Math.round(my)])
    }

    if (drawAnchorRef.current) {
      const [mx, my] = toSvg(e)
      if (drawMode === 'lines') {
        const last = rawPointsRef.current[rawPointsRef.current.length - 1]
        if (last) { const dx = Math.round(mx) - last[0], dy = Math.round(my) - last[1]; if (dx*dx+dy*dy >= 4) rawPointsRef.current.push([Math.round(mx), Math.round(my)]) }
      }
      setDrawCurrent([Math.round(mx), Math.round(my)]); return
    }

    const d = dragRef.current
    if (!d) return
    const [mx, my] = toSvg(e)
    if (d.kind === 'multi-move') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverrides(d.anchors.map(a => a.origPoints
        ? { id: a.id, props: { points: a.origPoints.map(([px,py]) => [px+dx, py+dy] as [number,number]) } }
        : { id: a.id, props: { x: a.ox+dx, y: a.oy+dy } }
      ))
    } else if (d.kind === 'move') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverrides([{ id: d.id, props: { x: d.ox+dx, y: d.oy+dy } }])
    } else if (d.kind === 'move-pts') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverrides([{ id: d.id, props: { points: d.origPoints.map(([px,py]) => [px+dx, py+dy] as [number,number]) } }])
    } else if (d.kind === 'move-vertex') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverrides([{ id: d.id, props: { points: d.origPts.map((p, i) => i === d.vertIdx ? [p[0]+dx, p[1]+dy] as [number,number] : p) } }])
    } else if (d.kind === 'resize') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      let x = d.ox, y = d.oy, w = d.ow, h = d.oh
      if (d.corner === 'se') { w = Math.max(4, d.ow+dx); h = Math.max(4, d.oh+dy) }
      if (d.corner === 'sw') { x = d.ox+dx; w = Math.max(4, d.ow-dx); h = Math.max(4, d.oh+dy) }
      if (d.corner === 'ne') { w = Math.max(4, d.ow+dx); y = d.oy+dy; h = Math.max(4, d.oh-dy) }
      if (d.corner === 'nw') { x = d.ox+dx; w = Math.max(4, d.ow-dx); y = d.oy+dy; h = Math.max(4, d.oh-dy) }
      setOverrides([{ id: d.id, props: { x, y, w, h } }])
    } else if (d.kind === 'endpoint') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      setOverrides([{ id: d.id, props: d.pt === 1 ? { x1: d.ox+dx, y1: d.oy+dy } : { x2: d.ox+dx, y2: d.oy+dy } }])
    } else if (d.kind === 'move-child') {
      const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)
      const orig = d.origProps
      let newProps: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      if ('x1' in orig) {
        newProps = { x1: (orig.x1 as number)+dx, y1: (orig.y1 as number)+dy, x2: (orig.x2 as number)+dx, y2: (orig.y2 as number)+dy }
      } else if ('points' in orig) {
        newProps = { points: (orig.points as [number,number][]).map(([px,py]) => [px+dx, py+dy] as [number,number]) }
      } else {
        newProps = { x: (orig.x as number)+dx, y: (orig.y as number)+dy }
      }
      setChildOverride({ groupId: d.groupId, childId: d.childId, props: newProps })
    }
  }

  const handleSvgPointerUp = (e: React.PointerEvent) => {
    pendingCaptureRef.current = null

    // Box select finish
    if (boxSelect) {
      const bx0 = Math.min(boxSelect.x0, boxSelect.x1), by0 = Math.min(boxSelect.y0, boxSelect.y1)
      const bx1 = Math.max(boxSelect.x0, boxSelect.x1), by1 = Math.max(boxSelect.y0, boxSelect.y1)
      if (bx1 - bx0 > 4 || by1 - by0 > 4) {
        const ids = activeScene.filter(o => objInBox(o, bx0, by0, bx1, by1)).map(o => o.id)
        setSelectedIds(ids)
      }
      setBoxSelect(null); return
    }

    const anchor = drawAnchorRef.current

    if (anchor && drawMode === 'lines') {
      drawAnchorRef.current = null; setDrawCurrent(null)
      const raw = rawPointsRef.current; rawPointsRef.current = []
      if (raw.length < 2) return
      let tol = 3, simplified = rdpSimplify(raw, tol)
      while (simplified.length > 64 && tol < 200) { tol *= 2; simplified = rdpSimplify(raw, tol) }
      if (simplified.length < 2) return
      const obj: GlassesLines = { id: uid(), type: 'lines', points: simplified, rgba: drawRgba, thickness: drawThickness }
      if (!atCap) activeAdd(obj)
      return
    }

    if (anchor && drawMode && drawMode !== 'poly' && drawMode !== 'item') {
      const [x1, y1] = anchor
      const [x2, y2] = toSvg(e)
      drawAnchorRef.current = null; setDrawCurrent(null)
      let obj: GlassesObject
      if (drawMode === 'rect') {
        obj = { id: uid(), type: 'rect', x: Math.round(Math.min(x1,x2)), y: Math.round(Math.min(y1,y2)), w: Math.max(4, Math.round(Math.abs(x2-x1))), h: Math.max(4, Math.round(Math.abs(y2-y1))), rgba: drawRgba }
      } else if (drawMode === 'text') {
        const h = Math.max(9, Math.abs(y2-y1))
        obj = { id: uid(), type: 'text', x: Math.round(Math.min(x1,x2)), y: Math.round(Math.max(y1,y2)), content: 'Text', rgba: drawRgba, size: Math.max(1, Math.round(h/9)), shadow: false }
      } else {
        obj = { id: uid(), type: 'line', x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), rgba: drawRgba, thickness: drawThickness }
      }
      if (!atCap) activeAdd(obj)
      return
    }

    const d = dragRef.current
    dragRef.current = null

    if (d) {
      if (d.kind === 'multi-move') {
        if (overrides.length > 0) {
          if (editorMode === 'draft') draftPushHistory()
          overrides.forEach(ov => activeUpdate(ov.id, ov.props))
        }
        // In live mode the useEffect clears overrides once the server confirms; clear immediately for draft.
        if (editorMode === 'draft') setOverrides([])
        return
      }

      if (d.kind === 'move-child') {
        if (childOverride) {
          if (editorMode === 'draft') draftPushHistory()
          handleGroupChildUpdate(d.groupId, d.childId, childOverride.props)
          setEditObj(prev => prev && 'id' in prev && prev.id === d.childId ? { ...prev, ...childOverride.props } as GlassesObject : prev)
        }
        // In live mode keep childOverride until the server round-trip confirms the new position.
        if (editorMode === 'draft') setChildOverride(null)
        return
      }

      const ov = overrides.find(o => o.id === (d as any).id) // eslint-disable-line @typescript-eslint/no-explicit-any
      if (ov) {
        if (editorMode === 'draft') draftPushHistory()
        activeUpdate(ov.id, ov.props)
        setEditObj(prev => prev?.id === ov.id ? { ...prev, ...ov.props } as GlassesObject : prev)
      }
      // In live mode keep overrides until the server round-trip confirms the new position.
      if (editorMode === 'draft') setOverrides([])
    }
  }

  // Clear overrides once server confirms (live mode only)
  useEffect(() => {
    if (overrides.length === 0 || editorMode === 'draft') return
    const unconfirmed = overrides.filter(ov => {
      const obj = liveObjects.find(o => o.id === ov.id)
      if (!obj) return false
      return !Object.entries(ov.props).every(([k, v]) => {
        const cur = (obj as any)[k] // eslint-disable-line @typescript-eslint/no-explicit-any
        if (typeof v === 'object' && v !== null) return JSON.stringify(v) === JSON.stringify(cur)
        return cur === v
      })
    })
    setOverrides(unconfirmed)
  }, [liveObjects]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear childOverride once server confirms the child's new position (live mode only)
  useEffect(() => {
    if (!childOverride || editorMode === 'draft') return
    const group = liveObjects.find(o => o.id === childOverride.groupId)
    if (!group || group.type !== 'group') { setChildOverride(null); return }
    const child = (group as GlassesGroup).children.find(c => c.id === childOverride.childId)
    if (!child) { setChildOverride(null); return }
    const confirmed = Object.entries(childOverride.props).every(([k, v]) => {
      const cur = (child as any)[k] // eslint-disable-line @typescript-eslint/no-explicit-any
      if (typeof v === 'object' && v !== null) return JSON.stringify(v) === JSON.stringify(cur)
      return cur === v
    })
    if (confirmed) setChildOverride(null)
  }, [liveObjects]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Object list ───────────────────────────────────────────────────────────

  const handleListDragStart = (e: React.DragEvent, i: number) => { setListDragIdx(i); e.dataTransfer.effectAllowed = 'move' }
  const handleListDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setListOverIdx(i) }
  const handleListDrop      = (e: React.DragEvent, toIdx: number) => { e.preventDefault(); if (listDragIdx !== null && listDragIdx !== toIdx) activeReorder(listDragIdx, toIdx); setListDragIdx(null); setListOverIdx(null) }
  const handleListDragEnd   = () => { setListDragIdx(null); setListOverIdx(null) }

  // ─── Properties ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateProp = (key: string, val: any) => {
    if (!editObj) return
    const updated = { ...editObj, [key]: val } as GlassesObject
    if (selectedChildId && selectedIds.length === 1) {
      setEditObj(updated)
      if (editorMode === 'draft') {
        handleGroupChildUpdate(selectedIds[0], selectedChildId, { [key]: val })
      } else {
        // Draft updates local state immediately; live updates are debounced to avoid flooding
        // the server/Lua with every slider tick.
        sendChildUpdateDebounced(selectedIds[0], selectedChildId, { [key]: val })
      }
    } else {
      if (JSON.stringify(activeScene.map(o => o.id === editObj.id ? updated : o)).length > JSON_CAP) return
      setEditObj(updated)
      activeUpdate(editObj.id, { [key]: val }, true)
    }
  }

  // ─── SVG rendering ─────────────────────────────────────────────────────────

  const resolved = (obj: GlassesObject): GlassesObject => {
    const ov = overrides.find(o => o.id === obj.id)
    return ov ? { ...obj, ...ov.props } as GlassesObject : obj
  }

  const SEL = '#3b82f6'
  const SEL_MULTI = '#22c55e'
  const HR  = 3

  const renderObj = (raw: GlassesObject): React.ReactNode => {
    const obj     = resolved(raw)
    const sel     = selectedIds.includes(obj.id)
    const selCol  = selectedIds.length > 1 ? SEL_MULTI : SEL
    const hasRgba = obj.type !== 'item'
    const opacity = hasRgba ? alphaOfRgba((obj as any).rgba) / 255 : 1 // eslint-disable-line @typescript-eslint/no-explicit-any
    const fill    = hasRgba ? intToHex(rgbOfRgba((obj as any).rgba)) : '#fff' // eslint-disable-line @typescript-eslint/no-explicit-any

    if (obj.type === 'rect') {
      const r = obj as GlassesRect
      return (
        <g key={r.id}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} opacity={opacity}
            style={{ cursor: 'move' }}
            onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move', id: r.id, mx0: mx, my0: my, ox: r.x, oy: r.y }) }} />
          {sel && <>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={selCol} strokeWidth={0.8} style={{ pointerEvents: 'none' }} />
            {(['nw','ne','sw','se'] as const).map(c => {
              const hx = c.includes('e') ? r.x+r.w : r.x
              const hy = c.includes('s') ? r.y+r.h : r.y
              return <rect key={c} x={hx-HR} y={hy-HR} width={HR*2} height={HR*2} fill={selCol}
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
        <MinecraftTextObj key={t.id} t={t} sel={sel} SEL={selCol} fontReady={fontReady}
          onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move', id: t.id, mx0: mx, my0: my, ox: t.x, oy: t.y }) }} />
      )
    }

    if (obj.type === 'line') {
      const l = obj as GlassesLine
      return (
        <g key={l.id}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={fill} strokeWidth={l.thickness} opacity={opacity} vectorEffect="non-scaling-stroke" />
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="transparent" strokeWidth={8}
            style={{ cursor: 'pointer' }}
            onPointerDown={e => { e.stopPropagation(); if (e.shiftKey) setSelectedIds(prev => prev.includes(l.id) ? prev.filter(i=>i!==l.id) : [...prev,l.id]); else setSelectedIds([l.id]) }} />
          {sel && <>
            <circle cx={l.x1} cy={l.y1} r={HR+1} fill={selCol} style={{ cursor: 'move' }}
              onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'endpoint', id: l.id, pt: 1, mx0: mx, my0: my, ox: l.x1, oy: l.y1 }) }} />
            <circle cx={l.x2} cy={l.y2} r={HR+1} fill={selCol} style={{ cursor: 'move' }}
              onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'endpoint', id: l.id, pt: 2, mx0: mx, my0: my, ox: l.x2, oy: l.y2 }) }} />
          </>}
        </g>
      )
    }

    if (obj.type === 'polygon') {
      const p = obj as GlassesPolygon
      const rawPts = p.points
      const outlinePts = rawPts.map(([x,y]) => `${x},${y}`).join(' ')
      const dragHandler = (e: React.PointerEvent) => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move-pts', id: p.id, mx0: mx, my0: my, origPoints: p.points }) }
      return (
        <g key={p.id}>
          <g opacity={opacity} style={{ cursor: 'move' }} onPointerDown={dragHandler}>
            {rawPts.length >= 3 && Array.from({ length: rawPts.length-2 }, (_,i) => (
              <polygon key={i} points={`${rawPts[0][0]},${rawPts[0][1]} ${rawPts[i+1][0]},${rawPts[i+1][1]} ${rawPts[i+2][0]},${rawPts[i+2][1]}`} fill={fill} />
            ))}
          </g>
          {sel && <>
            <polygon points={outlinePts} fill="none" stroke={selCol} strokeWidth={0.8} style={{ pointerEvents: 'none' }} />
            {p.points.map(([x,y],i) => (
              <circle key={i} cx={x} cy={y} r={HR+1} fill={selCol} style={{ cursor: 'move' }}
                onPointerDown={e => { e.stopPropagation(); const [mx,my] = toSvg(e); startDrag(e, { kind: 'move-vertex', id: p.id, vertIdx: i, mx0: mx, my0: my, origPts: p.points }) }} />
            ))}
          </>}
        </g>
      )
    }

    if (obj.type === 'lines') {
      const l = obj as GlassesLines
      const pts = l.points.map(([x,y]) => `${x},${y}`).join(' ')
      return (
        <g key={l.id}>
          {sel && <polyline points={pts} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={l.thickness+4} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />}
          <polyline points={pts} fill="none" stroke={fill} strokeWidth={l.thickness} opacity={opacity} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
          <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(8, l.thickness+4)}
            style={{ cursor: 'move' }}
            onPointerDown={e => { const [mx,my] = toSvg(e); startDrag(e, { kind: 'move-pts', id: l.id, mx0: mx, my0: my, origPoints: l.points }) }} />
          {sel && <>
            <polyline points={pts} fill="none" stroke="white" strokeWidth={1} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
            {l.points.map(([x,y],i) => (
              <circle key={i} cx={x} cy={y} r={HR+1} fill={selCol} style={{ cursor: 'move' }}
                onPointerDown={e => { e.stopPropagation(); const [mx,my] = toSvg(e); startDrag(e, { kind: 'move-vertex', id: l.id, vertIdx: i, mx0: mx, my0: my, origPts: l.points }) }} />
            ))}
          </>}
        </g>
      )
    }

    if (obj.type === 'item') {
      const itm = obj as GlassesItem
      return (
        <ItemObj key={itm.id} obj={itm} sel={sel} SEL={selCol}
          onPointerDown={e => { const [mx,my] = toSvg(e); startDrag(e, { kind: 'move', id: itm.id, mx0: mx, my0: my, ox: itm.x, oy: itm.y }) }} />
      )
    }

    if (obj.type === 'group') {
      const g = obj as GlassesGroup
      const [gx0, gy0, gx1, gy1] = objBounds(g)
      // Apply child position override for drag preview
      const displayChildren = g.children.map(c =>
        childOverride && childOverride.groupId === g.id && childOverride.childId === c.id
          ? { ...c, ...childOverride.props } as GlassesObject
          : c
      )
      const isChildActive = sel && selectedChildId !== null
      const activeChild = isChildActive ? displayChildren.find(c => c.id === selectedChildId) ?? null : null
      const [acx0, acy0, acx1, acy1] = activeChild ? objBounds(activeChild) : [0, 0, 0, 0]
      return (
        <g key={g.id}>
          <g transform={`translate(${g.x},${g.y})`} opacity={(g.alpha ?? 255) / 255}>
            {displayChildren.map((child, i) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const co = alphaOfRgba('rgba' in child ? (child as any).rgba : 255*256) / 255
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const cf = 'rgba' in child ? intToHex(rgbOfRgba((child as any).rgba)) : '#fff'
              if (child.type === 'rect') return <rect key={i} x={child.x} y={child.y} width={child.w} height={child.h} fill={cf} opacity={co} style={{ pointerEvents: 'none' }} />
              if (child.type === 'text') return <text key={i} x={child.x} y={child.y} fill={cf} opacity={co} fontSize={child.size*8} style={{ pointerEvents: 'none', userSelect: 'none' }}>{child.content}</text>
              if (child.type === 'line') return <line key={i} x1={child.x1} y1={child.y1} x2={child.x2} y2={child.y2} stroke={cf} strokeWidth={child.thickness} opacity={co} style={{ pointerEvents: 'none' }} />
              if (child.type === 'polygon') return <polygon key={i} points={child.points.map(([x,y])=>`${x},${y}`).join(' ')} fill={cf} opacity={co} style={{ pointerEvents: 'none' }} />
              if (child.type === 'lines') return <polyline key={i} points={child.points.map(([x,y])=>`${x},${y}`).join(' ')} fill="none" stroke={cf} strokeWidth={child.thickness} opacity={co} style={{ pointerEvents: 'none' }} />
              return null
            })}
          </g>
          {/* Transparent drag hit target for the whole group — suppressed when a child is being edited */}
          {!isChildActive && (
            <rect x={gx0} y={gy0} width={Math.max(4, gx1-gx0)} height={Math.max(4, gy1-gy0)}
              fill="transparent" style={{ cursor: 'move' }}
              onPointerDown={e => { const [mx,my] = toSvg(e); startDrag(e, { kind: 'move', id: g.id, mx0: mx, my0: my, ox: g.x, oy: g.y }) }} />
          )}
          {/* Group selection outline — only when no child is active */}
          {sel && !selectedChildId && <rect x={gx0-1} y={gy0-1} width={gx1-gx0+2} height={gy1-gy0+2}
            fill="none" stroke={selCol} strokeWidth={1} strokeDasharray="5 3" style={{ pointerEvents: 'none' }} />}
          {/* Active child: dashed selection border + transparent drag hit area */}
          {activeChild && (
            <>
              <rect x={acx0+g.x-1} y={acy0+g.y-1} width={Math.max(2, acx1-acx0)+2} height={Math.max(2, acy1-acy0)+2}
                fill="none" stroke={SEL} strokeWidth={0.8} strokeDasharray="4 2" style={{ pointerEvents: 'none' }} />
              <rect x={acx0+g.x-HR} y={acy0+g.y-HR} width={Math.max(8, acx1-acx0+HR*2)} height={Math.max(8, acy1-acy0+HR*2)}
                fill="transparent" style={{ cursor: 'move' }}
                onPointerDown={e => {
                  const [mx, my] = toSvg(e)
                  const origChild = g.children.find(c => c.id === selectedChildId)!
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  let origProps: Record<string, any>
                  if (origChild.type === 'line') origProps = { x1: origChild.x1, y1: origChild.y1, x2: origChild.x2, y2: origChild.y2 }
                  else if (origChild.type === 'polygon' || origChild.type === 'lines') origProps = { points: origChild.points.map(p => [p[0], p[1]] as [number,number]) }
                  else origProps = { x: (origChild as any).x, y: (origChild as any).y } // eslint-disable-line @typescript-eslint/no-explicit-any
                  dragRef.current = { kind: 'move-child', groupId: g.id, childId: selectedChildId!, mx0: mx, my0: my, origProps }
                  pendingCaptureRef.current = e.pointerId
                }} />
            </>
          )}
        </g>
      )
    }

    return null
  }

  // ─── Draw preview ──────────────────────────────────────────────────────────

  const renderDrawPreview = () => {
    const anchor = drawAnchorRef.current
    const ghost: React.CSSProperties = { pointerEvents: 'none', opacity: 0.75 }
    const drawFill = intToHex(rgbOfRgba(drawRgba))

    if (drawMode === 'poly') {
      const pts = polyPointsRef.current
      if (pts.length === 0) return null
      const ptStr = pts.map(([x,y]) => `${x},${y}`).join(' ')
      return (
        <g style={{ pointerEvents: 'none' }}>
          {pts.length >= 3 && <g opacity={0.2}>{Array.from({length: pts.length-2}, (_,i) => <polygon key={i} points={`${pts[0][0]},${pts[0][1]} ${pts[i+1][0]},${pts[i+1][1]} ${pts[i+2][0]},${pts[i+2][1]}`} fill={drawFill} />)}</g>}
          {pts.length >= 2 && <polyline points={ptStr} fill="none" stroke={SEL} strokeWidth={1} strokeDasharray="4 2" />}
          {drawCurrent && <line x1={pts[pts.length-1][0]} y1={pts[pts.length-1][1]} x2={drawCurrent[0]} y2={drawCurrent[1]} stroke={SEL} strokeWidth={1} strokeDasharray="4 2" />}
          {pts.map(([x,y],i) => {
            const isFirst = i === 0
            const canClose = isFirst && pts.length >= 3 && drawCurrent !== null && (drawCurrent[0]-x)**2+(drawCurrent[1]-y)**2 <= 64
            return <circle key={i} cx={x} cy={y} r={canClose ? 5 : (isFirst ? 4 : 2.5)} fill={canClose ? '#22c55e' : (isFirst ? drawFill : SEL)} stroke={canClose ? '#16a34a' : SEL} strokeWidth={0.5} />
          })}
        </g>
      )
    }

    if (drawMode === 'lines' && anchor) {
      const pts = rawPointsRef.current
      if (pts.length < 2) return null
      return <polyline points={pts.map(([x,y]) => `${x},${y}`).join(' ')} fill="none" stroke={drawFill} strokeWidth={1.5} strokeDasharray="4 2" style={ghost} />
    }

    if (drawMode === 'item' && drawCurrent) {
      return <rect x={drawCurrent[0]} y={drawCurrent[1]} width={16} height={16} fill="rgba(255,255,255,0.08)" stroke={SEL} strokeWidth={1} strokeDasharray="3 2" style={ghost} />
    }

    if (!anchor || !drawCurrent || !drawMode) return null
    const [x1, y1] = anchor, [x2, y2] = drawCurrent

    if (drawMode === 'rect') return <rect x={Math.min(x1,x2)} y={Math.min(y1,y2)} width={Math.max(4,Math.abs(x2-x1))} height={Math.max(4,Math.abs(y2-y1))} fill={drawFill} fillOpacity={0.15} stroke={SEL} strokeWidth={1} strokeDasharray="4 2" style={ghost} />
    if (drawMode === 'text') { const fs = Math.max(9, Math.max(1, Math.round(Math.abs(y2-y1)/9))*9); return <text x={Math.min(x1,x2)} y={Math.max(y1,y2)-fs*0.2} fill={drawFill} fontSize={fs} style={ghost}>Text</text> }
    return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={drawFill} strokeWidth={1.5} strokeDasharray="4 2" style={ghost} />
  }

  // ─── Box select preview ────────────────────────────────────────────────────

  const renderBoxSelect = () => {
    if (!boxSelect) return null
    const x = Math.min(boxSelect.x0, boxSelect.x1), y = Math.min(boxSelect.y0, boxSelect.y1)
    const w = Math.abs(boxSelect.x1 - boxSelect.x0), h = Math.abs(boxSelect.y1 - boxSelect.y0)
    return <rect x={x} y={y} width={w} height={h} fill="rgba(59,130,246,0.1)" stroke="#3b82f6" strokeWidth={0.8} strokeDasharray="4 2" style={{ pointerEvents: 'none' }} />
  }

  // ─── Properties panel ──────────────────────────────────────────────────────

  const renderProps = () => {
    // Mass edit when multiple selected
    if (selectedIds.length > 1) {
      const selObjs = activeScene.filter(o => selectedIds.includes(o.id))
      const firstWithRgba = selObjs.find(o => 'rgba' in o) as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const repRgba = firstWithRgba ? firstWithRgba.rgba : packRgba(0xffffff, 255)

      const applyColor = (rgb24: number) => selObjs.filter(o => 'rgba' in o).forEach(o => activeUpdate(o.id, { rgba: packRgba(rgb24, alphaOfRgba((o as any).rgba)) })) // eslint-disable-line @typescript-eslint/no-explicit-any
      const applyAlpha = (alpha: number) => selObjs.filter(o => 'rgba' in o).forEach(o => activeUpdate(o.id, { rgba: packRgba(rgbOfRgba((o as any).rgba), alpha) })) // eslint-disable-line @typescript-eslint/no-explicit-any
      const nudge = (dx: number, dy: number) => selObjs.forEach(o => activeUpdate(o.id, (() => { const n = nudgeObj(o,dx,dy); if (n.type==='line') return {x1:(n as any).x1,y1:(n as any).y1,x2:(n as any).x2,y2:(n as any).y2}; if (n.type==='polygon'||n.type==='lines') return {points:(n as any).points}; return {x:(n as any).x,y:(n as any).y} })())) // eslint-disable-line @typescript-eslint/no-explicit-any

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{selectedIds.length} selected</div>
          {firstWithRgba && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={labelStyle}>
                <span>col</span>
                <input type="color" value={intToHex(rgbOfRgba(repRgba))} style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                  onChange={ev => applyColor(hexToInt(ev.target.value))} />
              </label>
              <NumInput label="α" value={alphaOfRgba(repRgba)} onChange={v => applyAlpha(Math.max(0, Math.min(255, v)))} min={0} max={255} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {([['←',-1,0],['→',1,0],['↑',0,-1],['↓',0,1]] as [string,number,number][]).map(([lbl,dx,dy]) => (
              <button key={lbl} className="btn btn-compact" style={{ padding: '0 6px' }} onClick={() => nudge(dx,dy)}>{lbl}</button>
            ))}
          </div>
        </div>
      )
    }

    if (!editObj) return (
      <div style={{ fontSize: 11, color: 'var(--fg-dim)', lineHeight: 1.6 }}>
        Select an object to edit its properties.
      </div>
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = editObj as any
    const up = (key: string) => (v: number) => updateProp(key, v)

    // Child within a group is selected — show the child's properties with a breadcrumb label.
    if (selectedChildId && selectedIds.length === 1) {
      const parentGroup = activeScene.find(o => o.id === selectedIds[0]) as GlassesGroup | undefined
      const childLabel = parentGroup ? `child of group` : 'child'
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
            {editObj.type} · <span style={{ color: 'var(--fg-mute)' }}>{childLabel} (relative coords)</span>
          </div>
          {'x' in editObj && 'y' in editObj && (
            <div style={{ display: 'flex', gap: 4 }}>
              <NumInput label="x" value={(editObj as any).x} onChange={up('x')} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
              <NumInput label="y" value={(editObj as any).y} onChange={up('y')} /> {/* eslint-disable-line @typescript-eslint/no-explicit-any */}
            </div>
          )}
          {'rgba' in editObj && (() => { // eslint-disable-line @typescript-eslint/no-explicit-any
            const rgba = (editObj as any).rgba as number // eslint-disable-line @typescript-eslint/no-explicit-any
            return (
              <>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <label style={labelStyle}>
                    <span>col</span>
                    <input type="color" value={intToHex(rgbOfRgba(rgba))}
                      style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                      onChange={ev => updateProp('rgba', packRgba(hexToInt(ev.target.value), alphaOfRgba(rgba)))} />
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--fg-dim)', flexShrink: 0 }}>alpha</span>
                  <input type="range" value={alphaOfRgba(rgba)} min={0} max={255} step={1}
                    style={{ flex: 1, accentColor: 'var(--accent)' }}
                    onChange={ev => updateProp('rgba', packRgba(rgbOfRgba(rgba), Number(ev.target.value)))} />
                  <NumInput label="" value={alphaOfRgba(rgba)}
                    onChange={v => updateProp('rgba', packRgba(rgbOfRgba(rgba), Math.max(0, Math.min(255, v|0))))} min={0} max={255} />
                </div>
              </>
            )
          })()}
          {'alpha' in editObj && editObj.type === 'item' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--fg-dim)', flexShrink: 0 }}>alpha</span>
              <input type="range" value={(editObj as any).alpha ?? 255} min={0} max={255} step={1} // eslint-disable-line @typescript-eslint/no-explicit-any
                style={{ flex: 1, accentColor: 'var(--accent)' }}
                onChange={ev => updateProp('alpha', Number(ev.target.value))} />
              <NumInput label="" value={(editObj as any).alpha ?? 255} // eslint-disable-line @typescript-eslint/no-explicit-any
                onChange={v => updateProp('alpha', Math.max(0, Math.min(255, v|0)))} min={0} max={255} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-compact" style={{ fontSize: 10 }}
              onClick={() => { setSelectedChildId(null); if (parentGroup) setEditObj(parentGroup) }}>
              ← Back
            </button>
            <button className="btn btn-compact btn-danger" style={{ fontSize: 10 }}
              onClick={() => { if (parentGroup) handleRemoveFromGroup(parentGroup.id, selectedChildId!) }}>
              Remove from group
            </button>
          </div>
        </div>
      )
    }

    if (editObj.type === 'group') {
      const g = editObj as GlassesGroup
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>group · {g.children.length} children</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <NumInput label="x" value={g.x} onChange={up('x')} />
            <NumInput label="y" value={g.y} onChange={up('y')} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-dim)', flexShrink: 0 }}>alpha</span>
            <input type="range" value={g.alpha ?? 255} min={0} max={255} step={1}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
              onChange={ev => updateProp('alpha', Number(ev.target.value))} />
            <NumInput label="" value={g.alpha ?? 255} onChange={v => updateProp('alpha', Math.max(0, Math.min(255, v|0)))} min={0} max={255} />
          </div>
          <button className="btn btn-compact" onClick={handleUngroup}>Ungroup</button>
        </div>
      )
    }

    if (editObj.type === 'polygon' || editObj.type === 'lines') {
      const pts = (editObj as GlassesPolygon | GlassesLines).points
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{editObj.type} · {pts.length} pts</div>
          <div style={{ maxHeight: 120, overflowY: 'auto', background: 'var(--surface-3)', borderRadius: 2, padding: '2px 4px' }}>
            {pts.map(([x,y],i) => (
              <div key={i} style={{ display: 'flex', gap: 4, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--fg-mute)', minWidth: 18, textAlign: 'right' }}>{i}:</span>
                <span>{x}, {y}</span>
              </div>
            ))}
          </div>
          {editObj.type === 'lines' && <NumInput label="th" value={e.thickness} onChange={v => updateProp('thickness', Math.max(1, v|0))} min={1} />}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={labelStyle}>
              <span>col</span>
              <input type="color" value={intToHex(rgbOfRgba(editObj.rgba))} style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                onChange={ev => updateProp('rgba', packRgba(hexToInt(ev.target.value), alphaOfRgba(editObj.rgba)))} />
            </label>
            <NumInput label="α" value={alphaOfRgba(editObj.rgba)} onChange={v => updateProp('rgba', packRgba(rgbOfRgba(editObj.rgba), Math.max(0, Math.min(255, v))))} min={0} max={255} />
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
            <input type="text" style={{ ...inputStyle, width: 130 }} value={itm.item} placeholder="minecraft:stone"
              onChange={ev => updateProp('item', ev.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <NumInput label="dmg" value={itm.damage} onChange={v => updateProp('damage', Math.max(0, v|0))} min={0} />
            <NumInput label="sc" value={itm.scale} onChange={v => updateProp('scale', Math.max(0.1, v))} min={0.1} />
          </div>
          <NumInput label="α" value={itm.alpha} onChange={v => updateProp('alpha', Math.max(0, Math.min(255, v|0)))} min={0} max={255} />
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
        {editObj.type === 'rect' && <div style={{ display: 'flex', gap: 4 }}><NumInput label="w" value={e.w} onChange={up('w')} min={1} /><NumInput label="h" value={e.h} onChange={up('h')} min={1} /></div>}
        {(editObj.type === 'text' || editObj.type === 'dot') && <NumInput label="sz" value={e.size} onChange={up('size')} min={0} />}
        {editObj.type === 'line' && <NumInput label="th" value={e.thickness} onChange={up('thickness')} min={1} />}
        {editObj.type === 'text' && (
          <>
            <textarea ref={textareaRef}
              style={{ width: '100%', background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '3px 5px', fontSize: 11, resize: 'vertical', minHeight: 44, fontFamily: 'var(--font-mono)' }}
              value={(editObj as GlassesText).content}
              onChange={ev => updateProp('content', ev.target.value)} />
            <label style={{ ...labelStyle, gap: 6 }}>
              <input type="checkbox" checked={(editObj as GlassesText).shadow} onChange={ev => updateProp('shadow', ev.target.checked)} />
              shadow
            </label>
          </>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={labelStyle}>
            <span>col</span>
            <input type="color" value={intToHex(rgbOfRgba(editObj.rgba))} style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              onChange={ev => updateProp('rgba', packRgba(hexToInt(ev.target.value), alphaOfRgba(editObj.rgba)))} />
          </label>
          <NumInput label="α" value={alphaOfRgba(editObj.rgba)} onChange={v => updateProp('rgba', packRgba(rgbOfRgba(editObj.rgba), Math.max(0, Math.min(255, v))))} min={0} max={255} />
        </div>
      </div>
    )
  }

  // ─── Compact trigger ───────────────────────────────────────────────────────

  const liveJsonLen = JSON.stringify(liveObjects).length
  const meterColor = liveJsonLen > JSON_CAP * 0.94 ? 'var(--red)' : liveJsonLen > JSON_CAP * 0.75 ? '#f5a623' : 'var(--fg-dim)'
  const trigger = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>
        {liveObjects.length === 0
          ? 'No objects in scene.'
          : <>{liveObjects.length} object{liveObjects.length !== 1 ? 's' : ''} · <span style={{ color: meterColor }}>{liveJsonLen.toLocaleString()}/{JSON_CAP.toLocaleString()} chars</span></>}
      </span>
      <button className="btn btn-compact" onClick={() => setOpen(true)}>Open Editor</button>
    </div>
  )

  // ─── Import modal ──────────────────────────────────────────────────────────

  const importModal = importOpen && typeof document !== 'undefined' && createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 440, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Import Scene JSON</div>
        <textarea value={importText} onChange={e => setImportText(e.target.value)}
          style={{ width: '100%', height: 200, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '4px 6px', fontSize: 11, fontFamily: 'var(--font-mono)', resize: 'vertical', boxSizing: 'border-box' }}
          placeholder="Paste JSON array here…" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-compact" onClick={() => { setImportOpen(false); setImportText('') }}>Cancel</button>
          <button className="btn btn-compact btn-primary" onClick={handleImportConfirm}>Import</button>
        </div>
      </div>
    </div>,
    document.body
  )

  // ─── Main modal ────────────────────────────────────────────────────────────

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

          {/* Mode tabs */}
          <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 2px' }} />
          {(['live', 'draft'] as const).map(m => (
            <button key={m} className="btn btn-compact"
              style={editorMode === m ? { background: 'var(--accent)', color: 'var(--bg, #fff)' } : undefined}
              onClick={() => setEditorMode(m)}>
              {m === 'live' ? '● Live' : '✎ Draft'}
            </button>
          ))}

          <span style={{ flex: 1 }} />

          {/* === Draw Tools group (blue) === */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(59,130,246,0.5)', background: '#1c2d40' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Color / alpha for new objects">
              <input type="color" value={intToHex(rgbOfRgba(drawRgba))} style={{ width: 26, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                onChange={ev => setDrawRgba(packRgba(hexToInt(ev.target.value), alphaOfRgba(drawRgba)))} />
              <input type="range" value={alphaOfRgba(drawRgba)} min={0} max={255} step={1}
                style={{ width: 56, accentColor: 'var(--accent)', flexShrink: 0 }}
                onChange={ev => setDrawRgba(packRgba(rgbOfRgba(drawRgba), Number(ev.target.value)))} />
              <input type="number" className="glasses-toolbar-num" value={alphaOfRgba(drawRgba)} min={0} max={255} step={1} title="Alpha for new objects"
                style={{ width: 40, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: 11 }}
                onChange={ev => { const v = Number(ev.target.value); if (!isNaN(v)) setDrawRgba(packRgba(rgbOfRgba(drawRgba), Math.max(0, Math.min(255, v)))) }} />
            </label>
            <span style={{ width: 1, background: 'rgba(59,130,246,0.5)', alignSelf: 'stretch', margin: '0 1px' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Thickness for new line/drawing objects">
              <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>th</span>
              <input type="number" className="glasses-toolbar-num" value={drawThickness} min={1} step={1}
                style={{ width: 38, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: 11 }}
                onChange={ev => { const v = Number(ev.target.value); if (!isNaN(v)) setDrawThickness(Math.max(1, v|0)) }} />
            </label>
            <span style={{ width: 1, background: 'rgba(59,130,246,0.5)', alignSelf: 'stretch', margin: '0 1px' }} />
            {DRAW_TOOLS.map(({ mode, label }) => (
              <button key={mode} className="btn btn-compact"
                style={drawMode === mode ? { background: 'var(--accent)', color: 'var(--bg, #fff)' } : undefined}
                title={mode === 'poly' ? 'Click vertices; click first (green) to close; Enter closes; Esc cancels' : mode === 'lines' ? 'Click+drag freehand stroke' : mode === 'item' ? 'Click to place item' : `Draw ${label}`}
                onClick={() => toggleDraw(mode)} disabled={atCap}>
                + {label}
              </button>
            ))}
          </div>

          {/* === Group / Ungroup — visible in both modes when relevant === */}
          {(selectedIds.length >= 2 || (selectedIds.length === 1 && activeScene.find(o => o.id === selectedIds[0])?.type === 'group')) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(139,92,246,0.5)', background: '#221b38' }}>
              {selectedIds.length >= 2 && <button className="btn btn-compact" onClick={handleGroup}>Group</button>}
              {selectedIds.length === 1 && activeScene.find(o => o.id === selectedIds[0])?.type === 'group' && (
                <button className="btn btn-compact" onClick={handleUngroup}>Ungroup</button>
              )}
            </div>
          )}

          {/* === History + Publish (purple, draft only) === */}
          {editorMode === 'draft' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(139,92,246,0.5)', background: '#221b38' }}>
              <button className="btn btn-compact" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">↩ Undo</button>
              <button className="btn btn-compact" onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)">↪ Redo</button>
              <span style={{ width: 1, background: 'rgba(139,92,246,0.5)', alignSelf: 'stretch', margin: '0 1px' }} />
              <button className="btn btn-compact btn-primary" onClick={handlePublishToLive}>Publish →</button>
            </div>
          )}

          {/* === Export / Import group (teal) === */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(20,184,166,0.5)', background: '#132a26' }}>
            <button className="btn btn-compact" onClick={handleExport} title="Copy scene JSON to clipboard">Export</button>
            <button className="btn btn-compact" onClick={() => setImportOpen(true)}>Import</button>
            <span style={{ width: 1, background: 'rgba(20,184,166,0.5)', alignSelf: 'stretch', margin: '0 1px' }} />
            <button className="btn btn-compact btn-danger" onClick={handleClearGlasses}>Clear Glasses</button>
          </div>

          <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 2px' }} />
          <button className="btn btn-compact" onClick={() => setOpen(false)} title="Close (Esc)">✕</button>
        </div>

        {/* Draft/Live info bar */}
        {editorMode === 'draft' && (
          <div style={{ background: 'rgba(99,102,241,0.12)', borderBottom: '1px solid var(--line)', padding: '3px 12px', fontSize: 10, color: 'var(--fg-mute)', display: 'flex', gap: 12 }}>
            <span>Draft mode — changes are local only. "Publish →" to send to glasses.</span>
            <span style={{ color: jsonLen > JSON_CAP * 0.94 ? 'var(--red)' : jsonLen > JSON_CAP * 0.75 ? '#f5a623' : 'var(--fg-dim)' }}>
              {draftScene.length} obj · {jsonLen.toLocaleString()}/{JSON_CAP.toLocaleString()} chars
            </span>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>

          {/* SVG Viewport */}
          <div style={{ flex: 1, background: '#0e0e0e', overflow: 'hidden' }}>
            <svg ref={svgRef} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              preserveAspectRatio="xMidYMid meet" width="100%" height="100%"
              style={{ display: 'block', cursor: drawMode ? 'crosshair' : 'default' }}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={handleSvgPointerUp}>

              {/* Canvas fill — click-to-deselect + start box-select */}
              <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#111"
                onPointerDown={e => {
                  if (drawMode) return
                  const [mx, my] = toSvg(e)
                  if (!e.shiftKey) setSelectedIds([])
                  svgRef.current?.setPointerCapture(e.pointerId)
                  setBoxSelect({ x0: Math.round(mx), y0: Math.round(my), x1: Math.round(mx), y1: Math.round(my) })
                }} />

              {activeScene.map(renderObj)}
              {renderDrawPreview()}
              {renderBoxSelect()}

              {/* Draw overlay intercepts pointer events when tool is armed */}
              {drawMode && (
                <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="transparent"
                  style={{ cursor: 'crosshair' }}
                  onPointerDown={e => {
                    const [mx, my] = toSvg(e)
                    const pt: [number, number] = [Math.round(mx), Math.round(my)]
                    if (drawMode === 'poly') {
                      const pts = polyPointsRef.current
                      if (pts.length >= 3) {
                        const [fx, fy] = pts[0]; const dx = pt[0]-fx, dy = pt[1]-fy
                        if (dx*dx+dy*dy <= 64) { polyPointsRef.current = []; setPolyTick(t=>t+1); setDrawCurrent(null); commitPolygon(pts); return }
                      }
                      if (pts.length < 32) { polyPointsRef.current = [...pts, pt]; setPolyTick(t=>t+1) }
                      return
                    }
                    if (drawMode === 'item') { if (e.detail >= 2) return; commitItem(pt[0], pt[1]); return }
                    svgRef.current?.setPointerCapture(e.pointerId)
                    drawAnchorRef.current = pt
                    if (drawMode === 'lines') rawPointsRef.current = [pt]
                    setDrawCurrent(pt)
                  }} />
              )}

              <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} style={{ pointerEvents: 'none' }} />
            </svg>
          </div>

          {/* Sidebar */}
          <div style={{ width: 230, flexShrink: 0, borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Object list */}
            <div style={{ borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              <div style={{ background: 'var(--surface-3)', borderBottom: '1px solid var(--line)', padding: '5px 10px', fontSize: 10, color: 'var(--fg-mute)', textTransform: 'uppercase', letterSpacing: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Objects ({activeScene.length})</span>
                <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 9, fontFamily: 'var(--font-mono)', color: jsonLen > JSON_CAP*0.94 ? 'var(--red)' : jsonLen > JSON_CAP*0.75 ? '#f5a623' : 'var(--fg-dim)' }}>
                  {jsonLen.toLocaleString()}/{JSON_CAP.toLocaleString()}
                </span>
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', background: 'var(--surface-2)' }}>
                {activeScene.length === 0
                  ? <div style={{ fontSize: 11, color: 'var(--fg-dim)', padding: 10, textAlign: 'center' }}>Use + buttons above to add objects.</div>
                  : activeScene.map((obj, i) => {
                    const isSelected = selectedIds.includes(obj.id)
                    const objLabel = (o: GlassesObject) =>
                      o.type === 'text'    ? `text "${(o as GlassesText).content.slice(0, 10)}"` :
                      o.type === 'item'    ? `item ${(o as GlassesItem).item.split(':')[1] ?? ''}` :
                      o.type === 'lines'   ? `lines (${(o as GlassesLines).points.length}pts)` :
                      o.type === 'polygon' ? `poly (${(o as GlassesPolygon).points.length}pts)` :
                      o.type === 'group'   ? `group (${(o as GlassesGroup).children.length})` :
                      o.type
                    return (
                      <div key={obj.id}>
                        {/* Top-level object row */}
                        <div draggable
                          onDragStart={e => handleListDragStart(e, i)}
                          onDragOver={e => handleListDragOver(e, i)}
                          onDrop={e => handleListDrop(e, i)}
                          onDragEnd={handleListDragEnd}
                          style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 6px', cursor: 'pointer',
                            background: listDragIdx === i ? 'var(--surface-3)' : isSelected ? 'var(--accent-soft)' : 'transparent',
                            borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                            borderTop: listOverIdx === i && listDragIdx !== i ? '2px solid var(--accent)' : '2px solid transparent',
                            opacity: listDragIdx === i ? 0.4 : 1,
                          }}
                          onClick={e => {
                            setSelectedChildId(null)
                            if (e.shiftKey) setSelectedIds(prev => prev.includes(obj.id) ? prev.filter(id=>id!==obj.id) : [...prev, obj.id])
                            else setSelectedIds([obj.id])
                          }}>
                          <span style={{ color: 'var(--fg-dim)', fontSize: 10, cursor: 'grab', padding: '0 2px', userSelect: 'none' }}>⠿</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: isSelected && !selectedChildId ? 'var(--accent)' : 'var(--fg)' }}>
                            {objLabel(obj)}
                          </span>
                          <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20 }}
                            onClick={ev => { ev.stopPropagation(); activeReorder(i, i-1) }} disabled={i === 0}>↑</button>
                          <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20 }}
                            onClick={ev => { ev.stopPropagation(); activeReorder(i, i+1) }} disabled={i === activeScene.length-1}>↓</button>
                          <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 20, color: 'var(--red)' }}
                            onClick={ev => { ev.stopPropagation(); activeRemove(obj.id) }}>×</button>
                        </div>

                        {/* Group children sub-rows */}
                        {obj.type === 'group' && (obj as GlassesGroup).children.map(child => {
                          const isChildSelected = isSelected && selectedChildId === child.id
                          // Detect custom transparency: child has own alpha overriding the group factor
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const childAlpha = 'rgba' in child ? alphaOfRgba((child as any).rgba) : child.type === 'item' ? ((child as any).alpha ?? 255) : 255 // eslint-disable-line @typescript-eslint/no-explicit-any
                          const hasCustomAlpha = childAlpha < 255
                          return (
                            <div key={child.id}
                              style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px 6px 2px 22px', cursor: 'pointer',
                                background: isChildSelected ? 'var(--accent-soft)' : 'rgba(0,0,0,0.12)',
                                borderLeft: isChildSelected ? '2px solid var(--accent)' : '2px solid transparent',
                              }}
                              onClick={ev => {
                                ev.stopPropagation()
                                setSelectedIds([obj.id])
                                setSelectedChildId(child.id)
                                setEditObj(child)
                              }}>
                              <span style={{ color: 'var(--fg-mute)', fontSize: 9, padding: '0 2px', userSelect: 'none' }}>└</span>
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10,
                                color: isChildSelected ? 'var(--accent)' : 'var(--fg-dim)' }}>
                                {objLabel(child)}
                              </span>
                              {hasCustomAlpha && (
                                <span title={`Custom alpha: ${childAlpha} (overrides group transparency)`}
                                  style={{ fontSize: 8, color: '#f5a623', padding: '0 2px', flexShrink: 0, userSelect: 'none' }}>
                                  α{childAlpha}
                                </span>
                              )}
                              <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 18, color: 'var(--red)' }}
                                onClick={ev => { ev.stopPropagation(); handleRemoveFromGroup(obj.id, child.id) }}>×</button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })
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
              <b style={{ color: 'var(--fg-mute)' }}>Color/α</b> — color + alpha for new objects (slider or number).<br />
              <b style={{ color: 'var(--fg-mute)' }}>Click</b> to select · <b style={{ color: 'var(--fg-mute)' }}>Shift+click</b> adds to selection.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Drag background</b> — box select.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Multi-drag</b> — drag any selected obj to move all.<br />
              <b style={{ color: 'var(--fg-mute)' }}>Draft</b> — local edits; Ctrl+Z/Y to undo/redo; Publish to send.
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
      {importModal}
    </>
  )
}
