# Scene3D onto ControlSpec — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Put Scene3D on the ControlSpec system so its parameters become agent-drivable, sweepable and (later) animatable — including everything added on 2026-07-28 (relief Depth/Contrast/Tiling, Phong shininess/specular, six post passes), none of which any capability can currently reach.

**Architecture:** Copy the established pattern. One declarative `SCENE_CONTROLS` list; agent vocabulary and Collection bindables *derived* from it. Per-object parameters use **id-addressed paths** (`objects.<id>.<rest>`) via the existing shared `app/lib/studio/idPath.ts` — the pattern Vector Type already ships.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- **`ControlSpec` lives at `app/lib/spacetype/effect.ts:12-58`.** Nine kinds: `slider | text | textList | fillList | color | select | font | path | curve`. There is **no `switch`/boolean kind** — booleans must be modelled as a two-option `select`, or left out of the schema.
- **Flag semantics are asymmetric and deliberate.** `agent` and `animatable` are **opt-OUT** (absent = granted). `summary` is **opt-IN** (absent = never shown). Do not "helpfully" invert any of these.
- **Control keys are FROZEN once shipped** — persisted Collection bindings are `params.<key>`. Name them carefully the first time.
- **`when` is NOT on `ControlSpec`.** Each studio intersects it locally. Scene3D needs the **two-arg** form, like Vector Type: `when?: (doc: SceneDoc, obj?: SceneObject) => boolean`.
- **`app/lib/scene3d/controls.ts` must be free of `three` imports** — the Collection resolver dynamically imports it (`app/lib/collection/studioControls.ts:3-11` explains why). Task 0 makes that possible.
- **Bindability is derived from `kind`**, not declared: `slider→number`, `color→color`, `select→select`, `text|textList→text`, `font→font`, everything else **not bindable** (`app/lib/collection/studioBindables.ts:15-26`).
- Unit tests live flat in `frontend/tests/unit/<kebab>.unit.spec.ts`. Aliases `~/`→`frontend/app/`, `~~/`→`frontend/`. Run `npx vitest run <file>` from `frontend/`; `npm run test` is Playwright.
- ~106 files are modified by concurrent sessions. Stage only your own paths explicitly; isolate with `git apply --cached` where a file carries foreign hunks. Never `git add -A`, never `git stash`.

## Scope decisions made before planning

**The inspector UI is NOT rewritten in this plan.** `Scene3DStudioSurface.vue` keeps its hand-written controls. This follows Gradient's own precedent (`app/lib/gradientfx/controls.ts:9-10`: *"The inspector UI will derive from it in a follow-on change; today it is still hand-written"*). The capability gain — agent, sweeps, motion — comes entirely from the schema. Swapping 2,563 lines of working panel to `StudioControlPanel` is cosmetic risk with no capability payoff and belongs in its own change.

**Object transform (position/rotation/scale) is declared for the agent but NOT animatable.** Scene3D already animates transforms through its own `ObjectMotion` preset system (`app/lib/scene3d/motion/`), which composes deltas onto the home transform. Adding path-tracks for the same properties would have two systems fighting over one value. Mark them `animatable: false` and say why in the schema.

**Motion targets are Task 4 and may not be reached.** Tasks 0–3 are independently valuable and shippable: they deliver agent control and Collection sweeps. Motion is additive on top.

---

### Task 0: Make `scene3d/config.ts` three-free

**Why:** `controls.ts` must not pull in `three`, but it wants `SceneDoc`/`SceneObject` types and the `MATERIAL_DEFAULTS` values from `config.ts`. Today `config.ts` imports `DEFAULT_POST` — a **value** — from `app/lib/spacetype/post.ts`, which imports `three` and the whole `EffectComposer` stack. I verified this is the **only** three-dragging import in `config.ts`'s graph (`primParams`, `motion/types` and `fillTile` are all clean).

**Files:**
- Create: `frontend/app/lib/spacetype/postSettings.ts`
- Modify: `frontend/app/lib/spacetype/post.ts`, `frontend/app/lib/scene3d/config.ts`
- Test: `frontend/tests/unit/post-settings.unit.spec.ts` (exists — update its import)

