import { describe, it, expect } from 'vitest'
import { groupIntoSections } from '../../app/lib/studio/sections'

type C = { key: string; group: string; kind: string }
const c = (key: string, group: string): C => ({ key, group, kind: 'slider' })

describe('groupIntoSections', () => {
  const ORDER = ['Alpha', 'Beta', 'Gamma'] as const

  it('emits sections in the declared order, not the controls order', () => {
    const out = groupIntoSections([c('c', 'Gamma'), c('a', 'Alpha')], ORDER)
    expect(out.map(s => s.title)).toEqual(['Alpha', 'Gamma'])
  })

  it('keeps control order within a section', () => {
    const out = groupIntoSections([c('a1', 'Alpha'), c('a2', 'Alpha')], ORDER)
    expect(out[0]!.controls.map(x => x.key)).toEqual(['a1', 'a2'])
  })

  it('drops sections with no visible controls, so no empty card renders', () => {
    const out = groupIntoSections([c('a', 'Alpha')], ORDER)
    expect(out.map(s => s.title)).toEqual(['Alpha'])
  })

  it('silently drops a control whose group is not in the order list', () => {
    // Matches texturefx/sections.ts's documented contract: the order constant is the
    // allow-list, so a typo'd group is dropped rather than rendered in a stray section.
    const out = groupIntoSections([c('x', 'Nope'), c('a', 'Alpha')], ORDER)
    expect(out.map(s => s.title)).toEqual(['Alpha'])
  })

  it('applies the visibility predicate before grouping', () => {
    const out = groupIntoSections(
      [c('a', 'Alpha'), c('b', 'Beta')], ORDER, (x) => x.key !== 'b')
    expect(out.map(s => s.title)).toEqual(['Alpha'])
  })

  it('returns an empty array when nothing is visible', () => {
    expect(groupIntoSections([c('a', 'Alpha')], ORDER, () => false)).toEqual([])
  })
})
