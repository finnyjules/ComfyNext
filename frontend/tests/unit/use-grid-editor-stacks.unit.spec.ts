import { describe, expect, it } from 'vitest'
import { useGridEditor } from '~/composables/useGridEditor'
import type { TemplateV3 } from '~~/shared/template-grid/types'

function v3(): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq', formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 }, typeScale: { base: 16, ratio: 1.25 },
    elements: [
      { id: 'a', type: 'text', content: 'A', level: 'headline', priority: 1, region: { col: 1, colSpan: 6, row: 1, rowSpan: 2 } },
      { id: 'b', type: 'shape', shape: 'rect', priority: 2, region: { col: 1, colSpan: 6, row: 3, rowSpan: 2 } },
    ],
    sections: [],
  }
}

describe('useGridEditor — stacks', () => {
  it('wrapSelectionInStack groups the current selection into a Stack', () => {
    const ed = useGridEditor(v3())
    ed.selectedId.value = 'a'
    ed.wrapSelectionInStack()
    const t = ed.template.value as TemplateV3
    expect(t.sections).toHaveLength(1)
    expect(t.sections[0].layout?.direction).toBe('vertical')
  })

  it('updateStackLayout patches the layout reactively', () => {
    const ed = useGridEditor(v3())
    ed.selectedId.value = 'a'
    ed.wrapSelectionInStack()
    const sid = (ed.template.value as TemplateV3).sections[0].id
    ed.updateStackLayout(sid, { direction: 'horizontal' })
    expect((ed.template.value as TemplateV3).sections[0].layout?.direction).toBe('horizontal')
  })

  it('wrapSelectionInStack with explicit ids groups those elements', () => {
    const ed = useGridEditor(v3())
    ed.wrapSelectionInStack(['a', 'b'])
    const t = ed.template.value as TemplateV3
    expect(t.sections).toHaveLength(1)
    expect(t.sections[0].children.map(c => c.id).sort()).toEqual(['a', 'b'])
    expect(ed.selectedSectionId.value).toBe(t.sections[0].id)
    expect(ed.selectedId.value).toBeNull()
    expect(ed.dirty.value).toBe(true)
  })

  it('selectedStack returns the selected section when it is a stack', () => {
    const ed = useGridEditor(v3())
    ed.selectedId.value = 'a'
    ed.wrapSelectionInStack()
    const sid = (ed.template.value as TemplateV3).sections[0].id
    ed.selectedSectionId.value = sid
    expect(ed.selectedStack.value).not.toBeNull()
    expect(ed.selectedStack.value?.layout?.direction).toBe('vertical')
  })
})
