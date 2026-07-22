# Sketch pile — one deck node + expanding stack overlay

**Date:** 2026-07-21
**Status:** Approved design
**Builds on:** 2026-07-12-sketch-from-the-prompt-bar-design.md (the pad flow), 2026-07-08-sketch-node-design.md + -refinement.md (the Sketch node), and the BatchGrid pile/gallery convention (`BatchGridNode.vue` / `BatchGridModal.vue`).

## Problem

A sketch currently materializes **4 loose Image cards** in a vertical column (prompt-bar pad flow), and a Sketch node's batch lands only as a take on the node's filmstrip (the beside-the-node card fan-out was retired). Four independent cards clutter the canvas, read as four commitments instead of one draft moment, and drag slot/hole bookkeeping (`planSketchCardsAt`, `vacateSketchSlot`) through the codebase. Smart Layout batches already solved this presentation problem with the messy pile + expand-to-gallery pattern.

## Design

### 1. One SketchPile node replaces the 4 cards

A new **frontend-only** Vue Flow node, `SketchPileNode.vue`, holding its data in `properties.sailor_sketch` (rehydrates with the workflow, mirrors `sailor_batch`; excluded from the Run execution path like other frontend-only nodes):

```ts
interface SketchPilePayload {
  prompt: string        // the distilled subject prompt for the whole batch
  seed: number          // the batch's shared seed (one prediction → one seed)
  sourceNodeId: string  // the generator to re-run on re-roll — the hidden pad
                        // node (prompt-bar flow) or the Sketch node itself
  items: { image: string }[]  // up to 4 /view URLs, batch order
  loading?: boolean     // skeleton state while a (re-)sketch is in flight
  keptCount: number     // kept/developed cards placed so far (keeper-column march)
}
```

Per-item prompt/seed props are unnecessary: a batch of 4 comes from one prediction, so all items share the payload-level prompt/seed (exactly what `materializeSketchCardsAt` stamps identically on all 4 cards today).

**Visual:** the BatchGrid messy pile — cover uncropped, up to two id-seeded tilted peek cards, count badge. The pile visual (cover + peeks + tilt math) is **extracted from `BatchGridNode.vue` into a small shared presentational component** (`PileStack.vue`) so the two piles cannot drift. SketchPile wears the sketch identity token: dashed neutral ring (house draft token — never pastel, never purple). While `loading`, the pile renders as a dashed shimmer skeleton (same `sketch-shimmer` treatment the pad cards use today).

**Actions on the node:** click opens the stack overlay (also an explicit expand button in the top-right rail, mirroring BatchGrid). No ZIP.

### 2. The stack overlay (click → pile expands)

