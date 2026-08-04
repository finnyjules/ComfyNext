# State of the Build — Sailor

*Surveyed 2026-07-25 (three parallel codebase sweeps). Update when surfaces land or capabilities change. Companion to [VISION.md](VISION.md) and [ROADMAP.md](ROADMAP.md).*

## Scale

~158k lines in `frontend/app` · 308 components · 27 registered node types · ~22 creative surfaces · 389 unit specs + 20 E2E specs · `frontend/server` 8.6k lines · 50 house styles · 50 image models + ~17 video models.

## Surface maturity map

Legend: **bake** = render/export path · **motion** = animatable · **inspector** = panel UI · **agent** = agent-legible (control descriptor or command surface).

| Surface | bake | motion | inspector | agent | engine LOC |
|---|---|---|---|---|---|
| Space Type | ✅ + clip bake | ✅ timeline clip | ✅ | ✅ descriptor | 11,202 |
| Vector Type Studio | ✅ PNG + SVG export (9 fill types, 6 as real vector; multi-fill/stroke stack + extrude + skew/arc) | ✅ full incl. stagger, preset gallery, **colour tracks**, and 4 per-glyph effects (blink · axis scatter · grade flicker · draw-on) | ✅ | ✅ descriptor (unverified live) | — |
| Scene3D Studio | ✅ 3-pass + mp4 | ✅ own timeline (groups animate) | ✅ + object tree | ❌ | ~6,300 (+ SVG import) |
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

## Multi-LoRA generation — 2 slots → 4 — LANDED 2026-08-02

Commits `d2a32c2ea` → `ebaea43e3`. Spec: [2026-08-02-multi-lora-slots-design.md](superpowers/specs/2026-08-02-multi-lora-slots-design.md) · Plan: [2026-08-02-multi-lora-slots.md](superpowers/plans/2026-08-02-multi-lora-slots.md).

`FluxMultiLoRARemoteNode` already existed and already worked — the cap was ours, not the model's: `lucataco/flux-dev-multi-lora` takes `hf_loras`/`lora_scales` as unbounded arrays. Now four slots with tapered defaults (0.9/0.8/0.7/0.6) and progressive disclosure, so a fresh node still reads as the two-slot node it replaced. **Live-verified:** a 3-LoRA run logged three `Downloading LoRA weights` lines and three load timings, with each scale still paired to its own ref after the cache-defence reversal.

**The bug the plan caused, and the review caught.** `widgets_values` is positional and `realignWidgetValues` pads by *length*, not name. Declaring the six new inputs mid-schema shifted every later value in any previously-saved workflow: `aspect_ratio` → `lora_c`, `guidance` (3.5) → `scale_c` whose max is 1.5 (ComfyUI then rejects the run), `"randomize"` → `lora_d_url` (revealing slot D holding junk), seed lost. **New inputs must be appended, never inserted** — now guarded by a Python test that reads `define_schema()` and a TS test that round-trips an old 13-value array.

**Two UI gates that made the feature narrower than the node.** The gallery hardcoded `lora_a`/`lora_b`, so picking into C or D wrote to a `lora_url` widget this node doesn't have — a house-style pick was a silent no-op, and a local pick left a stale slot URL overriding the filename shown. And slot A is character-only while the reveal rule demanded *every* earlier slot be filled, so a style-only user filled B and C never unlocked — capped at one LoRA. Reveal now keys off the immediately preceding slot, and the gallery has switchable Characters / Your Styles / House Library tabs on every slot. Trigger-word routing had to move with it: it branched on the *slot's* kind, which is wrong once any slot can browse any library.

**Slots can be emptied again** (`41d22b1f3`). There was no way to unpick a LoRA: the raw combo carrying `[None]` is never rendered (excluded from the inspector, replaced by the launcher card in the node body) and the gallery had no None entry — so a slot filled by mistake billed on every run and only deleting the node escaped it. A × on the filled picker card now resets all four pieces of a slot: picker → `[None]`, URL override → `''`, scale → its **schema** default (read from `widgetDefs`, not hardcoded), and the slot's style block deleted. Verified against deliberately poisoned values — `scale_b` 1.35 → 0.8, a stale `lora_b_url` override cleared. *Deliberate asymmetry:* a cleared character's trigger is left in the prompt box, because that text is visible and editable; style blocks are hidden, which is why those must go automatically.

**Per-slot style blocks — the last collision, closed** (`0b21c2451`). Every style pick used to write one `data.properties.aesthetic`, so a second style overwrote the first. The *weights* were never affected — both adapters always loaded — but the first style's trigger word and taste-profile prose never reached the prompt, so it ran under-steered. Each slot now owns `aesthetic_a`…`aesthetic_d`; `composeLoraStyle()` in [loraStyleBlocks.ts](../frontend/app/lib/graph/loraStyleBlocks.ts) concatenates the node-level `aesthetic` (still NodeInspector's manual field, and the legacy key) followed by each slot in order. A one-time migration moves a stale `aesthetic` into `aesthetic_b` — before this, slot B was the only slot that could receive a style — guarded on "no slot key set yet", so it never double-fires. **Browser-verified through the real gallery:** Ultra_Pencil into B and Metallic_Mirage into C wrote two distinct keys, and the composed output carries both trigger words.

## Style duplication — one training run, many taste profiles — LANDED 2026-08-02

Commit `abb99dced`. Spec: [2026-08-02-style-duplication-design.md](../frontend/docs/superpowers/specs/2026-08-02-style-duplication-design.md).

