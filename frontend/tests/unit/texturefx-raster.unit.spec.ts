import { describe, expect, it } from 'vitest'
import { rasterSampleUV } from '~/lib/texturefx/raster'

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

describe('rasterSampleUV seamlessness', () => {
  for (const method of ['mirror', 'feather'] as const) {
    it(`${method} sample coord matches opposite edges`, () => {
      for (let i = 0; i <= 10; i++) {
        const t = i / 10
        const [x0] = rasterSampleUV(method, 0, t, 1)
        const [x1] = rasterSampleUV(method, 1, t, 1)
        const [, y0] = rasterSampleUV(method, t, 0, 1)
        const [, y1] = rasterSampleUV(method, t, 1, 1)
        expect(close(x0, x1), `x @ v=${t}`).toBe(true)
        expect(close(y0, y1), `y @ u=${t}`).toBe(true)
      }
    })
  }
  it('mirror is a triangle wave (edges map to 1, centre to 0)', () => {
    expect(close(rasterSampleUV('mirror', 0, 0, 1)[0], 1)).toBe(true)
    expect(close(rasterSampleUV('mirror', 0.5, 0.5, 1)[0], 0)).toBe(true)
  })
  it('scale: at u=0.5 the sample is the image centre regardless of scale', () => {
    expect(close(rasterSampleUV('feather', 0.5, 0.5, 2)[0], rasterSampleUV('feather', 0.5, 0.5, 1)[0])).toBe(true)
  })
})
