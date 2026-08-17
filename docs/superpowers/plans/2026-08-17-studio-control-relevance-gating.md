# Studio Control-Relevance Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide inspector controls that do nothing in the current effect's active mode, in Expressive (Space Type) Studio and Shader Studio — so every visible control affects the output.

**Architecture:** Space Type already has the mechanism — `ControlSpec.showIf: { key, equals?/notEquals? }`, evaluated by `showIfVisible()` (`app/lib/studio/sections.ts`) and applied by `SpaceTypeSurface.vue`'s `controlIsVisible()`. Four effects use it today (ring, stripes, loft, slitScan). This plan (a) extends `showIf` with `in`/`notIn` for multi-value gates, then (b) applies it to 16 more effects. Shader Studio has NO general mechanism (only a hardcoded `ascii_dither`/`u_shape===14` check), so we add a manifest `showWhen: { uniform, equals: number | number[] }` field plus a `matchesShowWhen()` helper in `ShaderStudioSurface.vue`, then apply it to 7 effects.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest. Shader manifest is `shader_effects/manifest.json` (repo root; the frontend catalog re-reads it per request).

## Global Constraints

- **Parallel-session commit hygiene:** main-direct, stage only the paths you touch (`git add <path>`), never `git add -A`, never stash. See memory `parallel-sessions-commit-hygiene`.
- **`showIf`/`showWhen` are data, not logic.** No control's default value changes; no render code changes. A hidden control keeps its stored value — hiding is purely visibility.
- **Verify literals against source.** The audit named each mode toggle, but every task MUST open the effect source (`.ts` / `.frag`) and confirm the exact param `key`/`uniform` and the exact value literal (`'on'` vs `true`, enum number, etc.) before writing the gate. A wrong literal silently hides nothing or hides always.
- **A `switch` toggles on a boolean; a `select` on its string option.** `showIf.equals` must match the stored type (`true`/`false` for a switch, the option string for a select).
- Never gate a control on a `key` that isn't a declared control of the same effect.

---

## Task 1: Extend `showIf` with `in` / `notIn`

