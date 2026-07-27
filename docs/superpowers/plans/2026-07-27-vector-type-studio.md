# Vector Type Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A studio where letters are **outlines you animate directly** — variable axes moving as real geometry, exportable as SVG — replacing the kinetic surfaces it supersedes.

**Architecture:** fontkit reads a variable TTF and yields glyph outlines at any axis position. Those paths are the single source for the canvas fill, the PNG bake, and the SVG export. The studio is **stateless** — `f(config, t) → paths` — so motion is free and, unusually for a Sailor studio, the engine is **unit-testable without a canvas**. Built on the factory: one `ControlSpec[]` declaration drives agent, motion, sweeps and the inspector via `StudioControlPanel`.

**Design:** `docs/superpowers/specs/2026-07-27-vector-type-studio-design.md` — read it first. It records both spikes and the corrections to the retirement list.

**Working demo:** `frontend/app/pages/dev/vectortype.vue` (commit `f7767f34c`) already proves the core loop end to end. Tasks 3–4 productionise it.

**Tech Stack:** TypeScript, Vue 3 (Nuxt 4), fontkit 2.0.4, Paper.js (already installed, for future boolean ops), Vitest.

## Global Constraints

- **`lib/motion/` must NOT be deleted.** The comment in `kineticEnabled.ts` calling it part of the dormant feature is **stale**. It is live infrastructure for the Compositor motion redesign and the timeline (`useCompositorLayers`, `CompositorMotionTimeline`, `MotionPresetPicker`, `KeyframeDock`, `MotionClipInspector`).
- **`uploadFrameBatch` must be extracted before any deletion.** It lives in `useKineticRenderer.ts` but eight live call sites across every studio use it. Task 1 does this; nothing may be deleted before it lands.
- **Kinetic Slates ≠ Kinetic Type.** Only *Slates* is gated off. `KineticType` is a live, ungated toolbox node that may exist in saved projects — it gets a **migration**, not a deletion.
- **Font source is the Google Fonts repo, never the CSS2 API.** `fonts.googleapis.com/css2` serves static instances regardless of user agent (curl UA → per-weight TTF; browser UA → woff2 that is still one weight, split by unicode-range). Verified 2026-07-27.
- **`requestAnimationFrame` is throttled to zero in a hidden tab.** Any render loop must fall back to a timer when `document.hidden`, or it silently never runs under automation or offscreen capture. The demo's `schedule()` is the reference.
- ~100 files are modified by OTHER concurrent sessions. Stage only the paths each task names; run `git diff --cached` and read it before every commit. Never `git add -A` / `git add .` / `git stash`.
- Test: `pnpm test:unit` from `frontend/`. Known pre-existing failures: 16 tests across 8 files (gradientfx-frame-source, gradientfx-mesh, ticker-effect, spacetype-palette, agent-capability-routing, artifact-next-steps, critique-fix-chips, video-model-adapt). Anything beyond those is yours.

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `app/lib/studio/frameUpload.ts` | `uploadFrameBatch`, moved out of the kinetic module | Create |
| `server/api/fonts/variable.get.ts` | family → variable TTF proxy (repo source, cached) | Create |
| `app/lib/vectortype/font.ts` | fontkit load + cache + axis metadata | Create |
| `app/lib/vectortype/outline.ts` | text + axes → path commands. **Pure, no canvas.** | Create |
| `app/lib/vectortype/render.ts` | paths → canvas; paths → SVG | Create |
| `app/lib/vectortype/config.ts` | `VectorTypeConfig`, `mergeConfig`, `DEFAULT_CONFIG` | Create |
| `app/lib/vectortype/controls.ts` | `VT_CONTROLS`, `VT_SECTIONS`, `visibleVtControls` | Create |
| `app/lib/vectortype/agentControls.ts` | derived agent vocabulary + guidance | Create |
| `app/lib/vectortype/motion.ts` | `animatableTargets`, `applyMotion` | Create |
| `app/components/vue-canvas/VectorTypeNode.vue` / `…Surface.vue` | node + surface | Create |
| `app/lib/vectortype/spike.ts` | **delete** — superseded by `font.ts`/`outline.ts` | Delete |

