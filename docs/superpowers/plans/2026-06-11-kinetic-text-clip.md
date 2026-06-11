# Kinetic Text Clip (Phase 1, Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A timeline **Motion clip** holding one animated text layer — add it, pick a variable font, choose a kinetic preset, animate a font axis (e.g. weight) over the clip — and watch it play and scrub in the timeline preview, rendered through the shared `lib/motion` engine.

**Architecture:** A new `'motion'` clip kind whose content is a single text layer, evaluated by `lib/motion` at the timeline playhead. A new pure `renderMotionClip()` (evaluate → axis-interpolate → draw) is dispatched from both preview paths (Canvas2D and WebGL/TextCanvasSource). Variable-font axis interpolation is lifted out of `useKineticRenderer` into a shared `lib/motion/axes.ts`. A `MotionClipInspector.vue` edits the selected clip. No new engine math — it reuses `evaluateAnimation` + `drawAnimatedTextLayer`.

**Tech Stack:** Vue 3 + TS (Nuxt 4), the existing `lib/motion` engine, the timeline store/editor, vitest (`cd frontend && npx vitest run tests/unit`).

**Spec:** docs/superpowers/specs/2026-06-11-kinetic-timeline-design.md

**Conventions binding every task:**
- Work on branch **main** directly. TREE SANITY GUARD for every task: `git branch --show-current` == `main` AND the prior tasks' files exist before starting and again before committing (a parallel session switches this checkout's branch mid-task — if the tree looks wrong, STOP and report BLOCKED; never recreate files). Stage only your own files.
- Tests: `cd frontend && npx vitest run tests/unit`. Dev servers supervised: Nuxt :3002, ComfyUI :8188.
- Geometry: `lib/motion` convention — x/y normalized centers (0..1), sizes normalized to canvas WIDTH. The Motion clip follows it (NOT the old `useAnimatedTextRenderer` which used canvas-height font size).
- `evaluateAnimation(anim, t, motion, n)`: `t` and durations are in SECONDS; `motion = { fps, duration }`; `n` = non-whitespace char count.

## Scope notes (read before starting)

- **This is author + preview only.** Export (bake the Motion clip to a video the Timeline node renders) and the full twirl-down keyframe-lane UX are **Slice B** (next plan). Axis animation here uses a simple per-axis `from → to` control that writes a 2-keyframe `axisKeyframes` array; the renderer interpolates it. Slice B replaces that control with full multi-keyframe lanes.
- **`useAnimatedTextRenderer` is NOT deleted here.** The legacy `title`/`lower_third` clips still use it (and `lower_third`'s bar+two-line compositing isn't a clean `lib/motion` mapping). The Motion clip is the new surface on the shared engine; retiring the legacy renderer is a later cleanup once those clips are migrated or removed. This refines the spec's "delete the duplication" Phase-1 line — the *new* surface is unified; no *new* duplication is added.

---

### Task 1: MotionClip + MotionLayer types

**Files:**
- Modify: `frontend/shared/timeline/types.ts` (Clip union ~line 222; add interfaces near the other animated-text clips ~line 192)
- Test: `frontend/tests/unit/motion-clip-types.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/motion-clip-types.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { migrateEditState, createDefaultEditState } from '../../shared/timeline/types'
import type { MotionClip } from '../../shared/timeline/types'

describe('MotionClip in the edit state', () => {
  it('a motion clip round-trips through migrateEditState untouched', () => {
    const clip: MotionClip = {
      id: 'm1', kind: 'motion', start_frame: 0, in_frame: 0, length: 120,
      layer: { id: 'l1', kind: 'text', text: 'ADELAIDE', fontFamily: 'Inter', fontSize: 0.11,
               color: '#ffffff', align: 'center',
               animation: { offset: 0, in: { presetId: 'mask-up', duration: 0.7, stagger: 0.035 } } },
    }
    const state = createDefaultEditState()
    state.tracks[0].clips.push(clip as any)
    const migrated = migrateEditState(JSON.parse(JSON.stringify(state)))!
    const back = migrated.tracks[0].clips[0] as MotionClip
    expect(back.kind).toBe('motion')
    expect(back.layer.text).toBe('ADELAIDE')
    expect(back.layer.animation?.in?.presetId).toBe('mask-up')
  })
})
```

- [ ] **Step 2: Run → FAIL** (`cd frontend && npx vitest run tests/unit/motion-clip-types.unit.spec.ts`) — `MotionClip` not exported.

- [ ] **Step 3: Add the types.** In `frontend/shared/timeline/types.ts`, after the `LowerThirdClip` interface, add:

