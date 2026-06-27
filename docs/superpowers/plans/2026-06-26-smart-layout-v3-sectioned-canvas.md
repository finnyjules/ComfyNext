# Smart Layout v3 — Sectioned Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a format-aware *sectioned* layout model on a *baseline-derived fine grid* to Smart Layout, evolving the v2 engine (resolver / satori render / multi-format overrides all reused) without breaking any v2 template or test.

**Architecture:** Introduce `TemplateV3` as a superset of `TemplateV2` adding `version: 3` and `sections`. v3 uses a baseline-derived fine grid (unit ≈ `grid.baseline`). A `SectionV3` is a named box with its own region (+ `regionByClass`/`overrides`) and `children: ElementV2[]`. The resolver composes each child's master-grid rect proportionally into its section's resolved box, so adapting a format = repositioning section boxes while children ride along. Ungrouped elements keep the exact v2 path. All grid/section math is pure and unit-tested; the existing satori render route renders v3 once the resolver and font/token collection are section-aware.

**Tech Stack:** TypeScript, Vitest (`npm run test:unit`, files `tests/unit/**/*.unit.spec.ts`, node env, `~~` → frontend root), Nuxt 4 / Vue 3, satori + resvg server render.

## Global Constraints

- Work on `main`, commit directly, no feature branches.
- No purple/violet accents in any UI (neutral white-opacity + type-color + emerald-for-run).
- v2 templates and all existing `template-grid-*` unit tests MUST stay green — v3 is additive and version-gated.
- Pure functions live in `frontend/shared/template-grid/`; one definition of grid→pixel math.
- TDD: failing test → minimal impl → green → commit, every task.

---

### Task 1: v3 schema types

**Files:**
- Modify: `frontend/shared/template-grid/types.ts`
- Test: `frontend/tests/unit/template-grid-v3-types.unit.spec.ts`

**Interfaces:**
- Produces:
  - `interface SectionV3 { id: string; name: string; region: Region; regionByClass?: Partial<Record<FormatClass, Region>>; overrides?: Record<string, { region?: Region; hidden?: boolean }>; children: ElementV2[] }`
  - `interface TemplateV3 extends Omit<TemplateV2, 'version'> { version: 3; sections: SectionV3[] }`
  - `type AnyGridTemplate = TemplateV2 | TemplateV3`
  - `function isV3(t: AnyGridTemplate): t is TemplateV3`

- [ ] **Step 1: Write failing test** — `isV3` narrows on `version`; a `TemplateV3` literal type-checks with a section holding a child element.
- [ ] **Step 2: Run** `npm run test:unit -- template-grid-v3-types` → FAIL (isV3 not exported).
- [ ] **Step 3: Implement** the three types + `isV3` in `types.ts`.
- [ ] **Step 4: Run** test → PASS, and `npm run test:unit -- template-grid` (all grid tests still green).
- [ ] **Step 5: Commit** `feat(smart-layout): v3 schema types (sections + fine-grid superset)`.

---

### Task 2: baseline-derived fine grid dimensions

**Files:**
- Modify: `frontend/shared/template-grid/grid.ts`
- Test: `frontend/tests/unit/template-grid-fine-dims.unit.spec.ts`

**Interfaces:**
- Produces: `function fineGridDims(template: AnyGridTemplate, f: FormatSpec): { cols: number; rows: number }` — for v3, cols/rows derived so one fine unit ≈ `grid.baseline` px in master space; for v2 returns `formatDims(f)` unchanged.
- `gridMetrics` / `formatDims` callers broaden their template param to `AnyGridTemplate`.

**Design:** fine unit target = `template.grid.baseline` (master px). `cols = clamp(round((f.w - 2*margin) / baseline), >=1)`, `rows = clamp(round((f.h - 2*margin) / baseline), >=1)`, using *unscaled* master margin so master and other formats stay proportional through `remapRegion`. v2 path unchanged → existing geometry tests green.

- [ ] **Step 1: Write failing test** — for a v3 template with `baseline: 12`, master `1080×1080`, `margin: 72`: `fineGridDims` returns ~`(1080-144)/12 ≈ 78` cols/rows; a v2 template returns class dims (square → 6×6).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `fineGridDims`; make `gridMetrics`/`formatDims` call it only when `isV3`. Keep `CLASS_DEFAULTS` path for v2.
- [ ] **Step 4: Run** new test + `template-grid-geometry` + `template-grid-resolve` → all PASS.
- [ ] **Step 5: Commit** `feat(smart-layout): baseline-derived fine grid for v3`.

