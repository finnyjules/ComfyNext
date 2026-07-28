# Scene3D Surface Relief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Scene3D materials believable surface relief from three sources (shader field, uploaded image, AI prompt), all routed through a single grayscale height texture bound to THREE's `.bumpMap`.

**Architecture:** One seam. Every producer emits a grayscale height canvas; `materialFor` binds it to `.bumpMap` + `bumpScale` and THREE derives the perturbed normal in the fragment shader. No Sobel pass, no normalization, no tangent handling. A separate `normalImage` slot handles real baked tangent-space normal maps via `.normalMap`.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, three@0.171.0, Vitest 4 (node environment), fal via existing `runFal` helpers.

**Spec:** `docs/superpowers/specs/2026-07-27-scene3d-surface-relief-design.md`

## Global Constraints

- **Test runner is Vitest, but `npm run test` is Playwright.** Always run unit tests with `npx vitest run tests/unit/<file>.unit.spec.ts` from `frontend/`.
- **All unit tests live flat** in `frontend/tests/unit/<kebab-name>.unit.spec.ts`. Not colocated, not in `__tests__/`.
- **Test environment is `node`, no DOM.** THREE materials construct fine without WebGL (verified: 30/30 pass in `scene3d-materials.unit.spec.ts`). Anything needing `document.createElement('canvas')` is NOT unit-testable here — keep pixel logic in pure functions over `Uint8ClampedArray`.
- **Import aliases:** `~/` → `frontend/app/`, `~~/` → `frontend/`.
- **Server routes are untestable in isolation** (Nitro auto-imports, no route test harness exists). All testable logic goes in `server/utils/`; routes stay thin `defineEventHandler` wrappers.
- **`relief.image` is ALWAYS a grayscale height map.** Conversion happens once at authoring time, never at render time.
- **Default `relief.scale` is `0.25`.** `bumpScale: 1` is already extreme.
- **UI copy must never call this a "normal pass"** — `passes.ts:54` already emits a screen-space `normal` G-buffer for ControlNet. Use the word "relief" throughout.
- **Typecheck baseline is ~328 errors.** `npx vue-tsc --noEmit` is NOT installed and downloads on first run (~390s). Grep for your own touched files rather than demanding a clean run.
- Working tree has ~106 files modified by parallel sessions. **Stage only your own files by explicit path.** Never `git add -A`, never `git stash`.

---

### Task 1: Doc model — `relief` + `normalImage`

The material parser is a **whitelist** (`config.ts:455-509`, each optional field explicitly copied). A new field that isn't added there is silently dropped on every save/reload. This task is the round-trip.

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` (type at `:38-91`, defaults at `:220`, parser at `:455-509`)
- Test: `frontend/tests/unit/scene3d-relief-config.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `ReliefSpec` interface; `SceneMaterial.relief?: ReliefSpec`; `SceneMaterial.normalImage?: string`; `MATERIAL_DEFAULTS.reliefScale: number`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/scene3d-relief-config.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defaultDoc, createPrimitive, serializeDoc, parseDoc, MATERIAL_DEFAULTS } from '~/lib/scene3d/config'

