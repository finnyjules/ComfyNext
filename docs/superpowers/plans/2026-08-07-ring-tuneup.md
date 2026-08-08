# Ring tune-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the animos control set plus a repeater and per-card bend to the Expressive Studio `ring` effect.

**Architecture:** All behaviour lives in the existing `ring` effect (`app/lib/spacetype/effects/ring.ts`), plus one pure helper (`bentOffset`) in `ringLayout.ts`. Every new control is a declared `ControlSpec`, so agent + motion derive automatically. `ringTransform` stays pure placement; padding / back-fade / bend / ring-opening are applied on the meshes in `update`, and the repeater duplicates tiles in `buildScene`.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, three.js, Vitest (happy-dom). Spec: [2026-08-07-ring-tuneup-design.md](../specs/2026-08-07-ring-tuneup-design.md).

## Global Constraints

- **Only `ring.ts` and `ringLayout.ts` change.** No other effect, no engine change. Existing non-ring documents are untouched by construction.
- **Existing ring documents** open and gain the new controls at their defaults. Keep the `radius` param KEY (only its label changes to "Ring size") so saved docs don't lose their radius. One intentional exception, flagged in Task 2: the ring's default *resting pose* changes (ring-opening becomes the primary reveal axis) — call it out, don't hide it.
- **`buildScene` stays synchronous** (no `await`) — bend geometry is built/displaced with plain CPU math, no async.
- **Per-scene mutable state on `root.userData`**, never module vars (concurrent preview + headless engines share the effect module).
- **Groups must be in `SPACE_TYPE_SECTIONS`**: use only `Ribbon`, `Transform`, `Look`, `Motion`, `Type` (all already valid).
- `ringLayout.ts` is PURE — no three.js import there beyond the existing `THREE` type usage; `bentOffset` is plain math.
- Test command: `cd frontend && npx vitest run tests/unit/<file>`.
- Shared tree: stage ONLY the files each task names; never `git add -A`/`.`/`-u`, never `git stash`/`checkout`/`reset` other files. Verify the target files are clean (`git status --porcelain`) before committing; if a target shows edits you didn't make, STOP (BLOCKED).

---

## Task 1: `bentOffset` — pure bend math

**Files:**
- Modify: `frontend/app/lib/spacetype/ringLayout.ts`
- Test: `frontend/tests/unit/spacetype-bent-offset.unit.spec.ts`

**Interfaces:**
- Produces: `interface BentOffset { tangent: number; inward: number }` and `function bentOffset(s: number, R: number, bend: number): BentOffset`.

**Behaviour:** a card point at tangential offset `s` from the card centre, on a ring of radius `R`, at bend factor `bend ∈ [0,1]`. `bend = 0` → flat (`{ tangent: s, inward: 0 }`). `bend = 1` → on the arc (`{ tangent: R·sin(s/R), inward: R·(1−cos(s/R)) }`). Each component lerps by `bend`. `s = 0` never moves. `R ≤ 0` → flat (guard div-by-zero).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-bent-offset.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { bentOffset } from '~/lib/spacetype/ringLayout'

