import { mulberry32, hashSeed } from './rng'

/** One cell in a slot's reel strip: a word/char (`text`), a geometric shape id (`shape`), or empty (`blank`). */
export type Cell = { kind: 'text' | 'shape' | 'blank'; value: string }

export interface ReelParams {
  messages: string
  reelUnit: 'word' | 'char'
  fillerSource: 'messages' | 'glyphs' | 'shapes' | 'custom'
  glyphSet: string
  shapeSet: string
  fillerTokens: string
  fillerDensity: number
  align: 'left' | 'center'
}

export interface Reel {
  slotCount: number
  messageCount: number
  /** cells per message = 1 land + fillerDensity filler. */
  stride: number
  /** cells[slotIndex] = that slot's ordered strip (length messageCount*stride). */
  cells: Cell[][]
}

/** Curated geometric shape catalogs (ids consumed by slot.ts's drawShapeToken). */
export const SHAPE_IDS: Record<string, string[]> = {
  basic: ['circle', 'square', 'triangle'],
  geometric: ['circle', 'square', 'triangle', 'diamond', 'cross', 'ring', 'chevron'],
}

const GLYPH_SETS: Record<string, string> = {
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '$#%&@*+=?!',
  mixed: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$#%&',
}

function splitMessages(raw: string): string[] {
  const out = String(raw ?? '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
  return out.length ? out : ['SLOT']
}

/** Tokenize one message into its landing units. */
function tokensOf(message: string, unit: 'word' | 'char'): string[] {
  if (unit === 'char') return Array.from(message).filter(c => c.trim() !== '')
  return message.split(/\s+/).filter(w => w.length > 0)
}

/** The pool of possible filler tokens for a given source. Returns Cells so shapes/text mix cleanly. */
function fillerPool(p: ReelParams, allTokens: string[]): Cell[] {
  switch (p.fillerSource) {
    case 'glyphs': {
      const set = GLYPH_SETS[p.glyphSet] ?? GLYPH_SETS.mixed!
      return Array.from(set).map(v => ({ kind: 'text', value: v }) as Cell)
    }
    case 'shapes': {
      const ids = SHAPE_IDS[p.shapeSet] ?? SHAPE_IDS.geometric!
      return ids.map(v => ({ kind: 'shape', value: v }) as Cell)
    }
    case 'custom': {
      const toks = String(p.fillerTokens ?? '').split(/\s+/).filter(t => t.length > 0)
      const src = toks.length ? toks : ['A', 'B', 'C']
      return src.map(v => ({ kind: 'text', value: v }) as Cell)
    }
    case 'messages':
    default: {
      const src = allTokens.length ? allTokens : ['SLOT']
      return src.map(v => ({ kind: 'text', value: v }) as Cell)
    }
  }
}

/** Where message m's token t sits among slotCount slots, honoring align. Returns the slot index or -1. */
function slotForToken(t: number, tokenCount: number, slotCount: number, align: 'left' | 'center'): number {
  if (align === 'center') {
    const start = Math.floor((slotCount - tokenCount) / 2)
    return start + t
  }
  return t // left
}

export function buildReel(p: ReelParams): Reel {
  const messages = splitMessages(p.messages)
  const perMsgTokens = messages.map(m => tokensOf(m, p.reelUnit))
  const slotCount = Math.max(1, ...perMsgTokens.map(t => t.length))
  const messageCount = messages.length
  const F = Math.max(0, Math.floor(Number(p.fillerDensity) || 0))
  const stride = 1 + F

  // Landing token per (slot j, message m), '' when this slot is padded blank for that message.
  const landing: string[][] = Array.from({ length: slotCount }, () => Array.from({ length: messageCount }, () => ''))
  for (let m = 0; m < messageCount; m++) {
    const toks = perMsgTokens[m]!
    for (let t = 0; t < toks.length; t++) {
      const j = slotForToken(t, toks.length, slotCount, p.align)
      if (j >= 0 && j < slotCount) landing[j]![m] = toks[t]!
    }
  }

  const allTokens = perMsgTokens.flat()
  const pool = fillerPool(p, allTokens)

  const cells: Cell[][] = []
  for (let j = 0; j < slotCount; j++) {
    const strip: Cell[] = []
    for (let m = 0; m < messageCount; m++) {
      const land = landing[j]![m]!
      strip.push(land ? { kind: 'text', value: land } : { kind: 'blank', value: '' })
      // Deterministic filler: seeded by slot+message+k so a given config is reproducible.
      const rand = mulberry32(hashSeed(`slot|${j}|${m}|${p.fillerSource}`))
      for (let k = 0; k < F; k++) {
        const pick = pool.length ? pool[Math.floor(rand() * pool.length)]! : { kind: 'blank', value: '' } as Cell
        strip.push({ ...pick })
      }
    }
    cells.push(strip)
  }

  return { slotCount, messageCount, stride, cells }
}

export interface Timing {
  messageCount: number
  stride: number
  slotCount: number
  hold: number
  stagger: number
  overshoot: number
}

/** Overshoot easing: 0 at p=0, 1 at p=1, overshoots above 1 near the end when s>0 (settles exactly). */
export function easeOutBack(p: number, s: number): number {
  const c1 = s
  const c3 = c1 + 1
  const q = p - 1
  return 1 + c3 * q * q * q + c1 * q * q
}

/** Local-segment settle time (u∈[hold,1]) for a slot: larger slot index ⇒ later ⇒ left-to-right cascade.
 *  stagger 0 ⇒ all settle at u=1; stagger 1 ⇒ slot j settles proportionally to (j+1)/slotCount. */
export function settleTime(slot: number, slotCount: number, hold: number, stagger: number): number {
  const frac = slotCount > 0 ? (slot + 1) / slotCount : 1
  const lerped = 1 - stagger * (1 - frac) // 1 at stagger 0, frac at stagger 1
  return hold + (1 - hold) * lerped
}

export function reelScroll(t01: number, slot: number, T: Timing): { offset: number; speed: number } {
  const M = Math.max(1, T.messageCount)
  const St = Math.max(1, T.stride)
  const L = M * St
  const tt = ((t01 % 1) + 1) % 1
  const m = Math.min(M - 1, Math.floor(tt * M))
  const u = tt * M - m
  const Pm = m * St
  const h = Math.min(0.95, Math.max(0, T.hold))
  const uLand = settleTime(slot, Math.max(1, T.slotCount), h, Math.min(1, Math.max(0, T.stagger)))

  let p: number
  if (u <= h) p = 0
  else if (u >= uLand) p = 1
  else p = (u - h) / Math.max(1e-4, uLand - h)

  const s = Math.min(1, Math.max(0, T.overshoot)) * 1.70158
  const e = easeOutBack(p, s)
  const offsetRaw = Pm + St * e
  const offset = ((offsetRaw % L) + L) % L

  let speed = 0
  if (p > 0 && p < 1) {
    const q = p - 1
    const dedp = 3 * (s + 1) * q * q + 2 * s * q
    const vCells = Math.abs((St * dedp) / Math.max(1e-4, uLand - h))
    speed = Math.min(1, vCells / (St * 3))
  }
  return { offset, speed }
}
