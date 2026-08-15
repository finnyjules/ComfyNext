import { describe, it, expect } from 'vitest'
import {
  PRIMITIVE_KINDS, NOT_PLACEABLE_KINDS, serializeDoc, parseDoc, defaultDoc, contentDigest,
  type PrimitiveObject,
} from '~/lib/scene3d/config'
import { PRIMITIVE_PARAMS } from '~/lib/scene3d/primParams'

// NOTE: the task brief called this `createDoc()`; the actual export in config.ts is
// `defaultDoc()`, which returns an empty scene (objects: []). Per the judgement call in
// the task instructions, the material's contents are irrelevant to what this test
// asserts, so it's a plain inline literal cast rather than a real material factory.
const withMesh = (encoded: string) => {
  const doc = defaultDoc()
  const obj: PrimitiveObject = {
    id: 'm1', name: 'Mesh', visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: {} as any,
    kind: 'primitive', primitive: 'mesh',
    content: { mesh: encoded, meshKey: contentDigest(encoded) },
  }
  doc.objects = [obj]
  return doc
}

describe('mesh primitive in the document', () => {
  it('is a known kind but is not placeable from the add menu', () => {
    expect(PRIMITIVE_KINDS).toContain('mesh')
    expect(NOT_PLACEABLE_KINDS).toContain('mesh')
  })

  it('is appended last, never reordered — stored indices are a contract', () => {
    // `gem` was appended after `mesh` (see scene3d-gem.unit.spec.ts's registration
    // test), so mesh is second-to-last rather than last.
    expect(PRIMITIVE_KINDS[PRIMITIVE_KINDS.length - 2]).toBe('mesh')
  })

  it('declares no geometry parameters', () => {
    expect(PRIMITIVE_PARAMS.mesh).toEqual([])
  })

  it('survives a serialize/parse round-trip', () => {
    const doc = withMesh('AAAAtestpayload')
    const back = parseDoc(serializeDoc(doc))
    const o = back.objects[0] as PrimitiveObject
    expect(o.primitive).toBe('mesh')
    expect(o.content?.mesh).toBe('AAAAtestpayload')
  })

  it('re-derives meshKey and ignores a tampered stored digest', () => {
    const doc = withMesh('AAAAtestpayload')
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].content.meshKey = 'liar'
    const back = parseDoc(JSON.stringify(raw))
    const o = back.objects[0] as PrimitiveObject
    expect(o.content?.meshKey).toBe(contentDigest('AAAAtestpayload'))
  })

  it('drops a non-string mesh field rather than trusting it', () => {
    const doc = withMesh('AAAAtestpayload')
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].content.mesh = { evil: true }
    const back = parseDoc(JSON.stringify(raw))
    const o = back.objects[0] as PrimitiveObject
    expect(o.content?.mesh).toBeUndefined()
  })
})
