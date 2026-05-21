<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
})

// -- Node sizing constants --
const NODE_W = 200
const NODE_H = 70
const PORT_RADIUS = 6

// -- Color map by node type --
const nodeColors = {
  checkpoint: { fill: '#141830', stroke: '#3b82f6', accent: '#60a5fa' },
  sampler: { fill: '#0f1a2e', stroke: '#38bdf8', accent: '#7dd3fc' },
  conditioning: { fill: '#2e2916', stroke: '#f59e0b', accent: '#fbbf24' },
  output: { fill: '#162416', stroke: '#22c55e', accent: '#4ade80' },
  latent: { fill: '#2d1a2e', stroke: '#a855f7', accent: '#c084fc' },
  loader: { fill: '#1e2a3a', stroke: '#3b82f6', accent: '#60a5fa' },
  default: { fill: '#1e1e2a', stroke: '#4a4a5e', accent: '#6b6b80' },
}

function getNodeColor(type) {
  const key = (type || '').toLowerCase()
  for (const [category, colors] of Object.entries(nodeColors)) {
    if (key.includes(category)) return colors
  }
  return nodeColors.default
}

// -- Pan/zoom state --
const canvasRef = ref(null)
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartY = ref(0)
const panStartPanX = ref(0)
const panStartPanY = ref(0)

const transformStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
  transformOrigin: '0 0',
}))

function handleWheel(e) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.min(Math.max(scale.value * delta, 0.25), 3)

  // Zoom toward cursor position
  const rect = canvasRef.value.getBoundingClientRect()
  const cursorX = e.clientX - rect.left
  const cursorY = e.clientY - rect.top

  panX.value = cursorX - (cursorX - panX.value) * (newScale / scale.value)
  panY.value = cursorY - (cursorY - panY.value) * (newScale / scale.value)
  scale.value = newScale
}

function handleMouseDown(e) {
  if (e.button !== 0) return
  isPanning.value = true
  panStartX.value = e.clientX
  panStartY.value = e.clientY
  panStartPanX.value = panX.value
  panStartPanY.value = panY.value
}

function handleMouseMove(e) {
  if (!isPanning.value) return
  panX.value = panStartPanX.value + (e.clientX - panStartX.value)
  panY.value = panStartPanY.value + (e.clientY - panStartY.value)
}

function handleMouseUp() {
  isPanning.value = false
}

function resetView() {
  scale.value = 1
  panX.value = 0
  panY.value = 0
}

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})

// -- Edge helpers --
function getNodeById(id) {
  return props.nodes.find(n => n.id === id)
}

function getOutputPortPos(node, portIndex = 0) {
  const x = (node.position?.x || 0) + NODE_W
  const outputCount = node.outputs?.length || 1
  const spacing = NODE_H / (outputCount + 1)
  const y = (node.position?.y || 0) + spacing * (portIndex + 1)
  return { x, y }
}

function getInputPortPos(node, portIndex = 0) {
  const x = node.position?.x || 0
  const inputCount = node.inputs?.length || 1
  const spacing = NODE_H / (inputCount + 1)
  const y = (node.position?.y || 0) + spacing * (portIndex + 1)
  return { x, y }
}

function getBezierPath(edge) {
  const sourceNode = getNodeById(edge.source)
  const targetNode = getNodeById(edge.target)
  if (!sourceNode || !targetNode) return ''

  const from = getOutputPortPos(sourceNode, edge.sourcePort || 0)
  const to = getInputPortPos(targetNode, edge.targetPort || 0)

  const dx = Math.abs(to.x - from.x) * 0.5
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
}

function getEdgeColor(edge) {
  const sourceNode = getNodeById(edge.source)
  if (!sourceNode) return '#4a4a5e'
  return getNodeColor(sourceNode.type).accent
}

// -- SVG viewbox --
const viewBoxStr = computed(() => {
  const maxX = Math.max(...props.nodes.map(n => (n.position?.x || 0) + NODE_W + 40), 800)
  const maxY = Math.max(...props.nodes.map(n => (n.position?.y || 0) + NODE_H + 40), 400)
  return `0 0 ${maxX} ${maxY}`
})
</script>

