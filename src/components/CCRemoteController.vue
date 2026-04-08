<template>
  <div class="hud">
    <h1 v-if="world.isUnauthorized" class="centered">
      Session expired. <a href="/api/signin">Sign in</a>
    </h1>
    <h1 v-else-if="world.isLoading" class="centered">
      LOADING ... (depending on the number of blocks this might take some
      seconds)
    </h1>
    <div class="hud-panel">
      <div class="panel-left">
        <a class="home-link" href="/api/home">← turkeyblock.org</a>
        <select v-model="worldView.selectedComputerId" @change="worldView.followComputer(worldView.selectedComputerId)">
          <option :value="-1">[None]</option>
          <option v-for="id in world.getComputerIds" :key="id" :value="id">
            {{ world.computers[id].type !== 'modem' && isStale(world.computers[id]) ? '⚠ ' : '' }}{{ world.computers[id].type === 'minecart' ? 'Minecart' : world.computers[id].type === 'modem' ? 'Modem' : 'Turtle' }} {{ id }}{{ world.computers[id].via_modem ? ' 📡' : world.computers[id].sleep_mode ? ' 💤' : '' }} : {{ world.computers[id].label }}
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
        <span v-if="user.loaded && user.isOperator && !user.isAdmin" class="operator-badge">Operator</span>
        <OperatorRequest v-if="user.loaded && !user.isOperator" />
        <AdminPanel v-if="user.isAdmin" ref="adminPanel" @opened="closeOtherPanels('adminPanel')" />
      </div>
    </div>
    <Inventory
      v-if="worldView.selectedInventory"
      :inventory="worldView.selectedInventory"
      :inventorySize="worldView.selectedInventorySize"
      style="grid-column: 2"
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

select {
  padding: 4px;
  border-radius: 4px;
  background-color: rgb(52, 52, 52);
  color: darkgray;
  font-weight: bold;
}
</style>

<script lang="ts">
import { defineComponent } from "vue";

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
    };
  },
  watch: {
    'worldView.selectedComputerId'(id: number) {
      if (id !== -1) {
        this.worldView.manualCenter = null;
        this.worldView.regenerateSceneFromBlocks();
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
    pollStatus() {
      const world = useWorldStore();
      const worldView = useWorldViewStore();

      fetch(world.apiURL + "getStateUpdate", {
        method: "POST",
        mode: "cors",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ lastTransactionId: world.lastTransactionId }),
      })
        .then((res) => {
          if (res.status === 401) { world.isUnauthorized = true; return null; }
          return res.json();
        })
        .then((data) => {
          if (!data) return;
          // console.log(data);
          if (data.state) {
            world.setComputerStatus(data.state.computers);
            world.blocks = data.state.world.blocks;
            worldView.regenerateSceneFromBlocks();
            world.lastTransactionId = data.state.lastTransactionId;
          } else {
            world.applyTransactions(data.transactions);
          }
          worldView.render();
        })
        .finally(() => {
          world.isLoading = false;
          if (!world.isUnauthorized) setTimeout(() => this.pollStatus(), 400);
        });

      if (worldView.selectedComputerId !== -1) {
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
      }
    },
    isStale,
  },
  mounted() {
    useUserStore().startPolling();
    this.pollStatus();
  },
  beforeUnmount() {
    useUserStore().stopPolling();
  },
});
</script>
