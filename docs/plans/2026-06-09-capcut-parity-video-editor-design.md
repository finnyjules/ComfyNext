# CapCut-Parity Video Editor — Design

**Date:** 2026-06-09
**Status:** Approved design, pre-implementation
**Goal:** Bring ComfyNext's video editing to working parity with CapCut's core editing loop for web video, while replacing several CapCut features with AI-driven equivalents that play to ComfyNext's generation strengths.

## Scope decisions (made with Julien)

| Decision | Choice |
|---|---|
| Parity bar | Core editing loop + AI-differentiated features. Not feature-for-feature parity (no templates marketplace, no stock library, no advanced manual masking). |
| Target formats | Both short-form social (9:16/1:1, <60s) and general web video (16:9, minutes) from day one. Aspect-ratio and duration agnostic. |
| AI feature set (all selected) | AI captions + sound, smart reframe + matting, generative transitions, text-to-edit assistant. |
| Editor surface | Keep the Timeline modal, make it maximal (near-fullscreen CapCut-style layout). Timeline remains a canvas node artifact. |
| Preview engine | **WebGL/WebCodecs engine first** — build the frame-accurate browser compositor before layering new features, so every effect added afterward previews live. |
| Export | **Server FFmpeg/Python render stays canonical.** The WebGL engine must match it, enforced by golden-frame tests. No client-side export. |

## What exists today (baseline)

- Multi-track timeline: `frontend/app/components/vue-canvas/TimelineEditor.vue`, `frontend/app/composables/useTimelineStore.ts`, data model in `frontend/shared/timeline/types.ts`. Video/audio/image/text clips, drag/resize, mute/lock, per-clip transform keyframes (x, y, rotation, scale, opacity) with easing, 10 blend modes, fade in/out.
- GSAP kinetic titles/lower-thirds with frame baking (`useKineticRenderer.ts`).
- Server renderer mirroring editor math: `comfy_extras/nodes_timeline.py` (`TimelineNode`, `render_timeline_to_file()`, `/comfynext/timeline/render` endpoints).
- Generation: Seedance 2, Veo 3 (synced audio), Kling, lipsync, Whisper, MusicGen, MiniMax TTS via `comfy_api_nodes/nodes_replicate.py`; Topaz enhancement.
- Asset library with video/audio/image import, metadata, playback.
- Preview today: DOM/HTML5-video compositing (`TimelineNodePreview.vue`, `usePlaybackEngine`) — good for transforms/fades, weak for transitions, filters, frame accuracy.

## Architecture

### One data model, two renderers, enforced parity

`frontend/shared/timeline/types.ts` remains the single source of truth. Extensions:

- **Transitions** — first-class objects attached to clip junctions (not clips), with type, duration, and parameters.
- **Per-clip speed** (constant factor first; speed curves are out of scope for v1) and **reverse**.
- **Per-clip filters/adjustments** — brightness, contrast, saturation, hue, temperature; 3D LUT reference later.
- **Captions track** — a track type whose clips carry word-level timing, text, and a style preset reference; fully editable as text clips.
- **Matte references** — a clip may reference an alpha/matte proxy asset produced by AI matting.
- **Bake/proxy references** — AI-generated derivatives (interpolated transitions, reframed crops, mattes) are cached assets linked from the timeline, re-bakeable when parameters change.

Every mutation goes through a **typed command layer** (split, move, set-keyframe, add-caption, …). Commands are the undo/redo backbone and, later, the tool surface the text-to-edit LLM drives.

### WebGL/WebCodecs preview engine (the big build)

- **Decode:** WebCodecs `VideoDecoder` in workers, one pipeline per active source; LRU frame cache; decode-ahead scheduler keyed to the playhead; frame-accurate seek.
- **Composite:** WebGL2. Shader ports of all 10 blend modes, keyframe transforms, opacity/fades, transitions, and filters. 3D-LUT color via lookup textures (post-v1).
- **Text:** text, captions, and kinetic titles rasterize via Canvas2D to textures. GSAP timelines are deterministic and seekable, so kinetic animations are sampled at time *t* — no live DOM in the render path.
- **Audio:** Web Audio API graph synced to the engine clock; decoded PCM peaks drive waveform rendering on audio clips.
- **Clock:** a master playback clock drives both video compositing and audio; scrubbing renders the exact requested frame.
- **Interface:** the engine sits behind a `PreviewRenderer` interface (state + time in → frame out). The current DOM preview remains as a fallback implementation while the engine matures and for browsers with weak WebCodecs support.

