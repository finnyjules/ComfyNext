import { describe, it, expect, vi, beforeEach } from 'vitest'

// studioTune's tuners call the plan/vibe endpoints via ofetch's $fetch — stub it
// so we can drive deterministic responses and assert the node-state plumbing
// (read config → apply patch/commands → write back → restore reverts).
const fetchMock = vi.fn()
vi.mock('ofetch', () => ({ $fetch: (...args: unknown[]) => fetchMock(...args) }))

import { STUDIO_TUNERS, studioTunerFor, tuneGradientNode, tuneShaderNode, tuneTextureNode } from '~/lib/agent/studioTune'
import { defaultConfig as defaultGradientConfig } from '~/lib/gradientfx/randomize'
import { gradientAgentControls } from '~/lib/gradientfx/agentControls'
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
    for (const t of ['Compositor', 'GradientStudio', 'ShaderStudio', 'TextureStudio', 'SmartLayout']) {
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
    const saved = n.data.properties.comfynext_gradientStudio
    expect(saved).toBeDefined()
    const readBack = makeConfigParams(() => saved, () => 0)[slider.path]
    expect(readBack).toBe(expected)

    res.restore()
    const reverted = makeConfigParams(() => n.data.properties.comfynext_gradientStudio, () => 0)[slider.path]
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
    const stops = n.data.properties.comfynext_gradientStudio.layers[0].color.stops
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
    expect(n.data.properties.comfynext_gradientStudio).toBeUndefined() // nothing written
  })

  it('preset macro: swaps to the preset base config, THEN applies overrides', async () => {
    fetchMock.mockResolvedValueOnce({
      changes: [{ key: 'preset', value: 'marble' }, { key: 'focus.blur', value: 40 }],
      rationale: 'marble base, softened',
    })
    const n = node('GradientStudio')
    const res = await tuneGradientNode(n, 'blurry blue marble', KEY)
    expect(res.ok).toBe(true)
    const saved = n.data.properties.comfynext_gradientStudio
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
    expect(n.data.properties.comfynext_gradientStudio).toBeUndefined()
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
    const saved = n.data.properties.comfynext_textureStudio
    expect(JSON.stringify(saved)).toContain('#ff8800')

    res.restore()
    expect(JSON.stringify(n.data.properties.comfynext_textureStudio)).not.toContain('#ff8800')
  })
})

describe('tuneShaderNode (param-patch)', () => {
  it('handles an empty patch without touching state', async () => {
    // Fresh config has effect.id === '' so no catalog lookup is needed.
    fetchMock.mockResolvedValueOnce({ changes: [], rationale: '' })
    const n = node('ShaderStudio')
    const res = await tuneShaderNode(n, 'noop', KEY)
    expect(res.ok).toBe(false)
    expect(n.data.properties.comfynext_shaderStudio).toBeUndefined()
  })
})
