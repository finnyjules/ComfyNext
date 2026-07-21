import type { Vec3 } from '~/lib/scene3d/config'
import type { ObjectMotion, CameraMotion, MotionSample } from './types'
import { evaluateLoop, evaluateTransition } from './presets'
import { resolveEaseRef } from './ease'

const TAU = Math.PI * 2
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function evaluateObjectMotion(
  motion: ObjectMotion | undefined, tSec: number, duration: number,
): MotionSample {
  const s: MotionSample = { dPosition: [0, 0, 0], dRotation: [0, 0, 0], scaleMul: [1, 1, 1], opacity: 1 }
  if (!motion || duration <= 0) return s

  if (motion.loop) {
    const l = evaluateLoop(motion.loop, tSec / duration)
    s.dPosition = [l.dPosition[0], l.dPosition[1], l.dPosition[2]]
    s.dRotation = [l.dRotation[0], l.dRotation[1], l.dRotation[2]]
    s.scaleMul = [l.scaleMul[0], l.scaleMul[1], l.scaleMul[2]]
  }

  const offset = motion.offset ?? 0
  let trans: Partial<MotionSample> | undefined
  if (motion.in) {
    const inEnd = offset + motion.in.duration
    if (tSec <= inEnd) {
      const p = motion.in.duration > 0 ? clamp01((tSec - offset) / motion.in.duration) : 1
      trans = evaluateTransition(motion.in.preset, motion.in.direction, resolveEaseRef(motion.in.ease)(p), 'in')
    }
  }
  if (!trans && motion.out) {
    const outStart = duration - motion.out.duration
    if (tSec >= outStart) {
      const p = motion.out.duration > 0 ? clamp01((tSec - outStart) / motion.out.duration) : 1
      trans = evaluateTransition(motion.out.preset, motion.out.direction, resolveEaseRef(motion.out.ease)(p), 'out')
    }
  }
  if (trans) {
    if (trans.dPosition) s.dPosition = add(s.dPosition, trans.dPosition)
    if (trans.dRotation) s.dRotation = add(s.dRotation, trans.dRotation)
    if (trans.scaleMul) s.scaleMul = mul(s.scaleMul, trans.scaleMul)
    if (trans.opacity !== undefined) s.opacity = trans.opacity
  }
  return s
}

export function evaluateCameraMotion(
  cam: CameraMotion | undefined, t01: number,
): { dPosition: Vec3; dTargetYaw: number } {
  if (!cam || cam.preset === 'none') return { dPosition: [0, 0, 0], dTargetYaw: 0 }
  const cyc = Math.max(1, Math.round(cam.speed))
  if (cam.preset === 'orbit') return { dPosition: [0, 0, 0], dTargetYaw: t01 * TAU * cyc }
  if (cam.preset === 'sway') return { dPosition: [0, 0, 0], dTargetYaw: Math.sin(t01 * TAU * cyc) * 0.08 * cam.amount }
  // push: ease in then out along a closed sine envelope (0 at ends)
  const k = Math.sin(t01 * Math.PI) * 0.15 * cam.amount
  return { dPosition: [0, 0, -k], dTargetYaw: 0 }
}

function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function mul(a: Vec3, b: Vec3): Vec3 { return [a[0] * b[0], a[1] * b[1], a[2] * b[2]] }
