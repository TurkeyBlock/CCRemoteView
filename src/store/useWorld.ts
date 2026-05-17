// ─── Backward-compat shim ─────────────────────────────────────────────────────
// The original `useWorldStore` god store has been split into three focused
// stores. This file re-exports everything from the new files so existing
// consumers keep working without import changes.
//
//   - Block data + mutations  → useBlockWorld.ts
//   - Computers, commands, WS → useComputers.ts
//   - Chat log                → useChat.ts
//
// New code should import directly from the underlying store modules.

export {
  worldPalette,
  worldData,
  worldDataLen,
  lookupBlock,
  replaceWorldBlocks,
  useBlockWorldStore,
} from './useBlockWorld'

export { useChatStore } from './useChat'

// Primary alias — most consumers still import this name.
export { useComputersStore as useWorldStore } from './useComputers'
