import { describe, it, expect } from 'vitest'
import { isHexA, parseHexA, withAlpha, stripAlpha } from '~/lib/color/convert'

describe('isHexA', () => {
  it('accepts 8-digit hex', () => {
    expect(isHexA('#ff000080')).toBe(true)
    expect(isHexA('ff000080')).toBe(true)
  })
  it('rejects 6-digit and garbage', () => {
    expect(isHexA('#ff0000')).toBe(false)
    expect(isHexA('#ff00008')).toBe(false)
    expect(isHexA('nope')).toBe(false)
  })
})

describe('parseHexA', () => {
  it('treats 6-digit as fully opaque', () => {
    expect(parseHexA('#3366ff')).toEqual({ hex: '#3366ff', alpha: 1 })
  })
  it('splits 8-digit into rgb and alpha', () => {
    const r = parseHexA('#3366ff00')
    expect(r.hex).toBe('#3366ff')
    expect(r.alpha).toBe(0)
  })
  it('parses ff alpha as exactly 1', () => {
    expect(parseHexA('#3366ffff').alpha).toBe(1)
  })
  it('parses 80 alpha as approximately half', () => {
    expect(parseHexA('#3366ff80').alpha).toBeCloseTo(0.502, 3)
  })
  it('falls back to opaque black on garbage', () => {
    expect(parseHexA('nope')).toEqual({ hex: '#000000', alpha: 1 })
  })
})

describe('withAlpha', () => {
  it('emits 6-digit when fully opaque', () => {
    expect(withAlpha('#3366ff', 1)).toBe('#3366ff')
  })
  it('emits 8-digit when translucent', () => {
    expect(withAlpha('#3366ff', 0)).toBe('#3366ff00')
    expect(withAlpha('#3366ff', 0.502)).toBe('#3366ff80')
  })
  it('clamps out-of-range alpha', () => {
    expect(withAlpha('#3366ff', 2)).toBe('#3366ff')
    expect(withAlpha('#3366ff', -1)).toBe('#3366ff00')
  })
  it('round-trips through parseHexA', () => {
    const out = withAlpha('#12ab34', 0.25)
    const back = parseHexA(out)
    expect(back.hex).toBe('#12ab34')
    expect(back.alpha).toBeCloseTo(0.25, 2)
  })
  it('ignores alpha already present on the input', () => {
    expect(withAlpha('#3366ff00', 1)).toBe('#3366ff')
  })
  it('treats a non-finite alpha as opaque rather than emitting NaN', () => {
    expect(withAlpha('#3366ff', NaN)).toBe('#3366ff')
    expect(withAlpha('#3366ff', undefined as unknown as number)).toBe('#3366ff')
  })
})

describe('stripAlpha', () => {
  it('drops the alpha pair', () => {
    expect(stripAlpha('#3366ff80')).toBe('#3366ff')
  })
  it('passes 6-digit through', () => {
    expect(stripAlpha('#3366ff')).toBe('#3366ff')
  })
})
