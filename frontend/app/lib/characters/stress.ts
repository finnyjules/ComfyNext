import { pickScenes } from '~/data/character-shot-scenes'
import type { CharacterShotScene } from '~/data/character-shot-scenes'
import type { StressResult } from '#shared/characters/types'

export const STRESS_TILE_COUNT = 10

export interface StressTile {
  idx: number
  scene: CharacterShotScene
  dataUrl: string | null
  loading: boolean
  error: boolean
  pass: boolean | null
}

/**
 * Select 10 scenes with quota-balanced coverage (≥1 full, ≥1 closeup).
 */
export function stressScenes(): CharacterShotScene[] {
  return pickScenes(STRESS_TILE_COUNT)
}

/**
 * Create fresh tiles for stress testing: 10 un-generated, un-judged.
 */
export function freshTiles(): StressTile[] {
  const scenes = stressScenes()
  return scenes.map((scene, idx) => ({
    idx,
    scene,
    dataUrl: null,
    loading: false,
    error: false,
    pass: null,
  }))
}

/**
 * Compute stress outcome once all tiles are generated AND judged.
 * Returns null until every tile has a dataUrl AND a pass judgment.
 * The `at` field is stamped empty; caller sets timestamp.
 */
export function stressOutcome(tiles: StressTile[]): StressResult | null {
  // Check that all tiles are generated (have dataUrl)
  if (tiles.some(tile => tile.dataUrl === null)) {
    return null
  }
  // Check that all tiles are judged (have pass value)
  if (tiles.some(tile => tile.pass === null)) {
    return null
  }
  // Count passes
  const passes = tiles.filter(tile => tile.pass === true).length
  return {
    passes,
    total: tiles.length,
    at: '',
  }
}

/**
 * Can the stress test be locked? True only when all 10 are generated,
 * error-free, and passed.
 */
export function canLock(tiles: StressTile[]): boolean {
  if (tiles.length !== STRESS_TILE_COUNT) {
    return false
  }
  // All must be generated (dataUrl not null)
  if (tiles.some(tile => tile.dataUrl === null)) {
    return false
  }
  // None must have error
  if (tiles.some(tile => tile.error === true)) {
    return false
  }
  // All must have passed
  if (tiles.some(tile => tile.pass !== true)) {
    return false
  }
  return true
}
