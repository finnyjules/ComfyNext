/**
 * Vector Type — seeded per-glyph randomness, and word grouping.
 *
 * These two modules are the primitive under blink, per-glyph axis scatter and
 * grade flicker. All three are one seeded random number driving a different
 * target, so a fault here is a fault in three features at once — and it is the
 * kind of fault that looks fine, because wrong randomness still looks random.
 *
 * Four claims are worth more than the rest:
 *
 *  1. **Determinism.** The same `(index, seed, channel, bucket)` gives the same
 *     number on a second call and in a freshly imported copy of the module. That
 *     is the difference between a bake matching its preview and not.
 *  2. **Channels decorrelate**, measured against a deliberately shared-channel
 *     control. The control is the point: `r = 1.000` shared versus `r ≈ 0`
 *     separate is what makes "the channel parameter earns its place" a number
 *     rather than an opinion.
 *  3. **Uniformity.** A hash returning 0.9 for every glyph passes a naive
 *     stability test and ruins every effect built on it, so the distribution is
 *     measured — chi-square across the range, and spread at headline lengths.
 *  4. **`hash32` is frozen.** It moved here from `motion.ts` and the stagger's
 *     `random` order depends on its exact outputs. Golden values on both sides
 *     of the move mean a future edit to the arithmetic reshuffles every saved
 *     animation loudly, in CI, instead of quietly, in the field.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  channelKey,
  glyphRandom,
  glyphRandomRange,
  hash32,
  timeBucket,
} from '~/lib/vectortype/random'
import {
  VT_NO_WORD,
  groupWords,
  isSeparatorGlyph,
  isWordSeparator,
  wordCount,
  wordIndexOfGlyph,
  type VtWordGlyph,
} from '~/lib/vectortype/words'
import { staggerRank } from '~/lib/vectortype/motion'

// ── helpers ─────────────────────────────────────────────────────────────────

/** Pearson correlation. `1` = the two series rise and fall together exactly. */
function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  let sa = 0, sb = 0
  for (let i = 0; i < n; i++) { sa += a[i]!; sb += b[i]! }
  const ma = sa / n, mb = sb / n
  let cov = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma, db = b[i]! - mb
    cov += da * db; va += da * da; vb += db * db
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0
}

/** Chi-square of `values` against a uniform expectation over `bins` buckets. */
function chiSquareUniform(values: readonly number[], bins: number): number {
  const counts = new Array<number>(bins).fill(0)
  for (const v of values) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))
    counts[b]!++
  }
  const expected = values.length / bins
  let chi = 0
  for (const c of counts) chi += ((c - expected) ** 2) / expected
  return chi
}

/** A glyph run from a string: one glyph per code point, which is what an
 *  unligated Latin run actually shapes to. */
function run(text: string): VtWordGlyph[] {
  return Array.from(text).map((ch) => ({ codePoints: [ch.codePointAt(0)!] }))
}

function words(text: string): string[] {
  const glyphs = Array.from(text)
  return groupWords(run(text)).map((w) => w.glyphs.map((i) => glyphs[i]!).join(''))
}

const SRC_DIR = fileURLToPath(new URL('../../app/lib/vectortype/', import.meta.url))

// ── purity ──────────────────────────────────────────────────────────────────