describe('bentOffset', () => {
  it('bend=0 is flat for every s', () => {
    for (const s of [-2, -0.5, 0, 0.5, 2]) {
      expect(bentOffset(s, 5, 0)).toEqual({ tangent: s, inward: 0 })
    }
  })

  it('bend=1 lands on the arc', () => {
    const R = 5, s = 2
    const o = bentOffset(s, R, 1)
    expect(o.tangent).toBeCloseTo(R * Math.sin(s / R), 6)
    expect(o.inward).toBeCloseTo(R * (1 - Math.cos(s / R)), 6)
  })

  it('centre never moves at any bend', () => {
    for (const b of [0, 0.3, 0.7, 1]) {
      const o = bentOffset(0, 5, b)
      expect(o.tangent).toBeCloseTo(0, 9)
      expect(o.inward).toBeCloseTo(0, 9)
    }
  })

  it('inward is >= 0 and grows with |s| (edges curl toward centre)', () => {
    const near = bentOffset(1, 5, 1).inward
    const far = bentOffset(3, 5, 1).inward
    expect(near).toBeGreaterThanOrEqual(0)
    expect(far).toBeGreaterThan(near)
  })

  it('R<=0 is flat (no div by zero)', () => {
    expect(bentOffset(2, 0, 1)).toEqual({ tangent: 2, inward: 0 })
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`bentOffset` not exported)

Run: `cd frontend && npx vitest run tests/unit/spacetype-bent-offset.unit.spec.ts`

- [ ] **Step 3: Implement** — append to `ringLayout.ts`:

```ts
export interface BentOffset { tangent: number; inward: number }

/** Map a card point at tangential offset `s` (from the card centre) onto the ring
 *  arc of radius `R`, at bend factor `bend` (0 flat, 1 fully wrapped). Pure. */
export function bentOffset(s: number, R: number, bend: number): BentOffset {
  if (R <= 0) return { tangent: s, inward: 0 }
  const phi = s / R
  const tangentArc = R * Math.sin(phi)
  const inwardArc = R * (1 - Math.cos(phi))
  return {
    tangent: s + (tangentArc - s) * bend,
    inward: inwardArc * bend,
  }
}
```

- [ ] **Step 4: Run — expect PASS** (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/ringLayout.ts frontend/tests/unit/spacetype-bent-offset.unit.spec.ts
git commit -m "feat(expressive): bentOffset — pure per-card bend math"
```

---

## Task 2: The light controls — repeater, padding, ring size, ring opening, back fade

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/ring.ts`
- Test: `frontend/tests/unit/spacetype-ring-effect.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: existing `ringTransform`/`RingParams`; the `SpaceTypeEffect` contract.
- Produces: 4 new controls (`repeat`, `padding`, `ringOpening`, `backFade`) + a relabel of `radius`.

**Add these `ControlSpec`s** to the `controls` array (place `repeat`/`padding` near `cardSize` in the `Ribbon` group; `ringOpening` in `Transform`; `backFade` in `Look`). Relabel the existing `radius` control's `label` to `'Ring size'` (key unchanged):

```ts
{ key: 'radius', label: 'Ring size', kind: 'slider', min: 2, max: 12, step: 0.1, default: 5, group: 'Ribbon' },
{ key: 'repeat', label: 'Repeater', kind: 'slider', min: 1, max: 8, step: 1, default: 1, group: 'Ribbon' },
{ key: 'padding', label: 'Padding', kind: 'slider', min: 0, max: 0.9, step: 0.01, default: 0, group: 'Ribbon' },
{ key: 'ringOpening', label: 'Ring opening', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.55, group: 'Transform' },
{ key: 'backFade', label: 'Back fade', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Look' },
```

**`liveKeys`** — add `'padding', 'ringOpening', 'backFade'`. Do NOT add `repeat` (it changes the quad count → structural rebuild). Final: `['radius', 'ringTilt', 'cardSize', 'perspective', 'speed', 'direction', 'padding', 'ringOpening', 'backFade']`.

**Repeater in `buildScene`** — after `const tiles = expandContent(items)`, duplicate:

```ts
const baseTiles = expandContent(items)
const repeat = Math.max(1, Math.round(Number(params.repeat) || 1))
const tiles = repeat > 1 ? Array.from({ length: repeat }, () => baseTiles).flat() : baseTiles
```

(Rest of the loop unchanged: glyph-texture memo by `sourceId` still rasterises/registers once even across repeats.)

**Padding in `update`** — change the scale line so width shrinks by `(1 − padding)`:

```ts
const padding = n(params, 'padding')
// ... inside the per-quad loop, replacing the existing quad.scale.set line:
quad.scale.set(aspect * tf.scale * (1 - padding), tf.scale, 1)
```

**Ring opening + tilt in `update`** — replace the single `root.rotation.x = ...` lines (in BOTH `buildScene`'s tail and `update`) with a two-axis composition. Ring opening is the primary reveal on X; ring tilt becomes a lean on Z:

```ts
const OPEN_MAX = 1.4 // radians (~80°): opening 1 ≈ top-down, full circle revealed
root.rotation.set(-n(params, 'ringOpening') * OPEN_MAX, 0, n(params, 'ringTilt'))
```

Apply the same in `buildScene` (replace `root.rotation.x = Number(params.ringTilt)` with the `root.rotation.set(...)` above). **INTENTIONAL POSE CHANGE — flag it:** existing ring docs had `ringTilt` on the X axis; it now leans on Z while `ringOpening` (default 0.55) drives the X reveal, so the default resting pose is more open than before. This is a deliberate, nicer default for the redesigned ring — note it in your report. **Live-verify the two endpoints** in the browser: `ringOpening = 0` → cards head-on / ring collapsed to face the viewer; `ringOpening = 1` → full circle of cards revealed. If the endpoints don't read that way, adjust `OPEN_MAX` (and, if needed, the axis choice) until they do, and record what you used.

**Back fade in `update`** — after positioning each quad, dim the far side by depth. Compute the card's camera-facing depth from its world position and set material opacity:

```ts
const backFade = n(params, 'backFade')
// inside the per-quad loop, AFTER quad.position/rotation/scale are set:
if (backFade > 0) {
  const wz = quad.getWorldPosition(_tmpVec).z // _tmpVec: a module-free THREE.Vector3 reused per call
  // normalize depth to [0,1] across the ring's z-range (~[-radius, +radius] before group rotation);
  // farther from camera (smaller world z) => more fade. Clamp.
  const back = Math.min(1, Math.max(0, (n(params, 'radius') - wz) / (2 * n(params, 'radius'))))
  ;(quad.material as THREE.MeshBasicMaterial).opacity = 1 - backFade * back
} else {
  ;(quad.material as THREE.MeshBasicMaterial).opacity = 1
}
```

Note: `quad.getWorldPosition` needs the group's world matrix current — call after setting `root.rotation`. Order the `update` body so `root.rotation.set(...)` runs, then `root.updateWorldMatrix(true, true)` (or rely on the renderer's matrix update — verify the fade actually tracks depth in the browser; if world matrices are stale, force `root.updateMatrixWorld(true)` before the per-quad world reads). Allocate one reusable `THREE.Vector3` at module scope for `_tmpVec` (a const, not mutable per-scene state — reused read-scratch is safe across engines because it's written-then-read synchronously within one call).

- [ ] **Step 1: Extend the failing test** — add to `spacetype-ring-effect.unit.spec.ts` a repeater assertion:

```ts
it('repeater duplicates tiles around the ring', () => {
  const items = [
    { id: 'i0', kind: 'image', src: 'data:0' },
    { id: 'i1', kind: 'image', src: 'data:1' },
  ]
  const params = { ...defaultsFromControls(ringEffect.controls), content: JSON.stringify(items), repeat: 3 }
  const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), { width: 960, height: 540, imageTextures: new Map() })
  expect((root as any).userData.ringState.quads).toHaveLength(6)
})
```

- [ ] **Step 2: Run — expect FAIL** (repeat not yet honored → 2 quads, not 6)

Run: `cd frontend && npx vitest run tests/unit/spacetype-ring-effect.unit.spec.ts`

- [ ] **Step 3: Implement** the control declarations, `liveKeys`, repeater loop, padding, ring-opening composition, and back-fade per the snippets above.

- [ ] **Step 4: Run tests + compile-check**

Run: `cd frontend && npx vitest run tests/unit/spacetype-ring-effect.unit.spec.ts` — expect PASS (existing + new).
Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "ring.ts"` — no new errors naming this file.

- [ ] **Step 5: Manual live-verify** (dev server on `127.0.0.1`, open a ring node): repeater fills the ring from 2–3 elements; padding opens gaps; ring-opening sweeps head-on → full circle (record `OPEN_MAX` used); back-fade dims the far side. Screenshot one.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects/ring.ts frontend/tests/unit/spacetype-ring-effect.unit.spec.ts
git commit -m "feat(expressive): ring — repeater, padding, ring size, ring opening, back fade"
```

---

## Task 3: Bend — subdivided, curved card geometry

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/ring.ts`
- Test: covered by Task 1's `bentOffset` unit tests + manual (geometry needs a real GL context; the effect test stays image-only and asserts no crash with bend set).

**Interfaces:**
- Consumes: `bentOffset` (Task 1).
- Produces: a `bend` control + `bendSig`-cached per-card geometry displacement.

**Add the control** (Ribbon group), and add `'bend'` to `liveKeys`:

```ts
{ key: 'bend', label: 'Bend', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Ribbon' },
```

**Geometry:** in `buildScene`, build each card plane subdivided so it can curve — replace `new three.PlaneGeometry(1, 1)` with `new three.PlaneGeometry(1, 1, BEND_SEGMENTS, 1)` where `const BEND_SEGMENTS = 16` (module const). Keep the glyph UV sub-rect remap working: with `BEND_SEGMENTS` the plane now has `(BEND_SEGMENTS+1)*2` uv entries; the existing remap (`uv.getX(k) < 0.5 ? u0 : u1`) still applies per-vertex and remains correct because interior vertices have intermediate u — so instead map each vertex's u **proportionally**: `uv.setX(k, u0 + (u1 - u0) * uv.getX(k))`. Update the letter-tile UV loop to this proportional form (works for any segment count; for the old 1-segment case it's identical to the min/max form since u is 0 or 1).

**Bend displacement (`update`):** the card's flat local geometry has x ∈ [−0.5, 0.5]. The card's world width is `w = aspect * cardSize * (1 - padding)` and it's placed at radius `R = radius`. Because the mesh uses a **non-uniform** `scale.x = aspect*cardSize*(1-padding)`, displacing unit-local x would distort the bend. So bend the geometry in **world-width space and cancel the scale**: for each vertex, `s = localX * w` (tangential offset in ring units), `o = bentOffset(s, R, bend)`; write back the vertex in unit-local space as `localX' = o.tangent / w` (so `scale.x` restores world width) and `localZ' = o.inward / 1` (z isn't scaled, `scale.z = 1`) — the inward curl goes into **local +Z toward the ring centre**, i.e. `position.setZ(k, -o.inward)` (negative because +Z is outward/toward viewer; curl is inward). localY unchanged.

Cache to avoid per-frame work: store a signature `bendSig = `${bend}|${aspect}|${cardSize}|${padding}|${radius}`` on `mesh.userData.bendSig`; only recompute the geometry when it changes. When `bend === 0`, restore the flat geometry (localX from the saved base, localZ = 0) if the card is currently bent, then skip. Keep each mesh's **base local X** (the undistorted `[-0.5..0.5]` grid) so you can recompute from scratch each time (read it once at build into `mesh.userData.baseX: Float32Array`, or recompute from `PlaneGeometry`'s known grid).

