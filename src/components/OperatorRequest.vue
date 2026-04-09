<template>
  <div class="operator-request">
    <button class="toggle" @click="open = !open">{{ open ? '▾' : '▸' }} Operator access</button>
    <div v-if="open">
      <a v-if="!user.isLoggedIn" class="action" href="/api/signin">Sign in</a>
      <template v-else>
        <p v-if="message" class="message">{{ message }}</p>
        <button v-else class="action" @click="request" :disabled="loading">Request access</button>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useUserStore } from '../store/useUser';

export default defineComponent({
  setup() {
    return { user: useUserStore() };
  },
  data() {
    return {
      open: false,
      loading: false,
      message: '' as string,
    };
  },
  methods: {
    async request() {
      this.loading = true;
      const res = await fetch('/api/requestOperator', { method: 'POST' }).catch(() => null);
      if (!res) { this.message = 'Could not reach server.'; return; }
      const data = await res.json();
      if (data.result === 'ok') { this.message = 'Request submitted. An admin will review it.'; await useUserStore().fetchMe(); }
      else if (data.result === 'already_requested') this.message = 'You already have a pending request.';
      else if (data.result === 'already_operator') this.message = 'You are already an operator.';
      else this.message = 'Something went wrong.';
      this.loading = false;
    },
  },
});
</script>

<style scoped>
.operator-request {
  background: rgb(30, 30, 30);
  border: 1px solid rgb(70, 70, 70);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.85em;
}

.toggle {
  background: none;
  border: none;
  color: gray;
  cursor: pointer;
  font-size: 0.85em;
  padding: 0;
}

.toggle:hover {
  color: darkgray;
}

.message {
  margin: 4px 0 0 0;
  color: darkgray;
  font-style: italic;
}

.action {
  margin-top: 4px;
  padding: 3px 10px;
  border-radius: 4px;
  border: none;
  background: rgb(52, 52, 52);
  color: darkgray;
  cursor: pointer;
  font-size: 1em;
}

.action:hover:not(:disabled) {
  background: rgb(70, 70, 70);
  color: white;
}

.action:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
