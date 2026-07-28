// Scene document model for the 3D Studio. This is the single source of truth:
// the editor mutates a SceneDoc, the engine renders from it, and serializeDoc's
// output is what the Scene3DStudio node stores in its `scene_state` widget.
import { sanitizeParams, sanitizeModifiers } from '~/lib/scene3d/primParams'
import type { ObjectMotion, CameraMotion, SceneMotion, LoopKind, TransitionPreset, Direction, EaseRef, TransitionSpec } from '~/lib/scene3d/motion/types'
import { DEFAULT_SCENE_MOTION } from '~/lib/scene3d/motion/types'
import { DEFAULT_POST, type PostSettings } from '~/lib/spacetype/post'
// Scene3D does not have (and does not want) its own fill vocabulary — a shaderFill material
// carries the SAME ShaderSpec the shader-fill field module (~/lib/shaderfill/field.ts) already
// understands, imported straight from Type Studio's CPU fill model. This is the one place
// Scene3D reaches into ~/lib/spacetype: for the type + its tolerant parser, never for `Fill`/
// `FILL_TYPES` — see materials.ts for how the field itself gets rendered onto a mesh.
import { normalizeShaderSpec, DEFAULT_SHADER_SPEC, type ShaderSpec } from '~/lib/spacetype/fillTile'

export type PrimitiveKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
  | 'capsule' | 'pyramid' | 'prism'
  | 'icosahedron' | 'octahedron' | 'dodecahedron'
  | 'torusKnot' | 'ring'
  | 'text' | 'shape'
export type Vec3 = [number, number, number]

// Mirrors AVAILABLE_FONTS[0].url in outlines.ts. Duplicated as a literal rather
// than imported: outlines.ts pulls in three + the vendored opentype module, and
// importing it here would drag all of three into config's import graph.
export const DEFAULT_FONT_URL = '/fonts/ABCROM-Bold.otf'

// 'phong' is a DELIBERATE stylistic addition, not a legacy leftover: MeshPhongMaterial's
// specular/shininess model produces a hard, glossy, slightly artificial highlight dot that
// no amount of roughness tuning on the PBR types (standard/glass) can reproduce — that
// hard-dot look is a distinct retro-CG aesthetic worth keeping on its own terms. Do not
// "modernise" it away in favour of Standard.
export type MaterialType = 'standard' | 'phong' | 'toon' | 'matcap' | 'glass' | 'fresnel' | 'gradient' | 'image' | 'shaderFill'
export const MATERIAL_TYPES: MaterialType[] = ['standard', 'phong', 'toon', 'matcap', 'glass', 'fresnel', 'gradient', 'image', 'shaderFill']

/** One stop of the gradient ramp. `pos` is 0..1 along the ramp direction. */
export interface GradientStop { pos: number; color: string }

/** Ramp bounds: fewer than MIN or more than MAX stops is rejected by parsing. */
export const GRADIENT_STOPS_MIN = 2
export const GRADIENT_STOPS_MAX = 8

/** Surface relief — a grayscale height field perturbing the lit normal via THREE's
 *  `.bumpMap`. `image` stores the user's ORIGINAL uploaded bytes — NOT a pre-converted height
 *  map. (Revised from the original design, which had `image` ALWAYS already a height map,
 *  converted once client-side at upload time: that made "Use as-is" a no-op — toHeightPixels is
 *  idempotent on grayscale, so re-running it at render time produced byte-identical output to
 *  running it once at upload time — and silently flattened any REAL tangent-space normal map a
 *  user uploaded before they got a chance to mark it as one, unrecoverably. See the final
 *  surface-relief review, C2.) Conversion to a height field now happens exactly ONCE, at
 *  TEXTURE-BUILD time in materials.ts (getHeightTexture), never client-side and never twice.
 *  `spec` mirrors the shaderFill ShaderSpec and is luminance-converted the same way at build
 *  time, so every catalog effect gains relief with no per-effect shader work. */
export interface ReliefSpec {
  source: 'none' | 'shader' | 'image'
  spec?: ShaderSpec
  image?: string
  /** → THREE bumpScale. 1 is already extreme; the shipped default is 0.25. */
  scale: number
  invert?: boolean
  /** Contrast expansion around the height midpoint, applied at TEXTURE-BUILD time —
   *  same step as `invert` (see materials.ts's getHeightTexture/getShaderHeightTexture). Unlike
   *  `invert`, a contrast edit updates the bound texture's canvas IN PLACE rather than
   *  rebuilding the material — see materials.ts's reliefKey doc (C1 of the final review): it's
   *  a continuous slider, not a toggle, so folding it into the rebuild identity turned a drag
   *  into dozens of full material rebuilds. 1 = unchanged; bump responds to the height field's
   *  LOCAL GRADIENT, not its range (see relief.ts's heightGradient doc), so a flat-looking AI
   *  height map often needs this well above 1 to read as relief at all. Absent = 1, so old docs
   *  render identically. */
  contrast?: number
  /** How many times the height field repeats across the object's UVs → THREE's per-texture
   *  `.repeat`/`.wrapS`/`.wrapT` (RepeatWrapping), NOT a material property — see materials.ts's
   *  getHeightTexture/applyRelief doc for why that forces a per-material Texture instead of the
   *  shared-by-key one every relief texture used to be. Absent = 1 (the old stretch-once
   *  behaviour), so old docs render identically. Updates IN PLACE like `scale` — a slider drag
   *  must not rebuild the material — so it is deliberately excluded from materials.ts's
   *  reliefKey. */
  tiling?: number
}

