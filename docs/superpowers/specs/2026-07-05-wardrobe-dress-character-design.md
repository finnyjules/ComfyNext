# Wardrobe — dress a character (+ character-panel UX pass)

**Date:** 2026-07-05
**Status:** Design approved (shape). Pass 1 = shared core + panel Dress action + panel UX. Pass 2 (canvas node) = its own later spec.
**Related:** [[project_character_library]], [[project_shot_director]] (env-plate `c87994d5c`, cover-for-video fix pending), [[feedback_pastel_means_ai]], [[feedback_cost_conscious_ai]]

## Why

Two findings converged. (1) Seedance duplicates a solo character when sent multiple
face photos — the fix is to send the look's **cover** as the single identity ref.
(2) Wardrobe is meant to live in **looks** (the `variants` array), which the panel
already supports — but nobody creates a second look because there's no easy way to
*generate* the character in a new outfit. This feature closes that: dress a character
(garment photo or text) → a new Look whose cover is the dressed image → castable and,
via the cover-fix, sent cleanly to video.

## Shared core — `lib/wardrobe/`

`buildDressPrompt(opts): string` — pure, unit-tested instruction builder.
- Garment mode: `"Dress the person in the first image in the garment shown in the
  second image. Preserve their face, hair, body, and pose exactly; replace only the
  clothing. Photorealistic, plain background."`
- Text mode: `"Change the person's outfit to {outfit}. Preserve their face, hair,
  body, and pose exactly; replace only the clothing. Photorealistic, plain
  background."` (`{outfit}` trimmed; empty → caller disables generate.)
- Garment + refining text: append the text as an outfit note.

Endpoint: extend `server/api/inpaint/nano-gen.post.ts` to accept `images?: string[]`
alongside the existing `image?: string` (back-compat: `image` → `[image]`). Passes
`image_input: images` to `google/nano-banana-pro`. One person image = text edit; two
= garment try-on. No new model or infra.

Person base is always the character's **identity cover** (clean identity in → dressed
identity out), resolved via `coverUrl(character)`.

Cost: one `nano-banana-pro` call. Surface a `~$` label (constant `DRESS_COST_USD`,
initial `0.14`; confirm against live billing). Money-explicit per convention.

## Pass 1a — panel Dress action (`CharacterLibraryPanel.vue`)

On a look: a **Dress** affordance opening an inline sheet with two tabs:
- **Garment** — upload/drop a garment photo (thumbnail preview).
- **Prompt** — a text field for the outfit (seeded from the look's `descriptor`).
- A pastel **Generate ~$0.14** (disabled until a garment or non-empty text exists),
  loading state, inline error.
- Result **preview** → **Keep** (writes the dressed image as the look's cover: upload
  the data URL via `uploadRefFile`, prepend to `refImages`, set `coverIndex: 0`) or
  **Retry**. Never silently overwrites.

"Add a look" gains a **Dress from Default** path: create a variant (label = outfit),
then dress the Default cover into it — so `Vera · Swimsuit` needs no photo hunting.

## Pass 1b — character-panel UX pass ("in light of our changes")

Grounded, bounded improvements — no schema change:

1. **Cover = identity, made legible.** The cover currently is a subtle hover button
   with no signal that it matters. Give the cover tile a persistent **"Identity"**
   badge and a one-line note: *"This photo is the character's face for video."*
   (Guardrail-copy: say the best practice where the decision happens.) Elevates the
   choice the video path now depends on.
2. **Looks framed as wardrobe.** Relabel the variant UI toward **Looks** (chips read
   `Default · Swimsuit · …`); "+ New variant" → "+ New look"; the Dress action is the
   primary way to populate one. Data stays `variants` (no migration).
3. **Source vs generated angles, for free.** Filenames already encode provenance
   (`…_source.png` vs `…_sheet_N.png`). Tag each tile with a tiny `Source`/`Sheet`
   caption (derived from the filename — no metadata change) so the flat grid stops
   hiding which photo is the real anchor vs a generated view.
4. **General polish** to the design system (hairlines, `text-[11px]` labels, pastel
   only for AI actions, emerald reserved for run) — tidy density, no restyle.

Out of scope for this pass (noted, not built): full re-generated sheet per look;
LoRA training honoring a non-Default look; garment-from-canvas/assets wiring;
character-level hero image distinct from a look cover.

## Pass 2 (later spec) — Dress node

Canvas node: person + optional garment in, dressed image out, wireable downstream;
a "save to look" action closes it back to a character. Same shared core.

## Testing
- Unit: `buildDressPrompt` (garment / text / garment+text / empty).
- Unit: `nano-gen` still honors single `image`; new `images[]` path shape.
- Browser (harness): panel renders real registry characters; Dress sheet opens,
  tabs switch, Generate disabled/enabled states, cover "Identity" badge, look chips,
  Source/Sheet captions. Navigate via `127.0.0.1` (426 gotcha). Live generation is a
  paid Replicate call — verify UI states, not the actual dress output.

## Files
- `frontend/app/lib/wardrobe/dress.ts` (new) — `buildDressPrompt`, `DRESS_COST_USD`.
- `frontend/server/api/inpaint/nano-gen.post.ts` — accept `images[]`.
- `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue` — Dress action + UX pass.
- `frontend/app/pages/dev/character-panel.vue` (new) — harness.
- `frontend/tests/unit/wardrobe-dress.unit.spec.ts` (new).
