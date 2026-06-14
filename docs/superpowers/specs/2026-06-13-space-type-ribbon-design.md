# Space Type: 3D Ribbon (suite slice 1)

**Date:** 2026-06-13
**Status:** Approved direction, pending spec review

Inspired by Kiel Mutschelknaus' Space Type Generator (`spacetypegenerator.com/ribbon`):
a real-time kinetic-type tool where a line of text is repeated and stacked into
flowing **ribbons** waving through 3D space. This spec delivers the **ribbon**
effect end-to-end as the first vertical slice of a Vessel "Space Type" suite —
laying down the engine, the pluggable-effect seam, and the bake-to-timeline
pipeline so later effects (cylinder, field, stripes) are "add one module."

## Principle

**Real 3D, authored live, delivered as a timeline clip.** The soul of Space Type
is dragging a slider and watching type wave in real time — so the home is a live
WebGL surface, not a configure-then-render node. But the *output* rides the
kinetic bake → `motion_frames` → `nodes_timeline.py` rails already shipped on
`feat/kinetic-export-keyframe-lanes`, so a ribbon lands on the timeline like any
Motion clip and the Python side needs **zero changes**.

The existing Canvas2D kinetic engine (`frontend/app/lib/motion/`) is **reused, not
replaced**: it paints the text-texture that 3D ribbon geometry is mapped with.
Variable-font axes already animated there can drive ribbon weight/width.

## Goal

Ship the ribbon effect with:
1. A **Three.js authoring surface** with a live preview and an auto-rendered
   control panel.
2. A **pluggable `SpaceTypeEffect` interface** so the suite grows by adding
   modules, not by editing the shell/engine/pipeline.
3. Three deliverables: **looping clip → timeline**, **static poster → Assets**,
   and **alpha/transparent** output for compositing.
4. **Determinism** — frame-index-driven, so renders are reproducible and
   cache-keyable, and loops are seamless.

## Architecture

### Dependency

`three` (Three.js) — **already a dependency** (`three@^0.171.0`, with
`@types/three`); no new install needed. It's the natural tool for the perspective
camera, geometry, and depth the suite needs, and effect modules stay small and
readable because the 3D math is the library's job, not hand-rolled WebGL.

### Components

```
frontend/app/lib/spacetype/
  engine.ts            SpaceTypeEngine — renderer, perspective camera,
                       frame-index→t01 clock, holds ONE active effect,
                       readPixels → PNG. No Date.now()/Math.random().
  effect.ts            SpaceTypeEffect interface + ControlSpec types.
  textTexture.ts       Paints a text line (via lib/motion text layout +
                       variable-font axes) onto an offscreen canvas →
                       THREE.CanvasTexture. The reuse bridge.
  effects/
    ribbon.ts          FIRST effect. Stacked, twisted, waving ribbons.
  bake.ts              ensureSpaceTypeBake() — deterministic PNG-sequence bake
                       + source_key cache, mirrors lib/engine/motionClipBake.ts.

frontend/app/components/vue-canvas/
  SpaceTypeSurface.vue Modal editor: live <canvas> preview, control panel
                       auto-built from the active effect's controls, export
                       buttons (Add to timeline / Save poster).

frontend/app/lib/spaceTypeEnabled.ts   SPACE_TYPE_ENABLED flag (default false),
                                       mirrors kineticEnabled.ts.
```

### The effect seam

```ts
interface SpaceTypeEffect {
  id: 'ribbon' | 'cylinder' | 'field' | 'stripes'
  label: string
  controls: ControlSpec[]              // declares its own UI; shell renders it
  defaults: Record<string, number | string | boolean>
  buildScene(three, params, textTexture): THREE.Object3D
  update(t01: number, params): void    // t01 = normalized 0..1 loop time
}
```

`ControlSpec` is a small union — `{ key, label, kind: 'slider', min, max, step }`,
`{ key, label, kind: 'text' }`, `{ key, label, kind: 'color' }`,
`{ key, label, kind: 'select', options }`. `SpaceTypeSurface.vue` reads
`effect.controls` and renders the panel generically. Adding cylinder/field later
means writing a new `effects/*.ts` that declares its controls — **no shell,
engine, or pipeline changes.**

### Text → texture bridge (the reuse win)

`textTexture.ts` calls into the existing `lib/motion` text layout / variable-font
path to paint the repeating line onto an offscreen canvas, wrapped as a
`THREE.CanvasTexture`. The ribbon material samples it. Consequences:
- Variable-font axes (wght/wdth) already supported there flow straight through.
- Per-char layout logic is not rebuilt.
- The curated font catalog (`frontend/app/data/variable-fonts.ts`) is the font
  source; fonts are awaited via `document.fonts.ready` before any bake, exactly
  as the current bake does.

