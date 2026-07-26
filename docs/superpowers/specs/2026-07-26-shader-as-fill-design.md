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

Shape Studio costing nothing is the factory result — evidence that the single door is real.
Scene3D costing something is the *more interesting* result: it does not consume `Fill` or
`FILL_TYPES` at all, so it proves the reusable unit is the **field module**, not the fill
vocabulary. Two different reuse seams sharing one core.

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

1. **The readback is unmeasured.** A half-day spike goes first in the implementation plan: can a
   512² animated field hold 30fps alongside a Space Type render? If not, the batching assumption
   is wrong and C moves back into act 1, roughly doubling it.
2. **The 28-shader `uFillAnchor` change** is the largest chunk. It is mechanical rather than a
   design problem, and is good parallel subagent work — but it is 28 files touching live visual
   output, so golden coverage matters before it starts.
3. **Recursive fill persistence** touching every fill serialisation site is the most likely
   source of a subtle regression in surfaces not otherwise part of this act.
