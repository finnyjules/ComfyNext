import type { Vec3 } from '~/lib/scene3d/config'
import type { TrackEasing } from '~/lib/studio/track'

export type LoopKind = 'none' | 'spin' | 'bob' | 'pulse' | 'orbit' | 'sway' | 'tumble'
export type TransitionPreset = 'move' | 'rise' | 'scale' | 'fade' | 'pop'
export type Direction = 'left' | 'right' | 'top' | 'bottom'
export type ProceduralEase = 'bounce' | 'elastic' | 'spring'

export type EaseRef =
  | { kind: 'bezier'; cps: [number, number, number, number] }
  | { kind: 'named'; name: ProceduralEase }

export interface LoopSpec { kind: LoopKind; speed: number; amount: number; phase?: number }
export interface TransitionSpec {
  preset: TransitionPreset
  duration: number
  direction?: Direction
  ease: EaseRef
}
export interface ObjectMotion {
  loop?: LoopSpec
  in?: TransitionSpec
  out?: TransitionSpec
  offset?: number   // seconds; delays the `in` and seeds stagger
}
export interface CameraMotion {
  preset: 'none' | 'orbit' | 'push' | 'sway'
  speed: number
  amount: number
}
/**
 * A path-based motion track: writes an ABSOLUTE value at a dotted path over the clip,
 * evaluated by the shared `trackValue` (`~/lib/studio/track.ts`) — the same easing/loop/
 * hold/delay engine Gradient and Vector Type already use, reused rather than reinvented.
 *
 * Orthogonal to `ObjectMotion` above, not a replacement for it: `ObjectMotion` composes
 * per-frame DELTAS onto an object's home transform (position/rotation additive, scale
 * multiplicative); a track writes an ABSOLUTE value at a leaf — material/lighting/camera/
 * post params, never transform (SCENE_CONTROLS declares those `animatable: false` for
 * exactly this reason) and never `objects.<id>.motion.*` (the preset system's own state —
 * `applyMotionToDoc` refuses that sub-namespace explicitly, mirroring vectortype/motion.ts's
 * glyph-namespace skip).
 *
 * `path` is either an absolute doc-level path (`lighting.sunIntensity`, `post.bloomStrength`,
 * `camera.fov`) or an ID-ADDRESSED object path (`objects.<id>.material.relief.scale`) —
 * resolved through `setByIdPath` (`~/lib/studio/idPath.ts`), never `objects.<index>.*`, for
 * the same reorder-safety reason `sceneStackControls` addresses objects by id.
 */
export interface SceneMotionTrack {
  path: string
  from: number
  to: number
  easing: TrackEasing
  /** Cycles within the clip; >= 1. */
  loops: number
  /** Hold at extremes, 0..0.5. */
  hold: number
  /** Phase offset into the cycle, 0..1. */
  cycleOffset: number
  /** Start delay, seconds. */
  delay: number
}

export interface SceneMotion {
  duration: number
  fps: number
  loop: boolean
  template?: string
  /** Path-based tracks. Absent (not an empty array) on a doc with none, so old scene_state
   *  round-trips byte-identically through parseDoc(serializeDoc(doc)) — see config.ts's
   *  parseSceneMotion. */
  tracks?: SceneMotionTrack[]
}

export const DEFAULT_SCENE_MOTION: SceneMotion = { duration: 4, fps: 30, loop: true }

/** Delta to compose onto an object's home transform.
 *  position/rotation are ADDITIVE (world units / radians),
 *  scaleMul is MULTIPLICATIVE, opacity is ABSOLUTE in [0,1] (1 = fully visible). */
export interface MotionSample {
  dPosition: Vec3
  dRotation: Vec3
  scaleMul: Vec3
  opacity: number
}
