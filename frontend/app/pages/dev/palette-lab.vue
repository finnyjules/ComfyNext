<script setup lang="ts">
// Dev harness for PalettePicker (duotone + stops modes). Not linked in the app.
definePageMeta({ layout: false })
import { ref } from 'vue'
import PalettePicker from '~/components/vue-canvas/studio/PalettePicker.vue'
import type { GradientStop } from '~/lib/color/harmony'

const duo = ref({ shadow: '#1a1a2e', highlight: '#f5f5f5' })
const stops = ref<GradientStop[]>([{ pos: 0, color: '#0a1428' }, { pos: 1, color: '#8fb4e8' }])
const ramp = (s: GradientStop[]) => `linear-gradient(to right, ${s.map(x => `${x.color} ${Math.round(x.pos * 100)}%`).join(', ')})`
</script>

<template>
  <div class="fixed inset-0 overflow-auto bg-[#0b0b0f] p-8 text-white">
    <div class="mx-auto grid max-w-4xl grid-cols-2 gap-8">
      <section>
        <h2 class="mb-3 text-sm font-medium text-white/70">Duotone mode</h2>
        <div class="mb-3 flex h-16 overflow-hidden rounded">
          <div class="flex-1" :style="{ background: duo.shadow }" />
          <div class="flex-1" :style="{ background: duo.highlight }" />
        </div>
        <div class="mb-3 font-mono text-[11px] text-white/50">{{ duo.shadow }} → {{ duo.highlight }}</div>
        <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <PalettePicker mode="duotone" @apply-duotone="v => duo = v" />
        </div>
      </section>

      <section>
        <h2 class="mb-3 text-sm font-medium text-white/70">Gradient-map / stops mode</h2>
        <div class="mb-3 h-16 rounded" :style="{ background: ramp(stops) }" />
        <div class="mb-3 font-mono text-[11px] text-white/50">{{ stops.length }} stops</div>
        <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <PalettePicker mode="stops" :stop-count="5" @apply-stops="v => stops = v" />
        </div>
      </section>
    </div>
  </div>
</template>
