# Gradient Control Schema + Path-Based Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a single declarative `GRADIENT_CONTROLS` list the source that both the agent's control vocabulary and the motion-animatable targets derive from — so every numeric Gradient parameter becomes animatable instead of only 11 hardcoded shape keys.

**Architecture:** A Gradient parameter is currently declared in up to 7 places. This plan collapses two of them onto one declarative list, and converts motion from `{layer, param}` index-targeting to dotted-path targeting so any config leaf can animate. The schema is a **superset**: each consumer opts in (`animatable` for motion, `agent: false` to withhold from the agent), so adding a control to the schema never silently changes another capability. Characterization snapshots pin the agent's current output so the derivation is provably behaviour-preserving. A migration rewrites saved `{layer, param}` tracks. The inspector UI rewrite (432 lines of hand-written markup → generic renderer) is explicitly the follow-on plan, not this one.

**Tech Stack:** TypeScript, Vue 3 (Nuxt 4), Vitest (`*.unit.spec.ts`, node environment), WebGL2.

## Global Constraints

- **Control keys are frozen. Never rename a `ControlSpec.key`.** Persisted Collection bindings are stored as `params.<key>` (`lib/collection/studioBindables.ts:31`), and `GRADIENT_GUIDANCE` names keys in prose (`focus.blur`, `relief.grain`, `layer.color.stops.0.color`, `flow.depth`) with unit tests asserting on that text.
- **All new `ControlSpec` fields must be optional.** ~30 files under `app/lib/spacetype/effects/` declare `ControlSpec[]`; a required field is a 30-file change.
- **Preserve `default: 0` on every migrated slider.** The existing `slider()` helper (`agentControls.ts:17-19`) hardcodes `default: 0` — Gradient's surface reads live config, so the field is currently inert. Setting "correct" defaults would break the Task 2 snapshots for no benefit. Keep `0`.
- **Preserve `hint` presence exactly.** The helper conditionally spreads `...(hint ? { hint } : {})` — a control without a hint has **no** `hint` key at all, not `hint: undefined`. Snapshots will catch this.
- **Saved-project compatibility is mandatory.** Existing `node.data.properties.sailor_gradientStudio` docs contain tracks shaped `{ layer, param }`.
- Working directory for all commands: `/Users/julien/Documents/GitHub/Sailor/frontend`
- Test runner: `pnpm test:unit` (Vitest). Single file: `pnpm test:unit <path>`.
- Typecheck baseline is ~328 pre-existing errors. Add none; do not fix unrelated ones.
- Commit after every task, Conventional Commits style.

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `app/lib/studio/path.ts` | Shared array-aware `getByPath` / `setByPath`. | Create |
| `app/lib/gradientfx/controls.ts` | `GRADIENT_CONTROLS` + `GRADIENT_SECTIONS` + `visibleGradientControls()`. The one declaration. | Create |
| `app/lib/gradientfx/agentControls.ts` | `gradientAgentControls()` becomes a derivation. `GRADIENT_GUIDANCE` untouched. | Modify |
| `app/lib/gradientfx/motion.ts` | `animatableTargets()` derived from schema; `applyMotion` uses `setByPath`; remap/drop rewrite path segments. | Modify |
| `app/lib/gradientfx/types.ts` | `MotionTrack.path`; `migrateMotionTracks()` called from `ensureConfigDefaults`. | Modify |
| `app/lib/spacetype/effect.ts` | `ControlMeta` gains optional `animatable` and `agent`. | Modify |
| `app/components/vue-canvas/GradientStudioSurface.vue` | Track editor: two selects → one path select. | Modify |
| `tests/unit/studio-path.unit.spec.ts` | Path utility incl. array traversal. | Create |
| `tests/unit/gradientfx-controls.unit.spec.ts` | Characterization + schema integrity. | Create |
| `tests/unit/gradientfx-motion-path.unit.spec.ts` | Path motion, migration. | Create |

---

### Task 1: Shared array-aware path utility

`setByPath` exists only in `app/lib/shaderstudio/motion.ts:24-37` and creates `{}` for missing intermediates. Gradient's deepest paths cross array indices (`layers.0.color.stops.0.color`), so a missing intermediate before a numeric key must become `[]`.

**Files:**
- Create: `app/lib/studio/path.ts`
- Create: `tests/unit/studio-path.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getByPath(obj: unknown, path: string): unknown`, `setByPath(obj: unknown, path: string, value: unknown): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/studio-path.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getByPath, setByPath } from '../../app/lib/studio/path'

describe('getByPath', () => {
  it('reads a nested value', () => {
    expect(getByPath({ a: { b: { c: 5 } } }, 'a.b.c')).toBe(5)
  })
  it('reads through an array index', () => {
    expect(getByPath({ layers: [{ shape: { count: 12 } }] }, 'layers.0.shape.count')).toBe(12)
  })
  it('returns undefined for a missing hop instead of throwing', () => {
    expect(getByPath({ a: {} }, 'a.b.c')).toBeUndefined()
  })
  it('returns undefined when traversing through null', () => {
    expect(getByPath({ a: null }, 'a.b')).toBeUndefined()
  })
  it('returns undefined for an empty path', () => {
    expect(getByPath({ a: 1 }, '')).toBeUndefined()
  })
})

describe('setByPath', () => {
  it('writes a nested value', () => {
    const o: any = { a: { b: { c: 1 } } }
    setByPath(o, 'a.b.c', 9)
    expect(o.a.b.c).toBe(9)
  })
  it('writes through an existing array index', () => {
    const o: any = { layers: [{ shape: { count: 1 } }] }
    setByPath(o, 'layers.0.shape.count', 42)
    expect(o.layers[0].shape.count).toBe(42)
  })
  it('creates an ARRAY when the next key is numeric', () => {
    const o: any = {}
    setByPath(o, 'layers.0.count', 3)
    expect(Array.isArray(o.layers)).toBe(true)
    expect(o.layers[0].count).toBe(3)
  })
  it('creates an OBJECT when the next key is not numeric', () => {
    const o: any = {}
    setByPath(o, 'focus.blur', 0.5)
    expect(Array.isArray(o.focus)).toBe(false)
    expect(o.focus.blur).toBe(0.5)
  })
  it('does not clobber an existing array with an object', () => {
    const o: any = { layers: [{ shape: {} }] }
    setByPath(o, 'layers.1.shape.count', 7)
    expect(Array.isArray(o.layers)).toBe(true)
    expect(o.layers[1].shape.count).toBe(7)
  })
  it('is a no-op on an empty path', () => {
    const o: any = { a: 1 }
    setByPath(o, '', 5)
    expect(o).toEqual({ a: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit tests/unit/studio-path.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "../../app/lib/studio/path"`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/studio/path.ts`:

```ts
/**
 * Shared dotted-path traversal for studio configs.
 *
 * Unlike the older copy in shaderstudio/motion.ts, this one is array-aware: when
 * creating a missing intermediate it looks at the NEXT segment and creates an
 * array if that segment is a numeric index. Gradient's deepest paths
 * (`layers.0.color.stops.0.color`) cross two array boundaries, and an object
 * where an array is expected breaks renderers silently.
 */

