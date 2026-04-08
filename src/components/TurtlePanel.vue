<template>
  <div class="panel">
    <template v-if="world.computers[computerId]?.type === 'modem'">
      <ModemPanel :computerId="computerId" />
    </template>
    <template v-else>
      <div class="connection-badge" :class="world.computers[computerId]?.via_modem ? 'via-modem' : 'via-http'">
        {{ world.computers[computerId]?.via_modem ? '📡 via Modem' : '⟳ Direct HTTP' }}
      </div>
      <template v-if="world.computers[computerId]?.type === 'minecart'">
        <MinecartPanel :computerId="computerId" />
      </template>
      <template v-else>
        <div v-if="world.computers[computerId]?.loc" class="location">
          📍 {{ world.computers[computerId].loc.x }}, {{ world.computers[computerId].loc.y }}, {{ world.computers[computerId].loc.z }}
        </div>
        <TurtleInventory :computerId="computerId"/>
        <FuelGauge :computerId="computerId"/>
        <MovementControl :computerId="computerId"/>
        <LuaTerminal :computerId="computerId"/>
      </template>
    </template>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.location {
  font-size: 0.85em;
  color: darkgray;
  padding: 2px 4px;
}
.connection-badge {
  font-size: 0.75em;
  padding: 2px 6px;
  border-radius: 3px;
  letter-spacing: 0.04em;
  align-self: flex-start;
}
.via-modem {
  background-color: rgba(80, 140, 200, 0.2);
  color: rgb(120, 180, 240);
  border: 1px solid rgba(80, 140, 200, 0.3);
}
.via-http {
  background-color: rgba(80, 80, 80, 0.2);
  color: gray;
  border: 1px solid rgba(80, 80, 80, 0.3);
}
</style>

<script lang="ts">
import { defineComponent } from "vue";
import MovementControl from "./MovementControl.vue";
import TurtleInventory from "./TurtleInventory.vue";
import LuaTerminal from "./LuaTerminal.vue"
import MinecartPanel from "./MinecartPanel.vue";
import ModemPanel from "./ModemPanel.vue";
import { useWorldStore } from "../store/useWorld";
import FuelGauge from "./FuelGauge.vue";
import { useWorldViewStore } from "../store/useWorldView";

export default defineComponent({
  setup() {
    const world = useWorldStore();
    const worldView = useWorldViewStore();
    return { world, worldView }
  },
  components: { MovementControl, TurtleInventory, LuaTerminal, FuelGauge, MinecartPanel, ModemPanel },
  props: {
    computerId: {
      required: true,
      type: Number
    },
  },
  mounted() {
    this.worldView.followComputer(this.computerId);
  },
});
</script>
