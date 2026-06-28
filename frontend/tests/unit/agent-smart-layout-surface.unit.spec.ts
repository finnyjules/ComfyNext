import { describe, it, expect } from 'vitest'
import type { ElementV2, TemplateV3 } from '~~/shared/template-grid/types'
import { describeSmartLayout, applySmartLayoutCommand, summarizeSmartLayoutChange } from '~/lib/agent/surfaces/smartLayout'

function fixture(): TemplateV3 {
  return {
    version: 3,
    id: 't1',
    name: 'Test',
    master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 48, baseline: 12 },
    typeScale: { base: 16, ratio: 1.25 },
    elements: [],
    sections: [
      { id: 'section-1', name: 'Hero', region: { col: 1, colSpan: 6, row: 1, rowSpan: 3 }, children: [] },
    ],
  }
}

describe('describeSmartLayout', () => {
  it('lists each section as an object with id, label, type, and current region', () => {
    const snap = describeSmartLayout(fixture())
    expect(snap.surface).toBe('smart-layout')
    expect(snap.objects).toContainEqual({
      id: 'section-1',
      label: 'Hero',
      type: 'section',
      current: { col: 1, colSpan: 6, row: 1, rowSpan: 3 },
    })
  })
})

describe('applySmartLayoutCommand — setSectionRegion', () => {
  const moved = { col: 2, colSpan: 4, row: 2, rowSpan: 2 }

  it('moves the target section to the new region', () => {
    const r = applySmartLayoutCommand(fixture(), {
      op: 'setSectionRegion', target: 'section-1', args: { region: moved },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.sections.find(s => s.id === 'section-1')?.region).toEqual(moved)
  })
})

describe('applySmartLayoutCommand — applyArchetype', () => {
  it('swaps in the archetype\'s elements', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'applyArchetype', args: { id: 'type-poster' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.elements.some(e => e.id === 'headline')).toBe(true)
  })

  it('scales archetype regions to the fine grid (not a tiny coarse-grid corner)', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'applyArchetype', args: { id: 'split' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const img = r.template.elements.find(e => e.id === 'image_layer_1')!
    // coarse colSpan was 3 (of 6); on the ~80-col fine grid it must scale up a lot.
    expect(img.region.colSpan).toBeGreaterThan(10)
  })

  it('returns an inverse that restores the previous elements', () => {
    const before = fixture()
    const r = applySmartLayoutCommand(before, { op: 'applyArchetype', args: { id: 'type-poster' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    expect(undo.ok).toBe(true)
    if (!undo.ok) return
    expect(undo.template.elements).toEqual(before.elements)
  })

  it('rejects an unknown op as out-of-vocabulary', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'frobnicate' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('out-of-vocabulary')
  })
})

function fixtureWithElements(): TemplateV3 {
  return {
    ...fixture(),
    elements: [
      { id: 'a', type: 'text', content: 'A', level: 'body', priority: 1, region: { col: 1, colSpan: 2, row: 1, rowSpan: 1 } },
      { id: 'b', type: 'text', content: 'B', level: 'body', priority: 2, region: { col: 3, colSpan: 2, row: 1, rowSpan: 1 } },
    ],
  }
}

describe('describeSmartLayout — hardening', () => {
  it('exposes the command catalog, every command carrying a hint', () => {
    const snap = describeSmartLayout(fixture())
    const ops = snap.commands.map(c => c.op)
    expect(ops).toEqual(expect.arrayContaining([
      'setSectionRegion', 'group', 'ungroup', 'applyArchetype', 'setBrand', 'addChildToSection',
      'setText', 'setTextColor', 'setElementStyle', 'setElementProps', 'addElement', 'removeElement', 'reorderElement',
      'setBackground', 'addFormat', 'removeFormat',
      'generateImage', 'removeImageBackground', 'editImage',
      'setSectionProps', 'setGrid', 'setTypeScale',
    ]))
    expect(snap.commands.every(c => typeof c.hint === 'string' && c.hint.length > 0)).toBe(true)
  })

  it('returns copies — mutating a described object never touches the template', () => {
    const t = fixture()
    const snap = describeSmartLayout(t)
    ;(snap.objects[0]!.current as { col: number }).col = 99
    expect(t.sections[0]!.region.col).toBe(1)
  })
})

describe('applySmartLayoutCommand — group / ungroup', () => {
  it('group moves the named elements into a new section', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'group', args: { name: 'Lockup', elementIds: ['a', 'b'] } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.elements.find(e => e.id === 'a')).toBeUndefined()
    expect(r.template.sections.find(s => s.name === 'Lockup')?.children.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('group inverse restores the ungrouped elements and sections', () => {
    const before = fixtureWithElements()
    const r = applySmartLayoutCommand(before, { op: 'group', args: { name: 'Lockup', elementIds: ['a', 'b'] } })
    if (!r.ok) throw new Error('group failed')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('undo failed')
    expect(undo.template.elements.map(e => e.id).sort()).toEqual(['a', 'b'])
    expect(undo.template.sections).toEqual(before.sections)
  })

  it('group does not mutate the input template', () => {
    const before = fixtureWithElements()
    const snapshot = JSON.stringify(before)
    applySmartLayoutCommand(before, { op: 'group', args: { name: 'Lockup', elementIds: ['a', 'b'] } })
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('group with no matching elements is rejected as invalid', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'group', args: { name: 'X', elementIds: ['missing'] } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })

  it('ungroup dissolves a section back into elements', () => {
    const grouped = applySmartLayoutCommand(fixtureWithElements(), { op: 'group', args: { name: 'Lockup', elementIds: ['a', 'b'] } })
    if (!grouped.ok) throw new Error('group failed')
    const secId = grouped.template.sections.find(s => s.name === 'Lockup')!.id
    const r = applySmartLayoutCommand(grouped.template, { op: 'ungroup', args: { sectionId: secId } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.sections.find(s => s.id === secId)).toBeUndefined()
    expect(r.template.elements.map(e => e.id).sort()).toEqual(['a', 'b'])
  })

  it('ungroup of an unknown section is rejected as invalid', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'ungroup', args: { sectionId: 'nope' } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })
})

describe('applySmartLayoutCommand — setBrand', () => {
  it('merges the brand patch', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setBrand', args: { patch: { primary: '#ff0000' } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.brand?.primary).toBe('#ff0000')
  })

  it('inverse restores the previous brand', () => {
    const before = fixture()
    const r = applySmartLayoutCommand(before, { op: 'setBrand', args: { patch: { primary: '#ff0000' } } })
    if (!r.ok) throw new Error('setBrand failed')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('undo failed')
    expect(undo.template.brand).toEqual(before.brand)
  })

  it('missing patch is rejected as invalid', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setBrand', args: {} })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })
})

describe('applySmartLayoutCommand — addChildToSection', () => {
  const child: ElementV2 = {
    id: 'c1', type: 'image', content: '{{ props.image_layer_1 }}', priority: 1,
    region: { col: 1, colSpan: 3, row: 1, rowSpan: 2 },
  }

  it('adds the element into the section children', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'addChildToSection', args: { sectionId: 'section-1', element: { ...child } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.sections.find(s => s.id === 'section-1')?.children.map(c => c.id)).toEqual(['c1'])
  })

  it('inverse removes the added child', () => {
    const before = fixture()
    const r = applySmartLayoutCommand(before, { op: 'addChildToSection', args: { sectionId: 'section-1', element: { ...child } } })
    if (!r.ok) throw new Error('addChild failed')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('undo failed')
    expect(undo.template.sections.find(s => s.id === 'section-1')?.children).toEqual([])
  })

  it('does not mutate the input template', () => {
    const before = fixture()
    const snapshot = JSON.stringify(before)
    applySmartLayoutCommand(before, { op: 'addChildToSection', args: { sectionId: 'section-1', element: { ...child } } })
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('rejects an unknown section as invalid', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'addChildToSection', args: { sectionId: 'nope', element: { ...child } } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })

  it('rejects a missing element as invalid', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'addChildToSection', args: { sectionId: 'section-1' } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })

  it('rejects a malformed element as invalid', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'addChildToSection', args: { sectionId: 'section-1', element: {} } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })
})

describe('applySmartLayoutCommand — setBackground (canvas, not brand)', () => {
  it('sets the document/canvas background fill', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setBackground', args: { fill: '#0000FF' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.background?.fill).toBe('#0000FF')
  })

  it('does not touch the brand background token', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setBackground', args: { fill: '#0000FF' } })
    if (!r.ok) throw new Error('fail')
    expect((r.template.brand as { background?: string } | undefined)?.background).toBeUndefined()
  })

  it('inverse restores the previous background', () => {
    const before = fixture()
    const r = applySmartLayoutCommand(before, { op: 'setBackground', args: { fill: '#0000FF' } })
    if (!r.ok) throw new Error('fail')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.background).toEqual(before.background)
  })

  it('accepts a CSS gradient as the fill (so "pink-orange gradient" is a real gradient, not a photo)', () => {
    const grad = 'linear-gradient(135deg, #FF6EB4, #FF8C42)'
    const r = applySmartLayoutCommand(fixture(), { op: 'setBackground', args: { fill: grad } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.background?.fill).toBe(grad)
  })

  it('accepts an image background and clears it when a fill is later set', () => {
    const withImg = applySmartLayoutCommand(fixture(), { op: 'setBackground', args: { image: '/view?filename=x.png' } })
    expect(withImg.ok).toBe(true)
    if (!withImg.ok) return
    expect(withImg.template.background?.image).toBe('/view?filename=x.png')
    const withFill = applySmartLayoutCommand(withImg.template, { op: 'setBackground', args: { fill: '#000000' } })
    if (!withFill.ok) throw new Error('fail')
    expect(withFill.template.background?.image).toBeUndefined()
    expect(withFill.template.background?.fill).toBe('#000000')
  })

  it('rejects when neither fill nor image is given', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setBackground', args: {} })
    expect(r.ok).toBe(false)
  })
})

