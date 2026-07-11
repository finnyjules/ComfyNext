import { describe, expect, it } from 'vitest'
import { deriveOutputs, resolveFormat } from '~~/shared/template-grid/resolve'
import type { TemplateV2 } from '~~/shared/template-grid/types'

function fixture(): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: {
      '1x1':     { w: 1080, h: 1080 },
      '9x16':    { w: 1080, h: 1920 },
      '728x90':  { w: 728, h: 90 },
      '320x50':  { w: 320, h: 50 },
      '160x600': { w: 160, h: 600 },
    },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    background: { fill: '#0a0a0a' },
    elements: [
      { id: 'hero', type: 'image', content: '{{ props.image_layer_1 }}', priority: 4,
        region: { col: 1, colSpan: 6, row: 1, rowSpan: 6 } },
      { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
        region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 } },
      { id: 'subhead', type: 'text', content: 'Single-origin espresso', level: 'subhead', priority: 5,
        region: { col: 1, colSpan: 4, row: 6, rowSpan: 1 } },
      { id: 'cta', type: 'text', content: 'Shop now', level: 'caption', role: 'CTA', priority: 2,
        region: { col: 5, colSpan: 2, row: 6, rowSpan: 1 } },
      { id: 'logo', type: 'image', content: '{{ brand.logo }}', role: 'LOGO', priority: 3, collapse: 'mark',
        region: { col: 1, colSpan: 2, row: 1, rowSpan: 1 } },
    ],
  }
}

