import { describe, it, expect } from 'vitest'
import { buildConfig } from '../../app/lib/gradientfx/randomize'

// Regression: randomize/re-roll used to apply a random hueRotate (30%) and hueDrift
// (35%) to a layer's colours. Because the colour-stop swatches show the RAW hex and
// never apply the hue transform, a randomized gradient's picker "lied" — you saw blue
// stops but the render was green. Randomize now never applies a hue shift, so the
// swatches always match the render.
describe('randomize never applies a surprise hue shift', () => {
  it('buildConfig produces hueRotate 0 and hueDrift 0 on every layer, across many seeds', () => {
    for (let s = 0; s < 60; s++) {
      const cfg = buildConfig(`#seed${s}`)
      for (const L of cfg.layers) {
        expect(L.color.hueRotate, `seed ${s}`).toBe(0)
        expect(L.color.hueDrift, `seed ${s}`).toBe(0)
      }
    }
  })
})
