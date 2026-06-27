import { describe, expect, it } from 'vitest'
import { useGridEditor } from '~/composables/useGridEditor'
import { isV3 } from '~~/shared/template-grid/types'
import type { TemplateV2, TemplateV3 } from '~~/shared/template-grid/types'

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

/** Resolved layout for a given output id (from resolvedByOutput). */
function byOut(ed: ReturnType<typeof useGridEditor>, id: string) {
  return ed.resolvedByOutput.value.find(r => r.output.id === id)!.layout
}

describe('useGridEditor', () => {
  it('starts on the master format with a single derived output', () => {
    const ed = useGridEditor(fixture())
    expect(ed.currentFormat.value).toBe('1x1')
    expect(ed.isMaster.value).toBe(true)
    expect(ed.formatClass.value).toBe('square')
    expect(ed.outputs.value).toHaveLength(1)
    expect(ed.outputs.value[0].format).toBe('1x1')
  })

  it('derives one output per aspect key on construction', () => {
    const ed = useGridEditor(fixture(), { aspects: '1x1,728x90,970x250' })
    expect(ed.outputs.value.map(o => o.format)).toEqual(['1x1', '728x90', '970x250'])
    expect(ed.outputs.value.map(o => o.id)).toEqual(['1x1', '728x90', '970x250'])
  })

  it('setRegion writes the base region on the master', () => {
    const ed = useGridEditor(fixture())
    ed.setRegion('headline', { col: 2, colSpan: 5, row: 3, rowSpan: 2 })
    expect(ed.template.value.elements[0].region).toEqual({ col: 2, colSpan: 5, row: 3, rowSpan: 2 })
    expect(ed.template.value.elements[0].regionByClass).toBeUndefined()
    expect(ed.dirty.value).toBe(true)
  })

  it('setRegion on a non-master output writes regionByClass for its class', () => {
    const ed = useGridEditor(fixture(), { aspects: '1x1,728x90,970x250' })
    ed.selectOutput('728x90')
    expect(ed.formatClass.value).toBe('strip')
    ed.setRegion('headline', { col: 1, colSpan: 8, row: 1, rowSpan: 1 })
    expect(ed.template.value.elements[0].regionByClass).toEqual({
      strip: { col: 1, colSpan: 8, row: 1, rowSpan: 1 },
    })
    // base region untouched
    expect(ed.template.value.elements[0].region).toEqual({ col: 1, colSpan: 6, row: 4, rowSpan: 2 })
    // the edit affects every strip output
    expect(byOut(ed, '970x250').elements[0].region).toEqual({ col: 1, colSpan: 8, row: 1, rowSpan: 1 })
    expect(ed.hasClassRegion('headline')).toBe(true)
  })

  it('regionScope "output" writes a per-output override that diverges one variation', () => {
    const ed = useGridEditor(fixture(), { aspects: '1x1,728x90,970x250' })
    ed.selectOutput('728x90')        // strip
    ed.regionScope.value = 'output'
    ed.setRegion('headline', { col: 1, colSpan: 5, row: 1, rowSpan: 1 })
    // overrides[outputId], not regionByClass
    expect(ed.template.value.elements[0].overrides).toEqual({
      '728x90': { region: { col: 1, colSpan: 5, row: 1, rowSpan: 1 } },
    })
    expect(ed.template.value.elements[0].regionByClass).toBeUndefined()
    expect(ed.hasOutputOverride('headline')).toBe(true)
    // only this output changes; the other strip (970x250) keeps the default
    expect(byOut(ed, '728x90').elements[0].region).toEqual({ col: 1, colSpan: 5, row: 1, rowSpan: 1 })
    expect(byOut(ed, '970x250').elements[0].region).not.toEqual({ col: 1, colSpan: 5, row: 1, rowSpan: 1 })
    // clearing removes just that override
    ed.clearOutputOverride('headline')
    expect(ed.template.value.elements[0].overrides).toBeUndefined()
    expect(ed.hasOutputOverride('headline')).toBe(false)
  })

  it('selecting an output resets the region scope to class', () => {
    const ed = useGridEditor(fixture(), { aspects: '1x1,728x90,970x250' })
    ed.selectOutput('728x90')
    ed.regionScope.value = 'output'
    ed.selectOutput('970x250')
    expect(ed.regionScope.value).toBe('class')
  })

  it('clearClassRegion removes the class entry', () => {
    const ed = useGridEditor(fixture(), { aspects: '1x1,728x90' })
    ed.selectOutput('728x90')
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

  it('resolvedByOutput reports culling per output (subhead drops on strips)', () => {
    const ed = useGridEditor(fixture(), { aspects: '1x1,728x90' })
    expect(byOut(ed, '728x90').elements.find(e => e.el.id === 'subhead')!.culled).toBe(true)
    expect(byOut(ed, '1x1').elements.find(e => e.el.id === 'subhead')!.culled).toBe(false)
  })

  // -- Outputs (chosen deliverables) -----------------------------------------

  it('addOutput adds a deliverable and selects it', () => {
    const ed = useGridEditor(fixture())
    const id = ed.addOutput('728x90')!
    expect(ed.outputs.value).toHaveLength(2)
    expect(ed.currentOutputId.value).toBe(id)
    expect(ed.currentFormat.value).toBe('728x90')
  })

  it('addOutput allows the same format twice (variations)', () => {
    const ed = useGridEditor(fixture())     // outputs: [1x1]
    const id2 = ed.addOutput('1x1')!
    expect(ed.outputs.value).toHaveLength(2)
    expect(ed.outputs.value.every(o => o.format === '1x1')).toBe(true)
    expect(ed.outputs.value[0].id).not.toBe(id2)
  })

  it('addOutput rejects unknown formats', () => {
    const ed = useGridEditor(fixture())
    expect(ed.addOutput('nope')).toBeNull()
    expect(ed.outputs.value).toHaveLength(1)
  })

  it('duplicateOutput copies the output + its overrides and diverges independently', () => {
    const ed = useGridEditor(fixture(), { aspects: '1x1,728x90' })
    ed.selectOutput('728x90')
    ed.regionScope.value = 'output'
    ed.setRegion('headline', { col: 1, colSpan: 5, row: 1, rowSpan: 1 })
    const newId = ed.duplicateOutput('728x90')!
    expect(ed.outputs.value).toHaveLength(3)
    expect(ed.currentOutputId.value).toBe(newId)
    expect(ed.regionScope.value).toBe('output')
    // overrides carried over so the copy starts identical
    expect(ed.template.value.elements[0].overrides![newId].region).toEqual({ col: 1, colSpan: 5, row: 1, rowSpan: 1 })
    // editing the copy doesn't touch the source variation
    ed.setRegion('headline', { col: 2, colSpan: 4, row: 1, rowSpan: 1 })
    expect(ed.template.value.elements[0].overrides!['728x90'].region).toEqual({ col: 1, colSpan: 5, row: 1, rowSpan: 1 })
    expect(ed.template.value.elements[0].overrides![newId].region).toEqual({ col: 2, colSpan: 4, row: 1, rowSpan: 1 })
  })

  it('removeOutput removes the deliverable and cleans its overrides', () => {
    const ed = useGridEditor(fixture(), { aspects: '1x1,728x90' })
    ed.selectOutput('728x90')
    ed.regionScope.value = 'output'
    ed.setRegion('headline', { col: 1, colSpan: 5, row: 1, rowSpan: 1 })
    ed.removeOutput('728x90')
    expect(ed.outputs.value.map(o => o.id)).toEqual(['1x1'])
    expect(ed.template.value.elements[0].overrides).toBeUndefined()
    expect(ed.currentOutputId.value).toBe('1x1')
  })

  it('removeOutput keeps at least one deliverable', () => {
    const ed = useGridEditor(fixture())
    ed.removeOutput('1x1')
    expect(ed.outputs.value).toHaveLength(1)
  })

  it('renameOutput sets and clears the label', () => {
    const ed = useGridEditor(fixture())
    ed.renameOutput('1x1', 'Hero square')
    expect(ed.outputs.value[0].label).toBe('Hero square')
    ed.renameOutput('1x1', '   ')
    expect(ed.outputs.value[0].label).toBeUndefined()
  })

  it('setHiddenInOutput hides an element in just that output', () => {
    const ed = useGridEditor(fixture())
    const id2 = ed.addOutput('1x1')!     // a second square variation
    ed.selectOutput(id2)
    ed.setHiddenInOutput('subhead', true)
    expect(ed.isHiddenInOutput('subhead')).toBe(true)
    expect(byOut(ed, id2).elements.find(e => e.el.id === 'subhead')!.culled).toBe(true)
    expect(byOut(ed, '1x1').elements.find(e => e.el.id === 'subhead')!.culled).toBe(false)
    ed.setHiddenInOutput('subhead', false)
    expect(ed.isHiddenInOutput('subhead')).toBe(false)
    expect(ed.template.value.elements.find(e => e.id === 'subhead')!.overrides).toBeUndefined()
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

  // -- v3 sections -----------------------------------------------------------

  function v3Fixture(): TemplateV3 {
    return {
      version: 3, id: 't3', name: 't3', master: '1x1',
      formats: { '1x1': { w: 1080, h: 1080 }, '9x16': { w: 1080, h: 1920 } },
      grid: { gutter: 24, margin: 72, baseline: 12 },
      typeScale: { base: 28, ratio: 1.414 },
      elements: [],
      sections: [
        { id: 'sec1', name: 'lockup',
          region: { col: 4, colSpan: 40, row: 40, rowSpan: 20 },
          children: [
            { id: 'h', type: 'text', content: 'Hi', level: 'display', priority: 1,
              region: { col: 4, colSpan: 40, row: 40, rowSpan: 10 } },
          ] },
      ],
    }
  }

  it('exposes v3 mode + sections; v2 reports none', () => {
    expect(useGridEditor(v3Fixture()).isV3Mode.value).toBe(true)
    const v2 = useGridEditor(fixture())
    expect(v2.isV3Mode.value).toBe(false)
    expect(v2.sections.value).toEqual([])
    expect(useGridEditor(v3Fixture()).sections.value).toHaveLength(1)
  })

  it('resolvedSections gives each section a box rect for the current format', () => {
    const ed = useGridEditor(v3Fixture())
    const rs = ed.resolvedSections.value
    expect(rs).toHaveLength(1)
    expect(rs[0].section.id).toBe('sec1')
    expect(rs[0].rect.w).toBeGreaterThan(0)
    expect(rs[0].rect.h).toBeGreaterThan(0)
  })

  it('setSectionRegion writes the base region on the master', () => {
    const ed = useGridEditor(v3Fixture())
    ed.setSectionRegion('sec1', { col: 1, colSpan: 30, row: 1, rowSpan: 15 })
    const t = ed.template.value as TemplateV3
    expect(t.sections[0].region).toEqual({ col: 1, colSpan: 30, row: 1, rowSpan: 15 })
    expect(t.sections[0].regionByClass).toBeUndefined()
    expect(ed.dirty.value).toBe(true)
  })

  it('setSectionRegion on a non-master output writes regionByClass for its class', () => {
    const ed = useGridEditor(v3Fixture(), { aspects: '1x1,9x16' })
    ed.selectOutput(ed.outputs.value.find(o => o.format === '9x16')!.id)
    expect(ed.formatClass.value).toBe('portrait')
    ed.setSectionRegion('sec1', { col: 1, colSpan: 30, row: 1, rowSpan: 80 })
    const t = ed.template.value as TemplateV3
    expect(t.sections[0].regionByClass).toEqual({ portrait: { col: 1, colSpan: 30, row: 1, rowSpan: 80 } })
    expect(t.sections[0].region).toEqual({ col: 4, colSpan: 40, row: 40, rowSpan: 20 })   // base untouched
  })

  it('convertToV3 lifts a v2 template, group/ungroup move elements in and out', () => {
    const ed = useGridEditor(fixture())     // v2: headline + subhead
    ed.convertToV3()
    expect(isV3(ed.template.value)).toBe(true)
    expect(ed.sections.value).toEqual([])
    ed.groupSelectedInto('lockup', ['headline', 'subhead'])
    expect(ed.sections.value).toHaveLength(1)
    expect(ed.template.value.elements.map(e => e.id)).toEqual([])
    const secId = ed.sections.value[0].id
    expect(ed.selectedSectionId.value).toBe(secId)
    ed.ungroupSelectedSection()
    expect(ed.sections.value).toEqual([])
    expect(ed.template.value.elements.map(e => e.id).sort()).toEqual(['headline', 'subhead'])
  })
})
