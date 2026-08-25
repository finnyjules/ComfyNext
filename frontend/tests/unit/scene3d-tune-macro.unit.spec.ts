// The 3D Studio tuner's `primitive` MACRO and its ordering contract.
//
// Why this exists: the routing fix (d28a38296) sends "a 3d iridescent diamond" to
// Scene3DStudio, but a freshly added node's SceneDoc has `objects: []` — so the
// tuner that runs straight after the addNode had NOTHING to address. It could set
// doc-level lighting and nothing else: the prompt landed opalescent-on-nothing.
// The macro closes that: `primitive: gem` puts the stone in the scene through the
// studio's OWN creation seam, and the same patch's material overrides land on it.
//
// Only `/api/vibe` is stubbed here (ofetch's imported $fetch, as studioTune.ts
// uses it). Scene3D resolves no catalog, so there is no ambient-global seam to
// stub — unlike the shader macro's twin spec.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.mock('ofetch', () => ({ $fetch: (...args: unknown[]) => fetchMock(...args) }))

import { tuneScene3DNode } from '~/lib/agent/studioTune'
import {
  parseDoc as parseSceneDoc, serializeDoc as serializeSceneDoc,
  defaultDoc, createPrimitive,
  PRIMITIVE_KINDS, NOT_PLACEABLE_KINDS, PLACEABLE_PRIMITIVE_KINDS,
  type SceneDoc, type PrimitiveObject,
} from '~/lib/scene3d/config'
import { PRIMITIVE_PARAMS } from '~/lib/scene3d/primParams'

const KEY = 'test-key'
beforeEach(() => fetchMock.mockReset())

/** A Scene3D node carrying `doc` on its scene_state widget. The widget layout
 *  mirrors what scene3dWidgetIndex looks for. */
function sceneNode(doc: SceneDoc = defaultDoc()): any {
  return {
    id: 'n1',
    data: {
      nodeType: 'Scene3DStudio',
      // The adapter finds the blob by widget NAME, not position.
      widgetDefs: [{ name: 'beauty_image' }, { name: 'scene_state' }],
      widgetsValues: ['', serializeSceneDoc(doc)],
    },
  }
}
const readDoc = (n: any): SceneDoc => parseSceneDoc(String(n.data.widgetsValues[1] ?? ''))
const prims = (d: SceneDoc) => d.objects.filter(o => o.kind === 'primitive') as PrimitiveObject[]
const vibeBody = () => fetchMock.mock.calls[0]![1].body as {
  controls: { path: string; options?: string[] }[]; guidance?: string
}

describe('the `primitive` macro creates the object through the studio’s own seam', () => {
  it('THE CASE: an EMPTY doc + "a 3d iridescent diamond" yields a real gem, opalescent, in ONE patch', async () => {
    fetchMock.mockResolvedValueOnce({
      rationale: 'an iridescent diamond',
      changes: [
        { key: 'primitive', value: 'gem' },
        { key: 'object.material.type', value: 'opalescent' },
        { key: 'object.material.opalHueShift', value: 120 },
      ],
    })
    const node = sceneNode() // objects: []
    const res = await tuneScene3DNode(node, 'a 3d iridescent diamond', KEY)
    expect(res.ok).toBe(true)

    const doc = readDoc(node)
    const p = prims(doc)
    expect(p).toHaveLength(1)
    expect(p[0]!.primitive).toBe('gem')
    // The material overrides from the SAME patch landed on the NEW object —
    // this is the re-describe half of the ordering contract.
    expect(p[0]!.material.type).toBe('opalescent')
    expect(p[0]!.material.opalHueShift).toBe(120)
  })

  it('seeds the gem’s own geometry params, exactly as createPrimitive would', async () => {
    fetchMock.mockResolvedValueOnce({ rationale: '', changes: [{ key: 'primitive', value: 'gem' }] })
    const node = sceneNode()
    await tuneScene3DNode(node, 'a gem', KEY)

    const made = prims(readDoc(node))[0]!
    // Field-for-field what the studio's add menu produces (same seam), so the
    // agent can never mint a shape the picker could not.
    const expected = createPrimitive('gem', [])
    expect(made.primitive).toBe(expected.primitive)
    expect(made.position).toEqual(expected.position)
    expect(made.scale).toEqual(expected.scale)
    expect(made.visible).toBe(true)
    expect(made.name).toBeTruthy()
    // The gem's params are addressable straight after (PRIMITIVE_PARAMS.gem).
    const gemKeys = PRIMITIVE_PARAMS.gem!.map(p => p.key)
    expect(gemKeys).toContain('points')
    expect(gemKeys).toContain('depth')
  })

  it('the macro is offered as a select over the PLACEABLE kinds only', async () => {
    fetchMock.mockResolvedValueOnce({ rationale: '', changes: [] })
    await tuneScene3DNode(sceneNode(), 'anything', KEY)

    const macro = vibeBody().controls.find(c => c.path === 'primitive')
    expect(macro, 'the `primitive` macro must be in the tuner vocabulary').toBeTruthy()
    expect(macro!.options).toEqual(PLACEABLE_PRIMITIVE_KINDS)
    expect(macro!.options).toContain('gem')
    // Kinds that only ever exist carrying imported data are withheld — the agent
    // has no payload for them, and a blank one is not a shape.
    for (const excluded of NOT_PLACEABLE_KINDS) {
      expect(macro!.options, `${excluded} must not be offered`).not.toContain(excluded)
    }
  })

  it('an excluded kind is refused — no object is created', async () => {
    fetchMock.mockResolvedValueOnce({
      rationale: '', changes: [{ key: 'primitive', value: 'svgPath' }],
    })
    const node = sceneNode()
    const res = await tuneScene3DNode(node, 'an svg path', KEY)
    // validatePatch drops it (not in the select's options), so nothing happens.
    expect(prims(readDoc(node))).toHaveLength(0)
    expect(res.ok).toBe(false)
  })
})

