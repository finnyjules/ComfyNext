# Artifact generator actions — grouped Edit menu + post-render chip strip

**Date:** 2026-07-02 · **Status:** approved design, pre-plan
**Context:** ARPU levers 2 + 5 ([build order](2026-07-01-arpu-levers-build-order.md), [pricing §6](2026-07-01-costs-and-pricing-model.md)). Surface the paid escalators (Enhance Detail, Upscale, Relight, Lens/Reframe, Variations, Animate) directly on the image artifact instead of leaving them as nodes users must go find.

## Scope

`ArtifactImageNode.vue` only (image artifacts). Video/audio artifacts, frames, and studio exports are out of scope for v1. Two deliverables, shippable independently, in this order:

1. **Grouped Edit menu** — restructure the existing top-right Edit… dropdown into three sections with the six new actions and credit hints.
2. **Post-render chip strip** — a transient one-tap row that appears under the image when a fresh render lands.

## Part 1 — Grouped Edit menu

The existing dropdown ([ArtifactImageNode.vue:500](../../../frontend/app/components/vue-canvas/ArtifactImageNode.vue)) grows from 4 flat items to 10 items in 3 labeled sections. Single pastel Edit… button stays as-is.

| Section | Item | Behavior | Hint |
|---|---|---|---|
| **Retouch** | Remove BG | existing (splice `BackgroundRemove`) | — |
| | Inpaint | existing (modal) | — |
| | Edit (Nano Banana) | existing (splice `EditImageNode`) | ~12cr |
| | Fix | existing (`comfynext:critiqueNode`) | — |
| **Enhance** | Enhance Detail | splice `EnhanceDetailNode`, focus, **don't run** | 14–28cr |
| | Upscale | splice `UpscaleImageNode` with defaults, **auto-run it** | ~14cr |
| | Relight | splice `RelightNode`, focus, **don't run** | ~12cr |
| | Lens · Reframe | splice `LensReframe`, focus, **don't run** | ~12cr |
| **Create** | Variations ×4 | queue 4 scoped re-runs with fresh seeds; results land in the existing Takes strip | 4 runs |
| | Animate | spawn `shot-director` node seeded with this image as primary reference, wired + focused, **don't run**; preset gallery opens on the way in (build-order slice 2.1) | from 160cr |

**The behavior rule (user-approved "mixed per action"):** actions that need aiming (Relight gimbal, lens choice, engine picker, shot direction) spawn their node pre-wired and focused but un-run — nobody pays before they've aimed. True one-taps (Upscale, Variations) execute immediately.

### Mechanics

- All splice actions reuse the existing `comfynext:applyEffect` → `spliceAfterNode(nodeId, nodeType, outType, widgetOverrides)` path (VueNodeCanvas.vue:1508). New need: a `run: false | true` flag on the event detail so Enhance/Relight/Lens splice without running while Upscale splices then dispatches `comfynext:runFiltered` at the new node. Also a `focus` behavior: select + pan the new node into view.
- **Animate** is the one non-splice spawn: `shot-director` is a frontend-only Vue node, so it needs its own event (`comfynext:animateArtifact`) handled in VueNodeCanvas — create the node at +360px, wire artifact → its reference input, hydrate the image as primary ref (`@Image1`), open the preset gallery modal.
- **Variations** dispatches 4 sequential `comfynext:runFiltered` events targeting this artifact. Requirement: each run must randomize the *upstream producing generator's* seed (otherwise 4 identical outputs). If the existing `'self'` reroll scope doesn't reach upstream seeds, add an `'upstream-seed'` scope to `runFiltered` rather than bending `'self'`. ComfyUI's queue serializes the runs; each `executed` event appends a Take.
- **Credit hints** live in one constants file `frontend/app/lib/artifact/actionPricing.ts` (static map, comment pointing at the pricing doc; 1cr = $0.01). Right-aligned, `text-white/35`, tabular-nums. This is the "finals cost money" mental-model seed — no billing dependency.

### Edge cases

- **No upstream generator** (user-uploaded image): Variations is disabled with tooltip "Nothing upstream to re-run — this image was uploaded." Everything else works (they operate on the image itself).
- **Node type missing from schema** (ComfyUI not restarted / not running): `spliceAfterNode` already fetches object info; on failure, `toast.error` naming the node, menu closes.
- **Menu height:** 10 rows + 2 section headers ≈ 320px — fine within canvas; keep `min-w` ~170px for hint column.

## Part 2 — Post-render chip strip

A transient chip row appears **under the image, above the footer** when a fresh render lands on this artifact (hook: the same `appendTake()` path that feeds the Takes strip). Contents:

> `✦ Variations` · `Upscale ~14cr` · `Animate` · `More…`

- Chips call the identical action functions as the menu; **More…** opens the Edit menu.
- **Transience rules:** appears only on a render completing *while the canvas is open* (never on load / stale artifacts); auto-dismisses after ~12s or on any click elsewhere on the canvas; only the most recently rendered artifact shows a strip (a new render elsewhere dismisses the old one); dismissed = dismissed, no re-show for that take.
- **Styling:** matches the dark chip idiom (bg-black/60, white/70 text, hover white/10) — not pastel, so it reads as suggestion rather than primary CTA. No purple. Subtle fade/slide-in; no pulse or attention-grabbing animation.
- **Extension point, not v1:** the critique loop injecting a contextual "Fix hands" chip when it finds a defect. The strip's chip list should be a computed array so this is an append later, but no critique wiring now.

## Error handling

- Upscale auto-run failure: existing run-failure path (node error state) — no charge on failure is the trust wedge, nothing new needed.
- Variations mid-queue cancel: user can cancel from the existing queue UI; no special handling.
- Chip strip must never block the image or the output handle (right-edge, vertical center).

## Testing

- Unit: `actionPricing.ts` map completeness (every menu action has a hint or explicit `null`); a pure helper deciding chip-strip visibility (fresh-take + not-dismissed + is-latest) tested over its state matrix.
- Manual (preview): each of the 6 actions from the menu on a rendered artifact — verify spawn/wire/focus/run behavior per the table; Variations on an uploaded image (disabled); chip strip appear/dismiss rules; menu on a narrow node.

## Out of scope / later

- Critique-loop chip injection ("Fix hands" at the moment of defect).
- Same actions on video artifacts, frames, studio exports (lever 2 says "every image, everywhere" — v1 proves the pattern on the highest-traffic surface first).
- Real metering/billing wiring; hints are static constants until the billing spec's price_book lands.
- Batch/×N as a first-class API (Variables & data-merge lever); Variations-as-4-reruns is deliberately the cheap version.
