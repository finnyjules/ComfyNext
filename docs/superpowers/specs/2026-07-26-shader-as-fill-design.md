# Shader as Fill — design

**Date:** 2026-07-26
**Status:** Design approved, awaiting spec review
**Thesis link:** Absorption-factory act. See `docs/VISION.md` and the technology-factory thesis.

## The idea in one line

A shader stops being a full-frame *layer* stacked above the composition and becomes a
**material you can pour into anything** — a glyph, a shape, a brush stroke, a 3D surface.

## Why this act, and why now

Sailor's named bottleneck is the cost of absorbing the next creative technology. This act
absorbs nothing new — it multiplies what is already absorbed. The 63-effect shader catalog
currently reaches exactly one surface (Shader Studio) in exactly one way (full frame). Making
a shader a legal *fill* multiplies that catalog across every fillable surface in the product.

The insight that makes it cheap: **this is not a GL problem, it is a `FillType` problem.**
Every target already knows how to produce an alpha mask and pour something into it. The
shader simply is not a legal thing to pour.

Evidence in the codebase:

- `frontend/app/lib/spacetype/fillTile.ts:10` — `FILL_TYPES` carries the comment
  *"SINGLE SOURCE OF TRUTH — imported by every fill dropdown."*
- `frontend/app/lib/spacetype/fills.ts:74` — `fillShaderTexture()` already resolves **every**
  fill to a texture (a solid colour becomes a 1×1 swatch).
- ~28 Space Type effects already declare `uniform sampler2D uFill` plus a `fillColor()`
  helper — e.g. `frontend/app/lib/spacetype/effects/shutter.ts:113,119,134`.
- `frontend/app/composables/useCompositorLayers.ts:571` — `resolvePaint()` is the single
  funnel for rect (`:1104`), ellipse (`:1112`), line (`:1135`), brush (`:1171`),
  text fill and stroke (`:1219,:1221`), expressive text (`:1292,:1294`), path
  (`:1339,:1344`), and the frame background itself (`:1429`). Polygon and star delegate
  to `drawPath`.
- `frontend/app/lib/scene3d/materials.ts:391` — the `image` material kind already assigns
  a user-content texture to `t.map`.

## Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| Liveness | **Alive from the start** | Fill advances with the host's clock, not a static tile |
| Anchoring | **Both, as one control** (Scene3D: `object` only) | `object` is free; `frame` costs a UV convention across ~28 shaders |
| Shader input | **The existing fill, post-processed** | `Fill` becomes recursive; catalog × fill vocabulary is multiplicative |
| Surface scope | **Space Type, Shape Studio, frames, Scene3D (object-anchor)** | Four consumers, two distinct reuse seams |
| Renderer strategy | **A (readback bridge) + descriptor batching** | One shader implementation; C deferred |

### On the renderer strategy

Three options were weighed:

- **A — readback bridge.** `shaderFx` stays the single shader authority; its canvas is blitted
  into a per-field canvas and uploaded as a texture. One implementation, parity by construction.
- **B — reimplement the shader path inside THREE.** Fastest, but a second implementation of pass
  expansion, ping-pong, `u_source` capture and blend compositing. **Rejected** — this is exactly
  the render-parity drift the codebase has been bitten by before.
- **C — make `shaderFx` context-agnostic.** A class bound to a caller-supplied
  `WebGL2RenderingContext`, so THREE surfaces render fills with no readback at all.

**A is chosen for act 1, with C named as the sequel.** Two findings drove this:

1. The Compositor is Canvas2D. A readback is *inherent* there — C would not have avoided it.
   What avoids cost is batching by descriptor, not by consumer.
2. `three` is pinned at `0.171.0`, which has no `ExternalTexture`. C would require private-API
   texture wrapping (`renderer.properties.get(tex).__webglTexture`) or a three upgrade.

C becomes forced the moment the per-frame field budget is genuinely exceeded. It is not
speculative work — it directly dissolves the "five independent WebGL contexts, no shared
texture pipeline" wall that constrains every future absorption.

## Architecture

### 1. A new fill type, and it nests

