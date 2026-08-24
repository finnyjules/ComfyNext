# Derived Inspector Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the hand-written inspector markup of Gradient Studio (all Design sections) and 3D Studio (Transform/Material/Camera/Lighting/Background) and render those sections from the studios' existing `ControlSpec` schemas via the shared `StudioControlPanel`, with pixel/behavior parity.

**Architecture:** Both surfaces already run `StudioControlPanel` for post-effects (`order: POST_SECTIONS`) with a dotted-path proxy read/write. The retrofit widens `order` to the full design-section list, adds two small generic panel capabilities (per-control `bindable: false`, per-section badge/open chrome), reconciles each schema to the shipped panel truth first (characterization test), then swaps the template. Bespoke editors (stops editor, mesh points, object tree, etc.) mount through the panel's existing `#control-<key>` / `#section-<Title>` slots or stay outside the panel.

**Tech Stack:** Vue 3.5 + TS, vitest (unit, `cd frontend && npx vitest run <file>`), existing schemas `GRADIENT_CONTROLS` (`app/lib/gradientfx/controls.ts`), `SCENE_CONTROLS` (`app/lib/scene3d/controls.ts`), shared panel `app/components/vue-canvas/studio/StudioControlPanel.vue` + `StudioSectionTree.vue` + `app/lib/studio/sections.ts`.

## Global Constraints

