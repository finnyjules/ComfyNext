# Restyle from image — accept a moodboard as the style source

**Date:** 2026-08-09
**Status:** Design approved, ready for implementation plan

## Plain-language summary

Today, "Restyle from image" takes a content photo plus **one** style-reference
image. Moodboards — which hold several inspiration images *and* a curated taste
reading (a prose summary, a named colour palette, and a list of things to
avoid) — can only be attached to the "Generate an image" node, never to
restyle.

This change lets you drag a moodboard straight into **Restyle from image**. When
a moodboard is attached, it becomes the style source: the board's images (up to
3) and its full taste reading drive the restyle, and the single style-image slot
is ignored. The content photo stays the subject. The result: "redraw this photo
in my moodboard's look" becomes a one-wire operation.

## Goals

- Wire a moodboard into `RestyleFromImageNode` as an alternative, overriding
  style source.
- Use the **whole** moodboard: up to 3 board images as style references **and**
  the taste reading (summary / palette / avoids) folded into the instruction.
- Reuse the existing moodboard "style channel" (TASTE wire + `style_block` +
  `style_refs` widgets) rather than build a parallel mechanism.
- Zero regression when no moodboard is attached.

## Non-goals

- `RestyleWithLoRANode` — out of scope. Its purpose is the user's trained LoRA
  as the style; a moodboard there competes with the LoRA and muddies intent.
- Model auto-switching on restyle. Restyle already defaults to Nano Banana 2
  (multi-image capable); there is no model to switch.
- Any change to how moodboards attach to `GenerateImageNode`.

## Background — how the moodboard style channel works today

A moodboard is images + a taste reading (`frontend/shared/taste/moodboard.ts`).
The `MoodboardNode` exposes one `style` output of type **TASTE**
(`MoodboardNode.vue`). That TASTE wire carries the style onto a consumer via two
hidden widgets on the consumer node:

- `style_block` (String) — the prose taste reading / palette / avoids.
- `style_refs` (String) — a `{folder, files[]}` JSON naming the board's image
  files (paths, never base64).

Every consumer path is currently hard-gated to `GenerateImageNode`:

- `capabilities.ts:138` — declares `GenerateImageNode` with `style_in` (TASTE).
- `VueNodeCanvas.vue:3115` (`handleMoodboardWire`) and `:3175`
  (`maybeApplyTasteWire`) — apply the board on wire.
- `VueNodeCanvas.vue:3204` — clears state on edge removal.
- `styleInject.ts:46` — copies `properties.style_refs`/`style_block` into the
  hidden widgets at submit.
- `moodboardApply.ts` — apply/clear logic; also the model auto-switch to
  `nano-banana-2` when the current model lacks the `multi-image` tag
  (`MOODBOARD_DEFAULT_MODEL`, gate ~line 107). **This switch is Generate-only
  and must NOT run for restyle.**

