# Visible Loops + Frame Auto-Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make loop length visible in a studio and on a Frame, and make a Frame auto-match its wired studios so it loops seamlessly.

**Architecture:** Each studio reports its *true* seamless loop length through the existing `StudioFrameSource.duration` contract. The Frame reconciles all wired slots into one master loop via LCM (so every slot completes whole cycles), and shows it. Space Type is the only studio whose reported duration is currently wrong (it reports the base loop duration, not `× k`); other studios already report honest durations.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (`tests/unit/**/*.unit.spec.ts`, run with `npx vitest run`).

## Global Constraints

- Tests live in `frontend/tests/unit/`, named `*.unit.spec.ts`; run `cd frontend && node_modules/.bin/vitest run <file>`.
- Pure logic goes in `frontend/app/lib/**`; Vue components import from `~/lib/...`.
- Colour: action-blue is the only accent; **amber is reserved for warnings**; purple is banned (project colour conventions).
- Backward compatibility: a Space Type node saved before this change has no `seamless` field → must behave exactly as today (base loop duration).
- All work on branch `claude/gifted-clarke-f19a4b`. If `frontend/node_modules` is missing, symlink it: `ln -sfn /Users/julien/Documents/GitHub/Sailor/frontend/node_modules frontend/node_modules`.

---

### Task 1: Shared loop-reconcile module

**Files:**
- Create: `frontend/app/lib/compositor/loopReconcile.ts`
- Test: `frontend/tests/unit/loop-reconcile.unit.spec.ts`

**Interfaces:**
- Produces:
  - `effectiveLoopSeconds(loopDuration: number, k: number): number`
  - `reconcileLoops(slots: { seconds: number; fps: number }[], capSeconds?: number): { duration: number; fps: number; capped: boolean }`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/loop-reconcile.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reconcileLoops, effectiveLoopSeconds } from '~/lib/compositor/loopReconcile'

describe('effectiveLoopSeconds', () => {
  it('is base duration times the whole-cycle multiplier', () => {
    expect(effectiveLoopSeconds(6, 1)).toBe(6)
    expect(effectiveLoopSeconds(6, 2)).toBe(12)
  })
  it('floors k at 1 and clamps negative durations', () => {
    expect(effectiveLoopSeconds(6, 0)).toBe(6)
    expect(effectiveLoopSeconds(-3, 2)).toBe(0)
  })
})

describe('reconcileLoops', () => {
  it('passes a single animated slot through unchanged', () => {
    expect(reconcileLoops([{ seconds: 6, fps: 30 }])).toEqual({ duration: 6, fps: 30, capped: false })
  })
  it('takes the LCM so both slots complete whole cycles (6s + 4s = 12s)', () => {
    expect(reconcileLoops([{ seconds: 6, fps: 30 }, { seconds: 4, fps: 30 }]))
      .toEqual({ duration: 12, fps: 30, capped: false })
  })
  it('handles coprime lengths (6s + 7s = 42s, under the cap)', () => {
    expect(reconcileLoops([{ seconds: 6, fps: 30 }, { seconds: 7, fps: 30 }]))
      .toEqual({ duration: 42, fps: 30, capped: false })
  })
  it('uses a shared frame base when fps differ (6s@30 + 4s@24 = 12s@30)', () => {
    expect(reconcileLoops([{ seconds: 6, fps: 30 }, { seconds: 4, fps: 24 }]))
      .toEqual({ duration: 12, fps: 30, capped: false })
  })
  it('resolves fractional seconds through the frame base (4.5s@30 = 4.5s)', () => {
    expect(reconcileLoops([{ seconds: 4.5, fps: 30 }])).toEqual({ duration: 4.5, fps: 30, capped: false })
  })
  it('caps an exploding LCM to whole multiples of the longest slot, flagged', () => {
    // lcm(180,210,150)=6300 frames = 210s @30 > 60s cap.
    // longest=210 frames; capFrames=1800; mult=floor(1800/210)=8 → 1680/30 = 56s.
    const r = reconcileLoops([{ seconds: 6, fps: 30 }, { seconds: 7, fps: 30 }, { seconds: 5, fps: 30 }])
    expect(r).toEqual({ duration: 56, fps: 30, capped: true })
  })
  it('is empty-safe (no animated slots → zero duration)', () => {
    expect(reconcileLoops([])).toEqual({ duration: 0, fps: 1, capped: false })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node_modules/.bin/vitest run tests/unit/loop-reconcile.unit.spec.ts`
Expected: FAIL — "Failed to resolve import '~/lib/compositor/loopReconcile'".

- [ ] **Step 3: Write the module**

Create `frontend/app/lib/compositor/loopReconcile.ts`:

```ts
// frontend/app/lib/compositor/loopReconcile.ts
// Combine per-studio loop lengths into one Frame master loop where every slot
// completes whole cycles (LCM in a shared frame base) → seamless. Pure, no Vue/DOM.

/** A studio's true seamless length: base loop duration × the whole-cycle multiplier. */
export function effectiveLoopSeconds(loopDuration: number, k: number): number {
  return Math.max(0, loopDuration) * Math.max(1, k)
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b))
  while (b) { const t = b; b = a % b; a = t }
  return a || 1
}
function lcm(a: number, b: number): number {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b))
  if (a === 0 || b === 0) return Math.max(a, b)
  return (a / gcd(a, b)) * b
}

