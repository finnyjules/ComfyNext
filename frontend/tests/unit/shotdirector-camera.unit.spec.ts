import { describe, it, expect } from 'vitest'
import { cameraMoveClause, MOVE_DIRECTIONS, MOVE_CATEGORY, CAMERA_MOVE_PHRASE } from '../../app/lib/shotdirector/types'
import { hydrateShotSheet } from '../../app/lib/shotdirector/hydrate'

describe('cameraMoveClause', () => {
  it('distinguishes physical dolly from optical zoom', () => {
    expect(cameraMoveClause('push-in')).toContain('dolly in')
    expect(cameraMoveClause('push-in')).toContain('physically')
    expect(cameraMoveClause('zoom-in')).toContain('lens only')
    expect(cameraMoveClause('zoom-in')).not.toContain('dolly')
  })

  it('interpolates direction on each axis', () => {
    expect(cameraMoveClause('pan', 'left')).toBe('pan left, rotating horizontally in place')
    expect(cameraMoveClause('tilt', 'down')).toBe('tilt down, rotating vertically in place')
    expect(cameraMoveClause('orbit', 'ccw')).toBe('orbit counterclockwise around the subject')
  })

  it('falls back to a sensible default direction when none is given', () => {
    expect(cameraMoveClause('pan')).toContain('pan right')
    expect(cameraMoveClause('orbit')).toContain('clockwise')
    expect(cameraMoveClause('tilt')).toContain('tilt up')
  })

  it('ignores direction for non-directional moves', () => {
    expect(cameraMoveClause('locked-off')).toBe('locked-off, a static camera')
    expect(cameraMoveClause('handheld')).toContain('human-operator')
  })

  it('has a label, category and direction entry for every move', () => {
    for (const move of Object.keys(CAMERA_MOVE_PHRASE) as (keyof typeof CAMERA_MOVE_PHRASE)[]) {
      expect(MOVE_CATEGORY[move]).toBeTruthy()
      expect(Array.isArray(MOVE_DIRECTIONS[move])).toBe(true)
      expect(cameraMoveClause(move)).toBeTruthy()
    }
  })
})

describe('hydrate camera', () => {
  it('keeps a valid move + direction', () => {
    const s = hydrateShotSheet({ camera: { shotType: 'wide', move: 'orbit', pacing: 'smooth', direction: 'ccw' } })
    expect(s.camera.move).toBe('orbit')
    expect(s.camera.direction).toBe('ccw')
  })

  it('defaults an unknown move and drops an unknown/mismatched direction', () => {
    const s = hydrateShotSheet({ camera: { move: 'barrel-roll', direction: 'sideways' } })
    expect(s.camera.move).toBe('locked-off') // default
    expect(s.camera.direction).toBeUndefined()
  })

  it('drops a direction that does not belong to the move', () => {
    // pan allows left/right, not "up" — a stale direction from a move change.
    const s = hydrateShotSheet({ camera: { move: 'pan', direction: 'up' } })
    expect(s.camera.move).toBe('pan')
    expect(s.camera.direction).toBeUndefined()
  })
})
