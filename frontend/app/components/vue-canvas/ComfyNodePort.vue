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
