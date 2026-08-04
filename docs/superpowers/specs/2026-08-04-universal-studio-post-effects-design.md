# Universal studio post-effects

**Date:** 2026-08-04
**Status:** Design approved, not implemented

## Problem

The post-effects panel in 3D Studio — ambient occlusion, bloom, colour, chroma, lens
blur, film, halftone, dot screen, glitch — is implemented as a three.js
`EffectComposer` stack in `frontend/app/lib/spacetype/post.ts` and shared by exactly
two studios: Scene3D and Space Type. Every other studio grew its own, unrelated
effect code.

The result is six overlapping implementations of the same ideas:

| Where | Backend | Post today |
|---|---|---|
| 3D Studio / Space Type | three.js + EffectComposer | the nine effects |
| Shape Studio | three.js | `shapefx/post.ts`, 59 lines — grain + distort |
| Gradient Studio | raw WebGL2 | grain and blur inside the gradient shader |
| Texture Studio | raw WebGL2 | `texturefx/stylize.ts` |
| Compositor | canvas2D + WebGL2 | its own six — adjust, duotone, bloom, vignette, grain, DOF |
| Shader Studio | raw WebGL2 | a 64-effect `.frag` catalog, chained by the user |
| Vector Type | SVG | none |

Grain alone exists four times, and the drift is documented in the code: `shapefx/post.ts:23`
claims its hash is *"Shared with gradientfx/shaders.ts — same hash so grain reads
identically across studios."* It does not. The luminance coefficients are `0.5` and
`0.16`, so the same slider value gives roughly triple the grain in Shape Studio. An
earlier attempt to converge by copying drifted while its comment kept asserting it
hadn't.

Meanwhile the effects are not symmetric. The Compositor has vignette and duotone that
the 3D panel lacks; the 3D panel has eight the Compositor lacks. Neither is reachable
from Gradient, Texture, or Shape.

## Scope

**In:** Gradient Studio, Texture Studio, Shape Studio gain a shared post stack of twelve
effects.

**Out, as named follow-ons:**

- Migrating Scene3D and Space Type off `EffectComposer` onto the shared chain. Gated on
  a golden-image parity diff per effect, so saved docs cannot silently change appearance.
- Absorbing the Compositor. Once the shared vocabulary exists, this is a deletion —
  all six of its effects are already in it.

**Out, deliberately:**

- **Shader Studio.** Its entire interface is already "pick effects from this catalog and
  chain them" — the same technology exposed as the primary UI. A fixed panel underneath
  would give users two routes to the same bloom. (Open question worth its own task:
  whether the chain's params are motion-animatable. If not, fix the chain rather than
  bolt on a second stack.)
- **Vector Type.** Rasterising its output to post-process it fights the point of the
  feature.
- **Depth of field.** Needs a depth map, which only the Compositor (via transformers.js)
  and the 3D studios can produce. Belongs with AO in the depth-gated tier.

## The effect list

Twelve effects — the union of the 3D panel and the Compositor's, so that phase 2 removes
code instead of adding it.

bloom · colour (exposure/contrast/saturation/hue) · chroma · blur · film · halftone ·
dot screen · glitch · grain · vignette · duotone · ambient occlusion

Ambient occlusion reads depth and normal buffers and never generalises. It is declared
3D-only and filtered out of the derived control list for every other host.

## Architecture

### One declaration per effect

Sailor has two declaration systems and the post stack needs both:

- **`EffectDef`** (`lib/shaderfx/types.ts`) — JSON in `shader_effects/manifest.json`,
  pairs a `.frag` with its uniforms. Drives rendering.
- **`ControlSpec`** (`lib/spacetype/effect.ts:39`) — TypeScript, drives inspector
  sections, agent vocabulary, and motion targets.

A post effect is declared **once**, as a manifest entry. The `ControlSpec` list is
**derived** from it: `uniform`→`key`, `label`→`label`, `min/max/step/default` carry
over, effect name→`group`. Adding a thirteenth post effect is one `.frag` plus one
manifest entry, and it arrives with a panel, agent control, and animatable params
attached.

### The shaders already exist

Eleven of the twelve have a working `.frag` in `shader_effects/` today:

| Post effect | Catalog effect |
|---|---|
| bloom | `bloom` — `u_threshold/u_radius/u_intensity`, exactly the `PostSettings` keys |
| chroma | `chromatic_aberration` |
| blur | `gaussian_blur` |
| halftone | `halftone` |
| dot screen | `dot_screen` |
| glitch | `rgb_glitch`, `block_glitch` |
| film | `film_grain` + `crt_scanlines` |
| grain | `film_grain` |
| vignette | `vignette` |
| duotone | `duotone` |
| colour | **new** — a combined exposure/contrast/saturation/hue pass |

