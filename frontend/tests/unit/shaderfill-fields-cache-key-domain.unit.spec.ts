import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

// Final review, Important 6: `shaderFieldTexture` in ~/lib/spacetype/fills.ts used to key
// `_shaderFieldCache` on the RESOLVED spec (`resolveEffectParams` applied) whenever an effect
// def was available, and on the RAW spec (effect null) otherwise. Those are the SAME authored
// spec producing TWO DIFFERENT key strings depending purely on whether the catalog has loaded
// yet — so a miss (registers an entry under the raw-domain key) followed by a rebuild AFTER
// the catalog resolves (keys the identical spec under the resolved-domain key instead) missed
// the existing entry and registered a SECOND one, with its own CanvasTexture/canvas, orphaning
// the first. The fix keys ALWAYS on the raw spec, so the SAME key is produced whether or not
// `getEffectSync` has resolved yet. Mocks BOTH `~/lib/shaderfill/field` (so the miss → hit
// pixel transition is deterministic) AND `~/lib/shaderfx/catalog` (so `getEffectSync` — which
// fills.ts consults directly, unmocked in shaderfill-fallback-heal's suite — can be flipped
// from "not yet loaded" to "loaded" mid-test, the actual condition that triggers the bug).

const resolveFieldMock = vi.fn()
const getEffectSyncMock = vi.fn()

vi.mock('~/lib/shaderfill/field', () => ({
  resolveField: (...args: unknown[]) => resolveFieldMock(...args),
  withFieldFrame: (_requests: unknown, fn: (frozenCount: number, token: number) => unknown) => fn(0, 1),
}))

vi.mock('~/lib/shaderfx/catalog', () => ({
  getEffectSync: (...args: unknown[]) => getEffectSyncMock(...args),
}))

import { withShaderFillContext, fillTexture, clearShaderFillOwner } from '~/lib/spacetype/fills'
import { DEFAULT_SHADER_SPEC, type Fill } from '~/lib/spacetype/fillTile'

function fakeCanvas() {
  return {
    width: 0, height: 0,
    getContext: () => ({ fillRect: () => {}, fillStyle: '' }),
  } as unknown as HTMLCanvasElement
}

const solidInput: Fill = { type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 0, density: 1 }
// `amount` deliberately has a non-trivial default: raw `params: {}` and the effect's own
// resolved `params: { amount: 0.42 }` are pixel-identical but textually DIFFERENT — the exact
// pair the old resolved-domain key would have split into two entries.
const effectDef = {
  id: 'churnable', name: 'Churnable', category: 'test', animated: true, passes: 1,
  centerParam: null, textures: [], source: '', generative: false,
  params: [{ uniform: 'u_amount', label: 'Amount', type: 'float' as const, min: 0, max: 1, default: 0.42 }],
}
const shaderFill = (effectId = 'churnable', params: Record<string, number> = {}): Fill => ({
  type: 'shader', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 0, density: 1,
  shader: { ...DEFAULT_SHADER_SPEC, effectId, params, input: solidInput },
})

beforeEach(() => {
  resolveFieldMock.mockReset()
  getEffectSyncMock.mockReset()
  vi.stubGlobal('document', { createElement: () => fakeCanvas() })
})

