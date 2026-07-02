import { describe, expect, it } from 'vitest'
import { usePendingTrainerSeed } from '~/composables/usePendingTrainerSeed'

describe('usePendingTrainerSeed', () => {
  it('set() then consume() returns the seed once, then null', () => {
    const { set, consume } = usePendingTrainerSeed()
    expect(consume()).toBeNull()

    set({
      kind: 'character',
      name: 'Vera',
      trigger: 'vera_char',
      refViewUrls: ['/view?filename=v1.png&type=input', '/view?filename=v2.png&type=input'],
    })

    const seed = consume()
    expect(seed).toEqual({
      kind: 'character',
      name: 'Vera',
      trigger: 'vera_char',
      refViewUrls: ['/view?filename=v1.png&type=input', '/view?filename=v2.png&type=input'],
    })

    // Consuming clears it — a second call returns null.
    expect(consume()).toBeNull()
  })

  it('is a module-level singleton — different call sites share the same pending seed', () => {
    const writer = usePendingTrainerSeed()
    const reader = usePendingTrainerSeed()

    writer.set({ kind: 'character', name: 'Ada', refViewUrls: [] })
    expect(reader.consume()).toEqual({ kind: 'character', name: 'Ada', refViewUrls: [] })
  })

  it('a later set() overwrites an unconsumed seed', () => {
    const { set, consume } = usePendingTrainerSeed()
    set({ kind: 'character', name: 'First', refViewUrls: [] })
    set({ kind: 'character', name: 'Second', refViewUrls: [] })
    expect(consume()?.name).toBe('Second')
    expect(consume()).toBeNull()
  })

  it('set() bumps seedVersion each call', () => {
    const { set, seedVersion } = usePendingTrainerSeed()
    const initial = seedVersion.value
    set({ kind: 'character', name: 'Test1', refViewUrls: [] })
    expect(seedVersion.value).toBe(initial + 1)
    set({ kind: 'character', name: 'Test2', refViewUrls: [] })
    expect(seedVersion.value).toBe(initial + 2)
  })

  it('consume-after-set returns the seed once then null', () => {
    const { set, consume, seedVersion } = usePendingTrainerSeed()
    const vBefore = seedVersion.value
    set({ kind: 'character', name: 'Test', refViewUrls: [] })
    expect(seedVersion.value).toBe(vBefore + 1)

    const seed = consume()
    expect(seed?.name).toBe('Test')

    // Consuming clears it — subsequent consume returns null
    expect(consume()).toBeNull()
    // seedVersion does not change on consume, only on set
    expect(seedVersion.value).toBe(vBefore + 1)
  })
})
