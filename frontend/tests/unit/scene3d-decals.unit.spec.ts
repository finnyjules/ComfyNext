import { describe, it, expect } from 'vitest'
import {
  parseDoc, serializeDoc, defaultDoc, createDecal, createPrimitive,
  DECAL_DEFAULTS, type DecalObject,
} from '~/lib/scene3d/config'

function docWith(objects: any[]) {
  return JSON.stringify({ ...JSON.parse(serializeDoc(defaultDoc())), objects })
}

describe('scene3d decals — doc model', () => {
  it('createDecal parents the decal under its target', () => {
    const box = createPrimitive('box')
    const d = createDecal(box.id, { position: [0, 0.5, 0.5], rotation: [0, 0, 0] },
      { type: 'text', text: 'HI', font: DECAL_DEFAULTS.font, color: DECAL_DEFAULTS.color }, [box])
    expect(d.kind).toBe('decal')
    expect(d.targetId).toBe(box.id)
    expect(d.parentId).toBe(box.id)
    expect(d.size).toBe(DECAL_DEFAULTS.size)
  })

  it('round-trips image and text decals through serialize/parse', () => {
    const box = createPrimitive('box')
    const img = createDecal(box.id, { position: [0, 0, 0.5], rotation: [0.1, 0.2, 0.3] },
      { type: 'image', image: 'sticker.png' }, [box])
    const txt = createDecal(box.id, { position: [0.5, 0, 0], rotation: [0, 1.57, 0] },
      { type: 'text', text: 'ACME', font: 'google:Inter@700', color: '#112233' }, [box, img])
    const doc = defaultDoc(); doc.objects = [box, img, txt]
    const back = parseDoc(serializeDoc(doc))
    const decals = back.objects.filter((o): o is DecalObject => o.kind === 'decal')
    expect(decals).toHaveLength(2)
    expect(decals[0]!.content).toEqual({ type: 'image', image: 'sticker.png' })
    expect(decals[1]!.content).toEqual({ type: 'text', text: 'ACME', font: 'google:Inter@700', color: '#112233' })
    expect(decals[1]!.position).toEqual([0.5, 0, 0])
  })

  it('drops a decal whose target is missing or not a primitive', () => {
    const box = createPrimitive('box')
    const orphan = { ...createDecal('nope', { position: [0,0,0], rotation: [0,0,0] },
      { type: 'text', text: 'X', font: 'f', color: '#000' }, []) }
    const back = parseDoc(docWith([box, orphan]))
    expect(back.objects.some(o => o.kind === 'decal')).toBe(false)
  })

  it('tolerates junk fields and fills defaults', () => {
    const box = createPrimitive('box')
    const raw = { id: 'd1', kind: 'decal', targetId: box.id,
      content: { type: 'text', text: 'Y' }, size: 'huge', opacity: 9 }
    const back = parseDoc(docWith([box, raw]))
    const d = back.objects.find(o => o.kind === 'decal') as DecalObject
    expect(d.size).toBe(DECAL_DEFAULTS.size)
    expect(d.opacity).toBe(1)                       // clamped
    expect(d.content).toEqual({ type: 'text', text: 'Y', font: DECAL_DEFAULTS.font, color: DECAL_DEFAULTS.color })
  })

  it('drops a decal with unusable content', () => {
    const box = createPrimitive('box')
    const back = parseDoc(docWith([box, { id: 'd2', kind: 'decal', targetId: box.id, content: { type: 'image' } }]))
    expect(back.objects.some(o => o.kind === 'decal')).toBe(false)
  })
})
