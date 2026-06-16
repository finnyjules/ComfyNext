// Gradient ramp helpers: parse hex, build a 256px RGBA LUT from color stops.

import type { ColorStop } from './types'

export interface RGB { r: number; g: number; b: number }

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full.slice(0, 6) || '000000', 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** HSL conversion (h 0..360, s/l 0..1). */
export function rgbToHsl({ r, g, b }: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s, l]
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

const LUT_W = 256

/**
 * Build a 256×1 RGBA8 lookup of the gradient (linear interpolation between
 * sorted stops). Returned as a Uint8Array the renderer uploads as a texture.
 */
export function buildRampLut(stops: ColorStop[]): Uint8Array {
  const out = new Uint8Array(LUT_W * 4)
  const sorted = [...stops].filter(s => s && typeof s.pos === 'number')
    .sort((a, b) => a.pos - b.pos)
  if (sorted.length === 0) sorted.push({ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 1 })
  if (sorted.length === 1) sorted.push({ ...sorted[0]!, pos: 1 })
  for (let i = 0; i < LUT_W; i++) {
    const t = i / (LUT_W - 1)
    // Find the bracketing stops.
    let a = sorted[0]!, b = sorted[sorted.length - 1]!
    for (let k = 0; k < sorted.length - 1; k++) {
      if (t >= sorted[k]!.pos && t <= sorted[k + 1]!.pos) { a = sorted[k]!; b = sorted[k + 1]!; break }
      if (t < sorted[0]!.pos) { a = b = sorted[0]! }
      if (t > sorted[sorted.length - 1]!.pos) { a = b = sorted[sorted.length - 1]! }
    }
    const span = b.pos - a.pos
    const f = span > 1e-6 ? (t - a.pos) / span : 0
    const ca = hexToRgb(a.color), cb = hexToRgb(b.color)
    const o = i * 4
    out[o] = ca.r + (cb.r - ca.r) * f
    out[o + 1] = ca.g + (cb.g - ca.g) * f
    out[o + 2] = ca.b + (cb.b - ca.b) * f
    out[o + 3] = 255
  }
  return out
}
