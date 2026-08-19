# Compositor — Feather Elements

**Date:** 2026-08-18
**Status:** Design approved, ready for implementation plan

## Plain-language summary

In the Frame Compositor you can already give an element a torn-paper edge. This
adds the opposite treatment: **feathering** — softening an element's edges so
they fade smoothly out to transparent, like a soft mask around the element.

Because it works off the element's real alpha shape (its silhouette), it does the
right thing in every case with one implementation:

- A **rectangular photo** feathers into a soft-edged rectangle (blends into the
  background).
- A **cut-out PNG, shape, or text** feathers along its real outline.

The control is a single uniform **Amount** (how far the fade reaches inward) plus
a **Falloff** shape (Linear or Smooth). It works on any layer kind and is
reachable both from the panel UI and from the agent ("feather this image",
"soften the edges of the logo").

## Motivation

The compositor's job is blending elements together. Feathering is the most common
edge treatment for making a placed element sit in a scene — softening a photo's
hard rectangular border into the background, or easing a cut-out's outline so it
doesn't look pasted on. Today the only per-layer edge treatment is `tornEdge`
(ragged paper). Feather is its smooth sibling and reuses the same rendering
machinery.

## Non-goals (YAGNI)

- **Directional / per-edge feather** (fade only the bottom of a photo). Uniform
  all-edges only for v1.
- **Feather outward** (a glow/spread beyond the silhouette). Inward alpha
  falloff only.
- Any interaction with the existing brush-mask `featherPx` (that stays a
  mask-only concern; this is a general per-element treatment).

## Architecture

Feather mirrors the existing `tornEdge` feature end-to-end, so it slots into
patterns already proven in the codebase.

### 1. Data model — `lib/compositor/feather.ts`

A new per-layer optional field on `LocalLayer`:

```ts
export interface FeatherSpec {
  amount: number              // feather depth, normalized to canvas WIDTH
                              //   (like the Figma-style effects — survives resize/export)
  curve: 'linear' | 'smooth'  // alpha falloff shape across the band
}
```

Added to `LayerCommon` in `useCompositorLayers.ts`:

```ts
feather?: FeatherSpec  // soft alpha falloff at the layer's edges; absent/inactive ⇒ crisp edge
```

Module exports mirroring `tornEdge.ts`:

- `DEFAULT_FEATHER: FeatherSpec` — a sensible visible default (e.g. `{ amount: 0.03, curve: 'smooth' }`).
- `featherActive(f): f is FeatherSpec` — true when `amount > 0` (the gate that keeps
  amount-0 byte-identical to no feather).
- `sanitizeFeather(raw, cur?): FeatherSpec` — clamp/merge for agent + persistence
  input (`amount` clamped to `[0, 0.5]`, `curve` validated against the union).

**Why normalized to canvas width** (not raw px like tornEdge): feather has no
physical paper-fibre detail to keep stable, so the dominant repo convention for
Figma-style per-layer effects (drop shadow, blur, inner shadow — all
"normalized to canvas width … survive resize/export unchanged") applies. The
render step converts to device px.

### 2. Rendering — `applyFeather(canvas, spec, opts)` in `feather.ts`

Reuses the **exact distance-transform primitive** already in `tornEdge.ts`.
`distanceInside(inside, W, x0,y0,x1,y1)` returns, for each opaque pixel, the
approximate Euclidean distance to the nearest transparent pixel, computed only
within a bounding band for performance. `applyFeather`:

1. Builds the binary inside-mask + opaque bounding box (same as
   `applyTornEdgeToData`).
2. Computes `featherDev = amount * W_canvasLogical * scale` in device px. (The
   caller passes canvas logical width and `scale` = device px per logical px, so
   the physical falloff distance is stable across dpr; normalization to canvas
   width makes it stable across resize.)
3. Runs `distanceInside` over a band of width `featherDev + 2`.
4. For each opaque pixel with edge distance `d`: `alphaMul = ramp(min(1, d / featherDev))`
   where `ramp(t)` is `t` for `'linear'` and `t*t*(3-2t)` (smoothstep) for
   `'smooth'`. Multiplies the pixel's existing alpha by `alphaMul`. Interior
   pixels (`d >= featherDev`) are untouched.

