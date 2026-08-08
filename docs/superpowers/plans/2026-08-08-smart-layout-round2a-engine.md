# Smart Layout Round 2a — Engine Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the surface axis with a brand-stamped theme model, make tiers multi-item, add overlap/overhang + text orientation + opt-in photo treatment, and make the type hierarchy dramatic — keeping the existing six stagings functional throughout.

**Architecture:** All engine changes stay inside the pure engine (`frontend/shared/template-grid/generate/` + the shared grid/text/resolve modules) emitting standard `TemplateV3`; editor changes ride the existing composable/panels. Ink is resolved by luminance, themes stamp `template.brand` (lowest merge layer), and the validator flips from forbidding drama to rejecting only *undeclared* geometry.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, Vitest, Playwright, Satori (render).

**Spec:** `docs/superpowers/specs/2026-08-08-smart-layout-round2-themes-tension-design.md` (incl. pinned override semantics + craft constants). Plan 2b (staging library v2) is written AFTER this plan lands.

## Global Constraints

- `shared/` never imports from `app/` or `~/`. No `Math.random()` — seeded RNG only.
- All schema changes optional/additive; legacy layouts and round-1 generated layouts must load (choke-point migrations, no data rewrites).
- Theme palette (verbatim): black `#000000`, white `#ffffff`, paper `#f2f0ef`, red `#dd2200`, orange `#fc461f`, green `#2e6f40`, blue `#1d4ed8`. Ink candidates: `#111111` (dark) / `#f2f0ef` (light).
- Surface→theme migration map (verbatim): `flat→paper`, `tint→red`, `holographic→paper`, `split-field→black`, `duotone-photo→black`.
- Craft constants (verbatim from spec): `heroScale` knob domain `{0.10, 0.14, 0.18}` × master height per line; hero `lineHeight` 0.92; hero `letterSpacing = −0.03 × fontSize` px; anchor ≈ `0.45 × hero` fontSize with `−0.02 × fontSize` tracking; fresh-generate grid margin = `round(0.03 × min(master w, h))`.
- Override semantics: Shuffle/Surprise never touch stamped brand values; only a theme change re-stamps. Tier `type` overrides always win and survive re-rolls.
- Existing six stagings stay registered and green after every task.
- Tests: `frontend/tests/unit/*.unit.spec.ts` (`npx vitest run <file>` from `frontend/`); aliases `~~`→`frontend/`, `~`→`frontend/app/`. E2E env: `PW_BASE_URL=http://127.0.0.1:3000` (never `localhost`).
- Commit per task directly to `main`; stage ONLY the task's files (parallel sessions share this tree — never `git add -A`).

## File Structure

**New:** `shared/template-grid/generate/themes.ts` (+ unit spec) · treatment support in `server/templates/inlineImages.ts` if the Satori gate fails.
**Deleted:** `shared/template-grid/generate/surfaces.ts` + `tests/unit/sl-gen-surfaces.unit.spec.ts` (Task 7).
**Modified:** `types.ts`, `generate/{tiers,stagings,generate,validate}.ts`, `grid.ts`, `text.ts`, `resolve.ts`, `server/templates/translate.ts`, `app/composables/useGridEditor.ts`, `app/components/templates/{LayoutControlsPanel,TierTypePanel,GridEditorCanvas,GridPropertyPanel}.vue`, `app/components/vue-canvas/SmartLayoutEditorModal.vue`, existing `sl-gen-*` unit specs, `tests/sl-generation.spec.ts`.

---

### Task 1: Themes module

**Files:**
- Create: `frontend/shared/template-grid/generate/themes.ts`
- Test: `frontend/tests/unit/sl-gen-themes.unit.spec.ts`

**Interfaces (Produces):**
```ts
export interface Theme { id: string; name: string; field: string; defaultAccent: string }
export const THEMES: Theme[]                    // the 7, ids: black|white|paper|red|orange|green|blue
export const THEME_PALETTE: string[]            // the 7 field hexes, in THEMES order
export function getTheme(id: string): Theme | undefined
export function relLuminance(hex: string): number          // 0..1, WCAG formula, tolerant of #rgb/#rrggbb
export function resolveInk(field: string): string          // relLuminance > 0.45 ? '#111111' : '#f2f0ef'
export function contrastRatio(a: string, b: string): number // WCAG (L1+0.05)/(L2+0.05)
export const SURFACE_TO_THEME: Record<string, string>       // the verbatim migration map
```
`defaultAccent`: black/white/paper → `#dd2200`; red/green/blue → `#f2f0ef`; orange → `#000000`.

