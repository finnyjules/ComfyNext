# Phase 1 / M2: Playback (Clock + WebCodecs + Audio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-time playback in the harness: an audio-anchored `PlaybackClock`, frame-exact `WebCodecsSource` (mp4box demux + `VideoDecoder`) with a `VideoElementSource` fallback ladder, Web Audio clip playback with fade envelopes, an A/V sync gate, and WebKit (Safari-engine) verification — milestone M2 of `docs/plans/2026-06-09-phase1-webgl-engine-design.md`.

**Architecture:** Sources stay behind the M1 `FrameSource` seam — `WebCodecsSource` decodes exact frames on demand from the nearest keyframe with a small decoded-frame LRU; `VideoElementSource` seek-and-captures as the codec-gap fallback. The clock anchors to `AudioContext.currentTime` while the context runs (video chases audio), falling back to `performance.now()` when audio is unavailable. Correctness is proven against a deterministic frame-indexed test video (each frame's gray level encodes its index) rather than Python goldens — decode exactness is an engine property, not a cross-renderer one. M1 follow-ups land first: `sourceFrame` in the draw list (speed/reverse formulas from `types.ts`), a texture-update path in `GlRenderer`, cached uniform locations.

**Tech Stack:** mp4box@2.3.0 (demux), WebCodecs `VideoDecoder`, Web Audio API, PyAV (fixture generation), Playwright (chromium + new webkit project for engine specs).

**Conventions:** pnpm frontend; `.venv/bin/python` at repo root; dev servers :3002/:8188 must be up for Playwright; working tree may carry Julien's unrelated WIP — `git add` only named files; commits `Area: description` style.

**Scope guard (YAGNI):** No editor integration, no `usePlaybackEngineGL`, no flag (M3). No 60fps performance work beyond cached uniforms (M3 hardens perf during dogfooding). WebM stays on the fallback path — only MP4/H.264 gets WebCodecs in M2 (HEVC: accepted if `isConfigSupported` passes, not separately tested). The golden gate does NOT run under webkit in M2 (tolerances were calibrated on Chromium; cross-GPU recalibration is M3-with-dogfooding territory — note it, don't chase it).

---

## Task 1: M1 follow-ups — `sourceFrame` in the draw list

The pinned formulas (`frontend/shared/timeline/types.ts:123-126`): `source_frame = in_frame + floor((frame - start_frame) * speed)`; reverse applies after speed — the mapped source range plays last→first, i.e. evaluate the forward mapping at the mirrored local frame.

**Files:**
- Create: `frontend/shared/timeline/sourceFrame.ts`
- Modify: `frontend/app/lib/engine/compositor.ts`
- Test: `frontend/tests/unit/source-frame.unit.spec.ts`
- Modify: `frontend/tests/unit/compositor.unit.spec.ts` (one new assertion block)

- [ ] **Step 1: Write the failing tests** — create `frontend/tests/unit/source-frame.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sourceFrameAt } from '../../shared/timeline/sourceFrame'

// Mirrors the formulas pinned in types.ts: source_frame = in_frame +
// floor(localFrame * speed); reverse evaluates at the mirrored local frame.
describe('sourceFrameAt', () => {
  const clip = (over: object) => ({ in_frame: 0, length: 10, ...over })

  it('identity at speed 1', () => {
    expect(sourceFrameAt(clip({}), 0)).toBe(0)
    expect(sourceFrameAt(clip({}), 7)).toBe(7)
    expect(sourceFrameAt(clip({ in_frame: 5 }), 7)).toBe(12)
  })

  it('speed 0.5 holds each source frame twice', () => {
    const f = [0, 1, 2, 3, 4].map(l => sourceFrameAt(clip({ speed: 0.5 }), l))
    expect(f).toEqual([0, 0, 1, 1, 2])
  })

  it('speed 2 skips every other source frame', () => {
    expect(sourceFrameAt(clip({ speed: 2 }), 3)).toBe(6)
  })

  it('reverse plays the mapped range last→first', () => {
    // length 10, speed 1: forward range [0..9]; reverse at local 0 → 9, local 9 → 0
    expect(sourceFrameAt(clip({ reverse: true }), 0)).toBe(9)
    expect(sourceFrameAt(clip({ reverse: true }), 9)).toBe(0)
    expect(sourceFrameAt(clip({ reverse: true, in_frame: 3 }), 0)).toBe(12)
  })

  it('reverse after speed: mirrored local frame, then speed mapping', () => {
    // length 10, speed 0.5: forward maps local 0..9 → 0,0,1,1,2,2,3,3,4,4
    // reverse at local 0 = forward at local 9 = 4
    expect(sourceFrameAt(clip({ reverse: true, speed: 0.5 }), 0)).toBe(4)
    expect(sourceFrameAt(clip({ reverse: true, speed: 0.5 }), 9)).toBe(0)
  })

  it('defaults: missing speed=1, in_frame=0, never negative', () => {
    expect(sourceFrameAt({ length: 1 }, 0)).toBe(0)
    expect(sourceFrameAt({ length: 0, reverse: true }, 0)).toBe(0)
  })
})
```

- [ ] **Step 2:** Run `cd frontend && pnpm run test:unit` — FAIL (module missing).

- [ ] **Step 3: Create `frontend/shared/timeline/sourceFrame.ts`:**

```ts
// Timeline→source frame mapping — the formulas pinned in types.ts (BaseClip
// speed/reverse doc comments). Phase 2 adds the Python twin; until then this
// is exercised by the engine playback specs against the frame-indexed video.
export interface SourceFrameClip {
  in_frame?: number
  length: number
  speed?: number
  reverse?: boolean
}

export function sourceFrameAt(clip: SourceFrameClip, localFrame: number): number {
  const speed = clip.speed ?? 1
  const inFrame = clip.in_frame ?? 0
  const eff = clip.reverse
    ? Math.max(0, Math.max(1, clip.length) - 1 - localFrame)
    : localFrame
  return inFrame + Math.floor(Math.max(0, eff) * speed)
}
```

- [ ] **Step 4: Thread `sourceFrame` through the draw list.** In `frontend/app/lib/engine/compositor.ts`: add to `DrawEntry`:

```ts
  /** Clip-local SOURCE frame (in_frame/speed/reverse applied — sourceFrameAt).
   *  Image layers ignore it; video/sequence sources index by it. */
  sourceFrame: number
```

Import `sourceFrameAt` from `~~/shared/timeline/sourceFrame`, and in `buildDrawList` add to the pushed entry:

```ts
        sourceFrame: sourceFrameAt(clip, localF),
```

Also REMOVE the `if (clip.kind !== 'image') continue` restriction's exclusivity: change the kind gate to admit video clips too —

```ts
      if (clip.kind !== 'image' && clip.kind !== 'video') continue // M2: images + video
```

(everything downstream — fades, fit, center — is kind-agnostic; `srcDims` gating still drops anything unloaded).

Append to `frontend/tests/unit/compositor.unit.spec.ts`:

```ts
describe('buildDrawList — sourceFrame threading', () => {
  it('computes sourceFrame from in_frame/speed/reverse', () => {
    const state = migrateEditState({
      version: 2,
      canvas: { width: 640, height: 360, fps: 30, bg_color: '#000000' },
      total_frames: 20, transitions: [],
      tracks: [{ id: 't', kind: 'video', name: 'V', muted: false, locked: false, clips: [
        { id: 'v', kind: 'video', asset_id: 'v', path: 'v.mp4', start_frame: 2, in_frame: 3, length: 10, speed: 2, reverse: false },
      ] }],
    })!
    const dims = new Map([['v', { w: 64, h: 64 }]])
    const e = buildDrawList(state, 6, dims)[0]!   // localF = 4
    expect(e.sourceFrame).toBe(3 + 8)             // in_frame 3 + floor(4*2)
  })
})
```

- [ ] **Step 5:** Run `cd frontend && pnpm run test:unit` — all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/timeline/sourceFrame.ts frontend/tests/unit/source-frame.unit.spec.ts frontend/app/lib/engine/compositor.ts frontend/tests/unit/compositor.unit.spec.ts
git commit -m "Engine: sourceFrame in the draw list — speed/reverse/in_frame mapping per the v2 contract"
```

---

## Task 2: M1 follow-ups — `GlRenderer` texture updates + cached uniforms

`uploadSource` is cache-only (no-op when the key exists) — wrong for animated sources. Replace with versioned `setSource`; cache uniform locations once per program.

**Files:**
- Modify: `frontend/app/lib/engine/gl/glRenderer.ts`
- Modify: `frontend/app/lib/engine/webglPreviewRenderer.ts`
- Modify: `frontend/app/pages/gl-conformance.vue`

- [ ] **Step 1: Versioned sources.** In `glRenderer.ts`, replace the `srcTextures` map and `uploadSource` with:

```ts
  private srcTextures = new Map<string, { tex: WebGLTexture; version: number }>()
```

```ts
  /** Upload or update the source texture for a draw key. Re-uploads only when
   *  `version` changes — static images pass a constant, animated sources pass
   *  the source frame index. LINEAR filtering (GPU analogue of PIL BILINEAR). */
  setSource(key: string, image: TexImageSource, version = 0): void {
    const gl = this.gl
    const existing = this.srcTextures.get(key)
    if (existing && existing.version === version) return
    const tex = existing?.tex ?? gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image)
    if (!existing) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    this.srcTextures.set(key, { tex, version })
  }
```

Update `render()`'s lookup (`const srcTex = this.srcTextures.get(e.clipId)` → `const src = this.srcTextures.get(e.clipId)`; bind `src.tex`; skip when undefined) and `clearSources`/`dispose` to delete `entry.tex`.

- [ ] **Step 2: Cached uniform locations.** In the constructor after linking, build:

```ts
  private layerU!: Record<string, WebGLUniformLocation | null>
  private presentU!: Record<string, WebGLUniformLocation | null>
```

```ts
    const cacheUniforms = (prog: WebGLProgram, names: string[]) =>
      Object.fromEntries(names.map(n => [n, gl.getUniformLocation(prog, n)]))
    this.layerU = cacheUniforms(this.layerProg, [
      'u_base', 'u_src', 'u_canvas', 'u_center', 'u_size', 'u_rotation', 'u_alpha', 'u_mode',
    ])
    this.presentU = cacheUniforms(this.presentProg, ['u_tex', 'u_flipY'])
```

Replace every `u('name')` / `gl.getUniformLocation(...)` in `render()` with `this.layerU.name` / `this.presentU.name` lookups; delete the per-entry `u` helper.

- [ ] **Step 3: Update callers.** `webglPreviewRenderer.ts`: `this.gl.uploadSource(e.clipId, frameImg)` → `this.gl.setSource(e.clipId, frameImg, e.sourceFrame)` and change `getFrame(0)` → `getFrame(e.sourceFrame)`. `gl-conformance.vue`: `renderer.uploadSource('base-ramp', base)` → `renderer.setSource('base-ramp', base)` (same for top-ramp); its inline DrawEntry literals each gain `sourceFrame: 0`.

- [ ] **Step 4: Regression-verify on the GPU suites** (servers up):

```bash
cd frontend && npx playwright test tests/gl-blend-conformance.spec.ts tests/timeline-golden.spec.ts --reporter=line
```
Expected: 7 PASS (conformance + 6 golden). Also `pnpm run test:unit` green and `npx vue-tsc --noEmit 2>&1 | grep engine/ | head -5` empty.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/gl/glRenderer.ts frontend/app/lib/engine/webglPreviewRenderer.ts frontend/app/pages/gl-conformance.vue
git commit -m "Engine: versioned setSource texture updates + cached uniform locations (animated-source ready)"
```

---

## Task 3: Deterministic playback fixtures — frame-indexed MP4 + tone WAV

Self-describing media: video frame `i`'s gray level encodes `i`; audio is a 440 Hz sine. Generated by committed scripts, committed as binaries (~tens of KB). Decode exactness is then testable without any cross-renderer comparison.

**Files:**
- Create: `tests-unit/timeline_fixtures/generate_media.py`
- Create: `tests-unit/timeline_fixtures/assets/counter_30f.mp4` (generated, committed)
- Create: `tests-unit/timeline_fixtures/assets/tone_440.wav` (generated, committed)
- Test: `tests-unit/comfy_extras_test/timeline_media_fixture_test.py`

- [ ] **Step 1: Create `tests-unit/timeline_fixtures/generate_media.py`:**

```python
"""Deterministic PLAYBACK fixtures for the engine specs.

  counter_30f.mp4 — 30 frames, 64×64, 30 fps, H.264 yuv420p, near-lossless
    (qp 0), no B-frames, keyframe every 10 frames (so frame 13 forces a
    decode-from-keyframe-10 path). Frame i is solid gray value = 8 + i*8
    (max 240). Gray ⇒ chroma constant ⇒ 4:2:0 subsampling is harmless; the
    decoder-side index recovery is round((v - 8) / 8) with ±3 tolerance for
    range-conversion drift.
  tone_440.wav — 1.0 s, 440 Hz sine, mono 16-bit 44.1 kHz, peak 0.5.

Regenerate: .venv/bin/python tests-unit/timeline_fixtures/generate_media.py
Outputs are committed; regeneration must stay deterministic (no timestamps).
"""
import math
import os
import struct
import wave
from fractions import Fraction

import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
FRAMES, SIZE, FPS = 30, 64, 30


def gen_video() -> None:
    import av
    path = os.path.join(OUT, "counter_30f.mp4")
    out = av.open(path, mode="w")
    stream = out.add_stream("h264", rate=Fraction(FPS, 1))
    stream.width = SIZE
    stream.height = SIZE
    stream.pix_fmt = "yuv420p"
    stream.options = {"qp": "0", "bf": "0", "g": "10"}
    for i in range(FRAMES):
        v = 8 + i * 8
        arr = np.full((SIZE, SIZE, 3), v, dtype=np.uint8)
        frame = av.VideoFrame.from_ndarray(arr, format="rgb24")
        for packet in stream.encode(frame):
            out.mux(packet)
    for packet in stream.encode():
        out.mux(packet)
    out.close()


def gen_tone() -> None:
    path = os.path.join(OUT, "tone_440.wav")
    rate, dur, freq, peak = 44100, 1.0, 440.0, 0.5
    n = int(rate * dur)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        samples = (
            int(peak * 32767 * math.sin(2 * math.pi * freq * t / rate))
            for t in range(n)
        )
        w.writeframes(b"".join(struct.pack("<h", s) for s in samples))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    gen_video()
    gen_tone()
```

Run: `.venv/bin/python tests-unit/timeline_fixtures/generate_media.py` → two files. Check sizes are sane (`ls -la tests-unit/timeline_fixtures/assets/` — mp4 should be well under 200KB, wav ~88KB).

NOTE on mp4 determinism: libx264 + mux metadata can embed nondeterminism; we do NOT require byte-stable regeneration for the mp4 (unlike the PNGs) — the committed file is the fixture of record, and the Python sanity test (Step 2) validates whatever is committed. State this in your report if regeneration changes bytes.

- [ ] **Step 2: Python sanity test** — create `tests-unit/comfy_extras_test/timeline_media_fixture_test.py`:

```python
"""The counter video must be self-describing: frame i decodes to gray ~8+i*8.
Validates the committed fixture (and PyAV's read-back), not the generator."""
import os

import numpy as np
import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MP4 = os.path.join(REPO_ROOT, "tests-unit", "timeline_fixtures", "assets", "counter_30f.mp4")


def test_counter_video_frames_encode_their_index():
    av = pytest.importorskip("av")
    container = av.open(MP4)
    values = []
    for frame in container.decode(video=0):
        arr = frame.to_ndarray(format="rgb24")
        values.append(int(arr[32, 32, 0]))
    container.close()
    assert len(values) == 30
    for i, v in enumerate(values):
        want = 8 + i * 8
        assert abs(v - want) <= 3, f"frame {i}: {v} != ~{want}"
```

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_media_fixture_test.py -v` → PASS. If qp=0 still drifts beyond ±3 (codec build differences), bump spacing (i*8 is generous; investigate before loosening).

- [ ] **Step 3: Commit**

```bash
git add tests-unit/timeline_fixtures/generate_media.py tests-unit/timeline_fixtures/assets/counter_30f.mp4 tests-unit/timeline_fixtures/assets/tone_440.wav tests-unit/comfy_extras_test/timeline_media_fixture_test.py
git commit -m "Engine: deterministic playback fixtures — frame-indexed counter mp4 + 440Hz tone wav"
```

---

## Task 4: `PlaybackClock`

Position in seconds; anchored to an injectable timebase chosen AT `play()` (audio when available and running, else `performance.now()/1000`) and held until pause — switching timebases mid-play would break the anchor.

**Files:**
- Create: `frontend/app/lib/engine/clock.ts`
- Test: `frontend/tests/unit/playback-clock.unit.spec.ts`

- [ ] **Step 1: Write the failing tests** — `frontend/tests/unit/playback-clock.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PlaybackClock } from '../../app/lib/engine/clock'

