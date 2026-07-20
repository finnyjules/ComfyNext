<script setup lang="ts">
// Dev harness for PalettePicker (duotone + stops) and the live gradient-map GLSL
// pass over a grayscale ramp. Not linked in the app.
definePageMeta({ layout: false })
import { ref, watch, onMounted } from 'vue'
import PalettePicker from '~/components/vue-canvas/studio/PalettePicker.vue'
import WidgetGradientEditor from '~/components/vue-canvas/widgets/WidgetGradientEditor.vue'
import { composePasses } from '~/lib/shaderstudio/passes'
import { shaderFx } from '~/lib/shaderfx/renderer'
import { defaultConfig } from '~/lib/shaderstudio/types'
import type { GradientStop } from '~/lib/color/harmony'

const duo = ref({ shadow: '#1a1a2e', highlight: '#f5f5f5' })
const stops = ref<GradientStop[]>([{ pos: 0, color: '#06283d' }, { pos: 0.5, color: '#256d85' }, { pos: 1, color: '#47b5ff' }])
const ramp = (s: GradientStop[]) => `linear-gradient(to right, ${s.map(x => `${x.color} ${Math.round(x.pos * 100)}%`).join(', ')})`

// Node widget harness (JSON blob in/out, like the canvas nodes)
const duoJson = ref('{"shadow":"#1a1a2e","highlight":"#f5f5f5"}')
const stopsJson = ref('[{"pos":0,"color":"#06283d"},{"pos":0.5,"color":"#256d85"},{"pos":1,"color":"#47b5ff"}]')

const gmCanvas = ref<HTMLCanvasElement | null>(null)
const gmError = ref('')
function renderGM() {
  try {
    const W = 360, H = 90
    const base = document.createElement('canvas'); base.width = W; base.height = H
    const bx = base.getContext('2d')!
    const g = bx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff')
    bx.fillStyle = g; bx.fillRect(0, 0, W, H)
    const cfg = defaultConfig()
    cfg.gradientMap.enabled = true; cfg.gradientMap.stops = stops.value; cfg.gradientMap.mix = 1
    const out = shaderFx.render(composePasses(cfg, () => null, 0), base, W, H)
    const cv = gmCanvas.value!; cv.width = W; cv.height = H
    cv.getContext('2d')!.drawImage(out, 0, 0)
    gmError.value = ''
  } catch (e: any) { gmError.value = String(e?.message ?? e) }
}
onMounted(renderGM)
watch(stops, renderGM, { deep: true })
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
        <div class="mb-1 text-[10px] uppercase tracking-wide text-white/30">CSS preview</div>
        <div class="mb-3 h-12 rounded" :style="{ background: ramp(stops) }" />
        <div class="mb-1 text-[10px] uppercase tracking-wide text-white/30">Live GLSL over a grayscale ramp</div>
        <canvas ref="gmCanvas" class="mb-1 w-full rounded" />
        <div v-if="gmError" class="mb-3 font-mono text-[11px] text-red-400">{{ gmError }}</div>
        <div class="mb-3 font-mono text-[11px] text-white/50">{{ stops.length }} stops</div>
        <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <PalettePicker mode="stops" :stop-count="5" @apply-stops="v => stops = v" />
        </div>
      </section>

      <section>
        <h2 class="mb-3 text-sm font-medium text-white/70">Node widget — Duotone</h2>
        <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <WidgetGradientEditor v-model="duoJson" mode="duotone" label="Duotone" />
        </div>
        <div class="mt-2 break-all font-mono text-[10px] text-white/40">{{ duoJson }}</div>
      </section>

      <section>
        <h2 class="mb-3 text-sm font-medium text-white/70">Node widget — Gradient Map</h2>
        <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <WidgetGradientEditor v-model="stopsJson" mode="stops" label="Gradient map" />
        </div>
        <div class="mt-2 break-all font-mono text-[10px] text-white/40">{{ stopsJson }}</div>
      </section>
    </div>
  </div>
</template>
