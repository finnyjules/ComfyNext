import { describe, it, expect } from 'vitest'
import { expandContent, parseContent, type ContentItem } from '~/lib/spacetype/tile'

describe('expandContent', () => {
  it('card/image → one card tile, aspect defaults to 1', () => {
    const out = expandContent([{ id: 'a', kind: 'card', fillKind: 'image', src: 'data:x' }])
    expect(out).toEqual([{ kind: 'card', sourceId: 'a', fillKind: 'image', src: 'data:x', fill: undefined, aspect: 1 }])
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
      { id: 'i1', kind: 'card', fillKind: 'image', src: 'data:1', aspect: 1.5 },
      { id: 'w1', kind: 'word', text: 'HI', resolution: 'letters' },
      { id: 'i2', kind: 'card', fillKind: 'image', src: 'data:2' },
    ]
    const out = expandContent(items)
    expect(out.map(t => t.kind)).toEqual(['card', 'letter', 'letter', 'card'])
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

  it('migrates a legacy image item to a card/image fill', () => {
    const items = parseContent(JSON.stringify([{ id: 'i', kind: 'image', src: 'data:x', aspect: 1.5 }]))
    expect(items).toEqual([{ id: 'i', kind: 'card', fillKind: 'image', src: 'data:x', aspect: 1.5 }])
  })

  it('expands a gradient card to one card tile carrying its fill', () => {
    const fill = { type: 'gradient', a: '#fff', b: '#000', angle: 45 } as any
    const out = expandContent([{ id: 'c', kind: 'card', fillKind: 'gradient', fill }])
    expect(out).toEqual([{ kind: 'card', sourceId: 'c', fillKind: 'gradient', aspect: 1, src: undefined, fill }])
  })

  it('legacy image expands to a card tile (kind card, fillKind image)', () => {
    const out = expandContent(parseContent(JSON.stringify([{ id: 'i', kind: 'image', src: 'data:x', aspect: 2 }])))
    expect(out[0]).toMatchObject({ kind: 'card', fillKind: 'image', src: 'data:x', aspect: 2 })
  })
})
