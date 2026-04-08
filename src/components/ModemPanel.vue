<template>
  <div class="modem-panel">
    <div class="modem-title">📡 Modem Server {{ computerId }}</div>

    <div class="client-section">
      <div class="section-label">
        Routing {{ clients.length }} computer{{ clients.length !== 1 ? 's' : '' }}
      </div>
      <div v-if="clients.length === 0" class="no-clients">
        No computers currently routing through this modem.
      </div>
      <div
        v-for="id in clients"
        :key="id"
        class="client-row"
        @click="selectComputer(id)"
      >
        <span class="client-type">{{ world.computers[id]?.type === 'minecart' ? 'Minecart' : 'Turtle' }}</span>
        <span class="client-id">{{ id }}</span>
        <span class="client-label">{{ world.computers[id]?.label }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modem-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modem-title {
  font-size: 0.9em;
  font-weight: bold;
  color: rgb(120, 180, 240);
}
.section-label {
  font-size: 0.75em;
  color: gray;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}
.no-clients {
  font-size: 0.8em;
  color: gray;
  font-style: italic;
}
.client-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 0.85em;
  padding: 3px 6px;
  border-radius: 3px;
  cursor: pointer;
  color: darkgray;
}
.client-row:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: lightgray;
}
.client-type {
  color: gray;
  font-size: 0.9em;
}
.client-id {
  color: rgb(120, 180, 240);
  font-weight: bold;
  min-width: 24px;
}
.client-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useWorldStore } from "../store/useWorld";
import { useWorldViewStore } from "../store/useWorldView";

export default defineComponent({
  props: {
    computerId: {
      required: true,
      type: Number,
    },
  },
  setup(props) {
    const world = useWorldStore();
    const worldView = useWorldViewStore();

    const clients = computed(() =>
      Object.keys(world.computers)
        .map(Number)
        .filter(id => id !== props.computerId && world.computers[id]?.via_modem)
    );

    function selectComputer(id: number) {
      worldView.selectedComputerId = id;
      worldView.followComputer(id);
    }

    return { world, worldView, clients, selectComputer };
  },
});
</script>