describe('applySmartLayoutCommand — setTextColor (the element, not the brand token)', () => {
  it('sets the text element style.color', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setTextColor', target: 'a', args: { color: '#FFFF00' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const el = r.template.elements.find(e => e.id === 'a')
    expect(el && el.type === 'text' ? el.style?.color : null).toBe('#FFFF00')
  })

  it('colours a text element nested in a section', () => {
    const r = applySmartLayoutCommand(fixtureWithSectionText(), { op: 'setTextColor', target: 'h', args: { color: '#FFFF00' } })
    if (!r.ok) throw new Error('fail')
    const el = r.template.sections[0]!.children.find(e => e.id === 'h')
    expect(el && el.type === 'text' ? el.style?.color : null).toBe('#FFFF00')
  })

  it('inverse restores the previous colour', () => {
    const before = fixtureWithElements()
    const r = applySmartLayoutCommand(before, { op: 'setTextColor', target: 'a', args: { color: '#FFFF00' } })
    if (!r.ok) throw new Error('fail')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.elements).toEqual(before.elements)
  })

  it('rejects a non-text element', () => {
    const t = fixtureWithElements()
    t.elements.push({ id: 'img', type: 'image', content: '{{ props.x }}', priority: 3, region: { col: 1, colSpan: 1, row: 2, rowSpan: 1 } })
    const r = applySmartLayoutCommand(t, { op: 'setTextColor', target: 'img', args: { color: '#FFFF00' } })
    expect(r.ok).toBe(false)
  })

  it('rejects a missing colour', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setTextColor', target: 'a', args: {} })
    expect(r.ok).toBe(false)
  })
})

