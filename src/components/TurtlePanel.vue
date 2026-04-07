<template>
  <div class="panel">
    <template v-if="world.computers[computerId]?.type === 'minecart'">
      <MinecartPanel :computerId="computerId" />
    </template>
    <template v-else>
      <TurtleInventory :computerId="computerId"/>
      <FuelGauge :computerId="computerId"/>
      <MovementControl :computerId="computerId"/>
      <LuaTerminal :computerId="computerId"/>
    </template>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>

<script lang="ts">
import { defineComponent } from "vue";
import MovementControl from "./MovementControl.vue";
import TurtleInventory from "./TurtleInventory.vue";
import LuaTerminal from "./LuaTerminal.vue"
import MinecartPanel from "./MinecartPanel.vue";
import { useWorldStore } from "../store/useWorld";
import FuelGauge from "./FuelGauge.vue";
import { useWorldViewStore } from "../store/useWorldView";

export default defineComponent({
  setup() {
    const world = useWorldStore();
    const worldView = useWorldViewStore();
    return { world, worldView }
  },
  components: { MovementControl, TurtleInventory, LuaTerminal, FuelGauge, MinecartPanel },
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
