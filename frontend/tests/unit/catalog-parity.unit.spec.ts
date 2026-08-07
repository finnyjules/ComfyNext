import { describe, it, expect } from 'vitest'
import { IMAGE_MODELS_BY_ID } from '~/data/image-models'
import { VIDEO_MODELS_BY_ID } from '~/data/video-models'

describe('new model catalog entries', () => {
  it('exposes the Krea 2 image models', () => {
    expect(IMAGE_MODELS_BY_ID['krea-2-large']?.brand).toBe('Krea')
    expect(IMAGE_MODELS_BY_ID['krea-2-medium']?.brand).toBe('Krea')
    expect(IMAGE_MODELS_BY_ID['krea-2-large']?.replicateSlug).toBe('krea/krea-2-large')
  })

  it('exposes flux-2-dev alongside the existing FLUX.2 family', () => {
    for (const id of ['flux-2-pro', 'flux-2-max', 'flux-2-flex', 'flux-2-dev']) {
      expect(IMAGE_MODELS_BY_ID[id], id).toBeTruthy()
    }
  })

  it('exposes FLUX 3 as a t2v+i2v video model', () => {
    const m = VIDEO_MODELS_BY_ID['flux-3']
    expect(m?.brand).toBe('BFL')
    expect(m?.modes).toEqual(['t2v', 'i2v'])
    expect(m?.durations).toContain(20)
  })
})
