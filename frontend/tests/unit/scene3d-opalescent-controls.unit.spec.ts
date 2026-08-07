import { describe, it, expect } from 'vitest'
import { SCENE_CONTROLS } from '~/lib/scene3d/controls'
import { createPrimitive } from '~/lib/scene3d/config'
import type { SceneDoc, SceneObject } from '~/lib/scene3d/config'

const OPAL_KEYS = [
  'object.material.opalHueShift',
  'object.material.opalFrequency',
  'object.material.opalAngleMix',
  'object.material.opalFlowSpeed',
  'object.material.opalStrength',
]

const objWithType = (type: SceneObject['material']['type']): SceneObject => {
  const o = createPrimitive('sphere', [])
  o.material.type = type
  return o
}

const shows = (doc: SceneDoc, obj: SceneObject, key: string): boolean => {
  const c = SCENE_CONTROLS.find((s) => s.key === key)!
  return !c.when || c.when(doc, obj)
}

describe('opalescent controls — gating', () => {
  const doc = { version: 1, objects: [] } as unknown as SceneDoc

  it('registers all five opal sliders', () => {
    for (const k of OPAL_KEYS) expect(SCENE_CONTROLS.some((c) => c.key === k), k).toBe(true)
  })

  it('offers the opal sliders on an opalescent material', () => {
    const obj = objWithType('opalescent')
    for (const k of OPAL_KEYS) expect(shows(doc, obj, k), k).toBe(true)
  })

  it('withholds the opal sliders on a non-opal material', () => {
    const obj = objWithType('gradient')
    for (const k of OPAL_KEYS) expect(shows(doc, obj, k), k).toBe(false)
  })

  it('offers base colour + roughness/metalness on an opalescent material (lit substrate)', () => {
    const obj = objWithType('opalescent')
    expect(shows(doc, obj, 'object.material.color')).toBe(true)
    expect(shows(doc, obj, 'object.material.roughness')).toBe(true)
    expect(shows(doc, obj, 'object.material.metalness')).toBe(true)
  })

  it('offers the glossy-coat / reflection knobs on an opalescent material', () => {
    const obj = objWithType('opalescent')
    expect(shows(doc, obj, 'object.material.clearcoat')).toBe(true)
    expect(shows(doc, obj, 'object.material.clearcoatRoughness')).toBe(true)
    expect(shows(doc, obj, 'object.material.envMapIntensity')).toBe(true)
  })

  it('still offers the coat knobs on standard, and withholds the opal-only sheen/transmission from opal', () => {
    expect(shows(doc, objWithType('standard'), 'object.material.clearcoat')).toBe(true)
    // opal is NOT the full physical block — sheen/transmission stay standard+glass only
    expect(shows(doc, objWithType('opalescent'), 'object.material.transmission')).toBe(false)
    expect(shows(doc, objWithType('opalescent'), 'object.material.sheen')).toBe(false)
  })
})
