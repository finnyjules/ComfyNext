import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Curated palette parsing on the Fable taste read (server/api/taste/read.post.ts).
 * The palette is CURATED (Fable-named {name, hex}[]) — never raw k-means.
 *
 * read.post.ts calls defineEventHandler at module scope (a Nitro auto-import
 * that doesn't exist under plain vitest), so the globals are stubbed before a
 * dynamic import — the loras-local-handlers.unit.spec.ts pattern.
 */
const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.readBody = async (event: any) => event
g.useRuntimeConfig = () => ({})
g.createError = (opts: { statusCode: number, statusMessage: string }) => {
  const err = new Error(opts.statusMessage) as Error & { statusCode: number, statusMessage: string }
  err.statusCode = opts.statusCode
  err.statusMessage = opts.statusMessage
  return err
}

let parseCuratedPalette: (raw: unknown) => { name: string, hex: string }[]
let parseBoardName: (raw: unknown) => string

beforeAll(async () => {
  ({ parseCuratedPalette, parseBoardName } = await import('../../server/api/taste/read.post'))
})

describe('parseCuratedPalette', () => {
  it('keeps valid named hexes, drops junk, clamps to 6', () => {
    const raw = [
      { name: 'Blush', hex: '#F6C1CB' }, { name: 'x', hex: 'red' }, { name: '', hex: '#000000' },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, hex: '#112233' })),
    ]
    const out = parseCuratedPalette(raw)
    expect(out[0]).toEqual({ name: 'Blush', hex: '#F6C1CB' })
    expect(out.every(p => /^#[0-9a-fA-F]{6}$/.test(p.hex) && p.name.trim())).toBe(true)
    expect(out.length).toBeLessThanOrEqual(6)
  })
  it('non-arrays → empty (never throws)', () => {
    expect(parseCuratedPalette(null)).toEqual([])
    expect(parseCuratedPalette('nope')).toEqual([])
  })
})

describe('parseBoardName', () => {
  it('trims, collapses whitespace, strips wrapping quotes', () => {
    expect(parseBoardName('  Cobalt  Print   World ')).toBe('Cobalt Print World')
    expect(parseBoardName('"Pastel Dream"')).toBe('Pastel Dream')
  })
  it('caps at 40 chars without a mid-word cut', () => {
    const out = parseBoardName('Extremely Long Evocative Editorial Illustration World Title')
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith(' ')).toBe(false)
  })
  it('junk → empty string (never throws, caller keeps its own name)', () => {
    expect(parseBoardName(null)).toBe('')
    expect(parseBoardName(12)).toBe('')
    expect(parseBoardName('   ')).toBe('')
  })
})
