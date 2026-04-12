<template>
  <div class="panel">
    <div class="inventory-container">
      <GenericInventorySlot
        v-for="slotIdx in inventorySize"
        :key="`${normalizedInventory[slotIdx] && normalizedInventory[slotIdx].name}${normalizedInventory[slotIdx] && normalizedInventory[slotIdx].count}`"
        :computerId="-1"
        :invSlot="normalizedInventory[slotIdx]"
        :slotNum="slotIdx"
        :isSelected="false"
      />
    </div>
  </div>
</template>

<style scoped>
.inventory-container {
  height: px;
  width: 576px;
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  /* grid-gap: 3%; */
  background-color: lightgray;
}

.panel {
  background-color: lightgray;
}
</style>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import GenericInventorySlot from "./GenericInventorySlot.vue";
import { useWorldStore } from "../store/useWorld";
import { Inventory } from "../types/types";

export default defineComponent({
  setup() {
    const world = useWorldStore();
    return { world };
  },
  components: { GenericInventorySlot },
  props: {
    inventory: {
      required: true,
      type: Object as PropType<Inventory>,
    },
    inventorySize: {
      required: true,
      type: Number,
    }
  },
  computed: {
    normalizedInventory(): Record<number, { name: string; count: number }> {
      const inv = this.inventory as any;
      if (!inv) return {};
      // CC serializes a full (sequential) chest as a JSON array (0-indexed).
      // A sparse chest becomes a JSON object with 1-based string keys.
      // Normalise both to a 1-indexed object so the template can use slotIdx directly.
      if (Array.isArray(inv)) {
        const result: Record<number, any> = {};
        for (let i = 0; i < inv.length; i++) {
          if (inv[i] != null) result[i + 1] = inv[i];
        }
        return result;
      }
      return inv;
    },
  },
});
</script>
