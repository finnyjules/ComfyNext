# Body Reference Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **HARD HUMAN GATE after Task 1:** Tasks 2–6 may not start until Julien has judged the probe images and said "Anny transfers" (or the fallback decision is recorded).

**Goal (AMENDED post-probe):** A game-style Body editor — eight sliders that COMPILE TO GRADED BODY TEXT riding the proven descriptor channel into every sheet and shot prompt, with the Anny grey figure as a free display-only preview of what the words mean.

**Architecture:** One-time offline Python bake (Anny, CC0 topology) → static GLB with 8 morph targets → three.js editor modal (live `morphTargetInfluences`) → free front+back composite upload → `bodyShape`/`bodyImage` on `CharacterRecord` → body panels become two-image nano-banana edits (portrait = identity, body render = proportions). A ~$0.40 probe precedes everything.

**Tech Stack:** Python scratch venv (`anny`, trimesh/pyrender — bake only, never runtime), three.js GLTFLoader + morph targets, existing endpoints (`/api/inpaint/nano-gen`), existing store/PATCH plumbing.

**Spec:** `docs/superpowers/specs/2026-08-13-body-reference-builder-design.md`

## Global Constraints

- **Working dir** `frontend/` for app code; `scripts/bake-body-model/` for bake tooling (repo root). Tests: `npx vitest run tests/unit/<file>`.
- **License guard (absolute):** only the MakeHuman/MPFB2 (CC0) or SOMA (Apache-2.0) topology. The SMPL-X-topology variant is non-commercial — it must never be selected, downloaded into the repo, or shipped. Every task touching Anny asserts this in code comments and the report.
- **No runtime Python/Anny dependency** — the app consumes only the committed GLB.
- **Money:** the probe (~$0.40) and nothing else in this plan spends. Sliding/saving/rendering are free and must stay free. Generation calls only from explicit user clicks (existing sheet-build flow).
- **Quiet-readiness language:** no locked/draft/stress/variant in user-facing strings; body-editor copy uses the spec's wording.
- **One shape per CHARACTER** (`bodyShape`, `bodyImage` on the record, not per state). Body edits do NOT demote look statuses (spec §4).
- Shared main-direct checkout; parallel sessions commit concurrently: stage only your files, record exact SHAs, review packages built per-commit.
- Ignore `frontend/.claude/worktrees/**`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/bake-body-model/probe.py` (new) | Task 1: phenotype listing, two figure renders, probe contact sheet. |
| `scripts/bake-body-model/bake.py` (new) | Task 2: GLB export (base + 8 morph targets). |
| `scripts/bake-body-model/ATTRIBUTION.md` (new) | Licenses + provenance. |
| `frontend/public/models/body-reference.glb` (new, committed binary) | The figure the app loads. |
| `frontend/shared/characters/types.ts` | +`bodyShape`/`bodyImage` on `CharacterRecord`. |
| `frontend/server/utils/characterRegistry.ts` | Parse/heal the two fields. |
| `frontend/server/api/characters-local.patch.ts` | Top-level-fields branch accepts them. |
| `frontend/app/lib/characters/bodyShape.ts` (new) | Pure: slider ids, presets, `bodyShape` ⇄ morph-influence mapping, save-payload assembly. |
| `frontend/app/components/vue-canvas/BodyEditorModal.vue` (new) | The editor (three.js stage + sliders + presets + save bake). |
| `frontend/app/components/vue-canvas/CharacterStudioModal.vue` | "Body" chip next to the readiness badge opens it. |
| `frontend/app/composables/useSheetGeneration.ts` | Two-image body panels when `bodyImage` present. |
| `frontend/app/pages/dev/body-editor.vue` (new) | Dev harness. |

---

### Task 1: The probe (HARD GATE — Julien judges)

**Files:**
- Create: `scripts/bake-body-model/probe.py`, `scripts/bake-body-model/README.md` (venv instructions), `scripts/bake-body-model/.gitignore` (`venv/`, `out/`)
- No frontend changes.

**Interfaces:**
- Produces: `scripts/bake-body-model/out/phenotypes.txt` (full `model.phenotype_labels` print — the authoritative slider-name source for Task 2), `out/figure-default-{front,back}.png`, `out/figure-extreme-{front,back}.png`, and `out/probe-contact-sheet.png` (control vs default-ref vs extreme-ref generations side by side, labeled). Also a locked mapping table written to `out/slider-mapping.md`: our 8 slider ids → real phenotype/target names found in the listing.

- [ ] **Step 1: Environment.** `cd scripts/bake-body-model && python3 -m venv venv && ./venv/bin/pip install anny trimesh pyrender pillow` (macOS: if pyrender's offscreen GL fails, fall back to `trimesh.Scene.save_image` (pyglet) or an orthographic matplotlib triangle plot — silhouette fidelity matters, shading does not; document which renderer worked).
- [ ] **Step 2: Phenotype listing.** In `probe.py`: instantiate the model on the **CC0/SOMA topology explicitly** (read Anny's constructor docs in the installed package — assert the topology name in an inline comment AND print it into `phenotypes.txt`), print `model.phenotype_labels` to `out/phenotypes.txt`. Choose the 8 mappings (Frame→gender-like, Height, Build→weight-like, Muscle, Shoulders, Chest, Waist, Hips — nearest real names) and write `out/slider-mapping.md` with a one-line justification each.
- [ ] **Step 3: Two figures.** Render default (all phenotypes at documented defaults/0.5) and extreme (Build+Shoulders near max, Height near min — a short broad figure, deliberately far from Jene) — front and back each, neutral stance, grey material, plain background, ~768×1024.
- [ ] **Step 4: The generations (~$0.40).** Against the running dev server (127.0.0.1:3000; `./dev.sh` from repo root if down), with Jene's portrait panel as image 1 (`GET /api/characters-local` → jene's default state `panels` → portrait filename → fetch `/view?filename=…&type=input`): call `POST /api/inpaint/nano-gen` three times with the body-front prompt from `frontend/app/data/character-shot-scenes.ts` (`HIGGSFIELD_PANELS` body-front entry):
  1. control: `images: [portrait]`, prompt as-is;
  2. default-ref: `images: [portrait, figure-default-front]` + appended `' Match the body proportions of the grey reference figure in the second image.'`;
  3. extreme-ref: `images: [portrait, figure-extreme-front]` + same suffix.
  Save the three outputs; composite all inputs+outputs into `out/probe-contact-sheet.png` with labels (PIL).
- [ ] **Step 5: Commit the tooling** (scripts + README + gitignore; NOT the venv, NOT out/ — but DO copy `phenotypes.txt`, `slider-mapping.md`, and `probe-contact-sheet.png` into `docs/superpowers/specs/assets/2026-08-13-body-probe/` and commit those three): `git commit -m "feat(body): Anny probe — phenotype listing + transfer test assets"`
- [ ] **Step 6: STOP. Present the contact sheet to Julien** (the controller surfaces it). The gate question: does the extreme-ref output visibly follow the short/broad figure while control and default-ref look alike? **Tasks 2–6 wait for his verdict.** If NO transfer: record the fallback decision in the spec (metaball skin over `usePoseRig`), and the controller re-plans Task 2 accordingly.

### Task 2: `bodyShape` field + the `bodyPhrase` compiler *(the mechanism core — AMENDED)*

**Files:**
- Modify: `frontend/shared/characters/types.ts` (`BODY_SLIDERS`, `BodySliderId`, `bodyShape` on CharacterRecord), `frontend/server/utils/characterRegistry.ts` (clamp/drop hygiene), `frontend/server/api/characters-local.patch.ts` (top-level branch accepts `bodyShape`), `frontend/app/composables/useCharacters.ts` (`patchCharacter`)
- Create: `frontend/app/lib/characters/bodyPhrase.ts`
- Test: `frontend/tests/unit/body-phrase.unit.spec.ts` (new) + extend `character-registry` and `characters-composable` suites

**Interfaces:**
- Produces:
```ts
// shared/characters/types.ts
export const BODY_SLIDERS = ['frame', 'height', 'build', 'muscle', 'shoulders', 'chest', 'waist', 'hips'] as const
export type BodySliderId = typeof BODY_SLIDERS[number]
// CharacterRecord gains: bodyShape: Partial<Record<BodySliderId, number>> | null

