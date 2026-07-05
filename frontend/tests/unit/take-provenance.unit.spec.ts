import { describe, it, expect } from 'vitest'
import { nodeGenParams } from '~/lib/artifact/takeProvenance'

const node = (widgets: [string, any][], nodeType = 'FluxLoRARemoteNode') => ({
  data: {
    nodeType,
    widgetDefs: widgets.map(([name]) => ({ name })),
    widgetsValues: widgets.map(([, v]) => v),
  },
})

describe('nodeGenParams — take provenance', () => {
  it('captures prompt, seed, model, lora, strength, aspect', () => {
    const p = nodeGenParams(node([
      ['prompt', 'a blonde woman at a bar'],
      ['seed', 123456],
      ['model', 'flux-dev'],
      ['lora_name', 'grand_theft_auto.safetensors'],
      ['lora_strength', 0.85],
      ['aspect_ratio', '1:1'],
    ]))
    expect(p).toMatchObject({
      nodeType: 'FluxLoRARemoteNode',
      prompt: 'a blonde woman at a bar',
      seed: 123456,
      model: 'flux-dev',
      lora_name: 'grand_theft_auto.safetensors',
      lora_strength: 0.85,
      aspect_ratio: '1:1',
    })
  })

  it('prefers the first present prompt-ish key', () => {
    expect(nodeGenParams(node([['text', 'hello']])).prompt).toBe('hello')
    expect(nodeGenParams(node([['positive', 'x'], ['prompt', 'y']])).prompt).toBe('y') // prompt wins by priority
  })

  it('matches a seed widget by name pattern (e.g. noise_seed)', () => {
    expect(nodeGenParams(node([['noise_seed', 42]])).seed).toBe(42)
  })

  it('skips empty / missing values and non-numeric strengths', () => {
    const p = nodeGenParams(node([
      ['prompt', '   '],           // blank → skipped
      ['model', ''],               // empty → skipped
      ['lora_strength', 'high'],   // non-numeric → skipped
    ]))
    expect(p.prompt).toBeUndefined()
    expect(p.model).toBeUndefined()
    expect(p.lora_strength).toBeUndefined()
    expect(p.nodeType).toBe('FluxLoRARemoteNode')
  })

  it('returns just nodeType (or empty) when nothing generative is present', () => {
    expect(nodeGenParams(node([['foo', 1]], 'Image'))).toEqual({ nodeType: 'Image' })
    expect(nodeGenParams(null)).toEqual({})
    expect(nodeGenParams({ data: {} })).toEqual({})
  })
})
