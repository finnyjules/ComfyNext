import { describe, it, expect } from 'vitest'
import { validateGenerated } from '~~/shared/template-grid/generate/validate'
import type { ElementV2 } from '~~/shared/template-grid/types'

const t = (id: string, level: any, region: any): ElementV2 =>
  ({ id, type: 'text', content: id, level, priority: 1, region, origin: 'staging' } as ElementV2)

describe('validateGenerated', () => {
  it('passes a valid in-grid layout with ≤3 levels', () => {
    const els = [
      t('a', 'display', { col: 1, colSpan: 12, row: 1, rowSpan: 4 }),
      t('b', 'headline', { col: 1, colSpan: 6, row: 6, rowSpan: 2 }),
      t('c', 'caption', { col: 1, colSpan: 12, row: 15, rowSpan: 1 }),
    ]
    expect(validateGenerated({ elements: els }, 12, 16).ok).toBe(true)
  })
  it('fails when a region leaves the grid', () => {
    const els = [t('a', 'display', { col: 10, colSpan: 6, row: 1, rowSpan: 2 })]
    const r = validateGenerated({ elements: els }, 12, 16)
    expect(r.ok).toBe(false)
    expect(r.reasons.join(' ')).toMatch(/off-grid/)
  })
  it('fails when more than three type sizes are used', () => {
    const els = [
      t('a', 'display', { col: 1, colSpan: 12, row: 1, rowSpan: 2 }),
      t('b', 'headline', { col: 1, colSpan: 12, row: 4, rowSpan: 2 }),
      t('c', 'subhead', { col: 1, colSpan: 12, row: 7, rowSpan: 2 }),
      t('d', 'caption', { col: 1, colSpan: 12, row: 10, rowSpan: 1 }),
    ]
    expect(validateGenerated({ elements: els }, 12, 16).ok).toBe(false)
  })
  it('fails on an undeclared collision, naming both ids', () => {
    const els = [
      t('a', 'display', { col: 1, colSpan: 6, row: 1, rowSpan: 4 }),
      t('b', 'headline', { col: 3, colSpan: 6, row: 2, rowSpan: 2 }),
    ]
    const r = validateGenerated({ elements: els }, 12, 16)
    expect(r.ok).toBe(false)
    expect(r.reasons.join(' ')).toContain('a')
    expect(r.reasons.join(' ')).toContain('b')
    expect(r.reasons.some(reason => reason.includes('a') && reason.includes('b'))).toBe(true)
  })
  it('passes the same collision when the pair is declared (a, b order)', () => {
    const els = [
      t('a', 'display', { col: 1, colSpan: 6, row: 1, rowSpan: 4 }),
      t('b', 'headline', { col: 3, colSpan: 6, row: 2, rowSpan: 2 }),
    ]
    expect(validateGenerated({ elements: els, overlaps: [['a', 'b']] }, 12, 16).ok).toBe(true)
  })
  it('passes the same collision when the pair is declared (b, a order)', () => {
    const els = [
      t('a', 'display', { col: 1, colSpan: 6, row: 1, rowSpan: 4 }),
      t('b', 'headline', { col: 3, colSpan: 6, row: 2, rowSpan: 2 }),
    ]
    expect(validateGenerated({ elements: els, overlaps: [['b', 'a']] }, 12, 16).ok).toBe(true)
  })
})