```ts
// ── Motion clip (kinetic timeline) ──────────────────────────────────────────
// A timeline clip whose content is a layer stack evaluated by lib/motion at the
// playhead. v1 holds exactly one text layer. Generalizes later to N layers
// (a Frame on the timeline) and to vector layers — text is the one-layer case.

/** Variable-font axis keyframe, normalized time 0..1 within the clip. */
export interface MotionAxisKeyframe {
  t: number
  axes: Record<string, number>
  ease?: string
}

/** In/out/loop preset animation — structurally mirrors lib/motion's
 *  LayerAnimation so the renderer can pass it straight to evaluateAnimation,
 *  WITHOUT shared/ importing an app/ type (keeps the layering clean). */
export interface MotionLayerAnimation {
  offset: number
  duration?: number
  in?: { presetId: string; duration: number; stagger?: number; ease?: string }
  out?: { presetId: string; duration: number; stagger?: number; ease?: string }
  loop?: { presetId: string; duration: number; stagger?: number; ease?: string }
}

export interface MotionTextLayer {
  id: string
  kind: 'text'
  text: string
  fontFamily: string
  fontWeight?: number
  fontSize: number                 // normalized to canvas WIDTH (lib/motion convention)
  color: string
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  strokeColor?: string
  strokeWidth?: number             // normalized to canvas width
  x?: number; y?: number           // normalized centers; default 0.5/0.5
  /** Base variable-font axis values (wght/wdth/opsz/slnt/custom). */
  axes?: Record<string, number>
  /** Variable-font axis animation (clip-local, normalized 0..1). */
  axisKeyframes?: MotionAxisKeyframe[]
  /** In/out/loop preset animation — structurally compatible with lib/motion's
   *  LayerAnimation (the renderer passes it to evaluateAnimation). */
  animation?: MotionLayerAnimation
}

export interface MotionClip extends BaseClip {
  kind: 'motion'
  layer: MotionTextLayer           // v1: a single text layer
}
```

Then extend the `Clip` union (~line 222) to include `| MotionClip`:

```ts
export type Clip = VideoClip | ImageClip | AudioClip | TextClip | WorkflowClip | TitleClip | LowerThirdClip | CaptionClip | MotionClip
```

(`migrateEditState` passes unknown clip kinds through untouched — confirm by reading it; it only normalizes `version`/`transitions`, so a `motion` clip survives.)

- [ ] **Step 4: Run → PASS**, full suite green (`npx vitest run tests/unit`).

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/timeline/types.ts frontend/tests/unit/motion-clip-types.unit.spec.ts
git commit -m "Timeline: MotionClip + MotionTextLayer types"
```

---

### Task 2: Lift axis interpolation into the shared engine

**Files:**
- Create: `frontend/app/lib/motion/axes.ts`
- Modify: `frontend/app/composables/useKineticRenderer.ts` (import from the new module instead of its local copies)
- Test: `frontend/tests/unit/motion-axes.unit.spec.ts`

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/unit/motion-axes.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { interpolateAxes, axesToVariationSettings } from '../../app/lib/motion/axes'

describe('interpolateAxes', () => {
  const base = { wght: 400 }
  it('no keyframes → static axes', () => {
    expect(interpolateAxes([], 0.5, base)).toEqual({ wght: 400 })
  })
  it('interpolates linearly between two keyframes', () => {
    const kf = [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 }, ease: 'none' }]
    expect(interpolateAxes(kf, 0.5, base).wght).toBeCloseTo(500, 3)
  })
  it('clamps before first / after last', () => {
    const kf = [{ t: 0.25, axes: { wght: 200 } }, { t: 0.75, axes: { wght: 800 } }]
    expect(interpolateAxes(kf, 0, base).wght).toBe(200)
    expect(interpolateAxes(kf, 1, base).wght).toBe(800)
  })
  it('missing axis holds its static value', () => {
    const kf = [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 } }]
    expect(interpolateAxes(kf, 0.5, { wght: 400, wdth: 75 }).wdth).toBe(75)
  })
})

describe('axesToVariationSettings', () => {
  it('formats CSS font-variation-settings', () => {
    expect(axesToVariationSettings({ wght: 600, wdth: 80 })).toBe('"wght" 600, "wdth" 80')
  })
  it('empty → empty string', () => {
    expect(axesToVariationSettings({})).toBe('')
  })
})
```

- [ ] **Step 2: Run → FAIL** (module not found).

- [ ] **Step 3: Create `frontend/app/lib/motion/axes.ts`.** Read the EXISTING `interpolateAxes` (useKineticRenderer.ts ~line 72) and `axesToVariationSettings` (~line 120) and MOVE them here verbatim, plus the `AxisKeyframe` shape, as the canonical home:

