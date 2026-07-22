import { describe, it, expect } from 'vitest'
import { groupBySections } from '~/lib/catalogSections'

const SECTIONS = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
const items = [
  { id: '1', cat: 'b' },
  { id: '2', cat: 'a' },
  { id: '3', cat: 'b' },
  { id: '4', cat: 'zzz' },
]

describe('groupBySections', () => {
  it('groups items into declared sections in order, keeping item order within a section', () => {
    const g = groupBySections(items, SECTIONS, i => i.cat)
    expect(g.map(s => s.id)).toEqual(['a', 'b', '__other'])
    expect(g[1]!.items.map(i => i.id)).toEqual(['1', '3'])
  })

  it('drops empty sections and omits __other when everything matches', () => {
    const g = groupBySections(items.slice(0, 3), SECTIONS, i => i.cat)
    expect(g.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('labels the fallback group "Other"', () => {
    const g = groupBySections([{ id: 'x', cat: 'nope' }], SECTIONS, i => i.cat)
    expect(g).toEqual([{ id: '__other', label: 'Other', items: [{ id: 'x', cat: 'nope' }] }])
  })
})
