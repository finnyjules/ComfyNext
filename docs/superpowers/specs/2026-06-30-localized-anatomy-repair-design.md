# Localized anatomy repair (hands/faces) — design

**Date:** 2026-06-30
**Status:** Approved, pre-implementation

## Problem

Generations frequently come out with botched hand anatomy (extra/missing/fused
fingers), and to a lesser extent mangled faces and limbs. The agent's
run→look→fix reviewer (`buildResultReviewPrompt`, commit `f60dc10c8`) already
*detects* this defect, but the fixes it can propose are both blunt:

- **Re-roll** (`setWidget` the generator's seed) — a pure gamble; a fresh roll
  may fix the hand or botch something else.
- **Full-image `EditImageNode`** ("fix the left hand to five fingers") — sends
  the whole 1024² back through a model, so it can drift the face, background,
  and other untouched content while repairing the hand.

The proven production technique (ADetailer / hand-refiner pattern) is
**localized**: detect the bad region → mask only it → regenerate inside the mask
→ composite back. Everything outside the mask is preserved by construction. We
have all the plumbing for this already; nothing currently points it at anatomy.

## Goal

One shared **localized anatomy-repair capability**, invoked by two callers:

1. **The agent** — its existing suggest-only fix-loop proposes a localized repair
   (instead of re-roll / full-image edit) for anatomy defects, with the bad
   region localized automatically (no human click).
2. **A manual button** — a "Fix hands" action on the result card the user
   triggers when they spot a bad hand, clicking the hand themselves.

Build the repair pass once; expose it to both.

## Non-goals

- Depth/mesh-guided hand refinement (MeshGraphormer-style). Deferred fidelity
  upgrade — see "Deferred" below.
- A dedicated hand/pose detection model. Localization reuses the VLM the reviewer
  already runs (path A). A hybrid detector fallback is a later upgrade.
- Fixing anatomy at generation time (negative prompts, model swaps). This is a
  post-hoc repair of an already-generated result.

## Architecture

### Component 1 — the repair pass (shared core)

**New server route:** `POST /api/inpaint/fix-anatomy`

Thin glue (~40 lines) over two routes we already ship.

Request body:
```
image  string            data URL or public http URL of the source image
point  { xPx, yPx }      click point in source pixel space (mutually exclusive with bbox)
bbox   [x, y, w, h]      normalized [0..1] box; center is used as the click point
kind   'hand'|'face'|'limb'   selects the canned repair prompt (default 'hand')
count  number            variations to generate (default 2, max 4)
seed   number            optional base seed for reproducible retries
```

Flow:
1. Resolve a click point: `point` if given, else the center of `bbox` mapped to
   pixel space.
2. **Mask** — call the existing SAM-2 path (the logic behind
   `/api/inpaint/segment`) with that point → tight silhouette mask
   (white = repair, black = keep).
3. **Repair** — call the existing `/api/inpaint/flux-fill` (dev tier) with the
   source image + mask + a canned, `kind`-specific prompt, `count` variations.
4. Return `{ images: string[] }` — full images with **only the masked region**
   changed.

Canned prompts (kept in one constant, single source of truth):
- `hand` → "a natural human hand, five fingers, anatomically correct, matching
  the image's existing style, skin tone and lighting"
- `face` → "a clean, natural human face, correct eyes and features, matching the
  image's existing style and lighting"
- `limb` → "a natural, anatomically-correct limb matching the image's existing
  style and lighting"

Degradation: if SAM-2 returns a junk mask (empty, or covering most of the
frame), the route returns a `409` with a `reason` so callers can fall back
(agent → re-roll; manual → manual brush). This mirrors how
`/api/inpaint/segment` already degrades to manual brushing on failure.

### Component 2 — the agent caller (path A localization)

**Schema change** (`buildReviewSchema` / result-review): when the reviewer flags
an anatomy issue, it also returns a normalized **`bbox`** of the defect. The VLM
is already looking at the image and naming the bad hand; we ask it to point at
it. (Added as part of the `fixAnatomy` command's args, below — not a new
top-level schema field.)

**New fix op `fixAnatomy`** added to the result-review command vocabulary
(`buildResultReviewPrompt` instructions + the command registry that backs the
review's `op` enum):
```
op:     'fixAnatomy'
target: <result node id>
args:   { kind: 'hand'|'face'|'limb', bbox: [x,y,w,h], note: '<what's wrong>' }
```
The reviewer prompt is updated so that **for anatomy defects it proposes
`fixAnatomy`** as the primary fix, keeping re-roll only as the fallback when it
cannot localize the defect (no usable bbox).

**Execution** (`useCanvasAgent`, stays suggest-only): on user accept of a
`fixAnatomy` command, map `bbox` → repair route → produce a new result card.

**Verify + bounded retry:** the existing look-loop re-reviews the repaired card.
If the same region is still wrong, retry **once** with a fresh flux-fill seed,
then stop. Hard cap of 2 repair attempts per defect to bound cost.

**Auto-pick:** the agent path generates `count: 2`, then the verify-review picks
the variation that reads as fixed (no extra user click). If both fail the verify,
the retry fires; if the retry also fails, the agent reports it couldn't repair it
cleanly and offers re-roll.

### Component 3 — the manual button

A **hand icon** on the result-card toolbar, beside the existing
eraser/brush/download/lock/refresh icons. Emerald-on-hover, consistent with the
run-affordance color language (no purple accents).

Interaction:
1. Click the hand icon → prompt "tap the bad hand".
2. User clicks the hand on the result image → click point in pixel space.
3. Call the **same** repair route with that `point`, `kind: 'hand'`, `count: 2`.
4. Show the 2 variations; user picks one → it replaces / becomes the result.

This reuses the existing click-to-segment UX (the InpaintModal click path), so
there is almost no new UI surface — just the toolbar icon and a small
2-variation picker (which the inpaint flow already has).

## Data flow (both callers converge)

```
                       ┌─ agent: VLM bbox (auto) ─┐
  bad result image ──► │                          ├─► /api/inpaint/fix-anatomy
                       └─ manual: user click ─────┘            │
                                                               ▼
                                            SAM-2 segment → mask (point)
                                                               │
                                                               ▼
                                  flux-fill-dev (mask + canned prompt, count 2)
                                                               │
                          ┌────────────────────────────────────┤
                          ▼                                     ▼
                 agent: verify-review auto-pick        manual: user picks 1 of 2
                          │                                     │
                          ▼                                     ▼
                   new result card                       replaces result
```

## Error handling

- **SAM junk mask** → route `409 { reason }`. Agent falls back to re-roll;
  manual falls back to "couldn't isolate the hand — try the brush" (existing
  inpaint manual path).
- **flux-fill failure / timeout** → surfaced to the caller; agent reports it in
  its message, manual shows a toast. No silent swallow.
- **No usable bbox from the VLM** → reviewer keeps re-roll as the proposed fix
  (current behavior), never emits a `fixAnatomy` with a missing/whole-frame box.
- **Repair still wrong after retry** → stop at the cap; agent says so plainly and
  offers re-roll rather than looping.

## Testing

- **Unit (route):** point resolution from `bbox` center; canned-prompt selection
  by `kind`; junk-mask → 409 mapping. Mock the SAM and flux-fill calls.
- **Unit (protocol):** `fixAnatomy` decodes via `decodeCommandList`; bbox/kind
  args round-trip; reviewer schema accepts the new op in its `op` enum.
- **Unit (agent loop):** verify-and-retry caps at 2 attempts; fallback to re-roll
  when no bbox / repeated failure.
- **Manual visual verification:** per the project's standing rule, do not ship a
  visual change on unit tests alone — run a real botched-hand generation through
  both the manual button and the agent path, screenshot before/after, confirm
  the hand is corrected and the rest of the image is byte-stable outside the
  mask. Get look sign-off.

## Deferred (documented, not built)

- **Depth/mesh-guided hand refiner** (MeshGraphormer-style structural guidance) —
  the fidelity upgrade for cases where plain FLUX-Fill re-botches a hand. Build
  only if the verify-loop shows real misses in practice. Treated like IC-Light /
  Topaz: documented as the next tier.
- **Hybrid localization** (path C) — fall back to a dedicated hand/pose detector
  when the VLM bbox yields a junk SAM mask. Adopt if VLM-box misses pile up.
- **Multi-hand batching** — repairing two bad hands in one pass. v1 handles the
  worst region; a second pass repeats for a second hand.

## Files touched (anticipated)

- `frontend/server/api/inpaint/fix-anatomy.post.ts` — NEW route (the shared core).
- `frontend/app/lib/agent/protocol.ts` — `fixAnatomy` op; reviewer schema gains
  `bbox` in the fix args; result-review prompt updated to prefer localized repair.
- `frontend/app/composables/useCanvasAgent.ts` — execute `fixAnatomy`,
  verify+retry loop, auto-pick.
- Result-card component (toolbar) — hand icon + click-to-repair manual flow,
  reusing the existing click-to-segment + variation-picker UX.
