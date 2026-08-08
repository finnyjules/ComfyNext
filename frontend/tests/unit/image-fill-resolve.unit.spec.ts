import { describe, it, expect } from 'vitest'
import type { ImageFill } from '~/lib/compositor/paint'
import { paintToVectorPaint } from '~/lib/paint/toVector'

const img: ImageFill = { type: 'image', src: '/view?filename=a.png&type=input', fit: 'cover' }

describe('ImageFill export', () => {
  it('paintToVectorPaint returns null for an image fill (raster embed is a fast-follow)', () => {
    // Must NOT fall through to the string arm and emit a bogus solid paint.
    expect(paintToVectorPaint(img, { box: { w: 100, h: 100 } } as any)).toBeNull()
  })
})
