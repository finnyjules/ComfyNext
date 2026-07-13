# Sketch from the prompt bar — kill the node, make sketching a typed idea

**Date:** 2026-07-12
**Status:** Approved design (user-directed), supersedes the *entry* half of the prior sketch specs
**Supersedes / builds on:**
- `2026-07-07-sketchbook-loop-design.md` (draft mode + Light Table + promote — the machinery)
- `2026-07-08-sketch-node-design.md` (draft-as-a-node — the entry model this replaces)
- `2026-07-08-sketch-node-refinement.md` (4-up grid, Enhance-as-main — the output model this reuses)

## Problem

The sketch feature has been reframed three times in two days: draft *mode* → draft *node* → 4-up *grid*. Each pivot moved the furniture without fixing the thing that actually grates: **the entry is clumsy.** To start exploring you press Space, type "Sketch", hit Enter, wait for a preset node to appear, then run it — four gestures before you see a pixel, for a feature whose entire value proposition is *speed of thought*.

The deeper mistake is treating sketching as **a thing on the canvas** (a mode you toggle, a node you place). A node that permanently sits on the canvas and spawns permanent cards on every run fights the medium: you accrete clutter while trying to think loosely. Exploration wants to be fluid and disposable; the canvas is built on permanence.

## The reframe

Sketching is not a place you go. It's **what the canvas does when you type an idea.** The persistent prompt bar (`CanvasPromptBar.vue`, the canvas agent's home) is already the always-there on-ramp — sketching should ride it instead of ignoring it.

**The loop:** type an idea → 4 cheap options bloom in view → tweak, sketch again → they refresh in place → keep the one that's working (it lifts out of the pad) → promote/enhance the keeper to real.

This dissolves the disposable-vs-permanent tension: the canvas stays a clean scratch space by default, and permanence is something you opt *into* per card by keeping it.

## Design

### 1. Intent routing — auto-detect (the entry)

The prompt bar's agent already classifies free text into commands via `app/lib/agent/commandSurface.ts`, and already intercepts a non-graph command (`searchImages`, "find me a picture of X") in `useCanvasAgent.ts`. Sketching becomes one more such command.

**New op `sketch`.** Add it to the command surface with semantic guidance: the user described a *new image to create from scratch* (a subject/scene/mood), not an instruction to modify existing nodes and not a question about the graph. The model emits `{ op: 'sketch', prompt: <cleaned image prompt> }`. Guidance hints that bias correctly: an empty/near-empty graph makes a bare idea almost certainly a sketch; imperative verbs referencing existing nodes ("add", "blur the sky", "make it warmer") are edits; interrogatives are questions.

**Interception.** In `useCanvasAgent.ts`, treat `sketch` like `searchImages`: it is never rendered as a proposal card (`cmd.op === 'sketch'` early-returns in the proposal loop, ~line 130), and in the dispatch block (~line 185) it calls a new `opts.sketchIdea?.(prompt)` callback. `CanvasPromptBar.vue` wires `sketchIdea: (prompt) => vueCanvas.startSketch(prompt)`.

**Zero added latency.** The agent LLM call already fires on every prompt-bar submit. Auto-detect gives the model one more possible output; it does not add a round trip. (A heuristic fast-path — fire the render immediately for an obvious noun-phrase idea and classify in parallel — is a deferred optimization, not v1.)

**Misfire correction is the safety net.** Auto-detect occasionally guesses wrong, so every route is one tap from its opposite:
- After a sketch fires, a quiet inline chip in the bar: *"Sketched this · edit the canvas instead?"* Tapping re-runs the same text through the agent with a directive prefix forcing edit interpretation (same re-ask mechanism `reroll` already uses).
- After an edit proposal appears, a symmetric chip: *"…or sketch it?"* — calls `sketchIdea(lastPhrase)` directly.

The correction affordance is what makes betting on auto-detect safe; it must ship with the routing, not after.

### 2. The sketch pad — output

`startSketch(prompt)` dispatches **4 Flux-Schnell images in one batched prediction** (`num_outputs: 4`, `megapixels: 0.25` — the cheap/fast tier the refinement spec already established) and materializes them as 4 `sketchOutput` Image cards in a **2×2 cluster anchored to the current viewport.**

This reuses the just-built materialization (`app/lib/sketch/planSketchCards.ts` + `VueNodeCanvas.materializeSketchCards`) almost verbatim. **The only change is the anchor:** instead of "right of a source node," the pad anchors to the **nearest clear spot in the current viewport** — computed to avoid overlapping existing cards, so a sketch is never destructive. Each card carries provenance: the pad's current `prompt`, its `seed`, and its `slot`.

Because there is no source node, slot ids key off a **synthetic per-canvas pad id** (`sketch-pad`), so slot ids read `sketch-out-sketch-pad-<slot>` and stay stable across re-sketches for in-place refresh.

