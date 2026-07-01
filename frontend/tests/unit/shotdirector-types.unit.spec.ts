import { describe, it, expect } from 'vitest'
import {
  createDefaultShotSheet,
  SHOT_TYPE_PHRASE, CAMERA_MOVE_PHRASE, ROLE_PURPOSE, ROLES_BY_KIND,
  type ShotType, type CameraMove, type RefRole,
} from '../../app/lib/shotdirector/types'

const SHOT_TYPES: ShotType[] = ['wide', 'medium', 'close-up', 'extreme-close-up', 'establishing']
const CAMERA_MOVES: CameraMove[] = ['push-in', 'pull-out', 'pan', 'track', 'orbit', 'aerial', 'handheld', 'locked-off']
const ROLES: RefRole[] = [
  'identity-lock', 'lighting-copy', 'composition-lock', 'style-transfer',
  'camera-copy', 'motion-transfer', 'sequence-extend', 'beat-sync', 'lip-sync', 'mood',
]

describe('shotdirector vocabulary', () => {
  it('every shot type and camera move has a phrase', () => {
    for (const s of SHOT_TYPES) expect(SHOT_TYPE_PHRASE[s], s).toBeTruthy()
    for (const m of CAMERA_MOVES) expect(CAMERA_MOVE_PHRASE[m], m).toBeTruthy()
  })

  it('every reference role has a purpose phrase', () => {
    for (const r of ROLES) expect(ROLE_PURPOSE[r], r).toBeTruthy()
  })

  it('roles-by-kind only references known roles and covers each kind', () => {
    for (const kind of ['image', 'video', 'audio'] as const) {
      expect(ROLES_BY_KIND[kind].length, kind).toBeGreaterThan(0)
      for (const role of ROLES_BY_KIND[kind]) expect(ROLES).toContain(role)
    }
  })
})

describe('createDefaultShotSheet', () => {
  it('produces a reference-mode sheet with sane Seedance defaults and no beats', () => {
    const s = createDefaultShotSheet()
    expect(s.mode).toBe('reference')
    expect(s.references).toEqual([])
    expect(s.beats).toEqual([])
    expect(s.camera.move).toBe('locked-off')
    expect(s.format.durationS).toBe(5)
    expect(s.format.resolution).toBe('1080p')
    expect(s.format.aspectRatio).toBe('16:9')
    expect(s.audio.generate).toBe(true)
  })
})
