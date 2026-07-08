# Frame Modal Interaction-Fidelity Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Figma/Photoshop "muscle-memory" interaction layer to the Compositor/Frame editor — keyboard nudge, duplicate, rotate-snap, and snap-to-canvas-edges — as pure, unit-tested functions wired into the existing editor.

**Architecture:** All new behavior lands as pure functions in a new `frontend/app/lib/compositor/layerEdits.ts` (mirroring the existing pure `layerGroups.ts`), each unit-tested in isolation with no Vue/canvas dependency. The composable [useLocalLayerEditor.ts](frontend/app/composables/useLocalLayerEditor.ts) imports them and does thin wiring; the only edit to the large [CompositorModal.vue](frontend/app/components/vue-canvas/CompositorModal.vue) is a single keydown call in the last task.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (`tests/unit/*.unit.spec.ts`, node env).

## Global Constraints

- Work directly on `main` — do NOT create branches (user rule).
- Stage files explicitly by path — NEVER `git add -A` (user rule; a parallel session is committing to `main` concurrently).
- Pre-flight EVERY task: `git status --short <target files>`. If any target file shows FOREIGN uncommitted changes, STOP and report BLOCKED — do not edit a file another session is mid-edit on.
- No new npm dependencies.
- `layerEdits.ts` imports ONLY `import type { … }` from `useCompositorLayers` / `layerGroups` (types erase at runtime → tests stay free of canvas/Vue).
- All pure functions are side-effect-free and return new arrays (never mutate inputs), matching `layerGroups.ts`.
- Figma-convention default values (use verbatim): keyboard nudge small step = `1` logical px, large (shift) step = `10` logical px; rotate snap increment = `15` degrees; duplicate offset = `0.02` (normalized); snap threshold = existing `SNAP_PX = 6` (unchanged); position clamp = `[-0.5, 1.5]` (matches existing move).
- Normalized coordinate model (unchanged): `x`,`y` are layer CENTER in `[0..1]` of artboard width/height; a nudge of N logical px = `N / dims().w` in x, `N / dims().h` in y.
- Unit tests run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`; full suite before each commit: `cd frontend && npx vitest run tests/unit`. KNOWN pre-existing unrelated failures (do NOT block on them, note in report): gradientfx-mesh, spacetype-palette (×2), video-model-adapt.
- End every commit message body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `nudgeLayers` + keyboard-free nudge wiring

**Files:**
- Create: `frontend/app/lib/compositor/layerEdits.ts`
- Create: `frontend/tests/unit/layer-edits.unit.spec.ts`
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (add import; add `nudgeSelection`; export it)

**Interfaces:**
- Produces: `nudgeLayers(layers: LocalLayer[], selectedIds: Set<string>, dx: number, dy: number): LocalLayer[]` and a module-local `clamp`. Editor gains `nudgeSelection(dx: number, dy: number): void`. Tasks 2–5 add more exports to the same file.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/layer-edits.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { nudgeLayers } from '../../app/lib/compositor/layerEdits'

const L = (id: string, x: number, y: number): any => ({ id, kind: 'rect', x, y, rotation: 0, opacity: 1, w: 0.1, h: 0.1 })

describe('nudgeLayers', () => {
  it('moves only selected layers by the delta', () => {
    const out = nudgeLayers([L('a', 0.2, 0.2), L('b', 0.5, 0.5)], new Set(['a']), 0.01, -0.02)
    expect(out[0]).toMatchObject({ id: 'a', x: 0.21, y: 0.18 })
    expect(out[1]).toMatchObject({ id: 'b', x: 0.5, y: 0.5 })
  })
  it('clamps to [-0.5, 1.5]', () => {
    const out = nudgeLayers([L('a', 1.49, -0.49)], new Set(['a']), 0.5, -0.5)
    expect(out[0].x).toBeCloseTo(1.5); expect(out[0].y).toBeCloseTo(-0.5)
  })
  it('returns the array unchanged for empty selection or zero delta', () => {
    const arr = [L('a', 0.2, 0.2)]
    expect(nudgeLayers(arr, new Set(), 0.01, 0.01)).toBe(arr)
    expect(nudgeLayers(arr, new Set(['a']), 0, 0)).toBe(arr)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: FAIL — `Cannot find module '../../app/lib/compositor/layerEdits'`

- [ ] **Step 3: Write the implementation**

```typescript
// frontend/app/lib/compositor/layerEdits.ts
/**
 * Pure layer-edit operations for the Compositor / Frame editor — the Figma
 * interaction layer (nudge, duplicate, rotate-snap, snap-to-edge). All functions
 * are side-effect-free and return new arrays, so useLocalLayerEditor stays a thin
 * wiring layer and every behavior is unit-tested without Vue or canvas. Mirrors
 * the pure-lib pattern of layerGroups.ts.
 */
