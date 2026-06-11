import { describe, expect, it } from 'vitest'
import { useGridEditor } from '~/composables/useGridEditor'
import type { TemplateV2 } from '~~/shared/template-grid/types'

function fixture(): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: {
      '1x1':    { w: 1080, h: 1080 },
      '728x90': { w: 728, h: 90 },
      '970x250': { w: 970, h: 250 },
    },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
        region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 } },
      { id: 'subhead', type: 'text', content: 'sub', level: 'subhead', priority: 5,
        region: { col: 1, colSpan: 4, row: 6, rowSpan: 1 } },
    ],
  }
}

describe('useGridEditor', () => {
  it('starts on the master format', () => {
    const ed = useGridEditor(fixture())
    expect(ed.currentFormat.value).toBe('1x1')
    expect(ed.isMaster.value).toBe(true)
    expect(ed.formatClass.value).toBe('square')
  })

  it('setRegion writes the base region on the master', () => {
    const ed = useGridEditor(fixture())
    ed.setRegion('headline', { col: 2, colSpan: 5, row: 3, rowSpan: 2 })
    expect(ed.template.value.elements[0].region).toEqual({ col: 2, colSpan: 5, row: 3, rowSpan: 2 })
    expect(ed.template.value.elements[0].regionByClass).toBeUndefined()
    expect(ed.dirty.value).toBe(true)
  })

  it('setRegion on a non-master format writes regionByClass for its class', () => {
    const ed = useGridEditor(fixture())
    ed.setFormat('728x90')
    expect(ed.formatClass.value).toBe('strip')
    ed.setRegion('headline', { col: 1, colSpan: 8, row: 1, rowSpan: 1 })
    expect(ed.template.value.elements[0].regionByClass).toEqual({
      strip: { col: 1, colSpan: 8, row: 1, rowSpan: 1 },
    })
    // base region untouched
    expect(ed.template.value.elements[0].region).toEqual({ col: 1, colSpan: 6, row: 4, rowSpan: 2 })
    // the edit affects every strip format
    expect(ed.resolvedAll.value['970x250'].elements[0].region).toEqual({ col: 1, colSpan: 8, row: 1, rowSpan: 1 })
    expect(ed.hasClassRegion('headline')).toBe(true)
  })

  it('clearClassRegion removes the class entry', () => {
    const ed = useGridEditor(fixture())
    ed.setFormat('728x90')
    ed.setRegion('headline', { col: 1, colSpan: 8, row: 1, rowSpan: 1 })
    ed.clearClassRegion('headline')
    expect(ed.template.value.elements[0].regionByClass).toBeUndefined()
    expect(ed.hasClassRegion('headline')).toBe(false)
  })

  it('worst-case toggle swaps text_layer props', () => {
    const ed = useGridEditor(fixture())
    ed.sampleProps.value = { text_layer_1: 'Short', image_layer_1: 'http://x/i.png' }
    const before = ed.resolved.value.elements[0].text!.content
    expect(before).toBe('Short')
    ed.worstCase.value = true
    const after = ed.resolved.value.elements[0].text!.content
    expect(after.length).toBeGreaterThan(100)
    expect(ed.sampleProps.value.text_layer_1).toBe('Short')  // source untouched
  })

  it('resolvedAll reports culling per format (subhead drops on strips)', () => {
    const ed = useGridEditor(fixture())
    const strip = ed.resolvedAll.value['728x90']
    expect(strip.elements.find(e => e.el.id === 'subhead')!.culled).toBe(true)
    const square = ed.resolvedAll.value['1x1']
    expect(square.elements.find(e => e.el.id === 'subhead')!.culled).toBe(false)
  })

  it('addText assigns the next priority and selects the element', () => {
    const ed = useGridEditor(fixture())
    ed.addText()
    const added = ed.template.value.elements[2]
    expect(added.priority).toBe(6)
    expect(ed.selectedId.value).toBe(added.id)
  })

  it('moveElementTo reorders (z-order contract)', () => {
    const ed = useGridEditor(fixture())
    ed.moveElementTo('headline', 1)
    expect(ed.template.value.elements.map(e => e.id)).toEqual(['subhead', 'headline'])
    ed.moveElement('subhead', 'up')
    expect(ed.template.value.elements.map(e => e.id)).toEqual(['headline', 'subhead'])
  })

  it('removeElement clears selection', () => {
    const ed = useGridEditor(fixture())
    ed.selectedId.value = 'subhead'
    ed.removeElement('subhead')
    expect(ed.template.value.elements).toHaveLength(1)
    expect(ed.selectedId.value).toBeNull()
  })
})
