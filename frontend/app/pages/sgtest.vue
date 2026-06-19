<script setup lang="ts">
// Dev/test-only harness for the Slice Glitch Space Type effect. 404 in prod.
// Not linked from the app UI; used for the screenshot-tuning loop.
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

import { onMounted, onBeforeUnmount, ref } from 'vue'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { defaultsFromControls } from '~/lib/spacetype/effect'
import { sliceGlitchEffect } from '~/lib/spacetype/effects/sliceGlitch'

const canvas = ref<HTMLCanvasElement | null>(null)
const t01 = ref(0.95)
const hold = ref(true)
const glitch = ref(1)
const mode = ref<'animate' | 'hold'>('hold')
let engine: SpaceTypeEngine | null = null
const params = defaultsFromControls(sliceGlitchEffect.controls)

function build() {
  if (!engine) return
  params.revealMode = mode.value
  params.glitchAmount = glitch.value
  engine.build(params, { label: 'X', fontFamily: 'Anton', fontWeight: 400, axes: {}, typeColor: '#ffffff' })
  render()
}

function render() {
  if (!engine) return
  params.revealMode = mode.value
  params.glitchAmount = glitch.value
  // map the t01 slider directly onto a single-loop frame index
  const idx = Math.round(t01.value * (engine.frameCount - 1))
  engine.renderFrame(idx, params)
}

onMounted(async () => {
  if (!canvas.value) return
  engine = new SpaceTypeEngine(canvas.value, {
    effect: sliceGlitchEffect,
    width: 900, height: 1150, fps: 30, loopDuration: 4,
    alpha: false, bgColor: '#141414', projection: 'perspective',
  })
  // give the font a beat to load, then build
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  try { await fonts?.load('400 40px "Anton"') } catch { /* ignore */ }
  build()
  ;(window as any).__sg = {
    set(o: Record<string, unknown>) { Object.assign(params, o); build() },
    setT(v: number) { t01.value = v; render() },
    setMode(m: 'animate' | 'hold') { mode.value = m; build() },
    setGlitch(g: number) { glitch.value = g; build() },
  }
})

onBeforeUnmount(() => { engine?.dispose(); engine = null; delete (window as any).__sg })
</script>

<template>
  <div class="min-h-screen bg-neutral-950 p-4 text-sm text-neutral-300">
    <div class="mb-3 flex flex-wrap items-center gap-4">
      <label class="flex items-center gap-2">
        Mode
        <select v-model="mode" class="bg-neutral-800 px-2 py-1" @change="build">
          <option value="hold">hold</option>
          <option value="animate">animate</option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        glitch {{ glitch.toFixed(2) }}
        <input v-model.number="glitch" type="range" min="0" max="1" step="0.02" @input="build">
      </label>
      <label class="flex items-center gap-2">
        t01 {{ t01.toFixed(2) }}
        <input v-model.number="t01" type="range" min="0" max="1" step="0.01" @input="render">
      </label>
    </div>
    <canvas ref="canvas" data-testid="sg-canvas" class="border border-neutral-700" style="width:540px;height:690px" />
  </div>
</template>
