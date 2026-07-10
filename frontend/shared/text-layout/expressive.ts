/**
 * Expressive text layout — per-word placement that overrides normal flow.
 *
 * A pure, framework-free engine: given text, a horizontal bound, a line height,
 * and a way to measure a word, it groups words into lines by a count and places
 * each word by a seeded placement rule. Frame (canvas) and Smart Layout (editor
 * DOM + Satori export) each render from the same `PlacedWord[]`; only the
 * injected `measure` differs (real canvas metrics vs. the char-width estimate).
 *
 * Deterministic: identical inputs + seed → identical output. "Reroll" = bump
 * the seed. Nothing ever overflows the box (each word's left is clamped).
 */

export type PlacementRule = 'random' | 'edges' | 'staircase' | 'alternate'

export interface ExpressiveParams {
  /** Words per line; grouped in reading order. Integer >= 1. */
  wordsPerLine: number
  placement: PlacementRule
  /** 0..1 — how far a word may stray horizontally from its anchor. */
  jitterX: number
  /** 0..1 — how far a word may drift vertically within its line band. */
  jitterY: number
  /** Deterministic seed; reroll bumps it. */
  seed: number
}

export interface PlacedWord {
  text: string
  line: number
  /** Left offset within the box, px. */
  x: number
  /** Top offset within the box, px (top of the line band + vertical jitter). */
  y: number
  /** Measured word width, px. */
  w: number
}

export interface ExpressiveLayout {
  words: PlacedWord[]
  lines: number
  width: number
  height: number
}

/** Default params — the neutral starting point (single word per line, random,
 *  no jitter) an inspector reveals when expressive mode is switched on. */
export function defaultExpressiveParams(): ExpressiveParams {
  return { wordsPerLine: 1, placement: 'random', jitterX: 0.5, jitterY: 0, seed: 1 }
}

// Small, self-contained seeded PRNG (mulberry32). Kept local so this module has
// no dependencies and behaves identically on server (Satori) and browser.
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const clamp01 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, 1)

export function layoutExpressive(opts: {
  text: string
  boxWidth: number
  lineHeight: number
  measure: (word: string) => number
  params: ExpressiveParams
}): ExpressiveLayout {
  const { boxWidth, lineHeight, measure, params } = opts
  const words = String(opts.text ?? '').split(/\s+/).filter(Boolean)
  if (!words.length) return { words: [], lines: 0, width: boxWidth, height: 0 }

  const wpl = Math.max(1, Math.floor(params.wordsPerLine || 1))
  const lineCount = Math.ceil(words.length / wpl)
  const jx = clamp01(params.jitterX)
  const jy = clamp01(params.jitterY)
  // One stream, pulled in a fixed order (x then y, word by word) so the layout
  // is fully determined by (seed, text, params).
  const rng = mulberry32((params.seed | 0) ^ 0x9e3779b9)

  const placed: PlacedWord[] = []
  for (let li = 0; li < lineCount; li++) {
    const lineWords = words.slice(li * wpl, li * wpl + wpl)
    const n = lineWords.length
    for (let wi = 0; wi < n; wi++) {
      const text = lineWords[wi]!
      const w = measure(text)
      const maxLeft = Math.max(0, boxWidth - w)
      const rx = rng()
      const ry = rng()

      let x: number
      switch (params.placement) {
        case 'edges': {
          // Anchor word i across the width at fraction i/(n-1); n===1 → left.
          const anchor = (n > 1 ? wi / (n - 1) : 0) * maxLeft
          x = anchor + (rx - 0.5) * jx * maxLeft
          break
        }
        case 'staircase': {
          // Progressive per-line indent (diagonal), plus jitter.
          const indent = (lineCount > 1 ? li / lineCount : 0) * maxLeft
          x = indent + (rx - 0.5) * jx * maxLeft
          break
        }
        case 'alternate': {
          // Whole lines flip their anchor left/right.
          const anchor = li % 2 === 0 ? 0 : maxLeft
          x = anchor + (rx - 0.5) * jx * maxLeft
          break
        }
        case 'random':
        default: {
          // Divide the line into n cells; center the word in its cell, then
          // jitter within the slack. jitterX 0 → an even, centered distribution.
          const cellW = boxWidth / n
          const cellStart = wi * cellW
          const room = Math.max(0, cellW - w)
          x = cellStart + room / 2 + (rx - 0.5) * jx * room
          break
        }
      }

      placed.push({
        text,
        line: li,
        x: clamp(x, 0, maxLeft),
        y: li * lineHeight + (ry - 0.5) * jy * lineHeight,
        w,
      })
    }
  }

  return { words: placed, lines: lineCount, width: boxWidth, height: lineCount * lineHeight }
}
