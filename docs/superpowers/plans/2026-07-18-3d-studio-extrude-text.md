# 3D Studio Extruded Shapes and 3D Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `text` and `shape` primitives that extrude a 2D outline into 3D — text set in Sailor's own `.otf` fonts, and shapes from Shape Studio's outline generator.

**Architecture:** A new `lib/scene3d/outlines.ts` turns both sources into `THREE.Shape[]`. `geometryFor` gains two cases that feed those shapes to `ExtrudeGeometry`. Because they arrive as ordinary `PrimitiveKind`s producing ordinary geometry, everything downstream — materials, modifiers, cloner, Size, export — works unchanged.

**Tech Stack:** Vue 3 / Nuxt 4, TypeScript, three.js 0.171 (`ExtrudeGeometry`), opentype.js (already a dependency, used server-side by the template renderer), vitest.

## Global Constraints

- Zero new npm dependencies. opentype.js is already installed; the `.otf` files are already in `frontend/public/fonts`.
- Additive only: the fourteen existing primitives, their params and their geometry must be untouched. The `PRIM_GROUPS` drift test asserts the menu covers every kind in canonical order — append, do not reorder.
- Font loading follows the `glb.ts` pattern exactly: cached by URL, failures NOT cached, a token guard so a stale load cannot overwrite a newer one.
- `content` is optional and absent-stays-absent through serialize→parse, like `params` and `modifiers`.
- Commit hygiene (parallel sessions share this tree): stage only your own files and hunks, never `git add -A`, never `git stash`. Commit to `main`.
- Gates for every task: `cd frontend && npx vitest run tests/unit/scene3d-*.unit.spec.ts` green, and `npx vue-tsc --noEmit | grep -i scene3d` empty. vitest must run from the `frontend/` cwd.

---

### Task 1: The outline module

**Files:**
- Create: `frontend/app/lib/scene3d/outlines.ts`
- Create: `frontend/tests/unit/scene3d-outlines.unit.spec.ts`

**Interfaces produced** (Tasks 2 and 3 depend on these exact names):
- `AVAILABLE_FONTS: { label: string; url: string }[]`
- `loadFont(url: string): Promise<opentype.Font>` — cached; failures not cached
- `fontCacheGet(url: string): opentype.Font | null` — synchronous peek, so `geometryFor` can stay synchronous
- `textOutline(text: string, font: opentype.Font, opts: { size: number; letterSpacing: number }): THREE.Shape[]`
- `shapeOutline(sides: number, roundness: number): THREE.Shape[]`

**Notes for the implementer:**
- `AVAILABLE_FONTS` is derived from what actually exists in `frontend/public/fonts` — list that directory first and use the real filenames. Give each a readable label.
- opentype's `font.getPath(text, x, y, size)` yields commands `M`/`L`/`C`/`Q`/`Z`. Walk them into `THREE.Shape`/`THREE.Path`: each `M` starts a new contour, `Z` closes it. Contour winding decides shape-vs-hole — a counter (the inside of an `o`) winds opposite to its outer contour. Compute the signed area of each contour; contours whose sign differs from the first contour of the glyph become holes on it.
- Scale by `size / font.unitsPerEm`, apply `letterSpacing` to the pen advance, and centre the whole result on its own bounding box so the object sits on its origin like every primitive.
- `shapeOutline` uses `gemPoints` from `~/lib/shapefx/points` — read that function's signature and the `ShapeConfig` type first and pass whatever it actually needs; `sides`/`roundness` are the knobs the panel will expose.
- Y axis: opentype paths are y-down, three is y-up. Negate y when building the shapes or the text renders upside down.

**Testing:** load a real `.otf` from `public/fonts` (vitest runs in node — read the file with `fs` and pass the buffer to `opentype.parse`), then assert: a one-glyph string yields at least one shape; `'o'` yields a shape with exactly one hole; `'oo'` is wider than `'o'`; increasing `letterSpacing` widens a two-character string; the result is centred (bounding box centre within a small epsilon of the origin); `shapeOutline` point count tracks `sides`; the font cache returns the identical object for a repeated URL and does not cache a rejection.

