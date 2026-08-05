import { describe, it, expect } from 'vitest'
import { POST_EFFECTS, POST_CHAIN_ORDER } from '~/lib/studio/post/manifest'
import { postControls, POST_SECTIONS } from '~/lib/studio/post/controls'
import { DEFAULT_POST } from '~/lib/studio/post/settings'
import { groupIntoSections } from '~/lib/studio/sections'

describe('post manifest', () => {
  it('declares the twelve effects', () => {
    expect(POST_EFFECTS).toHaveLength(12)
  })

  it('orders every effect exactly once in the chain', () => {
    expect([...POST_CHAIN_ORDER].sort()).toEqual(POST_EFFECTS.map(e => e.id).sort())
  })

  it('points every param at a real PostSettings key', () => {
    for (const e of POST_EFFECTS) {
      expect(DEFAULT_POST).toHaveProperty(e.enableKey)
      for (const p of e.params) expect(DEFAULT_POST).toHaveProperty(p.settingsKey)
    }
  })
})

describe('derived post controls', () => {
  it('emits a switch per effect plus a slider per param', () => {
    const cs = postControls({ threeD: true })
    const bloomSwitch = cs.find(c => c.key === 'post.bloom')
    expect(bloomSwitch?.kind).toBe('switch')
    const strength = cs.find(c => c.key === 'post.bloomStrength')
    expect(strength?.kind).toBe('slider')
    // A param sits in its effect's own nested section, alongside the switch that
    // heads it — 'Effects/Bloom', not the parent 'Effects'.
    expect(bloomSwitch?.group).toBe('Effects/Bloom')
    expect(strength?.group).toBe('Effects/Bloom')
    expect((bloomSwitch as { sectionToggle?: boolean }).sectionToggle).toBe(true)
  })

  it('withholds ambient occlusion from non-3D hosts', () => {
    const flat = postControls({ threeD: false }).map(c => c.key)
    expect(flat).not.toContain('post.gtao')
    expect(flat.some(k => k.startsWith('post.gtao'))).toBe(false)
    expect(postControls({ threeD: true }).map(c => c.key)).toContain('post.gtao')
  })

  it('drops halftoneScatter (uniform: null) for a flat host — nothing to bind on 2D — but keeps it for 3D', () => {
    expect(postControls({ threeD: false }).map(c => c.key)).not.toContain('post.halftoneScatter')
    expect(postControls({ threeD: true }).map(c => c.key)).toContain('post.halftoneScatter')
  })

  it('defaults each control to the DEFAULT_POST value', () => {
    for (const c of postControls({ threeD: true })) {
      const key = c.key.slice('post.'.length) as keyof typeof DEFAULT_POST
      expect(c.default).toEqual(DEFAULT_POST[key])
    }
  })
})

// The panel's shape, not just its contents. Two earlier shapes were wrong in
// opposite directions: a section per effect at TOP level gave twelve one-row cards,
// and one flat section ran 32 rows together with no visible owner per slider.
describe('post panel shape', () => {
  // Panel order is POST_EFFECTS declaration order, NOT POST_CHAIN_ORDER. They are
  // different jobs: the chain order is a pipeline fact (grade before glow before
  // grain), while this is a reading order, and it deliberately follows 3D Studio's
  // — Bloom, Color, Chroma, blur, Film, Halftone, Dot screen, Glitch — with the
  // three effects 3D Studio lacks slotted in where they belong by kind.
  it('is ONE section, holding a nested section per effect, in declaration order', () => {
    const sections = groupIntoSections(postControls(), POST_SECTIONS)
    expect(sections.map(s => s.title)).toEqual(['Effects'])
    expect(sections[0]!.controls).toEqual([])          // the parent is a container only
    expect(sections[0]!.sections.map(s => s.title)).toEqual([
      'Bloom', 'Color', 'Duotone', 'Chroma', 'Blur', 'Film',
      'Halftone', 'Dot screen', 'Glitch', 'Grain', 'Vignette',
    ])
  })

  // Each effect's card: its switch heads it, its params are the body.
  it('heads each effect section with exactly one sectionToggle switch', () => {
    const [effects] = groupIntoSections(postControls(), POST_SECTIONS)
    for (const s of effects!.sections) {
      const toggles = s.controls.filter(c => c.sectionToggle)
      expect(toggles).toHaveLength(1)
      expect(toggles[0]!.kind).toBe('switch')
      expect(toggles[0]!.label).toBe(s.title)
      // Everything else in the card belongs to that effect.
      expect(s.controls.filter(c => !c.sectionToggle).every(c => c.kind !== 'switch')).toBe(true)
    }
  })

  // The chevron is the reveal now, not showIf — that is what lets you open a disabled
  // effect and dial it in before switching it on.
  it('leaves params free of showIf so a disabled effect can still be opened', () => {
    for (const c of postControls({ threeD: true })) {
      expect((c as { showIf?: unknown }).showIf).toBeUndefined()
    }
  })

  // With one shared section the label is the ONLY thing separating two "Amount"
  // sliders — in the panel, in the agent's vocabulary, and in motion's track list.
  // This is why manifest labels are qualified ("Bloom strength", not "Strength").
  it('gives every control a distinct label', () => {
    for (const threeD of [false, true]) {
      const labels = postControls({ threeD }).map(c => c.label)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })
})

// Controls are opt-OUT: a thirteenth effect silently grants itself agent access
// and motion targets. Freeze the derived set so that shows up in review.
describe('derived control surface', () => {
  it('matches the frozen snapshot', () => {
    expect(postControls({ threeD: true }).map(c => `${c.kind} ${c.key}`).sort()).toMatchSnapshot()
  })
})
