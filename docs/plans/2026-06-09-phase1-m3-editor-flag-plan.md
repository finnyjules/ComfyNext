# Phase 1 / M3: Editor Flag + Dogfooding Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The WebGL engine becomes selectable inside the real TimelineEditor behind a localStorage flag — with text/title sources, real asset resolution, audio playback, per-clip resilience, and a dogfooding checklist — milestone M3 of `docs/plans/2026-06-09-phase1-webgl-engine-design.md`.

**Architecture:** A new `usePlaybackEngineGL` composable matches the existing `usePlaybackEngine` surface exactly (`(canvasRef, state, playhead, isPlaying, resolveClipPreview[, resolveAudioUrl]) → {start, stop, destroy, drawFrame}`) so `TimelineEditor.vue` picks an engine with one flag branch. The store transport stays master (its `performance.now` clock drives `playhead`); the GL engine renders the playhead's frame each rAF (with an unchanged-frame early-out) and `AudioEngine` follows transport (play/pause/seek-jump watches). Sources gain editor reality: title/lower-third rasterization through the existing `renderTitleClip`/`renderLowerThirdClip` draws, sequence clips through `SequenceSource`, looping video semantics matching the Python exporter, per-clip skip-and-warn, and a WebCodecs size cap.

**Tech Stack:** Existing engine modules (`frontend/app/lib/engine/*`), `useLocalSettings` flag pattern, Playwright (incl. webkit-engine project), no new dependencies.

**Conventions:** pnpm frontend; servers :3002/:8188 up for Playwright; BRANCH GUARD in every task (work on `phase1-m3-editor-flag`; never stash/switch user files); `git add` only named files; commits `Area: description`.

