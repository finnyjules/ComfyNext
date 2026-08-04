# Risograph shader effect — design

**Date:** 2026-08-04
**Status:** shipped

## In simple terms

A Risograph is a duplicator that prints with two or three tins of bright ink, one
pass each. What makes a riso print look like a riso print isn't grain — it's that
the picture was *separated*: its colour was thrown away and rebuilt out of two or
three inks, and then the passes didn't quite line up, so edges get a coloured
fringe.

So the effect does the real thing: split the image into 2–3 actual Riso ink
colours, print each as a pattern of dots at its own angle, nudge each one slightly
out of line, and lay them on paper with a bit of blotchiness and texture. You pick
an ink set (Fluoro Pink + Blue, and so on) and how strong each part is.

What's risky: nothing existing changes — this is a new effect sitting alongside the
others. The one thing to watch is that it must look right at small sizes too, not
just full size.

## Goal

A `risograph` effect in the Shader Studio catalog that simulates a real Risograph
duplicator print: the image separated into 2–3 spot-ink plates, each screened and
printed slightly out of register onto textured paper.

Not a grain overlay. The thing that makes a print read as riso is that the image
was *separated* — the colour was thrown away and rebuilt out of two or three
opaque-ish spot inks — and then the plates didn't quite line up.

## Surface

One new `shader_effects/risograph.frag` plus one entry in
`shader_effects/manifest.json`. No frontend changes: the catalog is
auto-discovered and re-read per request, so a browser reload picks the effect up
(no ComfyUI restart). Category `stylize`, `passes: 1`, `animated: false`,
`generative: false`, no textures.

## Pipeline

Per pixel, in order:

1. **Ink set.** `u_palette` (enum) indexes a hardcoded table of real Riso spot-ink
   RGBs. Each entry carries its own ink count (2 or 3), so there is no separate
   count control. Inks: Fluoro Pink, Blue, Yellow, Red, Green, Teal, Purple,
   Orange, Federal Blue, Black (riso black is ~0.145, not 0.0).

2. **Separation — colour-matched unmixing in density space.** Ink stacking is
   Beer-Lambert, so the separation and the composite are written as inverses of
   each other:

   - target density `d = -log(max(src, EPS))`
   - per-ink density `Dᵢ = -log(max(inkᵢ, EPS))`
   - solve `Σ cᵢ Dᵢ = d` for coverages `cᵢ`, least-squares over the 3 colour
     channels, with a non-negativity refit (clamp the offending ink to 0, re-solve
     the rest)

   Because the composite below is `Π pow(inkᵢ, cᵢ)`, a 3-ink palette with
   independent inks and no screening reproduces the source almost exactly. That is
   a testable property, not just a nicety — it is what keeps a photo readable
   instead of turning into a duotone of its own luminance.

   A 2-ink palette leaves residual by construction. That is correct: a two-colour
   riso print genuinely cannot hit every colour.

3. **Misregistration.** Each plate samples the source at its own offset —
   magnitude `u_misreg`, direction hashed from `u_seed` and the ink index. The
   offset moves the source sample *and* the screen grid together, so edges get a
   real coloured fringe rather than a blur.

4. **Halftone screen.** Each ink's coverage is screened on its own rotated grid at
   the classic separation angles (15° / 45° / 75°), cell size `u_dotSize`, dot
   radius `sqrt(coverage)` so tone stays area-correct. Anti-aliasing uses a
   resolution-derived pixel width, **not** `fwidth` — screen-space derivatives are
   the most likely source of browser-vs-server GL drift, and this effect has to
   pass the golden parity gate. `u_dotSize = 0` disables screening (continuous
   tone) without disabling the effect.

   When the cell is finer than about two pixels — catalog thumbnails, small
   previews, the 128px golden — the AA band spans the whole cell and every plate
   settles at ~50% coverage, which renders as a flat two-colour wash with the
   image gone. The screen therefore blends back to continuous tone below that
   size. Found by looking at the catalog thumbnail, not by any test: the parity
   gate passed the broken version happily, because both renderers were equally
   wrong.

5. **Ink mottle + roller streaks.** Coverage is modulated by a low-frequency fbm
   blotch field plus faint horizontal streaks (1D noise stretched along x), a
   different field per ink, amount `u_mottle`. This is what separates riso from
   clean CMYK offset.

6. **Paper.** Warm off-white base under everything; `u_paperTone` blends
   white→cream. `u_grain` adds fibre noise that modulates *ink coverage*, so the
   grain reads as ink failing to take on the paper rather than as an overlay
   sitting on top.

7. **Composite.** `result = paper * Π pow(inkᵢ, cᵢ')` over the screened, mottled
   coverages. Translucent stacking — pink over blue goes purple, not muddy.

## Controls

| Uniform | Label | Type | Range | Default |
|---|---|---|---|---|
| `u_palette` | Ink Set | enum (10) | — | 0 (Fluoro Pink + Blue) |
| `u_dotSize` | Screen | float | 0 – 0.06 | 0.008 |
| `u_misreg` | Misregistration | float | 0 – 0.02 | 0.004 |
| `u_inkDensity` | Ink Density | float | 0.3 – 1.6 | 1.0 |
| `u_mottle` | Ink Mottle | float | 0 – 1 | 0.35 |
| `u_grain` | Paper Grain | float | 0 – 1 | 0.3 |
| `u_paperTone` | Paper Tone | float | 0 – 1 | 0.5 |

Ink sets: Fluoro Pink + Blue, Fluoro Pink + Teal, Red + Blue, Yellow + Purple,
Orange + Federal Blue, Green + Fluoro Pink, Black + Fluoro Pink, Fluoro Pink +
Blue + Yellow, Red + Yellow + Blue, Black + Red + Yellow.

## Verification

- `tests-unit/test_shader_effects_enum.py` validates the manifest entry (enum
  options present, default is an option, float defaults within range).
- `frontend/tests/shaderfx-golden.spec.ts` iterates the manifest, so the effect
  gets a browser-vs-server-GL parity test the moment the entry lands. Goldens
  generated with `tests-unit/shaderfx_golden/generate_goldens.py` at 128 and 256.
- Live run in the Shader Studio node on a real photo. A shader that compiles and
  renders *something* proves nothing — verify by changing the palette index and
  the mottle/misreg sliders and confirming the output actually moves.

Known pre-existing: the `crystal_prism` and `oil_paint` goldens are already broken
in this repo. Failures there are not this change.
