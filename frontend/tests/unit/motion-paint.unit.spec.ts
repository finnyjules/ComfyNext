// frontend/tests/unit/motion-paint.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { composeEffectiveLayer } from '../../app/lib/motion/paint'
import { createRectLayer } from '../../app/composables/useCompositorLayers'
import { IDENTITY_UNIT } from '../../app/lib/motion/evaluate'

describe('composeEffectiveLayer', () => {
  const base = createRectLayer({ x: 0.5, y: 0.5, rotation: 10, opacity: 0.8, w: 0.2, h: 0.1 })
  it('identity state returns equivalent transform values', () => {
    const eff = composeEffectiveLayer(base, { visible: true, layer: IDENTITY_UNIT, units: [IDENTITY_UNIT] }, 1000, 1000)
    expect(eff.x).toBeCloseTo(0.5, 6)
    expect(eff.opacity).toBeCloseTo(0.8, 6)
    expect(eff.rotation).toBeCloseTo(10, 6)
  })
  it('keyframe layer state offsets x/y in canvas units and multiplies opacity', () => {
    const eff = composeEffectiveLayer(base, {
      visible: true,
      layer: { ...IDENTITY_UNIT, dx: 0.1, dy: -0.2, opacity: 0.5, rotation: 5 },
      units: [IDENTITY_UNIT],
    }, 1000, 1000)
    expect(eff.x).toBeCloseTo(0.6, 6)
    expect(eff.y).toBeCloseTo(0.3, 6)
    expect(eff.opacity).toBeCloseTo(0.4, 6)
    expect(eff.rotation).toBeCloseTo(15, 6)
  })
  it('whole-layer unit state (non-text) folds into the clone too', () => {
    const eff = composeEffectiveLayer(base, {
      visible: true,
      layer: IDENTITY_UNIT,
      units: [{ ...IDENTITY_UNIT, dy: 0.5, opacity: 0.5 }],
    }, 1000, 1000)
    // dy is in unit-box heights; for non-text the box is the layer's own h (0.1 of W)
    expect(eff.opacity).toBeCloseTo(0.4, 6)
    expect(eff.y).toBeGreaterThan(0.5)
  })
  it('whole-unit dy converts via canvas width (aspect-correct)', () => {
    const st = { visible: true, layer: IDENTITY_UNIT, units: [{ ...IDENTITY_UNIT, dy: 1 }] }
    const wide = composeEffectiveLayer(base, st, 1600, 900)   // boxH=0.1 → dy_norm = 0.1·(1600/900)
    expect(wide.y - 0.5).toBeCloseTo(0.1 * 1600 / 900, 6)
    const square = composeEffectiveLayer(base, st, 1000, 1000)
    expect(square.y - 0.5).toBeCloseTo(0.1, 6)
  })
})
