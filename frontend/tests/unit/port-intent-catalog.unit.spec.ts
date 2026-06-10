import { describe, it, expect } from 'vitest'
import { widgetDefsFromInfo, buildCatalog } from '../../app/lib/portIntentCatalog'
import type { NodeTypeLite } from '../../app/lib/portIntent'

const upscaleInfo = {
  input: {
    required: {
      image: ['IMAGE'],
      upscale_model: [['4x_esrgan.pth', '4x_ultrasharp.pth']],
      scale_by: ['FLOAT', { default: 1.5, min: 0.01, max: 8.0 }],
    },
  },
  output: ['IMAGE'],
}

describe('widgetDefsFromInfo', () => {
  it('extracts enum and numeric widgets, skips link inputs', () => {
    const defs = widgetDefsFromInfo(upscaleInfo, 20)
    expect(defs).toEqual([
      { name: 'upscale_model', type: 'ENUM', default: '4x_esrgan.pth', options: ['4x_esrgan.pth', '4x_ultrasharp.pth'], optionsOmitted: 0 },
      { name: 'scale_by', type: 'FLOAT', default: 1.5, min: 0.01, max: 8.0 },
    ])
  })
  it('caps enum options and records the omitted count', () => {
    const info = { input: { required: { ckpt: [['a', 'b', 'c', 'd']] } } }
    const defs = widgetDefsFromInfo(info, 2)
    expect(defs[0]).toMatchObject({ options: ['a', 'b'], optionsOmitted: 2 })
  })
  it('returns the full option list with maxEnum = Infinity', () => {
    const info = { input: { required: { ckpt: [['a', 'b', 'c', 'd']] } } }
    const defs = widgetDefsFromInfo(info, Infinity)
    expect(defs[0]).toMatchObject({ options: ['a', 'b', 'c', 'd'], optionsOmitted: 0 })
  })
})

describe('buildCatalog', () => {
  const lite = (name: string, inputs: { name: string; type: string }[], outputs: { name: string; type: string }[]): NodeTypeLite =>
    ({ name, displayName: name, description: '', category: '', inputs, outputs })
  const imgToLatent = lite('VAEEncode', [{ name: 'pixels', type: 'IMAGE' }], [{ name: 'LATENT', type: 'LATENT' }])
  const latentConsumer = lite('KSampler', [{ name: 'latent_image', type: 'LATENT' }], [{ name: 'LATENT', type: 'LATENT' }])
  const unrelated = lite('LoadAudio', [{ name: 'audio', type: 'AUDIO' }], [{ name: 'AUDIO', type: 'AUDIO' }])
  const objectInfo = { VAEEncode: { input: { required: { pixels: ['IMAGE'] } }, output: ['LATENT'] } }

  it('includes direct-compatible nodes first, then 1-hop bridged nodes, never unrelated ones', () => {
    const cat = buildCatalog([imgToLatent, latentConsumer, unrelated], objectInfo, { portType: 'IMAGE', direction: 'output' })
    expect(cat.map(e => e.type)).toEqual(['VAEEncode', 'KSampler'])
  })
  it('respects maxNodes', () => {
    const cat = buildCatalog([imgToLatent, latentConsumer], objectInfo, { portType: 'IMAGE', direction: 'output' }, { maxNodes: 1 })
    expect(cat).toHaveLength(1)
    expect(cat[0]!.type).toBe('VAEEncode')
  })
  it('uses object_info for ports/widgets when available, falls back to the lite entry', () => {
    const cat = buildCatalog([imgToLatent, latentConsumer], objectInfo, { portType: 'IMAGE', direction: 'output' })
    // VAEEncode has an objectInfo entry → ports derived from it
    expect(cat[0]).toMatchObject({ inputs: [{ name: 'pixels', type: 'IMAGE' }], outputs: [{ name: 'LATENT', type: 'LATENT' }] })
    // KSampler has no objectInfo entry → falls back to lite inputs
    expect(cat[1]!.inputs).toEqual(latentConsumer.inputs)
    expect(cat[1]!.widgets).toEqual([])
  })
})