So the work is parameter reconciliation, not shader authoring. The parameters do differ:
`halftone` takes `u_size/u_angle/u_softness` where `PostSettings` has
`halftoneRadius/halftoneScatter`; `duotone` takes hues as floats where the Compositor
stores hex colours. Each mapping is specified alongside its manifest entry.

**Storage: one copy, imported at build time.** The `.frag` files stay in
`shader_effects/`. The post chain imports the subset it needs via a Vite `?raw` glob,
with `shader_effects/` added to Vite's allowed FS roots. One file per effect, two
consumers, and no network dependency on any render path — which matters because post
runs in every studio including headless bakes, whereas the catalog endpoint
(`/sailor/shader_effects`) today only risks Shader Studio when it fails. Shader Studio
keeps its reload-don't-restart authoring loop for its own catalog.

Bundling copies was rejected: it would duplicate exactly what this consolidates.

### Module layout

`lib/studio/post/`:

| File | Role |
|---|---|
| `settings.ts` | `PostSettings`, `DEFAULT_POST`, `postEnabled()` — moved from `spacetype/postSettings.ts`, which becomes a re-export shim (a dozen importers) |
| `manifest.ts` | the twelve declarations, including uniform mappings and chain order |
| `controls.ts` | derives `ControlSpec[]` from the manifest, filtered per host studio |
| `chain.ts` | the GL2 runner |

### The render seam

One function:

```ts
applyPost(source: TexImageSource, post: PostSettings, w: number, h: number, t: number): HTMLCanvasElement
```

It holds one GL2 context app-wide, as `lib/shaderfx/renderer.ts:2` already does
("One GL context app-wide (browsers cap ~8-16)"), and runs a ping-pong pass per
*enabled* effect. When `postEnabled()` is false it returns the source untouched and
creates no context, so post-off costs nothing — matching how the three.js studios bypass
the composer today.

**Each studio calls it in exactly one place:** at the end of its own `render()`, then
draws the result back onto its own canvas. That single call site is what prevents drift,
because both consumers sit downstream of it — the live viewport *is* that canvas, and
`lib/studio/frameSource.ts:20`'s `getFrame` hands that same canvas to bakes, exports, and
wired downstream nodes. Post applied inside `render()` is automatically in every path,
rather than a step each export route must remember.

**Prerequisite verified:** every studio canvas already sets `preserveDrawingBuffer: true`
— `gradientfx/renderer.ts:48`, `shaderfx/renderer.ts:116`, `texturefx/renderer.ts:640`,
`shapefx/engine.ts:63`, `scene3d/engine.ts:435`. Handing a studio canvas to the shared
renderer as a `TexImageSource` is safe everywhere.

**Invariant to document loudly:** the returned canvas is valid only until the next
`applyPost` call, because all studios share one context. Drawing back immediately
satisfies it. A studio that held the reference across a frame would silently render
another studio's output.

**Chain order** is a single fixed constant in the manifest, in the spirit of
`compositor/postEffects.ts:8` declaring its order as the source of truth. Alpha
propagates through every pass, and each effect declares whether it is alpha-gated —
that one uniform replaces Gradient's coverage plumbing.

**Persistence:** each studio config gains `post: PostSettings`, defaulted on read. Only
Gradient has an `ensureConfigDefaults` on its load path
(`GradientStudioSurface.vue:487`); Texture and Shape need their own defaulting. A doc
saved before this change must read as post-off, not undefined.

## Two schema gaps, closed first

### The boolean gap (load-bearing)

`ControlSpec` has nine kinds and none is a switch. `lib/scene3d/controls.ts:27-38`
documents this at length: every `post.*` enable is *omitted* from the schema, because a
two-option `select` would write the string `'on'` into a boolean field —
`makeConfigParams` writes straight through the proxy with no coercion — corrupting the
document.

The live consequence: **the agent can turn bloom's strength up but cannot turn bloom
on**, and motion cannot key an effect on or off. Those toggles are the entire top level
of the panel. Generalising the panel without fixing this would faithfully reproduce the
gap in three more studios.

So adding a `switch` kind to `ControlSpec`, with its own agent, motion and UI story,
is a prerequisite rather than a follow-on. It is also the highest-leverage item here: it
retroactively unlocks `material.unlit`, `material.relief.invert` and
`GlbObject.materialOverride` in 3D Studio, blocked for the same reason.

### The colour gap

`EffectParamDef` types are `float | enum`. Duotone needs two colours. The manifest schema
gains a `color` type mapping to `ControlSpec`'s existing `color` kind.

