import { describe, it, expect } from 'vitest'
import { layerLabels } from '../../app/lib/gradientfx/layerLabel'
import { defaultConfig } from '../../app/lib/gradientfx/randomize'
import { ensureConfigDefaults, type LayoutKind } from '../../app/lib/gradientfx/types'

const cfg = (): any => ensureConfigDefaults(defaultConfig() as any)

/** Build a config with `n` layers whose per-layer effective layouts are given.
 *  A layout matching canvas.layout is left as an inherit (no `layout` field);
 *  a different one is set as a per-layer override. */
function withLayouts(canvasLayout: LayoutKind, ...perLayer: LayoutKind[]): any {
  const c = cfg()
  c.canvas.layout = canvasLayout
  const proto = c.layers[0]
  c.layers = perLayer.map((lo) => {
    const l = JSON.parse(JSON.stringify(proto))
    if (lo !== canvasLayout) l.layout = lo
    else delete l.layout
    return l
  })
  return c
}

describe('layerLabels — named by layout type', () => {
  it('names a layer after its gradient layout, not its shape or position', () => {
    expect(layerLabels(withLayouts('ramp', 'ramp'))).toEqual(['Linear'])
    expect(layerLabels(withLayouts('radialRamp', 'radialRamp'))).toEqual(['Radial'])
    expect(layerLabels(withLayouts('conic', 'conic'))).toEqual(['Conic'])
    expect(layerLabels(withLayouts('curve', 'curve'))).toEqual(['Curve'])
    expect(layerLabels(withLayouts('linear', 'linear'))).toEqual(['Linear stripes'])
  })

  it('reflects a per-layer layout override', () => {
    // canvas is ramp (Linear); layer 1 overrides to radialRamp (Radial)
    expect(layerLabels(withLayouts('ramp', 'ramp', 'radialRamp'))).toEqual(['Linear', 'Radial'])
  })

  it('gives distinct layouts distinct names', () => {
    expect(layerLabels(withLayouts('ramp', 'ramp', 'curve', 'conic'))).toEqual(['Linear', 'Curve', 'Conic'])
  })

  it('disambiguates repeats with an ordinal so labels stay unique', () => {
    // animatableTargets builds motion-dropdown labels from these — duplicates would
    // make two different targets indistinguishable.
    expect(layerLabels(withLayouts('curve', 'curve', 'curve', 'curve'))).toEqual(['Curve', 'Curve 2', 'Curve 3'])
  })

  it('numbers only the layout that repeats', () => {
    expect(layerLabels(withLayouts('ramp', 'ramp', 'radialRamp', 'ramp'))).toEqual(['Linear', 'Radial', 'Linear 2'])
  })

  it('labels liquid and mesh layouts by name', () => {
    expect(layerLabels(withLayouts('liquid', 'liquid'))).toEqual(['Liquid'])
    expect(layerLabels(withLayouts('mesh', 'mesh'))).toEqual(['Mesh'])
  })

  it('follows the layer when the stack is reordered', () => {
    const c = withLayouts('ramp', 'ramp', 'curve')
    expect(layerLabels(c)).toEqual(['Linear', 'Curve'])
    c.layers.reverse()
    expect(layerLabels(c)).toEqual(['Curve', 'Linear'])
  })

  it('always returns one label per layer', () => {
    for (const n of [1, 2, 6]) {
      const c = withLayouts('ramp', ...Array(n).fill('ramp'))
      expect(layerLabels(c)).toHaveLength(n)
    }
  })
})