describe('resolveFormat', () => {
  it('resolves the master format with no surprises', () => {
    const r = resolveFormat(fixture(), '1x1', { text_layer_1: 'Brew bold' })
    expect(r.formatClass).toBe('square')
    expect(r.elements).toHaveLength(5)
    const headline = r.elements.find(e => e.el.id === 'headline')!
    expect(headline.culled).toBe(false)
    expect(headline.text!.content).toBe('Brew bold')
    expect(headline.text!.fontSize).toBeGreaterThan(50)
  })
  it('bleed:true on a full-grid image covers the whole canvas', () => {
    const t = fixture()
    ;(t.elements[0] as any).bleed = true   // hero, col1 colSpan6 row1 rowSpan6
    const r = resolveFormat(t, '1x1', { image_layer_1: 'http://x/i.png' })
    const hero = r.elements.find(e => e.el.id === 'hero')!
    expect(hero.rect).toEqual({ x: 0, y: 0, w: 1080, h: 1080 })
  })

  it('bleed:false (default) keeps the image inside the margin', () => {
    const t = fixture()
    const r = resolveFormat(t, '1x1', { image_layer_1: 'http://x/i.png' })
    const hero = r.elements.find(e => e.el.id === 'hero')!
    expect(hero.rect.x).toBeGreaterThan(0)        // margin respected
    expect(hero.rect.x + hero.rect.w).toBeLessThan(1080)
  })

  it('a half-grid bleed extends to canvas on its outer sides only', () => {
    const t = fixture()
    ;(t.elements[0] as any).region = { col: 1, colSpan: 3, row: 1, rowSpan: 6 }
    ;(t.elements[0] as any).bleed = true
    const r = resolveFormat(t, '1x1', { image_layer_1: 'http://x/i.png' })
    const hero = r.elements.find(e => e.el.id === 'hero')!
    expect(hero.rect.x).toBe(0)                          // bleeds left
    expect(hero.rect.y).toBe(0)                          // bleeds top
    expect(hero.rect.h).toBe(1080)                       // bleeds bottom (full height)
    expect(hero.rect.x + hero.rect.w).toBeLessThan(1080) // keeps grid line on the right
  })

  it('text bleed extends the container but text still wraps within the margin box', () => {
    const t = fixture()
    ;(t.elements[1] as any).bleed = true
    ;(t.elements[1] as any).style = { fontSize: 80 }
    const longCopy = 'one two three four five six seven eight nine ten eleven'
    const baselineLines = resolveFormat(fixture(), '1x1', { text_layer_1: longCopy })
      .elements.find(e => e.el.id === 'headline')!.text!.lines.length
    const bled = resolveFormat(t, '1x1', { text_layer_1: longCopy })
      .elements.find(e => e.el.id === 'headline')!
    // Same wrap (text uses the un-bled width); container bleeds to canvas.
    expect(bled.text!.lines.length).toBe(baselineLines)
    expect(bled.rect.x).toBe(0)
    expect(bled.rect.x + bled.rect.w).toBe(1080)
  })

  it('honours an explicit style.fontSize exactly on the master (no auto-shrink)', () => {
    const t = fixture()
    ;(t.elements[1] as any).style = { fontSize: 300 }   // headline, master 1x1
    const r = resolveFormat(t, '1x1', { text_layer_1: 'Headline goes here' })
    const headline = r.elements.find(e => e.el.id === 'headline')!
    expect(headline.text!.fontSize).toBe(300)            // exactly what was typed
  })

  it('still auto-shrinks level-derived sizes to fit', () => {
    const t = fixture()
    // very long copy, no explicit size → shrinks below the display size
    const r = resolveFormat(t, '1x1', { text_layer_1: 'word '.repeat(60).trim() })
    const headline = r.elements.find(e => e.el.id === 'headline')!
    const displayMax = Math.round(28 * 1.414 ** 4)
    expect(headline.text!.fontSize).toBeLessThan(displayMax)
  })

  it('keeps template order for z, assigns slots by priority', () => {
    const r = resolveFormat(fixture(), '728x90', { text_layer_1: 'Brew bold' })
    expect(r.elements.map(e => e.el.id)).toEqual(['hero', 'headline', 'subhead', 'cta', 'logo'])
  })
  it('culls the subhead on strips and places the rest', () => {
    const r = resolveFormat(fixture(), '728x90', { text_layer_1: 'Brew bold' })
    const byId = Object.fromEntries(r.elements.map(e => [e.el.id, e]))
    expect(byId.subhead.culled).toBe(true)
    expect(byId.subhead.cullReason).toBe('no-slot')
    expect(byId.headline.culled).toBe(false)
    expect(byId.cta.culled).toBe(false)
    expect(byId.logo.culled).toBe(false)
  })
  it('collapse:mark renders as a centered square instead of culling', () => {
    const r = resolveFormat(fixture(), '728x90', {})
    const logo = r.elements.find(e => e.el.id === 'logo')!
    expect(logo.mark).toBe(true)
    expect(logo.rect.w).toBeCloseTo(logo.rect.h, 5)
  })
  it('remaps square→portrait proportionally', () => {
    const r = resolveFormat(fixture(), '9x16', { text_layer_1: 'Brew bold' })
    const headline = r.elements.find(e => e.el.id === 'headline')!
    expect(headline.culled).toBe(false)
    expect(headline.region).toEqual({ col: 1, colSpan: 4, row: 5, rowSpan: 3 })
  })
  it('respects regionByClass over defaults', () => {
    const t = fixture()
    ;(t.elements[2] as any).regionByClass = { strip: { col: 9, colSpan: 4, row: 1, rowSpan: 1 } }
    const r = resolveFormat(t, '728x90', {})
    const subhead = r.elements.find(e => e.el.id === 'subhead')!
    expect(subhead.culled).toBe(false)
  })
  it('grow extends the region downward for long copy', () => {
    const t = fixture()
    ;(t.elements[1] as any).overflow = 'grow'
    const long = 'a very long headline that absolutely will not fit in two rows '.repeat(6)
    const grown = resolveFormat(t, '1x1', { text_layer_1: long })
      .elements.find(e => e.el.id === 'headline')!
    const normal = resolveFormat(fixture(), '1x1', { text_layer_1: long })
      .elements.find(e => e.el.id === 'headline')!
    expect(grown.rect.h).toBeGreaterThan(normal.rect.h)
  })
  it('throws on unknown format keys', () => {
    expect(() => resolveFormat(fixture(), 'nope')).toThrow(/Unknown format/)
  })

  // -- Per-output overrides (variations of the same format) -------------------

  it('two outputs of the same format diverge via per-output region overrides', () => {
    const t = fixture()
    // headline has a per-output override only for output 'sq2'
    ;(t.elements[1] as any).overrides = { sq2: { region: { col: 1, colSpan: 2, row: 1, rowSpan: 1 } } }
    const base = resolveFormat(t, '1x1', { text_layer_1: 'Hi' }, {}, { outputId: 'sq1' })
      .elements.find(e => e.el.id === 'headline')!
    const variant = resolveFormat(t, '1x1', { text_layer_1: 'Hi' }, {}, { outputId: 'sq2' })
      .elements.find(e => e.el.id === 'headline')!
    // sq1 keeps the base region (row 4); sq2 uses the override (row 1)
    expect(base.region).toEqual({ col: 1, colSpan: 6, row: 4, rowSpan: 2 })
    expect(variant.region).toEqual({ col: 1, colSpan: 2, row: 1, rowSpan: 1 })
  })

  it('per-output hidden culls in only that output', () => {
    const t = fixture()
    ;(t.elements[3] as any).overrides = { sqB: { hidden: true } }   // cta hidden in sqB only
    const a = resolveFormat(t, '1x1', {}, {}, { outputId: 'sqA' }).elements.find(e => e.el.id === 'cta')!
    const b = resolveFormat(t, '1x1', {}, {}, { outputId: 'sqB' }).elements.find(e => e.el.id === 'cta')!
    expect(a.culled).toBe(false)
    expect(b.culled).toBe(true)
    expect(b.cullReason).toBe('hidden')
  })

  it('outputId falls back to the format key (pre-outputs overrides still work)', () => {
    const t = fixture()
    ;(t.elements[1] as any).overrides = { '1x1': { region: { col: 2, colSpan: 2, row: 2, rowSpan: 1 } } }
    // No outputId → oid defaults to formatKey '1x1' → the legacy override applies
    const r = resolveFormat(t, '1x1', { text_layer_1: 'Hi' }).elements.find(e => e.el.id === 'headline')!
    expect(r.region).toEqual({ col: 2, colSpan: 2, row: 2, rowSpan: 1 })
  })

  describe('deriveOutputs', () => {
    it('uses explicit template.outputs when present', () => {
      const t = { ...fixture(), outputs: [{ id: 'a', format: '1x1', label: 'A' }, { id: 'b', format: '1x1', label: 'B' }] }
      expect(deriveOutputs(t).map(o => o.id)).toEqual(['a', 'b'])
    })
    it('derives one output per aspect key (id === format) when no outputs', () => {
      const out = deriveOutputs(fixture(), '1x1,9x16,728x90')
      expect(out).toEqual([
        { id: '1x1', format: '1x1', label: undefined },
        { id: '9x16', format: '9x16', label: undefined },
        { id: '728x90', format: '728x90', label: undefined },
      ])
    })
    it('falls back to the master when aspects is empty/unknown', () => {
      expect(deriveOutputs(fixture(), '').map(o => o.format)).toEqual(['1x1'])
      expect(deriveOutputs(fixture(), 'bogus').map(o => o.format)).toEqual(['1x1'])
    })
  })

  it('style.fontSize overrides the level size but still scales per format', () => {
    const t = fixture()
    ;(t.elements[1] as any).style = { fontSize: 60 }
    const master = resolveFormat(t, '1x1', { text_layer_1: 'Hi' })
      .elements.find(e => e.el.id === 'headline')!
    expect(master.text!.fontSize).toBe(60)
    // 728x90: 60 × (90/1080) × 3 = 15
    const strip = resolveFormat(t, '728x90', { text_layer_1: 'Hi' })
      .elements.find(e => e.el.id === 'headline')!
    expect(strip.text!.fontSize).toBe(15)
  })

  it('style.transform uppercases the resolved content before fitting', () => {
    const t = fixture()
    ;(t.elements[1] as any).style = { transform: 'uppercase' }
    const r = resolveFormat(t, '1x1', { text_layer_1: 'Brew bold' })
      .elements.find(e => e.el.id === 'headline')!
    expect(r.text!.content).toBe('BREW BOLD')
  })

  describe('per-output content override (outpaint)', () => {
    it('swaps the image content for the overridden output only', () => {
      const t = fixture()
      ;(t.elements[0] as any).overrides = { '9x16': { content: '/view?filename=outpaint.png' } }
      const wide = resolveFormat(t, '9x16', { image_layer_1: 'http://x/orig.png' })
        .elements.find(e => e.el.id === 'hero')!
      expect(wide.el.content).toBe('/view?filename=outpaint.png')
      // A different format keeps the original source, unaffected.
      const square = resolveFormat(t, '1x1', { image_layer_1: 'http://x/orig.png' })
        .elements.find(e => e.el.id === 'hero')!
      expect(square.el.content).toBe('{{ props.image_layer_1 }}')
    })

    it('leaves other props (id, style, region) intact on the override clone', () => {
      const t = fixture()
      ;(t.elements[0] as any).overrides = { '1x1': { content: '/view?filename=op.png' } }
      const hero = resolveFormat(t, '1x1', { image_layer_1: 'http://x/orig.png' })
        .elements.find(e => e.el.id === 'hero')!
      expect(hero.el.id).toBe('hero')
      expect(hero.el.type).toBe('image')
      expect(hero.culled).toBe(false)
    })

    it('no override → resolved element is unchanged', () => {
      const hero = resolveFormat(fixture(), '1x1', { image_layer_1: 'http://x/orig.png' })
        .elements.find(e => e.el.id === 'hero')!
      expect(hero.el.content).toBe('{{ props.image_layer_1 }}')
    })
  })
})
