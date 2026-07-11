# Typography & motion nodes — design

**Status: ALL 6 FEATURES BUILT** — frontend builds, Python nodes parse,
toolbox wired, playback engine extended.

Six new features that bring animated typography, GSAP-driven motion, and
smooth-scroll polish to Sailor. Ordered by build priority — each
builds on primitives from the one before.

**Shared philosophy**: local-first, no AI cost. Every node below renders
in-browser using GSAP + Canvas2D + the variable font infrastructure the
Font Playground already proved out. The output is an image batch (frame
sequence) that plugs straight into the Timeline as a clip.

---

## 1. Kinetic Typography node

**The flagship.** Type a word, pick a motion preset, get an animated
frame sequence — no AI, no cost.

### Node shape

| Field | Type | Notes |
|---|---|---|
| `text` | STRING (req.) | The word(s) to animate |
| `font` | hidden JSON | `WidgetFontPlayground`-style state: fontId, axes, color, bg, transform |
| `animation` | hidden JSON | Preset id + overrides — edited via a gallery widget |
| `fps` | INT | Default 30 |
| `duration` | FLOAT | Seconds. Default 2.0 |
| **output** | IMAGE (batch) | N frames, ready for the Timeline |

Backend: `KineticTypeNode` in `comfy_api_nodes/nodes_kinetic_type.py`.
Thin — accepts the uploaded frame batch from the frontend bake.
The real work is client-side.

### Frontend widget

`WidgetKineticType.vue` — activated by `sailor_widget: "kinetic_type"`.

**Structure:**

```
┌──────────────────────────────────────────┐
│  [live preview — looping GSAP animation] │
│          YOUR TEXT HERE                  │
├──────────────────────────────────────────┤
│  Text: [________________]               │
│  Font: [Inter ▾]  (FontPicker reused)   │
│  Axes: [wght ─●──] [wdth ─●──]         │
├──────────────────────────────────────────┤
│  Animation gallery (horizontal scroll):  │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │TypeW│ │Stgr │ │Wave │ │Scrmb│ ...   │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
├──────────────────────────────────────────┤
│  Duration: [──●──] 2.0s                 │
│  Stagger:  [──●──] 0.05s               │
│  Ease:     [elastic.out ▾]             │
│  Colors: [■ text] [■ bg] [Transparent]  │
└──────────────────────────────────────────┘
```

### Animation presets

Catalog: `frontend/app/data/kinetic-presets.ts`. Each preset is a
function `(els: SplitTextResult, tl: gsap.core.Timeline, opts) => void`
that builds the GSAP timeline.

```ts
export interface KineticPreset {
  id: string
  label: string
  pitch: string           // one-line description
  category: 'reveal' | 'loop' | 'exit'
  build: (ctx: KineticBuildContext) => void
}

export interface KineticBuildContext {
  tl: gsap.core.Timeline
  chars: HTMLElement[]     // SplitText char divs
  words: HTMLElement[]     // SplitText word divs
  lines: HTMLElement[]     // SplitText line divs
  container: HTMLElement   // root wrapper
  opts: {
    duration: number       // seconds
    stagger: number        // seconds between units
    ease: string           // GSAP ease string
  }
}
```

**Preset catalog (v1):**

| id | label | category | Behavior |
|---|---|---|---|
| `typewriter` | Typewriter | reveal | Chars appear sequentially, blinking cursor at insertion point |
| `stagger-up` | Stagger Up | reveal | Chars/words fade+translateY from below, staggered |
| `stagger-down` | Stagger Down | reveal | Mirror — from above |
| `stagger-scale` | Pop In | reveal | Chars scale from 0 → 1 with stagger |
| `elastic-drop` | Elastic Drop | reveal | Chars drop from above with `elastic.out` bounce |
| `wave` | Wave | loop | Chars oscillate Y in a sine wave, looping |
| `scramble` | Scramble Decode | reveal | `ScrambleTextPlugin` — random chars resolve to the real word |
| `blur-in` | Blur Reveal | reveal | Chars go from `filter: blur(20px)` + opacity 0 → sharp |
| `rotate-in` | Spin In | reveal | Each char rotates 360° while scaling in |
| `glitch-reveal` | Glitch | reveal | Random x-offset flicker per char, settles to position |
| `bounce` | Bounce | loop | Word(s) bounce with `bounce.out` ease, looping |
| `breathe` | Breathe | loop | Gentle scale pulse 1 → 1.05 → 1, infinite |

