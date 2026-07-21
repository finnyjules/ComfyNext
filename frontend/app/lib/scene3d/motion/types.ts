import type { Vec3 } from '~/lib/scene3d/config'

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
export interface SceneMotion { duration: number; fps: number; loop: boolean; template?: string }

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