`FILL_TYPES` gains one entry, `'shader'`:

```ts
type ShaderFill = {
  type: 'shader'
  input: Fill              // any NON-shader fill — depth-1, enforced
  effectId: string         // from the existing shaderfx catalog
  params: Record<string, number>
  anchor: 'object' | 'frame'
  speed: number            // time multiplier; 0 freezes the field
}
```

`Fill` becoming recursive is what makes `gradient → kaleidoscope` expressible. The **depth-1
guard** is enforced at both the type level and at runtime: `input` must not itself be a shader
fill. Without it, a 40-deep stack hangs the renderer.

### 2. One module owns all the pixels — `lib/shaderfill/`

The only place in the product that knows how to turn a `ShaderFill` into pixels.

```
fieldKey(fill, w, h, tQuantum) -> string
resolveField(fill, w, h, t)    -> HTMLCanvasElement
```

Backed by an LRU keyed on descriptor. Animated entries are evicted per frame; static entries
are retained.

**The batching rule is the load-bearing part of this design: fields are keyed by descriptor,
not by consumer.** Ten shapes in a frame sharing one shader fill trigger one `shaderFx.render()`
and one readback. This is what makes "alive everywhere" affordable, and it is why the
Compositor's per-shape tile cache (`useCompositorLayers.ts:601`) is *replaced* by a lookup into
the field cache rather than gaining a time key. That cache keys on
`type|a|b|angle|density|WxH` with no time component and clears wholesale at 64 entries — an
animated fill would miss every frame and evict every other layer's tile on the way past.

### 3. Four consumers, two reuse seams

| Surface | Hook | Work |
|---|---|---|
| Space Type | `fills.ts:74` `fillShaderTexture()` | new branch → `CanvasTexture`, `needsUpdate` per frame |
| Shape Studio | `shapefx/surface.ts:23` `buildSurfaceTexture()` | **none** — already delegates to Space Type's `fillTexture()` |
| Frames | `useCompositorLayers.ts:610` `resolveFill()` | new branch → field canvas → `createPattern` + `DOMMatrix` |
| Scene3D | `scene3d/materials.ts:391` `materialFor()` | new material case → `t.map` = field texture, plus `updateMaterial()` |

Scene3D costing something is the *more interesting* result: it does not consume `Fill` or
`FILL_TYPES` at all, so it proves the reusable unit is the **field module**, not the fill
vocabulary. Two different reuse seams sharing one core.

> **CORRECTED 2026-07-26 — "Shape Studio costs nothing" was wrong, and the way it was wrong
> matters more than the correction.**
>
> Shape Studio cost **three small changes**, not zero: `SurfaceFill` (`shapefx/config.ts:54`)
> is a *narrower* type than `Fill`, and `toFill()` (`shapefx/surface.ts:11`) rebuilds a `Fill`
> field by field — so `shader` was silently dropped, and `shader` was also missing from the
> persistence whitelist. The fix was one schema field, one propagation line, one whitelist
> entry.
>
> **The single door is real only for surfaces that consume `Fill` directly.** Wherever a
> surface keeps its own projection of a fill, adding a fill type costs a few lines there too.
> That is still cheap and still supports the thesis — the seam held, the work was trivial — but
> the honest claim is "nearly free where a surface reuses `Fill`, plus a line per surface that
> re-models it", not "free".
>
> **Why it looked like a pass: the graceful fallback disguised the failure.** A shader fill
> whose spec cannot be read degrades to rendering its input fill — the safety behaviour
> deliberately built in Task 1. So selecting "shader" in Shape Studio rendered a plausible
> gradient, and visual inspection read that as success. It was the fallback working perfectly,
> hiding the fact that the shader path was never reached.
>
> **Generalise this: on any feature with graceful degradation, "I looked at it and it worked"
> is not evidence.** A verification must distinguish *working* from *falling back* — assert the
> renderer was actually invoked, or diff pixels across time (a static image proves the field
> never animated). The eventual proof here was 10,131 of 16,384 sampled pixels differing
> between t=0 and t=2.5.
>
> Still missing in Shape Studio: any picker UI for choosing the effect and params. The fill
> type is selectable and the data now flows and persists, but authoring it is Task 9's job.

