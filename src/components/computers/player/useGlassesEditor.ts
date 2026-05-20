'use client'

// All editor state and logic for the glasses canvas editor.
// Handles live/draft mode, undo/redo history, selection, drag, box-select,
// pen drawing (with RDP simplification), and server op dispatch.
// Returns an EditorState object consumed by GlassesEditorLayout and its sub-panels.
import { useRef, useEffect, useCallback } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore, useEditorStateStore } from '@/store/useWorldView'
import type { GlassesObject, GlassesPolygon, GlassesLines, GlassesGroup, GlassesItem } from '@/types/glasses'
import { loadMinecraftFont } from '@/utils/minecraftFont'
import {
  DrawMode, BoxSelect, DragInfo, Override, ChildOverride,
  EditorMutableState, DEFAULT_EDITOR_MUTABLE,
  JSON_CAP, HISTORY_CAP, alphaOfRgba,
  objBounds,
} from './glassesEditorTypes'

const EMPTY_SCENE: GlassesObject[] = []
const uid = () => Math.random().toString(36).slice(2, 11)

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

function objInBox(obj: GlassesObject, bx0: number, by0: number, bx1: number, by1: number): boolean {
  const [ox0, oy0, ox1, oy1] = objBounds(obj)
  return ox0 < bx1 && ox1 > bx0 && oy0 < by1 && oy1 > by0
}

export interface EditorState {
  computerId: number

  // Scene data
  liveObjects: GlassesObject[]
  activeScene: GlassesObject[]
  atCap: boolean
  jsonLen: number
  liveJsonLen: number

  // Editor mode
  editorMode: 'live' | 'draft'
  setEditorMode: (m: 'live' | 'draft') => void
  open: boolean
  setOpen: (v: boolean) => void

  // Font
  fontReady: boolean

  // Draft history
  draftScene: GlassesObject[]
  undoStack: GlassesObject[][]
  redoStack: GlassesObject[][]
  undo: () => void
  redo: () => void

  // Selection
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  selectedChildId: string | null
  setSelectedChildId: (id: string | null) => void
  editObj: GlassesObject | null
  setEditObj: (obj: GlassesObject | null) => void
  selectChild: (parentId: string, child: GlassesObject) => void

  // Draw tools
  drawMode: DrawMode | null
  setDrawMode: (m: DrawMode | null) => void
  drawCurrent: [number, number] | null
  setDrawCurrent: (v: [number, number] | null) => void
  drawRgba: number
  setDrawRgba: (v: number) => void
  drawThickness: number
  setDrawThickness: (v: number) => void
  toggleDraw: (mode: DrawMode) => void
  commitPolygon: (pts: [number, number][]) => void
  commitItem: (x: number, y: number) => void

  // Box select
  boxSelect: BoxSelect | null
  setBoxSelect: (v: BoxSelect | null) => void

  // Drag overrides (optimistic position during drag)
  overrides: Override[]
  childOverride: ChildOverride

  // Object list reordering
  listDragIdx: number | null
  listOverIdx: number | null
  handleListDragStart: (e: React.DragEvent, i: number) => void
  handleListDragOver: (e: React.DragEvent, i: number) => void
  handleListDrop: (e: React.DragEvent, toIdx: number) => void
  handleListDragEnd: () => void

  // Import modal
  importOpen: boolean
  setImportOpen: (v: boolean) => void
  importText: string
  setImportText: (v: string) => void
  handleImportConfirm: () => void

