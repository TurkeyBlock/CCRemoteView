// rgba: 32-bit packed integer encoding color and transparency as (rgb24 << 8) | alpha.
// rgb24 is a 24-bit RGB value (0x000000–0xFFFFFF); alpha is 0–255.
// Examples: full-white opaque = 0xFFFFFF * 256 + 255 = 4294967295
//           red at 50% opacity = 0xFF0000 * 256 + 128 = 4278190208
// Unpack:   rgb24 = Math.floor(rgba / 256),  alpha = rgba % 256
// Pack:     rgba  = rgb24 * 256 + alpha

export interface GlassesRect {
  id: string
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  rgba: number
}

export interface GlassesText {
  id: string
  type: 'text'
  x: number
  y: number
  content: string
  rgba: number
  size: number
  shadow: boolean
}

export interface GlassesLine {
  id: string
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  rgba: number
  thickness: number
}

export interface GlassesDot {
  id: string
  type: 'dot'
  x: number
  y: number
  rgba: number
  size: number
}

// Filled polygon. 3–32 points. Lua: c.addPolygon(unpack(pointArgs..., col)).
export interface GlassesPolygon {
  id: string
  type: 'polygon'
  points: [number, number][]
  rgba: number
}

// Freehand polyline. 2–64 points (RDP-simplified on creation). Lua: c.addLines(unpack(pointArgs..., col, thickness)).
export interface GlassesLines {
  id: string
  type: 'lines'
  points: [number, number][]
  rgba: number
  thickness: number
}

// Item icon. No rgba — items render with their natural texture; alpha controls opacity.
// Lua: c.addItem({x,y}, item, damage, scale); h.setAlpha(alpha).
export interface GlassesItem {
  id: string
  type: 'item'
  x: number
  y: number
  item: string
  damage: number
  scale: number
  alpha: number
}

export type GlassesObject = GlassesRect | GlassesText | GlassesLine | GlassesDot | GlassesPolygon | GlassesLines | GlassesItem
