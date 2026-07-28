import { describe, it, expect } from 'vitest'
import { listPathRe, makeListRemap } from '../../app/lib/studio/listRemap'

const t = (path: string) => ({
  path, from: 0, to: 1, easing: 'linear' as const,
  loops: 1, hold: 0, cycleOffset: 0, delay: 0,
})

// Gradient's scheme — `layers.<i>.<anything>`.
const layers = makeListRemap({ list: 'layers' })
// Shader's scheme — `effects.<i>.params.<uniform>`.
const effects = makeListRemap({ list: 'effects', mid: 'params', requireLeaf: true })

describe('listPathRe reproduces the originals exactly', () => {
  it('builds Shader Studio\'s regex character for character', () => {
    // The inline copy in ShaderStudioSurface.vue was literally this.
    expect(listPathRe({ list: 'effects', mid: 'params', requireLeaf: true }).source)
      .toBe(/^effects\.(\d+)\.params\.(.+)$/.source)
  })

  it('matches the same paths as Gradient\'s prefix matcher', () => {
    const original = /^layers\.(\d+)\./
    const generic = listPathRe({ list: 'layers' })
    const corpus = [
      'layers.0.shape.count', 'layers.12.color.stops.0.color', 'layers.0.',
      'layers.x.count', 'layers..count', 'relief.grain', 'layers', 'xlayers.0.a',
      'layers.0.a\nb',
    ]
    for (const p of corpus) {
      expect([p, generic.test(p)]).toEqual([p, original.test(p)])
      if (original.test(p)) expect(Number(generic.exec(p)![1])).toBe(Number(original.exec(p)![1]))
    }
  })

  it('does NOT loosen Shader\'s non-empty single-line leaf requirement', () => {
    const original = /^effects\.(\d+)\.params\.(.+)$/
    const generic = listPathRe({ list: 'effects', mid: 'params', requireLeaf: true })
    const loose = listPathRe({ list: 'effects', mid: 'params' })
    // A bare prefix with no uniform: the original leaves it alone. A looser
    // generic matcher would start rewriting it.
    expect(original.test('effects.0.params.')).toBe(false)
    expect(generic.test('effects.0.params.')).toBe(false)
    expect(loose.test('effects.0.params.')).toBe(true)
    // …and paths outside the scheme stay outside it.
    for (const p of ['effects.0.blend', 'effects.0.params', 'adjust.exposure', 'effects.a.params.u_size']) {
      expect([p, generic.test(p)]).toEqual([p, original.test(p)])
    }
  })
})

describe('onReorder', () => {
  it('follows a layer moved down', () => {
    expect(layers.onReorder([t('layers.0.shape.count')], 0, 2)[0]!.path).toBe('layers.2.shape.count')
  })
  it('shifts layers displaced by a downward move', () => {
    expect(layers.onReorder([t('layers.1.shape.count')], 0, 2)[0]!.path).toBe('layers.0.shape.count')
  })
  it('shifts layers displaced by an upward move', () => {
    expect(layers.onReorder([t('layers.1.shape.count')], 2, 0)[0]!.path).toBe('layers.2.shape.count')
  })
  it('leaves paths outside the list untouched', () => {
    expect(layers.onReorder([t('relief.grain')], 0, 2)[0]!.path).toBe('relief.grain')
  })
  it('keeps a whole stack consistent through a reorder', () => {
    const tracks = [0, 1, 2, 3].map((i) => t(`layers.${i}.shape.count`))
    // Move layer 3 to the front: 3,0,1,2.
    const out = layers.onReorder(tracks, 3, 0).map((x) => x.path)
    expect(out).toEqual([
      'layers.1.shape.count', 'layers.2.shape.count', 'layers.3.shape.count', 'layers.0.shape.count',
    ])
  })
  it('works for Shader\'s deeper prefix', () => {
    expect(effects.onReorder([t('effects.0.params.u_size')], 0, 2)[0]!.path).toBe('effects.2.params.u_size')
    expect(effects.onReorder([t('effects.1.params.u_size')], 0, 2)[0]!.path).toBe('effects.0.params.u_size')
    expect(effects.onReorder([t('effects.1.params.u_size')], 2, 0)[0]!.path).toBe('effects.2.params.u_size')
    // A non-params leaf on the same list is NOT a track target and must not move.
    expect(effects.onReorder([t('effects.0.blend')], 0, 2)[0]!.path).toBe('effects.0.blend')
    expect(effects.onReorder([t('adjust.exposure')], 0, 2)[0]!.path).toBe('adjust.exposure')
  })
  it('preserves a dotted uniform tail', () => {
    expect(effects.onReorder([t('effects.0.params.a.b.c')], 0, 1)[0]!.path).toBe('effects.1.params.a.b.c')
  })
})

describe('onInsert', () => {
  it('shifts a track at the insert point up one layer', () => {
    expect(layers.onInsert([t('layers.1.shape.count')], 1)[0]!.path).toBe('layers.2.shape.count')
  })
  it('shifts a track above the insert point up one layer', () => {
    expect(layers.onInsert([t('layers.2.shape.count')], 1)[0]!.path).toBe('layers.3.shape.count')
  })
  it('leaves a track below the insert point untouched', () => {
    expect(layers.onInsert([t('layers.0.shape.count')], 1)[0]!.path).toBe('layers.0.shape.count')
  })
  it('leaves paths outside the list untouched', () => {
    expect(layers.onInsert([t('relief.grain')], 1)[0]!.path).toBe('relief.grain')
  })
  it('works for Shader\'s deeper prefix', () => {
    expect(effects.onInsert([t('effects.1.params.u_size')], 1)[0]!.path).toBe('effects.2.params.u_size')
    expect(effects.onInsert([t('effects.0.params.u_size')], 1)[0]!.path).toBe('effects.0.params.u_size')
  })
})

describe('onRemove', () => {
  it('removes tracks targeting the deleted layer', () => {
    expect(layers.onRemove([t('layers.1.shape.count')], 1)).toHaveLength(0)
  })
  it('decrements indices above the deleted layer', () => {
    expect(layers.onRemove([t('layers.2.shape.count')], 1)[0]!.path).toBe('layers.1.shape.count')
  })
  it('leaves indices below the deleted layer alone', () => {
    expect(layers.onRemove([t('layers.0.shape.count')], 1)[0]!.path).toBe('layers.0.shape.count')
  })
  it('keeps paths outside the list', () => {
    expect(layers.onRemove([t('relief.grain')], 1)[0]!.path).toBe('relief.grain')
  })
  it('works for Shader\'s deeper prefix', () => {
    const out = effects.onRemove(
      [t('effects.0.params.a'), t('effects.1.params.b'), t('effects.2.params.c'), t('adjust.exposure')],
      1,
    ).map((x) => x.path)
    expect(out).toEqual(['effects.0.params.a', 'effects.1.params.c', 'adjust.exposure'])
  })
})

describe('indexOf / withIndex', () => {
  it('reports null for paths outside the list', () => {
    expect(layers.indexOf('relief.grain')).toBeNull()
    expect(layers.indexOf(undefined)).toBeNull()
    expect(effects.indexOf('effects.0.blend')).toBeNull()
  })
  it('returns a non-matching path unchanged rather than rewriting it', () => {
    expect(effects.withIndex('effects.0.blend', 3)).toBe('effects.0.blend')
  })
})
