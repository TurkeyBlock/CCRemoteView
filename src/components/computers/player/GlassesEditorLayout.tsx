'use client'

// Shared toolbar/sidebar shell for the glasses canvas editor.
// Composes Toolbar, ObjectList, PropertiesPanel, and a caller-supplied canvas area.
// Used by both the modal editor (GlassesEditor) and the live-view overlay in Scene.
import type React from 'react'
import { JSON_CAP } from './glassesEditorTypes'
import type { EditorState } from './useGlassesEditor'
import { PropertiesPanel } from './PropertiesPanel'
import { ObjectList } from './ObjectList'
import { Toolbar } from './Toolbar'

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
