/**
 * Depth-of-field maths. Pure — no DOM, no GL — so the shader, the unit tests and any
 * future CPU path all agree on the same numbers.
 *
 * The one rule that matters here: `aperture` is normalized to canvas width (exactly
 * like bloom.radius in postEffects.ts). CoC is measured in pixels, so an un-normalized
 * value renders half the blur on a 2x bake — correct in preview, wrong on export.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Defocus amount 0..1 for a normalized depth, given the focal plane and sharp band. */
export function cocFor(depth: number, focus: number, range: number): number {
  const d = Math.abs(clamp01(depth) - clamp01(focus)) - Math.max(0, range) / 2
  return clamp01(d)
}

/** Max blur radius in pixels, from a width-normalized aperture. */
export function apertureRadiusPx(aperture: number, W: number): number {
  return clamp01(aperture) * Math.max(0, W)
}

/**
 * Unit-disc sample offsets on a golden-angle spiral, clipped to an iris polygon.
 * `bladeCount < 3` leaves the disc circular — that polygon IS the aperture, so six
 * blades give hexagonal bokeh.
 *
 * Deterministic (no RNG): a bake must produce identical output every frame, or motion
 * sequences shimmer.
 */
export function apertureOffsets(
  taps: number, bladeCount: number, bladeRotationDeg: number,
): Array<{ x: number; y: number }> {
  const n = Math.max(1, Math.floor(taps))
  const blades = Math.floor(bladeCount)
  const rot = (bladeRotationDeg * Math.PI) / 180
  const GOLDEN = Math.PI * (3 - Math.sqrt(5))
  const out: Array<{ x: number; y: number }> = []

  for (let i = 0; i < n; i++) {
    // sqrt keeps samples area-uniform rather than clustered at the centre.
    const r = Math.sqrt((i + 0.5) / n)
    const a = i * GOLDEN
    let scale = 1
    if (blades >= 3) {
      // Distance from centre to the polygon edge along this angle, normalized so the
      // polygon is inscribed in the unit circle.
      const seg = (2 * Math.PI) / blades
      const local = (((a - rot) % seg) + seg) % seg - seg / 2
      scale = Math.cos(Math.PI / blades) / Math.cos(local)
    }
    const rr = r * scale
    out.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr })
  }
  return out
}
