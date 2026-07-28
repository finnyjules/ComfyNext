import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { materialFor, updateMaterial } from '~/lib/scene3d/materials'
import { MATERIAL_DEFAULTS, type SceneMaterial } from '~/lib/scene3d/config'

const base = (patch: Partial<SceneMaterial> = {}): SceneMaterial =>
  ({ type: 'standard', color: '#9aa3af', roughness: 0.6, metalness: 0, ...patch })

describe('scene3d relief on materials', () => {
  it('leaves bumpMap null when relief is absent', () => {
    const m = materialFor(base()) as THREE.MeshPhysicalMaterial
    expect(m.bumpMap).toBeNull()
  })

  it('leaves bumpMap null when relief source is none', () => {
    const m = materialFor(base({ relief: { source: 'none', scale: 0.5 } })) as THREE.MeshPhysicalMaterial
    expect(m.bumpMap).toBeNull()
  })

  it('sets bumpScale from relief.scale', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.4 } })) as THREE.MeshPhysicalMaterial
    expect(m.bumpScale).toBe(0.4)
  })

  // A normal map must NEVER go through the bump path — that misreads its blue channel as
  // height. The obvious assertion (bumpMap stays null) is VACUOUS in this suite as originally
  // written: materials.ts's module-level `hasDOM` const (`typeof document !== 'undefined'`,
  // frozen the instant materials.ts is first imported — see its top-of-file doc) is `false` in
  // vitest's node environment, so `getImageTexture` (the function behind BOTH `.map` and
  // `.normalMap`) returns null regardless of what applyRelief does — bumpMap would read null
  // even if applyRelief were rewritten to (wrongly) route `normalImage` through
  // `target.bumpMap = getImageTexture(...)` instead of `target.normalMap = ...`, because THAT
  // call would ALSO return null. The fixture also carried no `relief` at all, so the assertion
  // proved nothing about the normal-map path specifically.
  //
  // Fix: `vi.stubGlobal('document', ...)` alone (the heal spec's trick) does not help here,
  // because `hasDOM` is a frozen top-level const, not the dynamic `typeof document ===
  // 'undefined'` check `getHeightTexture`/`buildHeightTextureFromSpec` use — stubbing `document`
  // AFTER materials.ts has already been imported (as it was, statically, at the top of this
  // file) can't retroactively flip an already-evaluated constant. So this test stubs `document`
  // FIRST, then forces a FRESH evaluation of materials.ts via `vi.resetModules()` + a dynamic
  // `import()`, scoped to this one test — every other test in this file keeps using the
  // original (node-safe, hasDOM=false) module instance bound by the static import at the top.
  // The stub only needs to satisfy three's ImageLoader (`document.createElementNS('...', 'img')`
  // → an element with addEventListener/removeEventListener/src/crossOrigin) — the image never
  // actually loads (no network/XHR polyfill in node), but TextureLoader.load returns a real,
  // non-null `Texture` synchronously regardless, which is all this assertion needs.
  it('never routes a normal map through the bump path', async () => {
    vi.resetModules()
    const fakeImgEl = () => ({
      addEventListener: () => {},
      removeEventListener: () => {},
      crossOrigin: undefined as string | undefined,
      src: '',
    })
    vi.stubGlobal('document', {
      createElementNS: () => fakeImgEl(),
      createElement: () => fakeImgEl(),
    })
    try {
      const fresh = await import('~/lib/scene3d/materials')
      const m = fresh.materialFor(base({ normalImage: 'baked.png' })) as THREE.MeshPhysicalMaterial
      // The real assertion: a normal map reaches `.normalMap` (non-null now that hasDOM is
      // true for this fresh module instance) and NEVER `.bumpMap` (still null — there's no
      // `relief` on this fixture at all, so nothing should ever bind bumpMap here).
      expect(m.normalMap).not.toBeNull()
      expect(m.bumpMap).toBeNull()
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  // The unlit shaderFill case builds a MeshBasicMaterial, which has NO bump slot.
  // Writing to it would silently do nothing; the UI disables the section, and this
  // asserts the factory agrees rather than quietly creating a dead texture.
  it('applies no relief at all to an unlit shaderFill (MeshBasicMaterial)', () => {
    const m = materialFor(base({ type: 'shaderFill', unlit: true, relief: { source: 'image', image: 'h.png', scale: 0.5 } }))
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect((m as any).bumpMap).toBeUndefined()
  })

  it('applies relief to a LIT shaderFill', () => {
    const m = materialFor(base({ type: 'shaderFill', unlit: false, relief: { source: 'image', image: 'h.png', scale: 0.5 } })) as THREE.MeshStandardMaterial
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(m.bumpScale).toBe(0.5)
  })

  it('updates relief scale IN PLACE — a slider drag must not rebuild', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.2 } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'h.png', scale: 0.8 } }))).toBe(true)
    expect((m as THREE.MeshPhysicalMaterial).bumpScale).toBe(0.8)
  })

  it('rebuilds when the relief source or image changes', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'a.png', scale: 0.2 } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'b.png', scale: 0.2 } }))).toBe(false)
    const m2 = materialFor(base({ relief: { source: 'image', image: 'a.png', scale: 0.2 } }))
    expect(updateMaterial(m2, base({ relief: { source: 'shader', scale: 0.2 } }))).toBe(false)
  })

  it('rebuilds when normalImage changes', () => {
    const m = materialFor(base({ normalImage: 'a.png' }))
    expect(updateMaterial(m, base({ normalImage: 'b.png' }))).toBe(false)
  })

  it('applies relief to toon and matcap materials too', () => {
    const toon = materialFor(base({ type: 'toon', relief: { source: 'image', image: 'h.png', scale: 0.3 } })) as THREE.MeshToonMaterial
    expect(toon.bumpScale).toBe(0.3)
    const matcap = materialFor(base({ type: 'matcap', relief: { source: 'image', image: 'h.png', scale: 0.3 } })) as THREE.MeshMatcapMaterial
    expect(matcap.bumpScale).toBe(0.3)
  })

  // Phong has both bumpMap and normalMap slots, same as every other lit material — relief
  // works for it with no extra code in applyRelief (it only guards on 'bumpMap' in target).
  it('applies relief to a phong material too', () => {
    const phong = materialFor(base({ type: 'phong', relief: { source: 'image', image: 'h.png', scale: 0.45 } })) as THREE.MeshPhongMaterial
    expect(phong.bumpScale).toBe(0.45)
  })

  it('rebuilds when invert toggles on an image relief', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.2, invert: false } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'h.png', scale: 0.2, invert: true } }))).toBe(false)
  })

  it('rebuilds when invert toggles on a shader relief', () => {
    const m = materialFor(base({ relief: { source: 'shader', scale: 0.2, invert: false } }))
    expect(updateMaterial(m, base({ relief: { source: 'shader', scale: 0.2, invert: true } }))).toBe(false)
  })

  // C1 fix (final review): `contrast` is a CONTINUOUS slider (StudioSlider fires on every
  // `input` event during a drag), unlike `invert`'s discrete toggle — folding it into
  // reliefKey used to turn a single drag gesture into ~51 material rebuilds (each a fresh
  // canvas + fetch + decode). It must now update IN PLACE, exactly like scale/tiling: same
  // texture object, repainted from the cached source via `reliefSetContrast`.
  it('updates in place when contrast changes on an image relief', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.2, contrast: 1 } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'h.png', scale: 0.2, contrast: 3 } }))).toBe(true)
  })

  it('updates in place when contrast changes on a shader relief', () => {
    const m = materialFor(base({ relief: { source: 'shader', scale: 0.2, contrast: 1 } }))
    expect(updateMaterial(m, base({ relief: { source: 'shader', scale: 0.2, contrast: 3 } }))).toBe(true)
  })

  // The paired assertion that pins the partition: a contrast-ONLY change updates in place,
  // while an invert-ONLY change (contrast held fixed) still rebuilds — invert was deliberately
  // NOT moved to the in-place path (it's a one-shot toggle, not a drag; see reliefKey's doc).
  it('contrast updates in place while invert still rebuilds — the C1 partition', () => {
    const base1 = base({ relief: { source: 'image', image: 'h.png', scale: 0.2, invert: false, contrast: 1 } })
    const mContrast = materialFor(base1)
    expect(updateMaterial(mContrast, base({ relief: { source: 'image', image: 'h.png', scale: 0.2, invert: false, contrast: 4 } }))).toBe(true)

    const mInvert = materialFor(base1)
    expect(updateMaterial(mInvert, base({ relief: { source: 'image', image: 'h.png', scale: 0.2, invert: true, contrast: 1 } }))).toBe(false)
  })

  // Deliberate contrast with the above: `scale` is a slider that must keep updating IN
  // PLACE (a drag must not rebuild per tick) alongside a contrast change also updating in place.
  it('still updates in place when only scale changes, contrast held fixed', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.2, contrast: 2 } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'h.png', scale: 0.9, contrast: 2 } }))).toBe(true)
    expect((m as THREE.MeshPhysicalMaterial).bumpScale).toBe(0.9)
  })

  // Tiling is a Texture.repeat property (materials.ts's applyReliefTiling), never a pixel
  // change — it must update IN PLACE like scale, not force a rebuild.
  it('updates tiling in place — a slider drag must not rebuild', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.2, tiling: 1 } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'h.png', scale: 0.2, tiling: 6 } }))).toBe(true)
  })

  // Deliberate contrast with the above: a contrast-only change (tiling held fixed) must ALSO
  // update in place now — tiling must NOT have been folded into reliefKey, and neither is
  // contrast anymore (C1 fix).
  it('still updates in place on a contrast-only change with tiling held fixed', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.2, tiling: 3, contrast: 1 } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'h.png', scale: 0.2, tiling: 3, contrast: 3 } }))).toBe(true)
  })

  it('still updates scale in place without rebuilding', () => {
    const m = materialFor(base({ relief: { source: 'image', image: 'h.png', scale: 0.2, invert: false } }))
    expect(updateMaterial(m, base({ relief: { source: 'image', image: 'h.png', scale: 0.8, invert: false } }))).toBe(true)
    expect((m as THREE.MeshPhysicalMaterial).bumpScale).toBe(0.8)
  })

  it('does not let invert perturb the key when relief is off', () => {
    const m = materialFor(base({ relief: { source: 'none', invert: false } }))
    expect(updateMaterial(m, base({ relief: { source: 'none', invert: true } }))).toBe(true)
  })

  // Documents the contract that made the Task 5 "Effect selected but nothing renders" bug
  // invisible: a shader relief with no `spec` (and no `mat.shader` fallback) is exactly what
  // Scene3DStudioSurface.vue's matReliefSource setter used to write when the user picked
  // "Effect" — the getter displayed DEFAULT_SHADER_SPEC, but materials.ts had nothing to
  // render from. The literal end-to-end assertion ("no spec -> no bumpMap; spec -> a
  // bumpMap") CANNOT be made to discriminate in this suite: getShaderHeightTexture's very
  // first line is `if (typeof document === 'undefined') return null`, so in node BOTH cases
  // bind no bumpMap regardless of spec — a test comparing them would pass no matter what the
  // fix did, i.e. vacuous. Exercising the spec-present branch for real would require a canvas/
  // WebGL-capable field resolver (shaderfill/field.ts's resolveField) that has no stub
  // anywhere in this suite, and building one is out of scope here.
  //
  // What IS genuinely testable without a DOM is that `relief.spec` is not inert data: it is
  // folded into the material's rebuild identity (reliefKey, via JSON.stringify(spec)), so
  // adding or removing it is a real state transition the system reacts to, not a no-op the
  // renderer silently ignores either way.
  it('treats an added/removed relief.spec as an identity change, not inert data', () => {
    const withoutSpec = base({ relief: { source: 'shader', scale: 0.3 } })
    const withSpec = base({
      relief: {
        source: 'shader', scale: 0.3,
        spec: { effectId: 'fbm_warp', params: {}, anchor: 'object' as const, speed: 1, input: '#ffffff' },
      },
    })
    const m = materialFor(withoutSpec)
    expect(updateMaterial(m, withSpec)).toBe(false) // gaining a spec forces a rebuild
    const m2 = materialFor(withSpec)
    expect(updateMaterial(m2, withoutSpec)).toBe(false) // losing it again also forces one
  })
})
