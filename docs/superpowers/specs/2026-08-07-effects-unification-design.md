# Effects unification — Space Type & Scene3D onto the shared post stack

*Design · 2026-08-07*

## Plain-language summary

Every studio has a section for "effects" (bloom, grain, duotone, and so on). Three
of them — Gradient, Texture, Shape — already render it the same way: one collapsible
list where each effect is a row with an on/off toggle that expands to show its
sliders, all driven by a single shared manifest. Two others don't:

- **Space Type** hand-writes its own "Post" section with only 4 effects, even though
  its renderer can already do more (halftone, dot screen, glitch, film are built but
  hidden from the panel).
- **Scene3D** hand-writes its own "Effects" section with 9 effects, missing grain,
  vignette, and duotone.

This change moves both onto the shared list, so all five studios show the *same*
effects list, in the same order, rendered by the same component. And it makes the
effect *set* actually match: grain, vignette, and duotone get added to both studios'
renderers so nothing is missing — the only exception is Ambient Occlusion, which
physically needs 3D depth and so stays Scene3D-only.

Shader Studio and Vector Type are explicitly **out of scope** (Shader has a wholly
separate model plus a different ~61-effect stylized catalog; Vector Type has no post).

## Why

The effects UI and the effects *set* both diverge across studios, and the divergence
is drift, not intent:

- The collapsible toggle-row renderer (`StudioControlPanel` → `StudioSectionTree`, the
  `sectionToggle` header switch) and the 12-effect manifest (`lib/studio/post/manifest.ts`)
  **already exist and are shared** — Gradient/Texture/Shape opt in with two lines
  (splice `...postControls(...)` into their `ControlSpec[]`, append `...POST_SECTIONS`
  to their section order). The screenshot the user pointed at *is* this renderer.
- Space Type (`SpaceTypeSurface.vue:1705`) and Scene3D (`Scene3DStudioSurface.vue:3991`)
  instead hand-write inline `StudioSwitch` + slider rows against the same `post.*` data.
  These are the two drifted copies: Space Type exposes 4 of the effects its renderer
  supports and hides the rest; Scene3D exposes 9 but lacks grain/vignette/duotone.
- Crucially, the **data shape is already shared**: both studios store `post` as the
  same `PostSettings` object (`~~/shared/spacetype/state`) whose defaults
  (`lib/studio/post/settings.ts` `DEFAULT_POST`) already carry all 12 effects' fields.
  So grain/vignette/duotone are *already persisted* (defaulted off) — they were simply
  never rendered or exposed.

The manifest was built to be the single source (the `threeDOnly` flag and
`postControls({threeD:true})` scaffolding in `manifest.ts` / `controls.ts` were added
specifically for these two studios to migrate onto). This change finishes that.

## Scope

**In:** Space Type, Scene3D. **Already done:** Gradient, Texture, Shape.
**Out:** Shader Studio (separate `config.post`/Duotone/Adjust/GradientMap model + the
~61-effect stylized GLSL catalog — a different concept and a data migration), Vector
Type (no post), the Compositor (separate per-layer Add/Remove model).

## The 12 effects (the manifest, unchanged)

`POST_EFFECTS` (`manifest.ts:54`): **bloom, color, duotone, chroma, blur, film,
halftone, dotScreen, glitch, grain, vignette, gtao** (Ambient occlusion, `threeDOnly`).
Render order: `POST_CHAIN_ORDER` (`manifest.ts:239`).

After this change, every unified studio's Effects list is:

| Effect | Gr · Tx · Sh | Space Type | Scene3D |
|---|---|---|---|
| Bloom, Color, Chroma, Blur | ✅ | ✅ (was ✅) | ✅ |
| Film, Halftone, Dot screen, Glitch | ✅ | ✅ **un-hidden** | ✅ |
| Grain, Vignette, Duotone | ✅ | ✅ **new pass** | ✅ **new pass** |
| Ambient occlusion (gtao) | — (2D) | — (no depth) | ✅ |

## Design

### 1. Host capability — replace the `threeD` boolean

`postControls()` currently takes `{ threeD: boolean }`, which conflates two independent
things: (a) whether depth-only effects (gtao) are included, and (b) how params are
treated for the 2D-GL host vs a three.js host (the `uniform: null` param drop at
`controls.ts:71`). Space Type breaks this: it is a **three.js host without depth** —
it wants every effect *except* gtao, with three.js param treatment. The boolean can't
say that.

Replace `threeD` with an explicit capability. Concretely, `postControls` gains a way to
say **which effect ids the host supports** (default: all) and **whether to drop
`uniform: null` params** (the 2D-GL concern), decoupled from gtao inclusion. The precise
shape is a plan decision, but the behaviour required:

