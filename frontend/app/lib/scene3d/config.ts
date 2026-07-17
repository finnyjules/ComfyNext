// Scene document model for the 3D Studio. This is the single source of truth:
// the editor mutates a SceneDoc, the engine renders from it, and serializeDoc's
// output is what the Scene3DStudio node stores in its `scene_state` widget.

export type PrimitiveKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
  | 'capsule' | 'pyramid' | 'prism'
  | 'icosahedron' | 'octahedron' | 'dodecahedron'
  | 'torusKnot' | 'ring'
export type Vec3 = [number, number, number]

export interface SceneMaterial { color: string; roughness: number; metalness: number }

export interface SceneObjectBase {
  id: string
  name: string
  visible: boolean
  position: Vec3
  rotation: Vec3   // euler radians, XYZ order
  scale: Vec3
  material: SceneMaterial
}
export interface PrimitiveObject extends SceneObjectBase { kind: 'primitive'; primitive: PrimitiveKind }
export interface GlbObject extends SceneObjectBase { kind: 'glb'; url: string }
export type SceneObject = PrimitiveObject | GlbObject

export type LightingPreset = 'studio' | 'soft' | 'dramatic' | 'flat'
export interface SceneLighting {
  preset: LightingPreset
  sunAzimuth: number
  sunElevation: number
  sunIntensity: number
  ambient: number
}
export interface SceneCamera { position: Vec3; target: Vec3; fov: number }

export interface SceneDoc {
  version: 1
  objects: SceneObject[]
  camera: SceneCamera
  lighting: SceneLighting
  background: string
  output: { width: number; height: number }
}

export const PRIMITIVE_KINDS: PrimitiveKind[] = [
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
  'capsule', 'pyramid', 'prism',
  'icosahedron', 'octahedron', 'dodecahedron',
  'torusKnot', 'ring',
]
export const LIGHTING_PRESETS: LightingPreset[] = ['studio', 'soft', 'dramatic', 'flat']

const DEFAULT_MATERIAL: SceneMaterial = { color: '#9aa3af', roughness: 0.6, metalness: 0.0 }

export function defaultDoc(): SceneDoc {
  return {
    version: 1,
    objects: [],
    camera: { position: [4, 3, 6], target: [0, 0.5, 0], fov: 45 },
    lighting: { preset: 'studio', sunAzimuth: 35, sunElevation: 55, sunIntensity: 1.4, ambient: 0.5 },
    background: '#1b1e24',
    output: { width: 1024, height: 1024 },
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
  const objects: SceneObject[] = Array.isArray(raw.objects)
    ? raw.objects.flatMap((o: any): SceneObject[] => {
        if (!o || typeof o.id !== 'string') return []
        const common: SceneObjectBase = {
          id: o.id,
          name: typeof o.name === 'string' ? o.name : 'Object',
          visible: o.visible !== false,
          position: vec3(o.position, [0, 0, 0]),
          rotation: vec3(o.rotation, [0, 0, 0]),
          scale: vec3(o.scale, [1, 1, 1]),
          material: {
            color: typeof o.material?.color === 'string' ? o.material.color : DEFAULT_MATERIAL.color,
            roughness: typeof o.material?.roughness === 'number' ? o.material.roughness : DEFAULT_MATERIAL.roughness,
            metalness: typeof o.material?.metalness === 'number' ? o.material.metalness : DEFAULT_MATERIAL.metalness,
          },
        }
        if (o.kind === 'glb' && typeof o.url === 'string') return [{ ...common, kind: 'glb', url: o.url }]
        if (o.kind === 'primitive' && PRIMITIVE_KINDS.includes(o.primitive)) {
          return [{ ...common, kind: 'primitive', primitive: o.primitive }]
        }
        return []
      })
    : []
  return {
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
    output: {
      width: typeof raw.output?.width === 'number' ? raw.output.width : d.output.width,
      height: typeof raw.output?.height === 'number' ? raw.output.height : d.output.height,
    },
  }
}