describe('shaderFieldTexture — miss-time key stays stable across a catalog load (Important 6)', () => {
  it('a rebuild AFTER the catalog resolves reuses the SAME cache entry/texture the miss registered, not a second one', () => {
    getEffectSyncMock.mockReturnValue(null)   // catalog not loaded yet at build time
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`

    let tex1: THREE.Texture | null = null
    withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
      tex1 = fillTexture(THREE, shaderFill('churnable', {}))
    })
    expect(tex1).toBeInstanceOf(THREE.CanvasTexture)

    // The catalog "resolves" — getEffectSync now returns the effect def, so resolveEffectParams
    // would produce `{ amount: 0.42 }` (the default) for the SAME raw `params: {}` spec. Before
    // the fix, this changed the key and registered a second, orphaned entry.
    getEffectSyncMock.mockReturnValue(effectDef)
    resolveFieldMock.mockReturnValue(fakeCanvas())
    const disposeSpy1 = vi.spyOn(tex1 as unknown as THREE.CanvasTexture, 'dispose')

    let tex2: THREE.Texture | null = null
    withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
      tex2 = fillTexture(THREE, shaderFill('churnable', {}))
    })

    expect(tex2).toBe(tex1)             // same object — no duplicate registered
    expect(disposeSpy1).not.toHaveBeenCalled() // a HIT never disposes the entry it returns

    clearShaderFillOwner(ownerId)
  })
})

describe('shaderFieldTexture — per-owner cache is bounded during param churn (Important 6)', () => {
  it('churning many distinct raw param values for one owner evicts the OLDEST orphaned entries rather than growing unbounded', () => {
    getEffectSyncMock.mockReturnValue(null)   // simulate a stalled catalog outage throughout
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`

    const textures: THREE.CanvasTexture[] = []
    let firstDisposeSpy: ReturnType<typeof vi.spyOn> | null = null
    // One more than SHADER_FIELD_CACHE_MAX_PER_OWNER (32, see fills.ts) so eviction MUST fire
    // at least once if the cache is actually bounded.
    const CHURN = 40
    for (let i = 0; i < CHURN; i++) {
      withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
        const t = fillTexture(THREE, shaderFill('churnable', { amount: i })) as THREE.CanvasTexture
        textures.push(t)
        if (i === 0) firstDisposeSpy = vi.spyOn(t, 'dispose')   // spy BEFORE it can be evicted
      })
    }
    // Every distinct raw params value is a distinct entry — none of these should have been
    // deduplicated into the SAME texture object.
    expect(new Set(textures).size).toBe(CHURN)

    // The very first (now long-orphaned — nothing rebuilds against amount:0 anymore) entry
    // must have been evicted and disposed once the cache filled past its per-owner cap.
    expect(firstDisposeSpy).toHaveBeenCalled()

    // Re-request the FIRST spec again: since it was evicted, this is a fresh miss — it must
    // return a NEW texture, not the (disposed) original.
    let rebuilt: THREE.Texture | null = null
    withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
      rebuilt = fillTexture(THREE, shaderFill('churnable', { amount: 0 }))
    })
    expect(rebuilt).not.toBe(textures[0])

    // The MOST RECENT entry (just built, still "hot") must NOT have been evicted by its own
    // insertion — it's always safe against the eviction that makes room for it.
    let latest: THREE.Texture | null = null
    withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
      latest = fillTexture(THREE, shaderFill('churnable', { amount: CHURN - 1 }))
    })
    expect(latest).toBe(textures[CHURN - 1])

    clearShaderFillOwner(ownerId)
  })

  it('churn on one owner never evicts a DIFFERENT owner\'s entries', () => {
    getEffectSyncMock.mockReturnValue(null)
    resolveFieldMock.mockReturnValue(null)
    const churner = `test-owner-churn-${Math.random()}`
    const quiet = `test-owner-quiet-${Math.random()}`

    let quietTex: THREE.Texture | null = null
    withShaderFillContext({ ownerId: quiet, w: 64, h: 64, bake: false }, () => {
      quietTex = fillTexture(THREE, shaderFill('churnable', { amount: 999 }))
    })

    for (let i = 0; i < 40; i++) {
      withShaderFillContext({ ownerId: churner, w: 64, h: 64, bake: false }, () => {
        fillTexture(THREE, shaderFill('churnable', { amount: i }))
      })
    }

    // The quiet owner's single entry must still resolve to the SAME texture object —
    // never touched by the churner's own per-owner eviction.
    let quietTex2: THREE.Texture | null = null
    withShaderFillContext({ ownerId: quiet, w: 64, h: 64, bake: false }, () => {
      quietTex2 = fillTexture(THREE, shaderFill('churnable', { amount: 999 }))
    })
    expect(quietTex2).toBe(quietTex)

    clearShaderFillOwner(churner)
    clearShaderFillOwner(quiet)
  })
})
