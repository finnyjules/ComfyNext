import { describe, it, expect } from 'vitest'
import { buildSamInput } from '~~/server/utils/samInput'

describe('buildSamInput', () => {
  it('legacy single point body → one foreground point (back-compat)', () => {
    expect(buildSamInput({ image: 'data:x', xPx: 10.6, yPx: 20.2 })).toEqual({
      image: 'data:x',
      point_coords: [[11, 20]],
      point_labels: [1],
    })
  })
  it('points array wins over xPx/yPx and preserves labels', () => {
    expect(buildSamInput({
      image: 'data:x', xPx: 1, yPx: 2,
      points: [{ x: 5.4, y: 6.6, label: 1 }, { x: 9, y: 10, label: 0 }],
    })).toEqual({
      image: 'data:x',
      point_coords: [[5, 7], [9, 10]],
      point_labels: [1, 0],
    })
  })
  it('empty points array falls back to the legacy point', () => {
    expect(buildSamInput({ image: 'data:x', xPx: 3, yPx: 4, points: [] })).toEqual({
      image: 'data:x',
      point_coords: [[3, 4]],
      point_labels: [1],
    })
  })
  it('never emits undefined values', () => {
    const input = buildSamInput({ image: 'data:x' })
    for (const v of Object.values(input)) expect(v).not.toBeUndefined()
  })
})