describe('same-kind is a NO-OP that preserves hand-tuned work', () => {
  it('does not duplicate, and does not reset the existing gem’s params', async () => {
    // The guidance's worked example primes the model to send `primitive` on
    // nearly every turn, so `{primitive: gem}` on a doc that ALREADY has a gem is
    // the COMMON case — the shader macro's Critical, in additive form. Appending
    // a second gem each turn would be the same class of silent destruction.
    const doc = defaultDoc()
    const gem = createPrimitive('gem', [])
    gem.params = { ...(gem.params ?? {}), points: 30, depth: 1.7 }
    gem.material = { ...gem.material, type: 'opalescent', opalHueShift: 280 }
    gem.position = [1, 2, 3]
    doc.objects.push(gem)

    fetchMock.mockResolvedValueOnce({
      rationale: 'more rainbow',
      changes: [
        { key: 'primitive', value: 'gem' },
        { key: 'object.material.opalStrength', value: 0.8 },
      ],
    })
    const node = sceneNode(doc)
    await tuneScene3DNode(node, 'more rainbow', KEY)

    const p = prims(readDoc(node))
    expect(p, 'a redundant macro must not append a second gem').toHaveLength(1)
    // Hand-tuned geometry + transform survive untouched.
    expect(p[0]!.params?.points).toBe(30)
    expect(p[0]!.params?.depth).toBe(1.7)
    expect(p[0]!.position).toEqual([1, 2, 3])
    expect(p[0]!.material.opalHueShift).toBe(280)
    // …and the same patch's override still lands on that existing gem.
    expect(p[0]!.material.opalStrength).toBe(0.8)
  })

  it('a DIFFERENT kind adds alongside rather than mutating what is there', async () => {
    // The studio has no "change this object's kind" concept anywhere (no control
    // names it, and the surface never assigns `.primitive`). So the macro adds,
    // exactly as the add menu does, and the user's box is left alone.
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', []))

    fetchMock.mockResolvedValueOnce({ rationale: '', changes: [{ key: 'primitive', value: 'gem' }] })
    const node = sceneNode(doc)
    await tuneScene3DNode(node, 'add a gem', KEY)

    const p = prims(readDoc(node))
    expect(p.map(o => o.primitive)).toEqual(['box', 'gem'])
  })
})

describe('the macro control is withheld from the Collections bind vocabulary', () => {
  it('`primitive` is a verb, not a config leaf — binding it would write a dead key', async () => {
    // Same hazard the shader macro documents: `sceneBindableControls` feeds the
    // Collections bind menu, where a persisted binding to `primitive` would set a
    // bogus top-level property on the SceneDoc on every sweep row.
    const { sceneBindableControls } = await import('~/lib/scene3d/agentControls')
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('gem', []))
    expect(sceneBindableControls(doc).some(c => c.key === 'primitive')).toBe(false)
  })
})

describe('placeable-kind derivation', () => {
  it('is PRIMITIVE_KINDS minus the studio’s own NOT_PLACEABLE_KINDS — never a hand-list', () => {
    expect(PLACEABLE_PRIMITIVE_KINDS).toEqual(
      PRIMITIVE_KINDS.filter(k => !NOT_PLACEABLE_KINDS.includes(k)),
    )
    // A new kind added to the studio joins the macro automatically.
    expect(PLACEABLE_PRIMITIVE_KINDS.length).toBe(PRIMITIVE_KINDS.length - NOT_PLACEABLE_KINDS.length)
  })
})
