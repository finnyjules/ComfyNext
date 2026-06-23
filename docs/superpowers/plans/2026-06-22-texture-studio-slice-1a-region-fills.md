# Texture Studio — Slice 1a (Region fills: data model + solid/gradient) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every region/role the engine draws independently fillable with a **solid color or gradient** (cell-local or tile-global frame), via a per-role fill data model + a generic shader `evalFill`, replacing the flat Color section with a Fills panel — backward compatible (roles default to today's colors).

**Architecture:** A `roles.ts` declares each family's ordered roles + the legacy-color→default-fill mapping. A `fills.ts` holds the `Fill` types, defaults, and pure helpers (tested). The renderer gains `evalFill(role, cellCoord, tileCoord)` — solid inline, 2-stop gradient inline (linear/radial, periodic tile-global ramp) — and every family's role site routes through it via per-role uniforms. The surface's Color section becomes a Fills panel (per-role Solid/Gradient pickers + frame; Image/Pattern tabs visible-but-disabled, for 1b/1c).

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-region-fills-design.md`.

## Global Constraints
- Seamless output for every fill × frame (cell-local repeats; tile-global gradient uses a mirrored/periodic ramp).
- Backward compatible: with no `params.fills`, output is byte-identical to today (roles default to `colorA/colorB/background`).
- No `git add -A` (unrelated working-tree files exist) — stage explicit paths.
- 1a gradients are **2-stop** (start→end); 3–4 stops are a Phase-1 follow-up (panel shows 2 in 1a).
- No backticks / non-ASCII in GLSL comments inside the shader template literal (it breaks the JS string).

---

## File structure (1a)
- Create `frontend/app/lib/texturefx/roles.ts` — `ROLES_BY_FAMILY` + `rolesFor(params)` + `legacyFill(roleIndex, params)`.
- Create `frontend/app/lib/texturefx/fills.ts` — `Fill`/`SolidFill`/`GradientFill` types, `defaultFill`, `fillForRole(params, family, roleIndex)`, and pure helpers `gradientRampCoord(frame, fc, tc, angle, kind)` + `packFillUniforms(fills)`.
- Modify `frontend/app/lib/texturefx/renderer.ts` — `evalFill` GLSL + route family role sites through it + per-role fill uniforms.
- Modify `frontend/app/lib/texturefx/types.ts` — `TextureParams` widened with `fills?: FillsByRole`; `FILL_TYPES`, `FILL_FRAMES`, `GRADIENT_KINDS` tuples.
- Modify `frontend/app/lib/texturefx/sections.ts` — add `'Fills'`.
- Modify `frontend/app/components/vue-canvas/TextureStudioSurface.vue` — Fills panel (replaces Color section).
- Test: `frontend/tests/unit/texturefx-fills.unit.spec.ts`.

**Role index convention (all families): role 0 = primary ink, 1 = secondary, 2 = ground/gap.**
| family | role 0 | role 1 | role 2 |
|---|---|---|---|
| checker | a | b | — |
| stripes | ink | ink2 | — |
| dots | dot | ground | — |
| grid | line | ground | — |
| arcs | stroke | ground | — |
| diagonal | sideA | sideB | — |
| weave | warp | weft | gap |
| multiscale | arc | ground | — |

Legacy default mapping: role0→`colorA`, role1→ (`colorB` for checker/stripes/diagonal/weave-weft; `background` for dots/grid/arcs/multiscale ground), role2→`background`. (Encoded in `legacyFill` per family so today's look is preserved.)

---

## Task 1: Data model + pure helpers (`roles.ts`, `fills.ts`)

**Files:** Create `roles.ts`, `fills.ts`; Modify `types.ts`; Test `tests/unit/texturefx-fills.unit.spec.ts`.

**Interfaces — Produces:**
- `types.ts`: `FILL_TYPES = ['solid','gradient','image','pattern']`, `FILL_FRAMES = ['cell','tile']`, `GRADIENT_KINDS = ['linear','radial']`; `type Fill`, `FillsByRole = Record<string, Fill>`.
- `roles.ts`: `ROLES_BY_FAMILY: Record<string,string[]>`; `rolesFor(p): string[]` (roles for the active mode/motif/tileFamily); `legacyFill(p, roleKey, roleIndex): Fill` (solid from legacy colors).
- `fills.ts`: `defaultFill(): Fill`; `fillForRole(p, roleKey, roleIndex): Fill` (params.fills[roleKey] ?? legacyFill); `gradientRampCoord(...)`, `solidRgb`, etc.

- [ ] **Step 1: types.ts** — append:
```typescript
export const FILL_TYPES = ['solid', 'gradient', 'image', 'pattern'] as const
export const FILL_FRAMES = ['cell', 'tile'] as const
export const GRADIENT_KINDS = ['linear', 'radial'] as const
export type FillType = typeof FILL_TYPES[number]
export type Frame = typeof FILL_FRAMES[number]
export type GradientStop = { c: string; p: number }
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; frame: Frame; kind: 'linear' | 'radial'; angle: number; stops: GradientStop[] }
  | { type: 'image'; frame: Frame; src: string; seam: string; scale: number }
  | { type: 'pattern'; frame: Frame; sub: Record<string, unknown> }
