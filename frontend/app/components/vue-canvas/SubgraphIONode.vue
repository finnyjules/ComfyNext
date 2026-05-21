<script setup lang="ts">
import { getTypeColor } from '~/composables/useVueNodes'

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
</script>

<template>
  <div
    class="subgraph-io rounded-xl border border-indigo-500/30 select-none backdrop-blur-sm min-w-[180px]"
    :style="{
      background: data.isInput
        ? 'linear-gradient(180deg, rgba(99,102,241,0.12) 0%, rgba(30,30,30,0.95) 100%)'
        : 'linear-gradient(180deg, rgba(139,92,246,0.12) 0%, rgba(30,30,30,0.95) 100%)',
    }"
  >
    <!-- Title bar -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-indigo-500/15">
      <!-- Arrow icon -->
      <svg v-if="data.isInput" class="size-3.5 text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <svg v-else class="size-3.5 text-purple-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <span class="text-xs font-semibold truncate" :class="data.isInput ? 'text-indigo-300' : 'text-purple-300'">
        {{ data.title }}
      </span>
    </div>

    <!-- Ports -->
    <div class="py-2 flex flex-col gap-0.5">
      <!-- Input node shows output ports (data flows OUT from this boundary INTO the subgraph) -->
      <template v-if="data.isInput">
        <VueCanvasComfyNodePort
          v-for="(port, i) in data.outputs"
          :key="i"
          :id="`output-${i}`"
          type="source"
          position="right"
          :data-type="port.type"
          :label="port.name"
        />
      </template>
      <!-- Output node shows input ports (data flows IN from subgraph INTO this boundary) -->
      <template v-else>
        <VueCanvasComfyNodePort
          v-for="(port, i) in data.inputs"
          :key="i"
          :id="`input-${i}`"
          type="target"
          position="left"
          :data-type="port.type"
          :label="port.name"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.subgraph-io {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 20px rgba(99, 102, 241, 0.08);
}
</style>