function fakeTime() {
  let t = 100
  return { now: () => t, advance: (dt: number) => { t += dt } }
}

describe('PlaybackClock', () => {
  it('paused: position is settable and static', () => {
    const ft = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now })
    expect(clock.now()).toBe(0)
    clock.seek(2.5)
    ft.advance(10)
    expect(clock.now()).toBe(2.5)
    expect(clock.playing).toBe(false)
  })

  it('playing: position advances with the timebase', () => {
    const ft = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now })
    clock.seek(1)
    clock.play()
    ft.advance(0.5)
    expect(clock.now()).toBeCloseTo(1.5, 10)
    clock.pause()
    ft.advance(5)
    expect(clock.now()).toBeCloseTo(1.5, 10)
  })

  it('seek while playing re-anchors', () => {
    const ft = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now })
    clock.play()
    ft.advance(1)
    clock.seek(10)
    ft.advance(0.25)
    expect(clock.now()).toBeCloseTo(10.25, 10)
  })

  it('prefers the audio timebase when provided and running', () => {
    const ft = fakeTime()
    const at = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now, audio: () => at.now() })
    clock.play()
    at.advance(0.4)
    ft.advance(9.9) // fallback advancing differently must not matter
    expect(clock.now()).toBeCloseTo(0.4, 10)
  })

  it('falls back when the audio timebase reports null (context not running)', () => {
    const ft = fakeTime()
    const clock = new PlaybackClock({ fallback: ft.now, audio: () => null })
    clock.play()
    ft.advance(0.3)
    expect(clock.now()).toBeCloseTo(0.3, 10)
  })
})
```

- [ ] **Step 2:** Run unit tests — FAIL.

- [ ] **Step 3: Create `frontend/app/lib/engine/clock.ts`:**

```ts
// Playback position clock. While playing, position derives from a timebase
// chosen AT play(): the audio clock when available (AudioContext.currentTime —
// the only clock that never drifts from what you hear; video chases it), else
// the fallback (performance.now()/1000). The timebase is held until pause —
// switching mid-play would break the anchor. Paused/scrubbing: a settable
// position. No events; consumers sample now() inside rAF.

