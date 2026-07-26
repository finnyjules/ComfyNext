# Shape Studio Control Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Shape Studio a declarative `ControlSpec[]` schema, and from that one declaration light up two capabilities it does not have today: **agent tuning** and **Collection variable binding / sweeps**.

**Architecture:** This is the second application of the factory pattern proved on Gradient. `app/lib/shapefx/controls.ts` becomes the single declaration; `shapeAgentControls()` derives the agent vocabulary from it by filtering, exactly as `gradientAgentControls` does. Registration is then three one-line entries (`STUDIO_TUNERS`, `controlsForStudio`, `VARS_TARGET_NODE_TYPES`) plus surface wiring. Motion is explicitly NOT in scope — Shape's renderer is stateful (`setConfig` rebuild + `render(orbit)`) with no time parameter, so animating it is an engine change, not a schema change.

**The measure of success:** Gradient's schema cost 7 declaration sites collapsing to 1. Shape's should cost roughly one file plus three registry lines. If it doesn't, the factory claim is weaker than we think.

**Tech Stack:** TypeScript, Vue 3 (Nuxt 4), Vitest (`*.unit.spec.ts`), three.js.

## Global Constraints

- **`sailor_shapeStudio` is a WRAPPER, not a bare config.** It is `{ config, canvasW, canvasH, aspectKey, orbit }` (`ShapeStudioSurface.vue:69-80`). Gradient stores its config flat. Any adapter that writes this property MUST preserve the sibling keys, or the user loses their canvas size and camera orbit.
- **`mergeConfig(raw)` is the normalizer** (`app/lib/shapefx/config.ts:103-151`) — a strict field-by-field rebuild, not a mutate-in-place backfill. Use it wherever Gradient would use `ensureConfigDefaults`.
- **Keep `app/lib/shapefx/controls.ts` free of any `three` import.** `collection/studioControls.ts` loads studio schemas dynamically and its header rule (lines 1-11) requires heavy imports stay inside function bodies. `shapefx/config.ts` is three-free; `color.ts` and `geometry.ts` are NOT — do not import them from the schema.
- **All new `ControlSpec` fields must be optional** (~30 spacetype effect files declare `ControlSpec[]`).
- **`ControlSpec` has no `switch` kind** (`app/lib/spacetype/effect.ts:32-51`). Do not add one in this plan.
- Working directory: `/Users/julien/Documents/GitHub/Sailor/frontend`. Test: `pnpm test:unit`.
- ~100 files are modified by OTHER concurrent sessions. Stage only the exact paths each task names; run `git diff --cached` and read it before every commit. Never `git add -A` / `git add .` / `git stash`.
- Typecheck across the tree is unreliable; vitest is the gate.

## Deliberately excluded from the schema

Each of these is a real control in the UI that does NOT map to a `ControlSpec`. Leave the existing markup untouched for all of them:

| Thing | file:line | Why excluded |
|---|---|---|
| Lock buttons ×3 | `ShapeStudioSurface.vue:412,443,485,504` | `config.locks.*` is re-roll metadata, not a render param. No `switch` kind exists. |
| Palette preview strip | `:465-471` | Read-only derived display, writes nothing. |
| Base color | `:449` (+`:115-126`) | A derived 3-way setter over hue/sat/light. The three sliders it wraps ARE in the schema, so nothing is lost. |
| `bgTransparent` switch | `:512` (+`:143-157`) | `style.background` is a union (hex \| `'transparent'`) with a shadow-ref restore. One `color` spec cannot express it. |
| Canvas W / H / aspect | `:521-538` | Lives outside `ShapeConfig`, on the persisted wrapper. |
| Orbit yaw/pitch/zoom | `:206-210` | Outside the config. This is the motion opportunity — see the follow-on note. |
| Re-roll / Import buttons | `:394-400`, `:325-339` | Actions that replace the whole config. |

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `app/lib/shapefx/controls.ts` | `SHAPE_CONTROLS`, `SHAPE_SECTIONS`, `visibleShapeControls()`, `SHAPE_GUIDANCE` | Create |
| `app/lib/shapefx/agentControls.ts` | `shapeAgentControls()` — a filter over the schema | Create |
| `app/lib/agent/studioTune.ts` | `tuneShapeNode` + registry entry | Modify |
| `app/lib/collection/studioControls.ts` | `shapeControls()` + switch case | Modify |
| `app/lib/collection/varsInput.ts` | add `'ShapeStudio'` to `VARS_TARGET_NODE_TYPES` | Modify |
| `app/components/vue-canvas/ShapeStudioSurface.vue` | `edges` prop, agent + bindings wiring, `bound` on controls, param baker | Modify |
| `app/components/vue-canvas/VueNodeCanvas.vue` | pass `:edges` to the surface | Modify |
| `tests/unit/shapefx-controls.unit.spec.ts` | schema integrity + characterization snapshot | Create |

---

### Task 1: The declarative schema

**Files:**
- Create: `app/lib/shapefx/controls.ts`
- Create: `tests/unit/shapefx-controls.unit.spec.ts`

