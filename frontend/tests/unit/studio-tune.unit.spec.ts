import { describe, it, expect, vi, beforeEach } from 'vitest'

// studioTune's tuners call the plan/vibe endpoints via ofetch's $fetch — stub it
// so we can drive deterministic responses and assert the node-state plumbing
// (read config → apply patch/commands → write back → restore reverts).
const fetchMock = vi.fn()
vi.mock('ofetch', () => ({ $fetch: (...args: unknown[]) => fetchMock(...args) }))

import { STUDIO_TUNERS, studioTunerFor, tuneGradientNode, tuneShaderNode, tuneTextureNode } from '~/lib/agent/studioTune'
import { defaultConfig as defaultGradientConfig } from '~/lib/gradientfx/randomize'
import { gradientAgentControls } from '~/lib/gradientfx/agentControls'
import { resolvePost } from '~/lib/gradientfx/types'
import { makeConfigParams } from '~/lib/agent/configParams'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'
import { textureDefaults } from '~/lib/texturefx/controls'
import { rolesFor } from '~/lib/texturefx/roles'

const KEY = 'test-key'
beforeEach(() => fetchMock.mockReset())

/** A minimal live-canvas node stub (only the fields the tuners touch). */
function node(nodeType: string, properties: Record<string, unknown> = {}): any {
  return { id: 'n1', data: { nodeType, title: nodeType, properties: { ...properties } } }
}

describe('studioTunerFor registry', () => {
  it('maps every canvas-tunable studio to a tuner', () => {
    for (const t of ['Compositor', 'GradientStudio', 'ShaderStudio', 'TextureStudio', 'SmartLayout', 'ShapeStudio']) {
      expect(typeof studioTunerFor(t)).toBe('function')
      expect(STUDIO_TUNERS[t]).toBeTypeOf('function')
    }
  })
  it('returns undefined for a non-studio node or missing type', () => {
    expect(studioTunerFor('GenerateImageNode')).toBeUndefined()
    expect(studioTunerFor(undefined)).toBeUndefined()
    expect(studioTunerFor(null)).toBeUndefined()
  })
})

