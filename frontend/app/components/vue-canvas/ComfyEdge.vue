<script setup lang="ts">
import { getBezierPath, Position } from '@vue-flow/core'
import type { Ref } from 'vue'
import { getTypeColor } from '~/composables/useVueNodes'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  data: { dataType: string; running?: boolean }
  selected: boolean
}>()

const color = computed(() => getTypeColor(props.data?.dataType))

const bezier = computed(() => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  targetX: props.targetX,
  targetY: props.targetY,
  sourcePosition: props.sourcePosition,
  targetPosition: props.targetPosition,
}))
const path = computed(() => bezier.value[0])
const labelX = computed(() => bezier.value[1])
const labelY = computed(() => bezier.value[2])

const isRunning = computed(() => props.data?.running)

// Unique gradient ID per edge
const gradientId = computed(() => `edge-sweep-${props.id}`)

// Splice affordances: hover shows a "+" to insert a node into this wire; a node
// dragged over this wire (tracked by the canvas) highlights it as the drop target.
const hovering = ref(false)
const dragEdgeId = inject<Ref<string | null>>('spliceDragEdgeId', ref(null))
const isDropTarget = computed(() => dragEdgeId.value === props.id)
const showInsert = computed(() => (hovering.value || isDropTarget.value) && !isRunning.value)

function onInsert() {
  window.dispatchEvent(new CustomEvent('comfynext:edgeInsert', { detail: { edgeId: props.id } }))
  hovering.value = false
}
</script>

<template>
  <g>
    <!-- Animated gradient definition (only when running) -->
    <defs v-if="isRunning">
      <linearGradient :id="gradientId" gradientUnits="userSpaceOnUse"
        :x1="sourceX" :y1="sourceY" :x2="targetX" :y2="targetY"
      >
        <stop offset="0%" :stop-color="color" stop-opacity="0.4">
          <animate attributeName="offset" values="-0.3;1.0" dur="1.5s" repeatCount="indefinite" />
        </stop>
        <stop offset="0%" :stop-color="color" stop-opacity="1">
          <animate attributeName="offset" values="-0.1;1.2" dur="1.5s" repeatCount="indefinite" />
        </stop>
        <stop offset="0%" stop-color="white" stop-opacity="1">
          <animate attributeName="offset" values="0.0;1.3" dur="1.5s" repeatCount="indefinite" />
        </stop>
        <stop offset="0%" :stop-color="color" stop-opacity="1">
          <animate attributeName="offset" values="0.1;1.4" dur="1.5s" repeatCount="indefinite" />
        </stop>
        <stop offset="0%" :stop-color="color" stop-opacity="0.4">
          <animate attributeName="offset" values="0.3;1.6" dur="1.5s" repeatCount="indefinite" />
        </stop>
      </linearGradient>
    </defs>

    <!-- Glow layer (only when running) -->
    <path
      v-if="isRunning"
      :d="path"
      fill="none"
      :stroke="`url(#${gradientId})`"
      :stroke-width="8"
      stroke-opacity="0.3"
      stroke-linecap="round"
    />
    <!-- Drop-target highlight when a node is dragged over this wire -->
    <path
      v-if="isDropTarget"
      :d="path"
      fill="none"
      :stroke="color"
      :stroke-width="9"
      stroke-opacity="0.25"
      stroke-linecap="round"
    />
    <!-- Main edge path -->
    <path
      :d="path"
      fill="none"
      :stroke="isRunning ? `url(#${gradientId})` : color"
      :stroke-width="isDropTarget ? 3.5 : selected ? 3 : 2"
      :stroke-opacity="isRunning ? 1 : (isDropTarget || selected) ? 1 : 0.6"
      stroke-linecap="round"
    />

    <!-- Invisible fat path: widens the hit area for hover + carries the edge id
         so the canvas can detect a node dragged over this wire. -->
    <path
      :d="path"
      fill="none"
      stroke="transparent"
      :stroke-width="20"
      :data-edge-id="id"
      style="pointer-events: stroke; cursor: pointer"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
    />

    <!-- Insert ("+") affordance at the wire midpoint -->
    <g
      v-if="showInsert"
      :transform="`translate(${labelX}, ${labelY})`"
      style="pointer-events: all; cursor: pointer"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
      @click.stop="onInsert"
    >
      <title>Insert a node here</title>
      <circle r="10" :fill="color" fill-opacity="0.95" />
      <circle r="10" fill="none" stroke="white" stroke-opacity="0.3" stroke-width="1" />
      <line x1="-4" y1="0" x2="4" y2="0" stroke="white" stroke-width="1.6" stroke-linecap="round" />
      <line x1="0" y1="-4" x2="0" y2="4" stroke="white" stroke-width="1.6" stroke-linecap="round" />
    </g>
  </g>
</template>
