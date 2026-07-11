# Color-Theory Palettes for Duotone & Gradient Map

**Date:** 2026-07-05
**Status:** Design — awaiting review

## Goal

Let users pick colors for the **duotone** and **gradient map** effects from
color-theory-based options (complementary, analogous, triadic, monochromatic,
etc.) instead of raw per-channel R/G/B sliders. Two ways to drive it:

- **Curated harmony gallery** — hand-tuned palettes grouped by harmony type, as
  starting points.
- **Seed color → live harmonies** — pick one base color; harmonies are computed
  live from it.

The gradient map becomes **multi-stop** (N colors) so a triadic/tetradic harmony
maps onto stops directly. Duotone stays **2-color** (shadow + highlight).

Surfaced in **both** places these effects live:

1. **Canvas nodes** (Vue frontend): `Duotone`, `GradientMap` / `AdjustGradientMap`.
2. **Shader Studio** panel: the existing Duotone stage, plus a **new** Gradient
   Map stage.

## Non-goals

- No changes to `SplitToning` (out of scope; can adopt the same picker later).
- No new color *space* work beyond what `StudioColor.vue` already does (OKLCH).
- Not building a general gradient-authoring tool; the picker's job is
  harmony-driven color selection, with manual per-stop editing as a fallback.

## Architecture overview

One shared, pure-TS color engine feeds one reusable Vue picker, which is dropped
into both surfaces. Backend nodes migrate to hex / JSON-stop inputs so the
frontend can bind a real picker.

```
lib/color/harmony.ts   ── harmony math (OKLCH)     ┐  shared,
lib/color/palettes.ts  ── curated palette library  ┘  unit-tested
        │
        ▼
components/.../PalettePicker.vue  ── curated rows + seed mode
        │
        ├─────────────► Shader Studio (Duotone stage + NEW Gradient Map stage)
        │
        └─────────────► WidgetGradientEditor.vue  ── canvas node widget
                                │
                                ▼
                        backend nodes (hex / JSON stops)
```

Node widgets already render in the **Vue frontend**
(`vue-canvas/ComfyNodeWidget.vue`), not the ComfyUI iframe, so the picker is pure
Vue and shares code with `StudioColor.vue`. Custom node widgets are wired through
the existing `sailor_widget` hint mechanism (same seam as `lora_picker`,
`camera_gimbal`, etc.).

---

## Unit 1 — Harmony engine (`frontend/app/lib/color/harmony.ts`)

Pure functions, no Vue, fully unit-tested. Works in **OKLCH** (perceptually even
hue steps and lightness — consistent with the OKLCH conversions already in
`StudioColor.vue`). Hex in, hex out at the boundary; OKLCH internally.

### Harmony types

```ts
export type HarmonyType =
  | 'monochromatic'        // one hue, tonal ramp (shades/tints)
  | 'complementary'        // base + 180°
  | 'split-complementary'  // base + 150° + 210°
  | 'analogous'            // base ±30° (and ±60° when more hues needed)
  | 'accented-analogous'   // analogous set + complement as a single accent
  | 'triadic'              // 120° apart (3 hues)
  | 'tetradic'             // square: 90° apart (4 hues)
  | 'compound'             // rectangle: two complementary pairs, unequal spacing
```

### Core API

```ts
/** Generate an ordered list of hues for a harmony, as hex. */
export function harmonize(seedHex: string, type: HarmonyType, count: number): string[]

/** Collapse a harmony into a 2-color duotone { shadow, highlight }.
 *  shadow = first hue pushed dark; highlight = a second hue (or same hue for
 *  monochromatic) pushed light. Lightness/chroma tuned so the pair reads as a
 *  usable duotone regardless of the seed. */
export function toDuotone(hexes: string[]): { shadow: string; highlight: string }

/** Expand a harmony into N gradient stops, evenly positioned 0..1 and sorted by
 *  lightness ascending so the map preserves tonal order (dark→light). */
export function toStops(hexes: string[], n: number): GradientStop[]

export interface GradientStop { pos: number; color: string } // pos 0..1, color hex
```

### Behavior notes

- **Hue spacing** is computed in degrees on the OKLCH hue wheel; lightness and
  chroma are nudged per role (shadow darker/less chroma-clipped, highlight
  lighter) using fixed, tuned offsets — not left at the seed's raw L/C.
- `monochromatic` produces a **shades/tints ramp**: same hue, lightness stepped
  across `count`, slight chroma falloff at the extremes.
