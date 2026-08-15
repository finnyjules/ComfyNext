// Wiring test for the three.js grain/vignette/duotone passes (Effects Unification
// Task 2, re-scoped — see .superpowers/sdd/ef-2-report.md). No WebGL context exists
// in this repo's vitest (node env, no gl/headless-gl — see the report's harness
// survey), so this deliberately does NOT render pixels. It proves the wiring only:
// construct real three.js ShaderPass instances (pure JS at construction time, no
// GPU needed) and assert applyPostExtras sets the right `.enabled` flag and the
// right uniform values from a PostSettings fixture. Real pixel parity against the
// 2D chain (frontend/app/lib/studio/post/chain.ts) is verified live in Tasks 3/4.
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { makeGrainPass, makeVignettePass, makeDuotonePass, makeDistortPass, applyPostExtras } from '~/lib/studio/post/threePasses'
import { DEFAULT_POST } from '~/lib/studio/post/settings'
import type { PostSettings } from '~~/shared/spacetype/state'

function fixture(overrides: Partial<PostSettings> = {}): PostSettings {
  return {
    ...DEFAULT_POST,
    grain: true, grainAmount: 0.76, grainSize: 5,
    vignette: true, vignetteAmount: 0.6, vignetteRadius: 0.8, vignetteSoftness: 0.3,
    duotone: true, duotoneShadow: '#112233', duotoneHighlight: '#ffaa00', duotoneMix: 0.8,
    ...overrides,
  }
}

