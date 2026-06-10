<script setup lang="ts">
// Dev/test-only surface: Playwright drives window.__timelineHarness to render
// fixture frames through a PreviewRenderer and read pixels back. Not linked
// from anywhere in the app UI. Phase 1 registers 'webgl' as a second renderer
// kind here — the golden spec then runs against both.
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { migrateEditState } from '~~/shared/timeline/types'
import type { PreviewRenderer } from '~~/shared/timeline/previewRenderer'
import { ServerFrameRenderer } from '~/lib/serverFrameRenderer'
import { WebGLPreviewRenderer } from '~/lib/engine/webglPreviewRenderer'

const canvas = ref<HTMLCanvasElement | null>(null)
const status = ref('idle')
let renderer: PreviewRenderer | null = null

onMounted(() => {
  ;(window as any).__timelineHarness = {
    async load(stateJson: string, kind: 'server' | 'webgl' = 'server'): Promise<void> {
      const state = migrateEditState(JSON.parse(stateJson))
      if (!state) throw new Error('invalid edit state')
      renderer?.dispose()
      renderer = kind === 'webgl' ? new WebGLPreviewRenderer() : new ServerFrameRenderer()
      await renderer.load(state)
      status.value = `loaded (${kind})`
    },
    async renderFrame(frame: number): Promise<string> {
      if (!renderer || !canvas.value) throw new Error('load() first')
      await renderer.renderFrame(frame, canvas.value)
      status.value = `frame ${frame}`
      return canvas.value.toDataURL('image/png')
    },
  }
})

onBeforeUnmount(() => {
  renderer?.dispose()
  delete (window as any).__timelineHarness
})
</script>

<template>
  <div class="p-4 text-sm text-neutral-400">
    <div data-testid="harness-status">{{ status }}</div>
    <canvas ref="canvas" class="mt-2 border border-neutral-700" />
  </div>
</template>
