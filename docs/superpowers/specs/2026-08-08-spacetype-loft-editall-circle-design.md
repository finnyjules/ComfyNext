# Space Type — Loft: edit-all stops + Circle shape (round 3d)

**Date:** 2026-08-08
**Status:** Design approved, pre-plan
**Builds on:** the Loft effect + rounds 3a/3c.

## Plain-language summary

Two editor/shape refinements:
1. **Edit all stops at once.** The stops editor only edits the selected stop today.
   Add an **"All stops"** section — master **Width / Height / Roll / Colour** that
   *set every stop* to that value (position stays per-stop, it defines the spine).
2. **Add a real Circle, drop Capsule.** `Circle` is always perfectly round (sized
   by Width, ignores the Width/Height aspect). `Capsule` is removed — it was
   identical to a `Rectangle` at full corner-radius (the source of the oval/capsule
   confusion); legacy capsules migrate to `Rectangle` at full radius so they keep
   the pill shape.

## A. Edit all stops (master controls)

In `ProfileStopsEditor.vue`, add an **"All stops"** block (below the selected-stop
inspector) with master **Width, Height, Roll** sliders + a master **Colour**
picker. Changing any master **sets that field on EVERY stop** and commits (emits
the serialized JSON). Implementation: a `setAll<K extends keyof LoftStop>(k, v)`
that maps over the reactive `stops` array writing `s[k]=v`, then `commit()`.
- Master ranges mirror the per-stop sliders (Width/Height 0.05..6 step 0.05; Roll
  -180..180 step 1).
- The masters are "write-only actions" — they don't display a synced value (stops
  can differ); they show a neutral midpoint and apply on input. (A simple, robust
  UX: label the block "Set all stops" and let each drag stamp the value onto all.)
- Position (x/y/z) is NOT in the master block — it's per-stop (the spine shape).

No effect/geometry change — the editor already serializes stops the same way.

## B. Circle shape + drop Capsule

**Shape list** (`shape` control options) becomes:
`['circle', 'oval', 'rectangle', 'polygon', 'star', 'word']` — `circle` added
(first, it's the common default-y one), `capsule` removed.

**`LoftShape`** type: `'circle' | 'oval' | 'rectangle' | 'polygon' | 'star'` (drop
`'capsule'`). `shapeContour`:
- Add `case 'circle'`: the unit circle (same points as `oval`'s unit circle). The
  circle-ness comes from **uniform scaling** at build time, not the contour.
- Remove `case 'capsule'`.

**Uniform scaling (the "always round" part).** A unit circle scaled by per-stop
`width` × `height` becomes an ellipse. For `circle`, the effect forces the
cross-section scale **uniform**: in `buildScene`, when the shape is `circle`, map
`props` to `{ ...p, height: p.width }` so every station scales the circle by
`width` in both axes → a true circle of diameter = width. (Height is ignored for
circle; note it.)

**Migration** (`resolveShape` + `buildScene`):
- `resolveShape` maps a legacy `shape: 'capsule'` → `'rectangle'`.
- To preserve the pill look, `buildScene` computes the effective `rectRadius`:
  `const rawShape = String(params.shape ?? ''); const rectRadius = rawShape ===
  'capsule' ? 1 : n(params, 'rectRadius')` — a migrated capsule renders as a
  full-radius rounded rect (= the old capsule) without needing a param rewrite.
- Old `profileKind` migration (from earlier rounds) is unchanged.

## Files

**Modify:**
- `app/lib/spacetype/loftGeometry.ts` — `shapeContour`: add `'circle'`, remove
  `'capsule'`; `LoftShape` union drops `'capsule'`, adds `'circle'`.
- `app/lib/spacetype/effects/loft.ts` — `shape` control options (add circle, drop
  capsule); `resolveShape` valid-options list + capsule→rectangle migration; in
  `buildScene`, the uniform-scale for `circle` (`height=width` in props) and the
  `rectRadius=1` for legacy capsule.
- `app/components/vue-canvas/ProfileStopsEditor.vue` — the "All stops" master
  block + `setAll`.

## Tests

- `shapeContour('circle', …, P)` returns a unit circle (all radii ≈ 1); `'capsule'`
  is no longer a valid `LoftShape` (TS) and `shapeContour` has no capsule case.
- `resolveShape({shape:'capsule'})` → `'rectangle'`; `resolveShape({shape:'circle'})`
  → `'circle'`; the valid-options list includes circle, excludes capsule.
- effect: `shape='circle'` builds geometry whose cross-section is uniform (a unit
  circle scaled by width in both axes) — assert via the props passed / a sampled
  vertex being equidistant, OR simply that buildScene doesn't throw and the shape
  resolves to circle; `shape='capsule'` (legacy) resolves to rectangle and builds.
- `ProfileStopsEditor`: no unit test (Vue drag UI) — controller live-check that a
  master slider changes all stops. Add a small pure test only if a `setAll` helper
  is extracted; otherwise rely on the live check.

## Compatibility

- Legacy `capsule` lofts → Rectangle at full radius (same pill shape) — no visible
  change for square-aspect ones (they looked like circles anyway).
- `circle` is new; existing lofts default to their saved shape.
- The shape guard / sections tests are unaffected (still valid groups).

## Out of scope

- The on-preview bezier spine editor (round 3b — still queued).
- Per-fill gradient angle interpolation (round 3c follow-up).
- Hiding the Height control when `circle` is selected (it's simply ignored; a
  showIf-hide is a nicety, not required).