### Bake pipeline

1. Create an offscreen DOM container with the styled text
2. `SplitText` splits it into char/word/line elements
3. The preset's `build()` populates a `gsap.timeline()`
4. For each frame (0 .. fps × duration):
   - Seek the timeline to `frame / fps`
   - Read computed styles of each char element
   - Render to a `<canvas>` using `ctx.fillText()` per char,
     applying the char's transform/opacity/filter
5. Collect all canvases as PNG blobs
6. Upload the batch via `/upload/image`
7. Store the filenames in `widgetsValues` for the Python node to load

**Alternative (simpler, v1):** Use `html2canvas` or a DOM screenshot
approach per frame. Less precise but ships faster. Can upgrade to
per-char canvas render in v2.

**Preferred (v1 — no html2canvas dependency):** Render directly to Canvas2D.
The GSAP timeline controls *data* (x, y, opacity, scale, rotation per char);
at each frame tick we read those values and `ctx.fillText()` each glyph at
its interpolated position. This is the same approach the Font Playground
already uses for its single-frame bake — we just loop it.

### Preview

The live preview in the widget plays the GSAP animation on real DOM
elements (the `<span>` chars inside the preview area). This is instant,
no bake needed — GSAP animates the actual DOM.

On "Run" (or auto-bake after a setting change), the frame sequence is
rendered to canvas and uploaded.

---

## 2. Variable Font Animator

**Animate font axes over time.** Extends the Font Playground with a
timeline dimension.

### Node shape

Same as Kinetic Typography but with a different widget
(`sailor_widget: "font_animator"`). Could also be a mode toggle
on the same node — "Static / Animated".

### Key addition: axis keyframes

```ts
export interface AxisKeyframe {
  frame: number          // 0-based, matches the output fps
  axes: Record<string, number>   // wght, wdth, slnt, CASL, ...
  ease?: 'linear' | 'easeInOut' | string  // GSAP ease
}
```

The widget shows a mini-timeline (horizontal bar) with diamond keyframe
markers per axis. User drags them, sets values at each point.

### Bake

At each output frame:
1. GSAP-interpolate each axis value between bracketing keyframes
2. Set `ctx.fontVariationSettings` to the interpolated values
3. `ctx.fillText()` the word
4. Capture the canvas

This reuses `applyCtxFont()` from WidgetFontPlayground verbatim.

### Combinations with Kinetic Typography

These two nodes compose: wire the Variable Font Animator's output into
the Timeline alongside a Kinetic Typography clip. Or: merge both
features into one node with an "Axis animation" section beneath the
motion preset gallery.

**Recommendation:** Ship as one node. The Kinetic Typography widget
gains an optional "Axis keyframes" expander. If no axis keyframes are
set, the font stays static (back-compat with pure motion presets).

---

## 3. Text Mask node

**Use text as a clipping path for images/video.**

### Node shape

| Field | Type | Notes |
|---|---|---|
| `text` | STRING (req.) | The word(s) |
| `font` | hidden JSON | Same font state as Font Playground |
| `source` | IMAGE (opt.) | Image to show through the text. If unconnected, outputs a plain B&W mask |
| **output 0** | MASK | White text on black — the raw mask |
| **output 1** | IMAGE | Source image masked by the text (RGBA with alpha) |

### Implementation

Tiny. Canvas2D:
1. Render the text to a canvas with `fillStyle = '#ffffff'` on black bg
2. Output 0: that canvas as a grayscale mask
3. Output 1: `globalCompositeOperation = 'destination-in'` to clip the
   source image to the text shape