Some gates are "visible for one of several modes" (e.g. boost's colour group is live for palette/gradient/mixed/custom). A single `equals`/`notEquals` can't express that; add array forms.

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts` (the `showIf` type in `ControlMeta`, ~line 15)
- Modify: `frontend/app/lib/studio/sections.ts` (`showIfVisible`, ~line 16)
- Test: `frontend/tests/unit/spacetype-showif.unit.spec.ts` (create)

**Interfaces:**
- Produces: `showIf?: { key: string; equals?: ParamValue; notEquals?: ParamValue; in?: ParamValue[]; notIn?: ParamValue[] }`. `showIfVisible(c, read)` returns true unless a present clause fails. Clauses are ANDed (all present must pass); in practice only one is set per control.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { showIfVisible } from '../../app/lib/studio/sections'
import type { ControlSpec } from '../../app/lib/spacetype/effect'

const ctl = (showIf: any): ControlSpec =>
  ({ key: 'x', label: 'X', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0, group: 'G', showIf }) as any

describe('showIfVisible in/notIn', () => {
  const read = (vals: Record<string, any>) => (k: string) => vals[k]

  it('in: visible when value is one of the list', () => {
    const c = ctl({ key: 'mode', in: ['palette', 'gradient', 'custom'] })
    expect(showIfVisible(c, read({ mode: 'gradient' }))).toBe(true)
    expect(showIfVisible(c, read({ mode: 'solid' }))).toBe(false)
  })

  it('notIn: hidden when value is one of the list', () => {
    const c = ctl({ key: 'mode', notIn: ['solid', 'grid'] })
    expect(showIfVisible(c, read({ mode: 'grid' }))).toBe(false)
    expect(showIfVisible(c, read({ mode: 'palette' }))).toBe(true)
  })

  it('still honours equals/notEquals and no-showIf', () => {
    expect(showIfVisible(ctl({ key: 'm', equals: 'on' }), read({ m: 'on' }))).toBe(true)
    expect(showIfVisible(ctl({ key: 'm', equals: 'on' }), read({ m: 'off' }))).toBe(false)
    expect(showIfVisible({ key: 'x', label: 'X', kind: 'slider', min: 0, max: 1, step: 1, default: 0, group: 'G' } as any, read({}))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-showif.unit.spec.ts`
Expected: FAIL (in/notIn not honoured yet — the `in` case returns true for 'solid').

- [ ] **Step 3: Extend the type** in `effect.ts`:

```ts
  showIf?: { key: string; equals?: ParamValue; notEquals?: ParamValue; in?: ParamValue[]; notIn?: ParamValue[] }
```

- [ ] **Step 4: Extend `showIfVisible`** in `sections.ts` (add after the `notEquals` line, before the trailing `return true`):

```ts
  if (c.showIf.in !== undefined) return c.showIf.in.includes(v as ParamValue)
  if (c.showIf.notIn !== undefined) return !c.showIf.notIn.includes(v as ParamValue)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-showif.unit.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts frontend/app/lib/studio/sections.ts frontend/tests/unit/spacetype-showif.unit.spec.ts
git commit -m "feat(studio): showIf in/notIn for multi-value control gating"
```

---

## Task 2: Space Type — shadow-rig quartet (coil, cylinder, field, ribbon)

All four share a copy-pasted shadow rig: a `shadows` toggle (on/off) gating `shadowStrength`, `shadowSoftness`, `lightAngleX`, `lightAngleY`. Those four controls are only read inside `if (String(params.shadows) === 'on')`.

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/coil.ts`, `cylinder.ts`, `field.ts`, `ribbon.ts`
- Test: `frontend/tests/unit/spacetype-control-gating.unit.spec.ts` (create)

- [ ] **Step 1:** For EACH of the four effects, open the source and confirm: the exact `key` of the shadow toggle (audit says `shadows`), whether it is a `select` (`'on'`/`'off'`) or a `switch` (boolean), and the exact keys of the four dependent controls. Note per-effect any naming drift.

- [ ] **Step 2: Write the failing test** (asserts the four are hidden when shadows are off, visible when on, for all four effects):

```ts
import { describe, it, expect } from 'vitest'
import { showIfVisible } from '../../app/lib/studio/sections'
import { coil } from '../../app/lib/spacetype/effects/coil'
import { cylinder } from '../../app/lib/spacetype/effects/cylinder'
import { field } from '../../app/lib/spacetype/effects/field'
import { ribbon } from '../../app/lib/spacetype/effects/ribbon'

// If an effect's default export / named export differs, adjust the import.
const EFFECTS = { coil, cylinder, field, ribbon } as Record<string, any>
const SHADOW_DEPS = ['shadowStrength', 'shadowSoftness', 'lightAngleX', 'lightAngleY']

describe('shadow controls hide when shadows are off', () => {
  for (const [name, eff] of Object.entries(EFFECTS)) {
    it(`${name}: shadow deps gated on the shadows toggle`, () => {
      const controls = eff.controls as any[]
      const toggle = controls.find(c => c.key === 'shadows')
      expect(toggle, `${name} has a shadows toggle`).toBeTruthy()
      const offVal = toggle.kind === 'switch' ? false : 'off'
      const onVal = toggle.kind === 'switch' ? true : 'on'
      for (const dep of SHADOW_DEPS) {
        const c = controls.find(x => x.key === dep)
        expect(c, `${name}.${dep} exists`).toBeTruthy()
        expect(c.showIf, `${name}.${dep} has showIf`).toBeTruthy()
        expect(showIfVisible(c, (k) => (k === 'shadows' ? offVal : undefined))).toBe(false)
        expect(showIfVisible(c, (k) => (k === 'shadows' ? onVal : undefined))).toBe(true)
      }
    })
  }
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-control-gating.unit.spec.ts`
Expected: FAIL (`showIf` undefined on the deps).

- [ ] **Step 4: Add `showIf`** to each of the four dependent controls in all four effect files. For a `select` toggle use `showIf: { key: 'shadows', equals: 'on' }`; for a `switch` use `equals: true`. (Use the literal that matches what Step 1 found.)

- [ ] **Step 5: Run to verify it passes** — same command, Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects/coil.ts frontend/app/lib/spacetype/effects/cylinder.ts frontend/app/lib/spacetype/effects/field.ts frontend/app/lib/spacetype/effects/ribbon.ts frontend/tests/unit/spacetype-control-gating.unit.spec.ts
git commit -m "feat(spacetype): hide shadow controls when shadows off (coil/cylinder/field/ribbon)"
```

---

## Task 3: Space Type — boost

Largest single offender (~18 controls). Confirm each key/literal in `boost.ts` (and its `resolveSide`/`pickStyle` helpers) before gating.

**Files:** Modify `frontend/app/lib/spacetype/effects/boost.ts`; extend `spacetype-control-gating.unit.spec.ts`.

Gates (verify exact keys + literals in source):
- `extrudeMode` (static/tumble/zoom/punch): `punchDistance` → `equals: 'punch'`; `holdFraction` → `notEquals: 'static'`; if a distinct `tumble` control exists and is unused in `zoom`, gate it `notEquals: 'zoom'`.
- `sideMode` (palette/gradient/ombre/rainbow/grid/noise/solid/mixed/custom):
  - `sideColor` → `equals: 'solid'`
  - `gridCell`, `gridLine` → `equals: 'grid'`
  - `noiseColor1`, `noiseColor2` → `equals: 'noise'`
  - `boostColor1..6`, `paletteCount` → `in: ['palette', 'gradient', 'mixed', 'custom']`
  - `letterStyles` → `equals: 'custom'`
- `stroke` (off/on): `strokeColor`, `strokeWidth` → `equals: 'on'` (or `true` if switch).

- [ ] **Step 1:** Read `boost.ts`; list every control's exact key and the exact option strings of `extrudeMode`/`sideMode`/`stroke`. Reconcile with the gates above (rename literals to match).
- [ ] **Step 2:** Add one representative assertion per gate group to `spacetype-control-gating.unit.spec.ts` (e.g. `boostColor1` hidden when `sideMode='solid'`, visible when `'gradient'`; `punchDistance` hidden unless `extrudeMode='punch'`). Run — expect FAIL.
- [ ] **Step 3:** Add the `showIf` clauses in `boost.ts`.
- [ ] **Step 4:** Run — expect PASS. Also run the full spacetype suite to ensure no agent/motion integrity test breaks: `npx vitest run tests/unit -t spacetype` (adjust filter to match existing test names).
- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/boost.ts frontend/tests/unit/spacetype-control-gating.unit.spec.ts
git commit -m "feat(spacetype): gate boost side/extrude/stroke controls to their modes"
```

---

## Task 4: Space Type — sliceGlitch

~19 controls across several toggles; some conditions live in `sliceGlitchLayout.ts`. Verify in source.

**Files:** Modify `frontend/app/lib/spacetype/effects/sliceGlitch.ts`; extend the gating spec.

Gates (verify keys + literals):
- `revealMode` (animate/hold): `speed`, `sceneCount`, `sceneTransition`, `transitionTear`, `ease` → `equals: 'animate'`; `glitchAmount` (labelled "Glitch (hold)") → `equals: 'hold'`.
- `fontVaryUnit` (off/line/word/character): `weightJitter`, `slantJitter`, `fontSeed` → `notEquals: 'off'`.
- `blockUnit`: `blockDensity` → `equals: 'random'` (confirm the option value in source).
- `doodlesOn` (on/off): all 9 doodle controls (`doodleCount`, `doodleSize`, `doodleSizeJitter`, `doodleAreaW`, `doodleAreaH`, `doodleColorMode`, `doodleWidth`, `doodleStroke`, `doodleStrokeColor`) → `equals: 'on'` (or `true` if switch).

- [ ] **Step 1:** Read `sliceGlitch.ts` (+ `sliceGlitchLayout.ts` for `blockUnit`/`blockDensity`); confirm keys and option literals.
- [ ] **Step 2:** Add representative assertions (e.g. all 9 doodle controls hidden when `doodlesOn` off; `glitchAmount` hidden in `animate`; `weightJitter` hidden when `fontVaryUnit='off'`). Run — expect FAIL.
- [ ] **Step 3:** Add the `showIf` clauses.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/sliceGlitch.ts frontend/tests/unit/spacetype-control-gating.unit.spec.ts
git commit -m "feat(spacetype): gate sliceGlitch reveal/font/block/doodle controls to their modes"
```

---

## Task 5a: Space Type — ball, blend, cascade, cornerPin, echo

**Files:** Modify those five effect files; extend the gating spec.

Gates (verify keys + literals per source):
- **ball** — `panelMode` (fixed/per-word): `segments` → `equals: 'fixed'`. `shading` (flat/lit): `shadeStrength` → `equals: 'lit'`.
- **blend** — `style` (outline/solid): `strokeWidth` → `equals: 'outline'`.
- **cascade** — `noStripes` (off/on): `gradientMode` → `equals: 'off'` (gradientMode is dead when noStripes is on).
- **cornerPin** — `mode` (loop/static): `scenes`, `holdTime`, `transitionTime`, `ease`, `sway`, `seed` → `equals: 'loop'`.
- **echo** — `showBox` (off/on): `cardColor`, `cardOpacity` → `equals: 'on'` (or `true` if switch).

- [ ] **Step 1:** Read each file; confirm keys/literals.
- [ ] **Step 2:** Add one representative assertion per effect. Run — expect FAIL.
- [ ] **Step 3:** Add `showIf` clauses.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/ball.ts frontend/app/lib/spacetype/effects/blend.ts frontend/app/lib/spacetype/effects/cascade.ts frontend/app/lib/spacetype/effects/cornerPin.ts frontend/app/lib/spacetype/effects/echo.ts frontend/tests/unit/spacetype-control-gating.unit.spec.ts
git commit -m "feat(spacetype): gate mode-specific controls (ball/blend/cascade/cornerPin/echo)"
```

---

## Task 5b: Space Type — melt, onionburst, shutter, streamer, string

**Files:** Modify those five effect files; extend the gating spec.

Gates (verify keys + literals per source):
- **melt** — `waveStyle` (smooth/geometric): `steps` → `equals: 'geometric'`.
- **onionburst** — `tumbleMotion` (animate/static): `holdFraction` → `equals: 'animate'`.
- **shutter** — `colorMode` (mono/palette/fill): `textColor` → `equals: 'mono'`; `paletteA`, `paletteB` → `equals: 'palette'`; `fill` → `equals: 'fill'`. `mode` (static/loop): `scenes`, `variance`, `holdTime`, `transitionTime`, `ease`, `seed` → `equals: 'loop'`.
- **streamer** — `noStripes` (off/on): the front-face colour group (confirm exact keys — `frontMode`, `fills`, and related) → `equals: 'off'`. `backMode` (…/solid): `backColorB`, `backDensity` → `notEquals: 'solid'`.
- **string** — `textureMode` (Text/Gradient 1/Gradient 2/Stripes/Mixture/…): confirm each fore/g1..g5 key's live set in `buildTile`, then gate with `in: [...]`. `fore` (text colour) → the text/mixture modes; `g2..g5` → the modes that read them. (This one is the fiddliest — derive the live set directly from `buildTile`'s switch.)

- [ ] **Step 1:** Read each file (for **string**, read `buildTile`); confirm keys, option literals, and per-mode live sets.
- [ ] **Step 2:** Add one representative assertion per effect. Run — expect FAIL.
- [ ] **Step 3:** Add `showIf` clauses.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/melt.ts frontend/app/lib/spacetype/effects/onionburst.ts frontend/app/lib/spacetype/effects/shutter.ts frontend/app/lib/spacetype/effects/streamer.ts frontend/app/lib/spacetype/effects/string.ts frontend/tests/unit/spacetype-control-gating.unit.spec.ts
git commit -m "feat(spacetype): gate mode-specific controls (melt/onionburst/shutter/streamer/string)"
```

---

## Task 6: Shader — `showWhen` mechanism

Add the general mechanism Shader Studio lacks, and re-express the existing hardcoded `ascii_dither`/`u_shape===14` check through it.

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue` (param `v-for` ~line 786; add a `matchesShowWhen` helper near `numValue`)
- Test: `frontend/tests/unit/shader-showwhen.unit.spec.ts` (create) — unit-test the pure matcher via a small exported helper.

**Interfaces:**
- Manifest param gains optional `showWhen?: { uniform: string; equals: number | number[] }`.
- `matchesShowWhen(p, read)`: returns true when `p.showWhen` absent, else `Math.round(read(p.showWhen.uniform))` equals (or is included in) `p.showWhen.equals`. Uses rounding because enum uniforms are stored as floats.

- [ ] **Step 1:** Extract a pure exported matcher so it's testable without mounting the component. Add to a small module `frontend/app/lib/shaderfx/showWhen.ts`:

```ts
export interface ShowWhen { uniform: string; equals: number | number[] }
export function matchesShowWhen(showWhen: ShowWhen | undefined, read: (uniform: string) => number): boolean {
  if (!showWhen) return true
  const v = Math.round(read(showWhen.uniform))
  return Array.isArray(showWhen.equals) ? showWhen.equals.includes(v) : v === showWhen.equals
}
```

- [ ] **Step 2: Write the failing test** `shader-showwhen.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchesShowWhen } from '../../app/lib/shaderfx/showWhen'

describe('matchesShowWhen', () => {
  const read = (vals: Record<string, number>) => (u: string) => vals[u] ?? 0
  it('absent → always visible', () => {
    expect(matchesShowWhen(undefined, read({}))).toBe(true)
  })
  it('scalar equals with float rounding', () => {
    const sw = { uniform: 'u_mode', equals: 1 }
    expect(matchesShowWhen(sw, read({ u_mode: 1.0 }))).toBe(true)
    expect(matchesShowWhen(sw, read({ u_mode: 0.0 }))).toBe(false)
  })
  it('array equals', () => {
    const sw = { uniform: 'u_shape', equals: [14, 15] }
    expect(matchesShowWhen(sw, read({ u_shape: 15 }))).toBe(true)
    expect(matchesShowWhen(sw, read({ u_shape: 3 }))).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify it fails** (module doesn't exist yet).

Run: `cd frontend && npx vitest run tests/unit/shader-showwhen.unit.spec.ts`
Expected: FAIL.

- [ ] **Step 4:** Create `showWhen.ts` (Step 1 code). Run — expect PASS.

- [ ] **Step 5: Wire it into the surface.** In `ShaderStudioSurface.vue`:
  - Import `matchesShowWhen` and its `ShowWhen` type.
  - Add the param-visibility guard to the `v-for` row wrapper (the `<div v-for="p in effectDef?.params ...">` at line 786): change it to `v-if="matchesShowWhen(p.showWhen, numValue)"` on that div (keep `:key`). `numValue(uniform)` already returns the current numeric value.
  - Re-express the existing `ascii_dither` custom-chars block: keep the `u_shape===14` text-input row (it's a distinct extra UI element, not a param toggle), but the `u_shape` select itself now stays visible via the manifest — no change needed there. Confirm the custom-chars `<div v-if>` still reads `numValue('u_shape')===14`.

- [ ] **Step 6:** Compile-check the surface (Vite) and run the shader unit test again.

Run: `cd frontend && npx vitest run tests/unit/shader-showwhen.unit.spec.ts`
Expected: PASS. Then a typecheck of the file (see memory `sailor-dev-environment` for the Vite compile-check curl) — no new errors beyond the ~328 baseline.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/shaderfx/showWhen.ts frontend/app/components/vue-canvas/ShaderStudioSurface.vue frontend/tests/unit/shader-showwhen.unit.spec.ts
git commit -m "feat(shader): showWhen manifest field + param-visibility gating in the surface"
```

---

## Task 7: Shader — apply `showWhen` to the manifest

Add `showWhen` to dependent params for the 7 effects. Verify each uniform's enum values against the effect's `.frag` (and the manifest `options` value numbers) before writing.

**Files:** Modify `shader_effects/manifest.json` (repo root). Optionally add a fixture test.

Gates (enum `value` numbers are from each effect's manifest `options`; confirm):
- **crystal_prism** — `u_mode` (Glass 0 / Faceted 1 / Prism 2): `u_facetStyle`, `u_facetRefract`, `u_shading` → `showWhen: { uniform: 'u_mode', equals: 1 }`. `u_facetJitter`, `u_multiScale` → only in Faceted **and** `u_facetStyle==3` (Triangles); `showWhen` can only test one uniform, so gate these on `{ uniform: 'u_facetStyle', equals: 3 }` (they already sit under the mode via facetStyle being hidden outside Faceted — hiding facetStyle does not hide these, so choosing the facetStyle gate keeps them hidden whenever style≠Triangles, which is the tighter, correct condition).
- **ascii_dither** — `u_blur` → `{ uniform: 'u_underlay', equals: [1, 2, 3] }` (any non-Replace); `u_spacing` → hidden for material shapes `u_shape>=15`: `showWhen` has no `>=`, so enumerate `equals: [0,1,2,...,14]` (all shapes BELOW 15) — read the manifest's `u_shape` options to get the exact in-range value list.
- **blinds** — `u_mode` (Linear 0 / Concentric 1): `u_angle` → `equals: 0`; `u_centerX`, `u_centerY` → `equals: 1`.
- **droste** — `u_mode` (Zoom 0 / Spiral 1 / Tunnel 2): `u_twist` → `equals: 1`.
- **kaleidoscope** — `u_mode` (Wedge 0 / Nested 1 / Square 2 / Hex 3): `u_rotation`, `u_speed` → `{ uniform: 'u_mode', equals: [0,1,3] }` (all but Square).
- **block_glitch** — `u_style` (Random 0 / Horizontal 1 / Wave-Melt 2 / Mixed 3): `u_step` → `{ uniform: 'u_style', equals: [0,1,3] }` (dead in pure Wave-Melt; Mixed keeps it since only one of its three sub-styles is melt).
- **mirror** — `u_mode` (Axis 0 / Quad 1 / Octal 2 / Mirror-ball 3): `u_angle`, `u_speed` → `{ uniform: 'u_mode', equals: [0,1,2] }` (hidden in Mirror-ball — trusting the derivation per the scope decision).

- [ ] **Step 1:** For each effect above, open `shader_effects/<effect>.frag` + the manifest entry; confirm the uniform enum value numbers and that the dependent params exist with those exact `uniform` names. Correct any value-number mismatch.
- [ ] **Step 2:** Add the `showWhen` object to each dependent param in `manifest.json`.
- [ ] **Step 3: Validate the manifest parses** and every `showWhen.uniform` references a real param of the same effect:

```bash
cd /Users/julien/Documents/GitHub/Sailor && python3 -c "
import json
m=json.load(open('shader_effects/manifest.json'))
effs = m if isinstance(m,list) else m.get('effects', m)
items = effs if isinstance(effs,list) else [dict(v,id=k) for k,v in effs.items()]
bad=0
for e in items:
    ids={p['uniform'] for p in e.get('params',[])}
    for p in e.get('params',[]):
        sw=p.get('showWhen')
        if sw and sw['uniform'] not in ids:
            print('BAD', e.get('id'), p['uniform'], '->', sw['uniform']); bad+=1
print('manifest OK' if not bad else f'{bad} dangling showWhen')
"
```

Expected: `manifest OK`.

- [ ] **Step 4: Commit**

```bash
git add shader_effects/manifest.json
git commit -m "feat(shader): gate mode-specific params via showWhen (7 effects incl. mirror)"
```

---

## Task 8: Live verification (both studios)

Prove the gating in the running app, not just in unit tests — per memory `synthetic-pointer-events-prove-nothing` and `graceful-fallback-hides-integration-failure`, run it.

- [ ] **Step 1:** Ensure the dev server is up (`./dev.sh` or existing). Open Shader Studio; pick **crystal_prism**; toggle `u_mode` Glass→Faceted→Prism and confirm the facet controls appear only in Faceted (and `u_facetJitter`/`u_multiScale` only when Facet style = Triangles). Screenshot each state.
- [ ] **Step 2:** Pick **mirror**; set Mode = Mirror-ball; confirm Angle/Speed disappear; set back to Axis; confirm they return. Screenshot.
- [ ] **Step 3:** Open Expressive Studio; pick **boost**; flip `sideMode` across solid/grid/noise/palette and confirm only the relevant colour controls show; flip `doodlesOn` on **sliceGlitch** and confirm the 9 doodle controls appear/disappear. Screenshot.
- [ ] **Step 4:** Pick one shadow-rig effect (**field**); toggle `shadows` off and confirm the four shadow controls vanish. Screenshot.
- [ ] **Step 5:** Report results with screenshots. No commit (verification only).
