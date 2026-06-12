# Inpaint Modal Improvements — Design

**Date:** 2026-06-12
**Component:** `frontend/app/components/vue-canvas/InpaintModal.vue`
**Composables:** `frontend/app/composables/useBrushMask.ts`, new `frontend/app/composables/useStageView.ts`

## Goal

Improve the inpaint editor on two axes the user asked for: **visual polish / layout**
and **new capabilities**. The modal already does the core job (paint a mask, describe
or fill, pick a result, write back to the node). This pass tightens the layout and adds
the capabilities that make precise edits and iteration practical:

1. **Undo/redo** (stroke-level)
2. **Zoom / pan** on the stage
3. **Result history** (accumulate generations instead of replacing)
4. **Better mask tools** — Fill all, Invert, Mask-only view

Explicitly **out of scope** this pass (deferred):
- Per-brush *hardness* — the bake feathers globally (`useBrushMask.bakeMask`), so per-stroke
  hardness is a separate, larger change.
- Onboarding / shortcut legend — not requested.

## Approach

Approach **C** (chosen): keep `InpaintModal.vue` as the shell, push new *stateful* logic
into composables where it belongs, and build in risk order so the heavy geometry change
(zoom/pan) lands last and the rest is shippable independently.

- Undo/redo **and** Invert/Fill-all live in `useBrushMask` (it owns the mask).
- Zoom/pan lives in a new `useStageView` composable (isolates the coordinate-math change).
- Result history is local component state (just an array; session-scoped).

## Build order (risk-ascending)

### Phase 1 — Layout polish + low-risk features (no coordinate-math changes)

**1a. Visual polish / reorg of the controls panel**
- Fold the SAM "Click-select" (`Wand2`) button into the brush tool row as an icon button,
  removing its dedicated row + the "beta · falls back to brushing" caption (move that hint
  to the button `title`). Reduces vertical clutter.
- Group the three new mask actions (Fill all, Invert, Mask only) with the existing Clear in
  one wrap row.
- Keep the dark aesthetic, emerald = run, cyan = paint, rose = erase. **No purple accents**
  (per standing preference).

**1b. Result history (session-scoped)**
- Replace the single-batch `inpaintResults` "Pick a result" grid with an accumulating
  `history` list. Each entry: `{ id, url, prompt, mode, ts }`.
- On each successful `runInpaint`, **prepend** the new results to `history` (newest first).
- The strip shows thumbnails; the currently-previewed/active one is ringed emerald.
- Hover a thumb → `previewResult` (existing behavior). Click → `acceptInpaint` (existing).
- Compare (hold to see original) stays.
- History is **cleared** when the source image changes (`applySource`) and on modal close
  (component unmount) — **not** persisted to the node. No new graph-doc plumbing.

**1c. Fill all** (mask tool)
- Add `fillAll()` to `useBrushMask`: pushes one stroke (or sets a `fillAll` flag honored by
  `render` + `bakeMask`) that marks the entire artboard. Simplest correct version: a flag
  `fillAll: Ref<boolean>` that, when true, makes `hasMask` true and makes `bakeMask`/`render`
  produce a full-white mask (modulo `inverted`). Cleared by `clear()`.

**1d. Invert** (mask tool) — **flag on the mask** (chosen over baking into strokes)
- Add `inverted: Ref<boolean>` to `useBrushMask`.
- `render()` and `bakeMask()` honor it: when `inverted`, the output mask is
  `whole-image MINUS painted region` (i.e. paint the area to *keep*, change everything else).
- Reversible, lossless, undo-friendly. Toggling does not mutate strokes.
- `clear()` resets `inverted = false`.

**1e. Mask-only view** (display toggle, component-local)
- `maskOnly: Ref<boolean>` in the component. When true, the stage hides the source `<img>`
  (or dims it) so only the mask wash shows — for checking coverage. Pure view state; does
  not affect bake.

### Phase 2 — Undo / redo (touches `useBrushMask` state only)

