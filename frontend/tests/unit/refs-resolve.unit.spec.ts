import { describe, it, expect } from 'vitest'
import { substituteRefTokens } from '../../app/lib/refs/resolve'
import { setRef, type RefRegistry } from '../../app/lib/refs/registry'

const reg: RefRegistry = setRef(
  setRef({}, 'doue', { filename: 'doue.png', text: 'TOK man' }),
  'tracksuit', { filename: 'suit.png', text: 'black Nike tracksuit' },
)

describe('substituteRefTokens', () => {
  it('replaces @name with the entry text', () => {
    expect(substituteRefTokens('a shot of @doue in @tracksuit', reg))
      .toBe('a shot of TOK man in black Nike tracksuit')
  })
  it('leaves unknown @tokens untouched', () => {
    expect(substituteRefTokens('lit like @greycyc', reg)).toBe('lit like @greycyc')
  })
  it('leaves a known ref that has no text untouched (image-only ref)', () => {
    const r = setRef({}, 'plate', { filename: 'plate.png' })
    expect(substituteRefTokens('use @plate', r)).toBe('use @plate')
  })
  it('is a no-op on strings with no @ tokens', () => {
    expect(substituteRefTokens('plain prompt', reg)).toBe('plain prompt')
  })
  it('handles adjacent punctuation without eating it', () => {
    expect(substituteRefTokens('@doue, centered.', reg)).toBe('TOK man, centered.')
  })
})
