import { describe, expect, it } from 'vitest'
import { readiness } from '~/lib/characters/readiness'

const base = { status: 'draft' as const, sheetImage: null, stressResult: null }

describe('readiness', () => {
  it('locked → Ready/blue regardless of other fields', () => {
    expect(readiness({ ...base, status: 'locked', sheetImage: 's.png', stressResult: { passes: 10, total: 10, at: 't' } }))
      .toEqual({ key: 'ready', label: 'Ready', tone: 'blue' })
  })
  it('no sheet → Not built/grey (even while testing)', () => {
    expect(readiness(base)).toEqual({ key: 'not-built', label: 'Not built', tone: 'grey' })
    expect(readiness({ ...base, status: 'testing' })).toEqual({ key: 'not-built', label: 'Not built', tone: 'grey' })
  })
  it('sheet, draft → Not tested/grey', () => {
    expect(readiness({ ...base, sheetImage: 's.png' })).toEqual({ key: 'not-tested', label: 'Not tested', tone: 'grey' })
  })
  it('testing with a partial result → N/10 poses, amber', () => {
    expect(readiness({ ...base, status: 'testing', sheetImage: 's.png', stressResult: { passes: 6, total: 10, at: 't' } }))
      .toEqual({ key: 'partial', label: '6/10 poses', tone: 'amber' })
  })
  it('testing without a saved result → Not tested (no fake numbers)', () => {
    expect(readiness({ ...base, status: 'testing', sheetImage: 's.png' }))
      .toEqual({ key: 'not-tested', label: 'Not tested', tone: 'grey' })
  })
  it('never emits machine words', () => {
    for (const s of [base, { ...base, sheetImage: 's.png' }, { ...base, status: 'testing' as const, sheetImage: 's.png' }]) {
      expect(readiness(s).label).not.toMatch(/lock|draft|stress|variant/i)
    }
  })
})
