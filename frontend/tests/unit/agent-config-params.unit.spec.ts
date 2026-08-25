import { describe, it, expect } from 'vitest'
import { makeConfigParams } from '~/lib/agent/configParams'
import { gradientAgentControls } from '~/lib/gradientfx/agentControls'
import { shaderAgentControls } from '~/lib/shaderstudio/agentControls'
import { defaultConfig as gradientDefault } from '~/lib/gradientfx/randomize'
import { defaultConfig as shaderDefault } from '~/lib/shaderstudio/types'
import type { EffectDef } from '~/lib/shaderfx/types'

describe('makeConfigParams', () => {
  it('reads and writes nested dotted paths through to the reactive object', () => {
    const root = { flow: { intensity: 10 }, canvas: { margin: 0.1 } }
    const p = makeConfigParams(() => root)
    expect(p['flow.intensity']).toBe(10)
    p['flow.intensity'] = 55
    expect(root.flow.intensity).toBe(55)
  })

  it('resolves a leading `layer.` segment against the active layer', () => {
    const root = { layers: [{ opacity: 1 }, { opacity: 0.5 }] }
    let active = 0
    const p = makeConfigParams(() => root, () => active)
    expect(p['layer.opacity']).toBe(1)
    active = 1
    p['layer.opacity'] = 0.25
    expect(root.layers[1]!.opacity).toBe(0.25)
    expect(root.layers[0]!.opacity).toBe(1)
  })

  it('auto-creates missing intermediate objects on write', () => {
    const root: { canvas: { center?: { x: number; y: number } } } = { canvas: {} }
    const p = makeConfigParams(() => root)
    expect(p['canvas.center.x']).toBeUndefined()
    p['canvas.center.x'] = 0.3
    expect(root.canvas.center!.x).toBe(0.3)
  })
})

describe('gradientAgentControls', () => {
  it('offers liquid-only knobs only in the liquid layout', () => {
    const cfg = gradientDefault('#x')
    cfg.canvas.layout = 'linear'
    expect(gradientAgentControls(cfg).some(c => c.key === 'flow.gloss')).toBe(false)
    cfg.canvas.layout = 'liquid'
    expect(gradientAgentControls(cfg).some(c => c.key === 'flow.gloss')).toBe(true)
  })
  it('always offers flow + canvas controls with valid dotted keys', () => {
    const cfg = gradientDefault('#x')
    const ctrls = gradientAgentControls(cfg)
    expect(ctrls.some(c => c.key === 'flow.intensity')).toBe(true)
    expect(ctrls.some(c => c.key === 'canvas.background' && c.kind === 'color')).toBe(true)
    expect(ctrls.every(c => c.key.length > 0 && c.group.length > 0)).toBe(true)
  })
})

describe('shaderAgentControls', () => {
  const effect: EffectDef = {
    id: 'x', name: 'X', category: 'c', animated: false, passes: 1, centerParam: null, textures: [],
    params: [
      { uniform: 'u_intensity', label: 'Intensity', type: 'float', min: 0, max: 1, default: 0.5, step: 0.01 },
      { uniform: 'u_shape', label: 'Shape', type: 'enum', default: 0, options: [{ label: 'A', value: 0 }] },
    ],
    source: '',
  }
  it('surfaces float uniforms but skips enum uniforms', () => {
    const cfg = shaderDefault()
    const ctrls = shaderAgentControls(cfg, effect)
    expect(ctrls.some(c => c.key === 'effects.0.params.u_intensity')).toBe(true)
    expect(ctrls.some(c => c.key === 'effects.0.params.u_shape')).toBe(false)
  })
  // CHANGED 2026-08-25 (deliberate grant, was "only when that stage is enabled"):
  // a stage's params are now offered whether or not the stage is on, alongside its
  // `<stage>.enabled` switch, so one patch can enable AND tune. New keys granted:
  // duotone.enabled, gradientMap.enabled, adjust.enabled, post.blur.enabled,
  // post.blur.focusX/focusY, post.chromatic.enabled, post.bloom.enabled,
  // effects.N.mask.enabled, effects.N.mask.shape, plus the `effect` macro (opt-in
  // via opts.catalog). See ~/lib/shaderstudio/agentControls.ts's header.
  it('offers a stage’s params whether or not the stage is enabled, plus its switch', () => {
    const cfg = shaderDefault()
    expect(cfg.adjust.enabled).toBe(false)
    const off = shaderAgentControls(cfg, null)
    expect(off.some(c => c.key === 'adjust.saturation')).toBe(true)
    expect(off.find(c => c.key === 'adjust.enabled')?.kind).toBe('switch')
    cfg.adjust.enabled = true
    expect(shaderAgentControls(cfg, null).some(c => c.key === 'adjust.saturation')).toBe(true)
  })
})
