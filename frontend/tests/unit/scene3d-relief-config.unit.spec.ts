import { describe, it, expect } from 'vitest'
import { defaultDoc, createPrimitive, serializeDoc, parseDoc, MATERIAL_DEFAULTS } from '~/lib/scene3d/config'

describe('scene3d relief doc model', () => {
  it('round-trips a shader relief through serialize → parse', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material.relief = { source: 'shader', scale: 0.4, invert: true }
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects[0]!.material.relief).toEqual({ source: 'shader', scale: 0.4, invert: true })
  })

  it('round-trips an image relief and a normalImage', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material.relief = { source: 'image', image: 'height.png', scale: 0.25 }
    obj.material.normalImage = 'baked_normal.png'
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects[0]!.material.relief!.image).toBe('height.png')
    expect(back.objects[0]!.material.normalImage).toBe('baked_normal.png')
  })

  it('leaves relief absent when absent, so old docs round-trip exactly', () => {
    const doc = defaultDoc()
    doc.objects = [createPrimitive('box')]
    const back = parseDoc(serializeDoc(doc))
    expect('relief' in back.objects[0]!.material).toBe(false)
    expect('normalImage' in back.objects[0]!.material).toBe(false)
  })

  it('coerces a junk source to none and a junk scale to the default', () => {
    const raw = JSON.parse(serializeDoc(defaultDoc()))
    raw.objects = [{ ...createPrimitive('box'), material: { type: 'standard', color: '#fff', roughness: 0.5, metalness: 0, relief: { source: 'wat', scale: 'nope' } } }]
    const back = parseDoc(JSON.stringify(raw))
    expect(back.objects[0]!.material.relief).toEqual({ source: 'none', scale: MATERIAL_DEFAULTS.reliefScale })
  })

  it('defaults relief scale to 0.25', () => {
    expect(MATERIAL_DEFAULTS.reliefScale).toBe(0.25)
  })
})
