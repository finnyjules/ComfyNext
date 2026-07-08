import { describe, it, expect } from 'vitest'
import { useDraftMode } from '~/composables/useDraftMode'

describe('useDraftMode', () => {
  it('defaults to Final, toggles per tab, isolated between tabs', () => {
    const dm = useDraftMode()
    expect(dm.isDraft('tab-a')).toBe(false)
    dm.toggle('tab-a')
    expect(dm.isDraft('tab-a')).toBe(true)
    expect(dm.isDraft('tab-b')).toBe(false)
    dm.setDraft('tab-a', false)
    expect(dm.isDraft('tab-a')).toBe(false)
  })
})
