# Stylised Post Passes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stylised post-processing passes — film grain, halftone, dot screen, glitch, pixelation, and ground-truth ambient occlusion — to the shared post chain that Scene3D and Space Type already run.

**Architecture:** three.js ships all of these in `examples/jsm/postprocessing/`, and `PostChain` (`app/lib/spacetype/post.ts`) is already an `EffectComposer`. Passes are constructed once and toggled via `.enabled`, exactly as `UnrealBloomPass` already is. Settings live on the shared `PostSettings`.

**Tech Stack:** TypeScript, three@0.171 (`examples/jsm/postprocessing`), Vue 3 / Nuxt 4, Vitest.

## Global Constraints

- **`PostSettings` is SHARED between Scene3D and Space Type.** Adding a field affects both.
- **The two consumers parse it differently, and this is the single most likely thing to get wrong:**
  - **Scene3D** — `parsePost` in `app/lib/scene3d/config.ts:498` is an explicit per-field validating parse. **A new field not added there is silently dropped on every save/reload.**
  - **Space Type** — `SpaceTypeSurface.vue:740` does `Object.assign(post, DEFAULT_POST, scene.post)`, a tolerant spread. New fields flow through automatically **provided they are in `DEFAULT_POST`**.
  - So every new field needs: the `PostSettings` interface, `DEFAULT_POST`, **and** Scene3D's `parsePost`.
- **`postEnabled(p)` gates the whole composer.** It must be extended for every new toggle, or turning a new pass on will do nothing when no pre-existing effect is also on. This is a silent-no-op trap.
- **Every new pass defaults to OFF.** With everything off the engine bypasses the composer entirely for zero overhead and byte-identical output — preserve that property.
- **Chain order is fixed and load-bearing** (see Task 1). Geometry-aware passes go first; the grade pass stays last.
- `PostChain.render(scene, camera)` re-points `renderPass.scene/camera` every frame because the camera swaps. **Any new pass holding a scene/camera reference needs the same treatment.**
- Test env is `node` with no DOM/WebGL: `PostChain` itself is **not** unit-testable. Test the pure settings/gating logic; do not write a test that cannot fail.
- Unit tests live flat in `frontend/tests/unit/<kebab-name>.unit.spec.ts`. Aliases: `~/` → `frontend/app/`, `~~/` → `frontend/`.
- `npm run test` is Playwright. Use `npx vitest run <file>` from `frontend/`.
- ~106 files are modified by concurrent sessions. Stage only your own paths, explicitly; `Scene3DStudioSurface.vue` in particular carries foreign hunks — isolate with `git apply --cached`. Never `git add -A`, never `git stash`.

## Scope decisions made before planning

**LUTPass is NOT in this plan.** It requires an actual LUT asset (`options.lut`, defaults to `null` = silent no-op) and three ships `.cube`/`.3dl`/image loaders for it. That makes it a file-upload-and-storage feature, not a pass toggle — a materially different and larger piece of work. Deferred deliberately; raise with the user rather than smuggling it in.

**`RenderPixelatedPass` is not an appendable post pass.** Its signature is `(pixelSize, scene, camera, options)` — it *replaces* `RenderPass` at the head of the chain. It therefore also collides with GTAO, which must sit immediately after the render. Task 4 handles this explicitly.

---

### Task 1: Chain scaffold + FilmPass (proves the pattern end to end)

**Files:**
- Modify: `frontend/shared/spacetype/state.ts` (the `PostSettings` interface)
- Modify: `frontend/app/lib/spacetype/post.ts` (`DEFAULT_POST`, `postEnabled`, `PostChain`)
- Modify: `frontend/app/lib/scene3d/config.ts` (`parsePost` — the whitelist)
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (UI)
- Test: `frontend/tests/unit/post-settings.unit.spec.ts`

**Interfaces produced:** `PostSettings.film/filmIntensity/filmGrayscale`; the established add-a-pass pattern for Tasks 2–4.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_POST, postEnabled } from '~/lib/spacetype/post'

describe('post settings', () => {
  it('defaults every effect to off', () => {
    expect(postEnabled(DEFAULT_POST)).toBe(false)
  })
  it('film defaults to off but is present, so the tolerant Space Type spread picks it up', () => {
    expect(DEFAULT_POST.film).toBe(false)
    expect(typeof DEFAULT_POST.filmIntensity).toBe('number')
  })
  it('postEnabled reports true when ONLY film is on', () => {
    expect(postEnabled({ ...DEFAULT_POST, film: true })).toBe(true)
  })
})
```

The third case is the important one — it is the silent-no-op trap. Without extending `postEnabled`, enabling film alone leaves the composer bypassed and nothing happens.

- [ ] **Step 2: Run it, confirm it fails**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/post-settings.unit.spec.ts
```
Expected: FAIL — `DEFAULT_POST.film` is undefined.

