import { describe, it, expect } from 'vitest'
import { fitWithin, TRAIN_MAX_EDGE } from '~/lib/lora/datasetImages'
import { pickDatasetHost, REPLICATE_SAFE_BYTES } from '~~/server/utils/datasetHost'

/**
 * The style trainer used to upload full-resolution camera originals, which blew
 * past h3's multipart parser and then past Replicate's 100 MB files cap. Two
 * decisions keep it under control: shrink to the model's native resolution
 * before zipping, and pick a host that can hold whatever is left.
 */

describe('fitWithin', () => {
  it('shrinks the long edge to the cap and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1024, height: 768, scaled: true })
    expect(fitWithin(3000, 4000)).toEqual({ width: 768, height: 1024, scaled: true })
  })

  it('caps at the model\'s native 1024', () => {
    expect(TRAIN_MAX_EDGE).toBe(1024)
    expect(fitWithin(2048, 2048)).toEqual({ width: 1024, height: 1024, scaled: true })
  })

  it('never upscales a smaller image', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false })
    expect(fitWithin(64, 64)).toEqual({ width: 64, height: 64, scaled: false })
  })

  it('leaves an image already at the cap alone', () => {
    expect(fitWithin(1024, 768)).toEqual({ width: 1024, height: 768, scaled: false })
  })

  it('honours a custom cap', () => {
    expect(fitWithin(4000, 2000, 1536)).toEqual({ width: 1536, height: 768, scaled: true })
  })

  it('rounds to whole pixels and never collapses an edge to zero', () => {
    const r = fitWithin(4001, 3, 1024)
    expect(Number.isInteger(r.width)).toBe(true)
    expect(Number.isInteger(r.height)).toBe(true)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })
})

describe('pickDatasetHost', () => {
  it('keeps small datasets on Replicate\'s auth-gated files API', () => {
    expect(pickDatasetHost(5 * 1024 * 1024, { falAvailable: true })).toEqual({ host: 'replicate' })
    expect(pickDatasetHost(5 * 1024 * 1024, { falAvailable: false })).toEqual({ host: 'replicate' })
  })

  it('sends anything over the Replicate cap to fal instead', () => {
    expect(pickDatasetHost(REPLICATE_SAFE_BYTES + 1, { falAvailable: true })).toEqual({ host: 'fal' })
    expect(pickDatasetHost(400 * 1024 * 1024, { falAvailable: true })).toEqual({ host: 'fal' })
  })

  it('treats the boundary itself as still fitting Replicate', () => {
    expect(pickDatasetHost(REPLICATE_SAFE_BYTES, { falAvailable: true })).toEqual({ host: 'replicate' })
  })

  it('leaves headroom under Replicate\'s documented 100 MB limit', () => {
    expect(REPLICATE_SAFE_BYTES).toBeLessThan(100 * 1024 * 1024)
  })

  it('reports why it cannot host an oversized dataset with no fal key', () => {
    const r = pickDatasetHost(400 * 1024 * 1024, { falAvailable: false })
    expect(r.host).toBe(null)
    expect(r.reason).toMatch(/FAL_KEY/)
  })
})
