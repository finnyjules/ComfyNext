import { describe, it, expect } from 'vitest'
import { getFillBitmap, ensureFillBitmaps } from '~/lib/paint/imageFillCache'

// Node env: no `window`, so ensureFillBitmaps is a no-op and nothing decodes.
describe('imageFillCache', () => {
  it('getFillBitmap returns null for an unknown src', () => {
    expect(getFillBitmap('/view?filename=nope.png&type=input')).toBeNull()
  })

  it('ensureFillBitmaps resolves and is a no-op without a DOM', async () => {
    await expect(ensureFillBitmaps(['/view?filename=a.png&type=input', ''])).resolves.toBeUndefined()
    expect(getFillBitmap('/view?filename=a.png&type=input')).toBeNull()
  })
})