```ts
// frontend/app/lib/motion/axes.ts
/** Variable-font axis animation — shared by the Frame kinetic bake and the
 *  timeline Motion clip. Interpolates OpenType axis values over normalized
 *  time and formats them as CSS font-variation-settings. */

export interface AxisKeyframe {
  t: number                       // normalized 0..1
  axes: Record<string, number>
  ease?: string                   // GSAP-style ease name for the segment after this keyframe
}

// (Move the exact body of useKineticRenderer's interpolateAxes here. It sorts
//  by t, clamps, and lerps each axis between the bracketing keyframes, holding
//  static values for axes not present. If the original applies an ease per
//  segment, keep that behavior identical.)
export function interpolateAxes(
  keyframes: AxisKeyframe[],
  t: number,
  staticAxes: Record<string, number>,
): Record<string, number> {
  if (!keyframes.length) return { ...staticAxes }
  const sorted = keyframes.length > 1 ? [...keyframes].sort((a, b) => a.t - b.t) : keyframes
  const ct = Math.max(0, Math.min(1, t))
  if (ct <= sorted[0].t || sorted.length === 1) return { ...staticAxes, ...sorted[0].axes }
  const last = sorted[sorted.length - 1]
  if (ct >= last.t) return { ...staticAxes, ...last.axes }
  let lo = sorted[0], hi = sorted[1]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].t >= ct) { lo = sorted[i - 1]; hi = sorted[i]; break }
  }
  const span = Math.max(1e-6, hi.t - lo.t)
  const p = (ct - lo.t) / span
  const out: Record<string, number> = { ...staticAxes, ...lo.axes }
  for (const tag of Object.keys(hi.axes)) {
    const a = lo.axes[tag] ?? staticAxes[tag] ?? hi.axes[tag]
    const b = hi.axes[tag]
    out[tag] = a + (b - a) * p
  }
  return out
}

export function axesToVariationSettings(axes: Record<string, number>): string {
  return Object.entries(axes).map(([tag, v]) => `"${tag}" ${v}`).join(', ')
}
```

VERIFY the moved `interpolateAxes` matches the original's numeric behavior (the test pins the easy cases; if the original eased segments, replicate it — but the timeline uses `ease: 'none'`/linear by default, so linear is the baseline). Then in `useKineticRenderer.ts`, DELETE its local `interpolateAxes`/`axesToVariationSettings`/`AxisKeyframe` and import them from `~/lib/motion/axes` (re-export `AxisKeyframe` if other code imports it from useKineticRenderer — grep first).

