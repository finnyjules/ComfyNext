import { describe, it, expect } from 'vitest'
import {
  defaultDoc, createPrimitive, createGlbObject, serializeDoc, parseDoc,
} from '~/lib/scene3d/config'

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
})
