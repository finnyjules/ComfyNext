# Expressive text layout — design

**Date:** 2026-07-10
**Surfaces:** Frame (compositor) + Smart Layout (template-grid v3)
**Status:** approved, implementing

## Problem

Frame and Smart Layout only offer flow alignment (`left` / `center` / `right`, plus
vertical align in Smart Layout). Creative / editorial typography wants *expressive*
placement — e.g. one word per line scattered horizontally, or two words per line
snapped to opposite edges — with a way to reshuffle. This is not a CSS `text-align`
value; it is a per-word layout that overrides normal flow.

## Concept

A text element can switch from normal flow into an **expressive** layout mode where
words are grouped into lines by a count and each word's position comes from a
*placement rule* + a *seed*, with a **reroll** that bumps the seed. Both requested
looks are points in this space:

- one word per line, random X → `wordsPerLine: 1, placement: 'random'`
- two words per line, edge-split → `wordsPerLine: 2, placement: 'edges'`

Placement is **both axes** (X and Y drift within each line's band).

## Architecture

One pure, framework-free engine emits per-word geometry; three thin consumers render
from it. The engine is the whole feature; the only real risk is the Satori export
agreeing with the editor, which we solve by feeding **the same measure function** on
both Smart Layout paths.

### Engine — `frontend/shared/text-layout/expressive.ts` (new, pure, unit-tested)

```ts
export type PlacementRule = 'random' | 'edges' | 'staircase' | 'alternate'
export interface ExpressiveParams {
  wordsPerLine: number       // integer >= 1
  placement: PlacementRule
  jitterX: number            // 0..1, horizontal stray from anchor
  jitterY: number            // 0..1, vertical stray within the line band
  seed: number               // deterministic; reroll = new seed
}
export interface PlacedWord { text: string; line: number; x: number; y: number; w: number }
export interface ExpressiveLayout { words: PlacedWord[]; lines: number; width: number; height: number }

export function layoutExpressive(opts: {
  text: string
  boxWidth: number                    // px horizontal bound
  lineHeight: number                  // px per line
  measure: (word: string) => number   // injected per surface
  params: ExpressiveParams
}): ExpressiveLayout
```

- Words = `text` split on whitespace (newlines included — expressive owns wrapping).
- `lines = ceil(nWords / wordsPerLine)`; each line's band top = `line * lineHeight`.
- Each word's left is clamped to `[0, max(0, boxWidth - w)]` so nothing overflows.
- Deterministic: mulberry32 seeded by `(seed, wordIndex)` → same inputs, same output.

**Placement rules**

- `random` — the line is divided into N even cells (N = words on the line); each word
  jitters within its cell. `wordsPerLine: 1` ⇒ one word free across the whole width.
- `edges` — N words anchored across the width, word `i` at fraction `i/(N-1)`
  (N=2 ⇒ left edge / right edge). Reroll can swap order + jitter.
- `staircase` — each line indented progressively.
- `alternate` — whole lines flip their anchor left/right.

Adding a rule later = one function; the data model and UI are unchanged.

### Data model (additive; absent ⇒ byte-identical to today)

- Frame: `expressive?: ExpressiveParams` on `TextLayer`
  (`app/composables/useCompositorLayers.ts`).
- Smart Layout: `expressive?: ExpressiveParams` on `TextStyleV2`
  (`shared/template-grid/types.ts`).

No migration. Unset ⇒ existing `drawText` / Satori hand-off run exactly as before.

### Consumers

- **Frame canvas** (`drawText`, `useCompositorLayers.ts`) — inject `ctx.measureText`;
  `fillText` each word at its `(x, y)`. Box bound = `boxW·W` if set, else the natural
  max-line width. Exact.
- **Smart Layout editor** (`GridEditorCanvas.vue`) — inject the **CHAR_W estimate**
  from `template-grid/text.ts` (not canvas), render each word as an absolutely
  positioned `<span>` in a relative box.
- **Smart Layout export** (`server/templates/translate.ts`, Satori) — inject the
  **same CHAR_W estimate**, emit each word as an absolutely positioned box.

Using the identical estimate on both Smart Layout paths makes editor and export match
(consistency over per-glyph accuracy — the existing philosophy in `text.ts`). Frame is
canvas-only end to end, so it uses real metrics with no divergence.

### UI

Each text inspector's align control gains an **Expressive** toggle. On, it reveals:
`words per line`, `placement` dropdown, `horizontal jitter`, `vertical jitter`, and a
**⟳ Reroll** button (bumps `seed`). Normal `left/center/right` stays as the per-word
anchor the rules build from.

- Frame: `CompositorModal.vue` text inspector (+ `CompositorInlineToolbar.vue`).
- Smart Layout: `GridPropertyPanel.vue` (+ `GridInlineToolbar.vue`).

### Inline editing

Double-click to edit temporarily drops to normal flow (legible textarea), then
re-applies expressive layout on blur — avoids a contenteditable full of absolutely
positioned words.

## Testing

- Unit: pure-engine assertions at a fixed seed — determinism, no-overflow clamp,
  `edges` split, word-count → line-count, reroll changes output, empty text.
- Visual: screenshot pass on **both** surfaces (units alone never sign off visuals).

## Blind spots to handle in implementation

1. **Dirty working tree** — `types.ts`, `resolve.ts`, `GridEditorCanvas.vue`,
   `translate.ts` are mid-refactor. Keep edits additive; commit only the isolated
   new engine/spec/tests; leave Smart Layout edits uncommitted for integration.
2. **Frame with no box** — expressive needs a horizontal bound; fall back to natural
   max-line width when `boxW` is unset.
3. **Word wider than box** — clamp left to 0; never negative width.
4. **Long text / perf** — engine is O(words); fine. Editor re-runs on style change.
5. **`wordsPerLine: 'auto'`** — deferred; v1 is integer ≥ 1.
6. **Decoration / stroke** — carry per-word in Frame so underline/stroke still work.
7. **Selection box / hit-test** — expressive block bound stays the box, so
   `localLayerBox` is unaffected.
