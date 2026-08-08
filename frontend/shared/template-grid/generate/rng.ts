/**
 * Self-contained seeded PRNG for layout generation. Copied (not imported) so
 * shared/ stays free of any app dependency. Same mulberry32/FNV-1a used across
 * the codebase's visual-randomness modules — deterministic across editor,
 * render and the Python node.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a → 32-bit unsigned int, for deriving a numeric seed from a string. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

export interface Rng {
  next(): number
  int(n: number): number
  pick<T>(a: readonly T[]): T
  chance(p: number): boolean
}

/** A seeded RNG. `salt` derives an independent stream from the same seed, so
 *  staging choices and surface choices don't correlate at seed = 1. */
export function makeRng(seed: number, salt = ''): Rng {
  const s = salt ? hashSeed(salt + '|' + (seed >>> 0)) : (seed >>> 0)
  const fn = mulberry32(s)
  return {
    next: () => fn(),
    int: (n) => Math.floor(fn() * Math.max(1, n | 0)),
    pick: (a) => a[Math.floor(fn() * a.length)] as never,
    chance: (p) => fn() < p,
  }
}
