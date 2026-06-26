import type { Params } from './effect'
import type { PostSettings } from './post'
import type { GradientStop } from './gradient'
import type { SpaceTypeState } from './state'

export interface Scene {
  params: Params
  post?: PostSettings
  projection?: 'perspective' | 'isometric'
  panX?: number
  panY?: number
  bgColor?: string
  gradientStops?: GradientStop[]
}

const CAMERA_ZERO = ['rotateX', 'rotateY', 'rotateZ'] as const

/** A copy of params with the camera/framing neutralized: rotate→0, scale→1 — but only for keys
 *  the effect actually declares (so we never inject controls it doesn't have). */
export function neutralizeCamera(params: Params): Params {
  const out: Params = { ...params }
  for (const k of CAMERA_ZERO) if (k in out) out[k] = 0
  if ('scale' in out) out.scale = 1
  return out
}

/** Content keys the user owns — a scene captures the LOOK, not the words/typeface, so applying a
 *  scene never overrides these (switching to a defaulted effect keeps your current text). */
export const SCENE_CONTENT_KEYS = ['text', 'font'] as const

/** Merge a saved scene over a base state: look params replace, but text/font are preserved from
 *  the base; post/projection/pan/bg/gradientStops override only when the scene provides them.
 *  Pure — returns a new state. */
export function applySceneToState(base: SpaceTypeState, scene: Scene): SpaceTypeState {
  const params: Params = { ...scene.params }
  for (const k of SCENE_CONTENT_KEYS) {
    if (k in base.params) params[k] = base.params[k]!
    else delete params[k]
  }
  return {
    ...base,
    params,
    ...(scene.post ? { post: { ...scene.post } } : {}),
    ...(scene.projection ? { projection: scene.projection } : {}),
    ...(scene.panX !== undefined ? { panX: scene.panX } : {}),
    ...(scene.panY !== undefined ? { panY: scene.panY } : {}),
    ...(scene.bgColor ? { bgColor: scene.bgColor } : {}),
    ...(scene.gradientStops ? { gradientStops: scene.gradientStops.map(g => ({ ...g })) } : {}),
  }
}
