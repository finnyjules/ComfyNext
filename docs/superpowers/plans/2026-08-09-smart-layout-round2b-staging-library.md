# Smart Layout Round 2b — Staging Library v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild and grow the staging library (6 → 14 composers) across the four families surfaced by the backpocket.so 23-layout study — type-dominant, photo-as-block, photo-as-field, texture — exercising the round-2a vocabulary for real: declared overlaps, overhang crops, orientation, type voices, scrims.

**Architecture:** Everything stays inside the pure engine's composer idiom established in `frontend/shared/template-grid/generate/stagings.ts` (compose in `fineGridDims` space, `tierText` with filtered items, `clampRegion`/overhang, `StagingResult{elements, overlaps}`, back→front ordering). Two small engine deltas (staging image support + text opacity) land first; then one task per family; then panel/migration/E2E.

**Tech Stack:** TypeScript, Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-08-smart-layout-round2-themes-tension-design.md` (Item 6 + craft constants). Reference taxonomy: the backpocket study recorded in this plan's Family Tables below.

## Global Constraints

- `shared/` never imports `app/`/`~/`; no `Math.random()`; determinism (same tuple → identical output).
- Compose-space = resolve-space: composers receive `cols/rows` from `fineGridDims` via `generate()` — never hardcode grid dims (the round-1 collapse bug).
- Craft constants (binding, from the spec): heroScale knob `{0.10, 0.14, 0.18}` × canvas.h; hero lineHeight 0.92; hero tracking `−0.03×fontSize`; anchor ≈ `0.45×hero`, tracking `−0.02×fontSize`; support+fineprint at `caption` level (3 distinct sizes max — `validateGenerated` enforces).
- Every staged element: `origin:'staging'`, id `tier_<tier>_<index>` (text) / `img_<slot>` (images) / `rule_<n>` (hairline shapes) / `wall_<n>`,`repeat_<n>` (texture copies).
- Declared overlaps only (`StagingResult.overlaps`); undeclared collisions still fail validation. Overhang only via `overhang: true`.
- Tier `type` overrides (per item) always win over a staging's voice defaults — voices set defaults via `tierText`'s `opts.style`, never via `spec.type`.
- User-facing photo rule: stagings PLACE photos but never set `treatment` (opt-in only).
- Serif voice family: `'Playfair Display'` (curated set, loads via existing font infra). Grotesk stays the default (inherits brand `fontDisplay`).
- Retired staging ids migrate at the same choke point as `SURFACE_TO_THEME` (a `STAGING_MIGRATIONS` map; never leave a stored `gen.staging` dangling).
- Tests in `frontend/tests/unit/`; run from `frontend/`; E2E `PW_BASE_URL=http://127.0.0.1:3000` (never localhost). Commit per task to `main`; stage ONLY the task's files.
- **Parallel-session hazard:** a user-started session (`task_f65037d4`) may be editing `centered`/`editorial` in `stagings.ts`. Before each task's commit, `git diff` the file against your edit base; if foreign hunks appeared, rebase your edit on top (stage only your hunks — never stash).

## The Family Tables (design source of truth — from the backpocket study)

Regions given as fractions of the grid (cols C, rows R); composers convert with `Math.round`. "Voice" = tier type defaults. All stagings get the `heroScale` knob; extra knobs listed. Capacity defaults: hero 1, anchor 1, support n, fineprint n (overflow stacks).

### Family A — Type-dominant (no photo required)

| id | Composition (back→front) | Voice / knobs / moves |
|---|---|---|
| `statement` | Hero owns the upper half: rows [0.06..0.55], full width, flush-left, **overhang left** (col −0.04C so the first glyph crops). Anchor bottom-left [0.80..0.92]×[0..0.6C]. Support col right [0.58..0.72]×[0.55C..C]. Fineprint bottom edge row. | knobs: `crop: ['left','none']` (overhang on/off), heroScale. The flagship "giant type" staging. |
| `manifesto` | Hairline `rule_0` full-width at row 0.10 (shape, 2px). Giant **anchor-as-hero**: the anchor (date) at display scale [0.14..0.44] flush-left. Hero smaller top-left corner [0.02..0.10] (inverted hierarchy — the date is the mass). Support right column. Fineprint under the rule. | knobs: `ruleWeight: [1,2,3]`. Voice: anchor gets heroScale sizing (the numeral-as-graphic move). |
| `index` | Fineprint as top rail row 0. Hero mid [0.28..0.55]. Support as a ruled TABLE: each support item gets its own row band [0.60 + i·0.06] with a hairline `rule_i` under it, two columns (item text left 0.5C, anchor-derived cell right). Anchor bottom. | knobs: `tableRows`. The Slakthus/backpocket-12 ruled-meta look. |
| `stacked` | One flush-left block: hero rows [0.08..0.40], anchor immediately under at 0.45×, air below; support bottom-left small; fineprint bottom-right. Generous whitespace, no tricks. | knobs: `align: ['left','right']`. |

