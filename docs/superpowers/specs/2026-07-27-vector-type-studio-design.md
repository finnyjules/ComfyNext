# Vector Type Studio — design

**Date:** 2026-07-27
**Status:** Design for review — not yet planned
**Framing:** This is the **kinetic redesign**, not a seventh type surface. It replaces as it adds.

## The idea in one line

Letters stop being pictures and become **outlines you animate directly** — so type can be morphed, offset, deformed and exported as real vector.

## Why this, and why now

`app/lib/kineticEnabled.ts` has said this for a while:

> *"Kinetic Slates … is **hidden pending a redesign of the feature**. The implementation is left intact; only the user-facing entry points are gated off."*
> `export const KINETIC_ENABLED: boolean = false`

The kinetic surface is already switched off waiting for a redesign. This is that redesign.

Three other things line up behind it:

1. **Motion is the verified wedge.** The demand research found motion the loudest unmet signal, with incumbents split between too-hard (After Effects) and too-basic (Canva). Type-in-motion is a large share of the social and brand work that sits in that gap.
2. **Everything Sailor generates today is raster.** Six studios, all producing pixels. Real vector output is a categorically new deliverable, not another look.
3. **A spike proved the hard part works** (2026-07-27, results below), using parts that already exist.

## The three-way distinction — why this doesn't overlap

Sailor would have exactly one of each way to treat a letter:

| | Technique | Letter is… |
|---|---|---|
| **Space Type** | text → texture atlas → mapped onto 3D ribbons/tunnels/spirals | a **picture painted onto a shape** |
| **Scene3D text** | glyph outlines → `ExtrudeGeometry` | a **3D solid** |
| **Vector Type** *(new)* | glyph outlines → 2D paths, animated as geometry | an **outline you animate directly** |

These are genuinely different materials. Space Type stays — it is the flagship and 11.2k lines of engine; nothing here competes with it.

## Retirement list — the part that makes this a redesign

**Retire on ship:**
- **Kinetic Slates.** Already `KINETIC_ENABLED = false`. This design supersedes it; the flag becomes permanent and its entry points go.

**Supersede, migrate, then remove:**
- **Font Playground widget** (`WidgetFontPlayground.vue`, 730 lines). It drives variable axes and **rasterizes to a PNG**. This studio does the same thing as geometry. Keep the widget working until the studio ships, then migrate its node and remove it.

**Absorb later, not in v1:**
- **TextOnPath** (279) and **TextMask** (375) widgets. Both become *features* of an outline-native studio (text on a path is a path deform; text mask is a boolean op) rather than standalone widgets. Not v1 — but the plan should not pretend they'll live forever.

**Untouched:**
- Space Type, Scene3D text, Compositor text layers. Different jobs.

**Net surface count: six → five**, with two more absorbable later.

## What the spike established (2026-07-27)

Run live against the running app.

**The naive path is closed.** The `opentype` build vendored inside three parses `fvar` (2 refs — it can read *which* axes exist) but has **zero `gvar` support** (0 refs). `gvar` holds the per-point deltas. So it can report "Inter has weight 100–900" and cannot produce the outline at weight 650.

**The fallback works, and is structurally sound.** Two static instances of the same family interpolate cleanly:

- Every glyph tested — `A G O & g 8`, including the awkward ones — has **identical command counts and identical command-type sequences** between weight 100 and 900, in both Inter (2048 upem) and Archivo (1000 upem). They come from the same masters, so points correspond one-to-one.
- Interpolating and measuring ink coverage gives a smooth monotonic ramp: `A` = 1921 → 4981 → 7848 → 10438 → 12829 across t = 0…1. Same shape for `g` and `&`.

**Everything needed already exists:** `opentype` (via three, in `scene3d/outlines.ts`), the Google font proxy that already serves weight-specific static TTFs (`/api/scene3d/google-font-file`), Paper.js (installed, headless, used by `useVectorSvg.ts`), and the Compositor's `PathLayer` model.

**Known limits of the fallback:**
- Only families Google serves **static cuts** for. Roboto Flex returns **502** — variable-only. The best variable font is the one this can't use.
- Effectively **one axis** with two fetches. Weight × width needs four corner instances and bilinear blending.
- **Linear approximation.** Real fonts can carry non-linear axis mappings (`avar`); a straight lerp approximates. Fine for display type, not typographically exact.

## Scope — v1

Deliberately narrow. The test for inclusion: *could the Compositor's text layer already do this?* If yes, it isn't v1.

**In:**
1. **Text → outlines.** Reuse `scene3d/outlines.ts`'s glyph path extraction; add a 2D path output alongside its existing `THREE.Shape[]`.
2. **Axis animation** — weight as geometry, via two-instance interpolation. The headline.
3. **Per-glyph stagger** — the thing that makes it *kinetic*: delay, and per-glyph transform.
4. **Fill + stroke rendering** to canvas, including outline **offset** (weight as geometry, independent of the font's own axis).
5. **PNG bake** through the existing studio cascade — so it behaves like every other studio on day one.
6. **SVG export** — Sailor's first real vector output.

**Out of v1, explicitly:**
- Morphing between different strings (different glyph counts — a genuine research problem)
- Boolean ops between letters (Paper.js can, but it needs its own design pass)
- Field deformation of anchor points (wants the field work first)
- Complex-script shaping (opentype's shaping is basic; Latin display type only)
- Multi-axis blending (needs four-corner fetches)

## Architecture — how it fits what exists

**It is a factory studio, built the way the last three were:**
- `lib/vectortype/config.ts` + `controls.ts` → one declaration gives agent, motion, sweeps, **and** the inspector (via `StudioControlPanel`, which now exists)
- Registered at the nine touchpoints Shape's map enumerated
- `registerStudioBaker` for PNG, so it joins the cascade

**It is stateless, which means motion is free.** A vector type frame is `f(text, axes, t) → paths`. There is no engine to rebuild — unlike Shape, whose `setConfig` disposes and rebuilds geometry, capping it at camera-and-scale animation. This studio is shaped like Gradient, which is why Gradient can animate 30 parameters. **It arrives fully animatable.**

**The shared piece worth building once: a vector export spine.** SVG output should not be per-studio. Shape Studio is the obvious second consumer — its flat-shaded facets project to coloured polygons, which is exactly an SVG. Design the writer so both feed it.

## Open decisions

1. **Kinetic Slates: delete or leave dormant?** The code is intact behind a flag. Deleting is honest; leaving it costs nothing but keeps a dead surface in the tree.
2. **fontkit now, or two-instance interpolation?** The spike says interpolation ships today with zero dependencies but limits font coverage. fontkit is one dependency and unlocks every axis on every variable font, including Roboto Flex. **Recommendation: ship on interpolation, add fontkit when a real font is blocked by it** — the abstraction is the same either way.
3. **Does the Font Playground node migrate or coexist?** Migration is cleaner but touches saved projects.
4. **Name.** "Vector Type" is descriptive; "Type Studio" collides with Space Type's informal name.

## Risks

- **Sprawl if nothing retires.** Six type surfaces is already a lot. If this ships without the retirement list, it is the bloat the landscape research flagged as how tools in this category decay. The retirement list is not optional garnish.
- **Font coverage disappoints.** If the families users want are variable-only, interpolation fails and it looks broken rather than limited. Mitigation: detect variable-only families and say so plainly in the UI, rather than silently rendering one weight.
- **Performance.** Hundreds of anchor points per glyph, animated per frame, is real work. Bound the character count in v1 and measure before promising long strings.
