import { create } from 'zustand'
import type { EditorMutableState } from '../components/computers/player/glassesEditorTypes'
import { DEFAULT_EDITOR_MUTABLE } from '../components/computers/player/glassesEditorTypes'

interface EditorStateState {
  glassesEditorMutable: Record<number, EditorMutableState>
  updateGlassesEditor: (computerId: number, patch: Partial<EditorMutableState>) => void
}

export const useEditorStateStore = create<EditorStateState>()((set) => ({
  glassesEditorMutable: {},
  updateGlassesEditor: (computerId, patch) => set(s => ({
    glassesEditorMutable: {
      ...s.glassesEditorMutable,
      [computerId]: { ...(s.glassesEditorMutable[computerId] ?? DEFAULT_EDITOR_MUTABLE), ...patch },
    },
  })),
}))
