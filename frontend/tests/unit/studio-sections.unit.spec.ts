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

  it('treats a slashed group as a child section', () => {
    const out = groupIntoSections(
      [c('a', 'Alpha'), c('s', 'Alpha/Shadow')],
      ['Alpha', 'Alpha/Shadow'],
    )
    expect(out.map(s => s.title)).toEqual(['Alpha'])
    expect(out[0]!.controls.map(x => x.key)).toEqual(['a'])
    expect(out[0]!.sections.map(s => s.title)).toEqual(['Shadow'])
    expect(out[0]!.sections[0]!.controls.map(x => x.key)).toEqual(['s'])
  })

  it('creates the parent even when only the child path is listed', () => {
    const out = groupIntoSections([c('s', 'Alpha/Shadow')], ['Alpha/Shadow'])
    expect(out.map(s => s.title)).toEqual(['Alpha'])
    expect(out[0]!.controls).toEqual([])
    expect(out[0]!.sections.map(s => s.title)).toEqual(['Shadow'])
  })

  it('silently drops a control grouped at the implicitly-created parent when only the child path is listed', () => {
    // 'Canvas' is never itself in `order` — only 'Canvas/Shadow' is — so 'Canvas' is
    // created as an implicit parent node but the allow-list check on the raw group
    // string still rejects a control declared with group: 'Canvas'. Same trap as the
    // typo'd-group case above, just reached via nesting instead of a misspelling.
    const out = groupIntoSections(
      [c('root', 'Canvas'), c('s', 'Canvas/Shadow')],
      ['Canvas/Shadow'],
    )
    expect(out.map(s => s.title)).toEqual(['Canvas'])
    expect(out[0]!.controls).toEqual([])
    expect(out[0]!.sections.map(s => s.title)).toEqual(['Shadow'])
    expect(out[0]!.sections[0]!.controls.map(x => x.key)).toEqual(['s'])
  })

  it('nests more than one level deep', () => {
    const out = groupIntoSections([c('d', 'A/B/C')], ['A/B/C'])
    expect(out[0]!.sections[0]!.sections[0]!.title).toBe('C')
    expect(out[0]!.sections[0]!.sections[0]!.controls.map(x => x.key)).toEqual(['d'])
  })

  it('prunes an empty branch while a populated sibling branch survives', () => {
    // A flat (non-nesting) implementation can pass "prunes a branch whose every
    // descendant is empty" by accident — 'Beta/Deep' just never matches anything.
    // This pins the case that actually exercises the tree: two branches under the
    // SAME parent, one with a control two levels down, one with none at all.
    const out = groupIntoSections(
      [c('p', 'Alpha/Populated')],
      ['Alpha', 'Alpha/Populated', 'Alpha/Empty/Deeper'],
    )
    expect(out.map(s => s.title)).toEqual(['Alpha'])
    expect(out[0]!.sections.map(s => s.title)).toEqual(['Populated'])
    expect(out[0]!.sections[0]!.controls.map(x => x.key)).toEqual(['p'])
  })

  it('gives flat groups an empty children array, so callers can loop blindly', () => {
    const out = groupIntoSections([c('a', 'Alpha')], ORDER)
    expect(out[0]!.sections).toEqual([])
  })
})
