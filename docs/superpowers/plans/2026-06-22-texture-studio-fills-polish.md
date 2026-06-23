# Texture Studio — Phase-1 Fills Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Polish the per-region fill system with per-fill opacity (→ tile background), 3–4 gradient stops, share-a-fill-across-roles (link), and modal UX niceties — all backward compatible.

**Architecture:** P1 adds a per-role opacity uniform and a single final `mix(u_bg, col, opacity)` in `evalFill`. P2 replaces the 2-stop gradient (`u_fillC0/C1`) with up-to-4-stop arrays + a `gradColor(r,g)` walk. P3 adds a `link` Fill variant resolved in `fillForRole` (JS, cycle-guarded) so the renderer is unchanged. P4 is surface-only (collapsible roles, live swatch, reset) + the `Color`→`Fills` cleanup.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, WebGL2 GLSL, Vitest. Spec: `docs/superpowers/specs/2026-06-22-texture-studio-fills-polish-design.md`. Builds on Slices 1a/1b/1c.

## Global Constraints
- Backward compatible: missing `opacity`⇒1; 2-stop gradient renders identically; no-fills unchanged.
- Seamless preserved: opacity & multi-stop operate on the per-role color / periodic ramp `g` — the tile integer-wave-number snap stays.
- Dynamic indexing: vec3/float uniform ARRAYS may be indexed by a variable in GLSL ES 3.00 (only SAMPLER arrays may not). `u_fillStops[r*4+k]` in a loop is legal.
- NO backtick/non-ASCII in GLSL comments (template literal). NEVER `git add -A` — explicit paths. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Fill-type codes stay: solid=0, gradient=1, image=2, pattern=3. New `link` is resolved in JS (never reaches the shader).

---

## Task P1: Per-fill opacity → tile background

**Files:** Modify `types.ts`, `renderer.ts`, `TextureStudioSurface.vue`. Test `texturefx-fills.unit.spec.ts`.

**Interfaces — Produces:** `opacity?: number` on every Fill; `u_fillOpacity[3]`; an Opacity slider per fill block.

- [ ] **Step 1: types.ts** — add `opacity?: number` to each `Fill` union member (solid/gradient/image/pattern). (Keep optional; default applied at read.)
- [ ] **Step 2: renderer.ts shader** — add `uniform float u_fillOpacity[3];`. Refactor `evalFill` so every branch computes a `vec3 col` and there is a SINGLE final `return mix(u_bg, col, clamp(u_fillOpacity[r], 0.0, 1.0));`. Concretely: solid `col = u_fillC0[r];`, image/pattern `col = sampleFillSeam(...)`, gradient `col = mix(u_fillC0[r], u_fillC1[r], g);` (P2 changes this line) — then the final mix. (Plain-ASCII comments.)
- [ ] **Step 3: renderer.ts render()** — in the per-role loop, set `gl.uniform1f(loc('u_fillOpacity'), Number((fill as any).opacity ?? 1))` for every role (default 1; the gray-fallback path can leave it 1).
- [ ] **Step 4: surface** — add an **Opacity** StudioSlider (min 0 max 1 step 0.01) to EACH fill block (solid/gradient/image/pattern), `:model-value="(roleFill(rk,i) as any).opacity ?? 1"`, `@update` → `setFill(rk, { ...(roleFill(rk,i) as any), opacity: v })`. (A tiny helper `function setFillOpacity(rk,i,v){ setFill(rk,{...(roleFill(rk,i) as any), opacity:v}) }` keeps it DRY.)
- [ ] **Step 5: test** — `texturefx-fills.unit.spec.ts`: assert a fill without `opacity` is treated as 1 (if a pure helper reads it; otherwise this is a renderer concern — add a trivial test that `fillForRole` round-trips `opacity` when set and that absence is undefined). Keep minimal.
- [ ] **Step 6: verify** — `npx vue-tsc … | grep -E 'texturefx/(renderer|types)|TextureStudioSurface' || echo clean`; `npx vitest run tests/unit/texturefx-fills.unit.spec.ts` pass.
- [ ] **Step 7: commit** — `git add frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/renderer.ts frontend/app/components/vue-canvas/TextureStudioSurface.vue frontend/tests/unit/texturefx-fills.unit.spec.ts` → `feat(texture-studio): per-fill opacity blended toward tile background`.

---

