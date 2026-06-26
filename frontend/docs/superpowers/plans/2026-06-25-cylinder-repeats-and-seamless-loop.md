# Cylinder Repeats + Seamless Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cylinder "repeats per ring" slider + finer motion speeds, and a general "Seamless loop" video export that renders k loops so fractional speeds still seam.

**Architecture:** Cylinder changes are local to one effect file. The loop feature adds an optional `loopKeys` seam field, a pure `loopMultiplier` helper, an engine `renderFrameAt(t01)` (renders at an arbitrary, possibly >1, loop-time), and an export toggle that renders `k × frameCount` frames at unwrapped `t01`.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Three.js, Vitest.

## Global Constraints

- Cylinder `ringRepeat=1` and `seamlessLoop` off must be byte-identical to today.
- Speeds are on a `0.05` grid; `loopMultiplier` cap = 60, eps = 1e-3 (k ≤ 20 resolves the grid).
- Motions are normalized to the loop (`speed × t01 × 2π`); the loop export keeps the **rate/look** unchanged and only extends the render to `k` loops.
- `renderFrameAt` at an integer `t01` must equal today's `renderFrame` output.
- Run tests from `frontend/`: `npx vitest run <path>`. `vue-tsc --noEmit` has a large pre-existing baseline — only confirm no NEW errors in touched files. Commit on `main`; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Cylinder — repeats-per-ring slider + granular speeds

**Files:**
- Modify: `app/lib/spacetype/effects/cylinder.ts`
- Test: `frontend/tests/unit/spacetype-cylinder-controls.unit.spec.ts` (create)

**Interfaces:**
- Produces: Cylinder gains a `ringRepeat` control; `spinSpeed` step is `0.05`; `waveSpeed` is no longer internally rounded.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-cylinder-controls.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getEffect } from '~/lib/spacetype/effects'

