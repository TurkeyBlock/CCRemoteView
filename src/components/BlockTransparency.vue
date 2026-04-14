<template>
  <div class="block-transparency">
    <button class="toggle" @click="toggleOpen">{{ open ? '▾' : '▸' }} Block Filters</button>
    <div v-if="open" class="dropdown">
      <div class="input-row">
        <input
          v-model="input"
          class="block-input"
          placeholder="minecraft:stone"
          @keydown.enter="add"
        />
        <button class="add-btn" @click="add">Add</button>
      </div>

<div v-if="worldView.transparencyList.length" class="list">
        <div
          v-for="name in worldView.transparencyList"
          :key="name"
          class="list-item"
          @click="worldView.removeFromTransparencyList(name)"
          title="Click to remove"
        >
          <span class="block-name">{{ name }}</span>
          <span class="remove">×</span>
        </div>
      </div>
      <p v-else class="empty">No blocks filtered.</p>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useWorldViewStore } from '../store/useWorldView';

export default defineComponent({
  setup() {
    return { worldView: useWorldViewStore() };
  },
  data() {
    return {
      open: false,
      input: '',
    };
  },
  emits: ['opened'],
  methods: {
    toggleOpen() {
      this.open = !this.open;
      if (this.open) this.$emit('opened');
    },
    add() {
      const name = this.input.trim();
      if (!name) return;
      this.worldView.addToTransparencyList(name);
      this.input = '';
    },
  },
});
</script>

<style scoped>
.block-transparency {
  position: relative;
  background: rgb(30, 30, 30);
  border: 1px solid rgb(70, 70, 70);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.85em;
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
  min-width: 200px;
  margin-top: 2px;
}

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

.input-row {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.block-input {
  flex: 1;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid rgb(70, 70, 70);
  background: rgb(40, 40, 40);
  color: darkgray;
  font-size: 0.9em;
  min-width: 0;
}

.block-input::placeholder {
  color: rgb(90, 90, 90);
}

.block-input:focus {
  outline: none;
  border-color: rgb(100, 100, 100);
}

.add-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  background: rgb(60, 120, 60);
  color: white;
  cursor: pointer;
  font-size: 0.8em;
  white-space: nowrap;
}

.add-btn:hover {
  background: rgb(80, 150, 80);
}

.list {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgb(40, 40, 40);
  color: darkgray;
  cursor: pointer;
  font-size: 0.85em;
}

.list-item:hover {
  background: rgb(60, 40, 40);
  color: rgb(200, 150, 150);
}

.block-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove {
  color: rgb(150, 80, 80);
  font-size: 1.1em;
  margin-left: 6px;
  flex-shrink: 0;
}

.empty {
  font-size: 0.8em;
  color: gray;
  margin: 4px 0 0 0;
}
</style>
