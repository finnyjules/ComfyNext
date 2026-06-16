// Deterministic seeded RNG. A short hash string (the "seed") fully determines a
// roll, so the same seed always reproduces the same gradient.

/** xmur3 string hash → 32-bit seed. */
export function xmur3(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

/** mulberry32 PRNG — fast, good enough for visual randomness. */
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  /** Uniform float in [0,1). */
  next(): number
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number
  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number
  /** Random element of `arr`. */
  pick<T>(arr: readonly T[]): T
  /** True with probability `p`. */
  chance(p: number): boolean
}

/** Build a deterministic RNG from a seed string (optionally salted per channel). */
export function makeRng(seed: string, salt = ''): Rng {
  const fn = mulberry32(xmur3(seed + '|' + salt))
  return {
    next: fn,
    range: (lo, hi) => lo + (hi - lo) * fn(),
    int: (lo, hi) => lo + Math.floor((hi - lo + 1) * fn()),
    pick: arr => arr[Math.floor(fn() * arr.length) % arr.length]!,
    chance: p => fn() < p,
  }
}

const SEED_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** A fresh "#xxxxxxxx" seed string. Uses Math.random for genuine novelty. */
export function randomSeed(): string {
  let s = '#'
  for (let i = 0; i < 8; i++) s += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)]
  return s
}