### Entry point

A **"Space Type"** tile in the Add menu (alongside the `KINETIC_ENABLED`-gated
Slate gallery) opens `SpaceTypeSurface.vue` as a modal — same modal pattern as
the Compositor and Timeline editors. No ComfyUI graph node: output lands as a
timeline clip, consistent with how Motion clips already work. Gated behind
`SPACE_TYPE_ENABLED` so it can merge hidden and be refined in place.

## The ribbon effect (`effects/ribbon.ts`)

Controls (each declared in `controls`, so the panel auto-builds):

**Content**
- `text` — the repeating line (text input)
- `font` + variable-font axes — from the curated catalog, painted to the texture
- `case` — as-typed / uppercase (select)

**Ribbon form**
- `rows` — stacked ribbons (3–24)
- `rowSpacing` — Y gap between ribbons
- `zRotation` — progressive per-row twist (the STG signature helical stagger)
- `waveAmplitude` + `waveFrequency` — sine undulation along each ribbon
- `rowPhase` — wave shift row-to-row (0 = parallel, high = corkscrew)

**Motion**
- `scrollSpeed` — text flowing along the ribbon length
- `loopDuration` (sec) + `fps`

**Camera & look**
- `cameraAngle` (orbit/tilt) + `fov`
- `bgColor` (or transparent) + `typeColor` — neutral palette by default; no
  purple/violet accents (per house rule)
- `depthFade` — far ribbons dim

### Seamless loop guarantee

Scroll distance per loop and wave phase are snapped to **whole multiples** over
`loopDuration`, so frame 0 and frame `count` of the underlying motion match.
`update(t01)` is a pure function of `t01 ∈ [0,1)`; the engine feeds it
`frameIndex / count`. This is what makes the baked PNG sequence tile on the
timeline without a visible jump at the wrap.

## Output & delivery

All three come from the same deterministic render.

1. **Looping clip → timeline.** Bake `fps × loopDuration` frames:
   `engine.renderFrame(i) → readPixels → canvas.toBlob('image/png')`, upload via
   the existing `uploadFrameBatch`, emit a clip carrying `motion_frames`.
   `nodes_timeline.py` composites it unchanged.
2. **Static poster.** Render one frame at high res → save as a `type: output`
   asset (so it appears in Assets — per the generator-assets gotcha) as a title
   card / poster.
3. **Alpha.** Renderer uses `{ alpha: true }` + transparent clear; PNG sequence
   and poster carry real transparency, so ribbons composite over footage in the
   Frame/Compositor, not only on a solid background.

### Bake cache

`source_key` = FNV-1a hash over `{ effectId, params, fps, loopDuration, W, H }`,
mirroring `MotionBake`. Re-bake is skipped unless something actually changed.
Moving/trimming the clip on the timeline does not invalidate the bake.

## Scope slices

- **Slice 1 (this spec):** Ribbon, end-to-end — engine, `SpaceTypeEffect` seam,
  auto-rendered control shell, `ribbon.ts`, three outputs, bake-to-timeline,
  `SPACE_TYPE_ENABLED` gate. Complete and shippable; proves the suite seam.
- **Slice 2+ (future specs, out of scope):** cylinder, field, stripes — each a
  new `effects/*.ts` declaring its own controls. Designed-for now, not built now.

## Testing

WebGL isn't available under the Vitest (jsdom) unit runner, so the automated
guard is on the **pure deterministic motion math**, not rendered pixels. Pixel
fidelity is verified manually in the surface.

- **Golden motion-math snapshot:** the per-row ribbon state (`y`, `zRotation`,
  `wavePhase`, `scrollOffset`) at a fixed `(config, t01)` matches a committed
  reference. Catches motion-math regressions without a GPU.
- **Seamless-loop assertion:** for a fixed config, the wrapping channels
  (scroll, wave phase) at `t01 = 0` equal their values at the loop boundary
  (`t01 → 1`) within tolerance.
- **Determinism assertion:** the same `(config, frameIndex)` yields identical
  motion state twice (no `Date.now()`/`Math.random()` leakage).
- **Bake-cache test:** `ensureSpaceTypeBake` re-runs the (injected) frame
  renderer only when the `source_key` changes; an unchanged config returns the
  cached bake without re-rendering.
- **Surface component test (light):** the control panel renders one input per
  entry in a mock effect's `controls`.
- **Manual pixel verification:** the live surface and one baked clip are
  eyeballed in-app (the suite's real "does it look like STG" check).

## Non-goals

- No cylinder/field/stripes effects (future slices).
- No ComfyUI graph node — output is a timeline clip.
- No changes to `nodes_timeline.py` — the existing `motion_frames` path is reused.
- No new font infrastructure — the curated variable-font catalog is the source.
