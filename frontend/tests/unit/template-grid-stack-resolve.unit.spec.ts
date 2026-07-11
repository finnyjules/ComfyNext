import { describe, expect, it } from 'vitest'
import { resolveFormat } from '../../shared/template-grid/resolve'
import { typeSize, wrapLines } from '../../shared/template-grid/text'
import type { TemplateV3 } from '../../shared/template-grid/types'

function tpl(layout?: TemplateV3['sections'][0]['layout']): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 },
    typeScale: { base: 16, ratio: 1.25 },
    elements: [],
    sections: [{
      id: 's1', name: 'stack',
      region: { col: 1, colSpan: 10, row: 1, rowSpan: 20 },
      layout,
      children: [
        { id: 'a', type: 'shape', shape: 'rect', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 } },
        { id: 'b', type: 'shape', shape: 'rect', priority: 2, region: { col: 1, colSpan: 4, row: 6, rowSpan: 4 } },
      ],
    }],
  }
}

describe('resolveFormat — auto-layout stacks', () => {
  it('stacks children vertically (b below a) when layout present', () => {
    const r = resolveFormat(tpl({
      direction: 'vertical', padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0, mainAlign: 'start', crossAlign: 'stretch',
    }), 'sq')
    const a = r.elements.find(e => e.el.id === 'a')!
    const b = r.elements.find(e => e.el.id === 'b')!
    expect(a.culled).toBe(false)
    expect(b.rect.y).toBeGreaterThanOrEqual(a.rect.y + a.rect.h - 0.01) // b starts at/after a's bottom
    // With gap=0, start align: b packs immediately after a (no proportional gap preserved)
    expect(b.rect.y).toBeCloseTo(a.rect.y + a.rect.h, 1) // stacked tightly, not gap-preserving
    expect(a.rect.x).toBeCloseTo(b.rect.x) // cross stretch → same x
  })

  it('cross-stretch measures hug text at inner cross width when crossAlign=stretch', () => {
    // A vertical stack with crossAlign:'stretch' and a text child whose layoutSizing
    // is { main:'hug', cross:'hug' }. The solver will stretch the child to the full
    // inner cross width regardless of its cross mode, so the measurement must use
    // that same width — not the narrow seeded r.w from the child's own region.
    //
    // Grid math (margin:0→floors to 4, gutter:0, baseline:40, 1080×1080):
    //   cols=27, cellW≈39.7px, margin=4px
    //   section colSpan:10 → innerCrossPx = sectionRect.w = 10*cellW ≈ 397px
    //   child's seeded region colSpan:2  → r.w ≈ 79px  (the "wrong" narrow width)
    //
    // With the fix the text is measured at ~397px (innerCrossPx); without the fix
    // it would be measured at ~79px (r.w), producing more lines and a taller rect.
    const tplStretch: TemplateV3 = {
      version: 3, id: 'ts', name: 'ts', master: 'sq',
      formats: { sq: { w: 1080, h: 1080 } },
      grid: { gutter: 0, margin: 0, baseline: 40 },
      typeScale: { base: 16, ratio: 1.25 },
      elements: [],
      sections: [{
        id: 's1', name: 'stack',
        region: { col: 1, colSpan: 10, row: 1, rowSpan: 20 },
        layout: {
          direction: 'vertical',
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          gap: 0,
          mainAlign: 'start',
          crossAlign: 'stretch',
        },
        children: [{
          id: 'txt',
          type: 'text',
          content: 'Hello world this is a long wrapping line of text',
          level: 'body',
          priority: 1,
          // colSpan:2 → seeded r.w ≈ 79px — much narrower than the section cross width.
          // This is the wrong width that the bug would measure at.
          region: { col: 1, colSpan: 2, row: 1, rowSpan: 2 },
          layoutSizing: { main: 'hug', cross: 'hug' },
        }],
      }],
    }
    const r = resolveFormat(tplStretch, 'sq')
    const txt = r.elements.find(e => e.el.id === 'txt')!
    expect(txt.culled).toBe(false)

    // Known inner cross width: section colSpan:10, cellW = 1080 / 27 = 40
    // (margin:0 is now respected — no floor — so there's no horizontal inset).
    // innerCrossPx = 10 * cellW = 400
    const cellW = 1080 / 27
    const innerCrossPx = 10 * cellW

    // The solver stretches cross:'hug' when crossAlign==='stretch', so the resolved
    // child width must equal innerCrossPx.
    expect(txt.rect.w).toBeCloseTo(innerCrossPx, 1)

    // And the height must have been measured at that same stretched width, not at the
    // narrow seeded r.w (~79px). Verify by re-measuring at the correct width.
    // Use typeSize() to get the real resolved fontSize (it applies metricScale + typeMultiplier).
    const fontSize = typeSize('body', tplStretch, 'sq')
    const lineHeight = 1.1
    const linesAtStretchedWidth = wrapLines(
      'Hello world this is a long wrapping line of text',
      fontSize,
      innerCrossPx,
    )
    const expectedH = linesAtStretchedWidth.length * fontSize * lineHeight
    expect(txt.rect.h).toBeCloseTo(expectedH, 1)

    // Confirm the fix matters: at the narrow seeded width (~79px) we'd get more lines.
    const narrowW = 2 * cellW   // ≈ 79px
    const linesAtNarrowWidth = wrapLines(
      'Hello world this is a long wrapping line of text',
      fontSize,
      narrowW,
    )
    expect(linesAtNarrowWidth.length).toBeGreaterThan(linesAtStretchedWidth.length)
  })

  it('layout-less section is byte-identical to today (proportional projection)', () => {
    const withoutLayout = resolveFormat(tpl(undefined), 'sq')
    // snapshot the resolved child rects so any change to the existing path is caught
    const rects = withoutLayout.elements.map(e => ({ id: e.el.id, ...e.rect }))
    expect(rects).toMatchSnapshot()
  })
})
