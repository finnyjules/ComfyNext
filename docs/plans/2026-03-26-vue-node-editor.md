# Vue Node Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully interactive Vue-based node editor using Vue Flow that replaces the LiteGraph canvas when the "Modern node design" setting is enabled.

**Architecture:** Vue Flow handles canvas interactions (pan/zoom/drag/connect). Custom Vue components render styled nodes with widgets. A `useVueNodes()` composable converts between LiteGraph and Vue Flow data formats. The ComfyUI iframe stays loaded in the background for workflow execution.

**Tech Stack:** Vue Flow (`@vue-flow/core`, `@vue-flow/background`, `@vue-flow/minimap`), Vue 3, TypeScript, Tailwind CSS

---

### Task 1: Install Vue Flow and Create Setting Composable

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/app/composables/useVueNodesEnabled.ts`
- Modify: `frontend/app/components/SettingsModal.vue:76` (make setting `local: true`)

**Step 1: Install Vue Flow packages**

Run:
```bash
cd frontend && pnpm add @vue-flow/core @vue-flow/background @vue-flow/minimap
```

**Step 2: Make the VueNodes setting local (localStorage-based for instant reads)**

In `frontend/app/components/SettingsModal.vue`, change line 76 from:
```typescript
{ id: 'Comfy.VueNodes.Enabled', label: 'Modern node design', type: 'toggle', description: 'Use the new Vue-based node rendering' },
```
to:
```typescript
{ id: 'Comfy.VueNodes.Enabled', label: 'Modern node design', type: 'toggle', description: 'Use the new Vue-based node rendering', local: true },
```

**Step 3: Create the composable for reading the setting reactively**

Create `frontend/app/composables/useVueNodesEnabled.ts`:
```typescript
const vueNodesEnabled = ref(false)

export function useVueNodesEnabled() {
  function load() {
    if (import.meta.server) return
    vueNodesEnabled.value = localStorage.getItem('comfynext:Comfy.VueNodes.Enabled') === 'true'
  }

  // Listen for storage changes (from settings modal)
  if (import.meta.client) {
    window.addEventListener('storage', (e) => {
      if (e.key === 'comfynext:Comfy.VueNodes.Enabled') load()
    })
    load()
  }

  return { vueNodesEnabled, reloadSetting: load }
}
```

**Step 4: Commit**
```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/app/composables/useVueNodesEnabled.ts frontend/app/components/SettingsModal.vue
git commit -m "feat: install Vue Flow and create VueNodes setting composable"
```

---

### Task 2: Data Conversion Composable (`useVueNodes`)

**Files:**
- Create: `frontend/app/composables/useVueNodes.ts`

This composable converts between LiteGraph workflow JSON and Vue Flow's node/edge format.

**Step 1: Create the composable**

Create `frontend/app/composables/useVueNodes.ts`:
```typescript
import type { Node, Edge } from '@vue-flow/core'

// LiteGraph workflow format (matches BLANK_WORKFLOW shape and bridge extract)
export interface LiteGraphNode {
  id: number
  type: string
  pos: [number, number]
  size: [number, number]
  flags?: Record<string, any>
  order?: number
  mode?: number // 0=normal, 2=muted, 4=bypassed
  title?: string
  properties?: Record<string, any>
  widgets_values?: any[]
  inputs?: { name: string; type: string; link: number | null }[]
  outputs?: { name: string; type: string; links: number[] | null; slot_index?: number }[]
  color?: string
  bgcolor?: string
}

export interface LiteGraphLink {
  // Array format: [id, origin_id, origin_slot, target_id, target_slot, type]
  0: number  // link id
  1: number  // origin node id
  2: number  // origin slot index
  3: number  // target node id
  4: number  // target slot index
  5: string  // type
}

export interface LiteGraphWorkflow {
  last_node_id: number
  last_link_id: number
  nodes: LiteGraphNode[]
  links: LiteGraphLink[]
  groups: any[]
  config: Record<string, any>
  extra: Record<string, any>
  version: number
}