describe('applySmartLayoutCommand — setElementStyle', () => {
  it('sets style keys on a text element', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setElementStyle', target: 'a', args: { patch: { fontWeight: 700, color: '#FF0000' } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const el = r.template.elements.find(e => e.id === 'a')!
    expect(el.type === 'text' ? el.style?.fontWeight : null).toBe(700)
    expect(el.type === 'text' ? el.style?.color : null).toBe('#FF0000')
  })

  it('sets fit on an image element', () => {
    const t = fixtureWithElements()
    t.elements.push({ id: 'img', type: 'image', content: '', priority: 3, region: { col: 1, colSpan: 2, row: 2, rowSpan: 2 } })
    const r = applySmartLayoutCommand(t, { op: 'setElementStyle', target: 'img', args: { patch: { fit: 'contain' } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const el = r.template.elements.find(e => e.id === 'img')!
    expect(el.type === 'image' ? el.style?.fit : null).toBe('contain')
  })

  it('sets fill on a shape element', () => {
    const t = fixtureWithElements()
    t.elements.push({ id: 'sh', type: 'shape', shape: 'rect', priority: 3, region: { col: 1, colSpan: 2, row: 2, rowSpan: 2 } })
    const r = applySmartLayoutCommand(t, { op: 'setElementStyle', target: 'sh', args: { patch: { fill: '#00FF00' } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const el = r.template.elements.find(e => e.id === 'sh')!
    expect(el.type === 'shape' ? el.style?.fill : null).toBe('#00FF00')
  })

  it('reaches a text element inside a section', () => {
    const r = applySmartLayoutCommand(fixtureWithSectionText(), { op: 'setElementStyle', target: 'h', args: { patch: { color: '#123456' } } })
    if (!r.ok) throw new Error('fail')
    const el = r.template.sections[0]!.children.find(e => e.id === 'h')!
    expect(el.type === 'text' ? el.style?.color : null).toBe('#123456')
  })

  it('rejects a style key not valid for the element type', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setElementStyle', target: 'a', args: { patch: { fit: 'cover' } } })
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown element', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setElementStyle', target: 'zzz', args: { patch: { color: '#fff' } } })
    expect(r.ok).toBe(false)
  })

  it('inverse restores the previous style', () => {
    const before = fixtureWithElements()
    const r = applySmartLayoutCommand(before, { op: 'setElementStyle', target: 'a', args: { patch: { color: '#FF0000' } } })
    if (!r.ok) throw new Error('fail')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.elements).toEqual(before.elements)
  })
})

describe('applySmartLayoutCommand — setElementProps', () => {
  it('moves an element to a new region', () => {
    const region = { col: 2, colSpan: 3, row: 4, rowSpan: 2 }
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setElementProps', target: 'a', args: { patch: { region } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.elements.find(e => e.id === 'a')?.region).toEqual(region)
  })

  it('sets priority and hidden', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setElementProps', target: 'a', args: { patch: { priority: 5, hidden: true } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const el = r.template.elements.find(e => e.id === 'a')!
    expect(el.priority).toBe(5)
    expect(el.hidden).toBe(true)
  })

  it('sets a text-only prop (level)', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setElementProps', target: 'a', args: { patch: { level: 'display' } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const el = r.template.elements.find(e => e.id === 'a')!
    expect(el.type === 'text' ? el.level : null).toBe('display')
  })

  it('rejects a prop not valid for the element type (level on shape)', () => {
    const t = fixtureWithElements()
    t.elements.push({ id: 'sh', type: 'shape', shape: 'rect', priority: 3, region: { col: 1, colSpan: 1, row: 2, rowSpan: 1 } })
    const r = applySmartLayoutCommand(t, { op: 'setElementProps', target: 'sh', args: { patch: { level: 'body' } } })
    expect(r.ok).toBe(false)
  })

  it('rejects a malformed region', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setElementProps', target: 'a', args: { patch: { region: { col: 1 } } } })
    expect(r.ok).toBe(false)
  })

  it('inverse restores the previous props', () => {
    const before = fixtureWithElements()
    const r = applySmartLayoutCommand(before, { op: 'setElementProps', target: 'a', args: { patch: { priority: 9 } } })
    if (!r.ok) throw new Error('fail')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.elements).toEqual(before.elements)
  })
})