export interface ClockTimebases {
  /** Monotonic seconds. Default: performance.now()/1000. */
  fallback?: () => number
  /** Audio clock seconds, or null when the audio context isn't running. */
  audio?: () => number | null
}

export class PlaybackClock {
  private position = 0
  private anchor = 0
  private timebase: (() => number) | null = null
  private readonly bases: Required<Pick<ClockTimebases, 'fallback'>> & ClockTimebases

  constructor(bases: ClockTimebases = {}) {
    this.bases = { fallback: () => performance.now() / 1000, ...bases }
  }

  get playing(): boolean {
    return this.timebase !== null
  }

  now(): number {
    if (!this.timebase) return this.position
    return this.timebase() - this.anchor
  }

  play(): void {
    if (this.timebase) return
    const audioNow = this.bases.audio?.() ?? null
    this.timebase = audioNow !== null ? () => this.bases.audio!()! : this.bases.fallback
    this.anchor = this.timebase() - this.position
  }

  pause(): void {
    if (!this.timebase) return
    this.position = this.now()
    this.timebase = null
  }

  seek(seconds: number): void {
    this.position = Math.max(0, seconds)
    if (this.timebase) this.anchor = this.timebase() - this.position
  }
}
```

- [ ] **Step 4:** Run `cd frontend && pnpm run test:unit` — all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/clock.ts frontend/tests/unit/playback-clock.unit.spec.ts
git commit -m "Engine: PlaybackClock — audio-anchored when running, timebase locked per play()"
```

---

## Task 5: `WebCodecsSource` + `VideoElementSource` + engine-test page + contract spec

The big one. `WebCodecsSource`: mp4box demux at load (all compressed samples retained — fixture-scale; the DECODED-frame cache is the bounded resource: LRU of 24 closed-on-evict `VideoFrame`s), exact frame addressing by presentation index, decode-from-nearest-keyframe on miss with an ahead-window. `VideoElementSource`: hidden `<video>` seek-and-capture, best-effort. Both proven against the counter video through a dev page + Playwright contract spec.

**Files:**
- Modify: `frontend/package.json` (+ mp4box)
- Create: `frontend/app/lib/engine/sources/webCodecsSource.ts`
- Create: `frontend/app/lib/engine/sources/videoElementSource.ts`
- Create: `frontend/app/pages/engine-test.vue`
- Test: `frontend/tests/video-source.spec.ts`

- [ ] **Step 1:** `cd frontend && pnpm add mp4box` (2.3.0).

- [ ] **Step 2: Create `frontend/app/lib/engine/sources/webCodecsSource.ts`.** IMPORTANT: verify mp4box@2.3.0's actual export surface before finalizing (check `node_modules/mp4box/dist/` typings — recent versions export `createFile` and `DataStream` as named exports; if only a default export exists, adapt the import and note it in your report). The intended implementation:

```ts
import { createFile, DataStream } from 'mp4box'
import type { FrameSource } from './frameSource'

/** Thrown when the platform can't WebCodecs-decode this file — callers fall
 *  back to VideoElementSource (the design doc's failure ladder). */
export class UnsupportedSourceError extends Error {}

const CACHE_FRAMES = 24   // decoded VideoFrames kept (closed on evict)
const DECODE_AHEAD = 6    // extra frames decoded past the request

interface Sample {
  index: number          // presentation index (by cts order)
  isKey: boolean
  timestampUs: number
  durationUs: number
  data: Uint8Array
}

/** Frame-exact MP4 video source: mp4box demux once at load, VideoDecoder
 *  decode-from-nearest-keyframe on cache miss. Compressed samples stay in
 *  memory (clip-scale files); decoded frames are the bounded LRU. */
export class WebCodecsSource implements FrameSource {
  private samples: Sample[] = []
  private config!: VideoDecoderConfig
  private cache = new Map<number, VideoFrame>()  // insertion order = LRU
  private decoding: Promise<void> | null = null
  private _width = 0
  private _height = 0
  private disposed = false

  static async load(url: string): Promise<WebCodecsSource> {
    if (typeof VideoDecoder === 'undefined') {
      throw new UnsupportedSourceError('WebCodecs unavailable')
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error(`WebCodecsSource: ${res.status} fetching ${url}`)
    const buf = await res.arrayBuffer()

    const src = new WebCodecsSource()
    await src.demux(buf)
    const support = await VideoDecoder.isConfigSupported(src.config)
    if (!support.supported) {
      throw new UnsupportedSourceError(`codec ${src.config.codec} unsupported`)
    }
    return src
  }

  private demux(buf: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createFile()
      file.onError = (e: string) => reject(new UnsupportedSourceError(`demux: ${e}`))
      file.onReady = (info: any) => {
        const track = info.videoTracks?.[0]
        if (!track) return reject(new UnsupportedSourceError('no video track'))
        this._width = track.video.width
        this._height = track.video.height
        this.config = {
          codec: track.codec,
          codedWidth: track.video.width,
          codedHeight: track.video.height,
          description: extractDescription(file, track.id),
        }
        file.setExtractionOptions(track.id, null, { nbSamples: Infinity })
        file.start()
      }
      file.onSamples = (_id: number, _user: unknown, samples: any[]) => {
        for (const s of samples) {
          this.samples.push({
            index: 0, // assigned after sort
            isKey: !!s.is_sync,
            timestampUs: Math.round((s.cts * 1_000_000) / s.timescale),
            durationUs: Math.round((s.duration * 1_000_000) / s.timescale),
            data: new Uint8Array(s.data),
          })
        }
      }
      ;(buf as any).fileStart = 0
      file.appendBuffer(buf)
      file.flush()
      // mp4box delivers synchronously after flush for a fully-buffered file.
      queueMicrotask(() => {
        if (!this.samples.length) return reject(new UnsupportedSourceError('no samples'))
        this.samples.sort((a, b) => a.timestampUs - b.timestampUs)
        this.samples.forEach((s, i) => { s.index = i })
        resolve()
      })
    })
  }

  get width(): number { return this._width }
  get height(): number { return this._height }
  get frameCount(): number { return this.samples.length }

  async getFrame(n: number): Promise<TexImageSource> {
    const idx = Math.max(0, Math.min(n, this.samples.length - 1))
    const hit = this.cache.get(idx)
    if (hit) {
      // refresh LRU position
      this.cache.delete(idx)
      this.cache.set(idx, hit)
      return hit
    }
    // serialize decodes — concurrent seeks would fight over one decoder
    while (this.decoding) await this.decoding
    if (this.cache.has(idx)) return this.getFrame(idx)
    this.decoding = this.decodeRange(idx)
    try {
      await this.decoding
    } finally {
      this.decoding = null
    }
    const frame = this.cache.get(idx)
    if (!frame) throw new Error(`WebCodecsSource: frame ${idx} did not decode`)
    return frame
  }

  /** Decode from the nearest keyframe ≤ target through target + DECODE_AHEAD. */
  private decodeRange(target: number): Promise<void> {
    let start = target
    while (start > 0 && !this.samples[start]!.isKey) start--
    const end = Math.min(this.samples.length - 1, target + DECODE_AHEAD)

    return new Promise((resolve, reject) => {
      const decoder = new VideoDecoder({
        output: (frame) => {
          const i = Math.round(frame.timestamp / this.samples[0]!.durationUs)
          if (i >= start && i <= end && !this.cache.has(i) && !this.disposed) {
            this.cache.set(i, frame)
            this.evict()
          } else {
            frame.close()
          }
        },
        error: (e) => reject(e),
      })
      decoder.configure(this.config)
      for (let i = start; i <= end; i++) {
        const s = this.samples[i]!
        decoder.decode(new EncodedVideoChunk({
          type: s.isKey ? 'key' : 'delta',
          timestamp: s.timestampUs,
          duration: s.durationUs,
          data: s.data,
        }))
      }
      decoder.flush().then(() => {
        decoder.close()
        resolve()
      }, reject)
    })
  }

  private evict(): void {
    while (this.cache.size > CACHE_FRAMES) {
      const [oldest, frame] = this.cache.entries().next().value as [number, VideoFrame]
      this.cache.delete(oldest)
      frame.close()
    }
  }

  dispose(): void {
    this.disposed = true
    for (const f of this.cache.values()) f.close()
    this.cache.clear()
    this.samples = []
  }
}

/** Pull the codec description box (avcC/hvcC/…) VideoDecoder.configure needs. */
function extractDescription(file: any, trackId: number): Uint8Array {
  const trak = file.getTrackById(trackId)
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C
    if (box) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN)
      box.write(stream)
      return new Uint8Array(stream.buffer, 8) // strip the 8-byte box header
    }
  }
  throw new UnsupportedSourceError('no codec description box')
}
```

Known judgment points (adapt with a report note if reality differs): the `frame.timestamp → index` mapping assumes constant frame duration (true for our fixtures and FFmpeg/Replicate output; a VFR file would need a timestamp-search — out of M2 scope, throw `UnsupportedSourceError` if `durationUs` varies by >1µs across samples and note it); `onSamples` delivery timing relative to `flush()` (the `queueMicrotask` resolve is the pragmatic synchronization — if samples arrive later in mp4box 2.x, switch to resolving when `samples.length === track.nb_samples` inside `onSamples` and report).

- [ ] **Step 3: Create `frontend/app/lib/engine/sources/videoElementSource.ts`:**

```ts
import type { FrameSource } from './frameSource'

/** Seek-and-capture fallback for sources WebCodecs can't decode (codec gaps,
 *  Safari quirks — the design doc's failure ladder). Frame accuracy is
 *  best-effort: browsers snap currentTime seeks; expect ±1 frame. */
export class VideoElementSource implements FrameSource {
  private constructor(private video: HTMLVideoElement, private fps: number) {}

  static async load(url: string, fps: number): Promise<VideoElementSource> {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error(`VideoElementSource: failed to load ${url}`))
    })
    return new VideoElementSource(video, fps)
  }

  get width(): number { return this.video.videoWidth }
  get height(): number { return this.video.videoHeight }

  async getFrame(n: number): Promise<TexImageSource> {
    const target = (Math.max(0, n) + 0.5) / this.fps   // mid-frame avoids boundary snapping
    if (Math.abs(this.video.currentTime - target) > 1e-4) {
      this.video.currentTime = target
      await new Promise<void>((resolve) => {
        this.video.onseeked = () => resolve()
      })
    }
    return this.video
  }

  dispose(): void {
    this.video.removeAttribute('src')
    this.video.load()
  }
}
```

- [ ] **Step 4: Create `frontend/app/pages/engine-test.vue`** — the Playwright surface for source contracts AND (Task 7 extends it) playback:

