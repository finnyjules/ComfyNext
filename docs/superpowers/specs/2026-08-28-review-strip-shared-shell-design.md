# Shared review-strip shell — design

**Date:** 2026-08-28
**Scope:** Extract the studio take strip's visual shell into one shared component so the **canvas sketch review strip looks identical to the gradient-studio take strip** — and can't drift from it again. Two consumers only: `studio/TakeStrip.vue` and `SketchReviewStrip.vue`. The node-level take-history row (`TakesStrip.vue`, plural) is explicitly **out of scope**.

## Why

The canvas sketch review strip ([SketchReviewStrip.vue](../../../frontend/app/components/vue-canvas/SketchReviewStrip.vue)) shipped looking materially different from the review strip we refined in the studios ([studio/TakeStrip.vue](../../../frontend/app/components/vue-canvas/studio/TakeStrip.vue)): small 64px chips in a single cramped row with an inline Cancel/Re-roll/Keep bar and a hover-preview popup, versus the take strip's big 96px tiles in a two-row layout (tiles over a full-width actions bar) with per-card Keep revealed on hover. They shared only surface details (the action-blue selection ring, StudioButton hierarchy, action naming). Root cause: the sketch strip was built to a fresh mockup that itself drifted from the shipped take strip, instead of to the take strip itself.

Owner intent (verbatim): *"i just want the sketch flow to look like what we landed on with gradient studio."* The fix is to make the shared **look** come from ONE place, while each strip keeps only what is genuinely its own.

## The two consumers, and what is genuinely different

| | studio/TakeStrip | SketchReviewStrip |
|---|---|---|
| Items | `VibeTake[]` keyed by object, thumbs `Map` | `string[]` image URLs by index |
| "Current" anchor + divider | yes (compare-against + one-tap undo) | no (sketches become new nodes, nothing to compare) |
| Per-tile extras | rationale tooltip; pending tile; error tile | none |
| Hover semantics | drives the parent's live studio preview; Esc handling | (removed — see below) |
| Commit gesture | per-card Keep | per-card Keep **+ drag-to-place** (ghost + `dropAt`) |
| Surface | translucent panel inside the studio modal | solid dark floating tray over the canvas |

Everything else — tile size, clip, selection ring, the hover/focus/selected action-reveal mechanic, and the two-row tiles-then-actions-bar layout — is shared and must be pixel-identical.

## What the sketch strip becomes (owner-confirmed)

- **Four 96px tiles** filling the row (up from 64px chips), each the full sketch, `object-cover`, rounded, action-blue ring when selected.
- **Hover / focus a tile → Keep appears on the tile** over a gradient scrim (bottom-right), exactly like the take strip. Clicking Keep commits that sketch.
- **A real actions bar below the tiles:** Cancel (left) · ↻ Re-roll (right). Keep is per-card, not in the bar.
- **Drag-to-place unchanged:** press-and-drag a tile lifts the full-sketch ghost onto the canvas; drop places one image node under the cursor.
- **Removed:** the 64px chips, the single inline all-in-one-row bar, and the separate hover-preview popup (the 96px tile is now the preview — and that popup was the source of a live overflow-clipping bug).

One interaction shift for the owner: to Keep without aiming, hover the tile and click its Keep (or drag it) — the take strip's exact interaction — instead of clicking a chip then a bar button.

## Why a shared TILE, not a shared shell

The take strip is the locked reference: its unit suite pins the strip-level DOM tightly (row-children order = current, divider, then cells; each cell wraps the tile; hover lives on the cell; the "current" anchor + marker; the rationale tooltip; pending/error tiles; aria) across ~30 assertions, plus an import-purity test that fails if `TakeStrip` imports anything beyond `vue` / `StudioButton.vue` / `~/lib/vibePrompt`. Wrapping the WHOLE strip in a shared shell would force that shell to reproduce every one of those structural expectations and would rewrite the take strip's proven layout. Lower-risk and a cleaner boundary: share the **tile** — the exact unit that drifted (size, clip, selection ring, the hover-reveal overlay) — and let each strip keep its own strip-level layout, made identical by both pulling the same tray/bar style constants. This is literally the "one tile chrome + selection-ring source of truth used by both" the owner asked for.

## The shared units

**New:** `frontend/app/components/vue-canvas/studio/ReviewTile.vue` — the tile chrome, presentation only. Knows nothing about takes, sketches, nodes, or studios.

