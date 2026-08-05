# Universal Studio Post-Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Gradient, Texture and Shape Studio the twelve-effect post-processing stack that today only Scene3D and Space Type can reach, driven by one manifest and one shared GL2 chain.

**Architecture:** A post effect is declared once as a manifest entry pairing a `.frag` with its uniforms; the `ControlSpec` list that feeds the inspector, the agent, and motion is *derived* from that manifest. A single `applyPost()` runs the enabled effects in one app-wide WebGL2 context and hands back a canvas the studio draws onto its own. Each studio calls it in exactly one place — the end of its `render()` — so the live viewport, bakes, exports, and wired downstream pulls are all covered by one call site.

**Tech Stack:** TypeScript, Vue 3 / Nuxt 4, WebGL2 (raw, no three.js in the shared chain), Vitest for unit tests, Playwright for browser/golden tests.

**Spec:** `docs/superpowers/specs/2026-08-04-universal-studio-post-effects-design.md`

## Global Constraints

- **Shader source of truth is `shader_effects/`** at the repo root. Never copy a `.frag` into `frontend/`. The chain imports what it needs via Vite `?raw`.
- **`lib/studio/post/` must stay free of `three` imports.** It is reachable from the Collection control resolver's dynamic import graph, the same constraint `lib/scene3d/controls.ts` and `lib/shapefx/controls.ts` already carry.
- **Scene3D and Space Type are NOT migrated in this plan.** They keep `EffectComposer`. Do not touch `lib/spacetype/post.ts`'s `PostChain`.
- **Shader Studio is out of scope.** Do not add a post panel to it.
- **Ambient occlusion is 3D-only.** It must never appear in a derived control list for Gradient, Texture or Shape.
- **Control keys are FROZEN once written.** Persisted Collection bindings are `params.<key>`.
- **Commit hygiene:** other sessions share this repo. Stage only the files listed in each task's `git add` — never `git add -A`, never `git stash`.
- **Vitest counts are unreliable under load here.** When quoting a before/after failure count, also quote the collected-file total.

---

### Task 1: The `switch` ControlSpec kind

The reason this comes first: `lib/scene3d/controls.ts:27-38` documents that every `post.*` enable is *omitted* from the control schema because there is no boolean kind, and modelling one as a two-option `select` would write the **string** `'on'` into a **boolean** field — `makeConfigParams`' proxy writes straight through with no coercion. The user-visible symptom today is that the agent can change bloom's strength but cannot switch bloom on. Every toggle in the post panel depends on closing this.

`ParamValue` is already `number | string | boolean` (`frontend/shared/spacetype/state.ts:12`), so this is additive — no type widening ripples into persistence.

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts` (the `ControlSpec` union, ~line 39-64)
- Modify: `frontend/app/lib/spacetype/controlDescriptor.ts` (`DescribedControl`, `AI_EDITABLE_KINDS`, `validatePatch`)
- Modify: `frontend/app/components/vue-canvas/studio/StudioControlPanel.vue` (props/emit types + a render branch)
- Test: `frontend/tests/unit/switch-control-kind.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ControlSpec` variant `{ key: string; label: string; kind: 'switch'; default: boolean; group: string } & ControlMeta`
  - `DescribedControl['kind']` gains `'switch'`
  - `validatePatch` emits a real `boolean` for switch paths
  - `StudioControlPanel`'s `value` prop is `(key: string) => string | number | boolean` and its `set` emit is `(e: 'set', key: string, value: string | number | boolean)`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/switch-control-kind.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { defaultsFromControls } from '~/lib/spacetype/effect'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'

const CONTROLS: ControlSpec[] = [
  { key: 'post.bloom', label: 'Bloom', kind: 'switch', default: false, group: 'Bloom' },
  { key: 'post.bloomStrength', label: 'Strength', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Bloom' },
]

describe('switch control kind', () => {
  it('describes a switch as AI-editable', () => {
    const d = describeControls(CONTROLS, { 'post.bloom': false, 'post.bloomStrength': 0.6 })
    const sw = d.find(x => x.path === 'post.bloom')
    expect(sw).toBeDefined()
    expect(sw!.kind).toBe('switch')
    expect(sw!.current).toBe(false)
  })

  // THE point of the kind. scene3d/controls.ts warns that a two-option select
  // would write the STRING 'on' into a BOOLEAN field and corrupt the document.
  it('validates to a real boolean, never a string', () => {
    const d = describeControls(CONTROLS, { 'post.bloom': false })
    for (const raw of [true, 'true', 'on', 1]) {
      const out = validatePatch({ 'post.bloom': raw as never }, d)
      expect(typeof out['post.bloom']).toBe('boolean')
      expect(out['post.bloom']).toBe(true)
    }
    for (const raw of [false, 'false', 'off', 0]) {
      const out = validatePatch({ 'post.bloom': raw as never }, d)
      expect(typeof out['post.bloom']).toBe('boolean')
      expect(out['post.bloom']).toBe(false)
    }
  })

  it('drops values it cannot read as a boolean', () => {
    const d = describeControls(CONTROLS, { 'post.bloom': false })
    expect(validatePatch({ 'post.bloom': 'maybe' as never }, d)).toEqual({})
  })

  it('contributes its boolean default to defaultsFromControls', () => {
    expect(defaultsFromControls(CONTROLS)['post.bloom']).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend && npx vitest run tests/unit/switch-control-kind.unit.spec.ts
```

Expected: FAIL. TypeScript rejects `kind: 'switch'` as not assignable to `ControlSpec`, and `describeControls` filters the control out because `'switch'` is not in `AI_EDITABLE_KINDS`.

- [ ] **Step 3: Add the union variant**

In `frontend/app/lib/spacetype/effect.ts`, inside the `ControlSpec` union (after the `slider` line, before `text`):

```ts
  // A boolean toggle. Added because post-effect enables are booleans and modelling
  // them as a two-option select writes the STRING 'on' into a BOOLEAN field —
  // makeConfigParams' proxy writes through with no coercion, corrupting the doc.
  // See lib/scene3d/controls.ts's "Boolean gap" note, which this closes.
  | { key: string; label: string; kind: 'switch'; default: boolean; group: string }
```

- [ ] **Step 4: Teach the descriptor and the validator**

In `frontend/app/lib/spacetype/controlDescriptor.ts`:

Widen the kind union on `DescribedControl`:

```ts
  kind: 'slider' | 'select' | 'color' | 'font' | 'gradientStops' | 'switch'
```

Add `'switch'` to the editable set:

```ts
const AI_EDITABLE_KINDS = new Set(['slider', 'select', 'color', 'font', 'gradientStops', 'switch'])
```

Add a `validatePatch` branch, after the `select` branch:

```ts
    else if (d.kind === 'switch') {
      // Coerce, don't pass through: the model emits true/'true'/'on'/1 freely, and
      // a string reaching a boolean config field is the corruption this kind exists
      // to prevent. Anything not recognisable as a boolean is dropped, not guessed.
      const truthy = new Set([true, 'true', 'on', 'yes', 1, '1'])
      const falsy = new Set([false, 'false', 'off', 'no', 0, '0'])
      if (truthy.has(raw as never)) out[key] = true
      else if (falsy.has(raw as never)) out[key] = false
    }
```

- [ ] **Step 5: Run the unit test to verify it passes**