- Parity is the contract: the migrated panel must show the same rows, ranges, labels, gating and bindability the hand-written panel shows today. Where schema and template disagree, THE TEMPLATE WINS (it is shipped truth); reconcile the schema, never the visible behavior.
- Persisted keys are FROZEN (Collection bindings are `params.<key>`): never rename a `key`.
- Pinned characterization snapshots (agent grants `gradientfx-controls.unit.spec.ts.snap`, animatable target sets, scene3d equivalents) may change ONLY for the two deliberate Scene3D switch additions (Task 5), each called out in its own commit.
- Typecheck baseline: `cd frontend && npx nuxt typecheck 2>&1 | tail -3` — ~328 pre-existing errors; no NEW errors naming files this plan touches (per typecheck-baseline-anchoring: an error naming a type this feature introduces is not pre-existing).
- Commit hygiene: stage ONLY files this plan touches (parallel sessions may dirty the tree — never `git add -A`).
- Vue 3.5: `v-if` and `v-for` can't share a node the way you'd expect; string refs in v-for don't give element arrays. Follow existing component patterns.
- Do not restart or kill any running dev server unless a task says to (other sessions' servers may be up; use `./dev.sh` semantics only in the live-verify task).

---

### Task 1: Shared panel extensions — `bindable: false` meta + per-section chrome

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts` (ControlMeta: add `bindable?: false`)
- Modify: `frontend/app/components/vue-canvas/studio/StudioSectionTree.vue` (honor it; accept + apply section chrome)
- Modify: `frontend/app/components/vue-canvas/studio/StudioControlPanel.vue` (new optional `sections` prop, threaded down)
- Test: `frontend/tests/unit/studio-control-panel-chrome.unit.spec.ts` (new)

**Interfaces:**
- Produces: `ControlMeta.bindable?: false` (schema-level opt-out of the bind/promote affordance); `StudioControlPanel` prop `sections?: Record<string, { badge?: string; open?: boolean }>` — keys are section TITLES (the `group` path's last segment as rendered), applied by `StudioSectionTree` to `StudioSection`'s existing `badge`/`open` props. Both optional; omitted = today's behavior exactly.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/studio-control-panel-chrome.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StudioControlPanel from '~/components/vue-canvas/studio/StudioControlPanel.vue'
import type { ControlSpec } from '~/lib/spacetype/effect'

const CONTROLS: ControlSpec[] = [
  { key: 'a', label: 'Alpha', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0, group: 'One' },
  { key: 'b', label: 'Beta', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0, group: 'Two', bindable: false } as ControlSpec,
]

function mountPanel(sections?: Record<string, { badge?: string; open?: boolean }>) {
  return mount(StudioControlPanel, {
    props: { controls: CONTROLS, order: ['One', 'Two'], value: () => 0, ...(sections ? { sections } : {}) },
  })
}

describe('StudioControlPanel chrome', () => {
  it('bindable:false reaches StudioRow (no bind affordance)', () => {
    const w = mountPanel()
    const rows = w.findAllComponents({ name: 'StudioRow' })
    expect(rows).toHaveLength(2)
    expect(rows[0]!.props('bindable')).toBe(true)
    expect(rows[1]!.props('bindable')).toBe(false)
  })
  it('sections prop sets badge and open on the matching StudioSection', () => {
    const w = mountPanel({ One: { badge: 'both layers', open: false } })
    const sections = w.findAllComponents({ name: 'StudioSection' })
    expect(sections[0]!.props('badge')).toBe('both layers')
    expect(sections[0]!.props('open')).toBe(false)
    expect(sections[1]!.props('open')).toBe(true) // default unchanged
  })
})
```

Adjust prop names in the assertions to StudioSection's REAL prop names after reading `frontend/app/components/vue-canvas/StudioSection.vue` (it already renders `title` and supports `badge`/`open` — verify exact names first; if badge is a slot not a prop, assert rendered text instead: `expect(sections[0]!.text()).toContain('both layers')`).

- [ ] **Step 2: Run it, expect failure**

Run: `cd frontend && npx vitest run tests/unit/studio-control-panel-chrome.unit.spec.ts`
Expected: FAIL — second row's `bindable` is `true` (kind-derived), and `sections` is an unknown prop.

- [ ] **Step 3: Implement**

In `effect.ts`, inside `ControlMeta`, add (matching the doc-comment style of neighbors):

```ts
  /** Opt this control out of Collection binding/promotion in the panel UI, even
   *  though its kind is bindable. Schema-level twin of the hand-written panels'
   *  `:bindable="false"` rows (Gradient's Shape section). Motion/agent are NOT
   *  affected — use `animatable`/`agent` for those. */
  bindable?: false
```

In `StudioSectionTree.vue`: change the StudioRow `:bindable` binding to
`:bindable="c.bindable !== false && controlKindToVariableType(c.kind) !== null"`,
add a `sections?: Record<string, { badge?: string; open?: boolean }>` prop, pass it to the recursive child instances, and apply on the root `StudioSection`:
`:open="toggle ? value(toggle.key) === true : (sections?.[section.title]?.open ?? true)"` plus `:badge="sections?.[section.title]?.badge"` (or the badge slot equivalent if badge is a slot). `sectionToggle` keeps priority over chrome `open`.

In `StudioControlPanel.vue`: add the same optional `sections` prop and forward it to each `StudioSectionTree`.

- [ ] **Step 4: Run test, expect pass** — same command, all green. Also run the panel's existing specs: `npx vitest run tests/unit --silent -t "StudioControlPanel"` (and `git grep -l "StudioSectionTree\|StudioControlPanel" frontend/tests/unit` — run every hit).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts frontend/app/components/vue-canvas/studio/StudioSectionTree.vue frontend/app/components/vue-canvas/studio/StudioControlPanel.vue frontend/tests/unit/studio-control-panel-chrome.unit.spec.ts
git commit -m "feat(studio): panel chrome — schema bindable:false + per-section badge/open"
```

---

### Task 2: Gradient — characterization spec + schema reconciliation

**Files:**
- Test: `frontend/tests/unit/gradient-panel-parity.unit.spec.ts` (new)
- Modify: `frontend/app/lib/gradientfx/controls.ts` (reconcile to template truth; add `bindable: false` to Shape rows; add when-gated duplicate entries for dynamic-label rows)
- Reference (read-only): `frontend/app/components/vue-canvas/GradientStudioSurface.vue:986-1613` — the hand-written sections being characterized.

**Interfaces:**
- Consumes: `groupIntoSections` (`~/lib/studio/sections`), `visibleGradientControls(cfg)` (`~/lib/gradientfx/controls`), `defaultGradientConfig`-equivalent (find the exported default factory in `~/lib/gradientfx/*` — grep `export function default` / `presets.ts`).
- Produces: a passing parity spec that Task 3's template swap must keep green; a reconciled `GRADIENT_CONTROLS` whose visible rows at any config state match the old template 1:1.

- [ ] **Step 1: Build the expectation table from the template (mechanical, no judgment)**

For EACH hand-written control row in `GradientStudioSurface.vue` lines 986–1613 (sections Canvas, Color, Curve, Flow, Depth & light, Liquid surface, Mesh, Relief, Focus, Layer, Shape — skip bespoke rows: the stops list at ~1088-1110, mesh point rows at ~1390-1400, the aspect `<select>`'s custom preview, preset gallery, Motion, Export), record: `key` (from `boundColumnFor('<key>')` or `control-key`), label, min/max/step or options, `:bindable="false"` presence, and the section + its `v-if`/`v-show` condition. Write them into the spec as a literal array. Example rows (already extracted, use these verbatim):

```ts
// frontend/tests/unit/gradient-panel-parity.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { GRADIENT_CONTROLS, GRADIENT_SECTIONS, visibleGradientControls } from '~/lib/gradientfx/controls'
import { groupIntoSections } from '~/lib/studio/sections'

/** One row of the OLD hand-written panel, captured 2026-08-24 before deletion.
 *  THIS TABLE IS THE PARITY CONTRACT — do not edit it to make the test pass;
 *  edit the schema. */
interface OldRow { section: string; key: string; label: string; min?: number; max?: number; step?: number; options?: string[]; bindable?: false }

const OLD_PANEL: Array<{ state: string; mutate: (c: any) => void; rows: OldRow[] }> = [
  {
    state: 'linear (default)',
    mutate: () => {},
    rows: [
      { section: 'Canvas', key: 'canvas.aspect', label: 'Aspect ratio', options: undefined /* fill from ASPECTS */ },
      { section: 'Canvas', key: 'canvas.layout', label: 'Layout' },
      { section: 'Canvas', key: 'canvas.margin', label: 'Margin', min: 0, max: 0.45, step: 0.01 },
      { section: 'Canvas', key: 'canvas.background', label: 'Background' },
      { section: 'Gradient', key: 'layer.ramp.angle', label: 'Angle', min: 0, max: 360, step: 1 },
      { section: 'Flow', key: 'flow.angle', label: 'Flow angle', min: 0, max: 360, step: 1 },
      { section: 'Flow', key: 'flow.speed', label: 'Flow speed', min: 0, max: 100, step: 1 },
      // ... EVERY visible row in this state, in panel order
    ],
  },
  { state: 'radial', mutate: (c) => { c.canvas.layout = 'radial' }, rows: [ /* Center X/Y + Inner radius appear, ramp.angle disappears */ ] },
  { state: 'liquid', mutate: (c) => { c.canvas.layout = 'liquid' }, rows: [ /* + Depth & light + Liquid surface sections */ ] },
  { state: 'mesh',   mutate: (c) => { c.canvas.layout = 'mesh' },   rows: [ /* + Mesh sliders (softness/contrast/blur/drift) */ ] },
  { state: 'banded (bands)', mutate: (c) => { c.canvas.layout = 'bands' /* use the real banded layout id from LAYOUTS */ }, rows: [ /* Shape section rows, ALL bindable:false, incl. Count 2..64 */ ] },
  { state: 'banded (stack)', mutate: (c) => { c.canvas.layout = 'stack' }, rows: [ /* 'Ring count' 2..40 variant + Rotation/ring, Pivot, Disc size */ ] },
]

function panelRows(cfg: any): Array<{ section: string; c: any }> {
  const visible = new Set(visibleGradientControls(cfg).map((c) => c.key))
  const DESIGN_ORDER = GRADIENT_SECTIONS.filter((s) => !s.startsWith('post') /* keep non-post design sections; confirm exact POST_SECTIONS exclusion */)
  const tree = groupIntoSections(GRADIENT_CONTROLS as any[], DESIGN_ORDER, (c: any) => visible.has(c.key))
  const out: Array<{ section: string; c: any }> = []
  const walk = (nodes: any[], title?: string) => nodes.forEach((n) => { n.controls.forEach((c: any) => out.push({ section: title ?? n.title, c })); walk(n.sections, n.title) })
  walk(tree)
  return out
}

describe('Gradient panel parity (old hand-written panel is the contract)', () => {
  for (const scenario of OLD_PANEL) {
    it(scenario.state, async () => {
      const { /* default config factory */ } = await import('~/lib/gradientfx/presets')
      const cfg = /* build default config */ null as any
      scenario.mutate(cfg)
      const got = panelRows(cfg)
      for (const row of scenario.rows) {
        const hit = got.find((g) => g.c.key === row.key)
        expect(hit, `row ${row.key} missing in state ${scenario.state}`).toBeTruthy()
        expect(hit!.c.label).toBe(row.label)
        if (row.min !== undefined) { expect(hit!.c.min).toBe(row.min); expect(hit!.c.max).toBe(row.max); expect(hit!.c.step).toBe(row.step) }
        if (row.options) expect(hit!.c.options).toEqual(row.options)
        if (row.bindable === false) expect(hit!.c.bindable).toBe(false)
      }
      // no two visible controls share a key (duplicate-entry gating must be exclusive)
      const keys = got.map((g) => g.c.key)
      expect(new Set(keys).size).toBe(keys.length)
    })
  }
})
```

Fill EVERY `rows` array completely from the template — that extraction is this task's core work. Resolve the real layout ids from `LAYOUTS` in `~/lib/gradientfx/types.ts` and the real default-config factory before writing (`grep -n "banded\|isBanded\|isStack" app/lib/gradientfx/*.ts`).

- [ ] **Step 2: Run, expect failures** — `npx vitest run tests/unit/gradient-panel-parity.unit.spec.ts`. Expected mismatches to fix IN THE SCHEMA (template wins): Shape rows lack `bindable: false`; the Shape dynamic rows ('Count' 2–64 vs 'Ring count' 2–40, 'Randomness' vs 'Jitter', plus stack-only Rotation/ring, Pivot, Disc size and bands-only Peaks/Wave phase/Detail/Scrub/Valley) need when-gated entries; any label/bounds drift (e.g. check `layer.color.steps` 'Posterize steps' 0–24, `flow.*` bounds) — correct the schema entry to the template's values.

- [ ] **Step 3: Reconcile the schema.** For dynamic rows use same-key duplicate entries with complementary `when:` (both `agent: false, bindable: false` like their section siblings), e.g.:

```ts
  slider('layer.shape.count', 'Count', 2, 64, 1, 'Shape', undefined, { agent: false, bindable: false, when: (c) => isBanded(c) && !isStack(c) }),
  slider('layer.shape.count', 'Ring count', 2, 40, 1, 'Shape', undefined, { agent: false, bindable: false, when: isStack }),
```

CAUTION: duplicate keys must stay invisible to the agent and motion (both entries `agent: false`; Shape sliders' animatable status must not change — check the animatable-target snapshot stays identical). If a duplicate key breaks `defaultsFromControls` or any consumer that builds a keyed map, gate at the CONSUMER-visible layer instead: keep ONE schema entry (2–64) and give the surface a `#control-layer.shape.count` slot in Task 3 rendering the old dynamic row. Decide by running the full unit suite after the change: `npx vitest run tests/unit --silent 2>&1 | tail -5`.

- [ ] **Step 4: All green + snapshots untouched.** `npx vitest run tests/unit/gradient-panel-parity.unit.spec.ts tests/unit/gradientfx-controls.unit.spec.ts tests/unit/gradientfx-motion-path.unit.spec.ts` — parity passes, the two pinned snapshots UNCHANGED (agent/motion sets must not gain or lose entries; `bindable` is stripped by `gradientAgentControls`'s meta-strip — verify it strips the new field, extend the `.map(({ when, agent, animatable, summary, ...spec })` destructure with `bindable`).

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/unit/gradient-panel-parity.unit.spec.ts frontend/app/lib/gradientfx/controls.ts frontend/app/lib/gradientfx/agentControls.ts
git commit -m "test(gradient): panel parity contract + schema reconciled to shipped panel truth"
```

---

### Task 3: Gradient — template swap

**Files:**
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue` (replace lines ~986–1613's hand-written sections with one widened `StudioControlPanel`; keep bespoke blocks; delete dead proxies)
- Test: existing `tests/unit/gradient-panel-parity.unit.spec.ts` must stay green; typecheck must not regress.

**Interfaces:**
- Consumes: Task 1's `sections` prop + `bindable` meta; Task 2's reconciled schema. Existing in-file: `paramsProxy`, `onEdit`, `boundColumnFor`, `promote`, `openVarMenu`, `visibleGradientControls`, `postControlVisible`, `setPostControl`.
- Produces: a single `StudioControlPanel` rendering Design+post sections; bespoke rows via `#control-<key>` slots.

- [ ] **Step 1: Widen the existing post panel invocation** (at ~line 1662) instead of adding a second panel. `order` becomes the design sections + POST_SECTIONS (use `GRADIENT_SECTIONS` which already appends POST_SECTIONS — confirm and reuse). Replace `:visible="postControlVisible"` with a merged predicate and the generic setter:

```ts
// script: one visible predicate for the whole panel (design when + showIf + post rules)
const visibleKeys = computed(() => new Set(visibleGradientControls(config.value).map((c) => c.key)))
function designControlVisible(c: GradientControl): boolean {
  if (String(c.group).startsWith(/* post groups */)) return postControlVisible(c)  // keep exact existing post logic
  if (!visibleKeys.value.has(c.key)) return false
  if ((c as any).when && !(c as any).when(config.value)) return false               // duplicate-key twin selection
  return true
}
function setControl(key: string, v: string | number | boolean) {
  paramsProxy[key] = v
  onEdit(key, v)
}
```

(If `visibleGradientControls` already applies `when` per entry — read it — drop the double check; the duplicate-key twins need per-ENTRY evaluation, which a key-set can't express: in that case make `designControlVisible` evaluate `c.when?.(config) ?? true` directly plus `showIfVisible` via the shared helper, mirroring `visibleGradientControls`'s body per-entry.)

Section chrome map, from the old template's badges/open states:

```ts
const sectionChrome = computed(() => ({
  Canvas: { badge: 'both layers' },
  Colours: { badge: isMesh.value ? 'mesh palette' : (layerNames.value[activeLayer.value] ?? `Layer ${activeLayer.value + 1}`) },
  Curve: { open: true },
  Flow: { badge: 'all layouts', open: isLiquid.value || isMesh.value },
  Liquid: { badge: 'liquid', open: true },
  Mesh: { badge: 'layer 1', open: true },
  Relief: { open: false },
  Focus: { badge: 'both layers', open: false },
  Layer: { open: false },
  Shape: { badge: layerNames.value[activeLayer.value] ?? `Layer ${activeLayer.value + 1}` },
}))
```

NOTE the old panel had TWO section titles that differ from schema group names ('Color' vs 'Colours', 'Depth & light'/'Liquid surface' vs 'Liquid'). The schema's group names win on screen ONLY if identical rendering is preserved — they are not, so either (a) rename the GROUPS' display by splitting order paths, or (b) accept the schema titles. Choose (b) ONLY for 'Colours'→ acceptable? NO — parity is the contract: use nested-path groups to reproduce the old two liquid sections (`'Liquid/Depth & light'`-style paths) or rename the schema group strings to the old on-screen titles ('Color', 'Depth & light', 'Liquid surface') — group strings are NOT persisted keys, renaming is safe (check `GRADIENT_SECTIONS` + `GRADIENT_GUIDANCE` prose for group-name references and update them together). Update the Task 2 parity spec's section names accordingly BEFORE the swap so the contract pins the on-screen truth.

- [ ] **Step 2: Move bespoke rows into slots on that panel** — the colour-stops editor (old ~1088–1110) as `<template #control-layer.colorStops>` (use the REAL Colours-group key from the schema — `grep -n "group: 'Colours'" app/lib/gradientfx/controls.ts`), the mesh add/remove point rows as `#control-layer.mesh.softness`-adjacent? NO — points editor precedes the sliders: use `#section-Mesh`-prepend if the tree supports section slots, else keep the Mesh points block as its own small `StudioSection` ABOVE the panel (allowed: bespoke blocks may stay outside). Same decision for the Gradient section's aspect-preview `<select>` (custom preview markup): keep as `#control-canvas.aspect` slot preserving the current markup verbatim.