import type { LocalLayer } from '~/composables/useCompositorLayers'
import type { LayerGroup } from '~/lib/compositor/layerGroups'

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Move every selected layer by a normalized delta (clamped like the drag path). */
export function nudgeLayers(layers: LocalLayer[], selectedIds: Set<string>, dx: number, dy: number): LocalLayer[] {
  if (!selectedIds.size || (dx === 0 && dy === 0)) return layers
  return layers.map(l => (selectedIds.has(l.id)
    ? ({ ...l, x: clamp(l.x + dx, -0.5, 1.5), y: clamp(l.y + dy, -0.5, 1.5) } as LocalLayer)
    : l))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Wire `nudgeSelection` into the editor**

In `useLocalLayerEditor.ts`, add to the imports block (after the `layerGroups` import, ~line 21):

```typescript
import { nudgeLayers } from '~/lib/compositor/layerEdits'
```

Add this function just after `alignSelected` closes (~line 279):

```typescript
  /** Move the whole multi-selection by a normalized delta (keyboard nudge). */
  function nudgeSelection(dx: number, dy: number) {
    if (!selectedIds.value.size || (dx === 0 && dy === 0)) return
    recordHistory()
    commit(nudgeLayers(localLayers.value, selectedIds.value, dx, dy))
  }
```

Add `nudgeSelection` to the returned object (in the `alignSelected,` line group, ~line 544):

```typescript
    selectedIds, selectedLayers, toggleSelect, applyBoolean, alignSelected, nudgeSelection,
```

- [ ] **Step 6: Verify full suite + commit**

Run: `cd frontend && npx vitest run tests/unit`
Expected: PASS (minus the known pre-existing unrelated failures).

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/compositor/layerEdits.ts frontend/tests/unit/layer-edits.unit.spec.ts frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): nudgeLayers + editor nudgeSelection"
```

---

### Task 2: `duplicateLayers` + `duplicateSelection`

**Files:**
- Modify: `frontend/app/lib/compositor/layerEdits.ts` (add `duplicateLayers`)
- Modify: `frontend/tests/unit/layer-edits.unit.spec.ts` (append)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (add `duplicateSelection`)

**Interfaces:**
- Consumes: `clamp` from Task 1.
- Produces: `duplicateLayers(layers, groups, selectedIds, offset, mkId, mkGid): { layers: LocalLayer[]; groups: LayerGroup[]; newIds: string[] }` where `mkId: () => string` and `mkGid: () => string` are injected id factories. Editor gains `duplicateSelection(): void`. Behavior: each selected layer is deep-cloned with a fresh id and offset by `offset` in x and y; layers sharing a source `groupId` map to ONE fresh group id (added to the registry as a root); selection moves to the clones. (Nested-parent remap is intentionally out of scope — a v1 flat copy; noted in Deferred.)

- [ ] **Step 1: Write the failing test**

```typescript
// append to frontend/tests/unit/layer-edits.unit.spec.ts
import { duplicateLayers } from '../../app/lib/compositor/layerEdits'

const G = (id: string, x: number, y: number, groupId?: string): any => ({ id, kind: 'rect', x, y, rotation: 0, opacity: 1, w: 0.1, h: 0.1, ...(groupId ? { groupId } : {}) })

