import { mulberry32, hashSeed } from './rng'
import { type Fill, serializeFills } from './fillTile'

/**
 * The canonical "Vessell" fill palette — one ordered source of truth for every Type Studio
 * effect's default fills. Each effect takes a per-effect seeded shuffle of these (see
 * defaultFillsFor), so effects look varied but each effect's default is stable + reproducible.
 */
export const VESSELL_FILLS: Fill[] = [
  { type: 'solid',        a: '#2563ff', b: '#0a0a2e', textColor: '#0a0a2e', angle: 45, density: 8 },
  { type: 'stripes',      a: '#ef8fcb', b: '#e3685a', textColor: '#101014', angle: 45, density: 8 },
  { type: 'grid',         a: '#e3685a', b: '#edb07f', textColor: '#ffffff', angle: 45, density: 8 },
  { type: 'ombre',        a: '#86e8c0', b: '#eef07f', textColor: '#2a1838', angle: 45, density: 8 },
  { type: 'qr',           a: '#edb07f', b: '#e98fcf', textColor: '#ffffff', angle: 45, density: 8 },
  { type: 'checkerboard', a: '#eef07f', b: '#e98fcf', textColor: '#0a0a0a', angle: 45, density: 8 },
]

/** A deterministic Fisher-Yates shuffle of a COPY of VESSELL_FILLS, seeded by seedKey. */
function shuffledPalette(seedKey: string): Fill[] {
  const rand = mulberry32(hashSeed(seedKey))
  const out = VESSELL_FILLS.map(f => ({ ...f }))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** The first `count` fills of this effect's seeded shuffle, serialized for params. Cycles the
 *  palette if count exceeds its length. */
export function defaultFillsFor(count: number, seedKey: string): string {
  const shuffled = shuffledPalette(seedKey)
  const out: Fill[] = []
  for (let i = 0; i < count; i++) out.push({ ...shuffled[i % shuffled.length]! })
  return serializeFills(out)
}

/** The first `count` PRIMARY colors of this effect's seeded shuffle (for Extrude's side palette). */
export function vessellColorsFor(count: number, seedKey: string): string[] {
  const shuffled = shuffledPalette(seedKey)
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(shuffled[i % shuffled.length]!.a)
  return out
}
