import { watch, type Ref } from 'vue'
import type { EditState, Clip } from '~~/shared/timeline/types'
import { WebGLPreviewRenderer } from '~/lib/engine/webglPreviewRenderer'
import { AudioEngine } from '~/lib/engine/audio/audioEngine'
import type { ClipPreview } from '~/composables/usePlaybackEngine'

/** True when the browser can host the WebGL engine at all. */
export function webglPreviewSupported(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch {
    return false
  }
}

/**
 * WebGL twin of usePlaybackEngine — same surface, swapped behind the
 * 'comfynext:Engine.WebGLPreview' flag in TimelineEditor. The store transport
 * stays master (playhead in seconds, ticked by the editor's rAF); this engine
 * renders the playhead's frame each rAF with an unchanged-frame early-out, and
 * audio FOLLOWS transport (re-anchored on play and on seek jumps). Drift between
 * the store clock and AudioContext is ms-scale (both wall-clock) — accepted for
 * M3; audio-master transport is the M4+ question.
 */
export function usePlaybackEngineGL(
  canvasRef: Ref<HTMLCanvasElement | null>,
  state: Ref<EditState>,
  playhead: Ref<number>,
  isPlaying: Ref<boolean>,
  resolveClipPreview: (clip: Clip) => ClipPreview | null,
  resolveAudioUrl: (clip: Clip) => string | null = () => null,
) {
  const renderer = new WebGLPreviewRenderer()
  const audio = new AudioEngine()
  let rafId: number | null = null
  let lastRenderedFrame = -1
  let renderBusy = false
  let dirty = true
  let loading = false
  let failedOnce = false
  let destroyed = false

  /** Clip set signature — reload sources when it changes. */
  const clipSignature = () =>
    state.value.tracks
      .flatMap(t => t.clips.map(c => `${c.id}:${c.kind}:${'path' in c ? c.path ?? '' : ''}`))
      .join('|') + `@${state.value.canvas.width}x${state.value.canvas.height}`

  let lastSignature = ''

  async function reload(): Promise<void> {
    if (loading || destroyed) return
    loading = true
    const sigAtStart = lastSignature
    try {
      await Promise.all([
        renderer.load(state.value, { resolve: resolveClipPreview }),
        audio.load(state.value, resolveAudioUrl),
      ])
      dirty = true
      lastRenderedFrame = -1
    } catch (e) {
      if (!failedOnce) {
        failedOnce = true
        console.error('usePlaybackEngineGL: engine load failed — preview may be incomplete', e)
      }
    } finally {
      loading = false
      // If the clip set changed again while this load was in flight (rapid
      // clip adds), run again with the new set — the in-flight guard would
      // otherwise silently drop it.
      if (!destroyed && lastSignature !== sigAtStart) void reload()
    }
  }

  async function drawFrame(): Promise<void> {
    const canvas = canvasRef.value
    if (!canvas || loading) return
    if (canvas.dataset.engine !== 'webgl') canvas.dataset.engine = 'webgl'
    const fps = state.value.canvas.fps
    const frame = Math.floor(playhead.value * fps)
    if (frame === lastRenderedFrame && !dirty) return
    if (renderBusy) return // drop, never queue
    renderBusy = true
    try {
      await renderer.renderFrame(frame, canvas)
      lastRenderedFrame = frame
      dirty = false
    } catch (e) {
      if (!failedOnce) {
        failedOnce = true
        console.error('usePlaybackEngineGL: render failed', e)
      }
    } finally {
      renderBusy = false
    }
  }

  function loop() {
    void drawFrame()
    rafId = requestAnimationFrame(loop)
  }

  function start() {
    if (rafId !== null) return
    if (canvasRef.value) canvasRef.value.dataset.engine = 'webgl'
    const sig = clipSignature()
    lastSignature = sig
    void reload()
    loop()
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function destroy() {
    destroyed = true
    stop()
    audio.dispose()
    renderer.dispose()
  }

  // Sources follow the clip set (deep watch, same trigger as the old engine's
  // stale-media cleanup); signature check keeps transform-only edits cheap.
  // Canvas settings (bg color, size, fps) are included so paused edits repaint.
  watch(() => [state.value.tracks, state.value.canvas], () => {
    const sig = clipSignature()
    if (sig !== lastSignature) {
      lastSignature = sig
      void reload()
    } else {
      // Undo/redo replaces the whole state tree without changing the clip set —
      // re-point the renderer so it never composites a detached snapshot.
      renderer.setState(state.value)
    }
    dirty = true
  }, { deep: true })

  // Audio follows transport.
  watch(isPlaying, async (playing) => {
    if (playing) {
      await audio.resume()
      audio.play(state.value, playhead.value)
    } else {
      audio.stop()
    }
  })

  // Seek jumps while playing → reschedule audio from the new position.
  let lastPlayhead = 0
  watch(playhead, (now) => {
    const jumped = Math.abs(now - lastPlayhead) > 0.25
    lastPlayhead = now
    if (jumped && isPlaying.value) {
      audio.stop()
      audio.play(state.value, now)
    }
  })

  return { start, stop, destroy, drawFrame }
}
