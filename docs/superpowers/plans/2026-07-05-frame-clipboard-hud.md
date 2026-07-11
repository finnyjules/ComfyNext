# Frame Slice 2 — Copy/Paste + Dimension HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app cross-frame copy/paste (Cmd+C / Cmd+V offset / Cmd+Shift+V in place) and a live dimension HUD (shown while dragging/resizing/rotating) to the Compositor/Frame modal, as pure unit-tested functions with thin wiring.

**Architecture:** Same pattern as the nudge slice — pure logic in `frontend/app/lib/compositor/` (a new `layerClipboard.ts` + a `dragHud` helper in the existing `layerEdits.ts`), wired into `useLocalLayerEditor.ts`. The shared clipboard is a module-level singleton (→ cross-frame within a session). Keyboard entry reuses the existing `mapKeyToEdit`/`handleEditorKey` path, so copy/paste needs NO new modal keydown wiring; only the HUD adds one template element to `CompositorModal.vue`.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (`tests/unit/*.unit.spec.ts`, node env).

## Global Constraints

- Work directly on `main` — do NOT create branches. Stage files explicitly by path — NEVER `git add -A` (a parallel session commits to `main` concurrently).
- Pre-flight EVERY task: `git status --short <target files>`; if any target shows FOREIGN uncommitted changes, STOP and report BLOCKED.
- No new npm dependencies. `layerClipboard.ts` imports ONLY `import type` from `useCompositorLayers`/`layerGroups`.
- Pure functions are side-effect-free and return new arrays; the ONLY stateful part is the module-level clipboard singleton in `layerClipboard.ts`.
- Figma-convention values (verbatim): offset paste = `0.02`; paste-in-place = `0`; position clamp `[-0.5, 1.5]`.
- Unit tests: `cd frontend && npx vitest run tests/unit/<file>`. Full suite before each commit: `cd frontend && npx vitest run tests/unit`. KNOWN pre-existing unrelated failures (do NOT block, note in report): gradientfx-mesh, spacetype-palette (×2), video-model-adapt.
- End every commit message body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Browser verification is done by the CONTROLLER on the running `frontend-sg` server (port 3017, `/dev/frame-lab`) after the tasks land — implementers do unit tests only.

---

### Task 1: `layerClipboard.ts` — extract / materialize / clipboard singleton

**Files:**
- Create: `frontend/app/lib/compositor/layerClipboard.ts`
- Create: `frontend/tests/unit/layer-clipboard.unit.spec.ts`

