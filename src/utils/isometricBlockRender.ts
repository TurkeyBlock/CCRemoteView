// Renders a Minecraft-style isometric block icon into a canvas context.
//
// Projection geometry (all at scale S = size):
//   Top face rhombus:       (S/2,0) → (S,S/4) → (S/2,S/2) → (0,S/4)
//   Left face parallelogram:  (0,S/4) → (S/2,S/2) → (S/2,S) → (0,3S/4)
//   Right face parallelogram: (S/2,S/2) → (S,S/4) → (S,3S/4) → (S/2,S)
//
// Affine transforms (map local 0–S square → face, ex/ey are fractions of S):
//   Top:   setTransform(0.5, 0.25, -0.5, 0.25, S/2, 0)
//   Left:  setTransform(0.5, 0.25,  0,   0.5,  0,   S/4)
//   Right: setTransform(0.5,-0.25,  0,   0.5,  S/2, S/2)

import { blockTint, hasBiomeTint, BIOME_TINT } from './blockMaps'

const FACE_TRANSFORMS = {
  top:   [0.5,  0.25, -0.5, 0.25, 0.5, 0   ] as const,
  left:  [0.5,  0.25,  0,   0.5,  0,   0.25 ] as const,
  right: [0.5, -0.25,  0,   0.5,  0.5, 0.5  ] as const,
}

const FACE_SHADE: Record<string, string | null> = {
  top:   null,
  left:  'rgba(0,0,0,0.20)',
  right: 'rgba(0,0,0,0.38)',
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  S: number,
  face: 'top' | 'left' | 'right',
  uv?: [number, number, number, number],
  tint?: number,
) {
  ctx.save()

  ctx.beginPath()
  if (face === 'top') {
    ctx.moveTo(S / 2, 0); ctx.lineTo(S, S / 4); ctx.lineTo(S / 2, S / 2); ctx.lineTo(0, S / 4)
  } else if (face === 'left') {
    ctx.moveTo(0, S / 4); ctx.lineTo(S / 2, S / 2); ctx.lineTo(S / 2, S); ctx.lineTo(0, S * 3 / 4)
  } else {
    ctx.moveTo(S / 2, S / 2); ctx.lineTo(S, S / 4); ctx.lineTo(S, S * 3 / 4); ctx.lineTo(S / 2, S)
  }
  ctx.closePath()
  ctx.clip()

  const [a, b, c, d, ex, ey] = FACE_TRANSFORMS[face]
  ctx.setTransform(a, b, c, d, ex * S, ey * S)
  if (uv) {
    const [u1, v1, u2, v2] = uv
    ctx.drawImage(img, u1, v1, u2 - u1, v2 - v1, 0, 0, S, S)
  } else {
    ctx.drawImage(img, 0, 0, S, S)
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)

  const shade = FACE_SHADE[face]
  if (shade) {
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, S, S)
  }

  if (tint !== undefined) {
    const r = (tint >> 16) & 0xff
    const g = (tint >> 8) & 0xff
    const b = tint & 0xff
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(0, 0, S, S)
  }

  ctx.restore()
}

export function getBlockTintColor(name: string, meta = 0): number | undefined {
  const id = meta ? `${name}:${meta}` : name
  return blockTint[id] ?? blockTint[name] ?? (hasBiomeTint(name) ? BIOME_TINT : undefined)
}

export function drawIsometricBlock(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  size: number,
  uv?: [number, number, number, number],
  tint?: number,
): void {
  ctx.imageSmoothingEnabled = false
  drawFace(ctx, img, size, 'left', uv, tint)
  drawFace(ctx, img, size, 'right', uv, tint)
  drawFace(ctx, img, size, 'top', uv, tint)
}

export function renderIsometricBlock(
  texUrl: string,
  tint: number | undefined,
  uv?: [number, number, number, number],
  size = 64,
): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(null); return }
      drawIsometricBlock(ctx, img, size, uv, tint)
      resolve(canvas.toDataURL())
    }
    img.onerror = () => resolve(null)
    img.src = texUrl
  })
}
