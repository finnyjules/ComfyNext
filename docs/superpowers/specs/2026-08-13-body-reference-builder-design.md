# Body Reference Builder — Anny-based Character Body Editor

**Date:** 2026-08-13
**Status:** Approved design, pending implementation plan
**Extends:** [2026-08-13-character-studio-workbench-design.md](2026-08-13-character-studio-workbench-design.md) (the Character Studio this lives in) and the sheet pipeline from [2026-08-12-character-system-unification-design.md](2026-08-12-character-system-unification-design.md)

## Plain-language summary

Today a character's body shape is invented: the sheet's full-body panels are derived from a head-and-shoulders portrait, so the image model guesses everything below the frame. This feature adds a **Body editor** to the Character Studio — a video-game-style character creator: a grey 3D human figure morphed in real time by eight sliders (Frame, Height, Build, Muscle, Shoulders, Chest, Waist, Hips) plus four presets. Saving bakes a front+back render into a **body reference image** stored on the character; from then on the sheet's body panels are generated as two-image edits — portrait for identity, body reference for proportions — so every look and every shot inherits the same body. Sliding, saving, and rendering are free; only the sheet generations that consume the reference cost money, as they already do.

The figure is **Anny** (Naver Labs) — an open-source parametric human body (code Apache-2.0; the MakeHuman-derived mesh and blendshapes CC0/public domain). Anny runs ONLY in a one-time offline bake script; the app ships a small static GLB and drives it with plain three.js morph targets.

Decisions made in brainstorming (Julien, 2026-08-13):
- **Grey mannequin fidelity** (not paid realistic previews): sliders are free and instant; the image model transfers proportions only.
- **One shape per character** (not per look): the body is part of who they are, like the face.
- **Anny over hand-sculpted mesh or capsules**: Approach B's smooth human silhouette at near-Approach-A cost, license-safe.
- **Eight sliders, evidence-gated additions**: granularity is capped by what survives transfer through the image model; extra dials must prove they transfer before earning a slot (future collapsed "Advanced" tier).
- **Probe gate first**: ~$0.40 of test generations decide Anny vs the metaball fallback BEFORE any editor is built.

## 1 · Task 0 — the probe gate (before any product code)

From Python only (no app changes):
- `pip install anny` in a scratch venv (never the app runtime). First output: print `model.phenotype_labels` — the authoritative list of controllable parameters. Lock the final 8 slider→parameter mapping from real names (working mapping: Frame→gender, Height→height, Build→weight, Muscle→muscle, Shoulders/Chest/Waist/Hips→their MakeHuman regional targets).
- **License guard:** use the MakeHuman/MPFB2 (CC0) or SOMA (Apache-2.0) topology ONLY. The SMPL-X-topology variant is non-commercial and must never be used or shipped.
- Render two grey figures front+back (neutral stance): default shape, and an exaggerated shape (e.g. Build+Shoulders near max, Height low).
- Generate body panels via the existing `/api/inpaint/nano-gen` mechanics: {no reference control} × {default figure} × {exaggerated figure} against Jene's portrait (~$0.40 total). Julien judges: did proportions follow the figure?
- **Gate:** clear transfer → proceed with Anny. Weak/no transfer → fall back to the metaball skin over the existing `usePoseRig` capsule table (same sliders, same editor shell; document the decision) and re-probe once with the metaball render before building.

## 2 · One-time bake → static GLB