- [ ] **Step 4: Run new test + full suite** — green (the kinetic renderer's own behavior is unchanged; it now imports the shared fns).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/motion/axes.ts frontend/app/composables/useKineticRenderer.ts frontend/tests/unit/motion-axes.unit.spec.ts
git commit -m "Motion engine: lift variable-font axis interpolation into lib/motion/axes"
```

---

### Task 3: The Motion clip renderer

**Files:**
- Create: `frontend/app/lib/engine/motionClipRenderer.ts`
- Test: `frontend/tests/unit/motion-clip-render.unit.spec.ts`

- [ ] **Step 1: Failing test (recording-stub ctx, like motion-text-layout).**

```ts
// frontend/tests/unit/motion-clip-render.unit.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { renderMotionClip } from '../../app/lib/engine/motionClipRenderer'
import type { MotionClip } from '../../shared/timeline/types'

function recCtx() {
  const calls: any[] = []
  let variation = ''
  const ctx: any = {
    canvas: { width: 100, height: 100 }, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter', lineCap: 'butt',
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none',
    get fontVariationSettings() { return variation }, set fontVariationSettings(v: string) { variation = v; calls.push(['var', v]) },
    save(){}, restore(){}, translate(){}, rotate(){}, scale(){}, setTransform(){},
    beginPath(){}, rect(){}, clip(){}, measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: (s: string) => calls.push(['fillText', s, variation]),
    strokeText(){}, drawImage(){},
  }
  return { ctx: ctx as CanvasRenderingContext2D, calls }
}

const CLIP: MotionClip = {
  id: 'm', kind: 'motion', start_frame: 0, in_frame: 0, length: 120,
  layer: {
    id: 'l', kind: 'text', text: 'AB', fontFamily: 'Inter', fontWeight: 400, fontSize: 0.1,
    color: '#fff', align: 'center', axes: { wght: 100 },
    axisKeyframes: [{ t: 0, axes: { wght: 100 } }, { t: 1, axes: { wght: 900 } }],
    animation: { offset: 0, in: { presetId: 'fade-in', duration: 1, stagger: 0 } },
  },
}

describe('renderMotionClip', () => {
  beforeEach(() => { vi.stubGlobal('document', { fonts: { load: () => Promise.resolve() }, createElement: () => ({ getContext: () => recCtx().ctx }) }) })
  afterEach(() => vi.unstubAllGlobals())

  it('draws the chars at mid-clip with interpolated axis weight applied', () => {
    const { ctx, calls } = recCtx()
    renderMotionClip(ctx, CLIP, 60, 100, 100, 30) // localFrame 60 of 120 @ 30fps → t=2s, duration=4s, mid → wght~500
    const draws = calls.filter(c => c[0] === 'fillText')
    expect(draws.length).toBeGreaterThan(0)
    expect(calls.some(c => c[0] === 'var' && /"wght"\s*\d/.test(c[1]))).toBe(true)
    const wght = Number(/"wght"\s*([\d.]+)/.exec(calls.find(c => c[0] === 'var')![1])![1])
    expect(wght).toBeGreaterThan(100); expect(wght).toBeLessThan(900)
  })

  it('draws nothing before the clip starts animating-in-visible window only when visible', () => {
    // fade-in over 1s, clip duration 4s: at t=0 the units exist but opacity≈0;
    // renderMotionClip still issues draws (visibility is per-unit opacity, not skip).
    const { ctx, calls } = recCtx()
    renderMotionClip(ctx, CLIP, 0, 100, 100, 30)
    // At t=0 fade-in opacity is ~0 so drawAnimatedTextLayer skips near-zero chars;
    // assert it did not throw and set a variation string.
    expect(calls.some(c => c[0] === 'var')).toBe(true)
  })
})
```

(NOTE: the stub is approximate — if `drawAnimatedTextLayer` skips opacity≤0.001 chars, the t=0 case may have zero fillText calls; that's why the second test only asserts the axis-variation set + no throw. Adjust the stub if `layoutTextUnits` needs more ctx methods; mirror `tests/unit/motion-text-layout.unit.spec.ts`'s stub.)

- [ ] **Step 2: Run → FAIL** (module not found).

- [ ] **Step 3: Implement `frontend/app/lib/engine/motionClipRenderer.ts`:**

```ts
// frontend/app/lib/engine/motionClipRenderer.ts
/** Render a timeline Motion clip's text layer at a clip-local frame, through
 *  the shared lib/motion engine: evaluate the per-char animation, interpolate
 *  variable-font axes, and draw. One text layer in v1. */
import type { MotionClip, MotionTextLayer } from '~~/shared/timeline/types'
import { createTextLayer, type TextLayer } from '~/composables/useCompositorLayers'
import { evaluateAnimation } from '~/lib/motion/evaluate'
import { drawAnimatedTextLayer } from '~/lib/motion/animatedText'
import { interpolateAxes, axesToVariationSettings } from '~/lib/motion/axes'

const IDENTITY_ANIM = { offset: 0 } // no in/out/loop ⇒ always-visible, static units

/** Build a lib/motion TextLayer from the MotionTextLayer spec. */
function toTextLayer(l: MotionTextLayer): TextLayer {
  return createTextLayer({
    text: l.text,
    fontFamily: l.fontFamily,
    fontWeight: l.fontWeight ?? 700,
    fontSize: l.fontSize,
    color: l.color,
    align: l.align ?? 'center',
    lineHeight: l.lineHeight ?? 1.1,
    strokeColor: l.strokeColor ?? '#000000',
    strokeWidth: l.strokeWidth ?? 0,
    x: l.x ?? 0.5,
    y: l.y ?? 0.5,
    opacity: 1,
    rotation: 0,
  })
}

export function renderMotionClip(
  ctx: CanvasRenderingContext2D,
  clip: MotionClip,
  localFrame: number,
  canvasW: number,
  canvasH: number,
  fps: number,
): void {
  const l = clip.layer
  const duration = Math.max(0.01, clip.length / fps)
  const t = localFrame / fps
  const motion = { fps, duration }
  const n = Math.max(1, [...l.text].filter(c => c.trim()).length)

  const state = evaluateAnimation(l.animation ?? IDENTITY_ANIM, t, motion, n)
  if (!state.visible || !state.units) return

  // Variable-font axes: base values, interpolated over normalized clip time.
  const base = l.axes ?? {}
  const axes = interpolateAxes(l.axisKeyframes ?? [], duration > 0 ? t / duration : 0, base)
  const variation = axesToVariationSettings(axes)
  // fontVariationSettings is a non-standard canvas property; set it before drawing.
  ;(ctx as any).fontVariationSettings = variation || 'normal'

  drawAnimatedTextLayer(ctx, toTextLayer(l), canvasW, canvasH, state.units)
}
```

- [ ] **Step 4: Run new test + full suite** — green. (If the stub misses a ctx method `layoutTextUnits`/`drawAnimatedTextLayer` call, add it to the stub per the error.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/motionClipRenderer.ts frontend/tests/unit/motion-clip-render.unit.spec.ts
git commit -m "Timeline: renderMotionClip — text layer via lib/motion + axis animation"
```

---

### Task 4: Dispatch the Motion clip in both preview paths + ensure fonts

**Files:**
- Modify: `frontend/app/composables/usePlaybackEngine.ts` (the title/lower_third block, ~line 146-163)
- Modify: `frontend/app/lib/engine/sources/textCanvasSource.ts` (supports + getFrame)
- Modify: `frontend/app/composables/usePlaybackEngine.ts` (font ensure on edit-state change — see step 3)

This task is rendering integration; verification is in-browser (Task 7). No new unit test (the renderer is already tested).

- [ ] **Step 1: Canvas2D dispatch.** In `usePlaybackEngine.ts`, import the renderer and add a branch alongside the existing `title`/`lower_third` branches:

```ts
import { renderMotionClip } from '~/lib/engine/motionClipRenderer'
import type { MotionClip } from '~~/shared/timeline/types'
// ...inside the per-clip loop, after the lower_third branch:
        if (clip.kind === 'motion') {
          const localFrame = (currentSec - startSec) * fps
          ctx.save()
          ctx.globalCompositeOperation = CANVAS_BLEND[clip.blend ?? 'normal'] ?? 'source-over'
          ctx.globalAlpha = clip.opacity ?? 1
          renderMotionClip(ctx, clip as MotionClip, localFrame, cw, ch, fps)
          ctx.restore()
          continue
        }
```

- [ ] **Step 2: WebGL dispatch.** In `textCanvasSource.ts`: extend `supports()` and `getFrame()` to handle `'motion'`. Change the class to accept `MotionClip` too:

```ts
import type { Clip, TitleClip, LowerThirdClip, MotionClip } from '~~/shared/timeline/types'
import { renderMotionClip } from '~/lib/engine/motionClipRenderer'
// constructor clip type: TitleClip | LowerThirdClip | MotionClip
  static supports(clip: Clip): clip is TitleClip | LowerThirdClip | MotionClip {
    return clip.kind === 'title' || clip.kind === 'lower_third' || clip.kind === 'motion'
  }
  async getFrame(n: number): Promise<TexImageSource> {
    this.ctx.clearRect(0, 0, this.canvasW, this.canvasH)
    if (this.clip.kind === 'title') renderTitleClip(this.ctx, this.clip, n, this.canvasW, this.canvasH, this.fps)
    else if (this.clip.kind === 'lower_third') renderLowerThirdClip(this.ctx, this.clip, n, this.canvasW, this.canvasH, this.fps)
    else renderMotionClip(this.ctx, this.clip as MotionClip, n, this.canvasW, this.canvasH, this.fps)
    return this.canvas
  }
```

(Confirm where `TextCanvasSource.supports` is called in `webglPreviewRenderer.ts` so motion clips actually route to it — grep `TextCanvasSource`.)

- [ ] **Step 3: Ensure the variable font is loaded.** Canvas text renders with a fallback unless the font face is loaded. Find how the timeline already loads fonts for title clips (grep `fonts.load` / `ensureLayerFonts` / `useGoogleFontPreview` in `usePlaybackEngine.ts` / the timeline). If titles already trigger a font load by family, extend it to include motion clips' `layer.fontFamily`. If nothing loads fonts for titles today (likely — they assume system/loaded fonts), add a minimal ensure: when the edit state changes, for every `motion` clip call `document.fonts.load(\`700 32px "${clip.layer.fontFamily}"\`)` (best-effort, ignore failures) AND for variable fonts inject the Google CSS link via the existing `useGoogleFontPreview().ensure(family)` used by the Font Playground / Compositor (grep `useGoogleFontPreview`). Variation rendering needs the variable file served — `ensure` requests the full axis range. Implement as a small `ensureMotionFonts(state)` called from the same place the engine reacts to edit-state changes.

- [ ] **Step 4: Compile + full suite** — `npx vitest run tests/unit` green; `npx vue-tsc --noEmit 2>&1 | grep -iE "motion|textCanvas|playback" | head` — no new errors in the touched files.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/usePlaybackEngine.ts frontend/app/lib/engine/sources/textCanvasSource.ts
git commit -m "Timeline: render Motion clips in both preview paths + ensure fonts"
```

---

### Task 5: Add a Kinetic Text clip + the store factory

**Files:**
- Modify: `frontend/app/composables/useTimelineStore.ts` (a `createMotionClip` factory + an `addMotionClip` helper using the existing `addClip`)
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue` (a toolbar button "Kinetic Text")
- Test: `frontend/tests/unit/motion-clip-factory.unit.spec.ts`

- [ ] **Step 1: Failing test for the factory.**

```ts
// frontend/tests/unit/motion-clip-factory.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { createMotionClip } from '../../app/composables/timelineMotionClip'

describe('createMotionClip', () => {
  it('builds a centered text motion clip with a default preset at the playhead', () => {
    const clip = createMotionClip({ startFrame: 30, length: 90 })
    expect(clip.kind).toBe('motion')
    expect(clip.start_frame).toBe(30)
    expect(clip.length).toBe(90)
    expect(clip.layer.kind).toBe('text')
    expect(clip.layer.text.length).toBeGreaterThan(0)
    expect(clip.layer.x).toBeCloseTo(0.5, 6)
    expect(clip.layer.animation?.in?.presetId).toBeTruthy()
  })
  it('ids are unique across calls', () => {
    expect(createMotionClip({ startFrame: 0, length: 60 }).id)
      .not.toBe(createMotionClip({ startFrame: 0, length: 60 }).id)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Create the factory `frontend/app/composables/timelineMotionClip.ts`** (a tiny pure module so it's unit-testable without the store):

```ts
// frontend/app/composables/timelineMotionClip.ts
import type { MotionClip } from '~~/shared/timeline/types'

let _seq = 0
function id(prefix: string) { _seq += 1; return `${prefix}-${_seq}-${Math.round(performance.now())}` }

/** A fresh Kinetic Text Motion clip: centered display text, mask-up reveal. */
export function createMotionClip(opts: { startFrame: number; length: number }): MotionClip {
  return {
    id: id('motion'),
    kind: 'motion',
    start_frame: opts.startFrame,
    in_frame: 0,
    length: opts.length,
    layer: {
      id: id('mtl'),
      kind: 'text',
      text: 'KINETIC',
      fontFamily: 'Inter',
      fontWeight: 800,
      fontSize: 0.11,
      color: '#ffffff',
      align: 'center',
      x: 0.5, y: 0.5,
      axes: { wght: 800 },
      animation: { offset: 0, in: { presetId: 'mask-up', duration: 0.6, stagger: 0.04 },
                   out: { presetId: 'fade-out', duration: 0.4, stagger: 0.02 } },
    },
  }
}
```

(`performance.now()` is allowed in the app; avoid `Date.now()` only in pure-render/determinism code — factory ids aren't pixels.)

- [ ] **Step 4: Wire the store + toolbar.** In `useTimelineStore.ts` add:

```ts
import { createMotionClip } from '~/composables/timelineMotionClip'
// inside useTimelineStore(), alongside addClip:
  function addMotionClip(trackId: string, startFrame: number, length = 90) {
    const clip = createMotionClip({ startFrame, length })
    addClip(trackId, clip as any)
    selectedClipId.value = clip.id
    return clip
  }
// expose addMotionClip in the returned object
```

In `TimelineEditor.vue`, add a toolbar button near the existing add/clip controls (grep the toolbar markup): label "Kinetic Text" (or a Type icon), `@click` → resolve the active/first video-kind track and the current playhead frame, then call `store.addMotionClip(trackId, playheadFrame)`. (Read how the editor gets the playhead frame and the target track — mirror how existing clips are added; if there's no add-clip precedent, use the first `track.kind === 'video'` track and `Math.round(playhead * fps)`.)

- [ ] **Step 5: Run new test + full suite** — green. Commit:

```bash
git add frontend/app/composables/timelineMotionClip.ts frontend/app/composables/useTimelineStore.ts frontend/app/components/vue-canvas/TimelineEditor.vue frontend/tests/unit/motion-clip-factory.unit.spec.ts
git commit -m "Timeline: add Kinetic Text clip (factory + toolbar entry)"
```

---

### Task 6: The Motion clip inspector

**Files:**
- Create: `frontend/app/components/vue-canvas/timeline/MotionClipInspector.vue`
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue` (mount it in the selected-clip sidebar when `selectedClip.kind === 'motion'`)

UI task — verification in Task 7. The inspector edits the selected Motion clip via `store.updateClip(clipId, patch)` (patch merges into the clip; to edit the nested layer, send `{ layer: { ...clip.layer, ...layerPatch } }`).

- [ ] **Step 1: Build `MotionClipInspector.vue`.** Props `{ clip: MotionClip }`; emits `{ update: [patch: Partial<MotionClip>] }`. Sections:

```vue
<script setup lang="ts">
import type { MotionClip } from '~~/shared/timeline/types'
import { SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '~/lib/motion/evaluate'
import { VARIABLE_FONTS } from '~/data/variable-fonts'   // grep the exact export name

const props = defineProps<{ clip: MotionClip }>()
const emit = defineEmits<{ update: [patch: Partial<MotionClip>] }>()

const L = () => props.clip.layer
function patchLayer(p: Record<string, unknown>) { emit('update', { layer: { ...L(), ...p } as any }) }
function patchAnim(key: 'in' | 'out' | 'loop', presetId: string) {
  const anim = { offset: 0, ...(L().animation ?? {}) } as any
  anim[key] = presetId ? { ...(anim[key] ?? { duration: key === 'loop' ? 1.5 : 0.6, stagger: 0.04 }), presetId } : undefined
  patchLayer({ animation: anim })
}
function patchAxis(tag: string, v: number) { patchLayer({ axes: { ...(L().axes ?? {}), [tag]: v } }) }

// The chosen font's axis metadata (for sliders). Variable fonts only; a plain
// font shows no axis sliders.
const fontDef = () => VARIABLE_FONTS.find(f => f.family === L().fontFamily)
</script>

<template>
  <div class="space-y-3 text-xs">
    <label class="block">Text
      <textarea :value="clip.layer.text" rows="2"
        class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90"
        @change="patchLayer({ text: ($event.target as HTMLTextAreaElement).value })" />
    </label>

    <label class="flex items-center justify-between gap-2">Font
      <select class="w-36 bg-[#1a1a1a] rounded px-1 py-0.5" :value="clip.layer.fontFamily"
        @change="patchLayer({ fontFamily: ($event.target as HTMLSelectElement).value })">
        <option v-for="f in VARIABLE_FONTS" :key="f.id" :value="f.family">{{ f.label }}</option>
      </select>
    </label>

    <label class="flex items-center justify-between gap-2">Size
      <input type="number" min="0.01" max="0.5" step="0.005" :value="clip.layer.fontSize"
        class="w-20 bg-[#1a1a1a] rounded px-1 py-0.5"
        @change="patchLayer({ fontSize: Number(($event.target as HTMLInputElement).value) || 0.1 })" />
    </label>

    <label class="flex items-center justify-between gap-2">Color
      <input type="color" :value="clip.layer.color"
        @change="patchLayer({ color: ($event.target as HTMLInputElement).value })" />
    </label>

    <!-- Variable-font axes (base values) -->
    <div v-if="fontDef()" class="space-y-1">
      <div class="text-white/50 uppercase tracking-wide text-[10px]">Axes</div>
      <label v-for="ax in fontDef()!.axes" :key="ax.tag" class="flex items-center gap-2">
        <span class="w-16 text-white/60">{{ ax.label }}</span>
        <input type="range" class="flex-1 accent-emerald-400" :min="ax.min" :max="ax.max" :step="ax.step ?? 1"
          :value="clip.layer.axes?.[ax.tag] ?? ax.default"
          @input="patchAxis(ax.tag, Number(($event.target as HTMLInputElement).value))" />
      </label>
    </div>

    <!-- Animation presets -->
    <div class="space-y-1">
      <div class="text-white/50 uppercase tracking-wide text-[10px]">Animation</div>
      <label v-for="key in (['in','out','loop'] as const)" :key="key" class="flex items-center justify-between gap-2 capitalize">
        {{ key }}
        <select class="w-32 bg-[#1a1a1a] rounded px-1 py-0.5" :value="clip.layer.animation?.[key]?.presetId ?? ''"
          @change="patchAnim(key, ($event.target as HTMLSelectElement).value)">
          <option value="">none</option>
          <option v-for="id in (key==='in'?SUPPORTED_IN_IDS:key==='out'?SUPPORTED_OUT_IDS:SUPPORTED_LOOP_IDS)" :key="id" :value="id">{{ id }}</option>
        </select>
      </label>
    </div>
  </div>
</template>
```

(Confirm `VARIABLE_FONTS` is the exported catalog name in `app/data/variable-fonts.ts` — grep; the file's interface is `VariableFont`. If the timeline font dropdown should also offer non-variable fonts, union with the Google/template font list, but v1 can scope to variable fonts since axes are the point.)

- [ ] **Step 2: Mount it.** In `TimelineEditor.vue`, find the selected-clip sidebar (the generic transform panel). When `selectedClip?.kind === 'motion'`, render `<MotionClipInspector :clip="selectedClip" @update="p => store.updateClip(selectedClip.id, p)" />` above/instead of the generic transform controls. Use the auto-import name for the new component path (`timeline/MotionClipInspector.vue` → `VueCanvasTimelineMotionClipInspector` if path-prefixed; verify against how a sibling `vue-canvas/timeline/*` or `vue-canvas/compositor/*` component is referenced).

- [ ] **Step 3: Compile + full suite** — green. Commit:

```bash
git add frontend/app/components/vue-canvas/timeline/MotionClipInspector.vue frontend/app/components/vue-canvas/TimelineEditor.vue
git commit -m "Timeline: Motion clip inspector (text, variable-font axes, presets)"
```

---

### Task 7: Variable-font axis animation control + browser acceptance

**Files:**
- Modify: `frontend/app/components/vue-canvas/timeline/MotionClipInspector.vue` (per-axis "animate from→to" control writing `axisKeyframes`)

- [ ] **Step 1: Add the animate control.** Below each axis slider, add a small "animate" toggle. When on, show two number inputs (from / to) that write a 2-keyframe `axisKeyframes` array for that axis; when off, clear that axis from `axisKeyframes`. Keep it minimal (Slice B replaces this with full keyframe lanes):

Add these helpers to `<script setup>`. The model: `axisKeyframes` is always either
absent or exactly two entries (`t:0` and `t:1`), each carrying every animated
axis. The renderer already interpolates them over `t/duration`, so no renderer
change is needed.

```ts
function axisAnimated(tag: string): boolean {
  return !!L().axisKeyframes?.some(k => tag in k.axes)
}
function axisFrom(tag: string): number | undefined { return L().axisKeyframes?.[0]?.axes?.[tag] }
function axisTo(tag: string): number | undefined { return L().axisKeyframes?.[L().axisKeyframes!.length - 1]?.axes?.[tag] }

/** Write/clear a single axis's from→to animation. `from === null` clears it. */
function setAxisAnim(tag: string, from: number | null, to: number | null) {
  const cur = L().axisKeyframes
  const start: Record<string, number> = { ...(cur?.[0]?.axes ?? {}) }
  const end: Record<string, number> = { ...(cur?.[cur.length - 1]?.axes ?? {}) }
  if (from === null) { delete start[tag]; delete end[tag] }
  else { start[tag] = from; end[tag] = to ?? from }
  const anyAnimated = Object.keys(start).length > 0
  patchLayer({ axisKeyframes: anyAnimated ? [{ t: 0, axes: start }, { t: 1, axes: end }] : undefined })
}
```

```vue
<!-- under each axis slider row -->
<div class="flex items-center gap-2 pl-16 text-[10px]">
  <label class="flex items-center gap-1">
    <input type="checkbox" :checked="axisAnimated(ax.tag)"
      @change="($event.target as HTMLInputElement).checked
        ? setAxisAnim(ax.tag, clip.layer.axes?.[ax.tag] ?? ax.default, ax.max)
        : setAxisAnim(ax.tag, null, null)"> animate
  </label>
  <template v-if="axisAnimated(ax.tag)">
    <input type="number" class="w-14 bg-[#1a1a1a] rounded px-1" :value="axisFrom(ax.tag)"
      @change="setAxisAnim(ax.tag, Number(($event.target as HTMLInputElement).value), axisTo(ax.tag) ?? null)">
    <span class="text-white/40">→</span>
    <input type="number" class="w-14 bg-[#1a1a1a] rounded px-1" :value="axisTo(ax.tag)"
      @change="setAxisAnim(ax.tag, axisFrom(ax.tag) ?? null, Number(($event.target as HTMLInputElement).value))">
  </template>
</div>
```

- [ ] **Step 2: Compile + full suite** — green. Commit:

```bash
git add frontend/app/components/vue-canvas/timeline/MotionClipInspector.vue
git commit -m "Timeline: animate variable-font axes (from→to) on a Motion clip"
```

- [ ] **Step 3: Browser acceptance** (Chrome MCP, app :3002; a Timeline node/editor open — add one if needed; ComfyUI :8188 up; `comfynext:Comfy.VueNodes.Enabled` = true if required):
  1. Open the timeline editor. Click **Kinetic Text** → a Motion clip appears on a video track at the playhead, selected; the inspector shows Text/Font/Size/Color/Axes/Animation.
  2. Play the timeline → the text reveals with the default `mask-up` per-char stagger; scrub → it tracks the playhead.
  3. Change the font to a variable font (e.g. one with a `wght` axis), drag the **wght** base slider → the preview thickens live.
  4. Toggle **animate** on `wght`, set from 100 → to 900 → play: the word visibly thickens over the clip. Screenshot mid-animation.
  5. Console clean (`read_console_messages`): no errors from the timeline/motion path.
  If the dev env can't be driven, report DONE_WITH_CONCERNS with exactly what compiled vs what you couldn't click.

- [ ] **Step 4: Final full suite** — `npx vitest run tests/unit` green. (No commit unless step 3 surfaced a small fix.)

---

## Out of scope for this plan (Slice A)

- **Export** — baking the Motion clip to a video the Timeline node renders (Slice B). Today the clip is preview-only.
- **Full keyframe lanes** — the twirl-down per-channel keyframe tracks with stopwatches; this slice ships base axes + a simple from→to axis animation only (Slice B).
- The cloner (Phase 2), Frame-on-timeline (Phase 3), vector layers, deleting `useAnimatedTextRenderer`.

## Risks for the implementer

- **Font loading for variable axes:** if the chosen variable font isn't loaded with its variable file, canvas renders a static fallback and the axis slider does nothing visible. Task 4 step 3 is load-bearing — verify the font actually loads (the Font Playground / Compositor already solve this; reuse `useGoogleFontPreview().ensure`).
- **`fontVariationSettings` on canvas** is non-standard (Chrome supports it; the app is Chrome-driven). Cast `(ctx as any)`; if a target browser ignores it, axis animation silently no-ops — acceptable for the Chrome dev target, note it.
- **TimelineEditor.vue is large** — mount the inspector and toolbar button by grepping anchors (selected-clip sidebar, toolbar add controls); don't trust line numbers.
- **Two preview paths** (Canvas2D + WebGL) must both render the clip — verify which one is active in the editor (there's a GL flag); test whichever the editor uses, ideally both.
- **Parallel session** switches the branch — tree-guard every task; stage only your own files.
