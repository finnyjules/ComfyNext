// The Shader tuner's `effect` MACRO and its ordering contract.
//
// Two different network seams are stubbed here, and they are not the same one:
//  - `/api/vibe` goes through ofetch's imported $fetch (studioTune.ts).
//  - the effect catalog goes through Nuxt's AMBIENT global $fetch
//    (shaderfx/catalog.ts), which simply does not exist in a node environment.
// Stubbing the global is what gives this file a catalog at all; the companion
// assertion — what the tuner does with NO catalog — lives in
// studio-tune.unit.spec.ts, which deliberately never stubs it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import catalogJson from '../../../shader_effects/manifest.json'

const fetchMock = vi.fn()
vi.mock('ofetch', () => ({ $fetch: (...args: unknown[]) => fetchMock(...args) }))

// Must be in place before the first fetchShaderFxCatalog() call (it caches).
;(globalThis as unknown as { $fetch: unknown }).$fetch = async (url: string) => {
  if (url === '/sailor/shader_effects') return catalogJson
  throw new Error(`unexpected global $fetch: ${url}`)
}

import { tuneShaderNode } from '~/lib/agent/studioTune'
import type { EffectDef } from '~/lib/shaderfx/types'

const KEY = 'test-key'
const CATALOG = (catalogJson as { effects: EffectDef[] }).effects
beforeEach(() => fetchMock.mockReset())

/** A shader node already carrying a picked effect (gaussian_blur) to switch AWAY from. */
function shaderNode(): any {
  return {
    id: 'n1',
    data: {
      nodeType: 'ShaderStudio',
      properties: {
        sailor_shaderStudio: {
          version: 3,
          effects: [{ layerId: 'L0', id: 'gaussian_blur', params: { u_radius: 0.05 }, enabled: true, customChars: '', blend: 'normal', opacity: 1 }],
        },
      },
    },
  }
}
const vibeBody = () => fetchMock.mock.calls[0]![1].body as { controls: { path: string; options?: string[] }[]; guidance?: string }

describe('the `effect` macro swaps the effect and seeds its defaults', () => {
  it('applies the macro FIRST, then the same patch’s uniforms on top of the NEW effect', async () => {
    fetchMock.mockResolvedValueOnce({
      rationale: 'halftone it',
      changes: [
        { key: 'effect', value: 'halftone' },
        { key: 'effects.0.params.u_size', value: 0.05 },
        { key: 'effects.0.params.u_angle', value: 90 },
        // The OLD effect's uniform — meaningless on halftone, must not be written.
        { key: 'effects.0.params.u_radius', value: 0.07 },
        // A stage the patch also turns ON in the same breath.
        { key: 'post.bloom.enabled', value: true },
        { key: 'post.bloom.intensity', value: 2.2 },
      ],
    })
    const n = shaderNode()
    const res = await tuneShaderNode(n, 'make it a halftone print with a glow', KEY)
    expect(res.ok).toBe(true)

    const saved = n.data.properties.sailor_shaderStudio
    expect(saved.effects[0].id).toBe('halftone')
    // Seeded from the NEW effect's defaults (u_softness is halftone-only)…
    expect(saved.effects[0].params.u_softness).toBe(0.12)
    // …with this patch's overrides applied on top…
    expect(saved.effects[0].params.u_size).toBe(0.05)
    expect(saved.effects[0].params.u_angle).toBe(90)
    // …and the OLD effect's uniform gone, not carried over as a dead key.
    expect(saved.effects[0].params.u_radius).toBeUndefined()
    // Enable + tune in ONE patch.
    expect(saved.post.bloom.enabled).toBe(true)
    expect(saved.post.bloom.intensity).toBe(2.2)
  })

  it('reports the swap as a row and restore() puts the old effect back', async () => {
    fetchMock.mockResolvedValueOnce({ changes: [{ key: 'effect', value: 'halftone' }], rationale: 'r' })
    const n = shaderNode()
    const res = await tuneShaderNode(n, 'halftone', KEY)
    const row = res.rows.find(r => r.after === 'halftone')
    expect(row, 'the effect swap must surface as a proposal row').toBeTruthy()
    expect(row!.before).toBe('gaussian_blur')
    res.restore()
    expect(n.data.properties.sailor_shaderStudio.effects[0].id).toBe('gaussian_blur')
    expect(n.data.properties.sailor_shaderStudio.effects[0].params.u_radius).toBe(0.05)
  })

  it('never writes the macro key itself onto the config (it is a verb, not a leaf)', async () => {
    fetchMock.mockResolvedValueOnce({ changes: [{ key: 'effect', value: 'halftone' }], rationale: '' })
    const n = shaderNode()
    await tuneShaderNode(n, 'halftone', KEY)
    expect(n.data.properties.sailor_shaderStudio.effect).toBeUndefined()
  })

  it('leaves the effect alone for an unknown id, and still applies the scalars', async () => {
    fetchMock.mockResolvedValueOnce({ changes: [{ key: 'effect', value: 'not_a_real_effect' }, { key: 'adjust.enabled', value: true }], rationale: '' })
    const n = shaderNode()
    await tuneShaderNode(n, 'nonsense', KEY)
    const saved = n.data.properties.sailor_shaderStudio
    expect(saved.effects[0].id).toBe('gaussian_blur')
    expect(saved.adjust.enabled).toBe(true)
  })
})

describe('what the shader tuner hands the model', () => {
  it('offers the whole catalog as the `effect` control', async () => {
    fetchMock.mockResolvedValueOnce({ changes: [], rationale: '' })
    await tuneShaderNode(shaderNode(), 'anything', KEY)
    const effect = vibeBody().controls.find(c => c.path === 'effect')
    expect(effect, '`effect` must be offered when the catalog resolves').toBeTruthy()
    expect(effect!.options).toEqual(CATALOG.map(e => e.id))
  })

  it('offers stage params whose stage is OFF, plus that stage’s enable', async () => {
    fetchMock.mockResolvedValueOnce({ changes: [], rationale: '' })
    await tuneShaderNode(shaderNode(), 'anything', KEY)
    const paths = vibeBody().controls.map(c => c.path)
    for (const k of ['post.bloom.enabled', 'post.bloom.intensity', 'duotone.enabled', 'duotone.ink', 'adjust.enabled', 'adjust.temperature', 'effects.0.mask.enabled', 'effects.0.mask.shape']) {
      expect(paths, `${k} must be in the offered vocabulary`).toContain(k)
    }
  })

  it('sends the derived effect index + the honesty clause as guidance', async () => {
    fetchMock.mockResolvedValueOnce({ changes: [], rationale: '' })
    await tuneShaderNode(shaderNode(), 'anything', KEY)
    const g = String(vibeBody().guidance)
    expect(g).toContain('EFFECTS YOU MAY PICK')
    for (const id of CATALOG.map(e => e.id)) expect(g, `${id} missing from the derived index`).toContain(id)
    expect(g).toMatch(/approximat/i)
    expect(g).toMatch(/never present/i)
  })
})