- [ ] **Step 3: Extend the shared type**

In `frontend/shared/spacetype/state.ts`, add to `PostSettings`:
```ts
  film: boolean; filmIntensity: number; filmGrayscale: boolean
```

- [ ] **Step 4: Extend `DEFAULT_POST` and `postEnabled`**

In `app/lib/spacetype/post.ts`:
```ts
  film: false, filmIntensity: 0.35, filmGrayscale: false,
```
and extend `postEnabled` to include `p.film`.

- [ ] **Step 5: Add the pass to `PostChain`, in the correct position**

The chain order is load-bearing. Establish it now, with room for later tasks:

```
RenderPass  →  [GTAO]  →  Bloom  →  [Halftone]  →  [DotScreen]  →  Film  →  [Glitch]  →  Grade
```

Geometry-aware passes go immediately after the render; the grade pass stays **last**. There is a documented quirk in `setSettings` — the grade pass is force-enabled when only bloom is on, because `UnrealBloomPass` cannot end the chain on screen. Keeping grade last preserves that; do not move it.

Construct `FilmPass` in the constructor (`new FilmPass(intensity, grayscale)`), `addPass` it in the position above, default `enabled = false`, and drive it from `setSettings`. `FilmPass` exposes its parameters as uniforms (`uniforms.intensity`, `uniforms.grayscale`) — read the file and set them the way it actually expects rather than assuming setters exist.

Add a `// order matters` comment naming the rule, so nobody appends a pass after grade.

- [ ] **Step 6: Add it to Scene3D's whitelist**

In `app/lib/scene3d/config.ts`'s `parsePost`, add `film`, `filmIntensity`, `filmGrayscale` following the existing `bool(...)` / `num(...)` idiom. **Omitting this silently drops the setting on reload.**