- **Renders:** a `<button>` at fixed **96px** height, rounded-`[5px]` clip, `border` = `selected ? 'border-action ring-1 ring-action' : 'border-white/12 hover:border-white/30'`; sets `data-testid` (from a `tileTestid` prop), `data-selected` (`'true'`/`'false'`), `aria-pressed`, and — when a `label` prop is given — `data-label` + `aria-label`. A `#default` slot is the tile content (image, or the consumer's pending/error span). A `#actions` slot renders inside a **reveal overlay** (`pointer-events-none absolute inset-x-0 bottom-0 … bg-gradient-to-t from-black/85`, `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`, forced `!opacity-100` when `selected`) — the per-card Keep goes here.
- **Props:** `tileTestid: string`, `selected?: boolean`, `label?: string`, `draggable?: boolean` (default false; when true it wires the drag pointer contract below).
- **Events:** `@click`, `@focus`, `@blur` fall through to the button; the consumer binds them.
- **Drag contract (only when `draggable`):** ReviewTile owns the button element, so it owns **pointer capture** — capture must be on the `pointerdown` target or move/up re-target the moment the pointer leaves the tile (the exact Task-2 bug, invisible to jsdom). ReviewTile calls `setPointerCapture`/`releasePointerCapture` on its own element (guarded for the test env) and **emits** `tilepointerdown`/`tilepointermove`/`tilepointerup`/`tilepointercancel`, each with the raw `PointerEvent`. The consumer runs the gesture (threshold, ghost, `dropAt`, click-guard, cancel-cleanup) from those. The tile's own `<img>` (consumer-provided in `#default`) carries `draggable="false"` to stop native image-drag.

**Shared styles:** `frontend/app/components/vue-canvas/studio/reviewStripStyles.ts` — the strip-level class strings both strips use so the tray + bar are identical: `TRAY_PANEL` (`rounded-[8px] border border-white/10 bg-white/[0.03] p-2`), `TRAY_FLOATING` (`rounded-[9px] border border-white/10 bg-[#0b0d11]/95 p-2 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur`), `TILES_ROW`, `ACTIONS_BAR`. The tile chrome constants live in ReviewTile (its single source); the parity test asserts both strips render ReviewTiles so they can't diverge.

## Consumers after the refactor

- **`studio/TakeStrip.vue`** — keeps its row / current-anchor / divider / rationale tooltip / pending+error content / hover-on-cell / live-preview / Esc-and-unmount `dismiss` — all unchanged DOM, so its structural tests keep passing. Only its inline tile markup is swapped for `<ReviewTile tileTestid="take-tile" :selected="selected === t" :label="t.label">`, with the thumbnail/pending/error in `#default` and the Keep StudioButton in `#actions`. Uses `TRAY_PANEL` + `ACTIONS_BAR`. Passes no drag. Public props/emits and every `data-testid` unchanged.
- **`SketchReviewStrip.vue`** — **rebuilt to the two-row layout**: `TRAY_FLOATING` → a tiles row of four `<ReviewTile tileTestid="sketch-tile" :selected="selected === i" draggable>` (sketch image in `#default` with `draggable="false"`, Keep StudioButton in `#actions`) → an `ACTIONS_BAR` with Cancel + Re-roll. It listens to ReviewTile's `tilepointer*` events for its existing drag gesture (ghost + `dropAt` + click-guard + cancel-cleanup stay in this file). **Removed:** the 64px chip sizing, the inline all-in-one-row bar, the `sketch-tip` hover-preview popup, and the now-dead `hover` emit (its only consumer was the popup; the host never bound `@hover`). Its consumed props/emits (`images`, `selected`, `busy` → `select/keep/cancel/reroll/dropAt`) and the `sketch-tile`/`sketch-ghost`/`sketch-actions`/`sketch-cancel`/`sketch-reroll`/`sketch-keep` `data-testid`s are preserved, so **`VueNodeCanvas.vue` is untouched** (per-card Keep emits `select(i)` then `keep`, which the host's existing `onSketchSelect`+`onSketchKeep` already handle).

## Testing

- **ReviewTile unit** (`review-tile.unit.spec.ts`): renders the `#default` content inside a 96px button carrying `tileTestid`; `selected` toggles the ring classes + the overlay's forced `!opacity-100`; `#actions` content sits in the reveal overlay; `label` sets `data-label`/`aria-label` (and is absent when no label); native `@click`/`@focus`/`@blur` reach the button; with `draggable`, a pointerdown captures the pointer (guarded) and the `tilepointer*` events emit with their PointerEvent, and without `draggable` they don't.
- **`take-strip.unit.spec.ts` stays green with ONE surgical change** — the take strip's behavior and DOM are unchanged, so every structural/aria/hover/pending/error assertion passes as-is. The single edit is the import-purity test's allowlist: it must now also permit `ReviewTile.vue` (and `reviewStripStyles.ts`), since TakeStrip now imports them — the test's *intent* (no fetch / studio / config knowledge) is preserved, only presentational-sibling imports are added. If ANY other assertion needs editing to pass, the refactor changed a contract by accident — stop and reconcile.
- **`sketch-review-strip.unit.spec.ts` is UPDATED for the intended interaction change** — the sketch strip's *presentation* deliberately changes (Keep moves from the actions bar onto the tile, revealed on hover; the `sketch-tip` hover-preview popup and the dead `hover` emit are removed), so the tests tied to those are rewritten/removed. But the **host-facing event contract is preserved** (`select/keep/cancel/reroll/dropAt` still fire with the same payloads, same `data-testid`s for the tiles/ghost/actions), which is what keeps `VueNodeCanvas.vue` untouched — assert that those events are unchanged even as the trigger UI moves.
- **Parity test** (`review-strip-parity.unit.spec.ts`): mount both strips and assert each renders its tiles via `ReviewTile` (so the tile chrome is one source), that a selected tile in each carries the identical ring classes, and that both actions bars use the shared `ACTIONS_BAR` class — so a future edit to one can't silently re-diverge them.
- **Live verification:** in the browser, the take strip inside a studio still renders + behaves correctly, AND the canvas sketch strip now renders as its twin (96px tiles, per-card Keep on hover, Cancel/Re-roll bar, drag-to-place still lands under the cursor). Screenshot both.

## Non-goals

- The node-level take-history row `TakesStrip.vue` (plural) and its 7 consumers — untouched.
- No change to sketch generation, node creation, teardown, or the dock measurement (all landed and verified).
- No change to either strip's public props/emits/testids — the refactor is internal.
- No new behavior — this is a look-unification refactor, not a feature.
