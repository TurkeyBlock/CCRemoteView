'use client'

import { useEffect, useRef } from 'react'

interface Props {
  src: string
  uv?: [number, number, number, number]
}

const CANVAS_SIZE = 64

// Affine transforms mapping the source texture (drawn at 0,0,S,S) onto each
// isometric face parallelogram. Derived so each face's four corners map to the
// correct canvas positions (fractions of S):
//   top:   (S/2,0)→(S,S/4)→(S/2,S/2)→(0,S/4)
//   left:  (0,S/4)→(S/2,S/2)→(S/2,S)→(0,3S/4)
//   right: (S/2,S/2)→(S,S/4)→(S,3S/4)→(S/2,S)
const FACE_TRANSFORMS = {
  top:   [0.5,  0.25, -0.5, 0.25, 0.5, 0  ] as const,
  left:  [0.5,  0.25,  0,   0.5,  0,   0.25] as const,
  right: [0.5, -0.25,  0,   0.5,  0.5, 0.5 ] as const,
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
) {
  ctx.save()

  // Clip to the face parallelogram (in un-transformed canvas coords).
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

  const shade = FACE_SHADE[face]
  if (shade) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, S, S)
  }

  ctx.restore()
}

export default function BlockIcon({ src, uv }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    const img = new Image()
    img.onload = () => {
      ctx.imageSmoothingEnabled = false
      drawFace(ctx, img, CANVAS_SIZE, 'top', uv)
      drawFace(ctx, img, CANVAS_SIZE, 'left', uv)
      drawFace(ctx, img, CANVAS_SIZE, 'right', uv)
    }
    img.src = src
  }, [src, uv])

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      style={{ width: '80%', aspectRatio: '1', imageRendering: 'pixelated' }}
    />
  )
}
