# State of the Build — Sailor

*Surveyed 2026-07-25 (three parallel codebase sweeps). Update when surfaces land or capabilities change. Companion to [VISION.md](VISION.md) and [ROADMAP.md](ROADMAP.md).*

## Scale

~158k lines in `frontend/app` · 308 components · 27 registered node types · ~22 creative surfaces · 389 unit specs + 20 E2E specs · `frontend/server` 8.6k lines · 50 house styles · 50 image models + ~17 video models.

## Surface maturity map

Legend: **bake** = render/export path · **motion** = animatable · **inspector** = panel UI · **agent** = agent-legible (control descriptor or command surface).

| Surface | bake | motion | inspector | agent | engine LOC |
|---|---|---|---|---|---|
| Space Type | ✅ + clip bake | ✅ timeline clip | ✅ | ✅ descriptor | 11,202 |
| Vector Type Studio | ✅ PNG + SVG export (9 fill types, 6 as real vector) | ✅ full incl. stagger + preset gallery | ✅ | ✅ descriptor (unverified live) | — |
| Scene3D Studio | ✅ 3-pass + mp4 | ✅ own timeline | ✅ | ❌ | 4,258 |
| Compositor / Frame | ✅ | ✅ motion clips | ✅ | ✅ commands | 1,667 (+1,041 motion) |
| Timeline (NLE) | ✅ webm/mp4 + server | ✅ native | ✅ | ❌ | shared/timeline |
| Gradient Studio | ✅ | ✅ 30 targets, path-based | ✅ (hand-written) | ✅ descriptor | 2,620 |
| Shader Studio | ✅ | ✅ path tracks | ✅ (data-driven) | ✅ descriptor | 806 + 63 effects |
| Texture Studio | ✅ | ❌ | ✅ (data-driven) | ✅ commands | 2,041 |
| Shape Studio | ✅ | ❌ | ✅ | ❌ | 761 |
| Shot Director | ✅ | ✅ keyframes | ✅ | ❌ | 988 |
| Smart Layout | ✅ batch export | ❌ | ✅ | ✅ commands | 7,262 (UI) |
| Lip-Sync Studio | ❌ (server) | ❌ | ✅ | ❌ | 82 |
| LoRA Trainer | n/a (server) | — | ✅ | ❌ | 2,424 (UI) |
| Voice Trainer | n/a (server) | — | partial | ❌ | 341 (UI) |
| Character / Sheet | ✅ sheet gen | ❌ | ✅ | ✅ capability | — |
| Pose Mannequin | ✅ control img | ❌ | modal | ❌ (excluded) | — |
| Inpaint / Region | ✅ backend | — | toolbar | ✅ ops | — |
| Collection (sweeps) | — | — | ✅ | ✅ | backbone |

## The factory metric (Act 1)

Cost for one parameter to be inspectable + agent-drivable + animatable + sweepable:

- **Shader Studio uniform: 1 declaration** (`shader_effects/manifest.json` entry) → all four generated.
- **Gradient Studio param: was 7 sites / 5 files**, range retyped 3×, animation **impossible**.

**Act 1, part 1 — LANDED 2026-07-25** (commits `341bbf81e`..`ce07eeaf2`). `lib/gradientfx/controls.ts` is now the single declarative `GRADIENT_CONTROLS` list, and **both** the agent vocabulary (`gradientAgentControls`) and the motion targets (`animatableTargets`) are *derived* from it. Motion moved from `{layer, param}` index targeting to dotted paths, with a migration for saved projects plus a fallback in `applyMotion` itself (the single render choke point, `renderer.ts:156`) so legacy tracks resolve on every path — node card, headless bake, and studio frame source all read the saved blob raw and never call `ensureConfigDefaults`.

**Measured outcome: animatable Gradient parameters went from 11 → 30**, verified live in the running app. `relief.grain`, `focus.blur` and the whole `flow.*` block can animate for the first time.

The schema is a **superset with per-consumer opt-in** (`agent: false` withholds from the agent, `animatable: false` from motion), so declaring a control can never silently widen another capability.