- [ ] Write the failing tests
- [ ] Run them, confirm they fail for the right reason
- [ ] Implement `outlines.ts`
- [ ] Run tests, gates green
- [ ] Commit: `feat(3d-studio): text and shape outline sources`

---

### Task 2: Model and engine

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` (PRIMITIVE_KINDS, PrimitiveContent, PrimitiveObject, parser, createPrimitive seeding)
- Modify: `frontend/app/lib/scene3d/primParams.ts` (param specs for the two kinds)
- Modify: `frontend/app/lib/scene3d/primGroups.ts` (menu group so the drift test passes)
- Modify: `frontend/app/lib/scene3d/engine.ts` (`geometryFor` cases, `geoKey` includes content)
- Modify: `frontend/tests/unit/scene3d-config.unit.spec.ts`, `scene3d-engine.unit.spec.ts`

**Consumes:** everything Task 1 produced.

**Params** (per the spec's table): `text` gets `size`, `depth`, `bevel`, `bevelSegments`, `letterSpacing`, `curveSegments`; `shape` gets `depth`, `bevel`, `bevelSegments`, `sides`, `roundness`. Ranges and defaults are in the spec.

**Key points:**
- `geometryFor` must stay SYNCHRONOUS. For `text`, peek the font cache with `fontCacheGet`; on a miss, kick off `loadFont` (fire-and-forget) and return a small placeholder box this frame. The surface re-syncs when the promise resolves — the same shape as a loading GLB.
- `geoKey` must include the content bag, or editing text or swapping fonts will not rebuild.
- Centre the extruded geometry, and confirm the 14-kind back-compat oracle test still passes untouched.

- [ ] Write the failing tests
- [ ] Run them, confirm they fail for the right reason
- [ ] Implement
- [ ] Run tests, gates green
- [ ] Commit: `feat(3d-studio): text and shape primitives`

---

### Task 3: Panel controls and verification

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

**Consumes:** Tasks 1 and 2.

- The `+ Primitive` menu picks up the new group automatically from `PRIM_GROUPS`; confirm rather than assume.
- The Geometry section renders the numeric params automatically from the schema table. Above them, add the non-schema controls: for `text`, a text input bound to `content.text` and a font `StudioSelect` bound to `content.font`; for `shape`, a preset `StudioSelect`. Use the existing micro-label styling already used for Axis/Shading.
- Show an inline error when a font fails to load, following the GLB error convention already in this file.
- Style rules: the Selection panel is one `StudioSection` of plain `<details class="group">` sub-groups — do NOT nest a StudioSection, and do not restructure surrounding markup. This file carries other sessions' edits; stage only your hunks.

**Browser verification (real interactions only).** Find the dev server via `ps aux | grep -i nuxt` and confirm the port with `lsof -nP -iTCP -sTCP:LISTEN | grep node` (it has drifted off 3000). Reuse it; never kill a server you did not start. Always `127.0.0.1`. Create the node with `sailor:addNode` / `nodeType: 'Scene3DStudio'`; everything after that must be real clicks and drags.

Verify: Text appears in the + Primitive menu and adds an object; typing rebuilds the mesh; switching fonts changes the letterforms; size/depth/bevel behave; a glyph with a counter (`o`, `a`) renders its hole rather than a filled blob; Shape adds and its sides/roundness work; a multi-stop gradient, a twist modifier and a grid cloner all work on a text object; save/reopen restores text and font; Export bake matches; no console errors.

- [ ] Implement
- [ ] Gates green
- [ ] Browser verification with screenshots
- [ ] Commit: `feat(3d-studio): text and shape panel controls`

---

## Self-Review

**Spec coverage:** outline pipeline and both sources → Task 1; new kinds, content bag, params, menu group, geometry cases, geoKey → Task 2; panel controls, font error surface, verification → Task 3.

**Risk notes:** the glyph hole/winding logic is the most likely source of a subtle wrong result (a filled `o` looks obviously wrong; a slightly wrong hole on `a` may not), which is why Task 1 tests it directly rather than leaving it to the browser pass. The y-axis flip is the other classic.
