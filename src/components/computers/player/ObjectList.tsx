'use client'

// Sidebar panel listing all objects in the active glasses scene.
// Supports click-to-select, multi-select, and drag-to-reorder.
import type { GlassesGroup } from '@/types/glasses'
import { JSON_CAP, alphaOfRgba, objLabel } from './glassesEditorTypes'
import type { EditorState } from './useGlassesEditor'

export function ObjectList({ editor }: { editor: EditorState }) {
  const {
    activeScene, selectedIds, setSelectedIds, selectedChildId, setSelectedChildId,
    activeReorder, activeRemove,
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
                        editor.selectChild(obj.id, child)
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