- `accented-analogous` returns the analogous run first, complement last, so
  `toStops` places the accent as the brightest/among stops predictably.
- `count` clamps to each harmony's natural size (e.g. complementary → 2, triadic
  → 3) but can up-sample by interpolating between hues for larger N-stop maps.

## Unit 2 — Curated palette library (`frontend/app/lib/color/palettes.ts`)

Hand-picked hex palettes, each tagged with its harmony type, for the gallery. No
seed needed — always tasteful. ~4–6 per harmony type.

```ts
export interface CuratedPalette {
  name: string
  type: HarmonyType
  colors: string[]      // ordered; length matches the harmony
}
export const CURATED_PALETTES: CuratedPalette[]

/** Convenience selectors for the picker's rows. */
export function palettesByType(type: HarmonyType): CuratedPalette[]
```

Existing `DUOTONE_PRESETS` (in `lib/shaderstudio/presets.ts`) are folded in and
re-tagged by harmony (e.g. Sepia/Ember → monochromatic-ish, Indigo/Ocean →
analogous, Berry → complementary). The old flat 8-swatch grid is replaced by
harmony-grouped rows.

## Unit 3 — `PalettePicker.vue` (`frontend/app/components/vue-canvas/studio/`)

The one reusable UI. Two panes:

- **Gallery** — rows grouped by harmony type; each palette is a clickable
  multi-swatch chip. Clicking applies it.
- **From seed** — a `StudioColor` swatch to choose the base color + a harmony-type
  selector. Live-regenerates the set as the seed or type changes. A "shuffle"
  affordance re-rolls lightness/chroma vari/hue offset within the chosen harmony.

Props / events (mode-driven so it serves both a 2-color duotone and an N-stop
gradient):

```ts
const props = defineProps<{
  mode: 'duotone' | 'stops'
  stopCount?: number          // for mode 'stops'; default 4, user-adjustable
  modelValue: string | GradientStop[]  // hex duo packed, or stops
}>()
// mode 'duotone'  → emits { shadow, highlight } (packed to the surface's shape)
// mode 'stops'    → emits GradientStop[]
```

Reuses `StudioColor.vue` for the seed swatch and any manual per-color tweak.
Follows dark-theme studio styling; neutral affordances, no purple; pink only if a
control is variable-bound (per project color conventions).

---

## Unit 4 — Canvas node surface

### Backend schema migration (approved)

Move off raw R/G/B floats toward hex / JSON stops. Old graphs referencing the old
inputs may reset to defaults — accepted.

- **`Duotone`** (`comfy_extras/nodes_glsl_grading.py`): replace `shadow_r/g/b` +
  `highlight_r/g/b` with two hex string inputs `shadow` (default `#1a1a2e`) and
  `highlight` (default `#f5f5f5`). `execute` parses hex → tensor; mapping math
  unchanged (`c0*(1-l) + c1*l`).
- **`AdjustGradientMap`** (`comfy_extras/nodes_color_filters.py`): replace the six
  floats with a single **`stops`** JSON string input +
  keep `mix`. Default stops = current 2-stop look. New multi-stop interpolation in
  `execute` (below). Standardize the display name/behavior with the hex-based
  `GradientMap` in `nodes_glsl_unicorn.py`; consolidate to one gradient-map node
  if the second is redundant (decide during planning — see Open questions).
- Both mark their color input with
  `extra_dict={"sailor_widget": "gradient_editor"}` so the frontend renders the
  new widget instead of a text box.

### Multi-stop interpolation (`execute`)

Parse `stops` (JSON: `[{pos, color}]`), sort by `pos`, build a 1-D LUT (e.g. 256
entries) by linear interpolation between adjacent stops in RGB (or OKLab for
smoother ramps — decide in planning), then index the LUT by per-pixel luminance.
Keeps the existing luma weights (BT.709) and `mix` compositing. Live-preview path
(`AdjustGradientMap` is already in `LIVE_PREVIEW_NODES`) is unchanged — still one
param edit → one re-run.

### `WidgetGradientEditor.vue` (`vue-canvas/widgets/`)

New custom widget, selected in `ComfyNodeWidget.vue` when
`widgetDef.sailor_widget === 'gradient_editor'`:

- Renders a stop strip (add/remove/drag stop, per-stop `StudioColor`) for gradient
  map, or a two-swatch row for duotone.
