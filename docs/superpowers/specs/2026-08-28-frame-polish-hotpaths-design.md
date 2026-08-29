# Frame polish — card hot paths + editor niceties

**Date:** 2026-08-28
**Status:** landed 2026-08-28 (`ced455c6a`..`1982aed3a`; all 6 feature tasks reviewed; live umbrella pass owed — shared dev server down on unrelated parallel-session server code)
**Scope:** two clusters. A: the Frame card's hottest gestures. B: six editor-polish features, modal-first (paint changes land in the shared pipeline so the card and bakes inherit them).

## Cluster A — card hot paths

1. **Type immediately after Add text.** `beginEdit` renders the inline textarea but nothing focuses it (`useLocalLayerEditor.ts:298`; no autofocus on the textarea in either host). After Add text AND after double-clicking a text layer, the textarea gets focus with the placeholder text fully selected — Figma's T-click-type distance. Applies to card and modal (modal already focuses on dblclick; make the behavior identical from `addText` too).
2. **Idle-card double-click on text stops eating the layer.** `onArtboardDblClick` (`ArtifactFrameNode.vue:298`) begins text editing before `editMode` is set, so the guarded textarea never renders while paint skips the editing layer — the text vanishes. Fix the ordering: entering edit mode comes first, then text edit begins, one double-click total.
3. **F creates a Frame.** The canvas global-key handler (`VueNodeCanvas.vue` ~:1407, currently S/C/A) gains F → place a Frame node at the viewport center, selected, respecting the existing typing guard. Drag-out frame tool stays deferred (noted, not built).

## Cluster B — editor polish

4. **Per-corner radius (rect layers).** `RectLayer.radius: number` widens to `number | [tl, tr, br, bl]` — a plain number stays uniform (every saved doc unchanged). Inspector: the existing radius row gains an expand toggle to four linked/unlinked fields (Figma's pattern). Paint: rounded-rect path built per corner in the shared pipeline.
5. **Stroke alignment (closed shapes: rect, ellipse, polygon, star, path).** `strokeAlign?: 'center' | 'inside' | 'outside'`, default center (unchanged). Canvas2D strokes center; inside = clip to the shape then stroke at 2×width; outside = stroke at 2×width with the shape's interior knocked out. Line and text keep center-only.
6. **Dashed strokes.** `strokeDash?: { dash: number; gap: number }` normalized to canvas width like every dimension; absent = solid. Applies to every stroked kind including line. Inspector: a Solid/Dashed select revealing dash/gap fields.
7. **Drag-to-scrub numeric fields.** The modal inspector's bespoke number inputs (X/Y/W/H, rotation, size, spacing, dash…) gain pointer-drag scrubbing via one shared composable/directive, matching StudioRow's conventions (drag to scrub, Shift for the big step, click to type; no behavior change to typing). Applied to the Compositor inspector's number inputs; StudioRow surfaces already have it.
8. **Layer thumbnails.** The modal layers panel rows render a small live thumbnail (~24px, offscreen `drawLocalLayer`/slot content for wired, debounced on mutation, capped work per frame). Groups show a stacked/first-child thumb. No thumbnail on the card panel (it has none).
9. **System-clipboard copy/paste of layers.** ⌘C additionally writes the selection to the OS clipboard (`navigator.clipboard`: Sailor layer JSON as text + a composited PNG for external apps); ⌘V prefers Sailor layer JSON found on the OS clipboard (works across frames, projects, and sessions), else falls back to the existing image paste. Wired layers materialize on copy (snapshot rule from the unification — never two live layers on one slot). In-session clipboard behavior unchanged where the OS clipboard is unavailable.

## Design constraints

- All paint changes live in the shared pipeline (`useCompositorLayers.ts` / `drawLocalLayer`) so card previews, modal, and client bakes agree by construction. SVG export parity is explicitly OUT of scope (`useVectorSvg` degradation is known debt; do not extend it here).
- New fields are optional with absent = today's behavior; no doc migration needed.
- Not animatable in v1 (no motion targets for radius arrays, dash, align).
- Plain-language labels; inspector rows follow the existing idioms.

## Testing

- Unit: radius normalization (number ↔ array), stroke-align geometry (inside stays within silhouette, outside stays without — pixel probes on the recording/real ctx patterns already in tests), dash normalization, clipboard JSON round-trip (serialize → parse → same layers, ids re-minted), scrub composable math.
- Live (Playwright, established patterns): card — Add text then TYPE immediately, dblclick-on-idle-text edits without vanishing, F places a Frame; modal — set per-corner radii and see them, stroke align visibly inside/outside, dashed line, scrub a numeric field with a real drag, thumbnails present and updating after an edit, ⌘C in one frame → ⌘V in another frame pastes the layers.