- [ ] **Step 3: Delete** the replaced hand-written sections (Canvas, Color, Curve, Flow, Depth & light, Liquid surface, Mesh sliders, Relief, Focus, Layer, Shape) and now-dead script proxies — candidates: `flowSpeed`, `flowGloss`, `flowProxy` family (`flowSwirl`, `flowVeins`, `flowVeinScale`, ...), `centerX`/`centerY`, `onRamp`/`onCurve`/`onColor` (delete ONLY if no surviving code references them — `grep -n` each before deleting; the curve-handles overlay and canvas-click handlers may share them). Keep Motion, Export, preset gallery, layer stack untouched.

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/gradient-panel-parity.unit.spec.ts tests/unit --silent 2>&1 | tail -5` (full unit suite; per vitest-counts-lie memory, check `uptime` load and re-run if counts look absurd); `npx nuxt typecheck 2>&1 | tail -3` vs baseline; Vite compile check per sailor-dev-environment memory (curl the dev-server page if one is running, else `npx nuxt build --dry-run` equivalent — skip if no cheap check exists).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/GradientStudioSurface.vue frontend/app/lib/gradientfx/controls.ts frontend/tests/unit/gradient-panel-parity.unit.spec.ts
git commit -m "feat(gradient): inspector drawn from GRADIENT_CONTROLS — hand-written sections deleted"
```

