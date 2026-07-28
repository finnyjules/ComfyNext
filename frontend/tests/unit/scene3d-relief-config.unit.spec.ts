import { describe, it, expect } from 'vitest'
import {
  defaultDoc, createPrimitive, createLight, createGlbObject, serializeDoc, parseDoc,
  sceneHasShaderFill, MATERIAL_DEFAULTS,
} from '~/lib/scene3d/config'
import type { ShaderSpec } from '~/lib/spacetype/fillTile'

describe('scene3d relief doc model', () => {
  it('round-trips a shader relief through serialize → parse', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material.relief = { source: 'shader', scale: 0.4, invert: true }
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects[0]!.material.relief).toEqual({ source: 'shader', scale: 0.4, invert: true })
  })

  // The trap this file exists to catch: parseMaterial is a WHITELIST, and a new optional
  // relief field not explicitly copied there is silently dropped on every save/reload.
  it('round-trips relief.contrast through serialize → parse', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material.relief = { source: 'shader', scale: 0.4, invert: true, contrast: 3.5 }
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects[0]!.material.relief).toEqual({ source: 'shader', scale: 0.4, invert: true, contrast: 3.5 })
  })

  // The same trap, again: tiling is a new optional relief field, and parseMaterial's relief
  // block is a WHITELIST — a field not explicitly copied there is silently dropped.
  it('round-trips relief.tiling through serialize → parse', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material.relief = { source: 'image', image: 'h.png', scale: 0.4, tiling: 4.5 }
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects[0]!.material.relief).toEqual({ source: 'image', image: 'h.png', scale: 0.4, tiling: 4.5 })
  })

  it('coerces a junk tiling to absent instead of dropping the relief block', () => {
    const raw = JSON.parse(serializeDoc(defaultDoc()))
    raw.objects = [{
      ...createPrimitive('box'),
      material: { type: 'standard', color: '#fff', roughness: 0.5, metalness: 0, relief: { source: 'image', image: 'h.png', scale: 0.3, tiling: 'nope' } },
    }]
    const back = parseDoc(JSON.stringify(raw))
    expect('tiling' in back.objects[0]!.material.relief!).toBe(false)
  })

  it('defaults relief tiling to 1', () => {
    expect(MATERIAL_DEFAULTS.reliefTiling).toBe(1)
  })

  it('coerces a junk contrast to the default instead of dropping the relief block', () => {
    const raw = JSON.parse(serializeDoc(defaultDoc()))
    raw.objects = [{
      ...createPrimitive('box'),
      material: { type: 'standard', color: '#fff', roughness: 0.5, metalness: 0, relief: { source: 'image', image: 'h.png', scale: 0.3, contrast: 'nope' } },
    }]
    const back = parseDoc(JSON.stringify(raw))
    // A non-number contrast simply fails the `typeof === 'number'` gate, same as every other
    // optional field — the key stays absent (not coerced-and-kept), so callers fall back to
    // MATERIAL_DEFAULTS.reliefContrast exactly like an old document that never had it.
    expect('contrast' in back.objects[0]!.material.relief!).toBe(false)
  })

  it('defaults relief contrast to 1', () => {
    expect(MATERIAL_DEFAULTS.reliefContrast).toBe(1)
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

// I7 (final review): parseMaterial is a WHITELIST — `shininess`/`specular` ARE correctly copied
// there (unlike relief.contrast/tiling above before their fixes), but nothing exercised that
// copy, so a future edit that dropped one of those two lines the same way relief.contrast/
// tiling once were would ship silently. Same trap this file exists to catch, applied to Phong's
// pair of whitelist fields instead of relief's.
describe('scene3d phong material whitelist fields (I7)', () => {
  it('round-trips a phong material\'s shininess and specular through serialize → parse', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material = { type: 'phong', color: '#9aa3af', roughness: 0.6, metalness: 0, shininess: 87, specular: '#ff8800' }
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects[0]!.material.shininess).toBe(87)
    expect(back.objects[0]!.material.specular).toBe('#ff8800')
  })

  // The paired "absent stays absent" property parseMaterial promises for every optional field
  // (see its own doc: "copy only when present AND valid, so absent fields stay absent") — a
  // material that never set shininess/specular must not gain them from MATERIAL_DEFAULTS on a
  // round-trip, or every old phong document would silently start reporting values it never had.
  it('leaves shininess and specular absent when absent, so old phong docs round-trip exactly', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material = { type: 'phong', color: '#9aa3af', roughness: 0.6, metalness: 0 }
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect('shininess' in back.objects[0]!.material).toBe(false)
    expect('specular' in back.objects[0]!.material).toBe(false)
  })
})