**Scope guard (YAGNI):** No default-flip (M4, after dogfooding). No plain `text`-clip rendering (old preview doesn't render them either; Phase 2/3 territory — warn-skip). No transport rewrite (audio-master clock in the editor is an M4+ decision; store clock and `AudioContext` both track wall time, drift is ms-scale per minute — documented, accepted). No context-loss recovery beyond warn-once (dogfooding will tell us if it matters).

**Ground truth (verified):**
- `TimelineEditor.vue:171`: `const engine = usePlaybackEngine(canvasRef, store.state, store.playhead, store.isPlaying, resolveClipPreview)`; `engine.start()` ~line 67 (onMounted), `engine.destroy()` ~line 96 (onUnmounted); preview canvas `ref="canvasRef"` ~line 1289. `resolveClipPreview` (~lines 154–169) resolves asset clips via `getAsset`/`getAssetUrl` and workflow clips via `resolveClipSource`; returns null for audio/text/title/lower_third (titles render inline in the old engine).
- `playhead` is SECONDS; TimelineEditor's own rAF calls `store.tickPlayhead()` (~line 175).
- `renderTitleClip(ctx, clip, localFrame, canvasW, canvasH, fps)` / `renderLowerThirdClip(...)` in `~/composables/useAnimatedTextRenderer` are pure synchronous ctx draws.
- Flag pattern: `getLocalSetting(key)`/`setLocalSetting` in `frontend/app/composables/useLocalSettings.ts` (auto `sailor:` prefix).
- Python exporter LOOPS video sources (`ct = (local_t + in_frame) % src_T` in `render_frame_np`); the old Canvas2D preview loops too (`targetTime % v.duration`). M2's WebCodecsSource CLAMPS — that's the odd one out and gets fixed here (Task 1).
- ComfyUI `/view` serves byte ranges (probe-verified 206) — `VideoElementSource` can seek real assets.

---

## Task 1: Loop-semantics parity — video sources wrap like the exporter

**Files:**
- Modify: `frontend/app/lib/engine/sources/webCodecsSource.ts`
- Modify: `frontend/app/lib/engine/sources/videoElementSource.ts`
- Modify: `frontend/tests/video-source.spec.ts`

- [ ] **Step 1: Update the contract spec FIRST (failing).** In `frontend/tests/video-source.spec.ts`:
- In the WebCodecs test, replace the clamp probe:
```ts
  // Looping parity with the Python exporter (render_frame_np: ct = local % src_T)
  // and the Canvas2D preview (% duration): out-of-range frames WRAP, not clamp.
  const [rWrap] = await page.evaluate(() => (window as any).__engineTest.frameValue(35))
  expect(indexOf(rWrap)).toBe(5)
  const [rWrap2] = await page.evaluate(() => (window as any).__engineTest.frameValue(99))
  expect(indexOf(rWrap2)).toBe(9)   // 99 % 30
```
(delete the old `frameValue(99) → 29` clamp assertion).
- In the element test, add probe `33` expecting index within ±1 of `3` (33 % 30):
```ts
  for (const n of [0, 7, 13, 29, 33]) {
    const want = n % 30
    const [r] = await page.evaluate((f) => (window as any).__engineTest.frameValue(f), n)
    expect(Math.abs(indexOf(r) - want), `frame ${n} → gray ${r}`).toBeLessThanOrEqual(1)
  }
```

- [ ] **Step 2:** Run `cd frontend && npx playwright test tests/video-source.spec.ts --reporter=line` — the new assertions FAIL (sources clamp today).

- [ ] **Step 3: Implement wrapping.**
- `webCodecsSource.ts` `getFrame`: replace the clamp line with
```ts
    const len = this.samples.length
    if (!len) throw new Error('WebCodecsSource: no samples')
    // Loop like the exporter (render_frame_np: % src_T) and the old preview.
    const idx = ((Math.trunc(n) % len) + len) % len
```
- `videoElementSource.ts` `getFrame`: compute the source's frame count once at load (`Math.max(1, Math.round(video.duration * fps))` stored as a private field) and wrap:
```ts
  async getFrame(n: number): Promise<TexImageSource> {
    const wrapped = ((Math.trunc(n) % this.frameCount) + this.frameCount) % this.frameCount
    const target = (wrapped + 0.5) / this.fps   // mid-frame avoids boundary snapping
    ...
```
(constructor gains the `frameCount` computation from `video.duration` after load; keep everything else).

- [ ] **Step 4:** Run the contract spec on BOTH projects: `npx playwright test tests/video-source.spec.ts --reporter=line` (chromium + webkit-engine → 4 PASS). Also `npx playwright test tests/engine-playback.spec.ts --reporter=line` (unaffected — its clip window ends before any wrap, but verify).

- [ ] **Step 5: Commit**
```bash
git add frontend/app/lib/engine/sources/webCodecsSource.ts frontend/app/lib/engine/sources/videoElementSource.ts frontend/tests/video-source.spec.ts
git commit -m "Engine: video sources loop like the exporter (% src length) instead of clamping"
```

---

## Task 2: Title/lower-third sources + draw-list admission

Titles rasterize through the EXISTING pure draws (`renderTitleClip`/`renderLowerThirdClip`) onto an offscreen canvas that becomes a full-canvas texture. Deliberate behavior delta vs the old preview (document, don't hide): transforms/keyframes/fades now apply to title clips uniformly — matching the data model and how BAKED titles already behave in exports.

**Files:**
- Create: `frontend/app/lib/engine/sources/textCanvasSource.ts`
- Modify: `frontend/app/lib/engine/compositor.ts`
- Test: `frontend/tests/unit/compositor.unit.spec.ts` (append)

- [ ] **Step 1: Failing test** — append to `frontend/tests/unit/compositor.unit.spec.ts`:

```ts
describe('buildDrawList — title/lower_third admission', () => {
  it('admits title clips with registered dims as full-canvas entries', () => {
    const state = migrateEditState({
      version: 2,
      canvas: { width: 640, height: 360, fps: 30, bg_color: '#000000' },
      total_frames: 20, transitions: [],
      tracks: [{ id: 't', kind: 'video', name: 'V', muted: false, locked: false, clips: [
        { id: 'ttl', kind: 'title', start_frame: 0, in_frame: 0, length: 20, opacity: 0.9,
          title: { text: 'Hi', font_family: 'Inter', font_weight: 700, font_size: 0.1,
                   color: '#fff', animation_in: 'stagger-up', animation_out: 'fade-out-up',
                   hold_frames: 10, stagger: 0.05, ease: 'power2.out' } },
      ] }],
    })!
    // Renderer registers the CANVAS size as the title source's dims.
    const dims = new Map([['ttl', { w: 640, h: 360 }]])
    const e = buildDrawList(state, 5, dims)[0]!
    expect(e.clipId).toBe('ttl')
    expect(e.widthPx).toBe(640)    // full canvas (same aspect → exact fit)
    expect(e.heightPx).toBe(360)
    expect(e.centerX).toBe(320)
    expect(e.alpha).toBeCloseTo(0.9, 10)
    expect(e.sourceFrame).toBe(5)
  })

  it('still skips unregistered/unsupported kinds', () => {
    const state = migrateEditState({
      version: 2,
      canvas: { width: 640, height: 360, fps: 30, bg_color: '#000000' },
      total_frames: 20, transitions: [],
      tracks: [{ id: 't', kind: 'video', name: 'V', muted: false, locked: false, clips: [
        { id: 'txt', kind: 'text', start_frame: 0, in_frame: 0, length: 20,
          text: { text: 'x', font_size: 72, color: '#fff', bg_color: '#000', align: 'center', v_align: 'middle', padding: 0.06, line_spacing: 1.2 } },
      ] }],
    })!
    expect(buildDrawList(state, 5, new Map())).toEqual([])
  })
})
```

- [ ] **Step 2:** `cd frontend && pnpm run test:unit` — FAIL (title kind not admitted; note `e.url` handling below).

- [ ] **Step 3: Compositor admission.** In `frontend/app/lib/engine/compositor.ts`:
- Replace the kind gate with a set:
```ts
const RENDERABLE_KINDS = new Set(['image', 'video', 'title', 'lower_third'])
```
```ts
      if (!RENDERABLE_KINDS.has(clip.kind)) continue // M3: media + animated text (plain 'text' is Phase 2/3)
      const url = 'path' in clip ? clip.path ?? '' : ''   // text sources have no URL
      const dims = srcDims.get(clip.id)
      if (!dims) continue
```
(the old `if (!url || !dims) continue` becomes dims-only gating — media clips without a path simply never get dims registered, so the behavior for them is unchanged; update `DrawEntry.url`'s doc comment to say it's empty for canvas-rasterized sources). Keep everything else identical.

- [ ] **Step 4: Create `frontend/app/lib/engine/sources/textCanvasSource.ts`:**

```ts
import type { Clip, TitleClip, LowerThirdClip } from '~~/shared/timeline/types'
import { renderTitleClip, renderLowerThirdClip } from '~/composables/useAnimatedTextRenderer'
import type { FrameSource } from './frameSource'

/** Rasterizes animated text (title / lower_third) per frame onto an offscreen
 *  canvas that the GL layer uploads as a full-canvas texture. Reuses the SAME
 *  pure draws as the Canvas2D preview (useAnimatedTextRenderer) — one text
 *  implementation, two compositors.
 *
 *  Behavior delta vs the old preview (deliberate): the draw list applies
 *  transforms/keyframes/fades to these entries uniformly, matching how BAKED
 *  titles behave in exports. The old preview ignored transforms on live titles. */
export class TextCanvasSource implements FrameSource {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  constructor(
    private clip: TitleClip | LowerThirdClip,
    private canvasW: number,
    private canvasH: number,
    private fps: number,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = canvasW
    this.canvas.height = canvasH
    this.ctx = this.canvas.getContext('2d')!
  }

  static supports(clip: Clip): clip is TitleClip | LowerThirdClip {
    return clip.kind === 'title' || clip.kind === 'lower_third'
  }

  get width(): number { return this.canvasW }
  get height(): number { return this.canvasH }

  async getFrame(n: number): Promise<TexImageSource> {
    this.ctx.clearRect(0, 0, this.canvasW, this.canvasH)
    if (this.clip.kind === 'title') {
      renderTitleClip(this.ctx, this.clip, n, this.canvasW, this.canvasH, this.fps)
    } else {
      renderLowerThirdClip(this.ctx, this.clip, n, this.canvasW, this.canvasH, this.fps)
    }
    return this.canvas
  }

  dispose(): void {
    this.canvas.width = 0
    this.canvas.height = 0
  }
}
```

NOTE for the GL upload path: text frames change every frame, so the version passed to `setSource` must be the sourceFrame (animated), which Task 3's source-construction table handles. Transparent canvas regions upload as alpha<1 RGBA — but the layer shader samples `.rgb` only and treats the whole quad as opaque (`inside` coverage). That means transparent areas of the text canvas would render BLACK over the layers below. **This task must extend the shader to honor source alpha:** in `frontend/app/lib/engine/gl/shaders.ts` FRAGMENT_SRC, change the sampling + alpha lines to:

```glsl
  vec4 srcTex = texture(u_src, clamp(uv, 0.0, 1.0));
  vec3 src = srcTex.rgb;

  // Python: result = base*(1-a) + blend(base, src)*a  (a = 0 outside the layer;
  // src alpha modulates coverage — opaque media uploads with alpha=1 so this is
  // a no-op for image/video layers and only bites for rasterized text).
  float a = u_alpha * inside * srcTex.a;
```

This is pixel-identical for opaque sources (alpha=1 everywhere — images decode opaque, VideoFrames are opaque) and the golden + conformance gates verify that: run them in Step 6.

- [ ] **Step 5:** `pnpm run test:unit` — green.

- [ ] **Step 6: GPU regression** (the shader changed — the gates must prove opaque content is untouched):
```bash
npx playwright test tests/gl-blend-conformance.spec.ts tests/timeline-golden.spec.ts tests/video-source.spec.ts --reporter=line
```
Expected: all PASS on both projects (conformance ×2, golden ×6, video-source ×4). Any golden drift means the alpha change wasn't a no-op for opaque sources — STOP and investigate (check UNPACK_PREMULTIPLY is still false and decoded media really carries alpha=255).

- [ ] **Step 7: Commit**
```bash
git add frontend/app/lib/engine/sources/textCanvasSource.ts frontend/app/lib/engine/compositor.ts frontend/app/lib/engine/gl/shaders.ts frontend/tests/unit/compositor.unit.spec.ts
git commit -m "Engine: title/lower-third rasterization sources + alpha-aware layer shader (opaque media unchanged)"
```

---

## Task 3: Renderer resilience — resolver injection, skip-and-warn, size cap

`WebGLPreviewRenderer.load` learns the editor's resolution model and stops failing wholesale.

**Files:**
- Modify: `frontend/app/lib/engine/webglPreviewRenderer.ts`
- Modify: `frontend/app/pages/timeline-harness.vue` (no API change needed — verify only)
- Test: `frontend/tests/unit/renderer-resolve.unit.spec.ts`

- [ ] **Step 1: Failing unit test for the pure resolution table** — create `frontend/tests/unit/renderer-resolve.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolutionPlanFor } from '../../app/lib/engine/webglPreviewRenderer'

// The pure decision table: clip + resolved preview → which source kind loads.
describe('resolutionPlanFor', () => {
  const base = { id: 'c', start_frame: 0, in_frame: 0, length: 10 }
  it('image clip + image preview → image source', () => {
    expect(resolutionPlanFor({ ...base, kind: 'image' } as any, { url: 'u', kind: 'image' })).toEqual({ kind: 'image', url: 'u' })
  })
  it('video clip + video preview → webcodecs ladder', () => {
    expect(resolutionPlanFor({ ...base, kind: 'video' } as any, { url: 'u', kind: 'video' })).toEqual({ kind: 'video', url: 'u' })
  })
  it('workflow clip resolved to a sequence → sequence source', () => {
    expect(resolutionPlanFor({ ...base, kind: 'workflow', port_index: 1 } as any, { url: 'u0', kind: 'sequence', urls: ['u0', 'u1'] }))
      .toEqual({ kind: 'sequence', urls: ['u0', 'u1'] })
  })
  it('title clip needs no preview → text source', () => {
    expect(resolutionPlanFor({ ...base, kind: 'title', title: {} } as any, null)).toEqual({ kind: 'text' })
  })
  it('unsupported / unresolved → null', () => {
    expect(resolutionPlanFor({ ...base, kind: 'text' } as any, null)).toBeNull()
    expect(resolutionPlanFor({ ...base, kind: 'video' } as any, null)).toBeNull()
  })
})
```

- [ ] **Step 2:** `pnpm run test:unit` — FAIL.

- [ ] **Step 3: Rework `webglPreviewRenderer.ts`.** Shape (read the current file and preserve renderFrame/dispose/dims behavior):

```ts
import type { EditState, Clip } from '~~/shared/timeline/types'
import type { PreviewRenderer } from '~~/shared/timeline/previewRenderer'
import type { ClipPreview } from '~/composables/usePlaybackEngine'
import { buildDrawList, hexToRgb } from './compositor'
import { GlRenderer } from './gl/glRenderer'
import { ImageSource } from './sources/imageSource'
import { SequenceSource } from './sources/sequenceSource'
import { TextCanvasSource } from './sources/textCanvasSource'
import { WebCodecsSource, UnsupportedSourceError } from './sources/webCodecsSource'
import { VideoElementSource } from './sources/videoElementSource'
import type { FrameSource } from './sources/frameSource'

/** Above this, skip WebCodecs (whole-file fetch) and go straight to the
 *  seek-and-capture element source. Best-effort: unknown sizes proceed. */
export const WEBCODECS_MAX_BYTES = 96 * 1024 * 1024

export type ResolutionPlan =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'sequence'; urls: string[] }
  | { kind: 'text' }
  | null

/** Pure decision table: which source loads for a clip given its resolved
 *  preview. Exported for unit tests. */
export function resolutionPlanFor(clip: Clip, preview: ClipPreview | null): ResolutionPlan {
  if (TextCanvasSource.supports(clip)) return { kind: 'text' }
  if (!preview) return null
  if (preview.kind === 'sequence' && preview.urls?.length) return { kind: 'sequence', urls: preview.urls }
  if (preview.kind === 'image') return { kind: 'image', url: preview.url }
  if (preview.kind === 'video') return { kind: 'video', url: preview.url }
  return null
}

export interface RendererLoadOptions {
  /** Editor-style resolution (asset library / wired nodes). Default: the
   *  harness behavior — clip.path is already a fetchable URL. */
  resolve?: (clip: Clip) => ClipPreview | null
}

const defaultResolve = (clip: Clip): ClipPreview | null => {
  if ((clip.kind === 'image' || clip.kind === 'video') && clip.path) {
    return { url: clip.path, kind: clip.kind }
  }
  return null
}

export class WebGLPreviewRenderer implements PreviewRenderer {
  private state: EditState | null = null
  private gl: GlRenderer | null = null
  private sources = new Map<string, FrameSource>()
  /** Per-clip load failures (clip id → message). Cleared per load(). */
  readonly loadWarnings = new Map<string, string>()

  async load(state: EditState, opts: RendererLoadOptions = {}): Promise<void> {
    this.disposeSources()
    this.loadWarnings.clear()
    this.gl ??= new GlRenderer()
    this.state = state
    const resolve = opts.resolve ?? defaultResolve
    const { width: W, height: H, fps } = state.canvas

    const loads: Promise<void>[] = []
    for (const track of state.tracks) {
      if (track.kind === 'audio') continue
      for (const clip of track.clips) {
        const plan = resolutionPlanFor(clip, resolve(clip))
        if (!plan) {
          if (clip.kind !== 'caption' && clip.kind !== 'text') continue
          console.warn(`WebGLPreviewRenderer: clip kind '${clip.kind}' not renderable yet — skipped`)
          continue
        }
        loads.push(
          this.loadSource(clip, plan, W, H, fps)
            .then(src => { this.sources.set(clip.id, src) })
            .catch((e) => {
              // Per-clip resilience: a failed source must not kill the preview.
              const msg = e instanceof Error ? e.message : String(e)
              this.loadWarnings.set(clip.id, msg)
              console.warn(`WebGLPreviewRenderer: clip ${clip.id} failed to load — skipped (${msg})`)
            }),
        )
      }
    }
    await Promise.all(loads)
  }

  private async loadSource(clip: Clip, plan: Exclude<ResolutionPlan, null>, W: number, H: number, fps: number): Promise<FrameSource> {
    switch (plan.kind) {
      case 'text':
        return new TextCanvasSource(clip as any, W, H, fps)
      case 'image':
        return ImageSource.load(plan.url)
      case 'sequence':
        return SequenceSource.load(plan.urls, 0) // in_frame lives in sourceFrame already
      case 'video': {
        if (await this.tooLargeForWebCodecs(plan.url)) {
          console.warn(`WebGLPreviewRenderer: ${plan.url} exceeds WebCodecs size cap — element source`)
          return VideoElementSource.load(plan.url, fps)
        }
        try {
          return await WebCodecsSource.load(plan.url)
        } catch (e) {
          if (e instanceof UnsupportedSourceError) {
            console.warn(`WebGLPreviewRenderer: WebCodecs unavailable for ${plan.url} (${e.message}) — element fallback`)
            return VideoElementSource.load(plan.url, fps)
          }
          throw e
        }
      }
    }
  }

  private async tooLargeForWebCodecs(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      const len = Number(res.headers.get('content-length'))
      return Number.isFinite(len) && len > WEBCODECS_MAX_BYTES
    } catch {
      return false // unknown size → proceed; the cap is best-effort
    }
  }
  // renderFrame / disposeSources / dispose: unchanged except — in renderFrame,
  // the static-version check becomes: ImageSource stays version 0; everything
  // else (sequence, text, video) versions by e.sourceFrame.
}
```

Keep `renderFrame`'s existing body; verify its version line reads `const version = src instanceof ImageSource ? 0 : e.sourceFrame` (it does, from M2's close-out) — sequences and text sources animate, so that line is already right. Also REGISTER text-source dims: `renderFrame` builds dims from `src.width/height`, which for `TextCanvasSource` is the canvas size — no extra work needed (confirm by reading).

- [ ] **Step 4:** `pnpm run test:unit` green; harness regression: `npx playwright test tests/timeline-golden.spec.ts tests/engine-playback.spec.ts --reporter=line` — all PASS (the default resolver preserves harness behavior; engine-test's `loadTimeline` calls `renderer.load(state)` with no opts).

- [ ] **Step 5: Commit**
```bash
git add frontend/app/lib/engine/webglPreviewRenderer.ts frontend/tests/unit/renderer-resolve.unit.spec.ts
git commit -m "Engine: renderer learns editor resolution — pure plan table, per-clip skip-and-warn, WebCodecs size cap"
```

---

## Task 4: `usePlaybackEngineGL` + audio resolver generalization

The drop-in composable. Also generalizes `AudioEngine.load`'s URL resolution from path-mapping to clip-mapping (editor audio clips carry `asset_id`, not always `path`).

**Files:**
- Create: `frontend/app/composables/usePlaybackEngineGL.ts`
- Modify: `frontend/app/lib/engine/audio/audioEngine.ts` (load signature)
- Modify: `frontend/app/pages/engine-test.vue` (one-line caller update)
- Test: existing suites (composable is exercised by Task 6's e2e; audio change re-runs engine-playback)

- [ ] **Step 1: AudioEngine.load generalization.** In `audioEngine.ts`, change:

```ts
  /** Decode every unmuted audio clip's asset. resolveClipUrl maps an audio
   *  CLIP to a fetchable URL (editor: asset library; harness: clip.path). */
  async load(state: EditState, resolveClipUrl: (clip: Clip) => string | null): Promise<void> {
```
and in the loop replace the `!clip.path` gate + `resolveUrl(clip.path)` with:
```ts
        if (clip.kind !== 'audio') continue
        const url = resolveClipUrl(clip)
        if (!url) continue
```
(import `Clip` type). Update `engine-test.vue`'s caller: `audio.load(state, (c) => ('path' in c ? c.path ?? null : null))`.

- [ ] **Step 2:** Re-run: `npx playwright test tests/engine-playback.spec.ts --reporter=line` — PASS (both projects).

- [ ] **Step 3: Create `frontend/app/composables/usePlaybackEngineGL.ts`:**

```ts
import { watch, type Ref } from 'vue'
import type { EditState, Clip } from '~~/shared/timeline/types'
import { WebGLPreviewRenderer } from '~/lib/engine/webglPreviewRenderer'
import { AudioEngine } from '~/lib/engine/audio/audioEngine'
import type { ClipPreview } from '~/composables/usePlaybackEngine'

/** True when the browser can host the WebGL engine at all. */
export function webglPreviewSupported(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch {
    return false
  }
}

/**
 * WebGL twin of usePlaybackEngine — same surface, swapped behind the
 * 'sailor:Engine.WebGLPreview' flag in TimelineEditor. The store transport
 * stays master (playhead in seconds, ticked by the editor's rAF); this engine
 * renders the playhead's frame each rAF with an unchanged-frame early-out, and
 * audio FOLLOWS transport (re-anchored on play and on seek jumps). Drift between
 * the store clock and AudioContext is ms-scale (both wall-clock) — accepted for
 * M3; audio-master transport is the M4+ question.
 */
export function usePlaybackEngineGL(
  canvasRef: Ref<HTMLCanvasElement | null>,
  state: Ref<EditState>,
  playhead: Ref<number>,
  isPlaying: Ref<boolean>,
  resolveClipPreview: (clip: Clip) => ClipPreview | null,
  resolveAudioUrl: (clip: Clip) => string | null = () => null,
) {
  const renderer = new WebGLPreviewRenderer()
  const audio = new AudioEngine()
  let rafId: number | null = null
  let lastRenderedFrame = -1
  let renderBusy = false
  let dirty = true
  let loading = false
  let failedOnce = false

  /** Clip set signature — reload sources when it changes. */
  const clipSignature = () =>
    state.value.tracks
      .flatMap(t => t.clips.map(c => `${c.id}:${c.kind}:${'path' in c ? c.path ?? '' : ''}`))
      .join('|') + `@${state.value.canvas.width}x${state.value.canvas.height}`

  let lastSignature = ''

  async function reload(): Promise<void> {
    if (loading) return
    loading = true
    try {
      await Promise.all([
        renderer.load(state.value, { resolve: resolveClipPreview }),
        audio.load(state.value, resolveAudioUrl),
      ])
      dirty = true
      lastRenderedFrame = -1
    } catch (e) {
      if (!failedOnce) {
        failedOnce = true
        console.error('usePlaybackEngineGL: engine load failed — preview may be incomplete', e)
      }
    } finally {
      loading = false
    }
  }

  async function drawFrame(): Promise<void> {
    const canvas = canvasRef.value
    if (!canvas || loading) return
    const fps = state.value.canvas.fps
    const frame = Math.floor(playhead.value * fps)
    if (frame === lastRenderedFrame && !dirty) return
    if (renderBusy) return // drop, never queue
    renderBusy = true
    try {
      await renderer.renderFrame(frame, canvas)
      lastRenderedFrame = frame
      dirty = false
    } catch (e) {
      if (!failedOnce) {
        failedOnce = true
        console.error('usePlaybackEngineGL: render failed', e)
      }
    } finally {
      renderBusy = false
    }
  }

  function loop() {
    void drawFrame()
    rafId = requestAnimationFrame(loop)
  }

  function start() {
    if (rafId !== null) return
    if (canvasRef.value) canvasRef.value.dataset.engine = 'webgl'
    const sig = clipSignature()
    lastSignature = sig
    void reload()
    loop()
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function destroy() {
    stop()
    audio.dispose()
    renderer.dispose()
  }

  // Sources follow the clip set (deep watch, same trigger as the old engine's
  // stale-media cleanup); signature check keeps transform-only edits cheap.
  // Canvas settings (bg color, size, fps) are included so paused edits repaint.
  watch(() => [state.value.tracks, state.value.canvas], () => {
    const sig = clipSignature()
    if (sig !== lastSignature) {
      lastSignature = sig
      void reload()
    }
    dirty = true
  }, { deep: true })

  // Audio follows transport.
  watch(isPlaying, async (playing) => {
    if (playing) {
      await audio.resume()
      audio.play(state.value, playhead.value)
    } else {
      audio.stop()
    }
  })

  // Seek jumps while playing → reschedule audio from the new position.
  let lastPlayhead = 0
  watch(playhead, (now) => {
    const jumped = Math.abs(now - lastPlayhead) > 0.25
    lastPlayhead = now
    if (jumped && isPlaying.value) {
      audio.stop()
      audio.play(state.value, now)
    }
  })

  return { start, stop, destroy, drawFrame }
}
```

- [ ] **Step 4:** Typecheck: `npx vue-tsc --noEmit 2>&1 | grep -E "usePlaybackEngineGL|audioEngine|engine-test" | head -5` → empty. `pnpm run test:unit` green.

- [ ] **Step 5: Commit**
```bash
git add frontend/app/composables/usePlaybackEngineGL.ts frontend/app/lib/engine/audio/audioEngine.ts frontend/app/pages/engine-test.vue
git commit -m "Engine: usePlaybackEngineGL — drop-in GL twin with transport-following audio; AudioEngine resolves per clip"
```

---

## Task 5: TimelineEditor flag branch

Surgical: one import block, one flag read, one ternary, one audio resolver. `TimelineEditor.vue` is large and may carry user WIP — check `git diff frontend/app/components/vue-canvas/TimelineEditor.vue` FIRST; if it has uncommitted foreign changes, make your edits anyway but report the file's prior dirty state and commit ONLY if your hunks are separable (they are — line-local), staging with `git add` of the whole file ONLY when it was clean before; otherwise stop and report BLOCKED for the controller to sequence.

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue` (~lines 44, 154–171)

- [ ] **Step 1:** Read the current engine instantiation site (~line 171) and the imports. Apply:

```ts
import { usePlaybackEngineGL, webglPreviewSupported } from '~/composables/usePlaybackEngineGL'
import { getLocalSetting } from '~/composables/useLocalSettings'
```

```ts
function resolveAudioUrl(clip: Clip): string | null {
  if (clip.kind !== 'audio') return null
  const asset = getAsset((clip as any).asset_id)
  return asset ? getAssetUrl(asset) : null
}

// WebGL preview engine (Phase 1 M3): opt-in via
//   localStorage.setItem('sailor:Engine.WebGLPreview', 'true')
// Falls back to the Canvas2D engine when WebGL2 is unavailable.
const wantGl = getLocalSetting('Engine.WebGLPreview') === 'true'
const useGl = wantGl && webglPreviewSupported()
if (wantGl && !useGl) console.warn('TimelineEditor: WebGL preview flag set but WebGL2 unavailable — Canvas2D fallback')
const engine = useGl
  ? usePlaybackEngineGL(canvasRef, store.state, store.playhead, store.isPlaying, resolveClipPreview, resolveAudioUrl)
  : usePlaybackEngine(canvasRef, store.state, store.playhead, store.isPlaying, resolveClipPreview)
```

(`getAsset`/`getAssetUrl` are already in scope from `useAssetLibrary()` — verify; `Clip` type already imported — verify; adapt minimally.)

- [ ] **Step 2: Flag-off regression** (the default path must be byte-identical in behavior): `npx playwright test tests/timeline.spec.ts --reporter=line` — same results as before this task (9 passed + 1 skipped, or current baseline).

- [ ] **Step 3: Manual flag-on smoke** (Task 6 automates this — here just prove it boots): with dev servers up, open the app, set the flag in the console, reload, open the timeline editor; confirm `document.querySelector('canvas[data-engine="webgl"]')` exists and no console errors. Use the preview tools to verify for real.

- [ ] **Step 4: Commit** (subject to the dirty-file protocol above)
```bash
git add frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "Timeline: WebGL preview engine behind the Engine.WebGLPreview flag with Canvas2D fallback"
```

---## Task 6: Flag-on e2e spec

**Files:**
- Test: `frontend/tests/timeline-gl-flag.spec.ts`

- [ ] **Step 1: Create the spec** (reuse the helpers' conventions — read `frontend/tests/_helpers.ts` and the clip-adding pattern in `frontend/tests/timeline.spec.ts` "clicking an input file appends a clip" before writing):

```ts
import { test, expect } from '@playwright/test'
import { openBlankWorkflow, openTimelineEditor, timelineEditorOverlay, waitForBackend } from './_helpers'

// Flag-on smoke: with sailor:Engine.WebGLPreview set, the timeline editor
// boots the WebGL engine (canvas tagged data-engine="webgl"), renders without
// fallback warnings, and draws real pixels when a clip is added.
// The default-flag path is covered by timeline.spec.ts (Canvas2D, unchanged).

test.describe('Timeline editor — WebGL engine flag', () => {
  test('boots the GL engine and renders a clip', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('Canvas2D fallback')) warnings.push(msg.text())
      if (msg.type() === 'error' && msg.text().includes('usePlaybackEngineGL')) warnings.push(msg.text())
    })
    await page.addInitScript(() => {
      try { localStorage.setItem('sailor:Engine.WebGLPreview', 'true') } catch {}
    })

    await waitForBackend(page)
    await openBlankWorkflow(page)
    await openTimelineEditor(page)
    const editor = timelineEditorOverlay(page)

    const canvas = editor.locator('canvas[data-engine="webgl"]')
    await expect(canvas).toBeVisible({ timeout: 10_000 })

    // Add the first available asset as a clip (same flow timeline.spec.ts uses).
    await expect(editor.locator('[data-testid="asset-row"]').first()).toBeVisible({ timeout: 15_000 })
    await editor.locator('[data-testid="asset-row"]').first().click()

    // The preview canvas must show non-background pixels once the clip lands.
    await expect.poll(async () => {
      return canvas.evaluate((c: HTMLCanvasElement) => {
        const ctx = c.getContext('2d')
        if (!ctx || c.width === 0) return 0
        const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
        return d[0]! + d[1]! + d[2]!
      })
    }, { timeout: 15_000, message: 'center pixel stays background' }).toBeGreaterThan(0)

    expect(warnings, `engine warnings: ${warnings.join(' | ')}`).toEqual([])
  })
})
```

ADAPT to reality: the asset-row click behavior and the background color (#000 default ⇒ sum 0 is bg) — read timeline.spec.ts for the actual add-clip interaction and assertion patterns; if the first asset is a dark image, scrub the playhead or sample multiple pixels. If `[data-testid="asset-row"]` requires assets to exist (the existing suite has this dependency and one env-dependent skip), follow the same convention (skip with the same message when no assets are available).

- [ ] **Step 2:** Run: `npx playwright test tests/timeline-gl-flag.spec.ts --reporter=line` → 1 PASS (chromium; it is NOT in the webkit-engine testMatch — editor e2e stays chromium, real-Safari is manual per the checklist). Then the flag-OFF suite again: `npx playwright test tests/timeline.spec.ts --reporter=line` — unchanged.

- [ ] **Step 3: Commit**
```bash
git add frontend/tests/timeline-gl-flag.spec.ts
git commit -m "Tests: flag-on e2e — WebGL engine boots in the editor, renders clips, no fallback warnings"
```

---

## Task 7: Dev-gate the harness pages

**Files:**
- Modify: `frontend/app/pages/timeline-harness.vue`
- Modify: `frontend/app/pages/gl-conformance.vue`
- Modify: `frontend/app/pages/engine-test.vue`
- Modify: `docs/plans/2026-06-09-phase1-webgl-engine-design.md` (close the deferral note)

- [ ] **Step 1:** Add to the TOP of each page's `<script setup>` (before other logic):

```ts
// Dev/test-only surface — 404 in production builds (the M1 deferral, closed in M3).
if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}
```

(`createError` is a Nuxt auto-import; `import.meta.dev` is compile-time true under `nuxt dev`, so Playwright against the dev server is unaffected and the prod bundle tree-shakes the page body.)

- [ ] **Step 2:** Verify dev still serves all three: `for p in timeline-harness gl-conformance engine-test; do curl -s -o /dev/null -w "$p:%{http_code} " http://127.0.0.1:3002/$p; done` → all 200. Then the suites that ride them: `npx playwright test tests/timeline-golden.spec.ts tests/gl-blend-conformance.spec.ts tests/video-source.spec.ts tests/engine-playback.spec.ts --reporter=line` — all PASS.