- [ ] **Step 1 — failing test.** Assert: 7 themes registered with the exact ids+fields; `resolveInk('#f2f0ef') === '#111111'` and `resolveInk('#000000') === '#f2f0ef'` and `resolveInk('#dd2200') === '#f2f0ef'` (red is a dark field); `contrastRatio('#111111','#f2f0ef') > 12`; `relLuminance('#ffffff')` ≈ 1 and `('#000000')` = 0; `SURFACE_TO_THEME` equals the verbatim map. Run → FAIL (module not found).
- [ ] **Step 2 — implement** per the interfaces (WCAG relative luminance with sRGB linearization; pure module, zero imports).
- [ ] **Step 3 — green**, then commit: `feat(smart-layout): theme module (palette, luminance ink, migration map)` — stage only the two files.

---

### Task 2: Tiers become lists

**Files:**
- Modify: `frontend/shared/template-grid/types.ts`, `frontend/shared/template-grid/generate/tiers.ts`
- Test: `frontend/tests/unit/sl-gen-tiers.unit.spec.ts` (extend)

**Interfaces:**
- `types.ts`: `export type Tiers = Partial<Record<TierId, TierSpec | TierSpec[]>>` (stored form tolerates round-1 singles).
- `tiers.ts` Produces:
  - `normalizeTiers(t: Tiers | undefined): Partial<Record<TierId, TierSpec[]>>` — wraps singles, drops empties.
  - `tierEntries(tiers: Tiers): Array<{ id: TierId; items: TierSpec[] }>` — **signature change**; enabled, non-empty-content items, importance order; a tier with zero surviving items is omitted.
  - `autopopulateTiers(props): Partial<Record<TierId, TierSpec[]>>` — arrays now (`text_layer_N` → item 0 of tier N-1).
  - `appendTierItem(tiers: Tiers, id: TierId, item: TierSpec): Partial<Record<TierId, TierSpec[]>>` — normalize + push, returns new object.
  - `omitConsumedProps` unchanged behaviour (consumed = tier key present with ≥1 item).

- [ ] **Step 1 — failing tests.** normalize wraps a round-1 single into `[spec]`; `tierEntries` returns `items` arrays in importance order and skips `enabled:false`/empty items; `appendTierItem` appends (2 items, order preserved) without mutating input; `autopopulateTiers` produces arrays; `omitConsumedProps` still strips consumed keys given array tiers. Run → FAIL.
- [ ] **Step 2 — implement.** Update the two existing round-1 test blocks in the same file where the old single-shape is asserted (they now construct/expect arrays) — same behaviour, new shape.
- [ ] **Step 3 — green** (whole file), commit: `feat(smart-layout): multi-item tiers (normalize/append/entries)`.

---

### Task 3: Stagings consume lists + dramatic type

**Files:**
- Modify: `frontend/shared/template-grid/generate/stagings.ts`
- Test: `frontend/tests/unit/sl-gen-stagings.unit.spec.ts` (extend + adjust)

**Interfaces:**
- `StagingInput` gains `canvas: { w: number; h: number }` (master px; callers pass the master format dims).
- `tierText` becomes `tierText(id: TierId, index: number, item: TierSpec, region, priority, opts)` producing element id `tier_${id}_${index}`, `role: id.toUpperCase()`.
- Every staging: `knobs` gains `{ id: 'heroScale', pick: [0.10, 0.14, 0.18] }`.
- Hero placement sets `style.fontSize = Math.round(heroScale * canvas.h)`, `lineHeight: 0.92`, `letterSpacing: -Math.round(0.03 * fontSize)`; anchor sets `fontSize = Math.round(0.45 * heroFontSize)`, `letterSpacing: -Math.round(0.02 * fontSize)`. (`style.fontSize` is the master-px override that `typeSize` reflows per format — the ladder still governs support/fineprint.)
- **Distribution:** hero/anchor use item 0 (capacity 1). Support items stack vertically inside the staging's support slot (item *i* at `row + i * rowSpan`, clamped). Fineprint items distribute across the staging's fineprint positions (tower/centered: alternate left/right corners by index; others: stack like support). Nothing dropped: overflow items continue stacking downward.