// Type color map (same as NodeSearchDialog)
export const TYPE_COLORS: Record<string, string> = {
  MODEL: '#c084fc',      // purple-400
  CLIP: '#facc15',       // yellow-400
  IMAGE: '#60a5fa',      // blue-400
  LATENT: '#f472b6',     // pink-400
  VAE: '#f87171',        // red-400
  CONDITIONING: '#fb923c', // orange-400
  MASK: '#34d399',       // emerald-400
  INT: '#94a3b8',        // slate-400
  FLOAT: '#94a3b8',      // slate-400
  STRING: '#94a3b8',     // slate-400
}

export function getTypeColor(type: string): string {
  return TYPE_COLORS[type?.toUpperCase()] || '#6b7280' // gray-500 default
}

export function useVueNodes() {
  const nodes = ref<Node[]>([])
  const edges = ref<Edge[]>([])
  let lastWorkflow: LiteGraphWorkflow | null = null

  function convertFromLiteGraph(workflow: LiteGraphWorkflow) {
    lastWorkflow = workflow

    nodes.value = workflow.nodes.map((lgNode) => ({
      id: String(lgNode.id),
      type: 'comfy', // our custom node type
      position: { x: lgNode.pos[0], y: lgNode.pos[1] },
      data: {
        nodeType: lgNode.type,
        title: lgNode.title || lgNode.type,
        inputs: lgNode.inputs || [],
        outputs: lgNode.outputs || [],
        widgetsValues: lgNode.widgets_values || [],
        properties: lgNode.properties || {},
        mode: lgNode.mode ?? 0,
        color: lgNode.color,
        bgcolor: lgNode.bgcolor,
        size: lgNode.size,
      },
    }))

    edges.value = (workflow.links || [])
      .filter((link) => link != null)
      .map((link) => {
        // link is array: [id, origin_id, origin_slot, target_id, target_slot, type]
        const linkArr = Array.isArray(link) ? link : Object.values(link)
        return {
          id: `e-${linkArr[0]}`,
          source: String(linkArr[1]),
          sourceHandle: `output-${linkArr[2]}`,
          target: String(linkArr[3]),
          targetHandle: `input-${linkArr[4]}`,
          type: 'comfy',
          data: { dataType: String(linkArr[5]) },
        }
      })
  }

  function convertToLiteGraph(): LiteGraphWorkflow {
    const base = lastWorkflow || { groups: [], config: {}, extra: {}, version: 0.4 }

    const lgNodes: LiteGraphNode[] = nodes.value.map((n) => ({
      id: Number(n.id),
      type: n.data.nodeType,
      pos: [n.position.x, n.position.y] as [number, number],
      size: n.data.size || [220, 120],
      title: n.data.title,
      inputs: n.data.inputs,
      outputs: n.data.outputs,
      widgets_values: n.data.widgetsValues,
      properties: n.data.properties,
      mode: n.data.mode,
      color: n.data.color,
      bgcolor: n.data.bgcolor,
    }))

    // Rebuild links array and update node input/output link references
    const lgLinks: any[] = []
    let linkId = 0
    for (const edge of edges.value) {
      linkId++
      const originSlot = parseInt(edge.sourceHandle?.replace('output-', '') || '0')
      const targetSlot = parseInt(edge.targetHandle?.replace('input-', '') || '0')
      lgLinks.push([
        linkId,
        Number(edge.source),
        originSlot,
        Number(edge.target),
        targetSlot,
        edge.data?.dataType || '*',
      ])

      // Update node link references
      const sourceNode = lgNodes.find((n) => n.id === Number(edge.source))
      const targetNode = lgNodes.find((n) => n.id === Number(edge.target))
      if (sourceNode?.outputs?.[originSlot]) {
        if (!sourceNode.outputs[originSlot].links) sourceNode.outputs[originSlot].links = []
        sourceNode.outputs[originSlot].links!.push(linkId)
      }
      if (targetNode?.inputs?.[targetSlot]) {
        targetNode.inputs[targetSlot].link = linkId
      }
    }

    return {
      last_node_id: Math.max(0, ...lgNodes.map((n) => n.id)),
      last_link_id: linkId,
      nodes: lgNodes,
      links: lgLinks,
      groups: base.groups,
      config: base.config,
      extra: base.extra,
      version: base.version,
    }
  }

  return {
    nodes,
    edges,
    convertFromLiteGraph,
    convertToLiteGraph,
    getTypeColor,
  }
}
```

**Step 2: Commit**
```bash
git add frontend/app/composables/useVueNodes.ts
git commit -m "feat: add useVueNodes composable for LiteGraph ↔ Vue Flow conversion"
```

---

### Task 3: Custom Node Component (`ComfyNode`)

**Files:**
- Create: `frontend/app/components/vue-canvas/ComfyNode.vue`
- Create: `frontend/app/components/vue-canvas/ComfyNodePort.vue`

This is the heart of the visual design — the custom node component rendered inside Vue Flow.

**Step 1: Create port component**

Create `frontend/app/components/vue-canvas/ComfyNodePort.vue`:
```vue
<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { getTypeColor } from '~/composables/useVueNodes'