export interface SceneMaterial {
  type: MaterialType
  color: string
  roughness: number
  metalness: number
  /** `phong` only — MeshPhongMaterial's specular-highlight tightness (three's own default
   *  is 30). Has no roughness/metalness equivalent; Phong ignores both. */
  shininess?: number
  /** `phong` only — the highlight's own colour, independent of the base `color`. */
  specular?: string
  toonSteps?: number
  matcap?: string
  ior?: number
  transmission?: number
  thickness?: number
  fresnelColor?: string
  fresnelPower?: number
  gradientB?: string
  gradientAxis?: 'x' | 'y' | 'z'
  /** smooth = one ramp across the object; faceted = one flat ramp tone per facet
   *  (low-poly look); prismatic = the full ramp runs across EACH facet
   *  individually (ShapeStudio's cut-gem shimmer). */
  gradientShading?: 'smooth' | 'faceted' | 'prismatic'
  /** Multi-stop ramp, 2–8 entries sorted by `pos`. Absent synthesizes the
   *  two-stop pair [color, gradientB] — so old documents render identically. */
  gradientStops?: GradientStop[]
  gradientType?: 'linear' | 'radial'
  /** Ramp direction as yaw (around Y, degrees) + pitch (elevation, degrees).
   *  Absent derives from `gradientAxis`, so the axis stays a live preset. */
  gradientYaw?: number
  gradientPitch?: number
  gradientOffset?: number   // -1..1, slides the ramp along the direction
  gradientSpread?: number   // 0.1..3, compresses (<1) / stretches (>1)
  image?: string
  /** `shaderFill` only — a catalog effect run over `shader.input`, mapped through the mesh's
   *  own UVs (object anchor). Frame anchor is out of scope for Scene3D: `shader.anchor` is
   *  never read by the material factory, so a `frame`-anchored spec (e.g. hand-edited JSON, or
   *  copied from a Type Studio/Shape Studio export) silently renders exactly like `object` —
   *  see materials.ts. Absent until the user actually picks the shaderFill material type. */
  shader?: ShaderSpec
  /** `shaderFill` only — MeshBasicMaterial (flat, unshaded) when true, MeshStandardMaterial
   *  (scene-lit) when false/absent. */
  unlit?: boolean
  /** Surface relief. Absent = flat, exactly as before. Never applied to an `unlit`
   *  shaderFill: that builds a MeshBasicMaterial, which has no bump slot at all. */
  relief?: ReliefSpec
  /** A REAL baked tangent-space normal map (Blender, a game asset) → `.normalMap`.
   *  Distinct from `relief` because a normal map must NOT go through the bump path —
   *  that would misread its blue channel as height. */
  normalImage?: string
  // physical surface (standard + glass; all optional, defaults render identical
  // to the pre-physical look)
  clearcoat?: number            // 0–1
  clearcoatRoughness?: number   // 0–1
  sheen?: number                // 0–1
  sheenColor?: string
  emissive?: string             // '#000000' = off
  emissiveIntensity?: number    // 0–5
  opacity?: number              // 0–1 (alpha translucency; <1 sets transparent)
  dispersion?: number           // 0–5 (chromatic aberration in transmission)
  attenuationColor?: string
  attenuationDistance?: number  // 0 = off (maps to Infinity)
  iridescence?: number          // 0–1
  iridescenceIOR?: number       // 1–2.33
  envMapIntensity?: number      // 0–3
}

export interface SceneObjectBase {
  id: string
  name: string
  visible: boolean
  position: Vec3
  rotation: Vec3   // euler radians, XYZ order
  scale: Vec3
  material: SceneMaterial
  motion?: ObjectMotion
}
/** Content for the `text` primitive (the `shape` primitive is params-only —
 *  its geometry is fully parametric, see primParams.ts). Absent `font` falls
 *  back to the engine's first available font. */
export interface PrimitiveContent { text?: string; font?: string }

export interface PrimitiveObject extends SceneObjectBase {
  kind: 'primitive'
  primitive: PrimitiveKind
  /** Geometry parameters keyed by ParamSpec.key (primParams.ts). Absent means
   *  every default, which reproduces the pre-parametric geometry. */
  params?: Record<string, number>
  /** Deformations applied on top of the built geometry, keyed by
   *  MODIFIER_SPECS.key (primParams.ts). Absent means undeformed. */
  modifiers?: Record<string, number>
  /** Non-geometric source content — currently only the `text` primitive's
   *  string + font. Absent for every other kind. */
  content?: PrimitiveContent
}
export interface GlbObject extends SceneObjectBase {
  kind: 'glb'
  url: string
  /** Replace the file's baked materials with the object's `material` (which
   *  otherwise sits unused on GLBs). Absent = off, keeping the imported look. */
  materialOverride?: boolean
}