// Task 5 fix: sceneHasShaderFill (the per-frame refresh gate — see its doc in config.ts and
// refreshSceneShaderFields's in materials.ts) used to only recognise the `shaderFill`
// MATERIAL TYPE. A `standard`/`glass`/etc. material carrying a SHADER surface relief never
// satisfied it, so `refreshSceneShaderFields` (the only thing that can heal a relief bumpMap
// left null by a catalog-not-loaded-yet miss) was never even called for a relief-only scene —
// the null bumpMap stayed null forever. Mirrors scene3d-shaderfill.unit.spec.ts's coverage of
// the original shaderFill-type gate, so both paths (and their shared exclusions) stay pinned.
const reliefShaderSpec = (effectId = 'voronoi_cells'): ShaderSpec =>
  ({ effectId, params: {}, anchor: 'object', speed: 1, input: '#ffffff' })

describe('sceneHasShaderFill — widened for shader relief (Task 5 fix)', () => {
  it('is true for a primitive whose material has a shader relief with a spec', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box', doc.objects)
    box.material.relief = { source: 'shader', scale: 0.3, spec: reliefShaderSpec() }
    doc.objects.push(box)
    expect(sceneHasShaderFill(doc)).toBe(true)
  })

  it('is false for a shader relief with no spec attached yet (source picked, nothing to render)', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box', doc.objects)
    box.material.relief = { source: 'shader', scale: 0.3 }
    doc.objects.push(box)
    expect(sceneHasShaderFill(doc)).toBe(false)
  })

  it('is false for an image relief — only a SHADER relief needs the per-frame heal', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box', doc.objects)
    box.material.relief = { source: 'image', image: 'height.png', scale: 0.3 }
    doc.objects.push(box)
    expect(sceneHasShaderFill(doc)).toBe(false)
  })

  it('ignores a light object even if its (never-rendered) material carries a shader relief', () => {
    const doc = defaultDoc()
    const light = createLight('point', doc.objects)
    light.material.relief = { source: 'shader', scale: 0.3, spec: reliefShaderSpec() }
    doc.objects.push(light)
    expect(sceneHasShaderFill(doc)).toBe(false)
  })

  it('ignores a GLB shader relief unless materialOverride is explicitly on', () => {
    const doc = defaultDoc()
    const glb = createGlbObject('https://example.com/m.glb', doc.objects)
    glb.material.relief = { source: 'shader', scale: 0.3, spec: reliefShaderSpec() }
    doc.objects.push(glb)
    expect(sceneHasShaderFill(doc)).toBe(false) // override absent -> the GLB's own material never renders
    glb.materialOverride = true
    expect(sceneHasShaderFill(doc)).toBe(true) // override on -> it does
  })

  it('is still true for the original shaderFill MATERIAL TYPE case (no regression)', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box', doc.objects)
    box.material = { type: 'shaderFill', color: '#ffffff', roughness: 0.6, metalness: 0, shader: reliefShaderSpec('fbm_warp') }
    doc.objects.push(box)
    expect(sceneHasShaderFill(doc)).toBe(true)
  })

  it('is true if any single object in a mixed scene carries a shader relief', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    doc.objects.push(createLight('point', doc.objects))
    const sphere = createPrimitive('sphere', doc.objects)
    sphere.material.relief = { source: 'shader', scale: 0.3, spec: reliefShaderSpec() }
    doc.objects.push(sphere)
    expect(sceneHasShaderFill(doc)).toBe(true)
  })
})
