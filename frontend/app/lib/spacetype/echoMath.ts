/**
 * Pure math for the Echo effect — spacing distribution, the base→end look ramp,
 * drift slot wrapping, the wrap-fade envelope, and perspective compensation.
 * No Three.js / DOM so it unit-tests in the node env.
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/**
 * Map a normalized stack position u∈[0,1] through a spacing curve c∈[-1,1].
 * c = 0 → linear; c > 0 (ease-out) → gaps start tight then grow; c < 0
 * (ease-in) → gaps start wide then crowd. Endpoints are always 0 and 1, so
 * the far echo lands in the same place regardless of curve.
 */
export function easeSpacing(u: number, c: number): number {
  const cc = Math.max(-1, Math.min(1, c))
  const x = clamp01(u)
  if (cc === 0) return x
  const p = Math.pow(2, cc * 2) // c=1 → p=4 (slow start), c=-1 → p=0.25 (fast start)
  return Math.pow(x, p)
}

/** Linear interpolate base→end across t∈[0,1] (t clamped). */
export function rampScalar(base: number, end: number, t: number): number {
  return base + (end - base) * clamp01(t)
}

/**
 * Continuous slot of echo j (0-based) at drift fraction `frac`∈[0,1), with
 * `count` echoes. At frac 0, echo j sits at slot j+1 (slots 1..count). As frac
 * advances the slot increases and wraps within (0, count], so a copy that
 * reaches the far end re-emerges near the base. Periodic in frac with period 1.
 */
export function driftQ(j: number, frac: number, count: number): number {
  const span = Math.max(1, count)
  const raw = (((j + frac) % span) + span) % span // [0, count)
  return raw + 1 > span ? raw + 1 - span : raw + 1 // shift to slots 1..count, wrapping within (0, count]
}

/**
 * Fade envelope for drift: 1 in the middle of the stack, ramping to 0 within
 * `zone` of either end (n=0 near base, n=1 at the far end) so wrapping copies
 * fade in/out instead of popping. zone <= 0 disables fading (returns 1).
 */
export function wrapFade(n: number, zone: number): number {
  if (zone <= 0) return 1
  const a = Math.min(1, n / zone)
  const b = Math.min(1, (1 - n) / zone)
  return Math.max(0, Math.min(a, b))
}

/**
 * World-size scale for a copy at world `z` blending between flat (persp=0,
 * apparent size held constant by cancelling the camera's foreshortening) and
 * natural perspective (persp=1, no compensation). Camera sits at `camZ`.
 */
export function perspScale(z: number, persp: number, camZ = 14): number {
  const dist = Math.max(0.001, camZ - z)
  const comp = dist / camZ
  return comp + (1 - comp) * clamp01(persp)
}
