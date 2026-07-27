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

Run live against the running app. **Two spikes — the second supersedes the first.**

### Spike 1 — the vendored parser is a dead end

three's bundled `opentype` parses `fvar` (2 refs — it reads *which* axes exist) but has **zero `gvar` support** (0 refs). `gvar` holds the per-point deltas, so it can report "Inter has weight 100–900" and never produce the outline at 650.

A fallback works: two static instances interpolate cleanly (identical command counts *and* sequences across `A G O & g 8` in Inter and Archivo; ink coverage ramps monotonically 1921 → 12829). Kept on record as a zero-dependency option, but not the chosen path.

### Spike 2 — fontkit, and it is decisively better

`fontkit@2.0.4` added. It ships a browser build (`dist/browser-module.mjs`) and depends on `brotli`, so it decodes woff2. **Confirmed working in the browser against real variable fonts:**

| | Inter | Roboto Flex |
|---|---|---|
| Parsed as variable | ✅ | ✅ |
| Axes | 2 — `opsz`, `wght` | **13** — `wght`, `wdth`, `opsz`, `slnt`, `GRAD`, `XOPQ`, `YOPQ`, `XTRA`, `YTUC`, `YTLC`, `YTAS`, `YTDE`, `YTFI` |
| Weight sweep (glyph bbox area) | 1,358,512 → 1,828,988 | 1,378,312 → 1,722,176 |
| Path commands across the sweep | **46, constant** | **36, constant** |

Two things matter here. **Outline topology is stable** — the command count never changes across the axis range, so animating between any two positions is safe by construction, no point-matching needed. And **Roboto Flex works**, which the interpolation fallback could not touch at all (Google serves it no static cuts — the proxy returns 502).

Roboto Flex's exotic axes are the genuinely unexplored surface: `XOPQ` (stroke thickness), `YTAS` (ascender height), `GRAD` (grade — weight without width change). Nothing in the market exposes these as animatable design parameters.

### The font source is NOT the CSS2 API

Important and non-obvious. `fonts.googleapis.com/css2` **never serves the variable file**:
- with a `curl` UA it returns static per-weight TTF cuts (325 KB, `glyf` only)
- with a browser UA it returns woff2 — but still `font-weight: 100`, a **static instance**, split by unicode-range

The variable TTFs live in the Google Fonts repo, e.g.
`raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter[opsz,wght].ttf`
— verified to carry `fvar`, `gvar` and `avar` for Inter, Archivo and Roboto Flex.

**Consequence for the plan:** a new proxy route is needed alongside the existing `/api/scene3d/google-font-file`, resolving family → variable TTF from the fonts repo, with the same cache-and-allowlist treatment. It is a different source, not a parameter change.

Spike code: `frontend/app/lib/vectortype/spike.ts` — temporary, superseded by the plan's first task.

## Scope — v1

Deliberately narrow. The test for inclusion: *could the Compositor's text layer already do this?* If yes, it isn't v1.

