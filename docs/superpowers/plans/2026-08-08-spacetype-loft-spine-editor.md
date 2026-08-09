# Space Type — Loft bezier spine editor + angled caps (round 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the loft an on-preview bezier spine editor (drag points + tangent handles to aim the ends) and an angled-end-caps control, staged as: bezier model → angled caps → the overlay UI.

**Architecture:** Stops gain optional bezier tangent fields (`ta`/`hlf`/`hlb`/`manual`); `sampleSpine` becomes a cubic bezier through the stops (auto-smoothed handles reproduce the old look). `capAngle` shears the end caps. `LoftSpineEditor.vue` (modeled on `StringPathEditor.vue`) is an SVG overlay on the preview editing x/y + tangents; the loft studio adds an "Edit spine" mode that renders it head-on. Depth/other stop fields stay in the inspector.

**Tech Stack:** Nuxt 4, Vue 3.5, TypeScript, three.js, Vitest (node env).

## Global Constraints

- **Frontend cwd:** `frontend/`. Test: `npx vitest run tests/unit/<file>.unit.spec.ts`.
- **Bezier works in EDITOR space** then maps to world: `worldFromEditor(x,y,z) = { x:(x-0.5)*8, y:(0.5-y)*8, z:z*4 }` (this matches the existing `stopToWorld`). Handles (`ta` angle, `hlf`/`hlb` lengths) are in editor x/y space (y-down, 0..1). 2-D-first: handles have no z component; z rides along via the segment endpoints (smooth ease).
- **Auto-smooth reproduces the old curve:** legacy stops (no tangent fields) are auto-smoothed at sample time so existing lofts render ~identically. `sampleSpine`'s frame/endpoint/closed-wrap behaviour is unchanged — only the position curve changes.
- **`buildScene` stays synchronous**; per-scene state on `root.userData.tex`.
- **Commit hygiene — HARDENED (parallel sessions share git index + working tree):** commit via PATHSPEC; `git add` new files first; never `-A`/bare commit/stash. After: `git show HEAD:<file> | grep -c <marker>`.
- Typecheck baseline ~328; pre-existing `SpaceTypeSurface.vue` `onVibeRevert` (~line 160) error is NOT yours.
- **Part 3 (overlay UI) has no unit test** — it's a drag editor; the user live-verifies it. Build it faithfully to `StringPathEditor.vue`.

## Shared signatures

```ts
// loftStops.ts
export interface LoftStop { id: string; x: number; y: number; z: number; width: number; height: number; roll: number; color: string;
  ta?: number; hlf?: number; hlb?: number; manual?: boolean }   // + optional bezier tangent
export function autoSmoothStops(stops: LoftStop[]): LoftStop[]   // derive ta/hlf/hlb for non-manual stops
// loftGeometry.ts — sampleSpine unchanged signature, bezier internally; builders' opts gain: capAngle?: number
```

---

### Task 1: Stop tangent data + `autoSmoothStops`

**Files:**
- Modify: `frontend/app/lib/spacetype/loftStops.ts`
- Test: `frontend/tests/unit/spacetype-loft-stops.unit.spec.ts` (append)

**Interfaces:** `LoftStop` gains optional `ta`/`hlf`/`hlb`/`manual`. `sanitizeStop` copies them through when present (coerced), omits when absent. `autoSmoothStops(stops)` returns a NEW array where every stop with `manual !== true` gets `ta`/`hlf`/`hlb` derived from its neighbours; `manual` stops keep their handles.

- [ ] **Step 1: Write the failing test**