describe('purity', () => {
  // Statically, the way vectortype-curve does it: the strongest possible
  // statement about a module's reach is that it has none.
  it('random.ts and words.ts import nothing at all', () => {
    for (const file of ['random.ts', 'words.ts']) {
      const src = readFileSync(SRC_DIR + file, 'utf8')
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(/^\s*import\s/m.test(stripped), `${file} should import nothing`).toBe(false)
      expect(/require\(|await import\(/.test(stripped), `${file} dynamic import`).toBe(false)
    }
  })

  it('runs with every host global trapped', () => {
    const trap = () => { throw new Error('reached the host') }
    const g = globalThis as Record<string, unknown>
    const saved = {
      document: g.document, window: g.window, fetch: g.fetch,
      Math_random: Math.random,
    }
    Object.defineProperty(g, 'document', { value: trap, configurable: true })
    Object.defineProperty(g, 'window', { value: trap, configurable: true })
    Object.defineProperty(g, 'fetch', { value: trap, configurable: true })
    Math.random = trap as unknown as typeof Math.random
    try {
      expect(glyphRandom(3, 7, 'blink', 2)).toBeGreaterThanOrEqual(0)
      expect(groupWords(run('a b')).length).toBe(2)
      expect(timeBucket(1.5, 0.25)).toBe(6)
    } finally {
      Math.random = saved.Math_random
      Object.defineProperty(g, 'document', { value: saved.document, configurable: true })
      Object.defineProperty(g, 'window', { value: saved.window, configurable: true })
      Object.defineProperty(g, 'fetch', { value: saved.fetch, configurable: true })
    }
  })
})

// ── hash32: frozen, and still the stagger's hash ────────────────────────────

describe('hash32 is frozen', () => {
  // Captured from motion.ts BEFORE the function moved. If these change, every
  // saved animation using `stagger.order: 'random'` reshuffles.
  it('matches the goldens taken before the move', () => {
    expect(hash32(0, 0)).toBe(0)
    expect(hash32(1, 0)).toBe(2261973619)
    expect(hash32(2, 0)).toBe(229111015)
    expect(hash32(0, 1)).toBe(580771925)
    expect(hash32(7, 42)).toBe(208853272)
    expect(hash32(-1, 0)).toBe(2578835075)
    expect(hash32(100, 999)).toBe(1433178595)
  })

  it('still drives the stagger to the same ranks', () => {
    // Goldens computed from motion.ts's own copy before it was deleted, so this
    // asserts the relocation was behaviour-preserving end to end and not just
    // at the hash boundary.
    const ranks8 = Array.from({ length: 8 }, (_, i) => staggerRank('random', i, 8, 7))
    expect(ranks8).toEqual([0, 2, 7, 4, 5, 1, 3, 6])
    const ranks12 = Array.from({ length: 12 }, (_, i) => staggerRank('random', i, 12, 0))
    expect(ranks12).toEqual([0, 3, 1, 11, 4, 6, 9, 10, 8, 5, 2, 7])
  })

  it('returns an unsigned 32-bit integer', () => {
    for (let i = -50; i < 50; i++) {
      const h = hash32(i, i * 31)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(2 ** 32)
    }
  })
})

// ── glyphRandom: determinism ────────────────────────────────────────────────

describe('glyphRandom is stable', () => {
  it('returns the same number on a second call', () => {
    for (const args of [[0, 0, 'blink', 0], [5, 12, 'scatter', 40], [-3, -7, 9, -2]] as const) {
      const a = glyphRandom(...(args as [number, number, string | number, number]))
      const b = glyphRandom(...(args as [number, number, string | number, number]))
      expect(b).toBe(a)
    }
  })

  it('returns the same numbers in a freshly imported copy of the module', async () => {
    // The bake and the preview are different module instances in practice (a
    // headless bake, a Vite HMR reload). No module-level state means a fresh
    // import must agree exactly — this is the property that a memoised or
    // seeded-once RNG would fail.
    const before = Array.from({ length: 32 }, (_, i) => glyphRandom(i, 4, 'blink', i % 5))
    vi.resetModules()
    const fresh = await import('~/lib/vectortype/random')
    const after = Array.from({ length: 32 }, (_, i) => fresh.glyphRandom(i, 4, 'blink', i % 5))
    expect(after).toEqual(before)
  })

  it('lands in [0, 1) for a wide sweep, and never NaN', () => {
    for (let i = -100; i < 900; i++) {
      const v = glyphRandom(i, i % 13, i % 3 === 0 ? 'blink' : 'grade', i >> 2)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('coerces non-finite arguments instead of producing NaN', () => {
    // A NaN opacity paints nothing and a NaN axis coordinate ignores the whole
    // variation — both are silent at the far end of a slider.
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(Number.isFinite(glyphRandom(bad, 1, 'blink', 0))).toBe(true)
      expect(Number.isFinite(glyphRandom(1, bad, 'blink', 0))).toBe(true)
      expect(Number.isFinite(glyphRandom(1, 1, 'blink', bad))).toBe(true)
    }
    expect(glyphRandom(NaN, 1, 'blink', 0)).toBe(glyphRandom(0, 1, 'blink', 0))
  })

  it('does not collapse on the all-zero input, though hash32(0, 0) does', () => {
    // The single most likely call this module will ever receive: glyph 0, the
    // default seed, bucket 0. Without the domain salt the whole chain is zero
    // and the first letter is permanently dark, un-fixable by changing the seed.
    expect(hash32(0, 0)).toBe(0)
    expect(glyphRandom(0, 0, 'blink', 0)).toBeGreaterThan(0)
    expect(glyphRandom(0, 0, 0, 0)).toBeGreaterThan(0)
  })

  it('changes with each argument', () => {
    const base = glyphRandom(3, 5, 'blink', 2)
    expect(glyphRandom(4, 5, 'blink', 2)).not.toBe(base)
    expect(glyphRandom(3, 6, 'blink', 2)).not.toBe(base)
    expect(glyphRandom(3, 5, 'scatter', 2)).not.toBe(base)
    expect(glyphRandom(3, 5, 'blink', 3)).not.toBe(base)
  })

  it('is constant in time when no bucket is given', () => {
    // The scatter case: each glyph settles at its own fixed offset.
    const a = Array.from({ length: 16 }, (_, i) => glyphRandom(i, 9, 'scatter'))
    const b = Array.from({ length: 16 }, (_, i) => glyphRandom(i, 9, 'scatter', 0))
    expect(b).toEqual(a)
  })
})

// ── the channel, measured against a shared-channel control ──────────────────

describe('channels decorrelate', () => {
  const N = 2000
  const seed = 11
  const blink = Array.from({ length: N }, (_, i) => glyphRandom(i, seed, 'blink'))
  const scatter = Array.from({ length: N }, (_, i) => glyphRandom(i, seed, 'scatter'))
  /** The deliberate control: what these two series would be WITHOUT a channel
   *  parameter — the same stream read twice. */
  const sharedA = Array.from({ length: N }, (_, i) => glyphRandom(i, seed, 'shared'))
  const sharedB = Array.from({ length: N }, (_, i) => glyphRandom(i, seed, 'shared'))

  it('the shared-channel control correlates perfectly', () => {
    expect(pearson(sharedA, sharedB)).toBeCloseTo(1, 12)
  })

  it('two channels do not', () => {
    const r = pearson(blink, scatter)
    // n = 2000, so the 99.9% band for genuinely independent series is about
    // ±0.074. A tenth of that is comfortably inside it and nowhere near the
    // control's 1.000.
    expect(Math.abs(r)).toBeLessThan(0.05)
  })

  it('the loudest glyph on one channel is not the loudest on the other', () => {
    // The failure the channel exists to prevent, stated as the user would see
    // it: the letter that blinks off is the letter that scatters furthest.
    // Over 200 words of 8 letters, agreement should sit near chance (1/8).
    let agree = 0
    const WORDS = 200, LEN = 8
    for (let w = 0; w < WORDS; w++) {
      let bestBlink = 0, bestScatter = 0
      for (let i = 1; i < LEN; i++) {
        if (glyphRandom(i, w, 'blink') > glyphRandom(bestBlink, w, 'blink')) bestBlink = i
        if (glyphRandom(i, w, 'scatter') > glyphRandom(bestScatter, w, 'scatter')) bestScatter = i
      }
      if (bestBlink === bestScatter) agree++
    }
    const rate = agree / WORDS
    expect(rate).toBeGreaterThan(0.04)   // not anti-correlated either
    expect(rate).toBeLessThan(0.28)      // chance is 0.125; shared would be 1.0
  })

  it('near-neighbour channel labels are independent too', () => {
    // A per-axis scatter wants one channel per axis, and those labels differ by
    // one character. (This is NOT a test of channelKey's avalanche round —
    // measured, raw FNV keys score r = 0.0023 here, because glyphRandom's first
    // chained round already mixes whatever key it is handed. See channelKey.)
    const a = Array.from({ length: N }, (_, i) => glyphRandom(i, seed, 'axis0'))
    const b = Array.from({ length: N }, (_, i) => glyphRandom(i, seed, 'axis1'))
    expect(Math.abs(pearson(a, b))).toBeLessThan(0.05)
    const n0 = Array.from({ length: N }, (_, i) => glyphRandom(i, seed, 0))
    const n1 = Array.from({ length: N }, (_, i) => glyphRandom(i, seed, 1))
    expect(Math.abs(pearson(n0, n1))).toBeLessThan(0.05)
  })

  it('consecutive time buckets are independent', () => {
    // Blink reads consecutive buckets; correlated neighbours would make it drift
    // rather than flick.
    const t0 = Array.from({ length: N }, (_, i) => glyphRandom(i % 8, seed, 'blink', i))
    const t1 = Array.from({ length: N }, (_, i) => glyphRandom(i % 8, seed, 'blink', i + 1))
    expect(Math.abs(pearson(t0, t1))).toBeLessThan(0.05)
  })

  it('two seeds give different streams on the same channel', () => {
    const s1 = Array.from({ length: N }, (_, i) => glyphRandom(i, 1, 'blink'))
    const s2 = Array.from({ length: N }, (_, i) => glyphRandom(i, 2, 'blink'))
    expect(Math.abs(pearson(s1, s2))).toBeLessThan(0.05)
  })

  it('does not alias glyph i at bucket b onto glyph b at bucket i', () => {
    // The measured reason the three arguments are CHAINED through separate
    // avalanche rounds rather than XOR-ed into one word. The XOR shortcut is
    // symmetric in index and bucket, so it aliases every such pair — 1560 of
    // 1560 below — and paints a diagonal crawling through a blink.
    const xorControl = (i: number, s: number, c: string, b: number) =>
      hash32(i ^ channelKey(c) ^ b, s) / 4294967296
    let aliased = 0, controlAliased = 0, pairs = 0
    for (let i = 0; i < 40; i++) {
      for (let b = 0; b < 40; b++) {
        if (i === b) continue
        pairs++
        if (glyphRandom(i, 7, 'blink', b) === glyphRandom(b, 7, 'blink', i)) aliased++
        if (xorControl(i, 7, 'blink', b) === xorControl(b, 7, 'blink', i)) controlAliased++
      }
    }
    expect(controlAliased).toBe(pairs)   // the shortcut aliases every pair
    expect(aliased).toBe(0)              // the shipped chain aliases none
  })

  it('channelKey mixes distinct labels to distinct keys', () => {
    const keys = ['blink', 'scatter', 'grade', 'axis0', 'axis1', '', 'a', 'b']
      .map((c) => channelKey(c))
    expect(new Set(keys).size).toBe(keys.length)
    expect(channelKey('blink')).toBe(channelKey('blink'))
  })
})

// ── uniformity: the failure a naive stability test cannot see ───────────────

describe('the distribution does not clump', () => {
  it('passes chi-square across 10 bins over 10 000 glyphs', () => {
    const values = Array.from({ length: 10000 }, (_, i) => glyphRandom(i, 3, 'blink'))
    const chi = chiSquareUniform(values, 10)
    // 9 d.o.f.; the 99.9% critical value is 27.88. A hash returning 0.9 for
    // every glyph scores 90 000 here and would sail through every stability
    // assertion above.
    expect(chi).toBeLessThan(27.88)
  })

  it('passes chi-square across time buckets on a single glyph', () => {
    // Blink reads one glyph across thousands of buckets, which is a different
    // axis of the same table and can clump independently.
    const values = Array.from({ length: 10000 }, (_, b) => glyphRandom(2, 3, 'blink', b))
    expect(chiSquareUniform(values, 10)).toBeLessThan(27.88)
  })

  it('has a mean near 0.5 and uses both ends of the range', () => {
    const values = Array.from({ length: 10000 }, (_, i) => glyphRandom(i, 3, 'scatter'))
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    expect(mean).toBeGreaterThan(0.48)
    expect(mean).toBeLessThan(0.52)
    expect(Math.min(...values)).toBeLessThan(0.005)
    expect(Math.max(...values)).toBeGreaterThan(0.995)
  })

  it('spreads across a headline-length word, not just across thousands', () => {
    // The real n is 8 letters, not 10 000, and a hash can be uniform in bulk
    // while clumping for small `i` — which is exactly the case this studio
    // renders. Stated statistically, because the obvious per-seed assertion
    // ("every 8-letter run touches both halves") is WRONG: eight uniform samples
    // land in one half 2/2^8 of the time, so a correct generator fails it. It
    // did, on seed 14, which is how this test got its present shape.
    //
    // Two population measures over 1000 words instead:
    //   mean range of 8 uniform samples = (n−1)/(n+1) = 0.778
    //   P(all 8 in one half)            = 2/256      = 0.0078
    let totalRange = 0
    let oneSided = 0
    const WORDS = 1000
    for (let seed = 0; seed < WORDS; seed++) {
      const v = Array.from({ length: 8 }, (_, i) => glyphRandom(i, seed, 'scatter'))
      totalRange += Math.max(...v) - Math.min(...v)
      if (Math.max(...v) < 0.5 || Math.min(...v) > 0.5) oneSided++
    }
    expect(totalRange / WORDS).toBeGreaterThan(0.72)   // 0.778 expected
    expect(totalRange / WORDS).toBeLessThan(0.84)
    expect(oneSided / WORDS).toBeLessThan(0.03)        // 0.0078 expected
  })
})

// ── time bucketing ──────────────────────────────────────────────────────────

describe('timeBucket quantises time', () => {
  it('is constant within a bucket and steps at the edge', () => {
    expect(timeBucket(0, 0.25)).toBe(0)
    expect(timeBucket(0.249, 0.25)).toBe(0)
    expect(timeBucket(0.25, 0.25)).toBe(1)
    expect(timeBucket(0.999, 0.25)).toBe(3)
    expect(timeBucket(1, 0.25)).toBe(4)
  })

  it('is a pure function of t — the same t is the same bucket, always', () => {
    const ts = Array.from({ length: 500 }, (_, i) => i * 0.017)
    const first = ts.map((t) => timeBucket(t, 0.1))
    const second = ts.map((t) => timeBucket(t, 0.1))
    expect(second).toEqual(first)
  })

  it('freezes when the period is zero or negative', () => {
    // A rate slider at zero means "do not vary", not "divide by zero" and not
    // "flicker at the frame rate".
    for (const period of [0, -1, NaN, Infinity]) {
      expect(timeBucket(0.5, period)).toBe(0)
      expect(timeBucket(9.9, period)).toBe(0)
    }
    expect(timeBucket(NaN, 0.25)).toBe(0)
  })

  it('counts down through negative time', () => {
    expect(timeBucket(-0.1, 1)).toBe(-1)
    expect(timeBucket(-1, 1)).toBe(-1)
    expect(timeBucket(-1.5, 1)).toBe(-2)
  })

  it('gives a bake and a preview the same value at the same t', () => {
    // The end-to-end shape of trap 1, at the primitive's level: two independent
    // evaluations of `f(glyph, t)` with nothing shared between them.
    const render = (i: number, t: number) => glyphRandom(i, 5, 'blink', timeBucket(t, 1 / 12))
    const preview = Array.from({ length: 60 }, (_, f) => render(f % 6, f / 30))
    const bake = Array.from({ length: 60 }, (_, f) => render(f % 6, f / 30))
    expect(bake).toEqual(preview)
  })
})

// ── range mapping ───────────────────────────────────────────────────────────

describe('glyphRandomRange', () => {
  it('stays inside [min, max)', () => {
    for (let i = 0; i < 500; i++) {
      const v = glyphRandomRange(i, 2, 'scatter', 100, 900)
      expect(v).toBeGreaterThanOrEqual(100)
      expect(v).toBeLessThan(900)
    }
  })

  it('scatters the other way when the range is reversed', () => {
    // A spread control dragged past its base should mirror, not stop working.
    const a = glyphRandomRange(4, 2, 'scatter', 900, 100)
    expect(a).toBeGreaterThanOrEqual(100)
    expect(a).toBeLessThan(900)
    expect(a).toBe(glyphRandomRange(4, 2, 'scatter', 100, 900))
  })

  it('collapses to the value for a zero-width range', () => {
    expect(glyphRandomRange(4, 2, 'scatter', 400, 400)).toBe(400)
  })
})

// ── word grouping ───────────────────────────────────────────────────────────

describe('word grouping', () => {
  it('splits on spaces', () => {
    expect(words('the quick brown fox')).toEqual(['the', 'quick', 'brown', 'fox'])
  })

  it('treats a run with no spaces as one word', () => {
    // Otherwise `unit: 'word'` is silently identical to `unit: 'letter'` on a
    // one-word headline, which is most headlines in this studio.
    expect(words('HEADLINE')).toEqual(['HEADLINE'])
    expect(wordCount(run('HEADLINE'))).toBe(1)
  })

  it('keeps punctuation attached to its word', () => {
    // A blink that leaves the comma hanging in mid-air reads as a bug.
    expect(words('Hello, world!')).toEqual(['Hello,', 'world!'])
    expect(words('“quoted” (aside).')).toEqual(['“quoted”', '(aside).'])
  })

  it('keeps hyphenated compounds whole', () => {
    expect(words('state-of-the-art')).toEqual(['state-of-the-art'])
    expect(words('re-do it')).toEqual(['re-do', 'it'])
  })

  it('splits a spaced em dash, because the spaces do the work', () => {
    expect(words('a — b')).toEqual(['a', '—', 'b'])
  })

  it('opens no empty word for leading, trailing or repeated spaces', () => {
    expect(words('  hi  there  ')).toEqual(['hi', 'there'])
    expect(words('a  b')).toEqual(['a', 'b'])
    for (const w of groupWords(run('  hi  there  '))) expect(w.glyphs.length).toBeGreaterThan(0)
  })

  it('returns nothing for an empty or all-whitespace run', () => {
    expect(groupWords(run(''))).toEqual([])
    expect(groupWords(run('   \t\n '))).toEqual([])
    expect(groupWords([])).toEqual([])
    expect(groupWords(null)).toEqual([])
    expect(groupWords(undefined)).toEqual([])
  })

  it('does NOT split on a non-breaking space', () => {
    // U+00A0 and U+202F exist to say "keep these together"; honouring that is
    // the entire reason the character exists.
    expect(words('10 kg')).toEqual(['10 kg'])
    expect(words('Fig. 4')).toEqual(['Fig. 4'])
    expect(isWordSeparator(0x00a0)).toBe(false)
    expect(isWordSeparator(0x202f)).toBe(false)
  })

  it('splits on a zero-width space but not on the joiners', () => {
    expect(words('a​b')).toEqual(['a', 'b'])
    expect(words('a‌b')).toEqual(['a‌b'])
    expect(words('a‍b')).toEqual(['a‍b'])
  })

  it('splits on tabs, newlines and the typographic spaces', () => {
    for (const cp of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0x1680,
                      0x2000, 0x2005, 0x200a, 0x2028, 0x2029, 0x205f, 0x3000]) {
      expect(isWordSeparator(cp), `U+${cp.toString(16)}`).toBe(true)
      expect(words(`a${String.fromCodePoint(cp)}b`), `U+${cp.toString(16)}`).toEqual(['a', 'b'])
    }
  })

  it('reports contiguous ascending indices with an inclusive end', () => {
    const groups = groupWords(run('ab cde'))
    expect(groups).toEqual([
      { glyphs: [0, 1], start: 0, end: 1 },
      { glyphs: [3, 4, 5], start: 3, end: 5 },
    ])
  })

  it('accounts for every glyph: words plus separators equals the run', () => {
    const text = '  Hello,  non breaking — world!  '
    const glyphs = run(text)
    const inWords = groupWords(glyphs).reduce((n, w) => n + w.glyphs.length, 0)
    const separators = glyphs.filter((g) => isSeparatorGlyph(g)).length
    expect(inWords + separators).toBe(glyphs.length)
  })
})

describe('word grouping over shaped glyphs', () => {
  it('reads ligatures by their code points, not by character count', () => {
    // The reason the input is the glyph run and not the source string: `ffi`
    // shapes to ONE glyph, and the index a renderer transforms is the glyph's.
    const glyphs: VtWordGlyph[] = [
      { codePoints: [0x6f] },                  // o
      { codePoints: [0x66, 0x66, 0x69] },      // ffi ligature — one glyph
      { codePoints: [0x63] },                  // c
      { codePoints: [0x20] },                  // space
      { codePoints: [0x65] },                  // e
    ]
    expect(groupWords(glyphs).map((w) => w.glyphs)).toEqual([[0, 1, 2], [4]])
    expect(wordIndexOfGlyph(glyphs)).toEqual([0, 0, 0, VT_NO_WORD, 1])
  })

  it('treats a glyph carrying any ink as part of the word', () => {
    // A glyph that ligated a letter and a space still has ink; dropping it would
    // leave a hole in the word.
    expect(isSeparatorGlyph({ codePoints: [0x61, 0x20] })).toBe(false)
    expect(isSeparatorGlyph({ codePoints: [0x20, 0x20] })).toBe(true)
  })

  it('treats a glyph with no code points as part of the word', () => {
    // Unknown provenance defaults to ink: one glyph too many blinks a slightly
    // larger group; one too few leaves a stray mark on screen.
    const glyphs: VtWordGlyph[] = [{ codePoints: [0x61] }, { codePoints: [] }, { codePoints: [0x20] }]
    expect(isSeparatorGlyph(glyphs[1]!)).toBe(false)
    expect(groupWords(glyphs).map((w) => w.glyphs)).toEqual([[0, 1]])
  })

  it('survives a malformed glyph', () => {
    expect(isSeparatorGlyph(null)).toBe(false)
    expect(isSeparatorGlyph(undefined)).toBe(false)
    expect(isSeparatorGlyph({ codePoints: [NaN] })).toBe(false)
    expect(isSeparatorGlyph({ codePoints: undefined as unknown as number[] })).toBe(false)
  })
})

describe('wordIndexOfGlyph', () => {
  it('is parallel to the run and marks separators VT_NO_WORD', () => {
    expect(wordIndexOfGlyph(run('ab c'))).toEqual([0, 0, VT_NO_WORD, 1])
    expect(VT_NO_WORD).toBe(-1)
  })

  it('gives a space no word, so a space can never blink', () => {
    const idx = wordIndexOfGlyph(run(' a '))
    expect(idx).toEqual([VT_NO_WORD, 0, VT_NO_WORD])
    // Indexing a per-word array with -1 yields undefined, not word 0 — the
    // failure mode is a visible absence rather than a silently dimmed word.
    const perWord = [0.5]
    expect(perWord[idx[0]!]).toBeUndefined()
  })

  it('agrees with groupWords on a mixed run', () => {
    const glyphs = run('  Hello,  non breaking — world!  ')
    const idx = wordIndexOfGlyph(glyphs)
    const groups = groupWords(glyphs)
    for (let w = 0; w < groups.length; w++) {
      for (const i of groups[w]!.glyphs) expect(idx[i]).toBe(w)
    }
    expect(idx.filter((v) => v === VT_NO_WORD).length)
      .toBe(glyphs.filter((g) => isSeparatorGlyph(g)).length)
  })
})