describe('threePasses.ts — three.js grain/vignette/duotone passes', () => {
  it('constructs real ShaderPass instances (no GPU needed at construction time)', () => {
    const grain = makeGrainPass()
    const vignette = makeVignettePass()
    const duotone = makeDuotonePass()
    expect(grain.uniforms.tDiffuse).toBeDefined()
    expect(vignette.uniforms.tDiffuse).toBeDefined()
    expect(duotone.uniforms.tDiffuse).toBeDefined()
  })

  // Fix 1 (final review): distort is wired inline in PostChain (spacetype/post.ts),
  // not through applyPostExtras — PostChain needs a real WebGL context to test, so
  // this factory test is the durable check, same limitation as the other passes.
  it('makeDistortPass constructs with tDiffuse/u_resolution/u_amount(0)/u_seed uniforms', () => {
    const distort = makeDistortPass()
    expect(distort.uniforms.tDiffuse).toBeDefined()
    expect(distort.uniforms.u_resolution).toBeDefined()
    expect(distort.uniforms.u_amount!.value).toBe(0)
    expect(distort.uniforms.u_seed).toBeDefined()
  })

  it('wires grain: enabled + amount + size, with a fixed static seed', () => {
    const grainPass = makeGrainPass()
    const vignettePass = makeVignettePass()
    const duotonePass = makeDuotonePass()
    const resolution = new THREE.Vector2(800, 600)

    applyPostExtras({ grain: grainPass, vignette: vignettePass, duotone: duotonePass }, fixture(), resolution, 1.5)

    expect(grainPass.enabled).toBe(true)
    expect(grainPass.uniforms.u_amount!.value).toBe(0.76)
    expect(grainPass.uniforms.u_size!.value).toBe(5)
    // Grain is intentionally static: a fixed seed, NOT derived from timeSeconds.
    expect(grainPass.uniforms.u_seed!.value).toBe(42)
  })

  it('grain seed is STATIC — does not change with timeSeconds (grain never crawls)', () => {
    const grainPass = makeGrainPass()
    const vignettePass = makeVignettePass()
    const duotonePass = makeDuotonePass()
    const resolution = new THREE.Vector2(800, 600)
    const post = fixture()

    applyPostExtras({ grain: grainPass, vignette: vignettePass, duotone: duotonePass }, post, resolution, 2.0)
    const seedA = grainPass.uniforms.u_seed!.value

    // A very different time must produce the SAME seed — grain is frozen, not animated.
    applyPostExtras({ grain: grainPass, vignette: vignettePass, duotone: duotonePass }, post, resolution, 9.25)
    const seedB = grainPass.uniforms.u_seed!.value
    expect(seedB).toBe(seedA)
  })

  it('wires vignette: enabled + amount/radius/softness + resolution', () => {
    const grainPass = makeGrainPass()
    const vignettePass = makeVignettePass()
    const duotonePass = makeDuotonePass()
    const resolution = new THREE.Vector2(1024, 512)

    applyPostExtras({ grain: grainPass, vignette: vignettePass, duotone: duotonePass }, fixture(), resolution, 0)

    expect(vignettePass.enabled).toBe(true)
    expect(vignettePass.uniforms.u_amount!.value).toBe(0.6)
    expect(vignettePass.uniforms.u_radius!.value).toBe(0.8)
    expect(vignettePass.uniforms.u_softness!.value).toBe(0.3)
    const res = vignettePass.uniforms.u_resolution!.value as THREE.Vector2
    expect(res.x).toBe(1024)
    expect(res.y).toBe(512)
  })

  it('wires duotone: enabled + shadow/highlight hex→vec3 + contrast from duotoneMix', () => {
    const grainPass = makeGrainPass()
    const vignettePass = makeVignettePass()
    const duotonePass = makeDuotonePass()
    const resolution = new THREE.Vector2(800, 600)

    applyPostExtras({ grain: grainPass, vignette: vignettePass, duotone: duotonePass }, fixture(), resolution, 0)

    expect(duotonePass.enabled).toBe(true)
    expect(duotonePass.uniforms.u_contrast!.value).toBe(0.8)
    const shadow = duotonePass.uniforms.u_shadow!.value as THREE.Vector3
    const expectedShadow = new THREE.Color('#112233')
    expect(shadow.x).toBeCloseTo(expectedShadow.r, 5)
    expect(shadow.y).toBeCloseTo(expectedShadow.g, 5)
    expect(shadow.z).toBeCloseTo(expectedShadow.b, 5)
    const highlight = duotonePass.uniforms.u_highlight!.value as THREE.Vector3
    const expectedHighlight = new THREE.Color('#ffaa00')
    expect(highlight.x).toBeCloseTo(expectedHighlight.r, 5)
    expect(highlight.y).toBeCloseTo(expectedHighlight.g, 5)
    expect(highlight.z).toBeCloseTo(expectedHighlight.b, 5)
  })

  it('strips alpha from an 8-digit duotone hex before building THREE.Color (the alpha→white gotcha)', () => {
    const grainPass = makeGrainPass()
    const vignettePass = makeVignettePass()
    const duotonePass = makeDuotonePass()
    const resolution = new THREE.Vector2(800, 600)

    applyPostExtras(
      { grain: grainPass, vignette: vignettePass, duotone: duotonePass },
      fixture({ duotoneShadow: '#112233ff', duotoneHighlight: '#ffaa0080' }),
      resolution,
      0,
    )

    const shadow = duotonePass.uniforms.u_shadow!.value as THREE.Vector3
    const expectedShadow = new THREE.Color('#112233')
    expect(shadow.x).toBeCloseTo(expectedShadow.r, 5)
    expect(shadow.y).toBeCloseTo(expectedShadow.g, 5)
    expect(shadow.z).toBeCloseTo(expectedShadow.b, 5)
    // Must NOT have collapsed to white (THREE.Color fails to parse an 8-digit
    // hex string and silently no-ops, leaving its default white) — this is
    // exactly the bug the alpha-strip guards against.
    expect(shadow.x === 1 && shadow.y === 1 && shadow.z === 1).toBe(false)
  })

  it('disabling an effect sets its pass .enabled = false regardless of stale uniform values', () => {
    const grainPass = makeGrainPass()
    const vignettePass = makeVignettePass()
    const duotonePass = makeDuotonePass()
    const resolution = new THREE.Vector2(800, 600)

    applyPostExtras(
      { grain: grainPass, vignette: vignettePass, duotone: duotonePass },
      fixture({ grain: false, vignette: false, duotone: false }),
      resolution,
      0,
    )

    expect(grainPass.enabled).toBe(false)
    expect(vignettePass.enabled).toBe(false)
    expect(duotonePass.enabled).toBe(false)
  })
})
