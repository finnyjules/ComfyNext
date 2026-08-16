# Gradient Studio — Curve-Following Gradient

**Date:** 2026-08-16
**Status:** Design approved, ready for planning

## Plain-language summary

Gradient Studio has plain Linear, Radial and Conic gradients. This adds a fourth
simple primitive: a gradient that **follows a bezier curve**. Two looks from one
layout, chosen by a toggle:

- **Along** — the gradient runs *along* the curve. Stop 0 at the curve's start,
  stop 1 at its end, the ramp snaking down the path. A linear gradient with a
  bent axis.
- **Outward** — the gradient runs *outward* from the curve. Stop 0 sits on the
  curve itself, later stops fade outward to the sides — a glowing ribbon.

The whole point is that **the AI can control the curve**. So the curve is not a
free-form bezier blob (which a model can't reliably emit) — it's fully
**parametric**: the agent picks a shape (line / arc / s-curve / wave / loop) and
turns a few dials (endpoints, curvature, bend, waves, phase). Those parameters are
the single source of truth, from which the agent vocabulary, motion tracks and the
inspector all derive — the same factory pattern every other control uses. Humans
can also drag the curve directly on the preview; each handle writes back to a dial,
so the curve stays parametric no matter who edits it.

## Goals

1. A new `curve` layout with an **Along ↔ Outward** mode toggle.
2. The curve is fully parametric and **agent-legible** (preset shape + numeric dials).
3. Motion animates the curve (endpoints, curvature, phase, width) for free.
4. On-preview direct manipulation via draggable start / end / curvature handles.
5. Repeat + Falloff (the universal simple-primitive controls) apply here too.

## Non-goals

- Free-form multi-point path editing with arbitrary node counts. The curve is a
  single parametric shape between two endpoints; presets supply the wiggle. (The
  polyline the shader consumes can have many points, but they are *derived*, never
  hand-placed.)
- A distinct per-side ramp for Outward mode (both sides share one symmetric ramp).
- Reusing `canvas.center` — the curve carries its own endpoints.

## Architecture

`curve` is a new `LayoutKind` (shader index 9, label "Curve"), a **simple
primitive** like ramp/radialRamp/conic. It inherits the whole studio — layers,
the ramp editor, posterize/hue, Flow warp, the shared post stack, motion, agent
vocabulary, PNG/SVG/video export, embeds — by being a layout.

The core mechanism (recommended approach A of three considered; the analytic-SDF
and CPU-rasterized-field alternatives were rejected for GLSL cost / per-frame
re-rasterization respectively):

1. **CPU** flattens the parametric curve to a short polyline with cumulative
   arc-length (`buildCurvePolyline`, the pure twin of `buildField`).
2. That polyline is uploaded **as a per-layer data texture** via the *existing*
   `TEXTURE_2D_ARRAY` field-upload path — NOT a uniform array (≈40 points × 6
   layers would blow the fragment-uniform ceiling).
3. **Shader** does a per-pixel nearest-segment search over the texture, yielding
   `s` (arc-length param of the nearest point, 0→1) and `d` (distance to the
   curve). Along uses `s`; Outward uses `clamp(d / width, 0, 1)`.
4. Both feed the **same** `applyRepeat → falloff → quantize → sampleRamp → rotateHue`
   chain as the other simple primitives.

### 1. Types (`types.ts`)

```ts
export type LayoutKind =
  | 'ramp' | 'radialRamp' | 'conic' | 'curve'          // curve is NEW
  | 'linear' | 'radial' | 'orbit' | 'stack' | 'liquid' | 'mesh'

export type CurveShape = 'line' | 'arc' | 's-curve' | 'wave' | 'loop'
export type CurveMode = 'along' | 'outward'

export interface Vec2 { x: number; y: number }

/** Per-layer parametric curve. Optional for back-compat; a layer without it uses
 *  CURVE_DEFAULTS. Fully parametric — the polyline the renderer builds is derived,
 *  never stored. Coords are normalized frame space, 0..1 (0,0 = top-left). */
export interface CurveConfig {
  start: Vec2                 // curve start endpoint
  end: Vec2                   // curve end endpoint
  shape: CurveShape           // wiggle pattern between the endpoints
  curvature: number           // bow amount, 0..1 (0 = straight chord)
  bend: number                // bow side / rotation, -1..1
  waves: number               // oscillation count (wave preset), 1..8
  phase: number               // wave phase, 0..1
  mode: CurveMode             // along | outward
  width: number               // outward glow reach, 0.02..1 (frame fraction)
}

export const CURVE_DEFAULTS: CurveConfig = {
  start: { x: 0.2, y: 0.5 }, end: { x: 0.8, y: 0.5 },
  shape: 'arc', curvature: 0.4, bend: 1, waves: 3, phase: 0,
  mode: 'along', width: 0.35,
}
```

`LayerConfig.curve?: CurveConfig`. `LAYOUT_LABELS.curve = 'Curve'`. `curve` added
to `LAYOUTS` and `LAYOUT_IDX` (index 9). `ensureConfigDefaults` backfills `curve`
on a curve-layout layer 0 (same shape as the existing `ramp` backfill).

### 2. Curve polyline (`curvePath.ts` — new module)

```ts
export const CURVE_SAMPLES = 40          // polyline point count
export interface CurvePolyline { pts: Float32Array; len: Float32Array; n: number }
// pts = [x0,y0, x1,y1, …] normalized; len = cumulative arc-length normalized 0..1
export function buildCurvePolyline(c: CurveConfig): CurvePolyline
```

Pure + deterministic. Builds control points from `shape` + endpoints + dials, then
samples `CURVE_SAMPLES` points along the resulting path and accumulates normalized
arc-length. Preset patterns:
- `line` — straight chord (curvature ignored).
- `arc` — single-bow cubic; `curvature`×`bend` sets the perpendicular midpoint offset.
- `s-curve` — two opposing bows (cubic with mirrored control offsets).
- `wave` — `waves` sine periods across the chord; `curvature` = amplitude, `phase` = offset.
- `loop` — a closed-ish teardrop (endpoints near each other, a loop between).

### 3. Curve texture upload (`renderer.ts`)

A second per-layer `TEXTURE_2D_ARRAY` `this.curveArrayTex` + `uploadCurve(gl, i, poly)`,
modelled verbatim on the existing `uploadField`/`fieldArrayTex`. Each layer's curve
is an `N×1` RGBA texture: R=x, G=y, B=cumLen, A=1. Plus per-layer scalar uniforms
`u_curveN[LAYER_MAX]`, `u_curveMode[LAYER_MAX]`, `u_curveWidth[LAYER_MAX]` uploaded
in the same `arr(...)` block as the ramp uniforms. `LAYOUT_IDX` gains `curve: 9`.

### 4. Shader branch (`shaders.ts`)

Inside the existing simple-primitive block (`if (u_layout > 5.5)`), the trailing
`else` (currently conic) splits:

```glsl
} else if (u_layout < 8.5) {            // conic — unchanged
  … existing conic …
} else {                                // curve (9)
  // p is v_texCoord (0..1); curve texels are stored in the SAME 0..1 space
  // (see the Y-convention note in Risks — the upload flips to match).
  float bestD = 1e9; float bestS = 0.0;
  int n = int(u_curveN[i] + 0.5);
  vec2 prev = curveTexel(i, 0).xy;      // helper: sample u_curves layer i, texel k
  float prevL = curveTexel(i, 0).z;
  for (int k = 1; k < CURVE_MAX; k++) {
    if (k >= n) break;
    vec4 cur = curveTexel(i, k);
    vec2 a = prev, b = cur.xy;
    vec2 ab = b - a; vec2 ap = p - a;
    float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    vec2 proj = a + ab * t;
    vec2 dd = proj - p; dd.x *= u_aspect;        // aspect-correct distance
    float dist = length(dd);
    if (dist < bestD) { bestD = dist; bestS = mix(prevL, cur.z, t); }
    prev = b; prevL = cur.z;
  }
  float t;
  if (u_curveMode[i] < 0.5) t = bestS;                          // along
  else                      t = clamp(bestD / max(u_curveWidth[i], 1e-3), 0.0, 1.0); // outward
  t = applyRepeat(t, u_repeat[i], u_repeatCount[i]);
  t = clamp(t, 0.0, 1.0);
  t = quantize(t, u_steps[i]);
  vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
  return vec4(col, 1.0);
}
```

`CURVE_MAX` = `CURVE_SAMPLES` (40) as a compile-time `#define` (WebGL2 loop bound
must be constant; `n` gates the real length). `curveTexel(i,k)` samples the curve
`TEXTURE_2D_ARRAY` at layer `i`, texel `k` (mirrors `sampleField`).

### 5. Controls (`controls.ts`)

`curve` joins `isSimple` (Repeat/Falloff apply) but NOT `isBanded` and NOT
`usesCenter`. New `'Curve'` group, all `ControlSpec`s so agent + motion + inspector
derive together:

| key | kind | range / options | `when` |
|---|---|---|---|
| `layer.curve.mode` | select | along / outward | curve |
| `layer.curve.shape` | select | line/arc/s-curve/wave/loop | curve |
| `layer.curve.start.x` / `.start.y` | slider | 0–1 | curve |
| `layer.curve.end.x` / `.end.y` | slider | 0–1 | curve |
| `layer.curve.curvature` | slider | 0–1 | curve (shape≠line) |
| `layer.curve.bend` | slider | -1–1 | curve (shape≠line) |
| `layer.curve.waves` | slider | 1–8 | curve (shape=wave) |
| `layer.curve.phase` | slider | 0–1 | curve (shape=wave) |
| `layer.curve.width` | slider | 0.02–1 | curve (mode=outward) |
| `layer.curve.handles` | curveHandles | — (renders overlay) | curve |

`'Curve'` is inserted into `GRADIENT_SECTIONS` after `'Gradient'`. `isSimple`
extends to include `curve`.

### 6. On-preview editor (`CurveEditor.vue` + `curveHandles` ControlSpec kind)

A new `'curveHandles'` kind in the `ControlSpec` union (mirrors how Loft added
`profileStops`), rendered by `CurveEditor.vue` — an overlay reusing the canvas-rect
mapping from `StringPathEditor`/`LoftSpineEditor` (pointer-events-none root + auto
children per [[canvas-overlay-pointer-events]]). Three handles:
- **start** → writes `curve.start.{x,y}`
- **end** → writes `curve.end.{x,y}`
- **curvature** at the chord midpoint → its perpendicular offset from the chord
  writes `curve.curvature` (magnitude) + `curve.bend` (sign).

Every drag writes a parametric dial through the studio's existing edit path, so the
curve is always parametric. Shape / waves / phase / mode / width remain panel dials.

### 7. Surface (`GradientStudioSurface.vue`)

An `isCurve` computed; a `Curve` `StudioSection` (visible when `isCurve`) with the
mode + shape selects, the endpoint/curvature/bend/waves/phase/width sliders, and the
`CurveEditor` overlay mounted over the preview. Follows the Task-6 `onRamp`/`onColor`
helper pattern for writes.

## Data flow

```
GradientConfig (layer.curve params)
  → ensureConfigDefaults (backfills curve block)
  → buildCurvePolyline(curve)  [pure]  → {pts, len, n}
  → renderer uploadCurve → per-layer u_curves TEXTURE_2D_ARRAY + u_curveN/Mode/Width
  → shaders.ts curve branch: per-pixel nearest-segment → (s, d) → mode select
    → applyRepeat → falloff-LUT → quantize → sampleRamp
  → same composite / post / focus pipeline as every layout
```

Motion, agent, SVG export, embeds derive from the `ControlSpec` list + the `layout`
key with no bespoke wiring.

## Testing strategy

The known trap: a fallen-through branch still renders *a* gradient, so proof is
**differential**, per [[graceful-fallback-hides-integration-failure]].

**Unit (pure, no GL):**
- `buildCurvePolyline`: endpoints hit exactly (`pts[0..1]==start`, `pts[last]==end`);
  arc-length monotonic non-decreasing, `len[0]==0`, `len[n-1]==1`; `line` preset is
  collinear (cross-product ≈ 0 for all points); `wave` with `waves=N` has N
  cross-axis sign changes; `curvature=0` collapses arc/s-curve to the straight chord;
  `bend` sign flips the offset side.
- Handle→dial round-trip: a curvature-handle offset maps to `(curvature, bend)` and
  back to the same on-screen point.
- `ensureConfigDefaults` backfills `curve` on a curve layout, leaves an explicit
  curve untouched, and does NOT add it to non-curve layouts.
- `visibleGradientControls`: curve exposes the Curve group + Repeat/Falloff, NOT
  Shape/Relief/Margin/Center.
- `LAYOUT_LABELS` completeness (10 keys); `buildGradientPreset('linear')` still stripe.

**Differential (live `/dev/gradient-harness`, extend `__sailorLayoutProbe`):**
- Branch reached: `curve` render ≠ `ramp` render at the same palette.
- Along bends: with a bowed arc, iso-`t` bands are curved — the gradient axis is not
  straight (a mid-frame row's `t` is non-monotonic where the curve doubles back);
  `curvature 0` ≈ the Linear ramp along the chord (broken-control check).
- Outward symmetric: mirror-of-curve pixels share `t`; `width→small` collapses the
  frame toward the last stop, `width→large` toward stop 0 near the curve.
- Endpoint move relocates the gradient (moving `start` shifts where stop 0 lands).
- Repeat/Falloff still act (tile → multiple cycles along/outward).

## Risks & mitigations

- **Uniform-count blow-up** — the polyline MUST ride a per-layer texture (like the
  field), not a uniform array. Covered by reusing `uploadField`'s exact pattern.
- **Branch ordering** — curve (9) must be caught by an explicit `else` after the
  conic `< 8.5` test inside the simple block, or it renders as conic. Covered by the
  not-identical-to-ramp render test.
- **Constant loop bound** — WebGL2 requires `CURVE_MAX` constant; `u_curveN` gates
  the real length. Documented in the shader.
- **Aspect correction** — distance must aspect-correct (`dd.x *= u_aspect`) or the
  glow is oval on non-square frames; the arc-length param must not (it's along-curve).
  Called out in the branch.
- **Handle↔dial fidelity** — dragging must not drift the curve off-parametric; the
  round-trip unit test pins it.
- **Y convention mismatch** — the on-preview editor stores points in canvas
  convention (y=0 TOP, like `StringPathEditor`), but the shader's `v_texCoord` has
  y=1 at the visual TOP ([[shader-studio-expansion-landed]] double-flip). So the
  curve texture upload MUST flip Y (`y → 1 - y`) once, at `uploadCurve`, so stored
  points, the editor overlay, and the rendered gradient all agree. A single
  flip-site keeps it from being applied zero or two times; a live check (drag the
  start handle to the visual top-left, confirm stop 0 lands top-left) catches it.
```
