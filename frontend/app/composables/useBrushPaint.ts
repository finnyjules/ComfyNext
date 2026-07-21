import { ref } from 'vue'
import type { PaintStroke } from '~/lib/compositor/brushStamp'

export type BrushMode = 'paint' | 'mask'

export function useBrushPaint() {
  const active = ref(false)
  const mode = ref<BrushMode>('paint')
  const sizePx = ref(40)          // brush DIAMETER, display px
  const color = ref('#3b82f6')
  const opacity = ref(1)          // 0..1
  const hardness = ref(1)         // 1 hard … 0 soft
  const smoothing = ref(true)
  const eraser = ref(false)
  const cursor = ref<{ x: number; y: number } | null>(null) // width-normalized, for the ring

  let live: PaintStroke | null = null
  const hasLiveStroke = ref(false)

  function radiusNorm(baseW: number): number {
    return Math.max(0.0005, sizePx.value / 2 / Math.max(1, baseW))
  }
  function setActive(v: boolean) { active.value = v; if (!v) { live = null; hasLiveStroke.value = false } }

  function beginStroke(nx: number, ny: number, baseW: number) {
    live = { points: [{ x: nx, y: ny }], radius: radiusNorm(baseW), hardness: hardness.value, opacity: opacity.value, erase: eraser.value }
    hasLiveStroke.value = true
  }
  function extendStroke(nx: number, ny: number) {
    if (!live) return
    // Drop micro-moves so smoothing has clean input.
    const last = live.points[live.points.length - 1]!
    if (Math.hypot(nx - last.x, ny - last.y) < 0.0008) return
    live.points.push({ x: nx, y: ny })
  }
  function endStroke(): PaintStroke | null {
    const s = live
    live = null; hasLiveStroke.value = false
    return s && s.points.length ? s : null
  }
  const liveStroke = () => live

  return {
    active, mode, sizePx, color, opacity, hardness, smoothing, eraser, cursor, hasLiveStroke,
    setActive, radiusNorm, beginStroke, extendStroke, endStroke, liveStroke,
  }
}