---

### Task 3: resolver — section composition (proportional children)

**Files:**
- Modify: `frontend/shared/template-grid/resolve.ts`
- Test: `frontend/tests/unit/template-grid-sections.unit.spec.ts`

**Interfaces:**
- `resolveFormat(template: AnyGridTemplate, ...)` — unchanged signature, broadened type. For v3, after resolving ungrouped `template.elements` (existing path), also resolve each section: resolve `sectionRegion` for the target output (`overrides[oid].region ?? regionByClass[cls] ?? remapRegion(section.region, masterFineDims, targetFineDims)`), compute `sectionRect = regionToRect(sectionRegion, m)` and `sectionMasterRect = regionToRect(section.region, masterMetrics)`; for each child compute `childMasterRect = regionToRect(child.region, masterMetrics)`, normalize against `sectionMasterRect`, re-project into `sectionRect`, then run the SHARED fit/cull pass on that rect. Section `hidden`/per-output `hidden` culls all its children. Children keep template order within the section; sections render after ungrouped elements (or interleaved by a future z model — for v1, ungrouped first then sections in array order).

**Design:** Extract the existing per-element tail (the big `.map` body: text fit / mark / cull given a `rect`+`region`) into `fitResolvedElement(el, region, rect, template, formatKey, format, m, props, brand)` returning `ResolvedElement`. v2 path calls it with `regionToRect(region,m)`; section children call it with the proportional rect. This keeps v2 output identical (pure relocation).

- [ ] **Step 1: Write failing test** — v3 fixture: one section `{col:1,colSpan:40,row:1,rowSpan:40}` (fine units) with a headline child; resolving `1x1` places the child inside the section rect; resolving `9x16` with a section `regionByClass.portrait`/override moves the child proportionally; a `hidden` section culls its child.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Refactor** the map tail into `fitResolvedElement`; add the v3 section pass. Guard all v3 logic behind `isV3`.
- [ ] **Step 4: Run** `template-grid-sections` + full `template-grid-resolve` (v2 regression) → all PASS.
- [ ] **Step 5: Commit** `feat(smart-layout): resolve v3 sections with proportional children`.

---

### Task 4: v2→v3 conversion + v3 starter

**Files:**
- Modify: `frontend/shared/template-grid/convert.ts` (add v3 helpers) and/or `starter.ts`
- Test: `frontend/tests/unit/template-grid-v3-convert.unit.spec.ts`

**Interfaces:**
- Produces:
  - `function toV3(t: TemplateV2): TemplateV3` — wraps each top-level element as ungrouped (empty `sections`, elements stay in `elements`), bumps `version` to 3. Lossless; re-resolving a converted template across formats matches the v2 result within rounding (sanity, not exact).
  - `function groupIntoSection(t: TemplateV3, elementIds: string[], name: string): TemplateV3` — moves named elements out of `elements` into a new section whose `region` is the bounding box (in fine units) of the members' master regions; children regions left as-is (master grid).
  - `function ungroupSection(t: TemplateV3, sectionId: string): TemplateV3` — inverse: children back to `elements`.

- [ ] **Step 1: Write failing test** — `toV3` preserves element count + ids; `groupIntoSection` removes members from `elements`, adds a section whose region bounds them; `ungroupSection` restores; both are pure (input unmutated).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the three helpers (pure, no mutation).
- [ ] **Step 4: Run** test → PASS.
- [ ] **Step 5: Commit** `feat(smart-layout): v2→v3 convert + group/ungroup section helpers`.

---

### Task 5: fine-grid editor math

**Files:**
- Modify: `frontend/shared/template-grid/editor.ts`
- Test: `frontend/tests/unit/template-grid-fine-editor.unit.spec.ts`

**Interfaces:** existing `pointToCell`/`dragRegion`/`resizeRegion` already snap to whole cells; with a fine-grid `GridMetrics` (many cols/rows) they snap to fine units automatically — no signature change. Add `sectionBoundsOf(section, masterMetrics): Rect` helper for the editor to draw the section box. Verify drag/resize on a fine metrics object lands on fine units (e.g. a 1-unit drag moves 1 fine cell, not a coarse cell).