const isIndex = (k: string): boolean => /^\d+$/.test(k)

export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj)
}

export function setByPath(obj: unknown, path: string, value: unknown): void {
  if (!path) return
  const keys = path.split('.')
  let o: any = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    if (o[k] == null || typeof o[k] !== 'object') {
      o[k] = isIndex(keys[i + 1]!) ? [] : {}
    }
    o = o[k]
  }
  o[keys[keys.length - 1]!] = value
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit tests/unit/studio-path.unit.spec.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/studio/path.ts tests/unit/studio-path.unit.spec.ts
git commit -m "feat(studio): add shared array-aware getByPath/setByPath"
```

---

### Task 2: Characterization snapshots for the agent's current vocabulary

Pin `gradientAgentControls`'s exact current output before refactoring, so Task 3 is provably behaviour-preserving.

**Files:**
- Create: `tests/unit/gradientfx-controls.unit.spec.ts`

**Interfaces:**
- Consumes: `gradientAgentControls` from `app/lib/gradientfx/agentControls.ts`; the default-config factory from `app/lib/gradientfx/types.ts`; `makeConfigParams` from `app/lib/agent/configParams.ts`.
- Produces: snapshot fixtures Task 3 must not break.

- [ ] **Step 1: Confirm the default-config factory name**

Run: `grep -n "^export function default\|^export const default\|ensureConfigDefaults" app/lib/gradientfx/types.ts`

Use the real exported factory name in the test below wherever `defaultConfig` appears. If no zero-arg factory exists, build a config via `ensureConfigDefaults({} as any)` and use that instead.

- [ ] **Step 2: Write the characterization test**

Create `tests/unit/gradientfx-controls.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gradientAgentControls } from '../../app/lib/gradientfx/agentControls'
import { defaultConfig } from '../../app/lib/gradientfx/types'
import { makeConfigParams } from '../../app/lib/agent/configParams'

/**
 * Characterization tests. These pin the CURRENT output of gradientAgentControls
 * so converting it into a derivation over GRADIENT_CONTROLS is provably
 * behaviour-preserving. A change here means the agent's vocabulary moved, which
 * silently breaks saved Collection bindings (`params.<key>`) and the key strings
 * baked into GRADIENT_GUIDANCE.
 */

function cfgWithLayout(layout: string) {
  const c: any = defaultConfig()
  c.canvas.layout = layout
  return c
}

const LAYOUTS_UNDER_TEST = ['linear', 'radial', 'orbit', 'liquid', 'mesh'] as const

describe('gradientAgentControls characterization', () => {
  for (const layout of LAYOUTS_UNDER_TEST) {
    it(`emits stable full specs for layout=${layout}`, () => {
      expect(gradientAgentControls(cfgWithLayout(layout))).toMatchSnapshot()
    })
  }

  it('emits stable specs with includePreset', () => {
    expect(gradientAgentControls(cfgWithLayout('linear'), { includePreset: true })).toMatchSnapshot()
  })

  it('includePreset adds exactly one control, at the front', () => {
    const withPreset = gradientAgentControls(cfgWithLayout('linear'), { includePreset: true })
    const without = gradientAgentControls(cfgWithLayout('linear'))
    expect(withPreset).toHaveLength(without.length + 1)
    expect(withPreset[0]!.key).toBe('preset')
  })

  it('emits focus.angle only when focus.shape is linear', () => {
    const off: any = cfgWithLayout('linear')
    expect(gradientAgentControls(off).some((c) => c.key === 'focus.angle')).toBe(false)
    const lin: any = cfgWithLayout('linear')
    lin.focus = { ...(lin.focus ?? {}), shape: 'linear' }
    expect(gradientAgentControls(lin).some((c) => c.key === 'focus.angle')).toBe(true)
  })

  it('emits one colour control per stop, in ramp order', () => {
    const cfg: any = cfgWithLayout('linear')
    const stops = cfg.layers[0].color.stops.length
    const colours = gradientAgentControls(cfg).filter((c) => c.key.startsWith('layer.color.stops.'))
    expect(colours).toHaveLength(stops)
    expect(colours[0]!.key).toBe('layer.color.stops.0.color')
    expect(colours[0]!.label).toBe('Colour 1')
  })
})

