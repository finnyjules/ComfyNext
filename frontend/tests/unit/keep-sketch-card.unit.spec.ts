import { describe, it, expect } from 'vitest'
import { stripSketchProperties } from '~/lib/draft/keepSketchCard'

describe('stripSketchProperties', () => {
  it('removes all sketch-identity keys, keeps everything else', () => {
    const r = stripSketchProperties({
      sketchOutput: true,
      sketchSourceId: '123',
      sketchSlot: 2,
      sketchLoading: false,
      sketchPrompt: 'a cat',
      sketchSeed: 42,
      locked: true,
      seedLocks: { seed: true },
    })
    expect(r).toEqual({ locked: true, seedLocks: { seed: true } })
  })

  it('is a no-op on a plain (non-sketch) properties bag', () => {
    expect(stripSketchProperties({ locked: false })).toEqual({ locked: false })
  })

  it('handles undefined/null input', () => {
    expect(stripSketchProperties(undefined)).toEqual({})
    expect(stripSketchProperties(null)).toEqual({})
  })

  it('does not mutate the input object', () => {
    const input = { sketchOutput: true, kept: 1 }
    stripSketchProperties(input)
    expect(input).toEqual({ sketchOutput: true, kept: 1 })
  })
})
