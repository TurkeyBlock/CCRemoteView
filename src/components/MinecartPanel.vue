<template>
  <div class="panel">
    <div class="location">
      📍 {{ computer.loc.x }}, {{ computer.loc.y }}, {{ computer.loc.z }}
    </div>
    <div class="actions">
      <button @click="world.sendCommand(computerId, 'return capi.propel(1)')">Propel</button>
      <button @click="world.sendCommand(computerId, 'return capi.scan()')">Block Scan</button>
      <button @click="world.sendCommand(computerId, 'return capi.sense()')">Entity Scan</button>
      <button @click="worldView.focusOnComputer(computerId)">Focus Camera</button>
      <button
        :class="{ active: worldView.followedComputer.computerId === computerId }"
        @click="worldView.followComputer(computerId)"
      >Toggle Follow</button>
      <button @click="world.sendStopSignal(computerId)">🛑 Stop 🛑</button>
    </div>

    <div v-if="computer.entities && computer.entities.length > 0" class="section">
      <div class="section-title">Nearby Entities ({{ computer.entities.length }})</div>
      <div class="entity-list">
        <div v-for="e in computer.entities" :key="e.id" class="entity-row">
          <span class="entity-name">{{ e.name }}</span>
          <span class="entity-pos">{{ e.x.toFixed(1) }}, {{ e.y.toFixed(1) }}, {{ e.z.toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <div v-if="computer.chatLog && computer.chatLog.length > 0" class="section">
      <div class="section-title">Chat Log</div>
      <div class="chat-log">
        <div v-for="(msg, i) in [...computer.chatLog].reverse().slice(0, 20)" :key="i" class="chat-row">
          <span class="chat-player">{{ msg.player }}:</span>
          <span class="chat-message">{{ msg.message }}</span>
        </div>
      </div>
    </div>

    <LuaTerminal :computerId="computerId" />
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
.actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
}
button {
  padding: 8px 0;
  border-radius: 4px;
  background-color: #383e42;
  color: darkgray;
}
button.active {
  background-color: rgb(50, 100, 50);
  color: rgb(150, 220, 150);
}
.section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.section-title {
  font-size: 0.75em;
  color: gray;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.entity-list, .chat-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 120px;
  overflow-y: auto;
}
.entity-row, .chat-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8em;
  color: darkgray;
  gap: 8px;
}
.entity-name, .chat-player {
  color: rgb(180, 180, 220);
  white-space: nowrap;
}
.entity-pos {
  color: gray;
  font-size: 0.9em;
}
.chat-message {
  color: lightgray;
  flex: 1;
}
</style>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useWorldStore } from "../store/useWorld";
import { useWorldViewStore } from "../store/useWorldView";
import LuaTerminal from "./LuaTerminal.vue";

export default defineComponent({
  components: { LuaTerminal },
  props: {
    computerId: {
      required: true,
      type: Number,
    },
  },
  setup(props) {
    const world = useWorldStore();
    const worldView = useWorldViewStore();
    const computer = computed(() => world.computers[props.computerId]);
    return { world, worldView, computer };
  },
});
</script>
