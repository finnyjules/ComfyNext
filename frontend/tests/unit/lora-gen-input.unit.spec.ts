import { describe, it, expect } from 'vitest'
import { buildLoraGenInput } from '../../server/utils/loraGenInput'

describe('buildLoraGenInput', () => {
  it('keeps the existing defaults exactly', () => {
    expect(buildLoraGenInput({ prompt: 'p' })).toEqual({
      prompt: 'p',
      aspect_ratio: '1:1',
      megapixels: '1',
      num_inference_steps: 22,
      guidance_scale: 3.5,
      num_outputs: 1,
      output_format: 'png',
      lora_scale: 1,
    })
  })
  it('passes seed only when finite', () => {
    expect(buildLoraGenInput({ prompt: 'p', seed: 101101 }).seed).toBe(101101)
    expect('seed' in buildLoraGenInput({ prompt: 'p' })).toBe(false)
    expect('seed' in buildLoraGenInput({ prompt: 'p', seed: Number.NaN })).toBe(false)
  })
  it('honors overrides', () => {
    const out = buildLoraGenInput({ prompt: 'p', aspectRatio: '4:3', loraScale: 0.7, guidanceScale: 4 })
    expect(out.aspect_ratio).toBe('4:3')
    expect(out.lora_scale).toBe(0.7)
    expect(out.guidance_scale).toBe(4)
  })
})