`SketchStackOverlay.vue`, **owned by `VueNodeCanvas`** (codebase convention: node-local modal state doesn't survive Vue Flow re-renders), opened via `sailor:openSketchStack { nodeId }` (mirrors `sailor:openBatchGallery` wiring).

- **Canvas dims** (same scrim treatment as BatchGridModal), Escape / click-outside closes.
- **The expansion is the feature:** on open, the overlay measures the pile node's projected screen rect (Vue Flow viewport transform) and the item images animate from that origin to their slots in a **vertical stack** — transform transition, slight stagger, quick ease (~200ms per house motion). Close reverses the morph back into the pile.
- **Stack layout:** one column; each image renders at **the same on-screen size it has on the canvas** (the pile's rendered size at the current viewport zoom), so the expansion is a pure translate morph — no scaling between pile and stack. Clamped to a sane floor/ceiling (~120–320px cover width) so extreme zoom levels stay usable; the column scrolls when the stack exceeds the viewport. Hover reveals the actions.
- **Per-image actions:**
  - **Develop** (primary) — today's card "Refine…" semantics, verbatim: the picked image first lands as an ordinary Image card beside the pile (it needs a real node to wire from), then an **`EditImageNode` (model `Nano Banana 2`)** is spawned wired from that card via the existing `sailor:applyEffect` splice path (`output: 'IMAGE'`, `branch: true`, `focus: true`) with the polish prompt `"Turn this rough into a polished, finished, highly detailed image — keep the same composition and subject."`. Focused, **never auto-run** (standing rule). Closes the overlay. This preserves the exact pixels the user picked — no prompt/seed re-render.
  - **Keep as image** (secondary, subtle) — creates an ordinary Image card beside the pile holding that image, no sketch properties, no editor. Free, no generation. Overlay stays open. Kept/developed cards march down a keeper column to the pile's left (`keptCount`).
- **Footer: Re-roll all 4** — patch a **fresh seed** onto `sourceNodeId`'s seed widget and re-dispatch the scoped run (`sailor:runFiltered`, `direction: 'self'`, `skipCostConfirm`), exactly one mechanism for both flows. The stack items swap to shimmer placeholders in place (overlay stays open), the pile underneath enters `loading`, and the new batch replaces `items` when it lands.

### 3. Flow wiring

**Prompt-bar pad flow:** `sketchAt` materializes **one** SketchPile node at the anchor (skeleton, `loading: true`) instead of 4 skeleton cards. When the pad's batch executes (`properties.sketchPad === true` routing, unchanged), the handler writes the images + provenance into the pile's payload instead of calling `materializeSketchCardsAt`. Re-sketch from the bar reuses the same pile node (stable id per pad, replacing the slot-id machinery).

**Sketch node flow:** in the executed-take handler, when a node with `properties.sketch === true` lands a take with `images.length > 1`, materialize-or-update a SketchPile node **to its right** (same `sourceNodeId`-relative placement as the spawn handlers), `sourceNodeId` set. The node's own take/filmstrip append is **unchanged** (provenance, Light Table compare all keep working); the pile is the presentation surface for choosing. Re-running the node refreshes the same pile.

**Re-roll mechanics:** pad flow — regenerate `sketchPad.seed` and re-dispatch the pad generator (existing path). Node flow — trigger the source node's normal run with a fresh seed (the seed widget randomizes unless locked, matching a manual re-run).

### 4. Retirements (the payoff deletions)

- `planSketchCardsAt` slot/hole positional-id machinery, `sketchPad.cardIds`/`keptCount` bookkeeping, and `materializeSketchCardsAt`'s multi-card create/reuse branches collapse into "write one pile payload".
- `keepSketchCard.ts` (`stripSketchProperties` / `vacateSketchSlot`) + the `sailor:keepSketchCard` handler, and the per-card Keep/Refine footer + `sketchLoading` skeleton on `ArtifactImageNode.vue` are deleted. Saved canvases holding old sketch cards degrade gracefully: their `sketchOutput`/`sketchPrompt` properties become inert and the cards render as ordinary images.
- `handlePromoteSketchOutput` + `sketchPromoteOverridesFromProps` (the pad-card prompt/seed promote — already superseded on the cards by Refine) are deleted. `sketchPromoteOverridesFor` (the take-based Sketch-node Promote on the takes strip / Light Table) **stays** — takes are untouched by this design.
- `planSketchCards.ts` (the never-wired 2×2 grid planner) and its tests are deleted outright.

## Out of scope

- Multi-select develop / develop-all.
- Draggable images out of the overlay onto the canvas (Keep-as-image covers the need).
- Any change to Light Table / takes on the Sketch node.
- Pile behavior for non-sketch multi-image takes (BatchGrid owns Smart Layout; generators keep the filmstrip).

## Testing

- **Unit:** SketchPile payload build/refresh from an executed batch (pad + node flows, including re-roll replacing items and preserving node id); stack item sizing clamp; keeper-column placement math; keep-as-image node construction (plain image, no sketch props).
- **Browser (free/local):** prompt-bar sketch → one shimmer pile appears (not 4 cards); pile click → overlay morph → stack; Escape collapses back; Keep-as-image drops a plain card beside the pile.
- **Paid-render (owed to the user, per standing checklist):** real batch fills the pile; Develop spawns the seeded finisher beside it; Re-roll refreshes all 4 in the open overlay; Sketch-node run materializes/refreshes the pile beside the node.