const props = defineProps<{
  id: string
  type: 'source' | 'target'
  position: 'left' | 'right'
  dataType: string
  label: string
}>()

const color = computed(() => getTypeColor(props.dataType))
const handlePosition = computed(() =>
  props.position === 'left' ? Position.Left : Position.Right,
)
</script>

<template>
  <div class="flex items-center gap-1.5 h-6 relative" :class="position === 'right' ? 'flex-row-reverse' : ''">
    <Handle
      :id="id"
      :type="type"
      :position="handlePosition"
      class="!w-2.5 !h-2.5 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: color }"
    />
    <span class="text-[10px] text-white/50 leading-none whitespace-nowrap">{{ label }}</span>
    <span
      class="text-[9px] leading-none px-1 py-0.5 rounded"
      :style="{ color, backgroundColor: color + '15' }"
    >{{ dataType }}</span>
  </div>
</template>
```

**Step 2: Create main node component**

Create `frontend/app/components/vue-canvas/ComfyNode.vue`:
```vue
<script setup lang="ts">
import { getTypeColor } from '~/composables/useVueNodes'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title: string
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    widgetsValues: any[]
    properties: Record<string, any>
    mode: number
    color?: string
    bgcolor?: string
    size?: [number, number]
  }
}>()

// Category color for title bar accent
const accentColor = computed(() => {
  const firstOutput = props.data.outputs?.[0]
  if (firstOutput) return getTypeColor(firstOutput.type)
  const firstInput = props.data.inputs?.[0]
  if (firstInput) return getTypeColor(firstInput.type)
  return '#6b7280'
})

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)
</script>

<template>
  <div
    class="comfy-node rounded-xl border border-[#2a2a2a] shadow-lg min-w-[220px] overflow-hidden select-none"
    :class="{
      'opacity-40': isMuted,
      'opacity-60 border-dashed': isBypassed,
    }"
    :style="{ backgroundColor: data.bgcolor || '#1a1a1a' }"
  >
    <!-- Title bar -->
    <div
      class="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]"
      :style="{ background: `linear-gradient(135deg, ${accentColor}15 0%, transparent 60%)` }"
    >
      <div class="size-2 rounded-full shrink-0" :style="{ backgroundColor: accentColor }" />
      <span class="text-xs font-semibold text-white/90 truncate flex-1">{{ data.title }}</span>
    </div>

    <!-- Ports and body -->
    <div class="px-1 py-2 flex flex-col gap-0.5">
      <!-- Outputs (right-aligned) -->
      <ComfyNodePort
        v-for="(output, i) in data.outputs"
        :key="`out-${i}`"
        :id="`output-${i}`"
        type="source"
        position="right"
        :data-type="output.type"
        :label="output.name"
      />

      <!-- Inputs (left-aligned) -->
      <ComfyNodePort
        v-for="(input, i) in data.inputs"
        :key="`in-${i}`"
        :id="`input-${i}`"
        type="target"
        position="left"
        :data-type="input.type"
        :label="input.name"
      />
    </div>
  </div>
</template>

