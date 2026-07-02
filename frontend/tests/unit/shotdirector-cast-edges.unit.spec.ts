import { describe, expect, it } from 'vitest'
import { syncCast, wireCastFor } from '~/lib/shotdirector/castEdges'

const N = (id: string, slug: string | null, name = slug ?? '', nodeType: 'Character' | 'CharacterSheet' = 'Character') =>
  ({ id, nodeType, characterSlug: slug, characterName: name })
const SD = { id: 'sd1', nodeType: 'ShotDirector' }
const E = (source: string, handle: string) => ({ source, target: 'sd1', targetHandle: handle })

describe('wireCastFor', () => {
  it('maps wired Character nodes to cast members in input order', () => {
    const nodes = [SD, N('c1', 'reva', 'Reva'), N('c2', 'marcus', 'Marcus')]
    const edges = [E('c2', 'input-1'), E('c1', 'input-0')]
    expect(wireCastFor('sd1', nodes, edges)).toEqual([
      { slug: 'reva', name: 'Reva', via: 'wire' },
      { slug: 'marcus', name: 'Marcus', via: 'wire' },
    ])
  })
  it('skips slugless Character nodes and non-character sources', () => {
    const nodes = [SD, N('c1', null), { id: 'img', nodeType: 'Image' }]
    expect(wireCastFor('sd1', nodes, [E('c1', 'input-0'), E('img', 'input-1')])).toEqual([])
  })
  it('treats a saved CharacterSheet node like a Character node', () => {
    const nodes = [SD, N('c1', 'reva', 'Reva', 'CharacterSheet')]
    expect(wireCastFor('sd1', nodes, [E('c1', 'input-0')])).toEqual([
      { slug: 'reva', name: 'Reva', via: 'wire' },
    ])
  })
  it('dedupes same node wired into multiple cast inputs, keeping first occurrence', () => {
    const nodes = [SD, N('c1', 'reva', 'Reva')]
    const edges = [E('c1', 'input-0'), E('c1', 'input-1')]
    expect(wireCastFor('sd1', nodes, edges)).toEqual([
      { slug: 'reva', name: 'Reva', via: 'wire' },
    ])
  })
})

describe('syncCast', () => {
  const reva = { slug: 'reva', name: 'Reva', via: 'picker' as const }
  const marcusWire = { slug: 'marcus', name: 'Marcus', via: 'wire' as const }
  const zoeWire = { slug: 'zoe', name: 'Zoe', via: 'wire' as const }

  it('keeps picker entries, replaces wire entries', () => {
    expect(syncCast([reva, marcusWire], [])).toEqual([reva])
    expect(syncCast([reva], [marcusWire])).toEqual([reva, marcusWire])
  })
  it('dedupes by slug — picker wins over an identical wire member', () => {
    expect(syncCast([reva], [{ ...reva, via: 'wire' }])).toBeNull() // no change: picker entry already covers the slug
  })
  it('returns null when nothing changed', () => {
    expect(syncCast([marcusWire], [marcusWire])).toBeNull()
  })
  it('preserves existing order — a wire member before a picker member stays first', () => {
    // existing [wireA(marcus), picker(reva)] + wire list still containing marcus
    // → no change, order preserved (not reshuffled to picker-first).
    expect(syncCast([marcusWire, reva], [marcusWire])).toBeNull()
  })
  it('appends genuinely new wire members at the end, keeping prior order', () => {
    expect(syncCast([marcusWire], [marcusWire, zoeWire])).toEqual([marcusWire, zoeWire])
  })
})
