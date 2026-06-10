<script setup lang="ts">
// Dev/test-only: Playwright drives window.__engineTest to exercise frame
// sources against the counter fixture (each frame's gray level encodes its
// index) and, from Task 7, real-time playback. Not linked from the app UI.
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { FrameSource } from '~/lib/engine/sources/frameSource'
import { WebCodecsSource } from '~/lib/engine/sources/webCodecsSource'
import { VideoElementSource } from '~/lib/engine/sources/videoElementSource'
import { migrateEditState, type EditState } from '~~/shared/timeline/types'
import { WebGLPreviewRenderer } from '~/lib/engine/webglPreviewRenderer'
import { PlaybackClock } from '~/lib/engine/clock'
import { AudioEngine } from '~/lib/engine/audio/audioEngine'

const status = ref('idle')
let source: FrameSource | null = null

const canvas = ref<HTMLCanvasElement | null>(null)
let renderer: WebGLPreviewRenderer | null = null
let audio: AudioEngine | null = null
let clock: PlaybackClock | null = null
let playState: EditState | null = null
let rafId = 0
let lastRenderedFrame = -1
let renderBusy = false

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
    async loadTimeline(stateJson: string): Promise<void> {
      const state = migrateEditState(JSON.parse(stateJson))
      if (!state) throw new Error('invalid edit state')
      renderer?.dispose()
      audio?.dispose()
      renderer = new WebGLPreviewRenderer()
      audio = new AudioEngine()
      await Promise.all([
        renderer.load(state),
        audio.load(state, (p) => p),   // harness paths are already URLs
      ])
      clock = new PlaybackClock({ audio: audio.timebase })
      playState = state
      lastRenderedFrame = -1
      status.value = 'timeline loaded'
    },
    async play(): Promise<void> {
      if (!clock || !playState || !renderer || !canvas.value) throw new Error('loadTimeline first')
      await audio!.resume()
      clock.play()
      audio!.play(playState, clock.now())
      const fps = playState.canvas.fps
      const tick = async () => {
        if (!clock!.playing) return
        const frame = Math.floor(clock!.now() * fps)
        if (frame !== lastRenderedFrame && !renderBusy) {
          renderBusy = true
          try {
            await renderer!.renderFrame(frame, canvas.value!)
            lastRenderedFrame = frame
          } finally {
            renderBusy = false
          }
        }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
      status.value = 'playing'
    },
    pause(): void {
      clock?.pause()
      audio?.stop()
      cancelAnimationFrame(rafId)
      status.value = 'paused'
    },
    seek(seconds: number): void {
      clock?.seek(seconds)
      lastRenderedFrame = -1
    },
    sample(): { clockSec: number; renderedFrame: number; playing: boolean } {
      return { clockSec: clock?.now() ?? -1, renderedFrame: lastRenderedFrame, playing: clock?.playing ?? false }
    },
  }
})

onBeforeUnmount(() => {
  source?.dispose()
  cancelAnimationFrame(rafId)
  renderer?.dispose()
  audio?.dispose()
  delete (window as any).__engineTest
})
</script>

<template>
  <div class="p-4 text-sm text-neutral-400">
    <div data-testid="engine-test-status">{{ status }}</div>
    <canvas ref="canvas" class="mt-2 border border-neutral-700" />
  </div>
</template>
