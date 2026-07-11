# Expressive Word Nudges — Design

**Date:** 2026-07-11
**Status:** Approved

## Problem

Expressive text (per-word scattered placement in Smart Layout) is fully
engine-driven: word positions come from `(text, params, seed)` and the only
control is re-rolling the seed or tuning jitter. There is no way to grab one
word that landed awkwardly and move it. Users want manual per-word position
overrides on top of the generated layout.

## Decisions (from brainstorming)

1. **Relative nudges, keyed by word index.** A drag stores a `(dx, dy)` delta
   for "word #N", applied on top of wherever the engine places that word.
   Collection-bound text keeps nudges across row changes: the Nth word of the
   new text gets the same relative nudge. Rows with fewer words silently
   ignore out-of-range nudges.
2. **Double-click enters word mode.** Reuses the editor's existing
   reposition-mode pattern (images: double-click → drag → Esc/deselect to
   exit). While in word mode the element itself does not move; each word is
   individually draggable.
3. **Any expressive param change clears all nudges.** Shuffle (seed bump),
   placement, words-per-line, and jitter changes all rearrange the anchors
   the nudges were relative to — the user chose "re-roll means start over".
   Non-expressive edits (color, font size, content/Collection row changes)
   keep nudges.

## Architecture

Nudges are applied in the **shared adapter** `gridExpressiveLayout()`
(`frontend/shared/template-grid/expressive.ts`) — the single call site used by
BOTH the editor DOM (`GridEditorCanvas.expressiveWords`) and the satori export
(`server/templates/translate.ts`). Applying them there gives editor/render
parity for free and requires no changes to `translate.ts`.

The core engine `shared/text-layout/expressive.ts` stays untouched: it is a
pure text-layout module also consumed by the Frame compositor, which has no
nudge concept.

## Schema

One optional field on the existing expressive style object:

```ts
interface ExpressiveStyle /* style.expressive */ {
  wordsPerLine: number
  placement: PlacementRule
  jitterX: number
  jitterY: number
  seed: number
  /** Manual per-word offsets, keyed by word index (0-based, reading order).
   *  dx/dy are FRACTIONS of the element box (dx × boxWidth px), so a nudge
   *  scales proportionally across formats. Absent = no overrides. */
  nudges?: Record<number, { dx: number; dy: number }>
}
```

- Normalized units: the same element renders at very different pixel sizes
  per format (1×1 at 1080px wide vs a 300×250 MPU); fractions keep the nudge
  proportional everywhere.
- Backwards compatible: layouts without `nudges` behave byte-identically.
- Per-format style overrides (`el.overrides[format].style`) interact with
  `expressive` exactly as they do today (whole-object replacement); no new
  mechanism.

## Components

### 1. Shared adapter (`shared/template-grid/expressive.ts`)

`gridExpressiveLayout()` gains nudge application after `layoutExpressive()`
returns:

- For each placed word at index `i` with a nudge: `x += dx * boxWidth`,
  `y += dy * boxHeight` (boxHeight falls back to the layout height when the
  caller passed none).
- Clamp exactly like the engine: `x` to `[0, boxWidth - w]`, `y` to
  `[0, max(0, boxHeight - lineHeight)]` — a word can touch but never escape
  the element box (which crops via `overflow: hidden` on both surfaces).
- No new adapter argument: both call sites already pass `style.expressive`
  as `params`, and `nudges` lives inside it — the adapter reads
  `params.nudges` directly.

### 2. Editor interaction (`GridEditorCanvas.vue`)

- Double-click on an expressive text element sets the existing
  `repositionId` to that element (currently images only) — the hint chip
  reads "Drag words · Esc to finish".
- In word mode, each word span gets pointer handlers: pointerdown captures
  the word index and start point; pointermove updates the nudge live through
  a local ref (immediate visual feedback without template writes);
  pointerup commits via `patchStyle(id, { expressive: { ...expressive,
  nudges: next } })` — one undo step per drag, matching existing style edits.
- Drag deltas divide by the element's rendered rect size to produce
  normalized `dx`/`dy` increments on top of any existing nudge for that word.
- Exit paths mirror image reposition: Esc, deselect, or double-click
  elsewhere.
- No decoration on nudged words — the layout itself is the feedback.

### 3. Clearing semantics (`GridPropertyPanel.vue`)

`setExpressive(patch)` strips `nudges` from the merged result whenever the
patch touches any engine param (`wordsPerLine`, `placement`, `jitterX`,
`jitterY`, `seed`). Since every control in the expressive section routes
through `setExpressive`, Shuffle and all param edits clear nudges with no
extra plumbing. (Implementation note: the merge must not resurrect old
nudges via the spread — delete the key explicitly.)

## Error handling

- Out-of-range indices (text now shorter): ignored by the adapter.
- Non-finite / missing `dx`/`dy`: treated as 0.
- Malformed `nudges` value (not an object): ignored entirely.

## Testing

- **Adapter unit tests** (`template-grid-expressive.unit.spec.ts`): nudge
  moves the word by `dx × boxWidth`; clamped at box edges; out-of-range index
  ignored; same fractional nudge produces proportional pixel offsets at two
  box sizes; no `nudges` field → identical output to today.
- **Translate test** (`template-grid-translate.unit.spec.ts`): a nudged
  expressive element's satori word `top`/`left` include the nudge — locks
  editor/render parity at the export boundary.
- **Panel test**: `setExpressive({ seed: +1 })` (Shuffle) drops `nudges`;
  a pure color/font-size patch via `patchStyle` does not.

## Out of scope

- Per-word rotation/scale.
- Nudge UI outside the editor modal (node body, Collection drawer previews
  render nudges automatically via the shared adapter, but have no editing).
- Per-format distinct nudges beyond what the existing `overrides` mechanism
  already provides.
