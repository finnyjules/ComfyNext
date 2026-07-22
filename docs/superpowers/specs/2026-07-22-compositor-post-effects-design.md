# Compositor post-processing effects — per-layer + canvas post stack

**Date:** 2026-07-22
**Status:** Approved design
**Builds on:** the existing `LayerEffect` system in `frontend/app/composables/useCompositorLayers.ts` (drop shadow / layer blur / inner shadow / background blur) and the single-shared-painter architecture (`drawLocalLayer` / `paintLayerStack`) that gives modal preview, ArtifactFrameNode, motion bake, and agent bake render parity.

## Problem

The compositor's layer effects stop at shadows and blurs. There is no way to grade a layer (brightness/contrast/saturation/hue), glow it (bloom), texture it (grain), or stylize it (vignette, duotone) — and no way to apply a finishing pass over the whole composite. Users have to round-trip through a generation model for looks that are cheap, deterministic Canvas 2D operations.

## Approach

Extend the existing Canvas-2D effect system (approach A of A/B/C considered):

- New `LayerEffect` union members rendered by the shared painter with offscreen-canvas compositing recipes and `ctx.filter` (already a dependency for `layer_blur`, so no new browser-support surface).
- A doc-level post stack threaded through `paintLayerStack` as a new optional parameter — absent ⇒ byte-identical output, same pattern as the existing optional `background` / `groups` params.

WebGL (shaderfx) and SVG `url(#filter)` approaches were rejected: they fork the shared-painter parity architecture or couple the painter to DOM filter defs. If duotone's compositing approximation proves visually insufficient, a targeted per-pixel (`getImageData`) pass inside the painter is the sanctioned fallback — never a DOM filter.

## Effect types

All follow the existing conventions: single instance per type per layer, `visible: boolean`, spatial params normalized to canvas width (`* W` at draw time).

```ts
export interface AdjustEffect {
  type: 'adjust'
  brightness: number  // 1 = neutral, CSS filter brightness() multiplier, 0..2
  contrast: number    // 1 = neutral, 0..2
  saturation: number  // 1 = neutral, 0..2
  hue: number         // degrees, -180..180, 0 = neutral
  visible: boolean
}
export interface BloomEffect {
  type: 'bloom'
  threshold: number   // 0..1 — luminance cutoff for the bright pass
  radius: number      // blur radius, normalized to canvas width
  intensity: number   // 0..2 — alpha of the additive composite
  visible: boolean
}
export interface GrainEffect {
  type: 'grain'
  amount: number      // 0..1 — composite alpha
  size: number        // 1..8 — noise texel scale in device px
  visible: boolean
}
export interface VignetteEffect {
  type: 'vignette'
  amount: number      // 0..1 — darkening strength
  size: number        // 0..1 — inner radius where falloff starts
  softness: number    // 0..1 — falloff width
  visible: boolean
}
export interface DuotoneEffect {
  type: 'duotone'
  shadows: string     // hex color mapped to luminance 0
  highlights: string  // hex color mapped to luminance 1
  mix: number         // 0..1 — blend between original and duotone result
  visible: boolean
}
```

`LayerEffect` union grows by these five. Existing persisted layers deserialize unchanged (unknown-type filtering already tolerant; new types simply absent).

## Rendering recipes

All new per-layer effects run on the existing "effected path" in `paintLayer` (render layer to canvas-size offscreen, composite back). The fast path stays byte-identical when no effects are present.

