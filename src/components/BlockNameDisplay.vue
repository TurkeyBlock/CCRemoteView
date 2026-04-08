<template>
  <div class="pos-abs">
    <template v-if="worldView.hoveredEntity">
      <h2 class="hovered-block-text">Last clicked entity:</h2>
      <h2 class="hovered-block-text">{{ worldView.hoveredEntity.name }}</h2>
      <h2 class="hovered-block-text">{{ worldView.hoveredEntity.id }}</h2>
      <h2 class="hovered-block-text" v-if="worldView.hoveredEntity.worldPos">
        {{ worldView.hoveredEntity.worldPos.x.toFixed(1) }},
        {{ worldView.hoveredEntity.worldPos.y.toFixed(1) }},
        {{ worldView.hoveredEntity.worldPos.z.toFixed(1) }}
      </h2>
    </template>
    <template v-else>
      <h2 class="hovered-block-text">Last clicked block:</h2>
      <h2 class="hovered-block-text" v-if="worldView.hoveredBlock">
        {{ worldView.hoveredBlock.name }}:{{ worldView.hoveredBlock.metadata }}
      </h2>
      <h2 class="hovered-block-text" v-if="worldView.hoveredBlockPos">
        {{ worldView.hoveredBlockPos.x }}:{{ worldView.hoveredBlockPos.y }}:{{ worldView.hoveredBlockPos.z }}
      </h2>
    </template>
  </div>
</template>

<style scoped>

.hovered-block-text {
    color: lightgray;
    user-select: none;
    white-space: nowrap;
}
.pos-abs {
  position: fixed;
  top: 10px;
  right: 10px;
  background: rgb(30, 30, 30);
  border: 1px solid rgb(70, 70, 70);
  border-radius: 6px;
  padding: 8px 12px;
}
</style>

<script lang="ts">
import { defineComponent } from "vue";
import { useWorldViewStore } from "../store/useWorldView";

export default defineComponent({
  setup() {
    const worldView = useWorldViewStore();
    return { worldView };
  },
});
</script>