Concretely, a helper inside the effect:

```ts
const BEND_SEGMENTS = 16
function applyBend(mesh: THREE.Mesh, aspect: number, cardSize: number, padding: number, R: number, bend: number) {
  const sig = `${bend.toFixed(3)}|${aspect.toFixed(3)}|${cardSize.toFixed(3)}|${padding.toFixed(3)}|${R.toFixed(3)}`
  if (mesh.userData.bendSig === sig) return
  mesh.userData.bendSig = sig
  const geo = mesh.geometry as THREE.PlaneGeometry
  const pos = geo.attributes.position as THREE.BufferAttribute
  const baseX = mesh.userData.baseX as Float32Array // captured at build: the flat local X per vertex
  const w = aspect * cardSize * (1 - padding)
  for (let k = 0; k < pos.count; k++) {
    const lx = baseX[k]!
    if (bend <= 0 || w <= 0) { pos.setX(k, lx); pos.setZ(k, 0); continue }
    const o = bentOffset(lx * w, R, bend)
    pos.setX(k, o.tangent / w)
    pos.setZ(k, -o.inward)
  }
  pos.needsUpdate = true
}
```

At build, capture `mesh.userData.baseX = Float32Array.from({length: pos.count}, (_,k) => pos.getX(k))` right after creating the geometry (before any UV edits — position is independent of uv). In `update`, call `applyBend(quad, aspect, cardSize, padding, radius, bend)` for each quad (before or after placement — geometry is local, placement is the mesh transform, independent). `_textTexture` and existing behaviour otherwise unchanged.