- `scripts/bake-body-model/` (Python, committed; run manually, output committed): loads Anny, evaluates each slider's morph delta against the base body, exports ONE GLB with the base mesh + 8 morph targets (+ nothing else: no textures, no skeleton needed for v1's fixed neutral stance). Target size ≤ ~4 MB; decimate if needed (silhouette fidelity matters, vertex count doesn't).
- The GLB ships as a static asset under `frontend/public/models/body-reference.glb` (or the established static-asset location — implementer matches convention). Provenance + licenses recorded in a sibling `ATTRIBUTION.md` (Anny Apache-2.0 code, MakeHuman CC0 assets).
- Adding a future dial = one line in the bake script + one morph target. Re-run, re-commit.

## 3 · The Body editor (modal in the Character Studio)

- Entry: a **Body** affordance in the studio (header area or ⋯ menu — implementer picks the spot that reads best against the existing chrome; it must be visible without opening a menu once a character exists, e.g. a small "Body" chip next to the readiness badge).
- Modal chrome mirrors the Pose Editor / studio modal idiom (Teleport, overlay, Escape/backdrop through one close handler).
- Stage: the GLB in grey (`MeshStandardMaterial`, neutral studio look), OrbitControls, fixed neutral stance.
- Panel: 8 sliders (live `morphTargetInfluences`) + 4 presets (Slim / Average / Athletic / Broad — value sets tuned during implementation on the real figure). Free & instant; copy states so ("Free & instant — nothing is generated while you slide").
- **Save body**: renders front + back views off-screen (same renderer, two camera angles), composites side-by-side into ONE PNG (reuse the composite/bake canvas patterns), uploads via `uploadRefFilename`, then persists `{ bodyShape, bodyImage }` (§4). Free.
- Cancel discards. Reopening restores sliders from `bodyShape`.
- Quiet-readiness language rules apply (no machine words).

## 4 · Data model + API

- `CharacterRecord` gains two CHARACTER-level fields (not per state):
  - `bodyShape: Record<string, number> | null` — slider id → 0..1 value (re-editable source of truth)
  - `bodyImage: string | null` — baked reference filename in the input dir (`validRefFilename`)
- Registry hygiene parses/heals them like other filename fields (vanished `bodyImage` file → null; `bodyShape` kept). Parse-time default null (no migration needed for existing records).
- PATCH: the existing top-level-fields branch (`name/notes/loraName/trigger`) accepts `bodyShape`/`bodyImage`.
- Editing the body (new `bodyImage`) makes existing sheets stale in the honest sense only: nothing is auto-regenerated and nothing auto-demotes — the next sheet rebuild uses the new reference. (Body ≠ per-state content; the state machine's demote-on-content-edit does not fire. If Julien later wants body edits to demote all looks, that's a follow-up decision.)
- Store: `useCharacters().patchCharacter` extends to the two fields.

## 5 · Sheet consumption

- In `useSheetGeneration`'s derived-panel step: when the character has `bodyImage`, the two body panels (`body-front`, `body-back`) send `images: [portraitDataUrl, bodyReferenceDataUrl]` with the prompt extended: "Match the body proportions of the grey reference figure in the second image." (exact phrasing tuned during the probe). Faces panels unchanged (single image).
- No `bodyImage` → exactly today's single-image behavior.
- The probe's winning phrasing is recorded in the spec's implementation notes when known.

## 6 · Testing + verification

- Unit: slider→morph mapping table (pure), Save-body payload assembly (pure parts), registry hygiene for the two new fields, PATCH round-trip, two-image request assembly for body panels (call-count + body assertions in the existing sheet-generation suite style).
- The GLB loads in a component-level check (dev harness page for the modal, like `/dev/character-studio`).
- OWED (paid): the probe itself (Task 0, ~$0.40, Julien judges), and one post-build sheet rebuild with a deliberately extreme body to confirm end-to-end transfer (broken-control style: extreme vs default must differ visibly).
- E2E: open Body editor from the studio, assert sliders render + Save persists `bodyShape` via intercepted PATCH (no generation).

## Non-goals

- No pose control in the Body editor (fixed neutral stance; poses remain the Pose Editor's job).
- No per-look body override; no ageing over time; no Advanced slider tier in v1 (evidence-gated later).
- No runtime Python/Anny dependency; no SMPL-X-topology assets anywhere in the repo.
- No realistic-preview generation inside the editor.