export type LightKind = 'point' | 'spot' | 'rect'
export interface LightObject extends SceneObjectBase {
  kind: 'light'
  light: LightKind
  color: string
  intensity: number
  distance?: number   // point/spot range, 0 = infinite
  decay?: number      // point/spot falloff
  angle?: number      // spot cone half-angle (radians)
  penumbra?: number   // spot edge softness 0–1
  width?: number      // rect
  height?: number     // rect
  castShadow?: boolean // point/spot only
}

export type SceneObject = PrimitiveObject | GlbObject | LightObject

/** True when any object in `doc` currently needs the Scene3D per-frame shader-field
 *  refresh (`refreshSceneShaderFields` in materials.ts) — either it RENDERS a shaderFill
 *  material (a real ShaderSpec attached, not just the bare type picked with nothing to
 *  render yet), or it carries a SHADER surface relief (`relief.source === 'shader'` with
 *  `relief.spec` present). Widened for relief (Task 5 fix) because relief's null→bound
 *  bumpMap heal (see `refreshSceneShaderFields`'s doc) only ever runs from a call this
 *  gate is what triggers — a relief-only scene (no shaderFill material anywhere) used to
 *  never call `refreshSceneShaderFields` at all, so a bumpMap left null by a catalog-not-
 *  loaded-yet miss at material-construction time stayed null forever. The gate the Scene3D
 *  surface's per-frame loop uses (mirrors `configHasShaderFill` in lib/shapefx/surface.ts)
 *  so the shader-field refresh (beginFieldFrame + resolveField, a WebGL readback per live
 *  field) never runs for an ordinary scene that uses neither. Lights never render
 *  `material` (LIGHT_DEFAULTS carries a dummy `DEFAULT_MATERIAL`, see createLight) and a
 *  GLB's material only applies with `materialOverride` on — both still excluded. */
export function sceneHasShaderFill(doc: SceneDoc): boolean {
  return doc.objects.some((o) => {
    if (o.kind === 'light') return false
    if (o.kind === 'glb' && o.materialOverride !== true) return false
    const m = o.material
    if (m.type === 'shaderFill' && !!m.shader) return true
    return m.relief?.source === 'shader' && !!m.relief.spec
  })
}

export type LightingPreset = 'studio' | 'soft' | 'dramatic' | 'flat'
export interface SceneLighting {
  preset: LightingPreset
  sunAzimuth: number
  sunElevation: number
  sunIntensity: number
  ambient: number
}
export interface SceneCamera { position: Vec3; target: Vec3; fov: number; motion?: CameraMotion }

export interface SceneDoc {
  version: 1
  objects: SceneObject[]
  camera: SceneCamera
  lighting: SceneLighting
  background: string
  showFloor: boolean   // grid + shadow-catcher ground; false = clean floating look (viewport + render)
  post: PostSettings   // shared post-processing chain (bloom/colour/chroma/lens blur) — see lib/spacetype/post.ts
  output: { width: number; height: number }
  motion: SceneMotion
}

// Append, never reorder: stored indices are a persistence contract, and a
// PRIM_GROUPS drift test (scene3d-config.unit.spec.ts) asserts canonical order.
export const PRIMITIVE_KINDS: PrimitiveKind[] = [
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
  'capsule', 'pyramid', 'prism',
  'icosahedron', 'octahedron', 'dodecahedron',
  'torusKnot', 'ring',
  'text', 'shape',
]
export const LIGHTING_PRESETS: LightingPreset[] = ['studio', 'soft', 'dramatic', 'flat']

const LOOP_KINDS: LoopKind[] = ['none', 'spin', 'bob', 'pulse', 'orbit', 'sway', 'tumble']
const TRANSITION_PRESETS: TransitionPreset[] = ['move', 'rise', 'scale', 'fade', 'pop']
const DIRECTIONS: Direction[] = ['left', 'right', 'top', 'bottom']
const CAMERA_PRESETS: CameraMotion['preset'][] = ['none', 'orbit', 'push', 'sway']

export const LIGHT_KINDS: LightKind[] = ['point', 'spot', 'rect']
export const LIGHT_DEFAULTS = {
  color: '#ffffff', intensity: 8, distance: 0, decay: 2,
  angle: Math.PI / 6, penumbra: 0.3, width: 2, height: 2, castShadow: false,
} as const

