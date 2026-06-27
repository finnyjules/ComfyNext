import { describe, expect, it } from 'vitest'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import type { TemplateV3 } from '~~/shared/template-grid/types'

// A v3 template: one "headline lockup" section (top-left quadrant of the fine
// grid) holding a headline child that fills the section's top band.
function fixture(): TemplateV3 {
  return {
    version: 3, id: 't3', name: 't3', master: '1x1',
    formats: {
      '1x1': { w: 1080, h: 1080 },
      '9x16': { w: 1080, h: 1920 },
    },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    background: { fill: '#0a0a0a' },
    elements: [],   // nothing ungrouped
    sections: [
      {
        id: 'lockup', name: 'headline lockup',
        region: { col: 1, colSpan: 40, row: 1, rowSpan: 40 },
        children: [
          { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
            region: { col: 1, colSpan: 40, row: 1, rowSpan: 10 } },
        ],
      },
    ],
  }
}

const within = (a: number, lo: number, hi: number) => a >= lo - 0.5 && a <= hi + 0.5

describe('resolveFormat — v3 sections', () => {
  it('places the child inside its section box on the master', () => {
    const r = resolveFormat(fixture(), '1x1', { text_layer_1: 'Brew bold' })
    expect(r.elements).toHaveLength(1)
    const child = r.elements.find(e => e.el.id === 'headline')!
    expect(child.culled).toBe(false)
    expect(child.text!.content).toBe('Brew bold')
    // section box on master: x=72, w=40*12=480, y=72, h=480
    expect(within(child.rect.x, 72, 552)).toBe(true)
    expect(within(child.rect.x + child.rect.w, 72, 552)).toBe(true)
    expect(child.rect.y).toBeCloseTo(72, 0)
    // child fills only the top band (rowSpan 10 of section's 40) → ~1/4 height
    expect(child.rect.h).toBeLessThan(480 * 0.4)
  })

  it('section override repositions the child in only that output', () => {
    const t = fixture()
    t.sections[0]!.overrides = { sqB: { region: { col: 39, colSpan: 40, row: 39, rowSpan: 40 } } }
    const a = resolveFormat(t, '1x1', { text_layer_1: 'Hi' }, {}, { outputId: 'sqA' })
      .elements.find(e => e.el.id === 'headline')!
    const b = resolveFormat(t, '1x1', { text_layer_1: 'Hi' }, {}, { outputId: 'sqB' })
      .elements.find(e => e.el.id === 'headline')!
    // sqA keeps the top-left lockup; sqB's section moved to bottom-right → child follows
    expect(b.rect.x).toBeGreaterThan(a.rect.x)
    expect(b.rect.y).toBeGreaterThan(a.rect.y)
  })

  it('a hidden section culls its children', () => {
    const t = fixture()
    t.sections[0]!.hidden = true
    const child = resolveFormat(t, '1x1', { text_layer_1: 'Hi' })
      .elements.find(e => e.el.id === 'headline')!
    expect(child.culled).toBe(true)
    expect(child.cullReason).toBe('hidden')
  })

  it('child adapts proportionally to a portrait format', () => {
    const r = resolveFormat(fixture(), '9x16', { text_layer_1: 'Brew bold' })
    const child = r.elements.find(e => e.el.id === 'headline')!
    expect(child.culled).toBe(false)
    // portrait is taller → section box taller → child band taller than on square
    const sq = resolveFormat(fixture(), '1x1', { text_layer_1: 'Brew bold' })
      .elements.find(e => e.el.id === 'headline')!
    expect(child.rect.h).toBeGreaterThan(sq.rect.h)
  })

  it('ungrouped elements in a v3 template still resolve (v2 path)', () => {
    const t = fixture()
    t.elements = [
      { id: 'badge', type: 'shape', shape: 'rect', priority: 2,
        region: { col: 60, colSpan: 15, row: 60, rowSpan: 15 }, style: { fill: '#fff' } },
    ]
    const r = resolveFormat(t, '1x1', { text_layer_1: 'Hi' })
    const ids = r.elements.map(e => e.el.id)
    expect(ids).toContain('badge')
    expect(ids).toContain('headline')
  })
})