## Task P2: 3–4 gradient stops

**Files:** Modify `renderer.ts`, `TextureStudioSurface.vue`, `fills.ts` (pure helper), `texturefx-fills.unit.spec.ts`.

**Interfaces — Produces:** `gradColorAt(stops, g)` (pure, tested); shader `u_fillStopCount/Stops/StopPos` + `gradColor`; multi-stop gradient UI.

- [ ] **Step 1: fills.ts pure helper** (source-of-truth mirrored by the GLSL):
```ts
// Interpolate a multi-stop gradient at ramp position g in [0,1]. stops sorted by p.
export function gradColorAt(stops: { c: string; p: number }[], g: number): [number, number, number] {
  if (!stops.length) return [0, 0, 0]
  if (stops.length === 1) return hexToRgb(stops[0]!.c)
  const s = [...stops].sort((a, b) => a.p - b.p)
  const gg = Math.min(s[s.length - 1]!.p, Math.max(s[0]!.p, g))
  for (let k = 0; k < s.length - 1; k++) {
    const a = s[k]!, b = s[k + 1]!
    if (gg >= a.p && gg <= b.p) {
      const t = b.p === a.p ? 0 : (gg - a.p) / (b.p - a.p)
      const ca = hexToRgb(a.c), cb = hexToRgb(b.c)
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]
    }
  }
  return hexToRgb(s[s.length - 1]!.c)
}
```
- [ ] **Step 2: write the failing test** — `texturefx-fills.unit.spec.ts`:
```ts
import { gradColorAt } from '~/lib/texturefx/fills'
describe('gradColorAt', () => {
  it('2-stop linear matches endpoints + midpoint', () => {
    const s = [{c:'#000000',p:0},{c:'#ffffff',p:1}]
    expect(gradColorAt(s,0)).toEqual([0,0,0])
    expect(gradColorAt(s,1)).toEqual([1,1,1])
    const m = gradColorAt(s,0.5); expect(m[0]).toBeCloseTo(0.5,5)
  })
  it('4-stop picks the right segment', () => {
    const s = [{c:'#000000',p:0},{c:'#ff0000',p:0.33},{c:'#00ff00',p:0.66},{c:'#ffffff',p:1}]
    const r = gradColorAt(s,0.33); expect(r[0]).toBeCloseTo(1,5); expect(r[1]).toBeCloseTo(0,5)
  })
  it('clamps g outside the stop range', () => {
    const s = [{c:'#112233',p:0.2},{c:'#445566',p:0.8}]
    expect(gradColorAt(s,0)).toEqual(gradColorAt(s,0.2))
  })
})
```
Run → fails (missing export). Implement step 1 → passes.
- [ ] **Step 3: renderer.ts shader** — add `uniform int u_fillStopCount[3]; uniform vec3 u_fillStops[12]; uniform float u_fillStopPos[12];`. Add:
```glsl
vec3 gradColor(int r, float g){
  int base = r * 4;
  int n = u_fillStopCount[r];
  if (n < 2) return u_fillStops[base];
  float lo = u_fillStopPos[base];
  float hi = u_fillStopPos[base + n - 1];
  float gg = clamp(g, lo, hi);
  for (int k = 0; k < 3; k++){
    if (k >= n - 1) break;
    float pa = u_fillStopPos[base + k];
    float pb = u_fillStopPos[base + k + 1];
    if (gg >= pa && gg <= pb){
      float t = (pb > pa) ? (gg - pa) / (pb - pa) : 0.0;
      return mix(u_fillStops[base + k], u_fillStops[base + k + 1], t);
    }
  }
  return u_fillStops[base + n - 1];
}
```
Change evalFill's gradient `col` to `col = gradColor(r, g);` (g computed as today). (`u_fillC0/C1` remain for solid; gradient now uses the stops arrays.)
- [ ] **Step 4: renderer.ts render()** — for gradient fills, upload `gl.uniform1i(loc('u_fillStopCount'), Math.min(4, Math.max(2, stops.length)))` and for each k in 0..count-1: `gl.uniform3fv(loc2('u_fillStops', r*4+k), hexToRgb(stops[k].c)); gl.uniform1f(loc2('u_fillStopPos', r*4+k), stops[k].p)` where `loc2(n,idx)=getUniformLocation(prog, n+'['+idx+']')`. For non-gradient roles set `u_fillStopCount[r]=0`. (Drop the old C0/C1 gradient upload; keep solid's C0.)
- [ ] **Step 5: surface multi-stop UI** — replace the fixed 2 stop colors with a `v-for` over `(roleFill(rk,i) as any).stops`: each stop a StudioColor + a position StudioSlider (0–1, step 0.01), with a **Remove** button (when stops.length>2) and an **Add stop** button below (when <4) that inserts a stop at the midpoint and re-sorts. Helper `setStops(rk,i,stops)` writes a complete gradient Fill with the (sorted) stops via setGradient. Keep angle/kind/frame as-is.
- [ ] **Step 6: verify** — vue-tsc clean (renderer+surface); `npx vitest run tests/unit/texturefx-fills.unit.spec.ts` pass.
- [ ] **Step 7: commit** — `git add frontend/app/lib/texturefx/renderer.ts frontend/app/lib/texturefx/fills.ts frontend/app/components/vue-canvas/TextureStudioSurface.vue frontend/tests/unit/texturefx-fills.unit.spec.ts` → `feat(texture-studio): 3-4 stop gradients (gradColor walk + stops UI)`.
- [ ] **Step 8: visual sign-off (controller)** — harness: a 3-stop and a 4-stop gradient (cell + tile) → confirm multi-color + seamless 2x2.

---

## Task P3: Share a fill across roles (link)

**Files:** Modify `types.ts`, `fills.ts`, `TextureStudioSurface.vue`, `texturefx-fills.unit.spec.ts`.

**Interfaces — Produces:** `{type:'link', to:string}` variant; cycle-guarded resolution in `fillForRole`.

- [ ] **Step 1: types.ts** — add `| { type: 'link'; to: string }` to the `Fill` union.
- [ ] **Step 2: write the failing test** — `texturefx-fills.unit.spec.ts`:
```ts
describe('link resolution', () => {
  const base = { mode:'truchet', tileFamily:'weave' } as any // roles warp/weft/gap
  it('resolves a single hop to the target fill', () => {
    const p = { ...base, fills:{ warp:{type:'solid',color:'#abcdef'}, weft:{type:'link',to:'warp'} } } as any
    expect(fillForRole(p,'weft',1)).toEqual({type:'solid',color:'#abcdef'})
  })
  it('cycle falls back to legacy solid', () => {
    const p = { ...base, colorA:'#111111', colorB:'#222222',
      fills:{ warp:{type:'link',to:'weft'}, weft:{type:'link',to:'warp'} } } as any
    expect(fillForRole(p,'warp',0).type).toBe('solid') // legacy, not a link
  })
  it('self-link and missing target fall back to legacy', () => {
    const p = { ...base, fills:{ warp:{type:'link',to:'warp'}, weft:{type:'link',to:'nope'} } } as any
    expect(fillForRole(p,'warp',0).type).toBe('solid')
    expect(fillForRole(p,'weft',1).type).toBe('solid')
  })
})
```
- [ ] **Step 3: fills.ts** — make `fillForRole` resolve links. Map role KEYS to indices via `rolesFor(p)` so the target's `legacyFill` uses the right index:
```ts
export function fillForRole(p: Params, roleKey: string, roleIndex: number, _seen: Set<string> = new Set()): Fill {
  const fills = (p as any).fills as FillsByRole | undefined
  const f = fills?.[roleKey]
  if (!f) return legacyFill(p, activeFamily(p), roleIndex)
  if (f.type === 'link') {
    const to = (f as any).to as string
    const roles = rolesFor(p)
    const ti = roles.indexOf(to)
    if (to === roleKey || ti < 0 || _seen.has(roleKey)) return legacyFill(p, activeFamily(p), roleIndex)
    _seen.add(roleKey)
    return fillForRole(p, to, ti, _seen)
  }
  return f
}
```
(import `rolesFor` from `~/lib/texturefx/roles`.) Run the test → passes.
- [ ] **Step 4: surface link UI** — add `'link'` to the type picker options. `setFillType('link')` seeds `{type:'link', to:<first role key != rk>}` (from `rolesFor(params)`). Add a `<template v-else-if="...type==='link'">` block: a single StudioSelect of `rolesFor(params).filter(r=>r!==rk)`, value `(roleFill...).to`, `@update` → `setFill(rk,{type:'link', to})`. Hide all other controls for a link.
- [ ] **Step 5: verify** — vue-tsc clean; `npx vitest run tests/unit/texturefx-fills.unit.spec.ts` pass; also run `texturefx-controls` to be safe.
- [ ] **Step 6: commit** — `git add frontend/app/lib/texturefx/types.ts frontend/app/lib/texturefx/fills.ts frontend/app/components/vue-canvas/TextureStudioSurface.vue frontend/tests/unit/texturefx-fills.unit.spec.ts` → `feat(texture-studio): share a fill across roles (link variant, cycle-guarded)`.

---

## Task P4: Modal UX niceties + cleanup

**Files:** Modify `TextureStudioSurface.vue`, `sections.ts`, `controls.ts`, `fills.ts`, `texturefx-controls.unit.spec.ts`.

- [ ] **Step 1: collapsible roles** — a reactive `expandedRoles = reactive(new Set<string>())` (or a `ref<Record<string,boolean>>`); default all expanded. Each role header is a clickable row toggling membership; the body (`v-show="isExpanded(rk)"`) holds the existing type picker + controls.
- [ ] **Step 2: live swatch** — a small swatch element in each role header reflecting the resolved fill: solid → `:style="{background: color}"`; gradient → `:style="{background: 'linear-gradient(' + angle + 'deg,' + stops.map(s=>s.c+' '+(s.p*100)+'%').join(',') + ')'}"`; image → `<img :src="rasterViewUrl(src)">` (import `rasterViewUrl` from `~/lib/texturefx/raster`); pattern → a small glyph (e.g. a CSS checker or a label "▦"); link → resolve via `roleFill` (already returns the target's fill) and render that fill's swatch. A `roleSwatchStyle(rk,i)` computed/helper keeps the template clean.
- [ ] **Step 3: reset-to-default** — a small control per role header: `function resetFill(rk){ const f=(params as any).fills; if (f) { delete f[rk]; onParam() } }`.
- [ ] **Step 4: cleanup** — (a) remove the unused `defaultFill` export from `fills.ts` (confirm no importers first: `grep -rn defaultFill frontend/app`); (b) in `sections.ts` replace `'Color'` with `'Fills'` in `TEXTURE_SECTIONS`; in `controls.ts` change the `colorA/colorB/background` controls' `group` from `'Color'` to `'Fills'` (keep `when:()=>false`); update `texturefx-controls.unit.spec.ts` if it asserts the `'Color'` group/section.
- [ ] **Step 5: verify** — `npx vue-tsc … | grep -E 'TextureStudioSurface|texturefx/' || echo clean`; `npx vitest run tests/unit/texturefx-controls.unit.spec.ts tests/unit/texturefx-fills.unit.spec.ts` pass; full `npx vitest run` green.
- [ ] **Step 6: commit** — `git add frontend/app/components/vue-canvas/TextureStudioSurface.vue frontend/app/lib/texturefx/sections.ts frontend/app/lib/texturefx/controls.ts frontend/app/lib/texturefx/fills.ts frontend/tests/unit/texturefx-controls.unit.spec.ts` → `feat(texture-studio): Fills panel UX (collapsible roles, swatches, reset) + Color->Fills cleanup`.
- [ ] **Step 7: visual sign-off (controller)** — confirm the engine still renders (opacity + multi-stop + a link config) in a harness; the collapsible/swatch/reset UX is for in-app sign-off.

---

## Self-review
- **Spec coverage:** opacity (P1) ✓; 3–4 stops (P2) ✓; link (P3) ✓; modal UX + cleanup (P4) ✓. Blend-modes & >4 stops explicitly deferred.
- **Placeholders:** pure helper (`gradColorAt`), `fillForRole` link resolution, the `gradColor` GLSL, and the opacity mix are complete; UI tasks give exact data contracts (complete-Fill write-back via setFill/setGradient).
- **Type consistency:** `opacity?` on all variants; `link` variant + `fillForRole(p,key,idx,_seen)` signature consistent P3↔P4 swatch; `gradColorAt` shared by test + (mirrored) GLSL `gradColor`; stop arrays indexed `r*4+k` consistently in shader + upload.
- **Back-compat:** opacity default 1, 2-stop == old mix, link resolves to legacy on any failure, no-fills unchanged.
- **Seamless:** opacity constant; multi-stop over periodic `g`; tile snap unchanged.
