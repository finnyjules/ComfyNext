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

  const { event: evt, node_id, node, percent, progress: prog } = event.data
  const nodeId = node_id || node // bridge sends node_id, normalize

  if (evt === 'executing') {
    // Clear all running states, set new running node
    for (const n of nodes.value) {
      if (n.data?.running) {
        n.data = { ...n.data, running: false }
      }
    }
    if (nodeId) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
      if (target) {
        target.data = { ...target.data, running: true, error: false }
      }
    }
  }

  if (evt === 'progress') {
    // Update progress on the currently running node
    const running = (nodes.value as any[]).find((n: any) => n.data?.running)
    if (running) {
      // Bridge sends percent directly, or prog.value/prog.max
      const pct = percent ?? (prog ? Math.round((prog.value / prog.max) * 100) : undefined)
      if (pct !== undefined) running.data = { ...running.data, progress: pct }
    }
  }

  if (evt === 'execution_error') {
    if (nodeId) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
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

// Track whether any node is currently running (for background animation)
const isRunning = computed(() => (nodes.value as any[]).some((n: any) => n.data?.running))

// Expose serialization for Run button
defineExpose({
  getWorkflow: convertToLiteGraph,
})
</script>

<template>
  <div class="w-full h-full relative">
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
      <Background :gap="24" :size="2" color="rgba(255, 255, 255, 0.12)" variant="dots" />
      <MiniMap
        class="!bg-[#1a1a1a] !border-[#2a2a2a]"
        :node-color="() => '#2a2a2a'"
        :mask-color="'rgba(0, 0, 0, 0.6)'"
      />
    </VueFlow>

    <!-- Running sweep: illuminates dots left-to-right while workflow executes -->
    <Transition
      enter-active-class="transition-opacity duration-500"
      leave-active-class="transition-opacity duration-700"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="isRunning" class="canvas-sweep" />
    </Transition>
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

/* Running sweep — only the dots illuminate, not the space between them */
.canvas-sweep {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  /* Bright sweep gradient */
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(129, 140, 248, 0.5) 20%,
    rgba(165, 180, 252, 0.8) 35%,
    rgba(129, 140, 248, 0.5) 50%,
    transparent 65%
  );
  background-size: 200% 100%;
  animation: canvas-sweep-move 3s ease-in-out infinite;
  /* Mask to dot grid — gradient only shows through at dot positions */
  -webkit-mask-image: radial-gradient(circle 2px at center, black 0%, transparent 100%);
  mask-image: radial-gradient(circle 2px at center, black 0%, transparent 100%);
  -webkit-mask-size: 24px 24px;
  mask-size: 24px 24px;
}

@keyframes canvas-sweep-move {
  0% { background-position: 200% 0; }
  100% { background-position: -100% 0; }
}
</style>