```vue
<script setup lang="ts">
// Dev/test-only: Playwright drives window.__engineTest to exercise frame
// sources against the counter fixture (each frame's gray level encodes its
// index) and, from Task 7, real-time playback. Not linked from the app UI.
import { onMounted, onBeforeUnmount, ref } from 'vue'
import type { FrameSource } from '~/lib/engine/sources/frameSource'
import { WebCodecsSource } from '~/lib/engine/sources/webCodecsSource'
import { VideoElementSource } from '~/lib/engine/sources/videoElementSource'

const status = ref('idle')
let source: FrameSource | null = null

onMounted(() => {
  ;(window as any).__engineTest = {
    async loadSource(url: string, kind: 'webcodecs' | 'element', fps: number): Promise<{ width: number; height: number }> {
      source?.dispose()
      source = kind === 'webcodecs'
        ? await WebCodecsSource.load(url)
        : await VideoElementSource.load(url, fps)
      status.value = `source loaded (${kind})`
      return { width: source.width, height: source.height }
    },
    /** Center-pixel RGB of source frame n. */
    async frameValue(n: number): Promise<[number, number, number]> {
      if (!source) throw new Error('loadSource first')
      const img = await source.getFrame(n)
      const c = document.createElement('canvas')
      c.width = source.width
      c.height = source.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(img as CanvasImageSource, 0, 0)
      const d = ctx.getImageData(Math.floor(source.width / 2), Math.floor(source.height / 2), 1, 1).data
      status.value = `frame ${n}`
      return [d[0]!, d[1]!, d[2]!]
    },
    hasWebCodecs(): boolean {
      return typeof VideoDecoder !== 'undefined'
    },
    disposeSource(): void {
      source?.dispose()
      source = null
    },
  }
})

onBeforeUnmount(() => {
  source?.dispose()
  delete (window as any).__engineTest
})
</script>

<template>
  <div class="p-4 text-sm text-neutral-400">
    <div data-testid="engine-test-status">{{ status }}</div>
  </div>
</template>
```

- [ ] **Step 5: Create `frontend/tests/video-source.spec.ts`:**

```ts
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

// Frame-source contracts against the counter fixture (frame i = gray 8+i*8).
// WebCodecs: exact index recovery, including a mid-GOP seek (frame 13 forces
// decode from keyframe 10) and a seek-back (LRU/decoder reset path).
// VideoElement: best-effort — index within ±1.

const thisDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(thisDir, '../..')
const mp4Path = path.join(repoRoot, 'tests-unit', 'timeline_fixtures', 'assets', 'counter_30f.mp4')
const FPS = 30

function indexOf(gray: number): number {
  return Math.round((gray - 8) / 8)
}

async function setup(page: import('@playwright/test').Page) {
  await page.route('**/__fixture_media/counter.mp4', (route) =>
    route.fulfill({ body: readFileSync(mp4Path), contentType: 'video/mp4' }),
  )
  await page.goto('/engine-test')
  await page.waitForFunction(() => !!(window as any).__engineTest, { timeout: 10_000 })
}

test('WebCodecsSource decodes exact frames (keyframe seeks, seek-back, cache)', async ({ page }) => {
  await setup(page)
  const hasWebCodecs: boolean = await page.evaluate(() => (window as any).__engineTest.hasWebCodecs())
  test.skip(!hasWebCodecs, 'WebCodecs unavailable in this browser build — fallback ladder covers it')

  const dims = await page.evaluate(() =>
    (window as any).__engineTest.loadSource('/__fixture_media/counter.mp4', 'webcodecs', 30))
  expect(dims).toEqual({ width: 64, height: 64 })

  // exact recovery, scattered access pattern: forward, mid-GOP, seek-back, repeat (cache)
  for (const n of [0, 7, 13, 29, 5, 13]) {
    const [r] = await page.evaluate((f) => (window as any).__engineTest.frameValue(f), n)
    expect(indexOf(r), `frame ${n} decoded gray ${r}`).toBe(n)
  }
  // clamping
  const [rLast] = await page.evaluate(() => (window as any).__engineTest.frameValue(99))
  expect(indexOf(rLast)).toBe(29)
  await page.evaluate(() => (window as any).__engineTest.disposeSource())
})

test('VideoElementSource recovers frames within ±1', async ({ page }) => {
  await setup(page)
  await page.evaluate(() =>
    (window as any).__engineTest.loadSource('/__fixture_media/counter.mp4', 'element', 30))
  for (const n of [0, 7, 13, 29]) {
    const [r] = await page.evaluate((f) => (window as any).__engineTest.frameValue(f), n)
    expect(Math.abs(indexOf(r) - n), `frame ${n} → gray ${r}`).toBeLessThanOrEqual(1)
  }
  await page.evaluate(() => (window as any).__engineTest.disposeSource())
})
```

- [ ] **Step 6: Run it** (servers up; first hit compiles the page):

```bash
cd frontend && npx playwright test tests/video-source.spec.ts --reporter=line
```
Expected: 2 PASS. Debug ladder if the WebCodecs test fails: (a) demux rejects → check mp4box import shape + the `onSamples`-after-flush timing note in the source; (b) wrong index recovered on 13 → keyframe walk or timestamp→index mapping; (c) `frame did not decode` → decoder output timestamps don't match `durationUs` rounding — log actual `frame.timestamp` values and adjust the mapping (report what you found). Do NOT loosen `indexOf` exactness for WebCodecs.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/app/lib/engine/sources/webCodecsSource.ts frontend/app/lib/engine/sources/videoElementSource.ts frontend/app/pages/engine-test.vue frontend/tests/video-source.spec.ts
git commit -m "Engine: WebCodecsSource (mp4box demux, keyframe-exact decode, LRU) + VideoElementSource fallback, contract-tested"
```

---

## Task 6: `audioEngine`

Web Audio playback of timeline audio clips: decode once, schedule buffer sources with gain envelopes (clip volume, `audio_fade_in/out`) for the play range. The scheduling math is pure and unit-tested; the graph wiring is thin.

**Files:**
- Create: `frontend/app/lib/engine/audio/audioEngine.ts`
- Test: `frontend/tests/unit/audio-schedule.unit.spec.ts`

- [ ] **Step 1: Write the failing tests** — `frontend/tests/unit/audio-schedule.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { audioScheduleFor } from '../../app/lib/engine/audio/audioEngine'

// Clip: start_frame 30, length 60 @ 30fps → timeline [1s, 3s); volume 0.8;
// audio_fade_in 15 frames (0.5s), audio_fade_out 30 frames (1s).
const clip = {
  start_frame: 30, length: 60, volume: 0.8,
  audio_fade_in: 15, audio_fade_out: 30, in_frame: 0,
}

