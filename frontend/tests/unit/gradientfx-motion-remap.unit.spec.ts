import { describe, it, expect } from 'vitest'
import { remapTracksOnReorder, dropTracksForLayer } from '../../app/lib/gradientfx/motion'

const t = (path: string) => ({
  path, from: 0, to: 1, easing: 'linear' as const,
  loops: 1, hold: 0, cycleOffset: 0, delay: 0,
})

describe('remapTracksOnReorder', () => {
  it('follows a layer moved down', () => {
    expect(remapTracksOnReorder([t('layers.0.shape.count')], 0, 2)[0]!.path).toBe('layers.2.shape.count')
  })
  it('shifts layers displaced by a downward move', () => {
    expect(remapTracksOnReorder([t('layers.1.shape.count')], 0, 2)[0]!.path).toBe('layers.0.shape.count')
  })
  it('shifts layers displaced by an upward move', () => {
    expect(remapTracksOnReorder([t('layers.1.shape.count')], 2, 0)[0]!.path).toBe('layers.2.shape.count')
  })
  it('leaves non-layer paths untouched', () => {
    expect(remapTracksOnReorder([t('relief.grain')], 0, 2)[0]!.path).toBe('relief.grain')
  })
})

describe('dropTracksForLayer', () => {
  it('removes tracks targeting the deleted layer', () => {
    expect(dropTracksForLayer([t('layers.1.shape.count')], 1)).toHaveLength(0)
  })
  it('decrements indices above the deleted layer', () => {
    expect(dropTracksForLayer([t('layers.2.shape.count')], 1)[0]!.path).toBe('layers.1.shape.count')
  })
  it('leaves indices below the deleted layer alone', () => {
    expect(dropTracksForLayer([t('layers.0.shape.count')], 1)[0]!.path).toBe('layers.0.shape.count')
  })
  it('keeps non-layer paths', () => {
    expect(dropTracksForLayer([t('relief.grain')], 1)[0]!.path).toBe('relief.grain')
  })
})