describe('tuneGradientNode (param-patch / vibe)', () => {
  it('applies a clamped patch to a fresh node and restore reverts it', async () => {
    // Derive a REAL slider control off the default config so the test isn't tied to
    // a hardcoded key. Aim at the endpoint farthest from its current value so the
    // change is unambiguous after validatePatch snaps/clamps it.
    const probe = defaultGradientConfig()
    const described = describeControls(gradientAgentControls(probe), makeConfigParams(() => probe, () => 0))
    const slider = described.find(d => d.kind === 'slider')!
    expect(slider).toBeTruthy()
    const cur = Number(slider.current)
    const aim = Math.abs(slider.max! - cur) >= Math.abs(cur - slider.min!) ? slider.max! : slider.min!
    const expected = validatePatch({ [slider.path]: aim }, described)[slider.path]

    fetchMock.mockResolvedValueOnce({ changes: [{ key: slider.path, value: aim }], rationale: 'aim there' })
    const n = node('GradientStudio') // no saved config → seeded from a default
    const res = await tuneGradientNode(n, 'crank it', KEY)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect((fetchMock.mock.calls[0]![0] as string)).toBe('/api/vibe')
    expect(res.ok).toBe(true)
    expect(res.rows).toHaveLength(1)
    const saved = n.data.properties.sailor_gradientStudio
    expect(saved).toBeDefined()
    const readBack = makeConfigParams(() => saved, () => 0)[slider.path]
    expect(readBack).toBe(expected)

    res.restore()
    const reverted = makeConfigParams(() => n.data.properties.sailor_gradientStudio, () => 0)[slider.path]
    expect(reverted).toBe(cur) // back to the default's original value
  })

  it('exposes each colour stop and recolours the gradient from a patch', async () => {
    // The default gradient has multiple ramp stops — each must be an offerable
    // colour control, else the agent can't set "blue, pink, orange".
    const probe = defaultGradientConfig()
    const controls = gradientAgentControls(probe)
    const stopControls = controls.filter(c => /^layer\.color\.stops\.\d+\.color$/.test(c.key))
    expect(stopControls.length).toBe(probe.layers[0]!.color.stops.length)
    expect(stopControls.length).toBeGreaterThanOrEqual(3)

    const [c0, c1, c2] = stopControls
    fetchMock.mockResolvedValueOnce({
      changes: [
        { key: c0!.key, value: '#2b6bff' }, // blue
        { key: c1!.key, value: '#ff6ec7' }, // pink
        { key: c2!.key, value: '#ff8c42' }, // orange
      ],
      rationale: 'blue → pink → orange',
    })
    const n = node('GradientStudio')
    const res = await tuneGradientNode(n, 'blue, pink and orange', KEY)
    expect(res.ok).toBe(true)
    const stops = n.data.properties.sailor_gradientStudio.layers[0].color.stops
    expect(stops[0].color).toBe('#2b6bff')
    expect(stops[1].color).toBe('#ff6ec7')
    expect(stops[2].color).toBe('#ff8c42')
  })

  it('is a no-op (ok:false) when the model returns no changes', async () => {
    fetchMock.mockResolvedValueOnce({ changes: [], rationale: 'nothing to do' })
    const n = node('GradientStudio')
    const res = await tuneGradientNode(n, 'do nothing', KEY)
    expect(res.ok).toBe(false)
    expect(res.rows).toHaveLength(0)
    expect(res.notice).toBeTruthy()
    expect(n.data.properties.sailor_gradientStudio).toBeUndefined() // nothing written
  })

  it('preset macro: swaps to the preset base config, THEN applies overrides', async () => {
    fetchMock.mockResolvedValueOnce({
      changes: [{ key: 'preset', value: 'marble' }, { key: 'focus.blur', value: 40 }],
      rationale: 'marble base, softened',
    })
    const n = node('GradientStudio')
    const res = await tuneGradientNode(n, 'blurry blue marble', KEY)
    expect(res.ok).toBe(true)
    const saved = n.data.properties.sailor_gradientStudio
    expect(saved.canvas.layout).toBe('liquid')   // marble preset applied as the base
    expect(saved.focus.blur).toBe(40)            // override applied on top of the preset
    expect(res.rows.some(r => r.after === 'marble')).toBe(true)
    // and the /api/vibe call carried the gradient guidance + offered the preset control
    const body = fetchMock.mock.calls[0]![1].body
    expect(body.guidance).toBeTruthy()
    expect(body.controls.some((c: any) => c.path === 'preset')).toBe(true)
  })

  it('preset macro: an unknown preset name is dropped (validatePatch), no swap', async () => {
    fetchMock.mockResolvedValueOnce({ changes: [{ key: 'preset', value: 'bogus' }], rationale: '' })
    const n = node('GradientStudio')
    const res = await tuneGradientNode(n, 'x', KEY)
    expect(res.ok).toBe(false)   // 'bogus' not an option → dropped → no change
    expect(n.data.properties.sailor_gradientStudio).toBeUndefined()
  })

  it('a grain write survives a legacy relief.grain on the same doc (the invariant resolvePost documents)', async () => {
    // Task 8 invariant: resolvePost derives post.grain* from a legacy relief.grain
    // field at RENDER time and it wins over any saved post — deliberately, so a
    // document never opened in the studio keeps rendering its grain everywhere
    // (node card, bake, timeline, export). ensureConfigDefaults is the only thing
    // that drops relief.grain from a saved blob. Any writer of
    // sailor_gradientStudio that does not run it first has its post.grain* write
    // silently overridden on the very next render — which is exactly what "less
    // grain" from the agent tuner must not do.
    const legacyDoc = defaultGradientConfig()
    legacyDoc.relief.grain = 0.4 // never opened in the studio → legacy field still present
    // 0.18 is an exact multiple of the grainAmount slider's 0.02 step (manifest.ts),
    // so validatePatch's snap doesn't perturb the value we're asserting on.
    fetchMock.mockResolvedValueOnce({ changes: [{ key: 'post.grainAmount', value: 0.18 }], rationale: 'less grain' })
    const n = node('GradientStudio', { sailor_gradientStudio: JSON.parse(JSON.stringify(legacyDoc)) })
    const res = await tuneGradientNode(n, 'less grain', KEY)
    expect(res.ok).toBe(true)

    const saved = n.data.properties.sailor_gradientStudio
    // Every render path calls resolvePost on the raw saved blob — that is what must
    // reflect the tuner's write, not the in-memory config the tuner happened to hold.
    const rendered = resolvePost(saved)
    expect(rendered.grainAmount).toBe(0.18) // NOT 0.4 (the legacy field re-winning)
  })
})

describe('tuneTextureNode (command-surface)', () => {
  it('applies a planned fill command and restore reverts it', async () => {
    const role = rolesFor(textureDefaults())[0]!
    fetchMock.mockResolvedValueOnce({
      text: JSON.stringify({ commands: [{ op: 'setFillColor', target: role, args: { color: '#ff8800' } }] }),
    })
    const n = node('TextureStudio')
    const res = await tuneTextureNode(n, 'make it orange', KEY)

    expect((fetchMock.mock.calls[0]![0] as string)).toBe('/api/agent-plan')
    expect(res.ok).toBe(true)
    expect(res.rows.length).toBeGreaterThanOrEqual(1)
    const saved = n.data.properties.sailor_textureStudio
    expect(JSON.stringify(saved)).toContain('#ff8800')

    res.restore()
    expect(JSON.stringify(n.data.properties.sailor_textureStudio)).not.toContain('#ff8800')
  })
})

