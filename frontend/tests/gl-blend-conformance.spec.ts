import { test, expect } from '@playwright/test'
import { PNG } from 'pngjs'
import { blendChannel } from '../shared/timeline/blendModes'
import type { BlendMode } from '../shared/timeline/types'

// GLSL ↔ TS blend conformance over the full 8-bit (base, top) grid, through
// the REAL GlRenderer layer pass. The TS reference itself mirrors Python
// _blend_np (vitest: blend-modes.unit.spec.ts) — together: Python ↔ TS ↔ GLSL.

const MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'soft_light',
  'hard_light', 'difference', 'lighten', 'darken', 'add',
]
const SIZE = 256
// 8-bit quantization happens twice (FBO write after base pass, final write):
// allow 2 LSB. Anything beyond that is a real formula/orientation bug.
const TOL = 2 / 255

test('GLSL blend modes match the TS reference grid', async ({ page }) => {
  await page.goto('/gl-conformance')
  await page.waitForFunction(() => !!(window as any).__glConformance, { timeout: 10_000 })

  for (const mode of MODES) {
    const dataUrl: string = await page.evaluate((m) => (window as any).__glConformance.run(m), mode)
    const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
    expect(png.width).toBe(SIZE)

    let worst = 0
    let worstAt = ''
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const a = x / 255
        const b = y / 255
        const want = blendChannel(a, b, mode)
        const got = png.data[(y * SIZE + x) * 4]! / 255 // gray ramps: R==G==B
        const d = Math.abs(got - want)
        if (d > worst) {
          worst = d
          worstAt = `a=${x}/255 b=${y}/255 got=${got.toFixed(4)} want=${want.toFixed(4)}`
        }
      }
    }
    expect(worst, `${mode} worst ${worstAt}`).toBeLessThanOrEqual(TOL)
  }
})