describe('audioScheduleFor', () => {
  it('clip entirely ahead of the playhead: starts later, full duration', () => {
    const s = audioScheduleFor(clip, 0, 30)!
    expect(s.startInSec).toBeCloseTo(1, 10)     // starts 1s after "now"
    expect(s.offsetSec).toBeCloseTo(0, 10)      // from the top of the asset
    expect(s.durationSec).toBeCloseTo(2, 10)
    // envelope points are clip-relative seconds: [t, gain]
    expect(s.gainPoints).toEqual([
      [0, 0], [0.5, 0.8],   // fade-in 0.5s up to volume
      [1, 0.8], [2, 0],     // fade-out begins at 1s into the clip (2s-1s), to 0 at end
    ])
  })

  it('playhead inside the clip: starts now, mid-asset offset, remaining duration', () => {
    const s = audioScheduleFor(clip, 2, 30)!   // 1s into the clip
    expect(s.startInSec).toBe(0)
    expect(s.offsetSec).toBeCloseTo(1, 10)
    expect(s.durationSec).toBeCloseTo(1, 10)
  })

  it('clip already over: null', () => {
    expect(audioScheduleFor(clip, 5, 30)).toBeNull()
  })

  it('in_frame shifts the asset offset', () => {
    const s = audioScheduleFor({ ...clip, in_frame: 30 }, 2, 30)!
    expect(s.offsetSec).toBeCloseTo(2, 10)     // in_frame 1s + 1s into clip
  })

  it('no fades, default volume → flat envelope at 1', () => {
    const s = audioScheduleFor({ start_frame: 0, length: 30 }, 0, 30)!
    expect(s.gainPoints).toEqual([[0, 1], [1, 1]])
  })
})
```

- [ ] **Step 2:** Run — FAIL.

- [ ] **Step 3: Create `frontend/app/lib/engine/audio/audioEngine.ts`:**

```ts
import type { EditState } from '~~/shared/timeline/types'

// Web Audio playback for timeline audio clips. Pure scheduling math
// (audioScheduleFor — unit-tested) + a thin graph: one AudioBufferSourceNode +
// GainNode per overlapping clip per play(). Fade math mirrors the visual side:
// audio_fade_in ramps local 0→fi, audio_fade_out ramps (length-fo)→length.
// Muted tracks are skipped at load. stop() tears the graph down; pause/seek =
// stop + play(newPosition).

export interface AudioClipLike {
  start_frame: number
  length: number
  in_frame?: number
  volume?: number
  audio_fade_in?: number
  audio_fade_out?: number
}

export interface AudioSchedule {
  /** Seconds from "now" until the source starts (0 = already inside the clip). */
  startInSec: number
  /** Offset into the ASSET at which playback starts. */
  offsetSec: number
  durationSec: number
  /** Envelope as [clipRelativeSeconds, gain] anchor points (linear ramps). */
  gainPoints: [number, number][]
}

export function audioScheduleFor(clip: AudioClipLike, positionSec: number, fps: number): AudioSchedule | null {
  const startSec = clip.start_frame / fps
  const lengthSec = Math.max(1, clip.length) / fps
  const endSec = startSec + lengthSec
  if (positionSec >= endSec) return null

  const intoClip = Math.max(0, positionSec - startSec)
  const volume = clip.volume ?? 1
  const fiSec = (clip.audio_fade_in ?? 0) / fps
  const foSec = (clip.audio_fade_out ?? 0) / fps

  const gainPoints: [number, number][] = []
  if (fiSec > 0) gainPoints.push([0, 0], [fiSec, volume])
  else gainPoints.push([0, volume])
  if (foSec > 0) gainPoints.push([lengthSec - foSec, volume], [lengthSec, 0])
  else gainPoints.push([lengthSec, volume])

  return {
    startInSec: Math.max(0, startSec - positionSec),
    offsetSec: (clip.in_frame ?? 0) / fps + intoClip,
    durationSec: lengthSec - intoClip,
    gainPoints,
  }
}

interface Voice { src: AudioBufferSourceNode; gain: GainNode }

export class AudioEngine {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()  // clip id → decoded asset
  private voices: Voice[] = []
  private fps = 30

  /** Decode every unmuted audio clip's asset. resolveUrl maps a clip's path to
   *  a fetchable URL (harness routes fixture media; the editor (M3) resolves
   *  via the asset library). */
  async load(state: EditState, resolveUrl: (path: string) => string): Promise<void> {
    this.disposeVoices()
    this.buffers.clear()
    this.fps = state.canvas.fps
    this.ctx ??= new AudioContext()

    const jobs: Promise<void>[] = []
    for (const track of state.tracks) {
      if (track.muted || track.kind !== 'audio') continue
      for (const clip of track.clips) {
        if (clip.kind !== 'audio' || !clip.path) continue
        const url = resolveUrl(clip.path)
        jobs.push(
          fetch(url)
            .then(r => {
              if (!r.ok) throw new Error(`audio fetch ${r.status}: ${url}`)
              return r.arrayBuffer()
            })
            .then(b => this.ctx!.decodeAudioData(b))
            .then(buf => { this.buffers.set(clip.id, buf) }),
        )
      }
    }
    await Promise.all(jobs)
  }

  /** AudioContext time in seconds, or null when not running (clock fallback). */
  timebase = (): number | null =>
    this.ctx && this.ctx.state === 'running' ? this.ctx.currentTime : null

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume()
  }

  /** Schedule all clips overlapping [positionSec, …). Call stop() first when
   *  re-scheduling (seek). */
  play(state: EditState, positionSec: number): void {
    if (!this.ctx) return
    const t0 = this.ctx.currentTime
    for (const track of state.tracks) {
      if (track.muted || track.kind !== 'audio') continue
      for (const clip of track.clips) {
        if (clip.kind !== 'audio') continue
        const buf = this.buffers.get(clip.id)
        if (!buf) continue
        const s = audioScheduleFor(clip, positionSec, this.fps)
        if (!s) continue

        const src = this.ctx.createBufferSource()
        src.buffer = buf
        const gain = this.ctx.createGain()
        src.connect(gain).connect(this.ctx.destination)

        // Envelope: clip-relative anchors → absolute context time. Anchors at
        // or before the start offset collapse to an immediate set.
        const clipStartAbs = t0 + s.startInSec - (positionSec > clip.start_frame / this.fps ? positionSec - clip.start_frame / this.fps : 0)
        gain.gain.setValueAtTime(gainAt(s.gainPoints, positionSecToClipRel(clip, positionSec, this.fps)), t0 + s.startInSec)
        for (const [t, g] of s.gainPoints) {
          const abs = clipStartAbs + t
          if (abs > t0 + s.startInSec) gain.gain.linearRampToValueAtTime(g, abs)
        }

        src.start(t0 + s.startInSec, s.offsetSec, s.durationSec)
        this.voices.push({ src, gain })
      }
    }
  }

  stop(): void {
    this.disposeVoices()
  }

  private disposeVoices(): void {
    for (const v of this.voices) {
      try { v.src.stop() } catch {}
      v.src.disconnect()
      v.gain.disconnect()
    }
    this.voices = []
  }

  dispose(): void {
    this.disposeVoices()
    this.buffers.clear()
    this.ctx?.close()
    this.ctx = null
  }
}

function positionSecToClipRel(clip: AudioClipLike, positionSec: number, fps: number): number {
  return Math.max(0, positionSec - clip.start_frame / fps)
}

/** Linear interpolation over the envelope anchors. */
export function gainAt(points: [number, number][], t: number): number {
  if (!points.length) return 1
  if (t <= points[0]![0]) return points[0]![1]
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, g0] = points[i]!
    const [t1, g1] = points[i + 1]!
    if (t >= t0 && t <= t1) {
      return t1 === t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0)
    }
  }
  return points[points.length - 1]![1]
}
```

Add to the unit spec (same file, new describe):

```ts
import { gainAt } from '../../app/lib/engine/audio/audioEngine'

