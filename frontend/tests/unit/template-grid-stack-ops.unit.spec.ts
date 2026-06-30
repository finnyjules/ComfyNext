import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTOLAYOUT, addChildToStack, removeChildFromStack,
  setChildSizing, setStackLayout, wrapInStack,
} from '../../shared/template-grid/sections'
import type { TemplateV3 } from '../../shared/template-grid/types'

function base(): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 }, typeScale: { base: 16, ratio: 1.25 },
    elements: [
      { id: 'a', type: 'text', content: 'A', level: 'headline', priority: 1, region: { col: 1, colSpan: 6, row: 1, rowSpan: 2 } },
      { id: 'b', type: 'shape', shape: 'rect', priority: 2, region: { col: 1, colSpan: 6, row: 3, rowSpan: 2 } },
    ],
    sections: [],
  }
}

describe('stack ops', () => {
  it('wrapInStack creates a layout section with default layout + seeded sizing', () => {
    const t = wrapInStack(base(), ['a', 'b'])
    expect(t.sections).toHaveLength(1)
    expect(t.elements).toHaveLength(0)
    expect(t.sections[0].layout).toEqual(DEFAULT_AUTOLAYOUT)
    const a = t.sections[0].children.find(c => c.id === 'a')!
    const b = t.sections[0].children.find(c => c.id === 'b')!
    expect(a.layoutSizing).toEqual({ main: 'hug', cross: 'fill' })   // text
    expect(b.layoutSizing).toEqual({ main: 'fixed', cross: 'fill' }) // shape
  })

  it('setStackLayout patches direction without dropping other fields', () => {
    const t0 = wrapInStack(base(), ['a'])
    const sid = t0.sections[0].id
    const t2 = setStackLayout(t0, sid, { direction: 'horizontal' })
    expect(t2.sections[0].layout!.direction).toBe('horizontal')
    expect(t2.sections[0].layout!.gap).toBe(DEFAULT_AUTOLAYOUT.gap)
  })

  it('setChildSizing updates one child', () => {
    const t0 = wrapInStack(base(), ['a', 'b'])
    const sid = t0.sections[0].id
    const t = setChildSizing(t0, sid, 'b', { main: 'fill', cross: 'fill' })
    expect(t.sections[0].children.find(c => c.id === 'b')!.layoutSizing).toEqual({ main: 'fill', cross: 'fill' })
  })

  it('addChildToStack moves an ungrouped element in and seeds sizing', () => {
    let t = wrapInStack(base(), ['a'])    // a in a stack, b still ungrouped
    const sid = t.sections[0].id
    t = addChildToStack(t, sid, 'b')
    expect(t.elements).toHaveLength(0)
    expect(t.sections[0].children.map(c => c.id)).toEqual(['a', 'b'])
    expect(t.sections[0].children.find(c => c.id === 'b')!.layoutSizing).toEqual({ main: 'fixed', cross: 'fill' })
  })

  it('removeChildFromStack returns a child to ungrouped elements', () => {
    const t0 = wrapInStack(base(), ['a', 'b'])
    const sid = t0.sections[0].id
    const t = removeChildFromStack(t0, sid, 'b')
    expect(t.sections[0].children.map(c => c.id)).toEqual(['a'])
    expect(t.elements.map(e => e.id)).toEqual(['b'])
  })

  it('does not mutate the input template', () => {
    const input = base()
    wrapInStack(input, ['a', 'b'])
    expect(input.sections).toHaveLength(0)
    expect(input.elements).toHaveLength(2)
  })
})
