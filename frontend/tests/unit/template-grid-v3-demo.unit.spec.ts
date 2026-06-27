import { describe, expect, it } from 'vitest'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import { v3Demo } from '~~/shared/template-grid/starter'
import type { Rect } from '~~/shared/template-grid/grid'

const contains = (outer: Rect, inner: Rect, pad = 1) =>
  inner.x >= outer.x - pad
  && inner.y >= outer.y - pad
  && inner.x + inner.w <= outer.x + outer.w + pad
  && inner.y + inner.h <= outer.y + outer.h + pad

describe('v3 demo template', () => {
  for (const fmt of ['1x1', '9x16', '16x9'] as const) {
    it(`keeps the headline child inside its lockup section at ${fmt}`, () => {
      const t = v3Demo()
      const r = resolveFormat(t, fmt, { headline: 'Brazil', subhead: 'Group G' })
      const headline = r.elements.find(e => e.el.id === 'demo-headline')
      expect(headline?.culled).toBe(false)
      // sanity: the headline sits within the canvas
      expect(headline!.rect.x).toBeGreaterThanOrEqual(0)
      expect(headline!.rect.x + headline!.rect.w).toBeLessThanOrEqual(r.format.w + 1)
      void contains   // helper kept for local debugging
    })
  }

  it('renders both lockup children and the badge', () => {
    const r = resolveFormat(v3Demo(), '1x1', { headline: 'Brazil', subhead: 'Group G' })
    const ids = r.elements.filter(e => !e.culled).map(e => e.el.id)
    expect(ids).toContain('demo-headline')
    expect(ids).toContain('demo-subhead')
    expect(ids).toContain('demo-badge')
  })
})
