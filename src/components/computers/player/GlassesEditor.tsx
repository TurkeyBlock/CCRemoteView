'use client'

import { createPortal } from 'react-dom'
import { useGlassesEditor } from './useGlassesEditor'
import GlassesEditorLayout from './GlassesEditorLayout'
import GlassesSvgCanvas from './GlassesSvgCanvas'
import { JSON_CAP } from './glassesEditorTypes'

interface Props { computerId: number }

export default function GlassesEditor({ computerId }: Props) {
  const editor = useGlassesEditor(computerId)
  const { liveObjects, liveJsonLen, open, setOpen, isLiveView, setLiveView, importOpen, setImportOpen, importText, setImportText, handleImportConfirm } = editor

  const meterColor = liveJsonLen > JSON_CAP * 0.94 ? 'var(--red)' : liveJsonLen > JSON_CAP * 0.75 ? '#f5a623' : 'var(--fg-dim)'

  return (
    <>
      {/* Compact trigger shown inside the PlayerPanel section */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-mute)' }}>
          {liveObjects.length === 0
            ? 'No objects in scene.'
            : <>{liveObjects.length} object{liveObjects.length !== 1 ? 's' : ''} · <span style={{ color: meterColor }}>{liveJsonLen.toLocaleString()}/{JSON_CAP.toLocaleString()} chars</span></>}
        </span>
        <button className="btn btn-compact" onClick={() => setOpen(true)} disabled={isLiveView} title={isLiveView ? 'Exit Live-view to open the editor' : undefined}>Open Editor</button>
        <button
          className={`btn btn-compact${isLiveView ? ' btn-toggled' : ''}`}
          onClick={() => setLiveView(computerId)}
          title={isLiveView ? 'Exit Live-view' : 'Live-view: draw on the player\'s first-person view'}
        >{isLiveView ? 'Exit Live-view' : 'Live-view'}</button>
      </div>

      {/* Main modal */}
      {open && !isLiveView && typeof document !== 'undefined' && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onPointerDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div style={{ width: 'min(1600px, 98vw)', height: '95vh', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <GlassesEditorLayout
              editor={editor}
              canvasArea={
                <div style={{ width: '100%', height: '100%', background: '#0e0e0e' }}>
                  <GlassesSvgCanvas editor={editor} bgFill="#111" />
                </div>
              }
              onClose={() => setOpen(false)}
            />
          </div>
        </div>,
        document.body
      )}

      {/* Import modal */}
      {importOpen && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 440, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Import Scene JSON</div>
            <textarea value={importText} onChange={e => setImportText(e.target.value)}
              style={{ width: '100%', height: 200, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '4px 6px', fontSize: 11, fontFamily: 'var(--font-mono)', resize: 'vertical', boxSizing: 'border-box' }}
              placeholder="Paste JSON array here…" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-compact" onClick={() => { setImportOpen(false); setImportText('') }}>Cancel</button>
              <button className="btn btn-compact btn-primary" onClick={handleImportConfirm}>Import</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
