import { describe, it, expect } from 'vitest'
import {
  STRESS_TILE_COUNT,
  StressTile,
  stressScenes,
  freshTiles,
  stressOutcome,
  canLock,
} from '~/lib/characters/stress'
import {
  STRESS_PROMPT_SUFFIX,
  buildStressTileRequest,
  buildTestingPatch,
  buildLockPatch,
  refPhotoRequest,
  REF_PHOTO_SUFFIX,
} from '~/lib/characters/stressFlow'

describe('stress module', () => {
  describe('stressScenes', () => {
    it('returns STRESS_TILE_COUNT scenes', () => {
      const scenes = stressScenes()
      expect(scenes).toHaveLength(STRESS_TILE_COUNT)
    })

    it('includes at least 1 full-body scene', () => {
      const scenes = stressScenes()
      const fullCount = scenes.filter(s => s.framing === 'full').length
      expect(fullCount).toBeGreaterThanOrEqual(1)
    })

    it('includes at least 1 closeup scene', () => {
      const scenes = stressScenes()
      const closeupCount = scenes.filter(s => s.framing === 'closeup').length
      expect(closeupCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('freshTiles', () => {
    it('returns STRESS_TILE_COUNT tiles', () => {
      const tiles = freshTiles()
      expect(tiles).toHaveLength(STRESS_TILE_COUNT)
    })

    it('all tiles have idx from 0 to 9', () => {
      const tiles = freshTiles()
      tiles.forEach((tile, i) => {
        expect(tile.idx).toBe(i)
      })
    })

    it('all tiles have null dataUrl', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        expect(tile.dataUrl).toBeNull()
      })
    })

    it('all tiles have loading false', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        expect(tile.loading).toBe(false)
      })
    })

    it('all tiles have error false', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        expect(tile.error).toBe(false)
      })
    })

    it('all tiles have pass null', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        expect(tile.pass).toBeNull()
      })
    })
  })

  describe('stressOutcome', () => {
    it('returns null when any tile is un-generated (dataUrl is null)', () => {
      const tiles = freshTiles()
      tiles[0]!.dataUrl = 'data:image/png;base64,fake'
      tiles[0]!.pass = true
      // other 9 tiles have dataUrl: null
      const outcome = stressOutcome(tiles)
      expect(outcome).toBeNull()
    })

    it('returns null when any tile is un-judged (pass is null)', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        tile.dataUrl = 'data:image/png;base64,fake'
        tile.pass = true
      })
      tiles[5]!.pass = null // leave one un-judged
      const outcome = stressOutcome(tiles)
      expect(outcome).toBeNull()
    })

    it('returns StressResult when all tiles are generated and judged', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        tile.dataUrl = 'data:image/png;base64,fake'
        tile.pass = true
      })
      const outcome = stressOutcome(tiles)
      expect(outcome).not.toBeNull()
      expect(outcome?.passes).toBe(10)
      expect(outcome?.total).toBe(10)
      expect(outcome?.at).toBe('')
    })

    it('counts passes correctly when some tiles fail', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        tile.dataUrl = 'data:image/png;base64,fake'
        tile.pass = true
      })
      tiles[2]!.pass = false
      tiles[7]!.pass = false
      const outcome = stressOutcome(tiles)
      expect(outcome?.passes).toBe(8)
      expect(outcome?.total).toBe(10)
    })

    it('at field is empty string and caller stamps it', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        tile.dataUrl = 'data:image/png;base64,fake'
        tile.pass = true
      })
      const outcome = stressOutcome(tiles)
      expect(outcome?.at).toBe('')
    })
  })

  describe('canLock', () => {
    it('returns false with fresh tiles (none generated)', () => {
      const tiles = freshTiles()
      expect(canLock(tiles)).toBe(false)
    })

    it('returns false at 9/10 pass', () => {
      const tiles = freshTiles()
      for (let i = 0; i < 9; i++) {
        tiles[i]!.dataUrl = 'data:image/png;base64,fake'
        tiles[i]!.pass = true
      }
      // tile 9 is still un-generated
      expect(canLock(tiles)).toBe(false)
    })

    it('returns false when all 10 generated but 1 has error', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        tile.dataUrl = 'data:image/png;base64,fake'
        tile.pass = true
      })
      tiles[3]!.error = true
      expect(canLock(tiles)).toBe(false)
    })

    it('returns false when all 10 generated and no errors but 1 failed judgment', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        tile.dataUrl = 'data:image/png;base64,fake'
        tile.pass = true
      })
      tiles[5]!.pass = false
      // lock requires ALL passed, not just generated
      expect(canLock(tiles)).toBe(false)
    })

    it('returns true only when all 10 generated, error-free, and all passed', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        tile.dataUrl = 'data:image/png;base64,fake'
        tile.error = false
        tile.pass = true
      })
      expect(canLock(tiles)).toBe(true)
    })
  })
})