### 4. Anchor is a transform, not a renderer

- **`object`** — field rendered at the consumer's box size, pattern fitted to the box. This is
  the existing `setTransform` behaviour at `useCompositorLayers.ts:625`.
- **`frame`** — field rendered once at frame size, pattern transformed into frame space, so every
  shape samples the same field and becomes a window onto it.

In frames this is purely a matrix change. In Space Type it is not free: the ~28 effect shaders
each declare their own `fillColor()` sampling `uv * uFillTiling`
(`lib/spacetype/effects/shutter.ts:134`). Frame-anchor needs a `uFillAnchor` uniform and a
screen-space UV branch in each. **Mechanical, 28 files, the single largest chunk of work in the
act.** Suitable for parallel subagents.

Scene3D ships **object-anchor only**. Frame-anchor there would need `onBeforeCompile` shader
injection rather than a texture assignment (the pattern exists — see how `fresnel` is built at
`scene3d/materials.ts:330`), and is deferred.

Scene3D materials are lit, so a shader fill assigned to `map` is shaded by scene lights.
An **unlit toggle** is in scope so the field can also glow flat.

### 5. Time

Time comes from each host's existing clock — Space Type's effect time, the Compositor playhead
(`CompositorModal.vue:1475`), the Scene3D loop (`Scene3DStudioSurface.vue:835`). It is
**quantised before reaching `fieldKey`**, so two consumers rendering the same frame hit the same
cache entry.

The quantum is **the host's own frame interval**, not a fixed constant: 1/30s during live
playback, and `1/fps` of the bake during a bake. Fixing it at 1/30 would silently drop a
60fps bake to 30 distinct fields per second and stutter the fill relative to everything else
in the frame.

Live playback caps fields at 512²; bake renders at full size. This preview/bake split already
exists throughout Sailor.

## Authoring and schema

### Where the user meets it

Because the fill dropdowns share one source, `shader` appears in all of them at once. Selecting
it reveals: an **effect picker** (reusing the existing CatalogModal), the effect's **own params**,
**anchor**, **speed**, and the nested **input fill** — the existing fill editor rendered one
level down. That nesting is the only genuinely new UI; everything else is existing controls
pointed at a sub-object.

### Dynamic params vs frozen keys — "declare the frame, derive the contents"

`lib/gradientfx/controls.ts:5-24` establishes that control keys are **frozen**, because
Collection bindings persist `params.<key>`. But shader fill params are dynamic — 63 effects,
each with a different param list. You cannot freeze what you do not know.

Shader Studio already answered this: `lib/shaderstudio/agentControls.ts:21` builds `ControlSpec[]`
**imperatively from the live `EffectDef.params`** rather than declaring them. Shader fills adopt
the same pattern under a stable namespace:

```
fill.shader.effectId      <- declared, frozen
fill.shader.anchor        <- declared, frozen
fill.shader.speed         <- declared, frozen
fill.shader.p.<paramId>   <- derived per effect
```

The three declared keys are frozen and safe for Collection bindings. The derived keys are stable
*per effect* and change when the effect changes — inherent, not a defect.

This is the first place the control schema meets genuinely dynamic vocabulary. The answer —
**declare the frame, derive the contents** — is a pattern every future absorbed library will
need, and is the main architectural output of this act beyond the feature itself.

### What comes free, and what does not

Space Type and Shape Studio route through `ControlSpec` with opt-out semantics, so these entries
get agent vocabulary, motion tracks, and Collection bindings **automatically**.

**Scene3D gets none of it.** It exposes no control descriptors and is agent-invisible, so its
shader-fill controls are hand-wired and unreachable by the agent. This asymmetry is stated here
deliberately rather than discovered during implementation.

The inspector UI is **not** auto-derived from `ControlSpec` — `lib/gradientfx/controls.ts:9-11`
notes it is still hand-written, and it stays hand-written in this act.

### Two kinds of motion, both real, and they compose

