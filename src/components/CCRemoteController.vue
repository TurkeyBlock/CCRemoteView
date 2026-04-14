<template>
  <div class="hud">
    <h1 v-if="world.isLoading" class="centered">
      LOADING ... (depending on the number of blocks this might take some
      seconds)
    </h1>
    <div class="hud-panel">
      <div class="panel-left">
        <a class="home-link" href="/api/home">← turkeyblock.org</a>
        <div class="modem-status" :class="world.modemServerId !== null ? 'modem-online' : 'modem-offline'">
          📡 Modem: {{ world.modemServerId !== null ? `online (id ${world.modemServerId})` : 'offline' }}
        </div>
        <select v-model="worldView.selectedComputerId" @change="worldView.followComputer(worldView.selectedComputerId)">
          <option :value="-1">[None]</option>
          <option v-for="id in world.getComputerIds" :key="id" :value="id">
            {{ world.computers[id].type === 'minecart' ? 'Minecart' : world.computers[id].type === 'modem' ? 'Modem' : 'Turtle' }} {{ id }}{{ world.computers[id].type === 'modem' ? (world.modemServerId !== null ? ' [online]' : ' [offline]') : ((world.computers[id].via_modem ? ' 📡' : '') + (world.computers[id].sleep_mode ? ' 💤' : '') + (isStale(world.computers[id]) ? ' [offline]' : ' [online]')) }} : {{ world.computers[id].label }}
          </option>
        </select>
        <div v-if="worldView.selectedComputerId === -1" class="manual-center">
          <span class="manual-center-label">Center</span>
          <input type="number" v-model.number="manualX" placeholder="X" class="coord-input" @change="applyManualCenter" />
          <input type="number" v-model.number="manualZ" placeholder="Z" class="coord-input" @change="applyManualCenter" />
        </div>
        <TurtlePanel
          v-if="Number(worldView.selectedComputerId) != -1"
          :computerId="Number(worldView.selectedComputerId)"
        />
      </div>
      <div class="panel-right">
        <RenderFilters ref="renderFilters" @opened="closeOtherPanels('renderFilters')" />
        <BlockTransparency ref="blockTransparency" @opened="closeOtherPanels('blockTransparency')" />
        <div v-if="isGuest" class="guest-controls">
          <a href="/api/signin" class="guest-signin">Sign in</a>
          <button
            class="guest-refresh-btn"
            :disabled="guestRefreshDisabled"
            @click="guestRefresh"
          >{{ guestRefreshDisabled ? 'Refreshed ✓' : 'Refresh' }}</button>
        </div>
        <span v-if="user.loaded && user.isOperator && !user.isAdmin" class="operator-badge">Operator</span>
        <OperatorRequest v-if="user.loaded && !user.isOperator && !isGuest" />
        <AdminPanel v-if="user.isAdmin" ref="adminPanel" @opened="closeOtherPanels('adminPanel')" />
      </div>
    </div>
    <Inventory
      v-if="worldView.selectedInventory"
      :inventory="worldView.selectedInventory"
      :inventorySize="worldView.selectedInventorySize"
      style="grid-column: 2; pointer-events: auto"
    />
    <Scene />
    <KeyboardBindings />
    <BlockNameDisplay />
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  display: grid;
  user-select: none;
  pointer-events: none;
}
.centered {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.hud-panel {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  pointer-events: auto;
}

.panel-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 240px;
  background: rgb(30, 30, 30);
  border: 1px solid rgb(70, 70, 70);
  border-radius: 6px;
  padding: 8px 12px;
}

.panel-right {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 6px;
}

.home-link {
  color: darkgray;
  font-size: 0.85em;
  text-decoration: none;
}

.home-link:hover {
  color: white;
}