describe('gradientAgentControls integrity', () => {
  for (const layout of LAYOUTS_UNDER_TEST) {
    it(`every emitted key resolves against a real config leaf for layout=${layout}`, () => {
      const cfg = cfgWithLayout(layout)
      const params = makeConfigParams(() => cfg, () => 0)
      const unresolved = gradientAgentControls(cfg)
        .map((c) => c.key)
        .filter((k) => params[k] === undefined)
      expect(unresolved).toEqual([])
    })

    it(`has no duplicate keys for layout=${layout}`, () => {
      const keys = gradientAgentControls(cfgWithLayout(layout)).map((c) => c.key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it(`every slider declares a finite range for layout=${layout}`, () => {
      for (const c of gradientAgentControls(cfgWithLayout(layout))) {
        if (c.kind !== 'slider') continue
        expect(Number.isFinite(c.min), `${c.key} min`).toBe(true)
        expect(Number.isFinite(c.max), `${c.key} max`).toBe(true)
        expect(c.max, `${c.key} range`).toBeGreaterThan(c.min)
      }
    })
  }
})
```

- [ ] **Step 3: Run to generate the snapshot baseline**

Run: `pnpm test:unit tests/unit/gradientfx-controls.unit.spec.ts`
Expected: PASS, with Vitest reporting "6 snapshots written".

If the "every emitted key resolves" assertion FAILS for some layout, you have discovered a **pre-existing bug**. Do not fix it here. Change that single `it` to `it.skip` with a comment `// TODO(factory): pre-existing unresolved keys: <exact list>`, and name the keys in the commit message.

- [ ] **Step 4: Verify the snapshot file is substantial**

Run: `wc -l tests/unit/__snapshots__/gradientfx-controls.unit.spec.ts.snap`
Expected: well over 200 lines.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/gradientfx-controls.unit.spec.ts tests/unit/__snapshots__/gradientfx-controls.unit.spec.ts.snap
git commit -m "test(gradientfx): characterize agent control output before refactor"
```

---

### Task 3: Declarative `GRADIENT_CONTROLS` with the agent vocabulary derived from it

The current builder emits strictly in group order: `Preset → Canvas → Colours → Flow → Liquid → Mesh → Relief → Layer → Focus`. That makes a group-ordered derivation exactly reproduce it. Runtime-cardinality colour controls (one per stop / mesh point) are synthesized into the `Colours` group.

**Files:**
- Create: `app/lib/gradientfx/controls.ts`
- Modify: `app/lib/gradientfx/agentControls.ts`
- Modify: `tests/unit/gradientfx-controls.unit.spec.ts`

**Interfaces:**
- Consumes: `ControlSpec` (`app/lib/spacetype/effect.ts`), `GradientConfig`, `ASPECTS`, `BLEND_MODES`, `LAYOUTS` (`./types`), `GRADIENT_PRESET_NAMES` (`./presets`).
- Produces:
  - `type GradientControl = ControlSpec & { when?: (cfg: GradientConfig) => boolean }`
  - `GRADIENT_SECTIONS: readonly string[]`
  - `GRADIENT_CONTROLS: GradientControl[]`
  - `visibleGradientControls(cfg: GradientConfig, opts?: { includePreset?: boolean }): GradientControl[]`

- [ ] **Step 1: Write the schema-integrity test (failing)**

Append to `tests/unit/gradientfx-controls.unit.spec.ts`:

```ts
import { GRADIENT_CONTROLS, GRADIENT_SECTIONS, visibleGradientControls } from '../../app/lib/gradientfx/controls'

describe('GRADIENT_CONTROLS schema integrity', () => {
  it('has unique keys', () => {
    const keys = GRADIENT_CONTROLS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every control belongs to a declared section', () => {
    for (const c of GRADIENT_CONTROLS) {
      expect(GRADIENT_SECTIONS, `${c.key} group "${c.group}"`).toContain(c.group)
    }
  })

  it('every select default is one of its own options', () => {
    for (const c of GRADIENT_CONTROLS) {
      if (c.kind !== 'select') continue
      expect(c.options, `${c.key} options`).toContain(c.default)
    }
  })

  it('every slider keeps the inert default of 0', () => {
    for (const c of GRADIENT_CONTROLS) {
      if (c.kind !== 'slider') continue
      expect(c.default, `${c.key} default`).toBe(0)
    }
  })

  it('visibleGradientControls only returns members of GRADIENT_CONTROLS', () => {
    const all = new Set(GRADIENT_CONTROLS.map((c) => c.key))
    for (const c of visibleGradientControls(defaultConfig() as any)) {
      expect(all.has(c.key), `${c.key} not in GRADIENT_CONTROLS`).toBe(true)
    }
  })

  it('declares Shape controls that are withheld from the agent', () => {
    const shape = GRADIENT_CONTROLS.filter((c) => c.group === 'Shape')
    expect(shape.length).toBeGreaterThan(0)
    for (const c of shape) expect((c as any).agent, `${c.key}`).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit tests/unit/gradientfx-controls.unit.spec.ts`
Expected: FAIL — `Failed to resolve import ".../gradientfx/controls"`.

- [ ] **Step 3: Extend `ControlMeta` with the two opt-in fields**

Do this before writing the schema — it uses both fields. Modify `app/lib/spacetype/effect.ts`, extending `ControlMeta` (lines 12-16). Both fields are optional, so the ~30 spacetype effect files are unaffected:

```ts
type ControlMeta = {
  hint?: string
  aiEditable?: boolean
  showIf?: { key: string; equals?: ParamValue; notEquals?: ParamValue }
  /**
   * Set false to declare a control in the schema while withholding it from the
   * agent's vocabulary. Used for controls the agent has never been offered, so
   * declaring them for motion/inspector purposes is not a silent expansion of
   * what the model can change. Defaults to true.
   */
  agent?: boolean
  /**
   * Motion-track eligibility for numeric controls. Sliders are animatable by
   * default; pass false to opt out, or an explicit range when animation should
   * allow more than the UI slider does (e.g. layer.shape.sweep: slider 20..360,
   * animation 0..360).
   */
  animatable?: boolean | { min: number; max: number }
}
```

- [ ] **Step 4: Create the declarative schema**

Create `app/lib/gradientfx/controls.ts`. This is the complete list, transcribed from the current builder in emission order:

```ts
import type { ControlSpec } from '~/lib/spacetype/effect'
import { ASPECTS, BLEND_MODES, LAYOUTS, type GradientConfig } from './types'
import { GRADIENT_PRESET_NAMES } from './presets'

/**
 * The single declarative description of Gradient Studio's parameters.
 *
 * This list is the SOURCE. `gradientAgentControls` derives the agent vocabulary
 * from it and `motion.ts` derives animatable targets from it. The inspector UI
 * will derive from it in a follow-on change; today it is still hand-written.
 *
 * It is a SUPERSET — each consumer opts in. `agent: false` withholds a control
 * from the agent (used for the Shape block, which the agent has never seen);
 * `animatable: false` withholds a slider from motion. That way adding a control
 * here can never silently change another capability.
 *
 * Keys are FROZEN: persisted Collection bindings are `params.<key>`, and
 * GRADIENT_GUIDANCE names keys in prose.
 */
export type GradientControl = ControlSpec & {
  when?: (cfg: GradientConfig) => boolean
}

/** Emission order. The legacy builder emitted strictly in this group order. */
export const GRADIENT_SECTIONS = [
  'Preset', 'Canvas', 'Colours', 'Flow', 'Liquid', 'Mesh', 'Shape', 'Relief', 'Layer', 'Focus',
] as const

const isRadial = (c: GradientConfig) => c.canvas.layout === 'radial' || c.canvas.layout === 'orbit'
const isLiquid = (c: GradientConfig) => c.canvas.layout === 'liquid'
const isMesh = (c: GradientConfig) => c.canvas.layout === 'mesh'
const isBanded = (c: GradientConfig) => !isLiquid(c) && !isMesh(c)

/** Mirrors agentControls.ts's helper exactly, including the inert `default: 0`. */
function slider(
  key: string, label: string, min: number, max: number, step: number, group: string,
  hint?: string, extra: Partial<GradientControl> = {},
): GradientControl {
  return { key, label, kind: 'slider', min, max, step, default: 0, group, ...(hint ? { hint } : {}), ...extra } as GradientControl
}

export const GRADIENT_CONTROLS: GradientControl[] = [
  // --- Preset (agent-only macro; the surface has its own button row) --------
  { key: 'preset', label: 'Style preset', kind: 'select', options: [...GRADIENT_PRESET_NAMES], default: 'linear', group: 'Preset',
    hint: 'The overall look. marble/oil/ink/lava/satin = liquid surfaces; ripple/stack = concentric; mesh = soft blobs; linear = simple ramp. Set this to establish a style, then override colours/blur/grain. Leave it alone when only ADJUSTING an existing gradient.' },

  // --- Canvas --------------------------------------------------------------
  { key: 'canvas.aspect', label: 'Aspect ratio', kind: 'select', options: [...ASPECTS], default: '16:9', group: 'Canvas', hint: 'Output proportions' },
  { key: 'canvas.layout', label: 'Layout', kind: 'select', options: [...LAYOUTS], default: 'linear', group: 'Canvas', hint: 'Overall composition: linear/radial/orbit/stack/liquid/mesh' },
  slider('canvas.margin', 'Margin', 0, 0.45, 0.01, 'Canvas', undefined, { when: isBanded }),
  { key: 'canvas.background', label: 'Background', kind: 'color', default: '#000000', group: 'Canvas' },
  slider('canvas.innerRadius', 'Inner radius', 0, 0.9, 0.01, 'Canvas', undefined, { when: isRadial }),
  slider('canvas.center.x', 'Center X', -0.5, 0.5, 0.01, 'Canvas', undefined, { when: isRadial }),
  slider('canvas.center.y', 'Center Y', -0.5, 0.5, 0.01, 'Canvas', undefined, { when: isRadial }),

  // --- Colours: runtime cardinality, synthesized in visibleGradientControls --

  // --- Flow (every layout) --------------------------------------------------
  slider('flow.angle', 'Flow angle', 0, 360, 1, 'Flow'),
  slider('flow.noiseScale', 'Noise scale', 0.5, 8, 0.1, 'Flow'),
  slider('flow.intensity', 'Noise intensity', 0, 100, 1, 'Flow', 'Strength of the liquid warp; 0 = flat gradient'),
  slider('flow.distortion', 'Curve distortion', 0, 100, 1, 'Flow'),
  slider('flow.detail', 'Detail', 1, 6, 1, 'Flow'),
  slider('flow.swirl', 'Swirl', 0, 100, 1, 'Flow'),
  slider('flow.speed', 'Flow speed', 0, 100, 1, 'Flow', 'Living drift speed (visible in video export)'),

  // --- Liquid only ----------------------------------------------------------
  slider('flow.depth', 'Depth', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.highlights', 'Highlights', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.shadows', 'Shadows', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.foldScale', 'Fold scale', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.gloss', 'Gloss', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.veins', 'Veins', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.veinScale', 'Vein scale', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.ripple', 'Ripple', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.refract', 'Refraction', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('flow.viscosity', 'Viscosity', 0, 100, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('relief.light.azimuth', 'Light angle', 0, 360, 1, 'Liquid', undefined, { when: isLiquid }),
  slider('relief.light.elevation', 'Light height', 0, 90, 1, 'Liquid', undefined, { when: isLiquid }),

  // --- Mesh only ------------------------------------------------------------
  slider('layer.mesh.softness', 'Softness', 10, 100, 1, 'Mesh', undefined, { when: isMesh }),
  slider('layer.mesh.contrast', 'Contrast', 0, 100, 1, 'Mesh', undefined, { when: isMesh }),
  slider('layer.mesh.blur', 'Blur', 0, 100, 1, 'Mesh', undefined, { when: isMesh }),
  slider('layer.mesh.drift', 'Drift', 0, 100, 1, 'Mesh', undefined, { when: isMesh }),

  // --- Shape: previously ORPHANED. Present in the surface and in the legacy
  //     ANIMATABLE list, but never in the agent vocabulary. Declared here with
  //     `agent: false` so motion can derive from them without changing the
  //     agent's snapshot. Exposing them to the agent is a deliberate later step.
  //     Ranges are the legacy ANIMATABLE ranges (motion.ts:8-20), which for
  //     `sweep` and `count` intentionally differ from the UI slider bounds.
  slider('layer.shape.phase', 'Wave phase', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.scrub', 'Scrub / rotate', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.peaks', 'Peaks', 1, 12, 1, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.count', 'Count', 2, 64, 1, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.minDepth', 'Min depth', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.curveExp', 'Curve exponent', 0.2, 3, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.jitter', 'Jitter', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  // Slider bound is 20 but animation is allowed the full 0..360 — the one known
  // UI-vs-track divergence, declared once here instead of in two lists.
  slider('layer.shape.sweep', 'Sweep', 20, 360, 1, 'Shape', undefined, { agent: false, when: isBanded, animatable: { min: 0, max: 360 } }),
  slider('layer.shape.gap', 'Gap', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.rounding', 'Rounding', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),
  slider('layer.shape.valley', 'Valley position', 0, 1, 0.01, 'Shape', undefined, { agent: false, when: isBanded }),

  // --- Relief ---------------------------------------------------------------
  slider('relief.grain', 'Grain', 0, 1, 0.01, 'Relief'),
  slider('relief.relief', 'Relief', 0, 1, 0.01, 'Relief', undefined, { when: isBanded }),

  // --- Layer ----------------------------------------------------------------
  { key: 'layer.blend', label: 'Blend', kind: 'select', options: [...BLEND_MODES], default: 'normal', group: 'Layer' },
  slider('layer.opacity', 'Opacity', 0, 1, 0.01, 'Layer'),
  slider('layer.color.steps', 'Posterize steps', 0, 24, 1, 'Layer', '0 = smooth; higher = banded'),
  slider('layer.color.hueDrift', 'Hue drift', -180, 180, 1, 'Layer'),
  slider('layer.color.hueRotate', 'Hue rotate', 0, 360, 1, 'Layer'),

  // --- Focus ----------------------------------------------------------------
  slider('focus.blur', 'Blur', 0, 100, 1, 'Focus', 'Soft-focus / defocus amount; 0 = perfectly sharp'),
  { key: 'focus.shape', label: 'Focus region', kind: 'select', options: ['off', 'radial', 'linear'], default: 'off', group: 'Focus',
    hint: 'off = blur the whole thing evenly; radial = keep a round spot sharp; linear = keep an angled band sharp (tilt-shift)' },
  slider('focus.radius', 'Focus size', 0, 1, 0.01, 'Focus', 'Size of the in-focus region (needs a radial/linear shape)'),
  slider('focus.softness', 'Focus falloff', 0, 100, 1, 'Focus', 'How gradually blur ramps in past the focus region'),
  slider('focus.x', 'Focus X', -0.5, 0.5, 0.01, 'Focus', 'Focus centre, left↔right'),
  slider('focus.y', 'Focus Y', -0.5, 0.5, 0.01, 'Focus', 'Focus centre, up↔down'),
  slider('focus.angle', 'Band angle', 0, 360, 1, 'Focus', undefined, { when: (c) => c.focus?.shape === 'linear' }),
]

/** Per-stop / per-mesh-point colour controls — runtime cardinality. */
function colourControls(cfg: GradientConfig): GradientControl[] {
  const colour = (key: string, i: number, hint?: string): GradientControl =>
    ({ key, label: `Colour ${i + 1}`, kind: 'color', default: '#ffffff', group: 'Colours', ...(hint ? { hint } : {}) } as GradientControl)
  const layer0 = cfg.layers[0]
  if (cfg.canvas.layout === 'mesh') {
    const pts = layer0?.mesh?.points ?? []
    return pts.map((_, i) => colour(`layer.mesh.points.${i}.color`, i,
      i === 0 ? 'The gradient colours, in order. Set these to recolour the whole gradient.' : undefined))
  }
  const stops = layer0?.color?.stops ?? []
  return stops.map((_, i) => colour(`layer.color.stops.${i}.color`, i,
    i === 0 ? 'The gradient colours, in ramp order (1 = start). Set these to recolour the whole gradient.' : undefined))
}

/**
 * Controls applicable to this config, in GRADIENT_SECTIONS order, with the
 * runtime colour block spliced into the Colours section. `preset` is omitted
 * unless explicitly requested (the in-studio copilot can't express a whole-
 * config swap; only the canvas tuner can).
 */
export function visibleGradientControls(
  cfg: GradientConfig,
  opts: { includePreset?: boolean } = {},
): GradientControl[] {
  const out: GradientControl[] = []
  for (const section of GRADIENT_SECTIONS) {
    if (section === 'Preset') {
      if (opts.includePreset) out.push(...GRADIENT_CONTROLS.filter((c) => c.group === 'Preset'))
      continue
    }
    if (section === 'Colours') { out.push(...colourControls(cfg)); continue }
    for (const c of GRADIENT_CONTROLS) {
      if (c.group !== section) continue
      if (c.when && !c.when(cfg)) continue
      out.push(c)
    }
  }
  return out
}
```

- [ ] **Step 5: Rewrite `gradientAgentControls` as a derivation**

In `app/lib/gradientfx/agentControls.ts`, delete the `slider` helper and the whole body of `gradientAgentControls`, replacing them with the derivation. Leave `GRADIENT_GUIDANCE` completely untouched:

```ts
import type { ControlSpec } from '~/lib/spacetype/effect'
import type { GradientConfig } from './types'
import { visibleGradientControls } from './controls'

/**
 * The Gradient studio's tune vocabulary for the in-product agent, derived from
 * the declarative GRADIENT_CONTROLS schema. Keys are DOTTED paths resolved by
 * makeConfigParams (a leading `layer.` targets the active layer). Only controls
 * applicable to the current layout are returned — mirroring the surface's own
 * v-if gating so the agent is never offered a knob the user can't see.
 *
 * `opts.includePreset` adds the `preset` macro (the canvas tuner handles it by
 * swapping the whole base config; the in-studio copilot omits it).
 */
export function gradientAgentControls(
  cfg: GradientConfig,
  opts: { includePreset?: boolean } = {},
): ControlSpec[] {
  return visibleGradientControls(cfg, opts)
    .filter((c) => (c as any).agent !== false)
    .map(({ when, ...spec }) => spec as ControlSpec)
}
```

- [ ] **Step 6: Run the snapshots — they must pass unchanged**

Run: `pnpm test:unit tests/unit/gradientfx-controls.unit.spec.ts`
Expected: PASS with **zero** snapshot writes or obsoletions.

If a snapshot mismatches, read the diff carefully — the common causes are: a `hint` present/absent mismatch, a `default` that is not `0`, a control in the wrong group (changing order), or a stray `when`/`agent` key leaking into the emitted spec (the `.map(({ when, ...spec }))` must also strip `agent`; if the diff shows `agent: false`, extend the destructure to `({ when, agent, ...spec })`). **Never run with `-u`.**

- [ ] **Step 7: Run every downstream consumer**

Run: `pnpm test:unit tests/unit/gradientfx-engine.unit.spec.ts tests/unit/agent-config-params.unit.spec.ts tests/unit/studio-tune.unit.spec.ts tests/unit/collection-studio-controls.unit.spec.ts tests/unit/vibe-control.unit.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/lib/gradientfx/controls.ts app/lib/gradientfx/agentControls.ts app/lib/spacetype/effect.ts tests/unit/gradientfx-controls.unit.spec.ts
git commit -m "refactor(gradientfx): derive agent vocabulary from declarative GRADIENT_CONTROLS"
```

---

### Task 4: Derived animatable targets

Every slider is animatable unless it opts out. Layer-relative keys expand to one absolute path per layer.

**Files:**
- Modify: `app/lib/spacetype/effect.ts`
- Modify: `app/lib/gradientfx/motion.ts`
- Create: `tests/unit/gradientfx-motion-path.unit.spec.ts`

**Interfaces:**
- Consumes: `visibleGradientControls` (Task 3), `getByPath` (Task 1).
- Produces:
  - `ControlMeta.animatable?: boolean | { min: number; max: number }`
  - `interface AnimatableTarget { path: string; label: string; min: number; max: number }`
  - `animatableTargets(cfg: GradientConfig): AnimatableTarget[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gradientfx-motion-path.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { animatableTargets } from '../../app/lib/gradientfx/motion'
import { defaultConfig } from '../../app/lib/gradientfx/types'
import { getByPath } from '../../app/lib/studio/path'

describe('animatableTargets', () => {
  it('returns absolute paths that resolve on the config', () => {
    const cfg: any = defaultConfig()
    const targets = animatableTargets(cfg)
    expect(targets.length).toBeGreaterThan(0)
    for (const t of targets) {
      expect(getByPath(cfg, t.path), `${t.path} unresolved`).not.toBeUndefined()
    }
  })

  it('expands layer-relative controls once per layer', () => {
    const cfg: any = defaultConfig()
    cfg.layers = [cfg.layers[0], JSON.parse(JSON.stringify(cfg.layers[0]))]
    const paths = animatableTargets(cfg).map((t) => t.path)
    const l0 = paths.filter((p) => p.startsWith('layers.0.'))
    const l1 = paths.filter((p) => p.startsWith('layers.1.'))
    expect(l0.length).toBeGreaterThan(0)
    expect(l1.length).toBe(l0.length)
  })

  it('every target has a finite range with max > min', () => {
    for (const t of animatableTargets(defaultConfig() as any)) {
      expect(Number.isFinite(t.min), `${t.path} min`).toBe(true)
      expect(Number.isFinite(t.max), `${t.path} max`).toBe(true)
      expect(t.max, `${t.path} range`).toBeGreaterThan(t.min)
    }
  })

  it('animates far more than the 11 legacy shape keys', () => {
    // The point of the refactor: relief, flow and focus params become
    // animatable for the first time.
    expect(animatableTargets(defaultConfig() as any).length).toBeGreaterThan(11)
  })

  it('includes non-shape targets that were previously impossible', () => {
    const paths = animatableTargets(defaultConfig() as any).map((t) => t.path)
    expect(paths).toContain('relief.grain')
    expect(paths).toContain('focus.blur')
  })

  it('uses the animatable range override where it differs from the UI slider', () => {
    const cfg: any = defaultConfig()
    const sweep = animatableTargets(cfg).find((t) => t.path.endsWith('.shape.sweep'))
    expect(sweep).toBeDefined()
    expect(sweep!.min).toBe(0)
    expect(sweep!.max).toBe(360)
  })

  it('produces unique labels so the dropdown is unambiguous', () => {
    const labels = animatableTargets(defaultConfig() as any).map((t) => t.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('excludes non-numeric controls', () => {
    const paths = animatableTargets(defaultConfig() as any).map((t) => t.path)
    expect(paths).not.toContain('canvas.background')
    expect(paths).not.toContain('canvas.layout')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit tests/unit/gradientfx-motion-path.unit.spec.ts`
Expected: FAIL — `animatableTargets` is not exported from `motion.ts`.

- [ ] **Step 3: Implement `animatableTargets`**

The `animatable` field and the `layer.shape.sweep` range override were both declared in Task 3, so this task only adds the derivation.

Add to `app/lib/gradientfx/motion.ts`. Keep the legacy `ANIMATABLE` export in place — Task 7 removes its last consumer:

```ts
import { visibleGradientControls } from './controls'

export interface AnimatableTarget { path: string; label: string; min: number; max: number }

/**
 * Motion targets derived from GRADIENT_CONTROLS rather than hand-listed.
 * Layer-relative keys (`layer.shape.count`) expand to one absolute path per
 * layer (`layers.0.shape.count`, ...), mirroring how ShaderStudioSurface builds
 * `animatablePaths` from its effect manifest.
 */
export function animatableTargets(cfg: GradientConfig): AnimatableTarget[] {
  const out: AnimatableTarget[] = []
  for (const c of visibleGradientControls(cfg)) {
    if (c.kind !== 'slider') continue
    const flag = (c as any).animatable
    if (flag === false) continue
    const range = flag && typeof flag === 'object' ? flag : { min: c.min, max: c.max }
    if (c.key.startsWith('layer.')) {
      const rest = c.key.slice('layer.'.length)
      cfg.layers.forEach((_l, i) => {
        out.push({ path: `layers.${i}.${rest}`, label: `Layer ${i + 1} · ${c.label}`, ...range })
      })
    } else {
      out.push({ path: c.key, label: c.label, ...range })
    }
  }
  return out
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit tests/unit/gradientfx-motion-path.unit.spec.ts tests/unit/gradientfx-controls.unit.spec.ts tests/unit/spacetype-effect.unit.spec.ts tests/unit/spacetype-sections.unit.spec.ts`
Expected: PASS. The spacetype specs confirm the optional `ControlMeta` fields broke none of the ~30 effect files.

If "returns absolute paths that resolve" fails on a `layers.N.mesh.*` path for the default (non-mesh) layout, the `when: isMesh` guard is missing on a mesh control — fix `controls.ts`, not the test.

- [ ] **Step 5: Commit**

```bash
git add app/lib/gradientfx/motion.ts tests/unit/gradientfx-motion-path.unit.spec.ts
git commit -m "feat(gradientfx): derive animatable motion targets from control schema"
```

---

### Task 5: Path-based `MotionTrack` + migration for saved projects

**Files:**
- Modify: `app/lib/gradientfx/types.ts`
- Modify: `app/lib/gradientfx/motion.ts`
- Modify: `tests/unit/gradientfx-motion-path.unit.spec.ts`
- Modify: `tests/unit/gradientfx-engine.unit.spec.ts`

**Interfaces:**
- Consumes: `getByPath` / `setByPath` (Task 1).
- Produces: `MotionTrack.path?: string`; `migrateMotionTracks(cfg: GradientConfig): GradientConfig`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/gradientfx-motion-path.unit.spec.ts`:

```ts
import { applyMotion } from '../../app/lib/gradientfx/motion'
import { ensureConfigDefaults } from '../../app/lib/gradientfx/types'

const track = (over: any = {}) => ({
  path: 'layers.0.shape.count', from: 0, to: 10,
  easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0, ...over,
})

describe('path-based applyMotion', () => {
  it('writes the animated value at the track path', () => {
    const cfg: any = defaultConfig()
    cfg.motion.duration = 1
    cfg.motion.tracks = [track()]
    expect((applyMotion(cfg, 1) as any).layers[0].shape.count).toBe(10)
  })

  it('does not mutate the input config', () => {
    const cfg: any = defaultConfig()
    cfg.motion.duration = 1
    cfg.motion.tracks = [track()]
    const before = cfg.layers[0].shape.count
    applyMotion(cfg, 1)
    expect(cfg.layers[0].shape.count).toBe(before)
  })

  it('animates a non-shape path that was impossible before', () => {
    const cfg: any = defaultConfig()
    cfg.motion.duration = 1
    cfg.motion.tracks = [track({ path: 'relief.grain', from: 0, to: 1 })]
    expect((applyMotion(cfg, 1) as any).relief.grain).toBe(1)
  })

  it('ignores an unresolvable path without fabricating structure', () => {
    const cfg: any = defaultConfig()
    cfg.motion.duration = 1
    cfg.motion.tracks = [track({ path: 'nope.does.not.exist' })]
    expect((applyMotion(cfg, 1) as any).nope).toBeUndefined()
  })

  it('ignores a track with no path at all', () => {
    const cfg: any = defaultConfig()
    cfg.motion.duration = 1
    cfg.motion.tracks = [track({ path: undefined })]
    expect(() => applyMotion(cfg, 1)).not.toThrow()
  })
})

describe('legacy track migration', () => {
  it('rewrites {layer, param} tracks to absolute paths', () => {
    const cfg: any = defaultConfig()
    cfg.motion.tracks = [
      { layer: 0, param: 'count', from: 2, to: 8, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 },
      { layer: 1, param: 'phase', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 },
    ]
    const out: any = ensureConfigDefaults(cfg)
    expect(out.motion.tracks[0].path).toBe('layers.0.shape.count')
    expect(out.motion.tracks[1].path).toBe('layers.1.shape.phase')
  })

  it('leaves already-migrated tracks untouched', () => {
    const cfg: any = defaultConfig()
    cfg.motion.tracks = [{ path: 'relief.grain', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }]
    expect((ensureConfigDefaults(cfg) as any).motion.tracks[0].path).toBe('relief.grain')
  })

  it('a migrated legacy track still animates', () => {
    const cfg: any = defaultConfig()
    cfg.motion.duration = 1
    cfg.motion.tracks = [{ layer: 0, param: 'count', from: 0, to: 10, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }]
    expect((applyMotion(ensureConfigDefaults(cfg), 1) as any).layers[0].shape.count).toBe(10)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit tests/unit/gradientfx-motion-path.unit.spec.ts`
Expected: FAIL — `applyMotion` still reads `track.layer`/`track.param`; no `path` on tracks.

- [ ] **Step 3: Widen `MotionTrack` and add the migration**

In `app/lib/gradientfx/types.ts`, change `MotionTrack` (around line 189):

```ts
export interface MotionTrack {
  /** Absolute dotted path into GradientConfig, e.g. `layers.0.shape.count`. */
  path?: string
  /** @deprecated legacy targeting; migrated to `path` by ensureConfigDefaults */
  layer?: number
  /** @deprecated legacy targeting; migrated to `path` by ensureConfigDefaults */
  param?: string
  from: number
  to: number
  easing: EasingKind
  loops: number
  hold: number
  cycleOffset: number
  delay: number
}
```

Add the migration function in the same file:

```ts
/**
 * Rewrites pre-path motion tracks. Saved projects store `{ layer, param }`,
 * which implicitly meant `layers[layer].shape[param]`. Mirrors
 * shaderstudio/migrate.ts's effect-path rewrite.
 */
export function migrateMotionTracks(cfg: GradientConfig): GradientConfig {
  for (const tr of cfg.motion?.tracks ?? []) {
    if (typeof tr.path === 'string' && tr.path) continue
    if (typeof tr.layer === 'number' && typeof tr.param === 'string') {
      tr.path = `layers.${tr.layer}.shape.${tr.param}`
    }
  }
  return cfg
}
```

Then call it inside `ensureConfigDefaults` (around line 311-331), on the line immediately before its `return`:

```ts
  migrateMotionTracks(cfg)
```

- [ ] **Step 4: Rewrite `applyMotion`**

Replace `applyMotion` in `app/lib/gradientfx/motion.ts` (lines 61-71):

```ts
import { getByPath, setByPath } from '~/lib/studio/path'

export function applyMotion(cfg: GradientConfig, t: number): GradientConfig {
  if (!cfg.motion?.tracks?.length) return cfg
  const out = cloneConfig(cfg)
  for (const track of cfg.motion.tracks) {
    const path = track.path
    if (!path) continue
    // Only write where a leaf already exists — an unresolvable path must not
    // fabricate structure the renderer would then read as real config.
    if (getByPath(out, path) === undefined) continue
    setByPath(out, path, trackValue(track, t, cfg.motion.duration))
  }
  return out
}
```

- [ ] **Step 5: Run and expect one legacy failure**

Run: `pnpm test:unit tests/unit/gradientfx-motion-path.unit.spec.ts tests/unit/gradientfx-engine.unit.spec.ts`
Expected: the new spec PASSES; `gradientfx-engine.unit.spec.ts` FAILS at its `applyMotion` test (~lines 153-159) because it builds a `{layer, param}` track directly without going through `ensureConfigDefaults`.

- [ ] **Step 6: Update the legacy spec**

In `tests/unit/gradientfx-engine.unit.spec.ts` around lines 153-159, change the track fixture from `{ layer: 0, param: 'count', ... }` to `{ path: 'layers.0.shape.count', ... }`, keeping every assertion identical, and add above it:

```ts
    // Targeting moved from {layer, param} to a dotted `path`; legacy saved docs
    // are migrated on load by ensureConfigDefaults (see gradientfx-motion-path).
```

- [ ] **Step 7: Run the entire unit suite**

Run: `pnpm test:unit`
Expected: PASS. A failure outside `gradientfx-*` means a consumer was missed — fix before committing.

- [ ] **Step 8: Commit**

```bash
git add app/lib/gradientfx/types.ts app/lib/gradientfx/motion.ts tests/unit/gradientfx-motion-path.unit.spec.ts tests/unit/gradientfx-engine.unit.spec.ts
git commit -m "feat(gradientfx): path-based motion tracks with legacy migration"
```

---

### Task 6: Path-aware layer reorder and delete

`remapTracksOnReorder` and `dropTracksForLayer` do integer arithmetic on `track.layer`. With paths they must rewrite the index segment. `ShaderStudioSurface.vue:615-651` implements this pattern already.

**Files:**
- Modify: `app/lib/gradientfx/motion.ts`
- Modify: `tests/unit/gradientfx-motion-remap.unit.spec.ts`

**Interfaces:**
- Consumes: `MotionTrack.path` (Task 5). Signatures unchanged.
- Produces: `remapTracksOnReorder(tracks, from, to)`, `dropTracksForLayer(tracks, removed)` operating on paths.

- [ ] **Step 1: Rewrite the spec for paths**

Replace the whole of `tests/unit/gradientfx-motion-remap.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { remapTracksOnReorder, dropTracksForLayer } from '../../app/lib/gradientfx/motion'

const t = (path: string) => ({
  path, from: 0, to: 1, easing: 'linear' as const,
  loops: 1, hold: 0, cycleOffset: 0, delay: 0,
})

describe('remapTracksOnReorder', () => {
  it('follows a layer moved down', () => {
    expect(remapTracksOnReorder([t('layers.0.shape.count')], 0, 2)[0]!.path).toBe('layers.2.shape.count')
  })
  it('shifts layers displaced by a downward move', () => {
    expect(remapTracksOnReorder([t('layers.1.shape.count')], 0, 2)[0]!.path).toBe('layers.0.shape.count')
  })
  it('shifts layers displaced by an upward move', () => {
    expect(remapTracksOnReorder([t('layers.1.shape.count')], 2, 0)[0]!.path).toBe('layers.2.shape.count')
  })
  it('leaves non-layer paths untouched', () => {
    expect(remapTracksOnReorder([t('relief.grain')], 0, 2)[0]!.path).toBe('relief.grain')
  })
})

describe('dropTracksForLayer', () => {
  it('removes tracks targeting the deleted layer', () => {
    expect(dropTracksForLayer([t('layers.1.shape.count')], 1)).toHaveLength(0)
  })
  it('decrements indices above the deleted layer', () => {
    expect(dropTracksForLayer([t('layers.2.shape.count')], 1)[0]!.path).toBe('layers.1.shape.count')
  })
  it('leaves indices below the deleted layer alone', () => {
    expect(dropTracksForLayer([t('layers.0.shape.count')], 1)[0]!.path).toBe('layers.0.shape.count')
  })
  it('keeps non-layer paths', () => {
    expect(dropTracksForLayer([t('relief.grain')], 1)[0]!.path).toBe('relief.grain')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:unit tests/unit/gradientfx-motion-remap.unit.spec.ts`
Expected: FAIL — the functions read `track.layer`, so paths come back unchanged.

- [ ] **Step 3: Implement path rewriting**

Replace both functions in `app/lib/gradientfx/motion.ts` (lines 78-91):

```ts
const LAYER_RE = /^layers\.(\d+)\./

const layerIndexOf = (path: string | undefined): number | null => {
  const m = LAYER_RE.exec(path ?? '')
  return m ? Number(m[1]) : null
}

const withLayerIndex = (path: string, i: number): string => path.replace(LAYER_RE, `layers.${i}.`)

export function remapTracksOnReorder(tracks: MotionTrack[], from: number, to: number): MotionTrack[] {
  return tracks.map((tr) => {
    const i = layerIndexOf(tr.path)
    if (i === null) return tr
    let next = i
    if (i === from) next = to
    else if (from < i && i <= to) next = i - 1
    else if (to <= i && i < from) next = i + 1
    return next === i ? tr : { ...tr, path: withLayerIndex(tr.path!, next) }
  })
}

export function dropTracksForLayer(tracks: MotionTrack[], removed: number): MotionTrack[] {
  const out: MotionTrack[] = []
  for (const tr of tracks) {
    const i = layerIndexOf(tr.path)
    if (i === null) { out.push(tr); continue }
    if (i === removed) continue
    out.push(i > removed ? { ...tr, path: withLayerIndex(tr.path!, i - 1) } : tr)
  }
  return out
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit tests/unit/gradientfx-motion-remap.unit.spec.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/gradientfx/motion.ts tests/unit/gradientfx-motion-remap.unit.spec.ts
git commit -m "refactor(gradientfx): remap and drop motion tracks by path"
```

---

### Task 7: Surface wiring and browser verification

**Files:**
- Modify: `app/components/vue-canvas/GradientStudioSurface.vue` (import L9; duplicate-layer remap ~L468-470; `addTrack` ~L514-519; track editor ~L1156-1163)

**Interfaces:**
- Consumes: `animatableTargets` (Task 4). Produces no new exports.

- [ ] **Step 1: Swap the import and add the computed**

On line 9, replace `ANIMATABLE` with `animatableTargets` in the import from `~/lib/gradientfx/motion`. Then add alongside the other computeds:

```ts
const animatable = computed(() => animatableTargets(config.value))
```

- [ ] **Step 2: Seed new tracks with a path**

Replace `addTrack` (~L514-519):

```ts
function addTrack() {
  const a = animatable.value[0]
  if (!a) return
  config.value.motion.tracks.push({
    path: a.path, from: a.min, to: a.max,
    easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0,
  })
  onEdit('motion.tracks', config.value.motion.tracks.length)
}
```

- [ ] **Step 3: Fix the duplicate-layer index bump**

Around L468-470, replace the `t.layer >= at` integer bump:

```ts
  for (const t of config.value.motion.tracks) {
    const m = /^layers\.(\d+)\./.exec(t.path ?? '')
    if (m && Number(m[1]) >= at) {
      t.path = t.path!.replace(/^layers\.\d+\./, `layers.${Number(m[1]) + 1}.`)
    }
  }
```

- [ ] **Step 4: Collapse two selects into one**

In the track editor (~L1156-1163), delete the layer `<select>` element entirely and rebind the param `<select>` to the path, keeping the existing CSS classes:

```vue
<select v-model="track.path" class="...keep existing classes...">
  <option v-for="a in animatable" :key="a.path" :value="a.path">{{ a.label }}</option>
</select>
```

- [ ] **Step 5: Run the suite and typecheck**

Run: `pnpm test:unit`
Expected: PASS.

Run: `npx vue-tsc --noEmit 2>&1 | grep -c "error"`
Expected: at or below the ~328 baseline. Inspect anything new with `npx vue-tsc --noEmit 2>&1 | grep GradientStudioSurface`.

- [ ] **Step 6: Verify in the browser**

Start the dev environment from the repo root: `./dev.sh` (kills strays; frontend on 3000, ComfyUI on 8188). Use `127.0.0.1`, not `localhost`.

1. Add a Gradient Studio node and open it.
2. Open **Motion** and click **+ Track**.
3. Confirm the dropdown lists **far more than 11 entries**, including `Grain`, `Blur`, and layer-prefixed entries like `Layer 1 · Count`.
4. Choose `Grain`, set from 0 to 1, play — confirm the grain animates. This parameter could not be animated before this change.
5. Add a second layer; confirm the dropdown now shows `Layer 2 · …` entries too.
6. Reorder the two layers; confirm an existing track still targets the intended layer.
7. Delete a layer; confirm tracks targeting it disappear and others survive.

- [ ] **Step 7: Verify the migration against a real saved project**

This is the highest-risk behaviour in the plan and unit tests do not cover the persisted path. Open a project saved **before** this change, then in the browser console:

```js
const n = window.__vueFlow?.nodes?.value?.find(n => n.data?.nodeType === 'GradientStudio')
console.log(JSON.stringify(n?.data?.properties?.sailor_gradientStudio?.motion?.tracks, null, 2))
```

Expected: every track has a populated `path`. If any shows `path: undefined` while carrying `layer`/`param`, `ensureConfigDefaults` is not running on that load path — trace `loadConfig` (L540-543) before proceeding.

Then confirm the animation still plays as it did before the change.

- [ ] **Step 8: Commit**

```bash
git add app/components/vue-canvas/GradientStudioSurface.vue
git commit -m "feat(gradientfx): single path selector for motion tracks"
```

---

## Out of scope (follow-on plan)

Deliberately excluded so this plan stays independently shippable:

- The generic inspector renderer (`StudioControlPanel.vue`) and deleting Gradient's 432 lines of hand-written markup.
- New `ControlSpec` kinds — `segmented`, `repeater`, `custom` — needed only by the renderer.
- Flipping the Shape block's `agent: false` to expose those 11 controls to the agent, and wiring them into `BindableRow` for sweeps. Task 3 makes them *declared*; exposing them is a deliberate, separately-reviewable change.
- The 7 remaining orphan Shape sliders (`rotStep`, `pivot`, `ringScale`, `detail`, and the radial `scrub` duplicate among them) — they need the surface markup read for their real ranges, which belongs with the renderer work.
- Retiring the duplicated `trackValue` and `setByPath` in `shaderstudio/motion.ts` in favour of the shared modules.
- Texture and Space Type migrations onto the same schema.