describe('gainAt', () => {
  const pts: [number, number][] = [[0, 0], [0.5, 0.8], [1, 0.8], [2, 0]]
  it('interpolates linearly between anchors', () => {
    expect(gainAt(pts, 0.25)).toBeCloseTo(0.4, 10)
    expect(gainAt(pts, 0.75)).toBeCloseTo(0.8, 10)
    expect(gainAt(pts, 1.5)).toBeCloseTo(0.4, 10)
  })
  it('clamps outside the envelope', () => {
    expect(gainAt(pts, -1)).toBe(0)
    expect(gainAt(pts, 99)).toBe(0)
  })
})
```

- [ ] **Step 4:** Run `cd frontend && pnpm run test:unit` — all green. Typecheck: `npx vue-tsc --noEmit 2>&1 | grep "engine/audio" | head -5` → empty.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/audio/audioEngine.ts frontend/tests/unit/audio-schedule.unit.spec.ts
git commit -m "Engine: AudioEngine — decode-once audio clips, pure tested fade envelopes, clock timebase hook"
```

---

## Task 7: Harness playback + renderer video support + A/V sync gate

Wire it together: `WebGLPreviewRenderer` grows the video source ladder; `engine-test.vue` grows a real-time playback mode (clock + rAF + audio); a Playwright spec plays the counter video for ~2 s and asserts the rendered frame never diverges from the clock by more than 1 frame.

**Files:**
- Modify: `frontend/app/lib/engine/webglPreviewRenderer.ts`
- Modify: `frontend/app/pages/engine-test.vue`
- Test: `frontend/tests/engine-playback.spec.ts`

- [ ] **Step 1: Source ladder in `webglPreviewRenderer.ts`.** In `load()`, replace the image-only branch with:

```ts
      for (const clip of track.clips) {
        if ((clip.kind !== 'image' && clip.kind !== 'video') || !clip.path) {
          if (clip.kind !== 'image' && clip.kind !== 'video') {
            console.warn(`WebGLPreviewRenderer: skipping unsupported clip kind '${clip.kind}' (M2)`)
          }
          continue
        }
        const url = clip.path
        if (clip.kind === 'video') {
          loads.push(
            WebCodecsSource.load(url)
              .catch((e) => {
                if (e instanceof UnsupportedSourceError) {
                  console.warn(`WebGLPreviewRenderer: WebCodecs unavailable for ${url} (${e.message}) — video-element fallback`)
                  return VideoElementSource.load(url, state.canvas.fps)
                }
                throw e
              })
              .then((src) => { this.sources.set(clip.id, src) }),
          )
        } else {
          loads.push(ImageSource.load(url).then(src => { this.sources.set(clip.id, src) }))
        }
      }
```

with imports:

```ts
import { WebCodecsSource, UnsupportedSourceError } from './sources/webCodecsSource'
import { VideoElementSource } from './sources/videoElementSource'
```