Still to do in Act 1: the generic inspector renderer (Gradient still has 432 lines of hand-written markup), new `ControlSpec` kinds (`segmented`, `repeater`, `custom`), and exposing the 11 now-declared Shape controls to the agent. Known misfits remain: Texture's colour-role system (`texturefx/roles.ts`), Space Type's scene-sequencing motion model.

> ## Shader as Fill — status, corrected twice on 2026-07-26
>
> This entry was first written as "LANDED", which was **wrong**: a whole-branch review found the effect
> catalog was never preloaded outside the studio modals, so `getEffectSync` returned `null` and a saved
> shader fill silently rendered its input fill forever on node cards, in the Compositor, and on Scene3D
> (a plain white mesh there). The branch's own E2E spec had recorded both symptoms and filed them as
> unexplained.
>
> **Those are fixed** (`7a176a282`, `d987aa349`, `fc26ccf15`) and **Julien has since confirmed the feature
> working in the real app** — the first human click-through, and the evidence that was missing when the
> "NOT LANDED" block went up. Three review rounds each returned "not ready" and each found real defects;
> the third round's findings were all closed.
>
> Three factual corrections that stand regardless: derived keys are `fill.shader.params.<paramId>`, **not**
> `.p.` (that address pointed at a phantom object and was a real bug); the `uFillAnchor` convention spans
> **14** effect shaders, not ~28; and the grep cited below proves there is one render *function*, which is
> not the same as proving `bake: true` reaches every export path — that was separately wired afterwards.
>
> Known gaps still open, deliberate: shader fills inside per-copy fill **lists** degrade to a flat swatch
> (`fillAtlasTexture` has no `'shader'` case — affects `shutter`/`coil`); corner-pinned shapes with frame
> anchor are not pixel-correct (a projective warp is not an affine `CanvasPattern` transform); Scene3D
> treats `frame` anchor as `object` and is agent-invisible; Space Type exposes no agent/motion vocabulary
> for fills, since its fills are a single serialised `fillList` control.
>
> Ledger with every finding from every round: `.superpowers/sdd/progress.md`.

**Shader as Fill — LANDED 2026-07-26, user-confirmed** (`docs/superpowers/specs/2026-07-26-shader-as-fill-design.md`, Tasks 0–10 plus three review rounds and three fix waves). A shader stops being a full-frame layer and becomes a `FillType`: `FILL_TYPES` gained `'shader'` (recursive, depth-1 enforced), backed by one module, `lib/shaderfill/`, that is the *only* place in the product turning a shader fill into pixels (`resolveField`) — a readback bridge over the existing `shaderFx` WebGL2 singleton, batched by descriptor (not by consumer) so ten shapes sharing one field cost one render. Reaches all four surfaces that can host a fill — Space Type, Shape Studio (reuses Space Type's `fillTexture()` with 3 small schema/propagation fixes, not literally zero), every frame primitive (Compositor), and Scene3D (object-anchor only; the reusable unit there is the field module, not `Fill` itself, since Scene3D never touches `FILL_TYPES`). Object anchor is free; frame anchor cost a `uFillAnchor` convention across ~28 Space Type effect shaders. Authoring uses a new pattern — **declare the frame, derive the contents** (`fill.shader.effectId/anchor/speed` frozen and Collection-bindable, `fill.shader.p.<paramId>` derived per-effect from the live catalog) — the first place the control schema meets genuinely dynamic (63-effect) vocabulary, and the main architectural output of this act beyond the feature itself.

Task 10 closed the act: fixed a real correctness bug where `LIVE_FIELD_CEILING` (4 live fields/frame, protecting *interactive* framerate) was also being applied to bake/export requests, silently freezing the 5th-and-beyond shader-fill descriptor at t=0 on any export — fixed at `beginFieldFrame` so every surface inherits it, proven live (not just unit-tested) via a 6-field bake harness at `/dev/shaderfill-bench`'s `window.__benchBakeCeilingProof()`: all 6 fields advance under `bake:true`, only the first 4 advance under `bake:false` (control). Also wired `bake: true` through the Compositor's export paths (motion bake, static Render, Harmonize, Frame download/publish, `bakeOverlay`) — Space Type had this from an earlier task, Compositor didn't. Bake parity is structural, confirmed by grep: every bake path funnels through the same `resolveField` (`grep -rn "shaderFx.render" frontend/app` turns up only Shader Studio's own surfaces and `lib/texturefx/stylize.ts`).

