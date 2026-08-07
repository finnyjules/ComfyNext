import { describe, it, expect } from 'vitest'
import { expandContent, parseContent, type ContentItem } from '~/lib/spacetype/tile'

describe('expandContent', () => {
  it('image → one image tile, aspect defaults to 1', () => {
    const out = expandContent([{ id: 'a', kind: 'image', src: 'data:x' }])
    expect(out).toEqual([{ kind: 'image', sourceId: 'a', src: 'data:x', aspect: 1 }])
  })

  it('whole word → one word tile', () => {
    const out = expandContent([{ id: 'w', kind: 'word', text: 'NATURAL', resolution: 'whole' }])
    expect(out).toEqual([{ kind: 'word', sourceId: 'w', text: 'NATURAL' }])
  })

  it('letters word → one letter tile per non-space char, indexed', () => {
    const out = expandContent([{ id: 'w', kind: 'word', text: 'FRESH', resolution: 'letters' }])
    expect(out).toHaveLength(5)
    expect(out.map(t => (t as any).letterIndex)).toEqual([0, 1, 2, 3, 4])
    expect(out.every(t => t.kind === 'letter' && t.sourceId === 'w' && t.text === 'FRESH')).toBe(true)
  })

  it('letters word skips spaces but keeps order', () => {
    const out = expandContent([{ id: 'w', kind: 'word', text: 'A B', resolution: 'letters' }])
    expect(out).toHaveLength(2)
    expect(out.map(t => (t as any).letterIndex)).toEqual([0, 1])
  })

  it('mixed list preserves order and total count', () => {
    const items: ContentItem[] = [
      { id: 'i1', kind: 'image', src: 'data:1', aspect: 1.5 },
      { id: 'w1', kind: 'word', text: 'HI', resolution: 'letters' },
      { id: 'i2', kind: 'image', src: 'data:2' },
    ]
    const out = expandContent(items)
    expect(out.map(t => t.kind)).toEqual(['image', 'letter', 'letter', 'image'])
    expect(out.map(t => t.sourceId)).toEqual(['i1', 'w1', 'w1', 'i2'])
  })

  it('empty / whitespace word contributes nothing', () => {
    expect(expandContent([{ id: 'e', kind: 'word', text: '   ', resolution: 'letters' }])).toEqual([])
    expect(expandContent([{ id: 'e', kind: 'word', text: '', resolution: 'whole' }])).toEqual([])
  })

  it('parseContent returns [] on garbage', () => {
    expect(parseContent('not json')).toEqual([])
    expect(parseContent('{}')).toEqual([])
    expect(parseContent('[{"id":"a","kind":"image","src":"x"}]')).toHaveLength(1)
  })
})