- **Gradient/Texture/Shape** (2D GL): supports all except gtao; drops `uniform: null`
  params. (Equivalent to today's `threeD: false` — must remain byte-identical output.)
- **Scene3D** (three.js, depth): supports all 12 incl. gtao; keeps params.
- **Space Type** (three.js, no depth): supports all except gtao; keeps params.

This is additive and central — one function, one place, so gating a studio is declaring
its capability, not editing markup. It must not change the three existing 2D studios'
generated `ControlSpec[]` at all (characterization: snapshot their `postControls` output
before and after).

### 2. UI migration — delete the bespoke sections, render the shared panel

**Space Type** (`SpaceTypeSurface.vue`): delete the hand-written `StudioSection title="Post"`
(~1705–1745, the 4 inline `StudioSwitch` + `<input type="range">` rows). In its place,
render a dedicated `StudioControlPanel :controls="postControls(<space-type capability>)"
:order="POST_SECTIONS"`, wiring `:value`/`@set` to the `post.*` object — the exact
pattern Gradient uses at `GradientStudioSurface.vue:1301`. Space Type isn't otherwise on
`StudioControlPanel`, so this is a *scoped* panel just for the Effects list, sitting
where the old "Post" section was.

**Scene3D** (`Scene3DStudioSurface.vue`): delete the hand-written `StudioSection title="Effects"`
(~3991–4069). Replace with the same dedicated `StudioControlPanel` fed
`postControls(<scene3d capability>)`. Reconcile the agent-facing declarations: Scene3D
declares the post sliders in group `'Post'` for the agent at `lib/scene3d/controls.ts:232+`
while the enable switches lived only in the surface template (`controls.ts:34-36`
comment). After the migration the manifest is the single declaration for both inspector
and agent — remove the now-duplicated hand-declared post sliders from `scene3d/controls.ts`
and let `postControls` supply them, matching how Gradient's agent + inspector both derive
from one list. Verify the agent still sees the same (or a superset of) post targets.

Both wire the panel's `@set(key, value)` to write `post.<path>` and `:value(key)` to read
it, so the existing `PostSettings` object is the single mutation target — same as the 2D
studios.

### 3. Renderer — add grain, vignette, duotone (three.js passes)

Both studios post-process through a three.js `EffectComposer`
(`lib/spacetype/post.ts`, `lib/scene3d/engine.ts`) that already implements most effects
as passes. Add three passes to **each**:

- **Grain**: port the shared grain so it matches the 2D hosts exactly. The canonical
  grain math already lives in the shared post work (`shader_effects/post_grain.frag`
  and the 2D chain) — the three.js `ShaderPass` must reproduce it (seed hashing, cell
  quantisation via `grainSize`, the 0.16 amount scaling) so "Grain 0.76" is
  visually identical across every studio. This is the highest-risk pass (the four-grains
  saga: the same slider read ~3× stronger in one host).
- **Vignette**: a radial luminance falloff `ShaderPass` reading the manifest's vignette
  params.
- **Duotone**: map luminance to the two-colour ramp from the manifest's duotone params.

Each pass is inserted into the composer at the manifest's `POST_CHAIN_ORDER` position and
runs only when its `post.<effect>.enabled` switch is on. Params read from `post.*` (same
ranges as the manifest, since the data is shared — no range reconciliation, unlike Shader).

**Un-hide Space Type's built passes:** Space Type's `post.ts` already has
halftone/dotScreen/film/glitch passes; they gain switches for free once the UI is the
manifest-driven list (their `post.*.enabled` fields already exist).

**gtao stays Scene3D-only** via the capability in §1 — Space Type's list simply never
includes it.

### 4. No data migration

`post` is already `PostSettings` in both studios with all 12 effects' fields defaulted in
`DEFAULT_POST`. Enabling an effect that was previously unrendered just flips a switch that
already existed. A document saved before this change opens with grain/vignette/duotone
present and off — no rewrite, no compatibility shim.

## Units / boundaries

- `lib/studio/post/controls.ts` — the capability change (one function).
- `lib/spacetype/post.ts` — 3 new passes + composer wiring.
- `lib/scene3d/engine.ts` — 3 new passes + composer wiring.
- `SpaceTypeSurface.vue` / `Scene3DStudioSurface.vue` — delete bespoke section, add panel.
- `lib/scene3d/controls.ts` — remove the now-duplicated hand-declared post sliders.
- A shared three.js grain/vignette/duotone pass helper is acceptable if it avoids
  duplicating the pass code across the two renderers (both are three.js EffectComposers).

## Testing / verification

No component-test framework here (studio precedent), so:

- **Unit**: `postControls(capability)` returns the right effect set per host — Space Type
  excludes gtao, Scene3D includes it, and the three 2D studios' output is **unchanged**
  (characterization snapshot before/after). Test the capability filter, not the markup.
- **Pixel parity (the load-bearing test)**: render grain, vignette, and duotone in Space
  Type and Scene3D at fixed params, and compare against the 2D reference (Gradient/Texture)
  at the *same* params. Grain especially: assert the same slider value produces a
  visually-matching result across hosts (the four-grains bug was a ~3× amplitude drift
  under a comment claiming parity — so diff the actual pixels / measured amplitude, don't
  eyeball).
- **Live**: open Space Type and Scene3D; confirm the collapsible Effects list shows the
  full manifest set (minus gtao for Space Type), in `POST_CHAIN_ORDER`; toggle every
  effect and confirm it renders and that a saved+reopened doc restores the toggles. Verify
  Space Type's newly-exposed halftone/dot/glitch/film actually apply. Confirm the agent
  still reaches Scene3D's post targets after the `controls.ts` dedup.

## Non-goals

- No change to Gradient/Texture/Shape (must be byte-identical).
- No Shader Studio reconciliation, no Vector Type effects, no Compositor changes.
- No new effects beyond the existing 12-effect manifest.
- No change to `PostSettings` shape or defaults (the fields already exist).

## Rollout

1. Capability change in `postControls` + unit test (2D studios unchanged).
2. Shared three.js grain/vignette/duotone pass(es) + pixel-parity test vs the 2D reference.
3. Scene3D: wire the passes into its composer, migrate its UI to the panel, dedup
   `controls.ts`, verify live (incl. agent + gtao).
4. Space Type: wire the passes, migrate its UI to the panel, un-hide the built passes,
   verify live.
5. Sweep check: all five studios show one identical Effects list; docs/STATE + dashboard.
