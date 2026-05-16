'use client'

import type React from 'react'
import type { GlassesObject, GlassesText, GlassesGroup } from '@/types/glasses'
import { DRAW_TOOLS, JSON_CAP, intToHex, hexToInt, rgbOfRgba, alphaOfRgba, packRgba, nudgeObj, objLabel } from './glassesEditorTypes'
import type { EditorState } from './useGlassesEditor'

// ─── Shared input primitives ──────────────────────────────────────────────────

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

// ─── Properties panel ─────────────────────────────────────────────────────────

function PropertiesPanel({ editor }: { editor: EditorState }) {
  const {
    selectedIds, selectedChildId, setSelectedChildId, editObj, setEditObj,
    activeScene, updateProp, handleRemoveFromGroup, handleUngroup,
    textareaRef, activeUpdate,
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

  // Child within a group
  if (selectedChildId && selectedIds.length === 1) {
    const parentGroup = activeScene.find(o => o.id === selectedIds[0]) as GlassesGroup | undefined
    const childLabel  = parentGroup ? 'child of group' : 'child'
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
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
            <input type="range" value={e.alpha ?? 255} min={0} max={255} step={1}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
              onChange={ev => updateProp('alpha', Number(ev.target.value))} />
            <NumInput label="" value={e.alpha ?? 255}
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
    const pts = (editObj as any).points as [number,number][] // eslint-disable-line @typescript-eslint/no-explicit-any
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
        <div style={{ fontSize: 10, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>item</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <NumInput label="x" value={e.x} onChange={up('x')} />
          <NumInput label="y" value={e.y} onChange={up('y')} />
        </div>
        <label style={{ ...labelStyle, gap: 6 }}>
          <span style={{ width: 22, textAlign: 'right', flexShrink: 0 }}>id</span>
          <input type="text" style={{ ...inputStyle, width: 130 }} value={e.item} placeholder="minecraft:stone"
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
          <input type="color" value={intToHex(rgbOfRgba(e.rgba))} style={{ width: 36, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            onChange={ev => updateProp('rgba', packRgba(hexToInt(ev.target.value), alphaOfRgba(e.rgba)))} />
        </label>
        <NumInput label="α" value={alphaOfRgba(e.rgba)} onChange={v => updateProp('rgba', packRgba(rgbOfRgba(e.rgba), Math.max(0, Math.min(255, v))))} min={0} max={255} />
      </div>
    </div>
  )
}

// ─── Object list ──────────────────────────────────────────────────────────────

function ObjectList({ editor }: { editor: EditorState }) {
  const {
    activeScene, selectedIds, setSelectedIds, selectedChildId, setSelectedChildId,
    setEditObj, activeReorder, activeRemove,
    listDragIdx, listOverIdx, handleListDragStart, handleListDragOver, handleListDrop, handleListDragEnd,
    jsonLen,
  } = editor

  return (
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
            return (
              <div key={obj.id}>
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
                    if (e.shiftKey) setSelectedIds(selectedIds.includes(obj.id) ? selectedIds.filter(id=>id!==obj.id) : [...selectedIds, obj.id])
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

                {obj.type === 'group' && (obj as GlassesGroup).children.map(child => {
                  const isChildSelected = isSelected && selectedChildId === child.id
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const childAlpha = 'rgba' in child ? alphaOfRgba((child as any).rgba) : child.type === 'item' ? ((child as any).alpha ?? 255) : 255 // eslint-disable-line @typescript-eslint/no-explicit-any
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
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: isChildSelected ? 'var(--accent)' : 'var(--fg-dim)' }}>
                        {objLabel(child)}
                      </span>
                      {childAlpha < 255 && (
                        <span title={`Custom alpha: ${childAlpha}`} style={{ fontSize: 8, color: '#f5a623', padding: '0 2px', flexShrink: 0, userSelect: 'none' }}>α{childAlpha}</span>
                      )}
                      <button className="btn btn-compact" style={{ padding: '0 4px', fontSize: 10, minHeight: 18, color: 'var(--red)' }}
                        onClick={ev => { ev.stopPropagation(); editor.handleRemoveFromGroup(obj.id, child.id) }}>×</button>
                    </div>
                  )
                })}
              </div>
            )
          })
        }
      </div>
    </div>
  )
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({ editor, onClose }: { editor: EditorState; onClose?: () => void }) {
  const {
    editorMode, setEditorMode, drawMode, drawRgba, setDrawRgba, drawThickness, setDrawThickness,
    toggleDraw, atCap, selectedIds, activeScene, handleGroup, handleUngroup,
    undoStack, redoStack, undo, redo, handlePublishToLive,
    handleExport, setImportOpen, handleClearGlasses,
  } = editor

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'var(--surface-3)', borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Glasses Canvas Editor</span>
      <span style={{ fontSize: 11, color: 'var(--fg-dim)' }}>·</span>
      <span style={{ fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>512×288</span>

      <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 2px' }} />
      {(['live', 'draft'] as const).map(m => (
        <button key={m} className="btn btn-compact"
          style={editorMode === m ? { background: 'var(--accent)', color: 'var(--bg, #fff)' } : undefined}
          onClick={() => setEditorMode(m)}>
          {m === 'live' ? '● Live' : '✎ Draft'}
        </button>
      ))}

      <span style={{ flex: 1 }} />

      {/* Draw tools (blue) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(59,130,246,0.5)', background: '#1c2d40' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Color / alpha for new objects">
          <input type="color" value={intToHex(rgbOfRgba(drawRgba))} style={{ width: 26, height: 22, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            onChange={ev => setDrawRgba(packRgba(hexToInt(ev.target.value), alphaOfRgba(drawRgba)))} />
          <input type="range" value={alphaOfRgba(drawRgba)} min={0} max={255} step={1}
            style={{ width: 56, accentColor: 'var(--accent)', flexShrink: 0 }}
            onChange={ev => setDrawRgba(packRgba(rgbOfRgba(drawRgba), Number(ev.target.value)))} />
          <input type="number" value={alphaOfRgba(drawRgba)} min={0} max={255} step={1} title="Alpha"
            style={{ width: 40, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: 11 }}
            onChange={ev => { const v = Number(ev.target.value); if (!isNaN(v)) setDrawRgba(packRgba(rgbOfRgba(drawRgba), Math.max(0, Math.min(255, v)))) }} />
        </label>
        <span style={{ width: 1, background: 'rgba(59,130,246,0.5)', alignSelf: 'stretch', margin: '0 1px' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Thickness">
          <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>th</span>
          <input type="number" value={drawThickness} min={1} step={1}
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

      {/* Group/Ungroup (purple) */}
      {(selectedIds.length >= 2 || (selectedIds.length === 1 && activeScene.find(o => o.id === selectedIds[0])?.type === 'group')) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(139,92,246,0.5)', background: '#221b38' }}>
          {selectedIds.length >= 2 && <button className="btn btn-compact" onClick={handleGroup}>Group</button>}
          {selectedIds.length === 1 && activeScene.find(o => o.id === selectedIds[0])?.type === 'group' && (
            <button className="btn btn-compact" onClick={handleUngroup}>Ungroup</button>
          )}
        </div>
      )}

      {/* History + Publish (purple, draft only) */}
      {editorMode === 'draft' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(139,92,246,0.5)', background: '#221b38' }}>
          <button className="btn btn-compact" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">↩ Undo</button>
          <button className="btn btn-compact" onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)">↪ Redo</button>
          <span style={{ width: 1, background: 'rgba(139,92,246,0.5)', alignSelf: 'stretch', margin: '0 1px' }} />
          <button className="btn btn-compact btn-primary" onClick={handlePublishToLive}>Publish →</button>
        </div>
      )}

      {/* Export / Import (teal) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(20,184,166,0.5)', background: '#132a26' }}>
        <button className="btn btn-compact" onClick={handleExport} title="Copy scene JSON to clipboard">Export</button>
        <button className="btn btn-compact" onClick={() => setImportOpen(true)}>Import</button>
        <span style={{ width: 1, background: 'rgba(20,184,166,0.5)', alignSelf: 'stretch', margin: '0 1px' }} />
        <button className="btn btn-compact btn-danger" onClick={handleClearGlasses}>Clear Glasses</button>
      </div>

      {onClose && <>
        <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 2px' }} />
        <button className="btn btn-compact" onClick={onClose} title="Close (Esc)">✕</button>
      </>}
    </div>
  )
}

// ─── GlassesEditorLayout ──────────────────────────────────────────────────────

interface Props {
  editor: EditorState
  canvasArea: React.ReactNode
  onClose?: () => void
}

export default function GlassesEditorLayout({ editor, canvasArea, onClose }: Props) {
  const { editorMode, draftScene, jsonLen } = editor

  const sidebar = (
    <div style={{ width: 230, flexShrink: 0, borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface)' }}>
      <ObjectList editor={editor} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ background: 'var(--surface-3)', borderBottom: '1px solid var(--line)', padding: '5px 10px', fontSize: 10, color: 'var(--fg-mute)', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>
          Properties
        </div>
        <div style={{ flex: 1, padding: 10, overflowY: 'auto', background: 'var(--surface-2)' }}>
          <PropertiesPanel editor={editor} />
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', padding: '6px 10px', background: 'var(--surface-3)', fontSize: 9, color: 'var(--fg-dim)', lineHeight: 1.5, flexShrink: 0 }}>
        <b style={{ color: 'var(--fg-mute)' }}>Click</b> sel · <b style={{ color: 'var(--fg-mute)' }}>Shift+click</b> add · <b style={{ color: 'var(--fg-mute)' }}>Drag bg</b> box-sel · <b style={{ color: 'var(--fg-mute)' }}>Draft</b> Ctrl+Z/Y/Publish
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>

      <Toolbar editor={editor} onClose={onClose} />

      {editorMode === 'draft' && (
        <div style={{ background: 'rgba(99,102,241,0.12)', borderBottom: '1px solid var(--line)', padding: '3px 12px', fontSize: 10, color: 'var(--fg-mute)', display: 'flex', gap: 12, flexShrink: 0 }}>
          <span>Draft mode — changes are local only. &ldquo;Publish →&rdquo; to send to glasses.</span>
          <span style={{ color: jsonLen > JSON_CAP * 0.94 ? 'var(--red)' : jsonLen > JSON_CAP * 0.75 ? '#f5a623' : 'var(--fg-dim)' }}>
            {draftScene.length} obj · {jsonLen.toLocaleString()}/{JSON_CAP.toLocaleString()} chars
          </span>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {canvasArea}
        </div>
        {sidebar}
      </div>
    </div>
  )
}