<style scoped>
.comfy-node {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}
</style>
```

**Step 3: Commit**
```bash
git add frontend/app/components/vue-canvas/
git commit -m "feat: add ComfyNode and ComfyNodePort components"
```

---

### Task 4: Custom Edge Component (`ComfyEdge`)

**Files:**
- Create: `frontend/app/components/vue-canvas/ComfyEdge.vue`

**Step 1: Create edge component**

Create `frontend/app/components/vue-canvas/ComfyEdge.vue`:
```vue
<script setup lang="ts">
import { BezierEdge } from '@vue-flow/core'
import { getTypeColor } from '~/composables/useVueNodes'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: string
  targetPosition: string
  data: { dataType: string }
  selected: boolean
}>()

const color = computed(() => getTypeColor(props.data?.dataType))
</script>

<template>
  <BezierEdge
    v-bind="$props"
    :style="{
      stroke: color,
      strokeWidth: selected ? 3 : 2,
      strokeOpacity: selected ? 1 : 0.6,
    }"
  />
</template>
```

**Step 2: Commit**
```bash
git add frontend/app/components/vue-canvas/ComfyEdge.vue
git commit -m "feat: add ComfyEdge component with type-colored bezier curves"
```

---

### Task 5: Vue Node Canvas Wrapper

**Files:**
- Create: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`

This is the main canvas component that wraps Vue Flow.

**Step 1: Create the canvas component**

Create `frontend/app/components/vue-canvas/VueNodeCanvas.vue`:
```vue
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

const emit = defineEmits<{
  workflowChange: [workflow: any]
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
      :node-types="{ comfy: resolveComponent('ComfyNode') as any }"
      :edge-types="{ comfy: resolveComponent('ComfyEdge') as any }"
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
  ring: 2px solid #818cf8;
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
</style>
```

**Step 2: Commit**
```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat: add VueNodeCanvas wrapper with Vue Flow integration"
```

---

### Task 6: Wire Up in Layout (Toggle Between LiteGraph and Vue)

**Files:**
- Modify: `frontend/app/layouts/default.vue`

**Step 1: Add the VueNodes toggle in the layout**

In `frontend/app/layouts/default.vue`, in the `<script setup>` section (near the top, around line 12), add:
```typescript
const { vueNodesEnabled } = useVueNodesEnabled()
```

**Step 2: Add a ref for the Vue canvas**

Near the other refs (around line 116):
```typescript
const vueCanvasRef = ref<InstanceType<typeof import('~/components/vue-canvas/VueNodeCanvas.vue').default> | null>(null)
```

**Step 3: Modify the canvas area to conditionally render Vue or iframe**

Find the existing iframe section (lines 824-857, the `data-tab-id="comfyui-shared"` div). Wrap it in a condition and add the Vue alternative:

Replace the existing `v-show` on the iframe container with:
```vue
<!-- Vue Node Canvas (when Modern node design enabled) -->
<div
  v-if="vueNodesEnabled && tabs.some((t) => t.type === 'project')"
  v-show="activeTab.type === 'project'"
  class="absolute inset-0"
>
  <VueCanvasVueNodeCanvas
    ref="vueCanvasRef"
    :workflow="savedWorkflows[activeTab.id] || undefined"
  />
</div>

<!-- LiteGraph iframe (when Modern node design disabled) -->
<div
  v-if="!vueNodesEnabled && tabs.some((t) => t.type === 'project')"
  v-show="activeTab.type === 'project'"
  data-tab-id="comfyui-shared"
  class="absolute inset-0 overflow-hidden"
>
  <!-- existing iframe code unchanged -->
</div>
```

**Step 4: Update the Run button to use Vue canvas when enabled**

Find the run/queue logic and add a branch that serializes from the Vue canvas:

In the queue/run handler (wherever `sendToActiveProjectIframe` is called for running), add:
```typescript
// If Vue nodes mode, serialize from Vue canvas and POST directly
if (vueNodesEnabled.value && vueCanvasRef.value) {
  const workflow = vueCanvasRef.value.getWorkflow()
  // POST to /prompt endpoint directly
  await fetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  })
  return
}
```

**Step 5: Commit**
```bash
git add frontend/app/layouts/default.vue
git commit -m "feat: wire up Vue node canvas with LiteGraph/Vue toggle"
```

---

### Task 7: Node Widgets (Combo, Text, Number, Toggle, Seed)

