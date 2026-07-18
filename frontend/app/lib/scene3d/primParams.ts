// Per-primitive geometry parameters. One table drives both the geometry factory
// (engine.ts) and the Geometry panel (Scene3DStudioSurface.vue), so adding a
// knob is one row here rather than new code in two places.
//
// Every default reproduces the geometry the studio shipped before parameters
// existed — see the per-kind comments for the original three.js call.
import type { PrimitiveKind } from '~/lib/scene3d/config'

export interface ParamSpec {
  key: string
  label: string
  hint: string
  min: number
  max: number
  step: number
  default: number
  /** 'toggle' renders a checkbox storing 0 | 1; 'options' renders a segmented
   *  control storing the option's index. Both keep bags a flat number map. */
  control?: 'slider' | 'toggle' | 'options'
  /** Required when control === 'options'; min/max must span its indices. */
  options?: string[]
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Shared spec builders — most kinds want the same Detail/Arc knobs with
// different ranges, and repeating the copy would let it drift.
const detail = (min: number, max: number, def: number): ParamSpec =>
  ({ key: 'detail', label: 'Detail', hint: 'Segment count — low values give a faceted, low-poly look', min, max, step: 1, default: def })
const subdivision = (): ParamSpec =>
  ({ key: 'detail', label: 'Detail', hint: 'Subdivides the faces toward a geodesic sphere', min: 0, max: 3, step: 1, default: 0 })
const arc = (): ParamSpec =>
  ({ key: 'arc', label: 'Arc', hint: 'Sweeps only part of the way around, leaving a wedge', min: 30, max: 360, step: 1, default: 360 })
const radiusTop = (def: number): ParamSpec =>
  ({ key: 'radiusTop', label: 'Top radius', hint: 'Width of the top face — 0 comes to a point', min: 0, max: 1, step: 0.01, default: def })
const openEnded = (): ParamSpec =>
  ({ key: 'openEnded', label: 'Open ended', hint: 'Removes the end caps, leaving a hollow tube', min: 0, max: 1, step: 1, default: 0, control: 'toggle' })

export const PRIMITIVE_PARAMS: Record<PrimitiveKind, ParamSpec[]> = {
  // BoxGeometry(1, 1, 1) at cornerRadius 0
  box: [
    { key: 'cornerRadius', label: 'Corner', hint: 'Rounds off every edge of the box', min: 0, max: 0.49, step: 0.01, default: 0 },
    { key: 'cornerSides', label: 'Corner sides', hint: 'How smooth each rounded edge looks', min: 1, max: 8, step: 1, default: 2 },
  ],
  // SphereGeometry(0.5, 48, 32)
  sphere: [
    detail(4, 64, 48),
    arc(),
    { key: 'sweep', label: 'Sweep', hint: 'Trims the ball down from the bottom toward a dome', min: 10, max: 180, step: 1, default: 180 },
  ],
  // CylinderGeometry(0.5, 0.5, 1, 48)
  cylinder: [
    detail(3, 64, 48),
    radiusTop(0.5),
    { key: 'radiusBottom', label: 'Bottom radius', hint: 'Width of the bottom face', min: 0, max: 1, step: 0.01, default: 0.5 },
    arc(),
    openEnded(),
  ],
  // ConeGeometry(0.5, 1, 48) === CylinderGeometry(0, 0.5, 1, 48)
  cone: [
    detail(3, 64, 48),
    radiusTop(0),
    { key: 'radiusBottom', label: 'Bottom radius', hint: 'Width of the bottom face', min: 0, max: 1, step: 0.01, default: 0.5 },
    arc(),
    openEnded(),
  ],
  // TorusGeometry(0.5, 0.18, 24, 64)
  torus: [
    detail(8, 64, 64),
    { key: 'tube', label: 'Tube', hint: 'Thickness of the ring itself', min: 0.02, max: 0.45, step: 0.01, default: 0.18 },
    arc(),
  ],
  // PlaneGeometry(2, 2)
  plane: [detail(1, 32, 1)],
  // CapsuleGeometry(0.35, 0.5, 8, 24)
  capsule: [
    detail(4, 32, 24),
    { key: 'radius', label: 'Radius', hint: 'Thickness of the rounded body', min: 0.1, max: 0.5, step: 0.01, default: 0.35 },
    { key: 'length', label: 'Length', hint: 'Straight section between the two domed caps', min: 0, max: 2, step: 0.05, default: 0.5 },
  ],
  // ConeGeometry(0.55, 1, 4, 1).rotateY(PI/4)
  pyramid: [
    { key: 'detail', label: 'Detail', hint: 'Number of sides in the base — 4 is a classic pyramid', min: 3, max: 12, step: 1, default: 4 },
    radiusTop(0),
  ],
  // CylinderGeometry(0.5, 0.5, 1, 3)
  prism: [
    { key: 'detail', label: 'Detail', hint: 'Number of sides — 3 is a triangular prism, 6 a hexagonal one', min: 3, max: 24, step: 1, default: 3 },
    radiusTop(0.5),
  ],
  // IcosahedronGeometry(0.55)
  icosahedron: [subdivision()],
  // OctahedronGeometry(0.55)
  octahedron: [subdivision()],
  // DodecahedronGeometry(0.55)
  dodecahedron: [subdivision()],
  // TorusKnotGeometry(0.4, 0.12, 128, 16) — p and q default to 2 and 3
  torusKnot: [
    detail(32, 256, 128),
    { key: 'tube', label: 'Tube', hint: 'Thickness of the knotted rope', min: 0.02, max: 0.3, step: 0.01, default: 0.12 },
    { key: 'p', label: 'P winding', hint: 'How many times the rope loops around the axis', min: 1, max: 8, step: 1, default: 2 },
    { key: 'q', label: 'Q winding', hint: 'How many times it winds through the hole', min: 1, max: 8, step: 1, default: 3 },
  ],
  // RingGeometry(0.22, 0.5, 48)
  ring: [
    detail(3, 64, 48),
    { key: 'innerRadius', label: 'Inner radius', hint: 'Size of the hole in the middle', min: 0, max: 0.49, step: 0.01, default: 0.22 },
    arc(),
  ],
}

/** Resolve one value from a spec list: a stored value clamped to its range,
 *  else the spec default. Throws on a key the list does not declare — that is a
 *  programming error, and the drift tests catch it. */
export function resolveParam(
  specs: ParamSpec[],
  bag: Record<string, number> | undefined,
  key: string,
): number {
  const spec = specs.find((s) => s.key === key)
  if (!spec) throw new Error(`scene3d: no spec for "${key}"`)
  const v = bag?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default
}

/** Tolerant parse for a persisted bag: keep only declared keys, drop non-finite
 *  values, clamp the rest, and return undefined when nothing survives so absent
 *  stays absent and serialize→parse round-trips exactly. */
export function sanitizeBag(specs: ParamSpec[], raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const spec of specs) {
    const v = src[spec.key]
    if (typeof v === 'number' && Number.isFinite(v)) out[spec.key] = clamp(v, spec.min, spec.max)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function paramValue(
  kind: PrimitiveKind,
  params: Record<string, number> | undefined,
  key: string,
): number {
  return resolveParam(PRIMITIVE_PARAMS[kind], params, key)
}

export function sanitizeParams(kind: PrimitiveKind, raw: unknown): Record<string, number> | undefined {
  return sanitizeBag(PRIMITIVE_PARAMS[kind], raw)
}

// Modifiers deform whatever geometry the primitive produced. Unlike geometry
// params these are shared by every kind, and every default is the identity so a
// fresh object is undeformed.
const axisSpec = (key: string, label: string, hint: string, def: number): ParamSpec =>
  ({ key, label, hint, min: 0, max: 2, step: 1, default: def, control: 'options', options: ['x', 'y', 'z'] })

export const MODIFIER_SPECS: ParamSpec[] = [
  { key: 'subdivide', label: 'Subdivide', hint: 'Splits each face into smaller ones so bends and twists stay smooth', min: 0, max: 3, step: 1, default: 0 },

  { key: 'taper', label: 'Taper', hint: 'Narrows or widens the shape toward one end', min: -1, max: 1, step: 0.01, default: 0 },
  axisSpec('taperAxis', 'Taper axis', 'Which direction the taper runs along', 1),

  { key: 'twist', label: 'Twist', hint: 'Winds the shape progressively around an axis', min: -360, max: 360, step: 1, default: 0 },
  axisSpec('twistAxis', 'Twist axis', 'The axis the shape winds around', 1),

  { key: 'bend', label: 'Bend', hint: 'Curves the whole shape around an axis', min: -180, max: 180, step: 1, default: 0 },
  axisSpec('bendAxis', 'Bend axis', 'The axis the shape curves around', 2),

  { key: 'noise', label: 'Noise', hint: 'Pushes the surface in and out for an organic, lumpy look', min: 0, max: 0.5, step: 0.005, default: 0 },
  { key: 'noiseScale', label: 'Noise scale', hint: 'Size of the lumps — higher means finer detail', min: 0.5, max: 8, step: 0.1, default: 2 },
  { key: 'noiseSeed', label: 'Noise seed', hint: 'Shuffles the lumps into a different arrangement', min: 0, max: 99, step: 1, default: 0 },

  { key: 'arrayCount', label: 'Count', hint: 'How many copies of the shape to repeat', min: 1, max: 12, step: 1, default: 1 },
  { key: 'arrayMode', label: 'Mode', hint: 'Repeat in a straight line or around a circle', min: 0, max: 1, step: 1, default: 0, control: 'options', options: ['linear', 'radial'] },
  { key: 'arrayOffsetX', label: 'Offset X', hint: 'Gap between copies along X', min: -3, max: 3, step: 0.05, default: 1.2 },
  { key: 'arrayOffsetY', label: 'Offset Y', hint: 'Gap between copies along Y', min: -3, max: 3, step: 0.05, default: 0 },
  { key: 'arrayOffsetZ', label: 'Offset Z', hint: 'Gap between copies along Z', min: -3, max: 3, step: 0.05, default: 0 },
  { key: 'arrayRadius', label: 'Radius', hint: 'How far each copy sits from the centre', min: 0, max: 5, step: 0.05, default: 1.5 },
  axisSpec('arrayAxis', 'Around', 'The axis the copies are arranged around', 1),
]

export function modifierValue(modifiers: Record<string, number> | undefined, key: string): number {
  return resolveParam(MODIFIER_SPECS, modifiers, key)
}

export function sanitizeModifiers(raw: unknown): Record<string, number> | undefined {
  return sanitizeBag(MODIFIER_SPECS, raw)
}
