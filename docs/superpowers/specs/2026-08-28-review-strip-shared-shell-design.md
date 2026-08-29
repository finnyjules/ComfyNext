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

## The shared component

**New:** `frontend/app/components/vue-canvas/studio/ReviewStrip.vue` — presentation only; owns the shared look, knows nothing about takes, sketches, nodes, or studios.

**Props:**
- `count: number` — how many item cells to render (the consumer supplies each cell's content via a scoped slot; the shell owns the cell chrome).
- `selected: number | null` — index of the selected cell (drives the ring + forced action-reveal). Index-based is the shared currency; TakeStrip maps its object-selection to/from an index at the seam.
- `surface?: 'panel' | 'floating'` (default `'panel'`) — tray treatment. `panel` = `border-white/10 bg-white/[0.03]` (in-modal). `floating` = `bg-[#0b0d11]/95 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur` (over canvas).
- `busy?: boolean` — forwarded to disable the actions bar / gate hover, as today.

**Slots:**
- `#lead` — optional; rendered before the divider (TakeStrip's "current" anchor). When absent, no divider renders.
- `#cell="{ index, selected }"` — the content INSIDE one tile (the image, plus any pending/error/rationale the consumer adds). The shell wraps this in the shared tile chrome (fixed 96px height, clip, border, selection ring).
- `#cell-actions="{ index }"` — the per-tile overlay revealed on hover/focus/selected (the Keep button). The shell provides the gradient scrim + reveal transition; the consumer provides the button(s).
- `#actions` — the bottom bar contents (Cancel … Re-roll). The shell provides the bar row; the consumer provides the buttons and any `flex-1` spacer.
- `#tip="{ index }"` — optional cell-level sibling escaping the tile clip (TakeStrip's rationale tooltip). Sketch strip omits it.

**Emits:**
- `hover: [index: number | null]` — pointer entered a cell (or left all).
- `select: [index: number]` — a cell was clicked (not part of a drag; see gesture note).

**Shared tile chrome (the source of truth):** a `TILE_H = 'h-[96px]'` sizing, rounded-`[5px]` clip, `border` with `selected ? 'border-action ring-1 ring-action' : 'border-white/12 hover:border-white/30'`, and the reveal overlay classes (`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`, forced `!opacity-100` when selected, over `bg-gradient-to-t from-black/85`). Extracted as named constants in ReviewStrip so both strips are provably identical.

**Drag-to-place (sketch only):** the shell owns the tile element, so it must own **pointer capture** — capture has to be on the element the `pointerdown` fired on, or move/up re-target the moment the pointer leaves the 64→96px tile (the exact bug fixed in Task 2, invisible to jsdom). Contract: ReviewStrip emits `cellpointerdown`/`cellpointermove`/`cellpointerup`/`cellpointercancel` each carrying `{ index, event }`, AND itself calls `setPointerCapture`/`releasePointerCapture` on its tile element (guarded for the test env, as today). SketchReviewStrip listens to those four events and runs its existing gesture logic (4px threshold, ghost, `dropAt`, `draggedThisPress` click-guard, `pointercancel` cleanup) from them; it also renders `#cell` content with `draggable="false"` on the img (native image-drag still fires a spurious `pointercancel` otherwise). The ghost element + drop math stay entirely in SketchReviewStrip. TakeStrip listens to none of these and passes no drag.

## Consumers after the refactor

- **`studio/TakeStrip.vue`** — thin: renders `<ReviewStrip :count="takes.length" :selected="selectedIndex" surface="panel">` with `#lead` = current anchor, `#cell` = image / pending / error, `#cell-actions` = Keep, `#actions` = Cancel + Re-roll spacer, `#tip` = rationale. Keeps its own `thumbs`/`current`/`pending` computeds, object↔index mapping, live-preview-on-hover emit, and Esc/unmount `dismiss` behavior. Its public props/emits and every `data-testid` are unchanged.
- **`SketchReviewStrip.vue`** — thin: `<ReviewStrip :count="images.length" :selected="selected" surface="floating">` with no `#lead`/`#tip`, `#cell` = the sketch image, `#cell-actions` = Keep, `#actions` = Cancel + Re-roll. Keeps its drag gesture + ghost. Its public props/emits (`images`, `selected`, `busy` → `hover/select/keep/cancel/reroll/dropAt`) and `data-testid`s are unchanged, so **`VueNodeCanvas.vue` is untouched**.

## Testing

- **ReviewStrip unit** (`reviewstrip.unit.spec.ts`): renders `count` cells; `surface` swaps tray classes; clicking a cell emits `select(index)`; hover emits `hover(index|null)`; `#lead` presence toggles the divider; `#cell-actions` is in the DOM and revealed when its cell is selected.
- **Both existing suites stay green unchanged** — this is the refactor's safety net. `take-strip.unit.spec.ts` (current/rationale/pending/error/keyboard/keep) and `sketch-review-strip.unit.spec.ts` (select/keep/cancel/reroll/dropAt/pointercancel/click-vs-drag) must pass without edits to their assertions. If a test needs editing to pass, the refactor changed a contract — stop and reconcile.
- **Parity test** (`review-strip-parity.unit.spec.ts`): mount both strips and assert the shared tile chrome is byte-identical — same tile height class, same selection-ring classes, same actions-bar structure — so a future edit to one can't silently re-diverge them.
- **Live verification:** in the browser, the take strip inside a studio still renders + behaves correctly, AND the canvas sketch strip now renders as its twin (96px tiles, per-card Keep on hover, Cancel/Re-roll bar, drag-to-place still lands under the cursor). Screenshot both.

## Non-goals

- The node-level take-history row `TakesStrip.vue` (plural) and its 7 consumers — untouched.
- No change to sketch generation, node creation, teardown, or the dock measurement (all landed and verified).
- No change to either strip's public props/emits/testids — the refactor is internal.
- No new behavior — this is a look-unification refactor, not a feature.
