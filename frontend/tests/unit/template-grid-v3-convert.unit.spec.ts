import { describe, expect, it } from 'vitest'
import { allElements, groupIntoSection, toV3, ungroupSection } from '~~/shared/template-grid/sections'
import type { TemplateV2 } from '~~/shared/template-grid/types'

function v2(): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      { id: 'headline', type: 'text', content: 'Hi', level: 'display', priority: 1,
        region: { col: 2, colSpan: 4, row: 2, rowSpan: 2 } },
      { id: 'subhead', type: 'text', content: 'Sub', level: 'subhead', priority: 2,
        region: { col: 2, colSpan: 4, row: 5, rowSpan: 1 } },
      { id: 'logo', type: 'image', content: 'l', priority: 3,
        region: { col: 50, colSpan: 10, row: 1, rowSpan: 6 } },
    ],
  }
}

describe('toV3', () => {
  it('bumps version, keeps elements ungrouped, adds empty sections', () => {
    const t3 = toV3(v2())
    expect(t3.version).toBe(3)
    expect(t3.sections).toEqual([])
    expect(t3.elements.map(e => e.id)).toEqual(['headline', 'subhead', 'logo'])
  })
  it('does not mutate the input', () => {
    const src = v2()
    toV3(src)
    expect(src.version).toBe(2)
  })
})

describe('groupIntoSection', () => {
  it('moves members into a new section bounded by their regions', () => {
    const t3 = groupIntoSection(toV3(v2()), ['headline', 'subhead'], 'lockup')
    expect(t3.elements.map(e => e.id)).toEqual(['logo'])   // members removed
    expect(t3.sections).toHaveLength(1)
    const sec = t3.sections[0]!
    expect(sec.name).toBe('lockup')
    expect(sec.children.map(c => c.id)).toEqual(['headline', 'subhead'])
    // bounding box: cols 2..5, rows 2..5 → col2 colSpan4 row2 rowSpan4
    expect(sec.region).toEqual({ col: 2, colSpan: 4, row: 2, rowSpan: 4 })
  })
  it('is pure (input untouched)', () => {
    const src = toV3(v2())
    groupIntoSection(src, ['headline'], 's')
    expect(src.sections).toHaveLength(0)
    expect(src.elements).toHaveLength(3)
  })
})

describe('ungroupSection', () => {
  it('restores children to ungrouped elements', () => {
    const grouped = groupIntoSection(toV3(v2()), ['headline', 'subhead'], 'lockup')
    const back = ungroupSection(grouped, grouped.sections[0]!.id)
    expect(back.sections).toEqual([])
    expect(back.elements.map(e => e.id).sort()).toEqual(['headline', 'logo', 'subhead'])
  })
})

describe('allElements', () => {
  it('returns ungrouped elements plus every section child', () => {
    const grouped = groupIntoSection(toV3(v2()), ['headline', 'subhead'], 'lockup')
    expect(allElements(grouped).map(e => e.id).sort()).toEqual(['headline', 'logo', 'subhead'])
  })
  it('returns just elements for a v2 template', () => {
    expect(allElements(v2()).map(e => e.id)).toEqual(['headline', 'subhead', 'logo'])
  })
})