.operator-badge {
  font-size: 0.75em;
  color: rgb(80, 180, 80);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.manual-center {
  display: flex;
  align-items: center;
  gap: 4px;
}

.manual-center-label {
  font-size: 0.75em;
  color: gray;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.coord-input {
  width: 64px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid rgb(70, 70, 70);
  background: rgb(40, 40, 40);
  color: darkgray;
  font-size: 0.85em;
  text-align: center;
}

.coord-input:focus {
  outline: none;
  border-color: rgb(100, 100, 100);
}

.guest-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgb(30, 30, 30);
  border: 1px solid rgb(70, 70, 70);
  border-radius: 6px;
  padding: 6px 10px;
}

.guest-signin {
  color: darkgray;
  font-size: 0.85em;
  text-decoration: none;
}

.guest-signin:hover {
  color: white;
}

.guest-refresh-btn {
  padding: 3px 10px;
  border-radius: 4px;
  border: none;
  background: rgb(52, 52, 52);
  color: darkgray;
  cursor: pointer;
  font-size: 0.85em;
}

.guest-refresh-btn:hover:not(:disabled) {
  background: rgb(70, 70, 70);
  color: white;
}

.guest-refresh-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

select {
  padding: 4px;
  border-radius: 4px;
  background-color: rgb(52, 52, 52);
  color: darkgray;
  font-weight: bold;
}

.modem-status {
  font-size: 0.75em;
  letter-spacing: 0.03em;
}
.modem-online { color: rgb(80, 200, 80); }
.modem-offline { color: rgb(120, 120, 120); }
</style>

<script lang="ts">
import { defineComponent } from "vue";
import * as THREE from "three";

import { useWorldStore } from "../store/useWorld";
import { isStale } from "../utils/stale";
import { useWorldViewStore } from "../store/useWorldView";
import { useUserStore } from "../store/useUser";
import TurtlePanel from "./TurtlePanel.vue";
import Inventory from "./Inventory.vue";
import BlockNameDisplay from "./BlockNameDisplay.vue";
import Scene from "./Scene.vue";
import KeyboardBindings from "./KeyboardBindings.vue";
import AdminPanel from "./AdminPanel.vue";
import OperatorRequest from "./OperatorRequest.vue";
import BlockTransparency from "./BlockTransparency.vue";
import RenderFilters from "./RenderFilters.vue";

export default defineComponent({
  setup() {
    const world = useWorldStore();
    const worldView = useWorldViewStore();
    const user = useUserStore();
    return { world, worldView, user };
  },
  data() {
    return {
      computerId: -1 as Number,
      manualX: null as number | null,
      manualZ: null as number | null,
      _ws: null as WebSocket | null,
      _wsBackoff: 1000 as number,
      _wsReconnectTimeout: null as ReturnType<typeof setTimeout> | null,
      _cmdResultInterval: null as ReturnType<typeof setInterval> | null,
      _modemStatusInterval: null as ReturnType<typeof setInterval> | null,
      isGuest: false,
      guestRefreshDisabled: false,
      _guestRefreshTimer: null as ReturnType<typeof setTimeout> | null,
    };
  },
  watch: {
    'worldView.selectedComputerId'(id: number) {
      if (id === -1) return;
      this.worldView.manualCenter = null;
      // Only rebuild the scene when a range filter is active — that's the only
      // case where the visible block set actually changes with the computer.
      // Otherwise just reposition the camera.
      if (this.worldView.computerRangeXZ !== null) {
        this.worldView.regenerateSceneFromBlocks();
      } else {
        this.worldView.focusOnComputer(id);
      }
    },
  },
  components: {
    TurtlePanel,
    Scene,
    BlockNameDisplay,
    Inventory,
    KeyboardBindings,
    AdminPanel,
    OperatorRequest,
    BlockTransparency,
    RenderFilters,
  },
  methods: {
    applyManualCenter() {
      if (this.manualX !== null && this.manualZ !== null) {
        this.worldView.manualCenter = { x: this.manualX, z: this.manualZ };
        this.worldView.setCameraFocus(new THREE.Vector3(this.manualX, 64, this.manualZ));
      } else {
        this.worldView.manualCenter = null;
      }
      this.worldView.regenerateSceneFromBlocks();
    },
    closeOtherPanels(except: string) {
      (['renderFilters', 'blockTransparency', 'adminPanel'] as const).forEach(name => {
        if (name !== except) {
          const ref = this.$refs[name] as any;
          if (ref) ref.open = false;
        }
      });
    },
    connectWebSocket() {
      const world = useWorldStore();
      const worldView = useWorldViewStore();

      const wsUrl = world.URL
        ? world.URL.replace(/^http/, 'ws')
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

      const ws = new WebSocket(wsUrl);
      this._ws = ws;

      ws.onopen = () => {
        this._wsBackoff = 1000;
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.state) {
          world.setComputerStatus(data.state.computers);
          world.blocks = data.state.world.blocks;
          if (!world.computers[worldView.selectedComputerId]?.loc) {
            const entry = Object.entries(world.computers).find(([, c]) => c.loc);
            if (entry) worldView.selectedComputerId = Number(entry[0]);
          }
          worldView.regenerateSceneFromBlocks();
          world.lastTransactionId = data.state.lastTransactionId;
        } else {
          world.applyTransactions(data.transactions);
        }
        worldView.render();
        world.isLoading = false;
      };

      ws.onclose = (event) => {
        if (event.code === 4401) {
          this.isGuest = true;
          if (this._cmdResultInterval) { clearInterval(this._cmdResultInterval); this._cmdResultInterval = null; }
          this.loadGuestState();
          return;
        }
        const delay = this._wsBackoff;
        this._wsBackoff = Math.min(this._wsBackoff * 2, 10000);
        this._wsReconnectTimeout = setTimeout(() => this.connectWebSocket(), delay);
      };

      ws.onerror = () => ws.close();
    },
    async pollModemStatus() {
      const world = useWorldStore();
      const res = await fetch(world.apiURL + 'modem/id').catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json().catch(() => null);
      if (data) world.modemServerId = data.id ?? null;
    },
    pollCommandResult() {
      const world = useWorldStore();
      const worldView = useWorldViewStore();
      if (worldView.selectedComputerId === -1) return;
      fetch(world.apiURL + "getCommandResult", {
        method: "POST",
        mode: "cors",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          computerId: worldView.selectedComputerId,
          getOnlyLatest: true,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.result) {
            world.commandResult[data.computerId] = data.result.ret;
          }
        });
    },
    async loadGuestState() {
      const world = useWorldStore();
      const worldView = useWorldViewStore();
      const res = await fetch('/api/state').catch(() => null);
      if (!res) return;
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        this.startGuestCooldown(data.retryAfter ?? 30);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data) return;
      world.setComputerStatus(data.computers);
      world.blocks = data.world.blocks;
      if (!world.computers[worldView.selectedComputerId]?.loc) {
        const entry = Object.entries(world.computers).find(([, c]) => c.loc);
        if (entry) worldView.selectedComputerId = Number(entry[0]);
      }
      worldView.regenerateSceneFromBlocks();
      worldView.render();
      world.isLoading = false;
      this.startGuestCooldown(30);
    },
    guestRefresh() {
      if (this.guestRefreshDisabled) return;
      this.loadGuestState();
    },
    startGuestCooldown(seconds: number) {
      this.guestRefreshDisabled = true;
      if (this._guestRefreshTimer) clearTimeout(this._guestRefreshTimer);
      this._guestRefreshTimer = setTimeout(() => {
        this.guestRefreshDisabled = false;
        this._guestRefreshTimer = null;
      }, seconds * 1000);
    },
    isStale,
  },
  mounted() {
    useUserStore().startPolling();
    this.connectWebSocket();
    this._cmdResultInterval = setInterval(() => this.pollCommandResult(), 400);
    this.pollModemStatus();
    this._modemStatusInterval = setInterval(() => this.pollModemStatus(), 15000);
  },
  beforeUnmount() {
    useUserStore().stopPolling();
    if (this._ws) { this._ws.onclose = null; this._ws.close(); }
    if (this._wsReconnectTimeout) clearTimeout(this._wsReconnectTimeout);
    if (this._cmdResultInterval) clearInterval(this._cmdResultInterval);
    if (this._modemStatusInterval) clearInterval(this._modemStatusInterval);
    if (this._guestRefreshTimer) clearTimeout(this._guestRefreshTimer);
  },
});
</script>