- Add an undo/redo stack to `useBrushMask`. Snapshot granularity = **per stroke** (push a
  snapshot of `strokes` on `up()`, and on `fillAll`/`clear`/`invert` toggles so those are
  undoable too).
- API: `undo()`, `redo()`, `canUndo: ComputedRef<boolean>`, `canRedo: ComputedRef<boolean>`.
- Implementation: keep `past: BrushStroke[][]` and `future: BrushStroke[][]` arrays of
  deep-ish snapshots (strokes are plain data — `structuredClone` or JSON round-trip is fine).
  A new edit clears `future`.
- Wire keyboard in `InpaintModal.onKeydown`: `Cmd/Ctrl+Z` → undo, `Cmd/Ctrl+Shift+Z`
  (and `Cmd/Ctrl+Y`) → redo, guarded by the existing `typing` check.
- Stage UI: undo/redo chip top-left of the stage (icons `arrow-back-up` / `arrow-forward-up`),
  disabled state when `!canUndo` / `!canRedo`.

### Phase 3 — Zoom / pan (isolated coordinate-math change, last)

New composable `useStageView`:
- State: `scale: Ref<number>` (clamped, e.g. 0.25–8), `tx/ty: Ref<number>` (pan offset, px).
- Methods: `zoomAt(factor, anchorClientXY, stageRect)`, `setScale`, `reset()/fit()`,
  `panBy(dx, dy)`, and a `toNorm(clientX, clientY, stageRect)` that **replaces**
  `clientToNorm` — it must invert the pan+scale transform so painted coords stay correct.
- Apply the transform via CSS `transform: translate(tx,ty) scale(scale)` on an inner stage
  wrapper that contains both the `<img>` and the overlay `<canvas>`. The overlay keeps
  rendering in `disp.w × disp.h` logical space; the wrapper transform scales both together,
  so the existing bake geometry (`MaskTarget` built from `disp`/`out`) is **unchanged** —
  this is the key reason zoom/pan can be added without touching `bakeMask`.
- Brush cursor ring: position via `toNorm`; its on-screen diameter should scale with `scale`
  so it stays WYSIWYG against the zoomed image. `brush.sizePx` (the painted radius) stays in
  logical/display space, so the baked mask is identical regardless of zoom.
- Interactions:
  - `Cmd/Ctrl` + wheel → zoom at cursor. Plain wheel / trackpad two-finger → pan.
  - Hold **Space** + drag → pan (cursor → grab). Middle-drag → pan.
  - Stage UI: `−` / `%` / `+` and a fit button, bottom-left of the stage.
- `reset()`/`fit()` on new source load.

## Data flow (unchanged contract)

Source resolution, `imageToDataUrl`, `bakeMask(target, {feather, expand})`, `inpaint.*`,
and `acceptInpaint` write-back are all **unchanged**. The new features either:
- add reversible **flags** to the mask (`inverted`, `fillAll`) that `bakeMask` honors, or
- add a **view transform** (`useStageView`) that sits between the pointer and the unchanged
  normalized-coord space, or
- accumulate results in a session array.

## Testing

- **Unit (`useBrushMask`)**: undo/redo across paint/erase/clear/fillAll/invert; `canUndo`/
  `canRedo` edges; `bakeMask` output with `inverted` true vs false (assert pixel regions);
  `fillAll` produces full-coverage mask; `clear()` resets flags.
- **Unit (`useStageView`)**: `toNorm` round-trips a point through zoom+pan back to the same
  normalized coord it would have at scale=1/no-pan; clamping; `fit()` math.
- **Manual / preview**: paint → zoom in → paint precisely → undo twice → invert → generate →
  history accumulates → compare → accept writes back to node. Verify mask alignment after
  zoom/pan (the regression-prone path).

## Risks

- **Zoom/pan coordinate drift** is the main risk — mitigated by keeping the overlay in logical
  space and transforming the wrapper (bake geometry untouched), plus the `toNorm` round-trip
  unit test. Built last so Phases 1–2 ship regardless.
- Invert/fill correctness in `bakeMask` — covered by pixel-region unit assertions.