// app/lib/characters/bodyPhrase.ts (pure)
export function bodyPhrase(shape: Partial<Record<BodySliderId, number>> | null | undefined): string
```
- Band tables (exact; 0.5 ± 0.1 is the neutral dead zone emitting nothing; join non-empty fragments with ', '):
  - build: <0.15 'a very slim, slight build' · <0.4 'a slim build' · >0.85 'a very heavy, plus-size build with a full figure' · >0.6 'a noticeably heavyset build'
  - height: <0.15 'very short in stature' · <0.4 'short in stature' · >0.85 'very tall' · >0.6 'tall'
  - muscle: >0.85 'a strongly muscular physique' · >0.6 'an athletic, toned physique' · <0.15 'a soft, undefined physique'
  - shoulders: >0.6 'broad shoulders' · <0.4 'narrow shoulders'
  - chest: >0.6 'a full chest' · <0.4 'a flat chest'
  - waist: >0.6 'a thick waist' · <0.4 'a narrow waist'
  - hips: >0.6 'wide hips' · <0.4 'narrow hips'
  - frame: >0.6 'a masculine frame' · <0.4 'a feminine frame'
  (Order of fragments = BODY_SLIDERS order. Round-4 anchors: build 0.7 territory ≈ "noticeably heavyset", 1.0 ≈ "very heavy, plus-size".)

- [ ] **Step 1: Failing tests** — `bodyPhrase(null)` = '' ; all-0.5 = '' ; `{build: 1, height: 0.1}` = 'very short in stature, a very heavy, plus-size build with a full figure'... assert EXACT strings per band boundary (test 0.6/0.85/0.4/0.15 edges), fragment order, comma joining. Registry: bodyShape clamped to [0,1], unknown keys dropped, defaults null on legacy parse. Composable: patchCharacter sends `bodyShape` (fetch-stub body assertion) and explicit null clears.
- [ ] **Step 2: RED → implement → GREEN** — `npx vitest run tests/unit/body-phrase.unit.spec.ts tests/unit/character-registry.unit.spec.ts tests/unit/characters-composable.unit.spec.ts tests/unit/character-model.unit.spec.ts`
- [ ] **Step 3: Commit** — `git commit -m "feat(body): bodyShape field + bodyPhrase compiler — sliders speak"`

### Task 3: The phrase rides the descriptor channel

**Files:**
- Modify: `frontend/app/composables/useCharacters.ts` (`stateDescriptors` appends the character's phrase), `frontend/app/composables/useCharacterStudio.ts` (`buildSource` appends the phrase to the descriptor it passes into `SheetSource`)
- Test: extend `tests/unit/characters-composable.unit.spec.ts` + `tests/unit/character-studio-composable.unit.spec.ts`

**Interfaces:**
- Consumes: `bodyPhrase` (Task 2). NO signature changes anywhere downstream — the phrase joins the EXISTING descriptor strings:
  - `stateDescriptors(picks)`: per pick, `[state.descriptor, bodyPhrase(c.bodyShape)].filter(nonEmpty).join('; ')` — so the cast clause renders `Cal (soaked jacket; a noticeably heavyset build) @Image1`.
  - `buildSource(...)`: the returned `descriptor` becomes the same join — so every sheet panel prompt (portrait + derived) carries it via the existing `buildPortraitPrompt`/`buildDerivedPrompt` plumbing untouched.
- Golden back-compat: null/neutral bodyShape → joins collapse to today's exact strings (assert).

- [ ] **Step 1: Failing tests** — stateDescriptors with a bodyShape character yields the joined string; with null bodyShape yields exactly the state descriptor (byte-equal to current assertions — existing tests must stay green untouched); buildSource passes the joined descriptor into the SheetSource (stub-level assertion in the studio-composable suite style).
- [ ] **Step 2: RED → implement → GREEN** — same suites + `tests/unit/shotdirector-cast.unit.spec.ts` (goldens untouched).
- [ ] **Step 3: Commit** — `git commit -m "feat(body): body phrase joins the descriptor channel — sheets and shots inherit it"`

### Task 4: The preview bake → committed GLB *(preview-only; fail-soft)*

**Files:**
- Create: `scripts/bake-body-model/bake.py`, `scripts/bake-body-model/ATTRIBUTION.md`
- Create (committed output): `frontend/public/models/body-reference.glb`
- Test: `frontend/tests/unit/body-model-asset.unit.spec.ts` (new)

Same contract as the pre-amendment plan: 8 morph targets named exactly per `BODY_SLIDERS` order, base = default body, ≤5MB, CC0/SOMA topology ONLY (assert in ATTRIBUTION.md + bake.py comment; never SMPL-X). The asset test (verbatim from the original Task 2 Step 1: GLB header parse, `mesh.extras.targetNames` equals BODY_SLIDERS, 8 targets, <5MB). **Fail-soft rule:** if the bake fights tooling for more than a reasonable effort, report DONE_WITH_CONCERNS with the blocker — Task 5 ships slider-only (no figure) and the figure follows later; the mechanism (Tasks 2-3) is already independent of this asset.

- [ ] Steps: failing asset test (RED) → implement bake.py (trimesh/pygltflib or direct glTF JSON+bin authoring; Task 1's venv + slider-mapping.md) → run → commit GLB → GREEN → ATTRIBUTION.md → `git commit -m "feat(body): baked Anny preview GLB — 8 morph targets, CC0 topology"`

### Task 5: The Body editor modal (sliders → words, figure previews them)

**Files:**
- Create: `frontend/app/lib/characters/bodyShape.ts` (presets + influence mapping), `frontend/app/components/vue-canvas/BodyEditorModal.vue`, `frontend/app/pages/dev/body-editor.vue`
- Modify: `frontend/app/components/vue-canvas/CharacterStudioModal.vue` ("Body" chip beside the readiness badge)
- Test: `frontend/tests/unit/body-shape.unit.spec.ts` (new)

**Interfaces:**
- `bodyShape.ts` (pure): `BODY_PRESETS` (Slim/Average/Athletic/Broad; Average = all 0.5; others tuned on the real figure), `influencesFor(shape): number[]` (BODY_SLIDERS order, missing → 0.5, clamped), `defaultBodyShape()` (all 0.5).
- Modal: `<BodyEditorModal :slug="string" @close />` — GLB stage (module-cached load, grey MeshStandardMaterial, OrbitControls, `morphTargetInfluences = influencesFor(local)` live) IF the asset exists (Task 4 fail-soft: no asset → sliders + phrase preview only); 8 sliders + 4 preset buttons; **a live phrase line under the sliders showing exactly what the sliders will write** (`bodyPhrase(local)` — or "Nothing — she reads as average build" when empty); Save = `patchCharacter(slug, { bodyShape: local })` → close (free, instant, copy says so); Cancel/Escape/backdrop discard via one handler; reopening restores from the record. Quiet-language rules.

- [ ] Steps: failing bodyShape.ts tests (influences order/defaults/clamps, preset ids, Average all-0.5) → RED → implement module → GREEN → build modal + chip + dev page → live check on `/dev/body-editor` (sliders morph figure AND rewrite the phrase line in real time; Save PATCHes — network-verified; all free) → `npx vue-tsc --noEmit 2>&1 | grep -E "BodyEditor|bodyShape|bodyPhrase" | head` → zero → `git commit -m "feat(body): Body editor — sliders write words, the figure shows what they mean"`

### Task 6: E2E + docs

**Files:**
- Modify: `frontend/tests/character-sheet.spec.ts`, `docs/STATE.md` (dashboard controller-owned — skip)

- [ ] E2E scenario: studio → Body chip → modal renders; drag a slider (or set via the page) → the phrase preview line changes; Save → intercepted PATCH carries `bodyShape` with all set keys; no uploads, no generation. Run ×2.
- [ ] Full targeted suite (body-phrase, body-shape, body-model-asset, character-model/registry/composable, character-studio-composable, sheet-generation, shotdirector-cast) + typecheck plan-symbol grep (`bodyShape|bodyPhrase|BodyEditor`) → 0.
- [ ] STATE.md: Body builder LANDED sub-block (probe story: 4 rounds ~$1.75, figure-channel dead, text channel proven; sliders→words; figure preview) + OWED: one extreme-vs-neutral sheet rebuild (paid, broken-control) confirming the phrase steers the real pipeline. Commit: `git commit -m "feat(body): E2E + docs — body builder landed"`

## Self-review notes (applied)

- **Spec coverage:** §1→T1 (gate encoded in the header + T1 Step 6), §2→T2, §3→T4, §4→T3, §5→T5, §6→T2 (asset test)/T4 (harness)/T6 (E2E + owed). License guard is a Global Constraint + T1 Step 2 + T2 ATTRIBUTION.
- **Type consistency:** `BODY_SLIDERS` order (T3) = GLB targetNames (T2 test) = `influencesFor` order (T4) = PATCH keys (T6 E2E). `BODY_MATCH_SUFFIX` (T5) matches T1 Step 4's probe phrasing.
- **Open judgment, deliberately delegated:** renderer choice in the bake env (pyrender vs pyglet vs matplotlib) — silhouette-only requirement stated; preset value tuning on the real figure (T4).