The font infrastructure is reused from Font Playground (including 3D
transforms — tilted text mask!).

Backend: `TextMaskNode` — loads the uploaded mask PNG.

### Toolbox entry

```ts
{ nodeType: 'TextMask', label: 'Text Mask', description: 'Use text as a mask — type shows through to the image behind it.', icon: TypeIcon }
```

Sits in the **Composite** section alongside existing mask nodes.

---

## 4. Text on Path

**Render text along a curve.**

### Node shape

| Field | Type | Notes |
|---|---|---|
| `text` | STRING (req.) | |
| `font` | hidden JSON | Font state |
| `path` | hidden JSON | Path type + parameters |
| **output** | IMAGE | Rendered text on path |

### Path types (v1)

| Type | Parameters |
|---|---|
| `arc` | radius, startAngle, endAngle |
| `circle` | radius (text wraps fully around) |
| `wave` | amplitude, frequency, phase |
| `line-curved` | bezier control points (2) |

### Widget

`WidgetTextOnPath.vue` — shows an SVG preview of the path with the
text laid along it. Path type dropdown, parameter sliders.

### Rendering

Per-character placement along the path:
1. Measure each character's width with `ctx.measureText()`
2. Walk along the path, accumulating distance
3. At each char's center position, compute the tangent angle
4. `ctx.save(); ctx.translate(px, py); ctx.rotate(tangent); ctx.fillText(char); ctx.restore()`

This is a well-known technique — no library needed, pure Canvas2D math.

### Animation (v2 — with GSAP)

Animate the text's offset along the path over time (scrolling text
around a circle, text flowing along a wave). GSAP tweens the path
offset; frame-sequence bake outputs the animation.

---

## 5. GSAP Compositor Transitions — Animated title cards & lower thirds

**New clip types for the Timeline that use GSAP to animate text in/out.**

### New clip kind: `title`

```ts
export interface TitleClip extends BaseClip {
  kind: 'title'
  text: TitleSpec
}

export interface TitleSpec {
  text: string
  font_family: string
  font_weight: number
  font_size: number        // normalized to canvas height
  color: string
  animation_in: string     // kinetic preset id
  animation_out: string    // kinetic preset id (reversed)
  hold_frames: number      // frames to hold after in-animation completes
}
```

### New clip kind: `lower_third`

```ts
export interface LowerThirdClip extends BaseClip {
  kind: 'lower_third'
  lower_third: LowerThirdSpec
}

export interface LowerThirdSpec {
  name: string            // primary text (e.g. speaker name)
  title: string           // secondary text (e.g. job title)
  style: 'bar' | 'minimal' | 'boxed'
  color: string           // accent color
  animation_in: string    // 'slide-right' | 'fade' | 'wipe'
  hold_frames: number
}
```

### Playback engine integration

The playback engine (`usePlaybackEngine.ts`) currently handles video,
image, and text clips. New clip kinds get a dedicated render branch:

```ts
if (clip.kind === 'title' || clip.kind === 'lower_third') {
  renderAnimatedTextClip(ctx, clip, localFrame, cw, ch)
}
```

`renderAnimatedTextClip` uses the kinetic preset system to compute
per-char transforms at the given frame, then draws directly to the
compositor canvas — same pipeline as the Kinetic Typography bake,
but inline during playback.

### Toolbox entries (Video domain)

```ts
{ nodeType: 'TitleClip', label: 'Title Card',
  description: 'Animated title — text animates in, holds, animates out. GSAP presets.', icon: TypeIcon },
{ nodeType: 'LowerThirdClip', label: 'Lower Third',
  description: 'Name/title bar that slides in and out — broadcast style.', icon: TypeIcon },
```

---

## 6. Lenis: Smooth-scroll canvas navigation

**UX upgrade, not a node.** Buttery momentum-based panning on the
VueFlow canvas.

### Current state

VueFlow handles pan/zoom natively via pointer events and wheel. It
works, but the deceleration is abrupt — no inertia, no momentum.

