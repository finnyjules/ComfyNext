import type { Vec3 } from '~/lib/scene3d/config'
import type { LoopSpec, TransitionPreset, Direction, MotionSample } from './types'
import { backOut } from '~/lib/motion/easing'

export const MOVE_DIST = 2
export const RISE_DIST = 2
const TAU = Math.PI * 2
const SCALE_EPS = 0.001

/** integer cycles per scene loop so motion closes at t01=1 (>=1). */
function cycles(speed: number): number { return Math.max(1, Math.round(Math.abs(speed))) }

export function directionVector(dir: Direction, dist: number): Vec3 {
  switch (dir) {
    case 'left': return [-dist, 0, 0]
    case 'right': return [dist, 0, 0]
    case 'top': return [0, dist, 0]
    case 'bottom': return [0, -dist, 0]
  }
}

export function evaluateLoop(loop: LoopSpec, t01: number): MotionSample {
  const s: MotionSample = { dPosition: [0, 0, 0], dRotation: [0, 0, 0], scaleMul: [1, 1, 1], opacity: 1 }
  const a = loop.amount
  const th = t01 * TAU * cycles(loop.speed)
  const phase = (loop.phase ?? 0) * TAU
  const p = th + phase
  const norm = (v: number) => Math.abs(v) < 1e-10 ? 0 : v // Normalizes near-zero to 0
  switch (loop.kind) {
    case 'spin': s.dRotation = [0, th, 0]; break                       // wraps to 0 at t01=1
    case 'bob': {
      const y = (Math.sin(p) - Math.sin(phase)) * a
      s.dPosition = [0, norm(y), 0] as Vec3
      break
    }
    case 'pulse': { const k = 1 + (Math.sin(p) - Math.sin(phase)) * 0.15 * a; s.scaleMul = [k, k, k]; break }
    case 'orbit': {
      const x = Math.sin(th) * a
      const z = (1 - Math.cos(th)) * a
      s.dPosition = [norm(x), 0, norm(z)]
      break
    }
    case 'sway': s.dRotation = [0, 0, (Math.sin(p) - Math.sin(phase)) * 0.25 * a]; break
    case 'tumble': s.dRotation = [th, th, 0]; break                    // both wrap
    case 'none': break
  }
  return s
}

/** in: p 0→1 offscreen→home. out: p 0→1 home→gone. `pop` ignores caller ease (own overshoot). */
export function evaluateTransition(
  preset: TransitionPreset, dir: Direction | undefined, p: number, mode: 'in' | 'out',
): Partial<MotionSample> {
  const away = mode === 'in' ? 1 - p : p   // fraction "away from home"
  switch (preset) {
    case 'move': {
      const v = directionVector(dir ?? (mode === 'in' ? 'left' : 'right'), MOVE_DIST)
      return { dPosition: [v[0] * away, v[1] * away, v[2] * away] }
    }
    case 'rise': {
      const v = directionVector(dir ?? (mode === 'in' ? 'bottom' : 'top'), RISE_DIST)
      return { dPosition: [v[0] * away, v[1] * away, v[2] * away] }
    }
    case 'scale': { const k = 1 - away * (1 - SCALE_EPS); return { scaleMul: [k, k, k] } }
    case 'fade': return { opacity: mode === 'in' ? p : 1 - p }
    case 'pop': {
      // in: overshoot up to home; out: quick scale down (no overshoot)
      const k = mode === 'in' ? Math.max(SCALE_EPS, backOut()(p)) : Math.max(SCALE_EPS, 1 - p)
      return { scaleMul: [k, k, k] }
    }
  }
}