- Embeds `PalettePicker` (`mode` from the widget's config) to fill all
  stops/colors from a harmony at once.
- Emits a hex string (duotone: could pack as one JSON, or two adjacent hex
  widgets) / JSON stops string; `ComfyNode.vue` writes it back into
  `widgetsValues[i]` by name, preserving the order-critical index alignment.

Because the widget owns a single JSON/hex value, it maps to **one** widget slot —
avoiding the "one custom widget controlling six float values" alignment problem.

## Unit 5 — Shader Studio surface

### Duotone stage (existing)

Replace the flat `DUOTONE_PRESETS` swatch grid in `ShaderStudioSurface.vue` with
`PalettePicker` in `mode="duotone"`, bound to `config.duotone.ink/paper`. Keeps
the existing `StudioColor` ink/paper pickers and `BindableRow` variable-binding.

### New Gradient Map stage (new)

Add a gradient-map stage to the frontend WebGL pipeline, mirroring the backend
math so the Studio preview matches:

- `lib/shaderstudio/types.ts`: add `StudioGradientMap { enabled, stops:
  GradientStop[], mix }` to `StudioConfig` (+ default).
- `lib/shaderstudio/glsl.ts`: add `GRADIENT_MAP_FS` — samples a 1-D LUT texture
  (built from stops on the CPU) by luminance; `mix` blends with source.
- `lib/shaderstudio/passes.ts`: build the LUT (reuse `toStops`/interpolation),
  upload as a small texture, insert the pass in the stage order (near duotone).
- `ShaderStudioSurface.vue`: new `StudioSection` with `PalettePicker`
  `mode="stops"`, stop-count control, and `mix` slider.
- `lib/shaderstudio/agentControls.ts`: expose the new stage's params so the
  studio tuner / agent can drive it (consistent with existing duotone controls).

---

## Data flow

1. User clicks a curated palette or picks a seed + harmony in `PalettePicker`.
2. `harmony.ts` produces hexes → `toDuotone`/`toStops` shapes them for the mode.
3. **Studio:** writes into `StudioConfig`; passes rebuild the LUT/uniforms; live
   WebGL preview updates.
4. **Node:** `WidgetGradientEditor` emits the JSON/hex; `ComfyNode.vue` writes
   `widgetsValues[i]`; live-preview nodes re-run via existing `scheduleLiveRun`.

## Testing

- **`harmony.ts` unit tests** (`tests/unit/color-harmony.unit.spec.ts`): hue
  spacing per type (angles within tolerance on the OKLCH wheel), `toDuotone`
  returns a dark/light pair (shadow L < highlight L) for every harmony, `toStops`
  returns `n` stops sorted by lightness with `pos` spanning 0..1, monochromatic
  keeps one hue, up-sampling to large N stays monotonic in L.
- **`palettes.ts`**: every curated palette's length matches its harmony type;
  colors are valid hex.
- **Backend**: a small Python test that `execute` parses stops JSON, handles
  1 stop / unsorted stops / malformed JSON (falls back to default), and matches
  the old 2-stop output when given the equivalent 2 stops.
- **Visual sign-off (required):** per project rule, do NOT ship the WebGL
  Gradient Map stage or the picker on unit tests alone — screenshot loop in the
  browser and get a look sign-off before calling it done.

## Suggested slicing (for the plan)

1. **Engine + picker** — `harmony.ts`, `palettes.ts`, `PalettePicker.vue`, unit
   tests. No surface wiring yet. Independently verifiable.
2. **Shader Studio duotone** — swap the preset grid to `PalettePicker`
   (`mode="duotone"`). Lowest-risk real surface; browser sign-off.
3. **Shader Studio Gradient Map stage** — new GLSL LUT stage + section. Browser
   sign-off.
4. **Backend schema migration** — `Duotone` + gradient-map node hex/JSON inputs,
   multi-stop `execute`, Python tests.
5. **Node widget** — `WidgetGradientEditor.vue` + `sailor_widget` wiring;
   verify live-preview on canvas.

## Open questions / risks

- **Two gradient-map nodes** (`AdjustGradientMap` float-based vs. `GradientMap`
  hex-based) — consolidate to one during planning, or migrate both? Leaning:
  standardize on one multi-stop node, keep the other as a thin alias if graphs
  reference it.
- **LUT interpolation space** (RGB vs. OKLab) — OKLab is smoother but costs a bit
  more; pick during Unit-4 implementation, keep it identical between the WebGL
  Studio stage and the Python node so previews match.
- **Duotone value packing on the node** — one JSON value vs. two hex widget
  slots. Two slots is simpler for `widgetsValues` alignment; JSON is tidier for
  the picker. Decide in Unit 5/4 planning.