  // Scene operations
  activeAdd: (obj: GlassesObject) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeUpdate: (id: string, props: Record<string, any>, debounce?: boolean) => void
  activeRemove: (id: string) => void
  activeClear: () => void
  activeReorder: (fromIdx: number, toIdx: number) => void
  handleClearGlasses: () => void
  handlePublishToLive: () => void
  handleExport: () => void
  handleGroup: () => void
  handleUngroup: () => void
  handleRemoveFromGroup: (groupId: string, childId: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleGroupChildUpdate: (groupId: string, childId: string, delta: Record<string, any>) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateProp: (key: string, val: any) => void

  // SVG pointer interaction
  activeElRef: React.RefObject<SVGSVGElement | null>
  toSvg: (e: { clientX: number; clientY: number }) => [number, number]
  startDrag: (e: React.PointerEvent, info: DragInfo) => void
  handleSvgPointerMove: (e: React.PointerEvent) => void
  handleSvgPointerUp: (e: React.PointerEvent) => void

  // Refs needed by canvas / properties panel
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  drawAnchorRef: React.RefObject<[number, number] | null>
  rawPointsRef: React.RefObject<[number, number][]>
  polyPointsRef: React.RefObject<[number, number][]>
  setPolyTick: React.Dispatch<React.SetStateAction<number>>

  // Live view
  isLiveView: boolean
  setLiveView: (id: number) => void
}

// Module-level ref so CCRemoteController can access the active live-view editor state
// without subscribing to each individual field. Only populated when isLiveView is true.
export const liveEditorRef: { current: EditorState | null } = { current: null }

function propsMatchTarget(props: Record<string, any>, target: Record<string, any>): boolean {
  return Object.entries(props).every(([k, v]) => {
    const cur = target[k]
    if (typeof v === 'object' && v !== null) return JSON.stringify(v) === JSON.stringify(cur)
    return cur === v
  })
}

function computeMoveOverrides(d: DragInfo, dx: number, dy: number): Override[] | null {
  switch (d.kind) {
    case 'multi-move':
      return d.anchors.map(a => a.origPoints
        ? { id: a.id, props: { points: a.origPoints.map(([px,py]) => [px+dx, py+dy] as [number,number]) } }
        : a.ox2 !== undefined
          ? { id: a.id, props: { x1: a.ox+dx, y1: a.oy+dy, x2: a.ox2+dx, y2: a.oy2!+dy } }
          : { id: a.id, props: { x: a.ox+dx, y: a.oy+dy } }
      )
    case 'move-line':
      return [{ id: d.id, props: { x1: d.ox1+dx, y1: d.oy1+dy, x2: d.ox2+dx, y2: d.oy2+dy } }]
    case 'move':
      return [{ id: d.id, props: { x: d.ox+dx, y: d.oy+dy } }]
    case 'move-pts':
      return [{ id: d.id, props: { points: d.origPoints.map(([px,py]) => [px+dx, py+dy] as [number,number]) } }]
    case 'move-vertex':
      return [{ id: d.id, props: { points: d.origPts.map((p, i) => i === d.vertIdx ? [p[0]+dx, p[1]+dy] as [number,number] : p) } }]
    case 'resize': {
      let x = d.ox, y = d.oy, w = d.ow, h = d.oh
      if (d.corner === 'se') { w = Math.max(4, d.ow+dx); h = Math.max(4, d.oh+dy) }
      if (d.corner === 'sw') { x = d.ox+dx; w = Math.max(4, d.ow-dx); h = Math.max(4, d.oh+dy) }
      if (d.corner === 'ne') { w = Math.max(4, d.ow+dx); y = d.oy+dy; h = Math.max(4, d.oh-dy) }
      if (d.corner === 'nw') { x = d.ox+dx; w = Math.max(4, d.ow-dx); y = d.oy+dy; h = Math.max(4, d.oh-dy) }
      return [{ id: d.id, props: { x, y, w, h } }]
    }
    case 'endpoint':
      return [{ id: d.id, props: d.pt === 1 ? { x1: d.ox+dx, y1: d.oy+dy } : { x2: d.ox+dx, y2: d.oy+dy } }]
    default:
      return null
  }
}

export function useGlassesEditor(computerId: number): EditorState {
  const liveObjects    = useWorldStore(s => (s.canvasScenes[computerId] ?? EMPTY_SCENE) as GlassesObject[])
  const wsSend         = useWorldStore(s => s.wsSend)
  const invokeCommand  = useWorldStore(s => s.invokeCommand)
  const isLiveView     = useWorldViewStore(s => s.liveViewComputerId === computerId)
  const setLiveView    = useWorldViewStore(s => s.setLiveView)

  // ─── Zustand-backed mutable state ─────────────────────────────────────────
  const ms = useEditorStateStore(s => s.glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE)
  const {
    editorMode, draftScene, undoStack, redoStack,
    open, fontReady,
    selectedIds, selectedChildId, editObj,
    overrides, childOverride,
    listDragIdx, listOverIdx,
    drawRgba, drawThickness, boxSelect,
    importOpen, importText,
    drawMode, drawCurrent,
  } = ms

  const updateEditor = useCallback(
    (patch: Partial<EditorMutableState>) => useEditorStateStore.getState().updateGlassesEditor(computerId, patch),
    [computerId]
  )

  // Setters
  const setEditorMode   = (m: 'live' | 'draft')          => updateEditor({ editorMode: m })
  const setOpen         = (v: boolean)                    => updateEditor({ open: v })
  const setFontReady    = (v: boolean)                    => updateEditor({ fontReady: v })
  const setSelectedIds  = (ids: string[])                 => updateEditor({ selectedIds: ids })
  const setSelectedChildId = (id: string | null)          => updateEditor({ selectedChildId: id })
  const setEditObj      = (obj: GlassesObject | null)     => updateEditor({ editObj: obj })
  const setDrawRgba     = (v: number)                     => updateEditor({ drawRgba: v })
  const setDrawThickness = (v: number)                    => updateEditor({ drawThickness: v })
  const setBoxSelect    = (v: BoxSelect | null)           => updateEditor({ boxSelect: v })
  const setImportOpen   = (v: boolean)                    => updateEditor({ importOpen: v })
  const setImportText   = (v: string)                     => updateEditor({ importText: v })
  const setDrawMode     = (m: DrawMode | null)            => updateEditor({ drawMode: m })
  const setDrawCurrent  = (v: [number, number] | null)    => updateEditor({ drawCurrent: v })

  const setPolyTick: React.Dispatch<React.SetStateAction<number>> = (v) => {
    if (typeof v === 'function') {
      const cur = (useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE).polyTick
      updateEditor({ polyTick: v(cur) })
    } else {
      updateEditor({ polyTick: v })
    }
  }

  const setDraftScene = (scene: GlassesObject[] | ((prev: GlassesObject[]) => GlassesObject[])) => {
    if (typeof scene === 'function') {
      const cur = (useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE).draftScene
      updateEditor({ draftScene: scene(cur) })
    } else {
      updateEditor({ draftScene: scene })
    }
  }

  const activeScene = editorMode === 'live' ? liveObjects : draftScene

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const activeElRef        = useRef<SVGSVGElement | null>(null)
  const textareaRef        = useRef<HTMLTextAreaElement>(null)
  const dragRef            = useRef<DragInfo | null>(null)
  const debounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const childDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drawAnchorRef      = useRef<[number, number] | null>(null)
  const pendingCaptureRef  = useRef<number | null>(null)
  const polyPointsRef      = useRef<[number, number][]>([])
  const rawPointsRef       = useRef<[number, number][]>([])

  const jsonLen     = JSON.stringify(activeScene).length
  const atCap       = activeScene.length >= 512 || jsonLen > JSON_CAP - 100
  const liveJsonLen = JSON.stringify(liveObjects).length

  // ─── Draft history helpers ─────────────────────────────────────────────────

  const draftPushHistory = useCallback(() => {
    const { draftScene: ds, undoStack: us } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE
    updateEditor({ undoStack: [...us.slice(-(HISTORY_CAP - 1)), ds], redoStack: [] })
  }, [computerId, updateEditor])

  const undo = useCallback(() => {
    const { undoStack: us, redoStack: rs, draftScene: ds } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE
    if (us.length === 0) return
    updateEditor({ undoStack: us.slice(0, -1), redoStack: [ds, ...rs.slice(0, HISTORY_CAP - 1)], draftScene: us[us.length - 1] })
  }, [computerId, updateEditor])

  const redo = useCallback(() => {
    const { undoStack: us, redoStack: rs, draftScene: ds } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE
    if (rs.length === 0) return
    updateEditor({ undoStack: [...us.slice(-(HISTORY_CAP - 1)), ds], redoStack: rs.slice(1), draftScene: rs[0] })
  }, [computerId, updateEditor])

  // ─── Effects ───────────────────────────────────────────────────────────────

  // Eagerly initialize the store entry so CCRemoteController re-renders after mount
  useEffect(() => {
    useEditorStateStore.getState().updateGlassesEditor(computerId, {})
  }, [computerId])

  useEffect(() => {
    if (fontReady) return
    loadMinecraftFont('assets/').then(ok => { if (ok) setFontReady(true) })
  }, [fontReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync editObj when top-level selection changes
  useEffect(() => {
    if (selectedIds.length !== 1) { updateEditor({ editObj: null, selectedChildId: null }); return }
    if (selectedChildId) return
    const found = activeScene.find(o => o.id === selectedIds[0])
    if (found) updateEditor({ editObj: found })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectedChildId])

  // Auto-focus textarea when a new text object is placed
  useEffect(() => {
    if (!editObj || editObj.type !== 'text') return
    if (!activeScene.some(o => o.id === editObj.id)) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editObj?.id])

  // Subscribe/unsubscribe to live canvas updates
  useEffect(() => {
    if ((open || isLiveView) && editorMode === 'live') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wsSend?.({ type: 'subscribeCanvas', computerId, subscribe: true } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return () => { wsSend?.({ type: 'subscribeCanvas', computerId, subscribe: false } as any) }
    }
  }, [open, isLiveView, editorMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up transient state when both modal and live view close
  useEffect(() => {
    if (open || isLiveView) return
    dragRef.current = null
    updateEditor({ overrides: [], boxSelect: null, childOverride: null, drawCurrent: null, drawMode: null, polyTick: 0 })
    drawAnchorRef.current = null; rawPointsRef.current = []
    polyPointsRef.current = []
  }, [open, isLiveView]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    if (!open && !isLiveView) return
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
        updateEditor({ drawCurrent: null, drawMode: null })
      } else if (open) { updateEditor({ open: false }) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, isLiveView, drawMode, editorMode, undo, redo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear overrides once server confirms (live mode)
  useEffect(() => {
    const { overrides: ov, editorMode: em } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE
    if (ov.length === 0 || em === 'draft') return
    const unconfirmed = ov.filter(o => {
      const obj = liveObjects.find(lo => lo.id === o.id)
      if (!obj) return false
      return !propsMatchTarget(o.props, obj as any)
    })
    updateEditor({ overrides: unconfirmed })
  }, [liveObjects]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear childOverride once server confirms (live mode)
  useEffect(() => {
    const { childOverride: co, editorMode: em } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE
    if (!co || em === 'draft') return
    const group = liveObjects.find(o => o.id === co.groupId)
    if (!group || group.type !== 'group') { updateEditor({ childOverride: null }); return }
    const child = (group as GlassesGroup).children.find(c => c.id === co.childId)
    if (!child) { updateEditor({ childOverride: null }); return }
    if (propsMatchTarget(co.props, child as any)) updateEditor({ childOverride: null })
  }, [liveObjects]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── WS helpers ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendOp = (op: string, extra: Record<string, any> = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // ─── Scene operations ──────────────────────────────────────────────────────

  const activeAdd = (obj: GlassesObject) => {
    if (editorMode === 'live') { sendOp('add', { object: obj }) }
    else { draftPushHistory(); setDraftScene(s => [...s, obj]) }
    updateEditor({ selectedIds: [obj.id], editObj: obj })
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
    const { selectedIds: curIds, editObj: curEdit } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE
    updateEditor({ selectedIds: curIds.filter(i => i !== id), ...(curEdit?.id === id ? { editObj: null } : {}) })
  }

  const activeClear = () => {
    if (editorMode === 'live') sendOp('clear')
    else { draftPushHistory(); setDraftScene([]) }
    updateEditor({ selectedIds: [], editObj: null })
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
    updateEditor({ drawMode: drawMode === mode ? null : mode })
  }

  const handleClearGlasses = () => { activeClear(); invokeCommand(computerId, 'glassesClear') }

  const handlePublishToLive = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wsSend?.({ type: 'setGlassesScene', computerId, scene: draftScene } as any)
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wsSend?.({ type: 'setGlassesScene', computerId, scene: parsed } as any)
      } else {
        draftPushHistory(); setDraftScene(parsed)
      }
    } catch { /* invalid JSON */ }
    updateEditor({ importOpen: false, importText: '' })
  }

  // ─── Group / Ungroup ──────────────────────────────────────────────────────

  const handleGroup = () => {
    if (selectedIds.length < 2) return
    const selected = activeScene.filter(o => selectedIds.includes(o.id))
    const bounds = selected.map(objBounds)
    const minX = Math.min(...bounds.map(b => b[0]))
    const minY = Math.min(...bounds.map(b => b[1]))

    const children: GlassesObject[] = selected.map(obj => {
      if (obj.type === 'line')    return { ...obj, x1: obj.x1-minX, y1: obj.y1-minY, x2: obj.x2-minX, y2: obj.y2-minY }
      if (obj.type === 'polygon' || obj.type === 'lines') return { ...obj, points: obj.points.map(([x,y]) => [x-minX, y-minY] as [number,number]) }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ('x' in obj && 'y' in obj) return { ...obj, x: (obj as any).x-minX, y: (obj as any).y-minY } as GlassesObject
      return obj
    })

    const group: GlassesGroup = { id: uid(), type: 'group', x: minX, y: minY, children }
    if (editorMode === 'draft') {
      draftPushHistory()
      setDraftScene(s => [...s.filter(o => !selectedIds.includes(o.id)), group])
    } else {
      sendOp('group', { objectIds: selectedIds, groupObject: group })
    }
    updateEditor({ selectedIds: [group.id] })
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ...child, id: newId, x: (child as any).x+g.x, y: (child as any).y+g.y } as GlassesObject
    })

    if (editorMode === 'draft') {
      draftPushHistory()
      setDraftScene(s => { const idx = s.findIndex(o => o.id === g.id); const n = [...s]; n.splice(idx, 1, ...ungrouped); return n })
    } else {
      sendOp('ungroup', { objectId: g.id })
    }
    updateEditor({ selectedChildId: null, selectedIds: ungrouped.map(o => o.id) })
  }

  const handleRemoveFromGroup = (groupId: string, childId: string) => {
    const group = activeScene.find(o => o.id === groupId) as GlassesGroup | undefined
    if (!group || group.type !== 'group') return
    const child = group.children.find(c => c.id === childId)
    if (!child) return

    let extracted: GlassesObject
    if (child.type === 'line') {
      extracted = { ...child, x1: child.x1+group.x, y1: child.y1+group.y, x2: child.x2+group.x, y2: child.y2+group.y }
    } else if (child.type === 'polygon' || child.type === 'lines') {
      extracted = { ...child, points: child.points.map(([x,y]) => [x+group.x, y+group.y] as [number,number]) }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extracted = { ...child, x: (child as any).x+group.x, y: (child as any).y+group.y } as GlassesObject
    }

    const newChildren = group.children.filter(c => c.id !== childId)

    if (editorMode === 'draft') {
      draftPushHistory()
      if (newChildren.length === 0) {
        setDraftScene(s => s.map(o => o.id === groupId ? extracted : o))
      } else {
        setDraftScene(s => [...s.map(o => o.id === groupId ? { ...group, children: newChildren } : o), extracted])
      }
    } else {
      if (newChildren.length === 0) sendOp('remove', { objectId: groupId })
      else activeUpdate(groupId, { children: newChildren })
      sendOp('add', { object: extracted })
    }

    updateEditor({ selectedChildId: null, editObj: extracted, selectedIds: [extracted.id] })
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

  // ─── SVG coordinates ───────────────────────────────────────────────────────

  const toSvg = (e: { clientX: number; clientY: number }): [number, number] => {
    const svg = activeElRef.current
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
      const { selectedIds: curIds } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE
      updateEditor({ selectedIds: curIds.includes(info.id) ? curIds.filter(i => i !== info.id) : [...curIds, info.id] })
      return
    }
    pendingCaptureRef.current = e.pointerId

    if ((info.kind === 'move' || info.kind === 'move-line') && selectedIds.length > 1 && selectedIds.includes(info.id)) {
      const [mx0, my0] = toSvg(e)
      const anchors = activeScene.filter(o => selectedIds.includes(o.id)).map(o => {
        if (o.type === 'line')    return { id: o.id, ox: o.x1, oy: o.y1, ox2: o.x2, oy2: o.y2 }
        if (o.type === 'polygon' || o.type === 'lines') return { id: o.id, ox: 0, oy: 0, origPoints: o.points }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { id: o.id, ox: (o as any).x as number, oy: (o as any).y as number }
      })
      dragRef.current = { kind: 'multi-move', anchors, mx0, my0 }
      return
    }

    dragRef.current = info
    if ('id' in info) updateEditor({ selectedIds: [info.id] })
  }

  const handleSvgPointerMove = (e: React.PointerEvent) => {
    if (pendingCaptureRef.current !== null) {
      activeElRef.current?.setPointerCapture(pendingCaptureRef.current)
      pendingCaptureRef.current = null
    }

    if (boxSelect) {
      const [mx, my] = toSvg(e)
      updateEditor({ boxSelect: boxSelect ? { ...boxSelect, x1: Math.round(mx), y1: Math.round(my) } : null })
      return
    }

    if (drawMode === 'poly' && polyPointsRef.current.length > 0) {
      const [mx, my] = toSvg(e); updateEditor({ drawCurrent: [Math.round(mx), Math.round(my)] }); return
    }
    if (drawMode === 'item') {
      const [mx, my] = toSvg(e); updateEditor({ drawCurrent: [Math.round(mx), Math.round(my)] })
    }

    if (drawAnchorRef.current) {
      const [mx, my] = toSvg(e)
      if (drawMode === 'lines') {
        const last = rawPointsRef.current[rawPointsRef.current.length - 1]
        if (last) { const dx = Math.round(mx) - last[0], dy = Math.round(my) - last[1]; if (dx*dx+dy*dy >= 4) rawPointsRef.current.push([Math.round(mx), Math.round(my)]) }
      }
      updateEditor({ drawCurrent: [Math.round(mx), Math.round(my)] }); return
    }

    const d = dragRef.current
    if (!d) return
    const [mx, my] = toSvg(e)
    const dx = Math.round(mx - d.mx0), dy = Math.round(my - d.my0)

    if (d.kind === 'move-child') {
      const orig = d.origProps
      let newProps: Record<string, any>
      if ('x1' in orig) {
        newProps = { x1: (orig.x1 as number)+dx, y1: (orig.y1 as number)+dy, x2: (orig.x2 as number)+dx, y2: (orig.y2 as number)+dy }
      } else if ('points' in orig) {
        newProps = { points: (orig.points as [number,number][]).map(([px,py]) => [px+dx, py+dy] as [number,number]) }
      } else {
        newProps = { x: (orig.x as number)+dx, y: (orig.y as number)+dy }
      }
      updateEditor({ childOverride: { groupId: d.groupId, childId: d.childId, props: newProps } })
      return
    }

    const overrides = computeMoveOverrides(d, dx, dy)
    if (overrides) updateEditor({ overrides })
  }

  const handleSvgPointerUp = (e: React.PointerEvent) => {
    pendingCaptureRef.current = null

    if (boxSelect) {
      const bx0 = Math.min(boxSelect.x0, boxSelect.x1), by0 = Math.min(boxSelect.y0, boxSelect.y1)
      const bx1 = Math.max(boxSelect.x0, boxSelect.x1), by1 = Math.max(boxSelect.y0, boxSelect.y1)
      if (bx1 - bx0 > 4 || by1 - by0 > 4) {
        const ids = activeScene.filter(o => objInBox(o, bx0, by0, bx1, by1)).map(o => o.id)
        updateEditor({ selectedIds: ids })
      }
      updateEditor({ boxSelect: null }); return
    }

    const anchor = drawAnchorRef.current

    if (anchor && drawMode === 'lines') {
      drawAnchorRef.current = null; updateEditor({ drawCurrent: null })
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
      drawAnchorRef.current = null; updateEditor({ drawCurrent: null })
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
      const { overrides: curOv, childOverride: curCo } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE

      if (d.kind === 'multi-move') {
        if (curOv.length > 0) {
          if (editorMode === 'draft') draftPushHistory()
          curOv.forEach(ov => activeUpdate(ov.id, ov.props))
        }
        if (editorMode === 'draft') updateEditor({ overrides: [] })
        return
      }

      if (d.kind === 'move-child') {
        if (curCo) {
          if (editorMode === 'draft') draftPushHistory()
          handleGroupChildUpdate(d.groupId, d.childId, curCo.props)
          updateEditor({ editObj: editObj && 'id' in editObj && editObj.id === d.childId ? { ...editObj, ...curCo.props } as GlassesObject : editObj })
        }
        if (editorMode === 'draft') updateEditor({ childOverride: null })
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ov = curOv.find(o => o.id === (d as any).id)
      if (ov) {
        if (editorMode === 'draft') draftPushHistory()
        activeUpdate(ov.id, ov.props)
        updateEditor({ editObj: editObj?.id === ov.id ? { ...editObj, ...ov.props } as GlassesObject : editObj })
      }
      if (editorMode === 'draft') updateEditor({ overrides: [] })
    }
  }

  // ─── Object list ───────────────────────────────────────────────────────────

  const handleListDragStart = (e: React.DragEvent, i: number) => { updateEditor({ listDragIdx: i }); e.dataTransfer.effectAllowed = 'move' }
  const handleListDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; updateEditor({ listOverIdx: i }) }
  const handleListDrop      = (e: React.DragEvent, toIdx: number) => { e.preventDefault(); const { listDragIdx: di } = useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE; if (di !== null && di !== toIdx) activeReorder(di, toIdx); updateEditor({ listDragIdx: null, listOverIdx: null }) }
  const handleListDragEnd   = () => { updateEditor({ listDragIdx: null, listOverIdx: null }) }

  // ─── Properties ────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectChild = (parentId: string, child: GlassesObject) =>
    updateEditor({ selectedIds: [parentId], selectedChildId: child.id, editObj: child })

  const updateProp = (key: string, val: any) => {
    if (!editObj) return
    const updated = { ...editObj, [key]: val } as GlassesObject
    if (selectedChildId && selectedIds.length === 1) {
      if (editorMode === 'draft') {
        const groupId = selectedIds[0]
        const childId = selectedChildId
        const curDraft = (useEditorStateStore.getState().glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE).draftScene
        const newScene = curDraft.map(o => {
          if (o.id !== groupId || o.type !== 'group') return o
          const g = o as GlassesGroup
          return { ...g, children: g.children.map(c => c.id === childId ? { ...c, [key]: val } as GlassesObject : c) }
        })
        updateEditor({ editObj: updated, draftScene: newScene })
      } else {
        updateEditor({ editObj: updated })
        sendChildUpdateDebounced(selectedIds[0], selectedChildId, { [key]: val })
      }
    } else {
      if (JSON.stringify(activeScene.map(o => o.id === editObj.id ? updated : o)).length > JSON_CAP) return
      updateEditor({ editObj: updated })
      activeUpdate(editObj.id, { [key]: val }, true)
    }
  }

  const result: EditorState = {
    computerId,
    liveObjects, activeScene, atCap, jsonLen, liveJsonLen,
    editorMode, setEditorMode,
    open, setOpen,
    fontReady,
    draftScene, undoStack, redoStack, undo, redo,
    selectedIds, setSelectedIds,
    selectedChildId, setSelectedChildId,
    editObj, setEditObj, selectChild,
    drawMode, setDrawMode,
    drawCurrent, setDrawCurrent,
    drawRgba, setDrawRgba,
    drawThickness, setDrawThickness,
    toggleDraw, commitPolygon, commitItem,
    boxSelect, setBoxSelect,
    overrides, childOverride,
    listDragIdx, listOverIdx,
    handleListDragStart, handleListDragOver, handleListDrop, handleListDragEnd,
    importOpen, setImportOpen, importText, setImportText, handleImportConfirm,
    activeAdd, activeUpdate, activeRemove, activeClear, activeReorder,
    handleClearGlasses, handlePublishToLive, handleExport,
    handleGroup, handleUngroup, handleRemoveFromGroup, handleGroupChildUpdate,
    updateProp,
    activeElRef, toSvg, startDrag, handleSvgPointerMove, handleSvgPointerUp,
    textareaRef, drawAnchorRef, rawPointsRef, polyPointsRef, setPolyTick,
    isLiveView, setLiveView,
  }

  // Keep liveEditorRef current so CCRemoteController can access it reactively
  if (isLiveView) liveEditorRef.current = result

  return result
}
