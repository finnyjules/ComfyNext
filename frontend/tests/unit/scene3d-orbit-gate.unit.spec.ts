import { describe, it, expect } from 'vitest'
import { orbitShouldBeEnabled } from '~/lib/scene3d/interaction'

// Covers the decision that was wrong: orbit must be enabled only when NEITHER
// lock is held. SceneInteraction itself needs a live DOM/WebGL context and is
// not unit-testable here, so this exercises the extracted pure predicate its
// private updateOrbitEnabled() calls.
describe('orbitShouldBeEnabled', () => {
  it('is enabled when nothing holds a lock', () => {
    expect(orbitShouldBeEnabled(false, false)).toBe(true)
  })

  it('is disabled while camera motion is locked', () => {
    expect(orbitShouldBeEnabled(true, false)).toBe(false)
  })

  it('is disabled while a gizmo is being dragged', () => {
    expect(orbitShouldBeEnabled(false, true)).toBe(false)
  })

  it('is disabled when both locks are held', () => {
    expect(orbitShouldBeEnabled(true, true)).toBe(false)
  })
})
