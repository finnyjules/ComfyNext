# Torn Paper Edge — Design Spec

**Date:** 2026-08-17
**Status:** Approved, ready for implementation plan

## Plain-language summary

Give any Compositor layer a ragged "torn paper" edge. Instead of a clean
rectangular (or shape) boundary, the layer's edge frays and dissolves like a
piece of paper that's been ripped — with an optional white "lip" along the tear
showing the paper underside, and paper-fiber grain texture on that lip. It works
on any layer (a photo cut-out, a shape, a paint layer) because it follows the
layer's own alpha boundary, not a fixed rectangle. Controls live in the layer
inspector, and the AI can also set it from a text prompt ("give this a rough
torn edge with a thick white lip").

## Overview

A per-layer edge treatment for the Compositor. It raggedizes a layer's existing
alpha boundary using seeded noise, dissolves the edge into fibrous grain, and
draws a variable-width, textured "lip" band just inside the tear. Because it
operates on whatever alpha the layer already has, it needs no concept of
"sides" — it uniformly frays rectangles, ellipses, vector shapes, and
transparent images alike.

Scope is deliberately narrow (see **Scope boundaries**): per-layer only, no
motion keyframing.

## The effect, visually

The tear is composed of four independent noise-driven behaviors, each exposed as
a control:

1. **Tear (into the element)** — the boundary is pushed inward by a depth that
   varies along the perimeter. Three `style` presets shape this noise:
   - `deckle` — gentle low-amplitude undulation (soft handmade-paper edge)
   - `ripped` — domain-warped fbm; the tear meanders and frays organically
   - `shredded` — high-persistence noise with sharpened spikes (aggressive rip)
2. **Grain dissolve** — near the boundary, a noise field stipples the alpha so
   the edge crumbles into fibers instead of cutting clean. `grain` sets the
   width of this dissolve band (0 = crisp vector-like edge).
3. **White lip** — a band of `lipColor` (default warm paper-white) revealed
   just inside the tear, reading as the paper underside. Its width varies along
   the edge (`lipVariation`) — thick in places, tapering to nothing in others.
4. **Grain texture** — paper-fiber tonal variation applied **only to the lip
   band** (never the image content). `grainTexture` controls its strength.

## Data model

A new optional field on `LayerCommon` (so any layer kind can tear), mirroring
the existing `ImageLayer.displaceMap?: DisplaceMapSpec` precedent — presence
enables the behavior.

```ts
// frontend/app/lib/compositor/tornEdge.ts (new module)
export type TornEdgeStyle = 'ripped' | 'deckle' | 'shredded'

export interface TornEdgeSpec {
  style: TornEdgeStyle
  amount: number        // tear depth into the element (px)
  roughness: number     // fray/meander detail, 0..1
  grain: number         // grain dissolve band width (px, 0 = crisp)
  grainTexture: number  // paper-fiber texture strength on the lip, 0..1
  lipWidth: number      // average white-lip band width (px, 0 = no lip)
  lipVariation: number  // how much lip width varies along the edge, 0..1
  lipColor: string      // hex, default warm paper-white
  seed: number          // deterministic — same seed = same tear
}

export const DEFAULT_TORN_EDGE: TornEdgeSpec = {
  style: 'shredded',
  amount: 37,
  roughness: 0.18,
  grain: 7,
  grainTexture: 0.6,
  lipWidth: 10,
  lipVariation: 0.73,
  lipColor: '#fbf6ee',
  seed: 12,
}
```

Add `tornEdge?: TornEdgeSpec` to `LayerCommon`
(`frontend/app/composables/useCompositorLayers.ts:148`).

**Persistence is automatic.** Layers are JSON-cloned into
`node.data.properties.sailor_localLayers` (read `useLocalLayerEditor.ts:72`,
write `:78`, single-layer patch via `setLocal(id, patch)` `:157`). No extra
plumbing.

## Rendering

### Insertion point

The effect must run **per-pixel on the layer's device-sized offscreen**, inside
`paintLayer` (`useCompositorLayers.ts:1012`). A layer carrying any effect is
already rasterized to an offscreen `off` before compositing (the "effected
path", `:1133`–`:1179`), then stamped back with `ctx.drawImage(off,0,0)` at
`:1176`. The torn-edge treatment inserts just before that stamp.

**Critical:** `tornEdge` must join the effect condition at `:1133`
(`shadow || blur || inner || chain.length || tornEdge`) so the layer takes the
offscreen path. The fast path (`:1182`–`:1189`) draws directly onto the main
composite with no alpha buffer to perturb — a torn edge there is impossible.

### Why per-pixel raster (not a vector clip)

The grain dissolve requires breaking up the alpha into stippled fibers near the
boundary. A vector path clip produces a crisp mathematical edge and physically
cannot grain. So the tear is computed as a per-pixel alpha + color pass over the
layer's offscreen, in device space (via `ctx.getTransform()` sizing, matching
the `applyStrokeMask` idiom at `:901`/`:937`) so it stays sharp under dpr and
export.

### Algorithm (per pixel of the layer offscreen)

For each pixel, using the layer's alpha silhouette as the base boundary:

1. **`sT`** = signed distance from the pixel to the *tear* boundary
   (positive = inside), where the boundary is the layer's alpha edge pushed
   inward by `depthAt(perimeterPos)`. `depthAt` is the style-specific seeded fbm
   (see `depthCoord` in the demo).
2. **`sC`** = `sT - lipAt(perimeterPos)` — signed distance to the *content*
   boundary, where `lipAt` is the perimeter-varying lip width
   (`lipWidth` modulated by a low-frequency envelope scaled by `lipVariation`).
3. **Grain field `g`** = coherent 2D value-noise clumps blended with fine
   speckle (fibrous, not isotropic static).
4. **Keep tests** (grain dissolve over band width `bw = grain`):
   - `paper = sT<=0 ? 0 : (sT>=bw ? 1 : (g < sT/bw ? 1 : 0))`
   - `content = sC<=0 ? 0 : (sC>=bw ? 1 : (g < sC/bw ? 1 : 0))`
5. **Compose:**
   - not paper → transparent (alpha 0)
   - content → original layer pixel, **unmodified** (no texture)
   - paper but not content → `lipColor`, modulated by paper-fiber texture
     scaled by `grainTexture` (texture confined to the lip)

For an arbitrary layer alpha, "perimeter position" and "distance to boundary"
derive from the layer's own alpha (e.g. a distance transform of the alpha
channel); the demo's rectangle/ellipse math is the special-cased fast form. See
**Open implementation question** below.

