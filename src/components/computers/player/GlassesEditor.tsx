'use client'

import { FS } from '@/utils/fontSize'
// Modal wrapper for the glasses canvas editor, rendered from PlayerPanel.
// Thin shell: owns the open/closed trigger button and JSON size meter shown in the
// PlayerPanel section; delegates all editor logic to useGlassesEditor and
// all layout to GlassesEditorLayout.
import { createPortal } from 'react-dom'
import { Modal } from '@/components/modals/Modal'
import { useGlassesEditor } from './useGlassesEditor'
import GlassesEditorLayout from './GlassesEditorLayout'
import GlassesSvgCanvas from './GlassesSvgCanvas'
import { JSON_CAP } from './glassesEditorTypes'

interface Props { computerId: number }

function getMeterColor(len: number, cap: number): string {
  if (len > cap * 0.94) return 'var(--red)';
  if (len > cap * 0.75) return '#f5a623';
  return 'var(--fg-dim)';
}

export default function GlassesEditor({ computerId }: Props) {
  const editor = useGlassesEditor(computerId)
  const { liveObjects, liveJsonLen, open, setOpen, isLiveView, setLiveView, importOpen, setImportOpen, importText, setImportText, handleImportConfirm } = editor

  const meterColor = getMeterColor(liveJsonLen, JSON_CAP)

  return (
    <>
      {/* Compact trigger shown inside the PlayerPanel section */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: FS['11'], color: 'var(--fg-mute)' }}>
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
        <Modal layer="editor" dim={0.65} onBackdropPointerDown={() => setOpen(false)}>
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
        </Modal>,
        document.body
      )}

      {/* Import modal */}
      {importOpen && typeof document !== 'undefined' && createPortal(
        <Modal layer="confirmTop" dim={0.7}>
          <div style={{ width: 440, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: FS['13'], fontWeight: 600 }}>Import Scene JSON</div>
            <textarea value={importText} onChange={e => setImportText(e.target.value)}
              style={{ width: '100%', height: 200, background: 'var(--surface-3)', border: '1px solid var(--line)', borderRadius: 2, color: 'var(--fg)', padding: '4px 6px', fontSize: FS['11'], fontFamily: 'var(--font-mono)', resize: 'vertical', boxSizing: 'border-box' }}
              placeholder="Paste JSON array here…" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-compact" onClick={() => { setImportOpen(false); setImportText('') }}>Cancel</button>
              <button className="btn btn-compact btn-primary" onClick={handleImportConfirm}>Import</button>
            </div>
          </div>
        </Modal>,
        document.body
      )}
    </>
  )
}