---

### Task 4: Scene3D — schema additions (`object.material.unlit`, `showFloor`)

**Files:**
- Modify: `frontend/app/lib/scene3d/controls.ts`
- Test: extend the existing scene3d controls unit spec (`git grep -l "SCENE_CONTROLS" frontend/tests/unit` — add cases there) or new `frontend/tests/unit/scene3d-controls-switches.unit.spec.ts`

**Interfaces:**
- Produces: two new `switch` entries — `{ key: 'object.material.unlit', label: 'Unlit', kind: 'switch', default: false, group: 'Material', when: <same gate as the template's matUnlit row — material types that support it; read Scene3DStudioSurface.vue:4220's enclosing v-if> }` and `{ key: 'showFloor', label: 'Floor', kind: 'switch', default: true, group: 'Background' }` (create the `'Background'` group; add it to the Scene3D order list Task 5 introduces). Template rows for roughness/metalness at 4222–4223 are gated `v-if="!matUnlit"` — express as `showIf: { key: 'object.material.unlit', equals: false }` on those two EXISTING schema entries IF their material-type `when` gates coexist cleanly (showIf and when compose with AND); verify in the test.
- Consumes: nothing new. NOTE: `bgTransparent` was in the spec but is NOT a doc leaf (stateful proxy over `doc.background === 'transparent'` with last-colour memory, Scene3DStudioSurface.vue:475-483) — it stays a bespoke row; deviation from spec, reason recorded here.

