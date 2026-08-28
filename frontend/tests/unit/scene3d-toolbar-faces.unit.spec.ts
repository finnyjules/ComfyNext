import { describe, it, expect } from 'vitest'
import {
  PRIM_ITEMS, DEFAULT_PRIM_FACE, resolvePrimFace, primFaceLabel, primFaceIcon,
  LIGHT_KIND_LABELS, DEFAULT_LIGHT_FACE, resolveLightFace, lightFaceLabel,
  DECAL_ENTRIES, DEFAULT_DECAL_FACE, resolveDecalFace, decalFaceLabel, decalFaceIcon,
} from '~/lib/scene3d/toolbarFaces'
import { PRIM_GROUPS } from '~/lib/scene3d/primGroups'
import { LIGHT_KINDS } from '~/lib/scene3d/config'

describe('scene3d add-toolbar faces', () => {
  it('flattens the grouped grid without dropping or reordering kinds', () => {
    expect(PRIM_ITEMS.map(p => p.kind)).toEqual(PRIM_GROUPS.flatMap(g => g.kinds).map(p => p.kind))
    expect(PRIM_ITEMS[0]!.kind).toBe('box')
    // Every facable kind carries an icon — the face renders one unconditionally.
    for (const p of PRIM_ITEMS) expect(p.icon).toBeTruthy()
  })

  it('defaults the primitive face to Box', () => {
    expect(DEFAULT_PRIM_FACE).toBe('box')
    expect(resolvePrimFace(null)).toBe('box')
    expect(resolvePrimFace(undefined)).toBe('box')
    expect(resolvePrimFace('nope')).toBe('box')
    // svgPath is deliberately absent from the menu — it must never become a face.
    expect(resolvePrimFace('svgPath')).toBe('box')
    expect(primFaceLabel(null)).toBe('Box')
    expect(primFaceIcon(null)).toBe(PRIM_ITEMS[0]!.icon)
  })

  it('keeps a picked primitive as the face', () => {
    for (const p of PRIM_ITEMS) {
      expect(resolvePrimFace(p.kind)).toBe(p.kind)
      expect(primFaceLabel(p.kind)).toBe(p.label)
      expect(primFaceIcon(p.kind)).toBe(p.icon)
    }
    expect(primFaceLabel('torusKnot')).toBe('Torus knot')
  })

  it('defaults the light face to the first LIGHT_KIND', () => {
    expect(DEFAULT_LIGHT_FACE).toBe(LIGHT_KINDS[0])
    expect(DEFAULT_LIGHT_FACE).toBe('point')
    expect(resolveLightFace(null)).toBe('point')
    expect(resolveLightFace(undefined)).toBe('point')
    expect(resolveLightFace('nope')).toBe('point')
    expect(lightFaceLabel(null)).toBe('Point')
  })

  it('keeps a picked light kind as the face and labels every kind', () => {
    for (const k of LIGHT_KINDS) {
      expect(resolveLightFace(k)).toBe(k)
      expect(lightFaceLabel(k)).toBe(LIGHT_KIND_LABELS[k])
      expect(LIGHT_KIND_LABELS[k]).toBeTruthy()
    }
    expect(lightFaceLabel('rect')).toBe('Area')
    expect(lightFaceLabel('spot')).toBe('Spot')
  })

  it('pins the decal menu contents and order', () => {
    expect(DECAL_ENTRIES.map(r => r.id)).toEqual(['text', 'image'])
    expect(DECAL_ENTRIES.map(r => r.label)).toEqual(['Text label', 'Image sticker'])
  })

  it('defaults the decal face to the text label and keeps the last-used one', () => {
    expect(DEFAULT_DECAL_FACE).toBe('text')
    expect(resolveDecalFace(null)).toBe('text')
    expect(resolveDecalFace(undefined)).toBe('text')
    expect(resolveDecalFace('nope')).toBe('text')
    expect(decalFaceLabel(null)).toBe('Text label')
    expect(decalFaceIcon(null)).toBe(DECAL_ENTRIES[0]!.icon)
    for (const r of DECAL_ENTRIES) {
      expect(resolveDecalFace(r.id)).toBe(r.id)
      expect(decalFaceLabel(r.id)).toBe(r.label)
      expect(decalFaceIcon(r.id)).toBe(r.icon)
    }
    expect(decalFaceLabel('image')).toBe('Image sticker')
  })
})
