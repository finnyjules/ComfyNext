import { describe, it, expect } from 'vitest'
import { visibleGradientControls, GRADIENT_SECTIONS } from '~/lib/gradientfx/controls'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { ensureConfigDefaults, type GradientConfig, type LayoutKind } from '~/lib/gradientfx/types'

function cfg(layout: LayoutKind): GradientConfig {
  const c = defaultConfig('#cc1') as GradientConfig
  c.canvas.layout = layout
  return ensureConfigDefaults(c)
}
const keys = (l: LayoutKind) => new Set(visibleGradientControls(cfg(l)).map(k => k.key))

describe('curve control gating', () => {
  it('adds a Curve section', () => { expect(GRADIENT_SECTIONS).toContain('Curve') })

  it('curve exposes the Curve group + Repeat/Falloff, NOT Shape/Relief/Center', () => {
    const k = keys('curve')
    for (const key of ['layer.curve.mode','layer.curve.shape','layer.curve.start.x','layer.curve.end.y','layer.curve.curvature','layer.curve.handles'])
      expect(k.has(key), key).toBe(true)
    expect(k.has('layer.color.repeat')).toBe(true)
    expect(k.has('layer.color.falloff')).toBe(true)
    expect(k.has('layer.shape.count')).toBe(false)
    expect(k.has('relief.relief')).toBe(false)
    expect(k.has('canvas.center.x')).toBe(false)
  })

  it('width shows only in outward mode; waves/phase only for the wave shape', () => {
    const outward = cfg('curve'); outward.layers[0]!.curve!.mode = 'outward'
    expect(new Set(visibleGradientControls(outward).map(x=>x.key)).has('layer.curve.width')).toBe(true)
    const along = cfg('curve'); along.layers[0]!.curve!.mode = 'along'
    expect(new Set(visibleGradientControls(along).map(x=>x.key)).has('layer.curve.width')).toBe(false)
    const wave = cfg('curve'); wave.layers[0]!.curve!.shape = 'wave'
    expect(new Set(visibleGradientControls(wave).map(x=>x.key)).has('layer.curve.waves')).toBe(true)
    const arc = cfg('curve'); arc.layers[0]!.curve!.shape = 'arc'
    expect(new Set(visibleGradientControls(arc).map(x=>x.key)).has('layer.curve.waves')).toBe(false)
  })

  it('non-curve simple layouts do NOT get the curve group', () => {
    expect(keys('ramp').has('layer.curve.mode')).toBe(false)
  })
})
