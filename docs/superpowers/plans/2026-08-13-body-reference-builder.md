# Body Reference Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **HARD HUMAN GATE after Task 1:** Tasks 2–6 may not start until Julien has judged the probe images and said "Anny transfers" (or the fallback decision is recorded).

**Goal:** A game-style Body editor in the Character Studio — eight sliders morphing an Anny-derived grey figure whose baked front+back render pins every sheet's body-panel proportions.

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

### Task 2: The bake → committed GLB *(gated on Task 1 verdict)*

**Files:**
- Create: `scripts/bake-body-model/bake.py`, `scripts/bake-body-model/ATTRIBUTION.md`
- Create (committed output): `frontend/public/models/body-reference.glb`
- Test: `frontend/tests/unit/body-model-asset.unit.spec.ts` (new)

**Interfaces:**
- Consumes: Task 1's locked `slider-mapping.md` (the 8 real phenotype names).
- Produces: a GLB whose mesh has EXACTLY 8 morph targets named with our slider ids: `frame`, `height`, `build`, `muscle`, `shoulders`, `chest`, `waist`, `hips` (targetNames in the mesh extras, standard glTF). Base = default body. Each target = the mesh delta at that phenotype's max (value 1.0), all others default. ≤ 5 MB (decimate preserving silhouette if over).

- [ ] **Step 1: Write the failing asset test** — `frontend/tests/unit/body-model-asset.unit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GLB = resolve(__dirname, '../../public/models/body-reference.glb')
const SLIDERS = ['frame', 'height', 'build', 'muscle', 'shoulders', 'chest', 'waist', 'hips']

describe('body-reference.glb', () => {
  it('exists, is under 5MB, and carries exactly the 8 slider morph targets', () => {
    const buf = readFileSync(GLB)
    expect(buf.length).toBeLessThan(5 * 1024 * 1024)
    // GLB: 12-byte header, then JSON chunk (length LE uint32 at 12, type 'JSON' at 16)
    const jsonLen = buf.readUInt32LE(12)
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
    const mesh = json.meshes?.[0]
    expect(mesh).toBeTruthy()
    const names: string[] = mesh.extras?.targetNames ?? []
    expect(names).toEqual(SLIDERS)
    expect(mesh.primitives[0].targets).toHaveLength(8)
  })
})
```

