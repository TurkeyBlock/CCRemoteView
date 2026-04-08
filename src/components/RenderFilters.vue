<template>
  <div class="render-filters">
    <button class="toggle" @click="toggleOpen">{{ open ? '▾' : '▸' }} Render Filters</button>
    <div v-if="open" class="dropdown">

      <p class="file-size">World file: {{ fileSizeDisplay }}</p>

      <div class="section">
        <span class="section-label">Y</span>
        <div class="range-row">
          <input type="number" class="num-input" v-model.number="yMinLocal" min="0" max="255" @change="applyY" />
          <span class="sep">–</span>
          <input type="number" class="num-input" v-model.number="yMaxLocal" min="0" max="255" @change="applyY" />
          <button class="reset-btn" @click="resetY">Full</button>
        </div>
      </div>

      <div class="section">
        <span class="section-label">XZ ±</span>
        <div class="range-row">
          <input
            type="number"
            class="num-input"
            v-model.number="xzRangeLocal"
            min="1"
            placeholder="∞"
            @change="applyXZ"
          />
          <span class="unit-label">blocks</span>
          <button class="reset-btn" @click="clearXZ">Clear</button>
        </div>
        <p class="hint" v-if="worldView.computerRangeXZ !== null && worldView.selectedComputerId === -1 && !worldView.manualCenter">
          Set a center coordinate in the selector to apply XZ range.
        </p>
      </div>

    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useWorldViewStore } from '../store/useWorldView';
import { useUserStore } from '../store/useUser';
import { useWorldStore } from '../store/useWorld';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default defineComponent({
  setup() {
    return {
      worldView: useWorldViewStore(),
      user: useUserStore(),
      world: useWorldStore(),
    };
  },
  data() {
    return {
      open: false,
      yMinLocal: 0,
      yMaxLocal: 255,
      xzRangeLocal: null as number | null,
    };
  },
  computed: {
    fileSizeDisplay(): string {
      if (this.user.savedFileSizeBytes === null) return 'unknown';
      return formatBytes(this.user.savedFileSizeBytes);
    },
    trackedComputerLocation(): string | null {
      const id = this.worldView.selectedComputerId;
      if (id === -1 || this.worldView.computerRangeXZ === null) return null;
      const computer = this.world.computers[id];
      return computer ? `${computer.loc.x},${computer.loc.z}` : null;
    },
  },
  watch: {
    trackedComputerLocation() {
      if (this.worldView.computerRangeXZ !== null) {
        this.worldView.regenerateSceneFromBlocks();
      }
    },
  },
  emits: ['opened'],
  methods: {
    toggleOpen() {
      this.open = !this.open;
      if (this.open) this.$emit('opened');
    },
    applyY() {
      const lo = Math.max(0, Math.min(255, this.yMinLocal));
      const hi = Math.max(0, Math.min(255, this.yMaxLocal));
      this.worldView.yMin = Math.min(lo, hi);
      this.worldView.yMax = Math.max(lo, hi);
      this.worldView.regenerateSceneFromBlocks();
    },
    resetY() {
      this.yMinLocal = 0;
      this.yMaxLocal = 255;
      this.worldView.yMin = 0;
      this.worldView.yMax = 255;
      this.worldView.regenerateSceneFromBlocks();
    },
    applyXZ() {
      this.worldView.computerRangeXZ = this.xzRangeLocal && this.xzRangeLocal > 0
        ? this.xzRangeLocal
        : null;
      this.worldView.regenerateSceneFromBlocks();
    },
    clearXZ() {
      this.xzRangeLocal = null;
      this.worldView.computerRangeXZ = null;
      this.worldView.regenerateSceneFromBlocks();
    },
  },
});
</script>

<style scoped>
.render-filters {
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
  min-width: 180px;
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

.file-size {
  margin: 6px 0 8px 0;
  color: gray;
  font-size: 0.85em;
}

.section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 6px;
}

.section-label {
  font-size: 0.8em;
  color: gray;
  white-space: nowrap;
  flex-shrink: 0;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.num-input {
  width: 56px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid rgb(70, 70, 70);
  background: rgb(40, 40, 40);
  color: darkgray;
  font-size: 0.9em;
  text-align: center;
}

.num-input:focus {
  outline: none;
  border-color: rgb(100, 100, 100);
}

.sep {
  color: gray;
}

.unit-label {
  color: gray;
  font-size: 0.85em;
}

.reset-btn {
  padding: 2px 6px;
  border-radius: 4px;
  border: none;
  background: rgb(52, 52, 52);
  color: darkgray;
  cursor: pointer;
  font-size: 0.8em;
  margin-left: 2px;
}

.reset-btn:hover {
  background: rgb(70, 70, 70);
  color: white;
}

.hint {
  margin: 3px 0 0 0;
  color: gray;
  font-size: 0.78em;
  font-style: italic;
}
</style>