1. **Intrinsic** — `u_time` advances so the field itself is alive. Controlled by `speed`.
2. **Param animation** — the motion system animates e.g. `fill.shader.p.segments` over the
   timeline. Free, provided the derived specs are marked animatable.

## Persistence and render parity

`Fill` becoming recursive means every site that serialises a fill must round-trip one level of
nesting. The `studioTune` / `sailor_localFx` round-trip failure is the precedent: a fill that
survives the inspector but not a reload is the classic form of this bug.

Bake parity is structural rather than disciplinary: bake calls the **same** `resolveField` with
the same quantised time, only at full resolution instead of 512². There is no second code path
available to drift.

## Failure handling

Graceful degradation is free, because a shader fill always wraps a real fill. Every failure path
falls back to rendering `input` alone:

- unknown `effectId` (the catalog re-reads from disk per request, so effects can vanish)
- WebGL context loss
- a param that no longer exists on the selected effect

The user sees a gradient instead of a warped gradient — never an empty shape.

**Two guards:**

- **Depth-1**, enforced at type and runtime.
- **Live field ceiling** — at most 4 distinct live fields **per host surface, per rendered
  frame** (distinct meaning distinct descriptor, so ten shapes sharing one fill count as one).
  Beyond the ceiling, extra fields freeze at `t=0` **with a visible hint**. Never silent:
  silent truncation reads as "it is working" when it is not.

## Testing

- Unit — `fieldKey` stability, LRU eviction under animation, the depth-1 guard.
- Unit — **recursive fill round-trip through save/reload**. Most likely of these to catch a real bug.
- Golden images per surface. **Caveat:** the `crystal_prism` and `oil_paint` goldens are already
  broken, so the suite is not a green baseline and must not be treated as one.
- An exact-order test for the new control sections, following the Type Studio panel-reorg precedent.

## Explicitly out of scope for act 1

- Approach C (context-agnostic `shaderFx`) — named sequel, not this act.
- Frame-anchor in Scene3D (`onBeforeCompile` injection).
- Nesting beyond depth 1.
- Wired-image input to a shader fill.
- Auto-deriving inspector UI from `ControlSpec`.

## Risks

