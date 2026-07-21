// Pure doc-mutation helpers for the Motion panel (Scene3DStudioSurface.vue).
// StudioSelect binds `options: string[]` via `defineModel<string>` (plain value,
// capitalized for display by the component itself) — NOT `{value,label}` pairs.
import type { SceneObject } from '~/lib/scene3d/config'
import type { LoopKind, TransitionPreset, CameraMotion, Direction } from './types'

export const LOOP_OPTIONS: LoopKind[] = ['none', 'spin', 'bob', 'pulse', 'orbit', 'sway', 'tumble']
export const IN_OPTIONS: (TransitionPreset | 'none')[] = ['none', 'move', 'rise', 'scale', 'fade', 'pop']
export const OUT_OPTIONS = IN_OPTIONS
export const CAMERA_OPTIONS: CameraMotion['preset'][] = ['none', 'orbit', 'push', 'sway']

const DEFAULT_EASE = { kind: 'bezier' as const, cps: [0, 0, 0.58, 1] as [number, number, number, number] }

export function ensureObjectMotion(obj: SceneObject) {
  if (!obj.motion) obj.motion = {}
  return obj.motion
}

export function setObjectLoop(obj: SceneObject, kind: LoopKind) {
  const m = ensureObjectMotion(obj)
  if (kind === 'none') {
    delete m.loop
    if (!m.in && !m.out && m.offset === undefined) obj.motion = undefined
    return
  }
  m.loop = {
    kind,
    speed: 1,
    amount: 1,
    ...(m.loop ? { speed: m.loop.speed, amount: m.loop.amount, phase: m.loop.phase } : {}),
  }
}

export function setObjectTransition(obj: SceneObject, slot: 'in' | 'out', preset: TransitionPreset | 'none') {
  const m = ensureObjectMotion(obj)
  if (preset === 'none') {
    delete m[slot]
    if (!m.loop && !m.in && !m.out) obj.motion = undefined
    return
  }
  m[slot] = { preset, duration: 0.6, ease: DEFAULT_EASE }
}

export function setObjectDirection(obj: SceneObject, slot: 'in' | 'out', dir: Direction) {
  const t = obj.motion?.[slot]; if (!t) return
  t.direction = dir
}
