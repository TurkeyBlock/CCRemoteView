// ─── Backward-compat shim ─────────────────────────────────────────────────────
// The original `useWorldViewStore` god store has been split into four focused
// stores. This file re-exports them so existing consumers keep working through
// the same import path (`@/store/useWorldView`).
//
//   - Camera / viewport state → useViewport.ts        (exported as useWorldViewStore)
//   - Transparency / mining   → useRenderFilters.ts   (useRenderFiltersStore)
//   - Texture / materials     → useTextures.ts        (useTexturesStore)
//   - Glasses editor mutable  → useEditorState.ts     (useEditorStateStore)
//
// New code should import directly from the underlying store modules.

// Primary alias — most consumers still import this name.
export { useViewportStore as useWorldViewStore } from './useViewport'

export { useRenderFiltersStore } from './useRenderFilters'

export {
  useTexturesStore,
  getBlockMaterial,
  getBlockGeometry,
  getBlockIconInfo,
  getItemIconInfo,
  clearMaterialsCache,
} from './useTextures'

export { useEditorStateStore } from './useEditorState'
