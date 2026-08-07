import { describe, it, expect } from 'vitest'
import { resolveStatus } from '~/lib/studio/footer'

describe('resolveStatus', () => {
  it('returns null when nothing is set', () => {
    expect(resolveStatus()).toBeNull()
    expect(resolveStatus({})).toBeNull()
  })
  it('error wins over saved and saving', () => {
    expect(resolveStatus({ error: 'Boom', saved: true, saving: true }))
      .toEqual({ text: 'Boom', tone: 'error' })
  })
  it('saving wins over saved', () => {
    expect(resolveStatus({ saving: true, saved: true })).toEqual({ text: 'Saving…', tone: 'saving' })
  })
  it('saved shows the check', () => {
    expect(resolveStatus({ saved: true })).toEqual({ text: 'Saved ✓', tone: 'saved' })
  })
})
