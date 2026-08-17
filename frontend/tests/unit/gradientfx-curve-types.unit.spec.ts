import { describe, it, expect } from 'vitest'
import { LAYOUT_LABELS, LAYOUTS, CURVE_DEFAULTS, ensureConfigDefaults, type GradientConfig, type LayoutKind } from '~/lib/gradientfx/types'
import { defaultConfig } from '~/lib/gradientfx/randomize'

describe('curve types', () => {
  it('curve is a LayoutKind with label "Curve" and in the randomize pool', () => {
    const keys: LayoutKind[] = ['ramp','radialRamp','conic','curve','linear','radial','orbit','stack','liquid','mesh']
    expect(Object.keys(LAYOUT_LABELS).sort()).toEqual([...keys].sort())
    expect(LAYOUT_LABELS.curve).toBe('Curve')
    expect(LAYOUTS).toContain('curve')
  })

  it('CURVE_DEFAULTS is a complete parametric curve', () => {
    expect(CURVE_DEFAULTS.mode).toBe('along')
    expect(CURVE_DEFAULTS.shape).toBe('arc')
    expect(CURVE_DEFAULTS.start).toEqual({ x: 0.2, y: 0.5 })
    expect(CURVE_DEFAULTS.end).toEqual({ x: 0.8, y: 0.5 })
    expect(typeof CURVE_DEFAULTS.width).toBe('number')
  })

  it('ensureConfigDefaults backfills curve on a curve layout, not elsewhere', () => {
    const c = defaultConfig('#curve01') as GradientConfig
    c.canvas.layout = 'curve'
    delete (c.layers[0] as any).curve
    ensureConfigDefaults(c)
    expect(c.layers[0]!.curve).toEqual(CURVE_DEFAULTS)

    const r = defaultConfig('#ramp01') as GradientConfig  // ramp layout
    ensureConfigDefaults(r)
    expect((r.layers[0] as any).curve).toBeUndefined()
  })

  it('leaves an explicit curve untouched', () => {
    const c = defaultConfig('#curve02') as GradientConfig
    c.canvas.layout = 'curve'
    c.layers[0]!.curve = { start:{x:0,y:0}, end:{x:1,y:1}, shape:'wave', curvature:0.7, bend:-1, waves:5, phase:0.25, mode:'outward', width:0.5 }
    ensureConfigDefaults(c)
    expect(c.layers[0]!.curve!.shape).toBe('wave')
    expect(c.layers[0]!.curve!.mode).toBe('outward')
  })
})