```ts
// append to spacetype-loft-stops.unit.spec.ts
import { autoSmoothStops } from '../../app/lib/spacetype/loftStops'
describe('autoSmoothStops', () => {
  const S = (x: number, y: number, extra: any = {}) => ({ id: `s${x}${y}`, x, y, z: 0, width: 1, height: 1, roll: 0, color: '#fff', ...extra })
  it('derives ta/hlf/hlb for auto stops from neighbours', () => {
    const out = autoSmoothStops([S(0, 0.5), S(0.5, 0.5), S(1, 0.5)])
    // middle stop's tangent points along +x (neighbours are horizontal) → ta ≈ 0
    expect(Math.abs(Math.sin(out[1]!.ta!))).toBeLessThan(0.1)
    expect(out[1]!.hlf!).toBeGreaterThan(0)
    expect(out[1]!.hlb!).toBeGreaterThan(0)
  })
  it('leaves manual stops untouched', () => {
    const manual = S(0.5, 0.5, { manual: true, ta: 1.2345, hlf: 0.4, hlb: 0.4 })
    const out = autoSmoothStops([S(0, 0.5), manual, S(1, 0.5)])
    expect(out[1]!.ta).toBe(1.2345); expect(out[1]!.hlf).toBe(0.4)
  })
  it('returns a new array; endpoints get handles too (from their single neighbour)', () => {
    const stops = [S(0, 0.2), S(1, 0.8)]
    const out = autoSmoothStops(stops)
    expect(out).not.toBe(stops)
    expect(out[0]!.ta).toBeDefined(); expect(out[1]!.ta).toBeDefined()
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/spacetype-loft-stops.unit.spec.ts` → FAIL.