// Point/spot lights are physical (candela, inverse-square decay), so they need
// much larger intensities than a directional/area light to read bright at a
// normal distance. Per-kind spawn defaults + slider ceilings keep each type in a
// range that feels right instead of a shared scale where point/spot stay faint.
export function lightIntensityDefault(kind: LightKind): number {
  return kind === 'rect' ? 8 : 80
}
export function lightIntensityMax(kind: LightKind): number {
  return kind === 'rect' ? 60 : 600
}

const DEFAULT_MATERIAL: SceneMaterial = { type: 'standard', color: '#9aa3af', roughness: 0.6, metalness: 0.0 }

/** Per-type parameter defaults — the single source of truth shared by the
 *  material factory (materials.ts) and the Selection UI's proxies. */
export const MATERIAL_DEFAULTS = {
  // three.js's own MeshPhongMaterial defaults.
  shininess: 30,
  specular: '#111111',
  toonSteps: 3,
  matcap: 'chrome',
  ior: 1.5,
  transmission: 1,
  thickness: 0.5,
  fresnelColor: '#8ab4ff',
  fresnelPower: 3,
  gradientB: '#1c2740',
  gradientAxis: 'y' as const,
  gradientShading: 'smooth' as const,
  gradientType: 'linear' as const,
  // Yaw/pitch defaults are the angles derived from the default axis ('y').
  gradientYaw: 0,
  gradientPitch: 90,
  gradientOffset: 0,
  gradientSpread: 1,
  clearcoat: 0,
  clearcoatRoughness: 0.1,
  sheen: 0,
  sheenColor: '#ffffff',
  emissive: '#000000',
  emissiveIntensity: 1,
  opacity: 1,
  dispersion: 0,
  attenuationColor: '#ffffff',
  attenuationDistance: 0,
  iridescence: 0,
  iridescenceIOR: 1.3,
  envMapIntensity: 1,
  reliefScale: 0.25,
  reliefContrast: 1,
  reliefTiling: 1,
  shader: DEFAULT_SHADER_SPEC,
  unlit: false,
}

// ── Gradient derivations (shared by the material factory and the Selection UI,
// so the editor and the render can never disagree) ───────────────────────────

/** Axis → (yaw, pitch) preset. Chosen so the projected-AABB `t` in the shader
 *  reduces exactly to the old per-axis formula for each of x/y/z. */
const AXIS_ANGLES = {
  x: { yaw: 90, pitch: 0 },
  y: { yaw: 0, pitch: 90 },
  z: { yaw: 0, pitch: 0 },
} as const

/** The ramp direction angles: the stored pair when present, else derived from
 *  `gradientAxis` (which therefore keeps working as a preset on old docs). */
export function gradientAngles(mat: SceneMaterial): { yaw: number; pitch: number } {
  const preset = AXIS_ANGLES[mat.gradientAxis ?? MATERIAL_DEFAULTS.gradientAxis]
  return {
    yaw: typeof mat.gradientYaw === 'number' ? mat.gradientYaw : preset.yaw,
    pitch: typeof mat.gradientPitch === 'number' ? mat.gradientPitch : preset.pitch,
  }
}

// Degree-exact sin/cos: Math.sin(Math.PI/2 * n) leaks ~1e-16 error at the
// quadrants, which would make the projected form only *approximately* reduce to
// the per-axis formula. Snapping the quadrants makes the axis presets exact.
function sinDeg(deg: number): number {
  const m = ((deg % 360) + 360) % 360
  if (m === 0 || m === 180) return 0
  if (m === 90) return 1
  if (m === 270) return -1
  return Math.sin((m * Math.PI) / 180)
}
const cosDeg = (deg: number): number => sinDeg(deg + 90)

/** Unit direction for a yaw/pitch pair. yaw 0 / pitch 0 → +Z, yaw 90 → +X,
 *  pitch 90 → +Y — matching AXIS_ANGLES above. */
export function gradientDirection(yaw: number, pitch: number): [number, number, number] {
  const cp = cosDeg(pitch)
  return [cp * sinDeg(yaw), sinDeg(pitch), cp * cosDeg(yaw)]
}

/** The ramp's stops: the stored array when present, else the synthesized pair
 *  built from the legacy `color` + `gradientB` fields.
 *
 *  Returns the stored array BY REFERENCE, deliberately, and does not sort: this
 *  is the ramp editor's model source, and the editor keeps its working array
 *  unsorted mid-drag so the dragged handle tracks the cursor instead of jumping
 *  when it crosses a neighbour. Sorting here would fight that. The render path
 *  is protected instead — `buildRampTexture` sorts its own copy. */
export function gradientStopsOf(mat: SceneMaterial): GradientStop[] {
  if (mat.gradientStops && mat.gradientStops.length >= GRADIENT_STOPS_MIN) return mat.gradientStops
  return [
    { pos: 0, color: mat.color },
    { pos: 1, color: mat.gradientB ?? MATERIAL_DEFAULTS.gradientB },
  ]
}

