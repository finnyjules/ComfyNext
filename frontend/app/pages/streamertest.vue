<script setup lang="ts">
// Dev/test-only harness for the Streamer Space Type effect. 404 in prod.
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

import { onMounted, onBeforeUnmount, ref } from 'vue'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { defaultsFromControls } from '~/lib/spacetype/effect'
import { streamerEffect } from '~/lib/spacetype/effects/streamer'

const canvas = ref<HTMLCanvasElement | null>(null)
const t01 = ref(0)
let engine: SpaceTypeEngine | null = null
const params = defaultsFromControls(streamerEffect.controls)

function build() {
  if (!engine) return
  engine.build(params, { label: 'X', fontFamily: 'IBM Plex Mono', fontWeight: 400, axes: {}, typeColor: '#ffffff' })
  render()
}
function render() {
  if (!engine) return
  const idx = Math.round(t01.value * (engine.frameCount - 1))
  engine.renderFrame(idx, params)
}

onMounted(async () => {
  if (!canvas.value) return
  engine = new SpaceTypeEngine(canvas.value, {
    effect: streamerEffect,
    width: 1280, height: 800, fps: 30, loopDuration: 4,
    alpha: false, bgColor: '#212121', projection: 'perspective',
  })
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  try { await fonts?.load('40px "IBM Plex Mono"') } catch { /* ignore */ }
  build()
  ;(window as any).__st = {
    set(o: Record<string, unknown>) { Object.assign(params, o); build() },
    setT(v: number) { t01.value = v; render() },
    setProj(m: 'perspective' | 'isometric') { engine?.setProjection(m); render() },
    setDims(w: number, h: number) {
      engine?.setSize(w, h)
      if (canvas.value) { canvas.value.style.width = '720px'; canvas.value.style.height = `${Math.round(720 * h / w)}px` }
      build()
    },
    dump() { return JSON.parse(JSON.stringify(params)) },
  }
})

onBeforeUnmount(() => { engine?.dispose(); engine = null; delete (window as any).__st })
</script>

<template>
  <div class="min-h-screen bg-neutral-950 p-4 text-sm text-neutral-300">
    <div class="mb-3 flex items-center gap-4">
      <label class="flex items-center gap-2">
        t01 {{ t01.toFixed(2) }}
        <input v-model.number="t01" type="range" min="0" max="1" step="0.01" @input="render">
      </label>
    </div>
    <canvas ref="canvas" data-testid="st-canvas" class="border border-neutral-700" style="width:720px;height:450px" />
  </div>
</template>
