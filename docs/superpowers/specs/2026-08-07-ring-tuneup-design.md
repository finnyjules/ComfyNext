# Ring tune-up — bend, repeater, and the animos control set — design

*2026-08-07. Extends [Expressive Studio v1](2026-08-06-expressive-studio-v1-design.md)'s `ring` effect.*

## In plain language

The `ring` layout works (photos + words orbit on a circle) but has only 7 controls. This adds the
control set from [animos.app](https://animos.app) plus two behaviours we designed together: a
**repeater** (duplicate the elements around the ring to fill it) and **bend** (each card curves its
own geometry to conform to the ring's arc — flat quad at 0, a panel wrapped to the circle at 100).

We settled the two ambiguous ones by building an interactive model: **bend** curves the *element
itself*, not the arrangement; the **repeater** just duplicates content around the ring.

## What is being built

All additions live in one file, `app/lib/spacetype/effects/ring.ts`, plus small optional touches to
`ringLayout.ts`. Every new control is a `ControlSpec` slider, so **agent-legibility and motion tracks
derive for free** — bend and ring-opening become keyframeable with no extra wiring.

### Control set (final)

Existing (unchanged keys): `content`, `ringTilt`, `cardSize`, `perspective`, `speed`, `direction`.

| Key | Label | Kind / range | Default | Group | Live? | What it does |
|---|---|---|---|---|---|---|
| `radius` | **Ring size** | slider 2–12 ×0.1 | 5 | Ribbon | live | *(relabel only — key stays `radius` so saved docs don't break)* overall ring radius |
| `repeat` | **Repeater** | slider 1–8 ×1 | 1 | Ribbon | **structural** | duplicate the element sequence ×N around the ring |
| `padding` | **Padding** | slider 0–0.9 ×0.01 | 0 | Ribbon | live | shrink each card's width to open a gap between neighbours |
| `cornerRadius` | **Corner radius** | slider 0–0.5 ×0.01 | 0.06 | Ribbon | live | round **image** card corners (no-op on glyph tiles) |
| `bend` | **Bend** | slider 0–1 ×0.01 | 0 | Ribbon | live | curve each card from flat (0) to wrapped-to-the-ring (1) |
| `ringOpening` | **Ring opening** | slider 0–1 ×0.01 | 0.55 | Transform | live | 0 = cards head-on (ring collapsed to face you) → 1 = full circle revealed |
| `backFade` | **Back fade** | slider 0–1 ×0.01 | 0 | Look | live | fade cards on the far side of the ring by depth |

`liveKeys` gains `ringOpening, padding, cornerRadius, bend, backFade` (and keeps the existing live
keys). `repeat` and `content` stay **structural** (they change the quad count → rebuild). `loopRates`
is unchanged (driven by `speed`).

### Behaviour details

**Repeater (`repeat`, structural).** In `buildScene`, after `expandContent(items)` produces the base
`tiles`, repeat that array `repeat` times before building meshes (`Array.from({length: repeat}).flatMap(() => tiles)`).
Placement already distributes `count = quads.length` evenly, so N× tiles fill the ring. Glyph-texture
memoization is by `sourceId`, which is stable across repeats — the atlas is still rasterised once and
registered once for disposal, so repeats add meshes but not textures.

**Bend (`bend`, live).** Each card's *local* geometry curves to wrap the ring, independent of its
placement (which `ringTransform` still handles). Replace `PlaneGeometry(1,1)` with
`PlaneGeometry(1,1, BEND_SEGMENTS, 1)` (`BEND_SEGMENTS = 16`).

The math (pure, unit-testable — see Testing): a card point at **tangential offset `s`** from the
card centre (`s ∈ [−w/2, w/2]`, where `w` is the card's world width `= aspect · cardSize · (1 − padding)`)
maps onto the ring arc of radius `R = radius`. At `bend = 1`:
- tangential component: `R · sin(s/R)` (→ `s` as `s/R → 0`),
- inward component (toward ring centre): `R · (1 − cos(s/R))`.

At `bend = 0` the point stays flat (`tangent = s`, `inward = 0`). Interpolate **each component by
`bend`**. The centre vertex (`s = 0`) never moves at any bend, so the card curls symmetrically about
its centre, edges toward the ring centre (concave to the near-side viewer). Extract this as a pure
`bentOffset(s, R, bend) → { tangent, inward }`.

*Implementation note (resolve while building):* the mesh currently gets its world width from a
**non-uniform** `mesh.scale.x`, which would distort a bend applied in unit-local space (x scaled by
`w`, z by 1). So the bend must be baked at the card's true world width — either build the displaced
geometry at world width and drop `scale.x` for bent cards, or apply `bentOffset` in a frame that
isn't then non-uniformly scaled. Pick one during implementation and note it.

Recompute a card's bent geometry only when `bend`, `aspect`, `cardSize`, `radius`, or `padding`
change (cache a signature on `mesh.userData.bendSig`); when `bend ≈ 0`, leave the flat base geometry
untouched. Applies to **both** image and glyph tiles (a bent letter).

**Ring opening (`ringOpening`, live).** A second orientation rotation of the ring group, on a
distinct axis from `ringTilt`. `ringTilt` stays the group's lean (`rotation.x`); `ringOpening` drives
the reveal so at 0 the ring is edge-on/collapsed (you see a card face-on) and at 1 the full circle is
visible. Implement as a rotation on the perpendicular axis composed after tilt, and **live-verify the
two endpoints in the browser** match the described look — tune the angular range (roughly a 0 → ~80°
sweep) to hit "head-on" at 0 and "full circle" at 1. The mapping is an implementation detail; the two
endpoints are the acceptance test.

**Padding (`padding`, live).** In `update`, multiply each card's width by `(1 − padding)` so
neighbours no longer touch: `quad.scale.set(aspect · cardSize · (1 − padding), cardSize, 1)` (times
the `ringTransform` scale). Height is unaffected — padding opens horizontal gaps, distinct from
`cardSize` (uniform).

**Back fade (`backFade`, live).** In `update`, set each card's material opacity from its depth: cards
farther from the camera fade. Compute a normalized backness from the card's post-transform world Z
(or its ring angle relative to the front), `back ∈ [0,1]` (0 = nearest, 1 = farthest); set
`material.opacity = 1 − backFade · back`. Materials are already `transparent: true`.

**Corner radius (`cornerRadius`, live).** Round **image** card corners via a fragment-shader alpha
mask (a rounded-rect SDF on the card UVs), added through `material.onBeforeCompile` on image tiles,
with a `uCorner` uniform (in card-half-width units) and the card `uAspect`. Glyph tiles are skipped
(no panel to round). Keeping it a uniform makes it live/animatable at no per-frame CPU cost.

## Files

- **Modify** `app/lib/spacetype/effects/ring.ts` — the 7 new controls, the repeater loop in
  `buildScene`, subdivided geometry + bend displacement, ring-opening rotation, padding, back-fade,
  and the corner-radius shader hook. This is the whole feature; the file grows but stays one effect.
- **Modify** `app/lib/spacetype/ringLayout.ts` *(only if needed)* — `ringTransform` stays pure
  placement; padding/back-fade/bend/opening are applied in `ring.ts`, so this file likely needs no
  change. If any pure helper (e.g. a backness-from-angle function) is worth extracting for testing,
  it goes here.

## Testing

- **Unit (pure):** the bend displacement math — extract `bentOffset(s, R, bend) → { tangent, inward }`
  into `ringLayout.ts` and test it: `bend = 0` returns `{ tangent: s, inward: 0 }` (flat) for every
  `s`; `bend = 1` returns `{ tangent: R·sin(s/R), inward: R·(1−cos(s/R)) }`; the card **centre is
  preserved** (`s = 0 → { 0, 0 }` at all bend values); `inward ≥ 0` and grows with `|s|` (edges curl
  toward centre). Also a backness helper if extracted (front angle → 0, back → 1). Repeater:
  `repeat = 3` on a 2-tile content list yields 6 quads (assert in the existing `ring-effect` test
  with an image-only list).
- **Manual / live:** the acceptance tests that can't be unit-tested — ring-opening endpoints (head-on
  at 0, full circle at 1), bend visibly curving a photo card, padding opening gaps, back-fade dimming
  the far side, corner-radius rounding a photo. Drive the studio and screenshot; verify each control
  moves the render (revert-to-confirm for anything that looks like a no-op).

## Risks

- **Bend cost.** Per-frame vertex displacement for every card is the one non-trivial cost. Mitigated
  by the `bendSig` cache (recompute only on change) and skipping entirely at `bend ≈ 0` — a static
  bend pays once, and only an *animating* bend pays per frame.
- **Ring-opening axis math.** The exact Euler composition is fiddly; handled by defining the two
  endpoints as the acceptance test and verifying live, rather than deriving it blind.
- **Corner-radius shader on MeshBasicMaterial.** `onBeforeCompile` on a basic material is used
  elsewhere in this codebase (Scene3D materials); the SDF mask is standard. Glyph tiles are excluded
  so there's no interaction with the glyph UV sub-rect remap.
- **Saved-doc compatibility.** All additions are new keys with defaults; `radius` keeps its key (only
  its label changes). Existing ring documents open unchanged, gaining the new controls at defaults.

## Done when

All 7 controls appear in the ring inspector and each visibly changes the render; bend curves cards
(photos and letters), the repeater fills the ring from a few elements, ring-opening sweeps head-on →
full circle; the bend + backness math is unit-tested; existing ring and non-ring documents render
unchanged; and because every control is a declared `ControlSpec`, bend / ring-opening / the rest are
confirmed keyframeable on the Motion tab.