export interface ReconciledLoop { duration: number; fps: number; capped: boolean }

/**
 * Reconcile animated slot loops into one master loop. `slots` are the animated
 * wired studios (seconds > 0). Result loops at the LCM of the slot periods so each
 * completes whole cycles; clamped to `capSeconds` (falling back to whole multiples
 * of the longest slot so the dominant motion stays seamless).
 */
export function reconcileLoops(
  slots: { seconds: number; fps: number }[], capSeconds = 60,
): ReconciledLoop {
  const live = slots.filter(s => s.seconds > 0)
  if (!live.length) return { duration: 0, fps: 1, capped: false }
  const fps = Math.max(1, ...live.map(s => Math.max(1, Math.round(s.fps))))
  const frames = live.map(s => Math.max(1, Math.round(fps * s.seconds)))
  let combined = frames.reduce((acc, f) => lcm(acc, f), 1)
  let capped = false
  const capFrames = Math.max(1, Math.round(fps * capSeconds))
  if (combined > capFrames) {
    const longest = Math.max(...frames)
    combined = longest * Math.max(1, Math.floor(capFrames / longest))
    capped = true
  }
  return { duration: combined / fps, fps, capped }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node_modules/.bin/vitest run tests/unit/loop-reconcile.unit.spec.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/loopReconcile.ts frontend/tests/unit/loop-reconcile.unit.spec.ts
git commit -m "feat(compositor): loop reconcile (LCM master loop) + effectiveLoopSeconds"
```

---

### Task 2: deriveMasterClock reconciles via LCM

**Files:**
- Modify: `frontend/app/lib/compositor/masterClock.ts` (function `deriveMasterClock`, type `MasterClock`)
- Test: `frontend/tests/unit/compositor-master-clock.unit.spec.ts` (update the derived-branch assertions)

**Interfaces:**
- Consumes: `reconcileLoops` from Task 1.
- Produces: `MasterClock = { duration: number; fps: number; capped?: boolean } | null` (adds optional `capped`; `deriveMasterClock` signature unchanged).

- [ ] **Step 1: Update the failing test**

In `frontend/tests/unit/compositor-master-clock.unit.spec.ts`, REPLACE the `it('derives max duration and max fps across animated slots', ...)` test with:

```ts
  it('reconciles animated slots into the LCM master loop (max fps)', () => {
    // animated: 4s@30 and 6s@24 → frame base 30; frames 120 & 180; lcm 360 → 12s.
    expect(deriveMasterClock([{ duration: 4, fps: 30 }, { duration: 6, fps: 24 }, { duration: 0, fps: 60 }]))
      .toEqual({ duration: 12, fps: 30 })
  })
```

(The `ignores still slots`, `override wins`, `override applies`, `ignores a null override`, and `is null` tests stay unchanged — a single animated slot's LCM is itself, and the override branch does not call reconcile.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node_modules/.bin/vitest run tests/unit/compositor-master-clock.unit.spec.ts`
Expected: FAIL — current code returns `{ duration: 6, fps: 30 }` (max), not `{ duration: 12, fps: 30 }`.

- [ ] **Step 3: Modify deriveMasterClock**

In `frontend/app/lib/compositor/masterClock.ts`:

Add the import at the top (after the existing header comment / first import):

```ts
import { reconcileLoops } from './loopReconcile'
```

Change the `MasterClock` type to:

```ts
export type MasterClock = { duration: number; fps: number; capped?: boolean } | null
```

Replace the derived branch of `deriveMasterClock` (the `const animated = ...` block through its `return { duration: ..., fps: ... }`) with:

```ts
  const animated = slots.filter(s => s.duration > 0)
  if (!animated.length) return null
  const r = reconcileLoops(animated.map(s => ({ seconds: s.duration, fps: s.fps })))
  // Only surface `capped` when true so unchanged results stay {duration,fps} (existing shape).
  return r.capped ? { duration: r.duration, fps: r.fps, capped: true } : { duration: r.duration, fps: r.fps }
```

Leave the override branch (`if (override) return { duration: override.duration, fps: override.fps }`) and `slotPhase01` untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node_modules/.bin/vitest run tests/unit/compositor-master-clock.unit.spec.ts tests/unit/loop-reconcile.unit.spec.ts tests/unit/frame-preview-clock.unit.spec.ts`
Expected: PASS (all three files — frame-preview-clock imports `masterFrameIndex` from the same module, so this confirms no break).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/masterClock.ts frontend/tests/unit/compositor-master-clock.unit.spec.ts
git commit -m "feat(compositor): Frame master clock reconciles wired loops via LCM"
```

---

### Task 3: Space Type persists `seamless` and reports its true loop length

**Files:**
- Modify: `frontend/shared/spacetype/state.ts:31-49` (interface — add `seamless`)
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (loadConfig ~888, saveConfig ~927)
- Modify: `frontend/app/components/vue-canvas/SpaceTypeNode.vue` (frameSource `getClock` ~189)

**Interfaces:**
- Consumes: `effectiveLoopSeconds` (Task 1), `loopMultiplier` from `~/lib/spacetype/loop`, `getEffect` from `~/lib/spacetype/effects` (already imported in SpaceTypeNode).
- Produces: a `seamless?: boolean` field on `SpaceTypeState`; a `StudioFrameSource.duration` that equals the true seamless length.

- [ ] **Step 1: Add the persisted field**

In `frontend/shared/spacetype/state.ts`, inside `export interface SpaceTypeState { ... }`, add after the `loopDuration: number` line (line 36):

```ts
  /** Seamless-loop toggle. When true the true loop length is loopDuration × k
   *  (k = whole-cycle multiplier for the effect's motion). Absent ⇒ false ⇒ base. */
  seamless?: boolean
```

- [ ] **Step 2: Persist it in the Surface**

In `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`:

In `loadConfig()`, after the line `if (typeof c.loopDuration === 'number') loopDuration.value = c.loopDuration`, add:

```ts
  if (typeof c.seamless === 'boolean') seamlessLoop.value = c.seamless
```

In `saveConfig()`, in the `n.data.properties.sailor_spaceType = { ... }` object, add to the `fps: fps.value, loopDuration: loopDuration.value,` line:

```ts
    fps: fps.value, loopDuration: loopDuration.value, seamless: seamlessLoop.value,
```

- [ ] **Step 3: Report the true duration from the frame source**

In `frontend/app/components/vue-canvas/SpaceTypeNode.vue`:

Add imports near the existing `import { getEffect } from '~/lib/spacetype/effects'` (line 6):

```ts
import { loopMultiplier } from '~/lib/spacetype/loop'
import { effectiveLoopSeconds } from '~/lib/compositor/loopReconcile'
```

Replace the `getClock` closure body (currently `const s = state.value; const [cw, ch] = dimsFromState(s); return { duration: s.loopDuration, fps: s.fps, width: cw, height: ch }`) with:

```ts
    getClock: () => {
      const s = state.value
      const [cw, ch] = dimsFromState(s)
      const k = s.seamless ? loopMultiplier(getEffect(s.effectId).loopRates?.(s.params) ?? []) : 1
      return { duration: effectiveLoopSeconds(s.loopDuration, k), fps: s.fps, width: cw, height: ch }
    },
```

- [ ] **Step 4: Verify it compiles + behaves**

Run: `ln -sfn /Users/julien/Documents/GitHub/Sailor/frontend/node_modules frontend/node_modules` (if needed), then start the dev server via the preview tool (`name: frontend`), wait for HTTP 200 on `http://127.0.0.1:3002/`, and compile-check each changed file:

```bash
cd frontend; ABS=$(pwd)
for m in shared/spacetype/state.ts app/components/vue-canvas/SpaceTypeSurface.vue app/components/vue-canvas/SpaceTypeNode.vue; do
  curl -s -o /tmp/c.out -w "%{http_code} $m\n" "http://127.0.0.1:3002/_nuxt/@fs$ABS/$m"; grep -l "Transform failed" /tmp/c.out && echo "FAIL $m"
done
```

Expected: `200` for each, no "Transform failed".

Manual (dev server, on `127.0.0.1`): open a Space Type node's editor, toggle Seamless loop, reload the page → the toggle state persists (proves Step 2). (The frame-source duration is exercised in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/spacetype/state.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/app/components/vue-canvas/SpaceTypeNode.vue
git commit -m "feat(spacetype): persist seamless flag; frame source reports true loop length"
```

---

### Task 4: Studio readout — show the loop length next to the toggle

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (add a computed near other computeds; template near line ~2164)

**Interfaces:**
- Consumes: `effectiveLoopSeconds` (Task 1), `loopMultiplier` (already imported at line 25), `effect`, `params`, `loopDuration`, `seamlessLoop` (all existing refs).

- [ ] **Step 1: Add the length computed**

In `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`, add the import for `effectiveLoopSeconds` next to the existing `import { loopMultiplier, previewFrameAt } from '~/lib/spacetype/loop'` (line 25):

```ts
import { effectiveLoopSeconds } from '~/lib/compositor/loopReconcile'
```

Add a computed near the other `const ... = computed(...)` declarations (e.g. just after `const seamlessLoop = ref(false)` at line 93):

```ts
// True loop length shown beside the Seamless-loop toggle: loopDuration × k when
// seamless is on (k lets fractional-speed motions finish whole cycles), else base.
const loopLengthLabel = computed(() => {
  const k = seamlessLoop.value ? loopMultiplier(effect.value.loopRates?.(params) ?? []) : 1
  return `${effectiveLoopSeconds(loopDuration.value, k).toFixed(1)}s`
})
```

- [ ] **Step 2: Render it in the template**

Find the row (near line 2164): `<span>Seamless loop</span><StudioSwitch v-model="seamlessLoop" />`. Add a muted length after the switch:

```html
<span>Seamless loop</span><StudioSwitch v-model="seamlessLoop" /><span class="ml-2 text-white/40 tabular-nums">· {{ loopLengthLabel }}</span>
```

(Keep the surrounding element structure; only insert the trailing `<span>`. Use `tabular-nums` so the number doesn't jitter as it changes.)

- [ ] **Step 3: Verify it renders**

With the dev server running, compile-check the file (same curl pattern as Task 3 Step 4) → `200`, no "Transform failed". Manual: open a Space Type editor; the row reads e.g. `Seamless loop · 6.0s`; toggling on an effect with fractional motion updates the number (e.g. `12.0s`); changing loop duration updates it live.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(spacetype): show seamless loop length beside the toggle"
```

---

### Task 5: Frame loop badge

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` (template, inside the root `.artifact-frame-node` div near line 966)

**Interfaces:**
- Consumes: `masterClock` computed (existing, now `{ duration, fps, capped? }`), which is derived from wired slot durations (Task 2/3).

- [ ] **Step 1: Add the badge to the template**

In `frontend/app/components/vue-canvas/ArtifactFrameNode.vue`, inside the root `<div class="artifact-frame-node relative select-none" ...>` (opens ~line 960), right after `<VueCanvasNodeReadyBadge :node-id="id" />` (line 966), add:

```html
    <div
      v-if="masterClock && masterClock.duration > 0"
      class="absolute top-1 right-1 z-10 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] leading-none text-white/70 tabular-nums pointer-events-none"
      :title="masterClock.capped ? 'Loop capped at 60s — wired studios don’t share a common length' : `Loops every ${Math.round(masterClock.duration)}s`"
    >
      <span>⟳ {{ Math.round(masterClock.duration) }}s</span>
      <span v-if="masterClock.capped" class="text-amber-400">!</span>
    </div>
```

(Placement mirrors `NodeReadyBadge`'s corner chrome. `pointer-events-none` so it never eats artboard clicks — see the canvas-overlay-pointer-events convention. Neutral styling with amber reserved for the cap warning.)

- [ ] **Step 2: Verify it renders + is correct**

With the dev server running, compile-check the file (curl pattern from Task 3 Step 4) → `200`, no "Transform failed".

Manual end-to-end (the whole feature): on `127.0.0.1`, wire a Space Type node (Seamless loop on, an effect with fractional motion so k>1, e.g. loopDuration 6 → shows `12.0s`) into a Frame. The Frame card shows `⟳ 12s`. Hover to play: the loop repeats without a mid-loop seam (before this change it seamed at 6s). Wire a second animated studio of a different length and confirm the badge shows the LCM.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/ArtifactFrameNode.vue
git commit -m "feat(frame): loop-length badge on the card (with cap warning)"
```

---

## Notes for the implementer

- **Run the full unit suite once at the end** (`cd frontend && node_modules/.bin/vitest run tests/unit/loop-reconcile.unit.spec.ts tests/unit/compositor-master-clock.unit.spec.ts tests/unit/frame-preview-clock.unit.spec.ts`) to confirm nothing regressed.
- **Dev server gotcha:** use `http://127.0.0.1:3002` for browser/curl, NOT `localhost` (localhost hits an IPv6 WS listener and returns 426). Nuxt may pick a different port — check the preview logs.
- **Do not** touch the bake/export path: it already reads `masterClock.duration`, so it inherits the corrected (LCM) length for free.
- After Task 5, remove any temporary `frontend/node_modules` symlink before finishing (`rm -f frontend/node_modules`) so the worktree stays clean.
