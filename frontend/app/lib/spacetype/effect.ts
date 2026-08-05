import type * as THREE from 'three'
import type { ParamValue, Params } from '~~/shared/spacetype/state'

export type { ParamValue, Params } from '~~/shared/spacetype/state'

/** Optional metadata any control kind may carry. `hint` is a short semantic
 *  description used by the AI control copilot (and doubles as tooltip text).
 *  `aiEditable` overrides the kind-based default (slider/select/color/font are
 *  editable; text/textList/fillList/path are not).
 *  `showIf` hides the control unless another param matches — used for mode-specific
 *  controls (e.g. a second axis's controls that only apply in a 'crosshatch' mode). */
type ControlMeta = {
  hint?: string
  aiEditable?: boolean
  showIf?: { key: string; equals?: ParamValue; notEquals?: ParamValue }
  /**
   * Set false to declare a control in the schema while withholding it from the
   * agent's vocabulary. Used for controls the agent has never been offered, so
   * declaring them for motion/inspector purposes is not a silent expansion of
   * what the model can change. Defaults to true.
   */
  agent?: boolean
  /**
   * Motion-track eligibility for numeric controls. Sliders are animatable by
   * default; pass false to opt out, or an explicit range when animation should
   * allow more than the UI slider does (e.g. layer.shape.sweep: slider 20..360,
   * animation 0..360).
   */
  animatable?: boolean | { min: number; max: number }
  /**
   * Rank in the collapsed node capsule's read-out line. The two lowest ranks
   * render, in ascending order; absent means never shown. Opt-in like `agent`
   * and `animatable`, so declaring a control can never silently widen what a
   * capsule advertises.
   */
  summary?: number
}

export type ControlSpec = (
  | { key: string; label: string; kind: 'slider'; min: number; max: number; step: number; default: number; group: string }
  // A boolean toggle. Added because post-effect enables are booleans and modelling
  // them as a two-option select writes the STRING 'on' into a BOOLEAN field —
  // makeConfigParams' proxy writes through with no coercion, corrupting the doc.
  // See lib/scene3d/controls.ts's "Boolean gap" note, which this closes.
  | { key: string; label: string; kind: 'switch'; default: boolean; group: string }
  | { key: string; label: string; kind: 'text'; default: string; group: string }
  // Multiple texts that the effect ALTERNATES per word-repeat/instance. Stored as one
  // newline-separated string in params (so ParamValue stays scalar); the surface renders
  // add/remove rows and the texture pipeline splits it into an N-row atlas.
  | { key: string; label: string; kind: 'textList'; default: string; group: string }
  // A list of "fills" (per-slot colour recipes: solid / gradient / grid / noise). Stored as one
  // JSON string in params; the surface renders a type dropdown + dependent colour pickers per row.
  | { key: string; label: string; kind: 'fillList'; default: string; group: string }
  // An ordered list of gradient stops (`[{pos,color},…]`). Stored as JSON text for
  // the same reason `fillList` is — `ParamValue` is scalar — and normalized back to
  // an array by the single `cleanStops` in ~/lib/shaderfx/params.ts, which accepts
  // either form so the text and the array are one canonical value, not two.
  // `maxStops` mirrors the consuming shader's array size.
  | { key: string; label: string; kind: 'gradientStops'; default: string; maxStops?: number; group: string }
  | { key: string; label: string; kind: 'color'; default: string; group: string }
  | { key: string; label: string; kind: 'select'; options: string[]; default: string; group: string }
  | { key: string; label: string; kind: 'font'; default: string; group: string }
  // An interactive bézier path drawn on the preview (String effect). Stored as one JSON
  // string in params (StringPathDoc); the surface renders the StringPathEditor overlay.
  | { key: string; label: string; kind: 'path'; default: string; group: string }
  // A draggable cubic-bézier easing graph. Stored as a JSON string "[x1,y1,x2,y2]" (the two
  // control points; P0=(0,0), P3=(1,1)); the surface renders a CurveEditor.
  | { key: string; label: string; kind: 'curve'; default: string; group: string }
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
  /** Hidden effects stay registered (saved configs still resolve) but don't appear in the picker. */
  hidden?: boolean
  controls: ControlSpec[]
  /** Build the scene root. Called when the effect or any structural param changes. */
  buildScene(three: typeof THREE, params: Params, textTexture: THREE.Texture, env?: BuildEnv): THREE.Object3D
  /** Advance the existing scene to normalized loop time t01. Pure in t01.
   *  `root` is the engine's currently-mounted scene root (the one this effect's buildScene
   *  returned for this engine/key). Effects that keep per-scene state MUST stash it on
   *  `root.userData` in buildScene and read it back from here — module-level state is shared
   *  across concurrent engines (card preview + headless frame source) and cached roots, so it
   *  freezes whichever surface didn't build last. Optional for effects that hold no state. */
  update(t01: number, params: Params, root?: THREE.Object3D): void
  /** Keys read live in update() each frame (vertex/uniform/transform params). Changing one
   *  should NOT trigger a structural rebuild. Omit → every key is treated as structural. */
  liveKeys?: string[]
  /** The distinct per-frame motion RATES (coefficients of t01, in whole cycles) this effect
   *  advances at — the seamless-loop export renders enough loops that ALL complete whole cycles.
   *  Must include every motion that multiplies t01, including per-ring/per-instance variations.
   *  Omit → exports as a single loop. */
  loopRates?(params: Params): number[]
}