- **adjust** — build one filter string `brightness(b) contrast(c) saturate(s) hue-rotate(hdeg)` and include it in `ctx.filter` on the offscreen `drawImage` composite (composes with the existing `blur()` from `layer_blur`). Applied to the flattened offscreen, not per draw-op, so overlapping fill/stroke grade as one image.
- **bloom** — copy the effected offscreen to a second offscreen with a bright-pass approximation (`ctx.filter = brightness/contrast` push to crush sub-threshold pixels), blur it (`radius * W`), then `drawImage` over the composited layer with `globalCompositeOperation: 'lighter'` and `globalAlpha: intensity` (clamped). Bloom light may exceed the layer silhouette — that is the point; it is NOT clipped to layer alpha.
- **grain** — a module-level cached noise tile (~256×256, seeded PRNG, regenerated only when the `size` bucket changes) drawn as a repeating pattern onto a work canvas, clipped to the layer's alpha with `destination-in`, then composited over the layer with `'overlay'` at `globalAlpha: amount`. Deterministic: same seed every render so motion bakes and re-renders are stable (static grain in v1; animated grain is out of scope).
- **vignette** — radial gradient (transparent center → black at edges, stops derived from `size`/`softness`) drawn over the layer's offscreen clipped to layer alpha, composited `source-over` at `amount`. At canvas level: same gradient over the full frame, no clipping.
- **duotone** — grayscale the layer offscreen (`ctx.filter = 'grayscale(1)'` self-copy), then color-map: fill `shadows` color on a work canvas, draw the grayscale copy with `'screen'` (lifts toward white), then draw `highlights`-tinted via `'multiply'` of the inverse — the exact two-composite recipe is an implementation detail with one hard requirement: **luminance 0 renders `shadows`, luminance 1 renders `highlights`, monotone ramp between**. If no compositing recipe meets that acceptably, use a per-pixel `getImageData` map (offscreens are canvas-sized; acceptable cost). Result is clipped to layer alpha, then cross-faded with the original by `mix`.

**THREE.Color gotcha does not apply** (no THREE here), but 8-digit hex from color pickers must be handled wherever colors feed `fillStyle` — follow existing effect color handling.

## Canvas-level post stack

- New doc-level state `postEffects: LayerEffect[]` (same five types; `background_blur` et al not valid here), stored **alongside the doc background** wherever each surface persists it (compositor node properties, modal local state, agent state) and threaded to `paintLayerStack` as a new trailing optional param.
- Applied after the layer loop: snapshot the device canvas to an offscreen, apply effects in **fixed order adjust → duotone → bloom → vignette → grain** (grade before glow, texture last), stamp back in identity transform space. Absent/empty ⇒ no snapshot, byte-identical.
- Every `paintLayerStack` call site that has doc-level state (modal preview, modal export/bake, ArtifactFrameNode, motion bake, agent bake) threads it through. Call sites without doc state pass nothing and are unaffected.

## UI

- **Per-layer:** new sections in the CompositorModal right panel following the existing shadow/blur pattern (getter + patch helpers writing `layer.effects` via `setLocal`): Adjust (4 sliders), Bloom (3 sliders), Grain (2 sliders), Vignette (3 sliders), Duotone (2 color wells + mix slider). Each section has the same add/remove affordance as drop shadow today.
- **Canvas post:** the same five sections in a "Post-processing" panel shown when **no layer is selected**, next to the doc background fill control, writing `postEffects`.
- Slider ranges match the type comments; neutral defaults on add (adjust adds as all-neutral; bloom defaults threshold 0.6 / radius 0.02 / intensity 0.8; grain 0.25 / size 2; vignette 0.5 / 0.5 / 0.5; duotone dark navy → warm white / mix 1).

## Agent capabilities

The compositor agent's schema/vocabulary (`useCompositorAgent` + `app/lib/agent/capabilities.ts`) gains the five effect types on layers and the doc-level `postEffects`, so the AI agent can apply grades/bloom/grain by name. (`capabilities.ts` is currently touched by a parallel session — additions must be surgical hunks.)

## Out of scope (v1)

- Animating effect parameters over time (motion system integration beyond "static effects render correctly in baked frames").
- Per-group effects.
- Animated (per-frame re-seeded) grain.
- Server-side rendering — all bakes are client-side through the shared painter; no Python changes.

## Testing

- Unit: recipe-level tests where extractable (filter-string builder, vignette gradient stops, noise-tile determinism, duotone endpoint mapping via pixel sampling on an offscreen).
- Render parity: a paintLayerStack snapshot-style test (pixel sampling, not full golden images) asserting: no effects ⇒ unchanged pixels; each effect changes pixels in the expected direction (e.g. brightness up ⇒ mean luminance up; vignette ⇒ corners darker than center; bloom ⇒ pixels outside silhouette gain light).
- E2E: apply each effect in the modal on a seeded canvas, verify preview updates and persisted properties survive reload.
