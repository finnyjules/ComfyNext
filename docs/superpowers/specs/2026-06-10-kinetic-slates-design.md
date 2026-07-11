# Kinetic Slates: Animated Frame Engine + Motion Templates

**Date:** 2026-06-10
**Status:** Approved direction, pending spec review
**Reference:** LIV Golf 2025 motion brand kit by Please Call Me Champ Studio
(https://www.behance.net/gallery/221772539/LIVGOLF-2025) — broadcast-style
kinetic typography: choreographed slates, photo-in-type masks, marquee bands,
keyline traces, metadata grids. All deterministic 2D motion graphics (After
Effects work), zero AI-generated pixels.

## Goal

Make Sailor able to produce broadcast-quality kinetic typography and motion
slates. Two layers, built in order:

1. **Engine (B-core):** the Frame/Compositor unified layer stack gains a time
   dimension. Any Frame can be animated and baked to a video clip. No keyframe
   UI yet — animation is data + presets, not hand-authored curves.
2. **Content (A):** a library of pre-authored **slate templates** (LIV-style
   choreographed compositions) parameterized by a small **brand kit** and the
   user's text/media. Templates are ordinary Frame documents with animation
   data — anything a template does, a user can open and edit.

AI participates at the design level only (later phase: template selection,
copywriting, brand-color mapping) — never text-pixel generation. This keeps
output crisp and credit-cost zero (fits the cost-conscious product stance).

## Why this architecture

- The Compositor already has full static typography: text layers with
  fonts/variable fonts, gradient paints, strokes, effects, silhouette masks,
  vector pen paths, wired media layers — all in ONE unified z-order
  (wired stackOrder keys are 1-based; that invariant is untouched).
- The kinetic preset vocabulary already exists
  (`app/data/kinetic-presets.ts`, 60+ in/out/loop presets) and per-character
  preset-driven canvas animation already exists for timeline title clips
  (`useAnimatedTextRenderer`).
- Building templates on a separate one-off renderer would create a second
  text-animation stack that a future Frame animation engine would obsolete —
  the same trap as the old wired/local layer split.

## Engine design

### Data model

Additions are optional and backward-compatible (existing Frames = static).

```ts
// On LayerCommon (all layer kinds incl. wired stack entries):
animation?: LayerAnimation

interface LayerAnimation {
  offset: number              // sec from frame start; when this layer enters
  duration?: number           // sec; default = to end of frame
  in?: LayerAnimSpec          // entrance
  out?: LayerAnimSpec         // exit (anchored to end of layer duration)
  loop?: LayerAnimSpec        // looping behavior while on screen
  keyframes?: LayerKeyframe[] // transform/opacity over time (engine supports
                              // from day one; UI exposure deferred to Phase 3)
}

interface LayerAnimSpec {
  presetId: string            // shared kinetic preset vocabulary
  duration: number            // sec
  stagger?: number            // sec, per animation unit (chars/words/lines)
  ease?: string               // easing id
}

interface LayerKeyframe {     // mirrors shared/timeline/types.ts Keyframe
  t: number                   // sec, relative to layer offset
  x?: number; y?: number; scale?: number; rotation?: number; opacity?: number
  ease?: 'linear' | 'easeInOut'
}

// On the Frame document:
motion?: { fps: number; duration: number; loop?: boolean }
```

### Evaluation

- New pure module `app/lib/motion/evaluate.ts`:
  `evaluateLayerAt(layer, t) -> { transform, opacity, perUnitStates?, visible }`.
  No DOM, no GSAP at evaluation time — easing/stagger math is extracted from /
  shared with `useAnimatedTextRenderer` (which already implements
  preset-driven per-char animation in pure canvas for title clips).
  The GSAP/DOM bake path in `useKineticRenderer` stays as-is for the existing
  Kinetic Typography node; new engine work does not depend on it.
- `paintLayerStack` gains an optional time argument: `paintLayerStack(..., t)`.
  With `t` undefined, behavior is exactly today's static render.
- Wired layers are image-typed today (the Compositor has no video inputs), so
  v1 animates local layers and treats wired image layers as static backdrops.
  Photo-in-type works now (text layer as silhouette mask over an image/wired
  layer); video-in-type needs video-typed Compositor inputs and is deferred to
  Phase 3 alongside the FrameSource sampling work.
- Per-unit (char/word/line) states apply to text layers; other layer kinds
  animate as whole units.

### Preview

- Compositor/Frame editor gets a play button + scrub bar (rAF loop calling
  `paintLayerStack(t)`). No per-layer timeline rows, no keyframe editing UI
  in this phase.

### Bake & output

- Bake = loop `t` over `duration * fps` frames, `paintLayerStack(t)` at target
  resolution onto an offscreen canvas, collect frames.
- Frames upload to the backend as a PNG sequence (alpha preserved); a backend
  node assembles them into the Frame node's new **video output** (and the PNG
  batch remains available as an IMAGE sequence output for ComfyUI-style
  wiring). The PNG sequence is the canonical alpha-preserving artifact; the
  assemble node's video codec (e.g. VP9/WebM with alpha vs. ProRes 4444) is
  chosen during implementation planning after auditing what the existing
  timeline/ffmpeg path consumes, with an H.264 fallback (matted onto a chosen
  background) for consumers that can't take alpha.