**In:**
1. **Text → outlines** via fontkit, with a variable-TTF proxy route. Note this does NOT reuse `scene3d/outlines.ts` — that path is opentype-based and cannot vary; the two coexist until Scene3D text is optionally migrated later.
2. **Axis animation** — any axis as geometry, via fontkit variations. The headline. Roboto Flex alone exposes 13, including `XOPQ`, `GRAD` and `YTAS`, which nothing in the market animates.
3. **Per-glyph stagger** — the thing that makes it *kinetic*: delay, and per-glyph transform.
4. **Fill + stroke rendering** to canvas, including outline **offset** (weight as geometry, independent of the font's own axis).
5. **PNG bake** through the existing studio cascade — so it behaves like every other studio on day one.
6. **SVG export** — Sailor's first real vector output.

**Out of v1, explicitly:**
- Morphing between different strings (different glyph counts — a genuine research problem)
- Boolean ops between letters (Paper.js can, but it needs its own design pass)
- Field deformation of anchor points (wants the field work first)
- Complex-script shaping (opentype's shaping is basic; Latin display type only)
- Multi-axis *choreography* (several axes on independent timelines) — fontkit makes multi-axis sampling free, but the authoring UI for it is its own design problem

## Architecture — how it fits what exists

**It is a factory studio, built the way the last three were:**
- `lib/vectortype/config.ts` + `controls.ts` → one declaration gives agent, motion, sweeps, **and** the inspector (via `StudioControlPanel`, which now exists)
- Registered at the nine touchpoints Shape's map enumerated
- `registerStudioBaker` for PNG, so it joins the cascade

**It is stateless, which means motion is free.** A vector type frame is `f(text, axes, t) → paths`. There is no engine to rebuild — unlike Shape, whose `setConfig` disposes and rebuilds geometry, capping it at camera-and-scale animation. This studio is shaped like Gradient, which is why Gradient can animate 30 parameters. **It arrives fully animatable.**

**The shared piece worth building once: a vector export spine.** SVG output should not be per-studio. Shape Studio is the obvious second consumer — its flat-shaded facets project to coloured polygons, which is exactly an SVG. Design the writer so both feed it.

## Decisions taken (2026-07-27)

1. **Kinetic Slates — delete.** Not left dormant.
2. **fontkit — added** (`2.0.4`). Spike 2 justifies it: every axis on every variable font, stable outline topology, and Roboto Flex works where interpolation could not.
3. **Font Playground — migrate**, then remove the widget.
4. **KineticType node — replace, with a migration** so saved nodes open in the new studio carrying their text and preset.
5. **Name — deferred.** "Vector Type" is a working title.

## Corrections to the retirement list (found while scoping)

The original list conflated two different things and would have broken live code.

**`lib/motion/` must be KEPT.** The comment in `kineticEnabled.ts` lists it as part of the dormant feature; that comment is **stale**. It is now live infrastructure imported by `useCompositorLayers`, `CompositorMotionTimeline`, `MotionPresetPicker`, `KeyframeDock` and `MotionClipInspector` — the shipped Compositor motion redesign and the timeline.

**`uploadFrameBatch` must be EXTRACTED before anything is deleted.** It lives in `useKineticRenderer.ts` but is general-purpose: Shape, Gradient, Texture, Shader, Space Type, Compositor and both bake modules all call it to upload baked frame sequences. Move it to a neutral home (`lib/studio/frameUpload.ts`) and repoint its call sites first, or deleting the kinetic files breaks video export in every studio.

**Kinetic Slates ≠ Kinetic Type.** Only *Slates* is gated off. `KineticType` is a **live, ungated node** in the toolbox ("Animated text — type a word, pick a motion preset…"), reachable today and possibly in saved projects. It is the real thing this replaces, which is why it needs a migration rather than a deletion.

**Genuinely dead set (~450 lines):** `lib/slates/` (2 files), `data/slate-templates.ts`, `SlateGalleryModal.vue`, `lib/kineticEnabled.ts` and its three gates (`studio-options.ts:25`, `layouts/default.vue:4232`, `CompositorModal.vue:4076`).

## Risks

- **Sprawl if nothing retires.** Six type surfaces is already a lot. If this ships without the retirement list, it is the bloat the landscape research flagged as how tools in this category decay. The retirement list is not optional garnish.
- **Font coverage.** fontkit removes the variable-only problem, but the fonts repo is a different source from the existing CSS2 proxy: family→file-path resolution is by convention (`ofl/<family>/<Family>[axes].ttf`) and will not resolve for every family. Mitigation: resolve against the repo listing and fall back to a static cut with the axis controls disabled and labelled, rather than silently rendering one weight.
- **Performance.** Hundreds of anchor points per glyph, animated per frame, is real work. Bound the character count in v1 and measure before promising long strings.
