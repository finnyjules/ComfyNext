# Gradient Studio — Per-Layer Layout Kind

**Date:** 2026-08-16
**Status:** Design approved, ready for planning

## Plain-language summary

Gradient Studio lets you stack layers, but every layer is forced to the **same
gradient type** — one global "Layout" for the whole node. So you can't make a
radial glow layered over a linear sweep layered over a curve. This makes each
layer's layout its own choice: layer 1 can be Radial, layer 2 Linear, layer 3
Curve, stacked and blended (now that transparency works). The Layout picker sets
the *selected* layer's type. Nothing about existing gradients changes — a layer
with no explicit layout falls back to the canvas default, which is exactly today's
behavior.

Paired with the just-shipped alpha fix (transparent stops let layers show through),
this is what "stack different gradients" actually means.

## Goals

1. Each layer can be a different `LayoutKind` (radial / linear / conic / curve /
   stripe / liquid), stacked and composited.
2. The Layout picker sets the **active layer's** layout; the agent can set it too.
3. The inspector shows the controls for the **active layer's** layout.
4. Zero migration; a gradient built before this renders byte-identical.

## Non-goals

- Per-layer **mesh**. Mesh is a whole-canvas soft point-field keyed to layer 0's
  points and canvas-level uniforms; it is not a stackable fill. Mesh stays
  layer-0/canvas-level and is excluded from the per-layer picker on layers 1+.
- Per-layer **flow config**. `flow.*` stays canvas-level; a liquid layer reads the
  canvas flow (unchanged).
- Making relief / liquid-flow frame effects per-layer (they stay keyed to layer 0).

## Key decisions (from brainstorming)

- **Config model:** optional `layer.layout?: LayoutKind`; effective layout =
  `layer.layout ?? canvas.layout`. Layer 0 is anchored to `canvas.layout` (the doc
  default + what new layers inherit); layers 1+ may override.
- **Frame-level effects** (3D relief, liquid flow depth/gloss/ripple) key off
  **layer 0's** effective layout — which is what they already read (relief uses
  `bandHeight(0, p)`).

## Architecture

The only structurally new thing is that `u_layout` becomes **per-layer**. Everything
else is threading the active layer's effective layout into the UI gating.

### 1. Types (`types.ts`)

```ts
export interface LayerConfig {
  // ...existing...
  /** Per-layer gradient type. Absent → uses canvas.layout (the default). Layer 0 is
   *  anchored to canvas.layout; layers 1+ may override to stack different types. */
  layout?: LayoutKind
}
```

A tiny pure helper (exported so renderer + surface + controls share ONE definition):

```ts
export function effectiveLayout(cfg: GradientConfig, layerIndex: number): LayoutKind {
  return cfg.layers[layerIndex]?.layout ?? cfg.canvas.layout
}
```

No `ensureConfigDefaults` change — `layer.layout` stays optional/undefined by
default (undefined = "inherit canvas.layout", the current behavior).

### 2. Renderer (`renderer.ts`)

`u_layout` moves from a scalar to a per-layer array. In the existing per-layer
collection loop, push the effective layout index:

```ts
layoutIdx.push(LAYOUT_IDX[L.layout ?? c.canvas.layout] ?? 0)
```

Upload with the other per-layer arrays:

```ts
gl.uniform1fv(u('u_layout'), arr(layoutIdx))
```

(Remove the old scalar `gl.uniform1f(u('u_layout'), …)`.) `arr()` already pads to
`LAYER_MAX`, so `u_layout[0]` is always the layer-0 effective layout even with one
layer — the frame-level effects read it safely.

### 3. Shader (`shaders.ts`)

- Declaration: `uniform float u_layout;` → `uniform float u_layout[LAYER_MAX];`
- Inside `computeLayer(int i, vec2 p)`: every `u_layout` → `u_layout[i]` (10 sites:
  the branch ladder at ~309/360/388/436/467/521/586/596, all within computeLayer).
- Frame-level in `main()` (3 sites, keyed to layer 0): `u_layout` → `u_layout[0]`
  at the relief gate (`u_layout[0] < 3.5`), the liquid depth/gloss gate
  (`u_layout[0] > 3.5 && u_layout[0] < 4.5`), and the liquid ripple gate.

`bandHeight(int i, …)` already takes a layer index and reads per-layer uniforms, so
it needs no change beyond callers passing the right index (relief calls
`bandHeight(0, …)` — unchanged).

### 4. Controls (`controls.ts`)

Add `layer.layout` as an agent-legible select so the agent can set a layer's type:

```ts
{ key: 'layer.layout', label: 'Layer type', kind: 'select',
  options: [...LAYOUTS], default: 'ramp', group: 'Layer',
  hint: 'This layer\'s gradient type — stack different types across layers' } as GradientControl,
```

The existing layout-gated predicates (`isBanded`/`isSimple`/`isRadial`/`isCurve`/
`usesCenter`/`isLiquid`/`isMesh`) currently read `c.canvas.layout`. They must
gate on the **active layer's** effective layout so the inspector shows the right
controls. Since these predicates only receive `cfg`, the surface drives them by
passing a config view whose `canvas.layout` is the active layer's effective layout
(see §5) — no predicate signature change. Agent/motion callers pass the real config
(canvas.layout), unchanged.

