import { describe, it, expect } from 'vitest'
import { keyToLightTableAction } from '~/lib/artifact/lightTableKeymap'

describe('keyToLightTableAction', () => {
  it('maps the spec keys', () => {
    expect(keyToLightTableAction({ key: 'ArrowRight' })).toEqual({ type: 'move', dx: 1, dy: 0 })
    expect(keyToLightTableAction({ key: 'ArrowDown' })).toEqual({ type: 'move', dx: 0, dy: 1 })
    expect(keyToLightTableAction({ key: 'Enter' })).toEqual({ type: 'setActive' })
    expect(keyToLightTableAction({ key: 'Enter', metaKey: true })).toEqual({ type: 'promote' })
    expect(keyToLightTableAction({ key: 'p' })).toEqual({ type: 'pin' })
    expect(keyToLightTableAction({ key: 'x' })).toEqual({ type: 'discard' })
    expect(keyToLightTableAction({ key: ' ' })).toEqual({ type: 'lightbox' })
    expect(keyToLightTableAction({ key: 'Escape' })).toEqual({ type: 'close' })
    expect(keyToLightTableAction({ key: 'q' })).toBeNull()
  })
})
