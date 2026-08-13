import { describe, expect, it, vi } from 'vitest'
import { emitCharacterEvent, onCharacterEvent } from '~/lib/characters/bus'

describe('character bus', () => {
  it('delivers a payload to a subscriber', () => {
    const fn = vi.fn()
    onCharacterEvent('uncastCharacter', fn)
    emitCharacterEvent('uncastCharacter', { nodeId: 'n1', slug: 'reva' })
    expect(fn).toHaveBeenCalledExactlyOnceWith({ nodeId: 'n1', slug: 'reva' })
  })

  it('subscribe/unsubscribe round-trip: unsubscribed listener receives nothing further', () => {
    const fn = vi.fn()
    const off = onCharacterEvent('castEdgesChanged', fn)
    emitCharacterEvent('castEdgesChanged')
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    emitCharacterEvent('castEdgesChanged')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('supports multiple listeners on the same event, each getting the payload', () => {
    const a = vi.fn()
    const b = vi.fn()
    onCharacterEvent('addCharacterImageGen', a)
    onCharacterEvent('addCharacterImageGen', b)
    emitCharacterEvent('addCharacterImageGen', { slug: 'reva', use: 'sheet' })
    expect(a).toHaveBeenCalledExactlyOnceWith({ slug: 'reva', use: 'sheet' })
    expect(b).toHaveBeenCalledExactlyOnceWith({ slug: 'reva', use: 'sheet' })
  })

  it('unsubscribing one listener leaves the other(s) intact', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onCharacterEvent('addCharacterCastNode', a)
    onCharacterEvent('addCharacterCastNode', b)
    offA()
    emitCharacterEvent('addCharacterCastNode', { slug: 'reva', name: 'Reva', stateId: null })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledExactlyOnceWith({ slug: 'reva', name: 'Reva', stateId: null })
  })

  it('emit with no listeners is a no-op (does not throw)', () => {
    expect(() => emitCharacterEvent('castEdgesChanged')).not.toThrow()
    expect(() => emitCharacterEvent('uncastCharacter', { nodeId: 'x', slug: 'y' })).not.toThrow()
  })

  it('events are independent: emitting one key does not fire listeners on another', () => {
    const onCast = vi.fn()
    const onUncast = vi.fn()
    onCharacterEvent('castEdgesChanged', onCast)
    onCharacterEvent('uncastCharacter', onUncast)
    emitCharacterEvent('castEdgesChanged')
    expect(onCast).toHaveBeenCalledTimes(1)
    expect(onUncast).not.toHaveBeenCalled()
  })
})