- [ ] **Step 3:** Update the design doc deferral paragraph (the one starting "**Accepted deferral:**") to: `**Accepted deferral (closed in M3):** the harness pages (\`/timeline-harness\`, \`/gl-conformance\`, \`/engine-test\`) are dev-gated — they 404 in production builds.`

- [ ] **Step 4: Commit**
```bash
git add frontend/app/pages/timeline-harness.vue frontend/app/pages/gl-conformance.vue frontend/app/pages/engine-test.vue docs/plans/2026-06-09-phase1-webgl-engine-design.md
git commit -m "Engine: dev-gate the three harness pages (404 in prod builds) — closes the M1 deferral"
```

---

## Task 8: Dogfooding checklist + design-doc status

**Files:**
- Create: `docs/plans/2026-06-09-phase1-m3-dogfooding-checklist.md`
- Modify: `docs/plans/2026-06-09-phase1-webgl-engine-design.md` (M3 row)

- [ ] **Step 1: Create the checklist** — `docs/plans/2026-06-09-phase1-m3-dogfooding-checklist.md`:

```markdown
# Phase 1 M3 — Dogfooding Checklist (WebGL preview engine)

**Enable** (browser console, then reload the editor):
\`\`\`js
localStorage.setItem('sailor:Engine.WebGLPreview', 'true')
\`\`\`
**Disable:** set to 'false' or remove the key. The Canvas2D engine remains the default; WebGL2-less browsers fall back automatically (one console warning).

**Confirm it's active:** the preview canvas carries `data-engine="webgl"`.

## What to exercise (real projects)
- [ ] Scrub + play timelines with mixed clips (video, image, kinetic sequences, titles/lower-thirds)
- [ ] Audio: clips audible during play, volume + audio fades honored, stops on pause, follows seeks
- [ ] Long video assets (the >96MB WebCodecs cap routes them to the element source — look for the console note)
- [ ] Odd codecs / screen recordings / WebM (should warn + fall back per clip, never blank the preview)
- [ ] Long sessions: memory stays flat-ish while scrubbing (decoded-frame LRU is bounded at 24 frames/clip)
- [ ] Compare a render (`/sailor/render_timeline`) against what the preview showed — WYSIWYG spot checks, esp. rotated/scaled clips

## Known accepted differences vs the old preview
- Titles/lower-thirds now honor transforms/keyframes/fades (matches exports; the old preview ignored them on live titles).
- Layer geometry is quantized like the exporter (the old preview used float fits) — ≤1px shifts, closer to what renders.
- Plain `text` clips don't render in either preview engine (exporter-only until Phase 2/3).

## Real-Safari manual pass (actual Safari, not just the webkit-engine CI project)
- [ ] Open the editor with the flag on; confirm `data-engine="webgl"`
- [ ] First play requires a click (autoplay policy) — audio starts after the gesture, clock falls back gracefully before it
- [ ] Video clips decode (WebCodecs) or visibly fall back to the element source — either is a pass; a blank layer is a fail
- [ ] Scrub accuracy on an H.264 asset (element fallback is allowed ±1 frame)
- [ ] Backgrounding the tab mid-play and returning: playback position holds (clock suspension hold)

## Reporting
Console warnings prefixed `WebGLPreviewRenderer:` / `usePlaybackEngineGL:` are the signal — copy them verbatim into issues. The flag means flipping back is instant; nothing in the old path was touched.

**M4 gate:** a week of real use with no fallback triggers and no visual complaints → flip the default (design doc M4).
```

