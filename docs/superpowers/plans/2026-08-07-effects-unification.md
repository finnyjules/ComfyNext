# Effects Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Space Type and Scene3D render the same shared collapsible "Effects" toggle-row list (from `lib/studio/post/manifest.ts`) as Gradient/Texture/Shape, with the same effect set — adding the grain/vignette/duotone three.js passes they lack, gated only by depth (ambient occlusion stays Scene3D-only).

**Architecture:** The 12-effect manifest + `postControls()` + `StudioControlPanel`/`StudioSectionTree` renderer already exist and three 2D studios use them. This wires the two three.js studios onto the same pipeline: a `host` capability replaces `postControls`' boolean, both studios swap their bespoke inline effect UI for the shared panel bound to their existing `post.*` (`PostSettings`) data, and their three.js `EffectComposer`s gain grain/vignette/duotone passes ported from the 2D GL chain.

**Tech Stack:** Nuxt 4 / Vue 3 `<script setup>` / TypeScript / three.js `EffectComposer` + `ShaderPass` / Vitest (`environment: node`, no component-test framework — pure logic unit-tested, renderers pixel-tested, UI live-driven).

## Global Constraints

- The manifest (`lib/studio/post/manifest.ts`, 12 effects: bloom, color, duotone, chroma, blur, film, halftone, dotScreen, glitch, grain, vignette, gtao) is the single source — do NOT add effects or change `PostSettings` shape/defaults. The `post.*` fields already exist in `DEFAULT_POST` (`lib/studio/post/settings.ts`); grain/vignette/duotone were just never rendered — **no data migration**.
- `postControls` host mapping is exact: `'gl2d'` = Gradient/Texture/Shape (exclude gtao, drop `uniform:null` params) and MUST be byte-identical to today's `{ threeD: false }`; `'three'` = Space Type (exclude gtao, keep `uniform:null` params); `'three-depth'` = Scene3D (include gtao, keep params).
- **A Download item saves a file / a canvas item drops a node** — N/A here; this touches only the Effects controls + renderers.
- Grain/vignette/duotone three.js passes must match the 2D reference **pixel-for-pixel at matched params** — port the GLSL from the 2D chain (`lib/studio/post/chain.ts`), applying the manifest's `toUniform` transforms. Grain is the historically fiddly one (a past bug read ~3× strong in one host).
- No changes to Gradient/Texture/Shape output (assert via snapshot). Shader Studio, Vector Type, Compositor are out of scope.
- Dev server runs on `http://127.0.0.1:3000`; do NOT start another / don't run `./dev.sh`. Compile-check: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/_nuxt/<path>` → 200. Browser-pane native clicks may no-op this session — use `element.click()` via javascript_tool.
- Stage only your own hunks (a parallel session commits to `main`); commit to `main`; co-author trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `postControls` host capability + migrate the 2D call sites

**Files:**
- Modify: `frontend/app/lib/studio/post/controls.ts` (the `postControls` function, ~line 51)
- Modify: `frontend/app/lib/gradientfx/controls.ts:152`, `frontend/app/lib/texturefx/controls.ts:103`, `frontend/app/lib/shapefx/controls.ts:104`
- Test: `frontend/tests/unit/post-controls-host.unit.spec.ts`

**Interfaces:**
- Produces: `type PostHost = 'gl2d' | 'three' | 'three-depth'`; `postControls(opts: { host: PostHost }): ControlSpec[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { postControls } from '~/lib/studio/post/controls'

const keys = (host: any) => postControls({ host }).map(c => c.key)

describe('postControls host capability', () => {
  it("'gl2d' excludes gtao and drops uniform:null params (halftoneScatter)", () => {
    const k = keys('gl2d')
    expect(k).not.toContain('post.gtao')
    expect(k).not.toContain('post.halftoneScatter') // uniform: null, dropped for gl2d
  })
  it("'three' excludes gtao but KEEPS uniform:null params", () => {
    const k = keys('three')
    expect(k).not.toContain('post.gtao')
    expect(k).toContain('post.halftoneScatter')
  })
  it("'three-depth' includes gtao and keeps params", () => {
    const k = keys('three-depth')
    expect(k).toContain('post.gtao')
    expect(k).toContain('post.gtaoRadius')
    expect(k).toContain('post.halftoneScatter')
  })
  it("'gl2d' output is byte-identical to the legacy { threeD:false } shape", () => {
    // Legacy behaviour: no gtao, no uniform:null params. Assert the full set + defaults are stable.
    const specs = postControls({ host: 'gl2d' })
    expect(specs.find(c => c.key === 'post.grain')).toMatchObject({ kind: 'switch', sectionToggle: true })
    expect(specs.find(c => c.key === 'post.grainAmount')).toMatchObject({ kind: 'slider', min: 0, max: 1, step: 0.02 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/post-controls-host.unit.spec.ts`
