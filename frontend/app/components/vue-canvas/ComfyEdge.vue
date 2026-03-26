<script setup lang="ts">
import { BezierEdge, Position } from '@vue-flow/core'
import { getTypeColor } from '~/composables/useVueNodes'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
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