**Dispatch mechanism — the one real unknown (DISCOVERY gate).** Today the batch runs because a Sketch *node* runs through the normal workflow dispatch. Without a node we need a **headless Schnell dispatch** from a raw prompt. Before building refresh/keep, confirm the cleanest route and that it lands 4 `executed` image files through the bridge:
- **Option A (preferred):** build the Schnell prompt graph in-memory (reuse the Schnell builder) and send it through the existing bridge run path, feeding the returned images straight into `planSketchCards`.
- **Option B (fallback):** spawn a transient, off-canvas GenerateImageNode (the existing preset), run it, materialize cards, discard the node. Hacky but reuses 100% of the run path.

Pick A if the in-memory dispatch is reachable; fall back to B if the run pipeline is too node-coupled to bypass. This mirrors the refinement spec's DISCOVERY gate on Change 3.

### 3. Refresh in place + keepers (the churn)

The pad tracks which of its 4 slot ids are **live** (unkept). Sketching again refreshes only live slots — same ids, new images — so the canvas doesn't accumulate.

**Keep** (action on a `sketchOutput` card) pins it: the card sheds its slot id (re-id'd to a fresh untracked id), drops `sketchOutput`/the dashed sketch ring, and becomes an ordinary Image card. It **nudges clear of the pad grid** so the pad's 4 slot positions stay unoccupied, then the next sketch refills only the freed slots. Scratch area churns; keepers accumulate deliberately.

This is the mechanism that keeps the canvas clean *and* lets winners survive — the resolution of the disposable/permanent tension.

### 4. Make it real — commit (unchanged)

Inherited wholesale from the refinement spec, now applied to pad cards:
- **Enhance** (primary): super-resolve *this exact image* via the existing `EnhanceDetailNode` (Clarity engine). Keeps the picked image, makes it real.
- **Promote** (secondary): re-render the *idea* at full quality from the card's stored prompt/seed via `sketchPromote.ts` + `sailor:spawnBeside`, model at the finisher default.

Both spawn focused, never auto-run (standing rule). Provenance now comes from the pad's stored prompt/seed rather than a source node's widgets — the card fields are the same, so the builders are unchanged.

### 5. Retire the Sketch node

The prompt bar replaces the node as the entry; keeping both reintroduces the "thing on the canvas" clutter this design escapes. So:
- Remove the synthetic **Sketch** preset entry from `useNodeSearch.ts`.
- The locked-Schnell static-model rendering branch (`data.properties.sketch === true` in `ComfyNode.vue`, from refinement Change 1) goes dead once the preset is gone — remove it for cleanliness. Legacy saved docs containing an old sketch node degrade gracefully: they render as an ordinary Flux-Schnell generator, which is correct.

Everything *downstream* of entry survives and is re-anchored: `planSketchCards`, `sketchOutput` cards, Enhance/Promote, `sketchPromote.ts`.

## Non-goals / deferred

- **Contact-sheet history / stacking rows** — explicitly rejected in favor of replace-in-place. Comparison across rounds is not a v1 concern; the Light Table already exists for takes-level compare if needed.
- **Floating-overlay pad** (options in a panel, not canvas cards) — considered and dropped; diverges too far from the built card machinery.
- **Heuristic fast-path** for auto-detect latency — deferred; the classifier adds no round trip, so v1 doesn't need it.
- **Video / edit-node sketching** — unchanged from prior specs (out of scope).
- **Remembering the preferred finisher model** for Promote — still deferred.
- **Per-node/per-sketch model opt-out** — Schnell is the sketch tier, full stop, in v1.

## Data / provenance

No new take fields. `sketchOutput` cards already carry the fields Promote/Enhance need (image, prompt, seed, slot). The pad introduces one synthetic per-canvas anchor id (`sketch-pad`) and a small live-slot registry, both canvas-runtime state — no ProjectDoc schema change, no migration.

## Testing

- **Unit:** `sketch` op present in the command surface with routing guidance; classifier routes a bare image idea → `sketch`, an imperative graph edit → not `sketch` (intent-corpus cases); `planSketchCards` anchored to a viewport spot (nearest-clear-spot finder avoids existing cards); keep re-ids a card off the slot registry and frees its slot; Promote/Enhance override builders from a pad card's provenance.
- **Discovery (§2):** confirm the headless Schnell dispatch yields 4 `executed` images through the bridge and where they land, BEFORE building refresh/keep.
- **Browser (visuals verified by screenshot before ship):** type an idea → 4 cards bloom at a clear spot; re-sketch → same 4 slots refresh in place; keep → one card lifts out (ring gone), next sketch refills only freed slots; misfire chip flips a sketch into an edit and vice-versa; no Sketch entry in node search; Promote spawns a full generator, Enhance spawns a Clarity node. (Paid-render steps owed to the user as before.)

## Sequencing

1. **`sketch` op + classifier routing** — command surface + `useCanvasAgent` interception + `sketchIdea` callback (unit-testable, no UI yet).
2. **Headless dispatch DISCOVERY** + **`startSketch`** — 4 Schnell to the nearest clear spot, reusing `planSketchCards`.
3. **Refresh-in-place + keep** — live-slot registry, re-id on keep, nudge-clear.
4. **Misfire correction chips** — both directions in `CanvasPromptBar`.
5. **Retire the Sketch node** — remove preset + dead rendering branch.
6. **Promote/Enhance on pad cards** — verify the reused paths against viewport-anchored cards.
