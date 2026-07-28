import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SCENE_CONTROLS, SCENE_SECTIONS, visibleSceneControls,
} from '~/lib/scene3d/controls'
import {
  defaultDoc, createPrimitive, createLight, createGlbObject, MATERIAL_DEFAULTS, DEFAULT_MATERIAL,
} from '~/lib/scene3d/config'

describe('SCENE_CONTROLS integrity', () => {
  it('every control has a non-empty key, label and group', () => {
    for (const c of SCENE_CONTROLS) {
      expect(c.key, 'key').toBeTruthy()
      expect(c.label, `${c.key} label`).toBeTruthy()
      expect(c.group, `${c.key} group`).toBeTruthy()
    }
  })

  it('every group is declared in SCENE_SECTIONS', () => {
    for (const c of SCENE_CONTROLS) {
      expect(SCENE_SECTIONS, `${c.key} group "${c.group}"`).toContain(c.group)
    }
  })

  it('has unique keys', () => {
    const keys = SCENE_CONTROLS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every select default is one of its own options', () => {
    for (const c of SCENE_CONTROLS) {
      if (c.kind !== 'select') continue
      expect(c.options, c.key).toContain(c.default)
    }
  })

  it('every slider default sits inside its own range', () => {
    for (const c of SCENE_CONTROLS) {
      if (c.kind !== 'slider') continue
      expect(c.default, `${c.key} default`).toBeGreaterThanOrEqual(c.min)
      expect(c.default, `${c.key} default`).toBeLessThanOrEqual(c.max)
      expect(c.max, `${c.key} range`).toBeGreaterThan(c.min)
    }
  })

  // The anti-drift guard: MATERIAL_DEFAULTS is materials.ts's/the Selection UI's real source
  // of truth for these per-type params. Mapped explicitly (rather than derived from the key
  // string) because the relief.* keys use a different naming convention on each side
  // (object.material.relief.scale vs MATERIAL_DEFAULTS.reliefScale) — an explicit map also
  // means a typo'd or removed MATERIAL_DEFAULTS entry fails loudly instead of silently
  // skipping the check.
  const MATERIAL_DEFAULT_KEYS: Record<string, keyof typeof MATERIAL_DEFAULTS> = {
    'object.material.shininess': 'shininess',
    'object.material.clearcoat': 'clearcoat',
    'object.material.clearcoatRoughness': 'clearcoatRoughness',
    'object.material.sheen': 'sheen',
    'object.material.emissiveIntensity': 'emissiveIntensity',
    'object.material.opacity': 'opacity',
    'object.material.iridescence': 'iridescence',
    'object.material.iridescenceIOR': 'iridescenceIOR',
    'object.material.envMapIntensity': 'envMapIntensity',
    'object.material.ior': 'ior',
    'object.material.transmission': 'transmission',
    'object.material.thickness': 'thickness',
    'object.material.relief.scale': 'reliefScale',
    'object.material.relief.contrast': 'reliefContrast',
    'object.material.relief.tiling': 'reliefTiling',
  }

  it('slider defaults match MATERIAL_DEFAULTS where a matching entry exists', () => {
    // Every object.material.* slider is accounted for by EITHER MATERIAL_DEFAULTS
    // (per-type params) or DEFAULT_MATERIAL (the base color/roughness/metalness the two
    // don't share) — so nothing here is silently untested against its real default.
    const materialSliders = SCENE_CONTROLS.filter((c) => c.kind === 'slider' && c.key.startsWith('object.material.')).map((c) => c.key)
    const BASE_KEYS: Record<string, keyof typeof DEFAULT_MATERIAL> = {
      'object.material.roughness': 'roughness',
      'object.material.metalness': 'metalness',
    }
    expect([...Object.keys(MATERIAL_DEFAULT_KEYS), ...Object.keys(BASE_KEYS)].sort()).toEqual([...materialSliders].sort())
    for (const [key, mdKey] of Object.entries(MATERIAL_DEFAULT_KEYS)) {
      const c = SCENE_CONTROLS.find((ctrl) => ctrl.key === key)
      expect(c, key).toBeTruthy()
      expect(c!.kind, key).toBe('slider')
      expect((c as { default: number }).default, key).toBe(MATERIAL_DEFAULTS[mdKey])
    }
    for (const [key, dmKey] of Object.entries(BASE_KEYS)) {
      const c = SCENE_CONTROLS.find((ctrl) => ctrl.key === key)
      expect(c, key).toBeTruthy()
      expect((c as { default: number }).default, key).toBe(DEFAULT_MATERIAL[dmKey])
    }
  })

  it('imports no three — the Collection resolver dynamically imports this module', () => {
    const src = readFileSync(fileURLToPath(new URL('../../app/lib/scene3d/controls.ts', import.meta.url)), 'utf-8')
    expect(src).not.toMatch(/from ['"]three['"]/)
    expect(src).not.toMatch(/from ['"]three\//)
  })

  it('object transform controls are declared not animatable (ObjectMotion owns transforms)', () => {
    const transform = SCENE_CONTROLS.filter((c) => c.group === 'Transform')
    expect(transform.length).toBeGreaterThan(0)
    for (const c of transform) expect(c.animatable, c.key).toBe(false)
  })
})

describe('visibleSceneControls', () => {
  it('drops material controls for a light object', () => {
    const doc = defaultDoc()
    const light = createLight('point', [])
    const keys = visibleSceneControls(doc, light).map((c) => c.key)
    expect(keys.some((k) => k.startsWith('object.material.'))).toBe(false)
  })

  it('keeps the core material controls for a primitive object (default standard material)', () => {
    const doc = defaultDoc()
    const prim = createPrimitive('box', [])
    const keys = visibleSceneControls(doc, prim).map((c) => c.key)
    expect(keys).toContain('object.material.color')
    expect(keys).toContain('object.material.roughness')
    expect(keys).toContain('object.material.metalness')
    expect(keys).toContain('object.material.type')
    expect(keys).toContain('object.material.clearcoat')
    expect(keys).toContain('object.material.relief.scale')
    // phong-only fields are withheld while the material is 'standard'
    expect(keys).not.toContain('object.material.shininess')
  })

  it('drops material controls for a GLB without materialOverride, keeps them once it is set', () => {
    const doc = defaultDoc()
    const glb = createGlbObject('https://example.com/m.glb', [])
    expect(visibleSceneControls(doc, glb).some((c) => c.key.startsWith('object.material.'))).toBe(false)
    glb.materialOverride = true
    expect(visibleSceneControls(doc, glb).some((c) => c.key === 'object.material.color')).toBe(true)
  })

  it('always offers Lighting, Camera and Post controls regardless of the active object', () => {
    const doc = defaultDoc()
    const light = createLight('point', [])
    const keys = visibleSceneControls(doc, light).map((c) => c.key)
    expect(keys).toContain('lighting.sunAzimuth')
    expect(keys).toContain('camera.fov')
    expect(keys).toContain('post.bloomStrength')
  })

  it('returns only members of SCENE_CONTROLS, in SCENE_SECTIONS order', () => {
    const doc = defaultDoc()
    const prim = createPrimitive('box', [])
    const all = new Set(SCENE_CONTROLS.map((c) => c.key))
    const visible = visibleSceneControls(doc, prim)
    for (const c of visible) expect(all.has(c.key), c.key).toBe(true)
    const seenGroups = visible.map((c) => SCENE_SECTIONS.indexOf(c.group as (typeof SCENE_SECTIONS)[number]))
    const sorted = [...seenGroups].sort((a, b) => a - b)
    expect(seenGroups).toEqual(sorted)
  })
})
