import { describe, expect, it } from 'vitest'
import { autopopulateV2, refsSocket } from '~~/shared/template-grid/autopopulate'

const base = () => ({
  version: 2, id: 't', name: 't', master: '1x1',
  formats: { '1x1': { w: 1080, h: 1080 } },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  background: { fill: '#000' },
  elements: [
    { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
      region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 } },
  ],
}) as any

describe('autopopulateV2 (shared)', () => {
  it('seeds a full-bleed background element for a connected image_layer_1', () => {
    const t = base()
    autopopulateV2(t, { image_layer_1: '/view?x', text_layer_1: 'bound' })
    expect(t.elements[0]).toMatchObject({
      id: 'image_layer_1', type: 'image', bleed: true, content: '{{ props.image_layer_1 }}',
    })
    // referenced text socket untouched — no duplicate element
    expect(t.elements.filter((e: any) => String(e.content).includes('text_layer_1'))).toHaveLength(1)
  })

  it('is idempotent — a second pass adds nothing', () => {
    const t = base()
    autopopulateV2(t, { image_layer_1: '/view?x' })
    const count = t.elements.length
    autopopulateV2(t, { image_layer_1: '/view?x' })
    expect(t.elements.length).toBe(count)
  })

  it('refsSocket sees v3 section children too', () => {
    const t = base()
    t.version = 3
    t.elements = []
    t.sections = [{ id: 's', children: [{ id: 'c', type: 'image', content: '{{ props.image_layer_1 }}' }] }]
    expect(refsSocket(t, 'image_layer_1')).toBe(true)
  })
})
