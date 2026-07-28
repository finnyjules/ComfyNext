<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'
import NodeCapsule from '~/components/vue-canvas/NodeCapsule.vue'

const icon = { kind: 'component' as const, value: Sparkles }
const states = [
  { state: 'ready' as const, title: 'Flux Dev', readout: '28 steps · guidance 3.5' },
  { state: 'running' as const, title: 'Flux Dev', readout: 'rendering · 12.5s' },
  { state: 'done' as const, title: 'Flux Dev', readout: '28 steps · seed 84021' },
  { state: 'failed' as const, title: 'Export', readout: 'No credits remaining' },
]
</script>

<template>
  <div class="min-h-screen bg-[#0b0a09] p-16">
    <h1 class="mb-10 text-sm uppercase tracking-[0.14em] text-white/30">Capsule lab</h1>
    <div class="flex flex-col gap-10">
      <div v-for="s in states" :key="s.state" class="flex items-center gap-8">
        <NodeCapsule
          :title="s.title"
          :readout="s.readout"
          :icon="icon"
          :state="s.state"
          border-left="#facc15"
          border-right="#60a5fa"
        />
        <span class="text-xs uppercase tracking-[0.12em] text-white/30">{{ s.state }}</span>
      </div>
    </div>
  </div>
</template>
