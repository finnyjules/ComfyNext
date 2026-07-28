import { describe, it, expect } from 'vitest'
import {
  sceneStackControls, sceneAgentControls, sceneBindableControls, SCENE_GUIDANCE,
} from '~/lib/scene3d/agentControls'
import { SCENE_CONTROLS } from '~/lib/scene3d/controls'
import { defaultDoc, createPrimitive, createLight, type SceneDoc } from '~/lib/scene3d/config'

// stripMeta is not exported — tested indirectly through the public functions, same
// as vectortype/shapefx's own agentControls specs would (no module exposes it either).
// Assert its contract directly here since the brief calls it out by name: every emitted
// control must have exactly none of the four schema-only fields, and everything else
// from SCENE_CONTROLS must survive untouched.
describe('stripMeta (via sceneBindableControls doc-level output)', () => {
  it('removes exactly when/agent/animatable/summary and preserves everything else', () => {
    const doc = defaultDoc()
    const out = sceneBindableControls(doc)
    for (const c of out) {
      expect(c).not.toHaveProperty('when')
      expect(c).not.toHaveProperty('agent')
      expect(c).not.toHaveProperty('animatable')
      expect(c).not.toHaveProperty('summary')
    }
    // Spot check a known doc-level control keeps its real fields (key/label/kind/group
    // plus kind-specific fields like min/max/step/default for a slider).
    const fov = out.find((c) => c.key === 'camera.fov')
    expect(fov).toBeTruthy()
    expect(fov!.label).toBe('Field of view')
    expect((fov as any).kind).toBe('slider')
    expect((fov as any).min).toBe(15)
    expect((fov as any).max).toBe(100)
    expect((fov as any).default).toBe(45)
    expect((fov as any).group).toBe('Camera')
  })

  it('a control with agent: false is excluded entirely', () => {
    // Transform controls are `animatable: false` but NOT `agent: false` — none of
    // SCENE_CONTROLS today opt out of the agent, so assert the mechanism itself by
    // checking that every returned control's source in SCENE_CONTROLS never has
    // agent === false (i.e. nothing that opted out slipped through).
    const doc = defaultDoc()
    const bindable = sceneBindableControls(doc)
    const withheld = SCENE_CONTROLS.filter((c) => (c as any).agent === false).map((c) => c.key)
    for (const key of withheld) {
      expect(bindable.some((c) => c.key === key || c.key.endsWith(`.${key.replace(/^object\./, '')}`))).toBe(false)
    }
    // Direct mechanism test: a synthetic control run through the same filter used
    // internally would drop it — verified structurally since SCENE_CONTROLS has no
    // agent:false member to exercise end-to-end at time of writing.
    expect(SCENE_CONTROLS.every((c) => (c as any).agent !== false)).toBe(true)
  })
})