### Family B — Photo-as-block (photo optional; degrade = drop the photo, keep type)

| id | Composition | Voice / knobs / moves |
|---|---|---|
| `tower` (rebuild) | Fineprint corners row 0. Hero rows [0.10..0.44]. **Photo block** [0.48..0.72] × [0.30C..0.70C] centered. Anchor slab [0.76..0.94] full width bottom-flush. Support left of photo. | knobs: align, heroScale. |
| `split` (rebuild) | Hard vertical split: photo RIGHT half full-height (`img_0` [0..R]×[0.5C..C], bleed). Left column: hero top, anchor mid at 0.45×, support low, fineprint bottom. | knobs: `side: ['left','right']` (mirror). Declared overlap: none — hard split. |
| `frame` (rebuild) | Photo center-right [0.10..0.60]×[0.45C..0.95C]. Hero top-left [0.04..0.30]×[0..0.55C] — colSpan may touch the photo; **declared overlap (hero, img_0)** with hero in front. Anchor bottom full-width. Fineprint top-right above photo. Support under hero. | knobs: heroScale. First use of declared text-over-photo-EDGE overlap. |
| `corner` (new) | Photo pinned top-right corner [0..0.42]×[0.55C..C] (bleed top+right). Hero bottom-left big [0.55..0.90], **overhang bottom** knob. Anchor mid-right under photo. Meta top-left. | knobs: `crop: ['bottom','none']`. The backpocket-14 look. |

### Family C — Photo-as-field (REQUIRES image: `supports.needsImage`; excluded from Surprise pool when none wired)

| id | Composition | Voice / knobs / moves |
|---|---|---|
| `cover` | `img_0` FULL BLEED [0..R]×[0..C] (bleed, back). Hero centered on the photo [0.36..0.60], centered align, **declared overlap (hero, img_0)**; hero gets a scrim knob (`panel` w/ theme field at low opacity) OR overprint (no scrim) — knob `scrim: ['none','panel']`. Anchor small centered below hero. Fineprint corners. | The overprint move (backpocket-6/10). |
| `lockup` | Full-bleed photo; a small centered title+date jewel: hero at REDUCED scale (0.5×heroScale) + anchor tight under it, both centered [0.42..0.58]; declared overlaps for both on img_0. | knobs: `scrim`. |
| `band_header` | Solid BAND: `band_0` shape rows [0..0.28] full width filled `{{ brand.background }}`… then hero+anchor+meta INSIDE the band (hero left, anchor right, fineprint under), photo fills [0.28..R] full-bleed below. Band is a shape element behind its text (declared overlaps with each band text). | knobs: `bandSize: [0.24, 0.28, 0.34]`, `scrim` (applies to the support text on the photo). |
| `band_footer` | Mirror: photo [0..0.66] full bleed; band [0.66..R]; hero left in band, anchor right, caption on the photo bottom-left above the band (declared overlap with img_0). | knobs: bandSize. |

### Family D — Texture (type repetition; no photo required, uses one if present)

| id | Composition | Voice / knobs / moves |
|---|---|---|
| `repeat` | Hero content repeated down the left edge: N=⌊R/step⌋ copies `repeat_i`, each a text element at rows [i·step..(i+1)·step]×[0..0.55C], flush-left, all at anchor scale, **ink at reduced opacity for all but one** (`opacity: 0.25`); copy `k` (knob `hot: [0,1,2]`) full opacity. Photo block right-mid **overlapping the column** — declared overlaps (repeat_i, img_0) with photo IN FRONT (text runs behind — backpocket-4). Anchor bottom. | knobs: `step`, `hot`. Requires text `opacity` (Task 1). |
| `wall` | Hero content as a DIM full-canvas wall: rows of repeated text `wall_i` filling the grid at support scale, `opacity: 0.18`, overhang left+right (edge-to-edge texture); the REAL hero bright centered [0.38..0.62] on top — declared overlaps (hero, wall_i). Fineprint corners. | knobs: `wallScale`. The backpocket-20 Type Wall. |

**Retired ids:** `editorial` → `stacked`, `centered` → `lockup` (when image wired) / `stacked` (no image) — resolved at migration time by image presence. `STAGING_MIGRATIONS: Record<string, string | {withImage: string; without: string}>`.

