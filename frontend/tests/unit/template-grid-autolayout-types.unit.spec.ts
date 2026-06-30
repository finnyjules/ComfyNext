import { describe, expect, it } from 'vitest'
import { isLayoutStack } from '../../shared/template-grid/types'
import type { SectionV3 } from '../../shared/template-grid/types'

describe('isLayoutStack', () => {
  const base: SectionV3 = { id: 's1', name: 'x', region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 }, children: [] }

  it('is false when no layout', () => {
    expect(isLayoutStack(base)).toBe(false)
  })

  it('is true when layout present', () => {
    const s: SectionV3 = { ...base, layout: {
      direction: 'vertical', padding: { top: 2, right: 2, bottom: 2, left: 2 },
      gap: 1, mainAlign: 'start', crossAlign: 'stretch',
    } }
    expect(isLayoutStack(s)).toBe(true)
  })
})