---

### Task 1: Extract `uploadFrameBatch` — unblocks everything else

**Files:** Create `app/lib/studio/frameUpload.ts`; modify `app/composables/useKineticRenderer.ts` and its eight call sites.

- [ ] **Step 1: Find every call site**

```bash
grep -rn "uploadFrameBatch" frontend/app | grep -v "useKineticRenderer.ts:"
```
Expect ~8: `ShapeStudioSurface`, `GradientStudioSurface`, `TextureStudioSurface`, `ShaderStudioSurface`, `SpaceTypeSurface`, `CompositorModal`, `ArtifactFrameNode`, `lib/motion/bake.ts`, `lib/spacetype/bake.ts`, `lib/engine/motionClipBake.ts`, `lib/collection/upload.ts`. Some are dynamic `await import(...)`.

- [ ] **Step 2: Move the function verbatim**

Cut `uploadFrameBatch` (and only it, plus whatever it privately needs) from `useKineticRenderer.ts` into `app/lib/studio/frameUpload.ts`. Do not change its behaviour. Re-export it from `useKineticRenderer.ts` for one commit so nothing breaks mid-flight:

```ts
export { uploadFrameBatch } from '~/lib/studio/frameUpload'
```

- [ ] **Step 3: Repoint every call site** to `~/lib/studio/frameUpload`, static or dynamic import as each site already does.

- [ ] **Step 4: Remove the temporary re-export** and confirm nothing still imports it from the kinetic module:
```bash
grep -rn "uploadFrameBatch" frontend/app | grep "useKineticRenderer"   # must be empty
```

- [ ] **Step 5: Verify + commit**

`pnpm test:unit` — no new failures. Video export is the thing at risk here; if any bake-related spec exists, run it explicitly and say which.

```bash
git commit -m "refactor(studio): extract uploadFrameBatch out of the kinetic module"
```

---

### Task 2: Delete Kinetic Slates

Only after Task 1. This is the ~450-line dormant set.

**Files:** Delete `app/lib/slates/` (2 files), `app/data/slate-templates.ts`, `app/components/vue-canvas/SlateGalleryModal.vue`, `app/lib/kineticEnabled.ts`. Modify `app/data/studio-options.ts:25`, `app/layouts/default.vue:4232`, `app/components/vue-canvas/CompositorModal.vue:4076`.

- [ ] **Step 1: Remove the three gates.** Each is a `KINETIC_ENABLED &&` guard — delete the guard *and* the branch it gates (the Slate entry in the Studios door, the `SlateGalleryModal` render, the dev-only button).

- [ ] **Step 2: Delete the files above**, then confirm nothing dangles:
```bash
grep -rn "KINETIC_ENABLED\|SlateGalleryModal\|slate-templates\|lib/slates" frontend/app   # must be empty
```

- [ ] **Step 3: Do NOT touch `lib/motion/`, `useKineticRenderer.ts`, `KineticTypeModal.vue`, or `WidgetKineticType.vue`.** The first is live; the rest are the *KineticType* feature, retired later by Task 8.

- [ ] **Step 4: Verify + commit**

`pnpm test:unit`, plus `npx vue-tsc --noEmit 2>&1 | grep -E "default.vue|CompositorModal|studio-options"` — report exactly.

```bash
git commit -m "chore: retire Kinetic Slates"
```

---

### Task 3: The font layer

**Files:** Create `server/api/fonts/variable.get.ts`, `app/lib/vectortype/font.ts`, `tests/unit/vectortype-font.unit.spec.ts`. Modify `app/data/variable-fonts.ts`.

**Interfaces produced:** `loadVariableFont(id): Promise<VtFont>`, `VtFont { axes, unitsPerEm, raw }`.

- [ ] **Step 1: Add repo paths to the existing catalog**

