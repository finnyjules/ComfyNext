import { describe, expect, it } from 'vitest'
import { compileShot } from '~/lib/shotdirector/compile'
import { buildFilmShotPatch, findShotTarget } from '~/lib/shotdirector/dispatch'
import { SEEDANCE_PROFILE } from '~/lib/shotdirector/profiles'
import { createDefaultShotSheet } from '~/lib/shotdirector/types'

const DATA_URL = 'data:image/png;base64,x'

function referenceSheet() {
  const sheet = createDefaultShotSheet()
  sheet.subject = 'a woman in a red coat'
  sheet.action = 'walks toward camera'
  sheet.references.push({ kind: 'image', slot: 1, src: DATA_URL, role: 'identity-lock' })
  sheet.format.durationS = 10
  sheet.format.resolution = '720p'
  sheet.format.seed = 42
  return sheet
}

describe('buildFilmShotPatch', () => {
  it('splits widget-native fields from model_options extras (reference mode)', () => {
    const sheet = referenceSheet()
    const patch = buildFilmShotPatch(sheet, compileShot(sheet, SEEDANCE_PROFILE))
    expect(patch.model).toBe('seedance-2.0')
    expect(patch.prompt.length).toBeGreaterThan(0)
    expect(patch.duration).toBe(10)
    expect(patch.seed).toBe(42)
    expect(patch.aspect_ratio).toBe(sheet.format.aspectRatio)
    const opts = JSON.parse(patch.model_options)
    expect(opts.resolution).toBe('720p')
    expect(opts.reference_images).toEqual([DATA_URL])
    // widget-native keys must NOT leak into model_options
    for (const k of ['prompt', 'duration', 'aspect_ratio', 'seed']) {
      expect(opts).not.toHaveProperty(k)
    }
  })

  it('carries first/last frame through model_options in firstLastFrame mode', () => {
    const sheet = createDefaultShotSheet()
    sheet.subject = 's'
    sheet.action = 'a'
    sheet.mode = 'firstLastFrame'
    sheet.firstFrame = DATA_URL
    sheet.lastFrame = DATA_URL
    const patch = buildFilmShotPatch(sheet, compileShot(sheet, SEEDANCE_PROFILE))
    const opts = JSON.parse(patch.model_options)
    expect(opts.image).toBe(DATA_URL)
    expect(opts.last_frame_image).toBe(DATA_URL)
    expect(opts.reference_images).toBeUndefined()
  })

  it('sends seed 0 when the sheet has no seed', () => {
    const sheet = referenceSheet()
    sheet.format.seed = 0
    const patch = buildFilmShotPatch(sheet, compileShot(sheet, SEEDANCE_PROFILE))
    expect(patch.seed).toBe(0)
    expect(JSON.parse(patch.model_options)).not.toHaveProperty('seed')
  })
})

describe('findShotTarget', () => {
  const film = { id: 'f1', nodeType: 'FilmShotNode' }
  const other = { id: 'x1', nodeType: 'Image' }

  it('prefers a still-existing stored target', () => {
    expect(findShotTarget([film, other], [], 's1', 'f1')).toBe('f1')
  })

  it('ignores a stored target that was deleted', () => {
    expect(findShotTarget([other], [], 's1', 'f1')).toBeNull()
  })

  it('falls back to a downstream FilmShotNode via edges', () => {
    const edges = [{ source: 's1', target: 'x1' }, { source: 'x1', target: 'f1' }]
    expect(findShotTarget([film, other], edges, 's1', null)).toBe('f1')
  })

  it('returns null when nothing qualifies', () => {
    expect(findShotTarget([other], [{ source: 's1', target: 'x1' }], 's1', null)).toBeNull()
  })
})