- [ ] **Step 1: Write failing test** — build fine `GridMetrics` (e.g. 78×78); `dragRegion` by `cellW+gutter` px moves exactly 1 fine unit; `sectionBoundsOf` returns the section's pixel rect.
- [ ] **Step 2: Run** → FAIL (sectionBoundsOf missing).
- [ ] **Step 3: Implement** `sectionBoundsOf`; confirm drag/resize need no change.
- [ ] **Step 4: Run** new + `template-grid-editor-math` (v2) → PASS.
- [ ] **Step 5: Commit** `feat(smart-layout): fine-grid section bounds helper`.

---

### Task 6: render route + translate section-awareness

**Files:**
- Modify: `frontend/server/templates/schema.ts` (accept `AnyGridTemplate`), `frontend/shared/template-grid/translate.ts` (font/element walk), `frontend/server/api/render-template.post.ts` (token/font collection over section children).
- Test: `frontend/tests/unit/template-grid-translate.unit.spec.ts` (extend)

**Interfaces:** Add `function allElements(t: AnyGridTemplate): ElementV2[]` (ungrouped + every section child) in `types.ts` or `convert.ts`; use it wherever code currently iterates `template.elements` for fonts/tokens. `templateToSatori` already consumes `resolveFormat` output (resolved elements include children after Task 3), so geometry needs no change — only the font/token pre-walk must include children.

- [ ] **Step 1: Write failing test** — a v3 template with a section child whose text uses `{{ brand.fontBody }}` → font collection includes that family; translate produces a node for the child.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `allElements`; swap the font/token walks to it; broaden render types.
- [ ] **Step 4: Run** `template-grid-translate` + full suite → PASS.
- [ ] **Step 5: Commit** `feat(smart-layout): render v3 sections (font/token walk over children)`.

---

### Task 7: visual verification — render a v3 demo across formats

**Files:**
- Create: `frontend/tests/unit/template-grid-v3-demo.unit.spec.ts` (builds + resolves a demo) and a throwaway script under scratchpad to POST to the running render route for a PNG.

- [ ] **Step 1:** Build a v3 demo template (background + a "headline lockup" section with headline+subhead child, a logo section) and assert via resolver that children land inside their sections at `1x1`, `9x16`, `16x9`.
- [ ] **Step 2:** Start the Nuxt dev server (preview tools); POST the demo to `/api/render-template` for `1x1` and `9x16`; capture screenshots of both PNGs.
- [ ] **Step 3:** Eyeball: sections hold together, children adapt across formats. Save screenshots to scratchpad and report.
- [ ] **Step 4: Commit** `test(smart-layout): v3 sectioned render demo + cross-format proof`.

---

### Task 8 (stretch): editor renders + edits v3

**Files:** `frontend/app/components/templates/GridEditorCanvas.vue`, `GridEditorShell.vue`, `GridPropertyPanel.vue`, `useGridEditor` composable.

**Scope (guarded, additive — v2 editing must keep working):**
- Detect v3 templates; draw the fine-grid overlay + section boxes (using `sectionBoundsOf`).
- "Group into section" action on a multi-selection → `groupIntoSection`; "Ungroup" → `ungroupSection`.
- Move/resize a section box (reuse `dragRegion`/`resizeRegion` against section region); children re-resolve proportionally via the resolver (no separate child drag in this slice).
- Per-format: switching output and nudging a section writes `section.overrides[oid].region` / `regionByClass`.

- [ ] Detail each sub-step against the real component code at execution (read components first), TDD where logic is extractable into the composable; verify in-app with screenshots (place → group → resize → switch format → adapt). Commit per coherent sub-step.

---

## Self-Review

- **Spec coverage:** fine grid (T2), sections (T1/T3), section-level format adaptation (T3 overrides/regionByClass), proportional children (T3), v2 back-compat (T1 gating + T3 regression + T4 toV3), render (T6), visual sign-off (T7), editor (T8). Deliberately-later items (auto-layout, remix, assists, extreme formats) excluded. ✓
- **Placeholder scan:** engine tasks (1–7) carry concrete interfaces + designs; T8 is explicitly flagged as detail-at-execution against component code (stretch). 
- **Type consistency:** `AnyGridTemplate`, `isV3`, `SectionV3`, `fineGridDims`, `fitResolvedElement`, `allElements`, `toV3`/`groupIntoSection`/`ungroupSection`, `sectionBoundsOf` used consistently across tasks.

## Execution note

Tasks 1–7 are headless and safe (v2 path untouched), and give a visually-verifiable result via the render route. Task 8 (editor UI) is the stretch; it is additive and must not regress v2 editing. If T8 can't be completed cleanly in one sitting, leave the engine (T1–7) committed and green and document where T8 stopped.