describe('scene3d relief doc model', () => {
  it('round-trips a shader relief through serialize → parse', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material.relief = { source: 'shader', scale: 0.4, invert: true }
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects[0]!.material.relief).toEqual({ source: 'shader', scale: 0.4, invert: true })
  })

  it('round-trips an image relief and a normalImage', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    obj.material.relief = { source: 'image', image: 'height.png', scale: 0.25 }
    obj.material.normalImage = 'baked_normal.png'
    doc.objects = [obj]
    const back = parseDoc(serializeDoc(doc))
    expect(back.objects[0]!.material.relief!.image).toBe('height.png')
    expect(back.objects[0]!.material.normalImage).toBe('baked_normal.png')
  })

  it('leaves relief absent when absent, so old docs round-trip exactly', () => {
    const doc = defaultDoc()
    doc.objects = [createPrimitive('box')]
    const back = parseDoc(serializeDoc(doc))
    expect('relief' in back.objects[0]!.material).toBe(false)
    expect('normalImage' in back.objects[0]!.material).toBe(false)
  })

  it('coerces a junk source to none and a junk scale to the default', () => {
    const raw = JSON.parse(serializeDoc(defaultDoc()))
    raw.objects = [{ ...createPrimitive('box'), material: { type: 'standard', color: '#fff', roughness: 0.5, metalness: 0, relief: { source: 'wat', scale: 'nope' } } }]
    const back = parseDoc(JSON.stringify(raw))
    expect(back.objects[0]!.material.relief).toEqual({ source: 'none', scale: MATERIAL_DEFAULTS.reliefScale })
  })

  it('defaults relief scale to 0.25', () => {
    expect(MATERIAL_DEFAULTS.reliefScale).toBe(0.25)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-relief-config.unit.spec.ts
```

Expected: FAIL — `MATERIAL_DEFAULTS.reliefScale` is `undefined`, and `relief` is dropped by `parseMaterial`.

- [ ] **Step 3: Add the type**

In `frontend/app/lib/scene3d/config.ts`, immediately above `export interface SceneMaterial` (line 38):

```ts
/** Surface relief — a grayscale height field perturbing the lit normal via THREE's
 *  `.bumpMap`. `image` is ALWAYS already a height map: converting a colour photo to
 *  height happens once at authoring time (see lib/scene3d/relief.ts), never at render
 *  time. `spec` mirrors the shaderFill ShaderSpec and is luminance-converted the same
 *  way, so every catalog effect gains relief with no per-effect shader work. */
export interface ReliefSpec {
  source: 'none' | 'shader' | 'image'
  spec?: ShaderSpec
  image?: string
  /** → THREE bumpScale. 1 is already extreme; the shipped default is 0.25. */
  scale: number
  invert?: boolean
}
```

Then inside `SceneMaterial`, after the `unlit?: boolean` field (line 75):

```ts
  /** Surface relief. Absent = flat, exactly as before. Never applied to an `unlit`
   *  shaderFill: that builds a MeshBasicMaterial, which has no bump slot at all. */
  relief?: ReliefSpec
  /** A REAL baked tangent-space normal map (Blender, a game asset) → `.normalMap`.
   *  Distinct from `relief` because a normal map must NOT go through the bump path —
   *  that would misread its blue channel as height. */
  normalImage?: string
```

- [ ] **Step 4: Add the default**

In `MATERIAL_DEFAULTS` (line 220), after `envMapIntensity: 1,`:

```ts
  reliefScale: 0.25,
```

- [ ] **Step 5: Add the parser entries**

In `parseMaterial`, immediately after the `if (typeof m?.unlit === 'boolean') out.unlit = m.unlit` line:

```ts
    // Relief: same "copy only when present" rule as every other optional field, but the
    // nested shape needs its own coercion — a junk source degrades to 'none' rather than
    // dropping the whole block, so a hand-edited doc still loads.
    if (m?.relief && typeof m.relief === 'object') {
      const r = m.relief
      const rel: ReliefSpec = {
        source: r.source === 'shader' || r.source === 'image' ? r.source : 'none',
        scale: num(r.scale, MATERIAL_DEFAULTS.reliefScale),
      }
      if (typeof r.image === 'string') rel.image = r.image
      if (r.spec && typeof r.spec === 'object') rel.spec = normalizeShaderSpec(r.spec, 0)
      if (typeof r.invert === 'boolean') rel.invert = r.invert
      out.relief = rel
    }
    if (typeof m?.normalImage === 'string') out.normalImage = m.normalImage
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-relief-config.unit.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Run the existing config suite to verify nothing regressed**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts
```

Expected: PASS. The "absent stays absent" round-trip guarantee is what this protects.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/scene3d/config.ts frontend/tests/unit/scene3d-relief-config.unit.spec.ts
git commit -m "feat(scene3d): relief + normalImage on SceneMaterial"
```

---

### Task 2: Pure height conversion

The pixel transform shared by every producer. Kept as a pure function over `Uint8ClampedArray` because the test environment is `node` with no DOM — a canvas-based helper would be untestable.

**Files:**
- Create: `frontend/app/lib/scene3d/relief.ts`
- Test: `frontend/tests/unit/scene3d-relief.unit.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `toHeightPixels(rgba: Uint8ClampedArray, invert?: boolean): Uint8ClampedArray` — in-place-safe, returns a new array, alpha preserved at 255.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/scene3d-relief.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toHeightPixels } from '~/lib/scene3d/relief'

// One pixel = 4 entries (r,g,b,a).
const px = (...rgb: number[]) => new Uint8ClampedArray([...rgb, 255])

describe('toHeightPixels', () => {
  it('collapses colour to a single luminance value across all three channels', () => {
    const out = toHeightPixels(px(255, 0, 0))
    // Rec. 709 luma of pure red ≈ 0.2126 * 255 ≈ 54
    expect(out[0]).toBe(54)
    expect(out[1]).toBe(54)
    expect(out[2]).toBe(54)
  })

  it('weights green most and blue least', () => {
    const red = toHeightPixels(px(255, 0, 0))[0]!
    const green = toHeightPixels(px(0, 255, 0))[0]!
    const blue = toHeightPixels(px(0, 0, 255))[0]!
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })

  it('is a no-op on an already-grayscale pixel', () => {
    expect(toHeightPixels(px(128, 128, 128))[0]).toBe(128)
  })

  it('inverts when asked', () => {
    expect(toHeightPixels(px(255, 255, 255), true)[0]).toBe(0)
    expect(toHeightPixels(px(0, 0, 0), true)[0]).toBe(255)
  })

  it('forces alpha opaque so a transparent source cannot punch holes in the height field', () => {
    const out = toHeightPixels(new Uint8ClampedArray([10, 20, 30, 0]))
    expect(out[3]).toBe(255)
  })

  it('does not mutate its input', () => {
    const src = px(255, 0, 0)
    toHeightPixels(src)
    expect(src[0]).toBe(255)
  })

  it('handles a multi-pixel buffer', () => {
    const out = toHeightPixels(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))
    expect(out[0]).toBe(255)
    expect(out[4]).toBe(0)
    expect(out.length).toBe(8)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-relief.unit.spec.ts
```

Expected: FAIL — cannot resolve `~/lib/scene3d/relief`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/scene3d/relief.ts`:

```ts
// Surface relief helpers. The pixel transform lives here as a pure function over raw
// RGBA so it is unit-testable in the repo's node test environment (no DOM, no canvas).
// Every relief producer — uploaded image, AI-generated tile, shader field — funnels
// through toHeightPixels, so there is exactly one definition of "height" in Scene3D.

/** Rec. 709 luma weights — the perceptual convention, so a green-dominant texture does
 *  not read as uniformly higher than a red one of the same apparent brightness. */
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

/** Collapse RGBA to a grayscale height field. Returns a NEW buffer; the input is not
 *  mutated. Alpha is forced opaque: a transparent source pixel has no meaningful height,
 *  and leaving it transparent would punch a hole THREE samples as zero. */
export function toHeightPixels(rgba: Uint8ClampedArray, invert = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const luma = LUMA_R * rgba[i]! + LUMA_G * rgba[i + 1]! + LUMA_B * rgba[i + 2]!
    const v = Math.round(invert ? 255 - luma : luma)
    out[i] = v
    out[i + 1] = v
    out[i + 2] = v
    out[i + 3] = 255
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-relief.unit.spec.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/relief.ts frontend/tests/unit/scene3d-relief.unit.spec.ts
git commit -m "feat(scene3d): pure luminance→height pixel transform"
```

---

### Task 3: Bind relief in the material factory

The load-bearing task. After this, relief renders — a hand-edited `scene_state` produces visible surface detail with no UI yet.

`identityKey` (`materials.ts:494-509`) decides rebuild-vs-in-place. Source and image changes swap the texture object and must rebuild; `scale` and `invert` must NOT (scale is a slider — rebuilding per tick would jank).

**Files:**
- Modify: `frontend/app/lib/scene3d/materials.ts` (`identityKey` at `:494`, `materialFor` at `:342`, `updateMaterial` at `:511`)
- Test: `frontend/tests/unit/scene3d-relief-material.unit.spec.ts`

**Interfaces:**
- Consumes: `ReliefSpec`, `MATERIAL_DEFAULTS.reliefScale` (Task 1); `toHeightPixels` (Task 2)
- Produces: `applyRelief(m: THREE.Material, mat: SceneMaterial): void` exported from `materials.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/scene3d-relief-material.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
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

  // A normal map must NEVER go through the bump path — that misreads its blue channel
  // as height. Asserted as bumpMap staying null rather than normalMap being non-null,
  // because texture LOADING needs a DOM and this suite runs in node.
  it('never routes a normal map through the bump path', () => {
    const m = materialFor(base({ normalImage: 'baked.png' })) as THREE.MeshPhysicalMaterial
    expect(m.bumpMap).toBeNull()
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
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-relief-material.unit.spec.ts
```

Expected: FAIL — `bumpScale` is the THREE default `1`, not `0.4`.

- [ ] **Step 3: Extend `identityKey` to cover relief**

`identityKey` currently switches on `mat.type` and returns early per case. Relief is orthogonal to type, so it must be **appended to every key**, not folded into one case. Replace the function at `materials.ts:494-509` with:

```ts
/** The part of relief that forces a material REBUILD: which texture object is bound.
 *  `scale` is deliberately excluded — it is a slider, and rebuilding a material per
 *  tick would jank; it updates in place (see updateMaterial). `invert` IS included:
 *  height textures are cached per (filename, invert), so an inverted map is a
 *  genuinely different texture object, and a toggle clicked occasionally can afford
 *  a rebuild. Excluding it made toggling Invert silently do nothing. */
function reliefKey(mat: SceneMaterial): string {
  const r = mat.relief
  const relief = !r || r.source === 'none'
    ? '-'
    : r.source === 'image'
      ? `i:${r.image ?? ''}:${r.invert === true ? 1 : 0}`
      : `s:${r.spec ? JSON.stringify(r.spec) : ''}:${r.invert === true ? 1 : 0}`
  return `|${relief}|n:${mat.normalImage ?? ''}`
}

function identityKey(mat: SceneMaterial): string {
  return baseIdentityKey(mat) + reliefKey(mat)
}

function baseIdentityKey(mat: SceneMaterial): string {
  switch (mat.type) {
    case 'toon': return `toon:${mat.toonSteps ?? MATERIAL_DEFAULTS.toonSteps}`
    case 'matcap': return `matcap:${mat.matcap ?? MATERIAL_DEFAULTS.matcap}`
    case 'image': return `image:${mat.image ?? ''}`
    // `unlit` picks the THREE material CLASS (Basic vs Standard) — that boundary needs a
    // rebuild; the effect/params/speed/input inside `shader` are refreshed in place every
    // frame by refreshSceneShaderFields, never through this identity (see updateMaterial).
    case 'shaderFill': return `shaderFill:${mat.unlit === true ? 1 : 0}`
    // Program variant boundary: smooth vs facet (faceted/prismatic share the
    // facet program and switch via the uMode uniform in place).
    case 'gradient':
      return `gradient:${(mat.gradientShading ?? MATERIAL_DEFAULTS.gradientShading) === 'smooth' ? 'smooth' : 'facet'}`
    default: return mat.type
  }
}
```

- [ ] **Step 4: Write `applyRelief` and call it from `materialFor`**

Add near the other texture helpers in `materials.ts` (beside `getImageTexture`):

```ts
/** Bind relief onto an already-constructed material. Applied AFTER per-type construction
 *  so it composes with every material type instead of being special-cased per branch.
 *
 *  MeshBasicMaterial (the `unlit` shaderFill class) has neither a bumpMap nor a normalMap
 *  slot — there is no lighting to perturb — so relief is skipped entirely rather than
 *  writing a property THREE will ignore. The UI disables the section to match. */
export function applyRelief(m: THREE.Material, mat: SceneMaterial): void {
  const target = m as THREE.MeshStandardMaterial
  if (!('bumpMap' in target)) return

  const r = mat.relief
  if (r && r.source !== 'none') {
    const tex = r.source === 'image'
      ? (r.image ? getHeightTexture(r.image, r.invert === true) : null)
      : getShaderHeightTexture(mat, r)
    target.bumpMap = tex
    target.bumpScale = r.scale ?? MATERIAL_DEFAULTS.reliefScale
  } else {
    target.bumpMap = null
  }

  target.normalMap = mat.normalImage ? getImageTexture(mat.normalImage) : null
  target.needsUpdate = true
}
```

Then in `materialFor`, immediately before the material is returned (after the per-type switch produces `m`), add:

```ts
  applyRelief(m, mat)
```

Both texture loaders go alongside `getImageTexture`. Import `toHeightPixels` from `~/lib/scene3d/relief`.

**The `typeof document === 'undefined'` guard is load-bearing, not defensive padding:** this suite runs in node, and without it `new Image()` throws and every test in Step 1 fails for the wrong reason.

```ts
const heightCache = new Map<string, THREE.Texture>()

/** Load an input-dir image and convert it to a height field. Cached per
 *  (filename, invert) since inverting produces a genuinely different texture.
 *  Returns null outside a browser — the unit suite runs in node, where the
 *  factory must still set bumpScale and simply bind no texture. */
function getHeightTexture(filename: string, invert: boolean): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const key = `${filename}|${invert ? 1 : 0}`
  const hit = heightCache.get(key)
  if (hit) return hit

  const tex = new THREE.Texture()
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, c.width, c.height)
    data.data.set(toHeightPixels(data.data, invert))
    ctx.putImageData(data, 0, 0)
    tex.image = c
    tex.needsUpdate = true
  }
  img.src = `/view?filename=${encodeURIComponent(filename)}&type=input`
  heightCache.set(key, tex)
  return tex
}

/** Relief from a shader field: resolve the field, then run the SAME luminance
 *  transform as the image path. No per-effect height mode — every catalog effect
 *  gains relief with zero shader work. Not cached: the spec can change per edit,
 *  and identityKey already rebuilds the material when it does. */
function getShaderHeightTexture(mat: SceneMaterial, r: ReliefSpec): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const spec = r.spec ?? mat.shader
  if (!spec) return null
  const src = resolveField({ spec, w: 512, h: 512, t: 0, fps: 30 })
  if (!src) return null

  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(src, 0, 0)
  const data = ctx.getImageData(0, 0, c.width, c.height)
  data.data.set(toHeightPixels(data.data, r.invert === true))
  ctx.putImageData(data, 0, 0)
  return new THREE.CanvasTexture(c)
}
```

- [ ] **Step 5: Update relief in place in `updateMaterial`**

`updateMaterial` returns early only on identity mismatch, then switches per type. Relief is orthogonal, so add this immediately after the identity guard at `materials.ts:512` and before the `switch`:

```ts
  // Relief SCALE is an in-place update for EVERY material type — identityKey already
  // forced a rebuild if the bound texture itself changed (source, image, spec, or
  // invert). Do NOT try to handle invert here: it rebuilds, by design.
  const rt = m as THREE.MeshStandardMaterial
  if ('bumpScale' in rt && mat.relief && mat.relief.source !== 'none') {
    rt.bumpScale = mat.relief.scale ?? MATERIAL_DEFAULTS.reliefScale
  }
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-relief-material.unit.spec.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 7: Run the whole scene3d + shaderfill suite for regressions**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-shaderfill.unit.spec.ts tests/unit/scene3d-shaderfill-null-map-heal.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts
```

Expected: PASS. `identityKey` was rewritten — this is the blast radius.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/scene3d/materials.ts frontend/tests/unit/scene3d-relief-material.unit.spec.ts
git commit -m "feat(scene3d): bind relief to bumpMap, normalImage to normalMap"
```

---

### Task 4: Spike bump compatibility with `gradient` and `fresnel`

**Deliberately early, not last.** `gradient` (`materials.ts:407`) and `fresnel` (`:364`) inject shader code via `onBeforeCompile` near the normal fragment — exactly where bump support can break. If it does break, later tasks build on a false assumption. This task is a runtime check with a written verdict, not new production code.

**Files:**
- Modify (only if the spike finds a break): `frontend/app/lib/scene3d/materials.ts`
- Create: a short verdict appended to the spec's "Known risks" section

**Interfaces:**
- Consumes: `applyRelief` (Task 3)
- Produces: a documented yes/no on gradient + fresnel bump support

- [ ] **Step 1: Start the dev server**

Use the project's launcher (it reaps orphaned servers from parallel sessions):

```bash
cd /Users/julien/Documents/GitHub/Sailor && ./dev.sh
```

Open `http://127.0.0.1:3000` — **not** `localhost`, which hits the IPv6 WS listener and 426s.

- [ ] **Step 2: Build the test scene**

Add a Scene3D Studio node, add a sphere, and set its material to `gradient`. Hand-edit relief onto it via the browser console (the UI does not exist until Task 5):

```js
// Find the scene doc, attach an image relief, force a rebuild.
// Adjust the selector to the live node id.
window.__sailorScene3dDoc.objects[0].material.relief =
  { source: 'image', image: '<an uploaded grayscale height file>', scale: 1 }
```

If no such global exists, upload a height image via the existing `image` material's Upload control first to get a filename into the input dir, then set `relief` through whatever doc handle the surface exposes.

- [ ] **Step 3: Verify with a deliberately broken control**

Set `scale` to `0` and then to `2`. **The render must visibly change between the two.** A graceful fallback to a flat surface looks identical to success — "I looked and it rendered" is not evidence the bump path ran.

Repeat for `fresnel`, and for `standard` as the known-good control.

- [ ] **Step 4: Record the verdict**

Append to the "Known risks" section of `docs/superpowers/specs/2026-07-27-scene3d-surface-relief-design.md`, replacing risk 2's text with the actual finding — either:

> **RESOLVED 2026-07-XX:** bump confirmed working on `gradient` and `fresnel`; their `onBeforeCompile` injection does not interfere.

or a description of the break plus the fix applied.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-27-scene3d-surface-relief-design.md
git commit -m "docs(scene3d): record relief/onBeforeCompile spike verdict"
```

If a fix to `materials.ts` was needed, add that file to the same commit and describe the fix in the message body.

---

### Task 5: The Surface UI section

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (material state proxies at `:337-420`, Material section at `:1649+`, upload script at `:450-495`)

**Interfaces:**
- Consumes: `ReliefSpec` (Task 1), `applyRelief` (Task 3)
- Produces: user-reachable relief authoring; no new exports

House conventions to match exactly (from `Scene3DStudioSurface.vue`):
- Sub-group heading: `<p class="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/35">Surface</p>` wrapping a `<div class="space-y-3">`
- Label-left/control-right row: `<div class="flex items-center justify-between"><span class="text-[11px] text-white/55">Label</span><Control v-model="…" /></div>`
- `<StudioSlider v-model="x" label="…" hint="…" :min :max :step />` — **every slider carries a plain-English `hint`**
- `<StudioSwitch v-model="x" />` — no label prop; the label is a sibling you write
- `<StudioSegmented :options="[...]" v-model="x" />`
- Type gating: `v-if="matEditable && matType === '…'"` on a `<template>`
- Material state proxies are `computed` with explicit get/set writing into `selected.value.material.*`, falling back to `MATERIAL_DEFAULTS` on read

- [ ] **Step 1: Add the state proxies**

Beside the other material proxies (~`:337-420`):

```ts
const matReliefSource = computed<'none' | 'shader' | 'image'>({
  get: () => selected.value?.material.relief?.source ?? 'none',
  set: (v) => {
    const mat = selected.value?.material
    if (!mat) return
    mat.relief = { ...(mat.relief ?? { scale: MATERIAL_DEFAULTS.reliefScale }), source: v }
  },
})
const matReliefScale = computed<number>({
  get: () => selected.value?.material.relief?.scale ?? MATERIAL_DEFAULTS.reliefScale,
  set: (v) => {
    const mat = selected.value?.material
    if (!mat?.relief) return
    mat.relief.scale = v
  },
})
const matReliefInvert = computed<boolean>({
  get: () => selected.value?.material.relief?.invert === true,
  set: (v) => {
    const mat = selected.value?.material
    if (!mat?.relief) return
    mat.relief.invert = v
  },
})
/** Relief needs lighting to perturb. An unlit shaderFill is a MeshBasicMaterial with no
 *  bump slot at all — disable rather than silently no-op (materials.ts applyRelief). */
const reliefAvailable = computed(() => !(matType.value === 'shaderFill' && matUnlit.value))
```

- [ ] **Step 2: Add the template section**

Inside `<StudioSection title="Material">`, **after** the per-type `v-if`/`v-else-if` chain closes (so it applies to every material type):

```vue
        <!-- Surface relief. NB: never call this a "normal pass" in copy — passes.ts
             already emits a screen-space `normal` G-buffer for ControlNet. -->
        <div v-if="matEditable">
          <p class="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/35">Surface relief</p>
          <p v-if="!reliefAvailable" class="text-[10px] text-white/35">
            Unlit materials have no lighting to catch relief. Turn off Unlit to use it.
          </p>
          <div v-else class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-white/55">Relief</span>
              <StudioSegmented v-model="matReliefSource" :options="[
                { value: 'none', label: 'None' },
                { value: 'shader', label: 'Effect' },
                { value: 'image', label: 'Image' },
              ]" />
            </div>
            <template v-if="matReliefSource !== 'none'">
              <StudioSlider v-model="matReliefScale" label="Depth"
                hint="How raised or recessed the surface detail looks" :min="0" :max="1" :step="0.01" />
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Invert</span>
                <StudioSwitch v-model="matReliefInvert" />
              </div>
            </template>
          </div>
        </div>
