import { describe, it, expect } from 'vitest'
import { partialResultPatch, shouldAutoReady, clearStressTiles, stressTiles, buildSourceDescriptor, buildSourceBodyPhrase } from '~/composables/useCharacterStudio'
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

describe('buildSourceDescriptor (feeds buildSource\'s SheetSource.descriptor — wardrobe ONLY, never the body phrase)', () => {
  it('trims and returns the variant descriptor', () => {
    const variant = { descriptor: '  soaked jacket  ' } as CharacterState
    expect(buildSourceDescriptor(variant)).toBe('soaked jacket')
  })

  it('empty descriptor yields undefined, matching the prior `descriptor || undefined` behavior', () => {
    const variant = { descriptor: '' } as CharacterState
    expect(buildSourceDescriptor(variant)).toBeUndefined()
  })

  it('whitespace-only descriptor yields undefined', () => {
    const variant = { descriptor: '   ' } as CharacterState
    expect(buildSourceDescriptor(variant)).toBeUndefined()
  })
})

describe('buildSourceBodyPhrase (feeds buildSource\'s SheetSource.bodyPhrase — kept OUT of the wardrobe descriptor)', () => {
  it('returns the graded body phrase when bodyShape is set', () => {
    const c = { bodyShape: { build: 0.8 } } as CharacterRecord
    expect(buildSourceBodyPhrase(c)).toBe('a noticeably heavyset build')
  })

  it('null bodyShape yields undefined', () => {
    const c = { bodyShape: null } as CharacterRecord
    expect(buildSourceBodyPhrase(c)).toBeUndefined()
  })

  it('neutral bodyShape (dead-zone sliders) yields undefined', () => {
    const c = { bodyShape: { build: 0.5 } } as CharacterRecord
    expect(buildSourceBodyPhrase(c)).toBeUndefined()
  })
})
