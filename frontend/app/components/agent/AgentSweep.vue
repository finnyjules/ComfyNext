<script setup lang="ts">
// A glimm "citrus" sweep over the canvas while the agent is working — the same
// generation-in-flight treatment used by useRegionFx, applied to the whole
// artboard. Client-only WebGL; fails soft if glimm can't load.
import { onBeforeUnmount, ref, watch } from 'vue'

type ShaderController = import('glimm').ShaderController

const props = defineProps<{ active: boolean; period?: number }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let ctrl: ShaderController | null = null
let raf = 0
let t0 = 0
const PEAK_ALPHA = 0.5

async function ensure() {
  if (ctrl || !canvas.value || !import.meta.client) return
  try {
    const { createShader, resolvePalette } = await import('glimm')
    if (!canvas.value || ctrl) return
    ctrl = createShader({ canvas: canvas.value, palette: resolvePalette('citrus'), brightness: 0.85, swellAmount: 0.7 })
  } catch { /* glimm unavailable — sweep just stays off */ }
}

function loop() {
  if (ctrl) {
    if (props.active) {
      const period = props.period ?? 1.6 // seconds per sweep cycle
      const t = (performance.now() - t0) / 1000
      ctrl.setProgress((t % period) / period)
      ctrl.setAlpha(PEAK_ALPHA)
    } else {
      ctrl.setAlpha(0)
    }
  }
  raf = requestAnimationFrame(loop)
}

// flush: 'post' so v-show has shown (and sized) the canvas before glimm measures
// it — glimm sizes itself from getBoundingClientRect at create time.
watch(() => props.active, async (on) => {
  if (!on || !import.meta.client) return
  await ensure()
  t0 = performance.now()
  if (!raf) raf = requestAnimationFrame(loop)
}, { immediate: true, flush: 'post' })

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  ctrl?.destroy?.()
  ctrl = null
})
</script>

<template>
  <canvas
    v-show="active"
    ref="canvas"
    class="pointer-events-none absolute inset-0 h-full w-full"
    style="mix-blend-mode: screen"
  />
</template>
