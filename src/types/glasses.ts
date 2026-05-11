export interface GlassesRect {
  id: string
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  color: number
  alpha: number
}

export interface GlassesText {
  id: string
  type: 'text'
  x: number
  y: number
  content: string
  color: number
  alpha: number
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
  color: number
  alpha: number
  thickness: number
}

export interface GlassesDot {
  id: string
  type: 'dot'
  x: number
  y: number
  color: number
  alpha: number
  size: number
}

export type GlassesObject = GlassesRect | GlassesText | GlassesLine | GlassesDot
