import { mulberry32 } from './rng'

export interface Band { y: number; h: number }
export interface Segment { x: number; w: number; colorIndex: number }
export type TypeColorMode = 'white' | 'palette' | 'mixed'

/** glitch amount from loop time: linear ramp over [0, revealFrac], then 1. */
export function revealGlitch(t01: number, revealFrac: number): number {
  if (revealFrac <= 0) return 1
  return Math.min(1, Math.max(0, t01) / revealFrac)
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