### Integration

```ts
// composables/useCanvasSmooth.ts
import Lenis from 'lenis'

export function useCanvasSmooth(vueFlowInstance: Ref<VueFlowInstance>) {
  const lenis = new Lenis({
    wrapper: vueFlowInstance.value?.vueFlowRef,
    content: vueFlowInstance.value?.vueFlowRef,
    // Lenis intercepts wheel/touch and provides smooth interpolation
    smoothWheel: true,
    lerp: 0.08,           // deceleration curve
    wheelMultiplier: 1.2,
  })

  // On each Lenis tick, update VueFlow's viewport transform
  lenis.on('scroll', ({ scroll }) => {
    vueFlowInstance.value?.setViewport({
      x: -scroll.x,
      y: -scroll.y,
      zoom: currentZoom.value,
    })
  })

  // RAF loop
  function raf(time: number) {
    lenis.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)

  return { lenis }
}
```

### Scope

- Smooth wheel scroll → pan
- Momentum-based fling (trackpad/touch)
- Optional snap-to-node (Lenis snap plugin) for canvas organization
- Pinch-to-zoom passthrough (Lenis doesn't intercept pinch)

### Risk

Lenis was designed for page scroll, not canvas viewport transforms.
May need a thin adapter or custom Lenis instance. If it fights
VueFlow's built-in pan handler too much, the fallback is a lightweight
custom momentum implementation using GSAP's `InertiaPlugin` instead:

```ts
gsap.to(viewport, {
  x: targetX, y: targetY,
  inertia: { x: velocityX, y: velocityY },
  ease: 'power2.out',
})
```

This is actually simpler and avoids the Lenis-vs-VueFlow conflict.
**Recommendation: GSAP InertiaPlugin over Lenis for canvas momentum.**

---

## Build order

```
Phase 1 (ship together — they share 90% of the infrastructure):
  [1] Kinetic Typography node
  [2] Variable Font Animator (as axis-keyframes section in the same node)
  [3] Text Mask node (small, reuses the same font pipeline)

Phase 2:
  [4] Text on Path
  [5] GSAP Compositor Transitions (title cards + lower thirds)

Phase 3:
  [6] Smooth canvas navigation (GSAP InertiaPlugin)
```

## Shared infrastructure

All typography nodes share:

| Piece | Already exists | New |
|---|---|---|
| Variable font loading | `WidgetFontPlayground` | reuse |
| Font axis control UI | `WidgetFontPlayground` | reuse |
| Canvas text rendering | `applyCtxFont()` | reuse |
| 3D transform (tilt/skew) | `textWarp.ts` | reuse |
| Font Picker (variable + Google) | `FontPicker.vue` | reuse |
| Google Font catalog | `google-fonts.ts` | reuse |
| Upload baked PNG | `/upload/image` pipeline | reuse |
| SplitText per-char decomposition | — | **new** |
| Kinetic preset catalog | — | **new** |
| Per-char canvas renderer | — | **new** |
| Frame-sequence batch upload | — | **new** |
| Axis keyframe mini-timeline | — | **new** |

## File plan

```
frontend/app/data/kinetic-presets.ts              # preset catalog
frontend/app/composables/useKineticRenderer.ts    # SplitText → GSAP → Canvas bake
frontend/app/components/vue-canvas/widgets/
  WidgetKineticType.vue                           # the main widget
  KineticPresetGallery.vue                        # horizontal-scroll gallery cards
  AxisKeyframeEditor.vue                          # mini-timeline for font axis animation
frontend/app/utils/textOnPath.ts                  # path math for node #4
frontend/app/utils/textMask.ts                    # mask bake for node #3
comfy_api_nodes/nodes_kinetic_type.py             # Python node (loads uploaded frames)
comfy_api_nodes/nodes_text_mask.py                # Python node (loads uploaded mask)
comfy_api_nodes/nodes_text_on_path.py             # Python node (loads uploaded render)
```
