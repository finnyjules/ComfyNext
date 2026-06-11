import { describe, expect, it } from 'vitest'
import { resolveFormat } from '~~/shared/template-grid/resolve'
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
})