### Reuse

`frontend/app/lib/compositor/displace.ts` has `resampleBilinear` (`:153`) and
box-blur helpers, but **no seeded value-noise/turbulence** — that generator is
net-new and lives in the new `tornEdge.ts` module. Everything else (offscreen
alpha handling, config persistence, agent wiring) mirrors an existing precedent.

### Render parity

There is no separate headless bake path for the Compositor — preview and export
both funnel through `paintLayer`. Implementing the effect there gives
preview↔render parity automatically (`ArtifactFrameNode.vue:485` preview / `:649`
export; `CompositorModal.vue:1689/1791/1963`; `motion/bake.ts:79`).

## Agent expressibility

Mirror the fully-wired `setLayerEffect` precedent
(`frontend/app/lib/agent/surfaces/compositor.ts`):

1. **Declare** a `setLayerTornEdge` op in `COMPOSITOR_COMMANDS` (`:96`) with
   clamped params and a hint string.
2. **Apply** — add a `case 'setLayerTornEdge'` in `applyCompositorCommand`
   (~`:288`) that sanitizes/clamps params and writes `layer.tornEdge`.
3. **Describe** — surface current `tornEdge` state in `describeCompositor`
   (`:119`) so the model can read and adjust it.
4. **Render read** — `paintLayer` reads `layer.tornEdge` (per **Rendering**).

**Phrase mapping** (plain prompt → params):
- "rough / shredded torn edge" → `style: shredded`, high `roughness`
- "soft deckle edge" → `style: deckle`, low `roughness`, low `grain`
- "thick white torn border" → high `lipWidth`
- "clean tear" → `grain: 0`
- "uneven / ragged tear" → high `lipVariation`

No motion timeline binding (per scope), but `seed` keeps it animation-ready for
a future pass.

## UI

Add a "Torn edge" section to the Design inspector of `CompositorModal.vue`,
alongside the existing blur/shadow/mask blocks (drop-shadow `:2119`, layer blur
`:2159`, inner shadow `:2172`, mask mode `:2524`). Each control writes via
`setLocal(l.id, { tornEdge: { ...current, <field>: v } })`.

Nine controls, matching the approved demo layout:

| Control | Field | Type |
|---|---|---|
| Enable toggle | presence of `tornEdge` | toggle |
| Edge style | `style` | select (ripped/deckle/shredded) |
| Tear depth | `amount` | slider |
| Roughness | `roughness` | slider |
| Grain | `grain` | slider |
| Grain texture | `grainTexture` | slider |
| Lip width | `lipWidth` | slider |
| Lip width var | `lipVariation` | slider |
| Lip color | `lipColor` | color picker |
| New tear (reseed) | `seed` | button |

A dedicated `CompositorTornEdgePanel.vue` under
`frontend/app/components/vue-canvas/compositor/` (mirroring
`CompositorClonerPanel.vue`) is preferred over inlining, given the control count.

## Performance

The per-pixel pass runs on **every torn layer, at device resolution, on every
render and export**. Risks and mitigations:

- **Benchmark first** on a large frame with several torn layers.
- **Restrict the loop to the boundary band**, not the whole layer — interior
  content pixels are unmodified, so only pixels within
  `amount + maxLip + grain` of the alpha edge need processing.
- **Cache the computed tear mask** on the layer and invalidate only when
  `tornEdge` params (or the layer's alpha/size) change — so idle re-renders
  (pan, unrelated layer edits) don't recompute it.
- Seeded noise (no `Math.random`) is required for the cache to be valid and for
  preview==render.

## Scope boundaries (YAGNI)

- **Per-layer only** — no whole-frame torn artboard.
- **No motion keyframing** — controls are static per layer (seed keeps it
  future-ready).
- **Texture on the lip only** — never washed over image content.
- Three styles only (ripped/deckle/shredded); no burnt/grunge variants.

## Open implementation question

The demo special-cases rectangle and ellipse boundaries for speed. The
production effect must follow an **arbitrary layer alpha**. The plan should pick
between:
- **(a)** A distance transform of the layer's alpha channel to get
  `distance-to-edge` + an approximate perimeter parameter, then apply the same
  depth/lip/grain math. General, slightly more expensive.
- **(b)** Kind-aware fast paths (rect/ellipse/shape use analytic boundaries;
  image alpha uses the distance-transform path).

Recommend (a) as the correct general implementation, with the boundary-band
optimization making it affordable, and revisit (b) only if benchmarks demand it.

## Testing

- Unit: `tornEdge.ts` noise is deterministic for a fixed seed; `DEFAULT_TORN_EDGE`
  round-trips through persistence.
- Unit: agent `setLayerTornEdge` clamps out-of-range params and writes
  `layer.tornEdge`.
- Visual/manual: verify against a **broken control** (per project convention) —
  confirm each slider changes the render, and that the effect appears identically
  in live preview and in a baked export.
- Parity: a torn layer's preview canvas and its exported PNG match.
