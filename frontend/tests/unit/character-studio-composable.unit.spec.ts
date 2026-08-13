import { describe, it, expect } from 'vitest'
import { partialResultPatch, shouldAutoReady } from '~/composables/useCharacterStudio'
import { freshTiles } from '~/lib/characters/stress'

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