**Interfaces:**
- Consumes: `ControlSpec` (`~/lib/spacetype/effect`), `ShapeConfig`/`DEFAULT_CONFIG`/`PRIMITIVE_KINDS` etc (`./config`), `HARMONY_TYPES` (`~/lib/color/harmony`), `FILL_TYPES` (`~/lib/spacetype/fillTile`).
- Produces:
  - `type ShapeControl = ControlSpec & { when?: (cfg: ShapeConfig) => boolean }`
  - `SHAPE_SECTIONS: readonly string[]`
  - `SHAPE_CONTROLS: ShapeControl[]`
  - `visibleShapeControls(cfg: ShapeConfig): ShapeControl[]`
  - `SHAPE_GUIDANCE: string`

- [ ] **Step 1: Read the exact option constants before writing**

Run and read:
```bash
grep -n "PRIMITIVE_KINDS\|COLORING_MODES\|COLOR_DIRECTIONS\|PROJECTIONS\|FILL_MODES\|export const" app/lib/shapefx/config.ts
grep -n "HARMONY_TYPES" app/lib/color/harmony.ts
grep -n "FILL_TYPES" app/lib/spacetype/fillTile.ts
grep -n "PRIMITIVE_OPTIONS\|ASPECT_OPTIONS\|fillNeedsB\|fillHasAngle\|fillHasDensity" app/components/vue-canvas/ShapeStudioSurface.vue
```

Use the REAL exported constant names and the REAL predicate definitions. If a union has no exported array constant, spread the literal values in the same order the surface's select uses.

- [ ] **Step 2: Write the failing integrity test**

Create `tests/unit/shapefx-controls.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SHAPE_CONTROLS, SHAPE_SECTIONS, visibleShapeControls } from '../../app/lib/shapefx/controls'
import { DEFAULT_CONFIG, mergeConfig } from '../../app/lib/shapefx/config'
import { makeConfigParams } from '../../app/lib/agent/configParams'

const cfg = (over: any = {}): any => mergeConfig({ ...structuredClone(DEFAULT_CONFIG), ...over })

describe('SHAPE_CONTROLS integrity', () => {
  it('has unique keys', () => {
    const keys = SHAPE_CONTROLS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every control belongs to a declared section', () => {
    for (const c of SHAPE_CONTROLS) {
      expect(SHAPE_SECTIONS, `${c.key} group "${c.group}"`).toContain(c.group)
    }
  })

  it('every select default is one of its own options', () => {
    for (const c of SHAPE_CONTROLS) {
      if (c.kind !== 'select') continue
      expect(c.options, `${c.key}`).toContain(c.default)
    }
  })

  it('every slider default sits inside its own range', () => {
    for (const c of SHAPE_CONTROLS) {
      if (c.kind !== 'slider') continue
      expect(c.default, `${c.key} default`).toBeGreaterThanOrEqual(c.min)
      expect(c.default, `${c.key} default`).toBeLessThanOrEqual(c.max)
      expect(c.max, `${c.key} range`).toBeGreaterThan(c.min)
    }
  })

  it('every key resolves against a real config leaf', () => {
    // The whole point of dotted keys: the agent writes through makeConfigParams.
    // A key that does not resolve is a control the agent can never actually set.
    const c = cfg()
    const params = makeConfigParams(() => c, () => 0)
    const unresolved = SHAPE_CONTROLS.map((s) => s.key).filter((k) => params[k] === undefined)
    expect(unresolved).toEqual([])
  })

  it('every slider default equals the value DEFAULT_CONFIG actually ships', () => {
    // Guards the schema against drifting from the real defaults, which is what
    // v-studio-reset double-click restores to.
    const c = cfg()
    const params = makeConfigParams(() => c, () => 0)
    for (const s of SHAPE_CONTROLS) {
      if (s.kind !== 'slider') continue
      expect(params[s.key], `${s.key}`).toBe(s.default)
    }
  })
})

describe('visibleShapeControls follows the surface predicates', () => {
  it('offers primitive controls in primitive mode and gem controls in gem mode', () => {
    const prim = visibleShapeControls(cfg({ shape: { ...DEFAULT_CONFIG.shape, mode: 'primitive' } })).map((c) => c.key)
    expect(prim).toContain('shape.primitive')
    expect(prim).toContain('shape.density')
    expect(prim).not.toContain('shape.vertices')

    const gem = visibleShapeControls(cfg({ shape: { ...DEFAULT_CONFIG.shape, mode: 'gem' } })).map((c) => c.key)
    expect(gem).toContain('shape.vertices')
    expect(gem).toContain('shape.depth')
    expect(gem).not.toContain('shape.density')
  })

  it('offers palette controls for facets and fill controls for surface, never both', () => {
    const facets = visibleShapeControls(cfg({ fillMode: 'facets' })).map((c) => c.key)
    expect(facets).toContain('palette.harmony')
    expect(facets.some((k) => k.startsWith('fill.'))).toBe(false)

    const surface = visibleShapeControls(cfg({ fillMode: 'surface' })).map((c) => c.key)
    expect(surface).toContain('fill.type')
    expect(surface.some((k) => k.startsWith('palette.'))).toBe(false)
  })

  it('withholds palette.direction when coloring is scatter', () => {
    const keys = visibleShapeControls(cfg({ fillMode: 'facets', palette: { ...DEFAULT_CONFIG.palette, coloring: 'scatter' } })).map((c) => c.key)
    expect(keys).not.toContain('palette.direction')
  })

  it('returns only members of SHAPE_CONTROLS', () => {
    const all = new Set(SHAPE_CONTROLS.map((c) => c.key))
    for (const c of visibleShapeControls(cfg())) expect(all.has(c.key), c.key).toBe(true)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test:unit tests/unit/shapefx-controls.unit.spec.ts`