`app/data/variable-fonts.ts` already curates variable families with their axes for the Font Playground. Add a `ttfPath` per entry pointing at the Google Fonts repo, e.g. `ofl/robotoflex/RobotoFlex[GRAD,XOPQ,...,wght].ttf`.

**Do not derive the path by convention** — the axis list is baked into the filename and cannot be guessed. Curate it. The demo's `FONTS` array (`app/pages/dev/vectortype.vue`) has four verified paths to start from.

- [ ] **Step 2: The proxy route**

Model it on `server/api/scene3d/google-font-file.get.ts` — same in-memory cache, TTL, entry cap, and error shape. It takes a catalog `id` (not an arbitrary URL — do not build an open proxy) and fetches the corresponding repo path.

- [ ] **Step 3: The loader**

`app/lib/vectortype/font.ts`: fetch via the proxy, `fontkit.create(bytes)`, cache by id, expose `variationAxes` normalised to `{ tag, min, default, max }`. **Import fontkit as `import * as fontkit from 'fontkit'`** — it has no default export (the spike hit this).

- [ ] **Step 4: Tests**

Unit-test the pure parts: catalog integrity (every entry has a `ttfPath`; every declared axis tag is well-formed), and the axis normaliser. Do NOT unit-test the network fetch.

- [ ] **Step 5: Verify live + commit**

In the browser, load each catalogued family through the proxy and confirm the axis list matches the catalog. Report any family whose repo path 404s — those get removed from the catalog rather than shipped broken.

```bash
git commit -m "feat(vectortype): variable font proxy + fontkit loader"
```

---

### Task 4: Outlines and rendering — the testable core

**Files:** Create `app/lib/vectortype/outline.ts`, `render.ts`, `tests/unit/vectortype-outline.unit.spec.ts`. Delete `app/lib/vectortype/spike.ts`.

**This is the task with the best test leverage in the whole product** — path commands are plain data, so the engine can be tested without a canvas or a GPU.

- [ ] **Step 1: `outline.ts` — pure**

```ts
export interface GlyphOutline { commands: PathCommand[]; advance: number }
export function textOutlines(font: VtFont, text: string, axes: Record<string, number>): {
  glyphs: GlyphOutline[]; width: number; unitsPerEm: number
}
```
Use `font.getVariation(axes).layout(text)` — fontkit does the shaping and gives `positions[i].xAdvance`. Command shape is `{ command: 'moveTo'|'lineTo'|'quadraticCurveTo'|'bezierCurveTo'|'closePath', args: number[] }` (verified).

- [ ] **Step 2: Tests that actually pin the value**

```ts
it('produces one outline per glyph with a positive advance', …)
it('keeps command COUNT constant as an axis moves — the property that makes animation safe', () => {
  // Verified in the spike: Inter 46, Roboto Flex 36, constant across the sweep.
  const a = textOutlines(font, 'g', { wght: 100 })
  const b = textOutlines(font, 'g', { wght: 900 })
  expect(a.glyphs[0]!.commands.length).toBe(b.glyphs[0]!.commands.length)
})
it('moves the outline as the axis moves', … /* compare coordinates, expect difference */)
it('clamps an out-of-range axis value to the font\'s own range', …)
```

- [ ] **Step 3: `render.ts`**

Two consumers of the same outlines:
```ts
export function outlinesToPath2D(o, opts): Path2D[]
export function outlinesToSVG(o, opts): string   // the vector export spine
```
Font space is y-up; the canvas path applies `scale(1, -1)`. The SVG writer is deliberately separate from the studio so **Shape Studio can be its second consumer** (its flat-shaded facets project to coloured polygons).

- [ ] **Step 4: Delete `spike.ts`** — superseded.

- [ ] **Step 5: Verify + commit**

```bash
git commit -m "feat(vectortype): pure outline extraction + canvas/SVG renderers"
```

---

### Task 5: Config and schema — the factory

**Files:** Create `app/lib/vectortype/config.ts`, `controls.ts`, `agentControls.ts`, `tests/unit/vectortype-controls.unit.spec.ts`.

