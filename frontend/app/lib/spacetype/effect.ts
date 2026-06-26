import type * as THREE from 'three'

export type ParamValue = number | string | boolean
export type Params = Record<string, ParamValue>

/** Optional metadata any control kind may carry. `hint` is a short semantic
 *  description used by the AI control copilot (and doubles as tooltip text).
 *  `aiEditable` overrides the kind-based default (slider/select/color/font are
 *  editable; text/textList/fillList/path are not). */
type ControlMeta = { hint?: string; aiEditable?: boolean }

export type ControlSpec = (
  | { key: string; label: string; kind: 'slider'; min: number; max: number; step: number; default: number; group: string }
  | { key: string; label: string; kind: 'text'; default: string; group: string }
  // Multiple texts that the effect ALTERNATES per word-repeat/instance. Stored as one
  // newline-separated string in params (so ParamValue stays scalar); the surface renders
  // add/remove rows and the texture pipeline splits it into an N-row atlas.
  | { key: string; label: string; kind: 'textList'; default: string; group: string }
  // A list of "fills" (per-slot colour recipes: solid / gradient / grid / noise). Stored as one
  // JSON string in params; the surface renders a type dropdown + dependent colour pickers per row.
  | { key: string; label: string; kind: 'fillList'; default: string; group: string }
  | { key: string; label: string; kind: 'color'; default: string; group: string }
  | { key: string; label: string; kind: 'select'; options: string[]; default: string; group: string }
  | { key: string; label: string; kind: 'font'; default: string; group: string }
  // An interactive bézier path drawn on the preview (String effect). Stored as one JSON
  // string in params (StringPathDoc); the surface renders the StringPathEditor overlay.
  | { key: string; label: string; kind: 'path'; default: string; group: string }
) & ControlMeta

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
/** Render-target info passed to buildScene (e.g. the String effect maps a normalized
 *  drawn path into world space and needs the frame aspect). Optional — most effects ignore it. */
export interface BuildEnv { width: number; height: number; axes?: Record<string, number> }

export interface SpaceTypeEffect {
  id: string
  label: string
  controls: ControlSpec[]
  /** Build the scene root. Called when the effect or any structural param changes. */
  buildScene(three: typeof THREE, params: Params, textTexture: THREE.Texture, env?: BuildEnv): THREE.Object3D
  /** Advance the existing scene to normalized loop time t01. Pure in t01. */
  update(t01: number, params: Params): void
  /** Keys read live in update() each frame (vertex/uniform/transform params). Changing one
   *  should NOT trigger a structural rebuild. Omit → every key is treated as structural. */
  liveKeys?: string[]
  /** The distinct per-frame motion RATES (coefficients of t01, in whole cycles) this effect
   *  advances at — the seamless-loop export renders enough loops that ALL complete whole cycles.
   *  Must include every motion that multiplies t01, including per-ring/per-instance variations.
   *  Omit → exports as a single loop. */
  loopRates?(params: Params): number[]
}
