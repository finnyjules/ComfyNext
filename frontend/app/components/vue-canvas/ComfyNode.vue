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
    widgetDefs?: any[]
    properties: Record<string, any>
    mode: number
    color?: string
    bgcolor?: string
    size?: [number, number]
    running?: boolean
    error?: boolean
    progress?: number
  }
}>()

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
    class="comfy-node rounded-xl border border-[#2a2a2a] min-w-[220px] overflow-hidden select-none"
    :class="{
      'opacity-40': isMuted,
      'opacity-60 border-dashed': isBypassed,
      'ring-2 ring-[#818cf8] animate-pulse': data.running,
      'ring-2 ring-red-500': data.error,
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

    <!-- Ports -->
    <div class="px-1 py-2 flex flex-col gap-0.5">
      <!-- Outputs (right-aligned) -->
      <VueCanvasComfyNodePort
        v-for="(output, i) in data.outputs"
        :key="`out-${i}`"
        :id="`output-${i}`"
        type="source"
        position="right"
        :data-type="output.type"
        :label="output.name"
      />

      <!-- Inputs (left-aligned) -->
      <VueCanvasComfyNodePort
        v-for="(input, i) in data.inputs"
        :key="`in-${i}`"
        :id="`input-${i}`"
        type="target"
        position="left"
        :data-type="input.type"
        :label="input.name"
      />
    </div>

    <!-- Widgets -->
    <div v-if="data.widgetDefs?.length" class="border-t border-[#2a2a2a] py-1.5 flex flex-col gap-1">
      <VueCanvasComfyNodeWidget
        v-for="(widget, i) in data.widgetDefs"
        :key="widget.name"
        :widget-def="widget"
        :model-value="data.widgetsValues?.[i]"
        @update:model-value="data.widgetsValues[i] = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.comfy-node {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}
</style>
