# Phase 1: WebGL/WebCodecs Preview Engine — Design

**Date:** 2026-06-09
**Status:** Approved design, pre-implementation
**Parent:** `docs/plans/2026-06-09-capcut-parity-video-editor-design.md` (Phase 1 row)
**Builds on:** Phase 0 (EditState v2, command layer, golden-frame harness, `PreviewRenderer` seam) — merged to main 2026-06-09.

## Goal

A frame-accurate browser compositor for the timeline: WebGL2 compositing, WebCodecs decode, audio playback on an audio-anchored clock — behind the existing `PreviewRenderer` seam and the same `usePlaybackEngine` composable surface the editor already uses, so it swaps in behind a flag and falls back to the Canvas2D preview automatically.

## Scope decisions (made with Julien)

| Decision | Choice |
|---|---|
| Audio | **In Phase 1.** Web Audio playback of audio clips (volume, audio fades), clock anchored to `AudioContext.currentTime` during playback. Today's preview is silent; the clock is the heart of the engine, so it is built around its hardest client from day one. |
| Browser floor | **Chromium + Safari.** Canvas2D preview remains the automatic fallback everywhere. Firefox unverified in Phase 1. |
| Rollout | **Flag in editor, default ON when proven.** localStorage flag in TimelineEditor; harness parity → dogfooding → default flip. Old preview never deleted in Phase 1. |
| Decode architecture | **Hybrid sources.** WebCodecs (mp4box.js demux + `VideoDecoder`) for MP4/H.264 (+HEVC where supported); hidden-`<video>` seek-and-capture fallback for everything else (WebM, odd codecs, Safari gaps). Compositor is source-agnostic. |
| Compositor API | **WebGL2** (not WebGPU): strongest on the chosen browser floor; 2D compositing needs no compute. |

## What exists today (relevant baseline)

- Current preview: `frontend/app/composables/usePlaybackEngine.ts` — Canvas2D, `globalCompositeOperation` blends, per-clip `<video>`/`<img>` element pool, `currentTime` seeks with ~0.15 s drift tolerance. Audio tracks are skipped (silent).
- Kinetic titles/lower-thirds render live: GSAP DOM state is read per frame (`getComputedStyle`/`DOMMatrixReadOnly`) and replicated onto canvas (`useKineticRenderer.ts`, `renderTitleClip`/`renderLowerThirdClip`). Baked KineticType clips arrive as PNG frame-sequence URLs.
- URL resolution: `frontend/shared/timeline/resolveClipSource.ts` (node clips) and `useAssetLibrary` (asset clips → `/view?filename=…&type=input`).
- Parity harness (Phase 0): `PreviewRenderer` interface, `/timeline-harness` page, fixtures + committed goldens, Playwright golden spec, Python ground truth via `render_frame_np` and `/comfynext/timeline/render_frame`.
- Pinned v2 semantics live as doc comments in `frontend/shared/timeline/types.ts` (speed/reverse source-frame formula, etc.) — the engine implements them by importing `shared/timeline` helpers, never re-deriving.

## Architecture

All new engine code lives under `frontend/app/lib/engine/`.

### `clock.ts` — `PlaybackClock`
During playback, position derives from `AudioContext.currentTime` minus the anchor set at play/seek (audio never drifts from what you hear; video chases it). Paused/scrubbing: a plain settable position. No events; consumers sample it inside rAF.

### `sources/` — frame acquisition
`FrameSource` interface: `getFrame(sourceFrame: number): Promise<TexImageSource>`, `dispose()`. The compositor never knows which implementation produced a texture.

- `WebCodecsSource` — mp4box.js demux → `VideoDecoder`. Decode-ahead window around the playhead, LRU cache of decoded `VideoFrame`s (closed on evict), exact frame-index addressing. Phase 1 containers/codecs: MP4/MOV with H.264 always; HEVC when `VideoDecoder.isConfigSupported` says yes.
- `VideoElementSource` — hidden `<video>`: set `currentTime`, await `seeked`, upload the element. Best-effort frame accuracy (browser seek snapping), flagged as such in telemetry/logs. This is the Safari/codec-gap escape hatch.
- `ImageSource` — decoded `ImageBitmap` of a still.
- `SequenceSource` — baked kinetic PNG frame arrays, preloaded like today's preview.
- `CanvasSource` — live text/title/lower-third rasterization reusing the existing `renderTitleClip`/`renderLowerThirdClip` canvas code unchanged; its output canvas is the texture source.

Source selection per clip: media kind → image/sequence/canvas directly; video → `WebCodecsSource` if demuxable + `isConfigSupported`, else `VideoElementSource`.

### `gl/` — WebGL2 plumbing
Context creation/loss handling, quad renderer, texture pool, and one fragment shader implementing all 10 blend modes ported from the same W3C/CSS formulas the Python conformance test (`test_compositor_blend_conformance.py`) encodes. Premultiplied-alpha discipline documented at the module boundary.

### `compositor.ts` — the agreement point
Pure derivation `(EditState, frame) → draw list`: track paint order, muted-track skip, `interpolateClipAt` transforms, fade math, and timeline→source frame mapping (in_frame, speed, reverse — the formulas pinned in `types.ts`, imported from `shared/timeline`). Then the GL pass that executes the list. Every formula here must come from `shared/timeline` helpers so TS, GLSL inputs, and Python stay in lockstep.

### `audio/audioEngine.ts`
Per audio asset: fetch → `decodeAudioData` (cached). On play/seek: schedule `AudioBufferSourceNode`s for clips overlapping the play range, with `GainNode` envelopes for clip volume and `audio_fade_in/out`. Muted tracks silent. Stop/flush on pause/seek/state-change.

