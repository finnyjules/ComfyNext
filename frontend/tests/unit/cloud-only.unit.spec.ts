import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isPoolEligible } from '~/lib/graph/cloudOnly'
import type { ApiPrompt } from '~/lib/graph/graphToPrompt'

const goldenPromptPath = fileURLToPath(
  new URL('./__fixtures__/golden/txt2img-seed-control.prompt.json', import.meta.url),
)
const goldenTxt2Img: ApiPrompt = JSON.parse(readFileSync(goldenPromptPath, 'utf-8'))

// Minimal objectInfo stand-in: only `category` is consulted by isPoolEligible.
const objectInfo: Record<string, any> = {
  CheckpointLoaderSimple: { category: 'loaders' },
  KSampler: { category: 'sampling' },
  VAEDecode: { category: 'latent' },
  SaveImage: { category: 'image' },
  LoadImage: { category: 'image' },
  PreviewImage: { category: 'image' },
  EmptyImage: { category: 'image' },
  ImageBatch: { category: 'image' },
  SaveImageWebsocket: { category: 'api/image' },
  ComfyGateNode: { category: 'logic' },
  FluxProRemoteNode: { category: 'api node/image/Replicate' },
  PersonSwap: { category: 'api node/image/Replicate' },
  OpenAIImage: { category: 'api node/image/OpenAI' },
}

describe('isPoolEligible', () => {
  it('is eligible when every node is cloud-billed', () => {
    const prompt: ApiPrompt = {
      1: { class_type: 'FluxProRemoteNode', inputs: {} },
      2: { class_type: 'OpenAIImage', inputs: {} },
    }
    expect(isPoolEligible(prompt, objectInfo)).toBe(true)
  })

  it('is eligible when cloud nodes are mixed with utility-safe nodes', () => {
    const prompt: ApiPrompt = {
      1: { class_type: 'LoadImage', inputs: {} },
      2: { class_type: 'PersonSwap', inputs: {} },
      3: { class_type: 'SaveImage', inputs: {} },
    }
    expect(isPoolEligible(prompt, objectInfo)).toBe(true)
  })

  it('is ineligible when a GPU-shaped sampling node (KSampler) is present', () => {
    const prompt: ApiPrompt = {
      1: { class_type: 'FluxProRemoteNode', inputs: {} },
      2: { class_type: 'KSampler', inputs: {} },
    }
    expect(isPoolEligible(prompt, objectInfo)).toBe(false)
  })

  it('is ineligible when a class_type is known to objectInfo but neither cloud nor utility-safe', () => {
    const prompt: ApiPrompt = {
      1: { class_type: 'FluxProRemoteNode', inputs: {} },
      2: { class_type: 'SomeRandomLocalNode', inputs: {} },
    }
    expect(isPoolEligible(prompt, {
      ...objectInfo,
      SomeRandomLocalNode: { category: 'utils' },
    })).toBe(false)
  })

  it('is ineligible when a class_type is missing from objectInfo entirely', () => {
    const prompt: ApiPrompt = {
      1: { class_type: 'FluxProRemoteNode', inputs: {} },
      2: { class_type: 'NotInObjectInfo', inputs: {} },
    }
    expect(isPoolEligible(prompt, objectInfo)).toBe(false)
  })

  it('is ineligible for an empty prompt', () => {
    expect(isPoolEligible({}, objectInfo)).toBe(false)
  })

  it('rejects the golden txt2img-seed-control fixture (local KSampler pipeline)', () => {
    expect(isPoolEligible(goldenTxt2Img, objectInfo)).toBe(false)
  })

  it('is eligible when real artifact sink Image node is the final output', () => {
    const prompt: ApiPrompt = {
      1: { class_type: 'EmptyImage', inputs: {} },
      2: { class_type: 'Image', inputs: { image: ['1', 0] } },
    }
    expect(isPoolEligible(prompt, {
      ...objectInfo,
      Image: { category: 'image' },
    })).toBe(true)
  })
})