Expected: FAIL — `postControls({ host })` not yet accepted / types wrong.

- [ ] **Step 3: Implement the host mapping**

In `controls.ts`, replace the signature and the two conditionals. The current code (verbatim shape) is:
```ts
export function postControls(opts: { threeD?: boolean } = {}): ControlSpec[] {
  // ...
    if (e.threeDOnly && !opts.threeD) continue
    // ...
      if (p.uniform === null && !opts.threeD) continue
```
Replace with:
```ts
export type PostHost = 'gl2d' | 'three' | 'three-depth'

export function postControls(opts: { host: PostHost }): ControlSpec[] {
  const includeDepthOnly = opts.host === 'three-depth' // gtao needs a depth buffer
  const keepNullUniformParams = opts.host !== 'gl2d'   // three.js hosts render these via EffectComposer
  const out: ControlSpec[] = []
  for (const e of POST_EFFECTS) {
    if (e.threeDOnly && !includeDepthOnly) continue
    // ... unchanged switch push ...
    for (const p of e.params) {
      if (p.uniform === null && !keepNullUniformParams) continue
      // ... unchanged param push ...
    }
  }
  return out
}
```
Keep everything else (the switch/param `out.push` blocks, `POST_SECTION`, `POST_SECTIONS`) exactly as-is.

- [ ] **Step 4: Migrate the three 2D call sites**

`gradientfx/controls.ts:152`: `...postControls({ threeD: false }).map(...)` → `...postControls({ host: 'gl2d' }).map(...)` (keep the `.map(c => c.key === 'post.grainAmount' ? { ...c, summary: 2 } : c)` tail).
`texturefx/controls.ts:103`: `...postControls({ threeD: false })` → `...postControls({ host: 'gl2d' })`.
`shapefx/controls.ts:104`: `...postControls({ threeD: false })` → `...postControls({ host: 'gl2d' })`.

- [ ] **Step 5: Run test + typecheck**

Run: `cd frontend && npx vitest run tests/unit/post-controls-host.unit.spec.ts` → PASS (4).
Run: `npx vue-tsc --noEmit 2>&1 | grep -E "controls\.ts|postControls"` → no new errors (any remaining `{ threeD: ... }` caller is a type error to fix).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/studio/post/controls.ts frontend/app/lib/gradientfx/controls.ts frontend/app/lib/texturefx/controls.ts frontend/app/lib/shapefx/controls.ts frontend/tests/unit/post-controls-host.unit.spec.ts
git commit -m "feat(post): postControls takes a host capability (gl2d/three/three-depth)"
```

---

### Task 2: three.js grain / vignette / duotone passes + pixel-parity test

**Files:**
- Create: `frontend/app/lib/studio/post/threePasses.ts` (a small factory returning three `ShaderPass`es + an `update(post)` applier)
- Test: `frontend/tests/unit/post-three-parity.unit.spec.ts`

**Interfaces:**
- Consumes: `PostSettings` (`~~/shared/spacetype/state`), `DEFAULT_POST` + manifest param `toUniform` transforms (`lib/studio/post/manifest.ts`).
- Produces: `makeGrainPass()`, `makeVignettePass()`, `makeDuotonePass()` each returning a `three` `ShaderPass`; and `applyPostExtras(passes, post: PostSettings, resolution, timeSeconds)` that sets `.enabled` + uniforms for all three from `post.*`. Scene3D + Space Type both consume these.

**Port source (read these first):** the canonical GLSL lives in the 2D GL chain `lib/studio/post/chain.ts` — find the `post_grain`, `vignette`, and `duotone` fragment sources it compiles (grep the frag strings / `frag:` ids from `manifest.ts:204/215/89`). The three.js pass must reproduce that fragment's math exactly (grain: the seed hash + `grainSize` cell quantisation + the 0.16 amount scaling; vignette: radius/softness falloff; duotone: luminance→shadow/highlight ramp × mix). Apply the manifest's `toUniform` where present (grain/vignette/duotone params have none — they map 1:1 — but confirm against `manifest.ts`).

- [ ] **Step 1: Write the failing pixel-parity test**

Render a fixed 64×64 test image through (a) the 2D chain's grain (and vignette, and duotone) at set params, and (b) the new three.js pass at the same params, and assert the buffers match within a tight tolerance. Use the existing shaderfx golden/parity harness as the model (`tests-unit/shaderfx_golden/` + how those specs render offscreen). Concretely, for grain:
```ts
import { describe, it, expect } from 'vitest'
// render helpers: reuse the offscreen GL render util the post/chain tests already use
import { renderChainEffect, renderThreePass } from './helpers/postParity' // create alongside if absent
import { makeGrainPass, applyPostExtras } from '~/lib/studio/post/threePasses'

