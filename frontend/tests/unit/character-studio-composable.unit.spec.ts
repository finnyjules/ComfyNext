import { describe, it, expect } from 'vitest'
import { partialResultPatch, shouldAutoReady, clearStressTiles, stressTiles } from '~/composables/useCharacterStudio'
import { freshTiles } from '~/lib/characters/stress'
import type { CharacterRecord, CharacterState } from '#shared/characters/types'

describe('useCharacterStudio pure helpers', () => {
  it('partialResultPatch: null when nothing judged; counts passes when partial; null when complete', () => {
    expect(partialResultPatch(freshTiles(), 'T')).toBe(null)
    const tiles = freshTiles().map((t, i) => ({ ...t, dataUrl: 'd', pass: i < 6 ? true : i < 8 ? false : null }))
    expect(partialResultPatch(tiles, 'T')).toEqual({ stressResult: { passes: 6, total: 10, at: 'T' } })
    const done = freshTiles().map(t => ({ ...t, dataUrl: 'd', pass: true }))
    expect(partialResultPatch(done, 'T')).toBe(null)
  })
  it('shouldAutoReady mirrors canLock', () => {
    const done = freshTiles().map(t => ({ ...t, dataUrl: 'd', pass: true }))
    expect(shouldAutoReady(done)).toBe(true)
    expect(shouldAutoReady(freshTiles())).toBe(false)
  })
})

describe('clearStressTiles', () => {
  const c = { slug: 'reva' } as CharacterRecord
  const s = { id: 'punk' } as CharacterState
  const key = 'reva:punk'

  it('drops the tile grid for a look\'s vkey, leaving other looks untouched', () => {
    stressTiles.value[key] = freshTiles()
    stressTiles.value['reva:default'] = freshTiles()
    expect(stressTiles.value[key]).toBeDefined()

    clearStressTiles(c, s)

    expect(stressTiles.value[key]).toBeUndefined()
    expect(stressTiles.value['reva:default']).toBeDefined()
    delete stressTiles.value['reva:default']
  })

  it('is a no-op when there is nothing to clear', () => {
    delete stressTiles.value[key]
    expect(() => clearStressTiles(c, s)).not.toThrow()
    expect(stressTiles.value[key]).toBeUndefined()
  })
})