Follow `app/lib/shapefx/` exactly — it is the most recent and cleanest example (config + `mergeConfig` + controls + derived agentControls, with a characterization snapshot).

- [ ] **Step 1: `config.ts`** — `VectorTypeConfig` with `text`, `fontId`, `axes: Record<string, number>`, `size`, `tracking`, `fill`, `stroke`, `strokeWidth`, `align`, plus a `motion` block. `mergeConfig(raw)` in the strict rebuild style of `shapefx/config.ts` (type-check every field, never trust the blob).

- [ ] **Step 2: `controls.ts`** — `VT_CONTROLS` + `VT_SECTIONS` + `visibleVtControls(cfg)`. Keys are dotted paths resolving against `VectorTypeConfig`; a test must assert every key resolves via `makeConfigParams`.

  **The axis controls are dynamic** — each font has a different axis set. Use the pattern shader-as-fill established: **declare the frame, derive the contents.** `fontId` is a frozen `select`; the per-axis sliders are derived from the loaded font's `variationAxes` at `axes.<tag>`. Read `docs/superpowers/specs/2026-07-26-shader-as-fill-design.md` for how that was done there.

- [ ] **Step 3: `agentControls.ts`** — a filter over `visibleVtControls`, stripping `when`/`agent`/`animatable`, exactly like `shapefx/agentControls.ts`. Plus `VT_GUIDANCE` prose, with a test asserting every key it names exists.

- [ ] **Step 4: Tests + characterization snapshot**, mirroring `shapefx-controls.unit.spec.ts`.

- [ ] **Step 5: Commit** — `feat(vectortype): declarative control schema`

---

### Task 6: Motion

**Files:** Create `app/lib/vectortype/motion.ts`, `tests/unit/vectortype-motion.unit.spec.ts`.

Follow `app/lib/gradientfx/motion.ts` — this studio is stateless like Gradient, so that model ports directly (unlike Shape, whose rebuild-on-change engine capped it at camera and scale).

- [ ] **Step 1:** `animatableTargets(cfg)` derived from `VT_CONTROLS` where `animatable` is not false — including every `axes.<tag>`. Reuse `MotionTrack`/`trackValue` shapes from gradientfx rather than reinventing them; extract to a shared module if that is cleaner than duplicating.
- [ ] **Step 2:** `applyMotion(cfg, t)` via `getByPath`/`setByPath` from `~/lib/studio/path`, cloning rather than mutating.
- [ ] **Step 3:** Tests — an axis track animates; an unresolvable path is skipped without fabricating structure; the config is not mutated.
- [ ] **Step 4: Commit** — `feat(vectortype): motion tracks over any axis`

---

### Task 7: Node, surface, and registration — the studio appears

**Files:** Create `VectorTypeNode.vue`, `VectorTypeSurface.vue`. Modify the nine registration touchpoints.

- [ ] **Step 1: The surface.** Use `StudioControlPanel` for the inspector (it exists now — Texture and Shape both use it), `useStudioVarMenu` for the variable/sweep menu (extracted earlier today), and `useStudioVarBindings`. Pass `edges` from the mount site — Shape needed this and it is easy to miss.

  **The render loop must use the demo's `schedule()` pattern**, not raw rAF.

- [ ] **Step 2: The node.** `registerStudioBaker` for PNG (offscreen canvas, same one-shot pattern as `ShapeStudioNode.bakeOutput`), and `registerStudioFrameSource` — this studio is stateless, so the frame source is the easy Gradient case, not the Scene3D case.

- [ ] **Step 3: Registration — all nine.** Enumerated by probing an existing studio:
```bash
grep -rl "ShapeStudio" frontend/app | grep -vE "shapefx|ShapeStudioSurface|ShapeStudioNode"
```
`useVueNodes` · `VueNodeCanvas` (component map + modal listener) · `data/studio-options.ts` · `lib/agent/capabilities.ts` · `lib/agent/studioTune.ts` · **`lib/agent/surfaces/canvas.ts` (the tuneNode hint — a registered tuner absent from that prose is unreachable; there is a guard test)** · `lib/collection/studioControls.ts` · `lib/collection/varsInput.ts` · `lib/studio/cascade.ts`.