### `webglPreviewRenderer.ts`
Implements the Phase-0 `PreviewRenderer` seam for the harness: `load(state)` builds sources; `renderFrame(n, canvas)` deterministically renders exactly frame n (no clock, no audio). This is what the golden spec drives.

### `composables/usePlaybackEngineGL.ts`
Same public surface as `usePlaybackEngine` (canvas ref in, start/stop, resolve-clip callback) so `TimelineEditor.vue` selects an engine with a one-line flag branch. Owns the rAF loop: sample clock → compositor render; on decode miss, render without that layer and re-render when the decode lands (never show a stale frame as current).

## Frame flow

rAF tick → sample `PlaybackClock` → visible clips at frame → clip-local → source frame (shared/timeline math) → `FrameSource.getFrame` (hot path = cache hit; decode-ahead keeps it warm) → texture bind/upload → blend-stack render in paint order → canvas.

## Failure ladder

1. Codec unsupported by WebCodecs → `VideoElementSource` for that clip.
2. WebGL context lost → dispose + single rebuild attempt → else step 3.
3. No WebGL2 / no AudioContext / engine init throws → automatic fallback to the Canvas2D `usePlaybackEngine` (flag auto-reverts with a console warning). Nothing in the editor hard-depends on the engine.

## Parity & testing

- **GLSL blend conformance**: the W3C formula grid from the Python conformance test, executed against the actual shader via a Playwright-driven harness page (same infra as the golden spec; no headless-gl dependency), every mode × backdrop × source grid.
- **Golden spec, both renderers**: `/timeline-harness?renderer=webgl` registers `WebGLPreviewRenderer`; the existing Playwright golden spec parametrizes over `server` and `webgl`. Fixture assets reach the browser via Playwright `page.route` interception serving the PNGs from disk — no server changes.
- **Calibrated WebGL tolerance**: the server-renderer gate keeps max 2/255, mean 0.5/255. GPU sampling is not bit-identical to PIL BILINEAR (rotated edges, downscales), so the WebGL comparison gets its own budget: max-diff threshold plus fraction-of-pixels-over-threshold, measured during M1 and then **locked as constants in the spec file with the measured values recorded in a comment**. Visually indistinguishable and stable is the bar; bit-identity is not.
- **A/V sync test**: harness plays N seconds; assert rendered frame index vs audio-clock-derived index never diverges by ≥ 1 frame.
- **Mirrored unit tests** continue: source-frame mapping (speed/reverse/in_frame) gets TS tests with the same numbers as future Python twins (Phase 2).

## Rollout milestones

1. **M1 — Harness parity (visual, deterministic).** ✅ Completed 2026-06-09 (plan: `docs/plans/2026-06-09-phase1-m1-webgl-harness-parity-plan.md`). `WebGLPreviewRenderer` passes the golden spec on all three fixtures; GLSL conformance green over the full 8-bit grid; WebGL tolerances calibrated and recorded in `frontend/tests/timeline-golden.spec.ts` (mean ≤ 2.5/255, pctOver(8/255) ≤ 6%; measured worst 1.343/255 / 3.94%). Bonus: the gate exposed and fixed a real ground-truth bug — rotated clips exported with opaque black expand-bboxes (`_transform_and_alpha` now rotates in RGBA; goldens regenerated).
2. **M2 — Playback.** ✅ Completed 2026-06-09 (plan: `docs/plans/2026-06-09-phase1-m2-playback-plan.md`). Audio-anchored `PlaybackClock` (holds through context suspension); `WebCodecsSource` — mp4box demux, decode-order feeding (B-frame capable), keyframe-exact, LRU — with `VideoElementSource` fallback ladder; `AudioEngine` with monotonic fade envelopes; A/V sync gate ≤1 frame (measured worst Δ=1 over 16 samples). WebKit-engine verification via a dedicated Playwright project — all engine specs pass on WebKit 26 with zero skips (it caught a real fixture bug: x264 lossless = Hi444PP, undecodable by Safari). Golden gate stays Chromium-calibrated; real-Safari manual pass folds into M3 dogfooding.
3. **M3 — Editor flag.** `usePlaybackEngineGL` selectable in TimelineEditor via localStorage flag (default off); kinetic/text/sequence sources wired through the editor's clip-resolution callback; dogfooding on real projects.
4. **M4 — Default on.** Flag defaults to the engine; Canvas2D path remains as automatic fallback. Exit criteria: no fallback triggers and no visual complaints across a week of real use.

**Accepted deferral (closed in M3):** the harness pages (`/timeline-harness`, `/gl-conformance`, `/engine-test`) are dev-gated — they 404 in production builds.

## Out of scope (Phase 1)

Rendering transitions/filters/captions (Phase 2 adds them to all renderers together); client-side export; WebGPU; Firefox verification; waveform drawing changes; TimelineEditor UI restructuring beyond the engine swap point; video fixtures for goldens (added once the engine exists to define deterministic decode expectations).

## Risks

- **PIL↔GPU sampling divergence** exceeding a usable tolerance on rotated content → mitigations: edge-masked metrics, per-fixture budgets; worst case M1 accepts per-fixture thresholds with recorded values.
- **Safari WebCodecs gaps** → the `VideoElementSource` ladder is the design, not a patch; M2 explicitly verifies it.
- **VideoFrame/texture memory** on long timelines → decode-ahead window + LRU with explicit `close()`; budget asserted in a stress check during M2.
- **Audio autoplay policies** → AudioContext resumed on first user gesture; engine renders silently until then.
