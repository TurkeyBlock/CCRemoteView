'use client'

// Sidebar panel showing editable properties (position, size, color, text content, etc.)
// for the currently selected glasses object(s).
import type React from 'react'
import type { GlassesText, GlassesGroup } from '@/types/glasses'
import { intToHex, hexToInt, rgbOfRgba, alphaOfRgba, packRgba, nudgeObj } from './glassesEditorTypes'
import { FS } from '@/utils/fontSize'
import type { EditorState } from './useGlassesEditor'

const inputStyle: React.CSSProperties = {
  width: 60, background: 'var(--surface-3)', border: '1px solid var(--line)',
  borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: FS['12'],
}
const labelStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, fontSize: FS['12'], color: 'var(--fg-mute)',
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

export function PropertiesPanel({ editor }: { editor: EditorState }) {
  const {
    selectedIds, selectedChildId, setSelectedChildId, editObj, setEditObj,
    activeScene, updateProp, handleRemoveFromGroup, handleUngroup,
    textareaRef, itemIdRef, activeUpdate,
  } = editor

  const up = (key: string) => (v: number) => updateProp(key, v)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = editObj as any

  // Multi-select: mass color/nudge
  if (selectedIds.length > 1) {
    const selObjs = activeScene.filter(o => selectedIds.includes(o.id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstWithRgba = selObjs.find(o => 'rgba' in o) as any
    const repRgba = firstWithRgba ? firstWithRgba.rgba : packRgba(0xffffff, 255)

    const applyColor = (rgb24: number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      selObjs.filter(o => 'rgba' in o).forEach(o => activeUpdate(o.id, { rgba: packRgba(rgb24, alphaOfRgba((o as any).rgba)) }))
    const applyAlpha = (alpha: number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      selObjs.filter(o => 'rgba' in o).forEach(o => activeUpdate(o.id, { rgba: packRgba(rgbOfRgba((o as any).rgba), alpha) }))
    const nudge = (dx: number, dy: number) =>
      selObjs.forEach(o => {
        const n = nudgeObj(o, dx, dy)
        if (n.type === 'line') activeUpdate(n.id, { x1: (n as any).x1, y1: (n as any).y1, x2: (n as any).x2, y2: (n as any).y2 }) // eslint-disable-line @typescript-eslint/no-explicit-any
        else if (n.type === 'polygon' || n.type === 'lines') activeUpdate(n.id, { points: (n as any).points }) // eslint-disable-line @typescript-eslint/no-explicit-any
        else activeUpdate(n.id, { x: (n as any).x, y: (n as any).y }) // eslint-disable-line @typescript-eslint/no-explicit-any
      })

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: FS['12'], color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{selectedIds.length} selected</div>
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
      </div>
    )
  }

  if (!editObj) return (
    <div style={{ fontSize: FS['12'], color: 'var(--fg-dim)', lineHeight: 1.6 }}>
      Select an object to edit its properties.
    </div>
  )

  // Child within a group
  if (selectedChildId && selectedIds.length === 1) {
    const parentGroup = activeScene.find(o => o.id === selectedIds[0]) as GlassesGroup | undefined
    const childLabel  = parentGroup ? 'child of group' : 'child'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: FS['12'], color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {editObj.type} · <span style={{ color: 'var(--fg-mute)' }}>{childLabel} (relative coords)</span>
        </div>
        {'x' in editObj && 'y' in editObj && (
          <div style={{ display: 'flex', gap: 4 }}>
            <NumInput label="x" value={e.x} onChange={up('x')} />
            <NumInput label="y" value={e.y} onChange={up('y')} />
          </div>
        )}
        {'rgba' in editObj && (() => {
          const rgba = e.rgba as number
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
                <span style={{ fontSize: FS['12'], color: 'var(--fg-dim)', flexShrink: 0 }}>alpha</span>
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
            <span style={{ fontSize: FS['12'], color: 'var(--fg-dim)', flexShrink: 0 }}>alpha</span>
            <input type="range" value={e.alpha ?? 255} min={0} max={255} step={1}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
              onChange={ev => updateProp('alpha', Number(ev.target.value))} />
            <NumInput label="" value={e.alpha ?? 255}
              onChange={v => updateProp('alpha', Math.max(0, Math.min(255, v|0)))} min={0} max={255} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-compact" style={{ fontSize: FS['12'] }}
            onClick={() => { setSelectedChildId(null); if (parentGroup) setEditObj(parentGroup) }}>
            ← Back
          </button>
          <button className="btn btn-compact btn-danger" style={{ fontSize: FS['12'] }}
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
        <div style={{ fontSize: FS['12'], color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>group · {g.children.length} children</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <NumInput label="x" value={g.x} onChange={up('x')} />
          <NumInput label="y" value={g.y} onChange={up('y')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: FS['11'], color: 'var(--fg-dim)', flexShrink: 0 }}>alpha</span>
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
    const pts = (editObj as any).points as [number,number][] // eslint-disable-line @typescript-eslint/no-explicit-any
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: FS['12'], color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{editObj.type} · {pts.length} pts</div>
        <div style={{ maxHeight: 120, overflowY: 'auto', background: 'var(--surface-3)', borderRadius: 2, padding: '2px 4px' }}>
          {pts.map(([x,y],i) => (
            <div key={i} style={{ display: 'flex', gap: 4, fontSize: FS['10'], fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--fg-mute)', minWidth: 18, textAlign: 'right' }}>{i}:</span>
              <span>{x}, {y}</span>
            </div>
          ))}
        </div>
        {editObj.type === 'lines' && <NumInput label="th" value={e.thickness} onChange={v => updateProp('thickness', Math.max(1, v|0))} min={1} />}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={labelStyle}>
            <span>col</span>
            <input type="color" value={intToHex(rgbOfRgba(e.rgba))} style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              onChange={ev => updateProp('rgba', packRgba(hexToInt(ev.target.value), alphaOfRgba(e.rgba)))} />
          </label>
          <NumInput label="α" value={alphaOfRgba(e.rgba)} onChange={v => updateProp('rgba', packRgba(rgbOfRgba(e.rgba), Math.max(0, Math.min(255, v))))} min={0} max={255} />
        </div>
      </div>
    )
  }

  if (editObj.type === 'item') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: FS['12'], color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>item</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <NumInput label="x" value={e.x} onChange={up('x')} />
          <NumInput label="y" value={e.y} onChange={up('y')} />
        </div>
        <label style={{ ...labelStyle, gap: 6 }}>
          <span style={{ width: 22, textAlign: 'right', flexShrink: 0 }}>id</span>
          <input ref={itemIdRef} type="text" style={{ ...inputStyle, width: 130 }} value={e.item} placeholder="minecraft:stone"
            onChange={ev => updateProp('item', ev.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <NumInput label="dmg" value={e.damage} onChange={v => updateProp('damage', Math.max(0, v|0))} min={0} />
          <NumInput label="sc" value={e.scale} onChange={v => updateProp('scale', Math.max(0.1, v))} min={0.1} />
        </div>
        <NumInput label="α" value={e.alpha} onChange={v => updateProp('alpha', Math.max(0, Math.min(255, v|0)))} min={0} max={255} />
      </div>
    )
  }

  // rect, text, line, dot
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: FS['12'], color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{editObj.type}</div>
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
            style={{ width: '100%', background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '3px 5px', fontSize: FS['12'], resize: 'vertical', minHeight: 44, fontFamily: 'var(--font-mono)' }}
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
          <input type="color" value={intToHex(rgbOfRgba(e.rgba))} style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            onChange={ev => updateProp('rgba', packRgba(hexToInt(ev.target.value), alphaOfRgba(e.rgba)))} />
        </label>
        <NumInput label="α" value={alphaOfRgba(e.rgba)} onChange={v => updateProp('rgba', packRgba(rgbOfRgba(e.rgba), Math.max(0, Math.min(255, v))))} min={0} max={255} />
      </div>
    </div>
  )
}
