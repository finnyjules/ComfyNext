import { describe, it, expect } from 'vitest'
import { assembleAesthetic } from '~/lib/lora/aesthetic'

describe('assembleAesthetic', () => {
  it('joins prose and keywords in the Krea shape', () => {
    expect(assembleAesthetic('Moody grain.', ['teal', 'soft light']))
      .toBe('Moody grain.\n\nteal, soft light')
  })

  it('returns prose only when there are no keywords', () => {
    expect(assembleAesthetic('  Moody grain.  ', [])).toBe('Moody grain.')
  })

  it('returns keywords only when prose is empty (no leading newlines)', () => {
    expect(assembleAesthetic('', ['teal', 'grain'])).toBe('teal, grain')
  })

  it('preserves the given keyword order (caller shuffles)', () => {
    expect(assembleAesthetic('P.', ['c', 'a', 'b'])).toBe('P.\n\nc, a, b')
  })
})
