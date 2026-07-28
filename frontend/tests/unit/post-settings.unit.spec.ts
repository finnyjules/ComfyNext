import { describe, it, expect } from 'vitest'
import { DEFAULT_POST, postEnabled } from '~/lib/spacetype/post'

describe('post settings', () => {
  it('defaults every effect to off', () => {
    expect(postEnabled(DEFAULT_POST)).toBe(false)
  })
  it('film defaults to off but is present, so the tolerant Space Type spread picks it up', () => {
    expect(DEFAULT_POST.film).toBe(false)
    expect(typeof DEFAULT_POST.filmIntensity).toBe('number')
  })
  it('postEnabled reports true when ONLY film is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, film: true })).toBe(true)
  })
})