- [ ] **Step 1 — failing tests.** With `TIERS` where support has 2 items and fineprint has 2: every staging emits `tier_support_0` **and** `tier_support_1` (distinct regions) and both fineprint items; hero element has `style.fontSize === Math.round(0.10|0.14|0.18 × canvas.h)` for the knob rolled (assert membership), `lineHeight === 0.92`, negative `letterSpacing`; anchor fontSize ≈ 0.45×hero (±1px). Update the existing fixture/`input()` helper for the new shapes (`tiers` arrays, `canvas: { w: 1080, h: 1440 }`) and the existing id expectations (`tier_hero` → `tier_hero_0`). Run → FAIL.
- [ ] **Step 2 — implement** across all six stagings (mechanical: `has(id)` → `items(id).length > 0`; each `tierText` call site gains index+item; distribution helpers shared at top of file).
- [ ] **Step 3 — green** (17 existing + new must all pass; the no-undeclared-overlap test must still hold with 2+2 items — adjust slot spacing if any staging collides), commit: `feat(smart-layout): stagings take tier lists; dramatic hero scale + tight setting`.

---

### Task 4: Staging overlaps declaration + z-order

**Files:**
- Modify: `frontend/shared/template-grid/generate/stagings.ts`, `frontend/shared/template-grid/generate/validate.ts`, `frontend/shared/template-grid/generate/generate.ts`
- Test: `frontend/tests/unit/sl-gen-stagings.unit.spec.ts`, `frontend/tests/unit/sl-gen-validate.unit.spec.ts` (extend)

**Interfaces:**
- `export interface StagingResult { elements: ElementV2[]; overlaps?: Array<[string, string]> }`; `Staging.compose(input): StagingResult`. Elements are ordered **back→front**.
- `validateGenerated(result: StagingResult, cols, rows): { ok, reasons }` — collision check runs pairwise over elements **excluding declared pairs** (unordered match). Off-grid check unchanged (Task 5 relaxes it).
- `generate()` consumes `StagingResult`: writes `template.order = [...stagedIds(back→front), ...preservedIds]`.

- [ ] **Step 1 — failing tests.** A synthetic staging result with two overlapping elements: `ok:false` undeclared, `ok:true` when the pair is declared (both orderings). `generate()` output has `template.order` beginning with the staged ids in compose order. All six stagings still compose with `overlaps` absent-or-empty and validate clean. Run → FAIL (compose returns arrays).
- [ ] **Step 2 — implement**: wrap each staging's return in `{ elements }`; thread `StagingResult` through generate's re-roll loop and validator.
- [ ] **Step 3 — green** across `sl-gen-stagings`, `sl-gen-validate`, `sl-gen-generate`, commit: `feat(smart-layout): declared overlaps + staged z-order`.

---

### Task 5: Overhang (off-canvas regions)

**Files:**
- Modify: `frontend/shared/template-grid/types.ts` (`ElementV2Base.overhang?: boolean`), `frontend/shared/template-grid/grid.ts`, `frontend/shared/template-grid/resolve.ts`, `frontend/shared/template-grid/generate/validate.ts`
- Test: `frontend/tests/unit/sl-gen-validate.unit.spec.ts` + a new `frontend/tests/unit/sl-overhang-rect.unit.spec.ts`

**Interfaces:**
- `grid.ts`: `export function regionToRectRaw(region: Region, m: GridMetrics): Rect` — same arithmetic as `regionToRect` lines 178–181 but **no clamping** (accepts col ≤ 0, spans past the grid; rounds only).
- `resolve.ts`: the per-element rect uses `el.overhang ? regionToRectRaw(...) : regionToRect(...)`; culling must NOT cull an overhang element for being partially outside (only `too-small` when its on-canvas intersection is tiny — keep the existing `MIN_MARK` check against the intersection).
- `validate.ts`: off-grid is a reason only when `!el.overhang`.

