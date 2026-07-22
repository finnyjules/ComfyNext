# Shader Studio expansion: FBM Warp + Flag effects, generative un-hiding, picker sections

**Date:** 2026-07-22
**Status:** Approved (brainstormed with Julien)

## Goal

Four deliverables, approved as one scope:

1. New effect `fbm_warp` — a strong FBM-driven image melt (distortion).
2. New effect `flag` — cloth/flag wave distortion with anchor edge (distortion).
3. Show the 11 `generative`-flagged effects in the Shader Studio picker.
4. Category **sections** in the effect picker grid, as an opt-in feature of the
   shared `CatalogModal` (chips stay; sections add visible grouping).

## Context

- Effects live in `shader_effects/*.frag` + one entry in
  `shader_effects/manifest.json`; the backend route
  (`comfy_extras/_shader_effects.py`) re-reads the catalog per request, so new
  effects appear on page reload with no server restart.
- The Shader Studio picker (`frontend/app/components/vue-canvas/ShaderStudioSurface.vue`)
  currently filters out `generative: true` effects (lines ~363, 370-376, 389).
- The picker renders through the shared `frontend/app/components/CatalogModal.vue`
  (used by ~10 galleries). Per the render-parity house rule, shared UI behavior
  goes into the shared component.
- Golden parity gate: `tests-unit/shaderfx_golden/generate_goldens.py` bakes
  server-GL PNGs (u_time=0.7, u_seed=42, defaults, 128+256 px);
  `frontend/tests/shaderfx-golden.spec.ts` diffs the browser renderer against
  them. `tests-unit/comfy_extras_test/shader_effects_test.py` validates the
  manifest. Known pre-existing failure: `crystal_prism` golden (do not let it
  block; do not "fix" it in this scope).

## 1. `fbm_warp` — "FBM Warp"

Distortion-category effect: two-stage domain-warped FBM displaces the texture
lookup once (single tap). Distinct from `noise_distortion` (subtle single-stage
jitter) and from `fbm` (generative field). The two-stage warp (`q` field feeds
`r` field, matching the existing `fbm.frag` construction and its `pcg`/`vnoise`
helpers) produces marbled, wet-paint melting.

Manifest entry:

| param | uniform | range | default | notes |
|---|---|---|---|---|
| Amount | `u_amount` | 0–0.5 | 0.12 | displacement distance (uv units) |
| Scale | `u_scale` | 0.5–8 | 3.0 | noise frequency, aspect-corrected |
| Warp | `u_warp` | 0–4 | 2.0 | domain-warp feedback; the melt dial |
| Detail | `u_detail` | 0–1 | 0.5 | octave amplitude falloff (fixed 5 octaves; falloff `mix(0.35, 0.65, u_detail)`) |
| Speed | `u_speed` | 0–3 | 0.6 | 0 = frozen marble |

`animated: true`, `passes: 1`, `category: "distortion"`, no textures, clamped
lookups, house boilerplate (`#version 300 es`, `u_seed`, `v_texCoord`).

## 2. `flag` — "Flag"

Distortion-category effect: traveling-wave cloth with anchor envelope and slope
shading.

Algorithm (single pass):
- Wind axis from anchor: displacement is perpendicular to the anchored edge's
  axis; `none` anchors nothing (full-frame billow, uniform envelope).
- Phase = primary traveling sine along the wind axis + a half-frequency
  secondary harmonic + small FBM gust wobble (`u_gust` scales it) so motion
  never loops robotically.
- Amplitude envelope: 0 at the anchored edge → 1 at the free edge (smoothstep
  ramp); `none` ⇒ constant 0.75.
- With an anchor set, add a slight sag (gravity droop toward the free edge) and
  a small along-wind compression term so the cloth reads as hanging fabric.
- Shading: cloth folds lit by the wave slope (`cos(phase)` derivative), scaled
  by `u_shading`; 0 = pure distortion.

Manifest entry:

| param | uniform | range | default | notes |
|---|---|---|---|---|
| Anchor | `u_anchor` | enum | `left` | none / left / right / top / bottom |
| Amplitude | `u_amplitude` | 0–0.25 | 0.08 | |
| Frequency | `u_frequency` | 0.5–8 | 2.5 | waves across the frame |
| Speed | `u_speed` | 0–3 | 1.0 | |
| Gust | `u_gust` | 0–1 | 0.35 | 0 = clean sine |
| Shading | `u_shading` | 0–1 | 0.5 | fold lighting strength |

Enum params already exist in the manifest schema (the studio excludes them from
randomize — fine). `animated: true`, `passes: 1`, `category: "distortion"`.

## 3. Un-hide generative effects in the studio picker

In `ShaderStudioSurface.vue`, remove the `!def.generative` / `!e.generative`
conditions from: picker item list, thumbnail warming (both call sites), and
category counts. A `generative` chip then appears via the existing
chip-derivation code. No manifest changes. Semantics in a chain are the
existing shader semantics: effects that read `u_hasInput` modulate the incoming
image; pure generators replace the layer (base-layer behavior). Thumbnails go
through the existing preview path (`u_hasInput: 1` + placeholder) unchanged.

## 4. Sections in `CatalogModal` (opt-in)

New optional props on `CatalogModal`:

```ts
sections?: { id: string; label: string }[]   // ordered; presence enables grouping
sectionOf?: (item: T) => string              // item → section id
```

Behavior when provided:
- Grid renders one titled group per section, in the given order, each with its
  own `repeat(auto-fill, …)` grid (same card slot). Header style: small caps
  label + hairline rule + count, matching the house modal typography.
- Items not matching any section id fall into a trailing "Other" group (id
  `__other`) — defensive; shouldn't happen for the shader picker.
- Empty sections (post search/filter) are not rendered.
- Keyboard nav unchanged: `items` stays one flat array; the CALLER passes it
  ordered section-by-section so arrow-key order follows the visual order.
- No `sections` prop ⇒ exactly today's flat grid. Other galleries untouched.

Shader picker adoption (`ShaderStudioSurface.vue`):
- Section order: Distortion, Stylize, Color, Lens, Blur, Glow, Generative.
- `pickerItems` sorted by that order (stable within a section by catalog order).
- Chips keep filtering; with a single-category chip active only that section
  renders (header still shown for consistency).
- `ShaderEffectNode.vue`'s gallery (same modal, standalone node) may adopt the
  same sections trivially since it shares the catalog — in scope only if it is
  a ≤5-line change; otherwise leave it.

## Non-goals

- No new generative effects; no changes to the 11 existing generator shaders.
- No section adoption in the other 9 galleries.
- No fix for the pre-broken `crystal_prism` golden.
- No randomize support for enum params.

## Testing

- Bake goldens for `fbm_warp` + `flag` via `generate_goldens.py`; both must
  pass the browser-parity spec (`shaderfx-golden.spec.ts`), `crystal_prism`
  excepted as pre-broken.
- `shader_effects_test.py` manifest validation passes with the two new entries.
- Picker behavior: verify in the running app — generative section present with
  11 effects, sections ordered as specified, chips filter to one section,
  search hides empty sections, new effects render on an image in the studio.
- `flag` anchor enum: visually verify left-anchor ripple grows toward the right
  edge and `none` billows the whole frame.