- [ ] **Step 2: RED** (file missing) → **Step 3: implement `bake.py`** (evaluate base + 8 deltas via the anny API per Task 1's mapping; export via trimesh's glTF exporter with morph targets — if trimesh's morph support is insufficient, write the glTF JSON+bin directly (the structure is small) or use `pygltflib`; renderer-independent). Run it; commit the GLB.
- [ ] **Step 4: GREEN** → **Step 5:** `ATTRIBUTION.md` (Anny Apache-2.0, MakeHuman assets CC0, topology used, bake date/command). Commit: `git commit -m "feat(body): baked Anny body GLB — 8 morph targets, CC0 topology"`

### Task 3: Data + API for `bodyShape`/`bodyImage`

**Files:**
- Modify: `frontend/shared/characters/types.ts` (CharacterRecord + `emptyState` untouched; add fields + a `BODY_SLIDERS` const), `frontend/server/utils/characterRegistry.ts` (parse + heal), `frontend/server/api/characters-local.patch.ts` (top-level branch), `frontend/app/composables/useCharacters.ts` (`patchCharacter` fields)
- Test: extend `tests/unit/character-model.unit.spec.ts`, `tests/unit/character-registry.unit.spec.ts`, `tests/unit/characters-composable.unit.spec.ts`

**Interfaces:**
- Produces:
```ts
// shared/characters/types.ts
export const BODY_SLIDERS = ['frame', 'height', 'build', 'muscle', 'shoulders', 'chest', 'waist', 'hips'] as const
export type BodySliderId = typeof BODY_SLIDERS[number]
export interface CharacterRecord { /* existing */ bodyShape: Partial<Record<BodySliderId, number>> | null; bodyImage: string | null }
```
- Registry: parse clamps values to [0,1] and drops unknown keys; `healRefImages` nulls a vanished `bodyImage` (counted in `dropped`; no status side effects). PATCH: `{ slug, bodyShape }` / `{ slug, bodyImage }` accepted in the top-level-fields branch (bodyImage through `validRefFilename`; explicit `null` clears). Store: `patchCharacter(slug, { …existing, bodyShape?, bodyImage? })`.

- [ ] **Step 1: Failing tests** — registry: record with `bodyShape: {build: 1.4, nope: 0.5}` parses to `{build: 1}` (clamped, unknown dropped); `bodyImage: '../evil'` → null; heal drops vanished bodyImage without touching state statuses. Model suite: fields default null on parse of legacy records. Composable: `patchCharacter` sends the fields in the PATCH body (fetch-stub assertion).
- [ ] **Step 2: RED → implement → GREEN** (`npx vitest run tests/unit/character-model.unit.spec.ts tests/unit/character-registry.unit.spec.ts tests/unit/characters-composable.unit.spec.ts`).
- [ ] **Step 3: Commit** — `git commit -m "feat(body): bodyShape + bodyImage on the character record"`

### Task 4: `bodyShape.ts` pure module + Body editor modal

**Files:**
- Create: `frontend/app/lib/characters/bodyShape.ts`, `frontend/app/components/vue-canvas/BodyEditorModal.vue`, `frontend/app/pages/dev/body-editor.vue`
- Modify: `frontend/app/components/vue-canvas/CharacterStudioModal.vue` (a "Body" chip beside the readiness badge; opens the editor; visible whenever a character is loaded)
- Test: `frontend/tests/unit/body-shape.unit.spec.ts` (new)

**Interfaces:**
- Produces:
```ts
// bodyShape.ts (pure)
export interface BodyPreset { id: string; label: string; values: Partial<Record<BodySliderId, number>> }
export const BODY_PRESETS: BodyPreset[]  // Slim / Average / Athletic / Broad (tuned on the real figure during implementation; Average = all 0.5)
export function influencesFor(shape: Partial<Record<BodySliderId, number>> | null): number[]  // ordered per BODY_SLIDERS; missing → 0.5 default; 0.5 maps to influence per the bake's delta convention (document: influence = value when targets are authored at max — i.e. influence = clamp01(value))
export function defaultBodyShape(): Record<BodySliderId, number>  // all 0.5
```
- Modal contract: `<BodyEditorModal :slug="string" @close />` — loads the GLB once (module-level cache), sliders bound to a local copy of `character.bodyShape ?? defaultBodyShape()`, presets apply value sets, **Save body** = render front (+Y 180° for back) via the same renderer offscreen → side-by-side composite canvas → `uploadRefFilename` → `patchCharacter(slug, { bodyShape, bodyImage })` → close. Cancel/Escape/backdrop discard through one handler. Copy: "Free & instant — nothing is generated while you slide." Dev harness mounts it with the first character.

- [ ] **Step 1: Failing tests** — `influencesFor(null)` = eight 0.5s ordered per `BODY_SLIDERS`; explicit values pass through clamped; presets contain the four ids and Average is all-0.5; every preset value ∈ [0,1].
- [ ] **Step 2: RED → implement module → GREEN.**
- [ ] **Step 3: Build the modal** (three.js: GLTFLoader, `MeshStandardMaterial({ color: 0x8a8f9c })` override, OrbitControls, `mesh.morphTargetInfluences = influencesFor(local)` on each input; save bake per the contract; StudioButton actions; quiet copy).
- [ ] **Step 4: Wire the studio chip**; verify live on `/dev/body-editor` (figure renders, sliders morph in real time, Save uploads + patches — all free; confirm the PATCH in the network panel).
- [ ] **Step 5:** `npx vue-tsc --noEmit 2>&1 | grep -E "BodyEditor|bodyShape" | head` → zero. Commit: `git commit -m "feat(body): Body editor modal — live Anny morphs, free save"`

### Task 5: Sheet body panels consume the reference

**Files:**
- Modify: `frontend/app/composables/useSheetGeneration.ts` (derived-edit call for `body-front`/`body-back`), `frontend/app/composables/useCharacterStudio.ts` (thread the character's `bodyImage` dataUrl into `expandAll`/`rerollPanel` source)
- Test: extend `tests/unit/sheet-generation.unit.spec.ts`

**Interfaces:**
- Consumes: `SheetSource` gains optional `bodyReferenceDataUrl?: string` (both modes).
- Produces: when set AND the panel slot is `body-front`/`body-back`: `images: [portraitDataUrl, bodyReferenceDataUrl]`, prompt + `' Match the body proportions of the grey reference figure in the second image.'` (exported const `BODY_MATCH_SUFFIX` — single source, also used by the probe's Task-1 phrasing notes). Face panels and no-bodyImage behavior byte-identical to today.

- [ ] **Step 1: Failing tests** (fetch-stub style, existing suite conventions): with `bodyReferenceDataUrl` set, body-front's nano-gen body has 2 images and the suffixed prompt; face-neutral still has 1 image and no suffix; without it, all panels identical to current assertions (guard: existing tests untouched and green).
- [ ] **Step 2: RED → implement → GREEN** (`npx vitest run tests/unit/sheet-generation.unit.spec.ts tests/unit/character-studio-composable.unit.spec.ts`).
- [ ] **Step 3: Commit** — `git commit -m "feat(body): sheet body panels match the saved body reference"`

### Task 6: E2E + docs + owed-verification note

**Files:**
- Modify: `frontend/tests/character-sheet.spec.ts` (scenario: studio → Body chip → modal renders, sliders present, Save fires PATCH with `bodyShape` — intercepted, no uploads/generation), `docs/STATE.md`
- Dashboard: controller-owned — skip.

- [ ] **Step 1:** E2E scenario (route-intercept PATCH + `/upload/image`; assert the PATCH body carries all 8 slider keys). Run `npx playwright test tests/character-sheet.spec.ts` ×2.
- [ ] **Step 2:** Full targeted suite (the character/sheet/body files named in Tasks 2–5) + `npx nuxt typecheck` plan-symbol grep (`bodyShape|BodyEditor|body-reference`) → 0.
- [ ] **Step 3:** STATE.md: Body builder LANDED sub-block + OWED: one post-build extreme-vs-default sheet rebuild (broken-control, paid) confirming end-to-end transfer in the real pipeline. Commit: `git commit -m "feat(body): E2E + docs — body reference builder landed"`

## Self-review notes (applied)

- **Spec coverage:** §1→T1 (gate encoded in the header + T1 Step 6), §2→T2, §3→T4, §4→T3, §5→T5, §6→T2 (asset test)/T4 (harness)/T6 (E2E + owed). License guard is a Global Constraint + T1 Step 2 + T2 ATTRIBUTION.
- **Type consistency:** `BODY_SLIDERS` order (T3) = GLB targetNames (T2 test) = `influencesFor` order (T4) = PATCH keys (T6 E2E). `BODY_MATCH_SUFFIX` (T5) matches T1 Step 4's probe phrasing.
- **Open judgment, deliberately delegated:** renderer choice in the bake env (pyrender vs pyglet vs matplotlib) — silhouette-only requirement stated; preset value tuning on the real figure (T4).
