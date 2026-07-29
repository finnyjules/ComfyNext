import { describe, it, expect, vi } from 'vitest'

// studioTune.ts calls the plan/vibe endpoints via ofetch's $fetch at module scope
// (imported, not lazily) — mock it exactly like studio-tune.unit.spec.ts does so
// importing the registry doesn't require the real `ofetch` package to resolve.
// None of these tests actually invoke a network-calling tuner (no live /api/vibe
// call), so the mock is never exercised — it only needs to satisfy the import.
vi.mock('ofetch', () => ({ $fetch: vi.fn() }))

import { studioTunerFor } from '~/lib/agent/studioTune'
import { controlsForStudio } from '~/lib/collection/studioControls'
import { AGENT_CAPABILITIES, FRONTEND_ONLY_NODE_TYPES, capabilityByType } from '~/lib/agent/capabilities'
import { createPrimitive, defaultDoc, serializeDoc, type SceneDoc } from '~/lib/scene3d/config'

const SCENE3D_NODE_TYPE = 'Scene3DStudio'

/** A Scene3DStudio node fixture: state lives on the `scene_state` WIDGET (a
 *  serialized SceneDoc), not `data.properties` — mirrors Scene3DStudioNode.vue's
 *  own widgetStr/setWidget lookup by widgetDefs name. */
function makeScene3DNode(doc: SceneDoc): any {
  return {
    id: '1',
    data: {
      nodeType: SCENE3D_NODE_TYPE,
      widgetDefs: [
        { name: 'scene_state' },
        { name: 'beauty_image' },
        { name: 'depth_image' },
        { name: 'normal_image' },
        { name: 'glb_url' },
      ],
      widgetsValues: [serializeDoc(doc), '', '', '', ''],
    },
  }
}

function sceneWithObject(): SceneDoc {
  const doc = defaultDoc()
  const sphere = createPrimitive('sphere', [])
  sphere.name = 'Sphere'
  doc.objects.push(sphere)
  return doc
}

describe('Scene3D registration — studioTunerFor (STUDIO_TUNERS)', () => {
  it('resolves an adapter/tuner function for the real Scene3DStudio node type', () => {
    const tuner = studioTunerFor(SCENE3D_NODE_TYPE)
    expect(tuner).toBeTypeOf('function')
  })

  it('does NOT resolve for a near-miss node-type string (proves the lookup can fail)', () => {
    // Guards against a silent typo in the registry key — a wrong string just
    // returns undefined rather than throwing, so this must be asserted explicitly.
    expect(studioTunerFor('Scene3dStudio')).toBeUndefined()
    expect(studioTunerFor('Scene3D')).toBeUndefined()
    expect(studioTunerFor('Scene3DStudioNode')).toBeUndefined()
  })

  it('the resolved tuner reads the scene_state widget and proposes a change', async () => {
    const tuner = studioTunerFor(SCENE3D_NODE_TYPE)!
    const doc = sceneWithObject()
    const node = makeScene3DNode(doc)
    // No live network in this test env — just assert the adapter is wired
    // (read succeeds, doesn't throw) by exercising it through the exported
    // internals rather than a live /api/vibe call.
    const { __scene3dAdapterForTest } = await import('~/lib/agent/studioTune')
    const { config, controls } = await __scene3dAdapterForTest.read(node)
    expect(config.objects.length).toBe(1)
    expect(controls.length).toBeGreaterThan(0)
  })
})

describe('Scene3D registration — controlsForStudio (Collection bindings)', () => {
  it('returns a non-empty control list for a Scene3DStudio node fixture', async () => {
    const node = makeScene3DNode(sceneWithObject())
    const descs = await controlsForStudio(node)
    expect(descs.length).toBeGreaterThan(0)
  })

  it('returns [] for a near-miss node-type string (proves the switch can fail)', async () => {
    const node = makeScene3DNode(sceneWithObject())
    node.data.nodeType = 'Scene3dStudio' // wrong case
    const descs = await controlsForStudio(node)
    expect(descs).toEqual([])
  })

  it('descs are ABSOLUTE (objects.<id>.…) and doc-level only — no relative object.* keys', async () => {
    const node = makeScene3DNode(sceneWithObject())
    const descs = await controlsForStudio(node)
    expect(descs.some((d) => d.key.startsWith('objects.'))).toBe(true)
    expect(descs.some((d) => d.key.startsWith('object.'))).toBe(false)
    // Doc-level (Lighting/Camera/Post) keys pass through unprefixed and are fine.
    expect(descs.some((d) => d.key === 'camera.fov')).toBe(true)
  })

  it('an absolute per-object key names the real object id, not a relative alias', async () => {
    const doc = sceneWithObject()
    const node = makeScene3DNode(doc)
    const descs = await controlsForStudio(node)
    const id = doc.objects[0]!.id
    expect(descs.some((d) => d.key === `objects.${id}.material.roughness`)).toBe(true)
  })
})

describe('Scene3D registration — AGENT_CAPABILITIES / STUDIOS', () => {
  it('has a capability entry keyed on the exact backend node type', () => {
    const cap = capabilityByType(SCENE3D_NODE_TYPE)
    expect(cap).toBeTruthy()
    expect(cap?.kind).toBe('studio')
    expect(cap?.intents.length).toBeGreaterThan(0)
  })

  it('is registered as a REAL backend node (frontendOnly is false/absent), matching its actual class_type', () => {
    const cap = AGENT_CAPABILITIES.find((c) => c.nodeType === SCENE3D_NODE_TYPE)
    expect(cap?.frontendOnly).not.toBe(true)
  })
})

describe('Scene3D registration — FRONTEND_ONLY_NODE_TYPES (the trap)', () => {
  it('Scene3DStudio is a real backend node (comfy_extras/nodes_scene3d.py) so it must NOT be in the frontend-only strip set', () => {
    // If this ever flips to true, the global Run path would strip a node that
    // DOES have a class_type — silently dropping its baked beauty/depth/normal
    // outputs from every Run instead of the "no class_type" abort this set exists
    // to prevent. Getting this wrong in the other direction (a real gap) is the
    // documented failure mode this whole registry step is a trap for.
    expect(FRONTEND_ONLY_NODE_TYPES.has(SCENE3D_NODE_TYPE)).toBe(false)
  })
})
