'use client'

// SVG canvas that renders the glasses scene and handles all pointer events
// (selection, drag-move, box-select, drawing new objects).
// Purely presentational — reads EditorState from useGlassesEditor, no own state except font readiness.
import { useState, useRef, useEffect } from 'react'
import type { GlassesObject, GlassesRect, GlassesText, GlassesLine, GlassesPolygon, GlassesLines, GlassesItem, GlassesGroup } from '@/types/glasses'
import { renderMinecraftTextToCanvas, measureMinecraftText } from '@/utils/minecraftFont'
import { CANVAS_W, CANVAS_H, intToHex, rgbOfRgba, alphaOfRgba, objBounds } from './glassesEditorTypes'
import type { EditorState } from './useGlassesEditor'

// ─── MinecraftTextObj ─────────────────────────────────────────────────────────

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

  const textW   = fontReady
    ? measureMinecraftText(t.content, t.size)
    : Math.max(10, t.content.split('\n').reduce((m, l) => Math.max(m, l.length), 0) * t.size * 6)
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

// ─── ItemObj ──────────────────────────────────────────────────────────────────

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

  const w       = Math.max(4, Math.round(16 * obj.scale))
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

// ─── GlassesSvgCanvas ─────────────────────────────────────────────────────────

interface Props {
  editor: EditorState
  bgFill?: string
}