- [ ] **Step 1: Failing test** — assert both keys resolve on a default doc through the same dotted-path machinery sweeps use, and that the agent vocabulary now includes them:

```ts
it('new switches resolve on the doc and reach the agent', () => {
  const keys = SCENE_CONTROLS.map((c) => c.key)
  expect(keys).toContain('object.material.unlit')
  expect(keys).toContain('showFloor')
  // defaults resolve on a real doc: defaultDoc().showFloor === true, DEFAULT_MATERIAL.unlit === false
})
```

- [ ] **Step 2: Run, expect fail.** — `npx vitest run tests/unit/scene3d-controls-switches.unit.spec.ts`
- [ ] **Step 3: Add the two entries** (+ `showIf` on roughness/metalness if compose-clean). Run scene3d snapshot specs; the agent-grant snapshot changes — UPDATE IT DELIBERATELY (`npx vitest run <spec> -u`) and eyeball the diff contains exactly the two new keys and nothing else.
- [ ] **Step 4: Full scene3d unit specs green.** `npx vitest run tests/unit --silent -t scene3d 2>&1 | tail -5`
- [ ] **Step 5: Commit** — message calls out the deliberate grant:

```bash
git add frontend/app/lib/scene3d/controls.ts frontend/tests/unit/scene3d-controls-switches.unit.spec.ts <updated snapshots>
git commit -m "feat(scene3d): unlit + showFloor join the schema — deliberate agent/sweep grant (2 keys)"
```

