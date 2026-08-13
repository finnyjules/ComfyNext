import { describe, it, expect } from 'vitest'
import {
  STRESS_TILE_COUNT,
  StressTile,
  stressScenes,
  freshTiles,
  stressOutcome,
  canLock,
} from '~/lib/characters/stress'

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
