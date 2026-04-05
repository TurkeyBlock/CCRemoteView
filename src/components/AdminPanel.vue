<template>
  <div class="admin-panel">
    <button class="toggle" @click="toggleOpen">{{ open ? '▾' : '▸' }} Admin</button>
    <div v-if="open" class="dropdown">

    <div v-if="pending.length">
      <p class="section-label">Pending</p>
      <div v-for="ip in pending" :key="ip" class="ip-row">
        <span>{{ ip }}</span>
        <div class="btn-group">
          <button @click="approve(ip)">Approve</button>
          <button class="revoke" @click="deny(ip)">Deny</button>
        </div>
      </div>
    </div>
    <p v-else class="empty">No pending turtles.</p>

    <div v-if="approved.length" style="margin-top: 8px;">
      <p class="section-label">Approved IPs</p>
      <div v-for="ip in approved" :key="ip" class="ip-row">
        <span>{{ ip }}</span>
        <button class="revoke" @click="revoke(ip)">Revoke</button>
      </div>
    </div>

    <div style="margin-top: 8px;">
      <p class="section-label">Pending Turtle IDs</p>
      <div v-if="pendingIds.length">
        <div v-for="t in pendingIds" :key="t.id" class="ip-row">
          <span class="request-info">
            <span class="email">ID {{ t.id }}</span>
            <span class="sub">from {{ t.ip }}</span>
          </span>
          <div class="btn-group">
            <button @click="approveTurtleId(t.id)">Approve</button>
            <button class="revoke" @click="denyTurtleId(t.id)">Deny</button>
          </div>
        </div>
      </div>
      <p v-else class="empty">No pending turtle IDs.</p>
    </div>

    <div v-if="approvedIds.length" style="margin-top: 8px;">
      <p class="section-label">Approved Turtle IDs</p>
      <div v-for="id in approvedIds" :key="id" class="ip-row">
        <span>ID {{ id }}</span>
        <button class="revoke" @click="revokeTurtleId(id)">Revoke</button>
      </div>
    </div>

    <div class="allow-by-ip-row" style="margin-top: 10px;">
      <label class="warning-label">⚠ Allow by IP (override)</label>
      <input type="checkbox" :checked="allowByIp" @change="setAllowByIp(($event.target as HTMLInputElement).checked)" />
    </div>
    <p class="warning-text" v-if="allowByIp">
      Any turtle from an approved IP can connect without individual ID approval.
    </p>

    <hr class="divider" />

    <h3>Operator Requests</h3>
    <div v-if="operatorRequests.length">
      <div v-for="r in operatorRequests" :key="r.sub" class="ip-row">
        <span class="request-info">
          <span class="email">{{ r.email }}</span>
          <span class="sub">{{ r.sub }}</span>
        </span>
        <div class="btn-group">
          <button @click="approveOperator(r.sub)">Approve</button>
          <button class="revoke" @click="denyOperator(r.sub)">Deny</button>
        </div>
      </div>
    </div>
    <p v-else class="empty">No pending requests.</p>

    <div v-if="operators.length" style="margin-top: 8px;">
      <h3>Operators</h3>
      <div v-for="op in operators" :key="op.sub" class="ip-row">
        <span class="op-info">
          <span class="email">{{ op.email ?? '—' }}</span>
          <span class="sub">{{ op.sub }}</span>
        </span>
        <button class="revoke" @click="revokeOperator(op.sub)">Revoke</button>
      </div>
    </div>

    <hr class="divider" />

    <h3>Turtles</h3>
    <div v-if="Object.keys(world.turtles).length">
      <div v-for="(turtle, id) in world.turtles" :key="id" class="ip-row">
        <span :class="{ stale: isStale(turtle) }">
          #{{ id }} {{ turtle.label ?? '' }}
          <span v-if="isStale(turtle)" class="stale-label">(stale)</span>
        </span>
        <button class="revoke" @click="deleteTurtle(id)">Delete</button>
      </div>
    </div>
    <p v-else class="empty">No tracked turtles.</p>

    <hr class="divider" />

    <button class="danger" @click="clearWorld" :disabled="clearingWorld">
      {{ clearingWorld ? '⟳ Clearing...' : 'Clear World' }}
    </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useUserStore } from '../store/useUser';
import { useWorldStore } from '../store/useWorld';
import { isStale } from '../utils/stale';

