import { describe, it, expect } from 'vitest'
import { GRADIENT_FS, REFRACT_REACH, TILT_GAIN } from '~/lib/gradientfx/shaders'

/**
 * Liquid "Depth & Light" used to render as CAMOUFLAGE — flat navy and white
 * blotches with hard edges — instead of a folded surface. The owner reported it
 * on a "frosted silk" take (marble base, Depth 71 / Highlights 15 / Shadows 58 /
 * Fold scale 64) and asked whether the highlights and shadows could "blend
 * better".
 *
 * The cause was not the blend, and not the fold field. It was one mistake made
 * in TWO places: the fold slope is long-tailed, and both places added it raw to
 * a quantity that was then hard-clamped. Measured live on that exact config, at
 * 512x512, by rendering the intermediate values to the canvas and binning them:
 *
 *   fold height field   18 populated bins,  0.0% at the extremes   (healthy)
 *   ramp coordinate     47.5% of the frame pushed outside 0..1 and clamped
 *                       -> painted with only the first and last colour stop
 *   Lambert term d      31.6% of the frame pinned at exactly 0
 *                       -> one flat dark value with a hard edge round it
 *
 * Those two masks ARE the blotches. Both are fixed the same way: a tanh soft
 * limit, which is linear near zero (so low Depth is unchanged) and asymptotic
 * far out (so nothing ever reaches the clamp). After the fix, on the same
 * config: populated bins 15 -> 25, extremes 13.9% -> 8.7%, clamped ramp
 * coordinate 47.5% -> 14% (and ~9 of those 14 points are the frame corners,
 * which the base ramp has clamped since long before Depth existed).
 *
 * A quieter symptom fixed at the same time: the old term gave a FLAT surface
 * d ~= 0.78 rather than 0.5, so merely nudging Depth off zero jumped the mean
 * luminance 0.719 -> 0.771 (a 7.2% cliff on a one-unit move). Centring d at 0.5
 * makes shade exactly 1.0 on a flat surface, so the same move now costs 0.36%.
 */
describe('liquid Depth & Light soft limits', () => {
  /** The shader is built from the exported constants, so these are the real numbers. */
  it('is built from the exported constants, not hand-typed copies', () => {
    expect(GRADIENT_FS).toContain(`const float REFRACT_REACH = ${REFRACT_REACH.toFixed(4)};`)
    expect(GRADIENT_FS).toContain(`const float TILT_GAIN = ${TILT_GAIN.toFixed(4)};`)
  })

  it('soft-limits the Depth refraction before the ramp coordinate is clamped', () => {
    // The offset still comes from the same fold slope...
    expect(GRADIENT_FS).toContain('float off = dot(g * (7.0 / u_flowFoldScale), dir) * u_flowDepth * 0.3;')
    // ...but it goes through the limiter rather than straight onto t.
    expect(GRADIENT_FS).toContain('t += REFRACT_REACH * tanh(off / REFRACT_REACH);')
    // The regression to guard: adding the raw offset to t.
    expect(GRADIENT_FS).not.toContain('t += dot(g * (7.0 / u_flowFoldScale), dir) * u_flowDepth * 0.3;')
  })

  it('shades from a tanh-limited tilt, not a clamped Lambert', () => {
    expect(GRADIENT_FS).toContain('float d = 0.5 + 0.5 * tanh(dot(g, L.xy) * u_flowDepth * TILT_GAIN);')
    // The clamped Lambert is what pinned a third of the frame at 0. It must not
    // come back for the shading term. (`n` itself stays — Gloss still needs a
    // real normal, and its Blinn-Phong lobe is inherently soft.)
    expect(GRADIENT_FS).not.toContain('float d = clamp(dot(n, L), 0.0, 1.0);')
  })

  it('crossfades the two gains instead of switching at the terminator', () => {
    expect(GRADIENT_FS).toContain('mix(u_flowShadows, u_flowHighlights, smoothstep(0.3, 0.7, d))')
    // The old switch was value-continuous but slope-discontinuous whenever
    // Highlights != Shadows, which drew a crease along every terminator.
    expect(GRADIENT_FS).not.toContain('d > 0.5 ? u_flowHighlights : u_flowShadows')
  })

  it('Gloss keeps a real surface normal to reflect off', () => {
    expect(GRADIENT_FS).toContain('vec3 n = normalize(vec3(g, 1.0 / max(u_flowDepth, 0.05)));')
    expect(GRADIENT_FS).toContain('float spec = pow(clamp(dot(n, H), 0.0, 1.0), 48.0);')
  })
})

/**
 * The properties the chosen constants have to have. These test the transfer
 * function's SHAPE — they would still pass if the constants were retuned, and
 * they fail if someone swaps tanh for something that saturates hard or reverses.
 * They are deliberately not a re-implementation of the render: the render itself
 * was verified live (numbers above, PNGs in the task report).
 */
describe('the soft limiter has the properties the fix depends on', () => {
  const limit = (x: number, reach: number) => reach * Math.tanh(x / reach)

  it('is linear near zero, so low Depth renders as it did before', () => {
    for (const x of [0.001, 0.005, 0.01]) {
      expect(Math.abs(limit(x, REFRACT_REACH) - x) / x).toBeLessThan(0.001)
    }
  })

  it('can never move the colour lookup further than the reach', () => {
    // The failure mode was an offset large enough to run off the end of the ramp.
    // tanh saturates to exactly 1 in floating point well before x = 10, so the
    // bound is "never more than", not "always strictly less than".
    for (const x of [1, 10, 100, 1e4]) expect(limit(x, REFRACT_REACH)).toBeLessThanOrEqual(REFRACT_REACH)
    expect(limit(1e4, REFRACT_REACH)).toBeGreaterThan(REFRACT_REACH * 0.99)
  })

  it('never reverses, and still resolves detail across the whole working range', () => {
    // Never decreasing anywhere: a reversal would make Depth fight itself.
    let prev = -Infinity
    for (let x = -20; x <= 20; x += 0.05) {
      const v = limit(x, REFRACT_REACH)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    // And strictly increasing where real offsets live — a limiter that flattened
    // early would just be the old clamp wearing a tanh, which is the bug.
    prev = -Infinity
    for (let x = -4 * REFRACT_REACH; x <= 4 * REFRACT_REACH; x += 0.01) {
      const v = limit(x, REFRACT_REACH)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
  })

  it('leaves a flat surface completely alone', () => {
    // g = 0 => d = 0.5 => shade = 1 + 0 * gain = 1. Depth adds relief, nothing else.
    const d = 0.5 + 0.5 * Math.tanh(0 * TILT_GAIN)
    expect(d).toBe(0.5)
    for (const gain of [0, 0.15, 0.58, 1]) expect(1 + (d - 0.5) * 2 * gain).toBe(1)
  })
})
