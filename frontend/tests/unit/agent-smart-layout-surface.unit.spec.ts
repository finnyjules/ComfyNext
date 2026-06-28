import { describe, it, expect } from 'vitest'
import type { ElementV2, TemplateV3 } from '~~/shared/template-grid/types'
import { describeSmartLayout, applySmartLayoutCommand } from '~/lib/agent/surfaces/smartLayout'

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
    expect(headline?.current).toBe('OLD')
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