export default function GlassesSvgCanvas({ editor, bgFill = '#111' }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const {
    activeScene, selectedIds, selectedChildId, drawMode, drawCurrent,
    boxSelect, overrides, childOverride, fontReady,
    polyPointsRef, drawAnchorRef, rawPointsRef,
    activeElRef, setSelectedIds, setBoxSelect,
    toSvg, startDrag, handleSvgPointerMove, handleSvgPointerUp,
    drawRgba, setDrawCurrent, setPolyTick, commitPolygon, commitItem,
  } = editor

  const SEL       = '#3b82f6'
  const SEL_MULTI = '#22c55e'
  const HR        = 3

  const resolved = (obj: GlassesObject): GlassesObject => {
    const ov = overrides.find(o => o.id === obj.id)
    return ov ? { ...obj, ...ov.props } as GlassesObject : obj
  }

  const renderObj = (raw: GlassesObject): React.ReactNode => {
    const obj    = resolved(raw)
    const sel    = selectedIds.includes(obj.id)
    const selCol = selectedIds.length > 1 ? SEL_MULTI : SEL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasRgba = obj.type !== 'item'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opacity = hasRgba ? alphaOfRgba((obj as any).rgba) / 255 : 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fill    = hasRgba ? intToHex(rgbOfRgba((obj as any).rgba)) : '#fff'

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
            style={{ cursor: 'move' }}
            onPointerDown={e => { const [mx, my] = toSvg(e); startDrag(e, { kind: 'move-line', id: l.id, mx0: mx, my0: my, ox1: l.x1, oy1: l.y1, ox2: l.x2, oy2: l.y2 }) }} />
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
      const rawPts     = p.points
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
      const l   = obj as GlassesLines
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
      const displayChildren = g.children.map(c =>
        childOverride && childOverride.groupId === g.id && childOverride.childId === c.id
          ? { ...c, ...childOverride.props } as GlassesObject : c
      )
      const isChildActive = sel && selectedChildId !== null
      const activeChild   = isChildActive ? displayChildren.find(c => c.id === selectedChildId) ?? null : null
      const [acx0, acy0, acx1, acy1] = activeChild ? objBounds(activeChild) : [0, 0, 0, 0]

      return (
        <g key={g.id}>
          <g transform={`translate(${g.x},${g.y})`} opacity={(g.alpha ?? 255) / 255}>
            {displayChildren.map((child, i) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const co = alphaOfRgba('rgba' in child ? (child as any).rgba : 255*256) / 255
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const cf = 'rgba' in child ? intToHex(rgbOfRgba((child as any).rgba)) : '#fff'
              if (child.type === 'rect')    return <rect key={i} x={child.x} y={child.y} width={child.w} height={child.h} fill={cf} opacity={co} style={{ pointerEvents: 'none' }} />
              if (child.type === 'text')    return <text key={i} x={child.x} y={child.y} fill={cf} opacity={co} fontSize={child.size*8} style={{ pointerEvents: 'none', userSelect: 'none' }}>{child.content}</text>
              if (child.type === 'line')    return <line key={i} x1={child.x1} y1={child.y1} x2={child.x2} y2={child.y2} stroke={cf} strokeWidth={child.thickness} opacity={co} style={{ pointerEvents: 'none' }} />
              if (child.type === 'polygon') return <polygon key={i} points={child.points.map(([x,y])=>`${x},${y}`).join(' ')} fill={cf} opacity={co} style={{ pointerEvents: 'none' }} />
              if (child.type === 'lines')   return <polyline key={i} points={child.points.map(([x,y])=>`${x},${y}`).join(' ')} fill="none" stroke={cf} strokeWidth={child.thickness} opacity={co} style={{ pointerEvents: 'none' }} />
              return null
            })}
          </g>
          {!isChildActive && (
            <rect x={gx0} y={gy0} width={Math.max(4, gx1-gx0)} height={Math.max(4, gy1-gy0)}
              fill="transparent" style={{ cursor: 'move' }}
              onPointerDown={e => { const [mx,my] = toSvg(e); startDrag(e, { kind: 'move', id: g.id, mx0: mx, my0: my, ox: g.x, oy: g.y }) }} />
          )}
          {sel && !selectedChildId && (
            <rect x={gx0-1} y={gy0-1} width={gx1-gx0+2} height={gy1-gy0+2}
              fill="none" stroke={selCol} strokeWidth={1} strokeDasharray="5 3" style={{ pointerEvents: 'none' }} />
          )}
          {activeChild && <>
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                else origProps = { x: (origChild as any).x, y: (origChild as any).y }
                startDrag(e, { kind: 'move-child', groupId: g.id, childId: selectedChildId!, mx0: mx, my0: my, origProps })
              }} />
          </>}
        </g>
      )
    }

    return null
  }

  // ─── Draw preview ──────────────────────────────────────────────────────────

  const renderDrawPreview = () => {
    const anchor   = drawAnchorRef.current
    const ghost: React.CSSProperties = { pointerEvents: 'none', opacity: 0.75 }
    const drawFill = intToHex(rgbOfRgba(drawRgba))

    if (drawMode === 'poly') {
      const pts = polyPointsRef.current
      if (pts.length === 0) return null
      const ptStr = pts.map(([x,y]) => `${x},${y}`).join(' ')
      return (
        <g style={{ pointerEvents: 'none' }}>
          {pts.length >= 3 && <g opacity={0.2}>{Array.from({length: pts.length-2}, (_,i) =>
            <polygon key={i} points={`${pts[0][0]},${pts[0][1]} ${pts[i+1][0]},${pts[i+1][1]} ${pts[i+2][0]},${pts[i+2][1]}`} fill={drawFill} />
          )}</g>}
          {pts.length >= 2 && <polyline points={ptStr} fill="none" stroke={SEL} strokeWidth={1} strokeDasharray="4 2" />}
          {drawCurrent && <line x1={pts[pts.length-1][0]} y1={pts[pts.length-1][1]} x2={drawCurrent[0]} y2={drawCurrent[1]} stroke={SEL} strokeWidth={1} strokeDasharray="4 2" />}
          {pts.map(([x,y],i) => {
            const isFirst  = i === 0
            const canClose = isFirst && pts.length >= 3 && drawCurrent !== null && (drawCurrent[0]-x)**2+(drawCurrent[1]-y)**2 <= 64
            return <circle key={i} cx={x} cy={y} r={canClose ? 5 : (isFirst ? 4 : 2.5)}
              fill={canClose ? '#22c55e' : (isFirst ? drawFill : SEL)}
              stroke={canClose ? '#16a34a' : SEL} strokeWidth={0.5} />
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

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%" height="100%"
      style={{ display: 'block', cursor: drawMode ? 'crosshair' : 'default' }}
      onPointerEnter={() => { activeElRef.current = svgRef.current }}
      onPointerLeave={() => { activeElRef.current = null }}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onWheel={e => e.stopPropagation()}
    >
      <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={bgFill}
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
  )
}
