'use client'

import { useEffect, useRef } from 'react'
import { drawIsometricBlock } from '@/utils/isometricBlockRender'

interface Props {
  src: string
  uv?: [number, number, number, number]
}

const CANVAS_SIZE = 64

export default function BlockIcon({ src, uv }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    const img = new Image()
    img.onload = () => { drawIsometricBlock(ctx, img, CANVAS_SIZE, uv) }
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