export function defaultDoc(): SceneDoc {
  return {
    version: 1,
    objects: [],
    camera: { position: [4, 3, 6], target: [0, 0.5, 0], fov: 45 },
    lighting: { preset: 'studio', sunAzimuth: 35, sunElevation: 55, sunIntensity: 1.4, ambient: 0.5 },
    background: '#1b1e24',
    showFloor: true,
    post: { ...DEFAULT_POST },
    output: { width: 1024, height: 1024 },
    motion: { ...DEFAULT_SCENE_MOTION },
  }
}

let idCounter = 0
function newId(): string {
  // crypto.randomUUID exists in every target runtime (browser + node test env);
  // the counter suffix guards against any exotic mock returning duplicates.
  return `obj_${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))}_${++idCounter}`
}

function numberedName(base: string, existing: SceneObject[]): string {
  const taken = new Set(existing.map((o) => o.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

export function createPrimitive(kind: PrimitiveKind, existing: SceneObject[] = []): PrimitiveObject {
  const base = kind.charAt(0).toUpperCase() + kind.slice(1)
  const obj: PrimitiveObject = {
    kind: 'primitive', primitive: kind,
    id: newId(), name: numberedName(base, existing), visible: true,
    position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL },
  }
  // 'shape' is params-only (sides/roundness/star numeric params in
  // primParams.ts) — no content to seed, like every other primitive.
  if (kind === 'text') obj.content = { text: 'Text', font: DEFAULT_FONT_URL }
  return obj
}

export function createGlbObject(url: string, existing: SceneObject[]): GlbObject {
  const base = decodeURIComponent(url.split('/').pop() ?? 'Model').replace(/\.glb.*$/i, '') || 'Model'
  return {
    kind: 'glb', url,
    id: newId(), name: numberedName(base, existing), visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL }, // rendered only when materialOverride is on; otherwise the GLB keeps its own
  }
}

export function createLight(kind: LightKind, existing: SceneObject[]): LightObject {
  const label = kind === 'rect' ? 'Area light' : kind === 'spot' ? 'Spot light' : 'Point light'
  return {
    id: newId(), name: numberedName(label, existing), kind: 'light', light: kind,
    visible: true, position: [2.5, 3, 2.5], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL }, // dummy, never rendered; kept for type uniformity
    color: LIGHT_DEFAULTS.color, intensity: lightIntensityDefault(kind),
    distance: LIGHT_DEFAULTS.distance, decay: LIGHT_DEFAULTS.decay,
    angle: LIGHT_DEFAULTS.angle, penumbra: LIGHT_DEFAULTS.penumbra,
    width: LIGHT_DEFAULTS.width, height: LIGHT_DEFAULTS.height,
    castShadow: LIGHT_DEFAULTS.castShadow,
  }
}

export function serializeDoc(doc: SceneDoc): string {
  return JSON.stringify(doc)
}

/** Tolerant parse: anything unusable degrades to defaultDoc(); partial docs are
 *  deep-merged over defaults so old scene_state survives new fields. */