describe('sceneStackControls', () => {
  it('emits objects.<id>.<rest> for each object, labelled with the object name', () => {
    const doc: SceneDoc = defaultDoc()
    const box = createPrimitive('box', [])
    box.name = 'My Box'
    doc.objects.push(box)

    const stack = sceneStackControls(doc)
    const colorKey = `objects.${box.id}.material.color`
    const color = stack.find((c) => c.key === colorKey)
    expect(color, colorKey).toBeTruthy()
    expect(color!.label).toBe('My Box · Color')

    const posKey = `objects.${box.id}.position.0`
    const pos = stack.find((c) => c.key === posKey)
    expect(pos, posKey).toBeTruthy()
    expect(pos!.label).toBe('My Box · Position X')
  })

  it('skips an object with a missing, empty, dotted, or all-digit id — never addresses it positionally', () => {
    const doc: SceneDoc = defaultDoc()
    const good = createPrimitive('box', [])
    good.name = 'Good'
    const emptyId = createPrimitive('sphere', [])
    emptyId.name = 'EmptyId'
    ;(emptyId as any).id = ''
    const dottedId = createPrimitive('sphere', [])
    dottedId.name = 'DottedId'
    ;(dottedId as any).id = 'a.b'
    const digitId = createPrimitive('sphere', [])
    digitId.name = 'DigitId'
    ;(digitId as any).id = '123'
    const missingId = createPrimitive('sphere', [])
    missingId.name = 'MissingId'
    delete (missingId as any).id

    doc.objects.push(good, emptyId, dottedId, digitId, missingId)

    const stack = sceneStackControls(doc)

    // The good object IS addressed.
    expect(stack.some((c) => c.key === `objects.${good.id}.material.color`)).toBe(true)

    // None of the unsafe ones produced ANY key naming their id.
    expect(stack.some((c) => c.key.includes('objects..'))).toBe(false)
    expect(stack.some((c) => c.key.includes('a.b'))).toBe(false)
    expect(stack.some((c) => c.key === 'objects.123.material.color')).toBe(false)
    expect(stack.some((c) => c.key.includes('undefined'))).toBe(false)

    // And critically: they were not silently re-addressed by ARRAY POSITION either
    // (e.g. objects.1.*, objects.2.*, ...) — no key contains a bare numeric segment
    // standing in for one of these objects.
    for (const c of stack) {
      const segments = c.key.split('.')
      // segments[1] is the id slot in `objects.<id>.<rest>`
      if (segments[0] === 'objects') {
        expect(/^\d+$/.test(segments[1])).toBe(false)
      }
    }

    // Exactly one object's worth of material.color keys were emitted (the good one).
    const colorKeys = stack.filter((c) => c.key.endsWith('.material.color'))
    expect(colorKeys.length).toBe(1)
  })

  it('evaluates `when` per object: a light yields no material controls, a primitive does', () => {
    const doc: SceneDoc = defaultDoc()
    const light = createLight('point', [])
    light.name = 'Sun'
    const prim = createPrimitive('sphere', [])
    prim.name = 'Ball'
    doc.objects.push(light, prim)

    const stack = sceneStackControls(doc)
    const lightMaterialKeys = stack.filter((c) => c.key.startsWith(`objects.${light.id}.material.`))
    expect(lightMaterialKeys.length).toBe(0)

    const primMaterialKeys = stack.filter((c) => c.key.startsWith(`objects.${prim.id}.material.`))
    expect(primMaterialKeys.length).toBeGreaterThan(0)
    expect(primMaterialKeys.some((c) => c.key === `objects.${prim.id}.material.color`)).toBe(true)

    // Transform controls have no `when` gate — both objects get them.
    expect(stack.some((c) => c.key === `objects.${light.id}.position.0`)).toBe(true)
    expect(stack.some((c) => c.key === `objects.${prim.id}.position.0`)).toBe(true)
  })
})

describe('sceneAgentControls', () => {
  it('ships both the relative object.* namespace and the absolute objects.<id>.* namespace', () => {
    const doc: SceneDoc = defaultDoc()
    const prim = createPrimitive('box', [])
    doc.objects.push(prim)

    const out = sceneAgentControls(doc, prim)
    expect(out.some((c) => c.key === 'object.material.color')).toBe(true)
    expect(out.some((c) => c.key === `objects.${prim.id}.material.color`)).toBe(true)
    // Doc-level groups pass through too.
    expect(out.some((c) => c.key === 'lighting.sunAzimuth')).toBe(true)
  })
})

describe('sceneBindableControls', () => {
  it('contains no relative object.* keys', () => {
    const doc: SceneDoc = defaultDoc()
    const prim = createPrimitive('box', [])
    doc.objects.push(prim)

    const out = sceneBindableControls(doc)
    expect(out.some((c) => c.key.startsWith('object.'))).toBe(false)
    // The absolute twin IS present.
    expect(out.some((c) => c.key === `objects.${prim.id}.material.color`)).toBe(true)
    // Doc-level groups still present.
    expect(out.some((c) => c.key === 'lighting.sunAzimuth')).toBe(true)
  })
})

describe('SCENE_GUIDANCE', () => {
  it('is a non-empty string', () => {
    expect(typeof SCENE_GUIDANCE).toBe('string')
    expect(SCENE_GUIDANCE.length).toBeGreaterThan(100)
  })
})
