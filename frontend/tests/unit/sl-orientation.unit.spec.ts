import { describe, expect, it } from 'vitest'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import { isVerticalTextStyle } from '~~/shared/template-grid/types'
import type { GridExpressiveParams, TemplateV2, TemplateV3, TextElementV2 } from '~~/shared/template-grid/types'

// A TALL narrow region (1 col × 5 rows on the square master's 6x6 grid) — a
// vertical title running up the edge: 136px wide, 776px tall. Long enough
// copy that horizontal flow (2-3 chars per line at 136px) needs a heavy
// shrink to fit its many lines within the 776px budget, while vertical
// (swapped: 776px "line length" / 136px stacking budget) needs far less.
function fixture(orientation?: 'horizontal' | 'up' | 'down'): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      {
        id: 'title', type: 'text', content: 'Artisan Roasted Coffee Beans From The Highlands',
        level: 'display', priority: 1,
        region: { col: 1, colSpan: 1, row: 1, rowSpan: 5 },
        ...(orientation ? { style: { orientation } } : {}),
      },
    ],
  }
}

describe('resolveFormat: text orientation', () => {
  it('vertical "up" carries rotation: -90 on the resolved entry', () => {
    const r = resolveFormat(fixture('up'), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.culled).toBe(false)
    expect(title.rotation).toBe(-90)
  })

  it('vertical "down" carries rotation: 90 on the resolved entry', () => {
    const r = resolveFormat(fixture('down'), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.rotation).toBe(90)
  })

  it('default/horizontal orientation leaves rotation undefined', () => {
    const r = resolveFormat(fixture(), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.rotation).toBeUndefined()
  })

  it('the element rect stays the region rect (unswapped) — rotation is around center', () => {
    const control = resolveFormat(fixture(), '1x1')
    const vertical = resolveFormat(fixture('up'), '1x1')
    const controlEl = control.elements.find(e => e.el.id === 'title')!
    const verticalEl = vertical.elements.find(e => e.el.id === 'title')!
    expect(verticalEl.rect).toEqual(controlEl.rect)
  })

  it('vertical text fits a LARGER font than horizontal in the same tall narrow region — the fit used the swapped axis', () => {
    const horizontal = resolveFormat(fixture(), '1x1')
    const vertical = resolveFormat(fixture('up'), '1x1')
    const hEl = horizontal.elements.find(e => e.el.id === 'title')!
    const vEl = vertical.elements.find(e => e.el.id === 'title')!
    expect(hEl.culled).toBe(false)
    expect(vEl.culled).toBe(false)
    expect(vEl.text!.fontSize).toBeGreaterThan(hEl.text!.fontSize)
  })

  it('horizontal (default) resolve is byte-identical to a template with no style at all — no behaviour change', () => {
    const strip = (r: ReturnType<typeof resolveFormat>) =>
      r.elements.map(e => ({ region: e.region, rect: e.rect, culled: e.culled, text: e.text, rotation: e.rotation }))
    const withStyle = resolveFormat(fixture('horizontal'), '1x1')
    const noStyle = resolveFormat(fixture(), '1x1')
    expect(strip(withStyle)).toEqual(strip(noStyle))
  })
})

const EXPRESSIVE: GridExpressiveParams = {
  wordsPerLine: 2, placement: 'random', jitterX: 0, jitterY: 0, seed: 1,
}

// Same tall narrow region as `fixture`, but with an expressive word-layout
// style — the combo case where `orientation` should be a no-op (expressive
// wins layout entirely; a stamped ±90 rotation would corrupt the UNswapped
// outer box both renderers apply it to).
function expressiveFixture(orientation?: 'horizontal' | 'up' | 'down'): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      {
        id: 'title', type: 'text', content: 'Artisan Roasted Coffee Beans From The Highlands',
        level: 'display', priority: 1,
        region: { col: 1, colSpan: 1, row: 1, rowSpan: 5 },
        style: { expressive: EXPRESSIVE, ...(orientation ? { orientation } : {}) },
      },
    ],
  }
}

describe('resolveFormat: expressive + orientation combo (orientation is a no-op)', () => {
  it('expressive + orientation:"up" resolves with NO stamped rotation', () => {
    const r = resolveFormat(expressiveFixture('up'), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.rotation).toBeUndefined()
  })

  it('expressive + orientation:"up" is byte-identical to expressive-only (minus the orientation key on the source element)', () => {
    const withOrientation = resolveFormat(expressiveFixture('up'), '1x1')
    const control = resolveFormat(expressiveFixture(), '1x1')
    const strip = (r: ReturnType<typeof resolveFormat>) =>
      r.elements.map(e => ({ region: e.region, rect: e.rect, culled: e.culled, text: e.text, rotation: e.rotation }))
    expect(strip(withOrientation)).toEqual(strip(control))
  })
})