- [ ] **Step 1 — failing tests.** `regionToRectRaw({col:-1,colSpan:6,row:1,rowSpan:2})` returns x < canvas origin (exact arithmetic asserted); resolver keeps an `overhang` element un-culled when 40% off-canvas and culls nothing differently when `overhang` unset (clamped as today); validator accepts off-grid WITH the flag, rejects WITHOUT (existing test still passes). Run → FAIL.
- [ ] **Step 2 — implement.** Editor + Satori clip already (both render inside the canvas box with overflow hidden — verify while implementing; if the editor artboard doesn't clip, add `overflow:hidden` to the artboard container only).
- [ ] **Step 3 — green** (plus full `sl-gen-*` sweep), commit: `feat(smart-layout): overhang regions — declared off-canvas, raw rect math`.

---

### Task 6: Text orientation

**Files:**
- Modify: `frontend/shared/template-grid/types.ts` (`TextStyleV2.orientation?: 'horizontal' | 'up' | 'down'`), `frontend/shared/template-grid/resolve.ts`, `frontend/server/templates/translate.ts`, `frontend/app/components/templates/GridEditorCanvas.vue`
- Test: `frontend/tests/unit/sl-orientation.unit.spec.ts`

**Interfaces:**
- Resolver: for a text element with vertical orientation, the fit pass runs against the **swapped rect** (`{w: rect.h, h: rect.w}`), and the resolved element carries `rotation: -90` (up) / `90` (down) — the SAME field expressive children already use, so `translate.ts:323`'s existing `transform: rotate(...)` renders it; extend that conditional to plain text elements if it is currently gated to expressive children only.
- Editor DOM: apply the equivalent CSS (`transform: rotate(...)` with `transformOrigin: 'center'`, box swapped) in the text element branch of `GridEditorCanvas.vue` — mirror however the expressive tilt is already rendered there.

- [ ] **Step 1 — failing test (resolver-level).** Resolve a template with a vertical-up text element in a tall region: resolved entry has `rotation === -90` and its fitted text used the swapped width (assert via the fitted font size differing from the horizontal control in the expected direction — vertical text in a tall narrow region fits LARGER than horizontal). Horizontal default unchanged (`rotation` undefined). Run → FAIL.
- [ ] **Step 2 — implement** resolver + both render surfaces (translate + editor DOM in the same task; cite the exact lines touched in the report).
- [ ] **Step 3 — green** + confirm the existing render-template E2E/goldens still pass if present, commit: `feat(smart-layout): text orientation (vertical up/down, parity both renderers)`.

---

### Task 7: Generate rewrite — themes in, surfaces out

**Files:**
- Modify: `frontend/shared/template-grid/generate/generate.ts`, `frontend/shared/template-grid/generate/stagings.ts` (ink binding), `frontend/shared/template-grid/types.ts` (`GenState`)
- Delete: `frontend/shared/template-grid/generate/surfaces.ts`, `frontend/tests/unit/sl-gen-surfaces.unit.spec.ts`
- Test: `frontend/tests/unit/sl-gen-generate.unit.spec.ts` (substantially extend)

**Interfaces:**
- `GenState`: `surface: string` → `theme: string`; gains `accentOnHero?: boolean`. Reading a stored `gen` with `surface` maps through `SURFACE_TO_THEME` (one migration point at the top of `generate()`/`shuffle()`/`surprise()` — a small `migrateGen(gen)` helper).
- `generate(template, opts)` where `opts: { staging, theme, seed, knobs?, brand?, accentOnHero? }`:
  1. **Stamp on change:** if `opts.theme !== template.gen?.theme` OR `template.brand` lacks any of `background/foreground/accent`, write `template.brand.background = theme.field`, `.foreground = resolveInk(theme.field)`, `.accent = theme.defaultAccent` (only those three keys; other brand fields untouched). Same-theme regeneration (Shuffle, knob/tier edits) never rewrites them.
  2. Staged text ink: default `color: '{{ brand.foreground }}'` injected post-compose (item's own `type.color` wins); hero (`tier_hero_0`) gets `'{{ brand.accent }}'` when `accentOnHero`.
  3. `background.fill = '{{ brand.background }}'` (token — kit swap re-skins the field; archetypes already prove the pattern).
  4. **Luminance guard:** with the *effective* merge (`mergeBrand(template.brand, opts.brand)` — import `effectiveBrand` from `~~/shared/brand/resolve` is app-free: it lives in `shared/`), if `contrastRatio(effectiveInk, effectiveField) < 3`, inject the literal `resolveInk(effectiveField)` as the staged text colour instead of the token.
  5. `shuffle` keeps `{staging, theme}`; `surprise` re-rolls both axes honouring locks (theme pool = all 7, no image gating).
- `applyContrast` is deleted.

- [ ] **Step 1 — failing tests.** (a) fresh generate with `theme:'paper'` → `template.brand.background === '#f2f0ef'`, `.foreground === '#111111'`, staged hero color token `'{{ brand.foreground }}'`, `background.fill === '{{ brand.background }}'`; (b) re-generate SAME theme after hand-editing `template.brand.background = '#ff00aa'` → the edit **survives**; switching theme → re-stamped; (c) legacy `gen: { staging:'tower', surface:'flat', … }` shuffles without error and lands on `theme:'paper'`; (d) `accentOnHero` puts `'{{ brand.accent }}'` on `tier_hero_0` only; (e) guard: opts.brand kit with `foreground:'#ffffff'` on theme `white` → staged text gets literal `'#111111'`; (f) tier `type.color` still beats everything; (g) determinism holds. Run → FAIL.
- [ ] **Step 2 — implement**; delete surfaces module + spec; update `sl-gen-editor-actions` expectations mechanically where they name `surface`.
- [ ] **Step 3 — full engine sweep green** (`sl-gen-*` + orientation + overhang specs), commit: `feat(smart-layout): theme generation — brand stamping, auto ink, accent, surface retirement`.

---

### Task 8: Composable — theme actions + append tiers

**Files:**
- Modify: `frontend/app/composables/useGridEditor.ts`
- Test: `frontend/tests/unit/sl-gen-editor-actions.unit.spec.ts` (extend)

**Interfaces (all returned from the composable; mutations via the existing `commit()` — history + dirty):**
- `genTheme: ComputedRef<string>` (replaces `genSurface`), `genAccentOnHero: ComputedRef<boolean>`
- `setTheme(id)` — regenerates with the new theme (stamps); `toggleAccentOnHero()`
- `setBrandOverride(key: 'background'|'foreground'|'accent', hex: string | null)` — writes `template.brand[key]` directly (null restores the current theme's stamped value) then regenerates same-tuple so the guard re-evaluates
- `addTierItem(id, content?)` — **appends** via `appendTierItem` and regenerates (same tuple); returns the new item index
- Remove `genSurface`, `setSurface`, `hasGenImage` (grep the two panels for the removed names in the same task — memory: shared symbols, two consumers).

- [ ] **Step 1 — failing tests.** `setTheme('red')` changes `gen.theme` + stamps; `addTierItem('support','A')` then `('support','B')` → both staged (`tier_support_0/1` present) — the round-1 "overwrite" behaviour is the named regression; `setBrandOverride('background','#ff00aa')` survives a `shuffleLayout()`; undo reverts a `setTheme`. Run → FAIL.
- [ ] **Step 2 — implement**, **Step 3 — green** + existing consumer specs, commit: `feat(smart-layout): theme + append-tier composable actions`.

---

### Task 9: Panels — theme controls, orientation control

**Files:**
- Modify: `frontend/app/components/templates/LayoutControlsPanel.vue`, `frontend/app/components/templates/TierTypePanel.vue`
- (UI task — typecheck gate + browser check ride Task 12's E2E.)

- [ ] **Step 1 — LayoutControlsPanel:** replace the Surface chip row with: **Theme** swatch chips (7, `THEME_PALETTE` colours, selected ring), **Ink** row (`Auto` chip + palette swatches → `setBrandOverride('foreground', …)`, Auto = null), **Accent** row (palette swatches + `accentOnHero` toggle labelled "Accent on headline"). Staging chips / Shuffle / Surprise / locks / seed unchanged (lock now labels the theme axis).
- [ ] **Step 2 — TierTypePanel:** tier-id derivation updated for indexed ids (`/^tier_([a-z]+)/`); add an **Orientation** segmented control (horizontal / up / down → `setTierType(id, { orientation })`). Note in a comment that per-item type editing writes the whole tier's item (index parsed alongside).
- [ ] **Step 3 — typecheck** both files clean (`npx vue-tsc --noEmit … | grep <name>`), commit: `feat(smart-layout): theme + orientation panel controls`.

---

### Task 10: Editor unclamp + auto-overhang

**Files:**
- Modify: `frontend/app/composables/useGridEditor.ts` (move/nudge paths only — duplicate/stagger/autopopulate keep their clamps)
- Test: `frontend/tests/unit/sl-gen-editor-actions.unit.spec.ts` (extend)

- [ ] **Step 1 — failing test.** Select an element at col 1; `nudgeSelected(-2, 0)` twice → region.col goes negative AND the element's `overhang` becomes `true`; nudging back fully inside clears it. Run → FAIL (clamped today at `useGridEditor.ts:580-586`).
- [ ] **Step 2 — implement:** remove the min/max clamps in the drag-move + nudge paths; after each move compute `inBounds` and set/clear `overhang`. Cap runaway: keep a generous sanity clamp at ±2× the grid span.
- [ ] **Step 3 — green**, commit: `feat(smart-layout): drag/nudge past the canvas sets overhang`.

---

### Task 11: Photo treatment (gated)

**Files:**
- Modify: `frontend/shared/template-grid/types.ts` (`ImageElementV2.style.treatment?: { kind: 'none'|'grayscale'|'duotone'|'grain'; intensity?: number }`), `frontend/server/templates/translate.ts`, `frontend/app/components/templates/GridEditorCanvas.vue`, `frontend/app/components/templates/GridPropertyPanel.vue` (image section), possibly `frontend/server/templates/inlineImages.ts`
- Test: `frontend/tests/unit/sl-treatment.unit.spec.ts` + a server-side gate probe

- [ ] **Step 1 — GATE:** render two tiny PNGs through the real `/api/render-template` path (or `templateToSatori`+resvg directly in a server-capable test), one with `filter: grayscale(1)` on an image element, one without; compare buffers. **Record the verdict in the task report.**
- [ ] **Step 2 — implement per verdict.** Supported → CSS filter strings in both renderers (`grayscale(intensity)`, duotone approximated as grayscale+sepia-toward-ink NOT acceptable — duotone in that case ships via the fallback path regardless; grain is an overlay element in the editor and a pre-processed pass on the server). Unsupported → apply treatment at image-inline time in `inlineImages.ts` (add `sharp` as a server dependency; grayscale/duotone(field→ink of current theme)/grain there), editor keeps CSS approximations live.
- [ ] **Step 3 — behaviour tests:** treatment defaults to none (absent); `shuffle`/`surprise` leave a set treatment untouched (unit on generate: image element with treatment survives re-roll byte-identical); property-panel writes round-trip.
- [ ] **Step 4 — green + typecheck**, commit: `feat(smart-layout): opt-in photo treatment (grayscale/duotone/grain)`.

---

### Task 12: E2E + migration sweep

**Files:**
- Modify: `frontend/tests/sl-generation.spec.ts`
- Test: full unit sweep + E2E

- [ ] **Step 1 — extend the E2E:** existing journeys (wired edge → editor opens staged → Surprise ×2 changes seed → no duplicate hero → reopen clean) updated for `tier_hero_0` ids and the Theme chips; add: click theme `red` → canvas field changes (assert computed background), add a second `+ List` item → two support elements on canvas; nudge-past-edge smoke if cheap.
- [ ] **Step 2 — run** against the dev server (`PW_BASE_URL=http://127.0.0.1:3000`), plus `npx vitest run tests/unit/sl-*.unit.spec.ts tests/unit/sl-gen-*.unit.spec.ts` — everything green; compare collected-file count before/after (memory: vitest counts lie under load).
- [ ] **Step 3 — commit**: `feat(smart-layout): round-2a E2E — themes, multi-tier, overhang`.

---

## Self-Review

**Spec coverage:** theme model+stamping+overrides+guard (T1, T7, T8, T9) · multi-item tiers+append (T2, T3, T8, T9, T12) · opt-in treatment (T11) · overlap/overhang + editor unclamp (T4, T5, T10) · orientation (T6, T9) · craft constants (T3, fresh-margins live in the modal path — **covered in T7's fresh-stamp? No** → added to T7 Step 2: the modal's fresh-generate path sets `grid.margin = round(0.03 × min(w,h))`; T7's files list includes the modal — *correction applied*: `SmartLayoutEditorModal.vue` added to T7's Modify list for the margin stamp + `migrateGen` call on open) · migrations named at choke points (T2 normalize, T7 migrateGen) · library v2 explicitly deferred to plan 2b.

**Placeholders:** none — every step names exact assertions or exact code contracts; the two "mirror the existing pattern" directives (T6 editor DOM, T8 commit()) point at named, already-proven seams.

**Type consistency:** `StagingResult` (T4) is what T7's generate consumes; `tierEntries → items` (T2) matches T3's consumption; `tier_<id>_<index>` ids used consistently in T3/T8/T9/T12; `setBrandOverride` naming consistent T8/T9.