describe('tuneShaderNode (param-patch)', () => {
  it('handles an empty patch without touching state', async () => {
    // Fresh config has effect.id === '' so no catalog lookup is needed.
    fetchMock.mockResolvedValueOnce({ changes: [], rationale: '' })
    const n = node('ShaderStudio')
    const res = await tuneShaderNode(n, 'noop', KEY)
    expect(res.ok).toBe(false)
    expect(n.data.properties.sailor_shaderStudio).toBeUndefined()
  })
})

describe('tuneShapeNode', () => {
  it('is registered for the ShapeStudio node type', async () => {
    const { studioTunerFor } = await import('~/lib/agent/studioTune')
    expect(studioTunerFor('ShapeStudio')).toBeTypeOf('function')
  })

  it('migrates a legacy {config} blob to a doc and preserves the wrapper', async () => {
    // sailor_shapeStudio is now { doc, canvasW, canvasH, aspectKey } — the tuner
    // edits the base layer's mark. A legacy { config } blob must migrate (not be
    // read as defaults or written back as a dead `config` key), and the canvas
    // size must survive the write.
    const { __shapeAdapterForTest } = await import('~/lib/agent/studioTune')
    const node: any = { data: { properties: { sailor_shapeStudio: {
      config: { shape: 'star', sides: 7 }, canvasW: 1920, canvasH: 1080, aspectKey: '16:9',
      orbit: { yaw: 1, pitch: 2, zoom: 3 },
    } } } }
    const a = __shapeAdapterForTest
    const cfg = await a.read(node)
    // read migrated the legacy config into the base layer's mark (not defaults).
    expect(cfg.config.shape).toBe('star')
    expect(cfg.config.sides).toBe(7)
    a.write(node, cfg.config)
    const saved = node.data.properties.sailor_shapeStudio
    expect(saved.canvasW).toBe(1920)
    expect(saved.canvasH).toBe(1080)
    expect(saved.aspectKey).toBe('16:9')
    expect(saved.orbit).toEqual({ yaw: 1, pitch: 2, zoom: 3 })
    // Persists the layered doc; the stale legacy `config` key is dropped.
    expect(saved.doc?.layers?.[0]?.mark?.shape).toBe('star')
    expect(saved.config).toBeUndefined()
  })

  it('tunes the base layer of an existing doc (round-trips through doc)', async () => {
    const { __shapeAdapterForTest } = await import('~/lib/agent/studioTune')
    const { defaultDoc } = await import('~/lib/geoshape/studio')
    const doc0 = defaultDoc()
    doc0.layers.push({ ...doc0.layers[0]!, layerId: 'second' }) // a 2nd layer that must survive
    const node: any = { data: { properties: { sailor_shapeStudio: { doc: doc0, canvasW: 800, canvasH: 800 } } } }
    const a = __shapeAdapterForTest
    const cfg = await a.read(node)
    cfg.config.sides = 11
    a.write(node, cfg.config)
    const saved = node.data.properties.sailor_shapeStudio
    expect(saved.doc.layers).toHaveLength(2)                 // 2nd layer preserved
    expect(saved.doc.layers[0].mark.sides).toBe(11)          // base tuned
    expect(saved.doc.layers[1].layerId).toBe('second')
  })

  it('falls back to defaults when the node has never been opened', async () => {
    const { __shapeAdapterForTest } = await import('~/lib/agent/studioTune')
    const node: any = { data: { properties: {} } }
    const { config, controls } = await __shapeAdapterForTest.read(node)
    expect(config.fillMode).toBeDefined()
    expect(controls.length).toBeGreaterThan(0)
  })
})

describe('every registered studio tuner is discoverable by the model', () => {
  it('names each STUDIO_TUNERS key in the canvas tuneNode hint', async () => {
    // Registering a tuner is only half the job: the canvas agent picks tuneNode
    // targets from the prose hint, so a studio absent from that sentence is
    // wired but unreachable — the model never learns it can be tuned.
    const { STUDIO_TUNERS } = await import('~/lib/agent/studioTune')
    const { describeCanvas } = await import('~/lib/agent/surfaces/canvas')
    // Read the hint from what the model is actually handed, not from a module const.
    const surface = describeCanvas({ nodes: [], edges: [] })
    const hint = surface.commands.find((c) => c.op === 'tuneNode')?.hint ?? ''
    expect(hint, 'tuneNode op not found in the canvas surface').not.toBe('')
    for (const nodeType of Object.keys(STUDIO_TUNERS)) {
      expect(hint, `${nodeType} is registered but not named in the tuneNode hint`).toContain(`"${nodeType}"`)
    }
  })
})