export type FillsByRole = Record<string, Fill>
```
Also change `cloneParams`'s home type / add `export type TextureParams = Params & { fills?: FillsByRole }` if a `TextureParams` alias is wanted (the surface/renderer can read `(p as any).fills` or via this alias).

- [ ] **Step 2: roles.ts**:
```typescript
import type { Params } from '~/lib/spacetype/effect'
import type { Fill } from '~/lib/texturefx/types'

// Ordered roles per family. role 0 = primary ink, 1 = secondary, 2 = ground/gap.
export const ROLES_BY_FAMILY: Record<string, string[]> = {
  checker: ['a', 'b'], stripes: ['ink', 'ink2'], dots: ['dot', 'ground'], grid: ['line', 'ground'],
  arcs: ['stroke', 'ground'], diagonal: ['sideA', 'sideB'], weave: ['warp', 'weft', 'gap'], multiscale: ['arc', 'ground'],
}

// Which family is active given the params (procedural motif, truchet tileFamily, …).
export function activeFamily(p: Params): string {
  if (String(p.mode) === 'truchet') return String(p.tileFamily)
  if (String(p.mode) === 'procedural') return String(p.motif)
  return 'checker' // raster mode has no roles; harmless default
}
export function rolesFor(p: Params): string[] {
  return ROLES_BY_FAMILY[activeFamily(p)] ?? ['a', 'b']
}

// Legacy color a role index maps to, so existing tiles look identical pre-customization.
const GROUND_IS_BG = new Set(['dots', 'grid', 'arcs', 'multiscale'])
export function legacyColor(p: Params, family: string, roleIndex: number): string {
  if (roleIndex === 0) return String(p.colorA ?? '#e8eef5')
  if (roleIndex === 2) return String(p.background ?? '#0e1116')
  // roleIndex 1
  return GROUND_IS_BG.has(family) ? String(p.background ?? '#0e1116') : String(p.colorB ?? '#7aa2f7')
}
export function legacyFill(p: Params, family: string, roleIndex: number): Fill {
  return { type: 'solid', color: legacyColor(p, family, roleIndex) }
}
```

- [ ] **Step 3: fills.ts**:
```typescript
import type { Params } from '~/lib/spacetype/effect'
import type { Fill, FillsByRole } from '~/lib/texturefx/types'
import { activeFamily, legacyFill } from '~/lib/texturefx/roles'

export function defaultFill(color = '#7aa2f7'): Fill { return { type: 'solid', color } }

