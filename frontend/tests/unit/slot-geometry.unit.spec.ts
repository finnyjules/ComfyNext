import { describe, it, expect } from 'vitest'
import { buildReel, type ReelParams } from '~/lib/spacetype/slotGeometry'

const base: ReelParams = {
  messages: 'MAKE IT REAL\nSHIP TODAY',
  reelUnit: 'word',
  fillerSource: 'messages',
  glyphSet: 'mixed',
  shapeSet: 'geometric',
  fillerTokens: 'A B C',
  fillerDensity: 3,
  align: 'left',
}

describe('buildReel', () => {
  it('slotCount is the longest message token count (word mode)', () => {
    const r = buildReel(base)
    expect(r.slotCount).toBe(3)       // "MAKE IT REAL" = 3 words
    expect(r.messageCount).toBe(2)
    expect(r.stride).toBe(4)          // 1 land + 3 filler
  })

  it('each slot strip has messageCount*stride cells, land cells at m*stride', () => {
    const r = buildReel(base)
    expect(r.cells).toHaveLength(3)
    for (const strip of r.cells) expect(strip).toHaveLength(2 * 4)
    // slot 0, message 0 land cell = "MAKE"
    expect(r.cells[0]![0]).toEqual({ kind: 'text', value: 'MAKE' })
    // slot 0, message 1 land cell (index stride=4) = "SHIP"
    expect(r.cells[0]![4]).toEqual({ kind: 'text', value: 'SHIP' })
  })

  it('pads short messages with blank land cells (left align)', () => {
    // "SHIP TODAY" has 2 words; slot 2 (index 2) is blank for message 1
    const r = buildReel(base)
    expect(r.cells[2]![4]).toEqual({ kind: 'blank', value: '' })
    // but slot 2 message 0 = "REAL"
    expect(r.cells[2]![0]).toEqual({ kind: 'text', value: 'REAL' })
  })

  it('char mode makes one slot per character', () => {
    const r = buildReel({ ...base, messages: 'GO\nHEY', reelUnit: 'char' })
    expect(r.slotCount).toBe(3)       // "HEY" = 3 chars
    expect(r.cells[0]![0]).toEqual({ kind: 'text', value: 'G' })
  })

  it('shape filler emits shape cells; deterministic for same params', () => {
    const r1 = buildReel({ ...base, fillerSource: 'shapes' })
    const r2 = buildReel({ ...base, fillerSource: 'shapes' })
    expect(r1.cells).toEqual(r2.cells)
    const filler = r1.cells[0]![1]     // first filler after land 0
    expect(filler!.kind).toBe('shape')
  })

  it('fillerDensity 0 makes stride 1 (no filler)', () => {
    const r = buildReel({ ...base, fillerDensity: 0 })
    expect(r.stride).toBe(1)
    expect(r.cells[0]).toHaveLength(2)
  })
})