export default defineComponent({
  setup() {
    const world = useWorldStore();
    return { world };
  },
  data() {
    return {
      open: false,
      pending: [] as string[],
      approved: [] as string[],
      pendingIds: [] as { id: string; ip: string; requestedAt: number }[],
      approvedIds: [] as string[],
      allowByIp: true,
      operatorRequests: [] as { sub: string; email: string; requestedAt: number }[],
      operators: [] as { sub: string; email: string | null }[],
      pollHandle: null as ReturnType<typeof setTimeout> | null,
      clearingWorld: false,
    };
  },
  emits: ['opened'],
  methods: {
    toggleOpen() {
      this.open = !this.open;
      if (this.open) this.$emit('opened');
    },
    async fetchAll() {
      try {
        const [ips, ids, requests, ops] = await Promise.all([
          fetch('/api/admin/turtleIps').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/admin/turtleIds').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/admin/operatorRequests').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/admin/operators').then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (ips) { this.pending = ips.pending; this.approved = ips.approved; }
        if (ids) { this.pendingIds = ids.pending; this.approvedIds = ids.approved; this.allowByIp = ids.allowByIp; }
        if (requests) this.operatorRequests = requests;
        if (ops) this.operators = ops;
      } finally {
        this.pollHandle = setTimeout(() => this.fetchAll(), 30000);
      }
    },
    async fetchIps() { return this.fetchAll(); },
    async approve(ip: string) {
      await fetch('/api/admin/approveTurtle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip }),
      });
      await this.fetchIps();
    },
    async deny(ip: string) {
      await fetch('/api/admin/denyTurtle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip }),
      });
      await this.fetchIps();
    },
    async revoke(ip: string) {
      await fetch('/api/admin/revokeTurtle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip }),
      });
      await this.fetchAll();
    },
    async approveTurtleId(id: string) {
      await fetch('/api/admin/approveTurtleId', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      await this.fetchAll();
    },
    async denyTurtleId(id: string) {
      await fetch('/api/admin/denyTurtleId', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      await this.fetchAll();
    },
    async revokeTurtleId(id: string) {
      await fetch('/api/admin/revokeTurtleId', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      await this.fetchAll();
    },
    async setAllowByIp(enabled: boolean) {
      await fetch('/api/admin/setAllowByIp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      await this.fetchAll();
    },
    async approveOperator(sub: string) {
      await fetch('/api/admin/approveOperator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub }) });
      await Promise.all([this.fetchAll(), useUserStore().fetchMe()]);
    },
    async denyOperator(sub: string) {
      await fetch('/api/admin/denyOperatorRequest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub }) });
      await Promise.all([this.fetchAll(), useUserStore().fetchMe()]);
    },
    async revokeOperator(sub: string) {
      await fetch('/api/admin/revokeOperator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub }) });
      await Promise.all([this.fetchAll(), useUserStore().fetchMe()]);
    },
    isStale,
    async deleteTurtle(id: string | number) {
      await fetch('/api/admin/deleteTurtle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      this.world.removeTurtle(id);
      await this.fetchAll();
    },
    async clearWorld() {
      this.clearingWorld = true;
      await Promise.all([
        fetch('/api/admin/clearWorld', { method: 'POST' }).then(() => this.world.clearBlocks()),
        new Promise(r => setTimeout(r, 500)),
      ]);
      this.clearingWorld = false;
    },

  },
  mounted() {
    this.fetchAll();
  },
  beforeUnmount() {
    if (this.pollHandle) clearTimeout(this.pollHandle);
  },

});
</script>

<style scoped>
.toggle {
  background: none;
  border: none;
  color: gray;
  cursor: pointer;
  font-size: 0.85em;
  padding: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.toggle:hover {
  color: darkgray;
}

.admin-panel {
  position: relative;
  background: rgb(30, 30, 30);
  border: 1px solid rgb(70, 70, 70);
  border-radius: 6px;
  padding: 8px 12px;
}

.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  background: rgb(30, 30, 30);
  border: 1px solid rgb(70, 70, 70);
  border-radius: 6px;
  padding: 8px 12px;
  min-width: 220px;
  margin-top: 2px;
}

h3 {
  margin: 0 0 6px 0;
  font-size: 0.85em;
  color: darkgray;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-label {
  margin: 0 0 4px 0;
  font-size: 0.75em;
  color: gray;
}

.ip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 0.85em;
  color: darkgray;
}

.empty {
  font-size: 0.8em;
  color: gray;
  margin: 0;
}

button {
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  background: rgb(60, 120, 60);
  color: white;
  cursor: pointer;
  font-size: 0.8em;
}

button:hover {
  background: rgb(80, 150, 80);
}

.btn-group {
  display: flex;
  gap: 4px;
}

.divider {
  border: none;
  border-top: 1px solid rgb(60, 60, 60);
  margin: 10px 0;
}

.request-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.op-info {
  display: flex;
  flex-direction: row;
  gap: 6px;
  align-items: center;
}

.email {
  color: darkgray;
}

.sub {
  font-size: 0.75em;
  color: gray;
}

button.revoke {
  background: rgb(120, 50, 50);
}

button.revoke:hover {
  background: rgb(160, 60, 60);
}

button.danger {
  background: rgb(140, 60, 20);
  width: 100%;
  padding: 4px;
  margin-top: 4px;
}

button.danger:hover {
  background: rgb(180, 80, 30);
}

.stale {
  color: rgb(180, 140, 40);
}

.stale-label {
  font-size: 0.75em;
  opacity: 0.8;
}

.allow-by-ip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.warning-label {
  font-size: 0.8em;
  color: rgb(220, 160, 40);
  font-weight: bold;
}

.warning-text {
  font-size: 0.75em;
  color: rgb(200, 130, 30);
  margin: 4px 0 0 0;
  padding: 4px 6px;
  background: rgb(60, 40, 10);
  border: 1px solid rgb(120, 80, 20);
  border-radius: 4px;
}
</style>
