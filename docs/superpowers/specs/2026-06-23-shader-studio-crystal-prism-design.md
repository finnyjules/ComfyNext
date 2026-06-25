# Crystal Prism — Shader Studio effect

**Date:** 2026-06-23
**Status:** Approved, implementing

## Goal

A new Shader Studio distortion effect, `crystal_prism`, that refracts and
displaces the input image like cut crystal / a glass prism. One effect, three
modes, with chromatic dispersion, built-in shimmer, and luminous facet-seam
glints.

## Architecture

Self-contained, no Vue changes. Two additions only:

- `shader_effects/crystal_prism.frag` — GLSL ES 3.00 fragment shader.
- `shader_effects/manifest.json` — one effect entry (registration + param schema).

Controls auto-render from the param schema (float → slider, enum → dropdown).
Float params are picked up by the studio motion-track system automatically. A
ComfyUI restart re-reads the manifest and the effect appears in the picker.

Models after existing effects:
- `kaleidoscope.frag` — multi-mode enum dispatch + draggable center.
- `liquify.frag` — FBM noise warp (Glass mode base).
- `lens_distortion.frag` — aspect-corrected radial coordinates.

Renderer contract (from `frontend/app/lib/shaderfx/renderer.ts`):
- Input texture `u_image0` (CLAMP_TO_EDGE), original `u_source`.
- Always-set uniforms: `u_resolution`, `u_time`, `u_seed`, `u_hasInput`.
- Varying `v_texCoord` in [0,1]². Output `fragColor0`. Full-screen triangle VS.

## Controls (manifest params)

| uniform | label | type | range / options | default |
|---|---|---|---|---|
| `u_mode` | Mode | enum | Glass=0 · Faceted=1 · Prism=2 | 0 |
| `u_facetStyle` | Facet style | enum | Voronoi=0 · Radial=1 · Shards=2 | 0 |
| `u_refraction` | Refraction | float | 0 – 1, step 0.01 | 0.3 |
| `u_dispersion` | Dispersion | float | 0 – 0.1, step 0.005 | 0.02 |
| `u_facets` | Facets / scale | float | 3 – 24, step 1 | 8 |
| `u_glint` | Edge glint | float | 0 – 1, step 0.01 | 0.25 |
| `u_shimmer` | Shimmer | float | 0 – 1, step 0.01 | 0.2 |
| `u_rotation` | Rotation | float | 0 – 360, step 1 | 0 |
| `u_centerX` | (center) | float | 0 – 1, step 0.001 | 0.5 |
| `u_centerY` | (center) | float | 0 – 1, step 0.001 | 0.5 |

Manifest flags: `animated: true`, `passes: 1`, `centerParam: ["u_centerX","u_centerY"]`,
`category: "distortion"`, `generative: false`, `textures: []`. Seed comes from the
built-in `u_seed` uniform.

## Mode behaviour

All modes share a single dispersion implementation: each output pixel samples R,
G, B along the same refraction offset direction but scaled by
`(1 - d)`, `1`, `(1 + d)` respectively (R bent least, B most), where the spread is
`u_dispersion`. This keeps the rainbow consistent across modes.

### Glass (mode 0)
Smooth thick-irregular-glass refraction. 2-octave FBM of the centered, rotated,
aspect-corrected coordinate produces a displacement vector; magnitude scales with
`u_refraction`. No hard edges. Dispersion appears as soft rainbow fringing. Glint
rides FBM ridge lines (high gradient magnitude of the noise field). Center +
radial falloff so the effect can concentrate around the focus point.

### Faceted (mode 1)
Partition the plane into cells; each cell refracts the image by a per-cell
constant offset derived from a hashed cell id (the flat-facet "shattered crystal"
look). `u_facets` controls cell density / count. `u_facetStyle` selects the
partition:
- **Voronoi (0)** — jittered-grid Voronoi cells (seeded by `u_seed`). Organic gem.
- **Radial (1)** — angular wedges fanning from the center, count = `u_facets`,
  mirrored for symmetry (cut round-brilliant).
- **Shards (2)** — grid cells split along a diagonal into triangles (cracked glass).

Edge glint = bright rim as the pixel approaches a cell boundary (distance to the
second-nearest Voronoi feature / wedge seam / triangle edge), tinted toward the
dispersion rainbow.

### Prism (mode 2)
Minimal positional displacement, maximal chromatic dispersion. The per-channel
offset grows with distance from center (edge-weighted), producing clean prismatic
rainbow separation toward the frame edges. Glint optional/low here.

## Shimmer

`u_shimmer` scales a `u_time`-driven term that slowly rotates facet seeds (adds to
the effective `u_rotation`) and advances the FBM phase, so the crystal subtly
breathes and sparkles. `u_shimmer = 0` → fully static (no `u_time` contribution).

## Verification (before wiring in)

Per project rule "verify visuals with screenshots", do NOT ship on the manifest
alone:

1. Build a standalone HTML harness that compiles `crystal_prism.frag` against a
   WebGL2 full-screen triangle and a test image, with the same uniform names the
   renderer provides.
2. Drive it with Playwright; screenshot a matrix of mode × facet-style ×
   dispersion / refraction / glint values.
3. Iterate on the GLSL until each mode reads convincingly as crystal/glass/prism.
4. Get user look sign-off.
5. Then restart ComfyUI and confirm it appears + works in the actual studio modal.

## Out of scope

- New texture assets (uses procedural noise/hash only).
- Multi-pass (single pass is sufficient).
- Vue/UI code (auto-rendered from schema).