describe('applySmartLayoutCommand — addElement / removeElement', () => {
  const newText: ElementV2 = { id: 'n1', type: 'text', content: 'Hi', level: 'body', priority: 4, region: { col: 1, colSpan: 2, row: 3, rowSpan: 1 } }

  it('adds a loose element', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'addElement', args: { element: { ...newText } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.elements.some(e => e.id === 'n1')).toBe(true)
  })

  it('rejects a duplicate id', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'addElement', args: { element: { ...newText, id: 'a' } } })
    expect(r.ok).toBe(false)
  })

  it('rejects an element missing required fields', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'addElement', args: { element: { id: 'x', type: 'text' } } })
    expect(r.ok).toBe(false)
  })

  it('add inverse removes the element', () => {
    const before = fixtureWithElements()
    const r = applySmartLayoutCommand(before, { op: 'addElement', args: { element: { ...newText } } })
    if (!r.ok) throw new Error('fail')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.elements).toEqual(before.elements)
  })

  it('removes a loose element', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'removeElement', target: 'a' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.elements.some(e => e.id === 'a')).toBe(false)
  })

  it('removes a section child', () => {
    const r = applySmartLayoutCommand(fixtureWithSectionText(), { op: 'removeElement', target: 'h' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.sections[0]!.children.some(e => e.id === 'h')).toBe(false)
  })

  it('rejects removing an unknown element', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'removeElement', target: 'zzz' })
    expect(r.ok).toBe(false)
  })

  it('remove inverse restores the element', () => {
    const before = fixtureWithElements()
    const r = applySmartLayoutCommand(before, { op: 'removeElement', target: 'a' })
    if (!r.ok) throw new Error('fail')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.elements).toEqual(before.elements)
  })
})