describe('duplicateLayers', () => {
  const ids = () => { let n = 0; return () => `id${++n}` }
  const gids = () => { let n = 0; return () => `g${++n}` }

  it('clones a loose layer with a fresh id and offset, selection = the copy', () => {
    const r = duplicateLayers([G('a', 0.2, 0.2)], [], new Set(['a']), 0.02, ids(), gids())
    expect(r.layers).toHaveLength(2)
    expect(r.newIds).toEqual(['id1'])
    expect(r.layers[1]).toMatchObject({ id: 'id1', x: 0.22, y: 0.22 })
    expect(r.groups).toEqual([])
  })
  it('maps two layers sharing a group to ONE fresh group id', () => {
    const r = duplicateLayers([G('a', 0.2, 0.2, 'gsrc'), G('b', 0.3, 0.3, 'gsrc')], [{ id: 'gsrc' }], new Set(['a', 'b']), 0.02, ids(), gids())
    expect(r.layers).toHaveLength(4)
    const copies = r.layers.slice(2)
    expect(copies[0].groupId).toBe('g1')
    expect(copies[1].groupId).toBe('g1')
    expect(r.groups).toContainEqual({ id: 'g1' })
  })
  it('is a no-op for an empty selection', () => {
    const arr = [G('a', 0.2, 0.2)]
    const r = duplicateLayers(arr, [], new Set(), 0.02, ids(), gids())
    expect(r.layers).toBe(arr); expect(r.newIds).toEqual([])
  })
  it('deep-clones nested data (effects) so copies are independent', () => {
    const src: any = { ...G('a', 0.2, 0.2), effects: [{ type: 'drop_shadow', blur: 4 }] }
    const r = duplicateLayers([src], [], new Set(['a']), 0.02, ids(), gids())
    ;(r.layers[1] as any).effects[0].blur = 99
    expect((src as any).effects[0].blur).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: FAIL — `duplicateLayers` is not exported.

- [ ] **Step 3: Implement**

Append to `layerEdits.ts`:

```typescript
/** Duplicate the selected layers: fresh ids, offset, and a fresh group id per
 *  distinct source group (added as a registry root). Deep-clones layer data.
 *  mkId/mkGid are injected so callers control id minting (and tests stay
 *  deterministic). Nested-group parent links are NOT remapped (v1 flat copy). */
export function duplicateLayers(
  layers: LocalLayer[],
  groups: LayerGroup[],
  selectedIds: Set<string>,
  offset: number,
  mkId: () => string,
  mkGid: () => string,
): { layers: LocalLayer[]; groups: LayerGroup[]; newIds: string[] } {
  const sel = layers.filter(l => selectedIds.has(l.id))
  if (!sel.length) return { layers, groups, newIds: [] }
  const groupMap = new Map<string, string>()
  const newIds: string[] = []
  const clones = sel.map((l) => {
    const c = JSON.parse(JSON.stringify(l)) as any
    c.id = mkId(); newIds.push(c.id)
    c.x = clamp(l.x + offset, -0.5, 1.5)
    c.y = clamp(l.y + offset, -0.5, 1.5)
    if (l.groupId) {
      if (!groupMap.has(l.groupId)) groupMap.set(l.groupId, mkGid())
      c.groupId = groupMap.get(l.groupId)
    }
    return c as LocalLayer
  })
  const newGroups: LayerGroup[] = [...groups, ...[...groupMap.values()].map(id => ({ id }))]
  return { layers: [...layers, ...clones], groups: newGroups, newIds }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Wire `duplicateSelection` into the editor**

Add `duplicateLayers` to the Task-1 import line in `useLocalLayerEditor.ts`:

```typescript
import { nudgeLayers, duplicateLayers } from '~/lib/compositor/layerEdits'
```

Add after `nudgeSelection` (from Task 1):

```typescript
  /** Duplicate the current multi-selection; the copies become the selection. */
  function duplicateSelection() {
    if (!selectedIds.value.size) return
    recordHistory()
    const r = duplicateLayers(
      localLayers.value, localGroups.value, selectedIds.value, 0.02,
      () => `ll-${Date.now().toString(36)}-${++_dupSeq}`,
      () => `g-${Date.now().toString(36)}-${++_groupSeq}`,
    )
    commitBoth(r.layers as LocalLayer[], r.groups)
    selectedIds.value = new Set(r.newIds)
    selectedId.value = r.newIds[r.newIds.length - 1] ?? null
  }
```

Add a counter next to `_groupSeq` (~line 175): change `let _groupSeq = 0` to:

```typescript
  let _groupSeq = 0
  let _dupSeq = 0
```

Add `duplicateSelection` to the returned object (append to the `nudgeSelection` line from Task 1):

```typescript
    selectedIds, selectedLayers, toggleSelect, applyBoolean, alignSelected, nudgeSelection, duplicateSelection,
```

- [ ] **Step 6: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit`
Expected: PASS (minus known pre-existing failures).

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/compositor/layerEdits.ts frontend/tests/unit/layer-edits.unit.spec.ts frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): duplicateLayers + editor duplicateSelection"
```

---

### Task 3: `snapAngle` + shift-to-15° rotate

**Files:**
- Modify: `frontend/app/lib/compositor/layerEdits.ts` (add `snapAngle`)
- Modify: `frontend/tests/unit/layer-edits.unit.spec.ts` (append)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (rotate branch of `onMove`, ~line 398)

**Interfaces:**
- Produces: `snapAngle(deg: number, step: number | null): number` — rounds `deg` to the nearest multiple of `step`; returns `deg` unchanged when `step` is null/0. Used in the rotate drag when Shift is held.

- [ ] **Step 1: Write the failing test**

```typescript
// append to frontend/tests/unit/layer-edits.unit.spec.ts
import { snapAngle } from '../../app/lib/compositor/layerEdits'

describe('snapAngle', () => {
  it('snaps to the nearest step', () => {
    expect(snapAngle(7, 15)).toBe(0)
    expect(snapAngle(8, 15)).toBe(15)
    expect(snapAngle(52, 15)).toBe(45)
    expect(snapAngle(-8, 15)).toBe(-15)
  })
  it('passes through when step is null or 0', () => {
    expect(snapAngle(37, null)).toBe(37)
    expect(snapAngle(37, 0)).toBe(37)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: FAIL — `snapAngle` not exported.

- [ ] **Step 3: Implement**

Append to `layerEdits.ts`:

```typescript
/** Round an angle (degrees) to the nearest `step`; pass through when step falsy. */
export function snapAngle(deg: number, step: number | null): number {
  if (!step) return deg
  return Math.round(deg / step) * step
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Wire into the rotate drag**

Add `snapAngle` to the import line in `useLocalLayerEditor.ts`:

```typescript
import { nudgeLayers, duplicateLayers, snapAngle } from '~/lib/compositor/layerEdits'
```

In `onMove`, replace the rotate branch (currently):

```typescript
    } else if (d.type === 'rotate') {
      let rot = d.startRot + ((Math.atan2(e.clientY - d.cy, e.clientX - d.cx) - d.startAngle) * 180) / Math.PI
      while (rot > 180) rot -= 360
      while (rot < -180) rot += 360
      setLocal(d.id, { rotation: Math.round(rot) })
    }
```

with:

```typescript
    } else if (d.type === 'rotate') {
      let rot = d.startRot + ((Math.atan2(e.clientY - d.cy, e.clientX - d.cx) - d.startAngle) * 180) / Math.PI
      while (rot > 180) rot -= 360
      while (rot < -180) rot += 360
      setLocal(d.id, { rotation: Math.round(snapAngle(rot, e.shiftKey ? 15 : null)) })
    }
```

- [ ] **Step 6: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit`
Expected: PASS (minus known pre-existing failures).

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/compositor/layerEdits.ts frontend/tests/unit/layer-edits.unit.spec.ts frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): snapAngle + shift-to-15deg rotate"
```

---

### Task 4: `computeSnapAdjust` (snap to canvas edges) + applySnap refactor

**Files:**
- Modify: `frontend/app/lib/compositor/layerEdits.ts` (add `computeSnapAdjust`)
- Modify: `frontend/tests/unit/layer-edits.unit.spec.ts` (append)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (`applySnap`, ~lines 331-358)

**Interfaces:**
- Produces: `computeSnapAdjust(prim: Box, others: Box[], thresholdX: number, thresholdY: number, canvasTargets?: number[]): { dx: number; dy: number; guideX: number | null; guideY: number | null }` where `Box = { cx: number; cy: number; hx: number; hy: number }` (center + half-extents, normalized). Matches a moving layer's edges/center to the nearest target line (other layers' edges/centers plus `canvasTargets`, default `[0, 0.5, 1]`) within threshold, returning the adjustment and the guide line to draw. This ADDS canvas edges 0 and 1 to the existing behavior (which only targeted center 0.5).

- [ ] **Step 1: Write the failing test**

```typescript
// append to frontend/tests/unit/layer-edits.unit.spec.ts
import { computeSnapAdjust } from '../../app/lib/compositor/layerEdits'

describe('computeSnapAdjust', () => {
  const T = 0.02
  it('snaps the left edge to the canvas edge (0)', () => {
    const r = computeSnapAdjust({ cx: 0.105, cy: 0.5, hx: 0.1, hy: 0.1 }, [], T, T)
    expect(r.dx).toBeCloseTo(-0.005); expect(r.guideX).toBe(0)
  })
  it('snaps center to canvas center (0.5)', () => {
    const r = computeSnapAdjust({ cx: 0.49, cy: 0.5, hx: 0.1, hy: 0.1 }, [], T, T)
    expect(r.dx).toBeCloseTo(0.01); expect(r.guideX).toBe(0.5)
  })
  it("snaps to another layer's center", () => {
    const r = computeSnapAdjust({ cx: 0.31, cy: 0.5, hx: 0.05, hy: 0.05 }, [{ cx: 0.3, cy: 0.5, hx: 0.05, hy: 0.05 }], T, T)
    expect(r.dx).toBeCloseTo(-0.01); expect(r.guideX).toBe(0.3)
  })
  it('does nothing outside the threshold', () => {
    const r = computeSnapAdjust({ cx: 0.6, cy: 0.6, hx: 0.05, hy: 0.05 }, [], T, T)
    expect(r.dx).toBe(0); expect(r.dy).toBe(0); expect(r.guideX).toBeNull(); expect(r.guideY).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: FAIL — `computeSnapAdjust` not exported.

- [ ] **Step 3: Implement**

Append to `layerEdits.ts`:

```typescript
export interface SnapBox { cx: number; cy: number; hx: number; hy: number }

/** Snap a moving box's edges/center to target lines (other boxes' edges/centers
 *  plus canvas targets, default the two edges + center). Returns the adjustment
 *  and the guide line to draw per axis (null = no snap on that axis). */
export function computeSnapAdjust(
  prim: SnapBox,
  others: SnapBox[],
  thresholdX: number,
  thresholdY: number,
  canvasTargets: number[] = [0, 0.5, 1],
): { dx: number; dy: number; guideX: number | null; guideY: number | null } {
  const xt = [...canvasTargets]
  const yt = [...canvasTargets]
  for (const o of others) {
    xt.push(o.cx - o.hx, o.cx, o.cx + o.hx)
    yt.push(o.cy - o.hy, o.cy, o.cy + o.hy)
  }
  let bestX = { d: thresholdX, adj: 0, guide: null as number | null }
  for (const edge of [prim.cx - prim.hx, prim.cx, prim.cx + prim.hx]) for (const t of xt) {
    const dd = Math.abs(edge - t); if (dd < bestX.d) bestX = { d: dd, adj: t - edge, guide: t }
  }
  let bestY = { d: thresholdY, adj: 0, guide: null as number | null }
  for (const edge of [prim.cy - prim.hy, prim.cy, prim.cy + prim.hy]) for (const t of yt) {
    const dd = Math.abs(edge - t); if (dd < bestY.d) bestY = { d: dd, adj: t - edge, guide: t }
  }
  return { dx: bestX.adj, dy: bestY.adj, guideX: bestX.guide, guideY: bestY.guide }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Refactor `applySnap` to use it**

Add `computeSnapAdjust` (and its type) to the import line:

```typescript
import { nudgeLayers, duplicateLayers, snapAngle, computeSnapAdjust } from '~/lib/compositor/layerEdits'
```

Replace the body of `applySnap` (keep the signature) — currently lines ~333-358 — with:

```typescript
  function applySnap(primaryId: string, ox: number, oy: number, dx: number, dy: number) {
    const W = dims().w, H = dims().h
    const prim = localLayers.value.find(l => l.id === primaryId)
    if (!prim) return { dx, dy }
    const b = boxPx(prim); const hx = b.w / 2 / W, hy = b.h / 2 / H
    const cx = ox + dx, cy = oy + dy
    const movingIds = new Set((drag.value as any)?.origins?.map((o: any) => o.id) ?? [primaryId])
    const others = [] as { cx: number; cy: number; hx: number; hy: number }[]
    for (const l of localLayers.value) {
      if (movingIds.has(l.id)) continue
      const lb = boxPx(l)
      others.push({ cx: l.x, cy: l.y, hx: lb.w / 2 / W, hy: lb.h / 2 / H })
    }
    const res = computeSnapAdjust({ cx, cy, hx, hy }, others, SNAP_PX / W, SNAP_PX / H)
    snapGuides.value = { vx: res.guideX, hy: res.guideY }
    return { dx: dx + res.dx, dy: dy + res.dy }
  }
```

- [ ] **Step 6: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit`
Expected: PASS (minus known pre-existing failures). Existing compositor specs must stay green.

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/compositor/layerEdits.ts frontend/tests/unit/layer-edits.unit.spec.ts frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): snap to canvas edges via computeSnapAdjust"
```

---

### Task 5: `mapKeyToEdit` dispatcher + one keydown wire in CompositorModal

**Files:**
- Modify: `frontend/app/lib/compositor/layerEdits.ts` (add `mapKeyToEdit`)
- Modify: `frontend/tests/unit/layer-edits.unit.spec.ts` (append)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (add `handleEditorKey`)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (one call in the keydown handler, ~line 604-638)

**Interfaces:**
- Consumes: `nudgeSelection`, `duplicateSelection` (Tasks 1-2).
- Produces: `mapKeyToEdit(e: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }, pxSmall: number, pxLarge: number): EditAction | null` where `EditAction = { type: 'nudge'; dxPx: number; dyPx: number } | { type: 'duplicate' }`. Editor gains `handleEditorKey(e: KeyboardEvent): boolean` — returns true if it consumed the event (so the caller `return`s).

- [ ] **Step 1: Write the failing test**

```typescript
// append to frontend/tests/unit/layer-edits.unit.spec.ts
import { mapKeyToEdit } from '../../app/lib/compositor/layerEdits'

describe('mapKeyToEdit', () => {
  it('maps arrows to nudge (small step)', () => {
    expect(mapKeyToEdit({ key: 'ArrowLeft' }, 1, 10)).toEqual({ type: 'nudge', dxPx: -1, dyPx: 0 })
    expect(mapKeyToEdit({ key: 'ArrowDown' }, 1, 10)).toEqual({ type: 'nudge', dxPx: 0, dyPx: 1 })
  })
  it('uses the large step with shift', () => {
    expect(mapKeyToEdit({ key: 'ArrowRight', shiftKey: true }, 1, 10)).toEqual({ type: 'nudge', dxPx: 10, dyPx: 0 })
  })
  it('maps cmd/ctrl+D to duplicate', () => {
    expect(mapKeyToEdit({ key: 'd', metaKey: true }, 1, 10)).toEqual({ type: 'duplicate' })
    expect(mapKeyToEdit({ key: 'D', ctrlKey: true }, 1, 10)).toEqual({ type: 'duplicate' })
  })
  it('returns null for unrelated keys and plain d', () => {
    expect(mapKeyToEdit({ key: 'd' }, 1, 10)).toBeNull()
    expect(mapKeyToEdit({ key: 'a', metaKey: true }, 1, 10)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: FAIL — `mapKeyToEdit` not exported.

- [ ] **Step 3: Implement**

Append to `layerEdits.ts`:

```typescript
export type EditAction = { type: 'nudge'; dxPx: number; dyPx: number } | { type: 'duplicate' }

/** Map a keyboard event to an edit action (arrows → nudge in logical px,
 *  cmd/ctrl+D → duplicate). Pure; the editor converts px → normalized. */
export function mapKeyToEdit(
  e: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
  pxSmall: number,
  pxLarge: number,
): EditAction | null {
  const px = e.shiftKey ? pxLarge : pxSmall
  switch (e.key) {
    case 'ArrowLeft': return { type: 'nudge', dxPx: -px, dyPx: 0 }
    case 'ArrowRight': return { type: 'nudge', dxPx: px, dyPx: 0 }
    case 'ArrowUp': return { type: 'nudge', dxPx: 0, dyPx: -px }
    case 'ArrowDown': return { type: 'nudge', dxPx: 0, dyPx: px }
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) return { type: 'duplicate' }
  return null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Add `handleEditorKey` to the editor**

Add `mapKeyToEdit` to the import line:

```typescript
import { nudgeLayers, duplicateLayers, snapAngle, computeSnapAdjust, mapKeyToEdit } from '~/lib/compositor/layerEdits'
```

Add after `duplicateSelection`:

```typescript
  /** Keyboard: arrow-nudge (1px / shift 10px) + cmd/ctrl-D duplicate.
   *  Returns true if consumed. No-op (false) when nothing is selected. */
  function handleEditorKey(e: KeyboardEvent): boolean {
    if (!selectedIds.value.size) return false
    const a = mapKeyToEdit(e, 1, 10)
    if (!a) return false
    e.preventDefault()
    if (a.type === 'nudge') nudgeSelection(a.dxPx / dims().w, a.dyPx / dims().h)
    else duplicateSelection()
    return true
  }
```

Add `handleEditorKey` to the returned object (append to the Task-2 line):

```typescript
    selectedIds, selectedLayers, toggleSelect, applyBoolean, alignSelected, nudgeSelection, duplicateSelection, handleEditorKey,
```

- [ ] **Step 6: Wire ONE call into CompositorModal**

In `CompositorModal.vue`, find the keydown handler (`function onKeydown` near line 604). The editor is already destructured in this file (it calls `undo`, `groupSelected`, etc. from `useLocalLayerEditor`). Add — as the FIRST lines inside `onKeydown`, before its existing `if` branches — a guard that defers to the editor, but ONLY when focus is not in a text input (so arrows/`d` still type normally in fields):

```typescript
  const t = e.target as HTMLElement | null
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  if (!typing && !editingId.value && handleEditorKey(e)) return
```

Read the file first to confirm the exact local names in scope: the editor's return is destructured near the top of `<script setup>` (search for `useLocalLayerEditor(`). Ensure `handleEditorKey` and `editingId` are added to that destructure if not already present (`editingId` is already used by the editor; add `handleEditorKey` to the destructured list). If the keydown handler is not registered via `@keydown`/`window.addEventListener` for the modal, do NOT add new registration — only augment the existing handler.

- [ ] **Step 7: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit`
Expected: PASS (minus known pre-existing failures).

Note in the report: the CompositorModal keydown wiring has NO unit coverage (Vue SFC handler) — its correctness is asserted via `mapKeyToEdit`/`handleEditorKey` tests plus the typing-guard reasoning; browser verification is owed in the morning.

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/compositor/layerEdits.ts frontend/tests/unit/layer-edits.unit.spec.ts frontend/app/composables/useLocalLayerEditor.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): keyboard nudge + duplicate in the compositor modal"
```

---

## Deferred — needs your eyes / a live browser (morning agenda)

These were intentionally NOT built autonomously because they are taste-driven, visual, or touch the render path and need browser sign-off:

- **Live dimension HUD** on drag/resize (visual readout).
- **Drag-to-scrub on the modal's numeric inputs** — reuse the existing `app/plugins/scrub.client.ts` directive (CompositorModal already imports scrub); a quick template change, but visual.
- **Edge handles for 1D (non-uniform) resize** — today only corner handles doing uniform-from-center scale exist; adding edge handles + opposite-corner anchoring is a drag-model + visual change.
- **Proportional group resize** — scaling a multi-selection bounding box (math + a new group handle).
- **Group cascade** — opacity/visibility flowing from groups to children requires adding `opacity`/`hidden` to `LayerGroup`, UI to set it, and applying it in the render path (`useCompositorLayers` paint stack) — currently "rendering never consults groups". Meatier + visual.
- **Nested-group remap on duplicate** — Task 2 does a flat v1 copy; perfect parentId remap is a refinement.
- **Per-corner radius / stroke alignment (inside/center/outside) / dashed strokes** — data + render + UI.
- **The dive-in seam** — make entering/exiting the modal feel like a focused mode (Figma "enter"), not a popup; the biggest feel win, entirely your call.
- **Inline Frame right-sizing** — trim [ArtifactFrameNode.vue](frontend/app/components/vue-canvas/ArtifactFrameNode.vue) to preview + a frictionless dive-in.
- **Export (PNG/SVG/@2x), layer thumbnails, per-layer rename.**

## Self-Review

- **Coverage:** Tasks 1-5 deliver the four Tier-1 fidelity behaviors from the parity audit that are unit-testable without a browser (nudge, duplicate, rotate-snap, snap-to-edge) plus their keyboard entry. All visual/taste items are in Deferred.
- **No placeholders:** every step has real test + impl code + exact commands.
- **Type consistency:** `nudgeLayers`, `duplicateLayers`, `snapAngle`, `computeSnapAdjust`/`SnapBox`, `mapKeyToEdit`/`EditAction` names are used identically in their producing task and in the editor wiring. `_dupSeq`/`_groupSeq` both declared in Task 2.
- **Contention:** all logic lands in the new `layerEdits.ts` + `useLocalLayerEditor.ts`; the only edit to the large, possibly-contended `CompositorModal.vue` is Task 5's single keydown guard, done last, with a pre-flight dirty check.
