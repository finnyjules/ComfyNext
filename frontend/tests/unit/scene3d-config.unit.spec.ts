import { describe, it, expect } from 'vitest'
import {
  defaultDoc, createPrimitive, createGlbObject, serializeDoc, parseDoc, PRIMITIVE_KINDS, MATERIAL_TYPES,
} from '~/lib/scene3d/config'
import { PRIM_GROUPS } from '~/lib/scene3d/primGroups'

describe('scene3d config', () => {
  it('round-trips a document through serialize/parse', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    doc.objects.push(createGlbObject('https://example.com/m.glb', doc.objects))
    const back = parseDoc(serializeDoc(doc))
    expect(back).toEqual(doc)
  })

  it('parses empty/garbage input to the default document', () => {
    expect(parseDoc('')).toEqual(defaultDoc())
    expect(parseDoc('{not json')).toEqual(defaultDoc())
    expect(parseDoc('{"version":999}')).toEqual(defaultDoc())
  })

  it('creates unique ids and numbered names', () => {
    const objs = [createPrimitive('box', [])]
    const second = createPrimitive('box', objs)
    expect(second.id).not.toBe(objs[0]!.id)
    expect(objs[0]!.name).toBe('Box')
    expect(second.name).toBe('Box 2')
  })

  it('fills missing fields with defaults on parse', () => {
    const doc = defaultDoc()
    const raw = JSON.parse(serializeDoc(doc))
    delete raw.lighting.ambient
    const back = parseDoc(JSON.stringify(raw))
    expect(back.lighting.ambient).toBe(defaultDoc().lighting.ambient)
  })

  it('round-trips a document containing every primitive kind', () => {
    const doc = defaultDoc()
    for (const kind of PRIMITIVE_KINDS) doc.objects.push(createPrimitive(kind, doc.objects))
    expect(PRIMITIVE_KINDS).toHaveLength(14)
    const back = parseDoc(serializeDoc(doc))
    expect(back).toEqual(doc)
    expect(back.objects.map((o) => (o as any).primitive)).toEqual([...PRIMITIVE_KINDS])
  })

  it('drops objects with an unknown primitive kind instead of erroring', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects.push({ ...raw.objects[0], id: 'obj_bad', primitive: 'blob' })
    const back = parseDoc(JSON.stringify(raw))
    expect(back.objects).toHaveLength(1)
    expect((back.objects[0] as any).primitive).toBe('box')
  })

  it('round-trips every material type with params', () => {
    const doc = defaultDoc()
    const boxFor = (patch: any) => {
      const o = createPrimitive('box', doc.objects)
      Object.assign(o.material, patch)
      doc.objects.push(o)
    }
    boxFor({ type: 'toon', toonSteps: 4 })
    boxFor({ type: 'matcap', matcap: 'gold' })
    boxFor({ type: 'glass', ior: 1.8, transmission: 0.9, thickness: 1.2, roughness: 0.1 })
    boxFor({ type: 'fresnel', fresnelColor: '#ff00aa', fresnelPower: 5 })
    boxFor({ type: 'gradient', gradientB: '#123456', gradientAxis: 'z', gradientShading: 'faceted' })
    boxFor({ type: 'image', image: 'scene3d_tex_1.png' })
    expect(MATERIAL_TYPES).toHaveLength(7)
    const back = parseDoc(serializeDoc(doc))
    expect(back).toEqual(doc)
  })

  it('migrates old materials (no type field) to standard', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    delete raw.objects[0].material.type
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).material.type).toBe('standard')
  })

  it('degrades an unknown material type to standard', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].material.type = 'hologram'
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).material.type).toBe('standard')
  })

  it('round-trips every physical surface field', () => {
    const doc = defaultDoc()
    const o = createPrimitive('box', doc.objects)
    Object.assign(o.material, {
      clearcoat: 0.8, clearcoatRoughness: 0.2, sheen: 0.5, sheenColor: '#ffddee',
      emissive: '#220044', emissiveIntensity: 2.5, opacity: 0.7, dispersion: 1.5,
      attenuationColor: '#88ffcc', attenuationDistance: 2, iridescence: 0.9,
      iridescenceIOR: 1.8, envMapIntensity: 2,
    })
    doc.objects.push(o)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)
  })

  it('round-trips primitive geometry params and drops junk ones', () => {
    const doc = defaultDoc()
    const sphere = createPrimitive('sphere', doc.objects)
    sphere.params = { detail: 12, arc: 180 }
    doc.objects.push(sphere)
    const box = createPrimitive('box', doc.objects)
    box.params = { cornerRadius: 0.2, cornerSides: 4 }
    doc.objects.push(box)
    const plain = createPrimitive('cone', doc.objects)
    doc.objects.push(plain)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)

    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].params = { detail: 12, bogus: 5, arc: 9999 }
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).params).toEqual({ detail: 12, arc: 360 })
    expect((back.objects[2] as any).params).toBeUndefined()
  })

  it('round-trips modifiers and drops junk ones', () => {
    const doc = defaultDoc()
    const o = createPrimitive('box', doc.objects)
    o.modifiers = { twist: 120, subdivide: 2, cloneCount: 4 }
    doc.objects.push(o)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)

    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].modifiers = { twist: 120, bogus: 7, bend: 9999 }
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).modifiers).toEqual({ twist: 120, bend: 180 })
  })

  it('menu groups cover every primitive kind exactly once, in canonical order', () => {
    const menuKinds = PRIM_GROUPS.flatMap((g) => g.kinds.map((k) => k.kind))
    expect(menuKinds).toEqual([...PRIMITIVE_KINDS])
  })
})