// Resolve a role's fill: explicit params.fills entry, else the legacy-color solid.
export function fillForRole(p: Params, roleKey: string, roleIndex: number): Fill {
  const fills = (p as any).fills as FillsByRole | undefined
  const f = fills?.[roleKey]
  return f ?? legacyFill(p, activeFamily(p), roleIndex)
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Tile-global linear gradient coord is a MIRRORED ramp (0→1→0) so opposite tile
// edges match → seamless. Cell-local is a plain ramp in cell coords. Returns 0..1.
export function gradientRampCoord(frame: string, fcx: number, fcy: number, ux: number, uy: number, angleDeg: number): number {
  const a = (angleDeg * Math.PI) / 180
  const dx = Math.cos(a), dy = Math.sin(a)
  if (frame === 'tile') {
    const t = ux * dx + uy * dy        // projection across the tile
    return 1 - Math.abs(2 * (t - Math.floor(t)) - 1) // mirrored triangle ramp → seamless
  }
  const t = fcx * dx + fcy * dy
  return Math.min(1, Math.max(0, t))   // cell-local plain ramp
}
```

- [ ] **Step 4: Write the failing test** `tests/unit/texturefx-fills.unit.spec.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { fillForRole, gradientRampCoord, hexToRgb } from '~/lib/texturefx/fills'
import { rolesFor, ROLES_BY_FAMILY, legacyColor } from '~/lib/texturefx/roles'

describe('roles', () => {
  it('declares roles for every family', () => {
    for (const fam of ['checker','stripes','dots','grid','arcs','diagonal','weave','multiscale']) {
      expect(ROLES_BY_FAMILY[fam].length).toBeGreaterThanOrEqual(2)
    }
  })
  it('rolesFor follows mode (procedural→motif, truchet→tileFamily)', () => {
    expect(rolesFor({ mode: 'procedural', motif: 'weave' } as any).length).toBe(2) // motif weave doesn't exist → fallback ['a','b']
    expect(rolesFor({ mode: 'truchet', tileFamily: 'weave' } as any)).toEqual(['warp','weft','gap'])
  })
  it('legacy mapping: dots ground = background, checker role1 = colorB', () => {
    const p = { colorA:'#111111', colorB:'#222222', background:'#333333' } as any
    expect(legacyColor(p,'dots',1)).toBe('#333333')
    expect(legacyColor(p,'checker',1)).toBe('#222222')
  })
})

describe('fillForRole back-compat', () => {
  it('falls back to a legacy solid when no fills set', () => {
    const p = { mode:'truchet', tileFamily:'arcs', colorA:'#abcdef', background:'#000000' } as any
    expect(fillForRole(p,'stroke',0)).toEqual({ type:'solid', color:'#abcdef' })
    expect(fillForRole(p,'ground',1)).toEqual({ type:'solid', color:'#000000' })
  })
  it('uses an explicit fill when present', () => {
    const p = { mode:'truchet', tileFamily:'arcs', fills:{ stroke:{type:'gradient',frame:'cell',kind:'linear',angle:0,stops:[{c:'#fff',p:0},{c:'#000',p:1}]} } } as any
    expect(fillForRole(p,'stroke',0).type).toBe('gradient')
  })
})

describe('gradientRampCoord seamlessness', () => {
  it('tile-global ramp matches opposite edges (mirrored)', () => {
    for (let i=0;i<=10;i++){ const t=i/10
      expect(Math.abs(gradientRampCoord('tile',0,0,0,t,0) - gradientRampCoord('tile',0,0,1,t,0))).toBeLessThan(1e-9)
      expect(Math.abs(gradientRampCoord('tile',0,0,t,0,90) - gradientRampCoord('tile',0,0,t,1,90))).toBeLessThan(1e-9)
    }
  })
  it('returns 0..1', () => { expect(gradientRampCoord('tile',0,0,0.3,0.7,45)).toBeGreaterThanOrEqual(0) })
})
```

- [ ] **Step 5: Run** — `cd frontend && npx vitest run tests/unit/texturefx-fills.unit.spec.ts` → after implementing, all pass. (Run before to see it fail on missing modules.)

- [ ] **Step 6: Commit** — `git add frontend/app/lib/texturefx/roles.ts frontend/app/lib/texturefx/fills.ts frontend/app/lib/texturefx/types.ts frontend/tests/unit/texturefx-fills.unit.spec.ts && git commit -m "feat(texture-studio): region-fill data model (roles + fills + seamless gradient ramp)"`

---

## Task 2: Shader `evalFill` + route family roles through it

**Files:** Modify `renderer.ts`.

**Interfaces — Consumes:** `fillForRole`, `hexToRgb`, `gradientRampCoord`, `rolesFor` from Task 1.

Per-role fill uniforms (≤3 roles): `u_fillType[3]` (0 solid,1 gradient), `u_fillFrame[3]` (0 cell,1 tile), `u_fillKind[3]` (0 linear,1 radial), `u_fillAngle[3]`, `u_fillC0[3]`, `u_fillC1[3]` (gradient stop colors / solid uses C0). (1a = 2-stop gradient.)

- [ ] **Step 1: Add uniforms + `evalFill` to the fragment shader** (near the other helpers; plain-ASCII comments only):
```glsl
uniform int u_fillType[3];
uniform int u_fillFrame[3];
uniform int u_fillKind[3];
uniform float u_fillAngle[3];
uniform vec3 u_fillC0[3];
uniform vec3 u_fillC1[3];

// Evaluate role r's fill at cell-local fc and tile coord tc. Solid + 2-stop
// gradient (linear/radial). Tile-global linear uses a mirrored ramp (seamless).
vec3 evalFill(int r, vec2 fc, vec2 tc){
  if (u_fillType[r] == 0) return u_fillC0[r];                 // solid
  float g;
  if (u_fillKind[r] == 1) {                                   // radial (from cell/tile center)
    vec2 p = (u_fillFrame[r]==1) ? tc : fc;
    g = clamp(length(p - vec2(0.5)) * 2.0, 0.0, 1.0);
  } else {                                                    // linear
    float a = radians(u_fillAngle[r]);
    vec2 d = vec2(cos(a), sin(a));
    if (u_fillFrame[r]==1) { float t = dot(tc, d); g = 1.0 - abs(2.0*fract(t) - 1.0); }
    else { g = clamp(dot(fc, d), 0.0, 1.0); }
  }
  return mix(u_fillC0[r], u_fillC1[r], g);
}
```
(`fract`/`clamp`/`radians` are GLSL built-ins. The tile-global mirrored ramp matches `gradientRampCoord('tile',…)` from Task 1.)

- [ ] **Step 2: Route every family role-site through `evalFill`.** Replace the role color expressions. `F0 = evalFill(0, vec2(fx,fy), v_uv)`, `F1 = evalFill(1, …)`, `F2 = evalFill(2, …)`. Concretely:
  - Procedural block: compute `vec3 F0=evalFill(0,vec2(fx,fy),v_uv), F1=evalFill(1,...), F2=evalFill(2,...);` then jitter swap picks role order: `vec3 ink = (swap>0.5)?F1:F0; vec3 ink2 = (swap>0.5)?F0:F1;` checker `ink/ink2`; stripes `(fx<u_scale)?ink:ink2`; dots `mix(F2, ink, cov)` (ground=role2→F2 to preserve dots' bg=background mapping… NOTE: per the role table dots ground = role 1; so use F1 for dots/grid/arcs/multiscale ground). Use **F1** for ground in dots/grid; **F0** for the ink. So dots `mix(F1, F0, cov)`, grid `(fx<u_lw||fy<u_lw)?F0:F1`. (Jitter swap applies to checker/stripes only, where it currently swaps ink/ink2; keep that behavior with F0/F1.)
  - Truchet arcs: `arcCov(...) ? evalFill(0,...) : evalFill(1,...)` (stroke=0, ground=1).
  - diagonal: `side ? evalFill(0,...) : evalFill(1,...)`.
  - weave: warp→`evalFill(0,...)`, weft→`evalFill(1,...)`, gap→`evalFill(2,...)`.
  - multiscale: `arcCov(...) ? evalFill(0,...) : evalFill(1,...)`.
  (Keep `u_a/u_b/u_bg` uniforms for now ONLY if still referenced; otherwise remove. The legacy colors now flow in through the per-role fill uniforms.)

- [ ] **Step 3: Set the per-role fill uniforms in `render()`** — import `fillForRole`, `hexToRgb` from `~/lib/texturefx/fills` and `rolesFor` from `~/lib/texturefx/roles`. Replace the `u_a/u_b/u_bg` upload with:
```typescript
    const roles = rolesFor(p)
    for (let r = 0; r < 3; r++) {
      const fill = r < roles.length ? fillForRole(p, roles[r], r) : { type: 'solid', color: '#000000' } as const
      const loc = (n: string) => gl.getUniformLocation(this.prog!, `${n}[${r}]`)
      if (fill.type === 'gradient') {
        gl.uniform1i(loc('u_fillType'), 1)
        gl.uniform1i(loc('u_fillFrame'), fill.frame === 'tile' ? 1 : 0)
        gl.uniform1i(loc('u_fillKind'), fill.kind === 'radial' ? 1 : 0)
        gl.uniform1f(loc('u_fillAngle'), Number(fill.angle) || 0)
        gl.uniform3fv(loc('u_fillC0'), hex(String(fill.stops?.[0]?.c ?? '#ffffff')))
        gl.uniform3fv(loc('u_fillC1'), hex(String(fill.stops?.[fill.stops.length - 1]?.c ?? '#000000')))
      } else { // solid (image/pattern resolve to solid in 1a — handled in 1b/1c)
        gl.uniform1i(loc('u_fillType'), 0)
        gl.uniform3fv(loc('u_fillC0'), hex(String((fill as any).color ?? '#000000')))
      }
    }
```
(Reuse the existing `hex()` helper in renderer.ts. For 1a, image/pattern fills resolve to their solid fallback color — or skip until 1b/1c; the panel's Image/Pattern tabs are disabled in 1a so this won't occur.)

- [ ] **Step 4: Typecheck** — `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep texturefx/renderer || echo clean`.

- [ ] **Step 5: Commit** — `git add frontend/app/lib/texturefx/renderer.ts && git commit -m "feat(texture-studio): per-role evalFill (solid + gradient) routed through all families"`

> **Back-compat check (do before commit):** with no `params.fills`, every role resolves to its legacy solid color → the render must look identical to before. Verify visually in Task 4.

---

## Task 3: Fills panel UI (replace the Color section)

**Files:** Modify `sections.ts` (add `'Fills'`, remove/keep `'Color'`), `TextureStudioSurface.vue`.

**Interfaces — Consumes:** `rolesFor`, `fillForRole`, `defaultFill` from Tasks 1.

- [ ] **Step 1: sections.ts** — replace `'Color'` with `'Fills'` in `TEXTURE_SECTIONS` (keep the rest/order): `['Lattice','Cell','Content','Truchet','Raster','Stylize','Fills','Output']`. Remove the `colorA/colorB/background` controls' `group: 'Color'` entries from `controls.ts` (the colors are now defaults consumed by `legacyFill`; keep the keys + defaults in `textureDefaults` so back-compat mapping still reads them — i.e., keep them in `TEXTURE_CONTROLS` but with a `when: () => false` so they persist defaults without rendering, OR move their defaults into `textureDefaults` directly). Simplest: give the 3 color controls `when: () => false` so they stay in defaults/params but never render.

- [ ] **Step 2: Surface — add a `Fills` panel** rendered from `rolesFor(params)`. For each role, a collapsible block with: a type segmented control (Solid / Gradient / Image(disabled) / Pattern(disabled)); for solid → a `StudioColor`; for gradient → kind (linear/radial) `StudioSegmented`, angle `StudioSlider`, two stop `StudioColor`s, and a Cell/Tile `StudioSegmented`. Reads/writes `params.fills[roleKey]`. Helper to mutate a fill:
```typescript
import { rolesFor, activeFamily } from '~/lib/texturefx/roles'
import { fillForRole } from '~/lib/texturefx/fills'
import type { Fill } from '~/lib/texturefx/types'

function roleFill(roleKey: string, i: number): Fill { return fillForRole(params, roleKey, i) }
function setFill(roleKey: string, fill: Fill) {
  if (!(params as any).fills) (params as any).fills = {}
  ;(params as any).fills[roleKey] = fill
  onParam()
}
function setFillType(roleKey: string, i: number, type: 'solid'|'gradient') {
  const cur = roleFill(roleKey, i)
  if (type === 'solid') setFill(roleKey, { type:'solid', color: cur.type==='solid' ? cur.color : (cur as any).stops?.[0]?.c ?? '#7aa2f7' })
  else setFill(roleKey, { type:'gradient', frame:'cell', kind:'linear', angle:0, stops:[{c:'#e8eef5',p:0},{c:'#7aa2f7',p:1}] })
}
```
Template (in the `#controls` slot, a new section after the others; gate to non-raster modes since raster has no roles):
```vue
<StudioSection v-if="params.mode !== 'raster'" title="Fills">
  <div v-for="(rk, i) in rolesFor(params)" :key="rk" class="mb-2">
    <label class="mb-1 block text-[11px] uppercase tracking-wide text-white/55">{{ rk }}</label>
    <StudioSegmented :model-value="roleFill(rk,i).type"
      :options="['solid','gradient']"
      @update:model-value="(t:any)=>setFillType(rk,i,t)" />
    <template v-if="roleFill(rk,i).type==='solid'">
      <StudioColor class="mt-1" :model-value="(roleFill(rk,i) as any).color"
        @update:model-value="(c:string)=>setFill(rk,{type:'solid',color:c})" />
    </template>
    <template v-else>
      <!-- gradient controls: kind, angle, 2 stops, frame — each calls setFill with an updated copy -->
      ...kind StudioSegmented (linear/radial)...
      ...angle StudioSlider 0..360...
      ...two StudioColor for stops[0].c / stops[1].c...
      ...frame StudioSegmented (cell/tile)...
    </template>
  </div>
</StudioSection>
```
(Write the gradient sub-controls fully in the implementation — each reads `roleFill(rk,i)` and writes back a full updated `Fill` via `setFill`. Keep Image/Pattern out of the type options for 1a, or include them disabled with a "coming soon" affordance.)

- [ ] **Step 3: Typecheck + suite** — `npx vue-tsc --noEmit ... | grep TextureStudioSurface || echo clean`; `npm run test:unit 2>&1 | tail -3`.

- [ ] **Step 4: Commit** — `git add frontend/app/lib/texturefx/sections.ts frontend/app/lib/texturefx/controls.ts frontend/app/components/vue-canvas/TextureStudioSurface.vue && git commit -m "feat(texture-studio): Fills panel (per-role solid/gradient) replacing Color section"`

---

## Task 4: Visual verification + sign-off
> Controller-driven. Confirm: (a) **back-compat** — with no fills, every family looks identical to before; (b) per-role **solid** fills recolor each region; (c) per-role **gradient** fills render, cell-local repeats per cell, tile-global spans the tile; (d) **seamless** 2×2 for gradient cell + tile.
- [ ] Temp harness rendering a few families with: default (back-compat) vs a per-role gradient (cell + tile), each 2×2. Screenshot; confirm back-compat identical, gradients render + tile seamlessly.
- [ ] Present, self-sign-off if clean. Remove harness, `npm run test:unit`, final whole-slice review, update memory.

---

## Self-review (completed)
- **Spec coverage (1a scope):** data model (roles + fills + back-compat) ✓; solid + gradient fills with cell/tile frame ✓; Fills panel ✓; seamless (cell repeat + tile mirrored ramp, unit-tested) ✓. Image (1b) + nested-pattern (1c) + 3–4 stops explicitly deferred.
- **Placeholders:** the gradient sub-controls template is described with its exact data contract (`roleFill`/`setFill` + full `Fill` writes); implementer writes the StudioColor/Segmented/Slider rows against that contract. All pure logic + shader + uniform code is complete.
- **Type consistency:** `Fill` union + `rolesFor`/`fillForRole`/`legacyFill`/`gradientRampCoord` names consistent across Tasks 1–3; role index convention (0 ink,1 secondary/ground,2 ground/gap) consistent between `roles.ts`, the shader routing, and `render()` uniform upload; the shader's tile-global mirrored ramp matches `gradientRampCoord('tile',…)`.
- **Back-compat:** `legacyFill` reproduces today's colorA/B/bg per family; no-fills render is identical (verified Task 4).