- [ ] **Step 1:** Move `DEFAULT_POST` and `postEnabled` out of `post.ts` into a new three-free `postSettings.ts`. Both are plain data/logic with no `three` dependency. Re-export them from `post.ts` so every existing importer keeps working unchanged.
- [ ] **Step 2:** Point `config.ts` at the new module.
- [ ] **Step 3:** Verify no `three` remains in `config.ts`'s import graph — walk the imports by hand and state the result in your report. There is no automated guard for this; it is a discipline the Collection resolver depends on.
- [ ] **Step 4:** Run `npx vitest run tests/unit/post-settings.unit.spec.ts tests/unit/scene3d-config.unit.spec.ts` and the scene3d suite. Commit.

---

### Task 1: `scene3d/controls.ts` — the schema

**Files:**
- Create: `frontend/app/lib/scene3d/controls.ts`
- Test: `frontend/tests/unit/scene3d-controls.unit.spec.ts`

**Model it on `app/lib/shapefx/controls.ts`** — read that first. It is the better of the two references because its `default` values come from the real config defaults rather than being inert.

- [ ] **Step 1: Write the failing test.** Assert: every control has a non-empty `key`, `label`, `group`; every `group` appears in `SCENE_SECTIONS`; keys are unique; every slider's `default` sits within its `min`/`max`; and slider defaults match `MATERIAL_DEFAULTS` where one exists (this is the anti-drift guard Shape gets for free).
- [ ] **Step 2:** Run it, confirm it fails.
- [ ] **Step 3: Write the schema.**
  - `SceneControl = ControlSpec & { when?: (doc: SceneDoc, obj?: SceneObject) => boolean }`
  - `SCENE_SECTIONS` allow-list — ordering AND filter; a control whose `group` is absent is silently dropped.
  - `object.` as the **relative prefix** for per-object controls, mirroring Gradient's `layer.`.
  - Cover, at minimum:
    - **Material:** `object.material.color`, `.roughness`, `.metalness`, `.type` (select over `MATERIAL_TYPES`), the physical block (`clearcoat`, `clearcoatRoughness`, `sheen`, `sheenColor`, `emissive`, `emissiveIntensity`, `opacity`, `iridescence`, `envMapIntensity`), Phong's `shininess`/`specular`, and **relief** (`object.material.relief.scale`, `.contrast`, `.tiling`).
    - **Lighting:** `lighting.preset`, `.sunAzimuth`, `.sunElevation`, `.sunIntensity`, `.ambient`.
    - **Camera:** `camera.fov`.
    - **Post:** the effect toggles are booleans and there is no boolean kind — model each as a two-option `select` (`'on'|'off'`) or omit and expose only their numeric parameters. **Pick one, apply it consistently, and write down which and why.**
  - **Transform** (`object.position.*` etc.): declare with `animatable: false` and a comment explaining that `ObjectMotion` owns transforms.
  - Add a **"deliberately NOT here"** comment block listing what the schema does not own (GLB url, modifier stack, light widgets, per-object motion presets), the way `shapefx/controls.ts:15-18` does.
  - `visibleSceneControls(doc, activeObject?)` — the single gate everything downstream derives from.
- [ ] **Step 4:** Confirm the file imports **no** `three` (type-only imports from `config.ts` are fine and erase at compile time).
- [ ] **Step 5:** Run the test; commit.

---

### Task 2: `scene3d/agentControls.ts` — derive agent + bindables

**Files:**
- Create: `frontend/app/lib/scene3d/agentControls.ts`
- Test: `frontend/tests/unit/scene3d-agent-controls.unit.spec.ts`

**Copy `app/lib/vectortype/agentControls.ts:59-169` closely** — read its doc comment at `:59-89` first; it is the clearest statement in the repo of why id-addressing matters (*"an agent key is a promise about which layer it edits, and a positional one cannot keep it"*).

