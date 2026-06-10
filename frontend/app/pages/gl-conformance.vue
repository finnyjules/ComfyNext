<script setup lang="ts">
// Dev/test-only: Playwright drives window.__glConformance to render the full
// (base, top) value grid through the REAL GlRenderer layer pass for one blend
// mode and read pixels back. The base ramp is drawn first as a 'normal'
// full-canvas layer (normal blend at alpha 1 = replace), then the top ramp
// with the mode under test → result[y][x] = blend(x/255, y/255).
import { onMounted, onBeforeUnmount } from 'vue'
import { GlRenderer } from '~/lib/engine/gl/glRenderer'
import type { DrawEntry } from '~/lib/engine/compositor'
import type { BlendMode } from '~~/shared/timeline/types'

const SIZE = 256
let renderer: GlRenderer | null = null

function rampBitmap(horizontal: boolean): ImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = horizontal ? x : y
      const i = (y * SIZE + x) * 4
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  return new ImageData(data, SIZE, SIZE)
}

onMounted(async () => {
  renderer = new GlRenderer()
  const base = await createImageBitmap(rampBitmap(true))   // value = x
  const top = await createImageBitmap(rampBitmap(false))   // value = y
  renderer.setSource('base-ramp', base)
  renderer.setSource('top-ramp', top)

  ;(window as any).__glConformance = {
    run(mode: BlendMode): string {
      if (!renderer) throw new Error('renderer gone')
      const full = {
        url: '', widthPx: SIZE, heightPx: SIZE,
        centerX: SIZE / 2, centerY: SIZE / 2, rotationDeg: 0, alpha: 1,
        sourceFrame: 0,
      }
      const entries: DrawEntry[] = [
        { ...full, clipId: 'base-ramp', blend: 'normal' },
        { ...full, clipId: 'top-ramp', blend: mode },
      ]
      renderer.render(entries, [0, 0, 0], SIZE, SIZE)
      const out = document.createElement('canvas')
      out.width = SIZE; out.height = SIZE
      out.getContext('2d')!.drawImage(renderer.canvas, 0, 0)
      return out.toDataURL('image/png')
    },
  }
})

onBeforeUnmount(() => {
  renderer?.dispose()
  renderer = null
  delete (window as any).__glConformance
})
</script>

<template>
  <div class="p-4 text-sm text-neutral-400">gl-conformance harness (Playwright-driven)</div>
</template>