(`renderFrame` already uses `getFrame(e.sourceFrame)` + `setSource(..., e.sourceFrame)` from Task 2 — verify, don't duplicate.)

- [ ] **Step 2: Playback mode in `engine-test.vue`.** Extend the script (keep the Task-5 hooks; add):

```ts
import { migrateEditState, type EditState } from '~~/shared/timeline/types'
import { WebGLPreviewRenderer } from '~/lib/engine/webglPreviewRenderer'
import { PlaybackClock } from '~/lib/engine/clock'
import { AudioEngine } from '~/lib/engine/audio/audioEngine'

const canvas = ref<HTMLCanvasElement | null>(null)
let renderer: WebGLPreviewRenderer | null = null
let audio: AudioEngine | null = null
let clock: PlaybackClock | null = null
let playState: EditState | null = null
let rafId = 0
let lastRenderedFrame = -1
let renderBusy = false
```

and add to the `__engineTest` object:

```ts
    async loadTimeline(stateJson: string): Promise<void> {
      const state = migrateEditState(JSON.parse(stateJson))
      if (!state) throw new Error('invalid edit state')
      renderer?.dispose()
      audio?.dispose()
      renderer = new WebGLPreviewRenderer()
      audio = new AudioEngine()
      await Promise.all([
        renderer.load(state),
        audio.load(state, (p) => p),   // harness paths are already URLs
      ])
      clock = new PlaybackClock({ audio: audio.timebase })
      playState = state
      lastRenderedFrame = -1
      status.value = 'timeline loaded'
    },
    async play(): Promise<void> {
      if (!clock || !playState || !renderer || !canvas.value) throw new Error('loadTimeline first')
      await audio!.resume()
      clock.play()
      audio!.play(playState, clock.now())
      const fps = playState.canvas.fps
      const tick = async () => {
        if (!clock!.playing) return
        const frame = Math.floor(clock!.now() * fps)
        if (frame !== lastRenderedFrame && !renderBusy) {
          renderBusy = true
          try {
            await renderer!.renderFrame(frame, canvas.value!)
            lastRenderedFrame = frame
          } finally {
            renderBusy = false
          }
        }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
      status.value = 'playing'
    },
    pause(): void {
      clock?.pause()
      audio?.stop()
      cancelAnimationFrame(rafId)
      status.value = 'paused'
    },
    seek(seconds: number): void {
      clock?.seek(seconds)
      lastRenderedFrame = -1
    },
    sample(): { clockSec: number; renderedFrame: number; playing: boolean } {
      return { clockSec: clock?.now() ?? -1, renderedFrame: lastRenderedFrame, playing: clock?.playing ?? false }
    },
```

Template gains the canvas:

```vue
  <canvas ref="canvas" class="mt-2 border border-neutral-700" />
```

And `onBeforeUnmount` additionally disposes `renderer`/`audio` and cancels the rAF.

- [ ] **Step 3: Autoplay policy for the sync test.** In `frontend/playwright.config.ts`, give the chromium project explicit launch args (read the file; extend the existing chromium project entry):

```ts
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
```

- [ ] **Step 4: Create `frontend/tests/engine-playback.spec.ts`:**

```ts
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

// A/V sync gate (design doc M2): play the counter video with the tone audio
// for ~2s; the rendered frame must track the clock within 1 frame at every
// sample, and the clock must advance at wall-clock rate.

const thisDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(thisDir, '../..')
const fixturesDir = path.join(repoRoot, 'tests-unit', 'timeline_fixtures', 'assets')

const STATE = {
  version: 2,
  canvas: { width: 320, height: 180, fps: 30, bg_color: '#000000' },
  total_frames: 90,
  transitions: [],
  tracks: [
    { id: 'v1', kind: 'video', name: 'V', muted: false, locked: false, clips: [
      // counter video looped conceptually: 90-frame clip over a 30-frame source
      // exercises the modulo-free clamp path too; keep length 30 for exactness.
      { id: 'vid', kind: 'video', asset_id: 'counter', path: '/__fixture_media/counter.mp4',
        start_frame: 0, in_frame: 0, length: 30 },
    ] },
    { id: 'a1', kind: 'audio', name: 'A', muted: false, locked: false, clips: [
      { id: 'tone', kind: 'audio', asset_id: 'tone', path: '/__fixture_media/tone.wav',
        start_frame: 0, in_frame: 0, length: 30, volume: 0.5, audio_fade_in: 5, audio_fade_out: 5 },
    ] },
  ],
}

test('playback: rendered frame tracks the clock within 1 frame; clock tracks wall time', async ({ page }) => {
  await page.route('**/__fixture_media/counter.mp4', (route) =>
    route.fulfill({ body: readFileSync(path.join(fixturesDir, 'counter_30f.mp4')), contentType: 'video/mp4' }))
  await page.route('**/__fixture_media/tone.wav', (route) =>
    route.fulfill({ body: readFileSync(path.join(fixturesDir, 'tone_440.wav')), contentType: 'audio/wav' }))

  await page.goto('/engine-test')
  await page.waitForFunction(() => !!(window as any).__engineTest, { timeout: 10_000 })
  await page.evaluate((s) => (window as any).__engineTest.loadTimeline(s), JSON.stringify(STATE))

  const wallStart = Date.now()
  await page.evaluate(() => (window as any).__engineTest.play())

  const samples: { clockSec: number; renderedFrame: number }[] = []
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(100)
    samples.push(await page.evaluate(() => (window as any).__engineTest.sample()))
  }
  await page.evaluate(() => (window as any).__engineTest.pause())
  const wallSec = (Date.now() - wallStart) / 1000

  // Skip warmup (first 3 samples — decode-ahead filling).
  for (const s of samples.slice(3)) {
    const expected = Math.floor(s.clockSec * 30)
    // Clip is 30 frames; past its end the last frame legitimately holds.
    const expectedClamped = Math.min(expected, 29)
    expect(Math.abs(s.renderedFrame - expectedClamped),
      `clock ${s.clockSec.toFixed(3)}s expects frame ~${expectedClamped}, rendered ${s.renderedFrame}`,
    ).toBeLessThanOrEqual(1)
  }

  // Clock advanced at roughly wall rate (±15% — CI scheduling slop).
  const last = samples[samples.length - 1]!
  expect(last.clockSec).toBeGreaterThan(wallSec * 0.85 - 0.35)
  expect(last.clockSec).toBeLessThan(wallSec * 1.15)
})
```

NOTE: `renderedFrame` tracks the timeline frame; with `length: 30` the draw list yields no entries past frame 29 (clip window ends) so `lastRenderedFrame` keeps advancing with empty renders — the clamp in the assertion handles the comparison. Sample count 16 × 100 ms ≈ 1.6 s — inside the 30-frame/1 s clip for the first ~7 post-warmup samples and past it for the rest; both regimes asserted.

- [ ] **Step 5: Run**

```bash
cd frontend && npx playwright test tests/engine-playback.spec.ts tests/video-source.spec.ts --reporter=line
```
Expected: 3 PASS. If sync exceeds 1 frame consistently at steady state: check that `renderFrame` awaits don't pile up (the `renderBusy` guard must drop frames, never queue) and that the clock is being sampled at tick time (not capture time). Report findings rather than widening the tolerance past 1 frame — 1 frame IS the design-doc gate.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/engine/webglPreviewRenderer.ts frontend/app/pages/engine-test.vue frontend/playwright.config.ts frontend/tests/engine-playback.spec.ts
git commit -m "Engine: real-time playback in the harness — source ladder, clock+audio wiring, A/V sync gate (≤1 frame)"
```

---

## Task 8: WebKit (Safari-engine) verification project

Playwright's WebKit approximates Safari (same engine, not the same media stack). The webkit project runs the ENGINE specs only — conformance, source contracts, playback. The golden gate stays chromium-only in M2 (tolerances were calibrated on Chromium's GPU stack; recalibrating per-engine is M3 material — the design doc's "Safari manual verification" also lands properly at M3 dogfooding on real Safari, note this in the report).

**Files:**
- Modify: `frontend/playwright.config.ts`
- Modify: `frontend/tests/video-source.spec.ts` + `frontend/tests/engine-playback.spec.ts` (only if WebKit-specific guards prove necessary — see Step 3)

- [ ] **Step 1: Install WebKit:** `cd frontend && npx playwright install webkit` (it was NOT previously installed).

- [ ] **Step 2: Add the project** to `frontend/playwright.config.ts` `projects` array (after chromium):

```ts
    {
      // Safari-engine verification for the WebGL/WebCodecs engine ONLY.
      // The golden gate is excluded: its tolerances are calibrated on
      // Chromium's GPU stack (see timeline-golden.spec.ts) — per-engine
      // recalibration is deliberately deferred to M3 dogfooding.
      name: 'webkit-engine',
      use: { ...devices['Desktop Safari'] },
      testMatch: [
        '**/gl-blend-conformance.spec.ts',
        '**/video-source.spec.ts',
        '**/engine-playback.spec.ts',
      ],
    },
```

IMPORTANT: check how the chromium project selects tests today — it has NO testMatch (runs everything). Adding a second project makes EVERY spec run under chromium AND the matched ones under webkit; that's the intent. But existing full-suite runs (`npx playwright test`) will now include webkit — confirm `npx playwright test --list 2>&1 | tail -3` shows the expected ~4 extra webkit entries and no others.

- [ ] **Step 3: Run the webkit project:**

```bash
npx playwright test --project=webkit-engine --reporter=line
```

Triage expectations (don't chase perfection — report honestly):
- `gl-blend-conformance`: SHOULD pass (highp float math; same GPU, different GL stack). If a mode exceeds 2/255 by a hair on WebKit only: report the worst diffs, do NOT touch the shared TOL; a webkit-specific skip with a logged issue is acceptable ONLY if diffs are ≤4/255 and uniform (precision, not formula).
- `video-source`: the WebCodecs test auto-skips if `VideoDecoder` is absent in this WebKit build (the `test.skip(!hasWebCodecs…)` guard from Task 5); the VideoElementSource test MUST pass — it IS the Safari story.
- `engine-playback`: may be flakier under WebKit (autoplay policy — there's no chromium-style flag; the clock falls back to `performance.now` when the AudioContext can't start, by design). If audio can't start, the test still passes on the fallback clock — that's the failure ladder working. If it fails on SYNC, investigate before excusing.

Record per-spec outcomes for the report. If something needs a guard (e.g. `test.skip(browserName === 'webkit' && …)`), keep it surgical and commented with the reason.

- [ ] **Step 4: Full suite sanity** (both projects): `npx playwright test tests/gl-blend-conformance.spec.ts tests/video-source.spec.ts tests/engine-playback.spec.ts --reporter=line` → both-project run green (with any documented skips).

- [ ] **Step 5: Commit**

```bash
git add frontend/playwright.config.ts frontend/tests/video-source.spec.ts frontend/tests/engine-playback.spec.ts
git commit -m "Engine: webkit-engine Playwright project — Safari-engine verification for conformance, sources, playback"
```

---

## Task 9: Verification sweep + design-doc M2 status

- [ ] **Step 1: Everything:**

```bash
cd frontend && pnpm run test:unit
cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/ 2>&1 | tail -1
cd frontend && npx playwright test --reporter=line 2>&1 | tail -5
```
Expected: unit green; Python green (incl. the new media-fixture test); the full Playwright run green across chromium + webkit-engine (documented skips acceptable; the pre-existing "no video files in input/" skip persists).

- [ ] **Step 2: Design doc.** In `docs/plans/2026-06-09-phase1-webgl-engine-design.md`, mark M2 done:

`2. **M2 — Playback.** ✅ Completed <date> (plan: docs/plans/2026-06-09-phase1-m2-playback-plan.md). Clock + WebCodecs decode (frame-exact vs the counter fixture) + VideoElementSource ladder + audio engine; A/V sync gate ≤1 frame; WebKit-engine verification via Playwright (golden gate stays Chromium-calibrated; real-Safari manual pass folded into M3 dogfooding).`

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-06-09-phase1-webgl-engine-design.md
git commit -m "Engine: M2 playback complete — design doc status updated"
```

---

## Out of scope (M2) — do not build

`usePlaybackEngineGL` / editor flag / TimelineEditor changes (M3); waveforms; WebM demux; HEVC-specific tests; VFR video (explicit `UnsupportedSourceError`); golden gate under webkit; perf beyond cached uniforms; seek-while-playing audio rescheduling UX polish (harness pause→seek→play is sufficient for M2).
