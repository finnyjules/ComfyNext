import { describe, it, expect } from 'vitest'
import {
  controlKindToVariableType, studioBindableFor, listStudioBindables, clampForControl,
} from '~/lib/collection/studioBindables'

describe('controlKindToVariableType', () => {
  it('maps studio control kinds to variable types', () => {
    expect(controlKindToVariableType('slider')).toBe('number')
    expect(controlKindToVariableType('color')).toBe('color')
    expect(controlKindToVariableType('select')).toBe('select')
    expect(controlKindToVariableType('font')).toBe('font')
    expect(controlKindToVariableType('fillList')).toBeNull()
    expect(controlKindToVariableType('curve')).toBeNull()
  })
})

describe('studioBindableFor / listStudioBindables', () => {
  const controls = [
    { key: 'flow.intensity', label: 'Intensity', kind: 'slider', min: 0, max: 100, step: 1 },
    { key: 'canvas.background', label: 'Background', kind: 'color' },
    { key: 'fills', label: 'Fills', kind: 'fillList' },
  ]
  it('creates params.-prefixed bindables and drops unbindable kinds', () => {
    const b = listStudioBindables(controls)
    expect(b.map(x => x.path)).toEqual(['params.flow.intensity', 'params.canvas.background'])
    expect(b[0]!.type).toBe('number')
    expect(b[1]!.type).toBe('color')
  })
  it('dedupes repeated keys', () => {
    const b = listStudioBindables([controls[0]!, controls[0]!])
    expect(b).toHaveLength(1)
  })
})

describe('clampForControl', () => {
  it('clamps sliders to bounds and coerces numeric strings', () => {
    const c = { key: 'x', label: 'x', kind: 'slider', min: 0, max: 10, step: 1 }
    expect(clampForControl(c, 25)).toBe(10)
    expect(clampForControl(c, '-3')).toBe(0)
    expect(clampForControl(c, '7')).toBe(7)
  })
  it('snaps selects to a valid option', () => {
    const c = { key: 's', label: 's', kind: 'select', options: ['a', 'b'] }
    expect(clampForControl(c, 'b')).toBe('b')
    expect(clampForControl(c, 'zzz')).toBe('a')
  })
  it('passes valid hex through for colors, empty for invalid', () => {
    const c = { key: 'c', label: 'c', kind: 'color' }
    expect(clampForControl(c, '#0C447C')).toBe('#0C447C')
    expect(clampForControl(c, 'purpleish')).toBe('')
  })
})