**Vector Type Studio — LANDED 2026-07-27** (commits `003ac333a`..`7423d4fad`, 11 commits, +15,076/−4,065 across 161 files; `docs/superpowers/specs/2026-07-27-vector-type-studio-design.md`). Act 2's first surface: text → variable-font outlines (fontkit) → animated as real 2D geometry, baked to PNG through the existing cascade, and exported as SVG — **Sailor's first vector output**. It is stateless (`f(cfg, t) → paths`) like Gradient, not rebuild-on-change like Shape, so it arrived fully animatable on day one, including per-glyph stagger (seeded-stable order; a travelling weight wave proven by test). Roboto Flex's 13 axes — `XOPQ` (stroke thickness), `GRAD` (grade), `YTAS` (ascender height), among others — are now animatable design parameters. Fourth factory proof: one `ControlSpec[]` declaration again generated inspector, agent vocabulary, motion, and sweeps together. `app/lib/vector/svg.ts` (`VectorShape`/`shapesToSVG`) was built studio-agnostic, so Shape Studio can become its second consumer.

It replaced three retiring surfaces: Kinetic Slates (−781), the KineticType node with a 74-preset migration (−1,527, 17 mapped honestly / 9 partial / 48 dropped with a written reason each), and the Font Playground widget (−730, removed outright — 0/289 saved and 0/91 backup projects referenced it). **Surface count, stated honestly:** counted consistently, the net change is **−2** either way. Narrowly — type-*authoring* surfaces only — it is six→four: Space Type, Kinetic Type, Kinetic Slates, Font Playground, Text on Path and Text Mask become Vector Type, Space Type, Text on Path and Text Mask. Broadly, counting everything that lets a user pick a font, it is eight→six, because Scene3D text and Compositor text layers exist throughout and the design doc excluded them as "different jobs". (The earlier "six→five" figure was wrong — it paired the narrow before-count with the broad after-count.)

