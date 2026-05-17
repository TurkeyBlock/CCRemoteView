import { create } from 'zustand'
import type { ChatMessage } from '../types/world'

// ─── Chat Log Store ────────────────────────────────────────────────────────────
// Global chat log capped at 500 entries (matches server-side cap).
// Populated by:
//   - Full-state hydration (server WS `state` / `stateChunk` messages)
//   - IndexedDB cache load on startup
//   - Per-transaction appends via the orchestrator in useComputers.applyTransactions

interface ChatState {
  chatLog: ChatMessage[]
}

export const useChatStore = create<ChatState>()(() => ({
  chatLog: [],
}))
