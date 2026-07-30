// Pure color conversions (hex ↔ rgb ↔ hsv ↔ oklch). No Vue, no DOM.
// Canonical home for the color math; re-exported from
// components/vue-canvas/studio/color.ts for the StudioColor picker.

export function clampHex(hex: string): string {
  let x = String(hex).trim().replace(/^#/, '')
  if (x.length === 3) x = x.split('').map(c => c + c).join('')
  return /^[0-9a-fA-F]{6}$/.test(x) ? '#' + x.toLowerCase() : '#000000'
}

/** True when `s` is a complete hex colour (3 or 6 digits, `#` optional).
 *  clampHex silently turns anything else into black, which is destructive for a
 *  half-typed value — so callers that accept typed input test with this first
 *  and reject rather than clamp. */
export function isHex(s: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(s).trim())
}

export function hexToRgb(hex: string): [number, number, number] {
  const x = clampHex(hex).slice(1)
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return '#' + to(r) + to(g) + to(b)
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60; if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max]
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c } else { r = c; b = x }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

// ── OKLCH (Björn Ottosson's OKLab in cylindrical form) ──────────────────────────
function linearize(c: number): number { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
function delinearize(c: number): number { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return v * 255 }

/**
 * sRGB (0–255) → OKLab [L 0–1, a ~±0.4, b ~±0.4].
 *
 * The RECTANGULAR form, and the one to interpolate in: `a`/`b` are opponent axes,
 * so a straight line between two colours is a straight line in a perceptually
 * uniform space with no hue-wrap ambiguity to resolve. `rgbToOklch` below is this
 * same transform read in polar coordinates — it delegates, so the two cannot
 * drift and the polar pair's numbers are unchanged.
 */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = linearize(r), lg = linearize(g), lb = linearize(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

/** OKLab → sRGB (0–255, may be out of gamut → clamp via rgbToHex). */
export function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l_ = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
  const lr = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
  const lg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
  const lb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_
  return [delinearize(lr), delinearize(lg), delinearize(lb)]
}

/** sRGB (0–255) → OKLCH [L 0–1, C ~0–0.4, H 0–360]. */
export function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const [L, A, B] = rgbToOklab(r, g, b)
  let h = Math.atan2(B, A) * 180 / Math.PI
  if (h < 0) h += 360
  return [L, Math.hypot(A, B), h]
}

/** OKLCH [L 0–1, C, H 0–360] → sRGB (0–255, may be out of gamut → clamp via rgbToHex). */
export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const hr = H * Math.PI / 180
  return oklabToRgb(L, C * Math.cos(hr), C * Math.sin(hr))
}

/** hex → OKLab convenience. */
export function hexToOklab(hex: string): [number, number, number] {
  return rgbToOklab(...hexToRgb(hex))
}

/** hex → OKLCH convenience. */
export function hexToOklch(hex: string): [number, number, number] {
  return rgbToOklch(...hexToRgb(hex))
}

/** OKLCH → hex convenience (per-channel clamped by rgbToHex, so an out-of-gamut
 *  request lands on a colour with a DIFFERENT hue and lightness — see
 *  `oklchToHexInGamut` when the hue is the thing that must survive). */
export function oklchToHex(L: number, C: number, H: number): string {
  return rgbToHex(...oklchToRgb(L, C, H))
}

/** True when this OKLCH triple has an sRGB representation with no channel
 *  clipped. The 0.5/255 slack is one half of a quantisation step: a channel at
 *  255.3 rounds to 255 and is not visibly clipped. */
function inGamut(L: number, C: number, H: number): boolean {
  const t = 0.5 / 255
  return oklchToRgb(L, C, H).every(v => v >= -t * 255 && v <= 255 + t * 255)
}

/**
 * OKLCH → hex, REDUCING CHROMA until the colour fits in sRGB.
 *
 * The difference from `oklchToHex` is which property is sacrificed. That one
 * clamps each RGB channel independently, which changes the HUE and the LIGHTNESS
 * of an out-of-gamut request — `#ff0000` rotated 180° comes back 199° away and
 * 9 % lighter, so "the opposite hue" is not what you get. This reduces chroma
 * (a bisection, 20 steps, so within ~4·10⁻⁷ of the gamut boundary) and keeps L
 * and H, which is the right trade whenever the hue is the point: a hue rotation,
 * a palette, a complement.
 *
 * The two agree exactly whenever the request is already in gamut, so this is not
 * a different colour space — only a different answer to "and if it does not fit".
 */
export function oklchToHexInGamut(L: number, C: number, H: number): string {
  if (inGamut(L, C, H)) return oklchToHex(L, C, H)
  let lo = 0
  let hi = Math.max(0, C)
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(L, mid, H)) lo = mid; else hi = mid
  }
  return oklchToHex(L, lo, H)
}

/** True when `s` is a complete 8-digit hex colour with alpha (`#` optional). */
export function isHexA(s: string): boolean {
  return /^#?[0-9a-fA-F]{8}$/.test(String(s).trim())
}

/** Split any hex form into an opaque 6-digit hex plus a 0–1 alpha.
 *  6-digit input is fully opaque; garbage falls back to opaque black. */
export function parseHexA(hex: string): { hex: string; alpha: number } {
  const x = String(hex).trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{8}$/.test(x)) {
    return { hex: '#' + x.slice(0, 6).toLowerCase(), alpha: parseInt(x.slice(6, 8), 16) / 255 }
  }
  return { hex: clampHex(x), alpha: 1 }
}

/** Attach alpha to a hex colour. Emits 6-digit when fully opaque so saved scenes
 *  stay in the legacy form and diffs stay small. Any alpha already on `hex` is replaced. */
export function withAlpha(hex: string, alpha: number): string {
  const base = parseHexA(hex).hex
  const a = Number(alpha)
  const clamped = !isFinite(a) ? 1 : Math.max(0, Math.min(1, a))
  if (clamped >= 1) return base
  return base + Math.round(clamped * 255).toString(16).padStart(2, '0')
}

/** Drop any alpha — THREE.Color cannot parse 8-digit hex. It does not throw: it warns to the
 *  console and silently resolves to WHITE, so an unstripped colour blows out rather than darkens. */
export function stripAlpha(hex: string): string {
  return parseHexA(hex).hex
}
