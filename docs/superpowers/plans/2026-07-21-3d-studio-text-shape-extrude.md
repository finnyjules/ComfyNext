# 3D Studio — Extruded Text + Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add two new `PrimitiveKind`s to the 3D Studio — `'text'` (3D text set in one of Sailor's `.otf` fonts) and `'shape'` (Shape Studio's gem outline) — both extruded via `THREE.ExtrudeGeometry`, so they inherit every existing path (all 7 materials, modifiers, cloner, Size, duplication, export, motion).

**Architecture:** One pipeline: `2D outline (THREE.Shape[]) → ExtrudeGeometry(depth, bevel) → the existing mesh path`. Outlines come from `opentype.js` glyph paths (text) or `gemPoints` (shape). Fonts load async + cached (mirroring `glb.ts`); text shows a placeholder box until its font resolves, then re-syncs. Non-numeric content (`text`/`font`/`shape` strings) lives in an optional `content?: PrimitiveContent` on `PrimitiveObject` (the `params` bag stays a flat number map). `geoKey` includes the content bag so editing text/font rebuilds the mesh.

**Tech stack:** TypeScript, Three.js (`ExtrudeGeometry`, `Shape`/`Path`), `opentype.js` (already a dependency), Vitest, Vue 3. **No new dependencies.** Design source: `docs/superpowers/specs/2026-07-18-3d-studio-extrude-text-design.md` (approved).

## Global Constraints

