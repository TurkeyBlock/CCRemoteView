// Shared constants, types, and pure helpers for the glasses canvas editor.
// Imported by all other glasses editor files — no React, no state.
import type { GlassesObject, GlassesText, GlassesItem, GlassesLines, GlassesPolygon, GlassesGroup } from '@/types/glasses'

export const CANVAS_W = 512
export const CANVAS_H = 288
export const JSON_CAP = 16_000
export const HISTORY_CAP = 50

export type DrawMode = 'rect' | 'text' | 'line' | 'poly' | 'lines' | 'item'

export const DRAW_TOOLS: { mode: DrawMode; label: string }[] = [
  { mode: 'rect',  label: 'Rect'    },
  { mode: 'poly',  label: 'Poly'    },
  { mode: 'lines', label: 'Drawing' },
  { mode: 'line',  label: 'Line'    },
  { mode: 'text',  label: 'Text'    },
  { mode: 'item',  label: 'Item'    },
]

export type BoxSelect = { x0: number; y0: number; x1: number; y1: number }

export const intToHex = (n: number) => '#' + Math.max(0, Math.min(0xffffff, n | 0)).toString(16).padStart(6, '0')
export const hexToInt = (h: string) => parseInt(h.replace('#', ''), 16) || 0
export const rgbOfRgba   = (rgba: number) => Math.floor(rgba / 256)
export const alphaOfRgba = (rgba: number) => rgba % 256
export const packRgba    = (rgb24: number, alpha: number) => rgb24 * 256 + alpha

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DragInfo =
  | { kind: 'move';        id: string; mx0: number; my0: number; ox: number; oy: number }
  | { kind: 'move-line';   id: string; mx0: number; my0: number; ox1: number; oy1: number; ox2: number; oy2: number }
  | { kind: 'multi-move';  anchors: { id: string; ox: number; oy: number; ox2?: number; oy2?: number; origPoints?: [number,number][] }[]; mx0: number; my0: number }
  | { kind: 'move-pts';    id: string; mx0: number; my0: number; origPoints: [number, number][] }
  | { kind: 'move-vertex'; id: string; vertIdx: number; mx0: number; my0: number; origPts: [number, number][] }
  | { kind: 'resize';      id: string; corner: 'nw'|'ne'|'sw'|'se'; mx0: number; my0: number; ox: number; oy: number; ow: number; oh: number }
  | { kind: 'endpoint';    id: string; pt: 1|2; mx0: number; my0: number; ox: number; oy: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'move-child';  groupId: string; childId: string; mx0: number; my0: number; origProps: Record<string, any> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Override = { id: string; props: Record<string, any> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChildOverride = { groupId: string; childId: string; props: Record<string, any> } | null

export function objBounds(obj: GlassesObject): [number, number, number, number] {
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

export function nudgeObj(obj: GlassesObject, dx: number, dy: number): GlassesObject {
  if (obj.type === 'line')    return { ...obj, x1: obj.x1+dx, y1: obj.y1+dy, x2: obj.x2+dx, y2: obj.y2+dy }
  if (obj.type === 'polygon' || obj.type === 'lines') return { ...obj, points: obj.points.map(([x,y]) => [x+dx, y+dy] as [number,number]) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ('x' in obj && 'y' in obj) return { ...obj, x: (obj as any).x+dx, y: (obj as any).y+dy } as GlassesObject
  return obj
}

export interface EditorMutableState {
  editorMode: 'live' | 'draft'
  draftScene: GlassesObject[]
  undoStack: GlassesObject[][]
  redoStack: GlassesObject[][]
  open: boolean
  fontReady: boolean
  selectedIds: string[]
  selectedChildId: string | null
  editObj: GlassesObject | null
  overrides: Override[]
  childOverride: ChildOverride
  listDragIdx: number | null
  listOverIdx: number | null
  drawRgba: number
  drawThickness: number
  boxSelect: BoxSelect | null
  importOpen: boolean
  importText: string
  drawMode: DrawMode | null
  drawCurrent: [number, number] | null
  polyTick: number
}

export const DEFAULT_EDITOR_MUTABLE: EditorMutableState = {
  editorMode: 'live',
  draftScene: [],
  undoStack: [],
  redoStack: [],
  open: false,
  fontReady: false,
  selectedIds: [],
  selectedChildId: null,
  editObj: null,
  overrides: [],
  childOverride: null,
  listDragIdx: null,
  listOverIdx: null,
  drawRgba: packRgba(0xffffff, 255),
  drawThickness: 5,
  boxSelect: null,
  importOpen: false,
  importText: '',
  drawMode: null,
  drawCurrent: null,
  polyTick: 0,
}

export function objLabel(o: GlassesObject): string {
  if (o.type === 'text')    return `text "${(o as GlassesText).content.slice(0, 10)}"`
  if (o.type === 'item')    return `item ${(o as GlassesItem).item.split(':')[1] ?? ''}`
  if (o.type === 'lines')   return `lines (${(o as GlassesLines).points.length}pts)`
  if (o.type === 'polygon') return `poly (${(o as GlassesPolygon).points.length}pts)`
  if (o.type === 'group')   return `group (${(o as GlassesGroup).children.length})`
  return o.type
}
