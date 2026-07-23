// frontend/app/lib/motion/timelineBands.ts
/**
 * Pure band geometry + drag mutations for the compositor's docked motion
 * timeline. Mirrors lib/scene3d/motion/timeline.ts but typed to
 * LayerAnimation, whose window has an optional `duration`
 * (undefined = "to frame end") — bands therefore have a draggable end edge.
 * Seconds in/out; `bandSegments` returns fractions of the frame duration.
 */
import type { LayerAnimation } from './types'

export const BAND_MIN = 0.05
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

export function windowSeconds(anim: LayerAnimation, frameDur: number): { start: number; end: number } {
  const start = clamp(anim.offset ?? 0, 0, frameDur)
  const end = anim.duration == null ? frameDur : clamp(start + Math.max(0, anim.duration), start, frameDur)
  return { start, end }
}

export function bandSegments(anim: LayerAnimation | undefined, frameDur: number) {
  const d = frameDur > 0 ? frameDur : 1
  if (!anim) return { offset: 0, in: 0, loop: 1, out: 0, end: 1 }
  const { start, end } = windowSeconds(anim, d)
  const offset = start / d
  const endF = end / d
  const win = endF - offset
  const inF = clamp((anim.in?.duration ?? 0) / d, 0, win)
  const outF = clamp((anim.out?.duration ?? 0) / d, 0, Math.max(0, win - inF))
  return { offset, in: inF, loop: Math.max(0, win - inF - outF), out: outF, end: endF }
}

export function setClipOffset(anim: LayerAnimation, newSec: number, frameDur: number): void {
  const maxOffset = anim.duration == null
    ? Math.max(0, frameDur - BAND_MIN)
    : Math.max(0, frameDur - anim.duration)
  anim.offset = clamp(newSec, 0, maxOffset)
}

export function resizeTransition(anim: LayerAnimation, slot: 'in' | 'out', newSec: number, frameDur: number): void {
  const spec = anim[slot]
  if (!spec) return
  const { start, end } = windowSeconds(anim, frameDur)
  const win = end - start
  const other = slot === 'in' ? (anim.out?.duration ?? 0) : (anim.in?.duration ?? 0)
  spec.duration = clamp(newSec, BAND_MIN, Math.max(BAND_MIN, win - other))
}

export function setWindowDuration(anim: LayerAnimation, newSec: number, frameDur: number): void {
  const start = clamp(anim.offset ?? 0, 0, frameDur)
  const maxDur = Math.max(BAND_MIN, frameDur - start)
  if (newSec >= maxDur - 1e-6) { anim.duration = undefined; return }
  const minDur = Math.max(BAND_MIN, (anim.in?.duration ?? 0) + (anim.out?.duration ?? 0))
  anim.duration = clamp(newSec, Math.min(minDur, maxDur), maxDur)
}

export function snapSeconds(sec: number, targets: number[], epsSec = 0.08): number {
  let best = sec
  let bestDist = epsSec
  for (const t of targets) {
    const d = Math.abs(sec - t)
    if (d <= bestDist) { best = t; bestDist = d }
  }
  return best
}
