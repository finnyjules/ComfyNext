import { describe, it, expect } from 'vitest'
import { parseDoc, MATERIAL_TYPES, MATERIAL_DEFAULTS, sceneHasOpalFlow } from '~/lib/scene3d/config'
import type { SceneDoc } from '~/lib/scene3d/config'

const docWith = (material: Record<string, unknown>): string =>
  JSON.stringify({
    version: 1,
    objects: [{ id: 'a', name: 'A', kind: 'primitive', primitive: 'sphere', visible: true,
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], material }],
  })

describe('opalescent material — config', () => {
  it('registers the type', () => {
    expect(MATERIAL_TYPES).toContain('opalescent')
  })

  it('ships defaults for every opal field', () => {
    expect(MATERIAL_DEFAULTS.opalHueShift).toBeTypeOf('number')
    expect(MATERIAL_DEFAULTS.opalFrequency).toBeTypeOf('number')
    expect(MATERIAL_DEFAULTS.opalAngleMix).toBeTypeOf('number')
    expect(MATERIAL_DEFAULTS.opalFlowSpeed).toBe(0) // still by default
    expect(MATERIAL_DEFAULTS.opalStrength).toBeTypeOf('number')
  })

  it('round-trips authored opal fields through parseDoc', () => {
    const doc = parseDoc(docWith({
      type: 'opalescent', color: '#223344', roughness: 0.4, metalness: 0.1,
      opalHueShift: 120, opalFrequency: 3, opalAngleMix: 0.25, opalFlowSpeed: 0.8, opalStrength: 0.7,
      gradientStops: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#00ff00' }],
    }))
    const m = doc.objects[0]!.material as any
    expect(m.type).toBe('opalescent')
    expect(m.opalHueShift).toBe(120)
    expect(m.opalFrequency).toBe(3)
    expect(m.opalAngleMix).toBe(0.25)
    expect(m.opalFlowSpeed).toBe(0.8)
    expect(m.opalStrength).toBe(0.7)
    expect(m.gradientStops).toHaveLength(2)
  })

  it('leaves absent opal fields absent (exact round-trip, defaults applied downstream)', () => {
    const doc = parseDoc(docWith({ type: 'opalescent', color: '#223344', roughness: 0.5, metalness: 0 }))
    const m = doc.objects[0]!.material as any
    expect(m.opalHueShift).toBeUndefined()
    expect(m.opalFrequency).toBeUndefined()
  })

  it('rejects non-numeric opal fields (falls back to absent)', () => {
    const doc = parseDoc(docWith({ type: 'opalescent', color: '#223344', roughness: 0.5, metalness: 0,
      opalFrequency: 'lots' as unknown as number }))
    const m = doc.objects[0]!.material as any
    expect(m.opalFrequency).toBeUndefined()
  })
})

describe('sceneHasOpalFlow', () => {
  const doc = (mat: Record<string, unknown>): SceneDoc =>
    parseDoc(docWith(mat))

  it('is true only for an opalescent material with flow > 0', () => {
    expect(sceneHasOpalFlow(doc({ type: 'opalescent', color: '#fff', roughness: 1, metalness: 0, opalFlowSpeed: 0.5 }))).toBe(true)
  })
  it('is false when flow is 0 (still opal costs nothing per frame)', () => {
    expect(sceneHasOpalFlow(doc({ type: 'opalescent', color: '#fff', roughness: 1, metalness: 0, opalFlowSpeed: 0 }))).toBe(false)
  })
  it('is false for a non-opal material', () => {
    expect(sceneHasOpalFlow(doc({ type: 'gradient', color: '#fff', roughness: 1, metalness: 0 }))).toBe(false)
  })
})