<template>
  <section v-if="nodes.length" class="node-graph">
    <div class="node-graph__header">
      <h2 class="node-graph__heading">Node Graph</h2>
      <div class="node-graph__controls">
        <button class="node-graph__control-btn" @click="scale = Math.min(scale * 1.2, 3)" aria-label="Zoom in">+</button>
        <button class="node-graph__control-btn" @click="scale = Math.max(scale * 0.8, 0.25)" aria-label="Zoom out">&minus;</button>
        <button class="node-graph__control-btn" @click="resetView" aria-label="Reset view">Reset</button>
      </div>
    </div>
    <div
      ref="canvasRef"
      class="node-graph__canvas"
      :class="{ 'node-graph__canvas--panning': isPanning }"
      @wheel.prevent="handleWheel"
      @mousedown="handleMouseDown"
    >
      <svg class="node-graph__svg" :viewBox="viewBoxStr" :style="transformStyle">
        <defs>
          <filter id="node-shadow" x="-10%" y="-10%" width="130%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.4)" />
          </filter>
        </defs>

        <!-- Edges (bezier curves) -->
        <path
          v-for="(edge, i) in edges"
          :key="`e-${i}`"
          :d="getBezierPath(edge)"
          :stroke="getEdgeColor(edge)"
          stroke-width="2"
          fill="none"
          stroke-opacity="0.6"
        />

        <!-- Nodes -->
        <g
          v-for="node in nodes"
          :key="node.id"
          :transform="`translate(${node.position?.x || 0}, ${node.position?.y || 0})`"
          filter="url(#node-shadow)"
        >
          <!-- Node body -->
          <rect
            :width="NODE_W"
            :height="NODE_H"
            rx="10"
            :fill="getNodeColor(node.type).fill"
            :stroke="getNodeColor(node.type).stroke"
            stroke-width="1.5"
          />
          <!-- Type header bar -->
          <rect
            :width="NODE_W"
            height="22"
            rx="10"
            :fill="getNodeColor(node.type).stroke"
            fill-opacity="0.2"
          />
          <rect
            :width="NODE_W"
            height="11"
            y="11"
            :fill="getNodeColor(node.type).stroke"
            fill-opacity="0.2"
          />
          <!-- Type label -->
          <text
            :x="NODE_W / 2"
            y="15"
            text-anchor="middle"
            :fill="getNodeColor(node.type).accent"
            font-size="9"
            font-weight="600"
            text-transform="uppercase"
            letter-spacing="0.5"
          >{{ node.type }}</text>
          <!-- Node label -->
          <text
            :x="NODE_W / 2"
            y="48"
            text-anchor="middle"
            fill="#f0f0f5"
            font-size="12"
            font-weight="600"
          >{{ node.label || node.type }}</text>

          <!-- Input ports (left side) -->
          <circle
            v-for="(input, pi) in (node.inputs || [null])"
            :key="`in-${pi}`"
            :cx="0"
            :cy="NODE_H / ((node.inputs?.length || 1) + 1) * (pi + 1)"
            :r="PORT_RADIUS"
            :fill="getNodeColor(node.type).fill"
            :stroke="getNodeColor(node.type).stroke"
            stroke-width="1.5"
          />
          <!-- Output ports (right side) -->
          <circle
            v-for="(output, po) in (node.outputs || [null])"
            :key="`out-${po}`"
            :cx="NODE_W"
            :cy="NODE_H / ((node.outputs?.length || 1) + 1) * (po + 1)"
            :r="PORT_RADIUS"
            :fill="getNodeColor(node.type).accent"
            :stroke="getNodeColor(node.type).stroke"
            stroke-width="1.5"
          />
        </g>
      </svg>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.node-graph {
  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: $space-4;
  }

  &__heading {
    font-size: $text-xl;
    font-weight: $weight-bold;
    color: $color-text-primary;
  }

  &__controls {
    display: flex;
    gap: $space-1;
  }

  &__control-btn {
    padding: $space-1 $space-3;
    font-size: $text-xs;
    font-weight: $weight-medium;
    color: $color-text-secondary;
    background: $color-bg-tertiary;
    border: 1px solid $color-border;
    border-radius: $radius-md;
    cursor: pointer;
    transition: background $transition-fast, color $transition-fast;

    &:hover {
      background: $color-bg-hover;
      color: $color-text-primary;
    }
  }

  &__canvas {
    border: 1px solid $color-border;
    border-radius: $radius-lg;
    background: $color-bg-primary;
    overflow: hidden;
    padding: $space-4;
    cursor: grab;
    user-select: none;

    &--panning {
      cursor: grabbing;
    }
  }

  &__svg {
    min-height: 250px;
    width: 100%;
    transition: transform 0.05s linear;
  }
}
</style>