- [ ] **Step 1: Write the failing test.** Assert: `stripMeta` removes exactly `when`/`agent`/`animatable`/`summary` and nothing else; `agent: false` controls are excluded; `sceneStackControls` emits `objects.<id>.<rest>` for each object; an object with a missing/empty/dotted/all-digit id is **skipped, not positionally addressed**; and bindables include only absolute paths, never relative `object.*`.
- [ ] **Step 2:** Run it, confirm it fails.
- [ ] **Step 3: Implement.**
  - `stripMeta` — the exact four-field strip.
  - `sceneStackControls(doc)` — for each `object.`-prefixed control, iterate `doc.objects`, run `when(doc, obj)` **per object**, emit `{ ...spec, key: 'objects.<id>.<rest>', label: '<objectName> · <label>' }`. Refuse unsafe ids.
  - `sceneAgentControls(doc)` — ships **both** namespaces: relative `object.*` (follows selection: "make *this* one rougher") and absolute `objects.<id>.*` ("make the sphere rougher").
  - `sceneBindableControls(doc)` — **absolute only**. A persisted binding must not mean "whichever object happened to be selected".
  - Add the `shaderFill` derive-branch: when a material's type is `'shaderFill'`, append `SHADER_FILL_CONTROLS` + `derivedShaderFillControls(effectDef, ...)`, mirroring `shapefx/agentControls.ts:33-41`.
  - `SCENE_GUIDANCE` prose, co-located.
- [ ] **Step 4:** Run the test; commit.

---

### Task 3: Register Scene3D in the four registries

**Files:** `frontend/app/lib/agent/capabilities.ts`, `frontend/app/lib/agent/studioTune.ts`, `frontend/app/lib/collection/studioControls.ts`

- [ ] **Step 1:** Add a `STUDIO_TUNERS` entry with a `PatchAdapter` — `read` (returns `{ config, controls }`), `params` (a `makeConfigParams` proxy with **`listKey: 'objects'`** — `app/lib/agent/configParams.ts:51` already takes it as a parameter), `write`, `clone`, `label`, `guidance`. Model on Shape's at `studioTune.ts:368-388`, since Scene3D's persisted blob is also a wrapper rather than a bare config.
- [ ] **Step 2:** Add a `controlsForStudio` case (`studioControls.ts:134-144`). **Keep the import dynamic and inside the function body** — that is deliberate, so `mapControlSpecToDesc` stays importable from a node unit spec without dragging in `three`.
- [ ] **Step 3:** Add a `STUDIOS`/`AGENT_CAPABILITIES` entry (`capabilities.ts:274-315`).
- [ ] **Step 4: Check `FRONTEND_ONLY_NODE_TYPES` (`capabilities.ts:336-341`) — this one is a trap.** A frontend-only node missing from that set **aborts the entire Run** with `"Node 'X' has no class_type"`. Determine whether Scene3D's node type is already covered (it may be relying on a separate wildcard-output list in `VueNodeCanvas.vue`) and state what you found. Fix if needed.
- [ ] **Step 5:** Run the collection + agent unit suites; commit.

---

### Task 4: Motion targets (may not be reached — additive)

Scene3D's existing `ObjectMotion` is a **preset/envelope** system (`loop: {kind:'bob', speed, amount}`), structurally unlike path-tracks. The two are **orthogonal, not conflicting** — Vector Type is the precedent for running both, and explicitly skips its stagger namespace inside `applyMotion` rather than relying on a guard.

- [ ] `animatableTargets(doc)` emitting `objects.<id>.<rest>` for sliders that are not `animatable: false`.
- [ ] A path-track list alongside `ObjectMotion`; route through `setByIdPath` in a new branch of `applyMotionToDoc`.
- [ ] **Explicitly skip the `motion.` sub-namespace** so ControlSpec tracks can never target `objects.<id>.motion.*` and collide with the preset system.
- [ ] Preserve `applyMotion`'s universal invariant: guard on the **parent container** existing, never the leaf — a missing parent would make `setByIdPath` fabricate structure the renderer reads as real config and then saves.

## Final verification

- [ ] `scene3d/controls.ts` imports no `three` (hand-walk the graph).
- [ ] A characterization snapshot pins the agent vocabulary, mirroring `gradientfx-controls.unit.spec.ts.snap` — so a future edit that silently widens or narrows what the agent can touch fails loudly.
- [ ] Control keys are stable and documented as frozen.
- [ ] Existing Scene3D suites still pass — the schema is additive and must not change rendering.