1. ~~**The readback is unmeasured.**~~ **MEASURED 2026-07-26 — gate PASSED.** Bench at
   `/dev/shaderfill-bench`, 60 forced-sync iterations per field count (`getImageData(0,0,1,1)`
   after each blit, `gl.finish()` after each render), across a separate `THREE.WebGLRenderer`
   so the real cross-context handoff is reproduced. Three sweeps:

   | fields | run 1 | run 2 | run 3 | ms/field |
   |---|---|---|---|---|
   | 0 (baseline) | 0.09 ms | 0.02 ms | 0.02 ms | — |
   | 1 | 1.97 ms | 3.46 ms | 1.65 ms | 1.6–3.4 |
   | 2 | **2.96 ms** | **6.75 ms** | **2.82 ms** | 1.4–3.4 |
   | 4 | 5.03 ms | 12.73 ms | 5.12 ms | 1.2–3.2 |
   | 8 | 10.04 ms | 28.65 ms | 10.21 ms | 1.2–3.6 |

   **Pass condition was 2 distinct 512² fields under 33 ms; observed 2.8–6.8 ms — a 5–12×
   margin.** Cost is linear in field count and almost entirely the blit, as predicted. Runs 1
   and 3 agree at ~1.25 ms/field; run 2 is a transient outlier (~3.4 ms/field) attributable to
   GPU contention — duplicate dev servers and parallel sessions were live.

   **This confirms `LIVE_FIELD_CEILING = 4` rather than raising it.** Against the *worst*
   observed 3.6 ms/field, 4 fields costs ~14 ms — under half a 30 fps frame, leaving room for
   the surface's own render. 8 fields would be 10 ms typical but **28.65 ms worst**, which
   consumes nearly the entire frame budget on fills alone. The rule for re-deriving on other
   hardware: keep live fields under one third of the 33 ms budget at the *worst* observed
   per-field cost, not the median.

   Verified by content probe (`window.__benchProbe()`) that the pipeline is not short-circuited:
   the blitted canvas has full tonal spread (0–255), 100% opacity, and a mean that differs from
   the input fill's, so the shader transforms rather than passes through. This mattered — the
   cost is dominated by the blit, and a blit of a blank canvas costs exactly the same, so the
   timings alone could not distinguish a working pipeline from a silently empty one.

   Two false starts worth recording: the first bench timed CPU submission around asynchronous
   GPU calls and derived fps as `1000/cpuMs`, reporting an impossible 0.09 ms readback; the
   rAF-based rewrite that fixed it was unreadable because a hidden browser pane pauses
   `requestAnimationFrame` entirely, so every readout sat at 0.00.

   **RE-MEASURED 2026-07-26 through the real `resolveField` path (Task 3).** The figures above
   were taken against a direct `shaderFx` harness. Measured through the actual field module,
   with a consumer binding the returned canvas directly as a texture source (no copy):

   | fields | ms/iteration | ms/render | renders |
   |---|---|---|---|
   | 1 | 3.52 ms | 3.52 | 50 |
   | 2 | **7.55 ms** | 3.77 | 100 |
   | 4 | 15.35 ms | 3.84 | 200 |
   | 8 | 18.37 ms | 4.10 | 224 |

   **Per-render cost is ~3.8 ms — roughly 3× the 1.25 ms typical above, and just above the
   3.6 ms worst previously observed.** It is now essentially flat across field counts (16%
   spread, versus 160% before the redundant-copy fix), which is the signal that the remaining
   cost is per-render work rather than an accumulating overhead.

   **The gate still passes with room: 2 fields = 7.55 ms against 33 ms, a 4.4× margin.**

   `LIVE_FIELD_CEILING` stays 4 **but now sits at the boundary rather than comfortably inside
   it** — 4 fields is 15.35 ms, just under half a 30 fps frame. Two reasons not to lower it to
   3 yet: the bench renders N textured quads and performs N texture uploads *in the harness
   itself*, which a real surface does not do per fill, so this figure overstates a real
   consumer's cost by an unknown amount; and Tasks 4 and 6 measure against actual surfaces,
   where that overhead disappears. **Re-derive the ceiling there, against a real consumer, not
   against this harness.**

   Three separate too-good-to-be-true numbers were traced to missing GPU syncs during this
   work, the last being that `renderer.getContext().finish()` syncs only three.js's context and
   **not** `shaderFx`'s separate one. Any future measurement here must force a readback on
   `resolveField`'s own canvas, or it is timing command submission.

   Not indicated on this evidence: approach C. The readback is bounded, linear, and the gate
   passes 4.4×. C becomes the answer if a real surface in Task 4/6 confirms ~3.8 ms/render
   *without* the harness overhead, which would put a 4-field frame at half its budget on fills.

   **MEASURED ON A REAL SURFACE (Task 4) — the harness was overstating, and the ceiling is
   comfortable after all.** A live Space Type node, turntable effect, forced-sync measurement:

   | shader fills on the node | cost per frame |
   |---|---|
   | 1 | **1.35 ms** |
   | 2 | **2.99 ms** |

   That is roughly **a third** of the bench's 3.2–4.1 ms per render, confirming the suspicion
   that the harness's own N textured quads and N texture uploads — work no real surface does
   per fill — were inflating the figure. At ~1.4 ms per fill, `LIVE_FIELD_CEILING = 4` costs
   about 6 ms of a 33 ms frame rather than the 13–15 ms the bench implied. **The ceiling stays
   at 4 and is no longer boundary-tight.** Approach C is not indicated; this closes that
   question rather than deferring it again.

   Prefer these numbers over the bench's when reasoning about cost. The bench remains the right
   tool for *comparative* work (regimes, batching, cache behaviour) but overstates absolute
   per-fill cost by roughly 3×.
2. **The 28-shader `uFillAnchor` change** is the largest chunk. It is mechanical rather than a
   design problem, and is good parallel subagent work — but it is 28 files touching live visual
   output, so golden coverage matters before it starts.
3. **Recursive fill persistence** touching every fill serialisation site is the most likely
   source of a subtle regression in surfaces not otherwise part of this act.