### 5. Surface (`GradientStudioSurface.vue`)

- New computed: `const activeLayout = computed(() => config.value.layers[activeLayer.value]?.layout ?? config.value.canvas.layout)`.
- Rebase the layout computeds (`isRadial`/`isLiquid`/`isMesh`/`isCurve`/`isStack`/
  `isSimpleRamp`/`isRampAngle`/`isRampRadial`/`isConic`/`usesCenter`) from
  `config.value.canvas.layout` onto `activeLayout.value`. This makes the whole
  inspector (Shape/Gradient/Curve/Flow/Relief/Mesh sections + overlays) reflect the
  selected layer.
- `visibleGradientControls` for the inspector is computed against a shallow config
  view with `canvas.layout = activeLayout.value` (so the agent-derived inspector,
  if used, matches). The agent-vocabulary and motion call sites keep the real config.
- Layout picker (line ~967): highlight `activeLayout.value === l` instead of
  `config.canvas.layout === l`. Exclude `mesh` from the options when
  `activeLayer > 0`.
- `setLayout(l)` becomes layer-aware:
  ```ts
  function setLayout(l: LayoutKind) {
    if (activeLayer.value === 0) {
      config.value.canvas.layout = l
      delete config.value.layers[0].layout   // layer 0 anchors to canvas.layout
    } else {
      config.value.layers[activeLayer.value].layout = l
    }
    // keep the existing mesh-init side effect, but gate it on the EFFECTIVE layout
    if (l === 'mesh' && activeLayer.value === 0) { ensureMesh() }
  }
  ```
- New layers inherit the canvas default (no `layout` set), so adding a layer keeps
  today's behavior until the user picks a different type for it.

### 6. Agent / motion

`layer.layout` is a discrete select → **not** a motion target (like `canvas.layout`
today). Agent can set it (added in §4). No motion change.

## Data flow

```
GradientConfig (layer.layout? per layer)
  → renderer: LAYOUT_IDX[L.layout ?? canvas.layout] per layer → u_layout[i]
  → shader computeLayer(i): branches on u_layout[i]; main() relief/liquid use u_layout[0]
  → same composite (alpha-aware) + post pipeline
UI: activeLayout = layers[active].layout ?? canvas.layout drives the inspector gating
```

## Testing strategy

Per [[graceful-fallback-hides-integration-failure]], prove per-layer layout
differentially — not "it rendered."

**Unit (pure, no GL):**
- `effectiveLayout`: layer with `layout` returns it; without, returns `canvas.layout`;
  out-of-range index falls back to `canvas.layout`.
- Renderer layout-index array (extract or test via a thin seam): a 2-layer config
  with `layers[0].layout` unset + `layers[1].layout='radialRamp'` produces indices
  `[LAYOUT_IDX[canvas.layout], 7]`.
- `visibleGradientControls` against a config viewed at layer 1's layout shows that
  layer's controls (e.g. radialRamp → radius/shape, not Shape/Relief).
- `setLayout` semantics: layer 0 writes `canvas.layout` and clears `layers[0].layout`;
  layer 1 writes `layers[1].layout` and leaves `canvas.layout` untouched.
- Back-compat: a config with no `layer.layout` yields the same per-layer layout
  indices as today (all = canvas.layout).

**Differential (live `/dev/gradient-harness`, extend the multi-layer probe):**
- A 2-layer config with layer 0 = `ramp` and layer 1 = `radialRamp` (top fading to
  transparent) renders a radial shape over a linear one — assert the composite ≠
  either single-layout render, and ≠ the same config with both layers `ramp`.
- Layer 1 set to `conic` vs `curve` produces distinct composites (the top layer's
  branch is actually reached per-layer).
- Frame-level: relief keyed to layer 0 — with layer 0 = stripe + relief on, relief
  still shades; with layer 0 = a simple primitive, relief is off (u_layout[0] gate).
- Broken-control: reverting `u_layout` to scalar (or ignoring `layer.layout`) makes
  the mixed-layout render identical to the all-canvas-layout render — the test must
  fail in that state.

## Risks & mitigations

- **Frame-level `u_layout[0]` vs per-pixel `u_layout[i]`** — mixing them up would
  either break relief or make every layer render layer 0's layout. The differential
  "mixed ≠ uniform" test catches both.
- **Inspector gating drift** — if the surface computeds aren't rebased onto
  `activeLayout`, the panel shows the wrong controls for a layer. Covered by the
  visible-controls test + a live check (select a radial layer, see radial controls).
- **Mesh on layers 1+** — excluded from the picker; a saved/agent config that sets
  `layer.layout='mesh'` on layer >0 renders layer 0's mesh points (degenerate, not
  broken). Acceptable; noted.
- **`u_layout` array in a WebGL uniform** — `LAYER_MAX`-sized float array, same
  pattern as every other per-layer uniform; `arr()` pads. No new ceiling risk.