**Files:**
- Create: `frontend/app/components/vue-canvas/widgets/WidgetCombo.vue`
- Create: `frontend/app/components/vue-canvas/widgets/WidgetText.vue`
- Create: `frontend/app/components/vue-canvas/widgets/WidgetNumber.vue`
- Create: `frontend/app/components/vue-canvas/widgets/WidgetToggle.vue`
- Create: `frontend/app/components/vue-canvas/widgets/WidgetSeed.vue`
- Create: `frontend/app/components/vue-canvas/ComfyNodeWidget.vue`
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` (add widget rendering)
- Modify: `frontend/app/composables/useVueNodes.ts` (fetch and integrate `/object_info` widget specs)

**Step 1: Create widget dispatcher**

Create `frontend/app/components/vue-canvas/ComfyNodeWidget.vue`:
```vue
<script setup lang="ts">
const props = defineProps<{
  widgetDef: { name: string; type: string; options?: string[]; min?: number; max?: number; step?: number; default?: any }
  modelValue: any
}>()

const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

const isCombo = computed(() => Array.isArray(props.widgetDef.options) || props.widgetDef.type === 'COMBO')
const isNumber = computed(() => ['INT', 'FLOAT'].includes(props.widgetDef.type))
const isToggle = computed(() => props.widgetDef.type === 'BOOLEAN')
const isSeed = computed(() => props.widgetDef.name.toLowerCase().includes('seed'))
const isText = computed(() => props.widgetDef.type === 'STRING')
</script>

<template>
  <div class="px-2" data-slot="comfy-node-field">
    <label class="text-[9px] text-white/40 uppercase tracking-wide mb-0.5 block">{{ widgetDef.name }}</label>
    <WidgetCombo
      v-if="isCombo"
      :options="widgetDef.options || []"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <WidgetSeed
      v-else-if="isSeed && isNumber"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <WidgetNumber
      v-else-if="isNumber"
      :model-value="modelValue"
      :min="widgetDef.min"
      :max="widgetDef.max"
      :step="widgetDef.step"
      :is-float="widgetDef.type === 'FLOAT'"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <WidgetToggle
      v-else-if="isToggle"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <WidgetText
      v-else-if="isText"
      :model-value="modelValue"
      :multiline="widgetDef.name.toLowerCase().includes('text') || widgetDef.name.toLowerCase().includes('prompt')"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>
```

**Step 2: Create individual widget components**

Each widget matches the dark theme using the `data-slot="comfy-node-field"` sizing and `#2a2a2a` inputs.

Create `frontend/app/components/vue-canvas/widgets/WidgetCombo.vue`:
```vue
<script setup lang="ts">
defineProps<{ options: string[]; modelValue: any }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <select
    class="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 cursor-pointer focus:outline-none focus:border-white/20"
    :value="modelValue"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option>
  </select>
</template>
```

Create `frontend/app/components/vue-canvas/widgets/WidgetText.vue`:
```vue
<script setup lang="ts">
defineProps<{ modelValue: any; multiline?: boolean }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <textarea
    v-if="multiline"
    class="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 resize-y min-h-[60px] focus:outline-none focus:border-white/20"
    :value="modelValue"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
  <input
    v-else
    class="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 focus:outline-none focus:border-white/20"
    :value="modelValue"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
```

Create `frontend/app/components/vue-canvas/widgets/WidgetNumber.vue`:
```vue
<script setup lang="ts">
defineProps<{ modelValue: any; min?: number; max?: number; step?: number; isFloat?: boolean }>()
defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <input
    type="number"
    class="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 text-center focus:outline-none focus:border-white/20 [&::-webkit-inner-spin-button]:appearance-none"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step ?? (isFloat ? 0.01 : 1)"
    @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
  />
</template>
```

Create `frontend/app/components/vue-canvas/widgets/WidgetToggle.vue`:
```vue
<script setup lang="ts">
defineProps<{ modelValue: any }>()
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    class="relative w-8 h-4 rounded-full transition-colors cursor-pointer"
    :class="modelValue ? 'bg-[#818cf8]' : 'bg-[#3a3a3a]'"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <div
      class="absolute top-0.5 size-3 rounded-full bg-white shadow transition-transform"
      :class="modelValue ? 'translate-x-[18px]' : 'translate-x-0.5'"
    />
  </button>
</template>
```