**Interfaces:**
- Produces: `ClipboardPayload = { layers: LocalLayer[]; groups: LayerGroup[] }`; `extractForCopy(layers, groups, selectedIds): ClipboardPayload | null`; `materializePaste(payload, layers, groups, offset, mkId, mkGid): { layers: LocalLayer[]; groups: LayerGroup[]; newIds: string[] }`; and singleton `setClipboard(p)`, `getClipboard()`, `hasClipboard()`, `_resetClipboard()` (tests). `materializePaste` re-ids each layer, mints one fresh group id per distinct source group (carrying the source group's `name`), offsets by `offset` in x+y (clamped), and appends on top.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/tests/unit/layer-clipboard.unit.spec.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { _resetClipboard, extractForCopy, getClipboard, hasClipboard, materializePaste, setClipboard } from '../../app/lib/compositor/layerClipboard'

const L = (id: string, x: number, y: number, groupId?: string): any => ({ id, kind: 'rect', x, y, rotation: 0, opacity: 1, w: 0.1, h: 0.1, ...(groupId ? { groupId } : {}) })
const ids = () => { let n = 0; return () => `p${++n}` }
const gids = () => { let n = 0; return () => `pg${++n}` }

describe('extractForCopy', () => {
  it('deep-clones the selected layers + referenced groups', () => {
    const src: any = { ...L('a', 0.2, 0.2, 'g1'), effects: [{ blur: 4 }] }
    const p = extractForCopy([src, L('b', 0.5, 0.5)], [{ id: 'g1', name: 'Row' }, { id: 'gX' }], new Set(['a']))!
    expect(p.layers).toHaveLength(1)
    expect(p.groups).toEqual([{ id: 'g1', name: 'Row' }])
    ;(p.layers[0] as any).effects[0].blur = 99
    expect(src.effects[0].blur).toBe(4) // independent clone
  })
  it('returns null for an empty selection', () => {
    expect(extractForCopy([L('a', 0.2, 0.2)], [], new Set())).toBeNull()
  })
})

describe('materializePaste', () => {
  it('re-ids, offsets in x+y, appends on top, selection = the new ids', () => {
    const payload = { layers: [L('a', 0.2, 0.2)], groups: [] }
    const r = materializePaste(payload, [L('z', 0.9, 0.9)], [], 0.02, ids(), gids())
    expect(r.layers).toHaveLength(2)
    expect(r.newIds).toEqual(['p1'])
    expect(r.layers[1]).toMatchObject({ id: 'p1', x: 0.22, y: 0.22 })
  })
  it('in-place paste (offset 0) keeps position', () => {
    const r = materializePaste({ layers: [L('a', 0.3, 0.3)], groups: [] }, [], [], 0, ids(), gids())
    expect(r.layers[0]).toMatchObject({ x: 0.3, y: 0.3 })
  })
  it('mints one fresh group id per source group and carries its name', () => {
    const payload = { layers: [L('a', 0.2, 0.2, 'g1'), L('b', 0.3, 0.3, 'g1')], groups: [{ id: 'g1', name: 'Row' }] }
    const r = materializePaste(payload, [], [], 0.02, ids(), gids())
    const copies = r.layers
    expect(copies[0].groupId).toBe('pg1')
    expect(copies[1].groupId).toBe('pg1')
    expect(r.groups).toContainEqual({ id: 'pg1', name: 'Row' })
  })
})

describe('clipboard singleton', () => {
  beforeEach(() => _resetClipboard())
  it('set / get / has round-trip', () => {
    expect(hasClipboard()).toBe(false)
    setClipboard({ layers: [L('a', 0.2, 0.2)], groups: [] })
    expect(hasClipboard()).toBe(true)
    expect(getClipboard()!.layers).toHaveLength(1)
  })
  it('an empty payload is not "has"', () => {
    setClipboard({ layers: [], groups: [] })
    expect(hasClipboard()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-clipboard.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// frontend/app/lib/compositor/layerClipboard.ts
/**
 * In-app clipboard for the Compositor / Frame editor. Pure copy/paste transforms
 * (mirroring layerEdits.duplicateLayers) plus a module-level singleton so paste
 * works ACROSS frame modals within a session. Deep-clones via JSON round-trip —
 * LocalLayer is plain data (see layerEdits duplicateLayers).
 */
import type { LocalLayer } from '~/composables/useCompositorLayers'
import type { LayerGroup } from '~/lib/compositor/layerGroups'

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

export interface ClipboardPayload { layers: LocalLayer[]; groups: LayerGroup[] }

/** Deep-clone the selected layers + the group registry entries they reference. */
export function extractForCopy(layers: LocalLayer[], groups: LayerGroup[], selectedIds: Set<string>): ClipboardPayload | null {
  const sel = layers.filter(l => selectedIds.has(l.id))
  if (!sel.length) return null
  const gids = new Set(sel.map(l => l.groupId).filter(Boolean) as string[])
  return {
    layers: JSON.parse(JSON.stringify(sel)) as LocalLayer[],
    groups: JSON.parse(JSON.stringify(groups.filter(g => gids.has(g.id)))) as LayerGroup[],
  }
}

/** Paste a payload into an existing layer set: fresh ids, one new group id per
 *  distinct source group (carrying its name), offset applied, appended on top. */
export function materializePaste(
  payload: ClipboardPayload,
  layers: LocalLayer[],
  groups: LayerGroup[],
  offset: number,
  mkId: () => string,
  mkGid: () => string,
): { layers: LocalLayer[]; groups: LayerGroup[]; newIds: string[] } {
  const groupMap = new Map<string, string>()
  const newIds: string[] = []
  const clones = payload.layers.map((l) => {
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
  const newGroups: LayerGroup[] = [...groups]
  for (const [src, nid] of groupMap) {
    const srcG = payload.groups.find(g => g.id === src)
    newGroups.push(srcG?.name ? { id: nid, name: srcG.name } : { id: nid })
  }
  return { layers: [...layers, ...clones], groups: newGroups, newIds }
}

// Shared in-app clipboard (module singleton → cross-frame within a session).
let _clip: ClipboardPayload | null = null
export function setClipboard(p: ClipboardPayload | null): void { _clip = p }
export function getClipboard(): ClipboardPayload | null { return _clip }
export function hasClipboard(): boolean { return !!_clip && _clip.layers.length > 0 }
export function _resetClipboard(): void { _clip = null }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/layer-clipboard.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Full suite + commit**

Run: `cd frontend && npx vitest run tests/unit`

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/layerClipboard.ts frontend/tests/unit/layer-clipboard.unit.spec.ts
git commit -m "feat(frame): layerClipboard pure copy/paste + clipboard singleton"
```

---

### Task 2: Editor copy/paste wiring + keyboard dispatch

**Files:**
- Modify: `frontend/app/lib/compositor/layerEdits.ts` (`EditAction` + `mapKeyToEdit`)
- Modify: `frontend/tests/unit/layer-edits.unit.spec.ts` (append mapKeyToEdit copy/paste cases)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (`copySelection`, `pasteClipboard`, `handleEditorKey`)

**Interfaces:**
- Consumes: Task 1's `extractForCopy`, `materializePaste`, `setClipboard`, `getClipboard`, `hasClipboard`.
- Produces: `EditAction` gains `{ type: 'copy' }` and `{ type: 'paste'; inPlace: boolean }`. Editor gains `copySelection()`, `pasteClipboard(inPlace: boolean)`, both exported. `handleEditorKey` routes Cmd/Ctrl+C→copy, Cmd/Ctrl+V→paste(offset), Cmd/Ctrl+Shift+V→paste(inPlace).

- [ ] **Step 1: Write the failing test (mapKeyToEdit)**

Append to `frontend/tests/unit/layer-edits.unit.spec.ts`:

```typescript
describe('mapKeyToEdit copy/paste', () => {
  it('maps cmd/ctrl+C to copy', () => {
    expect(mapKeyToEdit({ key: 'c', metaKey: true }, 1, 10)).toEqual({ type: 'copy' })
    expect(mapKeyToEdit({ key: 'C', ctrlKey: true }, 1, 10)).toEqual({ type: 'copy' })
  })
  it('maps cmd/ctrl+V to offset paste, +Shift to in-place', () => {
    expect(mapKeyToEdit({ key: 'v', metaKey: true }, 1, 10)).toEqual({ type: 'paste', inPlace: false })
    expect(mapKeyToEdit({ key: 'v', metaKey: true, shiftKey: true }, 1, 10)).toEqual({ type: 'paste', inPlace: true })
  })
  it('plain c/v (no meta) is null', () => {
    expect(mapKeyToEdit({ key: 'c' }, 1, 10)).toBeNull()
    expect(mapKeyToEdit({ key: 'v' }, 1, 10)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: FAIL — copy/paste not mapped.

- [ ] **Step 3: Extend `mapKeyToEdit`**

In `layerEdits.ts`, replace the `EditAction` type and add copy/paste cases at the END of `mapKeyToEdit` (after the existing duplicate case, before `return null`):

```typescript
export type EditAction =
  | { type: 'nudge'; dxPx: number; dyPx: number }
  | { type: 'duplicate' }
  | { type: 'copy' }
  | { type: 'paste'; inPlace: boolean }
```

```typescript
  const meta = e.metaKey || e.ctrlKey
  if (meta && (e.key === 'c' || e.key === 'C')) return { type: 'copy' }
  if (meta && (e.key === 'v' || e.key === 'V')) return { type: 'paste', inPlace: !!e.shiftKey }
  if (meta && (e.key === 'd' || e.key === 'D')) return { type: 'duplicate' }
  return null
```

(Remove the old standalone `if ((e.metaKey || e.ctrlKey) && (e.key === 'd' …)) return { type: 'duplicate' }` line so duplicate is only defined once — the `meta` block above now owns it.)

- [ ] **Step 4: Run to verify mapKeyToEdit passes**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: PASS (existing arrow/duplicate tests stay green).

- [ ] **Step 5: Wire copy/paste into the editor**

In `useLocalLayerEditor.ts`, add to the layerEdits import line: nothing (mapKeyToEdit already imported). Add a new import:

```typescript
import { extractForCopy, materializePaste, setClipboard, getClipboard, hasClipboard } from '~/lib/compositor/layerClipboard'
```

Add after `duplicateSelection` (which already exists):

```typescript
  /** Copy the current multi-selection to the shared in-app clipboard. */
  function copySelection() {
    const p = extractForCopy(localLayers.value, localGroups.value, selectedIds.value)
    if (p) setClipboard(p)
  }
  /** Paste the clipboard into THIS frame; offset unless inPlace. Copies become the selection. */
  function pasteClipboard(inPlace: boolean) {
    const p = getClipboard()
    if (!p) return
    recordHistory()
    const r = materializePaste(
      p, localLayers.value, localGroups.value, inPlace ? 0 : 0.02,
      () => `ll-${Date.now().toString(36)}-${++_dupSeq}`,
      () => `g-${Date.now().toString(36)}-${++_groupSeq}`,
    )
    commitBoth(r.layers as LocalLayer[], r.groups)
    selectedIds.value = new Set(r.newIds)
    selectedId.value = r.newIds[r.newIds.length - 1] ?? null
  }
```

Replace `handleEditorKey` with the routed version (paste needs a clipboard, not a selection):

```typescript
  function handleEditorKey(e: KeyboardEvent): boolean {
    const a = mapKeyToEdit(e, 1, 10)
    if (!a) return false
    if (a.type === 'paste') {
      if (!hasClipboard()) return false
      e.preventDefault(); pasteClipboard(a.inPlace); return true
    }
    if (!selectedIds.value.size) return false
    e.preventDefault()
    if (a.type === 'nudge') nudgeSelection(a.dxPx / dims().w, a.dyPx / dims().h)
    else if (a.type === 'duplicate') duplicateSelection()
    else if (a.type === 'copy') copySelection()
    return true
  }
```

Add `copySelection, pasteClipboard` to the returned object (append to the line that already ends with `handleEditorKey,`).

- [ ] **Step 6: Full suite + commit**

Run: `cd frontend && npx vitest run tests/unit`

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/layerEdits.ts frontend/tests/unit/layer-edits.unit.spec.ts frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): copy/paste (Cmd+C, Cmd+V, Cmd+Shift+V) via editor + keymap"
```

---

### Task 3: `dragHud` pure helper + `hud` computed

**Files:**
- Modify: `frontend/app/lib/compositor/layerEdits.ts` (`dragHud`)
- Modify: `frontend/tests/unit/layer-edits.unit.spec.ts` (append)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (`hud` computed, exported)

**Interfaces:**
- Produces: `dragHud(kind: 'move' | 'scale' | 'rotate' | null, info: { wPx: number; hPx: number; xPx: number; yPx: number; rotation: number }): { text: string } | null` — scale→`"W × H"`, rotate→`"N°"`, move→`"X, Y"`, null-kind→null. Editor gains a `hud` computed `{ text: string; left: number; top: number } | null` (positioned in logical-canvas px, matching the snapGuides overlay coordinate space).

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/layer-edits.unit.spec.ts`:

```typescript
import { dragHud } from '../../app/lib/compositor/layerEdits'

describe('dragHud', () => {
  const info = { wPx: 120.4, hPx: 60.6, xPx: 340.5, yPx: 200.2, rotation: 12.7 }
  it('scale → rounded W × H', () => { expect(dragHud('scale', info)).toEqual({ text: '120 × 61' }) })
  it('rotate → rounded degrees', () => { expect(dragHud('rotate', info)).toEqual({ text: '13°' }) })
  it('move → rounded X, Y', () => { expect(dragHud('move', info)).toEqual({ text: '341, 200' }) })
  it('null kind → null', () => { expect(dragHud(null, info)).toBeNull() })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: FAIL — `dragHud` not exported.

- [ ] **Step 3: Implement `dragHud`**

Append to `layerEdits.ts`:

```typescript
/** HUD text for the active drag: scale → "W × H", rotate → "N°", move → "X, Y". */
export function dragHud(
  kind: 'move' | 'scale' | 'rotate' | null,
  info: { wPx: number; hPx: number; xPx: number; yPx: number; rotation: number },
): { text: string } | null {
  if (kind === 'scale') return { text: `${Math.round(info.wPx)} × ${Math.round(info.hPx)}` }
  if (kind === 'rotate') return { text: `${Math.round(info.rotation)}°` }
  if (kind === 'move') return { text: `${Math.round(info.xPx)}, ${Math.round(info.yPx)}` }
  return null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/layer-edits.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Expose a `hud` computed from the editor**

In `useLocalLayerEditor.ts`, add `dragHud` to the layerEdits import line. Add this computed near `handlePositions` (it reads `drag`, `selected`, `boxPx`, `dims` — all in scope):

```typescript
  const hud = computed(() => {
    const d = drag.value; const l = selected.value
    if (!d || !l) return null
    const b = boxPx(l); const W = dims().w, H = dims().h
    const h = dragHud(d.type, { wPx: b.w, hPx: b.h, xPx: l.x * W, yPx: l.y * H, rotation: l.rotation })
    if (!h) return null
    return { text: h.text, left: l.x * W, top: l.y * H - b.h / 2 - 12 }
  })
```

Add `hud` to the returned object (append to the `snapGuides, marquee, …` line).

- [ ] **Step 6: Full suite + commit**

Run: `cd frontend && npx vitest run tests/unit`

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/compositor/layerEdits.ts frontend/tests/unit/layer-edits.unit.spec.ts frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): dragHud helper + hud computed (dimension readout)"
```

---

### Task 4: Render the dimension HUD in the modal

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (destructure `hud`; render one badge in the artboard overlay next to the snap guides)

**Interfaces:**
- Consumes: Task 3's `hud` computed.
- Produces: no interface change — a visual overlay only.

- [ ] **Step 1: Pre-flight + locate the snap-guide overlay**

Run: `cd frontend && git status --short app/components/vue-canvas/CompositorModal.vue` (must be clean, else BLOCKED).
Then find the snap-guide render block: `grep -n "snapGuides.vx" app/components/vue-canvas/CompositorModal.vue` (the two guide divs, ~lines 2315-2318). The HUD goes in the SAME absolutely-positioned artboard overlay so its `left`/`top` (logical-canvas px) line up with `canvasDisplay`.

- [ ] **Step 2: Add `hud` to the editor destructure**

In the big `const { … } = editor`-style destructure (the block that already pulls `snapGuides, marquee, …`), add `hud` to the list.

- [ ] **Step 3: Render the badge**

Immediately AFTER the second snap-guide `<div>` (the `snapGuides.hy` one), add:

```html
        <div v-if="hud" class="absolute px-1.5 py-0.5 rounded bg-black/80 text-white text-[11px] font-medium tabular-nums pointer-events-none whitespace-nowrap"
          :style="{ left: hud.left + 'px', top: hud.top + 'px', transform: 'translate(-50%, -100%)' }">{{ hud.text }}</div>
```

- [ ] **Step 4: Verify (unit suite unaffected) + commit**

Run: `cd frontend && npx vitest run tests/unit` (no unit change expected; confirms nothing broke).
Note in the report: the HUD render + copy/paste have NO Vue-side unit coverage — CONTROLLER browser-verifies on `/dev/frame-lab` (port 3017).

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): render live dimension HUD while dragging"
```

---

## Controller browser verification (after Task 4)

On the running `frontend-sg` server (`http://localhost:3017/dev/frame-lab`):
1. Select a layer → Cmd+C, then Cmd+V → an offset copy appears + becomes selected (Layers panel gains a row).
2. Cmd+Shift+V → a copy pastes in place (no offset).
3. Drag a layer → HUD shows `X, Y`; drag a corner handle → HUD shows `W × H`; drag the rotate handle → HUD shows `N°`.
Screenshot the copy/paste result and a HUD-during-drag frame as proof.

## Deferred to Slice 3 (the big one, already scoped)

- **Full Figma resize**: mid-edge handles for 1D resize; corner drag anchors the opposite corner; Shift constrains aspect; Alt resizes from center. (Its own plan — touches the drag state machine + handle rendering; browser-heavy.)
- System-clipboard (OS-level) copy/paste; the earlier Cmd+D-empty-selection preventDefault nit; layer rename + thumbnails.

## Self-Review

- **Coverage:** copy/paste (Task 1-2) + dimension HUD (Task 3-4) — the two smaller of the three gaps, per the chosen sequencing. Full Figma resize is Slice 3.
- **No placeholders:** every step has real test + impl code + commands.
- **Type consistency:** `ClipboardPayload`, `extractForCopy`, `materializePaste`, `set/get/hasClipboard`, `EditAction` (with copy/paste), `copySelection`/`pasteClipboard`, `dragHud`/`hud` names match across producing and consuming tasks. `_dupSeq`/`_groupSeq` reused from the nudge slice.
- **Contention:** all logic in new `layerClipboard.ts` + existing `layerEdits.ts`/`useLocalLayerEditor.ts`; the only shared-file edit is Task 4's single HUD `<div>`, done last, dirty-checked. Copy/paste needs NO modal edit (routes through the existing `handleEditorKey`).
