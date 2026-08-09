// Round-2b Task 6 — panel-grouping metadata: STAGING_FAMILIES (declared next
// to STAGINGS in stagings.ts) must stay in sync with the actual registry, or
// LayoutControlsPanel's family sections would silently drop or duplicate a
// staging chip. This is the sync assertion the task brief calls for — every
// registered staging id appears in EXACTLY ONE family.
import { describe, expect, it } from 'vitest'
import { STAGING_FAMILIES, STAGINGS } from '~~/shared/template-grid/generate/stagings'

describe('STAGING_FAMILIES stays in sync with STAGINGS', () => {
  const allFamilyIds = Object.values(STAGING_FAMILIES).flat()

  it('every registered staging id appears in exactly one family', () => {
    for (const s of STAGINGS) {
      const memberships = Object.entries(STAGING_FAMILIES).filter(([, ids]) => ids.includes(s.id))
      expect(memberships.length, `${s.id} should be in exactly one family, found in: ${memberships.map(([f]) => f).join(', ') || '(none)'}`).toBe(1)
    }
  })

  it('no family lists an id that is not actually registered (no stale/typo'
    + ' entries)', () => {
    const registeredIds = new Set(STAGINGS.map(s => s.id))
    for (const [family, ids] of Object.entries(STAGING_FAMILIES)) {
      for (const id of ids) {
        expect(registeredIds.has(id), `${family} lists "${id}", which is not in STAGINGS`).toBe(true)
      }
    }
  })

  it('the family map has no duplicate ids across families', () => {
    expect(new Set(allFamilyIds).size).toBe(allFamilyIds.length)
  })

  it('the family map accounts for every staging (counts match)', () => {
    expect(allFamilyIds.length).toBe(STAGINGS.length)
  })

  // Pins the brief's explicit family membership, not just "sums match" —
  // a swap between two same-size families would pass the count checks above
  // but land a chip in the wrong section.
  it('matches the brief\'s declared family membership', () => {
    expect(STAGING_FAMILIES.Type).toEqual(['statement', 'manifesto', 'index', 'stacked'])
    expect(STAGING_FAMILIES.Photo).toEqual(['tower', 'split', 'frame', 'corner'])
    expect(STAGING_FAMILIES.Field).toEqual(['cover', 'lockup', 'band_header', 'band_footer'])
    expect(STAGING_FAMILIES.Texture).toEqual(['repeat', 'wall'])
  })
})
