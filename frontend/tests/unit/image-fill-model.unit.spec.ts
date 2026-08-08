import { describe, it, expect } from 'vitest'
import { isImageFill, isFill, isGradient, type ImageFill } from '~/lib/compositor/paint'
import { hasPaint } from '~/lib/paint/resolve'

const img: ImageFill = { type: 'image', src: '/view?filename=a.png&type=input', fit: 'cover' }

describe('ImageFill model', () => {
  it('isImageFill matches only an image paint', () => {
    expect(isImageFill(img)).toBe(true)
    expect(isImageFill('#fff')).toBe(false)
    expect(isImageFill({ type: 'linear', angle: 0, stops: [] } as any)).toBe(false)
    expect(isImageFill({ a: '#fff', density: 4, type: 'grid' } as any)).toBe(false)
  })

  it('does not confuse an ImageFill with a Fill or Gradient', () => {
    expect(isFill(img)).toBe(false)
    expect(isGradient(img)).toBe(false)
  })

  it('hasPaint is true only when src is non-empty', () => {
    expect(hasPaint(img)).toBe(true)
    expect(hasPaint({ ...img, src: '' })).toBe(false)
  })
})
