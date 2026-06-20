import { describe, it, expect } from 'vitest'
import { SPACE_TYPE_EFFECTS } from '../../app/lib/spacetype/effects'
import { SPACE_TYPE_SECTIONS } from '../../app/lib/spacetype/sections'

// The Type Studio panel (SpaceTypeSurface) renders control sections by filtering each effect's
// controls against SPACE_TYPE_SECTIONS. A control whose `group` isn't listed is SILENTLY hidden.
// This guards that every registered effect only uses renderable groups, so the bug that hid the
// Contour/Tunnel 'Layers' section can't recur.
describe('every effect control group is renderable by SpaceTypeSurface', () => {
  const allowed = new Set<string>(SPACE_TYPE_SECTIONS)

  it('SPACE_TYPE_SECTIONS has no duplicates', () => {
    expect(allowed.size).toBe(SPACE_TYPE_SECTIONS.length)
  })

  for (const effect of SPACE_TYPE_EFFECTS) {
    it(`${effect.id}: all control groups are in SPACE_TYPE_SECTIONS`, () => {
      for (const c of effect.controls) {
        // The surface maps a missing group to 'Other' (`c.group ?? 'Other'`), which is NOT a
        // section — so an ungrouped control is hidden too, and must fail this guard.
        const group = c.group ?? 'Other'
        expect(
          allowed.has(group),
          `effect "${effect.id}" control "${c.key}" uses group "${group}", which is not in SPACE_TYPE_SECTIONS — its whole section would be hidden in the panel`,
        ).toBe(true)
      }
    })
  }
})