- **No new deps.** Reuse `opentype.js` (installed) + the `.otf` files in `frontend/public/fonts`.
- **`'text'`/`'shape'` are `PrimitiveKind`s, NOT new `SceneObject` kinds** — do not add a new object branch; they flow through the existing `kind: 'primitive'` path.
- **Append, never reorder** `PRIMITIVE_KINDS` and `ParamSpec.options` (stored indices are a persistence contract; there's a `PRIM_GROUPS` drift test asserting canonical order).
- **Tests:** Vitest from `frontend/`, in `frontend/tests/unit/scene3d-*.unit.spec.ts`; alias `~` → `frontend/app`. Gate per task: `cd frontend && npx vitest run tests/unit/scene3d-*.unit.spec.ts` green + `npx vue-tsc --noEmit | grep -iE 'scene3d'` empty.
- **`parseDoc` takes a STRING**; round-trip via `parseDoc(serializeDoc(doc))`.
- Main-direct, file-scoped commits; stage only each task's paths (main is shared with parallel sessions).
- **Out of scope** (per spec): live Shape-Studio-node binding, SVG import, per-glyph transforms, text-on-path, multi-line alignment, font upload.

---

## File structure

- Modify `frontend/app/lib/scene3d/config.ts` — `PRIMITIVE_KINDS` += `'text'`,`'shape'`; `PrimitiveContent` type; `content?` on `PrimitiveObject`; tolerant parse; `createPrimitive` seeding.
- Modify `frontend/app/lib/scene3d/primParams.ts` — `PRIMITIVE_PARAMS.text`/`.shape` ParamSpec arrays.
- Modify `frontend/app/lib/scene3d/primGroups.ts` — a `Text · Shape` menu group.
- Create `frontend/app/lib/scene3d/outlines.ts` — `loadFont`, `AVAILABLE_FONTS`, `shapeOutline`, `textOutline`.
- Modify `frontend/app/lib/scene3d/engine.ts` — `geometryFor` `'text'`/`'shape'` cases; `geoKey` includes `content`; async font re-sync (mirror the GLB token/re-sync path).
- Modify `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` — `+ Primitive` menu group; Geometry panel text/font/shape-preset controls above the schema sliders; inline font error.
- Tests append to `frontend/tests/unit/scene3d-config.unit.spec.ts`, a new `frontend/tests/unit/scene3d-outlines.unit.spec.ts`, and `frontend/tests/unit/scene3d-engine.unit.spec.ts`.

---

## Task 1: config model — `'text'`/`'shape'` kinds + `content`

**Files:** `config.ts`; test `scene3d-config.unit.spec.ts`.

**Interfaces produced:** `PRIMITIVE_KINDS` includes `'text'`,`'shape'` (appended last). `export interface PrimitiveContent { text?: string; font?: string; shape?: string }`. `PrimitiveObject.content?: PrimitiveContent`. `createPrimitive('text', existing)` seeds `content = { text: 'Text', font: AVAILABLE_FONTS[0].url }` (import from `outlines.ts` — if that creates a cycle, seed the font url as a literal constant duplicated in config with a comment, or seed `font` undefined and let the engine fall back to the first font). `createPrimitive('shape', existing)` seeds `content = { shape: 'hexagon' }` (or the first shape preset).

- [ ] **Step 1 (RED):** append to `scene3d-config.unit.spec.ts`: (a) `createPrimitive('text', [])` and `createPrimitive('shape', [])` produce `kind:'primitive'`, `primitive:'text'|'shape'`, and a `content` object; (b) a text object with `content:{text:'Hi',font:'/fonts/x.otf'}` round-trips through `parseDoc(serializeDoc(doc))`; (c) malformed content (`content:{text:5, font:{}}`) drops the bad fields and leaves `content` absent when it ends empty; (d) `PRIMITIVE_KINDS` contains `'text'` and `'shape'`. Run: `npx vitest run tests/unit/scene3d-config.unit.spec.ts` → FAIL.
- [ ] **Step 2 (impl):** In `config.ts`: append `'text','shape'` to the `PrimitiveKind` union and `PRIMITIVE_KINDS` array. Add `PrimitiveContent` interface + `content?: PrimitiveContent` on `PrimitiveObject`. Add a `parseContent(raw): PrimitiveContent | undefined` helper (string-only fields; return `undefined` when the result is empty) and thread it into the primitive branch of `parseDoc` (`...(pc ? { content: pc } : {})`, computed once). Extend `createPrimitive` with a `content` seed for `text`/`shape` (switch on kind).
- [ ] **Step 3 (GREEN):** `npx vitest run tests/unit/scene3d-config.unit.spec.ts` green; `npx vue-tsc --noEmit | grep -iE 'scene3d'` empty. Commit `git add frontend/app/lib/scene3d/config.ts frontend/tests/unit/scene3d-config.unit.spec.ts`.

---

## Task 2: param schemas for `text`/`shape`

**Files:** `primParams.ts`; the `PRIMITIVE_PARAMS` map is `Record<PrimitiveKind, ParamSpec[]>` (each spec: `{key,label,hint,min,max,step,default,control?,options?}`).

**Exact params (from the spec):**
- `text`: `size` 0.1–2 step 0.05 (0.5) · `depth` 0–1 step 0.01 (0.2) · `bevel` 0–0.1 step 0.005 (0.01) · `bevelSegments` 1–5 step 1 (2) · `letterSpacing` −0.1–0.5 step 0.01 (0) · `curveSegments` 2–12 step 1 (6).
- `shape`: `depth` 0–1 step 0.01 (0.2) · `bevel` 0–0.1 step 0.005 (0.01) · `bevelSegments` 1–5 step 1 (2) · `sides` 3–24 step 1 (6) · `roundness` 0–1 step 0.01 (0.3).

- [ ] **Step 1:** Add `text:` and `shape:` entries to `PRIMITIVE_PARAMS` with the specs above (mirror the existing entry style + `hint` copy). `sanitizeParams`/`paramValue` already generalize over the schema — no other change.
- [ ] **Step 2:** Typecheck: adding the two keys satisfies the `Record<PrimitiveKind, …>` exhaustiveness (which now requires them). `npx vue-tsc --noEmit | grep -iE 'primParams|scene3d'` empty. Commit `git add frontend/app/lib/scene3d/primParams.ts`.

---

## Task 3: `outlines.ts` — font loader + text/shape outlines

**Files:** create `frontend/app/lib/scene3d/outlines.ts`; test create `scene3d-outlines.unit.spec.ts`.

**Interfaces produced:**
```ts
export const AVAILABLE_FONTS: { label: string; url: string }[]   // from public/fonts .otf list
export function loadFont(url: string): Promise<opentype.Font>    // cached; failures NOT cached; token-guarded (glb.ts pattern)
export function shapeOutline(sides: number, roundness: number): THREE.Shape[]
export function textOutline(text: string, font: opentype.Font, opts: { size: number; letterSpacing: number }): THREE.Shape[]
```

- `loadFont`: mirror `frontend/app/lib/scene3d/glb.ts` — a module `Map<string, Promise<opentype.Font>>` cache keyed by url; on reject, delete the cache entry so a retry re-fetches (don't cache failures). Load via `opentype.load(url)` (or `fetch`→`opentype.parse(arrayBuffer)` — match how the template renderer already uses opentype).
- `textOutline`: walk each glyph's `font.getPath(char, x, 0, size).commands` (`M`/`L`/`C`/`Q`/`Z`) into `THREE.Shape`/`THREE.Path`; closed outer contours become shapes, inner contours (counters in `o`,`a`,`e`) become **holes**, chosen by **winding direction** (signed area sign). Advance the pen by `font.getAdvanceWidth(char, size) + letterSpacing*size`. Scale by `size / font.unitsPerEm` (opentype `getPath(..., size)` already applies the scale — verify and don't double-scale). Center on the combined bounding box.
- `shapeOutline`: convert `gemPoints({ sides, roundness, … })` (from `frontend/app/lib/shapefx/points.ts`) into one closed `THREE.Shape`.

- [ ] **Step 1 (RED):** create `scene3d-outlines.unit.spec.ts` (per spec's tests): `shapeOutline(6, r)` returns a closed shape whose point count tracks `sides`; `textOutline` against a REAL `.otf` from `public/fonts` (load it in the test via `opentype.loadSync`/`parse` from the file) produces the expected shape count for a known string, puts exactly one hole in `'o'`, makes `'AB'` wider than `'A'` (advance), and honors `letterSpacing`; `loadFont` returns the SAME object for the same url and does NOT cache a failed load. Run → FAIL (module missing).
- [ ] **Step 2 (impl):** write `outlines.ts`. Handle empty text → `[]`; degenerate/zero-area outline → an empty shape (mesh handles it).
- [ ] **Step 3 (GREEN):** vitest green; typecheck clean. Commit `git add frontend/app/lib/scene3d/outlines.ts frontend/tests/unit/scene3d-outlines.unit.spec.ts`.

---

## Task 4: engine — `geometryFor` cases + async font re-sync

**Files:** `engine.ts`; test `scene3d-engine.unit.spec.ts`.

- [ ] **Step 1 (RED):** append engine tests: `geometryFor('text', params)` with a **resolved** font (passed in / a test seam) returns a non-empty `BufferGeometry` whose bounding-box depth ≈ the `depth` param; **without** a resolved font returns the small placeholder box; the object's `geoKey` (source key in `syncObject`) **changes** when `content.text` or `content.font` changes and **not** when an unrelated param changes. (Add a pure helper `geoKeyFor(obj)` if `geoKey` is currently inline, so it's unit-testable — small refactor.)
- [ ] **Step 2 (impl):** `geometryFor` gains `'text'`/`'shape'` cases, both ending in `new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: bevel>0, bevelThickness: bevel, bevelSize: bevel, bevelSegments, curveSegments })` then centered (translate by −boundingBox center). For text, the resolved font must be available — since `geometryFor` is sync, thread the resolved font through: `syncObject` looks up the cached font for `obj.content.font` (via a sync cache getter on `outlines.ts`, e.g. `cachedFont(url): opentype.Font | null`); if null, build the placeholder AND kick off `loadFont(url).then(() => re-sync this object)` guarded by a per-object token (mirror `glbTokens` — the exact "placeholder until load, re-sync on completion, drop stale loads" branch already in `syncObject` for GLB). Add the `content` bag to the `geoKey`/`sourceKey` string so text/font edits rebuild.
- [ ] **Step 3 (GREEN):** vitest green; typecheck clean. Commit `git add frontend/app/lib/scene3d/engine.ts frontend/tests/unit/scene3d-engine.unit.spec.ts`.

---

## Task 5: `PRIM_GROUPS` menu group + Geometry-panel controls

**Files:** `primGroups.ts`; `Scene3DStudioSurface.vue`.

- [ ] **Step 1:** `primGroups.ts` — add a group `{ label: 'Text & Shape', kinds: [{ kind:'text', label:'Text', icon:… }, { kind:'shape', label:'Shape', icon:… }] }` (match the existing group shape + pick lucide icons, e.g. `Type`, `Hexagon`). Keep canonical order so the drift test passes; update the drift test if it enumerates groups.
- [ ] **Step 2:** `Scene3DStudioSurface.vue` Geometry panel (`<StudioSection title="Geometry">`, the `geoSpecs`-driven sliders): ABOVE the generated sliders, add — when `selected.primitive === 'text'`: a text `<input>` bound to `selected.content.text` (with the micro-label styling) and a font `<StudioSelect :options="AVAILABLE_FONTS.map(f=>f.url)">` (or label/value adapted to StudioSelect's `string[]` contract — show labels, bind url) for `selected.content.font`; when `'shape'`: a preset `<StudioSelect>` for `selected.content.shape`. Import `AVAILABLE_FONTS` from `outlines.ts`. Add an inline font-error line following the GLB error convention already in this surface (a ref set when `loadFont` rejects). Mutations go straight to the reactive `doc` (the deep `watch(doc)` re-syncs the engine → mesh rebuilds).
- [ ] **Step 3:** typecheck `npx vue-tsc --noEmit | grep -iE 'Scene3DStudioSurface|primGroups'` empty; the drift/config/outlines/engine vitest suites stay green. Commit `git add frontend/app/lib/scene3d/primGroups.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`.

---

## Task 6: full-suite + browser E2E

- [ ] `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-outlines.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts` all green; `npx vue-tsc --noEmit | grep -iE 'scene3d'` empty.
- [ ] Browser (dev server :3000, ComfyUI :8188 not required for editing): + Primitive → **Text**; type into the text field → the mesh rebuilds; switch fonts; adjust size/depth/bevel/letterSpacing. + Primitive → **Shape**; adjust sides/roundness/depth. Confirm on both: all 7 materials (incl. a multi-stop gradient), a modifier (twist a text object), and the cloner. Save/reopen preserves content. Export bake matches. Undo (⌘Z) reverts a text edit.

---

## Notes for the implementer

- The hardest task is **3 (`textOutline`)** — opentype `getPath().commands` → `THREE.Shape` with correct **holes** (inner contours) via **winding**: accumulate contours, compute each contour's signed area; the outer (largest / opposite winding to holes) becomes the `Shape`, inner ones become `.holes.push(new THREE.Path(pts))`. Test against a glyph with a counter (`'o'` = 1 hole, `'B'` = 2) to pin it.
- Reuse patterns verbatim: `glb.ts` (loader cache + token guard + re-sync) for `loadFont` + the `syncObject` async branch; `PRIMITIVE_PARAMS` schema for params; `gemPoints` for shape.
- `createPrimitive`'s font seed: if importing `AVAILABLE_FONTS` into `config.ts` risks a cycle, seed `content.font` from a small `DEFAULT_FONT_URL` constant (kept in sync with `outlines.ts`) or leave it undefined and have `geometryFor`/the UI fall back to `AVAILABLE_FONTS[0]`.

## Status

Spec approved (`2026-07-18-3d-studio-extrude-text-design.md`); this converts it into TDD tasks. **Not yet executed** — authored while the platform classifier was blocking command-execution + subagent dispatch, so no tasks have run. Execute subagent-driven once that clears (or inline, gating each task on the vitest + vue-tsc commands above).
