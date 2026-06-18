/**
 * Pure deformation math for the Elastic effect. No DOM/Three — unit-tested in node.
 * The effect's 2D-canvas renderer and the warp shader consume these.
 *
 * Loop seamlessness: every value is periodic in `time` over [0, 2π] (the animated
 * term is sin(time + phase)), so a bake whose frames span time = t01·cycles·2π
 * has a matching first/last frame.
 */

export const TAU = Math.PI * 2

/** Deterministic per-key value in [0,1). Used for per-character random phase/magnitude. */
export function hash01(k: number): number {
  const x = Math.sin(k * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** Wave shape: blends sine (curvy) → triangle (polygonal, piecewise-linear). poly ∈ [0,1]. */
export function wave(p: number, poly: number): number {
  const s = Math.sin(p)
  const tri = (2 / Math.PI) * Math.asin(Math.sin(p))
  return s * (1 - poly) + tri * poly
}

export interface DeformParams {
  base: number       // static vertical stretch (frozen elongation)
  ampV: number       // animated vertical-stretch amount
  ampH: number       // horizontal-stretch amount
  baseSkew: number   // uniform shear angle° (parallel-edge lean)
  ampSkew: number    // per-character random shear° amount
  baseSlant: number  // uniform glyph rotation°
  ampSlant: number   // per-character random rotation° amount
  randomness: number // 0 = uniform across characters, 1 = full per-letter scatter
}

export interface CharDeform {
  sy: number       // vertical scale
  sx: number       // horizontal scale
  skewTan: number  // tan of shear angle (for ctx.transform)
  slantRad: number // rotation in radians
}

/**
 * Per-character deformation at global character index `gi` and loop phase `time`
 * (radians). randomness scales the per-character phase/magnitude scatter: at 0 the
 * whole word deforms in unison, at 1 each letter has its own phase + magnitude.
 */
export function charDeform(gi: number, time: number, p: DeformParams): CharDeform {
  const rnd = Math.min(1, Math.max(0, p.randomness))
  const ph = hash01(gi) * TAU * rnd
  const mag = 1 + (0.2 + hash01(gi + 91.7) * 1.2 - 1) * rnd
  const pulse = 0.5 + 0.5 * Math.sin(time + ph)
  const r = (s: number) => (hash01(gi + s) - 0.5) * 2 * rnd
  return {
    sy: p.base + p.ampV * mag * pulse,
    sx: 1 + p.ampH * (0.3 + hash01(gi + 5) * 0.7 * rnd) * pulse,
    skewTan: Math.tan(((p.baseSkew + p.ampSkew * r(13) * pulse) * Math.PI) / 180),
    slantRad: ((p.baseSlant + p.ampSlant * r(27) * pulse) * Math.PI) / 180,
  }
}