- [ ] **Step 7: Verify tests pass**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/post-settings.unit.spec.ts tests/unit/scene3d-config.unit.spec.ts
```

- [ ] **Step 8: UI**

Add a Film section to the post area of `Scene3DStudioSurface.vue`, following the existing Bloom block exactly: a `StudioSwitch` bound to `doc.post.film`, then `v-if="doc.post.film"` revealing `StudioSlider` for intensity (0–1, step 0.01) and a switch for grayscale. Every slider carries a plain-English `hint`.

**Tailwind trap:** use only classes/arbitrary values already present in that file — the running dev server's scanner does not pick up new arbitrary values and they silently compute to nothing.

- [ ] **Step 9: Commit**

```bash
git add frontend/shared/spacetype/state.ts frontend/app/lib/spacetype/post.ts frontend/app/lib/scene3d/config.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/tests/unit/post-settings.unit.spec.ts
git commit -m "feat(post): film grain pass + shared post-pass scaffold"
```

---

### Task 2: Halftone, DotScreen, Glitch

Three more appendable image passes, following Task 1's proven pattern exactly.

**Files:** same set as Task 1, plus its test file.

- [ ] **Step 1: Extend the test first** — for each pass, assert it is present-and-off in `DEFAULT_POST`, and that `postEnabled` returns true when only that pass is on. Three more cases of the silent-no-op guard.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Add fields** to `PostSettings`, `DEFAULT_POST`, `postEnabled`, and Scene3D's `parsePost`:
  - `halftone: boolean; halftoneRadius: number; halftoneScatter: number`
  - `dotScreen: boolean; dotScreenScale: number; dotScreenAngle: number`
  - `glitch: boolean`
- [ ] **Step 4: Construct and wire the passes** in the order from Task 1.
  - `HalftonePass(width, height, params)` — takes explicit dimensions, so it **must** also be updated in `PostChain.setSize`. Missing that leaves it wrong after any resize; check how `bloomPass.setSize` is handled there and match.
  - `DotScreenPass(center, angle, scale)` — parameters live in `uniforms`; read the file.
  - `GlitchPass(dt_size)` — has a `goWild` property; expose only the on/off toggle for now.
- [ ] **Step 5: Verify tests.**
- [ ] **Step 6: UI** — three more sections following the Bloom pattern.
- [ ] **Step 7: Commit** (stage explicitly).

---

### Task 3: GTAOPass

Ambient occlusion — the biggest realism lever, and the one with real tuning in it.

**Files:** same set, plus `frontend/tests/unit/post-settings.unit.spec.ts`.

- [ ] **Step 1: Test first** — `gtao` present-and-off in `DEFAULT_POST`; `postEnabled` true when only `gtao` is on.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Fields** — `gtao: boolean; gtaoRadius: number; gtaoIntensity: number; gtaoThickness: number`. Add to all four places including `parsePost`.
- [ ] **Step 4: Construct**

`new GTAOPass(scene, camera, width, height, parameters, aoParameters, pdParameters)`.

Three things that will otherwise bite, in order of likelihood:

1. **Set `screenSpaceRadius: true`.** GTAO's `radius` is in **world units**, and this is a design tool where users scale objects freely — a radius tuned on a 1-unit sphere is wrong for a 10-unit scene. Screen-space radius makes it scale-independent. Do not skip this.
2. **It holds `scene` and `camera`.** `PostChain.render(scene, camera)` re-points `renderPass` every frame because the camera swaps. GTAO needs the same, or it will silently occlude against a stale camera. Mirror what `render()` does for `renderPass`.
3. **It must sit immediately after the render pass**, before bloom — it is geometry-aware and needs the raw render.

Also call its `setSize` from `PostChain.setSize`.

- [ ] **Step 5: Keep `blendIntensity` moderate by default.** AO should darken *ambient* light; multiplying it over the whole image also darkens directly-lit surfaces, which reads as grime. Default the intensity low (≈0.5) and say why in a comment.
- [ ] **Step 6: Verify tests.**
- [ ] **Step 7: UI** — toggle plus Radius, Intensity, Thickness sliders, with hints.
- [ ] **Step 8: Commit.**

---

### Task 4: RenderPixelatedPass — chain-head restructure

Not an appendable pass. `RenderPixelatedPass(pixelSize, scene, camera, options)` **replaces** `RenderPass`.

- [ ] **Step 1: Test first** — `pixelate` present-and-off; `postEnabled` true when only `pixelate` is on.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Fields** — `pixelate: boolean; pixelSize: number` (2–16, default 6). All four places.
- [ ] **Step 4: Restructure the chain head**

Construct both `RenderPass` and `RenderPixelatedPass` up front and swap which is enabled, rather than rebuilding the composer — rebuilding on a toggle would drop every other pass's state.

**The GTAO collision is the real decision here.** Both want the head of the chain. Pick one and document it:
- Simplest defensible choice: when `pixelate` is on, disable GTAO (its depth/normals would be derived from a deliberately low-res render, so the occlusion is meaningless), and surface that in the UI rather than silently ignoring the user's GTAO toggle.
- If you find a defensible way to run both, take it — but say what you verified.

Whatever you choose, it must not be a **silent** override. This codebase has been bitten repeatedly by controls that appear to do something and don't.

- [ ] **Step 5: Re-point scene/camera** for the pixelated pass in `render()`, same as `renderPass`.
- [ ] **Step 6: Verify tests.**
- [ ] **Step 7: UI** — toggle + pixel size slider, plus the GTAO interaction made visible.
- [ ] **Step 8: Commit.**

---

## Final verification

- [ ] Full unit suite shows no NEW failures: `npx vitest run` (a pre-existing baseline of failures from concurrent sessions' uncommitted files is expected — compare, don't demand zero).
- [ ] With every effect off, `postEnabled` is false and the composer is bypassed — the zero-overhead property is intact.
- [ ] Each new pass toggles visibly ON ITS OWN, with no other effect enabled. This is the direct test of the `postEnabled` trap.
- [ ] Settings survive save → reload (the `parsePost` whitelist).
- [ ] Space Type still renders correctly — it shares `PostSettings` and its tolerant spread now carries fields its UI does not expose. Confirm they are inert there, not broken.
- [ ] Chain order is as documented, with grade still last.

## Out of scope

- **LUTPass** — needs a LUT asset pipeline (upload/store `.cube`), not a toggle. Deferred deliberately.
- **OutlinePass** — three's version is a *selection-highlight* pass (takes `selectedObjects`, draws a dilated glow). It is not a cel contour and would not catch interior creases. A real toon outline wants a depth+normal edge-detect `ShaderPass`, which is its own task.
- **AfterimagePass** — accumulates previous frames, so it breaks the `f(t)` bake/scrub model: a frame rendered in isolation has no trail history.
- **SSRPass** — expensive and artefact-prone; off-screen geometry simply does not reflect.
- Exposing the new passes in Space Type's own UI (the fields reach it, the controls are Scene3D-only for now).