**A trained style carried exactly one taste profile, for no structural reason.** The profile is sidecar text prepended to the prompt — nothing about it is in the weights. Wanting a second aesthetic over the same training set had no expression in the UI, and publishing a second house style against one trained model was silently swallowed by an upsert keyed on `replicateModel`.

**Duplicate copies the SIDECAR, not the weights** — ~1 KB against ~344 MB. It works because `GET /api/loras-local` already derived one entry per base name from *either* the `.safetensors` or the `.json`: sidecar-only entries were an existing supported shape (that is how the deployed server lists LoRAs whose weights live only on Replicate). So a copy appears in the gallery and the Style Publisher with no further wiring. Rejected alternatives: copying the weights (byte-identical waste) and a `profiles: []` array inside one sidecar (truest model, but changes the shape read by the GET loop, the publisher's per-filename draft map, and the `lora` filename stored on canvas nodes).

**`trained_on` is the load-bearing field.** `/api/dataset-match` resolves a LoRA's training folder from it alone, so a copy matches the *same* `input/lora_dataset_*` folder and the Fable "rewrite the profile from the training images" flow works on it. Verified live: original and copy both resolve to `lora_dataset_1780550961478`, 16 images.

**`id` replaces `replicateModel` as the house-style uniqueness key.** It already was one in practice — the publisher derives it as `kebab(name)` and thumbnails are written to `public/house-styles/<id>/`. Existing ids are unique, so this is a no-op for every published style. `findIdCollision` is unchanged and is now the only uniqueness rule.

**Findings worth keeping:**
- **"Sidecar-only" was the wrong delete guard on its own.** Refusing to delete when a `.safetensors` is present is correct locally and *inverted* on the deployed server, where **no** LoRA has weights on disk — the guard would have green-lit deleting a real trained style's provenance. Delete now also requires a `duplicate_of` marker, so only files this feature created are removable.
- **The PATCH gate was already a latent bug.** Requiring weights to exist meant sidecar-only LoRAs were listed but uneditable on the deployed server. Duplication forced the fix rather than causing it.
- **A nested route would have 404'd.** `/api/loras-local` is an *exact*-match entry in `comfyui-proxy.ts`'s `NITRO_API_PATHS`, so `/api/loras-local/duplicate` falls through to ComfyUI. Path matching there is method-agnostic, so duplicate/delete ride the same path as GET/PATCH and need no allowlist edit.
- **A compile-check that greps for error strings passes vacuously on a 404.** The first pass "verified" three `.vue` files that had returned `Not Found` — 9 bytes each. The Vite dev path needs the `@fs` prefix and an absolute path; a byte count is the cheap tell.

**Unverified:** a rendered image through a duplicate (never sent one to Replicate), and the gallery's Duplicate/Delete button click-through. Everything else is verified live end-to-end against the dev server.

## Scene3D SVG import — LANDED 2026-08-01

Commits `ece01d0af`..`f278dd2f7` (13). Spec: [2026-07-31-scene3d-svg-import-design.md](superpowers/specs/2026-07-31-scene3d-svg-import-design.md) · Plan: [2026-07-31-scene3d-svg-import.md](superpowers/plans/2026-07-31-scene3d-svg-import.md).

**The first time a vector reaches a Sailor studio as *geometry* rather than as a picture.** Vector Type Studio could already write SVG; nothing had ever read it. Drop or paste an SVG into 3D Studio and each path becomes real extruded geometry, one object per path, held in a group — which is why [grouping](#scene3d-grouping--landed-2026-07-29) was built first.

**An imported path is a new `svgPath` PRIMITIVE, not a new object kind.** Slotting in beside `text` means it inherits all eight material types, every modifier, motion, the Size row, the gizmo, duplicate and grouping for free, and reuses `extrudeShapes()` unchanged.

**Two libraries, each where it is strongest.** The import half **reuses the Compositor's existing paper.js pipeline** — `svgToLeafPaths`, extracted from `useVectorSvg.ts` so both consumers share it — which already handled `expandShapes` (rect/circle/polygon → real paths) and `applyMatrix` (transforms baked). The render half converts a stored `d` to `THREE.Shape[]` via three's `SVGLoader`, which resolves holes by fill-rule. That split also decides testability: paper is browser-only (E2E), `SVGLoader` needs only `DOMParser` (vitest under happy-dom) — and the render half is where the bugs live.

**Stroke-only paths are outlined into fills** with paper boolean ops — a rectangle per segment united with a disc at every join and cap, which is *exact* for the round joins Lucide, Feather and Heroicons all specify. Without it the most likely paste, an icon, imports as nothing at all. (`SVGLoader.pointsToStroke` returns a `BufferGeometry` of triangles, not a `Shape`, so it cannot feed the extruder — the spec's first draft was wrong about this.)

Above 40 paths, import asks: separate objects, or one merged object whose `d` concatenates every subpath.

**Verification:** 132 unit tests, 4 E2E against a live server, zero typecheck errors. Nine deliberate broken controls were each confirmed to turn a test red — a disabled Y flip, the pre-fix arc transform, a pass-through `outlineStrokes`, a removed `flatten`, deleted join/cap discs, a non-accumulating name scope, hard-coded `parseFailed`, `geoKeyFor` reverted to stringifying content, and a hard-coded `nonzero` fill-rule.

**Findings worth keeping:**
- **Arcs were never flipped.** The hand-rolled Y flip walked curves moving `v0..v3`, but `SVGLoader` emits an `EllipseCurve` for `A` commands, whose geometry lives in `aX`/`aY`/angles/`aClockwise`. Any logo with a rounded corner — routine Illustrator output — would have had arcs stranded at +Y while lines went to −Y: torn, self-crossing extrusions, no error. Fixed by pushing the flip into the SVG itself (`<g transform="scale(1,-1)">`) and deleting the hand-rolled transform entirely.
- **`fillRule` was captured, typed, threaded — then dropped at the seam.** Each half was individually correct; the field simply never crossed. Every import was forced to `nonzero`, so a Figma `evenodd` donut imported as a solid blob. Found only by the final whole-feature review.
- **Flattening curves was load-bearing, not cosmetic.** `expandShapes` gives a `<circle>` four anchors, so an anchors-only stroke outline turns a circle into a rounded square — and the area is only ~10% off, so a naive assertion would have passed it.
- **The E2E's own stroke assertion was vacuous at first.** The Size row renders `scale * (baseSize[i] || 1)`, so a *zero*-extent axis displays `1` — a degenerate object reads *larger* than a correct one. Caught mid-sabotage; replaced with a thickness assertion.

- **A multi-path logo imported as a pile** — fixed same day in `f278dd2f7`. `extrudeShapes` recentres every geometry on its own bounding box (correct, and shared with `text`/`shape`), while `buildSvgObjects` placed every child at `[0,0,0]`. The two combined to stack every path on one point: two squares authored 12 units apart measured **0** apart. It was first written up here as "arrangement renders correctly, only the gizmos stack" — that was wrong, and only measuring it showed so. `SvgLeafPath` now carries each path's own `cx`/`cy` (recomputed after stroke outlining, since an outline is fatter than its source) and the object is positioned at `[cx, -cy, 0]`; the Y negation is because the stored `d` stays Y-down while `pathToShapes` flips at build.
- **The E2E could not see it:** test 1 asserted a child *count*, not an arrangement. It now asserts the two children have different Position X.

## Scene3D grouping — LANDED 2026-07-29

Commits `004494585`..`710f94241` (18). Spec: [2026-07-29-scene3d-grouping-design.md](superpowers/specs/2026-07-29-scene3d-grouping-design.md) · Plan: [2026-07-29-scene3d-grouping.md](superpowers/plans/2026-07-29-scene3d-grouping.md).

**The first object hierarchy in any Sailor studio.** Every `SceneObject` may carry a `parentId`, and a new geometry-less `group` kind holds them, so several objects transform and animate as one unit. Built as the prerequisite for SVG import (a logo imports as one object per path, which needs something to hold the paths together) but it stands alone — two spheres and a light are groupable.

**`doc.objects` stays FLAT; hierarchy is a reference, not nesting.** This is the decision the design rests on. Eight modules iterate that array and `objects.<id>.motion.*` agent paths assume a flat id space; nested `children` would have forced all of them to recurse. The engine turns `parentId` into a real three.js parent/child edge, so the scene graph composes transforms and there is **no matrix maths on the render path**. Group motion is therefore free — a group is an object, so animating it moves its children.

New pure module `lib/scene3d/hierarchy.ts` owns every hierarchy operation (`orderParentsFirst`, `sanitizeHierarchy`, `worldMatrixOf`, `rebaseMany`, `groupObjects`, `ungroupObject`, `ungroupMany`, `cloneSubtree`), engine-free so it is testable without a WebGL context. Also landed: ordered multi-selection with a `selectedId` computed shim, a pivot-based gizmo for multi-drags, Cmd+G/Cmd+Shift+G, a recursive object-list tree, subtree delete/duplicate, and transform + material fan-out across a selection.

**Verification:** 84 unit tests, 2 E2E against a live server, zero typecheck errors. Every assertion was demonstrated able to fail before being believed — a subtraction rebase, disabled cycle-breaking, reversed rebase ordering, naive freed-ids concatenation, an unseeded clone-numbering scope, and a disabled ungroup rebase each turned the relevant test red.

**Findings worth keeping:**
- The plan's own group placement was wrong: putting a group at world-identity rotation requires a **shear** under a rotated, non-uniformly-scaled parent, and `Matrix4.decompose` silently drops shear. Children drifted 0.4378 units. Keeping the group's local basis at exactly identity makes recomposition lossless (8.9e-16).
- `cloneObject`'s constructor ternary was exhaustive over `primitive | glb | light`; adding `GroupObject` made **duplicating a group fabricate a light**. It hid inside the typecheck baseline for five tasks. Now guarded by a `never`-typed exhaustiveness check.
- Every blocking item in the final review was a module no task had opened, still assuming a flat list: opacity traversed whole subtrees (with insertion-order-dependent winners, giving the same document opposite bugs either side of a save), motion templates double-wrote to groups and their children, and `retryGlb` dropped `parentId`.

**Known gap:** the multi-select gizmo *drag* path has no runtime verification — synthetic pointer events do not drive `TransformControls`.

## Vector Type — seven animations, three of them random (landed 2026-07-29)

Commits `0713fec7d`, `241caba3e`, `f7b5103ae`, `1092f8910`, `31d93b92a`, `3b11eec06`, plus
two track presets that needed no engine at all. Plan:
[2026-07-28-vector-type-animations.md](superpowers/plans/2026-07-28-vector-type-animations.md).

**Two were free.** The studio's guarantee is `f(cfg, t) → paths`, so every declared slider
already animates: an **extrude light sweep** is one `appearance.<id>.angle` track (the block
shadow's ink centroid really orbits — 69.7 × 72.1 px of centroid travel over the turn, against a
0.0000 ink-XOR broken control), and **misregistration** is two opposed depth-1 extrude plates
with `distance` animated (plate separation, measured on isolated plates, is exactly
`2 × distance` at every sample). The plan's route to misregistration —
per-layer `glyph.dx` — *does not exist and cannot*: `frame.transforms[i]` is resolved once per
glyph and the whole appearance stack paints under it. Both shipped as one-click track presets.

**Three are seeded randomness**, which is the interesting part, because this studio's promise
is that the preview, the PNG bake, the video bake and the SVG export draw the same frame at the
same `t`. None of them rolls a die. Time enters as a **quantised bucket** and the value is a
pure hash of `(unit, seed, channel, bucket)`:

- **Blink** — letters *or whole words* drop out and come back on a beat. Word grouping is
  computed once per frame from the shaped run (`words.ts`), because glyph indices and character
  indices disagree the moment a ligature forms. A unit is lit at phase 0 by construction, so a
  beat edge can never fall inside a dark window — the one instant two clocks could disagree on.
- **Random per-glyph axis scatter** (the user's own idea) — every letter at its own position on
  one variable axis, settling or wandering. On Roboto Flex's real 13-axis file, `wght` deltas of
  +190 / −176 / +76 / −188 at t=0 collapsing to exactly 0 when settled.
- **Grade flicker** — an axis preset on `GRAD`, weight *without reflow*. Pen positions, advances
  and run width are bit-identical across the whole cycle while up to **23.6 %** of the ink's own
  union changes; a `wght` loop of the same shape moves the run width 3385.2 → 3326.2, the control.

**Draw-on** is the fourth new effect and the one that had to stay real vector: letters draw
themselves via genuine `stroke-dasharray` / `stroke-dashoffset` on the same `<path>` that holds
the letterform — no clip, no mask, no outlining a partly-drawn shape. It needed a per-glyph
arc-length table (`pathLength.ts`, quadratic-aware because every TrueType font is), and its own
`glyphStackLeaf` so a staggered draw-on reads *its own* glyph's clock rather than the run's.

**Colour motion tracks** closed a gap that had blocked a whole family. `MotionTrack.from`/`to`
are numbers, so there was no path from a track to a fill — which is why the KineticType migration
dropped `color-cycle`. A track is now a colour track iff it carries `fromColor`/`toColor`;
`lib/studio/track.ts` gained **one additive export**, `trackProgress` (the eased 0..1 `trackValue`
already computed internally), and `trackValue` is one line over it. Mixing is OKLab by default —
sRGB's red→blue midpoint lands *below both endpoints* in lightness, which reads as the animation
dying in the middle — with OKLCH for hue rotations.

**Verification (Task 8).** Every effect measured on real rasterised pixels (resvg over the
studio's own SVG export) with a broken control beside each claim and an ink-XOR metric carried
next to every count, because a centroid or a pixel tally is blind to geometry. Determinism holds
end to end: the same frame twice is byte-identical, a JSON round-tripped config renders the same
bytes, canvas and SVG agree exactly on colour, alpha and dash at every sampled `t`, and the two
bake clocks (`i/fps` and `(i/N)·duration`) are float-equal on all 120 frames of a 4 s / 30 fps
clip. All of it survives an arc and a stagger together — 30 distinct frames out of 30 with every
effect on at once. The three seeded channels are uncorrelated on 420 glyph-frames (blink×scatter
−0.0002, blink×flicker −0.0660, scatter×flicker −0.0387; the same channel against itself reads
1.0000). The shared engine is untouched: `trackValue` is **bit-identical to its pre-change self
over 200,000 random samples**.

**Open, honestly:**
- Live *playback* timing was never measured. The Browser pane throttles rAF to zero, so the
  studio's continuous clock cannot be driven there; every timing claim above is headless. What
  *was* driven by hand in the running app: the Motion tab, the blink and scatter sliders (whose
  sub-controls appear as the amount is raised), the Colour Cycle tile lighting up once the fill
  has saturation, and the colour popover — a typed hex reaches the preview as 9,530 pixels of
  exactly that value.
- `trackValue` diverges from its old self in exactly one unreachable case: endpoints whose
  *difference* overflows to Infinity (`|to − from| > 1.8e308`) now return `NaN`.
- The extrude presets remain the only stack-motion presets; nothing yet drives a stroke's
  `width` or an extrude's `taper` from a preset.

## Web Embed Export — LANDED 2026-07-28

First **non-pixel, non-video** export: a Shader Studio piece exports as one self-contained
`.html` file that renders **live** in a browser — shipping the renderer plus a config blob
instead of frames. Resolution-independent, kilobytes of code (17.6 KB adapter bundle), real
transparency available per-surface, and a path to scroll/pointer reactivity later.

Architecture is the factory pattern again: `lib/embed/contract.ts` declares one contract
(`mount` / `setTime(t01)` / `setSize` / `destroy`), `surfaces.ts` is a one-line-per-surface
registry, and the Shader adapter calls the studio's **own** `composePasses` and `applyMotion`
rather than reimplementing them — one renderer of record, no second render surface to drift.
`vite.embed.config.ts` builds each adapter to a standalone IIFE; `bundle.ts` assembles config
+ inlined poster + adapter JS + an ES5 clock loop into a single downloadable file.

**Delivery is download-only.** Sailor is local-first (no deploy config; `127.0.0.1`), so a
published URL is meaningless to anyone else and blocked as mixed content inside HTTPS pages.
Figma Slides is a documented **non-goal** — it cannot embed arbitrary URLs (not even YouTube)
and does not support video transparency; see the spec for the evidence.

Tests: 27 Playwright across four suites (shader contract / export / parity, plus gradient), 49
unit. The parity gate is layered adapter↔studio, export↔adapter, plus a corruption test proving
the comparison can fail — because every export carries a poster fallback, so a dead render path
still *looks* right.

**Gradient Studio is the second surface (2026-07-28).** The point of doing it was to test
whether the contract generalises to a surface it was *not* designed against. It does:
`contract.ts`, `bundle.ts` and `export.ts` were untouched, and the adapter is ~25 functional
lines. The strongest evidence is a behavioural divergence the contract absorbed silently —
Shader applies motion *in the adapter*, Gradient's `render()` applies it *internally*, so its
adapter must deliberately not. Two opposite placements of the same concern, one unchanged
contract.

Caveat worth keeping: both surfaces are the same species — a class owning its own canvas and GL
context, exposing `render(cfg, w, h, t) → HTMLCanvasElement`, which is exactly the shape the
contract was designed around. N=2 of one species is strong evidence for WebGL renderers and weak
evidence in general. **Vector Type** (SVG, no canvas) and **Scene3D** (async asset inflation, a
three.js scene graph) are the surfaces that would actually falsify it.

Recurring tax for every future surface: motion helpers must live in a Vue-free module or they
are unreachable from an embed bundle. `motionConfigFor` had to be duplicated because its natural
home (`frameSource.ts`) transitively imports Vue via a module-level `ref(0)`.

Bundle sizes: `shader.js` 18.6 KB, `gradient.js` 66.5 KB. Gradient is larger because it compiles
its entire renderer — a 727-line monolithic GLSL source — into the bundle, whereas Shader's
per-effect logic lives as *data* (GLSL inside `EffectDef`s) run by a thin generic compositor.
That is an argument for the data-driven shape whenever a surface has a plugin axis.

Spec: [specs/2026-07-28-web-embed-export-design.md](superpowers/specs/2026-07-28-web-embed-export-design.md) ·
Plan: [plans/2026-07-28-web-embed-export.md](superpowers/plans/2026-07-28-web-embed-export.md)

## Space Type is the third embeddable surface — LANDED 2026-08-03

A Space Type piece now exports as a self-contained `.html` that renders live, **with its real
typeface inlined**. 44 Playwright tests pass across the five embed suites.

`contract.ts`, `bundle.ts` and `export.ts` are **still unchanged** across all three surfaces —
including one needing async font loading, because `mount()` was already async for asset inflation.
Space Type is also the first surface with `caps.alpha` genuinely `true`, so the transparency
plumbing finally has a consumer.

**Getting there exposed a layering violation worth knowing about.** The bundle carried 22 network
references — including live `fonts.googleapis.com` URLs — because `lib/spacetype`'s effects reach
sideways into app *data* modules (`~/data/google-fonts` → `~/data/variable-fonts`) and into
`shaderfx/catalog`'s fetcher. Both had the same shape: a module mixing a network fetcher with a
pure sync reader of a module-level cache. Split each (`lib/font/resolveFamily.ts`,
`lib/shaderfx/catalogStore.ts`); the render path only needs the reader.

**No embed bundle had ever been scanned by `externalRefs`** — the gate only ran on final HTML,
which is why this reached a built artifact unnoticed. `embed-build-output.unit.spec.ts` now scans
every bundle with the real function, plus an allowlist of exact inert literals (three.js's XML
namespace, typeface-JSON licence strings) each carrying a written reason.

> **Limitation, verified not assumed.** The bundle still contains three.js's `FileLoader` and
> `ImageBitmapLoader` with live `fetch(` sites. Nothing invokes them and every asset is inlined,
> but a *static* scan cannot prove a bundled loader is never called. The definitive check is a
> runtime one: load an export in Playwright with network interception, assert zero requests.

**Size — largely addressed 2026-08-04 (`c66eecf5b`, `3c200075a`).** Exports now ship **one bundle
per effect** rather than all 25: a Space Type export went from **2.16 MB to 1.11 MB**, median
per-effect bundle 801 KB against the old 1.85 MB monolith. `export.ts` changed by one line — the
bundle-name decision lives in `surfaces.ts`, which is app-side and never bundled — so
`contract.ts` and `bundle.ts` remain untouched across all four surfaces.

The adapter became a `createSpaceTypeEmbedSurface(effects)` factory, with the app-side default
export marked `/* @__PURE__ */` so Rollup can prove it dead and drop the 25-effect registry from
every per-effect build. `bundleNameFor` validates `effectId` against the live effect array, which
closes path traversal as a side effect rather than by pattern-matching for `..`.

**The cheapest remaining win, found while doing this:** `boost.ts` vendors three typeface JSON
tables, but `getFont()` has exactly one caller, hardcoded to `FONT_NAMES[0]` (Helvetiker). Optimer
and Gentilis are **dead data everywhere**, not just in embeds — dropping them cuts ~760 KB, taking
`spacetype-boost.js` from 1.64 MB to ~880 KB and into line with the other 24.

After that, **the font is the dominant cost** at 296 KB (26% of an export, up from 14% purely
because the JS shrank). Subsetting to the glyphs used would take it to ~20–40 KB. Named imports
are a further ~20–30%; the three.js renderer core is irreducible at ~460 KB.

Superseded note — the original size analysis: `spacetype.js` was 1.85 MB (529 KB gzip) against gradient's 66 KB and
shader's 18 KB. Measured, not guessed: a single-effect probe bundle is 793 KB, so per-effect
bundles would be a 2.3× win, not 10×. The bigger lever is that **32 files use
`import * as THREE from 'three'` and none use named imports**, which defeats tree-shaking —
`AudioLoader` and `CubeTextureLoader` are in a bundle that only draws text. Measure that ceiling
before committing to 25 bundles (which would also force the first-ever change to `export.ts`).

Two gotchas worth keeping: `document.fonts.check()` is **unreliable** — it returns `true` for a
fake family; use `[...document.fonts].some(f => f.family === x && f.status === 'loaded')`. And
`exportEmbedHtml`'s `transparent` (the page background) is a different thing from
`config.opts.alpha` (the engine's) — setting only the latter ships a "transparent" export on an
opaque black page.

Plan: [plans/2026-08-03-spacetype-embed-adapter.md](superpowers/plans/2026-08-03-spacetype-embed-adapter.md) ·
[plans/2026-08-03-embed-bundle-network-leak.md](superpowers/plans/2026-08-03-embed-bundle-network-leak.md)

## Transparent Video Export — LANDED 2026-07-28

Motion exports can now keep their transparency. The alpha always survived the whole pipeline —
frames render client-side to RGBA PNGs and upload intact — and was discarded at the last step
only because h264/yuv420p cannot carry it. `comfy_extras/nodes_timeline.py` now branches to
`libvpx-vp9` / `yuva420p` / `.webm` when the caller passes `alpha: true`; the h264 default is
byte-identical to before (proven by running the pre-refactor encoder on the same frames).

Six duplicated frontend POST sites collapsed into `lib/engine/encodeVideo.ts`'s `encodeFrames()`,
which derives the file extension from the **server's response** rather than the request — so a
server-side downgrade can never produce a `.mp4`-named WebM. Space Type has a **Transparent
background** toggle, enabled only when a full-pixel scan finds real transparency, and it says
plainly that WebM excludes Safari.

Verified end to end on a real export: `codec vp9 · pix_fmt yuva420p · alpha min 0 · max 255`.

> **Gotcha that will cost you an hour.** Verifying VP9 alpha with the obvious probe gives a
> **false negative**: PyAV auto-selects ffmpeg's native `vp9` decoder, which does not merge
> WebM's `BlockAdditional` alpha side-channel, so a correct file decodes fully opaque. Force the
> `libvpx-vp9` decoder. The working alpha-aware helper is in `tests-unit/sailor_encode_alpha_test.py`.

Only three surfaces render with alpha at all — **Space Type, Compositor, Scene3D**. Shader and
Gradient were measured opaque during the embed work. The toggle is wired for Space Type; the
other two are follow-ups.

Known unknown: `auto-alt-ref` never engaged in this libvpx build even across a 60-frame sweep, so
omitting it is unproven rather than confirmed. First thing to check if alpha ever vanishes on a
long clip.

Spec: [specs/2026-07-28-transparent-video-export-design.md](superpowers/specs/2026-07-28-transparent-video-export-design.md) ·
Plan: [plans/2026-07-28-transparent-video-export.md](superpowers/plans/2026-07-28-transparent-video-export.md)

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

## Compositor — depth of field, and the first local model (landed 2026-07-29)

The first slice of **local inference**: `POST /api/depth/estimate` runs Depth Anything
V2 in-process via transformers.js and caches greyscale depth maps by content hash. No
API call, no per-preview bill. Measured on a 4094² portrait: **3.6 s one-time pipeline
load, 1.1 s inference, 38 ms on a cache hit**; maps are capped at 1024 px on the long
edge because they drive a blur radius, not detail.

That depth drives a **depth-of-field post effect on image layers** — focus, sharp band,
aperture, blade count and rotation, highlight threshold and boost. The blade polygon
*is* the iris, so six blades give hexagonal bokeh and under three a circle.

This also gives the Compositor its **first GPU post stage**. The existing chain is
Canvas 2D and correctly so, but a variable-radius shaped blur is ~700 samples/px —
the wrong machine, not an optimisation problem. `gpuPost.ts` is a small WebGL2 runner
whose output re-enters the 2D chain; DOF is its first inhabitant, and fog, distance
grading and every "by distance" variant of the existing 63 effects want the same stage.

`DofEffect` is routed by `GPU_TYPES`, deliberately disjoint from `CHAIN_TYPES`, so
`applyEffectChain` can never silently skip a type it cannot render. It sits **first** in
the order (`dof → adjust → duotone → bloom → vignette → grain`) because defocus happens
at the lens — putting it last would blur the grain.

**The factory paid out again.** The agent surface needed no code: `sanitizeEffect` is
already driven by `POST_EFFECT_DEFAULTS`/`POST_FX_PARAM_CLAMP`, so declaring the type
made DOF agent-drivable for free. Only the prose hint changed.

**Two bugs only real-GL verification could catch**, both of which produced *plausible*
output. (1) Missing `UNPACK_FLIP_Y_WEBGL`: every result was vertically flipped, and
because colour and depth flipped together the depth stayed correctly aligned — mean abs
diff 23.95 upright vs 3.07 flipped. (2) At 32 taps, samples land ~5 px apart, so each
bokeh disc rendered as a scatter of dots; fixed with a deterministic per-pixel rotation
of the tap spiral (hash of `gl_FragCoord`, stable across frames so bakes don't shimmer)
plus 48 taps. Face local contrast now 0.477 original / 0.472 focused / 0.195 defocused.

Open: **occlusion bleed is mitigated, not solved** — taps are weighted by whether their
own CoC reaches the centre, which softens the dark halo on foreground edges, but the
pixels behind a blurred foreground object were never captured. A correct fix needs layer
separation. Residual sampling speckle at 48 taps. **Not yet driven end-to-end in the
real Compositor UI** — the pass, the panel and the routing are each verified
independently, but nobody has added DOF to a live layer and watched it blur.

## Scene3D — surface relief (landed 2026-07-28)

Scene3D materials had exactly one texture slot, so a brick photo on a cube read as a
sticker. Three producers — a procedural shader effect, an uploaded image, and an AI
tile — now funnel through **one grayscale height field** bound to THREE's `bumpMap`,
which derives the perturbed normal in the fragment shader. No Sobel pass, no
normalisation, no tangent handling. Controls: **Depth · Contrast · Tiling**, plus a
separate `normalImage` slot for real baked tangent-space normal maps. Also landed: a
**Phong** material type, and film grain as the first of the stylised post passes.

**The one thing to know: bump renders the height field's *local gradient*, not its
range.** Every failure in this feature traced to that. Measured across all 63 catalog
effects, the original default scored 5.42 against a catalog median of 6.0 and rendered
identically to no relief; it was swapped for one at 36.8. A flatness guard now warns
below 8 rather than silently doing nothing.

Two design errors worth remembering. The AI path ran its tile through a **depth** model
to dodge baked-in lighting — correct diagnosis, wrong tool, because depth reports scene
*distance* and a flat material sample is all one distance (gradient 3.3, invisible). It
now uses the colour tile the route already generated and was throwing away, which also
halved the cost per generation. And `contrast` was wired to the rebuild key alongside
`invert` — correct for a toggle, wrong for a *slider*, costing 51 material rebuilds per
drag until the final review caught it.

Open: the paid AI generation path has never been run live; Space Type shares
`PostSettings` and now carries pass fields its own UI does not expose.

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

**Vector Type — appearance stack — LANDED 2026-07-28** (commits `00d307f0b`..`7953f8c4b`, 10 tasks; `docs/superpowers/plans/2026-07-28-vector-type-appearance.md`). Multiple fills and multiple strokes as an ordered, Illustrator-style stack, plus **extrude**. Each layer carries a **stable id**, its own `Paint`, anchor, opacity, blend and enabled flag. Array order is paint order, so **a stroke below a fill** is now expressible — measured at 56,350 px of visible fill against 0 px under the old fixed order, where the stroke swallowed the letterform.

**Extrude is real editable vector, not 3D and not a raster** — the same glyph path drawn N times at translated offsets behind the face (`depth`/`angle`/`distance`/`taper`), optionally unioned via paper.js into one solid body. Depth grows ink 11,804 → 61,683 px while the face stays *exactly* 11,092 at every depth. Worst realistic case 3.1 ms/frame, bounded at 2,400 copies with the drop reported rather than silently capped. The union costs ~1.3 ms per copy — 575× drawing — so it is gated to bake and export, proven three independent ways (import graph, sync-vs-async, input type); a memo on the union's own input took a 120-frame bake from 111.5 s to **1.12 s**.

**Stable ids were chosen over positional paths**, and the choice paid: a motion track survives a drag reorder still animating the same layer (cyan 0 → 38,785 px), while the same track written positionally reads 5,741 px at both times — **silently dead**. A Collection binding to a deleted layer bakes byte-identical to no-override rather than hitting a wrong layer. `lib/studio/listRemap.ts` + `idPath.ts` were extracted in the process, ending a copy-paste of the remap logic that Shader Studio had inlined into its `.vue`.

Also: **stroke was already there and merely invisible** — its colour control was `when`-gated behind `strokeWidth`, which defaults to 0. The stack fixes that structurally; a new stroke layer paints 7,055 px immediately without touching a slider.

Open: **a pre-existing paint-box clipping bug**, exposed by canvas-vs-SVG diffing and deliberately left unfixed. `resolvePaint` returns a `no-repeat` pattern, so a `Fill`-form gradient loses 68% of an extrude's ink at the `glyph` anchor, 50% at `word`, and 47% of a 20px gradient stroke. The correct answer differs per fill type (SVG pads gradients but tiles grid/stripes), the line is in `lib/paint/resolve.ts` shared with the Compositor, and the tempting local fix would break canvas/SVG colour parity. Recipe in the task report. Also open: `VectorShape.stroke` is `string | null`, so a gradient *stroke* still flattens to a colour in SVG; and Shader Studio's post-refactor behaviour is verified at module and test level only — ComfyUI was not running, so no live pixel.

**Vector Type — stroked extrude silhouette — LANDED 2026-07-28** (commits `bc75c2d30`..`c445d03cf`, 4 tasks; `docs/superpowers/plans/2026-07-28-extrude-silhouette-stroke.md`). An extrude layer can carry its own stroke: **one outline around the whole extruded body**, not an outline per offset copy. Verified by a seam metric — 0.00% of the silhouette's stroked ink lies inside the body, against 56–83% for a deliberately per-copy control, and 4 strokes against 32.

**The architecture is the interesting part.** A silhouette needs the paper.js union, which costs ~1.3 ms per copy — 575× the cost of drawing one. Rather than reopen the wall that keeps a draw frame off paper.js, the live path **reads** a paper-free body cache and never **triggers** a union; a cold frame draws unstroked and the stroke appears once the body lands, the same posture `resolveField` takes for shader fields. That wall is still load-bearing: adding a bare `import 'paper'` to the new cache module turns the existing import-graph guarantee test red. A rapid drag of 120 real slider events in 129 ms produced **0 unions during the burst and exactly 1 after**, against a control where one union is a 103 ms long task.

`solid` ships as a **stack row**, not a `ControlSpec` — the schema has no boolean kind, and faking one as a `select` would have shipped a toggle that forgets itself on reload. `StudioLayerStack` was extended with one `row-extra` scoped slot rather than forked; Gradient's and Shader's rows are byte-identical.

Open: on an **animated axis**, pausing or scrubbing does not bring the silhouette back — `previewTime` is in neither union trigger, so no body is scheduled for the paused frame. Two task reports claimed otherwise and the final verification pass disproved them. Deliberately unfixed: the one-line watcher would spend that 103 ms block precisely at the moment the user pauses. **Deliverables are unaffected** — SVG and PNG at the same `t` are correctly fused and stroked.

**Vector Type — skew and arc — LANDED 2026-07-28** (commits `f9cd8097b`..`50318329b`, 6 tasks; `docs/superpowers/plans/2026-07-28-vector-type-skew-arc.md`). A whole-run shear, and glyphs placed along a curve with each rotated to the tangent. **Both stay exactly-correct vector** — a shear is affine and rigid placement is affine, so both are legal SVG transforms. 21/21 verification items pass, with canvas-vs-SVG at 0.0000% and deliberately broken controls at 68–100%.

**Arc deliberately does not use paper.js.** It has exactly the right API, but arc placement runs every frame and the guarantee that a draw frame cannot reach paper is load-bearing. A cumulative-chord table plus a binary-search inversion gives spacing 1,600× more even than the naive `t`-uniform mapping `utils/textOnPath.ts` uses (0.0227% spread vs 36.30% on a wave), for ~15 lines and no dependency.

**Rotation broke four downstream assumptions, each measured before it was fixed.** The `glyph` fill anchor diverged canvas-vs-SVG by 76.7% — and *neither* renderer was right, SVG's box being the browser's own second derivation; both now replay the canvas's placed-ink box. The axis-aligned clip window was sliced per letter and, independently of arc, **could not fully open** (22.6% of ink lost at `amount: 0`); it became a generic `VectorWindow` with an optional rotation. The taper pivot lived in **four** places, not the three the handoff predicted. And motion `dx`/`dy` moved in output space rather than the glyph's frame — now local, dropping mask spread across arc angles from 17.0 to 0.4 points, with `rotate === 0` branching so straight runs stay bit-identical.

Open: negative arc past ~−150° collapses the word into its own centre. Proven to be *correct* type-on-path geometry — the placements are exact mirrors — but the slider range and its hint over-promise on the negative side; an Illustrator-style flip is a design decision, not a patch. Skew also carries a ~0.016px rounding residual at the default export precision, converging to exactly 0 at precision 6.

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
- ~~**Paint-box clipping in `resolvePaint`.**~~ **FIXED 2026-07-28** (`9c83a9e1f`). A `Fill` paint now spreads outside its own box when the ink reaches — extrude copies and stroke outsets. 42/42 cases reach SVG parity (losses of 65/47/42/21% → 0%); the Compositor is byte-identical across 48 cases because the default preserves the old behaviour exactly. Residual: per-pixel *colour* outside the box is approximate for `stripes`/`checkerboard`/`grid` (a box-sized tile leaves a phase seam) — the same disagreement those three already show inside the box. Gradients are exact.
- **Negative arc past ~−150° collapses the word.** Geometrically correct (exact mirror placements) but the slider range and hint over-promise; wants an Illustrator-style flip.
- **Gradient strokes flatten in SVG.** `VectorShape.stroke` is `string | null` — it needs a paint-server slot like `fill` has.
- **Paused frames lose the extrude silhouette on an animated axis.** `previewTime` is in neither union trigger, so scrubbing shows the un-fused stack. A config nudge restores it instantly, proving the mechanism. Unfixed by choice — the obvious watcher costs a 103 ms block at the pause. Exports are correct.
- **`useVectorSvg.ts` still degrades silently.** The Compositor's SVG writer collapses every rich fill to a flat representative colour via `paintPrimaryColor` and says nothing — the exact anti-pattern Vector Type's export-tier declaration was built to avoid. Same fix would port.
- **Space Type's live 3D render is unverified** after the `fillTileBox` rounding change. Its fill textures provably never route through that function, and `paintTileBox` (its only exposure) is verified correct — but the on-screen 3D readback could not be captured in the browser pane.
- **`MotionClipInspector`'s timeline path is unverified** for the new preset capability gating — checked at function level only, never driven through the live timeline UI.
- **Gallery cost is unmeasured on a visible window.** 11 outline thumbnails ran 12–16 ms/tick in a hidden pane, which is why `VectorTypeThumb` is used for the axis section only and `PresetThumb` elsewhere.
- **`lib/gsap-kinetic.ts` and `kinetic-presets.ts`'s `build()` closures are orphaned** by the KineticType retirement (the preset catalog itself is still live, read by the Compositor for metadata) — an uncompleted cleanup.
