# Shape Studio — per-shape fills (cycled list)

**Date:** 2026-08-16
**Status:** Approved, ready for implementation plan

## Plain-language summary

Add a **"Per-shape fill"** option to Shape Studio, modeled on Expressive Studio's
multi-fill pattern: the user defines a **list of fills**, and the app **cycles**
them across the clones (`fills[i % fills.length]`) — clone 0 gets fill 0, clone 1
fill 1, wrapping around. Each list entry is a full `FillControl` paint (solid /
gradient / pattern / image / shader), so a slot can be any paint, not just a flat
color.

It's a **mode toggle (default off)**:
- **Off** → today's unchanged behavior: all clones fold into one even-odd/boolean
  path with the single Fill — the negative-space-hole geologo look.
- **On** → each clone is drawn as its **own layered shape** with its cycled fill.
  Because the clones are separate shapes (not one folded path), the **even-odd
  negative-space holes turn off in this mode** — this tradeoff is inherent and
  user-accepted. Symmetry and clip still work in both modes.

## Reuse (from the Expressive/Space-Type mapping)

- **Cycle idiom** — `fills[i % fills.length]` after a parse that guarantees a
  non-empty list (mirror `parseFills`'s "empty → [default]" guarantee).
- **List-editor STRUCTURE** (not an importable component) — `SpaceTypeSurface.vue`'s
  reactive `Fill[]` mirror ↔ scalar param, add/remove/drag-reorder, keep-≥1
  invariant. We mirror the structure but bind each entry to **`FillControl`** (the
  geoshape fill system already uses it), storing compositor `Paint` (not
  Space-Type `Fill`).
- **Paint-carrying shapes** — the fill-system work already made `drawToCanvas` and
  `toSvg` render N `GeoVectorShape`s each with its own `.paint`. So per-shape mode
  needs NO new render code beyond producing the N per-clone shapes.

## Design

### A. Config (`lib/geoshape/config.ts`)

- `perShapeFill: boolean` (default `false`).
- `fills: Paint[]` — the cycle list (default a small pleasant palette of ~3 solid
  Paints, e.g. `['#1a1a2e', '#e5484d', '#f5a623']`, so turning the mode on looks
  good immediately). `Paint` stays a type-only import.
- `mergeConfig`: `perShapeFill: bool(...)`; `fills`: validate as an array — map each
  entry through the existing `paint()` validator, drop invalid entries; if the
  result is empty or the input isn't an array, fall back to `[...DEFAULT.fills]`
  (guarantees non-empty, mirroring `parseFills`). Deep-copy.

### B. Composite (`lib/geoshape/boolean.ts`)

Add a per-shape branch at the top of `composite`, BEFORE the fold:

```
if (cfg.perShapeFill) {
  // build one transformed paper path per placement (as today)
  // symmetry: for each original clone, also add a mirrored copy that INHERITS
  //   the original's cycled paint (so the mark is colour-symmetric)
  // clip: intersect each clone path with the clip shape (if clipMask !== 'none')
  // → one GeoVectorShape per clone: { commands: paperToCommands(path),
  //     paint: cfg.fills[i % cfg.fills.length], fill: solidOf(that),
  //     stroke, strokeWidth, fillRule: 'nonzero' }
  //   (later clones draw on top — no fold, no even-odd, no overlap shape)
  return shapes
}
// else: the existing unified fold path (evenodd/unite/…, overlap, holes) — unchanged
```

Paper scope discipline unchanged (`sc.project.clear()` in `finally`). `fillMode`,
`overlapMode`, and even-odd do not apply in per-shape mode. `count` is clamped by
mergeConfig, so the shape count is bounded.

### C. Render — no change needed

`renderShapes` → `composite` returns the per-clone `GeoVectorShape[]`;
`drawToCanvas` resolves each shape's `.paint` (solid/gradient/pattern/image/shader
all work — the fill system covers it), and `toSvg` converts each via
`paintToVectorPaint`. Add a `toSvg` test asserting per-shape mode yields N `<path>`
with DIFFERENT fills (proving the cycle), but no pipeline code changes.

`invert` is a unified-mode affordance and is a no-op for the `fills` list in v1
(document it; can be added later).

### D. UI (`ShapeStudioSurface.vue` + `controls.ts`)

- `controls.ts`: add a `perShapeFill` **switch** control (Paint group). Exclude
  `fills` from the drift-guard's key set (like `locks`) — it's edited via a bespoke
  list editor, not a standard control kind. Keep the single `fill`/`overlapFill`
  controls declared (for unified mode + agent).
- `ShapeStudioSurface.vue` Paint section:
  - A **"Per-shape fill"** `StudioSwitch` bound to `config.perShapeFill`.
  - When **off**: the current single Fill + (gated) Overlap-fill `FillControl`s.
  - When **on**: a **Fills list editor** — a reactive mirror of `config.fills`;
    `v-for` one row per fill with an index badge, a `FillControl` (bound to
    `fills[i]`), a remove button (shown when length > 1), and drag-reorder; a
    "+ Add fill" button (pushes a solid default); helper text "Clones cycle
    through these fills, top to bottom." Writes the mutated array back to
    `config.fills` (autosave persists it). Mirror `SpaceTypeSurface.vue`'s
    fills-list structure (reactive mirror, add/removeFill keep-≥1, dragStart/
    dragOver/drop reorder) but with `FillControl` per entry.

### E. Testing

- **Config:** `perShapeFill` + `fills` round-trip; `fills` with a gradient/pattern
  entry survives; junk/empty `fills` → `[...DEFAULT.fills]` (non-empty); a
  non-array `fills` → default.
- **Composite:** per-shape mode with count 3 + `fills` of 2 → 3 shapes whose paints
  are `[fills[0], fills[1], fills[0]]` (cycle); unified mode still yields the
  even-odd 1–2 shapes (regression). Symmetry in per-shape mode doubles the shape
  count and mirrors paints.
- **Render:** `toSvg` per-shape → N `<path>` with ≥2 distinct fill values.
- **Controls:** `perShapeFill` has a control; `fills` excluded from the drift guard;
  reroll unaffected.
- **Live render-proof:** in the studio, toggle Per-shape fill on, set 3 vivid
  fills → the clones render in cycling colors (pixel check: ≥3 distinct hues over
  the mark); holes are gone (expected); toggle off → holes return, single fill.

## Risks / watch-items

- **Symmetry paint mapping:** a mirrored clone must inherit its source clone's
  cycled paint (colour-symmetric), not continue the modulo past the mirror
  boundary — get the index bookkeeping right (test it).
- **`fills` in the drift guard:** must be excluded or the guard fails; but keep it
  in the config so it persists + the list editor can address it.
- **Default `fills`** should be non-empty and pleasant, but it never affects the
  default mark (perShapeFill defaults off), so it's purely the mode's starting
  palette.
- **`count` bound:** per-shape produces one shape per clone — already bounded by
  mergeConfig's count clamp (1..200); no new O(n²) risk (no pairwise overlap in
  this mode).