```bash
cd frontend && npx vitest run tests/unit/switch-control-kind.unit.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Render the switch in the shared panel**

`StudioControlPanel.vue` currently types its reader and emit as `string | number`, which cannot carry a boolean. Widen both, then add the branch.

In the `defineProps` block:

```ts
  value: (key: string) => string | number | boolean
```

In the `defineEmits` block:

```ts
  (e: 'set', key: string, value: string | number | boolean): void
```

Add the import alongside the other studio components:

```ts
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
```

Add the render branch after the `slider` branch in the template:

```vue
        <template v-else-if="c.kind === 'switch'">
          <div class="flex items-center justify-between py-[6px]">
            <span class="text-[11px] text-white/55">{{ c.label }}</span>
            <StudioSwitch
              :model-value="value(c.key) === true"
              @update:model-value="(v: boolean) => emit('set', c.key, v)"
            />
          </div>
        </template>
```

- [ ] **Step 7: Typecheck**

```bash
cd frontend && npx nuxt typecheck 2>&1 | tail -20
```

Expected: no NEW errors mentioning `ControlSpec`, `DescribedControl`, `StudioControlPanel`, or `switch`. The repo carries a large pre-existing error baseline (~328); compare against `git stash list`-free baseline by running the same command on `HEAD` if a number looks suspicious. **An error naming a type this task introduced is not pre-existing.**

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts \
        frontend/app/lib/spacetype/controlDescriptor.ts \
        frontend/app/components/vue-canvas/studio/StudioControlPanel.vue \
        frontend/tests/unit/switch-control-kind.unit.spec.ts
git commit -m "feat(controls): add switch kind, closing the ControlSpec boolean gap"
```

---

### Task 2: Move `PostSettings` and add the three new effects

Two things at once because they touch the same two files: relocate the settings module, and extend it with the effects the union brings in.

`PostSettings` (`frontend/shared/spacetype/state.ts:15-25`) today declares only the **nine** effects the 3D panel has. The twelve-effect union adds **grain, vignette and duotone**, which have no keys at all — without them Task 3's manifest would point at fields that do not exist.

Duotone also brings the stack's first non-numeric params: two hex colours. `postEnabled` must learn the three new enables too, or a doc with only vignette on would render as post-off.

**Files:**
- Create: `frontend/app/lib/studio/post/settings.ts`
- Modify: `frontend/shared/spacetype/state.ts` (extend `PostSettings`)
- Modify: `frontend/app/lib/spacetype/postSettings.ts` (becomes a shim)
- Test: `frontend/tests/unit/studio-post-settings.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_POST: PostSettings`, `postEnabled(p: PostSettings): boolean`, and the `PostSettings` type re-export, all from `~/lib/studio/post/settings`. `PostSettings` gains:
  `grain: boolean; grainAmount: number; grainSize: number`,
  `vignette: boolean; vignetteAmount: number; vignetteRadius: number; vignetteSoftness: number`,
  `duotone: boolean; duotoneShadow: string; duotoneHighlight: string; duotoneMix: number`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/studio-post-settings.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_POST, postEnabled } from '~/lib/studio/post/settings'
import { DEFAULT_POST as LEGACY } from '~/lib/spacetype/postSettings'