Expected: FAIL — `Failed to resolve import ".../shapefx/controls"`.

- [ ] **Step 4: Write the schema**

Create `app/lib/shapefx/controls.ts`. Transcribe all 24 controls from the surface table below. Use the real option constants found in Step 1; use `DEFAULT_CONFIG.<path>` for every `default` (unlike Gradient, Shape's defaults are real and the tests assert them).

```ts
import type { ControlSpec } from '~/lib/spacetype/effect'
import { DEFAULT_CONFIG, type ShapeConfig } from './config'

/**
 * The single declarative description of Shape Studio's parameters.
 *
 * Source for the agent's vocabulary (`shapeAgentControls`) and for Collection
 * variable binding / sweeps (`lib/collection/studioControls.ts`). Keys are dotted
 * paths resolved by `makeConfigParams`, so each one must address a real leaf on
 * ShapeConfig — pinned by a test.
 *
 * Deliberately NOT here: the section lock toggles (re-roll metadata, and there is
 * no `switch` kind), the read-only palette preview, the derived base-colour
 * swatch (its three sliders are here individually), the transparent-background
 * union, and canvas size / orbit (both live outside ShapeConfig).
 *
 * Must stay free of `three` imports — this module is dynamically loaded by the
 * Collection control resolver.
 */
export type ShapeControl = ControlSpec & { when?: (cfg: ShapeConfig) => boolean }

/** Emission order; a control whose group is not listed here is dropped. */
export const SHAPE_SECTIONS = ['Form', 'Shape', 'Palette', 'Fill', 'Style'] as const

const isPrimitive = (c: ShapeConfig) => c.shape.mode === 'primitive'
const isGem = (c: ShapeConfig) => c.shape.mode === 'gem'
const isFacets = (c: ShapeConfig) => c.fillMode === 'facets'
const isSurface = (c: ShapeConfig) => c.fillMode === 'surface'

const slider = (
  key: string, label: string, min: number, max: number, step: number, group: string,
  def: number, hint?: string, extra: Partial<ShapeControl> = {},
): ShapeControl =>
  ({ key, label, kind: 'slider', min, max, step, default: def, group, ...(hint ? { hint } : {}), ...extra } as ShapeControl)

const select = (
  key: string, label: string, options: string[], def: string, group: string,
  hint?: string, extra: Partial<ShapeControl> = {},
): ShapeControl =>
  ({ key, label, kind: 'select', options, default: def, group, ...(hint ? { hint } : {}), ...extra } as ShapeControl)

export const SHAPE_CONTROLS: ShapeControl[] = [
  // --- Form ---------------------------------------------------------------
  select('fillMode', 'Fill mode', ['facets', 'surface'], DEFAULT_CONFIG.fillMode, 'Form',
    'facets = per-face colours from the palette; surface = one tiled fill over the whole solid'),

  // --- Shape --------------------------------------------------------------
  select('shape.mode', 'Mode', ['primitive', 'gem'], DEFAULT_CONFIG.shape.mode, 'Shape'),
  // ... transcribe the remaining Shape / Palette / Fill / Style controls here,
  //     in the surface's DOM order, with their `when` predicates.
]

/** Controls applicable to this config, in SHAPE_SECTIONS order. */
export function visibleShapeControls(cfg: ShapeConfig): ShapeControl[] {
  const out: ShapeControl[] = []
  for (const section of SHAPE_SECTIONS) {
    for (const c of SHAPE_CONTROLS) {
      if (c.group !== section) continue
      if (c.when && !c.when(cfg)) continue
      out.push(c)
    }
  }
  return out
}
```

The complete control table to transcribe (config path → kind → range/options → default → predicate). Ranges come from `ShapeStudioSurface.vue` lines noted:

| key | kind | range / options | default | group | `when` | line |
|---|---|---|---|---|---|---|
| `fillMode` | select | facets, surface | `DEFAULT_CONFIG.fillMode` | Form | — | 406 |
| `shape.mode` | select | primitive, gem | `…shape.mode` | Shape | — | 418 |
| `shape.primitive` | select | the 8 `PrimitiveKind`s | `…shape.primitive` | Shape | `isPrimitive` | 423 |
| `shape.density` | slider | 0 / 4 / 1 | `…shape.density` | Shape | `isPrimitive` | 425 |
| `shape.vertices` | slider | 4 / 40 / 1 | `…shape.vertices` | Shape | `isGem` | 428 |
| `shape.depth` | slider | 0.2 / 2 / 0.05 | `…shape.depth` | Shape | `isGem` | 429 |
| `shape.spread` | slider | 0.1 / 1 / 0.05 | `…shape.spread` | Shape | `isGem` | 430 |
| `shape.jitter` | slider | 0 / 100 / 1 | `…shape.jitter` | Shape | — | 432 |
| `shape.scale` | slider | 0.25 / 3 / 0.05 | `…shape.scale` | Shape | — | 433 |
| `shape.projection` | select | orthographic, perspective | `…shape.projection` | Shape | — | 436 |
| `palette.harmony` | select | `HARMONY_TYPES` | `…palette.harmony` | Palette | `isFacets` | 453 |
| `palette.baseHue` | slider | 0 / 360 / 1 | `…palette.baseHue` | Palette | `isFacets` | 462 |
| `palette.saturation` | slider | 0 / 100 / 1 | `…palette.saturation` | Palette | `isFacets` | 463 |
| `palette.lightness` | slider | 0 / 100 / 1 | `…palette.lightness` | Palette | `isFacets` | 464 |
| `palette.coloring` | select | prismatic, smooth, faceted, ombre, scatter | `…palette.coloring` | Palette | `isFacets` | 474 |
| `palette.direction` | select | vertical, depth, radial, angular | `…palette.direction` | Palette | `isFacets` AND `coloring !== 'scatter'` | 478 |
| `fill.type` | select | `FILL_TYPES` (8) | `…fill.type` | Fill | `isSurface` | 491 |
| `fill.a` | color | — | `…fill.a` | Fill | `isSurface` | 494 |
| `fill.b` | color | — | `…fill.b` | Fill | `isSurface` AND `fillNeedsB` | 495 |
| `fill.angle` | slider | 0 / 360 / 1 | `…fill.angle` | Fill | `isSurface` AND `fillHasAngle` | 497 |
| `fill.density` | slider | 2 / 32 / 1 | `…fill.density` | Fill | `isSurface` AND `fillHasDensity` | 498 |
| `style.grain` | slider | 0 / 100 / 1 | `…style.grain` | Style | — | 508 |
| `style.distortion` | slider | 0 / 100 / 1 | `…style.distortion` | Style | — | 509 |
| `style.background` | color | — | `…style.background` | Style | — | 516 |

Copy the `fillNeedsB` / `fillHasAngle` / `fillHasDensity` predicate bodies from `ShapeStudioSurface.vue:135-137` — do not re-derive them from memory.

- [ ] **Step 5: Run the tests**

Run: `pnpm test:unit tests/unit/shapefx-controls.unit.spec.ts`
Expected: PASS.

If "every key resolves against a real config leaf" fails, the key is wrong — fix the schema, not the test. If "every slider default equals DEFAULT_CONFIG" fails, you hardcoded a default instead of reading it from `DEFAULT_CONFIG`.

- [ ] **Step 6: Commit**

```bash
git add app/lib/shapefx/controls.ts tests/unit/shapefx-controls.unit.spec.ts
git commit -m "feat(shapefx): declarative control schema"
```

---

### Task 2: Agent vocabulary derived from the schema

**Files:**
- Create: `app/lib/shapefx/agentControls.ts`
- Modify: `tests/unit/shapefx-controls.unit.spec.ts`

**Interfaces:**
- Consumes: `visibleShapeControls` (Task 1).
- Produces: `shapeAgentControls(cfg: ShapeConfig): ControlSpec[]`, `SHAPE_GUIDANCE: string`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/shapefx-controls.unit.spec.ts`:

```ts
import { shapeAgentControls, SHAPE_GUIDANCE } from '../../app/lib/shapefx/agentControls'

describe('shapeAgentControls', () => {
  it('emits plain ControlSpecs with no schema-only fields leaking', () => {
    for (const c of shapeAgentControls(cfg())) {
      expect(c, c.key).not.toHaveProperty('when')
      expect(c, c.key).not.toHaveProperty('agent')
      expect(c, c.key).not.toHaveProperty('animatable')
    }
  })

  it('tracks the layout predicates', () => {
    const facets = shapeAgentControls(cfg({ fillMode: 'facets' })).map((c) => c.key)
    const surface = shapeAgentControls(cfg({ fillMode: 'surface' })).map((c) => c.key)
    expect(facets).toContain('palette.baseHue')
    expect(surface).toContain('fill.type')
    expect(facets).not.toEqual(surface)
  })

  it('is a characterization snapshot for both fill modes', () => {
    expect(shapeAgentControls(cfg({ fillMode: 'facets' }))).toMatchSnapshot()
    expect(shapeAgentControls(cfg({ fillMode: 'surface' }))).toMatchSnapshot()
  })

  it('guidance names only keys that exist in the schema', () => {
    // The guidance is prose fed to the model; a stale key name silently teaches it
    // to set something that will be dropped by validatePatch.
    const keys = new Set(SHAPE_CONTROLS.map((c) => c.key))
    for (const m of SHAPE_GUIDANCE.matchAll(/\b(?:shape|palette|fill|style)\.[a-zA-Z.]+/g)) {
      expect(keys.has(m[0]), `guidance names unknown key ${m[0]}`).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit tests/unit/shapefx-controls.unit.spec.ts`
Expected: FAIL — cannot resolve `.../shapefx/agentControls`.

- [ ] **Step 3: Write the derivation**

Create `app/lib/shapefx/agentControls.ts`:

```ts
import type { ControlSpec } from '~/lib/spacetype/effect'
import type { ShapeConfig } from './config'
import { visibleShapeControls } from './controls'

/**
 * Shape Studio's tune vocabulary for the in-product agent, derived from
 * SHAPE_CONTROLS rather than hand-listed. Only controls that apply to the current
 * fill mode and shape mode are returned, mirroring the surface's own v-if gating
 * so the agent is never offered a knob the user cannot see.
 */
export function shapeAgentControls(cfg: ShapeConfig): ControlSpec[] {
  return visibleShapeControls(cfg)
    .filter((c) => (c as any).agent !== false)
    .map(({ when, agent, animatable, ...spec }: any) => spec as ControlSpec)
}

/**
 * Domain guidance injected into the /api/vibe prompt. Teaches the model how the
 * knobs COMBINE into looks — without it the model sets one literal-sounding knob
 * and leaves the rest at defaults.
 */
export const SHAPE_GUIDANCE = `This is a FACETED 3D SHAPE generator (a gem or primitive solid rendered flat-shaded). Compose the WHOLE look, not one knob.

FORM: fillMode "facets" colours each face from a generated palette; "surface" wraps one tiled fill over the solid. shape.mode "gem" builds a faceted hull (shape.vertices = facet count, shape.depth = how deep, shape.spread = how wide); "primitive" uses a named solid (shape.primitive) subdivided by shape.density.

LOOK -> KNOBS (recognise synonyms):
- crystalline / gem / jewel / diamond / faceted -> shape.mode "gem", higher shape.vertices (16-30), palette.coloring "prismatic".
- chunky / low-poly / blocky / geometric -> shape.mode "primitive", low shape.density (0-1).
- smooth / rounded / organic -> higher shape.density (3-4), palette.coloring "smooth".
- rough / irregular / eroded / raw -> shape.jitter (30-70).
- soft / pastel / muted -> lower palette.saturation (25-45), higher palette.lightness (55-70).
- vivid / neon / punchy / saturated -> palette.saturation (80-100).
- grainy / filmic / gritty -> style.grain (30-60).
- warped / melted / liquid -> style.distortion (30-70).
- monochrome / one colour -> palette.harmony "monochromatic". rainbow / multicolour -> "analogous" or "triadic".`
```

- [ ] **Step 4: Run and generate the snapshot**

Run: `pnpm test:unit tests/unit/shapefx-controls.unit.spec.ts`
Expected: PASS, with 2 snapshots written.

If the guidance test fails, a key in the prose does not exist — fix the prose to match the schema.

- [ ] **Step 5: Commit**

```bash
git add app/lib/shapefx/agentControls.ts tests/unit/shapefx-controls.unit.spec.ts tests/unit/__snapshots__/shapefx-controls.unit.spec.ts.snap
git commit -m "feat(shapefx): derive agent vocabulary from the control schema"
```

---

### Task 3: Register the agent tuner

**Files:**
- Modify: `app/lib/agent/studioTune.ts`
- Modify: `tests/unit/studio-tune.unit.spec.ts`

**Interfaces:**
- Consumes: `shapeAgentControls`, `SHAPE_GUIDANCE` (Task 2); `mergeConfig`, `DEFAULT_CONFIG` (`~/lib/shapefx/config`).
- Produces: `tuneShapeNode(node, request, apiKey)` and `STUDIO_TUNERS.ShapeStudio`.

- [ ] **Step 1: Read the Gradient tuner and the registry test**

Run: `sed -n '320,375p' app/lib/agent/studioTune.ts` and `sed -n '20,45p' tests/unit/studio-tune.unit.spec.ts`

Note the existing registry-completeness test — it may enumerate expected keys and will need `ShapeStudio` added.

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/studio-tune.unit.spec.ts`:

```ts
describe('tuneShapeNode', () => {
  it('is registered for the ShapeStudio node type', async () => {
    const { studioTunerFor } = await import('~/lib/agent/studioTune')
    expect(studioTunerFor('ShapeStudio')).toBeTypeOf('function')
  })

  it('preserves the persisted wrapper when it writes back', async () => {
    // sailor_shapeStudio is { config, canvasW, canvasH, aspectKey, orbit } — NOT a
    // bare config like gradient's. Overwriting it with just the config would lose
    // the user's canvas size and camera orbit.
    const { __shapeAdapterForTest } = await import('~/lib/agent/studioTune')
    const node: any = { data: { properties: { sailor_shapeStudio: {
      config: { fillMode: 'facets' }, canvasW: 1920, canvasH: 1080, aspectKey: '16:9',
      orbit: { yaw: 1, pitch: 2, zoom: 3 },
    } } } }
    const a = __shapeAdapterForTest
    const cfg = await a.read(node)
    a.write(node, cfg.config)
    const saved = node.data.properties.sailor_shapeStudio
    expect(saved.canvasW).toBe(1920)
    expect(saved.canvasH).toBe(1080)
    expect(saved.aspectKey).toBe('16:9')
    expect(saved.orbit).toEqual({ yaw: 1, pitch: 2, zoom: 3 })
    expect(saved.config).toBeDefined()
  })

  it('falls back to defaults when the node has never been opened', async () => {
    const { __shapeAdapterForTest } = await import('~/lib/agent/studioTune')
    const node: any = { data: { properties: {} } }
    const { config, controls } = await __shapeAdapterForTest.read(node)
    expect(config.fillMode).toBeDefined()
    expect(controls.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test:unit tests/unit/studio-tune.unit.spec.ts`
Expected: FAIL — `studioTunerFor('ShapeStudio')` is undefined.

- [ ] **Step 4: Implement**

In `app/lib/agent/studioTune.ts`, add next to `tuneGradientNode`:

```ts
/**
 * Shape Studio's persisted property is a WRAPPER — { config, canvasW, canvasH,
 * aspectKey, orbit } — unlike gradient's bare config. `write` merges the tuned
 * config back into the existing wrapper so canvas size and camera orbit survive.
 */
const shapeAdapter: PatchAdapter = {
  read: async (n: any) => {
    const { mergeConfig } = await import('~/lib/shapefx/config')
    const { shapeAgentControls } = await import('~/lib/shapefx/agentControls')
    const config = mergeConfig(n?.data?.properties?.sailor_shapeStudio?.config)
    return { config, controls: shapeAgentControls(config) }
  },
  params: (config: any) => makeConfigParams(() => config, () => 0),
  write: (n: any, config: any) => {
    if (!n.data) n.data = {}
    if (!n.data.properties) n.data.properties = {}
    const prev = n.data.properties.sailor_shapeStudio ?? {}
    n.data.properties.sailor_shapeStudio = { ...prev, config: JSON.parse(JSON.stringify(config)) }
  },
  clone: (config: any) => JSON.parse(JSON.stringify(config)),
  label: 'Shape studio',
  guidance: SHAPE_GUIDANCE,
}

/** Exposed for tests only — the adapter is otherwise reached via the registry. */
export const __shapeAdapterForTest = shapeAdapter

export async function tuneShapeNode(node: any, request: string, apiKey: string): Promise<TuneResult> {
  return runParamPatch(node, request, apiKey, shapeAdapter)
}
```

Import `SHAPE_GUIDANCE` and `shapeAgentControls` **statically at the top of the file**, matching how `GRADIENT_GUIDANCE` is already imported there. Then `read` needs no dynamic import either — simplify it to match `tuneGradientNode`'s synchronous shape:

```ts
  read: (n: any) => {
    const config = mergeConfig(n?.data?.properties?.sailor_shapeStudio?.config)
    return { config, controls: shapeAgentControls(config) }
  },
```

Check the top of `studioTune.ts` first and follow whatever convention is already there — do not introduce a second one.

Then add to the registry:

```ts
export const STUDIO_TUNERS: Record<string, StudioTuner> = {
  Compositor: tuneCompositorNode,
  TextureStudio: tuneTextureNode,
  SmartLayout: tuneSmartLayoutNode,
  GradientStudio: tuneGradientNode,
  ShaderStudio: tuneShaderNode,
  ShapeStudio: tuneShapeNode,
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit tests/unit/studio-tune.unit.spec.ts tests/unit/shapefx-controls.unit.spec.ts`
Expected: PASS. If the registry-completeness test enumerates expected node types, add `ShapeStudio` to its list.

- [ ] **Step 6: Commit**

```bash
git add app/lib/agent/studioTune.ts tests/unit/studio-tune.unit.spec.ts
git commit -m "feat(agent): register the Shape Studio tuner"
```

---

### Task 4: Collection controls + the VARS port

**Files:**
- Modify: `app/lib/collection/studioControls.ts`
- Modify: `app/lib/collection/varsInput.ts`
- Modify: `tests/unit/collection-studio-controls.unit.spec.ts`

**Interfaces:**
- Consumes: `shapeAgentControls` (Task 2).
- Produces: `controlsForStudio` handling `'ShapeStudio'`; `'ShapeStudio'` in `VARS_TARGET_NODE_TYPES`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/collection-studio-controls.unit.spec.ts`:

```ts
describe('ShapeStudio', () => {
  it('resolves bindable controls for a ShapeStudio node', async () => {
    const { controlsForStudio } = await import('~/lib/collection/studioControls')
    const node: any = { data: { nodeType: 'ShapeStudio', properties: {} } }
    const descs = await controlsForStudio(node)
    expect(descs.length).toBeGreaterThan(0)
    expect(descs.map((d) => d.key)).toContain('shape.jitter')
  })

  it('is a vars target, so the node renders its VARS input port', async () => {
    // ShapeStudioNode.vue already computes varsInputIndex and renders the port
    // v-if="varsInputIndex >= 0" — it was dead code until this registration.
    const { VARS_TARGET_NODE_TYPES } = await import('~/lib/collection/varsInput')
    expect(VARS_TARGET_NODE_TYPES.has('ShapeStudio')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit tests/unit/collection-studio-controls.unit.spec.ts`
Expected: FAIL on both.

- [ ] **Step 3: Implement**

In `app/lib/collection/studioControls.ts`, add alongside `gradientControls` — note the dynamic imports, required by the file's header rule:

```ts
async function shapeControls(node: any): Promise<StudioControlDesc[]> {
  const [{ mergeConfig }, { shapeAgentControls }] = await Promise.all([
    import('~/lib/shapefx/config'),
    import('~/lib/shapefx/agentControls'),
  ])
  const config = mergeConfig(node?.data?.properties?.sailor_shapeStudio?.config)
  return mapAll(shapeAgentControls(config))
}
```

and the switch case:

```ts
    case 'ShapeStudio': return shapeControls(node)
```

In `app/lib/collection/varsInput.ts`, add `'ShapeStudio'` to the set:

```ts
export const VARS_TARGET_NODE_TYPES = new Set(['SmartLayout', 'SpaceType', 'GradientStudio', 'ShaderStudio', 'TextureStudio', 'ShapeStudio'])
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit tests/unit/collection-studio-controls.unit.spec.ts tests/unit/collection-studio-bindables.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/collection/studioControls.ts app/lib/collection/varsInput.ts tests/unit/collection-studio-controls.unit.spec.ts
git commit -m "feat(collection): Shape Studio controls are bindable, VARS port unlocked"
```

---

### Task 5: Wire the surface — agent bar and binding affordances

**Files:**
- Modify: `app/components/vue-canvas/ShapeStudioSurface.vue`
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue` (~line 7452, the ShapeStudioSurface mount)

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: no new exports.

- [ ] **Step 1: Add the `edges` prop and pass it from the canvas**

`ShapeStudioSurface.vue:34` is currently `defineProps<{ nodeId: string; nodes?: any[] }>()`. Add `edges`:

```ts
const props = defineProps<{ nodeId: string; nodes?: any[]; edges?: any[] }>()
```

Then at the mount site in `VueNodeCanvas.vue` (~7452), add `:edges="edges as any[]"` alongside the existing `:node-id` and `:nodes`. Match how `GradientStudioSurface` is mounted in the same file — copy its attribute exactly.

Without this, `useStudioVarBindings` cannot resolve a wired Collection node and every binding silently no-ops.

- [ ] **Step 2: Wire the bindings composable**

Add to `ShapeStudioSurface.vue`'s setup, following `GradientStudioSurface.vue:88-107`:

```ts
import { makeConfigParams } from '~/lib/agent/configParams'
import { controlsForStudio } from '~/lib/collection/studioControls'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'

const studioControls = ref<StudioControlDesc[]>([])
onMounted(async () => { studioControls.value = await controlsForStudio(currentNode()) })

const paramsProxy = makeConfigParams(() => config.value, () => 0)
const { boundColumnFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  () => studioControls.value,
  (key, value) => { paramsProxy[key] = value },
  { nodes: () => props.nodes ?? [], edges: () => props.edges ?? [] },
)
```

- [ ] **Step 3: Light up the bind affordance on sliders and fills**

`StudioSlider` already accepts `:bound` and `:bindable` and renders the `VariableGlyph` itself (`StudioSlider.vue:84-89`) — Shape currently passes neither. For each `StudioSlider` whose key is in the schema, add:

```vue
  :bindable="true" :bound="boundColumnFor('<dotted.key>')"
  @promote="promote({ key: '<dotted.key>', label: '<Label>', kind: 'slider', min: <min>, max: <max>, step: <step> }, config.<path>)"
  @menu="(e: MouseEvent) => openVarMenu(e, { key: '<dotted.key>', label: '<Label>', kind: 'slider' })"
```

For the two `FillSwatch`es (`:494`, `:495`), replace the hardcoded `:bound="null"` with `:bound="boundColumnFor('fill.a')"` / `'fill.b'` and handle their `promote` / `menu` emits.

Copy `openVarMenu` and the sweep plumbing verbatim from `GradientStudioSurface.vue:152-186` and `:133-149` — the map confirms Texture's and Gradient's copies are already byte-identical, so this is a third copy of a known-stable block. Note that in the commit message.

Also call `onEdit(key, value)` on each control's change so a bound value writes through to the Collection row, matching Gradient's `@input="onEdit('relief.grain', config.relief.grain)"` pattern.

- [ ] **Step 4: Wire the agent bar**

Following `GradientStudioSurface.vue:71-86`:

```ts
import { useStudioAgent } from '~/composables/useStudioAgent'
import { shapeAgentControls, SHAPE_GUIDANCE } from '~/lib/shapefx/agentControls'
import { getLocalSetting } from '~/lib/localSettings'

const agentParams = makeConfigParams(() => config.value, () => 0)
const activeAgentControls = computed(() => shapeAgentControls(config.value))
const shapeAgent = useStudioAgent({
  controls: () => activeAgentControls.value,
  params: agentParams,
  label: () => 'Shape studio',
  apiKey: () => getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '',
  guidance: () => SHAPE_GUIDANCE,
})
```

Mount the agent bar in the template the same way `StudioModalShell` receives it in `GradientStudioSurface.vue` — inspect that file and mirror it exactly, including any slot name.

- [ ] **Step 5: Verify**

Run: `pnpm test:unit`
Expected: no new failures.

Run: `npx vue-tsc --noEmit 2>&1 | grep -E "ShapeStudioSurface|VueNodeCanvas"` — report exactly what it prints; fix anything on lines you touched.

- [ ] **Step 6: Commit**

```bash
git add app/components/vue-canvas/ShapeStudioSurface.vue app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(shapefx): wire the agent bar and Collection bindings into the surface"
```

---

### Task 6: Param baker, so sweeps actually render

**Files:**
- Modify: `app/components/vue-canvas/ShapeStudioSurface.vue`
- Create: `tests/unit/shapefx-param-baker.unit.spec.ts`

A binding without a param baker lets you bind a control but produces no swept output. Gradient registers one at `GradientStudioSurface.vue:705` with the implementation at `:622-645`; the contract is `app/lib/studio/cascade.ts:27`.

**Interfaces:**
- Consumes: `registerStudioParamBaker` (`~/lib/studio/cascade`), the existing offscreen-bake approach in `ShapeStudioNode.vue:64-93`.
- Produces: a registered param baker for the Shape node.

- [ ] **Step 1: Read both references**

Run: `sed -n '618,650p;700,710p' app/components/vue-canvas/GradientStudioSurface.vue` and `sed -n '60,100p' app/components/vue-canvas/ShapeStudioNode.vue` and `sed -n '20,40p' app/lib/studio/cascade.ts`

Note Gradient's structure: snapshot the current values of the override keys, apply the overrides, render, then **restore in a `finally`**. The restore is what stops a sweep from permanently mutating the user's config.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/shapefx-param-baker.unit.spec.ts` testing the pure part — that applying overrides and restoring leaves the config untouched. Do not attempt to test WebGL rendering.

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '../../app/lib/shapefx/config'
import { makeConfigParams } from '../../app/lib/agent/configParams'

describe('shape param override round-trip', () => {
  it('applying then restoring overrides leaves the config byte-identical', () => {
    const cfg: any = mergeConfig(structuredClone(DEFAULT_CONFIG))
    const before = JSON.stringify(cfg)
    const params = makeConfigParams(() => cfg, () => 0)
    const overrides = { 'shape.jitter': 55, 'palette.baseHue': 12 }

    const snapshot: Record<string, unknown> = {}
    for (const k of Object.keys(overrides)) snapshot[k] = params[k]
    try {
      for (const [k, v] of Object.entries(overrides)) params[k] = v
      expect(cfg.shape.jitter).toBe(55)
      expect(cfg.palette.baseHue).toBe(12)
    } finally {
      for (const [k, v] of Object.entries(snapshot)) params[k] = v
    }
    expect(JSON.stringify(cfg)).toBe(before)
  })
})
```

- [ ] **Step 3: Run it**

Run: `pnpm test:unit tests/unit/shapefx-param-baker.unit.spec.ts`
Expected: PASS immediately — this pins the contract the baker must honour, using only existing pieces.

- [ ] **Step 4: Implement the baker**

In `ShapeStudioSurface.vue`, add a `renderBlobWithOverrides(overrides)` mirroring Gradient's `:622-645`: snapshot → apply via `paramsProxy` → render to a blob using the same offscreen-engine approach as `ShapeStudioNode.vue:64-93` (`new ShapeEngine` → `setConfig` → `render(orbit)` → `frameToBlob` → `dispose`) → restore in a `finally`. Register it alongside the existing lifecycle hooks:

```ts
registerStudioParamBaker(props.nodeId, renderBlobWithOverrides)
```

Use the surface's current `canvasW` / `canvasH` / `orbit` for the render, so a swept frame matches what the user sees.

- [ ] **Step 5: Verify**

Run: `pnpm test:unit`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add app/components/vue-canvas/ShapeStudioSurface.vue tests/unit/shapefx-param-baker.unit.spec.ts
git commit -m "feat(shapefx): param baker so Collection sweeps render"
```

---

## Follow-on, explicitly not in this plan

**Motion.** Shape's renderer is stateful and has no time parameter: `ShapeEngine.setConfig()` (`app/lib/shapefx/engine.ts:65-90`) disposes and rebuilds geometry, material and texture, while `render(orbit)` (`:92-105`) is the cheap per-frame call and takes orbit, not config or time. Compare `gradientfx/renderer.ts:155-156`, where `render(cfg, w, h, time)` calls `applyMotion` on every frame.

Two viable routes when we take it on:
1. **Cheap subset** — animate only what needs no rebuild: `shape.scale` and the orbit `yaw`/`pitch`/`zoom`, all already applied per-frame at `engine.ts:94-101`. A spin/orbit loop is nearly free and covers the obvious use case. This argues for promoting `orbit` into the config (or a `motion.camera` block) since it currently lives outside `ShapeConfig`.
2. **Full** — `render(orbit, time)` diffs `applyShapeMotion(cfg, t)` against the last applied config and calls `setConfig` only when a rebuild-triggering path changed; palette-only changes can go through `applyVertexColors` (`shapefx/color.ts:87`) without touching geometry.

Either route also needs `registerStudioFrameSource` (Shape has none — see `GradientStudioNode.vue:86-90` for the pattern). `app/lib/scene3d/motion/` is the better structural precedent than `gradientfx` here, being the other three.js studio with full motion.

**Also noted, not fixed here:** `style.grain` and `style.distortion` are CSS/SVG overlays applied to the live preview only (`ShapeStudioSurface.vue:159-184`) and are **not baked by the engine** — so exported and swept frames silently drop them. That is a pre-existing bug worth its own fix, and it will become more visible once sweeps make people compare rendered variants side by side.