- [ ] **Step 4: Param baker** for Collection sweeps — snapshot, apply, render, **restore in a `finally`**. `GradientStudioSurface.renderBlobWithOverrides` is the reference.

- [ ] **Step 5: Verify live.** Add the node, type text, pick a font, drag an axis, see outlines move. Add a motion track on an axis and play. Render to PNG. Bind an axis to a Collection column and sweep it. Report each.

- [ ] **Step 6: Commit** — `feat(vectortype): studio node, surface and registration`

---

### Task 8: SVG export

**Files:** Modify `VectorTypeSurface.vue`; wire `outlinesToSVG` to a download and to the deliverables path.

- [ ] **Step 1:** An Export SVG action on the surface footer, next to the existing PNG render.
- [ ] **Step 2:** Confirm the exported file opens in a vector editor with editable outlines — not a raster embed. Say which editor you checked in.
- [ ] **Step 3:** Note in the commit that this is Sailor's **first vector output**, and that `outlinesToSVG` is deliberately studio-agnostic so Shape Studio's facets can feed it next.
- [ ] **Step 4: Commit** — `feat(vectortype): SVG export — Sailor's first vector output`

---

### Task 9: Retire KineticType, with migration

Only after Tasks 3–8 work. This touches saved projects.

**Files:** Modify `app/data/toolbox-items.ts`; add a migration; delete `KineticTypeModal.vue`, `WidgetKineticType.vue`, and the kinetic-only remainder of `useKineticRenderer.ts`.

- [ ] **Step 1: Inspect what a saved KineticType node holds** — its properties key, text, and preset — before writing anything.
- [ ] **Step 2: Write the migration** — on load, a `KineticType` node becomes a `VectorType` node carrying its text across, and mapping its motion preset to the nearest equivalent. Where no equivalent exists, carry the text and leave motion empty rather than guessing.
- [ ] **Step 3: Test the migration** as a pure function over a saved-blob fixture. This is the highest-risk step in the plan; it deserves a spec of its own.
- [ ] **Step 4: Remove** the toolbox entry, the modal, the widget, and whatever remains of `useKineticRenderer.ts` after Task 1 took `uploadFrameBatch` out. Confirm nothing dangles.
- [ ] **Step 5: Verify** an old project opens with its type intact.
- [ ] **Step 6: Commit** — `feat(vectortype): replace KineticType, migrating saved nodes`

---

### Task 10: Retire the Font Playground

- [ ] **Step 1:** Confirm the studio covers what the widget did — a variable family, live axes, a render. It should, in vector rather than raster.
- [ ] **Step 2:** Migrate its node the same way as Task 9, or — if usage is plausibly zero — remove the toolbox entry first and delete a release later. **Say which you chose and why.**
- [ ] **Step 3:** Delete `WidgetFontPlayground.vue` and any now-unreferenced entries in `app/data/variable-fonts.ts` that the studio does not use.
- [ ] **Step 4: Commit** — `chore: retire the Font Playground widget`

---

## Out of scope, deliberately

Morphing between different strings (different glyph counts is a real research problem) · boolean ops between letters (Paper.js can, but it needs its own design pass) · field deformation of anchor points · complex-script shaping · multi-axis *choreography* (fontkit makes multi-axis sampling free; the authoring UI for independent axis timelines is its own problem) · **TextOnPath and TextMask** (absorbable as features later — the design says so explicitly, and the plan should not quietly adopt them).

## The number to watch

Net type surfaces **six → four** by Task 10 (Slates, KineticType, Font Playground retired; Vector Type added). If this ships without Tasks 9 and 10, it is a seventh surface and the sprawl the landscape research warned about — the retirement tasks are the point, not the cleanup.
