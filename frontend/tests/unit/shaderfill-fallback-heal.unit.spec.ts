import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

// Final review, Item 2 (Critical, residual): a `resolveField` MISS used to return the
// input fill's texture directly and insert NOTHING into fills.ts's `_shaderFieldCache`
// — but `refreshLiveShaderFills` only ever iterates EXISTING entries, so a miss with no
// entry could never be found and healed by the next preview frame. Only a fresh
// `withShaderFillContext` BUILD (mount, or a debounced config change) could retry, so a
// hard-reload racing the shader-fx catalog fetch fell back forever even though the
// node's own rAF preview kept calling `refreshLiveShaderFills` every frame — there was
// simply no cache entry there to retry. Mocks `~/lib/shaderfill/field` directly so the
// miss → hit transition is deterministic and doesn't depend on real WebGL.

const resolveFieldMock = vi.fn()

vi.mock('~/lib/shaderfill/field', () => ({
  resolveField: (...args: unknown[]) => resolveFieldMock(...args),
  withFieldFrame: (_requests: unknown, fn: (frozenCount: number, token: number) => unknown) => fn(0, 1),
}))

import { withShaderFillContext, fillTexture, refreshLiveShaderFills, clearShaderFillOwner } from '~/lib/spacetype/fills'
import { DEFAULT_SHADER_SPEC, type Fill } from '~/lib/spacetype/fillTile'

/** Minimal fake 2D canvas — only exercises fillTileBox's `solid` branch
 *  (`ctx.fillStyle = ...; ctx.fillRect(...)`), the cheapest input fill shape, since this
 *  suite is about the cache-registration/heal LOGIC, not fillTileBox's rasterisation. */
function fakeCanvas() {
  return {
    width: 0, height: 0,
    getContext: () => ({ fillRect: () => {}, fillStyle: '' }),
  } as unknown as HTMLCanvasElement
}

const solidInput: Fill = { type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 0, density: 1 }
const shaderFill = (effectId: string): Fill => ({
  type: 'shader', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 0, density: 1,
  shader: { ...DEFAULT_SHADER_SPEC, effectId, input: solidInput },
})

beforeEach(() => {
  resolveFieldMock.mockReset()
  vi.stubGlobal('document', { createElement: () => fakeCanvas() })
})

describe('shaderFieldTexture — a MISS still registers a healable cache entry (Item 2)', () => {
  it('a miss builds a texture AND registers it, so refreshLiveShaderFills can later heal it in place', () => {
    resolveFieldMock.mockReturnValue(null)   // simulate "effect not loaded yet"
    const ownerId = `test-owner-${Math.random()}`

    let tex: THREE.Texture | null = null
    withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
      tex = fillTexture(THREE, shaderFill('not_yet_loaded'))
    })
    expect(tex).toBeInstanceOf(THREE.CanvasTexture)

    // Before the fix, a miss registered nothing — refreshLiveShaderFills would find
    // ZERO entries for this owner (frozenCount: 0 by the early return) and never even
    // attempt a resolveField retry. Confirm it does NOT early-return here: it must
    // actually invoke resolveField for this owner's (now-registered) entry.
    refreshLiveShaderFills(ownerId, 0, 30, 64, 64, false)
    expect(resolveFieldMock).toHaveBeenCalled()

    // The catalog "resolves" on a later frame — refreshLiveShaderFills must heal the
    // SAME texture object in place (per resolveField's ownership contract: bind
    // directly, never allocate a new CanvasTexture per frame), mirroring
    // ~/lib/scene3d/materials.ts's identical heal branch for the null-map case.
    const realCanvas = fakeCanvas()
    resolveFieldMock.mockReturnValue(realCanvas)
    refreshLiveShaderFills(ownerId, 1, 30, 64, 64, false)
    expect((tex as unknown as THREE.CanvasTexture).image).toBe(realCanvas)

    clearShaderFillOwner(ownerId)
  })

  it('a HIT at build time registers the entry the same way (no behaviour change on the success path)', () => {
    const ownerId = `test-owner-${Math.random()}`
    const realCanvas = fakeCanvas()
    resolveFieldMock.mockReturnValue(realCanvas)

    let tex: THREE.Texture | null = null
    withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
      tex = fillTexture(THREE, shaderFill('already_loaded'))
    })
    expect((tex as unknown as THREE.CanvasTexture).image).toBe(realCanvas)

    // Re-resolving the SAME spec under the SAME owner must return the cached texture,
    // not build a second one.
    let tex2: THREE.Texture | null = null
    withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
      tex2 = fillTexture(THREE, shaderFill('already_loaded'))
    })
    expect(tex2).toBe(tex)

    clearShaderFillOwner(ownerId)
  })

  it('clearShaderFillOwner disposes the miss-registered texture like any other entry', () => {
    resolveFieldMock.mockReturnValue(null)
    const ownerId = `test-owner-${Math.random()}`
    let tex: THREE.CanvasTexture | null = null
    withShaderFillContext({ ownerId, w: 64, h: 64, bake: false }, () => {
      tex = fillTexture(THREE, shaderFill('not_yet_loaded')) as THREE.CanvasTexture
    })
    const disposeSpy = vi.spyOn(tex!, 'dispose')
    clearShaderFillOwner(ownerId)
    expect(disposeSpy).toHaveBeenCalled()
  })
})