describe('three.js post passes match the 2D chain', () => {
  it('grain at amount 0.76 size 3 matches the 2D reference within 2/255', () => {
    const params = { grain: true, grainAmount: 0.76, grainSize: 3 }
    const ref = renderChainEffect('post_grain', params)      // 2D GL chain
    const got = renderThreePass(makeGrainPass(), applyPostExtras, params) // three.js
    const maxDiff = maxChannelDiff(ref, got)
    expect(maxDiff).toBeLessThanOrEqual(2) // out of 255
  })
  // + vignette (amount 0.6, radius 0.8, softness 0.3) and duotone (shadow/highlight/mix) cases
})
```
Note: matching grain requires the SAME seed/coordinate convention as the 2D chain — if the chain seeds grain from `gl_FragCoord`/resolution, the three.js pass must use the same, or the noise pattern (not just amplitude) will differ. Assert amplitude AND that the pattern correlates (not a flat wash — the "parity tests agree on a wrong answer" lesson: a flat-wash bug passed a 0.01/255 gate). If an exact per-pixel match is infeasible (different RNG), split the assertion: (i) mean/variance of the grain delta matches within tolerance, (ii) output is NOT constant.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/post-three-parity.unit.spec.ts`
Expected: FAIL — `threePasses.ts` missing.

- [ ] **Step 3: Implement `threePasses.ts`**

