/**
 * Interpolating BETWEEN two colours. Pure — no Vue, no DOM, no THREE.
 *
 * Sibling of `./convert.ts` (which owns the transforms this uses) rather than
 * part of it: a conversion is lossless and answers "what is this colour in that
 * space", a MIX is a design decision and answers "what is halfway between these
 * two". The second question has a wrong answer that looks plausible, which is
 * the whole reason this module exists.
 *
 * ## The wrong answer, MEASURED — `#ff0000` → `#0000ff`, halfway
 *
 *   endpoints        L* 0.628 / 0.452
 *   rgb    `#800080` L* 0.421   C 0.193   ← BELOW BOTH ENDPOINTS
 *   oklab  `#8c53a2` L* 0.539   C 0.133
 *   oklch  `#ba00c2` L* 0.559   C 0.260
 *
 * The failure is the LIGHTNESS TROUGH, and it is worth naming precisely because
 * the easy story ("RGB goes through grey") is not what the numbers say — 0.193 is
 * between the other two, so the sRGB midpoint is not the least colourful of the
 * three. What it *is* is DARKER THAN EITHER END: sRGB is gamma-encoded, so 0x80 is
 * about 22 % of the light 0xff emits rather than 50 %, and half of each channel is
 * far less than half the brightness. A viewer reads a dip below both endpoints as
 * the animation dying in the middle and coming back.
 *
 * OKLab is perceptually uniform, so its L* interpolates linearly between the two
 * endpoints and there is no trough anywhere on the ramp. What a straight line in
 * OKLab gives up is CHROMA — it cuts the corner across the a/b plane — and that
 * is the trade taken by default, because a straight line also has no hue-wrap
 * decision that can come out wrong.
 *
 * OKLCH is the same space in polar form, so it carries chroma all the way across:
 * a hue ROTATION rather than a chord. Reach for it when the colour TRAVELLING is
 * the point (a cycle), and note the corollary — a rotation to a colour's own
 * opposite hue is exactly the pair OKLab handles worst, because the straight line
 * between them passes through the middle of the a/b plane, which is grey.
 *
 * `rgb` is kept as a real, selectable option rather than removed: it is what CSS
 * `<gradient>` and every legacy tool do, so "match what that other tool produced"
 * is a legitimate ask. It is also the CONTROL every test here measures the
 * perceptual spaces against.
 */
import { hexToOklab, hexToRgb, oklabToRgb, oklchToRgb, parseHexA, rgbToHex, rgbToOklch, withAlpha } from './convert'

/** The interpolation spaces a colour animation may choose between. Order is
 *  best-default-first, which is the order a picker should offer them in. */
export const COLOR_MIX_SPACES = ['oklab', 'oklch', 'rgb'] as const
export type ColorMixSpace = (typeof COLOR_MIX_SPACES)[number]

/** The default, and see this module's header for why: perceptually uniform, and
 *  a straight line, so there is no hue-wrap decision that can come out wrong. */
export const DEFAULT_COLOR_MIX_SPACE: ColorMixSpace = 'oklab'

export function isColorMixSpace(v: unknown): v is ColorMixSpace {
  return typeof v === 'string' && (COLOR_MIX_SPACES as readonly string[]).includes(v)
}

/** Human labels, for a picker. Here rather than in a component so the two
 *  studios that will offer this cannot describe the same space differently. */
export const COLOR_MIX_SPACE_LABELS: Record<ColorMixSpace, string> = {
  oklab: 'Perceptual',
  oklch: 'Perceptual (hue)',
  rgb: 'RGB',
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Below this the hue angle carries no information — `atan2(0, 0)` is 0°, which
 * would read as "red" and make a mix from grey sweep the long way round through
 * the spectrum. CSS Color 4 calls such a hue POWERLESS and takes the other
 * endpoint's; so does this.
 */
const ACHROMATIC_C = 1e-4

/** Shortest signed arc from `a` to `b` in degrees, in (−180, 180]. */
function hueDelta(a: number, b: number): number {
  let d = (b - a) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

/**
 * The colour `t` of the way from `from` to `to`, as a hex string.
 *
 * Accepts and preserves ALPHA: an 8-digit endpoint mixes its alpha linearly
 * (alpha is already linear — it is a coverage fraction, not a light intensity —
 * so there is no perceptual space to do it in), and the result is emitted
 * 6-digit whenever it lands fully opaque, so a config that never used alpha
 * keeps producing the short form and its saved diffs stay small.
 *
 * `t` is clamped to 0..1, and both endpoints go through `parseHexA`, so a
 * half-typed or junk colour resolves to opaque black rather than to `NaN`
 * channels — which would reach a renderer as an invalid `fillStyle` and paint
 * the previous layer's colour instead of erroring.
 *
 * Out-of-gamut intermediates (an OKLCH rotation stepping outside sRGB on the way)
 * are CLAMPED PER CHANNEL by `rgbToHex`, deliberately, and NOT sent through
 * `convert.ts`'s `oklchToHexInGamut`. The two are the right answer to two
 * different questions:
 *
 *  - a MIX has both endpoints fixed and exact, and a slightly distorted path
 *    between them is a sub-perceptual difference in one intermediate frame;
 *  - a DERIVATION — "the opposite hue of this colour" — has the hue as its whole
 *    deliverable, and a per-channel clamp eats it (measured: 180° became 129°).
 *    That one uses the gamut-mapping form.
 */
export function mixHex(
  from: string,
  to: string,
  t: number,
  space: ColorMixSpace = DEFAULT_COLOR_MIX_SPACE,
): string {
  const p = clamp01(Number.isFinite(t) ? t : 0)
  const A = parseHexA(from)
  const B = parseHexA(to)
  const alpha = A.alpha + (B.alpha - A.alpha) * p
  // Exact endpoints, whatever the space: p === 0 must be the colour the user
  // picked, byte for byte, not a round-trip of it. Every space below is exact at
  // the ends mathematically, but a round-trip through cbrt/pow can land a
  // channel on 0x7f where 0x80 was asked for, and frame 0 of a clip is the frame
  // a still bake captures.
  if (p === 0) return withAlpha(A.hex, alpha)
  if (p === 1) return withAlpha(B.hex, alpha)
  if (space === 'rgb') {
    const [r1, g1, b1] = hexToRgb(A.hex)
    const [r2, g2, b2] = hexToRgb(B.hex)
    return withAlpha(rgbToHex(r1 + (r2 - r1) * p, g1 + (g2 - g1) * p, b1 + (b2 - b1) * p), alpha)
  }
  if (space === 'oklch') {
    const [L1, C1, H1] = rgbToOklch(...hexToRgb(A.hex))
    const [L2, C2, H2] = rgbToOklch(...hexToRgb(B.hex))
    // A powerless hue takes its partner's, so grey → blue is a chroma ramp at a
    // fixed hue rather than a sweep through every other colour on the way.
    const h1 = C1 < ACHROMATIC_C ? H2 : H1
    const h2 = C2 < ACHROMATIC_C ? H1 : H2
    const H = h1 + hueDelta(h1, h2) * p
    return withAlpha(rgbToHex(...oklchToRgb(L1 + (L2 - L1) * p, C1 + (C2 - C1) * p, H)), alpha)
  }
  const [L1, a1, b1] = hexToOklab(A.hex)
  const [L2, a2, b2] = hexToOklab(B.hex)
  return withAlpha(
    rgbToHex(...oklabToRgb(L1 + (L2 - L1) * p, a1 + (a2 - a1) * p, b1 + (b2 - b1) * p)),
    alpha,
  )
}
