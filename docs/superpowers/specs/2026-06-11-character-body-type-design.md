# Character Trainer: Capture Body Type, Not Just Face

**Date:** 2026-06-11
**Status:** Design approved, pending spec review
**Area:** `frontend/` — LoRA character trainer (single-reference dataset builder)

## Problem

The character trainer reproduces a person's **face** well but not their **body type**. Two
compounding causes in the single-reference flow ("Build a character dataset from one reference"):

1. **Scene selection never reaches full-body shots.** `buildCharacterDataset()` picks scenes
   with `CHARACTER_SHOT_SCENES.slice(0, n)`
   ([LoraTrainerSurface.vue:791-792](../../../frontend/app/components/LoraTrainerSurface.vue)).
   The scene list is ordered close-up → full-body, with the full-body scenes at indices 18-21.
   The default `datasetCount` is 16, so `slice(0, 16)` yields **only close-ups, headshots, and
   waist-up shots — zero full-body frames** reach the trainer.

2. **`ideogram-character` invents the body.** The model binds identity to the *face* in the
   reference image and generates everything else fresh
   ([character-shot.post.ts:41-45](../../../frontend/server/api/cloud-train/character-shot.post.ts)).
   It accepts **only one reference image** per call (confirmed: Replicate
   `ideogram-ai/ideogram-character` supports a single `character_reference_image`). If the
   reference is a headshot, the body in every generated shot is fabricated and inconsistent
   shot-to-shot, so the LoRA learns no stable body — while the clearly-present face comes through.

The captioning rule for character mode (omit face/body/identity so they bind to the trigger word)
is **correct and stays unchanged** — anything described in a caption becomes variable; anything
omitted is fused into the trigger as fixed identity.

## Goal

Reproduce **both face and body type** without regressing face quality. Body type can only be
captured from real proportions, so real photos must reach the trainer directly; synthetic shots
provide pose/lighting variety that binds identity to the trigger word.

## Non-Goals

- Multi-image input to a single Ideogram call (the model does not support it).
- Dropping synthetic generation (keeps the "bootstrap from a few photos" convenience).
- Changing style-mode behavior (this is character-mode only).
- Changing the character-mode caption prompt.

## Approach (chosen)

**Real photos go into the training set; synthetic shots top it up.**

- Real reference photos are added to the dataset directly — this is what captures true body type.
- Ideogram generates synthetic variety to reach the target dataset size, seeded one-reference-at-
  a-time (round-robin across all references).
- Scene selection is rewritten to guarantee full-body coverage via framing tiers + quotas.
- Close-ups remain the plurality so face quality never regresses.

Rejected alternatives:
- *Multi-reference only to seed Ideogram (real photos not added):* Ideogram still invents the
  body; defeats the purpose.
- *Real photos only, no synthesis:* reintroduces the 10-30 varied-photos friction the feature
  exists to remove.

## Design

### 1. State & reference upload

- Replace `referenceFile: File | null` / `referencePreview: string | null` with:
  - `referenceFiles: File[]` (cap **5**)
  - parallel previews (array, revoked on removal)
  - per-reference `includeInTraining: boolean`, default **true**
- Drop zone ([LoraTrainerSurface.vue:1561](../../../frontend/app/components/LoraTrainerSurface.vue))
  becomes multi-file: a row of removable thumbnails + an "add" tile, each with an
  include-in-training toggle.
- `subjectHint` and `datasetCount` unchanged.

**`buildCharacterDataset()` flow:**
1. Upload real references flagged `includeInTraining` and append to `images[]` tagged
   `{ generated: false, isReference: true }`.
2. Compute `synthetic = max(0, datasetCount − realIncludedCount)` so total ≈ `datasetCount`.
3. Generate `synthetic` shots via Ideogram, seeding by round-robin over **all** references
   (each call takes one ref).
4. Existing concurrency pool, live-append, and skip-on-failure behavior preserved.

### 2. Scene selection (core fix)

- Restructure `CHARACTER_SHOT_SCENES` from `string[]` to
  `{ prompt: string; framing: 'closeup' | 'medium' | 'full' }[]`.
- Add 2-3 more `full` / three-quarter scenes for variety.
- New **quota-based picker** (pure function, extracted for testing). For a synthetic count `m`:
  - `≥ 35%` `full`
  - `≥ 25%` `medium`
  - remainder `closeup` (close-ups remain the plurality at the default count)
  - within each tier, **spread the selection** across available scenes (stride sampling), not the
    first few, so repeated runs vary.
- Aspect ratios still cycle, but `full` shots bias toward `3:4` (portrait) so a standing body is
  not squashed into a square.

Net: a 12-shot synthetic run yields ~4 full + ~3 medium + ~5 closeup instead of 0 full.

### 3. Captioning & copy

- Character-mode caption prompt unchanged.
- Reference helper copy:
  *"Drop one clear, front-on photo"* → *"Drop a few photos — at least one clear face close-up and
  one full-length shot."*
- Soft inline hint when no reference looks full-body (heuristic: portrait aspect ratio or user
  has only one reference), encouraging a full-length shot. Non-blocking.

### 4. Training capacity

- Bump **LoRA rank 16 → 32 for character mode only**
  ([start.post.ts:71](../../../frontend/server/api/cloud-train/start.post.ts)). Rank 16 is tight
  to hold face + body + hair in one trigger token; 32 adds headroom. Style mode stays at 16.
  No extra per-image Replicate cost; modest extra training time.

### Face/body tension (why both survive)

Face fidelity comes from frames where the face is large (close-ups); body fidelity from full-body
frames where the face is small. Keeping close-ups the plurality preserves face quality while the
guaranteed full/medium frames add body. The highest-leverage user input is including **at least
one real close-up and one real full-body reference** — real close-up → accurate face, real
full-body → true body type.

## Testing

Pure functions extracted from the Vue component / network for unit testing:

- **Scene picker** `pickScenes(count)`: for counts 4 / 8 / 12 / 16 / 24, assert quotas hold
  (`≥35%` full, `≥25%` medium, close-ups plural at default), selection is spread (not
  front-loaded), and no scene repeats until the tier is exhausted.
- **Top-up math** `syntheticCount(datasetCount, realIncluded)`: equals
  `max(0, datasetCount − realIncluded)`; total never exceeds target; handles `realIncluded >
  datasetCount` (→ 0 synthetic).
- **Aspect bias**: `full` framings map to `3:4`.

## Files Touched

| File | Change |
|------|--------|
| `frontend/app/data/character-shot-scenes.ts` | `string[]` → tagged objects; add full-body scenes; export picker + aspect helper |
| `frontend/app/components/LoraTrainerSurface.vue` | multi-reference state/UI; `buildCharacterDataset()` top-up flow; copy |
| `frontend/server/api/cloud-train/start.post.ts` | character-mode rank 32 |
| test file (new) | scene picker + top-up math unit tests |

## Rollout / Risk

- Backward compatible: a single reference still works (just yields all-synthetic top-up with the
  new quota picker, which alone fixes cause #1).
- No schema/API changes to Replicate calls beyond the rank value.
- Worst case if real photos are poor quality: user toggles `includeInTraining` off per photo.
