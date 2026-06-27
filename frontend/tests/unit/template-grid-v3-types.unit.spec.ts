import { describe, expect, it } from 'vitest'
import { isV3 } from '~~/shared/template-grid/types'
import type { TemplateV2, TemplateV3 } from '~~/shared/template-grid/types'

function v2(): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      { id: 'h', type: 'text', content: 'Hi', level: 'display', priority: 1,
        region: { col: 1, colSpan: 6, row: 1, rowSpan: 2 } },
    ],
  }
}

function v3(): TemplateV3 {
  return {
    version: 3, id: 't3', name: 't3', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [],
    sections: [
      {
        id: 'sec1', name: 'headline lockup',
        region: { col: 1, colSpan: 40, row: 1, rowSpan: 20 },
        children: [
          { id: 'h', type: 'text', content: 'Hi', level: 'display', priority: 1,
            region: { col: 1, colSpan: 40, row: 1, rowSpan: 10 } },
        ],
      },
    ],
  }
}

describe('v3 schema types', () => {
  it('isV3 narrows on the version discriminant', () => {
    expect(isV3(v2())).toBe(false)
    expect(isV3(v3())).toBe(true)
  })

  it('a TemplateV3 carries sections with children', () => {
    const t = v3()
    expect(t.sections).toHaveLength(1)
    expect(t.sections[0]!.children[0]!.id).toBe('h')
    expect(t.sections[0]!.name).toBe('headline lockup')
  })
})