- [ ] **Step 1: Write/extend test** — add to `spacetype-ring-effect.unit.spec.ts` a smoke test that building + updating with `bend: 1` doesn't throw and keeps the quad count (the bend math itself is unit-tested in Task 1):

```ts
it('bend builds and updates without error', () => {
  const items = [{ id: 'i0', kind: 'image', src: 'data:0' }, { id: 'i1', kind: 'image', src: 'data:1' }]
  const params = { ...defaultsFromControls(ringEffect.controls), content: JSON.stringify(items), bend: 1 }
  const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), { width: 960, height: 540, imageTextures: new Map() })
  expect(() => ringEffect.update!(0.25, params, root)).not.toThrow()
  expect((root as any).userData.ringState.quads).toHaveLength(2)
})
```

- [ ] **Step 2: Run — expect FAIL** (bend not in defaults / applyBend absent → depends; at minimum the control isn't declared yet)

- [ ] **Step 3: Implement** the `bend` control, `BEND_SEGMENTS` geometry, `baseX` capture, proportional glyph-UV remap, and `applyBend` called from `update`; add `'bend'` to `liveKeys`.

- [ ] **Step 4: Run tests + compile-check** — ring-effect test PASS; `vue-tsc` no new `ring.ts` errors.

- [ ] **Step 5: Manual live-verify** — a photo card visibly curves from flat (bend 0) toward wrapping the ring (bend 1); a letter tile bends too; the card's centre stays put (curl is symmetric). Confirm bend is keyframeable on the Motion tab. Screenshot bend 0 vs bend 1.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects/ring.ts frontend/tests/unit/spacetype-ring-effect.unit.spec.ts
git commit -m "feat(expressive): ring — per-card bend (subdivided curved panels)"
```

---

## Task 4: Corner radius — rounded image cards

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/ring.ts`
- Test: manual (fragment-shader visual; no headless GL).

**Interfaces:**
- Produces: a `cornerRadius` control + an `onBeforeCompile` rounded-rect alpha mask on **image** materials.

**Add the control** (Ribbon), and add `'cornerRadius'` to `liveKeys`:

```ts
{ key: 'cornerRadius', label: 'Corner radius', kind: 'slider', min: 0, max: 0.5, step: 0.01, default: 0.06, group: 'Ribbon' },
```

**Shader mask (image tiles only).** In `buildScene`, for image tiles, attach an `onBeforeCompile` that adds a rounded-rect SDF alpha discard based on the card UV, a `uCorner` uniform (corner radius in half-width units, 0..0.5), and `uAspect` (so corners are round, not stretched). Store the uniform holder on `mesh.userData.matUniforms` so `update` can set `uCorner` live. Do NOT attach it to glyph materials (they have no panel to round).

Sketch (adapt to three's chunk names; keep it minimal — a standard rounded-box SDF on centered UV):

```ts
const uniforms = { uCorner: { value: Number(params.cornerRadius) }, uAspect: { value: aspect } }
material.onBeforeCompile = (shader) => {
  shader.uniforms.uCorner = uniforms.uCorner
  shader.uniforms.uAspect = uniforms.uAspect
  shader.fragmentShader = 'uniform float uCorner; uniform float uAspect;\n' + shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    `#include <dithering_fragment>
     {
       vec2 p = (vMapUv - 0.5) * vec2(uAspect, 1.0);      // centered, aspect-corrected
       vec2 half = vec2(0.5 * uAspect, 0.5);
       float r = clamp(uCorner, 0.0, 0.5) * min(half.x, half.y) * 2.0;
       vec2 q = abs(p) - (half - vec2(r));
       float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
       if (d > 0.0) discard;                               // outside the rounded rect
     }`
  )
}
material.transparent = true
```

Notes: use whatever UV varying the compiled MeshBasicMaterial exposes (`vMapUv` in current three; if the build uses `vUv`, use that — verify against the three version in `package.json` and the compiled shader). `discard` gives a hard rounded edge (fine for v1); a smoothstep alpha is a later polish. In `update`, for image quads, set `mesh.userData.matUniforms.uCorner.value = n(params, 'cornerRadius')` so it's live.

- [ ] **Step 1: Implement** the control, the `onBeforeCompile` mask on image tiles, the uniform stash, and the live update. (No unit test — fragment shader; verify live.)

- [ ] **Step 2: Compile-check** — `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "ring.ts"` — no new errors. Run the ring-effect unit test to confirm no crash: `npx vitest run tests/unit/spacetype-ring-effect.unit.spec.ts` (image tiles now compile a shader on build — confirm build still works headlessly, or guard the `onBeforeCompile` body so it's inert without a GL context; the test builds meshes but never renders, so `onBeforeCompile` won't run — confirm no error).

- [ ] **Step 3: Manual live-verify** — an image card shows rounded corners at `cornerRadius > 0`, square at 0; dragging the slider rounds live; glyph tiles are unaffected. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/spacetype/effects/ring.ts
git commit -m "feat(expressive): ring — corner radius on image cards (rounded-rect mask)"
```

---

## Self-review against the spec

- Ring size relabel, Padding, Corner radius, Bend, Ring opening, Back fade, Repeater → Tasks 2 (light), 3 (bend), 4 (corner). ✅
- Bend curves the element itself, photos + glyphs → Task 3 (`applyBend`, subdivided geometry, both tile kinds). ✅
- Repeater duplicates content around the ring → Task 2 (buildScene loop, structural). ✅
- Ring opening = distinct axis, head-on → circle, live-verified endpoints → Task 2 (X reveal + Z lean, `OPEN_MAX`, flagged pose change). ✅
- All new controls are declared `ControlSpec`s → agent + motion for free; bend/opening keyframeable → verified in Task 3 Step 5. ✅
- Bend math unit-tested (`bentOffset`), centre preserved → Task 1. ✅
- `radius` key preserved (label only), existing docs open → Global Constraints + Task 2. ✅

**Type/name consistency:** `bentOffset`/`BentOffset` (Task 1) used in Task 3; `BEND_SEGMENTS`, `applyBend`, `mesh.userData.{baseX,bendSig,matUniforms}` internal to `ring.ts`; new control keys (`repeat`, `padding`, `ringOpening`, `backFade`, `bend`, `cornerRadius`) consistent across declarations, `liveKeys`, and `update` reads.

**Open risk to watch:** ring-opening axis composition and back-fade world-matrix timing both need live confirmation (Task 2 Steps 5) — they can't be proven headlessly. The plan defines the endpoints as the acceptance test; if the live look is wrong, adjust within the task before committing.
