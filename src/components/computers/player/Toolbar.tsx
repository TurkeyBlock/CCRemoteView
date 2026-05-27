'use client'

// Top toolbar for the glasses canvas editor: draw-tool selector, color/thickness
// picker, undo/redo, group/ungroup, publish-to-live, import/export, and clear.
import { DRAW_TOOLS, intToHex, hexToInt, rgbOfRgba, alphaOfRgba, packRgba } from './glassesEditorTypes'
import { FS } from '@/utils/fontSize'
import type { EditorState } from './useGlassesEditor'

export function Toolbar({ editor, onClose }: { editor: EditorState; onClose?: () => void }) {
  const {
    editorMode, setEditorMode, drawMode, drawRgba, setDrawRgba, drawThickness, setDrawThickness,
    toggleDraw, atCap, selectedIds, activeScene, handleGroup, handleUngroup,
    undoStack, redoStack, undo, redo, handlePublishToLive,
    handleExport, setImportOpen, handleClearGlasses, activeClear,
  } = editor

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'var(--surface-3)', borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap' }}>
      <span style={{ fontSize: FS['14'], fontWeight: 600, color: 'var(--fg)' }}>Glasses Canvas Editor</span>
      <span style={{ fontSize: FS['12'], color: 'var(--fg-dim)' }}>·</span>
      <span style={{ fontSize: FS['12'], color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>512×288</span>

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
          <input type="number" value={alphaOfRgba(drawRgba)} min={0} max={255} step={1} title="Alpha"
            style={{ width: 46, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: FS['12'] }}
            onChange={ev => { const v = Number(ev.target.value); if (!isNaN(v)) setDrawRgba(packRgba(rgbOfRgba(drawRgba), Math.max(0, Math.min(255, v)))) }} />
        </label>
        <span style={{ width: 1, background: 'rgba(59,130,246,0.5)', alignSelf: 'stretch', margin: '0 1px' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} title="Thickness">
          <span style={{ fontSize: FS['12'], color: 'rgba(190,215,235,0.9)' }}>th</span>
          <input type="number" value={drawThickness} min={1} step={1}
            style={{ width: 38, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '1px 4px', fontSize: FS['12'] }}
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

      {/* Group/Ungroup (purple) — always visible to avoid header layout shifts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '3px 6px', borderRadius: 4, border: '1px solid rgba(139,92,246,0.5)', background: '#221b38' }}>
        <button className="btn btn-compact" onClick={handleGroup} disabled={(() => { const gc = selectedIds.filter(id => activeScene.find(o => o.id === id)?.type === 'group').length; const ngc = selectedIds.filter(id => activeScene.find(o => o.id === id)?.type !== 'group').length; return gc >= 2 || (gc === 1 ? ngc < 1 : ngc < 2) })()}>Group</button>
        <button className="btn btn-compact" onClick={handleUngroup}
          disabled={!(selectedIds.length === 1 && activeScene.find(o => o.id === selectedIds[0])?.type === 'group')}>
          Ungroup
        </button>
      </div>

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
        {editorMode === 'live'
          ? <button className="btn btn-compact btn-danger" onClick={handleClearGlasses} style={{ color: '#f4a08a', borderColor: '#f4a08a' }}>Clear Glasses</button>
          : <button className="btn btn-compact btn-danger" onClick={activeClear} style={{ color: '#f4a08a', borderColor: '#f4a08a' }}>Clear Draft</button>
        }
      </div>

      {onClose && <>
        <span style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch', margin: '0 2px' }} />
        <button className="btn btn-compact" onClick={onClose} title="Close (Esc)">✕</button>
      </>}
    </div>
  )
}
