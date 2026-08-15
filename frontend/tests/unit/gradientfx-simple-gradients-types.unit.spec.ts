import { describe, it, expect } from 'vitest'
import {
  LAYOUT_LABELS, LAYOUTS, RAMP_DEFAULTS, ensureConfigDefaults,
  type GradientConfig, type LayoutKind,
} from '~/lib/gradientfx/types'
import { defaultConfig } from '~/lib/gradientfx/randomize'

describe('simple-gradient types', () => {
  it('LAYOUT_LABELS has exactly one label per LayoutKind', () => {
    const keys: LayoutKind[] = ['ramp','radialRamp','conic','linear','radial','orbit','stack','liquid','mesh']
    for (const k of keys) expect(LAYOUT_LABELS[k], `label for ${k}`).toBeTruthy()
    expect(Object.keys(LAYOUT_LABELS).sort()).toEqual([...keys].sort())
  })

  it('renames stripe layouts but keeps the plain names for the new primitives', () => {
    expect(LAYOUT_LABELS.linear).toBe('Linear stripes')
    expect(LAYOUT_LABELS.radial).toBe('Radial stripes')
    expect(LAYOUT_LABELS.ramp).toBe('Linear')
    expect(LAYOUT_LABELS.radialRamp).toBe('Radial')
    expect(LAYOUT_LABELS.conic).toBe('Conic')
  })

  it('LAYOUTS randomize pool includes the three new keys', () => {
    for (const k of ['ramp','radialRamp','conic'] as const) expect(LAYOUTS).toContain(k)
  })

  it('ensureConfigDefaults backfills ramp on a simple layout and repeat/falloff on every layer', () => {
    const c = defaultConfig('#seed0001') as GradientConfig
    c.canvas.layout = 'ramp'
    delete (c.layers[0] as any).ramp
    delete (c.layers[0]!.color as any).repeat
    delete (c.layers[0]!.color as any).falloff
    ensureConfigDefaults(c)
    expect(c.layers[0]!.ramp).toEqual(RAMP_DEFAULTS)
    expect(c.layers[0]!.color.repeat).toBe('once')
    expect(c.layers[0]!.color.falloff).toBe('linear')
  })

  it('ensureConfigDefaults leaves an explicit ramp/repeat/falloff untouched', () => {
    const c = defaultConfig('#seed0002') as GradientConfig
    c.canvas.layout = 'conic'
    c.layers[0]!.ramp = { angle: 33, radius: 0.5, shape: 'ellipse', sweep: 180, closeLoop: true }
    c.layers[0]!.color.repeat = 'tile'; c.layers[0]!.color.repeatCount = 4; c.layers[0]!.color.falloff = 'smooth'
    ensureConfigDefaults(c)
    expect(c.layers[0]!.ramp).toEqual({ angle: 33, radius: 0.5, shape: 'ellipse', sweep: 180, closeLoop: true })
    expect(c.layers[0]!.color.repeat).toBe('tile')
    expect(c.layers[0]!.color.falloff).toBe('smooth')
  })
})