## Retirement and migration

**Retired into `post.grain`:** Gradient's `u_grain` and Shape's `style.grain`. Gradient
also sheds its `u_grainDeferred` flag and the trick at `gradientfx/shaders.ts:642` that
smuggles coverage through the alpha channel — the shared chain's alpha gate does that job.

The risk is the threefold coefficient difference. A Shape doc with grain `0.3` currently
renders like a Gradient doc at roughly `0.94`. One canonical coefficient is chosen and
**stored values are rescaled per studio on read**, so existing docs render unchanged and
only the slider's meaning is unified. Values exceeding the canonical range after
rescaling clamp — a documented, tested case.

If migration fidelity cannot be met, the fallback is a permanent per-studio scale factor
rather than a one-time migration.

**Kept:**

- Gradient's blur/focus (`gradientfx/types.ts:221`) — it has a focus point and is
  optical, closer to DOF than to a uniform post blur. Depth-gated tier, with AO.
- Shape's `distortion` — in neither panel; generalising it is not this change.

## Verification

Six checks, ordered by what they would catch:

1. **The `switch` kind, TDD from the failing case.** The first test written asserts that
   a `switch` control writes a *boolean*, not the string `'on'` — the exact corruption
   `scene3d/controls.ts` warns about. Written before the kind exists.

2. **Derived-control characterization snapshot.** The `ControlSpec` list derived from the
   manifest is frozen in a snapshot, following `gradientfx-controls.unit.spec.ts.snap`.
   Controls are opt-*out*, so a thirteenth post effect silently grants itself agent
   access and motion targets; the snapshot surfaces that in review.

3. **Per-studio integration assertions.** For each of Gradient, Texture and Shape: render
   with every effect off, render again with one on, assert the pixel diff is non-zero. A
   plausible-looking screenshot does not prove the post stage ran — a chain that silently
   no-ops renders exactly like one that is off.

4. **Migration fidelity.** A Gradient doc and a Shape doc saved before the change must
   render identically after the grain rescale. The retirement rests on this test.

5. **Alpha preservation.** A transparent-background frame stays transparent through all
   twelve passes, and grain does not land on the transparent region. Not cosmetic — the
   transparent-WebM and Figma-matte export routes depend on it, and it is the property
   Gradient's coverage gate exists to protect.

6. **Golden images per effect**, extending the existing shader-golden harness. Caveat for
   whoever runs it: the `crystal_prism` and `oil_paint` goldens are already broken on
   main, so a green baseline should not be expected there.

Vitest counts are unreliable under load in this repo; quote the collected-file total
alongside any before/after failure count.

## Phasing

Four commits:

1. The `switch` `ControlSpec` kind and the `color` param type. Independently useful;
   unblocks everything else.
2. `lib/studio/post/` — manifest, derived controls, GL2 chain, the new `adjust` frag.
3. Per-studio adoption, one studio per commit: Gradient, Texture, Shape.
4. Retirements and their migrations.

Follow-ons, explicitly out: the three.js migration onto the shared chain, and the
Compositor's absorption.

---

## In simple terms

Right now the effects panel you see in 3D Studio only works in 3D Studio and Space Type,
because it is built on three.js machinery the other studios do not use. The other
studios each grew their own small pile of effects instead. Grain got written four
separate times, and two of those copies claim in a code comment to match each other
while actually differing by a factor of three.

The fix is to stop treating effects as something each studio owns. Almost every one of
these effects is just a filter applied to the finished picture — it does not care how the
picture was made. So there will be one shared filter stage that any studio can hand its
finished frame to, and one list describing the twelve effects. That single list feeds
the panel, the agent's vocabulary, and what motion can animate, so adding a new effect
later means writing one shader and one line of description, and it shows up everywhere
at once.

Three good things fall out of it. Gradient, Texture and Shape Studio gain twelve effects
each. Vignette and duotone, which only the Compositor had, become available everywhere.
And the shaders themselves mostly already exist — Shader Studio's catalog already
contains working versions of eleven of the twelve, so this is largely wiring, not writing.

One real bug gets fixed on the way. The agent can currently change bloom's *strength* but
cannot switch bloom *on*, because Sailor's control system has no way to describe an
on/off toggle. That gap has to be closed first, and closing it also unlocks several other
switches in 3D Studio that were stuck for the same reason.

The main risk is grain. Retiring four versions in favour of one means existing saved
documents could suddenly look different. The plan handles that by rescaling old saved
values as they load, and there is a test whose whole job is to prove that a document
saved yesterday still looks identical tomorrow.
