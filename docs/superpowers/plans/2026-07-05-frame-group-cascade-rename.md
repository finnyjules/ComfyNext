# Frame Slice 4a — Group Cascade + Layer Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Compositor/Frame groups cascade opacity + visibility + lock to their children, and let layers be renamed — closing two "groups/layers feel broken" gaps. (Group proportional transform/resize is a separate follow-up plan.)

**Architecture:** A pure `resolveGroupCascade(groupId, groups)` resolver + an `upsertGroup` helper in `frontend/app/lib/compositor/layerGroups.ts`, exhaustively unit-tested. The cascade is applied at three read points: render opacity (`paintLayer`), render visibility (`paintLayerStack`), and canvas selection (`hitTest`). Editor setters write the new group fields; the layers panel gets group eye/lock/opacity controls and per-layer rename. `LayerGroup` and `LocalLayer` gain optional fields (absent ⇒ today's behavior, byte-identical).

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest.

## Global Constraints

- Work on `main` — no branches. Stage files explicitly — NEVER `git add -A` (a parallel session commits to `main`). Pre-flight EVERY task; BLOCK on foreign uncommitted changes in a target.
- No new npm deps. All new `LayerGroup`/`LocalLayer` fields are OPTIONAL — absent ⇒ identical to current behavior (this is the regression-safety invariant; verify existing compositor specs stay green each task).
- The render cascade param is OPTIONAL: when `groups` is not passed to `paintLayerStack`, behavior is byte-identical to today (so any un-updated caller is safe). Update the caller(s) that HAVE the group registry (the modal preview AND the bake/output path — grep `paintLayerStack(`).
- Unit tests: `cd frontend && npx vitest run tests/unit/<file>`; full suite before each commit. KNOWN pre-existing unrelated failures (note, don't block): gradientfx-mesh, spacetype-palette (×2), video-model-adapt.
- Browser verification by the CONTROLLER on `frontend-sg` (`:3017`, `/dev/frame-lab` — the fixture has a nested group "Header" over "Row"/"Side").
- End every commit body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: `resolveGroupCascade` + `upsertGroup` (pure)

**Files:**
- Modify: `frontend/app/lib/compositor/layerGroups.ts` (extend `LayerGroup`; add `resolveGroupCascade`, `upsertGroup`)
- Create: `frontend/tests/unit/group-cascade.unit.spec.ts`

**Interfaces:**
- Produces: `LayerGroup` gains optional `opacity?: number; hidden?: boolean; locked?: boolean`. `GroupCascade = { opacity: number; hidden: boolean; locked: boolean }`. `resolveGroupCascade(groupId: string | undefined, groups: LayerGroup[]): GroupCascade` — walks the group + its ancestors, multiplying opacity (default 1), OR-ing hidden/locked. `upsertGroup(groups, groupId, patch: Partial<LayerGroup>): LayerGroup[]` — updates the registry entry or appends one; pure.

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/tests/unit/group-cascade.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { resolveGroupCascade, upsertGroup, type LayerGroup } from '../../app/lib/compositor/layerGroups'

describe('resolveGroupCascade', () => {
  it('no group → identity', () => {
    expect(resolveGroupCascade(undefined, [])).toEqual({ opacity: 1, hidden: false, locked: false })
  })
  it('single group multiplies opacity', () => {
    expect(resolveGroupCascade('g', [{ id: 'g', opacity: 0.5 }])).toMatchObject({ opacity: 0.5 })
  })
  it('nested groups multiply opacity', () => {
    const gs: LayerGroup[] = [{ id: 'child', parentId: 'parent', opacity: 0.5 }, { id: 'parent', opacity: 0.5 }]
    expect(resolveGroupCascade('child', gs).opacity).toBeCloseTo(0.25)
  })
  it('hidden/locked OR up the chain', () => {
    const gs: LayerGroup[] = [{ id: 'child', parentId: 'parent' }, { id: 'parent', hidden: true, locked: true }]
    expect(resolveGroupCascade('child', gs)).toMatchObject({ hidden: true, locked: true })
  })
  it('missing registry entry (implicit group) contributes nothing', () => {
    expect(resolveGroupCascade('ghost', [])).toEqual({ opacity: 1, hidden: false, locked: false })
  })
})

describe('upsertGroup', () => {
  it('updates an existing entry, preserving other fields', () => {
    const out = upsertGroup([{ id: 'g', name: 'Row' }], 'g', { hidden: true })
    expect(out).toContainEqual({ id: 'g', name: 'Row', hidden: true })
  })
  it('appends when absent', () => {
    const out = upsertGroup([], 'g', { opacity: 0.4 })
    expect(out).toContainEqual({ id: 'g', opacity: 0.4 })
  })
  it('does not mutate the input array', () => {
    const src: LayerGroup[] = [{ id: 'g' }]
    upsertGroup(src, 'g', { locked: true })
    expect(src).toEqual([{ id: 'g' }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/group-cascade.unit.spec.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

In `layerGroups.ts`, extend the interface:

```typescript
export interface LayerGroup {
  id: string
  name?: string
  parentId?: string
  opacity?: number   // 0..1 group multiplier (cascades to descendants)
  hidden?: boolean   // group hidden ⇒ all descendants hidden
  locked?: boolean   // group locked ⇒ all descendants not selectable on canvas
}
```

Add (near the other pure helpers, after `ancestorsOf`):

```typescript
export interface GroupCascade { opacity: number; hidden: boolean; locked: boolean }

/** Resolve the effective group contribution for a layer's immediate group:
 *  opacity multiplied, hidden/locked OR-ed, across the group + all ancestors. */
export function resolveGroupCascade(groupId: string | undefined, groups: LayerGroup[]): GroupCascade {
  const out: GroupCascade = { opacity: 1, hidden: false, locked: false }
  if (!groupId) return out
  const byId = byId_(groups)
  for (const id of [groupId, ...ancestorsOf(groupId, groups)]) {
    const g = byId.get(id)
    if (!g) continue
    if (typeof g.opacity === 'number') out.opacity *= g.opacity
    if (g.hidden) out.hidden = true
    if (g.locked) out.locked = true
  }
  return out
}

/** Update a group's registry entry (or append one), preserving other fields. Pure. */
export function upsertGroup(groups: LayerGroup[], groupId: string, patch: Partial<LayerGroup>): LayerGroup[] {
  let found = false
  const out = groups.map(g => (g.id === groupId ? (found = true, { ...g, ...patch }) : g))
  if (!found) out.push({ id: groupId, ...patch })
  return out
}
```

The file already has a private `byId(groups)` map helper used by `parentOf`/`ancestorsOf` — REUSE it (write `byId(groups)` instead of the `byId_` placeholder above). Do not duplicate the lookup helper.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/group-cascade.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Full suite + commit**

Run: `cd frontend && npx vitest run tests/unit` (layerGroups is widely imported — confirm agent-compositor-surface + compositor specs stay green).

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/compositor/layerGroups.ts frontend/tests/unit/group-cascade.unit.spec.ts
git commit -m "feat(frame): group cascade resolver + upsertGroup (opacity/hidden/locked)"
```

---

### Task 2: Editor setters + selection (lock/hidden) cascade

**Files:**
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (setters `setGroupHidden/setGroupLocked/setGroupOpacity`; `hitTest` respects cascade; expose group cascade readers)

**Interfaces:**
- Consumes: Task 1 `resolveGroupCascade`, `upsertGroup`.
- Produces: editor gains `setGroupHidden(id, v)`, `setGroupLocked(id, v)`, `setGroupOpacity(id, v)` (each `recordHistory()` then `writeGroups(upsertGroup(...))`), plus `groupCascade(id)` (reads `resolveGroupCascade(id, localGroups.value)` for the panel). `hitTest` skips a layer whose effective group cascade is hidden or locked. All exported.

- [ ] **Step 1: Add setters + readers**

Add `resolveGroupCascade, upsertGroup` to the `layerGroups` import. Add near `renameGroup`:

```typescript
  function setGroupHidden(groupId: string, hidden: boolean) { recordHistory(); writeGroups(upsertGroup(localGroups.value, groupId, { hidden })) }
  function setGroupLocked(groupId: string, locked: boolean) { recordHistory(); writeGroups(upsertGroup(localGroups.value, groupId, { locked })) }
  function setGroupOpacity(groupId: string, opacity: number) { recordHistory(); writeGroups(upsertGroup(localGroups.value, groupId, { opacity: Math.max(0, Math.min(1, opacity)) })) }
  function groupCascade(groupId: string) { return resolveGroupCascade(groupId, localGroups.value) }
```

- [ ] **Step 2: Apply cascade in `hitTest`**

In `hitTest` (the loop that currently does `if (l.visible === false || l.locked) continue`), add the group cascade check right after:

```typescript
      if (l.visible === false || l.locked) continue
      const gc = resolveGroupCascade(l.groupId, localGroups.value)
      if (gc.hidden || gc.locked) continue
```

- [ ] **Step 3: Export**

Add `setGroupHidden, setGroupLocked, setGroupOpacity, groupCascade` to the returned object (near `renameGroup, ungroupGroup`).

- [ ] **Step 4: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit` (no unit change here; the hitTest cascade is browser-verified). Confirm nothing broke.

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): group hidden/locked/opacity setters + selection cascade"
```

Note in the report: hitTest cascade is browser-verification-owed.

---

### Task 3: Render cascade (visibility skip + opacity multiply)

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`paintLayerStack` optional `groups` param + cascade; `paintLayer` optional `opacityMul`)
- Modify: the `paintLayerStack` call sites that have the group registry (grep — the modal preview + the bake/output path)

**Interfaces:**
- Consumes: Task 1 `resolveGroupCascade` (+ `LayerGroup` type).
- Produces: `paintLayerStack(..., groups?: LayerGroup[])` — when `groups` present, a layer whose cascade is hidden is skipped, and its cascade opacity is passed to `paintLayer`. `paintLayer(ctx, layer, W, H, opacityMul = 1)` multiplies `layer.opacity * opacityMul` into `baseOpacity`. When `groups` absent ⇒ byte-identical to today.

- [ ] **Step 1: Read the current bodies first**

Read `paintLayer` (~line 797-895) and `paintLayerStack` (~line 1083-1176) and the `layerHidden(layer)` skip (~line 1137). Confirm `paintLayer`'s `const baseOpacity = Math.max(0, Math.min(1, layer.opacity))` (~803).

- [ ] **Step 2: Thread `opacityMul` into `paintLayer`**

Add the param and multiply it in:

```typescript
function paintLayer(ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number, H: number, opacityMul = 1) {
  const baseOpacity = Math.max(0, Math.min(1, layer.opacity * opacityMul))
```

(Everything else in `paintLayer` unchanged — the cloner loop still multiplies `baseOpacity * c.dopacity`.)

- [ ] **Step 3: Cascade in `paintLayerStack`**

Add `groups?: LayerGroup[]` as the LAST param of `paintLayerStack` (import `resolveGroupCascade`, `type LayerGroup` from `~/lib/compositor/layerGroups`). In the per-layer loop, next to the existing `if (layerHidden(layer)) continue`:

```typescript
    const gc = groups ? resolveGroupCascade(layer.groupId, groups) : null
    if (layerHidden(layer) || gc?.hidden) continue
    // ... where paintLayer(ctx, layer, W, H) is called, pass the cascade opacity:
    paintLayer(ctx, layer, W, H, gc ? gc.opacity : 1)
```

(Adapt to the exact call — `paintLayer` may be invoked via a helper like `drawLocalLayer`; thread `opacityMul` through that helper's signature the same way if needed.)

- [ ] **Step 4: Pass groups at the call sites**

Run `grep -rn "paintLayerStack(" frontend/app`. For each caller that has the local group registry available (the modal preview render and the bake/output path — the group registry is `node.data.properties.comfynext_localGroups`), pass it as the new final arg. Callers WITHOUT the registry: leave unchanged (safe — no cascade). Document in the report which callers you updated and which you left.

- [ ] **Step 5: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit` (existing compositor render specs MUST stay green — the optional param keeps no-groups behavior byte-identical).

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/composables/useCompositorLayers.ts <the updated caller file(s)>
git commit -m "feat(frame): group opacity/visibility cascade in the render path"
```

Note: render cascade is browser-verification-owed.

---

### Task 4: Group-row controls (eye / lock / opacity) in the layers panel

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (group rows: eye + lock toggles + a compact opacity control)

**Interfaces:**
- Consumes: Task 2 `setGroupHidden/setGroupLocked/setGroupOpacity/groupCascade`.

- [ ] **Step 1: Read the current row template + toggles**

Read the layer-row lock/eye buttons (~lines 2154-2168 — the `v-if="row.kind !== 'group'"` blocks) and the group-row block (~2149-2178). Note `rowHidden(row)`/`rowLocked(row)`/`toggleRowHidden`/`toggleRowLocked` for layers, and the `Eye/EyeOff/Lock/LockOpen` lucide components already imported.

- [ ] **Step 2: Add group eye + lock toggles**

For GROUP rows, add eye + lock buttons mirroring the layer ones but calling the group setters and reading the group's own field. Destructure `setGroupHidden, setGroupLocked, setGroupOpacity, groupCascade` from the editor. Add helpers in `<script setup>`:

```typescript
const groupRowHidden = (gid: string) => !!localGroups.value.find(g => g.id === gid)?.hidden
const groupRowLocked = (gid: string) => !!localGroups.value.find(g => g.id === gid)?.locked
const groupRowOpacity = (gid: string) => localGroups.value.find(g => g.id === gid)?.opacity ?? 1
```

Add the two group toggle buttons (mirror the layer markup, `v-if="row.kind === 'group'"`), calling `setGroupLocked(row.groupId, !groupRowLocked(row.groupId))` / `setGroupHidden(row.groupId, !groupRowHidden(row.groupId))`.

- [ ] **Step 3: Add a compact group opacity control**

On the group row, add a small opacity input (mirror how a layer opacity input looks elsewhere in the inspector, or a minimal `<input type="range" min="0" max="1" step="0.05">`) bound to `groupRowOpacity(row.groupId)` with `@input="setGroupOpacity(row.groupId, +$event.target.value)"`. Keep it compact (icon-sized or a narrow slider), only on group rows. If the row is too tight, place it as a hover-reveal control matching the row's existing hover affordances.

- [ ] **Step 4: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit` (confirms nothing broke).

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): group eye/lock/opacity controls in the layers panel"
```

Note: group-row UI is browser-verification-owed.

---

### Task 5: Per-layer rename

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (add `name?: string` to `LayerCommon`)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (`setLayerName`; editing state for layer rename)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (`rowLabel` uses `.name`; double-click a layer row to rename, mirroring group rename)

**Interfaces:**
- Produces: `LayerCommon` gains `name?: string`. Editor gains `setLayerName(id, name)` + editing state (`editingLayerNameId`, `layerNameDraft`, `startLayerRename(id)`, `commitLayerRename()`). `rowLabel` returns `layer.name` when set, else the current derived label.

- [ ] **Step 1: Add the field + setter + editing state**

In `useCompositorLayers.ts`, add to `LayerCommon` (near `groupName?`): `name?: string   // user-set display name (overrides the derived label)`.

In `useLocalLayerEditor.ts`, add:

```typescript
  const editingLayerNameId = ref<string | null>(null)
  const layerNameDraft = ref('')
  function setLayerName(id: string, name: string) { const nm = name.trim(); recordHistory(); commit(localLayers.value.map(l => (l.id === id ? ({ ...l, name: nm || undefined } as LocalLayer) : l))) }
  function startLayerRename(id: string) { editingLayerNameId.value = id; const l = localLayers.value.find(x => x.id === id); layerNameDraft.value = (l as any)?.name ?? '' }
  function commitLayerRename() { if (editingLayerNameId.value) setLayerName(editingLayerNameId.value, layerNameDraft.value); editingLayerNameId.value = null }
```

Export `editingLayerNameId, layerNameDraft, startLayerRename, commitLayerRename, setLayerName`.

- [ ] **Step 2: rowLabel uses the name**

In `CompositorModal.vue`, update `rowLabel`:

```typescript
function rowLabel(row: any) {
  const l = row.layer
  if (l.name) return l.name
  return l.kind === 'text' ? (l.text?.split('\n')[0] || 'Text') : l.kind
}
```

- [ ] **Step 3: Double-click a layer row to rename (mirror group rename)**

Destructure the new rename API. On the LAYER row label span (the `v-else` at ~line 2152), add `@dblclick.stop="startLayerRename(row.layer.id)"` and `title="Double-click to rename"`. Add a rename `<input>` shown `v-if="editingLayerNameId === row.layer.id"` mirroring the group-rename input (~2139-2148): `v-model="layerNameDraft"`, autofocus, `@keydown.enter.prevent="commitLayerRename"`, `@keydown.esc.prevent="editingLayerNameId = null"`, `@blur="commitLayerRename"`, `@click.stop @mousedown.stop`.

- [ ] **Step 4: Verify + commit**

Run: `cd frontend && npx vitest run tests/unit` (confirm compositor specs green; the new optional `name` field must not break any snapshot).

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/composables/useCompositorLayers.ts frontend/app/composables/useLocalLayerEditor.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): per-layer rename (double-click the layer row)"
```

Note: rename UI is browser-verification-owed.

---

## Controller browser verification (after Task 5)

On `http://localhost:3017/dev/frame-lab` (the fixture has group "Header" over "Row" [Title+rect] and "Side" [Subtitle]):
1. **Group hide** — toggle the group's eye → all its child layers vanish from the canvas; toggle back → reappear.
2. **Group opacity** — set the group opacity to ~40% → all children render dimmer.
3. **Group lock** — lock the group → clicking a child on the canvas no longer selects it (panel still can).
4. **Layer rename** — double-click a layer row, type a name, Enter → the row shows the new name; reselect to confirm it persists.
Screenshot the hidden-group and dimmed-group states + a renamed row as proof.

## Deferred (Slice 4b — its own plan)

- **Group proportional transform/resize** — a group bounding box + handles that scale/reposition all children (builds on `resizeBox`). Non-uniform group stretch with uniform-size children (text/line/path) is the ambiguous edge.
- Group inspector panel (richer than the row controls); transform cascade beyond the existing multi-select move.

## Self-Review

- **Coverage:** cascade resolver (T1, tested) applied at render-opacity (T3), render-visibility (T3), selection-lock (T2); setters + panel UI (T2/T4); layer rename (T5).
- **Regression safety:** every new field is optional; the render `groups` param is optional and defaults to byte-identical behavior; existing compositor specs must stay green each task.
- **Type consistency:** `LayerGroup.opacity/hidden/locked`, `GroupCascade`, `resolveGroupCascade`, `upsertGroup`, `setGroupHidden/Locked/Opacity`, `groupCascade`, `LayerCommon.name`, `setLayerName`/rename state — consistent across tasks.
- **Contention:** T1 layerGroups.ts, T2/T5 useLocalLayerEditor.ts, T3 useCompositorLayers.ts, T4/T5 CompositorModal.vue (shared — dirty-checked; T4 and T5 both touch it, do them in order).
