# Character System Unification + Higgsfield Sheet Methodology

**Date:** 2026-08-12
**Status:** Approved design, pending implementation plan

## Plain-language summary

Today, nine parts of the app each keep their own private idea of what "a character" is, and images and video consume characters through completely different hidden paths (video gets one cover photo; images get a LoRA or a face-swap node, chosen silently). This design collapses everything into one model: a character is a set of **states** (Cal-clean, Cal-wet, Cal-bloody), each state has one **composite sheet image** (headless body front + back, large ¾ portrait, two face close-ups), and that sheet — once it survives a 10-image stress test you judge by eye — is the single asset every generator receives, for both images and video.

The methodology is adapted from Higgsfield's character-sheet guide for Seedance
(https://x.com/higgsfield_ai/status/2086868401788731762):

- Three panels: full body front, full body back, large close ¾ portrait.
- **Take the head off the full-body figures** — the small soft face on a wide panel is exactly the face the model copies badly into wide shots. Remove it and the only face source left is the close portrait.
- **Two face close-ups — with a smile and without** — otherwise the model invents teeth and the smile arrives as somebody else's mouth.
- **One asset per state, not one asset with notes.** Cal-clean, Cal-wet, Cal-bloody are three different assets. Mixing states in one text makes the blood fade in and out.
- **Stress test before locking:** ten generations in different poses and light, recognizable 10/10. If it fails, fix the description, not the model. Splitting is cheaper than arguing.

## Current state (what the exploration found)

The pure core is well-factored and unit-tested: `server/utils/characterRegistry.ts`
(disk registry at `models/characters/<slug>.json`, 5 records), `app/lib/shotdirector/cast.ts`
(cast materialization, `CAST_REF_CAP = 1`), `app/data/character-shot-scenes.ts` (25-scene
LoRA library + 4-shot canonical sheet), `app/composables/useSheetGeneration.ts`.

The mess is everything around it:

1. **Nine representations of "a character":** registry record, hand-copied client mirror
   (`useCharacters.ts`), LoRA sidecar `kind:'character'`, three magic `sailor_character*`
   node props, `CastMember`, materialized `Ref{castSlug, role:'identity-lock'}`,
   `ShotSheet.subject` free text, `LipSyncSheet.face`, `TrainerSeed`.
2. **Variant resolution ("named → default → first") implemented four times:**
   `useCharacters.pickVariant`, inline in `VueNodeCanvas.vue:3432` (generate path),
   `characterRegistry.defaultVariant`, `CharacterLibraryPanel.activeVariant`. The preview
   path and generate path resolve characters through different code kept in sync by comment.
3. **Split consumption:** video sends only the cover (`CAST_REF_CAP = 1`, deliberate —
   multiple photos of one person made Seedance spawn duplicates); images silently fork on
   training status (trained LoRA → Flux LoRA node; draft → Ideogram ConsistentFace).
   Sheet shots 2–4 are generated, paid for, and never consumed downstream.
4. **Dead descriptor:** `CharacterVariant.descriptor` only feeds sheet generation prompts;
   it never reaches `compile.ts`, so ShotDirector tells users to retype outfits into `subject`.
5. **The `'default'` sentinel bug class:** `variantId` must be `undefined`, never `'default'`,
   defended by three separate guards with long comments.
6. **Legacy write shape:** `characters-local.patch.ts` accepts both `variants[]` and a legacy
   top-level `refImages`/`coverIndex` alias (three callers still on it); full-array replace
   semantics forced five hand-written stale-closure guards into the panel.
7. **Event-bus coupling:** five stringly-typed `window` CustomEvents wire panel ↔ canvas.
8. **Auto-spend on panel mount:** absorb migration + auto sheet generation fire as a mount
   side effect, guarded only by non-persisted session booleans.

## Decisions made during brainstorming

- **Scope: full unification (Approach C).** Clean every corner's idea of "a character" first,
  then build the sheet system on top. A ⊂ C: nothing is wasted.
- **The sheet is the identity asset.** Both image and video generation consume the locked
  composite sheet as a reference image. The trained LoRA is demoted to a visible opt-in
  quality upgrade, never a silent fork.
- **Packaging: one composite, faces included.** Single wide composite (headless front,
  headless back, large ¾ portrait) with the smile/neutral close-ups as a second row/insets.
  One image carries everything → compatible with the cap-of-1 rule.
- **Stress test: manual grid review.** 10-tile grid, user marks pass/fail per tile,
  10/10 enables Lock. The user stays the judge of "recognizable."

## Design

### 1. One character model, shared everywhere

- Canonical types move to `frontend/shared/characters/types.ts` (Nuxt `shared/` is
  importable from both server and app). Server registry and client composable both import
  it; the hand-copied mirror in `useCharacters.ts` is deleted.
- `CharacterVariant` → `CharacterState`:

  ```ts
  interface CharacterState {
    id: string                      // stable id; 'default' only as a stored id, never a sentinel
    label: string                   // "Clean", "After the Thames", "Third act"
    descriptor: string              // "soaked navy jacket, wet hair" — reaches BOTH sheet gen AND shot prompts
    panels: CharacterPanel[]        // the 5 source shots, kept for per-panel reroll
    sheetImage: string | null       // composite filename in ComfyUI input dir; null until generated
    status: 'draft' | 'testing' | 'locked'
    stressResult: { passes: number; total: number; at: string } | null
    updatedAt: string
  }
  interface CharacterPanel {
    slot: 'body-front' | 'body-back' | 'portrait' | 'face-neutral' | 'face-smile'
    filename: string
  }
  ```

- UI language: "Looks" → **"States"**.
- `stateId` is `string | null` end-to-end, normalized once at the type boundary. The three
  `'default'`-sentinel guards (`CharacterNode.vue:40`, `CharacterLibraryPanel.vue:240`,
  `VueNodeCanvas.vue:3874`) are deleted.
- Satellite shapes stop carrying copies:
  - Canvas nodes: one typed `CharacterBinding { slug: string; stateId: string | null }`
    replaces the three `sailor_character*` magic props (with node-data migration on load;
    note `convertToLiteGraph` drops unknown `node.data` fields silently — verify the
    binding survives round-trip).
  - `CastMember.variantId` → `stateId: string | null`.
  - `LipSyncSheet.face` and `TrainerSeed` reference `slug`/`stateId` and derive images
    from the registry at use time instead of storing their own srcs.
  - LoRA sidecar linkage (`loraName`/`trigger`) stays on the record, unchanged.

### 2. One store, typed calls, honest server API

- `useCharacters` becomes the single client store — the only reader/writer of character
  data. All panel/canvas/node access goes through it.
- The five `window` CustomEvents (`sailor:charactersChanged`, `castEdgesChanged`,
  `uncastCharacter`, `addCharacterImageGen`, `addCharacterCastNode`) are replaced by
  store state/actions plus one small typed emitter for the two genuinely canvas-side
  operations (add cast node, add image-gen node).
- Server API:
  - Drop the legacy top-level `refImages`/`coverIndex` alias from
    `characters-local.patch.ts`; migrate its three callers to the state shape.
  - Move from full-array replace to per-state field patches
    (`PATCH /api/characters-local` with `{ slug, stateId, patch: Partial<CharacterState> }`).
  - Add an `updatedAt` stale-write guard (409 on mismatch), mirroring the existing
    persistence recency-guard pattern. Delete the five hand-written stale-closure guards
    in `CharacterLibraryPanel.vue`.
- Auto-spend on mount is removed entirely. The absorb migration may still run on mount
  (it's free — it only mints records), but sheet generation happens only on explicit
  click. "Already generated" is the persisted `sheetImage` field, not session booleans.

### 3. Higgsfield sheet generation

- `CHARACTER_SHEET_CANONICAL` (4 shots) is replaced by the five Higgsfield panels.
- Order of operations — portrait first, since that is where identity lives:
  1. **Portrait (large ¾):** from source photo via Ideogram Character
     (`character_reference_image`), or from a trained LoRA via Flux.
  2. **Headless bodies (front, back):** nano-banana edits derived from portrait + state
     descriptor — full-body figure, head removed, matching wardrobe, neutral grey studio
     ground like the Higgsfield example.
  3. **Face close-ups (neutral, smile):** nano-banana edits of the portrait. The smile
     close-up exists so the model never invents teeth.
- Sequential generation with abort-on-first-failure (existing don't-burn-money behavior).
  Per-panel reroll supported, as with today's per-tile reroll.
- **Compositing is a client-side canvas bake** (same technique as the studio render
  buttons): row 1 = body-front | body-back | portrait (portrait largest), row 2 =
  face-neutral | face-smile insets. Deterministic layout, no generation cost. The
  composite uploads to ComfyUI's input dir; filename stored as `state.sheetImage`.
- Estimated cost per state ≈ $0.40–0.70 (5 generations; source-dependent).

### 4. Uniform consumption — images and video

- **Video:** `materializeCast` sends the cast state's `sheetImage` as the single
  identity-lock ref. `CAST_REF_CAP = 1` survives untouched — one image per character,
  but it now carries front/back/face instead of one cover photo.
- **Prompt clause:** `castClause()` grows the state descriptor:
  `"Characters: Cal (soaked navy jacket, wet hair) @Image1; Marcus @Image2."`
  This fixes the retype-the-outfit-into-`subject` workaround. One state per cast member
  per shot — mixing states in one text is exactly what the methodology forbids.
- **Images:** the silent LoRA-vs-ConsistentFace fork is removed. "Use in image" sends the
  sheet as a reference image to the chosen ref-capable model (Seedream / nano-banana /
  Ideogram Character). A trained LoRA is offered as a visible "use trained identity"
  option, never an automatic switch.
- **Lip-sync:** picks a character → portrait panel (not the composite) via the same
  store resolution path.
- Draft states without a generated sheet fall back to their cover ref image (migration
  window only), flagged in the UI.

### 5. Stress test and locking

- Lifecycle: `draft` → `testing` → `locked`.
- **Stress test:** explicit button generates a 10-tile grid — poses/lighting sampled from
  the existing 25-scene library (`CHARACTER_SHOT_SCENES`) — rendered by a ref-capable
  image model (Seedream by default) receiving the composite sheet as its reference,
  through the same consumption path production image gen uses. Status → `testing`.
- User marks each tile recognizable / not. **10/10 enables Lock.** Anything less directs
  the user to edit the descriptor or reroll panels — fix the description, not the model.
- Cast pickers and "use in image" offer `locked` states by default; drafts are visible
  but flagged.
- Editing a locked state's descriptor or panels reverts it to `draft`. Locked states
  never silently drift.
- Grid cost ≈ $0.30–0.80 per attempt. Always explicit, never automatic.

### 6. Migration and testing

- **Data migration:** parse-time in `parseCharacterRecord` (the established pattern):
  each existing variant becomes a `draft` state; `refImages` → `panels` with best-effort
  slot mapping (front closeup → `portrait`, full-body → `body-front`, rest unslotted);
  cover image stands in for `sheetImage` consumption fallback until a real sheet is
  generated. The five existing characters stay castable throughout.
- **Node-data migration:** `sailor_character*` props → `CharacterBinding` on graph load;
  round-trip through `convertToLiteGraph` verified by test (it silently drops unknown
  `node.data` fields).
- **Tests:** update the nine existing unit suites (registry, characters-composable, link,
  shot-scenes, cast, cast-edges, sheet-generation, training-finalize-link) rather than
  discard; new suites for the store, per-state PATCH + 409 stale-write guard, composite
  layout, and lock-state transitions (including edit-reverts-to-draft).
- **E2E:** cast a locked character into a Seedance shot AND a Seedream image; assert both
  requests carry the same `sheetImage` reference (assert the path ran — "it rendered" is
  not evidence).
- **Out of scope:** live paid renders for sheet generation and the stress grid are owed
  as a post-implementation verification checklist (the standing pattern for paid paths).

## Non-goals

- No backend/Python-side character concept (there is none today; none is added).
- No change to LoRA training itself (dataset builder, rank bump) beyond consuming the
  unified types.
- No multi-character interaction logic beyond what `CAST_MAX = 3` already provides.