Create `frontend/app/components/vue-canvas/widgets/WidgetSeed.vue`:
```vue
<script setup lang="ts">
import { Shuffle } from 'lucide-vue-next'

const props = defineProps<{ modelValue: any }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function randomize() {
  emit('update:modelValue', Math.floor(Math.random() * 2 ** 53))
}
</script>

<template>
  <div class="flex items-center gap-1">
    <input
      type="number"
      class="flex-1 bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 text-center focus:outline-none focus:border-white/20 [&::-webkit-inner-spin-button]:appearance-none"
      :value="modelValue"
      @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    />
    <button
      class="shrink-0 p-1 rounded bg-[#2a2a2a] border border-[#3a3a3a] text-white/60 hover:text-white/90 cursor-pointer transition-colors"
      title="Randomize"
      @click="randomize"
    >
      <Shuffle class="size-3" />
    </button>
  </div>
</template>
```

**Step 3: Integrate widget definitions into useVueNodes**

Modify `frontend/app/composables/useVueNodes.ts` — add a function to fetch and cache `/object_info` widget specs, and include them in the node data during conversion:

```typescript
// Add near top of file
const objectInfo = ref<Record<string, any>>({})
let objectInfoFetched = false

async function fetchObjectInfo() {
  if (objectInfoFetched) return
  try {
    const data = await $fetch<Record<string, any>>('/object_info')
    objectInfo.value = data
    objectInfoFetched = true
  } catch (err) {
    console.error('[useVueNodes] Failed to fetch object_info:', err)
  }
}

// In convertFromLiteGraph, add widget definitions to node data:
// After the existing node mapping, enrich with widget info:
function getWidgetDefs(nodeType: string): any[] {
  const info = objectInfo.value[nodeType]
  if (!info?.input?.required) return []
  const defs: any[] = []
  for (const [name, spec] of Object.entries(info.input.required as Record<string, any>)) {
    const specArr = Array.isArray(spec) ? spec : [spec]
    const type = Array.isArray(specArr[0]) ? 'COMBO' : String(specArr[0])
    const options = Array.isArray(specArr[0]) ? specArr[0] : undefined
    const config = specArr[1] || {}
    // Skip inputs that are connected (they become ports, not widgets)
    defs.push({ name, type, options, ...config })
  }
  return defs
}
```

**Step 4: Update ComfyNode to render widgets**

Add to `ComfyNode.vue` template, after the ports section:
```vue
<!-- Widgets -->
<div v-if="data.widgetDefs?.length" class="border-t border-[#2a2a2a] py-1.5 flex flex-col gap-1">
  <ComfyNodeWidget
    v-for="(widget, i) in data.widgetDefs"
    :key="widget.name"
    :widget-def="widget"
    :model-value="data.widgetsValues?.[i]"
    @update:model-value="data.widgetsValues[i] = $event"
  />
</div>
```

**Step 5: Commit**
```bash
git add frontend/app/components/vue-canvas/widgets/ frontend/app/components/vue-canvas/ComfyNodeWidget.vue frontend/app/components/vue-canvas/ComfyNode.vue frontend/app/composables/useVueNodes.ts
git commit -m "feat: add node widget components (combo, text, number, toggle, seed)"
```

---

### Task 8: Connect Node Search to Vue Canvas

**Files:**
- Modify: `frontend/app/composables/useNodeSearch.ts` (update `addNode` to support Vue mode)

**Step 1: Update addNode in useNodeSearch**

The current `addNode` sends a postMessage to the iframe. When Vue nodes are enabled, it should add a node to the Vue Flow graph instead.

In `useNodeSearch.ts`, update the `addNode` function:
```typescript
function addNode(nodeType: string) {
  // Check if Vue nodes mode is active
  const { vueNodesEnabled } = useVueNodesEnabled()
  if (vueNodesEnabled.value) {
    // Dispatch custom event for Vue canvas to handle
    window.dispatchEvent(new CustomEvent('comfynext:addNode', {
      detail: { nodeType },
    }))
    closeNodeSearch()
    return
  }

  // LiteGraph mode — existing iframe postMessage
  const container = document.querySelector('[data-tab-id]')
  const iframe = container?.querySelector('iframe') as HTMLIFrameElement | null
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage(
      { type: 'comfynext', action: 'addNodeAtCenter', nodeType },
      '*',
    )
  }
  closeNodeSearch()
}
```

