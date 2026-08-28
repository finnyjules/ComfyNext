# Canvas sketch review strip — design

**Date:** 2026-08-28
**Scope:** Replace the canvas prompt-bar sketch flow's auto-placed **pile node** with a **review-then-commit strip**. When a prompt yields four instant sketches, they appear in a transient strip docked above the prompt bar — the user reviews, then commits exactly one to the canvas (via Keep or drag-to-place) and the strip closes. Generation is unchanged.

Design converged with the owner via visual brainstorming (mockups in `.superpowers/brainstorm/83435-1787940921/`; final = `docked-final.html`, placement A).

## Why

The prompt-bar sketch flow currently drops a **SketchPile deck node** straight onto the canvas — four near-identical sketches stacked, whether the user wanted them placed or not. The owner's take on it: the sketches themselves are fine, but auto-placing a pile is worse UX than the studio's **take strip** — a calm tray you look at *first*, from which only your pick becomes real. This ports that review-then-commit model to the canvas. It does **not** change what generates the four (one image prediction, one seed, four variations — kept as-is; the "four are near-identical" property does not bother the owner and is out of scope).

## The model (owner-confirmed)

1. User types an image idea into the canvas prompt bar → the existing sketch fast-path generates four instant sketches (unchanged).
2. The four appear in a **review strip docked above the prompt bar** (placement A) — an ephemeral overlay, **not** a canvas node. The canvas stays fully visible behind it.
3. **Hover** a tile → a preview pops above the strip (look before committing).
4. **Commit one, two ways:**
   - **Drag** a tile onto the canvas → it lifts, a ghost (the full sketch) follows the cursor, and dropping places the image node exactly there.
   - **Keep** → places the currently-selected tile at an open spot in view (the no-aim quick path).
5. Either commit creates **exactly one** image node and **closes the strip**; the other three sketches are discarded.
6. **Cancel** → nothing lands, strip closes. **Re-roll** → four fresh sketches for the same prompt (replaces the current four).

## What changes vs today

- **Removed from the canvas:** the auto-placed `sketch-pile` node presentation for the prompt-bar flow. The batch no longer materializes as an on-canvas deck the user must then curate in place.
- **Added:** a transient review strip overlay (canvas-level), and a single committed image node on Keep/drop.
- **Unchanged:** the hidden sketch-pad generator, the batch prediction (`buildSketchPilePayload` / `refreshSketchPile`), the seed model, and the committed output being an ordinary image node (the existing "sketch-output card" image loader that a kept sketch already becomes today).

Open question for implementation (not blocking the design): whether the visible **Sketch node** path (not the prompt-bar path) also adopts the strip, or keeps its pile. Default: **prompt-bar flow only** in this pass; the visible Sketch node is a follow-up.

## Component

A **new canvas-level component** (working name `SketchReviewStrip.vue`) that **borrows the take strip's visual vocabulary** (calm dark tray, pure-image tiles, hover-preview, the Keep-accent/Cancel-text/neutral-Re-roll hierarchy) but is **not** a reuse of `TakeStrip.vue` — the canvas context differs materially: the tiles are finished sketch images (not studio takes keyed to a live preview), the commit is drag-to-place or Keep-to-canvas (not a studio config commit), and there is no central studio preview to drive on hover. Shared visual constants/classes may be factored out if it stays DRY without contorting either side; otherwise the two stay separate and merely consistent.

It is **presentation + a commit gesture**: it takes the four sketch images and reports what the user did (drop at a canvas point, keep, cancel, re-roll). The canvas host (`VueNodeCanvas.vue`) owns turning a commit into an image node at the right position and tearing down the transient sketch-pad state.

## Interaction details (settled defaults)

- **Placement:** docked above the prompt bar, bottom-center, over a blurred hairline tray; canvas fully visible behind (no dim).
- **Hover vs drag disambiguation:** hover (no button) → preview pops; press-and-move on a tile → drag begins (the tile lifts, ghost follows). A click without drag selects the tile (for the Keep path). Standard pointer-drag threshold (~4px) separates a click from a drag.
- **Drag ghost:** the **full sketch** image (lightly scaled/rotated for lift), not a smaller chip — it reads as "this picture is going onto the canvas."
- **Drop target:** anywhere on the canvas; the node is created at the drop point in canvas coordinates (account for pan/zoom transform).
- **Keep landing spot:** an open spot in view near the sketch-pad anchor / viewport, reusing the existing keeper-placement logic (`planKeptCard`) so a committed sketch lands where a developed keeper lands today.
- **Re-roll:** stays **in the strip** (alongside Cancel + Keep), matching the studio take-strip bar. Neutral/white treatment; Cancel is quiet text; Keep is the action-blue accent.
- **Keyboard/touch:** the strip is reachable without hover — focus a tile → preview + it becomes the Keep target; Enter/Keep commits. (Drag is pointer-only; Keep is the non-pointer path.)
- **One at a time:** a new prompt or Re-roll while a strip is open replaces its four; there is only ever one review strip.

## Non-goals

- No change to sketch **generation** (four near-identical, one seed) — explicitly kept.
- No curation / eye-pick / diversity pass (that was considered and deferred — a possible later follow-up, with its latency/cost tradeoff).
- Not the studio take strip (already shipped) and not the visible Sketch node's pile (follow-up).
- No multi-keep / cherry-pick — exactly one commit closes the strip (owner-confirmed).

## Testing

- Strip presentation: given four sketch images, renders four pure-image tiles + Cancel/Re-roll/Keep with the take-strip hierarchy; docked position; hover reveals a preview.
- Commit — Keep: emits a keep for the selected tile; host creates one image node (at the keeper spot) and closes the strip; the other three are discarded.
- Commit — drag: a pointer drag past threshold emits a drop with the tile's index and the canvas-space point; a click under threshold selects (does not drop). Host creates the node at that point.
- Cancel: emits cancel, no node created, strip closes. Re-roll: emits re-roll, strip stays open with a fresh four (host swaps the images).
- Canvas integration: dropping accounts for pan/zoom (node lands under the cursor, not at raw screen px); no orphaned sketch-pad/pile nodes remain after commit or cancel.
- Regression: the prompt-bar sketch fast-path still triggers generation the same way; the committed node is the same image-loader shape as today's kept sketch.