At execute time (`nodes_replicate.py`, `GenerateImageNode.execute`), a validated
`style_refs` on a `multi-image` model becomes ≤3 data URLs
(`_parse_style_refs`, `_moodboard_ref_data_urls`, `_MOODBOARD_MAX_REFS = 3`) sent
as `refs`, with `_STYLE_REFS_INSTRUCTION` appended to the prompt
("...strictly as STYLE references — match their palette, light, grain and mood;
do not copy their subjects or composition").

`RestyleFromImageNode.execute` today sends `image_input: [content_url,
style_url]` for the Nano Banana engines, or `style_image`/`structure_image` for
the IP-Adapter engine (`nodes_replicate.py` ~3095-3160).

## Design

### Backend — `RestyleFromImageNode` (`comfy_api_nodes/nodes_replicate.py`)

**Schema — add three inputs mirroring `GenerateImageNode`:**

- `style_in` — TASTE socket, optional. The moodboard wires in here.
- `style_block` — hidden String, optional. The taste reading.
- `style_refs` — hidden String, optional. The board's `{folder, files[]}` JSON.

The existing `content_image`, `style_image`, `prompt`, `structure_strength`,
`resolution`, `seed`, `output_format` inputs are unchanged. `style_image`
becomes effectively optional in the moodboard case (still declared; ignored when
a board is present).

**`execute` — branch on a validated `style_refs`:**

Reuse `_parse_style_refs` and `_moodboard_ref_data_urls` (already module-level
helpers). Let `board_urls` = up to 3 data URLs from the board.

- **When `board_urls` is non-empty (moodboard attached):**
  - **Nano Banana engine** (`model in _NANO_BANANA_SLUGS`):
    - `image_input = [content_url, *board_urls]` — first image is the
      content/subject, the rest are style references.
    - Instruction = `build_restyle_instruction(structure_strength, guidance)`
      **+** `_STYLE_REFS_INSTRUCTION` **+** the `style_block` taste text (when
      present). The style-only instruction keeps the content as subject while
      the board donates palette/light/grain/mood.
    - The single `style_image` input is ignored.
  - **IP-Adapter engine** (`fofr/style-transfer`): cannot take multiple style
    images. Fall back to `board_urls[0]` as `style_image`, keep `content_url`
    as `structure_image`, and fold the taste text into the prompt. Documented
    degradation — IP-Adapter is single-image.
- **When `board_urls` is empty (no moodboard):** behaviour is exactly as today —
  `[content_url, style_url]` (Nano Banana) or the IP-Adapter pair. Zero
  regression. If a bare `style_block` is present with no refs (unusual), it is
  appended to the instruction; otherwise ignored.

`_parse_style_refs` never raises — a malformed payload degrades to the no-board
path.

### Frontend — relax the four Generate-only gates to also accept `RestyleFromImageNode`

- **`capabilities.ts` (~174):** add a `style_in` TASTE input to the
  `RestyleFromImageNode` declaration so the wire is a legal connection.
- **`VueNodeCanvas.vue:3115` (`handleMoodboardWire`) and `:3175`
  (`maybeApplyTasteWire`):** accept both node types. Extract the node-type test
  to a small helper (e.g. `nodeTakesMoodboard(nodeType)` returning true for
  `GenerateImageNode` and `RestyleFromImageNode`) so the four sites stay in
  sync — see "shared guard" note below.
- **`VueNodeCanvas.vue:3204`:** clear moodboard state on edge removal for restyle
  too.
- **`styleInject.ts:46`:** copy `style_refs`/`style_block` into the hidden
  widgets for restyle as well.

### Frontend — apply path must skip the model switch for restyle

`moodboardApply.ts` currently, for `GenerateImageNode`, may switch the model to
`nano-banana-2` and record a `sailor_moodboard_switched` revert marker.

For `RestyleFromImageNode`:
- Attach `style_block` + `style_refs` (the images + taste).
- **Disconnect any edge feeding the `style_image` input** as part of the apply
  (remove it from the edge set), so no ignored-but-live wire remains.
- **Do not** run the model-switch branch; **do not** set the revert marker.
  Restyle's engine selector is not the shared image-model catalog, and its
  default (Nano Banana 2) is already multi-image capable.

Implement by gating the switch branch on `nodeType === 'GenerateImageNode'` while
the ref/block attachment runs for both.

### Frontend — UI

- The moodboard chip renders on the restyle node the same as on Generate
  ("MOODBOARD  refs ✓").
- **No** "Switched to Nano Banana…" banner on restyle (there is no switch).
- When a board is attached, **any edge feeding the `style_image` slot is
  disconnected** (removed from the graph) as part of the apply, so there is no
  live-but-ignored wire. The slot then renders as disabled with a tooltip:
  "Moodboard is providing the style." Removing the moodboard re-enables the slot
  (the user re-wires a style image if they want one — the disconnected edge is
  not restored automatically).

## Edge cases

- **IP-Adapter engine + moodboard:** single-image fallback (board image 0 as the
  style image; taste text into the prompt). It cannot do multi-image.
- **Removing the moodboard wire:** restores single-image restyle behaviour and
  clears the hidden widgets (via the relaxed `:3204` cleanup).
- **Malformed / empty `style_refs`:** degrades to the no-board path; never
  raises.
- **Both a moodboard AND a wired single `style_image`:** on apply, the
  `style_image` edge is disconnected so only the moodboard remains. The backend
  still ignores any `style_image` value when refs are present, as a safety net.

## Shared guard note (regression risk)

The four Generate-only checks are effectively one shared gate expressed in four
places. Relaxing them risks a second consumer diverging over time. Centralise the
node-type test in a single helper and route all four sites (plus `moodboardApply`)
through it, so "which nodes take a moodboard" has one source of truth. Grep every
consumer of the moodboard wire before finishing to confirm none is missed.

## Testing

**Python unit tests** (`nodes_replicate` restyle execute):
- Nano Banana + valid `style_refs` → `image_input == [content, ...≤3 board]`
  (content first), and the instruction contains the style-only text + taste
  block.
- `_MOODBOARD_MAX_REFS` cap honoured (a 5-image board sends 3).
- IP-Adapter + moodboard → single `style_image` = board image 0; taste in prompt.
- No-board path unchanged: `[content, style_url]` for Nano Banana, IP-Adapter
  pair otherwise.
- Malformed `style_refs` → no-board path, no raise.

**Frontend unit tests:**
- Each relaxed guard accepts `RestyleFromImageNode` and still rejects an
  unrelated node type.
- Restyle apply attaches `style_refs`/`style_block` and does **not** set the
  `sailor_moodboard_switched` marker (assert with a deliberately-broken control
  that would set it).
- Restyle apply **removes an existing edge into `style_image`** (seed the graph
  with such an edge, apply a board, assert the edge is gone and the slot
  disabled).
- Edge-removal clears the hidden widgets on restyle.

**Live verification (owed, not run at implementation time):**
- One real paid restyle-with-moodboard render. Assert the content subject
  survives and the board's look transfers. Per this repo's rule, "it rendered"
  is not evidence — confirm the moodboard path actually ran (e.g. the
  style-refs instruction and board images were in the request), not a silent
  fallover to the plain restyle path.
