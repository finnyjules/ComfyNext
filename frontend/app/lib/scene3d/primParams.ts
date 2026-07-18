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
  /** 'toggle' renders a checkbox and stores 0 | 1, keeping params a flat number map. */
  control?: 'slider' | 'toggle'
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

/** Resolve one parameter: a stored value clamped to its range, else the spec
 *  default. Throws on a key the kind does not declare — that is a programming
 *  error, and the drift test in scene3d-params catches it. */
export function paramValue(
  kind: PrimitiveKind,
  params: Record<string, number> | undefined,
  key: string,
): number {
  const spec = PRIMITIVE_PARAMS[kind].find((s) => s.key === key)
  if (!spec) throw new Error(`scene3d: primitive "${kind}" has no geometry param "${key}"`)
  const v = params?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default
}

/** Tolerant parse for persisted params: keep only keys this kind declares, drop
 *  non-finite values, clamp the rest. Returns undefined when nothing survives so
 *  absent stays absent and serialize→parse round-trips exactly. */
export function sanitizeParams(kind: PrimitiveKind, raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const spec of PRIMITIVE_PARAMS[kind]) {
    const v = src[spec.key]
    if (typeof v === 'number' && Number.isFinite(v)) out[spec.key] = clamp(v, spec.min, spec.max)
  }
  return Object.keys(out).length > 0 ? out : undefined
}
