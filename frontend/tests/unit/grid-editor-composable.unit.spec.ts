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

  it('setFormatDims overrides and resets per-format grid dimensions', () => {
    const ed = useGridEditor(fixture())
    ed.setFormatDims('1x1', { cols: 12, rows: 8 })
    expect(ed.template.value.formats['1x1'].cols).toBe(12)
    expect(ed.metrics.value.cols).toBe(12)
    expect(ed.metrics.value.rows).toBe(8)
    ed.setFormatDims('1x1', { cols: undefined, rows: undefined })
    expect(ed.template.value.formats['1x1'].cols).toBeUndefined()
    expect(ed.metrics.value.cols).toBe(6)   // class default again
    expect(ed.dirty.value).toBe(true)
  })

  it('setFormatDims clamps to sane bounds', () => {
    const ed = useGridEditor(fixture())
    ed.setFormatDims('1x1', { cols: 99, rows: 0 })
    expect(ed.template.value.formats['1x1'].cols).toBe(24)
    expect(ed.template.value.formats['1x1'].rows).toBe(1)
  })

  it('setGridSpec patches gutter/margin and reflows metrics', () => {
    const ed = useGridEditor(fixture())
    ed.setGridSpec({ gutter: 48, margin: 120 })
    expect(ed.template.value.grid.gutter).toBe(48)
    expect(ed.metrics.value.margin).toBe(120)
    // inner = 1080 - 240 = 840; cell = (840 - 5*48)/6 = 100
    expect(ed.metrics.value.cellW).toBeCloseTo(100, 5)
  })

  // -- Lock / hide -----------------------------------------------------------

  it('toggleHidden flips the flag and culls in the resolver', () => {
    const ed = useGridEditor(fixture())
    ed.toggleHidden('subhead')
    expect(ed.template.value.elements[1].hidden).toBe(true)
    const r = ed.resolved.value.elements.find(e => e.el.id === 'subhead')!
    expect(r.culled).toBe(true)
    expect(r.cullReason).toBe('hidden')
    ed.toggleHidden('subhead')
    expect(ed.template.value.elements[1].hidden).toBeUndefined()
  })

  it('toggleLocked flips the editor-only flag', () => {
    const ed = useGridEditor(fixture())
    ed.toggleLocked('headline')
    expect(ed.template.value.elements[0].locked).toBe(true)
    expect(ed.isLocked('headline')).toBe(true)
    ed.toggleLocked('headline')
    expect(ed.isLocked('headline')).toBe(false)
  })

  // -- Duplicate -------------------------------------------------------------

  it('duplicateElement clones with a new id, shifted region, next priority, and selects it', () => {
    const ed = useGridEditor(fixture())
    // subhead: col1 colSpan4 row6 rowSpan1 — has room to shift col, clamps row.
    const newId = ed.duplicateElement('subhead')
    expect(ed.template.value.elements).toHaveLength(3)
    const clone = ed.template.value.elements.find(e => e.id === newId)!
    expect(clone.id).not.toBe('subhead')
    expect(clone.type).toBe('text')
    expect(clone.priority).toBe(6)   // max(1,5)+1
    expect(clone.region).toEqual({ col: 2, colSpan: 4, row: 6, rowSpan: 1 })
    expect(ed.selectedId.value).toBe(newId)
  })

  it('duplicate clamps a full-width element instead of shifting off-grid', () => {
    const ed = useGridEditor(fixture())   // headline spans all 6 cols
    const newId = ed.duplicateElement('headline')
    const clone = ed.template.value.elements.find(e => e.id === newId)!
    expect(clone.region).toEqual({ col: 1, colSpan: 6, row: 5, rowSpan: 2 })
  })

  // -- Nudge -----------------------------------------------------------------

  it('nudgeSelected moves the region by whole cells, clamped', () => {
    const ed = useGridEditor(fixture())
    ed.selectedId.value = 'subhead'   // region col1 colSpan4 row6 rowSpan1
    ed.nudgeSelected(1, 0)
    expect(ed.template.value.elements[1].region.col).toBe(2)
    ed.nudgeSelected(0, -1)
    expect(ed.template.value.elements[1].region.row).toBe(5)
    // clamp at the grid edge (row can't exceed rows - rowSpan + 1 = 6)
    ed.nudgeSelected(0, 99)
    expect(ed.template.value.elements[1].region.row).toBe(6)
  })

  // -- Undo / redo -----------------------------------------------------------

  it('commit/undo/redo round-trips template state', () => {
    const ed = useGridEditor(fixture())
    expect(ed.canUndo.value).toBe(false)
    expect(ed.canRedo.value).toBe(false)

    ed.addText()
    ed.commitNow()
    expect(ed.template.value.elements).toHaveLength(3)
    expect(ed.canUndo.value).toBe(true)

    ed.undo()
    expect(ed.template.value.elements).toHaveLength(2)
    expect(ed.canRedo.value).toBe(true)

    ed.redo()
    expect(ed.template.value.elements).toHaveLength(3)
  })

  it('undo captures an uncommitted edit before stepping back', () => {
    const ed = useGridEditor(fixture())
    ed.patchStyle('headline', { color: '#ff0000' })   // no explicit commit
    ed.undo()
    expect((ed.template.value.elements[0] as any).style?.color).toBeUndefined()
    ed.redo()
    expect((ed.template.value.elements[0] as any).style?.color).toBe('#ff0000')
  })

  it('a new edit after undo truncates the redo tail', () => {
    const ed = useGridEditor(fixture())
    ed.addText(); ed.commitNow()           // state A (3 els)
    ed.addShape(); ed.commitNow()          // state B (4 els)
    ed.undo()                              // back to A
    expect(ed.template.value.elements).toHaveLength(3)
    ed.addImage(); ed.commitNow()          // new branch from A
    expect(ed.canRedo.value).toBe(false)
    expect(ed.template.value.elements).toHaveLength(4)
    expect(ed.template.value.elements.some(e => e.type === 'shape')).toBe(false)
  })

  it('undo clears a dangling selection', () => {
    const ed = useGridEditor(fixture())
    ed.addText(); ed.commitNow()
    // selectedId is the new element after addText
    const newId = ed.selectedId.value
    ed.undo()
    expect(ed.template.value.elements.some(e => e.id === newId)).toBe(false)
    expect(ed.selectedId.value).toBeNull()
  })
})