describe('applySmartLayoutCommand — reorderElement (z-order)', () => {
  it('moving up swaps toward the front (later in array)', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'reorderElement', target: 'a', args: { direction: 'up' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.elements.map(e => e.id)).toEqual(['b', 'a'])
  })

  it('moving down swaps toward the back', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'reorderElement', target: 'b', args: { direction: 'down' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.elements.map(e => e.id)).toEqual(['b', 'a'])
  })

  it('rejects moving past the edge', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'reorderElement', target: 'a', args: { direction: 'down' } })
    expect(r.ok).toBe(false)
  })

  it('inverse restores the order', () => {
    const before = fixtureWithElements()
    const r = applySmartLayoutCommand(before, { op: 'reorderElement', target: 'a', args: { direction: 'up' } })
    if (!r.ok) throw new Error('fail')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.elements.map(e => e.id)).toEqual(before.elements.map(e => e.id))
  })
})

describe('applySmartLayoutCommand — addFormat / removeFormat', () => {
  const base = (): TemplateV3 => ({ ...fixture(), outputs: [{ id: 'sq', format: 'sq', label: 'Square' }] })

  it('adds a wide format from the alias "wide"', () => {
    const r = applySmartLayoutCommand(base(), { op: 'addFormat', args: { format: 'wide' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.formats['16x9']).toMatchObject({ w: 1920, h: 1080 })
    expect((r.template.outputs ?? []).some(o => o.format === '16x9')).toBe(true)
  })

  it('adds by preset key (9x16)', () => {
    const r = applySmartLayoutCommand(base(), { op: 'addFormat', args: { format: '9x16' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.formats['9x16']).toBeTruthy()
  })

  it('keeps existing formats/outputs when adding', () => {
    const r = applySmartLayoutCommand(base(), { op: 'addFormat', args: { format: 'story' } })
    if (!r.ok) throw new Error('fail')
    expect(r.template.formats.sq).toBeTruthy()
    expect((r.template.outputs ?? []).some(o => o.format === 'sq')).toBe(true)
  })

  it('rejects an unknown format', () => {
    const r = applySmartLayoutCommand(base(), { op: 'addFormat', args: { format: 'banana' } })
    expect(r.ok).toBe(false)
  })

  it('add inverse restores formats and outputs', () => {
    const before = base()
    const r = applySmartLayoutCommand(before, { op: 'addFormat', args: { format: 'wide' } })
    if (!r.ok) throw new Error('fail')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.formats).toEqual(before.formats)
    expect(undo.template.outputs).toEqual(before.outputs)
  })

  it('removes a non-master format', () => {
    const added = applySmartLayoutCommand(base(), { op: 'addFormat', args: { format: 'wide' } })
    if (!added.ok) throw new Error('fail')
    const r = applySmartLayoutCommand(added.template, { op: 'removeFormat', args: { format: 'wide' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.formats['16x9']).toBeUndefined()
    expect((r.template.outputs ?? []).some(o => o.format === '16x9')).toBe(false)
  })

  it('refuses to remove the master format', () => {
    const r = applySmartLayoutCommand(base(), { op: 'removeFormat', args: { format: 'sq' } })
    expect(r.ok).toBe(false)
  })
})

describe('applySmartLayoutCommand — Tier 2 verbs (section / grid / type scale)', () => {
  it('setSectionProps hides a section', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setSectionProps', target: 'section-1', args: { patch: { hidden: true } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.sections.find(s => s.id === 'section-1')?.hidden).toBe(true)
  })

  it('setSectionProps rejects an unknown key', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setSectionProps', target: 'section-1', args: { patch: { color: '#fff' } } })
    expect(r.ok).toBe(false)
  })

  it('setGrid updates spacing and inverts cleanly', () => {
    const before = fixture()
    const r = applySmartLayoutCommand(before, { op: 'setGrid', args: { patch: { gutter: 40, margin: 80 } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.grid.gutter).toBe(40)
    expect(r.template.grid.margin).toBe(80)
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.grid).toEqual(before.grid)
  })

  it('setGrid rejects a non-numeric value', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setGrid', args: { patch: { gutter: 'wide' } } })
    expect(r.ok).toBe(false)
  })

  it('setTypeScale updates the ratio', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'setTypeScale', args: { patch: { ratio: 1.5 } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template.typeScale.ratio).toBe(1.5)
  })
})

describe('applySmartLayoutCommand — renderer-capability coverage (gradients, brand tokens)', () => {
  it('setElementStyle accepts a CSS gradient on a shape fill', () => {
    const t = fixtureWithElements()
    t.elements.push({ id: 'sh', type: 'shape', shape: 'rect', priority: 3, region: { col: 1, colSpan: 2, row: 2, rowSpan: 2 } })
    const grad = 'linear-gradient(135deg, #FF6EB4, #FF8C42)'
    const r = applySmartLayoutCommand(t, { op: 'setElementStyle', target: 'sh', args: { patch: { fill: grad } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const el = r.template.elements.find(e => e.id === 'sh')!
    expect(el.type === 'shape' ? el.style?.fill : null).toBe(grad)
  })

  it('setTextColor accepts a brand token (binds the colour to the kit)', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setTextColor', target: 'a', args: { color: '{{ brand.primary }}' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const el = r.template.elements.find(e => e.id === 'a')!
    expect(el.type === 'text' ? el.style?.color : null).toBe('{{ brand.primary }}')
  })
})

describe('describeSmartLayout — document', () => {
  it('exposes the current formats so the agent knows what exists', () => {
    const snap = describeSmartLayout(fixture())
    const doc = snap.objects.find(o => o.type === 'document')
    expect(doc).toBeTruthy()
    expect((doc!.current as { formats: string[] }).formats).toContain('sq')
  })

  it('exposes the master fine-grid size so the agent can span the full canvas', () => {
    const snap = describeSmartLayout(fixture())
    const doc = snap.objects.find(o => o.type === 'document')
    const grid = (doc!.current as { grid?: { cols: number; rows: number } }).grid
    expect(grid).toBeTruthy()
    expect(grid!.cols).toBeGreaterThan(1)
    expect(grid!.rows).toBeGreaterThan(1)
  })

  it('exposes the brand kit values and the variable slots in use', () => {
    const t = { ...fixture(), brand: { primary: '#0057FF', fontDisplay: 'Anton' } }
    t.elements.push({ id: 'p', type: 'image', content: '{{ props.hero_image }}', priority: 1, region: { col: 1, colSpan: 2, row: 1, rowSpan: 1 } })
    const doc = describeSmartLayout(t).objects.find(o => o.type === 'document')!
    const cur = doc.current as { brand?: Record<string, string>; props?: string[] }
    expect(cur.brand?.primary).toBe('#0057FF')
    expect(cur.props).toContain('hero_image')
  })
})

describe('describeSmartLayout — element detail', () => {
  it('exposes each element with its content and region', () => {
    const snap = describeSmartLayout(fixtureWithElements())
    const a = snap.objects.find(o => o.id === 'a')!
    expect(a.current).toMatchObject({ content: 'A', region: { col: 1, colSpan: 2, row: 1, rowSpan: 1 } })
  })
})

describe('summarizeSmartLayoutChange', () => {
  function withText(): TemplateV3 {
    return {
      ...fixture(),
      sections: [{
        id: 'section-1', name: 'Hero', region: { col: 1, colSpan: 6, row: 1, rowSpan: 3 },
        children: [{ id: 'h', type: 'text', content: 'OLD', level: 'headline', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 1 } }],
      }],
    }
  }

  it('summarizes a setText change with before/after content', () => {
    const s = summarizeSmartLayoutChange(withText(), { op: 'setText', target: 'h', args: { text: 'NEW' } })
    expect(s?.before).toBe('OLD')
    expect(s?.after).toBe('NEW')
    expect(typeof s?.label).toBe('string')
    expect((s?.label ?? '').length).toBeGreaterThan(0)
  })

  it('summarizes a setSectionRegion change with row before/after', () => {
    const s = summarizeSmartLayoutChange(fixture(), { op: 'setSectionRegion', target: 'section-1', args: { region: { col: 1, colSpan: 6, row: 5, rowSpan: 1 } } })
    expect(s?.before).toContain('row 1')
    expect(s?.after).toContain('row 5')
  })
})

function fixtureTwoSections(): TemplateV3 {
  return {
    ...fixture(),
    sections: [
      { id: 'section-1', name: 'Hero', region: { col: 1, colSpan: 6, row: 1, rowSpan: 3 }, children: [] },
      { id: 'section-2', name: 'Footer', region: { col: 1, colSpan: 6, row: 5, rowSpan: 1 }, children: [] },
    ],
  }
}

describe('applySmartLayoutCommand — output independence (no shared refs with input)', () => {
  it('mutating a non-target section in the result never touches the input', () => {
    const before = fixtureTwoSections()
    const r = applySmartLayoutCommand(before, {
      op: 'setSectionRegion', target: 'section-1', args: { region: { col: 2, colSpan: 2, row: 2, rowSpan: 2 } },
    })
    if (!r.ok) throw new Error('setSectionRegion failed')
    r.template.sections.find(s => s.id === 'section-2')!.region.col = 99
    expect(before.sections.find(s => s.id === 'section-2')!.region.col).toBe(1)
  })

  it('mutating the result\'s elements never touches the input', () => {
    const before = fixtureWithElements()
    const r = applySmartLayoutCommand(before, { op: 'setBrand', args: { patch: { primary: '#ff0000' } } })
    if (!r.ok) throw new Error('setBrand failed')
    r.template.elements.push({ id: 'x', type: 'text', content: 'X', level: 'body', priority: 9, region: { col: 1, colSpan: 1, row: 1, rowSpan: 1 } })
    expect(before.elements.map(e => e.id)).toEqual(['a', 'b'])
  })
})

describe('applySmartLayoutCommand — stricter validation', () => {
  it('group rejects when any element id is missing', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'group', args: { name: 'X', elementIds: ['a', 'missing'] } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })

  it('ungroup rejects a section with no children', () => {
    const r = applySmartLayoutCommand(fixture(), { op: 'ungroup', args: { sectionId: 'section-1' } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })
})

function contentOf(t: TemplateV3, id: string): unknown {
  const el = t.elements.find(e => e.id === id) ?? t.sections.flatMap(s => s.children).find(e => e.id === id)
  return el && 'content' in el ? (el as { content: unknown }).content : undefined
}

function fixtureWithSectionText(): TemplateV3 {
  return {
    ...fixture(),
    sections: [{
      id: 'section-1', name: 'Hero', region: { col: 1, colSpan: 6, row: 1, rowSpan: 3 },
      children: [{ id: 'h', type: 'text', content: 'OLD', level: 'headline', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 1 } }],
    }],
  }
}

describe('describeSmartLayout — elements', () => {
  it('lists elements with their current content so the agent can see the copy', () => {
    const snap = describeSmartLayout(fixtureWithSectionText())
    const headline = snap.objects.find(o => o.id === 'h')
    expect(headline?.type).toBe('text')
    expect(headline?.current).toMatchObject({ content: 'OLD' })
  })
})

describe('applySmartLayoutCommand — setText', () => {
  it('sets the content of an ungrouped element', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setText', target: 'a', args: { text: 'NEW' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(contentOf(r.template, 'a')).toBe('NEW')
  })

  it('sets the content of an element inside a section', () => {
    const r = applySmartLayoutCommand(fixtureWithSectionText(), { op: 'setText', target: 'h', args: { text: 'SUMMER SALE' } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(contentOf(r.template, 'h')).toBe('SUMMER SALE')
  })

  it('inverse restores the previous content', () => {
    const before = fixtureWithSectionText()
    const r = applySmartLayoutCommand(before, { op: 'setText', target: 'h', args: { text: 'SUMMER SALE' } })
    if (!r.ok) throw new Error('setText failed')
    const undo = applySmartLayoutCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('undo failed')
    expect(contentOf(undo.template, 'h')).toBe('OLD')
  })

  it('does not mutate the input template', () => {
    const before = fixtureWithSectionText()
    const snap = JSON.stringify(before)
    applySmartLayoutCommand(before, { op: 'setText', target: 'h', args: { text: 'X' } })
    expect(JSON.stringify(before)).toBe(snap)
  })

  it('rejects setting text on a non-text element', () => {
    const t: TemplateV3 = {
      ...fixture(),
      sections: [{
        id: 'section-1', name: 'Hero', region: { col: 1, colSpan: 6, row: 1, rowSpan: 3 },
        children: [{ id: 'img', type: 'image', content: '{{ props.image_layer_1 }}', priority: 1, region: { col: 1, colSpan: 2, row: 1, rowSpan: 1 } }],
      }],
    }
    const r = applySmartLayoutCommand(t, { op: 'setText', target: 'img', args: { text: 'nope' } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })

  it('rejects an unknown element id', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setText', target: 'ghost', args: { text: 'x' } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })

  it('rejects missing text', () => {
    const r = applySmartLayoutCommand(fixtureWithElements(), { op: 'setText', target: 'a', args: {} })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid')
  })

  it('describe lists setText with a hint', () => {
    const spec = describeSmartLayout(fixture()).commands.find(c => c.op === 'setText')
    expect(spec).toBeDefined()
    expect(typeof spec?.hint).toBe('string')
  })
})

describe('applySmartLayoutCommand — double undo', () => {
  it('undo of undo reproduces the applied state (group)', () => {
    const original = fixtureWithElements()
    const r1 = applySmartLayoutCommand(original, { op: 'group', args: { name: 'G', elementIds: ['a', 'b'] } })
    if (!r1.ok) throw new Error('group failed')
    const r2 = applySmartLayoutCommand(r1.template, r1.inverse)
    if (!r2.ok) throw new Error('undo failed')
    const r3 = applySmartLayoutCommand(r2.template, r2.inverse)
    if (!r3.ok) throw new Error('undo-of-undo failed')
    expect(r3.template.sections.length).toBe(r1.template.sections.length)
    expect(r3.template.elements.map(e => e.id).sort()).toEqual(r1.template.elements.map(e => e.id).sort())
  })
})
