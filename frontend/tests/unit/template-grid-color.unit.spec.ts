import { describe, expect, it } from 'vitest'
import { colorToRgba } from '~~/shared/template-grid/color'

describe('colorToRgba', () => {
  it('expands #rrggbb with opacity', () => {
    expect(colorToRgba('#000000', 0.6)).toBe('rgba(0, 0, 0, 0.6)')
    expect(colorToRgba('#E2362B', 0.5)).toBe('rgba(226, 54, 43, 0.5)')
  })
  it('expands #rgb shorthand', () => {
    expect(colorToRgba('#fff', 1)).toBe('rgba(255, 255, 255, 1)')
  })
  it('folds an existing #rrggbbaa alpha into the opacity', () => {
    // base alpha 0x80≈0.502 × 0.5 ≈ 0.251
    expect(colorToRgba('#00000080', 0.5)).toBe('rgba(0, 0, 0, 0.251)')
  })
  it('clamps opacity and leaves unparseable colours alone', () => {
    expect(colorToRgba('#000', 5)).toBe('rgba(0, 0, 0, 1)')
    expect(colorToRgba('rebeccapurple', 0.5)).toBe('rebeccapurple')
  })
})
