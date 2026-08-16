import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '~/lib/geoshape/config'
import type { Paint } from '~/lib/compositor/paint'

describe('geoshape config', () => {
  it('mergeConfig on junk returns defaults', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(mergeConfig({ count: 'nope', layout: 'bogus' }).count).toBe(DEFAULT_CONFIG.count)
    expect(mergeConfig({ layout: 'bogus' }).layout).toBe(DEFAULT_CONFIG.layout)
  })
  it('round-trips a full config', () => {
    const cfg = { ...DEFAULT_CONFIG, count: 8, layout: 'grid' as const, overlapMode: 'shape' as const, seed: 42 }
    expect(mergeConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg)
  })
  it('defaults overlapMode to hole (geologo default)', () => {
    expect(DEFAULT_CONFIG.overlapMode).toBe('hole')
  })
  it('accepts a gradient Paint for fill and round-trips it', () => {
    const grad: Paint = { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f' }] }
    const cfg = mergeConfig({ ...DEFAULT_CONFIG, fill: grad })
    expect(cfg.fill).toEqual(grad)
  })
  it('accepts a pattern Fill and an ImageFill for fill', () => {
    const patt: any = { type: 'stripes', a: '#111', b: '#eee', textColor: '#000', angle: 0, density: 8 }
    const img: any = { type: 'image', src: 'data:image/png;base64,AAAA', fit: 'cover' }
    expect(mergeConfig({ ...DEFAULT_CONFIG, fill: patt }).fill).toEqual(patt)
    expect(mergeConfig({ ...DEFAULT_CONFIG, overlapFill: img }).overlapFill).toEqual(img)
  })
  it('falls back to default for junk paint (bad/absent type)', () => {
    expect(mergeConfig({ ...DEFAULT_CONFIG, fill: { type: 'bogus' } }).fill).toBe(DEFAULT_CONFIG.fill)
    expect(mergeConfig({ ...DEFAULT_CONFIG, fill: 42 }).fill).toBe(DEFAULT_CONFIG.fill)
  })
  it('a solid string stays a solid string', () => {
    expect(mergeConfig({ ...DEFAULT_CONFIG, fill: '#abcdef' }).fill).toBe('#abcdef')
  })
})
