import { describe, it, expect } from 'vitest'
import { layerLabels } from '../../app/lib/gradientfx/layerLabel'
import { defaultConfig } from '../../app/lib/gradientfx/randomize'
import { ensureConfigDefaults } from '../../app/lib/gradientfx/types'

const cfg = (): any => ensureConfigDefaults(defaultConfig() as any)

/** Build a config with `n` layers whose shape types are given. */
function withShapes(...types: string[]): any {
  const c = cfg()
  const proto = c.layers[0]
  c.layers = types.map((t) => {
    const l = JSON.parse(JSON.stringify(proto))
    l.shape.type = t
    return l
  })
  return c
}

describe('layerLabels', () => {
  it('names a layer after its shape kind, not its position', () => {
    expect(layerLabels(withShapes('wave'))).toEqual(['Wave'])
    expect(layerLabels(withShapes('bands'))).toEqual(['Bands'])
    expect(layerLabels(withShapes('noise'))).toEqual(['Noise'])
    expect(layerLabels(withShapes('pyramid'))).toEqual(['Pyramid'])
  })

  it('gives distinct shapes distinct names', () => {
    expect(layerLabels(withShapes('wave', 'bands'))).toEqual(['Wave', 'Bands'])
  })

  it('disambiguates repeats with an ordinal so labels stay unique', () => {
    // Uniqueness matters: animatableTargets builds motion-dropdown labels from
    // these, and a duplicate would make two different targets indistinguishable.
    expect(layerLabels(withShapes('wave', 'wave', 'wave'))).toEqual(['Wave', 'Wave 2', 'Wave 3'])
  })

  it('numbers only the kind that repeats', () => {
    expect(layerLabels(withShapes('wave', 'bands', 'wave'))).toEqual(['Wave', 'Bands', 'Wave 2'])
  })

  it('names every layer Liquid in the liquid layout, since shape does not apply', () => {
    const c = withShapes('wave', 'bands')
    c.canvas.layout = 'liquid'
    expect(layerLabels(c)).toEqual(['Liquid', 'Liquid 2'])
  })

  it('names layer 0 Mesh in the mesh layout and leaves the rest on their shape', () => {
    const c = withShapes('wave', 'bands')
    c.canvas.layout = 'mesh'
    expect(layerLabels(c)).toEqual(['Mesh', 'Bands'])
  })

  it('follows the layer when the stack is reordered, unlike a positional name', () => {
    const c = withShapes('wave', 'noise')
    expect(layerLabels(c)).toEqual(['Wave', 'Noise'])
    c.layers.reverse()
    expect(layerLabels(c)).toEqual(['Noise', 'Wave'])
  })

  it('always returns one label per layer', () => {
    for (const n of [1, 2, 6]) {
      const c = withShapes(...Array(n).fill('bands'))
      expect(layerLabels(c)).toHaveLength(n)
    }
  })

  it('falls back to a positional name when the shape kind is unrecognised', () => {
    const c = withShapes('wave')
    delete c.layers[0].shape.type
    expect(layerLabels(c)).toEqual(['Layer 1'])
  })
})