Open, not softened: a migrated KineticType node no longer executes on the ComfyUI backend (it was a real node with IMAGE/MASK outputs; Vector Type is frontend-only — graphs piping kinetic frames into a backend node lose that input at Run time, though baked frames and timeline playback still work; needs a release note), and its migrated MASK output wire dangles unconnected. No fallback exists if `google/fonts` renames a path upstream (the design doc's "static cut, axes disabled" mitigation is unimplemented). No node consumes SVG output — it only leaves the product by download. Parity gaps vs. the retired Font Playground remain: 10 curated families rather than the full Google Fonts catalog, no kerning off-switch, no word-level 3-D transform. `lib/gsap-kinetic.ts` and `kinetic-presets.ts`'s `build()` closures are now orphaned (the preset catalog is still live for Compositor metadata) — a separate cleanup. The in-studio agent tuner is wired and guard-tested but not yet runtime-verified against a live model.

**Vector Type — motion preset gallery — LANDED 2026-07-27** (commits `173249a1c`..`7a5f251cc`, 11 tasks + 1 added mid-flight; `docs/superpowers/plans/2026-07-27-vector-type-motion-presets.md`). A Jitter-style gallery of live-animated tiles in the Motion tab: Appear, Fade, Slide ×4, Mask ↑↓, Grow, Shrink, Blur, Blur & Slide — all 12 proven working in a browser, each with a discriminating metric. Mostly **reuse**: the Compositor's `MotionPresetPicker`/`PresetThumb`/`evaluate.ts` were already consumer-agnostic and moved to a neutral home. New capability was blur (absent from the canvas engine entirely — now in `UnitState`, `ctx.filter`, and `feGaussianBlur`) and a **variable-axis section shown first**: Weight In, Weight Wave, Width Breathe, Grade Pulse, Optical Drift, each a fraction of the loaded font's own range, disabled-with-reason on fonts lacking the axis. Grade Pulse's no-reflow property is measured and proven — shaped advances identical to the unit (0.000% change) while ink swings +19.5%, against a `wght` control that moves advances +14.1%. Presets compose with hand-authored axis tracks (offsets add, scale/opacity multiply); the studio's seeded stagger wins over the engine's.

Three things worth remembering from it. Putting blur into the *shared* engine tables silently added three un-renderable tiles to the **Compositor's** picker — fixed by making the catalog declare what each preset requires, derived by probing what it actually returns, which also caught a fourth un-gated consumer in the timeline's clip inspector. Canvas filter radius is in **device px and ignores the CTM**, so it needs a `pixelRatio` multiply or the node card blurs ~5× harder than the bake. And SVG `stdDeviation` **equals** canvas blur radius — the CSS spec defines the parameter as the standard deviation — verified at RMS 0.000 against a σ-halved control that diffs 12.55%.

Open: `MotionClipInspector`'s timeline path and the mask-through-the-real-SVG-button case were verified at function level only, never through the live button. Gallery cost is unmeasured on a visible window (11 outline tiles ran 12–16 ms/tick headless, which is why outline thumbnails are axis-section-only).

## Canvas — the node capsule (landed 2026-07-27)

Canvas nodes have a collapsed resting state: a 260px capsule (icon, title, one-line
read-out, run button) that grows into the full card on click. Size now encodes
importance instead of every node carrying equal weight.

- **Read-out** resolves error > running > declared rule > silence. Studios derive theirs
  from `ControlSpec.summary` (one opt-in field beside `agent`/`animatable`); Comfy nodes
  declare widget names in `lib/canvas/capsuleMeta.ts`. Undeclared types show their name
  and nothing else, so coverage lands incrementally.
- **Tiers**: always / after-run / never / manual, all 28 vue-flow types classified.
  **v1 ships `comfy` only** — the tier table and the `{from:'controls'}` path are tested
  groundwork with no consumer yet, and the manual toggle for studios does not exist.
- **Transition**: real height animation (0.36s in / 0.22s out, `cubic-bezier(0.32,0,0.12,1)`)
  plus a card-only fade. Deliberately no width, scale or capsule-opacity change — each
  contradicted "same object opening". Height is what makes ports and wires travel.
- **Persistence**: `collapsed` (true only) and `hasRun` via `lib/canvas/persistCapsule.ts`.
  `runningSince` is deliberately excluded — a saved wall clock reloads as a forever-ticking
  counter.

Modules: `lib/canvas/{elapsed,capsuleReadout,capsuleMeta,nodeIcon,persistCapsule}.ts`,
`components/vue-canvas/NodeCapsule.vue`. 5 unit specs + 2 Playwright specs.

**Vector Type — fills — LANDED 2026-07-28** (commits `0cdc83e5a`..`29a308a94`, 10 tasks; `docs/superpowers/plans/2026-07-27-vector-type-fills.md`). The studio's flat `#rrggbb` becomes the product's full `Paint` vocabulary — all nine `FILL_TYPES` (solid, gradient, ombre, grid, noise, checkerboard, stripes, qr, shader), reusing `lib/spacetype/fillTile.ts` and `lib/compositor/paint.ts` rather than a second model. All nine proven end-to-end (canvas, PNG bake, SVG through the real Export button). The 2D paint resolver moved out of `useCompositorLayers` into `lib/paint/resolve.ts` so a second studio could use it.

**Three fill anchors, not two.** Space Type has `object | frame`; type needed the middle term. `glyph` gives every letter its own ramp (all ≈ midpoint), `word` spans the run (235→22 red across six letters), `frame` pins to the canvas (183→73). Under motion a letter's colour is byte-identical at t=0 and t=1 under `glyph` and changes completely under `word`/`frame` — the fill rides the letter, or the letter slides across it.

**Six of nine export as genuine vector**, and the product says so. Solid and both gradient forms emit real `<linearGradient>`/`<radialGradient>`; grid, stripes, checkerboard and qr emit real `<pattern>` geometry — every one at **0.0000%** against the canvas, with broken controls diffing 95–100%. Ombre, noise and shader cannot be vector (per-pixel dithers and a WebGL fragment render have no geometry to recover) and embed an honest raster. `exportTier(paint)` derives the tier by calling **the same function the exporter calls**, so the UI claim cannot drift from the bytes — verified 9/9 by clicking Export and inspecting the file.

Findings worth keeping. An untransformed wrapper `<g>` does **not** pin an SVG paint server — `fill` is inherited; the inverse `gradientTransform` is what cancels the glyph's own transform (the plan said otherwise and a pixel diff disproved it). `objectBoundingBox` needs aspect correction at oblique angles (46.3% disagreement, exact at 0°/90°). Angled stripes tile exactly, because the canvas's per-pixel dot product is an orthonormal basis change. And raster embed scale must be **kind-derived** — a dither at 2× measured 82–91% different, because its raster grid *is* the artwork.

Open: the live Space Type 3D render could not be verified in the browser pane (scene builds, no GL error, readback black — believed environmental, not claimed working). No non-Chrome renderer was checked. `useVectorSvg.ts` (the Compositor's own SVG writer) still collapses rich fills to a flat colour silently — the anti-pattern this work corrected in Vector Type, still live there.

## Agent layer

Loop shape is right (perceive → plan → invertible commands → ghost preview → Keep/Dismiss) plus visual self-review and Direction Loop. **Reach is the gap:** 4 agent surfaces (canvas, compositor, smartLayout, texture) vs ~22 creative surfaces; 3 of 8 studios expose descriptors, plus a 4th (Vector Type) wired but with its agent tuner unverified live. LLM tiers: haiku→patch / sonnet→plan / opus→campaign; Fable for style profiles.

## Known debt

- **Export:** 4 independent paths; JSZip ×2; ~40 ad-hoc `a.download`; deliverables shelf re-packages, never renders. (Act 3)
- **Motion:** 6 parallel motion modules wired through 3 registries + DOM CustomEvents; only one preset↔keyframe bridge. (Act 1 absorbs numeric tracks; sequencing models stay per-surface)
- **Agent-invisible depth:** Scene3D is the largest surface with zero agent access. (Act 3, or free via factory retrofit)
- **Texture/Shape have bakers but no motion path.**
- **Bindability markup gate:** a control missing its `<BindableRow>` wrapper is sweepable in principle but has no UI affordance.
- **Migrated KineticType nodes lost backend execution.** The retired node was a real ComfyUI node (IMAGE/MASK outputs); Vector Type Studio is frontend-only. Graphs that piped kinetic frames into a downstream backend node lose that input at Run time — baked frames and timeline playback are unaffected. Needs a release note. The migrated MASK output wire also dangles unconnected on these nodes.
- **No fallback if `google/fonts` renames a path upstream** for Vector Type Studio's variable-TTF proxy — the family just fails to load. The design's "static cut, axes disabled and labelled" mitigation was never implemented.
- **No SVG-consuming node exists.** Vector Type's SVG export only leaves the product by download.
- **`useVectorSvg.ts` still degrades silently.** The Compositor's SVG writer collapses every rich fill to a flat representative colour via `paintPrimaryColor` and says nothing — the exact anti-pattern Vector Type's export-tier declaration was built to avoid. Same fix would port.
- **Space Type's live 3D render is unverified** after the `fillTileBox` rounding change. Its fill textures provably never route through that function, and `paintTileBox` (its only exposure) is verified correct — but the on-screen 3D readback could not be captured in the browser pane.
- **`MotionClipInspector`'s timeline path is unverified** for the new preset capability gating — checked at function level only, never driven through the live timeline UI.
- **Gallery cost is unmeasured on a visible window.** 11 outline thumbnails ran 12–16 ms/tick in a hidden pane, which is why `VectorTypeThumb` is used for the axis section only and `PresetThumb` elsewhere.
- **`lib/gsap-kinetic.ts` and `kinetic-presets.ts`'s `build()` closures are orphaned** by the KineticType retirement (the preset catalog itself is still live, read by the Compositor for metadata) — an uncompleted cleanup.
