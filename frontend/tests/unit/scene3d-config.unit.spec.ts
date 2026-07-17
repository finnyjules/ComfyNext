import { describe, it, expect } from 'vitest'
import {
  defaultDoc, createPrimitive, createGlbObject, serializeDoc, parseDoc, PRIMITIVE_KINDS,
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

  it('menu groups cover every primitive kind exactly once, in canonical order', () => {
    const menuKinds = PRIM_GROUPS.flatMap((g) => g.kinds.map((k) => k.kind))
    expect(menuKinds).toEqual([...PRIMITIVE_KINDS])
  })
})
