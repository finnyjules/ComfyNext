# Space Type — Loft edit-all stops + Circle shape (round 3d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real always-round `Circle` shape and remove the redundant `Capsule` (legacy capsules migrate to full-radius Rectangle), and add "edit all stops at once" master controls to the stops editor.

**Architecture:** `Circle` reuses the unit-circle contour but the effect scales it uniformly (`height=width`) so it's always round. `Capsule` is dropped from the `LoftShape` union / `shapeContour`; `resolveShape` migrates a legacy `capsule` to `rectangle` and `buildScene` forces its corner-radius to 1 to preserve the pill. Edit-all is a `ProfileStopsEditor` block backed by a pure `applyToAllStops` helper (unit-testable).

**Tech Stack:** Nuxt 4, Vue 3.5, TypeScript, three.js, Vitest (node env).

## Global Constraints

- **Frontend cwd:** `frontend/`. Test: `npx vitest run tests/unit/<file>.unit.spec.ts`.
- **`buildScene` stays synchronous**; per-scene state on `root.userData.tex`.
- Shape list (final): `['circle', 'oval', 'rectangle', 'polygon', 'star', 'word']`. `LoftShape = 'circle' | 'oval' | 'rectangle' | 'polygon' | 'star'` (word is handled separately in the effect).
- Circle = the unit-circle contour scaled UNIFORMLY by `width` (height ignored). Legacy `capsule` → `rectangle` with `rectRadius` forced to 1.
- **Commit hygiene — HARDENED (parallel sessions share git index + working tree):** commit via PATHSPEC; `git add` new files first; never `-A`/bare commit/stash. After: `git show HEAD:<file> | grep -c <marker>`.
- Typecheck baseline ~328; the pre-existing `SpaceTypeSurface.vue` `onVibeRevert` (~line 160) error is NOT yours.

## Shared signatures

```ts
// loftStops.ts
export function applyToAllStops<K extends keyof LoftStop>(stops: LoftStop[], key: K, value: LoftStop[K]): LoftStop[]  // returns NEW array, every stop[key]=value
// loftGeometry.ts
export type LoftShape = 'circle' | 'oval' | 'rectangle' | 'polygon' | 'star'   // capsule removed, circle added
```

---

### Task 1: Circle shape + drop Capsule (geometry + effect + migration)

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (`LoftShape`, `shapeContour`)
- Modify: `frontend/app/lib/spacetype/effects/loft.ts` (shape control, `resolveShape`, `buildScene`)
- Test: `frontend/tests/unit/spacetype-loft-shape.unit.spec.ts`, `frontend/tests/unit/spacetype-loft-effect.unit.spec.ts`

**Interfaces:** `LoftShape` drops `'capsule'`, adds `'circle'`. `shapeContour('circle', …, P)` = the unit circle (same as `'oval'`). `resolveShape` returns `'circle'` for `shape:'circle'`, and migrates legacy `shape:'capsule'` → `'rectangle'`. `buildScene` scales circle uniformly and forces legacy-capsule `rectRadius=1`.

- [ ] **Step 1: Update the shape tests (RED)**

In `spacetype-loft-shape.unit.spec.ts`: change the "every shape returns exactly points" loop from `['oval','capsule','rectangle','polygon','star']` to `['circle','oval','rectangle','polygon','star']`. Add:
```ts
it('circle is a unit circle (all radii ~1), same as oval', () => {
  const P = 48
  const c = shapeContour('circle', { rectRadius: 0.5, polySides: 5, starDepth: 0.5 }, P)
  for (const p of c) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 3)
})
```
In `spacetype-loft-effect.unit.spec.ts`, add:
```ts
it('resolveShape: circle passes through; legacy capsule migrates to rectangle', () => {
  expect(resolveShape({ shape: 'circle' } as any)).toBe('circle')
  expect(resolveShape({ shape: 'capsule' } as any)).toBe('rectangle')
})
it('shape=circle builds drawable geometry (uniform round cross-section)', () => {
  const p = defaultFromControls(); (p as any).shape = 'circle'
  const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
  let drawable = 0; root.traverse((o: any) => { if (o.isMesh) drawable++ })
  expect(drawable).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/spacetype-loft-shape.unit.spec.ts tests/unit/spacetype-loft-effect.unit.spec.ts` → FAIL (circle unsupported; capsule still valid).

- [ ] **Step 3: `loftGeometry.ts`** — in the `LoftShape` union change `'capsule'` → `'circle'` (final: `'circle' | 'oval' | 'rectangle' | 'polygon' | 'star'`). In `shapeContour`'s switch, REMOVE the `case 'capsule':` line and ADD `case 'circle':` sharing the oval body — the cleanest is:
```ts
    case 'circle':
    case 'oval': {
      const out: Vec2[] = []
      for (let i = 0; i < points; i++) { const a = (i / points) * Math.PI * 2; out.push({ x: Math.cos(a), y: Math.sin(a) }) }
      return out
    }
```
(delete the old separate `case 'oval'` and the `case 'capsule': return resampleContour(roundedRectPath(1), points)` line.)

