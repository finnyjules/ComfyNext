import { describe, it, expect } from 'vitest'
import { isTypeCompatible, anchorCandidates, linkInputPorts, outputPorts, type NodeTypeLite } from '../../app/lib/portIntent'

const upscaler: NodeTypeLite = {
  name: 'ImageUpscaleWithModel', displayName: 'Upscale Image (using Model)',
  description: '', category: 'image/upscaling',
  inputs: [{ name: 'upscale_model', type: 'UPSCALE_MODEL' }, { name: 'image', type: 'IMAGE' }],
  outputs: [{ name: 'IMAGE', type: 'IMAGE' }],
}
const sampler: NodeTypeLite = {
  name: 'KSampler', displayName: 'KSampler', description: '', category: 'sampling',
  inputs: [{ name: 'model', type: 'MODEL' }, { name: 'latent_image', type: 'LATENT' }],
  outputs: [{ name: 'LATENT', type: 'LATENT' }],
}

describe('isTypeCompatible', () => {
  it('matches identical types and wildcards', () => {
    expect(isTypeCompatible('IMAGE', 'IMAGE')).toBe(true)
    expect(isTypeCompatible('*', 'IMAGE')).toBe(true)
    expect(isTypeCompatible('IMAGE', '*')).toBe(true)
  })
  it('rejects different types and empty strings', () => {
    expect(isTypeCompatible('IMAGE', 'LATENT')).toBe(false)
    expect(isTypeCompatible('', 'IMAGE')).toBe(false)
  })
})

describe('anchorCandidates', () => {
  const all = [upscaler, sampler]
  it('output anchor: returns nodes with a compatible input', () => {
    const out = anchorCandidates(all, { portType: 'IMAGE', direction: 'output' })
    expect(out.map(n => n.name)).toEqual(['ImageUpscaleWithModel'])
  })
  it('input anchor: returns nodes with a compatible output', () => {
    const out = anchorCandidates(all, { portType: 'LATENT', direction: 'input' })
    expect(out.map(n => n.name)).toEqual(['KSampler'])
  })
  it('wildcard anchor returns everything', () => {
    expect(anchorCandidates(all, { portType: '*', direction: 'output' })).toHaveLength(2)
  })
})

describe('object_info port derivation', () => {
  // Mirrors a real /object_info entry shape
  const info = {
    input: {
      required: {
        image: ['IMAGE'],
        upscale_model: ['UPSCALE_MODEL'],
        scale_by: ['FLOAT', { default: 1.5, min: 0.01, max: 8.0 }],
        method: [['nearest', 'bilinear', 'area']],
      },
      optional: { mask: ['MASK'] },
    },
    output: ['IMAGE'],
    output_name: ['IMAGE'],
  }
  it('linkInputPorts keeps link types, drops widgets and enums, and tags optional inputs', () => {
    expect(linkInputPorts(info)).toEqual([
      { name: 'image', type: 'IMAGE' },
      { name: 'upscale_model', type: 'UPSCALE_MODEL' },
      { name: 'mask', type: 'MASK', optional: true }, // from the optional dict
    ])
  })
  it('linkInputPorts honors forceInput on scalar types', () => {
    const i2 = { input: { required: { seed: ['INT', { forceInput: true }] } } }
    expect(linkInputPorts(i2)).toEqual([{ name: 'seed', type: 'INT' }])
  })
  it('outputPorts uses output_name when present', () => {
    expect(outputPorts(info)).toEqual([{ name: 'IMAGE', type: 'IMAGE' }])
  })
})
