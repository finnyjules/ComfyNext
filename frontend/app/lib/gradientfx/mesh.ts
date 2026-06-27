// Mesh gradient — soft Stripe/CSS-style point mesh. A handful of colored points
// bleed into each other; the renderer Gaussian-weights them per pixel. Everything
// here is pure + deterministic from the seed so a given seed reproduces the same
// mesh, and the drift orbit closes a seamless loop (phase 0 == phase 1).

import { buildRampLut, hexToRgb, rgbToHex } from './ramp'
import { makeRng } from './rng'
import type { ColorStop, MeshConfig, MeshPoint } from './types'

/** Hard cap — the shader declares fixed-size uniform arrays of this length. */
export const MESH_MAX_POINTS = 16

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v }

/** Sample the stop ramp at t (0..1) and return a hex color. */
function rampColorAt(lut: Uint8Array, t: number): string {
  const n = lut.length / 4
  const i = Math.max(0, Math.min(n - 1, Math.round(clamp01(t) * (n - 1))))
  return rgbToHex({ r: lut[i * 4]!, g: lut[i * 4 + 1]!, b: lut[i * 4 + 2]! })
}

/**
 * Lay down `count` colored points on a jittered grid. Positions are spread so the
 * mesh fills the frame; colors are sampled from the palette ramp at scattered
 * positions (so the existing color-stops drive the mesh palette).
 */
export function buildMeshPoints(count: number, stops: ColorStop[], seed: string): MeshPoint[] {
  const n = Math.max(2, Math.min(MESH_MAX_POINTS, Math.round(count || 0)))
  const rng = makeRng(seed, 'mesh')
  const lut = buildRampLut(stops)
  const cols = Math.max(1, Math.round(Math.sqrt(n)))
  const rows = Math.ceil(n / cols)
  const pts: MeshPoint[] = []
  for (let k = 0; k < n; k++) {
    const cx = k % cols, cy = Math.floor(k / cols)
    const gx = (cx + 0.5) / cols, gy = (cy + 0.5) / rows
    // Jitter wider than the cell so successive scatters visibly rearrange (a tight
    // jitter kept every point near its grid slot, so scatter looked like a no-op).
    const jx = (rng.next() - 0.5) * 1.7 / cols
    const jy = (rng.next() - 0.5) * 1.7 / rows
    pts.push({ x: clamp01(gx + jx), y: clamp01(gy + jy), color: rampColorAt(lut, rng.next()) })
  }
  return pts
}

/** Recolor existing points from a (possibly new) palette, keeping their positions. */
export function recolorMeshPoints(points: MeshPoint[], stops: ColorStop[], seed: string): MeshPoint[] {
  const rng = makeRng(seed, 'meshcol')
  const lut = buildRampLut(stops)
  return points.map(p => ({ ...p, color: rampColorAt(lut, rng.next()) }))
}

/** A default mesh for a layer that just switched to the mesh layout. */
export function defaultMesh(stops: ColorStop[], seed: string): MeshConfig {
  return { points: buildMeshPoints(6, stops, seed), softness: 55, contrast: 18, blur: 0, drift: 0 }
}

/** Per-point orbit params (deterministic) — amplitude scale + phase offset. */
function orbit(seed: string, index: number): { amp: number; phase: number } {
  const r = makeRng(seed, 'meshdrift:' + index)
  return { amp: 0.5 + 0.5 * r.next(), phase: r.next() * Math.PI * 2 }
}

/**
 * Positions after the living-drift orbit at loop phase `loopPhase` (0..1). Each
 * point traces ONE circle per loop, so phase 0 and phase 1 are identical — the
 * preview/video loop is seamless. `amount` 0..1 scales the orbit radius; 0 = the
 * points are returned unmoved.
 */
export function driftedMeshPositions(
  points: MeshPoint[], amount: number, loopPhase: number, seed: string,
): { x: number; y: number }[] {
  if (amount <= 0) return points.map(p => ({ x: p.x, y: p.y }))
  const rad = amount * 0.12
  const ang = loopPhase * Math.PI * 2
  return points.map((p, i) => {
    const o = orbit(seed, i)
    return { x: p.x + Math.cos(ang + o.phase) * rad * o.amp, y: p.y + Math.sin(ang + o.phase) * rad * o.amp }
  })
}

/** Convenience: a point's color as 0..1 rgb (for uniform upload). */
export function meshColorRgb(p: MeshPoint): [number, number, number] {
  const c = hexToRgb(p.color)
  return [c.r / 255, c.g / 255, c.b / 255]
}