- [ ] **Step 4: `loft.ts` control + migration.**
  - `shape` control `options`: `['circle', 'oval', 'rectangle', 'polygon', 'star', 'word']`, `default: 'oval'` (keep oval default). 
  - `resolveShape`: update the valid-options list to include `'circle'` and NOT `'capsule'`, and add capsule migration. Final:
    ```ts
    export function resolveShape(params: Params): LoftShape | 'word' {
      const s = String(params.shape ?? '')
      if (s === 'capsule') return 'rectangle'                      // legacy migrate
      if (['circle', 'oval', 'rectangle', 'polygon', 'star', 'word'].includes(s)) return s as LoftShape | 'word'
      const pk = String(params.profileKind ?? '')
      return pk === 'word' ? 'word' : 'oval'
    }
    ```
  - In `buildScene`: compute the effective corner radius + uniform-circle props. Where `shape`/`baseContours`/`props` are set:
    ```ts
    const rawShape = String(params.shape ?? '')
    const shape = resolveShape(params)
    const rectRadius = rawShape === 'capsule' ? 1 : n(params, 'rectRadius')   // legacy capsule → full radius
    // ...
    // props: circle scales uniformly (height := width) so it stays perfectly round
    const props = stations.map(st => {
      const p = interpStopProps(flatStops, st.t)
      return shape === 'circle' ? { ...p, height: p.width } : p
    })
    // baseContours (non-word): use `rectRadius` (not n(params,'rectRadius')) so migrated capsules render as a pill
    ```
    Adapt to the exact current `buildScene` structure — the key changes are: (1) `props` uniform for circle, (2) `rectRadius` uses the legacy-capsule override in the `shapeContour({ rectRadius, polySides: shape==='star'?starSides:polySides, starDepth }, …)` call.

- [ ] **Step 5: Run, verify pass** (shape + effect specs green). Update any OTHER loft test that constructs `shapeContour('capsule', …)` — grep `capsule` under `frontend/tests/unit/spacetype-loft-*` and replace with `'circle'` or `'oval'` as appropriate (there should be few/none).

- [ ] **Step 6: Typecheck + commit.** `npx vue-tsc --noEmit 2>&1 | grep -E 'effects/loft|loftGeometry|LoftShape|capsule' || echo clean`.
  ```bash
  git commit frontend/app/lib/spacetype/loftGeometry.ts frontend/app/lib/spacetype/effects/loft.ts frontend/tests/unit/spacetype-loft-shape.unit.spec.ts frontend/tests/unit/spacetype-loft-effect.unit.spec.ts -m "feat(spacetype): loft — add Circle shape (always round), drop Capsule (migrate to rectangle)"
  ```
  Verify: `git show HEAD:frontend/app/lib/spacetype/effects/loft.ts | grep -c "'circle'"` (>0) and `grep -c "'capsule'"` should be small (only the migration line).

---

### Task 2: Edit-all master controls

**Files:**
- Modify: `frontend/app/lib/spacetype/loftStops.ts` (`applyToAllStops`)
- Modify: `frontend/app/components/vue-canvas/ProfileStopsEditor.vue` (the "All stops" block)
- Test: `frontend/tests/unit/spacetype-loft-stops.unit.spec.ts` (append)

**Interfaces:** `applyToAllStops(stops, key, value)` returns a NEW array with every stop's `key` set to `value` (pure — used by the editor's master controls).

- [ ] **Step 1: Add the failing test**

```ts
// append to spacetype-loft-stops.unit.spec.ts
import { applyToAllStops } from '../../app/lib/spacetype/loftStops'
describe('applyToAllStops', () => {
  it('sets one field on every stop, leaving others (and identity) intact', () => {
    const stops = parseStops('garbage')   // DEFAULT_STOPS clone
    const out = applyToAllStops(stops, 'width', 2.5)
    expect(out.every(s => s.width === 2.5)).toBe(true)
    expect(out.map(s => s.id)).toEqual(stops.map(s => s.id))   // ids preserved
    expect(out).not.toBe(stops)                                 // new array
    expect(stops.every(s => s.width === 2.5)).toBe(false)       // input not mutated (unless it already was)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/spacetype-loft-stops.unit.spec.ts` → FAIL (not exported).