**Step 2: Handle the event in VueNodeCanvas**

Add to `VueNodeCanvas.vue` setup:
```typescript
// Listen for addNode events from NodeSearchDialog
onMounted(() => {
  window.addEventListener('comfynext:addNode', handleAddNode as EventListener)
})
onUnmounted(() => {
  window.removeEventListener('comfynext:addNode', handleAddNode as EventListener)
})

function handleAddNode(e: CustomEvent<{ nodeType: string }>) {
  const { nodeType } = e.detail
  // Get viewport center for placement
  const { project } = useVueFlow()
  const center = project({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  const newId = String(Date.now())
  const widgetDefs = getWidgetDefs(nodeType)
  const info = objectInfo.value[nodeType]

  nodes.value.push({
    id: newId,
    type: 'comfy',
    position: { x: center.x, y: center.y },
    data: {
      nodeType,
      title: info?.display_name || nodeType,
      inputs: (info?.input?.required ? Object.entries(info.input.required) : [])
        .filter(([_, spec]) => !Array.isArray(spec) || !Array.isArray(spec[0]))
        .map(([name, spec]) => ({
          name,
          type: Array.isArray(spec) ? String(spec[0]) : String(spec),
          link: null,
        })),
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
  })
}
```

**Step 3: Commit**
```bash
git add frontend/app/composables/useNodeSearch.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat: connect NodeSearchDialog to Vue canvas for adding nodes"
```

---

### Task 9: Execution Progress and Node States

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` (add running/error states)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (listen for execution events)

**Step 1: Add running state to ComfyNode**

Add to ComfyNode props data type:
```typescript
running?: boolean
error?: boolean
progress?: number
```

Add to ComfyNode template (around the root div):
```vue
:class="{
  'opacity-40': isMuted,
  'opacity-60 border-dashed': isBypassed,
  'ring-2 ring-[#818cf8] animate-pulse': data.running,
  'ring-2 ring-red-500': data.error,
}"
```

**Step 2: Listen for execution events in VueNodeCanvas**

The existing `default.vue` receives execution progress via `postMessage` from the bridge. Forward these to the Vue canvas via a provide/inject or event system.

Add to `VueNodeCanvas.vue`:
```typescript
// Listen for execution progress from bridge
function handleBridgeMessage(event: MessageEvent) {
  if (event.data?.type !== 'comfynext-bridge') return
  const { event: evt, node } = event.data
  if (evt === 'executing') {
    // Clear all running states, set new running node
    for (const n of nodes.value) {
      n.data = { ...n.data, running: false }
    }
    if (node) {
      const target = nodes.value.find((n) => n.id === String(node))
      if (target) target.data = { ...target.data, running: true }
    }
  }
}

onMounted(() => {
  window.addEventListener('message', handleBridgeMessage)
})
onUnmounted(() => {
  window.removeEventListener('message', handleBridgeMessage)
})
```

**Step 3: Commit**
```bash
git add frontend/app/components/vue-canvas/ComfyNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat: add execution progress and running/error states to Vue nodes"
```

---

### Task 10: Integration Test and Polish

**Step 1: Verify the complete flow**

1. Start the frontend: `cd frontend && pnpm dev`
2. Start ComfyUI: `.venv/bin/python main.py --listen 127.0.0.1 --port 8188`
3. Open the app, go to Settings → Appearance → enable "Modern node design"
4. Open a project tab — should see the Vue Flow canvas with nodes
5. Test: drag nodes, create connections, edit widgets
6. Test: press Space to add a node from search
7. Test: click Run — workflow should execute and show progress on nodes

**Step 2: Fix any visual issues**

- Ensure node widths accommodate widget content
- Verify port handle positions align with edge endpoints
- Check minimap colors and position
- Test dark theme contrast (text readability, border visibility)
- Ensure node selection outline is visible

**Step 3: Final commit**
```bash
git add -A
git commit -m "feat: Vue node editor - integration polish and fixes"
```
