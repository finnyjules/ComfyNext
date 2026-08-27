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
