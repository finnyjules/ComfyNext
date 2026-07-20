<script setup lang="ts">
import { getTypeColor } from '~/composables/useVueNodes'
import { minHeightForPorts } from '~/lib/canvas/portLayout'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title: string
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    isInput: boolean
    size?: [number, number]
  }
}>()

const portsMinHeight = computed(() =>
  minHeightForPorts(props.data.isInput ? props.data.outputs.length : props.data.inputs.length),
)
</script>

<template>
  <!-- Ports sit outside the card so its background occludes their inner half.
       An input boundary exposes outputs and vice versa: data flows OUT from an
       input boundary INTO the subgraph. -->
  <div class="relative w-fit">
    <VueCanvasNodePort
      v-for="(port, i) in (data.isInput ? data.outputs : data.inputs)"
      :id="data.isInput ? `output-${i}` : `input-${i}`"
      :key="`port-${i}`"
      :type="data.isInput ? 'source' : 'target'"
      :side="data.isInput ? 'right' : 'left'"
      :index="i"
      :data-type="port.type"
      :label="port.name"
    />

  <div
    class="subgraph-io relative z-10 rounded-xl border border-white/30 select-none backdrop-blur-sm min-w-[180px]"
    :style="{
      // Absolutely positioned ports can't hold the node open themselves.
      minHeight: `${portsMinHeight}px`,
      background: data.isInput
        ? 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(30,30,30,0.95) 100%)'
        : 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(30,30,30,0.95) 100%)',
    }"
  >
    <!-- Title bar -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-white/15">
      <!-- Arrow icon -->
      <svg v-if="data.isInput" class="size-3.5 text-white/70 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <svg v-else class="size-3.5 text-white/70 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <span class="text-xs font-semibold truncate" :class="data.isInput ? 'text-white/70' : 'text-white/70'">
        {{ data.title }}
      </span>
    </div>

    <!-- Spacer: reserves the vertical room the centred port stack needs. -->
    <div class="py-2" />
  </div>
  </div>
</template>

<style scoped>
.subgraph-io {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 20px rgba(99, 102, 241, 0.08);
}
</style>