---

### Task 1: Engine deltas — staging image support + text opacity

**Files:**
- Modify: `frontend/shared/template-grid/generate/stagings.ts` (interface only), `frontend/shared/template-grid/generate/generate.ts`, `frontend/shared/template-grid/types.ts`, `frontend/server/templates/translate.ts`, `frontend/app/components/templates/GridEditorCanvas.vue`
- Test: `frontend/tests/unit/sl-gen-stagings.unit.spec.ts`, `frontend/tests/unit/sl-orientation.unit.spec.ts` (opacity render assertions live near the other parity tests — or a new `sl-staging-image.unit.spec.ts`)

**Interfaces (Produces):**
- `Staging.supports?: { needsImage?: boolean }`; `StagingInput.image?: string` (the CONTENT to place — the token `'{{ props.image_layer_1 }}'` when the socket is wired, else undefined).
- `generate()` opts gain `image?: string | undefined` presence (read how round-1 threaded `genCtx().image`; re-verify what survives at HEAD and re-thread from `sampleProps.image_layer_1` in the composable + `initialProps` in the modal). `surprise()` pool excludes `supports.needsImage` stagings when no image.
- `TextStyleV2.opacity?: number` (0..1, default 1) rendered by BOTH renderers (CSS `opacity` on the text node; satori supports `opacity`). Parity: one shared read (style pass-through), no helper needed, but test both surfaces' style output.
- A `tierImage(slot: string, content: string, region, priority, opts?)` helper in stagings.ts producing `{ id: 'img_'+slot, type:'image', origin:'staging', content, style:{fit:'cover'}, ... }` (+ `bleed` passthrough).

**Steps:** failing tests (image threading: generate with `image` → staging receives it; surprise pool excludes needsImage stagings without image and includes them with; opacity: resolved style carries it, translate emits `opacity`, editor style object emits it) → RED → implement → GREEN → engine sweep green → commit `feat(smart-layout): staging image support + text opacity`.

### Task 2: Family A — type-dominant (statement, manifesto, index, stacked)

**Files:** `stagings.ts` + `sl-gen-stagings.unit.spec.ts` (new `describe` per staging).

Implement the four composers per Family Table A in the established idiom (entries/has/items, drama, clampRegion or overhang). `index`'s rules are `type:'shape'` rects (2px tall regions) with ids `rule_<i>`. `manifesto` applies heroScale sizing to the ANCHOR (inverted mass) — hero stays a smaller styled text.

**Tests per staging (contract, write first):** every enabled tier's content present; regions in-grid except declared-overhang elements (assert `statement`'s hero HAS `overhang` when `crop:'left'` knob rolls, and its region.col < 1); rules present for `index` (one per support item); validator `ok:true` under default knobs for 1-item AND 2/2-item tier sets; determinism; distinctness from every other registered staging. Registry grows additively — existing 6 untouched this task.

Commit: `feat(smart-layout): type-dominant staging family (statement/manifesto/index/stacked)`.

### Task 3: Family B — photo-as-block (tower/split/frame rebuilds + corner)

**Files:** `stagings.ts` + spec.

Rebuild `tower`/`split`/`frame` per Table B (photo placement via `tierImage` when `input.image` present; WITHOUT an image each degrades: photo region redistributes to air — hero/support keep their positions, no reflow of text). Add `corner`. `frame` declares its (hero, img_0) overlap with hero LAST (front). `split`'s photo carries `bleed: true`.

**Tests:** photo element present iff `image` passed (id `img_0`, content = the token, `origin:'staging'`); degrade case validates clean with no image element; `frame`'s declared overlap listed AND validator ok; z-order: img before hero in `elements` (back→front); existing round-2a staging tests updated where geometry moved (single-item generous spans still asserted; adjust constants to the new tables). Determinism + distinctness.

Commit: `feat(smart-layout): photo-block staging family (tower/split/frame rebuilt + corner)`.

### Task 4: Family C — photo-as-field (cover, lockup, band_header, band_footer)

**Files:** `stagings.ts` + spec.

Per Table C. All four: `supports.needsImage: true`. `cover`/`lockup`: full-bleed `img_0` (`bleed: true`, region full grid), heroes DECLARE overlap on img_0, `scrim` knob maps to `style.panel = { fill: '{{ brand.background }}', opacity: 0.55 }` when `'panel'`. Bands: `band_0` is a shape filled `'{{ brand.background }}'`… band text declares overlap with band_0 (text in front). `lockup` hero at `0.5 × heroScale` sizing.

