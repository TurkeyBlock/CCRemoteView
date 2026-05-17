import { create } from 'zustand'
import { fetchWithTimeout } from '@/utils/fetchWithTimeout'

interface UserState {
  username: string | null
  email: string | null
  isLoggedIn: boolean
  isAdmin: boolean
  isOperator: boolean
  loaded: boolean
  savedFileSizeBytes: number | null
  _pollHandle: ReturnType<typeof setTimeout> | null
  fetchMe: () => Promise<void>
  startPolling: (intervalMs?: number) => void
  stopPolling: () => void
}

export const useUserStore = create<UserState>()((set, get) => ({
  username: null,
  email: null,
  isLoggedIn: false,
  isAdmin: false,
  isOperator: false,
  loaded: false,
  savedFileSizeBytes: null,
  _pollHandle: null,

  fetchMe: async () => {
    const res = await fetchWithTimeout('/api/me').catch(() => null)
    if (!res || !res.ok) return
    const data = await res.json()
    const s = get()
    const isLoggedIn = data.isLoggedIn ?? false
    const username = data.username ?? null
    const email = data.email ?? null
    const isAdmin = data.isAdmin
    const isOperator = data.isOperator
    const savedFileSizeBytes = data.savedFileSizeBytes ?? null
    if (
      s.loaded &&
      s.isLoggedIn === isLoggedIn &&
      s.username === username &&
      s.email === email &&
      s.isAdmin === isAdmin &&
      s.isOperator === isOperator &&
      s.savedFileSizeBytes === savedFileSizeBytes
    ) return
    set({ isLoggedIn, username, email, isAdmin, isOperator, savedFileSizeBytes, loaded: true })
  },

  startPolling: (intervalMs = 30000) => {
    const poll = async () => {
      await get().fetchMe()
      set({ _pollHandle: setTimeout(poll, intervalMs) })
    }
    poll()
  },

  stopPolling: () => {
    const handle = get()._pollHandle
    if (handle) clearTimeout(handle)
    set({ _pollHandle: null })
  },
}))
