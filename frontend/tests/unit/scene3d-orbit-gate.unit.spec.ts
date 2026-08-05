import { describe, it, expect } from 'vitest'
import { orbitShouldBeEnabled, SceneInteraction } from '~/lib/scene3d/interaction'

// Covers the decision that was wrong: orbit must be enabled only when NEITHER
// lock is held. SceneInteraction itself needs a live DOM/WebGL context and is
// not unit-testable here, so this exercises the extracted pure predicate its
// private updateOrbitEnabled() calls.
describe('orbitShouldBeEnabled', () => {
  it('is enabled when nothing holds a lock', () => {
    expect(orbitShouldBeEnabled(false, false, false)).toBe(true)
  })

  it('is disabled while camera motion is locked', () => {
    expect(orbitShouldBeEnabled(true, false, false)).toBe(false)
  })

  it('is disabled while a gizmo is being dragged', () => {
    expect(orbitShouldBeEnabled(false, true, false)).toBe(false)
  })

  it('is disabled when both locks are held', () => {
    expect(orbitShouldBeEnabled(true, true, false)).toBe(false)
  })
})

// The bug that actually shipped was NOT a wrong truth table (the four cases above all still
// pass under it) — it was Scene3DStudioSurface.vue writing `interaction.orbit.enabled` directly
// on every animation frame, which clobbered the gizmo-drag lock's `false` the instant camera
// motion's own lock released. The fix routes every per-frame camera-motion-lock write through
// `SceneInteraction.setCameraLocked`, whose private `updateOrbitEnabled` recomputes from BOTH
// locks (never a raw assignment) — see interaction.ts's field comments on `cameraLocked` /
// `gizmoDragging`. This pins that composition, not just the pure predicate.
describe('SceneInteraction — orbit lock precedence (I6)', () => {
  it('setCameraLocked(false) cannot re-enable orbit while a gizmo drag still holds its own lock', () => {
    // SceneInteraction's constructor needs a live DOM/WebGL context — `new OrbitControls(...)`
    // and `new TransformControls(...)` both require a real canvas element, which vitest's node
    // environment (this repo's unit-test environment; no DOM, no WebGL) can't provide, so the
    // class can't be `new`'d here. Instead this calls the REAL prototype methods
    // (`setCameraLocked`, and the private `updateOrbitEnabled` it delegates to) against a plain
    // stand-in `this` object carrying just the three fields they touch — the same technique
    // `scene3d-engine.unit.spec.ts` (around line 303-325) uses for `SceneEngine.prototype.
    // syncObject`. This exercises the actual shipped composition logic, not a reimplementation
    // of it, so it can't just be asserting a copy of the fix back at itself.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const host: any = {
      cameraLocked: true,
      gizmoDragging: true, // a gizmo drag is already in progress and has claimed its own lock
      orbit: { enabled: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateOrbitEnabled: (SceneInteraction.prototype as any).updateOrbitEnabled,
    }

    // The fixed per-frame call site (Scene3DStudioSurface.vue) releases camera motion's OWN
    // lock through this method instead of writing `orbit.enabled` directly. That release must
    // never re-enable orbit while the gizmo-drag lock is still held.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(SceneInteraction.prototype as any).setCameraLocked.call(host, false)

    expect(host.cameraLocked).toBe(false) // the camera-motion lock did release...
    expect(host.orbit.enabled).toBe(false) // ...but orbit stays disabled: the gizmo lock wins
  })
})
