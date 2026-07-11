import { describe, expect, it } from 'vitest'
import { resolveFormat } from '../../shared/template-grid/resolve'
import type { TemplateV3 } from '../../shared/template-grid/types'

function tpl(style?: TemplateV3['sections'][0]['style']): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 },
    typeScale: { base: 16, ratio: 1.25 },
    elements: [],
    sections: [{
      id: 's1', name: 'frame',
      region: { col: 1, colSpan: 10, row: 1, rowSpan: 10 },
      style,
      children: [
        { id: 'a', type: 'shape', shape: 'rect', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 } },
      ],
    }],
  }
}

describe('section frame', () => {
  it('an unstyled section emits no frame element', () => {
    const r = resolveFormat(tpl(undefined), 'sq')
    expect(r.elements.some(e => e.sectionFrame)).toBe(false)
    expect(r.elements.find(e => e.el.id === 's1__frame')).toBeUndefined()
  })

  it('a styled section emits a frame shape BEHIND its children', () => {
    const r = resolveFormat(tpl({ fill: '#222', stroke: '#f00', strokeWidth: 2, radius: 8 }), 'sq')
    const frameIdx = r.elements.findIndex(e => e.sectionFrame)
    const childIdx = r.elements.findIndex(e => e.el.id === 'a')
    expect(frameIdx).toBeGreaterThanOrEqual(0)
    expect(frameIdx).toBeLessThan(childIdx)   // z-order: frame under children

    const frame = r.elements[frameIdx]!
    const s = (frame.el as any).style
    expect(frame.el.type).toBe('shape')
    expect(frame.el.id).toBe('s1__frame')
    expect(s.fill).toBe('#222')
    expect(s.borderColor).toBe('#f00')
    expect(s.borderWidth).toBe(2)
    expect(s.borderRadius).toBe(8)
    expect(frame.rect.w).toBeGreaterThan(0)
    expect(frame.rect.h).toBeGreaterThan(0)
  })

  it('a stroke-only frame gets a transparent fill (no black default)', () => {
    const r = resolveFormat(tpl({ stroke: '#0f0' }), 'sq')
    const frame = r.elements.find(e => e.sectionFrame)!
    expect((frame.el as any).style.fill).toBe('transparent')
    expect((frame.el as any).style.borderColor).toBe('#0f0')
    expect((frame.el as any).style.borderWidth).toBe(1)   // default width
  })

  it('a clipping frame emits a container (even unstyled) and tags its children', () => {
    const t = tpl(undefined)
    t.sections[0].clip = true
    const r = resolveFormat(t, 'sq')
    const frame = r.elements.find(e => e.sectionFrame)!
    expect(frame).toBeDefined()          // container emitted despite no fill/stroke
    expect(frame.clipsChildren).toBe(true)
    const child = r.elements.find(e => e.el.id === 'a')!
    expect(child.clippedBy).toBe('s1')
    expect(child.clipRect?.w).toBeGreaterThan(0)
  })

  it('a non-clipping frame does not tag its children', () => {
    const r = resolveFormat(tpl({ fill: '#222' }), 'sq')   // styled, clip off
    const child = r.elements.find(e => e.el.id === 'a')!
    expect(child.clippedBy).toBeUndefined()
    expect(r.elements.find(e => e.sectionFrame)!.clipsChildren).toBeFalsy()
  })
})