- [ ] **Step 3: Implement in `loftStops.ts`.** Add the optional fields to the `LoftStop` interface. In `sanitizeStop`, after the existing fields, conditionally carry tangents:
```ts
  // inside the returned object, add (only when present so legacy stops stay clean):
  ...(raw?.ta !== undefined ? { ta: num(raw.ta, 0) } : {}),
  ...(raw?.hlf !== undefined ? { hlf: num(raw.hlf, 0) } : {}),
  ...(raw?.hlb !== undefined ? { hlb: num(raw.hlb, 0) } : {}),
  ...(raw?.manual ? { manual: true } : {}),
```
Add:
```ts
/** Derive smooth bezier tangents (angle + handle lengths, in x/y editor space) for every
 *  non-manual stop from its neighbours — a Catmull-Rom-equivalent auto-smooth. Manual stops keep
 *  their handles. Returns a new array. */
export function autoSmoothStops(stops: LoftStop[]): LoftStop[] {
  const n = stops.length
  return stops.map((s, i) => {
    if (s.manual) return { ...s }
    const prev = stops[(i - 1 + n) % n]!, next = stops[(i + 1) % n]!
    const p = i === 0 ? s : prev, q = i === n - 1 ? s : next
    const dx = q.x - p.x, dy = q.y - p.y
    const ta = Math.atan2(dy, dx)
    const dPrev = Math.hypot(s.x - prev.x, s.y - prev.y)
    const dNext = Math.hypot(next.x - s.x, next.y - s.y)
    const hlf = (i === n - 1 ? dPrev : dNext) / 3
    const hlb = (i === 0 ? dNext : dPrev) / 3
    return { ...s, ta, hlf, hlb }
  })
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** (pathspec). Verify `git show HEAD:frontend/app/lib/spacetype/loftStops.ts | grep -c autoSmoothStops` (>0).

---

### Task 2: Bezier `sampleSpine`

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (`sampleSpine` internals)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (append)

**Interfaces:** `sampleSpine(stops, closed, count)` — same signature. Internally: auto-smooth non-manual stops, build the piecewise cubic bezier in editor space (`P1 = stop[i] + handle`, `P2 = stop[i+1] - handle`, z rides via endpoints), map samples to world, keep the parallel-transport frame. Existing frame/endpoint tests must still pass.

- [ ] **Step 1: Add failing tests** (append):

```ts
import { autoSmoothStops } from '../../app/lib/spacetype/loftStops'
describe('sampleSpine bezier', () => {
  const S = (x:number,y:number,extra:any={}) => ({ id:`s${x}${y}`, x, y, z:0, width:1, height:1, roll:0, color:'#fff', ...extra })
  it('still yields orthonormal unit frames + endpoints t=0/1 (bezier)', () => {
    const st = sampleSpine([S(0,0.5), S(0.5,0.2), S(1,0.5)] as any, false, 20)
    for (const s of st) { expect(Math.hypot(s.normal.x,s.normal.y,s.normal.z)).toBeCloseTo(1,3); expect(Math.hypot(s.binormal.x,s.binormal.y,s.binormal.z)).toBeCloseTo(1,3) }
    expect(st[0]!.t).toBeCloseTo(0); expect(st[19]!.t).toBeCloseTo(1)
  })
  it('a manual tangent handle bends the curve vs the auto version', () => {
    const base = [S(0,0.5), S(0.5,0.5), S(1,0.5)]
    const bent = [S(0,0.5), S(0.5,0.5,{ manual:true, ta: Math.PI/2, hlf:0.4, hlb:0.4 }), S(1,0.5)]
    const a = sampleSpine(base as any, false, 40)[20]!.pos
    const b = sampleSpine(bent as any, false, 40)[20]!.pos
    expect(Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z)).toBeGreaterThan(0.1)   // the manual handle moved the curve
  })
  it('legacy stops (no tangents) sample without throwing', () => {
    expect(() => sampleSpine([S(0,0.2), S(1,0.8)] as any, false, 10)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run, verify fail** (manual-handle test fails — curve is still Catmull-Rom, ignores handles).

- [ ] **Step 3: Rewrite `sampleSpine`'s curve.** Replace the Catmull-Rom `sampleCurve`/`catmullRom` usage with a cubic-bezier sampler. Keep `stopToWorld` for the frame math but build the curve from bezier control points in editor space. Concretely:
```ts
import { autoSmoothStops, type LoftStop } from './loftStops'

interface Ed { x: number; y: number; z: number }
function bez(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3
}
// control points for editor-space cubic bezier segment i→j using the stops' handles
function segEditor(s: LoftStop, e: LoftStop): { p1: Ed; p2: Ed } {
  const taS = s.ta ?? 0, hlfS = s.hlf ?? 0
  const taE = e.ta ?? 0, hlbE = e.hlb ?? 0
  return {
    p1: { x: s.x + Math.cos(taS)*hlfS, y: s.y + Math.sin(taS)*hlfS, z: s.z },
    p2: { x: e.x - Math.cos(taE)*hlbE, y: e.y - Math.sin(taE)*hlbE, z: e.z },
  }
}
```
Then `sampleSpine`:
1. `const sm = autoSmoothStops(stops)` (fills handles for auto stops; manual kept).
2. Build a `posAtU(u)` that maps overall `u∈[0,1]` across `seg = closed ? n : n-1` segments to a bezier point in editor space, then `worldFromEditor`. `worldFromEditor(x,y,z) = { x:(x-0.5)*8, y:(0.5-y)*8, z:z*4 }`.
3. Keep the existing station loop (parallel-transport frame from `pos`/`ahead`), just source `pos`/`ahead` from `posAtU` instead of the old `sampleCurve`. Endpoint/closed/frame logic unchanged.
Delete the now-unused `catmullRom`/`sampleCurve` if nothing else calls them (grep first).

- [ ] **Step 4: Run, verify pass** — the bezier tests + all existing geometry/spine tests (frames, endpoints, coincident-stop guard, counts, caps, ribbons, aAcross) still green. If a spine test asserts an exact interior position, adjust it to the bezier value (do NOT loosen frame/endpoint invariants).

- [ ] **Step 5: Commit** (pathspec). Verify `git show HEAD:frontend/app/lib/spacetype/loftGeometry.ts | grep -c "function bez"` (>0).

---

### Task 3: Angled end caps (`capAngle`)

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (cap emission), `frontend/app/lib/spacetype/effects/loft.ts` (control)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (append)

**Interfaces:** both builders' opts gain `capAngle?: number` (degrees, default 0). When capping (fill), the OUTER end caps (continuous: stations 0 & K-1; sliced: the first band's first ring + last band's last ring) shear: each cap vertex offsets along the station tangent by `tan(capAngle) * (vertex's projection onto the cap's shear axis)`. `capAngle=0` = today's caps unchanged.

- [ ] **Step 1: Add failing tests** (append) — assert a non-zero `capAngle` moves the outer-end cap vertices along the tangent (vs `capAngle=0`), while `capAngle=0` is byte-identical to no-capAngle. (Model on the existing cap tests; compare a cap vertex's position between `capAngle:0` and `capAngle:45`.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** In the cap-emission blocks (from round 3a), when `capAngle` is set and the cap is an OUTER end (continuous stations `[0,K-1]`; sliced: only band 0 ring 0 and band E-1 ring 1), offset each cap vertex (both the centroid and the ring vertices it fans to are already placed — shear the CENTROID and use the existing ring vertices, OR shift the cap by adding `tShift = Math.tan(capAngle*π/180) * (localAcrossCoord)` along the unit tangent). Simplest correct approach: shear the CAP CONTOUR before placement — but the ring vertices are shared with the wall. To avoid moving shared wall vertices, only the CENTROID moves is insufficient for a visible shear. So: emit the cap as its OWN ring copy (duplicate the P ring vertices for the cap, sheared) + centroid, rather than fanning to the shared wall vertices. Add `capAngle` handling: for each outer-end cap, append `P` sheared ring vertices + 1 centroid, and fan among the appended vertices. Shear: vertex at contour point `v` → its placed position + `tan(capAngle) * (v · shearAxis) * tangent`, where `shearAxis` = the binormal (or normal). Keep `capAngle=0` → zero shear → identical to fanning the shared vertices (assert byte-identical counts/positions for 0).
  (Adapt exact indices to the committed cap code; the KEY behaviours the tests assert: capAngle≠0 shifts outer-cap vertices along the tangent; capAngle=0 unchanged.)

- [ ] **Step 4: Add the control + pass it.** `loft.ts`: `{ key: 'capAngle', label: 'End cap angle', kind: 'slider', min: -80, max: 80, step: 1, default: 0, group: 'Style', showIf: { key: 'render', equals: 'fill' } }`. Pass `capAngle: n(params,'capAngle')` into both builder calls.

- [ ] **Step 5: Run, verify pass; commit** (pathspec: loftGeometry.ts, loft.ts, the geometry test). Verify `git show HEAD:frontend/app/lib/spacetype/effects/loft.ts | grep -c capAngle` (>0).

---

### Task 4: `LoftSpineEditor.vue` overlay component

**Files:**
- Create: `frontend/app/components/vue-canvas/LoftSpineEditor.vue`

**Interfaces:** props `{ modelValue: string; canvas: HTMLCanvasElement | null }`, emit `update:modelValue` (serialized stops JSON) — mirrors `StringPathEditor.vue`. Edits stops' `x,y` + tangents (`ta`/`hlf`/`hlb`, sets `manual:true` on drag); passes through `z`/width/height/roll/color unchanged.

- [ ] **Step 1: Read the template.** Read `frontend/app/components/vue-canvas/StringPathEditor.vue` fully — reuse its canvas-rect tracking, pointer→normalized mapping, point/handle drag, auto/manual mode, and add/remove. Also read `~/lib/spacetype/stringPath.ts` for the handle-drag math (`forwardHandle`/`backHandle`/`autoSmooth`) — adapt the equivalents against `LoftStop` (`ta`/`hlf`/`hlb`).

- [ ] **Step 2: Build the component.** An SVG overlay tracking the `canvas` prop's on-screen rect. Parse `modelValue` with `parseStops`; draw the spine as a cubic bezier through the stops' `x,y`; render each stop as a draggable node + two tangent-handle squares (position = point ± handle along `ta`). Drag a node → update `x,y` (re-`autoSmoothStops` the non-manual neighbours). Drag a handle → set that stop's `ta`/`hlf`/`hlb` + `manual:true`. Add-on-empty-click / delete-selected reuse the stop add/remove pattern. On every edit, `emit('update:modelValue', serializeStops(stops))`. Guard the inbound `watch(modelValue)` against self-echo (serialize-equality), exactly like `ProfileStopsEditor`/`StringPathEditor`.

- [ ] **Step 3: Typecheck** — `npx vue-tsc --noEmit 2>&1 | grep -E 'LoftSpineEditor' || echo clean`. (No unit test — drag UI.)

- [ ] **Step 4: Commit** (pathspec: `git add` the new file first). Verify `git show HEAD:frontend/app/components/vue-canvas/LoftSpineEditor.vue | grep -c "update:modelValue"` (>0).

---

### Task 5: "Edit spine" mode + head-on view in the studio

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`

**Interfaces:** Consumes `LoftSpineEditor.vue`. Adds an "Edit spine" toggle (loft only) that renders the overlay over the preview and forces head-on rendering while active.

- [ ] **Step 1: Add the toggle + overlay.** Import `LoftSpineEditor`. Add a reactive `spineEditActive = ref(false)` and an "Edit spine" button shown only when `effect.value.id === 'loft'`. When active, render `<LoftSpineEditor :model-value="String(params.stops)" :canvas="<preview canvas ref>" @update:model-value="(v) => { params.stops = v }" />` over the preview (same `params.stops` the `profileStops` control binds — edits round-trip through the same rebuild path). Find how `StringPathEditor` is mounted/positioned over the canvas (line ~1639) and mirror it.

- [ ] **Step 2: Head-on override.** While `spineEditActive`, force the preview head-on so screen = the spine's x/y plane: temporarily render with `rotateX=rotateY=rotateZ=0` (override the params the engine reads per-frame in `renderFrameAt`, or set a transient scene rotation of 0). Restore the real transform on exit. Keep it minimal — the goal is that dragging in the overlay maps 1:1 to stop x/y.

- [ ] **Step 3: Typecheck + verify existing spacetype tests unaffected.** `npx vue-tsc --noEmit 2>&1 | grep -E 'SpaceTypeSurface|LoftSpineEditor|spineEdit' || echo clean`; `npx vitest run tests/unit/spacetype-*.unit.spec.ts` (no new failures; count vs baseline).

- [ ] **Step 4: Commit** (pathspec). Verify `git show HEAD:frontend/app/components/vue-canvas/SpaceTypeSurface.vue | grep -c "Edit spine"` (>0).

---

### Task 6: Full-suite green + runtime proof + docs

**Files:** none (verification) + `docs/STATE.md`.

- [ ] **Step 1: Full loft + spacetype suite** — `npx vitest run tests/unit/spacetype-loft-*.unit.spec.ts` then a broad `spacetype-*` run — no NEW failures.
- [ ] **Step 2: Typecheck** — `npx vue-tsc --noEmit 2>&1 | grep -iE 'loft|Spine|capAngle|autoSmooth' || echo clean`.
- [ ] **Step 3: Runtime proof — USER-DRIVEN (this session can't reach the running dev server).** Report to the controller a precise checklist for the user to verify live: (a) "Edit spine" toggles a head-on overlay; (b) dragging a spine node moves that stop; (c) grabbing a point's tangent handle swings the curve there and aims the end; (d) `capAngle` tilts the tube's end caps; (e) existing lofts look unchanged until a handle is dragged. Parts 1–2 (model/caps) are proven by unit tests; Part 3 (overlay) is the user's live check.
- [ ] **Step 4: Update `docs/STATE.md`** — extend the Loft entry: bezier spine (auto-smooth default, manual tangent handles), on-preview `LoftSpineEditor` + head-on edit mode, `capAngle` end caps. Note the overlay's live-verification is user-owned. Pathspec commit.

---

## Self-review

**Spec coverage:** Part 1 model → Tasks 1 (`autoSmoothStops`) + 2 (bezier `sampleSpine`). Part 2 caps → Task 3 (`capAngle`). Part 3 overlay → Tasks 4 (`LoftSpineEditor`) + 5 (edit mode + head-on). Verify/docs → Task 6. ✓

**Placeholder scan:** Tasks 3–5 contain "adapt to the committed cap code / read StringPathEditor / find how it's mounted" — these are match-the-existing-code instructions naming the exact reference (`StringPathEditor.vue`, its mount site ~line 1639, `stringPath.ts`) and the exact behaviours the tests/user check. The pure Tasks 1–2 have complete code. Task 3's geometry has the KEY assertions named (capAngle≠0 shifts outer-cap verts; 0 unchanged); the implementer adapts the index detail to the committed cap block, as in prior rounds.

**Type consistency:** `LoftStop` tangent fields (`ta`/`hlf`/`hlb`/`manual`) + `autoSmoothStops` (Task 1) are consumed by `sampleSpine` (Task 2) and `LoftSpineEditor` (Task 4). `capAngle` opt (Task 3) name matches the control + builder calls. `worldFromEditor`/`stopToWorld` scale (×8 / ×4) is stated once and reused.

**Ordering guard:** Task 1 (tangent fields) is additive — optional fields, legacy stops unaffected. Task 2 switches `sampleSpine` to bezier but auto-smooth makes legacy curves ~identical (frame/endpoint tests hold). Task 3 (caps) is additive (default 0 = unchanged). Tasks 4–5 (UI) are additive (new component + new toggle). Each task ends green; the overlay's interaction is the only user-verified surface.
