# Per-Layer Gradient Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each stacked Gradient Studio layer be a different `LayoutKind` (radial / linear / conic / curve / stripe / liquid), instead of one global canvas layout.

**Architecture:** Add optional `layer.layout?` (effective layout = `layer.layout ?? canvas.layout`). Promote the shader's `u_layout` scalar to a per-layer `u_layout[LAYER_MAX]` array; `computeLayer`/`bandHeight` branch on `u_layout[i]`, while the two frame-level effects (relief, liquid flow) key off `u_layout[0]`. The UI's layout picker and inspector gating rebase onto the active layer's effective layout.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL2 (raw GLSL in `shaders.ts`), Vitest units, Browser-pane differential probe.

## Global Constraints

- **Zero migration:** `layer.layout` is optional/undefined by default. A config with no `layer.layout` renders byte-identical (every layer resolves to `canvas.layout`). No `ensureConfigDefaults` change.
- **Layer 0 is anchored to `canvas.layout`** (the doc default + what new layers inherit). Layers 1+ may override via `layer.layout`.
- **Effective layout** = `cfg.layers[i]?.layout ?? cfg.canvas.layout`, via one shared exported helper `effectiveLayout(cfg, i)`.
- **`u_layout` is per-layer in `computeLayer`/`bandHeight` (`u_layout[i]`), but frame-level effects use `u_layout[0]`** — relief gate (shaders.ts:666), liquid depth/gloss gate (681), liquid ripple gate (708). Getting these mixed up either breaks relief or makes every layer render layer 0's layout.
- **Mesh is not per-layer:** excluded from the picker on layers 1+; stays layer-0/canvas-level.
- Per-layer uniforms are `[LAYER_MAX]` arrays uploaded via `gl.uniform1fv(u('...'), arr(...))`.
- Run units from `frontend/`: `cd frontend && npx vitest run <file> --no-coverage`. Pre-existing unrelated reds (`gradientfx-mesh` u_flowOffset, `gradientfx-motion-path` 50→51 from a parallel session's distort effect) are NOT ours — ignore them.
- PARALLEL sessions + dirty tree: stage only your own paths, never `git add -A`/`git add .`/stash.

---

### Task 1: Types + effectiveLayout helper

**Files:**
- Modify: `frontend/app/lib/gradientfx/types.ts` (LayerConfig; add `effectiveLayout`)
- Test: `frontend/tests/unit/gradientfx-per-layer-layout.unit.spec.ts` (create)

**Interfaces:**
- Produces: `LayerConfig.layout?: LayoutKind`; `export function effectiveLayout(cfg: GradientConfig, layerIndex: number): LayoutKind`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-per-layer-layout.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { effectiveLayout, ensureConfigDefaults, type GradientConfig } from '~/lib/gradientfx/types'
import { defaultConfig } from '~/lib/gradientfx/randomize'

function twoLayer(): GradientConfig {
  const c = ensureConfigDefaults(defaultConfig('#pll1') as GradientConfig)
  c.canvas.layout = 'ramp'
  c.layers = [c.layers[0]!, { ...structuredClone(c.layers[0]!) }]
  return c
}

describe('effectiveLayout', () => {
  it('returns the layer override when set', () => {
    const c = twoLayer()
    c.layers[1]!.layout = 'radialRamp'
    expect(effectiveLayout(c, 1)).toBe('radialRamp')
  })
  it('falls back to canvas.layout when the layer has no override', () => {
    const c = twoLayer()
    expect(effectiveLayout(c, 0)).toBe('ramp')
    expect(effectiveLayout(c, 1)).toBe('ramp')
  })
  it('falls back to canvas.layout for an out-of-range index', () => {
    const c = twoLayer()
    expect(effectiveLayout(c, 9)).toBe('ramp')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-per-layer-layout.unit.spec.ts --no-coverage`
Expected: FAIL — `effectiveLayout` not exported.

- [ ] **Step 3: Edit `types.ts`**

Add to `LayerConfig` (after `curve?`):

```ts
  /** Per-layer gradient type. Absent → uses canvas.layout (the default). Layer 0 is
   *  anchored to canvas.layout; layers 1+ may override to stack different types. */
  layout?: LayoutKind
```

Add the helper near `LAYOUTS`/`LAYOUT_LABELS`:

```ts
/** The gradient type a given layer renders: its own override, else the canvas default. */
export function effectiveLayout(cfg: GradientConfig, layerIndex: number): LayoutKind {
  return cfg.layers?.[layerIndex]?.layout ?? cfg.canvas.layout
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-per-layer-layout.unit.spec.ts --no-coverage`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/gradientfx/types.ts frontend/tests/unit/gradientfx-per-layer-layout.unit.spec.ts
git commit -m "feat(gradient): layer.layout field + effectiveLayout helper"
```

---

### Task 2: Renderer + shader — per-layer u_layout

**Files:**
- Modify: `frontend/app/lib/gradientfx/shaders.ts` (decl line 32; computeLayer/bandHeight sites; main() frame sites)
- Modify: `frontend/app/lib/gradientfx/renderer.ts` (per-layer collection loop; upload line 368)
- Test: verified live (Task 5) — GL is mocked in Vitest

**Interfaces:**
- Consumes: `effectiveLayout` (Task 1) — or read `L.layout ?? c.canvas.layout` inline in the renderer loop.
- Produces: `u_layout` is a per-layer array; each layer renders `L.layout ?? canvas.layout`; frame effects key off layer 0.

- [ ] **Step 1: Shader — declaration**

`shaders.ts` line 32: change

```glsl
uniform float u_layout;        // 0 linear, 1 radial, 2 orbit
```

to

```glsl
uniform float u_layout[LAYER_MAX]; // per-layer effective layout index (see LAYOUT_IDX)
```

- [ ] **Step 2: Shader — per-layer sites in computeLayer + bandHeight**

In `computeLayer(int i, vec2 p)` and `bandHeight(int i, …)`, replace `u_layout` with `u_layout[i]` at these lines: 309, 311, 316, 321, 360, 388, 436, 467, 521, 586, 596. Each is a bare `u_layout` comparison — e.g. `if (u_layout > 5.5)` → `if (u_layout[i] > 5.5)`, `bool orbit = u_layout > 1.5;` → `bool orbit = u_layout[i] > 1.5;`. Do NOT change lines 666/681/708 here (those are main(), Step 3).

- [ ] **Step 3: Shader — frame-level sites in main() → layer 0**

At the three main() gates, key off layer 0:
- Line 666: `if (u_relief > 0.001 && u_layout < 3.5 && u_enabled[0] > 0.5)` → `u_layout[0] < 3.5`
- Line 681: `if (u_layout > 3.5 && u_layout < 4.5 && (u_flowDepth > 0.001 || u_flowGloss > 0.001))` → `u_layout[0] > 3.5 && u_layout[0] < 4.5`
- Line 708: `if (u_layout > 3.5 && u_layout < 4.5 && u_flowRipple > 0.001)` → `u_layout[0] > 3.5 && u_layout[0] < 4.5`

- [ ] **Step 4: Renderer — collect + upload the per-layer layout array**

In `renderer.ts`, add a collection array with the other per-layer arrays (near where `counts`/`dir` are declared):

```ts
    const layoutIdx: number[] = []
```

In the per-layer loop (where `L` is the current layer, alongside the other `.push` calls), add:

```ts
      layoutIdx.push(LAYOUT_IDX[L.layout ?? c.canvas.layout] ?? 0)
```

Replace the scalar upload at line 368:

```ts
    gl.uniform1f(u('u_layout'), LAYOUT_IDX[c.canvas.layout] ?? 0)
```

with the array upload (place it with the other `uniform1fv` array uploads, ~line 461):

```ts
    gl.uniform1fv(u('u_layout'), arr(layoutIdx))
```

(`arr()` pads to `LAYER_MAX`, so `u_layout[0]` is always valid even with one layer.)

- [ ] **Step 5: Compile-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "gradientfx/renderer\|gradientfx/shaders" || echo clean`
Expected: `clean`. (The GLSL is a string; the check is that the TS around it still types. Live GL render is Task 5.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/gradientfx/shaders.ts frontend/app/lib/gradientfx/renderer.ts
git commit -m "feat(gradient): per-layer u_layout array (frame effects key off layer 0)"
```

---

### Task 3: Controls — layer.layout as an agent-legible select

**Files:**
- Modify: `frontend/app/lib/gradientfx/controls.ts` (add the control row)
- Test: `frontend/tests/unit/gradientfx-per-layer-layout-controls.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `LAYOUTS`, `visibleGradientControls`
- Produces: control key `layer.layout` (kind `select`, options `LAYOUTS`) present in the vocabulary.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-per-layer-layout-controls.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { visibleGradientControls } from '~/lib/gradientfx/controls'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { ensureConfigDefaults, LAYOUTS, type GradientConfig } from '~/lib/gradientfx/types'

describe('layer.layout control', () => {
  it('is present with all layouts as options', () => {
    const c = ensureConfigDefaults(defaultConfig('#pl1') as GradientConfig)
    const ctl = visibleGradientControls(c).find(k => k.key === 'layer.layout')
    expect(ctl).toBeTruthy()
    expect(ctl!.kind).toBe('select')
    expect((ctl as any).options).toEqual([...LAYOUTS])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-per-layer-layout-controls.unit.spec.ts --no-coverage`
Expected: FAIL — no `layer.layout` control.

- [ ] **Step 3: Edit `controls.ts`**

Add to the `Layer` group (near `layer.blend`), ensuring `LAYOUTS` is imported:

```ts
  { key: 'layer.layout', label: 'Layer type', kind: 'select', options: [...LAYOUTS], default: 'ramp', group: 'Layer', hint: "This layer's gradient type — stack different types across layers" } as GradientControl,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-per-layer-layout-controls.unit.spec.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Reconcile the characterization suite**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-controls.unit.spec.ts --no-coverage`
Expected: the snapshot gains `layer.layout` in the Layer group for every characterized layout (a legitimate universal addition). Update the snapshot; confirm the ONLY diff is `layer.layout` appearing — nothing else. If more changed, stop and report.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/gradientfx/controls.ts frontend/tests/unit/gradientfx-per-layer-layout-controls.unit.spec.ts frontend/tests/unit/gradientfx-controls.unit.spec.ts frontend/tests/unit/__snapshots__/gradientfx-controls.unit.spec.ts.snap
git commit -m "feat(gradient): layer.layout agent-legible select control"
```

---

### Task 4: Surface — active-layer picker + gating

**Files:**
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue` (layout computeds lines 60-73; picker ~967; `setLayout` ~805)
- Test: verified live (Task 5)

**Interfaces:**
- Consumes: `effectiveLayout` (Task 1) or an inline `activeLayout` computed; `LAYOUTS`
- Produces: the picker sets the active layer's layout; the inspector gates on the active layer's effective layout; mesh excluded on layers 1+.

- [ ] **Step 1: Add the `activeLayout` computed** (near line 60, before the layout computeds):

```ts
const activeLayout = computed(() => config.value.layers[activeLayer.value]?.layout ?? config.value.canvas.layout)
```

- [ ] **Step 2: Rebase the layout computeds onto `activeLayout`** (lines 60-73). Replace each `config.value.canvas.layout` with `activeLayout.value`:

```ts
const isRadial = computed(() => activeLayout.value === 'radial' || activeLayout.value === 'orbit')
const isStack = computed(() => activeLayout.value === 'stack')
const isLiquid = computed(() => activeLayout.value === 'liquid')
const isMesh = computed(() => activeLayout.value === 'mesh')
const isCurve = computed(() => activeLayout.value === 'curve')
const isSimpleRamp = computed(() => ['ramp', 'radialRamp', 'conic'].includes(activeLayout.value))
const isRampAngle = computed(() => activeLayout.value === 'ramp' || activeLayout.value === 'conic')
const isRampRadial = computed(() => activeLayout.value === 'radialRamp')
const isConic = computed(() => activeLayout.value === 'conic')
const usesCenter = computed(() => isRadial.value || isRampRadial.value || isConic.value)
```

(If `isSimpleRamp` was later widened to include curve for Repeat gating — from the prior fix — preserve that: keep whatever the current condition is, just swap the layout source to `activeLayout.value`. Grep the current line before editing.)

- [ ] **Step 3: Layout picker — highlight + options + mesh exclusion** (~line 967). The picker currently iterates `LAYOUTS` and highlights `config.canvas.layout === l`. Change the highlight to `activeLayout === l`, and exclude `mesh` for layers 1+. Read the picker's `v-for` and adapt; the pattern:

```vue
<button v-for="l in (activeLayer > 0 ? LAYOUTS.filter(x => x !== 'mesh') : LAYOUTS)" :key="l"
        :class="activeLayout === l ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
        @click="setLayout(l)">{{ LAYOUT_LABELS[l] }}</button>
```

(Match the real element's existing classes/label expression — only change the highlight condition, the `v-for` source, and keep `@click="setLayout(l)"`.)

- [ ] **Step 4: `setLayout` becomes layer-aware** (~line 805):

```ts
function setLayout(l: LayoutKind) {
  if (activeLayer.value === 0) {
    config.value.canvas.layout = l
    delete config.value.layers[0]!.layout   // layer 0 anchors to canvas.layout
  } else {
    config.value.layers[activeLayer.value]!.layout = l
  }
  if (l === 'mesh' && activeLayer.value === 0) { activeLayer.value = 0; ensureMesh() }
  onEdit(activeLayer.value === 0 ? 'canvas.layout' : 'layer.layout', l)
}
```

(Preserve whatever side-effects the current `setLayout` had — grep it first; the key change is the layer-0-vs-N branch and gating the mesh-init on layer 0. If the current `setLayout` did more, keep it, just make the target layer-aware.)

- [ ] **Step 5: Compile-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "GradientStudioSurface" || echo clean`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/GradientStudioSurface.vue
git commit -m "feat(gradient): per-layer layout picker + active-layer inspector gating"
```

---

### Task 5: Live differential verification

**Files:** none (verification only — code only if a defect is found)

Per [[graceful-fallback-hides-integration-failure]], prove per-layer layout differentially.

- [ ] **Step 1: Full unit sweep**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-*.unit.spec.ts --no-coverage`
Expected: all pass except the two known pre-existing parallel-session reds (mesh `u_flowOffset`, motion-path 50→51). Confirm those are the only failures.

- [ ] **Step 2: Dev server + harness**

Reuse the running server on `127.0.0.1:3000` ([[orphaned-dev-servers-from-parallel-sessions]]); open `/dev/gradient-harness`; hard-reload after HMR (shader change needs a fresh renderer).

- [ ] **Step 3: Extend `__sailorMultiLayerProbe`** (already in the harness) to accept a per-layer `layout` on `l0`/`l1` (set `L.layout = o.layout` in its `applyLayer`). Then:
- [ ] **Step 4: Mixed ≠ uniform** — render layer0=`ramp`, layer1=`radialRamp` (top fading to transparent). Assert the composite differs from the same config with BOTH layers `ramp` (proves layer 1 actually renders radial, not layer 0's layout).
- [ ] **Step 5: Per-layer branch reached** — layer1=`conic` vs layer1=`curve` produce distinct composites.
- [ ] **Step 6: Frame effect keys off layer 0** — layer0=`linear` (stripe) with relief on shades; layer0=`ramp` (simple) with relief on does not (u_layout[0] gate). Assert the two differ / relief only acts when layer 0 is banded.
- [ ] **Step 7: Broken-control** — confirm that if `layer.layout` were ignored (all layers = canvas.layout), the mixed render equals the uniform render. (Reason about it, or temporarily hardcode to confirm the test would catch a regression.)
- [ ] **Step 8: Screenshots** — a stacked radial-over-linear and a curve-over-radial for the handoff.
- [ ] **Step 9: If any check fails**, diagnose against Task 2 (u_layout[i] vs [0]) / Task 4 (gating), fix in the owning task's files, re-run from Step 1.
- [ ] **Step 10: Commit** any harness probe extension (dev-only infra); no product commit unless a defect was fixed.

---

### Task 6: Docs — STATE + dashboard + memory

**Files:**
- Modify: `docs/STATE.md` (Gradient row + a landed entry)
- Modify: the live ⛵ dashboard artifact ([[update-dashboard-on-every-commit]] — read the LIVE one first)
- Update: `[[gradient-simple-primitives-landed]]` memory (per-layer layout + the alpha fix)

- [ ] **Step 1: STATE.md landed entry** — per-layer layout (`layer.layout ?? canvas.layout`); `u_layout` per-layer array with frame effects keyed to layer 0; picker sets active layer; mesh stays canvas-level; pairs with the alpha fix for real stacked gradients. Cite spec + plan. Update the Gradient row note.

- [ ] **Step 2: Dashboard** — read the live ⛵ artifact, add the per-layer-layout + alpha note to the Gradient maturity row, redeploy to the same URL.

- [ ] **Step 3: Memory** — update `[[gradient-simple-primitives-landed]]` (or add a focused note) covering: per-layer `u_layout` (frame effects key off `[0]`), the alpha-through-LUT fix, and that these two together make stacked gradients combine.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "docs: per-layer gradient layout + alpha — landed"
```

---

## Self-Review

**Spec coverage:**
- `layer.layout?` + `effectiveLayout` → Task 1. ✓
- Per-layer `u_layout`; frame effects key off layer 0 → Task 2. ✓
- Agent-legible `layer.layout` select → Task 3. ✓
- Picker sets active layer; inspector gates on active layer; mesh excluded on layers 1+; `setLayout` layer-aware; layer 0 anchors canvas.layout → Task 4. ✓
- Zero migration (no ensureConfigDefaults change) → Task 1 (optional field). ✓
- Differential verification (mixed≠uniform, frame-effect layer-0, broken-control) → Task 5. ✓

**Placeholder scan:** none. The "grep the current line before editing" notes (Task 4) are concrete reuse instructions guarding against the prior isSimpleRamp/curve fix, not placeholders.

**Type consistency:** `effectiveLayout(cfg, i)` defined Task 1, used Tasks 2/4. `layer.layout` key consistent across Tasks 1/3/4. `LAYOUT_IDX`/`LAYOUTS`/`LAYOUT_LABELS` are existing exports. `u_layout[LAYER_MAX]` array + `u_layout[i]`/`u_layout[0]` split consistent across Task 2 steps.
