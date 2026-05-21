<script setup lang="ts">
import { getBezierPath, Position } from '@vue-flow/core'
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

const path = computed(() => {
  const [d] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  })
  return d
})

const isRunning = computed(() => props.data?.running)

// Unique gradient ID per edge
const gradientId = computed(() => `edge-sweep-${props.id}`)
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
    <!-- Main edge path -->
    <path
      :d="path"
      fill="none"
      :stroke="isRunning ? `url(#${gradientId})` : color"
      :stroke-width="selected ? 3 : 2"
      :stroke-opacity="isRunning ? 1 : selected ? 1 : 0.6"
      stroke-linecap="round"
    />
  </g>
</template>
