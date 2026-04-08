<template>
  <div class="panel">
    <div class="location">
      📍 {{ computer.loc.x }}, {{ computer.loc.y }}, {{ computer.loc.z }}
    </div>
    <div class="actions">
      <div class="propel-row">
        <input
          v-model.number="propelPower"
          type="number"
          min="-1000"
          max="1000"
          class="propel-input"
        />
        <button
          :class="{ missing: computer.peripherals && !computer.peripherals.includes('plethora:kinetic') }"
          @click="world.sendCommand(computerId, `return capi.propel(${propelPower})`)"
        >Propel</button>
      </div>
      <button
        :class="{ missing: computer.peripherals && !computer.peripherals.includes('plethora:scanner') }"
        @click="world.sendCommand(computerId, 'return capi.scan()')"
      >Block Scan</button>
      <button
        :class="{ missing: computer.peripherals && !computer.peripherals.includes('plethora:sensor') }"
        @click="world.sendCommand(computerId, 'return capi.sense()')"
      >Entity Scan</button>
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
.propel-row {
  display: contents;
}
.propel-input {
  padding: 8px 4px;
  border-radius: 4px;
  background-color: #2a2e32;
  color: lightgray;
  border: 1px solid #555;
  text-align: center;
  width: 100%;
}
button.active {
  background-color: rgb(50, 100, 50);
  color: rgb(150, 220, 150);
}
button.missing {
  background-color: rgba(140, 30, 30, 0.6);
  color: rgb(255, 110, 110);
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
import { defineComponent, computed, ref } from "vue";
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
    const propelPower = ref(1);
    return { world, worldView, computer, propelPower };
  },
});
</script>