- [ ] **Step 3: Implement `applyToAllStops` in `loftStops.ts`**
```ts
export function applyToAllStops<K extends keyof LoftStop>(stops: LoftStop[], key: K, value: LoftStop[K]): LoftStop[] {
  return stops.map(s => ({ ...s, [key]: value }))
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Wire the "All stops" block into `ProfileStopsEditor.vue`.** Import `applyToAllStops`. Add a `setAll` that replaces the working array and commits:
```ts
import { applyToAllStops, parseStops, serializeStops, presetStops, type LoftStop } from '~/lib/spacetype/loftStops'
// ...
function setAll<K extends keyof LoftStop>(k: K, v: LoftStop[K]) {
  const next = applyToAllStops(stops, k, v)
  stops.splice(0, stops.length, ...next)
  commit()
}
```
Add a block below the selected-stop inspector (after its closing `</div>`):
```vue
<div class="flex flex-col gap-1 rounded border border-white/10 p-2">
  <div class="text-[9px] uppercase tracking-[0.1em] text-white/35">Set all stops</div>
  <label class="flex items-center justify-between text-[10px] text-white/50">Width
    <input type="range" min="0.05" max="6" step="0.05" @input="(e) => setAll('width', Number((e.target as HTMLInputElement).value))" /></label>
  <label class="flex items-center justify-between text-[10px] text-white/50">Height
    <input type="range" min="0.05" max="6" step="0.05" @input="(e) => setAll('height', Number((e.target as HTMLInputElement).value))" /></label>
  <label class="flex items-center justify-between text-[10px] text-white/50">Roll
    <input type="range" min="-180" max="180" step="1" @input="(e) => setAll('roll', Number((e.target as HTMLInputElement).value))" /></label>
  <StudioColor :model-value="selected?.color ?? '#ffffff'" @update:model-value="(v: string) => setAll('color', v)" />
</div>
```
(The master sliders are write-only actions — no bound value, they stamp on input. The master colour reuses `StudioColor`, seeded from the selected stop, and writes to all.)

- [ ] **Step 6: Verify (automated) + commit.** Typecheck: `npx vue-tsc --noEmit 2>&1 | grep -E 'ProfileStops|applyToAllStops' || echo clean`. `npx vitest run tests/unit/spacetype-loft-stops.unit.spec.ts` green.
  ```bash
  git commit frontend/app/lib/spacetype/loftStops.ts frontend/app/components/vue-canvas/ProfileStopsEditor.vue frontend/tests/unit/spacetype-loft-stops.unit.spec.ts -m "feat(spacetype): loft — 'set all stops' master Width/Height/Roll/Colour controls"
  ```
  Verify: `git show HEAD:frontend/app/components/vue-canvas/ProfileStopsEditor.vue | grep -c "Set all stops"` (>0).

---

### Task 3: Full-suite green + runtime proof + docs

**Files:** none (verification) + `docs/STATE.md`.

- [ ] **Step 1: Full loft suite** — `npx vitest run tests/unit/spacetype-loft-*.unit.spec.ts` — no NEW failures.
- [ ] **Step 2: Typecheck** — `npx vue-tsc --noEmit 2>&1 | grep -iE 'effects/loft|loftGeometry|loftStops|ProfileStops' || echo clean`.
- [ ] **Step 3: Runtime proof (controller; needs this session's OWN dev server — the running one is another chat's).** Loft: (a) Shape picker shows **Circle** (not Capsule); Circle renders perfectly round even with non-square Width/Height; a legacy saved capsule loft still renders as a pill. (b) In the stops editor, dragging a **"Set all stops"** master slider changes every stop at once. Screenshots + no console errors.
- [ ] **Step 4: Update `docs/STATE.md`** — extend the Loft entry: Circle shape (always round) replaces Capsule; edit-all master stop controls. Pathspec commit.

---

## Self-review

**Spec coverage:** A edit-all → Task 2 (`applyToAllStops` + editor block). B circle+drop-capsule → Task 1 (`shapeContour`/`LoftShape`, control options, `resolveShape` migration, `buildScene` uniform-scale + legacy `rectRadius=1`). Runtime + docs → Task 3. ✓

**Placeholder scan:** Task 1 Step 4's "adapt to the exact current `buildScene` structure" is a match-the-code instruction with the two exact changes named (uniform `props` for circle; `rectRadius` legacy override). No TBDs; all code shown.

**Type consistency:** `LoftShape` (Task 1) = `'circle'|'oval'|'rectangle'|'polygon'|'star'` used by `resolveShape`/`shapeContour`. `applyToAllStops(stops,key,value)` (Task 2) name/generics match the editor call. `resolveShape` capsule→rectangle + circle passthrough consistent between the geometry union and the effect list.

**Ordering guard:** Task 1 (shape) and Task 2 (edit-all) are independent — either order is green. Task 1 updates the shape/effect tests in the same commit as the type change (no window where capsule is half-removed). Task 2 is additive (`applyToAllStops` new; editor block new). Each task ends green.