### Server render stays canonical

`nodes_timeline.py` gains every feature the engine gains (transitions, speed/reverse, filters, captions, mattes). The existing mirrored-math discipline (TS ↔ Python interpolation) extends to all new features.

**Golden-frame harness** (built before the engine): fixture timelines rendered at sampled frames by both the Python renderer and headless-browser WebGL (Playwright), image-diffed with tolerance in CI. Any divergence between preview and export is a test failure, not a user surprise.

## AI features (cost-conscious: local-first, paid models opt-in)

Per project practice, paid model calls go through the existing pre-run cost estimate + confirm-above-threshold guard.

1. **AI captions** — Whisper transcription → word-level timestamps → captions track with styled, editable clips. Presets include karaoke-style word highlight. Prefer local faster-whisper (free); Replicate Whisper as fallback.
2. **AI sound** — TTS voiceover (MiniMax) and MusicGen surfaced in the editor's audio panel. **Auto-ducking:** local speech-energy analysis generates volume keyframes on music tracks under speech — visible and editable, not a black box.
3. **Matting (chroma-key replacement)** — local video matting (RVM or BiRefNet) in ComfyUI produces an alpha proxy; the engine composites it like any clip. Near-free.
4. **Smart reframe** — local subject detection/tracking generates crop keyframes on the clip transform for 16:9 ↔ 9:16 conversion. Output is ordinary keyframes the user can edit.
5. **Generative transitions** — RIFE frame interpolation (local, free) for morph transitions and high-quality slow-mo; first/last-frame video-model generation (Replicate) as the premium tier for scene-to-scene "impossible" transitions.
6. **Text-to-edit assistant** — an LLM drives the typed command layer from natural language ("cut to the beat, add captions, punch in on faces"). Beat/onset detection runs locally. Ships last; depends on the command layer and the features it orchestrates.

## Editor UX (maximal modal)

- Near-fullscreen modal: media/asset panel left, preview center, properties right, timeline bottom.
- Keyboard shortcuts: space (play/pause), S (split at playhead), arrows (frame step), etc.
- Timeline ergonomics: razor/split, snapping/magnetic edges, waveforms on audio clips, transition handles at junctions.
- Canvas presets: 9:16 / 1:1 / 16:9 with safe-area guides; per-platform export presets (resolution/fps/bitrate).

## Phasing

Each phase is its own spec → plan → implementation cycle.

| Phase | What | Size |
|---|---|---|
| 0 | Data-model extensions + typed command layer + golden-frame parity harness | S |
| 1 | WebGL/WebCodecs engine to parity with today's features, behind `PreviewRenderer`, DOM fallback retained | XL |
| 2 | Editing essentials: split, speed/reverse, transitions, filters, waveforms, snapping, maximal-modal layout. Each feature lands in engine + Python renderer + UI together | L |
| 3 | AI captions + sound + ducking (parallelizable with late Phase 2) | M |
| 4 | Matting + smart reframe | M |
| 5 | Generative transitions (RIFE local; video-model premium) | M |
| 6 | Text-to-edit assistant | M |
| 7 | Export presets, performance hardening, polish | S–M |

**Known cost of the WebGL-first choice:** Phase 1 is roughly a 1.5–3 month solo effort with little user-visible change. Repaid by every later phase previewing live with no bake wall.

**Top risks:**
- WebCodecs behavior across browsers (Safari/Firefox edge cases) — mitigated by the DOM fallback and targeting Chromium first.
- Three implementations of compositing semantics (TS model, GLSL, Python) — mitigated by the golden-frame harness and shared fixture suite.
- Texture/decoder memory pressure on long timelines — mitigated by proxy resolutions for preview and LRU eviction.

## Testing

- **Golden-frame CI:** Python ↔ headless WebGL image diff over fixture timelines (every blend mode, transition, filter, keyframe shape).
- **Mirrored unit tests:** interpolation/command logic tested in both TS and Python, continuing the existing pattern.
- **Interaction tests:** Playwright for split/trim/drag/snapping in the editor.
- **AI fixtures:** known audio → expected caption timings; known green-screen clip → matte quality threshold; known clip pair → RIFE transition renders without artifacts.

## Out of scope (explicitly)

- Templates marketplace, stock media library, sticker/effect packs.
- Speed curves (constant speed only in v1), manual bezier masks, client-side export.
- Collaborative/multiplayer editing.