// Section-child (expressive scatter) path — same combo, but the text child
// sits under a `section.expressive` box-scatter, going through the
// `fitElementAtRect` call at resolve.ts's section-child site (not the
// top-level ungrouped path above). Cheap to build from the same pattern as
// template-grid-expressive-section.unit.spec.ts's `tpl` helper.
function sectionFixture(orientation?: 'horizontal' | 'up' | 'down'): TemplateV3 {
  const title: TextElementV2 = {
    id: 'title', type: 'text', content: 'Artisan Roasted Coffee Beans From The Highlands',
    level: 'display', priority: 1,
    region: { col: 1, colSpan: 18, row: 1, rowSpan: 90 },
    style: { expressive: EXPRESSIVE, ...(orientation ? { orientation } : {}) },
  }
  return {
    version: 3, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1000, h: 1000 } },
    grid: { gutter: 0, margin: 0, baseline: 10 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [],
    sections: [{
      id: 'sec', name: 'sec',
      region: { col: 1, colSpan: 100, row: 1, rowSpan: 100 },
      expressive: { placement: 'scatter', jitter: 0, rotation: 0, seed: 3 },
      children: [title],
    }],
  }
}

describe('resolveFormat: expressive-section child + orientation combo (no-op)', () => {
  it('section-scattered expressive child with orientation:"up" has NO stamped ±90 rotation beyond the scatter\'s own tilt (0 here)', () => {
    const r = resolveFormat(sectionFixture('up'), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    // rotation===0 params → scatter's own tilt is 0/omitted; a leaked ±90
    // from the orientation guard gap would show up here.
    expect(title.rotation ?? 0).toBe(0)
  })

  it('section-scattered expressive child resolves identically with or without orientation set', () => {
    const withOrientation = resolveFormat(sectionFixture('up'), '1x1')
    const control = resolveFormat(sectionFixture(), '1x1')
    const strip = (r: ReturnType<typeof resolveFormat>) =>
      r.elements.map(e => ({ rect: e.rect, culled: e.culled, text: e.text, rotation: e.rotation }))
    expect(strip(withOrientation)).toEqual(strip(control))
  })
})

// Round-2a final-fix 5: overflow:'grow' × vertical orientation. A 2-col
// region on the square master's 6x6 grid, starting at rowSpan 2 — the exact
// fontSize/content/colSpan combo below is a verified divergence point
// (found by scanning the parameter space): the OLD (unswapped) grow loop
// maxes rowSpan out to 6 — the whole grid — because it measures wrapLines
// against the FIXED colSpan-derived width while comparing the needed height
// against the growing rowSpan-derived one; the fix (swap both dimensions
// when the text is vertical) converges one row sooner (5) because it
// measures wrap width against the GROWING (rowSpan-derived) dimension. This
// mirrors the reported repro (a vertical hero's rowSpan growing to the whole
// grid) at the scale a 6-row v2 grid can actually exhibit it.
const GROW_CONTENT = 'THE ANNUAL GATHERING'
const GROW_FONT_SIZE = 128
function growFixture(orientation?: 'horizontal' | 'up' | 'down'): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: { '1x1': { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    elements: [
      {
        id: 'title', type: 'text', content: GROW_CONTENT,
        level: 'display', priority: 1, overflow: 'grow',
        region: { col: 1, colSpan: 2, row: 1, rowSpan: 2 },
        style: { fontSize: GROW_FONT_SIZE, ...(orientation ? { orientation } : {}) },
      },
    ],
  }
}

describe('resolveFormat: overflow "grow" × vertical orientation (swapped-axis fit)', () => {
  it('vertical grow converges before maxing rowSpan out to the whole 6-row grid', () => {
    const r = resolveFormat(growFixture('up'), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.region!.rowSpan).toBe(5)
    expect(title.region!.rowSpan).toBeLessThan(6)
  })

  it('horizontal grow is UNCHANGED by the fix — same content/font/colSpan still maxes rowSpan to 6 as before', () => {
    const r = resolveFormat(growFixture(), '1x1')
    const title = r.elements.find(e => e.el.id === 'title')!
    expect(title.region!.rowSpan).toBe(6)
  })
})

describe('isVerticalTextStyle (shared predicate)', () => {
  it('true for orientation "up" with no expressive', () => {
    expect(isVerticalTextStyle({ orientation: 'up' })).toBe(true)
  })

  it('true for orientation "down" with no expressive', () => {
    expect(isVerticalTextStyle({ orientation: 'down' })).toBe(true)
  })

  it('false for orientation "up" when expressive is also set — expressive wins', () => {
    expect(isVerticalTextStyle({ orientation: 'up', expressive: EXPRESSIVE })).toBe(false)
  })

  it('false for horizontal/absent orientation', () => {
    expect(isVerticalTextStyle({})).toBe(false)
    expect(isVerticalTextStyle(undefined)).toBe(false)
    expect(isVerticalTextStyle({ orientation: 'horizontal' })).toBe(false)
  })
})