describe('stressFlow', () => {
  describe('buildStressTileRequest', () => {
    it('appends the identity-anchor suffix to the scene prompt', () => {
      const scenes = stressScenes()
      const req = buildStressTileRequest('data:image/png;base64,sheet', scenes[0]!, 0)
      expect(req.prompt).toBe(scenes[0]!.prompt + STRESS_PROMPT_SUFFIX)
      expect(req.prompt.endsWith(', the exact same person as the reference sheet')).toBe(true)
    })

    it('passes the sheet data URL through as referenceImageDataUrl', () => {
      const scenes = stressScenes()
      const req = buildStressTileRequest('data:image/png;base64,sheet', scenes[0]!, 0)
      expect(req.referenceImageDataUrl).toBe('data:image/png;base64,sheet')
    })

    it('derives aspectRatio from the scene framing via aspectForFraming', () => {
      const full = { prompt: 'full body shot', framing: 'full' as const }
      const closeup = { prompt: 'closeup shot', framing: 'closeup' as const }
      // full framing is always 3:4 regardless of idx (mirrors aspectForFraming)
      expect(buildStressTileRequest('sheet', full, 0).aspectRatio).toBe('3:4')
      expect(buildStressTileRequest('sheet', full, 7).aspectRatio).toBe('3:4')
      // non-full framings cycle CHARACTER_SHOT_ASPECTS by idx
      expect(buildStressTileRequest('sheet', closeup, 0).aspectRatio).toBe('1:1')
      expect(buildStressTileRequest('sheet', closeup, 1).aspectRatio).toBe('3:4')
      expect(buildStressTileRequest('sheet', closeup, 2).aspectRatio).toBe('4:3')
    })
  })

  describe('buildTestingPatch', () => {
    it('is the draft-to-testing transition sent on the first tile landing', () => {
      expect(buildTestingPatch()).toEqual({ status: 'testing' })
    })
  })

  describe('buildLockPatch', () => {
    it('carries status locked and the exact stressResult with the stamped at', () => {
      const tiles = freshTiles()
      tiles.forEach(tile => {
        tile.dataUrl = 'data:image/png;base64,fake'
        tile.pass = true
      })
      tiles[3]!.pass = false
      const outcome = stressOutcome(tiles)!
      const patch = buildLockPatch(outcome, '2026-08-13T00:00:00.000Z')
      expect(patch).toEqual({
        status: 'locked',
        stressResult: { passes: 9, total: 10, at: '2026-08-13T00:00:00.000Z' },
      })
    })

    it('does not mutate the passed-in outcome', () => {
      const outcome = { passes: 10, total: 10, at: '' }
      buildLockPatch(outcome, 'stamp')
      expect(outcome.at).toBe('')
    })
  })

  describe('refPhotoRequest', () => {
    it('portrait: exact prompt + same-person suffix, 1:1', () => {
      const req = refPhotoRequest('portrait', 'data:image/png;base64,cover')
      expect(req).toEqual({
        referenceImageDataUrl: 'data:image/png;base64,cover',
        prompt: 'close-up portrait, facing camera directly, neutral expression, soft even studio light, plain neutral background' + REF_PHOTO_SUFFIX,
        aspectRatio: '1:1',
      })
    })

    it('profile: exact prompt + same-person suffix, 1:1', () => {
      const req = refPhotoRequest('profile', 'data:image/png;base64,cover')
      expect(req).toEqual({
        referenceImageDataUrl: 'data:image/png;base64,cover',
        prompt: 'profile view close-up, looking to the side, soft even light, plain background' + REF_PHOTO_SUFFIX,
        aspectRatio: '1:1',
      })
    })

    it('full-body: exact prompt + same-person suffix, 3:4', () => {
      const req = refPhotoRequest('full-body', 'data:image/png;base64,cover')
      expect(req).toEqual({
        referenceImageDataUrl: 'data:image/png;base64,cover',
        prompt: 'full-body shot standing naturally, arms relaxed, soft daylight, plain seamless background' + REF_PHOTO_SUFFIX,
        aspectRatio: '3:4',
      })
    })

    it('suffix is exactly ", the exact same person as the reference"', () => {
      expect(REF_PHOTO_SUFFIX).toBe(', the exact same person as the reference')
    })
  })
})
