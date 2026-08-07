import { describe, expect, it } from 'vitest'
import { sectionIds, activeSection } from '../../app/lib/taste/moodboardModal'

// The modal's floating nav tracks scroll via IntersectionObserver; these pure
// helpers decide which nav item is active from the observed visibility states.

describe('moodboard modal activeSection', () => {
  it('exposes the document sections in reading order', () => {
    expect(sectionIds).toEqual(['board', 'reading', 'palette', 'avoids'])
  })

  it('first visible section wins when several are on screen', () => {
    expect(activeSection([
      { id: 'board', visible: false },
      { id: 'reading', visible: true },
      { id: 'palette', visible: true },
      { id: 'avoids', visible: false },
    ], 'board')).toBe('reading')
  })

  it('respects document order even when states arrive shuffled (broken control: an unsorted first-match would return "palette")', () => {
    expect(activeSection([
      { id: 'palette', visible: true },
      { id: 'board', visible: false },
      { id: 'reading', visible: true },
    ], 'board')).toBe('reading')
  })

  it('none visible falls back to the previous active section', () => {
    expect(activeSection([
      { id: 'board', visible: false },
      { id: 'reading', visible: false },
    ], 'palette')).toBe('palette')
    // …and to the first section when there is no previous yet.
    expect(activeSection([], undefined)).toBe('board')
  })
})
