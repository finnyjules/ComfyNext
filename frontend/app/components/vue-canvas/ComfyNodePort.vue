<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { getTypeColor } from '~/composables/useVueNodes'

const props = defineProps<{
  id: string
  type: 'source' | 'target'
  position: 'left' | 'right'
  dataType: string
  label: string
  tooltip?: string
}>()

const color = computed(() => getTypeColor(props.dataType))
const handlePosition = computed(() =>
  props.position === 'left' ? Position.Left : Position.Right,
)

function toTitleCase(str: string): string {
  return str
    .split(/[_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

const displayLabel = computed(() => toTitleCase(props.label))
</script>

<template>
  <div
    class="flex items-center h-6 relative"
    :class="position === 'right' ? 'flex-row-reverse pr-3' : 'pl-3'"
  >
    <Handle
      :id="id"
      :type="type"
      :position="handlePosition"
      class="!w-2.5 !h-2.5 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: color }"
    />
    <span
      class="text-[9px] leading-none px-1 py-0.5 rounded"
      :class="tooltip ? 'cursor-help' : ''"
      :style="{ color, backgroundColor: color + '15' }"
      :title="tooltip || undefined"
    >{{ displayLabel }}</span>
  </div>
</template>
