<script setup lang="ts">
// Dev/test-only: Playwright drives window.__engineTest to exercise frame
// sources against the counter fixture (each frame's gray level encodes its
// index) and, from Task 7, real-time playback. Not linked from the app UI.
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { FrameSource } from '~/lib/engine/sources/frameSource'
import { WebCodecsSource } from '~/lib/engine/sources/webCodecsSource'
import { VideoElementSource } from '~/lib/engine/sources/videoElementSource'

const status = ref('idle')
let source: FrameSource | null = null

onMounted(() => {
  ;(window as any).__engineTest = {
    async loadSource(url: string, kind: 'webcodecs' | 'element', fps: number): Promise<{ width: number; height: number }> {
      source?.dispose()
      source = kind === 'webcodecs'
        ? await WebCodecsSource.load(url)
        : await VideoElementSource.load(url, fps)
      status.value = `source loaded (${kind})`
      return { width: source.width, height: source.height }
    },
    /** Center-pixel RGB of source frame n. */
    async frameValue(n: number): Promise<[number, number, number]> {
      if (!source) throw new Error('loadSource first')
      const img = await source.getFrame(n)
      const c = document.createElement('canvas')
      c.width = source.width
      c.height = source.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(img as CanvasImageSource, 0, 0)
      const d = ctx.getImageData(Math.floor(source.width / 2), Math.floor(source.height / 2), 1, 1).data
      status.value = `frame ${n}`
      return [d[0]!, d[1]!, d[2]!]
    },
    hasWebCodecs(): boolean {
      return typeof VideoDecoder !== 'undefined'
    },
    disposeSource(): void {
      source?.dispose()
      source = null
    },
  }
})

onBeforeUnmount(() => {
  source?.dispose()
  delete (window as any).__engineTest
})
</script>

<template>
  <div class="p-4 text-sm text-neutral-400">
    <div data-testid="engine-test-status">{{ status }}</div>
  </div>
</template>