describe('studio post settings', () => {
  it('exposes the defaults from the new home', () => {
    expect(DEFAULT_POST.bloom).toBe(false)
    expect(DEFAULT_POST.bloomStrength).toBe(0.6)
  })

  it('keeps the legacy import path working (a dozen importers rely on it)', () => {
    expect(LEGACY).toBe(DEFAULT_POST)
  })

  it('reports enabled only when an effect is on', () => {
    expect(postEnabled(DEFAULT_POST)).toBe(false)
    expect(postEnabled({ ...DEFAULT_POST, bloom: true })).toBe(true)
  })

  it('declares the three effects the union adds', () => {
    expect(DEFAULT_POST.grain).toBe(false)
    expect(DEFAULT_POST.grainAmount).toBe(0.25)
    expect(DEFAULT_POST.grainSize).toBe(2)
    expect(DEFAULT_POST.vignette).toBe(false)
    expect(DEFAULT_POST.duotone).toBe(false)
    expect(DEFAULT_POST.duotoneShadow).toBe('#1a1a2e')
    expect(DEFAULT_POST.duotoneHighlight).toBe('#f5f0e8')
  })

  // A doc with only a new effect on must not read as post-off, or the whole
  // chain is skipped and the effect silently does nothing.
  it('reports enabled for each new effect on its own', () => {
    for (const key of ['grain', 'vignette', 'duotone'] as const) {
      expect(postEnabled({ ...DEFAULT_POST, [key]: true })).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run tests/unit/studio-post-settings.unit.spec.ts
```

Expected: FAIL — `Cannot find module '~/lib/studio/post/settings'`.

- [ ] **Step 3: Extend the `PostSettings` type**

In `frontend/shared/spacetype/state.ts`, add three lines to the `PostSettings` interface (after the `glitch` line, before `gtao`, matching the file's one-effect-per-line style). Duotone's defaults are taken from the catalog's own `duotone.frag` declaration so the shared stack and the catalog agree out of the box:

```ts
  grain: boolean; grainAmount: number; grainSize: number
  vignette: boolean; vignetteAmount: number; vignetteRadius: number; vignetteSoftness: number
  duotone: boolean; duotoneShadow: string; duotoneHighlight: string; duotoneMix: number
```

- [ ] **Step 4: Create the new module**

Create `frontend/app/lib/studio/post/settings.ts` with the current contents of `frontend/app/lib/spacetype/postSettings.ts` (read that file and move `DEFAULT_POST`, `postEnabled`, the `PostSettings` type re-export from `~~/shared/spacetype/state`, and its header comment about staying three-free), updating the header to say this is the shared home for every studio rather than a Space Type detail.

Add the three new effects' defaults to `DEFAULT_POST`:

```ts
  grain: false, grainAmount: 0.25, grainSize: 2,
  vignette: false, vignetteAmount: 0.4, vignetteRadius: 0.6, vignetteSoftness: 0.5,
  duotone: false, duotoneShadow: '#1a1a2e', duotoneHighlight: '#f5f0e8', duotoneMix: 1,
```

and their enables to `postEnabled`:

```ts
export function postEnabled(p: PostSettings): boolean {
  return !!(p.bloom || p.color || p.chroma || p.blur || p.film || p.halftone
    || p.dotScreen || p.glitch || p.gtao || p.grain || p.vignette || p.duotone)
}
```

- [ ] **Step 5: Turn the old path into a shim**

Replace the entire body of `frontend/app/lib/spacetype/postSettings.ts` with:

```ts
// Moved to ~/lib/studio/post/settings — post is shared by every studio, not a
// Space Type detail. Kept as a re-export because a dozen modules import this path
// (scene3d/config.ts, scene3d/controls.ts, embed/surfaces/spacetype.ts, post.ts…).
export type { PostSettings } from '~/lib/studio/post/settings'
export { DEFAULT_POST, postEnabled } from '~/lib/studio/post/settings'
```

- [ ] **Step 6: Run the test and the full unit suite**

```bash
cd frontend && npx vitest run tests/unit/studio-post-settings.unit.spec.ts && npx vitest run 2>&1 | tail -15
```

Expected: the new file PASSes (5 tests), and the full run's failure count and collected-file total match what `npx vitest run` reports on `HEAD` before this task. **Record both numbers in the task report — every later task compares against this baseline.**

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/spacetype/state.ts \
        frontend/app/lib/studio/post/settings.ts \
        frontend/app/lib/spacetype/postSettings.ts \
        frontend/tests/unit/studio-post-settings.unit.spec.ts
git commit -m "refactor(post): move PostSettings to lib/studio/post, add grain/vignette/duotone"
```

---

### Task 3: The post manifest and its derived controls

The heart of the design: twelve effects declared once, with the `ControlSpec` list derived rather than hand-written, so a thirteenth effect arrives with a panel, agent vocabulary and motion targets already attached.

**Uniform mappings** — the catalog's parameter names do not match `PostSettings` keys, so each declaration carries the mapping explicitly. Verify each against `shader_effects/manifest.json` at HEAD before writing it; that file changed mid-design once already.

**Files:**
- Create: `frontend/app/lib/studio/post/manifest.ts`
- Create: `frontend/app/lib/studio/post/controls.ts`
- Test: `frontend/tests/unit/studio-post-controls.unit.spec.ts`

**Interfaces:**
- Consumes: `PostSettings`, `DEFAULT_POST` from Task 2; the `switch` kind from Task 1.
- Produces:
  - `POST_EFFECTS: PostEffectDef[]` where `PostEffectDef = { id: string; label: string; enableKey: keyof PostSettings; frag: string | null; threeDOnly?: boolean; alphaGated?: boolean; params: PostParamDef[] }`
  - `PostParamDef` is a discriminated union — duotone's two hex colours do not fit a numeric range:
    `{ kind: 'slider'; uniform: string; settingsKey: keyof PostSettings; label: string; min: number; max: number; step: number; hint: string }`
    `| { kind: 'color'; uniform: string; settingsKey: keyof PostSettings; label: string; hint: string }`
  - `POST_CHAIN_ORDER: string[]` — effect ids in render order
  - `postControls(opts?: { threeD?: boolean }): ControlSpec[]`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/studio-post-controls.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { POST_EFFECTS, POST_CHAIN_ORDER } from '~/lib/studio/post/manifest'
import { postControls } from '~/lib/studio/post/controls'
import { DEFAULT_POST } from '~/lib/studio/post/settings'

describe('post manifest', () => {
  it('declares the twelve effects', () => {
    expect(POST_EFFECTS).toHaveLength(12)
  })

  it('orders every effect exactly once in the chain', () => {
    expect([...POST_CHAIN_ORDER].sort()).toEqual(POST_EFFECTS.map(e => e.id).sort())
  })

  it('points every param at a real PostSettings key', () => {
    for (const e of POST_EFFECTS) {
      expect(DEFAULT_POST).toHaveProperty(e.enableKey)
      for (const p of e.params) expect(DEFAULT_POST).toHaveProperty(p.settingsKey)
    }
  })
})

describe('derived post controls', () => {
  it('emits a switch per effect plus a slider per param', () => {
    const cs = postControls({ threeD: true })
    const bloomSwitch = cs.find(c => c.key === 'post.bloom')
    expect(bloomSwitch?.kind).toBe('switch')
    const strength = cs.find(c => c.key === 'post.bloomStrength')
    expect(strength?.kind).toBe('slider')
    // Params live under the effect's own section, revealed by its switch.
    expect(strength?.group).toBe(bloomSwitch?.group)
    expect((strength as { showIf?: { key: string } }).showIf?.key).toBe('post.bloom')
  })

  it('withholds ambient occlusion from non-3D hosts', () => {
    const flat = postControls({ threeD: false }).map(c => c.key)
    expect(flat).not.toContain('post.gtao')
    expect(flat.some(k => k.startsWith('post.gtao'))).toBe(false)
    expect(postControls({ threeD: true }).map(c => c.key)).toContain('post.gtao')
  })

  it('defaults each control to the DEFAULT_POST value', () => {
    for (const c of postControls({ threeD: true })) {
      const key = c.key.slice('post.'.length) as keyof typeof DEFAULT_POST
      expect(c.default).toEqual(DEFAULT_POST[key])
    }
  })
})

// Controls are opt-OUT: a thirteenth effect silently grants itself agent access
// and motion targets. Freeze the derived set so that shows up in review.
describe('derived control surface', () => {
  it('matches the frozen snapshot', () => {
    expect(postControls({ threeD: true }).map(c => `${c.kind} ${c.key}`).sort()).toMatchSnapshot()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run tests/unit/studio-post-controls.unit.spec.ts
```

Expected: FAIL — `Cannot find module '~/lib/studio/post/manifest'`.

- [ ] **Step 3: Write the manifest**

Create `frontend/app/lib/studio/post/manifest.ts`. Declare all twelve effects. The catalog frag ids to reference (confirm against `shader_effects/manifest.json`): `bloom`, `chromatic_aberration`, `gaussian_blur`, `film_grain`, `crt_scanlines`, `halftone`, `dot_screen`, `rgb_glitch`, `vignette`, `duotone`, plus the new `post_adjust` from Task 4. Ambient occlusion has **no frag** — it is `threeDOnly` and rendered by `EffectComposer`, so its entry declares `frag: null` and exists only to contribute controls.

Shape of each entry — write all twelve following this pattern, drawing `min`/`max`/`step`/`hint` from `lib/scene3d/controls.ts:200-230` (which already declares the nine, so their ranges and hints are settled and must be copied exactly rather than re-invented):

```ts
import type { PostSettings } from './settings'

// Discriminated because duotone's shadow/highlight are hex colours, which have no
// min/max/step. The catalog's duotone.frag already stores hex (type: "color"),
// so the shared stack and the catalog agree without translation.
export type PostParamDef =
  | { kind: 'slider'; uniform: string; settingsKey: keyof PostSettings; label: string; min: number; max: number; step: number; hint: string }
  | { kind: 'color'; uniform: string; settingsKey: keyof PostSettings; label: string; hint: string }

export interface PostEffectDef {
  id: string
  label: string
  enableKey: keyof PostSettings
  /** Catalog effect id in shader_effects/, or null for effects with no frag
   *  (ambient occlusion renders from depth+normal buffers in EffectComposer). */
  frag: string | null
  /** Depth/normal-buffer effects. Withheld from every non-3D host. */
  threeDOnly?: boolean
  /** Multiply the effect's contribution by the frame's alpha, so it never lands
   *  on transparent background. Replaces Gradient's `cover` plumbing. */
  alphaGated?: boolean
  params: PostParamDef[]
}

export const POST_EFFECTS: PostEffectDef[] = [
  {
    id: 'bloom', label: 'Bloom', enableKey: 'bloom', frag: 'bloom',
    params: [
      { kind: 'slider', uniform: 'u_intensity', settingsKey: 'bloomStrength', label: 'Strength', min: 0, max: 3, step: 0.05, hint: 'How bright the glow is' },
      { kind: 'slider', uniform: 'u_radius', settingsKey: 'bloomRadius', label: 'Radius', min: 0, max: 1, step: 0.05, hint: 'How far the glow spreads' },
      { kind: 'slider', uniform: 'u_threshold', settingsKey: 'bloomThreshold', label: 'Threshold', min: 0, max: 1, step: 0.05, hint: 'How bright a pixel must be to glow' },
    ],
  },
  {
    id: 'duotone', label: 'Duotone', enableKey: 'duotone', frag: 'duotone',
    params: [
      { kind: 'color', uniform: 'u_shadow', settingsKey: 'duotoneShadow', label: 'Shadow', hint: 'Colour the darkest tones become' },
      { kind: 'color', uniform: 'u_highlight', settingsKey: 'duotoneHighlight', label: 'Highlight', hint: 'Colour the brightest tones become' },
      { kind: 'slider', uniform: 'u_contrast', settingsKey: 'duotoneMix', label: 'Mix', min: 0, max: 1, step: 0.05, hint: 'How much of the duotone shows through' },
    ],
  },
  {
    id: 'grain', label: 'Grain', enableKey: 'grain', frag: 'film_grain', alphaGated: true,
    params: [
      { kind: 'slider', uniform: 'u_amount', settingsKey: 'grainAmount', label: 'Amount', min: 0, max: 1, step: 0.02, hint: 'How strong the grain is' },
      { kind: 'slider', uniform: 'u_size', settingsKey: 'grainSize', label: 'Size', min: 1, max: 8, step: 0.5, hint: 'How coarse the grain is' },
    ],
  },
  {
    // No frag: ambient occlusion reads depth+normal buffers and renders in
    // EffectComposer. Declared here only so 3D hosts derive its controls from the
    // same source as everything else.
    id: 'gtao', label: 'Ambient occlusion', enableKey: 'gtao', frag: null, threeDOnly: true,
    params: [
      { kind: 'slider', uniform: '', settingsKey: 'gtaoRadius', label: 'Radius', min: 0.05, max: 2, step: 0.05, hint: 'How far contact shadows reach' },
      { kind: 'slider', uniform: '', settingsKey: 'gtaoIntensity', label: 'Intensity', min: 0, max: 2, step: 0.05, hint: 'How dark the contact shadows are' },
      { kind: 'slider', uniform: '', settingsKey: 'gtaoThickness', label: 'Thickness', min: 0.05, max: 1, step: 0.05, hint: 'How solid surfaces are assumed to be' },
    ],
  },
  // … the remaining eight (color, chroma, blur, film, halftone, dotScreen,
  // glitch, vignette), same shape. Copy each one's min/max/step/hint verbatim
  // from lib/scene3d/controls.ts:200-230 where it already exists — those ranges
  // are settled and users' saved values sit inside them.
]

/** Fixed render order — the single source of truth, in the spirit of
 *  compositor/postEffects.ts:8. Colour grading first so later effects screen
 *  the graded image; grain and vignette last because they are on the film and
 *  the barrel, not in the scene. */
export const POST_CHAIN_ORDER = [
  'gtao', 'color', 'duotone', 'bloom', 'chroma', 'blur',
  'halftone', 'dotScreen', 'glitch', 'film', 'vignette', 'grain',
]
```

- [ ] **Step 4: Derive the controls**

Create `frontend/app/lib/studio/post/controls.ts`:

```ts
import type { ControlSpec } from '~/lib/spacetype/effect'
import { DEFAULT_POST } from './settings'
import { POST_EFFECTS } from './manifest'

/**
 * The post panel's controls, DERIVED from the manifest rather than hand-written.
 *
 * This list is the SOURCE for three consumers at once: the inspector (via
 * groupIntoSections), the agent vocabulary (via describeControls), and motion's
 * animatable targets. Adding an effect to the manifest therefore grants all three
 * unless explicitly opted out — which is why the derived set is snapshot-frozen in
 * tests/unit/studio-post-controls.unit.spec.ts.
 *
 * Keys are FROZEN: persisted Collection bindings are `params.post.<key>`.
 *
 * Must stay free of `three` imports — reachable from the Collection control
 * resolver's dynamic import graph (same constraint as scene3d/controls.ts).
 */
export function postControls(opts: { threeD?: boolean } = {}): ControlSpec[] {
  const out: ControlSpec[] = []
  for (const e of POST_EFFECTS) {
    if (e.threeDOnly && !opts.threeD) continue
    out.push({
      key: `post.${e.enableKey}`,
      label: e.label,
      kind: 'switch',
      default: DEFAULT_POST[e.enableKey] as boolean,
      group: e.label,
    })
    for (const p of e.params) {
      const showIf = { key: `post.${e.enableKey}`, equals: true } as const
      if (p.kind === 'color') {
        out.push({
          key: `post.${p.settingsKey}`, label: p.label, kind: 'color',
          default: DEFAULT_POST[p.settingsKey] as string,
          group: e.label, hint: p.hint, showIf,
        })
      } else {
        out.push({
          key: `post.${p.settingsKey}`, label: p.label, kind: 'slider',
          min: p.min, max: p.max, step: p.step,
          default: DEFAULT_POST[p.settingsKey] as number,
          group: e.label, hint: p.hint, showIf,
        })
      }
    }
  }
  return out
}

/** Section order for groupIntoSections — one section per effect, chain order. */
export const POST_SECTIONS = POST_EFFECTS.map(e => e.label)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run tests/unit/studio-post-controls.unit.spec.ts
```

Expected: PASS, 7 tests. The snapshot is written on this first run — **read the generated snapshot file and confirm ambient occlusion's four keys are absent from the non-3D list** before accepting it. A snapshot that captures a bug is worse than no snapshot.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/studio/post/manifest.ts \
        frontend/app/lib/studio/post/controls.ts \
        frontend/tests/unit/studio-post-controls.unit.spec.ts \
        frontend/tests/unit/__snapshots__/studio-post-controls.unit.spec.ts.snap
git commit -m "feat(post): manifest of twelve effects with manifest-derived controls"
```

---

### Task 4: The shared GL2 chain and the `post_adjust` frag

**Files:**
- Create: `shader_effects/post_adjust.frag`
- Create: `shader_effects/post_grain.frag`
- Modify: `shader_effects/manifest.json` (register both)
- Modify: `frontend/app/lib/studio/post/manifest.ts` (add `toUniform` mappings; repoint `grain`)
- Modify: `frontend/app/lib/studio/post/controls.ts` (drop unrenderable params per host)
- Create: `frontend/app/lib/studio/post/chain.ts`
- Modify: `frontend/nuxt.config.ts` (`vite.server.fs.allow`)
- Test: `frontend/tests/unit/studio-post-chain.unit.spec.ts`

**Interfaces:**
- Consumes: `POST_EFFECTS`, `POST_CHAIN_ORDER` (Task 3); `PostSettings`, `postEnabled` (Task 2).
- Produces: `applyPost(source: TexImageSource, post: PostSettings, w: number, h: number, t: number): TexImageSource` and `activePasses(post: PostSettings, opts?: { threeD?: boolean }): PostEffectDef[]`.

#### Three corrections from Task 3, to apply before writing the chain

Task 3 verified every declaration against the real catalog and found the plan's assumptions wrong in three ways. All three are settled — implement them as stated.

**(a) `film_grain` is NOT in the committed catalog.** `shader_effects/film_grain.frag` exists on disk but is **untracked**, and has no entry in `shader_effects/manifest.json` — it belongs to another session's in-flight work. Depending on it would make this feature's rendering hinge on someone else's uncommitted files.

So write our own `shader_effects/post_grain.frag` (alongside `post_adjust.frag`), register it, and repoint the manifest's `grain` entry from `'film_grain'` to `'post_grain'`. Its two uniforms are `u_amount` (0..1) and `u_size` (1..8), and it is the **alpha-gated** effect — see the alpha requirement below. Port the luminance-shaped midtone formula from `frontend/app/lib/gradientfx/shaders.ts:629-642` (`hashGrain`, Dave Hoskins "Hash without Sine") with the canonical `0.16` coefficient, because Task 8 migrates saved Gradient documents onto exactly this and they must render unchanged.

**(b) Sailor's slider ranges do not match the catalog uniforms' ranges.** The plan assumed `settingsKey → uniform` was a direct assignment. It isn't:

| Setting | Sailor range | Catalog uniform | Catalog range |
|---|---|---|---|
| `chromaAmount` | 0–1.5 | `u_amount` | 0–0.08 |
| `halftoneRadius` | 1–20 | `u_size` | 0.004–0.1 |

Passing 1.5 into a uniform expecting 0.08 overdrives the effect roughly nineteenfold. Add an optional mapping to `PostParamDef`:

```ts
  /** Convert the stored setting into the shader's own units. Absent = identity.
   *  Sailor's slider ranges are settled and users' saved values sit inside them,
   *  so the range gap between a setting and its catalog uniform is closed HERE
   *  rather than by moving either range. */
  toUniform?: (v: number) => number
```

Fill it in for every param whose two ranges differ — check all of them against the catalog, not just the two above — and give each one a one-line comment stating the two ranges it bridges. `applyPost` applies `toUniform` where present.

**(c) Params with `uniform: null` must not reach a host that cannot render them.** Task 3 typed `uniform` as `string | null`; `halftoneScatter` and the three `gtao` params carry `null`. `gtao` is already withheld wholesale from non-3D hosts, but `halftoneScatter` is not — and on Gradient/Texture/Shape it would render a slider, and offer the agent a knob, that provably cannot affect a pixel.

So in `controls.ts`, drop any param with `uniform === null` when `threeD` is false. Ambient occlusion's params keep appearing for 3D hosts (EffectComposer renders them), and `halftoneScatter` likewise stays for 3D. Add a test asserting `post.halftoneScatter` is absent for a flat host and present for a 3D one, and update the snapshot after reading it.

- [ ] **Step 1: Write the failing test**

`applyPost` needs a GPU, so the unit test covers the pure pass-selection logic; the pixel behaviour is covered by the per-studio browser assertions in Tasks 5-7. Create `frontend/tests/unit/studio-post-chain.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { activePasses } from '~/lib/studio/post/chain'
import { DEFAULT_POST } from '~/lib/studio/post/settings'
import { POST_CHAIN_ORDER } from '~/lib/studio/post/manifest'

describe('post pass selection', () => {
  it('selects nothing when every effect is off', () => {
    expect(activePasses(DEFAULT_POST)).toEqual([])
  })

  it('selects only the enabled effects', () => {
    const passes = activePasses({ ...DEFAULT_POST, bloom: true, vignette: true })
    expect(passes.map(p => p.id)).toEqual(['bloom', 'vignette'])
  })

  it('emits passes in chain order regardless of which were switched on first', () => {
    const passes = activePasses({ ...DEFAULT_POST, grain: true, color: true, bloom: true })
    const ids = passes.map(p => p.id)
    const expected = POST_CHAIN_ORDER.filter(id => ids.includes(id))
    expect(ids).toEqual(expected)
  })

  it('never selects a 3D-only effect for a flat host', () => {
    const passes = activePasses({ ...DEFAULT_POST, gtao: true }, { threeD: false })
    expect(passes.map(p => p.id)).not.toContain('gtao')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run tests/unit/studio-post-chain.unit.spec.ts
```

Expected: FAIL — `Cannot find module '~/lib/studio/post/chain'`.

- [ ] **Step 3: Allow Vite to read the catalog directory**

`shader_effects/` sits at the repo root, outside `frontend/`. In `frontend/nuxt.config.ts`, inside the existing `vite: { ... }` block (around line 191), add:

```ts
    server: {
      // shader_effects/ lives at the repo root; the post chain imports its .frag
      // files with ?raw so post never depends on the backend catalog endpoint at
      // render time. Keep the existing allowedHosts entry in this same block.
      fs: { allow: ['..'] },
    },
```

If a `server` key already exists in that block (it holds `allowedHosts`), add `fs` to it rather than creating a second `server` key.

- [ ] **Step 4: Write the `post_adjust` frag**

Eleven of the twelve effects already have a catalog frag; colour grading is the one gap. Create `shader_effects/post_adjust.frag` following the conventions of the existing effects (read `shader_effects/duotone.frag` first for the exact uniform/varying preamble this catalog uses, and match it):

```glsl
// Exposure / contrast / saturation / hue grade — the `color` post effect.
// Matches PostSettings' exposure, contrast, saturation, hue.
uniform float u_exposure;    // 0..3, 1 = neutral
uniform float u_contrast;    // 0..3, 1 = neutral
uniform float u_saturation;  // 0..3, 1 = neutral
uniform float u_hue;         // -1..1 turns, 0 = neutral

vec3 hueRotate(vec3 c, float turns) {
  float a = turns * 6.2831853;
  vec3 k = vec3(0.57735);
  float cs = cos(a);
  return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}

void main() {
  vec4 src = texture(u_texture, v_uv);
  vec3 c = src.rgb * u_exposure;
  c = (c - 0.5) * u_contrast + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, u_saturation);
  if (abs(u_hue) > 0.0001) c = hueRotate(c, u_hue);
  fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
```

Register it in `shader_effects/manifest.json` with `"id": "post_adjust"`, `"category": "color"`, `"animated": false`, `"passes": 1`, `"centerParam": null`, `"textures": []`, and the four float params above with their min/max/default/step.

- [ ] **Step 5: Write the chain**

Create `frontend/app/lib/studio/post/chain.ts`. Model the GL2 setup on `frontend/app/lib/shaderfx/renderer.ts` — read it first; it already solves the singleton context, the ping-pong framebuffers, and the y-flip convention, and this module should mirror its structure rather than invent a second approach.

Requirements the code must satisfy:

```ts
/**
 * The shared post stage. Any studio hands its finished frame in and draws the
 * result back onto its own canvas.
 *
 * ONE GL2 context app-wide (browsers cap at ~8-16), same posture as
 * shaderfx/renderer.ts. Consequence, and the invariant to respect: the returned
 * canvas is valid ONLY until the next applyPost call. Draw it back immediately.
 * A studio that held the reference across a frame would silently render another
 * studio's output.
 *
 * Returns `source` untouched (and creates no context) when nothing is enabled,
 * so post-off costs nothing.
 *
 * Must stay free of `three` imports.
 */
export function applyPost(
  source: TexImageSource, post: PostSettings, w: number, h: number, t: number,
  opts: { threeD?: boolean } = {},
): TexImageSource
```

- `activePasses(post, opts)` filters `POST_EFFECTS` to enabled, non-withheld effects and returns them sorted by `POST_CHAIN_ORDER`.
- `applyPost` returns `source` immediately when `activePasses(...).length === 0`.
- Each pass binds the previous result as `u_texture`, sets each declared uniform from its `settingsKey`, sets `u_time` to `t` and `u_resolution` to `(w, h)`, and ping-pongs.
- `alphaGated` effects receive `u_alphaGate = 1.0`; the frag multiplies its contribution by `src.a`. Where a catalog frag does not yet read `u_alphaGate`, add the multiply to that frag — this is the change that replaces Gradient's `cover` plumbing.
- The `.frag` sources are imported with `import.meta.glob('../../../../shader_effects/*.frag', { query: '?raw', import: 'default', eager: true })`, keyed by effect id.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run tests/unit/studio-post-chain.unit.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Prove alpha survives the chain**

The transparent-WebM and Figma-matte export routes depend on studios emitting real transparency, and grain landing on empty background is exactly what Gradient's coverage gate existed to prevent. This needs a GPU, so it goes in the Playwright harness rather than Vitest.

Add to `frontend/tests/studio-post-integration.spec.ts` (created in Task 5 — if running Task 4 first, create the file with just this test):

```ts
test('post preserves alpha and keeps grain off transparent pixels', async ({ page }) => {
  await page.goto('/dev/shaderfx-harness')
  const r = await page.evaluate(async () => {
    // A frame that is opaque on the left half, fully transparent on the right.
    return await window.__sailorPostAlphaProbe({ effects: ['grain', 'bloom', 'vignette'] })
  })
  // Transparent stays transparent — no pass may fill the background in.
  expect(r.transparentMaxAlpha).toBe(0)
  // And nothing was painted there either, so a matte export stays clean.
  expect(r.transparentMaxLuma).toBe(0)
  // The opaque half is untouched in alpha.
  expect(r.opaqueMinAlpha).toBe(255)
})
```

Add `__sailorPostAlphaProbe` to the harness page: build a half-opaque/half-transparent canvas, run `applyPost` with the named effects on, read the pixels back, and return those three numbers.

- [ ] **Step 8: Run it**

```bash
cd frontend && npx playwright test tests/studio-post-integration.spec.ts --project=chromium
```

Expected: PASS. If `transparentMaxLuma` is non-zero, the failing effect is missing its `u_alphaGate` multiply — fix the frag, not the test.

- [ ] **Step 9: Commit**

```bash
git add shader_effects/post_adjust.frag shader_effects/manifest.json \
        frontend/app/lib/studio/post/chain.ts \
        frontend/nuxt.config.ts \
        frontend/tests/unit/studio-post-chain.unit.spec.ts \
        frontend/tests/studio-post-integration.spec.ts
git commit -m "feat(post): shared GL2 chain + post_adjust colour grade frag"
```

---

### Task 5: Gradient Studio adopts the post stack

The first real host. Get the seam right here; Tasks 6 and 7 repeat it.

**Files:**
- Modify: `frontend/app/lib/gradientfx/types.ts` (add `post` to `GradientConfig`, default it in `ensureConfigDefaults`)
- Modify: `frontend/app/lib/gradientfx/renderer.ts` (call `applyPost` at the end of `render`)
- Modify: `frontend/app/lib/gradientfx/controls.ts` (append `postControls({ threeD: false })`)
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue` (render the Post sections)
- Test: `frontend/tests/unit/gradientfx-post.unit.spec.ts`, `frontend/tests/studio-post-integration.spec.ts`

**Interfaces:**
- Consumes: `applyPost` (Task 4), `postControls`/`POST_SECTIONS` (Task 3), `DEFAULT_POST` (Task 2).
- Produces: `GradientConfig.post: PostSettings`; the browser helper `window.__sailorPostProbe` used by Tasks 6-7.

- [ ] **Step 1: Write the failing unit test**

Create `frontend/tests/unit/gradientfx-post.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ensureConfigDefaults } from '~/lib/gradientfx/types'
import { GRADIENT_CONTROLS } from '~/lib/gradientfx/controls'
import { DEFAULT_POST } from '~/lib/studio/post/settings'

describe('gradient post adoption', () => {
  it('defaults post to off on a config saved before the change', () => {
    const legacy = ensureConfigDefaults({ canvas: {}, layers: [] } as never)
    expect(legacy.post).toEqual(DEFAULT_POST)
  })

  it('preserves post that is already present', () => {
    const cfg = ensureConfigDefaults({ canvas: {}, layers: [], post: { ...DEFAULT_POST, bloom: true } } as never)
    expect(cfg.post.bloom).toBe(true)
  })

  it('exposes the post controls without ambient occlusion', () => {
    const keys = GRADIENT_CONTROLS.map(c => c.key)
    expect(keys).toContain('post.bloom')
    expect(keys).toContain('post.vignette')
    expect(keys.some(k => k.startsWith('post.gtao'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run tests/unit/gradientfx-post.unit.spec.ts
```

Expected: FAIL — `post` is undefined on the returned config.

- [ ] **Step 3: Add `post` to the config and its defaulting**

In `frontend/app/lib/gradientfx/types.ts`, add to the `GradientConfig` interface:

```ts
  /** Shared post-processing stack — see ~/lib/studio/post. */
  post: PostSettings
```

with `import type { PostSettings } from '~/lib/studio/post/settings'`. In `ensureConfigDefaults` (around line 313), add:

```ts
  cfg.post = { ...DEFAULT_POST, ...(cfg.post ?? {}) }
```

- [ ] **Step 4: Append the controls**

In `frontend/app/lib/gradientfx/controls.ts`, append to the exported control list:

```ts
  ...postControls({ threeD: false }),
```

and add `...POST_SECTIONS` to the end of `GRADIENT_SECTIONS`.

- [ ] **Step 5: Call the chain from the renderer**

In `frontend/app/lib/gradientfx/renderer.ts`, at the very end of the render method — after the gradient and its existing blur pass have drawn, before returning:

```ts
    // The single post call site for this studio. Because getFrame() hands this same
    // canvas to bakes, exports and wired downstream nodes, post applied here is in
    // every path automatically — no export route has to remember it.
    if (postEnabled(cfg.post)) {
      const out = applyPost(this.canvas, cfg.post, width, height, t)
      if (out !== this.canvas) this.blitBack(out)
    }
```

**The blit is the part to get right, and it is not a `drawImage`.** `this.canvas` is a WebGL2 context — it has no 2D context, so `getContext('2d')` returns `null` and the composite would silently do nothing. Write `blitBack(src: TexImageSource)` as a private method on the renderer that uploads `src` into a texture and draws a full-screen triangle with a pass-through shader, using the renderer's existing GL context.

The renderer already has everything this needs: a compiled full-screen quad path for its blur pass and its `texImage2D` upload helper. Read `lib/gradientfx/renderer.ts`'s blur-pass code and reuse its quad and program-creation helpers rather than adding a second way to draw a full-screen pass.

Preserve straight (non-premultiplied) alpha — the context is created with `premultipliedAlpha: false` (renderer.ts:48), and the transparent-background export routes depend on that staying true.

- [ ] **Step 6: Render the panel**

In `GradientStudioSurface.vue`, the inspector already renders sections from the control list via `StudioControlPanel`. Confirm the new Post sections appear without further work; if the surface hand-writes its sections rather than deriving them, add the Post sections following the file's existing pattern.

- [ ] **Step 7: Write the integration assertion**

Create `frontend/tests/studio-post-integration.spec.ts`. This is the test that catches a chain that silently no-ops — and, per the spec, a diff alone is not enough, because a broken effect that flattens the frame to a wash also diffs.

```ts
import { test, expect } from '@playwright/test'

// Two assertions per studio, because either alone can be fooled:
//   1. post ON differs from post OFF   → proves the stage ran
//   2. output still correlates with input → proves it did not flatten the frame
// The risograph bug (2026-08-04) passed a parity gate at 0.01/255 while rendering
// a flat wash with the image gone. Assertion 2 is what would have caught it.
const SIZES = [128, 512]

test('gradient post stage runs and preserves structure', async ({ page }) => {
  await page.goto('/dev/gradient-harness')
  for (const size of SIZES) {
    const r = await page.evaluate(async (s) => await window.__sailorPostProbe({ effect: 'bloom', size: s }), size)
    expect(r.meanAbsDiff).toBeGreaterThan(1 / 255)      // it ran
    expect(r.corr).toBeGreaterThan(0.5)                  // it did not wash out
  }
})
```

Add the `__sailorPostProbe` helper to the dev harness page: it renders the studio at `size` with post off, captures the luma, renders with `effect` on, captures again, and returns `{ meanAbsDiff, corr }` where `corr` is the Pearson correlation of the two luma arrays. If no `/dev/gradient-harness` page exists, create one following `/dev/shaderfx-harness`, which `tests/shaderfx-golden.spec.ts` already drives.

- [ ] **Step 8: Run both tests**

```bash
cd frontend && npx vitest run tests/unit/gradientfx-post.unit.spec.ts
npx playwright test tests/studio-post-integration.spec.ts --project=chromium
```

Expected: unit PASS (3 tests); Playwright PASS. The Playwright run needs a dev server — start it with `./dev.sh` from the repo root, and check `ps` for stray Nuxt servers from parallel sessions first, since a duplicate silently takes a different port.

- [ ] **Step 9: Look at it in the real UI**

Open Gradient Studio, switch on bloom, vignette and grain one at a time, and confirm each visibly changes the frame at the size the node renders at — not just in a 128px probe. The risograph bug was invisible to every automated gate and obvious in a thumbnail. Report what you saw.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/lib/gradientfx/types.ts \
        frontend/app/lib/gradientfx/controls.ts \
        frontend/app/lib/gradientfx/renderer.ts \
        frontend/app/components/vue-canvas/GradientStudioSurface.vue \
        frontend/tests/unit/gradientfx-post.unit.spec.ts \
        frontend/tests/studio-post-integration.spec.ts
git commit -m "feat(gradient): adopt the shared post stack"
```

---

### Task 6: Texture Studio adopts the post stack

Same seam as Task 5. Read Task 5 in full before starting — the steps are the same shape with different files, and the renderer blit detail in Task 5 Step 5 applies here too.

**Files:**
- Modify: `frontend/app/lib/texturefx/types.ts` (add `post`, default it)
- Modify: `frontend/app/lib/texturefx/renderer.ts` (call `applyPost` at the end of render)
- Modify: `frontend/app/lib/texturefx/controls.ts` (append `postControls({ threeD: false })`)
- Modify: `frontend/app/lib/texturefx/sections.ts` (append `POST_SECTIONS`)
- Test: `frontend/tests/unit/texturefx-post.unit.spec.ts`, extend `frontend/tests/studio-post-integration.spec.ts`

**Interfaces:**
- Consumes: everything Task 5 consumes, plus the `__sailorPostProbe` helper shape Task 5 established.
- Produces: `TextureConfig.post: PostSettings`.

- [ ] **Step 1: Write the failing unit test**

Create `frontend/tests/unit/texturefx-post.unit.spec.ts`, mirroring Task 5 Step 1 against Texture's config type and its control list export. Texture has **no `ensureConfigDefaults`** — find where it normalizes a loaded config (read `lib/texturefx/types.ts` and `TextureStudioSurface.vue`'s load path) and assert defaulting happens there.

```ts
import { describe, it, expect } from 'vitest'
import { TEXTURE_CONTROLS } from '~/lib/texturefx/controls'
import { DEFAULT_POST } from '~/lib/studio/post/settings'

describe('texture post adoption', () => {
  it('exposes the post controls without ambient occlusion', () => {
    const keys = TEXTURE_CONTROLS.map(c => c.key)
    expect(keys).toContain('post.bloom')
    expect(keys.some(k => k.startsWith('post.gtao'))).toBe(false)
  })

  it('defaults post to off for a config saved before the change', () => {
    // Replace with Texture's actual normalizer once located.
    const cfg = normalizeTextureConfig({} as never)
    expect(cfg.post).toEqual(DEFAULT_POST)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run tests/unit/texturefx-post.unit.spec.ts
```

Expected: FAIL — no `post.*` keys in the control list.

- [ ] **Step 3: Add `post` to the config, its defaulting, and the controls**

Follow Task 5 Steps 3-4 against Texture's files. Append `...POST_SECTIONS` to `texturefx/sections.ts`'s order array — remember that array is both the ordering **and** the allow-list, so a section not listed is silently dropped and the panel would simply not appear.

- [ ] **Step 4: Call the chain from the renderer**

Follow Task 5 Step 5 against `texturefx/renderer.ts`'s render exit point (the file is ~904 lines; find the single point where the frame is finished).

- [ ] **Step 5: Extend the integration test**

Add a Texture case to `frontend/tests/studio-post-integration.spec.ts`, same two assertions at the same two sizes.

- [ ] **Step 6: Run both**

```bash
cd frontend && npx vitest run tests/unit/texturefx-post.unit.spec.ts
npx playwright test tests/studio-post-integration.spec.ts --project=chromium
```

Expected: both PASS.

- [ ] **Step 7: Look at it in the real UI**, as in Task 5 Step 9. Report what you saw.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/texturefx/types.ts \
        frontend/app/lib/texturefx/controls.ts \
        frontend/app/lib/texturefx/sections.ts \
        frontend/app/lib/texturefx/renderer.ts \
        frontend/tests/unit/texturefx-post.unit.spec.ts \
        frontend/tests/studio-post-integration.spec.ts
git commit -m "feat(texture): adopt the shared post stack"
```

---

### Task 7: Shape Studio adopts the post stack

Same seam again, with one difference: Shape renders through **three.js** (`lib/shapefx/engine.ts` uses `THREE.WebGLRenderer`), so its frame reaches `applyPost` as the three.js canvas. That canvas already sets `preserveDrawingBuffer: true` (engine.ts:63), so it is a valid `TexImageSource`.

**Files:**
- Modify: `frontend/app/lib/shapefx/config.ts` (add `post`, default it)
- Modify: `frontend/app/lib/shapefx/engine.ts` (call `applyPost` after its existing post pass)
- Modify: `frontend/app/lib/shapefx/controls.ts` (append `postControls({ threeD: false })`)
- Test: `frontend/tests/unit/shapefx-post.unit.spec.ts`, extend `frontend/tests/studio-post-integration.spec.ts`

**Interfaces:**
- Consumes: as Task 5.
- Produces: `ShapeConfig.post: PostSettings`.

- [ ] **Step 1: Write the failing unit test**

Create `frontend/tests/unit/shapefx-post.unit.spec.ts` mirroring Task 6 Step 1 against `ShapeConfig` and `lib/shapefx/controls.ts`'s export.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run tests/unit/shapefx-post.unit.spec.ts
```

Expected: FAIL — no `post.*` keys.

- [ ] **Step 3: Add `post`, its defaulting, and the controls**

Follow Task 5 Steps 3-4. `lib/shapefx/controls.ts` must stay three-free (it says so in its own header) — `postControls` is three-free by construction, so importing it is safe, but do not import `chain.ts` there.

- [ ] **Step 4: Call the chain from the engine**

In `lib/shapefx/engine.ts`, after its existing `POST_FRAG` pass runs (Shape keeps its own `distortion`; only `grain` is retired, in Task 8), hand the renderer's canvas to `applyPost` and blit the result back.

- [ ] **Step 5: Extend the integration test**, run both suites, and look at it in the real UI — Task 5 Steps 7-9.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shapefx/config.ts \
        frontend/app/lib/shapefx/controls.ts \
        frontend/app/lib/shapefx/engine.ts \
        frontend/tests/unit/shapefx-post.unit.spec.ts \
        frontend/tests/studio-post-integration.spec.ts
git commit -m "feat(shape): adopt the shared post stack"
```

---

### Task 8: Retire the duplicate grains

Four grain implementations collapse to one. The risk is that saved documents change appearance, so the migration and its test are the deliverable — not the deletion.

The coefficients differ threefold: `gradientfx/shaders.ts:637` applies `g * u_grain * 0.16 * cover * midtone`, while `shapefx/post.ts:54` applies `g * uGrain * 0.5 * midtone` — despite shapefx/post.ts:23 claiming the two read identically. **Gradient's 0.16 is canonical** (it is the more-used studio and the more conservative value).

**Files:**
- Modify: `frontend/app/lib/gradientfx/shaders.ts` (remove `u_grain`, `u_grainDeferred`, the alpha-smuggle at :642)
- Modify: `frontend/app/lib/gradientfx/renderer.ts` (stop setting the removed uniforms)
- Modify: `frontend/app/lib/gradientfx/types.ts` (migrate `grain` → `post.grainAmount` in `ensureConfigDefaults`)
- Modify: `frontend/app/lib/shapefx/post.ts` (remove `uGrain`; keep `uDistort`)
- Modify: `frontend/app/lib/shapefx/config.ts` (migrate `style.grain` → `post.grainAmount`, rescaled)
- Test: `frontend/tests/unit/post-grain-migration.unit.spec.ts`

**Interfaces:**
- Consumes: `post.grain`/`post.grainAmount` from Task 3's manifest.
- Produces: nothing new; removes `GradientConfig.grain` and `ShapeConfig.style.grain`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/post-grain-migration.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ensureConfigDefaults } from '~/lib/gradientfx/types'
import { ensureShapeDefaults } from '~/lib/shapefx/config'

const SHAPE_TO_CANONICAL = 0.5 / 0.16

describe('grain migration', () => {
  it('carries a gradient doc through unchanged (0.16 is canonical)', () => {
    const cfg = ensureConfigDefaults({ canvas: {}, layers: [], grain: 0.4 } as never)
    expect(cfg.post.grain).toBe(true)
    expect(cfg.post.grainAmount).toBeCloseTo(0.4, 5)
  })

  it('rescales a shape doc so it renders as before', () => {
    const cfg = ensureShapeDefaults({ style: { grain: 0.2 } } as never)
    expect(cfg.post.grain).toBe(true)
    expect(cfg.post.grainAmount).toBeCloseTo(0.2 * SHAPE_TO_CANONICAL, 5)
  })

  it('clamps rather than exceeding the slider range', () => {
    const cfg = ensureShapeDefaults({ style: { grain: 0.9 } } as never)
    expect(cfg.post.grainAmount).toBeLessThanOrEqual(1)
    expect(cfg.post.grainAmount).toBe(1)
  })

  it('leaves post.grain off when the old doc had no grain', () => {
    expect(ensureConfigDefaults({ canvas: {}, layers: [], grain: 0 } as never).post.grain).toBe(false)
    expect(ensureShapeDefaults({ style: {} } as never).post.grain).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npx vitest run tests/unit/post-grain-migration.unit.spec.ts
```

Expected: FAIL — the migration does not exist.

- [ ] **Step 3: Migrate on read**

In `gradientfx/types.ts`'s `ensureConfigDefaults`, after the `post` default from Task 5:

```ts
  // Grain moved into the shared post stack. Gradient's 0.16 coefficient is
  // canonical, so its stored values carry over 1:1 and existing docs are
  // pixel-stable. Delete this block once pre-2026-08 gradient docs are gone.
  const legacyGrain = (cfg as { grain?: number }).grain
  if (typeof legacyGrain === 'number' && legacyGrain > 0) {
    cfg.post.grain = true
    cfg.post.grainAmount = Math.min(1, legacyGrain)
  }
  delete (cfg as { grain?: number }).grain
```

In `shapefx/config.ts`'s defaulting function, the same shape with the rescale:

```ts
  // Shape's grain used a 0.5 coefficient where Gradient used 0.16, so the same
  // slider value rendered ~3x stronger — despite shapefx/post.ts claiming the two
  // matched. Rescale into the canonical 0.16 space so saved shapes look unchanged.
  const legacyGrain = cfg.style?.grain
  if (typeof legacyGrain === 'number' && legacyGrain > 0) {
    cfg.post.grain = true
    cfg.post.grainAmount = Math.min(1, legacyGrain * (0.5 / 0.16))
  }
  delete (cfg.style as { grain?: number }).grain
```

- [ ] **Step 4: Run the migration test**

```bash
cd frontend && npx vitest run tests/unit/post-grain-migration.unit.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Remove the old implementations**

- `gradientfx/shaders.ts`: delete the `u_grain` and `u_grainDeferred` uniforms, the grain block at ~:629-642, and restore `fragColor`'s alpha to `1.0`-or-coverage without the deferred smuggle. Delete the matching block in the blur post-pass (~:665-680).
- `gradientfx/renderer.ts`: stop setting `u_grain` / `u_grainDeferred`.
- `shapefx/post.ts`: delete `uGrain`, `hashGrain`, and the grain block; keep `uDistort` and update `postNeeded` to test distortion only. Delete the now-false comment at :23 claiming the hash is shared.

- [ ] **Step 6: Prove the pixels did not move**

This is the test the whole retirement rests on. With the dev server running, load a Gradient doc and a Shape doc saved before this change, render each at 512px, and compare against a capture taken at the commit before Task 8:

```bash
cd frontend && npx playwright test tests/studio-post-integration.spec.ts --project=chromium
```

Then, by eye: open both studios with their migrated docs and confirm the grain reads the same as before. **A Shape doc is the one to scrutinise** — it is the one whose stored number changed.

- [ ] **Step 7: Run the full unit suite**

```bash
cd frontend && npx vitest run 2>&1 | tail -15
```

Expected: no new failures versus the baseline recorded in Task 2 Step 5. Quote the failure count **and** the collected-file total.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/gradientfx/shaders.ts \
        frontend/app/lib/gradientfx/renderer.ts \
        frontend/app/lib/gradientfx/types.ts \
        frontend/app/lib/shapefx/post.ts \
        frontend/app/lib/shapefx/config.ts \
        frontend/tests/unit/post-grain-migration.unit.spec.ts
git commit -m "refactor(post): retire the duplicate grains, migrate saved docs"
```

---

## Out of scope — do not start these

Named in the spec as follow-ons, each needing its own plan:

- Migrating Scene3D and Space Type off `EffectComposer` onto the shared chain, gated on a golden-image parity diff per effect.
- Absorbing the Compositor's six-effect chain (a deletion once the shared vocabulary exists).
- Whether Shader Studio's chain params are motion-animatable.

## After the last task

Per the standing rule, update the ⛵ State of the Build artifact — read the live one first, since other sessions publish to it.
