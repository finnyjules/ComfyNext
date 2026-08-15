import { describe, it, expect } from 'vitest'
import { visibleGradientControls, GRADIENT_SECTIONS } from '~/lib/gradientfx/controls'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { ensureConfigDefaults, type GradientConfig, type LayoutKind } from '~/lib/gradientfx/types'

function cfg(layout: LayoutKind): GradientConfig {
  const c = defaultConfig('#c0ntrol1') as GradientConfig
  c.canvas.layout = layout
  return ensureConfigDefaults(c)
}
const keys = (layout: LayoutKind) => new Set(visibleGradientControls(cfg(layout)).map(k => k.key))

describe('simple-gradient control gating', () => {
  it('adds a Gradient section', () => {
    expect(GRADIENT_SECTIONS).toContain('Gradient')
  })

  it('ramp layout exposes angle but not radius/sweep, and NOT Shape/Relief', () => {
    const k = keys('ramp')
    expect(k.has('layer.ramp.angle')).toBe(true)
    expect(k.has('layer.ramp.radius')).toBe(false)
    expect(k.has('layer.ramp.sweep')).toBe(false)
    expect(k.has('layer.shape.count')).toBe(false)
    expect(k.has('relief.relief')).toBe(false)
  })

  it('radialRamp exposes radius + shape + center, not angle/sweep', () => {
    const k = keys('radialRamp')
    expect(k.has('layer.ramp.radius')).toBe(true)
    expect(k.has('layer.ramp.shape')).toBe(true)
    expect(k.has('canvas.center.x')).toBe(true)
    expect(k.has('layer.ramp.angle')).toBe(false)
  })

  it('conic exposes angle + sweep + closeLoop + center', () => {
    const k = keys('conic')
    expect(k.has('layer.ramp.angle')).toBe(true)
    expect(k.has('layer.ramp.sweep')).toBe(true)
    expect(k.has('layer.ramp.closeLoop')).toBe(true)
    expect(k.has('canvas.center.x')).toBe(true)
  })

  it('falloff is universal; repeat is simple-primitive-only; repeatCount only when tile', () => {
    for (const l of ['ramp','linear','liquid','mesh'] as LayoutKind[]) {
      const k = keys(l)
      expect(k.has('layer.color.falloff'), `falloff on ${l}`).toBe(true)
    }
    // Repeat (u_repeat) is only read in the simple-primitive shader branch — a
    // no-op on the 6 legacy layouts, so it's withheld there.
    for (const l of ['ramp','radialRamp','conic'] as LayoutKind[]) {
      expect(keys(l).has('layer.color.repeat'), `repeat on ${l}`).toBe(true)
    }
    for (const l of ['linear','liquid','mesh'] as LayoutKind[]) {
      expect(keys(l).has('layer.color.repeat'), `repeat on ${l}`).toBe(false)
    }
    const c = cfg('ramp'); c.layers[0]!.color.repeat = 'tile'
    expect(new Set(visibleGradientControls(c).map(x => x.key)).has('layer.color.repeatCount')).toBe(true)
    const c2 = cfg('ramp'); c2.layers[0]!.color.repeat = 'once'
    expect(new Set(visibleGradientControls(c2).map(x => x.key)).has('layer.color.repeatCount')).toBe(false)
    // repeatCount stays withheld on a non-simple layout even when tile is set —
    // isSimple gates it before the tile check.
    const c3 = cfg('linear'); c3.layers[0]!.color.repeat = 'tile'
    expect(new Set(visibleGradientControls(c3).map(x => x.key)).has('layer.color.repeatCount')).toBe(false)
  })

  it('stripe layouts still expose Shape and NOT the ramp axis', () => {
    const k = keys('linear')
    expect(k.has('layer.shape.count')).toBe(true)
    expect(k.has('layer.ramp.angle')).toBe(false)
  })
})