Write the three `ShaderPass` factories. Follow the existing custom-`ShaderPass` pattern in `lib/spacetype/post.ts` (`this.gradePass = new ShaderPass({ uniforms, vertexShader, fragmentShader })`, ~line 137). Each pass:
- `makeGrainPass()`: `ShaderPass` with uniforms `{ tDiffuse, u_amount, u_size, u_seed, uResolution }`, fragment = the ported `post_grain` GLSL. `alphaGated` per manifest (grain multiplies within alpha) — preserve that behaviour.
- `makeVignettePass()`: uniforms `{ tDiffuse, u_amount, u_radius, u_softness }`, fragment = ported `vignette` GLSL.
- `makeDuotonePass()`: uniforms `{ tDiffuse, u_shadow (vec3), u_highlight (vec3), u_contrast (mix) }`, fragment = ported `duotone` GLSL. Convert `post.duotoneShadow`/`Highlight` hex → `THREE.Color` → vec3.
- `applyPostExtras(passes, post, resolution, timeSeconds)`: sets `grain.enabled = post.grain`, `grain.uniforms.u_amount.value = post.grainAmount`, `u_size = post.grainSize`, `u_seed` from `timeSeconds` (match the chain's seeding; if the chain grain is static per-frame-seed, mirror it); vignette/duotone likewise from `post.*`.

- [ ] **Step 4: Run test → PASS**

Run: `cd frontend && npx vitest run tests/unit/post-three-parity.unit.spec.ts` → PASS. If grain can't match per-pixel, the split assertion (amplitude + non-constant) must pass and you must `log`/comment WHY exact match is infeasible.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/studio/post/threePasses.ts frontend/tests/unit/post-three-parity.unit.spec.ts
git commit -m "feat(post): three.js grain/vignette/duotone passes matched to the 2D chain"
```

---

### Task 3: Scene3D onto the shared effects list (+ gtao, + new passes)

**Files:**
- Modify: `frontend/app/lib/scene3d/controls.ts` (~line 231, the hand-declared `'Post'` sliders — splice postControls, remove duplicates)
- Modify: `frontend/app/lib/scene3d/engine.ts` (its `EffectComposer` — wire the 3 new passes)
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (~3991–4069 — delete bespoke `Effects` section, render the shared panel)

**Interfaces:**
- Consumes: `postControls({ host: 'three-depth' })`, `POST_SECTIONS` (Task 1); `makeGrainPass`/`makeVignettePass`/`makeDuotonePass`/`applyPostExtras` (Task 2).

- [ ] **Step 1: Controls — one source for inspector + agent.** In `scene3d/controls.ts`, remove the hand-declared `'Post'` group `slider(...)` block (`post.bloomStrength` … `post.saturation`, ~231–250+, all `group: 'Post'`) and instead splice the manifest controls into the exported controls array: `...postControls({ host: 'three-depth' })`. Append `...POST_SECTIONS` to Scene3D's section-order array (mirror `texturefx/sections.ts:9`). This gives the agent AND the inspector one derived list (matching Gradient). Keep any genuinely non-post Scene3D controls untouched.

- [ ] **Step 2: Renderer — add the passes.** In `scene3d/engine.ts`, construct `makeGrainPass()/makeVignettePass()/makeDuotonePass()` and `addPass` them into the `EffectComposer` at their `POST_CHAIN_ORDER` positions (duotone early after colour; grain then vignette near the end, before `OutputPass`). In the per-frame/post update, call `applyPostExtras([grain,vignette,duotone], doc.post, resolution, timeSeconds)` alongside the existing pass enables. gtao already exists here.

- [ ] **Step 3: UI — swap the section.** In `Scene3DStudioSurface.vue`, delete the hand-written `<StudioSection title="Effects">` (~3991–4069). In its place render (mirror `GradientStudioSurface.vue:1303`):
```vue
<StudioControlPanel
  :controls="postControls({ host: 'three-depth' })"
  :order="POST_SECTIONS"
  :value="(k: string) => (doc.post as any)[k.replace('post.','')] ?? readPost(k)"
  @set="(k: string, v: any) => setPost(k, v)"
/>
```
Wire `setPost(key, value)` to write `doc.post.<path>` (strip the `post.` prefix) and the `:value` accessor to read it — the panel keys are `post.<field>` and `post.<enableKey>`. Import `postControls`, `POST_SECTIONS`, `StudioControlPanel`. Remove the now-unused inline switch/slider handlers.

- [ ] **Step 4: Compile + typecheck.** `curl … Scene3DStudioSurface.vue` → 200; `npx vue-tsc --noEmit 2>&1 | grep -E "scene3d|Scene3D"` → no new errors.

- [ ] **Step 5: Live-verify.** Open a Scene3D editor (dev/scene3d lab if present, else via the app). Confirm: the Effects section is the collapsible toggle-row list with the full set INCLUDING Ambient occlusion (gtao) and now Grain/Vignette/Duotone; toggle each and confirm it renders on the 3D preview; grain visually matches a 2D studio at the same amount; a saved+reopened doc restores toggles. Confirm the agent still reaches post targets (the `useStudioAgent` control list now derives from postControls).

- [ ] **Step 6: Commit.**
```bash
git add frontend/app/lib/scene3d/controls.ts frontend/app/lib/scene3d/engine.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "refactor(scene3d): effects onto the shared post panel (+grain/vignette/duotone)"
```

---

### Task 4: Space Type onto the shared effects list (+ new passes, un-hide built)

**Files:**
- Modify: `frontend/app/lib/spacetype/post.ts` (its `EffectComposer` — wire the 3 new passes)
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (~1705–1745 — delete bespoke `Post` section, render the shared panel)

**Interfaces:**
- Consumes: `postControls({ host: 'three' })`, `POST_SECTIONS` (Task 1); the Task 2 passes.

- [ ] **Step 1: Renderer — add the passes.** In `spacetype/post.ts`, add `makeGrainPass()/makeVignettePass()/makeDuotonePass()` as class members, `addPass` at their `POST_CHAIN_ORDER` positions (relative to the existing `bloom → halftone → dotScreen → film → glitch → gradePass → OutputPass` chain — grain/vignette go just before `OutputPass`; duotone before `gradePass`/after bloom per manifest order). In `update(p: PostSettings)` (~line 173) call `applyPostExtras(...)` so `p.grain/p.vignette/p.duotone` + params drive them. Space Type's `gradePass`/halftone/dot/film/glitch already exist and are enabled from `p.*` — no change to those.

- [ ] **Step 2: UI — swap the section, un-hide the built effects.** In `SpaceTypeSurface.vue`, delete the hand-written `<StudioSection title="Post">` (~1705–1745, the 4 inline `StudioSwitch` + range rows). Render instead (mirror Gradient / Task 3):
```vue
<StudioControlPanel
  :controls="postControls({ host: 'three' })"
  :order="POST_SECTIONS"
  :value="(k: string) => (post as any)[k.replace('post.','')]"
  @set="(k: string, v: any) => setPost(k, v)"
/>
```
Wire `setPost` to write `post.<field>` on the existing `PostSettings` object. Because the panel now lists the full `'three'` set, Space Type's already-built halftone/dot/glitch/film gain their switches automatically (their `post.*.enabled` fields already exist and `post.ts` already toggles them). Import `postControls`, `POST_SECTIONS`, `StudioControlPanel`. Remove the old inline handlers + the removed `<input type="range">` rows.

- [ ] **Step 3: Compile + typecheck.** `curl … SpaceTypeSurface.vue` → 200; `npx vue-tsc --noEmit 2>&1 | grep SpaceTypeSurface` → no new errors beyond the known pre-existing baseline (~line 146).

- [ ] **Step 4: Live-verify.** Open a Space Type editor. Confirm the Effects list is the collapsible toggle-row list showing the full set EXCEPT Ambient occlusion (no gtao — `host:'three'`), including the newly-exposed Halftone/Dot screen/Glitch/Film AND the new Grain/Vignette/Duotone. Toggle each; confirm it renders on the text preview and grain matches a 2D studio at the same amount. Save + reopen restores toggles.

- [ ] **Step 5: Commit.**
```bash
git add frontend/app/lib/spacetype/post.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "refactor(spacetype): effects onto the shared post panel (+grain/vignette/duotone, un-hide built)"
```

---

### Task 5: Sweep verification + docs

**Files:** Modify `docs/STATE.md`; update the ⛵ State-of-the-Build artifact.

- [ ] **Step 1:** Open all five studios (Gradient, Texture, Shape, Space Type, Scene3D) in one pass; confirm each shows the identical collapsible "Effects" list in `POST_CHAIN_ORDER`, gated only by gtao (Scene3D only). Confirm Gradient/Texture/Shape are visually unchanged.
- [ ] **Step 2:** Run the two new unit specs + the existing post/chain specs: `cd frontend && npx vitest run tests/unit/post-controls-host.unit.spec.ts tests/unit/post-three-parity.unit.spec.ts` → PASS. Grep for stragglers: `grep -rn "threeD:" frontend/app/lib` → none remain.
- [ ] **Step 3:** Update `docs/STATE.md` (extend the effects/post-stack entry: 5/7 studios unified, grain/vignette/duotone added to the two three.js renderers, the `host` capability). Update the ⛵ artifact. Commit `docs: effects unified — Space Type & Scene3D on the shared post stack`.

## Self-Review

- **Spec coverage:** host capability (Task 1); grain/vignette/duotone passes + parity (Task 2); Scene3D UI+renderer+dedup (Task 3); Space Type UI+renderer+un-hide (Task 4); gtao gating (Task 1 `three` excludes it, Task 3 `three-depth` includes it); no data migration (constraint + all tasks read existing `post.*`); byte-identical 2D output (Task 1 test + Task 5). ✓
- **Type consistency:** `PostHost`/`postControls({host})` defined Task 1, consumed verbatim in Tasks 3/4; `makeGrainPass`/`makeVignettePass`/`makeDuotonePass`/`applyPostExtras` defined Task 2, consumed in Tasks 3/4. ✓
- **Known risk (flagged, not hidden):** grain per-pixel parity may be infeasible if the 2D chain's RNG can't be reproduced in the three.js pass — Task 2 Step 1/4 gives the split-assertion fallback (amplitude + non-constant) with a required WHY. The pixel-parity test is the gate that catches the four-grains-style amplitude drift.
