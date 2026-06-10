import { describe, it, expect } from 'vitest'
import { validateSuggestion } from '../../app/lib/portIntentValidate'
import type { PortAnchor } from '../../app/lib/portIntent'

const objectInfo: Record<string, any> = {
  ImageUpscaleWithModel: {
    input: { required: { upscale_model: ['UPSCALE_MODEL'], image: ['IMAGE'] } },
    output: ['IMAGE'], output_name: ['IMAGE'],
  },
  UpscaleModelLoader: {
    input: { required: { model_name: [['4x_esrgan.pth', '4x_ultrasharp.pth']] } },
    output: ['UPSCALE_MODEL'], output_name: ['UPSCALE_MODEL'],
  },
  ImageScaleBy: {
    input: { required: { image: ['IMAGE'], scale_by: ['FLOAT', { default: 1.5, min: 0.01, max: 8.0 }] } },
    output: ['IMAGE'],
  },
}

const outAnchor: PortAnchor = {
  nodeId: '42', nodeType: 'LoadImage', portName: 'IMAGE',
  portType: 'IMAGE', portIndex: 0, direction: 'output',
}

const goodChain = {
  nodes: [
    { id: 'a', type: 'UpscaleModelLoader', widgets: [{ name: 'model_name', value: '4x_esrgan.pth' }] },
    { id: 'b', type: 'ImageUpscaleWithModel', widgets: [] },
  ],
  edges: [
    { from: 'anchor', to: 'b.image' },
    { from: 'a.UPSCALE_MODEL', to: 'b.upscale_model' },
  ],
  note: 'Upscales with ESRGAN',
}

describe('validateSuggestion', () => {
  it('accepts a valid chain and normalizes it', () => {
    const r = validateSuggestion(goodChain, objectInfo, outAnchor)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.nodes).toEqual([
      { localId: 'a', type: 'UpscaleModelLoader', widgetOverrides: { model_name: '4x_esrgan.pth' } },
      { localId: 'b', type: 'ImageUpscaleWithModel', widgetOverrides: {} },
    ])
    expect(r.edges[0]).toEqual({ fromAnchor: true, toId: 'b', toPort: 'image' })
    expect(r.edges[1]).toEqual({ fromId: 'a', fromPort: 'UPSCALE_MODEL', toId: 'b', toPort: 'upscale_model' })
    expect(r.note).toBe('Upscales with ESRGAN')
  })

  it('rejects empty or missing node arrays', () => {
    expect(validateSuggestion({ nodes: [], edges: [], note: '' }, objectInfo, outAnchor).ok).toBe(false)
    expect(validateSuggestion(null, objectInfo, outAnchor).ok).toBe(false)
  })

  it('rejects unknown node types', () => {
    const r = validateSuggestion({ ...goodChain, nodes: [{ id: 'a', type: 'NotANode', widgets: [] }] }, objectInfo, outAnchor)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('NotANode')
  })

  it('rejects edges referencing unknown ports', () => {
    const bad = {
      nodes: [{ id: 'a', type: 'UpscaleModelLoader', widgets: [] }],
      edges: [{ from: 'anchor', to: 'a.nope' }],
      note: '',
    }
    expect(validateSuggestion(bad, objectInfo, outAnchor).ok).toBe(false)
  })

  it('rejects edges connecting incompatible types', () => {
    const bad = {
      nodes: [
        { id: 'a', type: 'UpscaleModelLoader', widgets: [] },
        { id: 'b', type: 'ImageScaleBy', widgets: [] },
      ],
      edges: [
        { from: 'anchor', to: 'b.image' },
        { from: 'a.UPSCALE_MODEL', to: 'b.image' }, // UPSCALE_MODEL → IMAGE mismatch
      ],
      note: '',
    }
    const r = validateSuggestion(bad, objectInfo, outAnchor)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('incompatible')
  })

  it('requires exactly one anchor edge, oriented to the anchor direction', () => {
    const noAnchor = {
      nodes: [{ id: 'a', type: 'ImageScaleBy', widgets: [] }],
      edges: [], note: '',
    }
    expect(validateSuggestion(noAnchor, objectInfo, outAnchor).ok).toBe(false)

    const wrongDir = {
      nodes: [{ id: 'a', type: 'ImageScaleBy', widgets: [] }],
      edges: [{ from: 'a.IMAGE', to: 'anchor' }], note: '',
    }
    expect(validateSuggestion(wrongDir, objectInfo, outAnchor).ok).toBe(false)
  })

  it('silently drops bad widget values and clamps numerics (best-effort)', () => {
    const s = {
      nodes: [{ id: 'a', type: 'ImageScaleBy', widgets: [
        { name: 'scale_by', value: 99 }, // above max → clamp to 8
        { name: 'not_a_widget', value: 'x' }, // unknown → dropped
      ] }],
      edges: [{ from: 'anchor', to: 'a.image' }], note: '',
    }
    const r = validateSuggestion(s, objectInfo, outAnchor)
    expect(r.ok).toBe(true)
    expect(r.nodes[0]!.widgetOverrides).toEqual({ scale_by: 8 })
  })

  it('drops enum values not in the full option list', () => {
    const s = {
      nodes: [{ id: 'a', type: 'UpscaleModelLoader', widgets: [{ name: 'model_name', value: 'fake.pth' }] }],
      edges: [{ from: 'a.UPSCALE_MODEL', to: 'anchor' }], note: '',
    }
    const inAnchor: PortAnchor = { ...outAnchor, direction: 'input', portType: 'UPSCALE_MODEL' }
    const r = validateSuggestion(s, objectInfo, inAnchor)
    expect(r.ok).toBe(true)
    expect(r.nodes[0]!.widgetOverrides).toEqual({})
  })

  it('coerces numeric strings for numeric widgets', () => {
    const s = {
      nodes: [{ id: 'a', type: 'ImageScaleBy', widgets: [{ name: 'scale_by', value: '4' }] }],
      edges: [{ from: 'anchor', to: 'a.image' }], note: '',
    }
    const r = validateSuggestion(s, objectInfo, outAnchor)
    expect(r.ok).toBe(true)
    expect(r.nodes[0]!.widgetOverrides).toEqual({ scale_by: 4 })
  })
})
