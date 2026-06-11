import { describe, expect, it } from 'vitest'
import { convertV1toV2 } from '~~/shared/template-grid/convert'
import type { Template } from '~~/server/templates/schema'

const V1: Template = {
  version: 1, id: 'legacy', name: 'Legacy',
  aspects: { '1x1': { w: 1080, h: 1080 }, '9x16': { w: 1080, h: 1920 } },
  defaultAspect: '1x1',
  background: { fill: '#0a0a0a' },
  elements: [
    { id: 'headline', type: 'text', role: 'HEADLINE', anchor: 'top-center',
      offset: { x: 0, y: '58%' }, size: { w: '84%', h: 'auto' },
      style: { fontSize: 96, fontWeight: 700, color: '#fff', align: 'center' },
      content: '{{ props.text_layer_1 }}' },
    { id: 'hero', type: 'image', role: 'IMAGE_LAYER_1', anchor: 'top-left',
      offset: { x: 0, y: 0 }, size: { w: '100%', h: '100%' },
      style: { fit: 'cover' }, content: '{{ props.image_layer_1 }}' },
  ],
}

describe('convertV1toV2', () => {
  it('produces a valid v2 template with formats from aspects', () => {
    const t2 = convertV1toV2(V1)
    expect(t2.version).toBe(2)
    expect(t2.master).toBe('1x1')
    expect(Object.keys(t2.formats)).toEqual(['1x1', '9x16'])
    expect(t2.grid.gutter).toBe(24)
    expect(t2.background).toEqual({ fill: '#0a0a0a' })
  })
  it('snaps a full-bleed image to the full grid', () => {
    const t2 = convertV1toV2(V1)
    const hero = t2.elements.find(e => e.id === 'hero')!
    expect(hero.region).toEqual({ col: 1, colSpan: 6, row: 1, rowSpan: 6 })
  })
  it('snaps the headline into the lower grid rows and maps size to a level', () => {
    const t2 = convertV1toV2(V1)
    const h = t2.elements.find(e => e.id === 'headline')! as any
    expect(h.region.row).toBeGreaterThanOrEqual(4)
    expect(h.level).toBe('display')   // 96px is closest to display (≈112)
    expect(h.priority).toBe(1)        // HEADLINE role
  })
  it('assigns priorities by role heuristic', () => {
    const t2 = convertV1toV2(V1)
    expect(t2.elements.find(e => e.id === 'hero')!.priority).toBe(4)
  })
})