- [ ] **Step 2:** Design doc M3 row → `3. **M3 — Editor flag.** 🚧 Implementation landed <date> (plan: docs/plans/2026-06-09-phase1-m3-editor-flag-plan.md); dogfooding IN PROGRESS per docs/plans/2026-06-09-phase1-m3-dogfooding-checklist.md. usePlaybackEngineGL behind \`sailor:Engine.WebGLPreview\` (default off), Canvas2D auto-fallback, kinetic/title/sequence/audio wired, per-clip skip-and-warn, WebCodecs size cap, harness pages dev-gated.`

- [ ] **Step 3: Commit**
```bash
git add docs/plans/2026-06-09-phase1-m3-dogfooding-checklist.md docs/plans/2026-06-09-phase1-webgl-engine-design.md
git commit -m "Docs: M3 dogfooding checklist + design-doc status (implementation landed, dogfooding open)"
```

---

## Task 9: Verification sweep + final review

- [ ] **Step 1:** Full suites: `cd frontend && pnpm run test:unit`; `.venv/bin/python -m pytest tests-unit/comfy_extras_test/ | tail -1`; `npx playwright test --reporter=line | tail -4` (both projects). All green (known conditional skips OK).
- [ ] **Step 2:** Final whole-milestone review (controller dispatches): coverage vs this plan, the Task-2 shader alpha change's golden neutrality, flag-off path untouched (diff TimelineEditor for accidental behavior change), M4 readiness list.
- [ ] **Step 3:** Commit any review fixes; report.

---

## Out of scope (M3) — do not build

Default-on flip (M4, gated on dogfooding); plain `text` clip rendering; captions; transport rewrite (audio-master clock in the editor); waveform changes; WebGL context-loss recovery beyond warn-once; golden gate under webkit; Settings-UI toggle for the flag (console flip is fine for dogfooding).