To avoid an unnecessary second `getImageData/putImageData` pass when both torn
edge and feather are active, factor the distance-transform helpers so both can
share; acceptable initial implementation is two independent passes (feather
reads back the torn result) — correctness first, the shared-pass optimization is
noted but not required for v1.

`distanceInside`, `makeNoise` are currently module-private in `tornEdge.ts`.
`distanceInside` is pure and reusable — **export it** from `tornEdge.ts` and
import it into `feather.ts` (single source of truth for the distance transform),
rather than duplicating it.

### 3. Wiring into `paintLayer`

In `useCompositorLayers.ts::paintLayer`, the "effected path" offscreen is entered
when any per-layer treatment is present. Extend the gate and apply feather:

```ts
const feather = featherActive(layer.feather) ? layer.feather : undefined
...
if (shadow || blur || inner || chain.length || tornEdge || feather) {
  ...
  if (tornEdge) applyTornEdge(off, tornEdge, { scale: s })
  if (feather)  applyFeather(off, feather, { scale: s, canvasW: W })
  // then the drop-shadow / blur stamp follows the softened silhouette
}
```

Ordering rationale (matches tornEdge's own): after content + 2D chain effects (so
adjust/grain sit inside the faded edge), after tornEdge (so a torn silhouette is
also softened when both are set), and before the stamp (so drop-shadow and blur
trace the feathered edge).

Applies uniformly to every layer kind (image, text, shape, vector) because the
effected path already renders all of them the same way. Baking/export go through
the same `paintLayerStack` path, so preview and generated output feather
identically.

### 4. UI — panel control

A compact control block modeled on `CompositorTornEdgePanel.vue`, shown for a
selected layer:

- Enable toggle (adds/removes `layer.feather`, seeding `DEFAULT_FEATHER`).
- **Amount** slider (maps to `amount`, shown in canvas-relative terms).
- **Falloff** segmented toggle: Linear / Smooth.

Follows the Compositor's existing panel styling and the studio colour convention
(action blue as the only accent).

### 5. Agent expressibility

Feather added to the compositor agent surface (`app/lib/agent/surfaces/compositor.ts`)
so natural-language requests set it via `sanitizeFeather`, consistent with how
`tornEdge`, gradients, and the rest of the studio are agent-reachable. Vocabulary:
"feather", "soften the edges", "fade the edges".

## Data flow

```
agent / panel edit ──▶ sanitizeFeather ──▶ layer.feather (persisted)
                                                  │
                        paintLayer (effected path)│
                                                  ▼
   content ─▶ chain fx ─▶ [tornEdge] ─▶ applyFeather (alpha *= ramp(dist)) ─▶ stamp (shadow/blur)
                                                  │
                                    same path used by preview, Frame node, and bake/export
```

## Error handling / edge cases

- **amount = 0 / no field** → `featherActive` false → effected path not entered
  for feather alone → byte-identical to today.
- **Fully transparent layer** → no opaque bounding box → early return, no-op
  (same guard as `applyTornEdgeToData`).
- **amount larger than the element** → the ramp saturates; the whole element
  fades toward its center. Clamp `amount` to `[0, 0.5]` (of canvas width) in
  `sanitizeFeather` to bound the band cost.
- **Retina (dpr > 1)** → `scale` keeps the physical falloff distance stable, as
  in tornEdge.

## Testing

Unit tests (`tests/unit/compositor-feather.unit.spec.ts`), mirroring the tornEdge
unit test:

1. A pixel well inside the silhouette keeps full alpha.
2. A pixel within `amount` of the edge has reduced alpha (0 < a < original).
3. A fully-transparent buffer is returned unchanged (no-op).
4. `featherActive({amount:0})` is false; a zero-amount render leaves alpha bytes
   unchanged (the identity gate).
5. `sanitizeFeather` clamps out-of-range amount and rejects an invalid curve.
6. `smooth` and `linear` produce different mid-band alpha for the same distance.

No live/paid render is required; the feature is pure client-side canvas.
