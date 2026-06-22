import { describe, it, expect } from 'vitest'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'
import type { ControlSpec, Params } from '~/lib/spacetype/effect'

const CONTROLS: ControlSpec[] = [
  { key: 'depth', label: 'Depth', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, hint: 'higher = deeper' },
  { key: 'palette', label: 'Palette', kind: 'select', options: ['cool', 'warm', 'mono'], default: 'cool' },
  { key: 'tint', label: 'Tint', kind: 'color', default: '#101010' },
  { key: 'face', label: 'Font', kind: 'font', default: 'Inter' },
  { key: 'message', label: 'Text', kind: 'text', default: 'HELLO' },
  { key: 'locked', label: 'Locked', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0.2, aiEditable: false },
]

describe('describeControls', () => {
  it('keeps AI-editable kinds, drops text/locked', () => {
    const out = describeControls(CONTROLS, { depth: 0.7 })
    const paths = out.map(c => c.path)
    expect(paths).toEqual(['depth', 'palette', 'tint', 'face'])
  })
  it('reports current value over default', () => {
    const out = describeControls(CONTROLS, { depth: 0.7 } as Params)
    expect(out.find(c => c.path === 'depth')!.current).toBe(0.7)
    expect(out.find(c => c.path === 'palette')!.current).toBe('cool')
  })
})

describe('validatePatch', () => {
  const described = describeControls(CONTROLS, {})
  it('clamps and snaps sliders', () => {
    expect(validatePatch({ depth: 9 }, described)).toEqual({ depth: 1 })
    expect(validatePatch({ depth: -5 }, described)).toEqual({ depth: 0 })
    expect(validatePatch({ depth: 0.333 }, described)).toEqual({ depth: 0.33 })
  })
  it('drops unknown keys, bad enums, bad colors', () => {
    expect(validatePatch({ nope: 1 }, described)).toEqual({})
    expect(validatePatch({ palette: 'purple' }, described)).toEqual({})
    expect(validatePatch({ tint: 'red' }, described)).toEqual({})
  })
  it('keeps valid enum and color', () => {
    expect(validatePatch({ palette: 'warm', tint: '#ABCDEF' }, described))
      .toEqual({ palette: 'warm', tint: '#ABCDEF' })
  })
  it('keeps non-empty fonts, drops empty', () => {
    expect(validatePatch({ face: 'Georgia' }, described)).toEqual({ face: 'Georgia' })
    expect(validatePatch({ face: '' }, described)).toEqual({})
  })
})
