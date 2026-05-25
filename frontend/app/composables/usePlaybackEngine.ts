import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue'
import type { EditState, Clip, Track, BlendMode } from '~~/shared/timeline/types'
import { computeTotalFrames } from '~~/shared/timeline/types'

const CANVAS_BLEND: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  soft_light: 'soft-light',
  hard_light: 'hard-light',
  difference: 'difference',
  lighten: 'lighten',
  darken: 'darken',
  add: 'lighter',
}

interface MediaEntry {
  clipId: string
  kind: 'video' | 'image'
  el: HTMLVideoElement | HTMLImageElement
  url: string
}

/** Result of resolving a clip to a playable preview source. */
export interface ClipPreview {
  url: string
  kind: 'video' | 'image'
}

export function usePlaybackEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  state: Ref<EditState>,
  playhead: Ref<number>,
  isPlaying: Ref<boolean>,
  resolveClipPreview: (clip: Clip) => ClipPreview | null,
) {
  const media = new Map<string, MediaEntry>()
  let rafId: number | null = null

  function ensureMedia(clip: Clip): MediaEntry | null {
    const existing = media.get(clip.id)
    if (existing) return existing

    const preview = resolveClipPreview(clip)
    if (!preview) return null

    if (preview.kind === 'video') {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      v.crossOrigin = 'anonymous'
      v.src = preview.url
      v.load()
      const entry: MediaEntry = { clipId: clip.id, kind: 'video', el: v, url: preview.url }
      media.set(clip.id, entry)
      return entry
    }

    if (preview.kind === 'image') {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = preview.url
      const entry: MediaEntry = { clipId: clip.id, kind: 'image', el: img, url: preview.url }
      media.set(clip.id, entry)
      return entry
    }

    return null
  }

  function cleanupStaleMedia() {
    const liveIds = new Set<string>()
    for (const track of state.value.tracks) {
      if (track.kind === 'audio') continue
      for (const clip of track.clips) {
        liveIds.add(clip.id)
      }
    }
    for (const [id, entry] of media) {
      if (!liveIds.has(id)) {
        if (entry.kind === 'video') {
          const v = entry.el as HTMLVideoElement
          v.pause()
          v.removeAttribute('src')
          v.load()
        }
        media.delete(id)
      }
    }
  }

  function drawFrame() {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    if (!ctx) return
    const s = state.value
    const { width: cw, height: ch, fps, bg_color } = s.canvas

    if (canvas.width !== cw) canvas.width = cw
    if (canvas.height !== ch) canvas.height = ch

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = bg_color
    ctx.fillRect(0, 0, cw, ch)

    const currentSec = playhead.value
    const totalFrames = computeTotalFrames(s)

    for (const track of s.tracks) {
      if (track.muted) continue
      if (track.kind === 'audio') continue

      for (const clip of track.clips) {
        const startSec = clip.start_frame / fps
        const endSec = (clip.start_frame + clip.length) / fps
        if (currentSec < startSec || currentSec >= endSec) continue

        const entry = ensureMedia(clip)
        if (!entry) continue

        let el: CanvasImageSource | null = null
        let sw = 0
        let sh = 0

        if (entry.kind === 'video') {
          const v = entry.el as HTMLVideoElement
          if (!isFinite(v.duration) || v.duration <= 0) continue
          const localSec = currentSec - startSec
          const inSec = (clip.in_frame ?? 0) / fps
          const targetTime = ((inSec + localSec) % v.duration + v.duration) % v.duration
          if (isPlaying.value) {
            if (v.paused) {
              try { v.currentTime = targetTime } catch {}
              v.play().catch(() => {})
            } else if (Math.abs(v.currentTime - targetTime) > 0.15) {
              try { v.currentTime = targetTime } catch {}
            }
          } else {
            if (!v.paused) v.pause()
            if (Math.abs(v.currentTime - targetTime) > 0.05) {
              try { v.currentTime = targetTime } catch {}
            }
          }
          el = v
          sw = v.videoWidth
          sh = v.videoHeight
        } else if (entry.kind === 'image') {
          const img = entry.el as HTMLImageElement
          if (!img.complete || img.naturalWidth === 0) continue
          el = img
          sw = img.naturalWidth
          sh = img.naturalHeight
        }

        if (!el || sw === 0 || sh === 0) continue

        const localFrame = (currentSec - startSec) * fps
        let fadeAlpha = 1
        if ((clip.fade_in ?? 0) > 0 && localFrame < clip.fade_in!)
          fadeAlpha *= localFrame / clip.fade_in!
        if ((clip.fade_out ?? 0) > 0 && localFrame > clip.length - clip.fade_out!)
          fadeAlpha *= (clip.length - localFrame) / clip.fade_out!
        fadeAlpha = Math.max(0, Math.min(1, fadeAlpha))

        ctx.save()
        ctx.globalAlpha = Math.max(0, Math.min(1, (clip.opacity ?? 1) * fadeAlpha))
        ctx.globalCompositeOperation = CANVAS_BLEND[clip.blend ?? 'normal'] ?? 'source-over'

        const cx = cw / 2 + (clip.x ?? 0) * cw
        const cy = ch / 2 + (clip.y ?? 0) * ch
        ctx.translate(cx, cy)
        ctx.rotate(((clip.rotation ?? 0) * Math.PI) / 180)
        ctx.scale(clip.scale ?? 1, clip.scale ?? 1)

        const cAspect = cw / ch
        const sAspect = sw / sh
        let dw: number, dh: number
        if (sAspect > cAspect) {
          dw = cw
          dh = cw / sAspect
        } else {
          dh = ch
          dw = ch * sAspect
        }

        try {
          ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh)
        } catch {}
        ctx.restore()
      }
    }
  }

  function loop() {
    drawFrame()
    rafId = requestAnimationFrame(loop)
  }

  function start() {
    if (rafId !== null) return
    loop()
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function destroy() {
    stop()
    for (const entry of media.values()) {
      if (entry.kind === 'video') {
        const v = entry.el as HTMLVideoElement
        v.pause()
        v.removeAttribute('src')
        v.load()
      }
    }
    media.clear()
  }

  watch(() => state.value.tracks, cleanupStaleMedia, { deep: true })

  return { start, stop, destroy, drawFrame }
}
