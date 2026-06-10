import { describe, expect, it } from 'vitest'
import { defaultClassRegion, slotOf } from '~~/shared/template-grid/layouts'
import type { Slot } from '~~/shared/template-grid/layouts'
import type { ElementV2 } from '~~/shared/template-grid/types'

const R = { col: 1, colSpan: 1, row: 1, rowSpan: 1 }
const headline: ElementV2 = { id: 'h', type: 'text', content: 'x', level: 'display', priority: 1, region: R }
const subhead: ElementV2 = { id: 's', type: 'text', content: 'x', level: 'subhead', priority: 5, region: R }
const cta: ElementV2 = { id: 'c', type: 'text', content: 'x', level: 'caption', role: 'CTA', priority: 2, region: R }
const logo: ElementV2 = { id: 'l', type: 'image', content: 'x', role: 'LOGO', priority: 3, region: R }
const hero: ElementV2 = { id: 'i', type: 'image', content: 'x', priority: 4, region: R }
const shape: ElementV2 = { id: 'sh', type: 'shape', shape: 'rect', priority: 9, region: R }

describe('slotOf', () => {
  it('maps roles and types to slots', () => {
    expect(slotOf(headline)).toBe('headline')
    expect(slotOf(subhead)).toBe('subhead')
    expect(slotOf(cta)).toBe('cta')
    expect(slotOf(logo)).toBe('logo')
    expect(slotOf(hero)).toBe('image')
    expect(slotOf(shape)).toBeNull()
  })
})

describe('defaultClassRegion: strip', () => {
  const dims = { cols: 12, rows: 1 }
  it('places logo, headline, image, cta on the 12-col strip', () => {
    const taken = new Set<Slot>()
    expect(defaultClassRegion(logo, 'strip', dims, taken)).toEqual({ col: 1, colSpan: 2, row: 1, rowSpan: 1 })
    expect(defaultClassRegion(headline, 'strip', dims, taken)).toEqual({ col: 3, colSpan: 6, row: 1, rowSpan: 1 })
    expect(defaultClassRegion(hero, 'strip', dims, taken)).toEqual({ col: 9, colSpan: 1, row: 1, rowSpan: 1 })
    expect(defaultClassRegion(cta, 'strip', dims, taken)).toEqual({ col: 10, colSpan: 3, row: 1, rowSpan: 1 })
  })
  it('culls subhead in strips (no slot)', () => {
    expect(defaultClassRegion(subhead, 'strip', dims, new Set())).toBeNull()
  })
  it('gives a contested slot to the first claimant only', () => {
    const taken = new Set<Slot>()
    expect(defaultClassRegion(headline, 'strip', dims, taken)).not.toBeNull()
    const second: ElementV2 = { ...headline, id: 'h2' }
    expect(defaultClassRegion(second, 'strip', dims, taken)).toBeNull()
  })
})

describe('defaultClassRegion: skyscraper', () => {
  it('stacks logo/image/headline/subhead/cta top to bottom', () => {
    const dims = { cols: 3, rows: 10 }
    const taken = new Set<Slot>()
    expect(defaultClassRegion(logo, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 1, rowSpan: 1 })
    expect(defaultClassRegion(hero, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 2, rowSpan: 3 })
    expect(defaultClassRegion(headline, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 5, rowSpan: 3 })
    expect(defaultClassRegion(subhead, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 8, rowSpan: 1 })
    expect(defaultClassRegion(cta, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 9, rowSpan: 2 })
  })
})
