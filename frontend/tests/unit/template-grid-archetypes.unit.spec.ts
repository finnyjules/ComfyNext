import { describe, expect, it } from 'vitest'
import { ARCHETYPES, applyArchetype } from '~~/shared/template-grid/archetypes'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'

describe('archetypes', () => {
  it('ships the four curated starting points', () => {
    expect(ARCHETYPES.map(a => a.id).sort()).toEqual(
      ['editorial', 'hero-band', 'split', 'type-poster'],
    )
  })

  it('applyArchetype keeps the format matrix + grid, swaps elements', () => {
    const base = makeStarterTemplate('keep-me')
    const out = applyArchetype(base, ARCHETYPES[0])
    expect(out.id).toBe('keep-me')                       // identity preserved
    expect(Object.keys(out.formats)).toEqual(Object.keys(base.formats))   // all ad sizes
    expect(out.grid).toEqual(base.grid)
    expect(out.elements.length).toBeGreaterThan(0)
    // not aliased to the archetype's own array
    expect(out.elements).not.toBe(ARCHETYPES[0].elements)
  })

  it("the user's brand wins over the archetype defaults", () => {
    const base = { ...makeStarterTemplate('b'), brand: { primary: '#123456' } }
    const out = applyArchetype(base, ARCHETYPES[0])
    expect(out.brand!.primary).toBe('#123456')           // user override kept
    expect(out.brand!.foreground).toBe('#FFFFFF')         // archetype default filled in
  })

  it('every archetype renders something on the square master (not all culled)', () => {
    for (const arch of ARCHETYPES) {
      const tpl = applyArchetype(makeStarterTemplate(arch.id), arch)
      const r = resolveFormat(tpl, '1x1',
        { text_layer_1: 'Headline', text_layer_2: 'Subhead', image_layer_1: 'http://x/i.png' })
      const visible = r.elements.filter(e => !e.culled)
      expect(visible.length, `${arch.id} should place elements`).toBeGreaterThan(2)
    }
  })

  it('every archetype survives reflow to a strip format', () => {
    for (const arch of ARCHETYPES) {
      const tpl = applyArchetype(makeStarterTemplate(arch.id), arch)
      // 728x90 is a strip; must not throw and must keep the headline.
      const r = resolveFormat(tpl, '728x90', { text_layer_1: 'Headline' })
      const headline = r.elements.find(e => e.el.id === 'headline')
      expect(headline, `${arch.id} headline`).toBeTruthy()
      expect(headline!.culled, `${arch.id} headline survives strip`).toBe(false)
    }
  })
})
