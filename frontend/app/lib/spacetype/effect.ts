import type * as THREE from 'three'

export type ParamValue = number | string | boolean
export type Params = Record<string, ParamValue>

export type ControlSpec =
  | { key: string; label: string; kind: 'slider'; min: number; max: number; step: number; default: number; group?: string }
  | { key: string; label: string; kind: 'text'; default: string; group?: string }
  | { key: string; label: string; kind: 'color'; default: string; group?: string }
  | { key: string; label: string; kind: 'select'; options: string[]; default: string; group?: string }
  | { key: string; label: string; kind: 'font'; default: string; group?: string }

/** Build the param object from a control list's declared defaults. */
export function defaultsFromControls(controls: ControlSpec[]): Params {
  const out: Params = {}
  for (const c of controls) out[c.key] = c.default
  return out
}

/**
 * The pluggable seam of the Space Type suite. Each effect declares its own
 * controls (so the surface auto-builds its UI), builds a Three.js scene graph
 * from a text texture + params, and advances that graph by normalized loop
 * time `t01 ∈ [0,1)`. Adding cylinder/field later = a new module implementing
 * this — no engine or surface changes.
 */
export interface SpaceTypeEffect {
  id: string
  label: string
  controls: ControlSpec[]
  /** Build the scene root. Called when the effect or any structural param changes. */
  buildScene(three: typeof THREE, params: Params, textTexture: THREE.Texture): THREE.Object3D
  /** Advance the existing scene to normalized loop time t01. Pure in t01. */
  update(t01: number, params: Params): void
}
