import { describe, it, expect } from 'vitest'
import { defaultsFromControls, type ControlSpec } from '../../app/lib/spacetype/effect'
import { ribbonEffect } from '../../app/lib/spacetype/effects/ribbon'

const controls: ControlSpec[] = [
  { key: 'rows', label: 'Rows', kind: 'slider', min: 3, max: 24, step: 1, default: 11 },
  { key: 'text', label: 'Text', kind: 'text', default: 'VESSEL' },
  { key: 'typeColor', label: 'Type color', kind: 'color', default: '#f5f5f7' },
  { key: 'case', label: 'Case', kind: 'select', options: ['as-typed', 'upper'], default: 'upper' },
]

describe('defaultsFromControls', () => {
  it('extracts one default per control keyed by control key', () => {
    expect(defaultsFromControls(controls)).toEqual({
      rows: 11, text: 'VESSEL', typeColor: '#f5f5f7', case: 'upper',
    })
  })
  it('returns an empty object for no controls', () => {
    expect(defaultsFromControls([])).toEqual({})
  })
})

describe('ribbonEffect contract', () => {
  it('declares an id, label, and controls', () => {
    expect(ribbonEffect.id).toBe('ribbon')
    expect(ribbonEffect.label.length).toBeGreaterThan(0)
    expect(ribbonEffect.controls.length).toBeGreaterThan(0)
  })
  it('every control has a default and a unique key', () => {
    const keys = ribbonEffect.controls.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of ribbonEffect.controls) expect(c.default).toBeDefined()
  })
  it('exposes the STG signature controls', () => {
    const keys = ribbonEffect.controls.map(c => c.key)
    for (const k of ['text', 'rows', 'zRotation', 'waveAmplitude', 'scrollSpeed']) {
      expect(keys).toContain(k)
    }
  })
})
