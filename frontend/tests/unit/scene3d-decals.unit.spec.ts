import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import {
  parseDoc, serializeDoc, defaultDoc, createDecal, createPrimitive, createLight,
  DECAL_DEFAULTS, type DecalObject,
} from '~/lib/scene3d/config'
import {
  eulerFromNormal, decalKeyFor, DecalTextureRegistry, DECAL_TEX_CACHE_MAX, canvasFontPlanFor,
} from '~/lib/scene3d/decals'
import { setLibraryFaceResolver } from '~/lib/scene3d/outlines'

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

  it('drops a decal whose target EXISTS but is a light', () => {
    // The other arm of the same survivor filter: `byId.get(targetId)` is
    // truthy here, so only the `.kind === 'primitive'` half rejects it. A light
    // has no geometry to project onto — keeping it would leave a decal root
    // parented to a light forever, invisible and un-fixable from the panel.
    const lamp = createLight('point', [])
    const d = { ...createDecal(lamp.id, { position: [0, 0, 0], rotation: [0, 0, 0] },
      { type: 'text', text: 'X', font: 'f', color: '#000' }, []) }
    const back = parseDoc(docWith([lamp, d]))
    expect(back.objects.some(o => o.kind === 'decal')).toBe(false)
    expect(back.objects.some(o => o.id === lamp.id)).toBe(true) // the light itself survives
  })

  it('coerces a stored decal whose parentId diverged from its targetId', () => {
    // The hierarchy edge must always mirror the projection target: the engine
    // follows targetId, everything else (grouping, transforms, delete cascade)
    // follows parentId. A doc hand-edited — or written by a build where a
    // reparent could split them — must not load with the two disagreeing.
    const box = createPrimitive('box')
    const other = createPrimitive('sphere')
    const d = createDecal(box.id, { position: [0, 0, 0.5], rotation: [0, 0, 0] },
      { type: 'text', text: 'Z', font: 'f', color: '#000' }, [box])
    const back = parseDoc(docWith([box, other, { ...d, parentId: other.id }]))
    const parsed = back.objects.find(o => o.kind === 'decal') as DecalObject
    expect(parsed.targetId).toBe(box.id)
    expect(parsed.parentId).toBe(box.id)
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

describe('scene3d decals — projector math', () => {
  it.each([
    [[0, 0, 1]], [[0, 0, -1]], [[1, 0, 0]], [[0, 1, 0]], [[0.5, 0.5, 0.7071]],
  ] as const)('eulerFromNormal(%j): applying the euler to +Z recovers the normal', (n) => {
    const e = eulerFromNormal([n[0], n[1], n[2]])
    const v = new THREE.Vector3(0, 0, 1)
      .applyEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'))
    const expected = new THREE.Vector3(...n).normalize()
    expect(v.distanceTo(expected)).toBeLessThan(1e-6)
  })

  it('decalKeyFor changes with pose/content/target geometry, not opacity', () => {
    const base = { kind: 'decal', id: 'd', name: 'D', visible: true, targetId: 't',
      position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], material: {} as any,
      content: { type: 'text', text: 'A', font: 'f', color: '#000' },
      size: 0.6, depth: 0.25, spin: 0, opacity: 1 } as any
    const k = decalKeyFor(base, 'geo1')
    expect(decalKeyFor({ ...base, opacity: 0.3 }, 'geo1')).toBe(k)
    expect(decalKeyFor({ ...base, spin: 1 }, 'geo1')).not.toBe(k)
    expect(decalKeyFor(base, 'geo2')).not.toBe(k)
    expect(decalKeyFor({ ...base, content: { ...base.content, text: 'B' } }, 'geo1')).not.toBe(k)
  })
})

describe('scene3d decals — texture registry (LRU + refcount)', () => {
  // Plain THREE.Texture, no GL context needed: dispose() only fires an event
  // and flips a version counter, which is exactly what we assert on.
  const makeTex = () => new THREE.Texture()
  const spy = (t: THREE.Texture) => vi.spyOn(t, 'dispose')

  it('caches by key and re-uses the same promise', async () => {
    const reg = new DecalTextureRegistry(4)
    let built = 0
    const make = () => { built++; return Promise.resolve(makeTex()) }
    const a = reg.get('k', make)
    const b = reg.get('k', make)
    expect(a).toBe(b)
    expect(built).toBe(1)
    await a
    expect(reg.size).toBe(1)
  })

  it('evicts least-recently-used past the cap and disposes the unreferenced texture', async () => {
    const reg = new DecalTextureRegistry(2)
    const t1 = makeTex(); const t2 = makeTex(); const t3 = makeTex()
    const d1 = spy(t1)
    await reg.get('a', () => Promise.resolve(t1))
    await reg.get('b', () => Promise.resolve(t2))
    await reg.get('c', () => Promise.resolve(t3)) // pushes 'a' out
    expect(reg.size).toBe(2)
    expect(d1).toHaveBeenCalledTimes(1)   // nothing referenced it
    expect(reg.isCached(t1)).toBe(false)
    expect(reg.isCached(t2)).toBe(true)
  })

  it('a cache HIT refreshes recency, so the untouched key is the one evicted', async () => {
    const reg = new DecalTextureRegistry(2)
    const t1 = makeTex(); const t2 = makeTex(); const t3 = makeTex()
    const d1 = spy(t1); const d2 = spy(t2)
    await reg.get('a', () => Promise.resolve(t1))
    await reg.get('b', () => Promise.resolve(t2))
    reg.get('a', () => Promise.reject(new Error('should not rebuild'))) // touch 'a'
    await reg.get('c', () => Promise.resolve(t3))
    expect(d1).not.toHaveBeenCalled()
    expect(d2).toHaveBeenCalledTimes(1)
  })

  it('NEVER disposes a texture a live decal mesh still references', async () => {
    const reg = new DecalTextureRegistry(1)
    const t1 = makeTex(); const t2 = makeTex()
    const d1 = spy(t1)
    await reg.get('a', () => Promise.resolve(t1))
    reg.acquire(t1)                                  // a decal mesh is painting with it
    await reg.get('b', () => Promise.resolve(t2))    // evicts 'a'
    expect(reg.isCached(t1)).toBe(false)
    expect(d1).not.toHaveBeenCalled()                // still on screen
    reg.release(t1)                                  // that mesh goes away
    expect(d1).toHaveBeenCalledTimes(1)              // evicted AND unreferenced ⇒ freed
  })

  it('releases refcount to zero before disposing (two meshes, one texture)', async () => {
    const reg = new DecalTextureRegistry(1)
    const t1 = makeTex(); const t2 = makeTex()
    const d1 = spy(t1)
    await reg.get('a', () => Promise.resolve(t1))
    reg.acquire(t1); reg.acquire(t1)
    await reg.get('b', () => Promise.resolve(t2)) // evict 'a' while doubly referenced
    reg.release(t1)
    expect(reg.refCount(t1)).toBe(1)
    expect(d1).not.toHaveBeenCalled()
    reg.release(t1)
    expect(d1).toHaveBeenCalledTimes(1)
  })

  it('a release while the texture is STILL cached never disposes it', async () => {
    const reg = new DecalTextureRegistry(4)
    const t1 = makeTex()
    const d1 = spy(t1)
    await reg.get('a', () => Promise.resolve(t1))
    reg.acquire(t1)
    reg.release(t1)                       // mesh rebuilt; the cache still owns the texture
    expect(d1).not.toHaveBeenCalled()
    expect(reg.isCached(t1)).toBe(true)
  })

  it('evicts a failed load so the next sync retries', async () => {
    const reg = new DecalTextureRegistry(4)
    await expect(reg.get('a', () => Promise.reject(new Error('404')))).rejects.toThrow('404')
    await Promise.resolve() // let the internal catch run
    expect(reg.size).toBe(0)
    const t = makeTex()
    await expect(reg.get('a', () => Promise.resolve(t))).resolves.toBe(t)
  })

  it('the shared registry is bounded', () => {
    expect(DECAL_TEX_CACHE_MAX).toBeLessThanOrEqual(64)
    expect(DECAL_TEX_CACHE_MAX).toBeGreaterThan(0)
  })
})

describe('decal canvas font plan', () => {
  it('google token routes to the css2 path with its weight', () => {
    expect(canvasFontPlanFor('google:Space Grotesk@500'))
      .toEqual({ kind: 'google', family: 'Space Grotesk', weight: 500 })
    expect(canvasFontPlanFor('google:Inter'))
      .toEqual({ kind: 'google', family: 'Inter', weight: 700 })
  })

  it('library token routes to a file plan via the installed resolver', () => {
    setLibraryFaceResolver((family, weight) => (family === 'Neue Montreal' ? `nm-${weight ?? 400}` : null))
    try {
      expect(canvasFontPlanFor('local:Neue Montreal@700')).toEqual({
        kind: 'file',
        cssFamily: 'decal-local_Neue_Montreal_700',
        url: '/api/library-font/nm-700',
      })
    } finally { setLibraryFaceResolver(null) }
  })

  it('library token with no resolver (or unknown family) falls back to Inter', () => {
    expect(canvasFontPlanFor('local:Ghost Family')).toEqual({ kind: 'google', family: 'Inter', weight: 700 })
  })

  it('pinned font URL routes to a file plan keyed by the sanitized url', () => {
    const plan = canvasFontPlanFor('/fonts/SpaceGrotesk.ttf')
    expect(plan).toEqual({ kind: 'file', cssFamily: 'decal-_fonts_SpaceGrotesk_ttf', url: '/fonts/SpaceGrotesk.ttf' })
  })

  it('garbage falls back to Inter', () => {
    expect(canvasFontPlanFor('not a font token')).toEqual({ kind: 'google', family: 'Inter', weight: 700 })
  })
})