**Tests:** needsImage excluded from surprise pool without image (uses Task 1 machinery — assert via surprise loop determinism); full-bleed img region spans the full grid + `bleed`; scrim knob '`panel`' → hero style.panel present, `'none'` → absent; overlaps declared for every text-on-photo pair; validator ok; z-order photo/band first. Geometry assertions: cover hero centered (col fraction ≈ centered), band text INSIDE band rows.

Commit: `feat(smart-layout): photo-field staging family (cover/lockup/bands)`.

### Task 5: Family D — texture (repeat, wall) + retirements

**Files:** `stagings.ts`, `frontend/shared/template-grid/generate/generate.ts` (STAGING_MIGRATIONS at the migrateGen choke point), spec files.

Per Table D. Repetition helpers stay LOCAL to stagings.ts (`repeatColumn`, `wallGrid`) — pure, seeded only through knobs. `repeat`'s copies at `opacity: 0.25` except the `hot` knob's index; photo (if present) declared-overlaps every repeat_i it intersects, photo in FRONT. `wall`: `wall_i` rows overhang left+right (edge-to-edge), hero bright on top, declared overlaps.

**Retire `editorial` + `centered`:** remove from `STAGINGS`; add `STAGING_MIGRATIONS = { editorial: 'stacked', centered: { withImage: 'lockup', without: 'stacked' } }` resolved inside `migrateGen` (which already handles surface→theme; extend it with staging migration + image-presence input). A stored gen naming a retired id regenerates cleanly under the mapped id.

**Tests:** repeat produces ⌊R/step⌋ copies with exactly one full-opacity; wall covers ≥90% of rows with wall elements at opacity 0.18 and overhang on both edges; migrations: stored `gen.staging:'editorial'` → shuffle lands on `stacked`; `'centered'`+image → `lockup`, without → `stacked`; registry has EXACTLY the 14 ids (assert the full sorted list); distinctness across all 14; full-library validator matrix: every staging × {1-item, 2/2-item} tiers × {image, no-image} → `validateGenerated.ok` (needsImage stagings skip the no-image cell).

Commit: `feat(smart-layout): texture staging family (repeat/wall); retire editorial+centered`.

### Task 6: Panel grouping + E2E + library sweep

**Files:** `frontend/app/components/templates/LayoutControlsPanel.vue`, `frontend/tests/sl-generation.spec.ts`.

- Panel: staging chips grouped by family with tiny family labels (`Type / Photo / Field / Texture` — `text-[9px] uppercase text-white/30`), needsImage chips disabled (+ tooltip "wire an image first") when no image — reuse the Task-1 presence source the composable exposes (add `hasGenImage`-equivalent computed BACK, reading the same source generate uses; name it `genHasImage` to avoid confusion with the removed round-1 symbol).
- E2E additions inside the existing journey: pick `statement` → hero computed font-size ≥ 0.10 × canvas height and (crop knob permitting) renders clipped at the left edge; wire the image socket (existing harness does) → pick `cover` → assert the img element renders full-bleed behind the hero (z-order via DOM order or computed z), hero readable (scrim or ink). Pick `repeat` → count repeat elements > 4. Both runs ×2, plus full unit sweep with stable counts.

Commit: `feat(smart-layout): staging library panel grouping + library E2E`.

### Task 7: Final whole-round review + fix wave

Standard: feature-scoped diff from 2b's base commit, opus reviewer, one fix subagent for the complete findings list, re-review. Gate: the full 14-staging matrix validates; E2E ×2; no regression to 2a's 439-test sweep.

---

## Self-Review

**Spec coverage:** Item 6's families all present (4+4+4+2 = 14); voices (serif via manifesto? — **correction**: the spec's Serif-Dates-style voice belongs to a staging — assign serif voice to `lockup` (title+date serif jewel) and `manifesto` (serif anchor numeral option via knob `voice: ['grotesk','serif']`) — added to Tables C/A); rules (index, manifesto); bands; repetition; overprint+scrims; overhang crops (statement, corner, wall); orientation — **gap: no staging uses vertical orientation** → added: `corner` gains knob `heroOrientation: ['horizontal','up']` (the backpocket-19 Reel move folded into corner) — Table B updated. Craft constants inherited from 2a. Retirements migrated at the choke point.
**Placeholder scan:** none — geometry is fully specified in the tables; composers transcribe.
**Type consistency:** `StagingResult`/`tierText`/`tierImage`/`supports.needsImage`/`STAGING_MIGRATIONS` used consistently across tasks; `opacity` lands in Task 1 before Family D consumes it; image threading lands in Task 1 before Families B/C consume it.