```

- [ ] **Step 3: Add the image sub-branch**

When `matReliefSource === 'image'`, reuse the existing upload pattern from `:1801-1827`. Copy its structure exactly — hidden `<input type="file">`, `StudioButton` with a `Loader2` spinner, `texUploading` holding the **object id** (not a boolean) so the spinner only shows on the object the upload started for, and **capture the target object into a local before any `await`** so reselecting mid-upload cannot land the texture on the wrong object.

On upload, convert to height before persisting: decode to a canvas, run `toHeightPixels`, re-encode, then `inpaint.uploadDataUrl(heightDataUrl, \`scene3d_relief_${props.nodeId}\`)`. Offer the three authoring conversions from the spec — **Brightness** (default, free, local), **Refine with depth** (Task 6, paid), **Use as-is** (already a height map).

Also add the normal-map escape hatch, visible only once an image is chosen:

```vue
              <div class="flex items-center justify-between">
                <div>
                  <span class="text-[11px] text-white/55">Already a normal map</span>
                  <p class="text-[10px] text-white/35">For maps baked in Blender or from a game asset</p>
                </div>
                <StudioSwitch v-model="matIsNormalMap" />
              </div>
```

Ticking it moves the filename from `material.relief.image` to `material.normalImage` and disables Invert.

- [ ] **Step 4: Add the shader sub-branch**

When `matReliefSource === 'shader'`, render the existing `ShaderFillEditor` bound to `material.relief.spec`, exactly as the `shaderFill` branch at `:1829-1840` binds `material.shader`.

- [ ] **Step 5: Verify in the browser with a broken control**

```bash
cd /Users/julien/Documents/GitHub/Sailor && ./dev.sh
```

At `http://127.0.0.1:3000`: add a sphere, set Relief to Image, upload a photo, drag Depth from 0 to 1. **The surface must visibly change.** Then set Relief to Effect, pick a catalog effect, confirm relief appears. Then set the material to shaderFill + Unlit and confirm the section shows the disabled explanation rather than dead controls.

Hard-reload before debugging anything odd — HMR-stale pages have burned this codebase before.

- [ ] **Step 6: Verify persistence**

Save the node, reload the page, reopen the studio. Relief source, image, depth, and invert must all survive. This is what Task 1's whitelist entry exists for — if it does not round-trip, the parser entry is wrong.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): Surface relief section in the material panel"
```

---

### Task 6: AI height generation

Last on purpose — the other producers work offline, instantly, at zero per-use cost. This is the smallest slice of the value.

**Files:**
- Create: `frontend/server/utils/scene3dRelief.ts`
- Create: `frontend/server/api/scene3d/gen-map.post.ts`
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`
- Test: `frontend/tests/unit/scene3d-relief-gen.unit.spec.ts`

**Interfaces:**
- Consumes: `toHeightPixels` (Task 2); the UI from Task 5
- Produces: `shapeReliefPrompt(prompt: string): string`; `DEPTH_MODEL: { app: string; buildInput(imageUrl: string): Record<string, unknown>; heightUrlFrom(result: unknown): string | null }`

> **This plan deliberately does NOT name a depth model id.** A wrong fal field returns HTTP 200 at submit and only fails at result, which then falls over to a Replicate cold boot — silent and expensive to diagnose. A guessed id copied from memory is worse than no id. Step 0 determines it from the live schema; every later step depends on that answer.

- [ ] **Step 0: Determine and verify the depth model — do this FIRST**

Find the current fal depth-estimation endpoints:

```bash
curl -s "https://fal.ai/api/models?keywords=depth" | head -80
```

Pick a depth/normal-estimation model that takes a single image. Then pull its schema and read the actual field names — do not assume `image_url`:

```bash
curl -s "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<candidate-app-id>" | head -120
```

Record three things before writing any code: the exact **app id**, the exact **input field name(s)**, and the exact **output path** to the resulting image. Task 6's helper, its test, and the route all encode these. If the output shape is not `{ image: { url } }`, adjust `heightUrlFrom` and its test in Step 1 to match what the schema actually says.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/scene3d-relief-gen.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shapeReliefPrompt, DEPTH_MODEL } from '~~/server/utils/scene3dRelief'

describe('scene3d relief generation helpers', () => {
  it('biases the prompt toward a flat, evenly lit material sample', () => {
    const out = shapeReliefPrompt('hammered copper')
    expect(out).toContain('hammered copper')
    expect(out.length).toBeGreaterThan('hammered copper'.length)
  })

  it('returns empty for an empty prompt', () => {
    expect(shapeReliefPrompt('   ')).toBe('')
  })

  it('builds a depth input carrying the image url', () => {
    const input = DEPTH_MODEL.buildInput('https://cdn.example/a.png')
    expect(Object.values(input)).toContain('https://cdn.example/a.png')
  })

  it('extracts the height url from a well-formed result', () => {
    expect(DEPTH_MODEL.heightUrlFrom({ image: { url: 'https://cdn.example/d.png' } }))
      .toBe('https://cdn.example/d.png')
  })

  it('returns null rather than throwing on a malformed result', () => {
    expect(DEPTH_MODEL.heightUrlFrom({})).toBeNull()
    expect(DEPTH_MODEL.heightUrlFrom(null)).toBeNull()
    expect(DEPTH_MODEL.heightUrlFrom({ image: {} })).toBeNull()
  })
})
```

Adjust `heightUrlFrom`'s expected shape to whatever the live schema check in the warning above actually returns.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-relief-gen.unit.spec.ts
```

Expected: FAIL — cannot resolve `~~/server/utils/scene3dRelief`.

- [ ] **Step 3: Write the helper**

Create `frontend/server/utils/scene3dRelief.ts`, mirroring the shape of the existing `server/utils/scene3dGen.ts`:

```ts
// Pure fal relief helpers, shared by /api/scene3d/gen-map and unit tested without any
// network. The route wraps these with runFal().
//
// Two stages, deliberately: image models bake lighting into their output. A brick photo's
// mortar grooves are dark because they are IN SHADOW — desaturating that makes every shadow
// a fake dent, which the renderer then lights and shadows again. Depth models are trained to
// ignore lighting and report actual distance, so the height is genuine.

const RELIEF_PROMPT_SUFFIX = ', flat material sample, top-down orthographic, evenly lit, no shadows, no highlights, fills the frame, seamless texture'

/** Bias the colour-tile prompt toward a flat, evenly lit material swatch. */
export function shapeReliefPrompt(prompt: string): string {
  const p = prompt.trim()
  return p ? `${p}${RELIEF_PROMPT_SUFFIX}` : ''
}

export interface DepthModel {
  app: string
  buildInput(imageUrl: string): Record<string, unknown>
  heightUrlFrom(result: unknown): string | null
}

/** App id, input field names and output path all come from the live-schema check in
 *  Step 0 — NOT from memory. A wrong field 200s at submit and only fails at result. */
export const DEPTH_MODEL: DepthModel = {
  app: /* the app id confirmed in Step 0 */ '',
  buildInput: (imageUrl) => ({ image_url: imageUrl }),
  heightUrlFrom: (r) => {
    const u = (r as { image?: { url?: string } })?.image?.url
    return typeof u === 'string' && u ? u : null
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/scene3d-relief-gen.unit.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the route**

Create `frontend/server/api/scene3d/gen-map.post.ts`, mirroring `gen-image.post.ts` exactly (`runFal`, `firstFalImageUrl`, `shapeReliefPrompt`, `DEPTH_MODEL` are all Nitro auto-imports — no import statements):

```ts
// POST /api/scene3d/gen-map — text → colour tile → grayscale height map, for Scene3D
// surface relief. Returns both URLs so the UI can offer the colour tile as the albedo
// map in the same action. /api/scene3d is already in NITRO_API_PREFIXES.
interface Body {
  prompt?: string
  seed?: number
  /** Skip stage 1 and run depth directly on an image the user already has. */
  imageUrl?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const seed = Number.isFinite(body?.seed) ? Math.round(body!.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  let imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : ''
  if (!imageUrl) {
    const prompt = shapeReliefPrompt(body?.prompt ?? '')
    if (!prompt) throw createError({ statusCode: 400, message: 'prompt or imageUrl is required' })
    const tile = await runFal('fal-ai/flux/dev', { prompt, image_size: 'square_hd', num_images: 1, seed })
    imageUrl = firstFalImageUrl(tile) ?? ''
    if (!imageUrl) throw createError({ statusCode: 502, message: 'fal returned no image' })
  }

  const depth = await runFal(DEPTH_MODEL.app, DEPTH_MODEL.buildInput(imageUrl))
  const heightUrl = DEPTH_MODEL.heightUrlFrom(depth)
  if (!heightUrl) throw createError({ statusCode: 502, message: 'fal returned no height map' })

  return { imageUrl, heightUrl, seed }
})
```

The `imageUrl` branch is what powers Task 5's "Refine with depth" on an uploaded photo — same route, one component serving both producers.

- [ ] **Step 6: Wire the Generate button**

In `Scene3DStudioSurface.vue`, add a `Generate…` `StudioButton` beside Upload in the relief image sub-branch. It opens a prompt input, POSTs to `/api/scene3d/gen-map`, then persists `heightUrl` through `inpaint.uploadDataUrl` into `material.relief.image`. Must be an **explicit button** — never automatic on a parameter change (it costs money and takes seconds). Show progress and surface errors inline, matching the existing `uploadError`/`bakeError` pattern.

- [ ] **Step 7: Zero-cost schema probe**

Before any paid run, confirm the depth model's schema is right:

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && curl -s "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<DEPTH_MODEL.app>" | head -60
```

Check that `buildInput`'s field names appear in the schema's input properties and that `heightUrlFrom`'s path matches the output shape. Fix the helper and its test if they disagree.

- [ ] **Step 8: Live paid verification — ASK THE USER FIRST**

**Stop and confirm with the user before running any paid generation.** Then run **one** generation end to end: prompt → colour tile → height → uploaded → bound to `.bumpMap` → visible relief in the viewport. Drag Depth 0→1 and confirm the render changes.

- [ ] **Step 9: Commit**

```bash
git add frontend/server/utils/scene3dRelief.ts frontend/server/api/scene3d/gen-map.post.ts frontend/tests/unit/scene3d-relief-gen.unit.spec.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): AI height map generation via prompt → tile → depth"
```

---

## Final verification

- [ ] Full unit suite green:

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npm run test:unit
```

- [ ] Typecheck did not regress for touched files:

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit 2>&1 | grep -E "scene3d|Scene3DStudioSurface" || echo "(clean)"
```

- [ ] Relief survives a save → page reload → reopen cycle.
- [ ] Depth 0 vs 1 produces a visibly different render on `standard`, `gradient`, `fresnel`, `toon`, and a lit `shaderFill`.
- [ ] The relief section is disabled with an explanation on an unlit `shaderFill`.
- [ ] No UI copy anywhere calls this a "normal map pass".
- [ ] **Static-relief check (spec risk 1, rescoped).** v1 shader relief resolves the field ONCE
      at `t: 0` and never re-points it, so there is no per-frame relief cost and the live-field
      ceiling is untouched. What must be verified is the *consequence*: on an object whose
      `shaderFill` colour map is animating AND which uses shader relief, confirm the colour
      animates while the relief stays fixed — and that this reads as intentional rather than
      broken. If it reads as a bug to you, that is a finding worth raising before shipping.
      Note: the Browser pane pauses rAF when hidden, so drive renders with a forced-sync probe
      rather than trusting the live loop — a reading of 0.00 fps is the pane, not the feature.
