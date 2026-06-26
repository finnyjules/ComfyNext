import { mulberry32, hashSeed } from './rng'
import { type Fill, serializeFills } from './fillTile'

/**
 * The Vessell brand palette — hex equivalents of the `--palette-*` CSS variables defined in
 * `app/assets/css/main.css` (those are authored in oklch "exact values from Figma"; THREE/canvas
 * need hex, so we mirror them here). Keep in sync with main.css if the brand palette changes.
 */
export const PALETTE = {
  yellow: '#F2FF5A',
  darkIndigo: '#23123C',
  darkNavy: '#040541',
  darkTeal: '#15221F',
  darkBrown: '#4A1F1C',
  purple: '#52367B',
  blue: '#0E6BFF',
  teal: '#209D80',
  coral: '#FF6259',
  pink: '#FF99F7',
  periwinkle: '#96B4FF',
  mint: '#54F4CF',
  peach: '#FFB984',
  gray: '#C2BFB9',
  beige: '#D2D3C1',
  lavender: '#DDE3EF',
  charcoal: '#232323',
} as const

/**
 * The canonical "Vessell" fill palette — one ordered source of truth for every Type Studio
 * effect's default fills, built from the brand PALETTE. Each effect takes a per-effect seeded
 * shuffle of these (see defaultFillsFor), so effects look varied but each effect's default is
 * stable + reproducible.
 */
export const VESSELL_FILLS: Fill[] = [
  { type: 'solid',        a: PALETTE.blue,  b: PALETTE.darkNavy, textColor: PALETTE.darkNavy,   angle: 45, density: 8 },
  { type: 'stripes',      a: PALETTE.pink,  b: PALETTE.coral,    textColor: PALETTE.darkIndigo, angle: 45, density: 8 },
  { type: 'grid',         a: PALETTE.coral, b: PALETTE.peach,    textColor: PALETTE.lavender,   angle: 45, density: 8 },
  { type: 'ombre',        a: PALETTE.mint,  b: PALETTE.yellow,   textColor: PALETTE.darkIndigo, angle: 45, density: 8 },
  { type: 'qr',           a: PALETTE.peach, b: PALETTE.pink,     textColor: PALETTE.lavender,   angle: 45, density: 8 },
  { type: 'checkerboard', a: PALETTE.yellow, b: PALETTE.pink,    textColor: PALETTE.charcoal,   angle: 45, density: 8 },
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
