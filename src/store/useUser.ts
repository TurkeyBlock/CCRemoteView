import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    username: null as string | null,
    email: null as string | null,
    isLoggedIn: false,
    isAdmin: false,
    isOperator: false,
    loaded: false,
    savedFileSizeBytes: null as number | null,
    _pollHandle: null as ReturnType<typeof setTimeout> | null,
  }),
  actions: {
    async fetchMe() {
      const res = await fetch('/api/me').catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json();
      this.isLoggedIn = data.isLoggedIn ?? false;
      this.username = data.username ?? null;
      this.email = data.email ?? null;
      this.isAdmin = data.isAdmin;
      this.isOperator = data.isOperator;
      this.savedFileSizeBytes = data.savedFileSizeBytes ?? null;
      this.loaded = true;
    },
    startPolling(intervalMs = 30000) {
      const poll = async () => {
        await this.fetchMe();
        this._pollHandle = setTimeout(poll, intervalMs);
      };
      poll();
    },
    stopPolling() {
      if (this._pollHandle) clearTimeout(this._pollHandle);
    },
  },
})