- Bake runs client-side (single renderer, no GSAP→Python port). Accepted
  trade-off: baking needs the frontend open; the Frame is the source of truth
  and re-bakes on edit (same mental model as the existing client-side
  RGBA-overlay bake).
- Determinism: evaluation is pure (no Date.now/random); same doc + same t =
  same pixels, so golden-frame tests are possible.

## Template system design

### Brand kit

SUPERSEDED by the shipped project brand library
(docs/superpowers/specs/2026-06-10-brand-library-design.md, shipped
2026-06-10): `BrandKit` lives in `frontend/shared/brand/types.ts` (primary,
secondary, accent, **accent2**, foreground, background, fontDisplay,
fontBody, logo); the active kit is `ProjectDoc.brandKitId` resolved via
`useBrandLibrary().activeKit`; merging via `effectiveBrand()` from
`shared/brand/resolve.ts`. Slate templates author `{{ brand.* }}` tokens and
build gradients from `accent`→`accent2` color roles.

### Templates

- `app/data/slate-templates.ts`, data-driven like `shot-presets.ts`.
- A template = a Frame document factory: layer stack + animation data +
  **slots**:
  - text slots (`title`, `subtitle`, `date`, `location`, list slots)
  - media slots (photo/video fills for masked shapes)
  - color roles (`primary`/`accent`/`gradient` → resolved from BrandKit)
- Instantiation produces a plain animated Frame — fully editable afterwards,
  no live link back to the template.

### v1 template set (6) — the LIV primitives

1. **Event slate** — stacked condensed caps, gradient highlight bar punches in
   behind one line, staggered line reveals, metadata microtype at edges.
2. **Photo-mask punch** — giant numeral/word silhouette-masks a wired
   photo/video layer; hard scale punch-in, keyline echo.
3. **Marquee band** — tiled wordmark row(s) in alternating color bars,
   looping ticker scroll.
4. **Lower third** — name/subtitle bar with accent sweep (upgrade path from
   the existing timeline lower-third).
5. **Keyline trace** — pen-path/outline letterforms stroke-draw over media,
   then fill snaps on.
6. **Metadata grid loop** — repeated microtype + glyphs (globe/arrow) ticking
   in a grid; ambient loop for backgrounds/overlays.

### Gallery UX

- "Kinetic Slate" entry following the Film a Shot pattern:
  `SlatePresetGalleryModal` with category filter and animated (CSS-only)
  thumbnails; picking a template + filling slots creates an Artifact Frame
  node with the instantiated doc, ready to play/bake/wire.

## Phasing

- **Phase 1 — Engine:** data model, `evaluate.ts`, `paintLayerStack(t)`,
  preview play/scrub in the Compositor, bake → PNG sequence → Frame node
  video output (the Compositor backend node gains a `motion_params` input and
  a VIDEO output, following the KineticType params/rendered pattern).
  Acceptance: a hand-built animated Frame (text + bar + image-in-type mask)
  plays in the editor and its baked clip overlays correctly in the timeline
  and over a Film a Shot output.
- **Phase 2 — Templates:** BrandKit storage + editor, slot system, 6 templates,
  gallery modal. Acceptance: pick template → fill text/media → branded slate
  clip in under a minute, no animation knowledge required.
- **Phase 3 (deferred, separate specs):** per-layer timing/keyframe UI in the
  Compositor; timeline "Add slate" button; text-on-path integration
  (`textOnPath.ts`); AI template filling (LLM picks template, writes copy,
  maps brand colors); template sharing.

## Out of scope (v1)

- Hand-authored keyframe editing UI (engine supports keyframes; UI later).
- Porting animation evaluation to Python; server-side bake.
- 3D, shaders, particles, audio-reactivity.
- Caption-clip rework and existing Kinetic Typography node changes (it keeps
  working as-is; a later phase may reimplement it as a one-layer slate).

## Testing

- Unit tests on `evaluate.ts`: preset timing, stagger windows, keyframe
  interpolation parity with `shared/timeline/interpolate.ts` semantics.
- Golden-frame tests: fixture Frame docs rendered at fixed `t` values,
  compared against committed PNGs (tolerance-based), following the timeline
  golden-harness workflow. These land with the bake (end of Phase 1 / Phase 2)
  where PNG frames are the natural artifact; Phase 1's evaluator is covered by
  pure unit tests.
- Manual visual pass per template at 16:9 / 9:16 / 1:1.

## Risks

- **Preview/bake divergence:** single renderer (Canvas2D `paintLayerStack`)
  for both; goldens guard regressions.
- **Bake performance** (e.g. 6 s × 30 fps × 4K): mitigate with resolution
  presets and OffscreenCanvas; acceptable because bakes are explicit, not
  per-keystroke.
- **CompositorModal size/complexity** (already 123 KB): engine lives in new
  `app/lib/motion/` modules; the modal only gains the play/scrub control.
- **Font readiness during bake:** reuse `ensureLayerFonts()` before first
  frame; bake waits on font load promises.
