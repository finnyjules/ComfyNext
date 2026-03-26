<script setup lang="ts">
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'

const props = defineProps<{
  workflow: any
}>()

const { nodes, edges, convertFromLiteGraph, convertToLiteGraph } = useVueNodes()
const { onConnect, addEdges, fitView } = useVueFlow()

// Load workflow when prop changes
watch(
  () => props.workflow,
  (wf) => {
    if (wf) {
      convertFromLiteGraph(wf)
      nextTick(() => fitView({ padding: 0.2 }))
    }
  },
  { immediate: true },
)

// Handle new connections
onConnect((params) => {
  addEdges([{
    ...params,
    type: 'comfy',
    data: { dataType: '*' },
  }])
})

// Expose serialization for Run button
defineExpose({
  getWorkflow: convertToLiteGraph,
})
</script>

<template>
  <div class="w-full h-full bg-[#0a0a0a]">
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="{ comfy: resolveComponent('VueCanvasComfyNode') as any }"
      :edge-types="{ comfy: resolveComponent('VueCanvasComfyEdge') as any }"
      :default-edge-options="{ type: 'comfy' }"
      :snap-to-grid="true"
      :snap-grid="[16, 16]"
      :min-zoom="0.1"
      :max-zoom="4"
      :connection-line-style="{ stroke: '#818cf8', strokeWidth: 2 }"
      :delete-key-code="['Backspace', 'Delete']"
      class="vue-node-canvas"
      fit-view-on-init
    >
      <Background :gap="64" :size="1.5" color="rgba(255, 255, 255, 0.08)" variant="dots" />
      <MiniMap
        class="!bg-[#1a1a1a] !border-[#2a2a2a]"
        :node-color="() => '#2a2a2a'"
        :mask-color="'rgba(0, 0, 0, 0.6)'"
      />
    </VueFlow>
  </div>
</template>

<style>
/* Override Vue Flow defaults to match ComfyNext dark theme */
.vue-node-canvas .vue-flow__node {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}

.vue-node-canvas .vue-flow__node.selected .comfy-node {
  outline: 2px solid #818cf8;
  outline-offset: 1px;
}

.vue-node-canvas .vue-flow__edge.selected path {
  filter: drop-shadow(0 0 4px currentColor);
}

.vue-node-canvas .vue-flow__handle {
  background: transparent;
  border: none;
}

.vue-node-canvas .vue-flow__background {
  background-color: #0a0a0a;
}

/* Connection line while dragging */
.vue-node-canvas .vue-flow__connection-line path {
  stroke: #818cf8;
  stroke-width: 2;
  stroke-dasharray: 5;
}
</style>