describe('cylinder controls', () => {
  const cyl = getEffect('cylinder')
  const ctrl = (k: string) => cyl.controls.find(c => c.key === k) as any
  it('has a ringRepeat slider (Ribbon group, default 1)', () => {
    const c = ctrl('ringRepeat')
    expect(c).toBeTruthy()
    expect(c.kind).toBe('slider'); expect(c.group).toBe('Ribbon')
    expect(c.min).toBe(1); expect(c.max).toBe(8); expect(c.step).toBe(1); expect(c.default).toBe(1)
  })
  it('spin speed steps by 0.05', () => {
    expect(ctrl('spinSpeed').step).toBe(0.05)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-cylinder-controls.unit.spec.ts`
Expected: FAIL — no `ringRepeat`; spinSpeed step is 0.25.

- [ ] **Step 3: Add the control + change steps + un-round wave**

In `cylinder.ts`:

(a) Change `spinSpeed` step (currently `0.25`):
```ts
  { key: 'spinSpeed', label: 'Spin speed', kind: 'slider', min: -4, max: 4, step: 0.05, default: 0, group: 'Motion' },
```

(b) Add the `ringRepeat` control in the `Ribbon` group (next to `count`):
```ts
  { key: 'ringRepeat', label: 'Repeats per ring', kind: 'slider', min: 1, max: 8, step: 1, default: 1, group: 'Ribbon' },
```

(c) Un-round wave speed — change the line in `update()` (currently `const t = t01 * Math.max(0, Math.round(n(params, 'waveSpeed'))) * twoPi`):
```ts
    const t = t01 * Math.max(0, n(params, 'waveSpeed')) * twoPi
```

- [ ] **Step 4: Tile the text `ringRepeat` times around each ring**

In `buildScene`, locate the ring loop (`for (let i = 0; i < count; i++) { ... }`). Read the repeat just before it:
```ts
    const ringRepeat = Math.max(1, Math.floor(n(params, 'ringRepeat')))
```
Inside the ring loop, replace `const ringNGlyphs = Math.max(1, layout.glyphs.length)` with:
```ts
      const baseN = Math.max(1, layout.glyphs.length)
      const ringNGlyphs = baseN * ringRepeat
```
Wrap the inner glyph loop (`for (let gi = 0; gi < layout.glyphs.length; gi++) { ... }`) in an outer repeat loop, and change the angle line. The glyph-building body (geo/uv/mat/mesh creation, the `registered` texture registration, `root.add(mesh)`) stays exactly as-is; only the wrapping loop and `a0` change:
```ts
      for (let rep = 0; rep < ringRepeat; rep++) {
        for (let gi = 0; gi < layout.glyphs.length; gi++) {
          const g = layout.glyphs[gi]!
          // ...existing geo / uv1 / mat / mesh / registered block UNCHANGED...
          const a0 = ((rep * baseN + gi) / ringNGlyphs) * Math.PI * 2
          root.add(mesh)
          glyphs.push({ mesh, a0, ringY, ring: i, gi, nGlyphs: ringNGlyphs })
        }
      }
```
(`update()` positions each glyph purely from `a0`/`ring`, so the extra copies at extra angles need no other change. Verify `update()` does not use `gi` for angular positioning — it uses `g.a0`.)

- [ ] **Step 5: Run the control test + full cylinder/effect suite**

Run: `cd frontend && npx vitest run tests/unit/spacetype-cylinder-controls.unit.spec.ts tests/unit/spacetype-effect.unit.spec.ts tests/unit/spacetype-livekeys.unit.spec.ts`
Expected: PASS. (The control test now passes; effect/livekeys suites unaffected.)

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "effects/cylinder.ts" || echo "(clean)"`
Expected: `(clean)`.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/spacetype/effects/cylinder.ts frontend/tests/unit/spacetype-cylinder-controls.unit.spec.ts
git commit -m "feat(space-type): Cylinder repeats-per-ring + granular spin/wave speed

ringRepeat tiles the text N times around each ring; spin step 0.25->0.05;
wave speed un-rounded so fractional values work (loopable via the seamless
export). ringRepeat=1 is unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `loopMultiplier` helper

**Files:**
- Create: `app/lib/spacetype/loop.ts`
- Test: `frontend/tests/unit/spacetype-loop.unit.spec.ts`

**Interfaces:**
- Consumes: `Params` from `./effect`.
- Produces: `loopMultiplier(params: Params, loopKeys: string[] | undefined, cap?: number, eps?: number): number`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-loop.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loopMultiplier } from '~/lib/spacetype/loop'

describe('loopMultiplier', () => {
  it('returns 1 when loopKeys is empty/absent', () => {
    expect(loopMultiplier({ s: 1.3 }, [])).toBe(1)
    expect(loopMultiplier({ s: 1.3 }, undefined)).toBe(1)
  })
  it('integer speeds → 1', () => {
    expect(loopMultiplier({ s: 2, t: -3 }, ['s', 't'])).toBe(1)
  })
  it('1.3 → 10 (13 whole cycles)', () => {
    expect(loopMultiplier({ s: 1.3 }, ['s'])).toBe(10)
  })
  it('0.05 → 20', () => {
    expect(loopMultiplier({ s: 0.05 }, ['s'])).toBe(20)
  })
  it('multiple keys → common k', () => {
    // 0.5 needs k=2, 0.25 needs k=4 → common 4
    expect(loopMultiplier({ a: 0.5, b: 0.25 }, ['a', 'b'])).toBe(4)
  })
  it('zero speed contributes nothing', () => {
    expect(loopMultiplier({ a: 0, b: 1.5 }, ['a', 'b'])).toBe(2)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-loop.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `loop.ts`**

Create `app/lib/spacetype/loop.ts`:

```ts
import type { Params } from './effect'

/** Smallest k in [1, cap] such that, for every loopKey, value × k is within eps of a whole number
 *  — so all periodic motions complete whole cycles over k loops (seamless). Empty/absent loopKeys
 *  → 1; if none qualifies (e.g. an irrational speed), returns cap as best effort. */
export function loopMultiplier(params: Params, loopKeys: string[] | undefined, cap = 60, eps = 1e-3): number {
  const speeds = (loopKeys ?? []).map(k => Number(params[k]) || 0).filter(v => Math.abs(v) > eps)
  if (!speeds.length) return 1
  for (let k = 1; k <= cap; k++) {
    if (speeds.every(v => Math.abs(v * k - Math.round(v * k)) < eps)) return k
  }
  return cap
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-loop.unit.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/loop.ts frontend/tests/unit/spacetype-loop.unit.spec.ts
git commit -m "feat(space-type): loopMultiplier helper for seamless-loop export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Engine `renderFrameAt(t01)`

**Files:**
- Modify: `app/lib/spacetype/engine.ts` (`renderFrame`)

**Interfaces:**
- Produces: `renderFrameAt(t01: number, params: Params): void` — renders at a normalized loop-time that may exceed 1 (no wrap). `renderFrame(index, params)` computes `t01` then delegates.

- [ ] **Step 1: Refactor `renderFrame` to extract `renderFrameAt`**

In `engine.ts`, the current `renderFrame` computes `const t01 = (index % this.frameCount) / this.frameCount` then does the scale/rotation/camera/effect.update/render inside a try/catch. Split it: keep the try/catch body in a new `renderFrameAt(t01, params)`, and have `renderFrame` compute the wrapped t01 and call it:

```ts
  /** Render the scene at integer frame index (wraps to one loop). */
  renderFrame(index: number, params: Params): void {
    this.renderFrameAt((index % this.frameCount) / this.frameCount, params)
  }

  /** Render at a normalized loop-time t01 (may exceed 1 — used by the multi-loop seamless export,
   *  where motions must keep their per-loop rate across k loops). At an integer t01 this equals
   *  renderFrame. */
  renderFrameAt(t01: number, params: Params): void {
    try {
      const scale = Number(params.scale ?? 1) || 1
      this.scene.rotation.set(Number(params.rotateX ?? 0), Number(params.rotateY ?? 0), Number(params.rotateZ ?? 0))
      if (this.opts.projection === 'isometric') {
        this.orthoCam.zoom = scale
        this.orthoCam.updateProjectionMatrix()
        this.applyPan(this.orthoCam)
      } else {
        this.perspCam.position.z = 14 / scale
        this.applyPan(this.perspCam)
      }
      this.effect.update(t01, params)
      if (postEnabled(this.post) && this.postChain) this.postChain.render(this.scene, this.activeCam)
      else this.renderer.render(this.scene, this.activeCam)
      this._lastError = null
      this._loggedError = false
    } catch (e) {
      this._lastError = e instanceof Error ? e.message : String(e)
      if (!this._loggedError) { console.error('[space-type] render failed', e); this._loggedError = true }
    }
  }
```

(Copy the exact body of the current `renderFrame` try/catch — the snippet above mirrors the post-hardening version; if the live file differs, preserve its exact statements, only moving them into `renderFrameAt` and parameterizing on `t01`.)

- [ ] **Step 2: Verify parity + no new errors**

Run: `cd frontend && npx vitest run tests/unit/spacetype-bake.unit.spec.ts tests/unit/spacetype-effect.unit.spec.ts && npx vue-tsc --noEmit 2>&1 | grep "spacetype/engine.ts" || echo "(clean)"`
Expected: PASS + `(clean)`. (renderFrame still wraps and behaves identically; renderFrameAt is additive.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/lib/spacetype/engine.ts
git commit -m "feat(space-type): engine.renderFrameAt(t01) for multi-loop rendering

renderFrame now delegates to renderFrameAt, which renders at an arbitrary
(possibly >1) normalized loop-time without wrapping.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `loopKeys` seam + Cylinder loopKeys + "Seamless loop" export

**Files:**
- Modify: `app/lib/spacetype/effect.ts` (`SpaceTypeEffect` interface)
- Modify: `app/lib/spacetype/effects/cylinder.ts` (declare `loopKeys`)
- Modify: `app/components/vue-canvas/SpaceTypeSurface.vue` (toggle + generateVideo)
- Test: `frontend/tests/unit/spacetype-loop.unit.spec.ts` (extend — cylinder loopKeys are real control keys)

**Interfaces:**
- Consumes: `loopMultiplier` (Task 2); `engine.renderFrameAt` (Task 3).
- Produces: `SpaceTypeEffect.loopKeys?: string[]`; Cylinder declares `['waveSpeed','spinSpeed','spinRingOffset']`; a `seamlessLoop` export toggle.

- [ ] **Step 1: Add `loopKeys` to the seam + Cylinder declaration**

In `app/lib/spacetype/effect.ts`, add to the `SpaceTypeEffect` interface (after `liveKeys`):
```ts
  /** Params that are "cycles/turns per loop" — the seamless-loop export renders enough loops that
   *  each completes whole cycles. Omit → the effect exports as a single loop. */
  loopKeys?: string[]
```

In `cylinder.ts`, add to the effect object (next to `liveKeys`):
```ts
  loopKeys: ['waveSpeed', 'spinSpeed', 'spinRingOffset'],
```

- [ ] **Step 2: Add the guard test (cylinder loopKeys are real control keys)**

Append to `frontend/tests/unit/spacetype-loop.unit.spec.ts`:
```ts
import { getEffect } from '~/lib/spacetype/effects'

it('cylinder loopKeys are all real control keys', () => {
  const cyl = getEffect('cylinder')
  const keys = new Set(cyl.controls.map(c => c.key))
  for (const lk of cyl.loopKeys ?? []) expect(keys.has(lk), lk).toBe(true)
})
```
Run: `cd frontend && npx vitest run tests/unit/spacetype-loop.unit.spec.ts` → PASS.

- [ ] **Step 3: Add the export toggle**

In `SpaceTypeSurface.vue` script, add the import and ref:
```ts
import { loopMultiplier } from '~/lib/spacetype/loop'
// ...
const seamlessLoop = ref(false)
```
In the template's **Output** section (near the Duration / FPS controls), add:
```vue
<label data-control class="flex items-center justify-between text-xs text-white/60">
  <span>Seamless loop</span><StudioSwitch v-model="seamlessLoop" />
</label>
```

- [ ] **Step 4: Render k loops in `generateVideo` when the toggle is on**

In `generateVideo`, replace the single bake call with a branch. The current code is:
```ts
    const bake = await ensureSpaceTypeBake(cfg.value, undefined, {
      renderFrame: async (i) => { engine!.renderFrame(i, params); return engine!.frameToBlob(W.value, H.value) },
    })
```
Replace with:
```ts
    const k = seamlessLoop.value ? loopMultiplier(params, effect.value.loopKeys) : 1
    const origFrames = Math.max(1, Math.round(fps.value * loopDuration.value))
    const loopCfg = k > 1 ? { ...cfg.value, loopDuration: loopDuration.value * k } : cfg.value
    const bake = await ensureSpaceTypeBake(loopCfg, undefined, {
      // Unwrapped t01 = i / origFrames runs 0..k so motions keep their per-loop rate across k loops
      // and land on whole cycles → seamless. k=1 is identical to the previous behavior.
      renderFrame: async (i) => { engine!.renderFrameAt(i / origFrames, params); return engine!.frameToBlob(W.value, H.value) },
    })
```
(`ensureSpaceTypeBake` renders `round(loopCfg.fps * loopCfg.loopDuration)` = `k × origFrames` frames; the encode below already posts `fps: fps.value` and `bake.frames`, so the MP4 is `k×` longer and loops seamlessly. No other change to the encode call.)

- [ ] **Step 5: Typecheck + suites + manual note**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "effect.ts|cylinder.ts|SpaceTypeSurface.vue" | grep -v "(10[0-9]," || echo "(no new errors)"` then `npx vitest run tests/unit/`
Expected: no new errors (the known onVibeRevert line ~105 excepted); full suite green.
Manual (needs ComfyUI running): set Cylinder spin speed to a fractional value (e.g. 1.3), enable "Seamless loop", Generate as video → the clip is k× longer and loops with no jump; with the toggle off it's the single-loop clip as before.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts frontend/app/lib/spacetype/effects/cylinder.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/tests/unit/spacetype-loop.unit.spec.ts
git commit -m "feat(space-type): Seamless loop video export (renders k loops)

loopKeys seam field + Cylinder declaration; 'Seamless loop' toggle renders
loopMultiplier(k) loops at unwrapped t01 so fractional speeds complete whole
cycles and the clip loops perfectly (look unchanged). Off = today's export.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd frontend && npm run test:unit` — full suite green (incl. cylinder-controls + loop specs).
- [ ] `cd frontend && npx vue-tsc --noEmit` — no new errors in touched files.
- [ ] **In-app (needs ComfyUI running):** Cylinder repeats look right at R=2/3; granular spin/wave speeds dial smoothly; a fractional-speed export with "Seamless loop" on loops cleanly at k× duration.

## Notes / deferred

- Only Cylinder declares `loopKeys`; other effects export as a single loop until they declare theirs.
- `seamlessLoop` is an export-time toggle, not persisted in the node config.