export function parseDoc(json: string): SceneDoc {
  const d = defaultDoc()
  if (!json) return d
  let raw: any
  try { raw = JSON.parse(json) } catch { return d }
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return d
  const vec3 = (v: any, fb: Vec3): Vec3 =>
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number') ? [v[0] as number, v[1] as number, v[2] as number] : fb
  const str = (v: any, fb: string): string => (typeof v === 'string' ? v : fb)
  const num = (v: any, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
  const parseEaseRef = (raw: any): EaseRef => {
    if (raw && raw.kind === 'named' && (raw.name === 'bounce' || raw.name === 'elastic' || raw.name === 'spring')) {
      return { kind: 'named', name: raw.name }
    }
    const c = raw?.cps
    if (raw?.kind === 'bezier' && Array.isArray(c) && c.length === 4 && c.every((n: unknown) => typeof n === 'number')) {
      return { kind: 'bezier', cps: c as [number, number, number, number] }
    }
    return { kind: 'bezier', cps: [0.42, 0, 0.58, 1] }
  }
  const parseTransition = (raw: any): TransitionSpec | undefined => {
    if (!raw || !TRANSITION_PRESETS.includes(raw.preset)) return undefined
    const spec: TransitionSpec = { preset: raw.preset, duration: num(raw.duration, 0.6), ease: parseEaseRef(raw.ease) }
    if (DIRECTIONS.includes(raw.direction)) spec.direction = raw.direction
    return spec
  }
  const parseObjectMotion = (raw: any): ObjectMotion | undefined => {
    if (!raw || typeof raw !== 'object') return undefined
    const m: ObjectMotion = {}
    if (raw.loop && LOOP_KINDS.includes(raw.loop.kind)) {
      m.loop = { kind: raw.loop.kind, speed: num(raw.loop.speed, 1), amount: num(raw.loop.amount, 1) }
      if (typeof raw.loop.phase === 'number') m.loop.phase = num(raw.loop.phase, 0)
    }
    const mIn = parseTransition(raw.in); if (mIn) m.in = mIn
    const mOut = parseTransition(raw.out); if (mOut) m.out = mOut
    if (typeof raw.offset === 'number') m.offset = num(raw.offset, 0)
    return Object.keys(m).length ? m : undefined
  }
  const parseSceneMotion = (raw: any): SceneMotion => {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SCENE_MOTION }
    const m: SceneMotion = {
      duration: num(raw.duration, DEFAULT_SCENE_MOTION.duration),
      fps: num(raw.fps, DEFAULT_SCENE_MOTION.fps),
      loop: raw.loop !== false,
    }
    if (typeof raw.template === 'string') m.template = raw.template
    return m
  }
  const parseCameraMotion = (raw: any): CameraMotion | undefined => {
    if (!raw || !CAMERA_PRESETS.includes(raw.preset)) return undefined
    return { preset: raw.preset, speed: num(raw.speed, 1), amount: num(raw.amount, 1) }
  }
  // Tolerant merge over DEFAULT_POST: every field validated individually, so a
  // partially-valid or absent `post` (old scene_state) still yields a fully
  // populated, correctly-typed PostSettings rather than dropping the section.
  const parsePost = (raw: any): PostSettings => {
    const p = raw && typeof raw === 'object' ? raw : {}
    const bool = (v: any, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb)
    return {
      bloom: bool(p.bloom, DEFAULT_POST.bloom),
      bloomStrength: num(p.bloomStrength, DEFAULT_POST.bloomStrength),
      bloomRadius: num(p.bloomRadius, DEFAULT_POST.bloomRadius),
      bloomThreshold: num(p.bloomThreshold, DEFAULT_POST.bloomThreshold),
      color: bool(p.color, DEFAULT_POST.color),
      exposure: num(p.exposure, DEFAULT_POST.exposure),
      contrast: num(p.contrast, DEFAULT_POST.contrast),
      saturation: num(p.saturation, DEFAULT_POST.saturation),
      hue: num(p.hue, DEFAULT_POST.hue),
      chroma: bool(p.chroma, DEFAULT_POST.chroma),
      chromaAmount: num(p.chromaAmount, DEFAULT_POST.chromaAmount),
      blur: bool(p.blur, DEFAULT_POST.blur),
      blurAmount: num(p.blurAmount, DEFAULT_POST.blurAmount),
      film: bool(p.film, DEFAULT_POST.film),
      filmIntensity: num(p.filmIntensity, DEFAULT_POST.filmIntensity),
      filmGrayscale: bool(p.filmGrayscale, DEFAULT_POST.filmGrayscale),
      halftone: bool(p.halftone, DEFAULT_POST.halftone),
      halftoneRadius: num(p.halftoneRadius, DEFAULT_POST.halftoneRadius),
      halftoneScatter: num(p.halftoneScatter, DEFAULT_POST.halftoneScatter),
      dotScreen: bool(p.dotScreen, DEFAULT_POST.dotScreen),
      dotScreenScale: num(p.dotScreenScale, DEFAULT_POST.dotScreenScale),
      dotScreenAngle: num(p.dotScreenAngle, DEFAULT_POST.dotScreenAngle),
      glitch: bool(p.glitch, DEFAULT_POST.glitch),
      gtao: bool(p.gtao, DEFAULT_POST.gtao),
      gtaoRadius: num(p.gtaoRadius, DEFAULT_POST.gtaoRadius),
      gtaoIntensity: num(p.gtaoIntensity, DEFAULT_POST.gtaoIntensity),
      gtaoThickness: num(p.gtaoThickness, DEFAULT_POST.gtaoThickness),
    }
  }
  const parseMaterial = (m: any): SceneMaterial => {
    const out: SceneMaterial = {
      type: MATERIAL_TYPES.includes(m?.type) ? m.type : 'standard',
      color: str(m?.color, DEFAULT_MATERIAL.color),
      roughness: num(m?.roughness, DEFAULT_MATERIAL.roughness),
      metalness: num(m?.metalness, DEFAULT_MATERIAL.metalness),
    }
    // Optional per-type params: copy only when present AND valid, so absent
    // fields stay absent (keeps serialize→parse round-trips exact).
    if (typeof m?.shininess === 'number') out.shininess = num(m.shininess, MATERIAL_DEFAULTS.shininess)
    if (typeof m?.specular === 'string') out.specular = m.specular
    if (typeof m?.toonSteps === 'number') out.toonSteps = num(m.toonSteps, MATERIAL_DEFAULTS.toonSteps)
    if (typeof m?.matcap === 'string') out.matcap = m.matcap
    if (typeof m?.ior === 'number') out.ior = num(m.ior, MATERIAL_DEFAULTS.ior)
    if (typeof m?.transmission === 'number') out.transmission = num(m.transmission, MATERIAL_DEFAULTS.transmission)
    if (typeof m?.thickness === 'number') out.thickness = num(m.thickness, MATERIAL_DEFAULTS.thickness)
    if (typeof m?.fresnelColor === 'string') out.fresnelColor = m.fresnelColor
    if (typeof m?.fresnelPower === 'number') out.fresnelPower = num(m.fresnelPower, MATERIAL_DEFAULTS.fresnelPower)
    if (typeof m?.gradientB === 'string') out.gradientB = m.gradientB
    if (m?.gradientAxis === 'x' || m?.gradientAxis === 'y' || m?.gradientAxis === 'z') out.gradientAxis = m.gradientAxis
    if (m?.gradientShading === 'smooth' || m?.gradientShading === 'faceted' || m?.gradientShading === 'prismatic') out.gradientShading = m.gradientShading
    // Stops: clamp positions, sort, and drop the whole array unless 2–8 valid
    // entries survive — a dropped array falls back to the synthesized pair.
    if (Array.isArray(m?.gradientStops) && m.gradientStops.length <= GRADIENT_STOPS_MAX) {
      const stops: GradientStop[] = m.gradientStops
        .filter((s: any) => s && typeof s.pos === 'number' && Number.isFinite(s.pos) && typeof s.color === 'string')
        .map((s: any) => ({ pos: Math.min(1, Math.max(0, s.pos)), color: s.color as string }))
        .sort((a: GradientStop, b: GradientStop) => a.pos - b.pos)
      if (stops.length >= GRADIENT_STOPS_MIN && stops.length <= GRADIENT_STOPS_MAX) out.gradientStops = stops
    }
    if (m?.gradientType === 'linear' || m?.gradientType === 'radial') out.gradientType = m.gradientType
    if (typeof m?.gradientYaw === 'number') out.gradientYaw = num(m.gradientYaw, MATERIAL_DEFAULTS.gradientYaw)
    if (typeof m?.gradientPitch === 'number') out.gradientPitch = num(m.gradientPitch, MATERIAL_DEFAULTS.gradientPitch)
    if (typeof m?.gradientOffset === 'number') out.gradientOffset = num(m.gradientOffset, MATERIAL_DEFAULTS.gradientOffset)
    if (typeof m?.gradientSpread === 'number') out.gradientSpread = num(m.gradientSpread, MATERIAL_DEFAULTS.gradientSpread)
    if (typeof m?.image === 'string') out.image = m.image
    if (typeof m?.clearcoat === 'number') out.clearcoat = num(m.clearcoat, MATERIAL_DEFAULTS.clearcoat)
    if (typeof m?.clearcoatRoughness === 'number') out.clearcoatRoughness = num(m.clearcoatRoughness, MATERIAL_DEFAULTS.clearcoatRoughness)
    if (typeof m?.sheen === 'number') out.sheen = num(m.sheen, MATERIAL_DEFAULTS.sheen)
    if (typeof m?.sheenColor === 'string') out.sheenColor = m.sheenColor
    if (typeof m?.emissive === 'string') out.emissive = m.emissive
    if (typeof m?.emissiveIntensity === 'number') out.emissiveIntensity = num(m.emissiveIntensity, MATERIAL_DEFAULTS.emissiveIntensity)
    if (typeof m?.opacity === 'number') out.opacity = num(m.opacity, MATERIAL_DEFAULTS.opacity)
    if (typeof m?.dispersion === 'number') out.dispersion = num(m.dispersion, MATERIAL_DEFAULTS.dispersion)
    if (typeof m?.attenuationColor === 'string') out.attenuationColor = m.attenuationColor
    if (typeof m?.attenuationDistance === 'number') out.attenuationDistance = num(m.attenuationDistance, MATERIAL_DEFAULTS.attenuationDistance)
    if (typeof m?.iridescence === 'number') out.iridescence = num(m.iridescence, MATERIAL_DEFAULTS.iridescence)
    if (typeof m?.iridescenceIOR === 'number') out.iridescenceIOR = num(m.iridescenceIOR, MATERIAL_DEFAULTS.iridescenceIOR)
    if (typeof m?.envMapIntensity === 'number') out.envMapIntensity = num(m.envMapIntensity, MATERIAL_DEFAULTS.envMapIntensity)
    // normalizeShaderSpec is already tolerant of junk (falls back to DEFAULT_SHADER_SPEC's
    // fields piecewise) — only gate on `m.shader` being present at all, same "copy only when
    // present" rule as every other optional field above.
    if (m?.shader && typeof m.shader === 'object') out.shader = normalizeShaderSpec(m.shader, 0)
    if (typeof m?.unlit === 'boolean') out.unlit = m.unlit
    // Relief: same "copy only when present" rule as every other optional field, but the
    // nested shape needs its own coercion — a junk source degrades to 'none' rather than
    // dropping the whole block, so a hand-edited doc still loads.
    if (m?.relief && typeof m.relief === 'object') {
      const r = m.relief
      const rel: ReliefSpec = {
        source: r.source === 'shader' || r.source === 'image' ? r.source : 'none',
        scale: num(r.scale, MATERIAL_DEFAULTS.reliefScale),
      }
      if (typeof r.image === 'string') rel.image = r.image
      if (r.spec && typeof r.spec === 'object') rel.spec = normalizeShaderSpec(r.spec, 0)
      if (typeof r.invert === 'boolean') rel.invert = r.invert
      if (typeof r.contrast === 'number') rel.contrast = num(r.contrast, MATERIAL_DEFAULTS.reliefContrast)
      if (typeof r.tiling === 'number') rel.tiling = num(r.tiling, MATERIAL_DEFAULTS.reliefTiling)
      out.relief = rel
    }
    if (typeof m?.normalImage === 'string') out.normalImage = m.normalImage
    return out
  }
  // Tolerant content parse: any non-string/unknown field in a stored doc is
  // simply dropped; an empty result collapses to `undefined` so round-trips
  // through parseDoc(serializeDoc(doc)) stay exact for kinds without content.
  const parseContent = (raw: any): PrimitiveContent | undefined => {
    if (!raw || typeof raw !== 'object') return undefined
    const c: PrimitiveContent = {}
    if (typeof raw.text === 'string') c.text = raw.text
    if (typeof raw.font === 'string') c.font = raw.font
    return Object.keys(c).length ? c : undefined
  }
  const objects: SceneObject[] = Array.isArray(raw.objects)
    ? raw.objects.flatMap((o: any): SceneObject[] => {
        if (!o || typeof o.id !== 'string') return []
        const om = parseObjectMotion(o.motion)
        const common: SceneObjectBase = {
          id: o.id,
          name: typeof o.name === 'string' ? o.name : 'Object',
          visible: o.visible !== false,
          position: vec3(o.position, [0, 0, 0]),
          rotation: vec3(o.rotation, [0, 0, 0]),
          scale: vec3(o.scale, [1, 1, 1]),
          material: parseMaterial(o.material),
          ...(om ? { motion: om } : {}),
        }
        if (o.kind === 'glb' && typeof o.url === 'string') {
          return [{ ...common, kind: 'glb', url: o.url, ...(o.materialOverride === true ? { materialOverride: true } : {}) }]
        }
        if (o.kind === 'light' && LIGHT_KINDS.includes(o.light)) {
          return [{
            ...common, kind: 'light' as const, light: o.light,
            color: str(o.color, LIGHT_DEFAULTS.color),
            intensity: num(o.intensity, LIGHT_DEFAULTS.intensity),
            distance: num(o.distance, LIGHT_DEFAULTS.distance),
            decay: num(o.decay, LIGHT_DEFAULTS.decay),
            angle: num(o.angle, LIGHT_DEFAULTS.angle),
            penumbra: num(o.penumbra, LIGHT_DEFAULTS.penumbra),
            width: num(o.width, LIGHT_DEFAULTS.width),
            height: num(o.height, LIGHT_DEFAULTS.height),
            castShadow: o.castShadow === true,
          }]
        }
        if (o.kind === 'primitive' && PRIMITIVE_KINDS.includes(o.primitive)) {
          const params = sanitizeParams(o.primitive, o.params)
          const modifiers = sanitizeModifiers(o.modifiers)
          const content = parseContent(o.content)
          return [{
            ...common, kind: 'primitive', primitive: o.primitive,
            ...(params ? { params } : {}),
            ...(modifiers ? { modifiers } : {}),
            ...(content ? { content } : {}),
          }]
        }
        return []
      })
    : []
  const doc: SceneDoc = {
    version: 1,
    objects,
    camera: {
      position: vec3(raw.camera?.position, d.camera.position),
      target: vec3(raw.camera?.target, d.camera.target),
      fov: typeof raw.camera?.fov === 'number' ? raw.camera.fov : d.camera.fov,
    },
    lighting: {
      preset: LIGHTING_PRESETS.includes(raw.lighting?.preset) ? raw.lighting.preset : d.lighting.preset,
      sunAzimuth: typeof raw.lighting?.sunAzimuth === 'number' ? raw.lighting.sunAzimuth : d.lighting.sunAzimuth,
      sunElevation: typeof raw.lighting?.sunElevation === 'number' ? raw.lighting.sunElevation : d.lighting.sunElevation,
      sunIntensity: typeof raw.lighting?.sunIntensity === 'number' ? raw.lighting.sunIntensity : d.lighting.sunIntensity,
      ambient: typeof raw.lighting?.ambient === 'number' ? raw.lighting.ambient : d.lighting.ambient,
    },
    background: typeof raw.background === 'string' ? raw.background : d.background,
    showFloor: raw.showFloor !== false,   // default true; only an explicit false hides the floor
    post: parsePost(raw.post),
    output: {
      width: typeof raw.output?.width === 'number' ? raw.output.width : d.output.width,
      height: typeof raw.output?.height === 'number' ? raw.output.height : d.output.height,
    },
    motion: parseSceneMotion(raw.motion),
  }
  const cm = parseCameraMotion(raw.camera?.motion)
  if (cm) doc.camera.motion = cm
  return doc
}
