import { describe, it, expect } from 'vitest'
import {
  MODEL_PRICED_BADGE_CLASSES,
  modelPricedUsd,
  nodeCreditEstimate,
} from '~/lib/nodeCreditEstimate'
import { creditsForUsd } from '~/lib/pricing'
import { IMAGE_MODELS } from '~/data/image-models'
import { VIDEO_MODEL_USD } from '~/data/video-prices'
import { ENGINE_USD } from '~/data/engine-prices'
import { MODEL_PRICED_NODE_CLASSES, priceGraph } from '../../server/utils/priceBook'

// The hosted node badge must price a model-picker node from the model the user
// actually picked, not from the static price_badge string baked into the Python
// schema — those diverge by up to 8x across a picker's model range. These
// assertions mirror server/utils/priceBook.ts's graphNodeModelCredits: same
// catalogs, same legacy remaps, same markup policy, plus the 1cr base_render
// the graph pricer adds for the render itself.
const BASE_RENDER = 1

describe('MODEL_PRICED_BADGE_CLASSES', () => {
  it('covers exactly the five picker classes the server prices by model', () => {
    expect([...MODEL_PRICED_BADGE_CLASSES].sort()).toEqual([
      'EnhanceDetailNode',
      'FilmShotNode',
      'GenerateImageNode',
      'GenerateVideoNode',
      'UpscaleImageNode',
    ])
  })

  it('is the same set the server price book prices by model', () => {
    expect([...MODEL_PRICED_BADGE_CLASSES].sort()).toEqual([...MODEL_PRICED_NODE_CLASSES].sort())
  })
})

// The gate this whole helper exists for: what the badge PROMISES must equal
// what the server CHARGES for the same node at the same model. Compare against
// priceGraph itself (a one-node graph with a SaveImage sink, so base_render is
// in both figures) rather than re-deriving the number a second way.
describe('badge ↔ server price parity', () => {
  const cases: [string, string][] = [
    ['GenerateImageNode', 'flux-2-pro'],
    ['GenerateImageNode', 'seedream-4.5'],
    ['GenerateVideoNode', 'veo-3.1'],
    ['GenerateVideoNode', 'ltx-video'],
    ['GenerateVideoNode', 'Seedance 2.0'],
    ['FilmShotNode', 'kling-v3'],
    ['UpscaleImageNode', 'Clarity'],
    ['UpscaleImageNode', 'Recraft Crisp'],
    ['EnhanceDetailNode', 'Diffusion Refine'],
  ]

  for (const [nodeType, model] of cases) {
    it(`${nodeType} @ ${model} quotes exactly what priceGraph charges`, () => {
      const server = priceGraph({
        '1': { class_type: nodeType, inputs: { model } },
        '2': { class_type: 'SaveImage', inputs: {} },
      })
      expect(nodeCreditEstimate(nodeType, model)).toBe(server.credits)
    })
  }
})

describe('modelPricedUsd — image models', () => {
  it('reads pricePerImage off the image catalog by model id', () => {
    const priced = IMAGE_MODELS.find(m => typeof m.pricePerImage === 'number')!
    expect(modelPricedUsd('GenerateImageNode', priced.id)).toBe(priced.pricePerImage)
  })

  it('returns null for an unknown model id', () => {
    expect(modelPricedUsd('GenerateImageNode', 'not-a-real-model')).toBeNull()
  })

  it('returns null for a catalog model with no listed price', () => {
    const unpriced = IMAGE_MODELS.find(m => m.pricePerImage == null)
    if (unpriced) expect(modelPricedUsd('GenerateImageNode', unpriced.id)).toBeNull()
  })
})

describe('modelPricedUsd — video models', () => {
  it('prices GenerateVideoNode and FilmShotNode off the same video table', () => {
    expect(modelPricedUsd('GenerateVideoNode', 'veo-3.1')).toBe(VIDEO_MODEL_USD['veo-3.1']!.usd)
    expect(modelPricedUsd('FilmShotNode', 'ltx-video')).toBe(VIDEO_MODEL_USD['ltx-video']!.usd)
  })

  it('honours the legacy model-label remap the node applies at execute time', () => {
    expect(modelPricedUsd('GenerateVideoNode', 'Seedance 2.0')).toBe(VIDEO_MODEL_USD['seedance-2.0']!.usd)
    expect(modelPricedUsd('GenerateVideoNode', 'Veo 3')).toBe(VIDEO_MODEL_USD['veo-3.1']!.usd)
    expect(modelPricedUsd('GenerateVideoNode', 'Kling 2.1'))
      .toBe(VIDEO_MODEL_USD['kling-v2.5-turbo-pro']!.usd)
  })

  it('returns null for an unknown video model id', () => {
    expect(modelPricedUsd('GenerateVideoNode', 'veo-99')).toBeNull()
  })
})

describe('modelPricedUsd — engine pickers', () => {
  it('prices each engine off ENGINE_USD keyed by node class', () => {
    expect(modelPricedUsd('UpscaleImageNode', 'Clarity')).toBe(ENGINE_USD.UpscaleImageNode!.Clarity)
    expect(modelPricedUsd('UpscaleImageNode', 'Real-ESRGAN')).toBe(ENGINE_USD.UpscaleImageNode!['Real-ESRGAN'])
    expect(modelPricedUsd('EnhanceDetailNode', 'Faithful')).toBe(ENGINE_USD.EnhanceDetailNode!.Faithful)
  })

  it('returns null for an unknown engine name', () => {
    expect(modelPricedUsd('UpscaleImageNode', 'Sharpener 9000')).toBeNull()
  })
})

describe('modelPricedUsd — non-picker classes and empty values', () => {
  it('returns null for a class that is not model-priced', () => {
    expect(modelPricedUsd('FluxProRemoteNode', 'anything')).toBeNull()
  })

  it('returns null when no model is selected', () => {
    expect(modelPricedUsd('GenerateImageNode', '')).toBeNull()
    expect(modelPricedUsd('GenerateImageNode', undefined)).toBeNull()
    expect(modelPricedUsd('GenerateImageNode', null)).toBeNull()
  })
})

describe('nodeCreditEstimate', () => {
  it('is the model USD through the markup policy plus base_render', () => {
    const usd = VIDEO_MODEL_USD['veo-3.1']!.usd
    expect(nodeCreditEstimate('GenerateVideoNode', 'veo-3.1')).toBe(creditsForUsd(usd) + BASE_RENDER)
  })

  it('separates a cheap engine from an expensive one on the same node', () => {
    const cheap = nodeCreditEstimate('UpscaleImageNode', 'Real-ESRGAN')!
    const dear = nodeCreditEstimate('UpscaleImageNode', 'Clarity')!
    expect(cheap).toBe(creditsForUsd(0.002) + BASE_RENDER)
    expect(dear).toBe(creditsForUsd(0.20) + BASE_RENDER)
    expect(dear).toBeGreaterThan(cheap)
  })

  it('never returns less than the base render for a priced model', () => {
    for (const id of Object.keys(VIDEO_MODEL_USD)) {
      expect(nodeCreditEstimate('GenerateVideoNode', id)!).toBeGreaterThan(BASE_RENDER)
    }
  })

  it('returns null (badge falls back to the static estimate) on anything unknown', () => {
    expect(nodeCreditEstimate('GenerateImageNode', 'nope')).toBeNull()
    expect(nodeCreditEstimate('UpscaleImageNode', undefined)).toBeNull()
    expect(nodeCreditEstimate('SomeOtherNode', 'flux-dev')).toBeNull()
  })
})
