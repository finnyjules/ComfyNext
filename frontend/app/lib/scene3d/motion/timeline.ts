import type { ObjectMotion } from './types'

const MIN = 0.05
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

export function bandSegments(motion: ObjectMotion | undefined, duration: number) {
  const d = duration > 0 ? duration : 1
  const offset = clamp((motion?.offset ?? 0) / d, 0, 1)
  const inFrac = clamp((motion?.in?.duration ?? 0) / d, 0, 1)
  const outFrac = clamp((motion?.out?.duration ?? 0) / d, 0, 1)
  const loopFrac = Math.max(0, 1 - offset - inFrac - outFrac)
  return { offsetFrac: offset, inFrac, loopFrac, outFrac }
}

export function resizeTransition(motion: ObjectMotion, slot: 'in' | 'out', newSec: number, duration: number): void {
  const t = motion[slot]
  if (!t) return
  const offset = motion.offset ?? 0
  const other = slot === 'in' ? (motion.out?.duration ?? 0) : (motion.in?.duration ?? 0)
  t.duration = clamp(newSec, MIN, Math.max(MIN, duration - offset - other))
}

export function setClipOffset(motion: ObjectMotion, newSec: number, duration: number): void {
  const inSec = motion.in?.duration ?? 0
  const outSec = motion.out?.duration ?? 0
  motion.offset = clamp(newSec, 0, Math.max(0, duration - inSec - outSec))
}

export function snapSeconds(sec: number, targets: number[], epsSec = 0.08): number {
  let best = sec
  let bestD = epsSec
  for (const t of targets) {
    const dd = Math.abs(sec - t)
    if (dd <= bestD) {
      best = t
      bestD = dd
    }
  }
  return best
}
