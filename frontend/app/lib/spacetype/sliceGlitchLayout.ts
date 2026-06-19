import { mulberry32 } from './rng'

export interface Band { y: number; h: number }
export interface Segment { x: number; w: number; colorIndex: number }
export interface CharBox { x: number; w: number; isSpace: boolean }
export type TypeColorMode = 'white' | 'palette' | 'mixed'
export type BlockUnit = 'random' | 'line' | 'word' | 'character'
export type EaseMode = 'linear' | 'in' | 'out' | 'in-out'

/** glitch amount from loop time: linear ramp over [0, revealFrac], then 1. */
export function revealGlitch(t01: number, revealFrac: number): number {
  if (revealFrac <= 0) return 1
  return Math.min(1, Math.max(0, t01) / revealFrac)
}

/** Shape a 0..1 progress with an easing curve (cubic). Endpoints are fixed at 0 and 1. */
export function ease(x: number, mode: EaseMode): number {
  const t = Math.min(1, Math.max(0, x))
  switch (mode) {
    case 'in': return t * t * t                                   // slow start, snaps at the end
    case 'out': return 1 - Math.pow(1 - t, 3)                     // snaps immediately, eases out
    case 'in-out': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    default: return t
  }
}

/** Quantize loop time into churnRate steps; mix with base seed for a flicker seed. */
export function churnSeed(t01: number, churnRate: number, baseSeed: number): number {
  const step = churnRate <= 0 ? 0 : Math.floor(t01 * churnRate)
  return ((baseSeed >>> 0) ^ Math.imul(step + 1, 0x9e3779b1)) >>> 0
}

/** Contiguous equal bands covering [0,height]. */
export function bandLayout(count: number, height: number): Band[] {
  const n = Math.max(1, Math.floor(count))
  const h = height / n
  return Array.from({ length: n }, (_, i) => ({ y: i * h, h }))
}

/** Partition [x0, x0+width] into ~density segments with random widths and palette indices. */
export function segmentRow(rng: () => number, x0: number, width: number, density: number, paletteLen: number): Segment[] {
  const n = Math.max(1, Math.round(density))
  const weights = Array.from({ length: n }, () => 0.5 + rng())
  const total = weights.reduce((a, b) => a + b, 0)
  const segs: Segment[] = []
  let x = x0
  for (let i = 0; i < n; i++) {
    const w = (weights[i]! / total) * width
    segs.push({ x, w, colorIndex: Math.floor(rng() * paletteLen) % paletteLen })
    x += w
  }
  const last = segs[segs.length - 1]!
  last.w = x0 + width - last.x
  return segs
}

export interface Jitter { weight: number; slant: number }
/**
 * Seeded per-unit font jitter. `unitId` is a stable id for the jitter unit (line index,
 * word index, or char index) so all glyphs in the same unit share a value. Returns a clamped
 * weight near `baseWeight` and a slant (skew tangent, ± for synthetic italic).
 */
export function fontJitter(unitId: number, seed: number, baseWeight: number, weightAmt: number, slantAmt: number): Jitter {
  const r = mulberry32((seed >>> 0) ^ Math.imul((unitId | 0) + 1, 0x9e3779b1))
  const weight = Math.min(900, Math.max(100, baseWeight + (r() * 2 - 1) * 500 * weightAmt))
  const slant = (r() * 2 - 1) * 0.35 * slantAmt
  return { weight, slant }
}

/** Center a line's per-char advances within width W → boxes carrying x/width/space flag. */
export function lineLayout(advances: number[], isSpace: boolean[], W: number): CharBox[] {
  const total = advances.reduce((a, b) => a + b, 0)
  let x = (W - total) / 2
  return advances.map((w, i) => { const box = { x, w, isSpace: isSpace[i] ?? false }; x += w; return box })
}

/**
 * Color-block segments for one line band, by unit:
 *  - random   → random-width partition across W (segmentRow)
 *  - line     → one block spanning the whole band
 *  - word     → one block per run of non-space chars (gaps between words)
 *  - character→ one block per non-space char
 * rng drives the palette pick (and, for 'random', the widths).
 */
export function blockSegments(
  unit: BlockUnit, boxes: CharBox[], W: number, rng: () => number, density: number, paletteLen: number,
): Segment[] {
  const pick = () => Math.floor(rng() * paletteLen) % paletteLen
  if (unit === 'random') return segmentRow(rng, 0, W, density, paletteLen)
  if (unit === 'line') return [{ x: 0, w: W, colorIndex: pick() }]
  if (unit === 'character') return boxes.filter(b => !b.isSpace).map(b => ({ x: b.x, w: b.w, colorIndex: pick() }))
  // word: merge consecutive non-space boxes into one segment spanning their extent
  const segs: Segment[] = []
  let start = -1
  for (let i = 0; i <= boxes.length; i++) {
    const isGap = i === boxes.length || boxes[i]!.isSpace
    if (!isGap && start < 0) start = i
    if (isGap && start >= 0) {
      const a = boxes[start]!, b = boxes[i - 1]!
      segs.push({ x: a.x, w: (b.x + b.w) - a.x, colorIndex: pick() })
      start = -1
    }
  }
  return segs
}

/** scaleX lerps 1 → targetW/natW as glitch goes 0 → 1. */
export function scaleXForGlitch(natW: number, targetW: number, glitch: number): number {
  const target = natW > 0 ? targetW / natW : 1
  return 1 + (target - 1) * Math.min(1, Math.max(0, glitch))
}

/** -1 means white; otherwise a palette index. 'mixed' is white ~half the time. */
export function pickTypeColor(rng: () => number, mode: TypeColorMode, paletteLen: number): number {
  if (mode === 'white') return -1
  if (mode === 'mixed' && rng() < 0.5) return -1
  return Math.floor(rng() * paletteLen) % paletteLen
}

export interface StripOffsetsInput {
  height: number; sliceH: number; glitch: number; seed: number
  bandShift: number; tearAmount: number; tearFrequency: number
}

/**
 * One x-offset per horizontal strip. Two layers:
 *  - coarse band shift: a few wide bands share a large offset (chunky tears)
 *  - fine tear: per-strip jitter grouped by tearFrequency
 * Both scale with glitch.
 */
export function stripOffsets(inp: StripOffsetsInput): number[] {
  const { height, sliceH, glitch, seed, bandShift, tearAmount, tearFrequency } = inp
  const count = Math.max(1, Math.ceil(height / Math.max(1, sliceH)))
  const g = Math.min(1, Math.max(0, glitch))
  if (g === 0) return new Array(count).fill(0)

  const coarseRng = mulberry32(seed)
  const COARSE_BANDS = 6
  const coarse = Array.from({ length: COARSE_BANDS }, () => (coarseRng() * 2 - 1) * bandShift * g)

  const tearRng = mulberry32((seed >>> 0) ^ 0x85ebca6b)
  const groups = Math.max(1, Math.round(tearFrequency))
  const tear = Array.from({ length: groups }, () => (tearRng() * 2 - 1) * tearAmount * g)

  return Array.from({ length: count }, (_, i) => {
    const ci = Math.min(COARSE_BANDS - 1, Math.floor((i / count) * COARSE_BANDS))
    const ti = Math.min(groups - 1, Math.floor((i / count) * groups))
    return coarse[ci]! + tear[ti]!
  })
}
