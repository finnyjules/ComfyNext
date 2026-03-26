<script setup lang="ts">
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { fetchObjectInfo, getWidgetDefs } from '~/composables/useVueNodes'
import ComfyNode from '~/components/vue-canvas/ComfyNode.vue'
import ComfyEdge from '~/components/vue-canvas/ComfyEdge.vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'

const props = defineProps<{
  workflow: any
}>()

const { nodes, edges, objectInfo, convertFromLiteGraph, convertToLiteGraph } = useVueNodes()
const { onConnect, addEdges, fitView, project } = useVueFlow()

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

// Listen for addNode events from NodeSearchDialog
function handleAddNode(e: Event) {
  const detail = (e as CustomEvent<{ nodeType: string }>).detail
  const { nodeType } = detail

  // Get viewport center for placement
  const center = project({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const newId = String(Date.now())
  const info = objectInfo.value[nodeType]
  const widgetDefs = getWidgetDefs(nodeType)

  nodes.value.push({
    id: newId,
    type: 'comfy',
    position: { x: center.x, y: center.y },
    data: {
      nodeType,
      title: info?.display_name || nodeType,
      inputs: (info?.input?.required
        ? Object.entries(info.input.required as Record<string, any>)
            .filter(([_, spec]: [string, any]) => {
              const specArr = Array.isArray(spec) ? spec : [spec]
              // Non-widget inputs (types like IMAGE, MODEL, etc.) become ports
              return !Array.isArray(specArr[0]) && !['INT', 'FLOAT', 'STRING', 'BOOLEAN'].includes(String(specArr[0]))
            })
            .map(([name, spec]: [string, any]) => ({
              name,
              type: Array.isArray(spec) ? String(spec[0]) : String(spec),
              link: null,
            }))
        : []),
      outputs: (info?.output || []).map((type: string, i: number) => ({
        name: info?.output_name?.[i] || type,
        type,
        links: null,
      })),
      widgetsValues: widgetDefs.map((w: any) => w.default ?? null),
      widgetDefs,
      properties: {},
      mode: 0,
      size: [220, 120],
    },
  } as any)
}

// Listen for execution progress from bridge (via postMessage)
function handleBridgeMessage(event: MessageEvent) {
  if (event.data?.type !== 'comfynext-bridge') return

  const { event: evt, node, progress: prog } = event.data

  if (evt === 'executing') {
    // Clear all running states, set new running node
    for (const n of nodes.value) {
      if (n.data?.running) {
        n.data = { ...n.data, running: false }
      }
    }
    if (node) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(node))
      if (target) {
        target.data = { ...target.data, running: true, error: false }
      }
    }
  }

  if (evt === 'progress') {
    // Update progress on the currently running node
    const running = (nodes.value as any[]).find((n: any) => n.data?.running)
    if (running && prog) {
      const pct = Math.round((prog.value / prog.max) * 100)
      running.data = { ...running.data, progress: pct }
    }
  }

  if (evt === 'execution_error') {
    // Mark the errored node
    if (node) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(node))
      if (target) {
        target.data = { ...target.data, running: false, error: true }
      }
    }
  }

  if (evt === 'execution_complete') {
    // Clear all running/progress states
    for (const n of nodes.value) {
      if (n.data?.running || n.data?.progress) {
        n.data = { ...n.data, running: false, progress: undefined }
      }
    }
  }
}

onMounted(() => {
  window.addEventListener('comfynext:addNode', handleAddNode)
  window.addEventListener('message', handleBridgeMessage)
  // Fetch object_info on mount so widget defs are available
  fetchObjectInfo()
})
onUnmounted(() => {
  window.removeEventListener('comfynext:addNode', handleAddNode)
  window.removeEventListener('message', handleBridgeMessage)
})

// Expose serialization for Run button
defineExpose({
  getWorkflow: convertToLiteGraph,
})
</script>

<template>
  <div class="w-full h-full">
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="{ comfy: markRaw(ComfyNode) }"
      :edge-types="{ comfy: markRaw(ComfyEdge) }"
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

.vue-node-canvas {
  background-color: #0a0a0a;
}

/* Connection line while dragging */
.vue-node-canvas .vue-flow__connection-line path {
  stroke: #818cf8;
  stroke-width: 2;
  stroke-dasharray: 5;
}
</style>