---

### Task 5: Scene3D — characterization + template swap (Transform / Material / Camera / Lighting / Background)

**Files:**
- Test: `frontend/tests/unit/scene3d-panel-parity.unit.spec.ts` (new; same shape as Task 2's)
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (sections at 3713–3771 Transform, 3971–4353 Material, 4430–4436 Camera, 4438–4451 Lighting, 4453–4462 Background), `frontend/app/lib/scene3d/controls.ts` (reconciliation only if parity finds drift)

**Interfaces:**
- Consumes: Task 1 chrome + bindable meta; Task 4 entries; existing `visibleSceneControls(doc, obj)`, the surface's post wiring `readPost`/`setPost` (line ~4477) as the read/write pattern to generalize (`readControl`/`setControl` over the same dotted proxy).
- Produces: those five sections rendered by ONE `StudioControlPanel` (order: `['Transform','Geometry?NO','Material','Camera','Lighting','Background', ...POST_SECTIONS]` — Geometry stays hand-written); bespoke Material rows (harmony palette grid, gradient ramp editor, texture/normal-map pickers, matOverride switch header, shader-fill editor) via `#control-<key>` slots or their own retained blocks.

- [ ] **Step 1: Characterization spec.** Same literal-table pattern as Task 2, states: primitive selected × material types (standard, physical/glass, phong, toon, fresnel, palette, gradient, opal — read `MATERIAL_TYPES`), GLB selected (matOverride on/off), nothing selected (doc sections only: Camera/Lighting/Background). Pin rows from the template lines listed above (Material rows already extracted in the recon: roughness/metalness 0–1 step .01; clearcoat pair; sheen; emissiveIntensity 0–5 step .05; opacity; transmission; ior 1–2.33; thickness 0–2 step .05; dispersion 0–5 step .05; attenuationDistance 0–10 step .1; iridescence pair; envMapIntensity 0–3 step .05; shininess 0–200 step 1; toonSteps 2–5; fresnelPower 1–8 step .1; palette hue/sat/light; gradient yaw/pitch/offset/spread; opal quintet; relief scale/contrast/tiling; unlit-gated roughness/metalness; Transform 9 axes; Camera fov 15–100; Lighting sunAzimuth/sunElevation 5–90/sunIntensity 0–3/ambient 0–2; Background showFloor).
- [ ] **Step 2: Run, reconcile schema to template truth** where they drift (expect a few: template `dispersion` 0–5 vs schema? template `attenuationDistance` — check both exist in schema at all; any missing Material entry gets ADDED with `agent: false` first, promoted deliberately later if wanted — do NOT silently grow the agent surface beyond Task 4's two keys).
- [ ] **Step 3: Template swap.** Replace the five sections with the panel; wire `value`/`@set` through the same dotted proxy the post block uses; visible = `visibleSceneControls(doc, selectedObject)`-driven per-entry predicate (+ `showIf` via shared helper); chrome map reproduces today's titles/open states; keep `@pointerdown.capture="onControlsPointerDown"` behavior — StudioControlPanel has no such hook, so wrap the panel in a `<div @pointerdown.capture="onControlsPointerDown">` (same effect: it's a capture listener on an ancestor). Bespoke rows stay: matOverride header switch (section chrome can't host it — keep Material's override banner block above the panel), texture/normal pickers, harmony grid, gradient ramp editor, shader-fill editor block, bgTransparent + background colour row (bespoke, stays), light/decal/geometry/motion sections untouched.
- [ ] **Step 4: Delete dead `mat*` proxies** (only those exclusively serving migrated rows — grep each; many are shared with the viewport/renderer code, KEEP those), run parity + full unit + typecheck as in Task 3 Step 4.
- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/app/lib/scene3d/controls.ts frontend/tests/unit/scene3d-panel-parity.unit.spec.ts
git commit -m "feat(scene3d): Transform/Material/Camera/Lighting/Background drawn from SCENE_CONTROLS"
```

---

### Task 6: Live browser verification (both studios)

**Files:** none modified (fix-loops excepted — any fix returns to the owning task's spec first).

- [ ] **Step 1:** Check for a running dev server (`ps aux | grep -i "nuxt" | grep -v grep`); if a stale one is up from another session, do NOT kill it — start against it if healthy (127.0.0.1:3000, NEVER localhost per memory) else use `./dev.sh` (kills strays + takes over 3000/8188 — acceptable overnight).
- [ ] **Step 2 (Gradient):** open the app, add/open a Gradient node's studio. Per section: move one control → preview visibly changes (per synthetic-pointer memory: use REAL browser-pane clicks by ref, not dispatchEvent). Flip layouts linear→radial→liquid→mesh→banded→stack; assert sections/rows appear/disappear per the old rules (the parity table). Right-click a Flow slider → bind menu appears; Shape sliders → NO bind affordance. Promote one control to a Collection binding and confirm the badge renders. Screenshot each section state.
- [ ] **Step 3 (Scene3D):** open a 3D node's studio; select a primitive: Transform sliders move the object; each material type shows its old row set (walk all types); unlit ON hides roughness/metalness; GLB without override shows no material rows, override ON shows them; deselect: Camera/Lighting/Background behave (floor toggle works, sun sliders relight). Screenshot per state.
- [ ] **Step 4:** `read_console_messages` — zero new errors/warnings attributable to the panels. Per graceful-fallback memory, prove the DERIVED path renders: temporarily set a bogus group on one schema entry in devtools-reachable state? NO console hacking — instead assert via the row COUNT matching the parity table for one state (a fallback/empty panel would show 0 rows).
- [ ] **Step 5:** Record findings in `docs/superpowers/plans/2026-08-24-derived-inspector-retrofit.md` (append a Verification Record section: what was walked, what broke, what was fixed). Commit doc update.

---

### Task 7: Docs + dashboard

**Files:**
- Modify: `docs/STATE.md` (surface table: Scene3D agent column ✅ descriptor — stale ❌ today; new "derived inspector" notes for Gradient/Scene3D rows; add a LANDED entry for this retrofit), `docs/ROADMAP.md` (Act 1: mark the Gradient legacy-retrofit proof done, status line un-pause), dashboard artifact (per update-dashboard memory: READ THE LIVE ARTIFACT FIRST, then update).

- [ ] **Step 1:** Update both docs with honest status (including anything Task 6 left broken).
- [ ] **Step 2:** Update the ⛵ dashboard artifact (Artifact list → find it → WebFetch current → edit → republish same URL).
- [ ] **Step 3:** Final commit + verify clean scope: `git status` shows no plan-touched files unstaged.

```bash
git add docs/STATE.md docs/ROADMAP.md
git commit -m "docs(factory): Act 1 status — Gradient retrofit landed, Scene3D core sections derived"
```

---

## Verification Record (2026-08-24, Task 6)

**Live browser, dev server :3002, real pointer input (not synthetic events):**

*Gradient (/dev/gradient-studio-lab):*
- All sections render derived with correct chrome: Canvas "both layers", Color with active-layer badge, Flow "all layouts", the Liquid group split into "Depth & light" + "Liquid surface" cards, Focus, Shape with layer badge, post stack (one card per effect with header switches), Export.
- Write path: Angle row drag 90→312, gradient visibly rotated. Layout flips (linear→radial→liquid→linear stripes) add/remove exactly the shipped rows (Center X/Y + Inner radius on radial; Flow/Depth & light/Liquid surface on liquid; Relief + Shape on banded).
- Dynamic caption: Shape shows "Randomness" in bands mode (override path live).
- Bind menu: right-click "Hue drift" → "Turn into variable" appears (proven via in-page MutationObserver — the Browser pane's focus cycling closes menus before screenshots); right-click "Count" (bindable:false) → no menu. Fix da35f485c verified live.
- Console: no new errors (only stale Vite optimize-dep noise from first boot, cleared by reload).

*Scene3D (/dev/scene3d-lab):*
- No selection: Camera (FOV), Lighting (Preset/Environment/Sun azimuth/elevation/intensity/Ambient), Background, post stack incl. Ambient occlusion — all derived.
- Sphere selected: Transform = bespoke unbounded number inputs (typed 35 into Position X, accepted, no min/max attrs — the clamping revert verified live); Geometry/Modifiers/Cloner untouched hand-written; Material derived with shipped structure (Standard select, SURFACE, Color, Roughness, Metalness, Coat & sheen / Glow / Transparency / Iridescence cards).
- Write path: Roughness drag 0.60→0.02 written into the scene doc (lab debug dump) and sphere highlight visibly tightened.

**Whole-branch:** unit suite 15 failed files / 30 failed tests — all pre-existing (other sessions' WIP + known baseline; branch's own covering specs all green). Typecheck flat at 420. The gradient embed size failure (284KB vs 90KB ceiling) was A/B-proven pre-existing: merge-base builds 283,734B; this branch adds 577B. Spun off as its own task.
