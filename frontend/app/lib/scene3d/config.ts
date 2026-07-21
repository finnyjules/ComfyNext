// Scene document model for the 3D Studio. This is the single source of truth:
// the editor mutates a SceneDoc, the engine renders from it, and serializeDoc's
// output is what the Scene3DStudio node stores in its `scene_state` widget.
import { sanitizeParams, sanitizeModifiers } from '~/lib/scene3d/primParams'
import type { ObjectMotion, CameraMotion, SceneMotion, LoopKind, TransitionPreset, Direction, EaseRef, TransitionSpec } from '~/lib/scene3d/motion/types'
import { DEFAULT_SCENE_MOTION } from '~/lib/scene3d/motion/types'

export type PrimitiveKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
  | 'capsule' | 'pyramid' | 'prism'
  | 'icosahedron' | 'octahedron' | 'dodecahedron'
  | 'torusKnot' | 'ring'
export type Vec3 = [number, number, number]

export type MaterialType = 'standard' | 'toon' | 'matcap' | 'glass' | 'fresnel' | 'gradient' | 'image'
export const MATERIAL_TYPES: MaterialType[] = ['standard', 'toon', 'matcap', 'glass', 'fresnel', 'gradient', 'image']

/** One stop of the gradient ramp. `pos` is 0..1 along the ramp direction. */
export interface GradientStop { pos: number; color: string }

/** Ramp bounds: fewer than MIN or more than MAX stops is rejected by parsing. */
export const GRADIENT_STOPS_MIN = 2
export const GRADIENT_STOPS_MAX = 8

export interface SceneMaterial {
  type: MaterialType
  color: string
  roughness: number
  metalness: number
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
export interface PrimitiveObject extends SceneObjectBase {
  kind: 'primitive'
  primitive: PrimitiveKind
  /** Geometry parameters keyed by ParamSpec.key (primParams.ts). Absent means
   *  every default, which reproduces the pre-parametric geometry. */
  params?: Record<string, number>
  /** Deformations applied on top of the built geometry, keyed by
   *  MODIFIER_SPECS.key (primParams.ts). Absent means undeformed. */
  modifiers?: Record<string, number>
}
export interface GlbObject extends SceneObjectBase { kind: 'glb'; url: string }

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
  output: { width: number; height: number }
  motion: SceneMotion
}

export const PRIMITIVE_KINDS: PrimitiveKind[] = [
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
  'capsule', 'pyramid', 'prism',
  'icosahedron', 'octahedron', 'dodecahedron',
  'torusKnot', 'ring',
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

export function createPrimitive(kind: PrimitiveKind, existing: SceneObject[]): PrimitiveObject {
  const base = kind.charAt(0).toUpperCase() + kind.slice(1)
  return {
    kind: 'primitive', primitive: kind,
    id: newId(), name: numberedName(base, existing), visible: true,
    position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL },
  }
}

export function createGlbObject(url: string, existing: SceneObject[]): GlbObject {
  const base = decodeURIComponent(url.split('/').pop() ?? 'Model').replace(/\.glb.*$/i, '') || 'Model'
  return {
    kind: 'glb', url,
    id: newId(), name: numberedName(base, existing), visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL }, // GLBs keep their own materials; kept for type uniformity
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
  const parseMaterial = (m: any): SceneMaterial => {
    const out: SceneMaterial = {
      type: MATERIAL_TYPES.includes(m?.type) ? m.type : 'standard',
      color: str(m?.color, DEFAULT_MATERIAL.color),
      roughness: num(m?.roughness, DEFAULT_MATERIAL.roughness),
      metalness: num(m?.metalness, DEFAULT_MATERIAL.metalness),
    }
    // Optional per-type params: copy only when present AND valid, so absent
    // fields stay absent (keeps serialize→parse round-trips exact).
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
    return out
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
        if (o.kind === 'glb' && typeof o.url === 'string') return [{ ...common, kind: 'glb', url: o.url }]
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
          return [{
            ...common, kind: 'primitive', primitive: o.primitive,
            ...(params ? { params } : {}),
            ...(modifiers ? { modifiers } : {}),
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
