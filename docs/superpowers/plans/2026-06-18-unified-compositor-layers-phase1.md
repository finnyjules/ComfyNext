# Unified Compositor Layers — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wired (graph-slot) and local layers behave identically in the Compositor — one inspector, and silhouette masking that works for any layer masking any other — verified in the editor and the frame's own client-side Render output.

**Architecture:** Promote the existing `StackKey` (`w:<slot>` / `l:<id>`) into the layer model and the mask system. The frontend Canvas-2D renderer (`paintLayerStack`) gains a general "mask any item by any other item's silhouette" path. Wired-layer treatments (mask reference) persist on the node as `comfynext_wiredTreatments`. The inspector binds to a normalized `EditorLayer` façade so both kinds render the same panel. A per-frame **Render** button composites the static stack client-side and tracks a fresh/stale state.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest unit tests, Canvas-2D rendering. Frontend only — no Python changes in Phase 1.

**Out of scope (Phase 2, separate plan):** compiling wired-layer masks into the backend `layer{i}_mask` input for server-side graph-run parity; shadow/blur effects on wired layers via submit-time bake; extending `motionSourceKey` to wired treatments.

**Spec:** `docs/superpowers/specs/2026-06-18-unified-compositor-layer-model-design.md` (Sections 1, 2, 5, 6).

---

## File Structure

- `frontend/app/composables/useCompositorLayers.ts` — add `maskedByKey` to `LayerCommon`; export `layerMaskRef()`; add `key` to `StackItem`; generalize `paintLayerStack` mask resolution across sources; export `drawLayerSilhouette()` helper.
- `frontend/tests/unit/layer-mask-ref.unit.spec.ts` — **new** — unit tests for `layerMaskRef()`.
- `frontend/tests/unit/cross-source-mask.unit.spec.ts` — **new** — unit tests for cross-source mask resolution in `paintLayerStack`.
- `frontend/app/components/vue-canvas/CompositorModal.vue` — `buildStackItems()` adds `key` + applies wired masks; `maskCandidates`/`setLayerMaskedBy`/`layerLabel` go cross-source; new `comfynext_wiredTreatments` read/write; unified inspector (move the Mask block to a shared section visible for wired too); Render button + static stale state.
- `frontend/tests/unit/wired-treatments.unit.spec.ts` — **new** — unit tests for the treatments read/write + cross-source candidate helpers (extracted to a testable module — see Task 4).
- `frontend/app/composables/useWiredTreatments.ts` — **new** — pure helpers for reading/writing `comfynext_wiredTreatments` and building cross-source mask candidates, so the logic is unit-testable outside the `.vue` SFC.

---

## Task 1: Generalize the mask reference to a StackKey

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`LayerCommon` ~line 101-119; add exported helper near line 122)
- Test: `frontend/tests/unit/layer-mask-ref.unit.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/layer-mask-ref.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { layerMaskRef } from '~/composables/useCompositorLayers'

describe('layerMaskRef', () => {
  it('returns the explicit StackKey when maskedByKey is set', () => {
    expect(layerMaskRef({ maskedByKey: 'w:2' })).toBe('w:2')
    expect(layerMaskRef({ maskedByKey: 'l:abc' })).toBe('l:abc')
  })
  it('upgrades a legacy local maskedById to an l: key', () => {
    expect(layerMaskRef({ maskedById: 'abc' })).toBe('l:abc')
  })
  it('prefers maskedByKey over a legacy maskedById', () => {
    expect(layerMaskRef({ maskedByKey: 'w:1', maskedById: 'abc' })).toBe('w:1')
  })
  it('returns undefined when neither is set', () => {
    expect(layerMaskRef({})).toBeUndefined()
    expect(layerMaskRef({ maskedById: '' })).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/layer-mask-ref.unit.spec.ts`
Expected: FAIL — `layerMaskRef is not a function` / not exported.

- [ ] **Step 3: Add the field and helper**

In `LayerCommon` (after the `maskedById?: string` line ~115), add:

```ts
  maskedById?: string     // DEPRECATED legacy local-only ref; read via layerMaskRef()
  maskedByKey?: string     // clipped by another layer's silhouette; a StackKey ('w:<slot>'|'l:<id>')
```

After `layerHidden` (~line 124), add:

```ts
/**
 * The StackKey of the layer this one is masked by, or undefined. Prefers the
 * new cross-source `maskedByKey`; falls back to the legacy local-only
 * `maskedById` (interpreted as `l:<id>`) so old frames keep rendering.
 */
export function layerMaskRef(
  l: { maskedByKey?: string; maskedById?: string } | null | undefined,
): string | undefined {
  if (l?.maskedByKey) return l.maskedByKey
  if (l?.maskedById) return `l:${l.maskedById}`
  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/layer-mask-ref.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/layer-mask-ref.unit.spec.ts
git commit -m "feat(compositor): add cross-source maskedByKey + layerMaskRef helper"
```

---

## Task 2: Give StackItem a key and a silhouette renderer

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`StackItem` ~line 803; add `drawLayerSilhouette` export)
- Test: covered by Task 3's cross-source test (this task is a type/helper change with no standalone behavior).

- [ ] **Step 1: Extend the StackItem type**

Replace the `StackItem` definition (~line 803):

```ts
export type StackItem =
  | { type: 'wired'; key: string; draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void }
  | { type: 'local'; key: string; layer: LocalLayer }
```

- [ ] **Step 2: Add a silhouette renderer that works for either item kind**

Add near `drawLocalLayer` (~line 566):

```ts
/**
 * Render an item's alpha silhouette (full opacity, no effects/blend) onto `ctx`,
 * sized W×H. Used as the clip source for another item's mask. Wired items render
 * via their draw closure; local items via their own paint (no nested mask).
 */
export function drawLayerSilhouette(ctx: CanvasRenderingContext2D, item: StackItem, W: number, H: number) {
  if (item.type === 'wired') { item.draw(ctx, W, H); return }
  const ghost = { ...item.layer, opacity: 1, effects: undefined, blend: undefined } as LocalLayer
  drawLocalLayerSelf(ctx, ghost, W, H)
}
```

- [ ] **Step 3: Verify the project still type-checks / builds**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i compositorlayers || echo "no useCompositorLayers type errors"`
Expected: `no useCompositorLayers type errors` (callers updated in Task 3; `drawLocalLayerSelf` is already module-scoped).

> Note: existing `StackItem` constructors (CompositorModal `buildStackItems`, bake.ts) now miss `key` — they are fixed in Tasks 3 and 6. If type-check is run before those, expect "missing property key" at those call sites only.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts
git commit -m "feat(compositor): StackItem carries key + drawLayerSilhouette for any source"
```

---

## Task 3: Cross-source mask resolution in paintLayerStack

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`paintLayerStack` ~line 849-905)
- Test: `frontend/tests/unit/cross-source-mask.unit.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/cross-source-mask.unit.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { paintLayerStack, type StackItem } from '~/composables/useCompositorLayers'

// A tagged 2D-context stub. Offscreen canvases created inside the renderer get
// their own ('offscreen'); the main ctx we pass in is tagged 'main' so we can
// assert WHICH ctx a draw closure was handed.
function stubCtx(tag = 'ctx') {
  const ctx: any = {
    _tag: tag,
    canvas: { width: 10, height: 10 },
    save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(),
    clearRect: vi.fn(), setTransform: vi.fn(), getTransform: () => ({ a: 1 }),
    beginPath: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), clip: vi.fn(), fillRect: vi.fn(),
    globalCompositeOperation: 'source-over', filter: 'none', globalAlpha: 1,
  }
  return ctx
}

beforeEach(() => {
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') return { width: 0, height: 0, getContext: () => stubCtx('offscreen') } as any
    return {} as any
  }) as any)
})

describe('paintLayerStack cross-source masking', () => {
  it('skips the mask-source layer from top-level paint and stamps the masked result', () => {
    const mainCtx = stubCtx('main')
    const drawA = vi.fn() // wired mask source w:2
    const drawB = vi.fn() // wired content w:1, masked by w:2
    const items: StackItem[] = [
      { type: 'wired', key: 'w:2', draw: drawA },
      { type: 'wired', key: 'w:1', draw: drawB },
    ]
    paintLayerStack(mainCtx, 10, 10, items, [], undefined, undefined, undefined, {
      'w:1': { maskedByKey: 'w:2' },
    })
    // Neither content nor mask source is drawn DIRECTLY on the main ctx — both
    // render onto offscreens; only the composited result is stamped on main.
    expect(drawA).toHaveBeenCalled()
    expect(drawA.mock.calls.every((c: any[]) => c[0] !== mainCtx)).toBe(true)
    expect(drawB).toHaveBeenCalled()
    expect(drawB.mock.calls.every((c: any[]) => c[0] !== mainCtx)).toBe(true)
    // The masked result is stamped onto the main ctx exactly once.
    expect(mainCtx.drawImage).toHaveBeenCalledTimes(1)
  })

  it('renders an unmasked wired item directly onto the main ctx', () => {
    const mainCtx = stubCtx('main')
    const draw = vi.fn()
    const items: StackItem[] = [{ type: 'wired', key: 'w:1', draw }]
    paintLayerStack(mainCtx, 10, 10, items, [], undefined, undefined, undefined, {})
    expect(draw).toHaveBeenCalledTimes(1)
    expect(draw.mock.calls[0][0]).toBe(mainCtx) // drawn directly, no offscreen
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/cross-source-mask.unit.spec.ts`
Expected: FAIL — `paintLayerStack` ignores the 9th `wiredTreatments` arg, so it paints `w:2` directly on the main ctx and never routes `w:1` through an offscreen (the `mainCtx.drawImage` / "not on main ctx" assertions fail).

- [ ] **Step 3: Generalize paintLayerStack**

Replace the `paintLayerStack` signature and body (~line 849-905) with the version below. It adds a `wiredTreatments` param (`{ [key]: { maskedByKey?: string } }`), builds a key→item map, resolves each item's mask reference across sources, skips mask-source items, and routes masked items (wired or local) through a shared silhouette-clip path.

```ts
export function paintLayerStack(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  items: StackItem[],
  localLayers: LocalLayer[],
  skip?: (layer: LocalLayer) => boolean,
  t?: number,
  motion?: { fps: number; duration: number },
  /** Per-key treatments for wired layers (mask ref). Locals carry their own. */
  wiredTreatments?: Record<string, { maskedByKey?: string }>,
) {
  const byKey = new Map(items.map(it => [it.key, it]))
  // Resolve every item's mask reference (local → layerMaskRef; wired → treatments).
  const maskRefOf = (it: StackItem): string | undefined =>
    it.type === 'local' ? layerMaskRef(it.layer) : wiredTreatments?.[it.key]?.maskedByKey
  // Keys used as a mask source by someone → those items only clip, never self-paint.
  const maskSourceKeys = new Set<string>()
  for (const it of items) { const r = maskRefOf(it); if (r) maskSourceKeys.add(r) }

  for (const item of items) {
    if (maskSourceKeys.has(item.key)) continue

    if (item.type === 'wired') {
      const ref = maskRefOf(item)
      const maskItem = ref ? byKey.get(ref) ?? null : null
      if (maskItem) { drawItemMasked(ctx, item, maskItem, W, H, 'source-over'); continue }
      item.draw(ctx, W, H)
      continue
    }

    const layer = item.layer
    if (layerHidden(layer)) continue
    if (skip?.(layer)) continue

    const ref = layerMaskRef(layer)
    const maskItem = ref ? byKey.get(ref) ?? null : null
    // Local mask source resolved cross-source — pass its LocalLayer when local,
    // else use the generic masked-item path for a wired silhouette.
    const motionActive = t !== undefined && motion && _motionPainterImpl
      && (layer.animation || (maskItem?.type === 'local' && maskItem.layer.animation))
    if (motionActive) {
      const { motionStateFor, drawLayerWithMotion, identityState } = _motionPainterImpl!
      const st = layer.animation ? motionStateFor(layer, t!, motion!) : identityState()
      if (st) {
        if (!st.visible) continue
        const maskLocal = maskItem?.type === 'local' ? maskItem.layer : null
        const maskState = maskLocal?.animation ? motionStateFor(maskLocal, t!, motion!) : null
        if (maskState && !maskState.visible) continue
        const bgBlur = layer.effects?.find(
          (e): e is BackgroundBlurEffect => e.type === 'background_blur' && e.visible,
        )
        if (bgBlur) applyBackdropBlur(ctx, layer, localLayers, W, H, bgBlur.radius)
        drawLayerWithMotion(ctx, layer, W, H, maskLocal, st, maskState)
        continue
      }
    }
    const bgBlur = layer.effects?.find(
      (e): e is BackgroundBlurEffect => e.type === 'background_blur' && e.visible,
    )
    if (bgBlur) applyBackdropBlur(ctx, layer, localLayers, W, H, bgBlur.radius)

    if (maskItem && maskItem.type !== 'local') {
      // Wired silhouette masking a local layer → generic path.
      drawItemMasked(ctx, item, maskItem, W, H, localBlendOp(layer))
    } else {
      drawLocalLayer(ctx, layer, W, H, maskItem?.type === 'local' ? maskItem.layer : null)
    }
  }
}

/**
 * Render an item's REAL content onto `ctx` (wired image via its draw closure,
 * which folds the wired layer's own opacity/blend; local via `drawLocalLayerSelf`,
 * which includes the layer's crop). This is NOT a silhouette — full pixels,
 * opacity and effects are preserved. Wrapped in save/restore for wired closures
 * (they have no state-hygiene contract). Generalizes the original drawLocalLayer
 * mask path (which used drawLocalLayerSelf for both content and mask) to wired.
 */
function drawItemContent(ctx: CanvasRenderingContext2D, item: StackItem, W: number, H: number) {
  if (item.type === 'wired') { ctx.save(); item.draw(ctx, W, H); ctx.restore(); return }
  drawLocalLayerSelf(ctx, item.layer, W, H)
}

/**
 * Draw `content` clipped to `mask`'s alpha, then stamp onto `ctx` with `blendOp`.
 * Both render their REAL paint on separate offscreens (mirrors the original
 * drawLocalLayer path), then destination-in keeps only where the mask is opaque.
 * NOTE (Phase 1 limitation): when `content` is a WIRED layer with a non-normal
 * blend mode, that blend is folded inside its draw closure against the
 * transparent offscreen (no backdrop), so it is effectively lost while masked —
 * pass blendOp 'source-over' for wired content. Local content stamps with its
 * own blend (re-applied here against the real backdrop, exactly as before).
 */
function drawItemMasked(
  ctx: CanvasRenderingContext2D,
  content: StackItem,
  mask: StackItem,
  W: number,
  H: number,
  blendOp: string,
) {
  const off = document.createElement('canvas')
  off.width = Math.max(1, Math.round(W)); off.height = Math.max(1, Math.round(H))
  const octx = off.getContext('2d'); if (!octx) return
  drawItemContent(octx, content, W, H)
  const maskOff = document.createElement('canvas')
  maskOff.width = off.width; maskOff.height = off.height
  const mctx = maskOff.getContext('2d'); if (!mctx) return
  drawItemContent(mctx, mask, W, H)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(maskOff, 0, 0)
  octx.globalCompositeOperation = 'source-over'
  ctx.save()
  ctx.globalCompositeOperation = blendOp as GlobalCompositeOperation
  ctx.drawImage(off, 0, 0)
  ctx.restore()
}
```

Ensure `layerMaskRef` is visible (same module — it is). Keep the existing `drawLocalLayer`/`drawLocalLayerSelf` for the local-content + local-mask fast path (zero behavior change there). `drawLayerSilhouette` (Task 2) is NOT used here — it is reserved for Phase 2's submit-time mask compile, which needs a pure alpha silhouette PNG.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/cross-source-mask.unit.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing mask invariant test (no regression)**

Run: `cd frontend && npx vitest run tests/unit/layer-mask-composite.unit.spec.ts`
Expected: PASS (existing local-mask invariants still hold). If it calls `paintLayerStack` positionally, the new trailing optional arg is backward-compatible; if it constructs `StackItem`s, add `key` to them.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/cross-source-mask.unit.spec.ts
git commit -m "feat(compositor): paintLayerStack masks any item by any other (cross-source)"
```

---

## Task 4: Wired-treatments store + cross-source candidate helpers (testable module)

**Files:**
- Create: `frontend/app/composables/useWiredTreatments.ts`
- Test: `frontend/tests/unit/wired-treatments.unit.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/wired-treatments.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { readWiredTreatments, setWiredMask, maskCandidateKeys } from '~/composables/useWiredTreatments'

function node() { return { data: { properties: {} as any } } }

describe('wired treatments store', () => {
  it('reads an empty map when unset', () => {
    expect(readWiredTreatments(node())).toEqual({})
  })
  it('writes and reads a wired mask ref keyed by w:<slot>', () => {
    const n = node()
    setWiredMask(n, 2, 'w:1')
    expect(readWiredTreatments(n)['w:2']).toEqual({ maskedByKey: 'w:1' })
  })
  it('clears a wired mask ref when key is empty', () => {
    const n = node()
    setWiredMask(n, 2, 'w:1')
    setWiredMask(n, 2, '')
    expect(readWiredTreatments(n)['w:2']).toBeUndefined()
  })
})

describe('maskCandidateKeys', () => {
  it('returns every other layer key regardless of source, excluding self', () => {
    const present = ['w:1', 'w:2', 'l:abc']
    expect(maskCandidateKeys(present, 'w:1')).toEqual(['w:2', 'l:abc'])
    expect(maskCandidateKeys(present, 'l:abc')).toEqual(['w:1', 'w:2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/wired-treatments.unit.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

```ts
// frontend/app/composables/useWiredTreatments.ts
/**
 * Per-wired-layer treatments (Phase 1: mask reference) persisted on the node as
 * `comfynext_wiredTreatments`, keyed by the unified StackKey ('w:<slot>'). This
 * mirrors how comfynext_stackOrder lives in node.data.properties. Pure helpers so
 * the logic is unit-testable outside the SFC.
 */
export interface WiredTreatment { maskedByKey?: string }
export type WiredTreatments = Record<string, WiredTreatment>

export function readWiredTreatments(node: any): WiredTreatments {
  return (node?.data?.properties?.comfynext_wiredTreatments as WiredTreatments | undefined) ?? {}
}

function writeWiredTreatments(node: any, next: WiredTreatments) {
  if (!node?.data) return
  if (!node.data.properties) node.data.properties = {}
  node.data.properties.comfynext_wiredTreatments = next
}

/** Set/clear the mask reference for a wired slot (1-based). Empty key clears. */
export function setWiredMask(node: any, slot: number, maskedByKey: string) {
  const key = `w:${slot}`
  const cur = { ...readWiredTreatments(node) }
  if (maskedByKey) cur[key] = { ...cur[key], maskedByKey }
  else { const t = { ...cur[key] }; delete t.maskedByKey; if (Object.keys(t).length) cur[key] = t; else delete cur[key] }
  writeWiredTreatments(node, cur)
}

/** Every other present layer key (cross-source), excluding `selfKey`. */
export function maskCandidateKeys(presentKeys: string[], selfKey: string): string[] {
  return presentKeys.filter(k => k !== selfKey)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/wired-treatments.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useWiredTreatments.ts frontend/tests/unit/wired-treatments.unit.spec.ts
git commit -m "feat(compositor): wired-treatments store + cross-source mask candidates"
```

---

## Task 5: Wire the renderer to treatments + cross-source masking in the modal

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` — `buildStackItems` (~978), `renderStack` (~991-1004), imports (~9-17), `maskCandidates`/`layerLabel`/`setLayerMaskedBy` (~1152-1154).
- Test: manual (rendering wiring) — covered by the visual check in Task 8. No new unit test (SFC glue).

- [ ] **Step 1: Import the new helpers**

In the `useCompositorLayers` import block (~line 9-12) add `layerMaskRef`:

```ts
import {
  type TextLayer, type RectLayer, type EllipseLayer, type LocalLayer, type StackItem,
  drawLocalLayer, drawWiredImageLayer, ensureLayerFonts, ensureLayerImages, paintLayerStack,
  layerMaskRef,
} from '~/composables/useCompositorLayers'
```

After the existing imports (~line 24) add:

```ts
import { readWiredTreatments, setWiredMask, maskCandidateKeys } from '~/composables/useWiredTreatments'
```

- [ ] **Step 2: Add `key` to StackItems and pass treatments through render**

Update `buildStackItems` (~978) so each item carries its key:

```ts
function buildStackItems(): StackItem[] {
  return stackKeys.value.map((key): StackItem | null => {
    const r = resolveStackKey(key)
    if (!r) return null
    if (r.type === 'wired') {
      if (hiddenWired.value.has((r.layer as Layer).slot)) return null
      return { type: 'wired', key, draw: (c, w, h) => drawWiredLayer(c, r.layer as Layer, w, h) }
    }
    return { type: 'local', key, layer: r.layer as LocalLayer }
  }).filter((x): x is StackItem => x != null)
}
```

Add a computed for the treatments and pass it to `paintLayerStack` in `renderStack` (~1002):

```ts
const wiredTreatments = computed(() => readWiredTreatments(compositor.value))
```

```ts
  paintLayerStack(ctx, W, H, items, localLayers.value as LocalLayer[], l =>
    l.id === editingId.value || (nodeEdit.active.value && l.id === nodeEdit.layerId.value),
    previewT.value ?? undefined, previewT.value != null ? motionDoc.value : undefined,
    wiredTreatments.value)
```

- [ ] **Step 3: Re-render when treatments change**

Add `JSON.stringify(wiredTreatments.value)` to the `renderStack` watch source array (~line 1006-1014), alongside the existing `comfynext_hiddenWired` entry:

```ts
    JSON.stringify(readSlotArr('comfynext_hiddenWired')),
    JSON.stringify(wiredTreatments.value),
```

- [ ] **Step 4: Make the mask helpers cross-source**

Replace `maskCandidates`/`layerLabel`/`setLayerMaskedBy` (~1152-1154) with key-based, cross-source versions:

```ts
function layerLabelByKey(key: StackKey): string {
  const r = resolveStackKey(key)
  if (!r) return key
  if (r.type === 'wired') return `Layer ${(r.layer as Layer).slot}`
  return `${r.layer.kind} ${String(r.layer.id).slice(-4)}`
}
// Candidate mask sources for the selected layer: every other present layer.
function maskCandidates(selfKey: StackKey): { key: StackKey; label: string }[] {
  return maskCandidateKeys(presentKeys.value, selfKey).map(k => ({ key: k, label: layerLabelByKey(k) }))
}
// Current mask ref for any selected key (local → layerMaskRef; wired → treatments).
function currentMaskRef(key: StackKey): string {
  const r = resolveStackKey(key)
  if (!r) return ''
  if (r.type === 'local') return layerMaskRef(r.layer) ?? ''
  return wiredTreatments.value[key]?.maskedByKey ?? ''
}
// Set the mask ref for any selected key.
function setMaskRef(key: StackKey, ref: string) {
  const r = resolveStackKey(key)
  if (!r) return
  if (r.type === 'local') setLocal(r.layer.id, { maskedByKey: ref || undefined, maskedById: undefined } as any)
  else setWiredMask(compositor.value, (r.layer as Layer).slot, ref)
}
```

- [ ] **Step 5: Type-check passes**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "CompositorModal|useWiredTreatments|useCompositorLayers" || echo "no relevant type errors"`
Expected: `no relevant type errors`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): route renderer through wired treatments; cross-source mask helpers"
```

---

## Task 6: Update remaining StackItem constructors (bake)

**Files:**
- Modify: `frontend/app/lib/motion/bake.ts` (and any other `{ type: 'wired'` / `{ type: 'local'` literal).
- Test: existing bake/motion tests.

- [ ] **Step 1: Find every StackItem literal missing `key`**

Run: `cd frontend && grep -rn "type: 'wired'\|type: 'local'" app | grep -v "buildStackItems"`
Expected: a short list (e.g. bake.ts, any fixtures). For each, ensure a `key` is present.

- [ ] **Step 2: Fix bake.ts items**

`bakeMotionFrames` receives `buildItems: () => StackItem[]` (the modal passes `buildStackItems`, already keyed after Task 5), so bake.ts itself likely needs no change. If any local literal exists in bake/test fixtures, add `key` (e.g. `key: 'l:' + layer.id` for local, `key: 'w:' + slot` for wired).

- [ ] **Step 3: Type-check + run motion/bake unit tests**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "type: " || echo "no StackItem literal errors"`
Run: `cd frontend && npx vitest run tests/unit --silent 2>&1 | tail -5`
Expected: no type errors from StackItem literals; unit suite green.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/motion/bake.ts
git commit -m "fix(compositor): keyed StackItem literals after type change"
```

---

## Task 7: Unified inspector — Mask control visible for wired layers + Render button

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` — wired-layer inspector branch (`<template v-else>` ~2408-2469); add Render button near the header/toolbar.
- Test: manual + visual (Task 8).

- [ ] **Step 1: Add the Mask control to the wired inspector branch**

In the wired-layer properties (`v-if="selected"` block, after the Blend mode grid ~line 2468, before the closing `</div>`), add a Mask dropdown mirroring the local one but keyed:

```vue
          <!-- Mask: clip this layer to another layer's silhouette (cross-source) -->
          <div>
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Mask</div>
            <select :value="currentMaskRef(wiredKey(selected.slot))"
              class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none cursor-pointer"
              @change="setMaskRef(wiredKey(selected.slot), ($event.target as HTMLSelectElement).value)">
              <option value="">No mask</option>
              <option v-for="o in maskCandidates(wiredKey(selected.slot))" :key="o.key" :value="o.key">Mask with {{ o.label }}</option>
            </select>
          </div>
```

- [ ] **Step 2: Point the LOCAL inspector's Mask control at the same cross-source helpers**

Replace the local Mask block (~2343-2352) options + handlers to use the keyed helpers (so a local layer can also be masked by a wired layer):

```vue
          <!-- Layer mask: clip this layer to another layer's silhouette -->
          <div class="mt-3">
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Mask</div>
            <select :value="currentMaskRef(localKey(selectedLocal!.id))"
              class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
              @change="setMaskRef(localKey(selectedLocal!.id), ($event.target as HTMLSelectElement).value)">
              <option value="">No mask</option>
              <option v-for="o in maskCandidates(localKey(selectedLocal!.id))" :key="o.key" :value="o.key">Mask with {{ o.label }}</option>
            </select>
          </div>
```

- [ ] **Step 3: Add static-frame stale state + Render action**

Add near `motionStale` (~934) a static fresh/stale tracker. The static composite is "stale" when the layer/treatment state changed since the last Render. Store the last-rendered key on node properties.

```ts
// Static Render freshness: hash the inputs that affect the client-side composite.
function staticSourceKey(): string {
  const { W, H } = bakeSize()
  const s = JSON.stringify({
    local: localLayers.value, order: stackKeys.value,
    treatments: wiredTreatments.value, wired: layers.value, W, H,
  })
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}
const lastRenderKey = computed<string | null>(() =>
  (compositor.value?.data?.properties as any)?.comfynext_renderKey ?? null)
const renderStale = computed(() => lastRenderKey.value !== staticSourceKey())

async function renderFrame() {
  const node = compositor.value
  if (!node) return
  if (previewT.value != null) { await bakeMotion(); return } // motion frame → existing bake
  // Static frame: composite the unified stack client-side to the node output.
  const { W, H } = bakeSize()
  const blob = await renderStaticComposite(W, H) // see Step 4
  if (!blob) return
  const file = new File([blob], `comfynext_frame_${node.id}_${Date.now()}.png`, { type: 'image/png' })
  const fd = new FormData(); fd.append('image', file); fd.append('overwrite', 'true')
  try {
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(await res.text() || `upload ${res.status}`)
    const name = (await res.json())?.name || file.name
    const p = (node.data.properties ||= {})
    p.comfynext_renderKey = staticSourceKey()
    node.data.images = [`/view?${new URLSearchParams({ filename: name, type: 'input' })}`]
  } catch (err) { console.error('[compositor render]', err) }
}
```

- [ ] **Step 4: Add the static composite helper**

Add near `renderStack` (~991):

```ts
// Render the static unified stack to a PNG blob at W×H (no motion, no preview skip).
async function renderStaticComposite(W: number, H: number): Promise<Blob | null> {
  const off = document.createElement('canvas')
  off.width = Math.max(1, Math.round(W)); off.height = Math.max(1, Math.round(H))
  const ctx = off.getContext('2d'); if (!ctx) return null
  await ensureLayerImages(localLayers.value as LocalLayer[])
  await ensureLayerFonts(localLayers.value as LocalLayer[], W)
  paintLayerStack(ctx, W, H, buildStackItems(), localLayers.value as LocalLayer[],
    undefined, undefined, undefined, wiredTreatments.value)
  return await new Promise<Blob | null>(resolve => off.toBlob(b => resolve(b), 'image/png'))
}
```

- [ ] **Step 5: Add the Render button to the toolbar header**

Add to the Compositor header (near the close button ~line 1569) a primary action with a stale dot:

```vue
        <button
          class="ml-auto mr-2 h-8 px-3 rounded-md text-[12px] font-medium flex items-center gap-1.5 cursor-pointer"
          :class="renderStale ? 'bg-emerald-500/90 hover:bg-emerald-500 text-black' : 'bg-white/[0.06] hover:bg-white/12 text-white/85'"
          :title="renderStale ? 'Frame output is out of date — click to render' : 'Frame output is up to date'"
          @click="renderFrame">
          <Play class="size-3" />
          {{ renderStale ? 'Render' : 'Rendered' }}
        </button>
```

(`Play` is already imported, line 26.)

- [ ] **Step 6: Type-check passes**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i CompositorModal || echo "no CompositorModal type errors"`
Expected: `no CompositorModal type errors`.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): unified Mask control for wired layers + per-frame Render button"
```

---

## Task 8: Visual verification (REQUIRED — no visual effect ships on unit tests alone)

**Files:** none (verification only). Per the project's standing rule, a WebGL/Canvas visual change must be verified by screenshot and signed off, not unit tests alone.

- [ ] **Step 1: Start the dev server and ComfyUI backend**

Run (background): `cd frontend && npm run dev`
Run (background): `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`

- [ ] **Step 2: Reproduce the original scenario**

In the app: open a Frame/Compositor with two wired image inputs (the user's case — `Layer 1` = a photo, `Layer 2` = a transparent-background silhouette). Select Layer 1, open the now-present **Mask** dropdown, choose **Mask with Layer 2**.

- [ ] **Step 3: Capture and confirm the masked preview**

Use the preview screenshot tool to capture the editor canvas. Expected: Layer 1 is clipped to Layer 2's silhouette.

- [ ] **Step 4: Confirm Render produces a matching output image**

Click **Render**. Expected: the button returns to "Rendered" state; the node's output image (`node.data.images[0]`) shows the masked composite. Screenshot it. Then change a transform on a layer → button flips back to "Render" (stale).

- [ ] **Step 5: Get look sign-off**

Share both screenshots (masked preview + rendered output) with the user and confirm the look before considering Phase 1 done. Record sign-off.

---

## Self-Review

- **Spec coverage:** Section 1 (unified identity/inspector) → Tasks 5, 7. Section 2 (cross-source masking renderer) → Tasks 2, 3. Section 5 (persistence/migration: `maskedByKey` + legacy fallback + `comfynext_wiredTreatments`) → Tasks 1, 4. Section 6 (Render button + static stale) → Task 7. Sections 3 & 4 (backend compile + effects bake) are explicitly Phase 2 (separate plan). Visual rule → Task 8.
- **Naming consistency:** `layerMaskRef`, `drawLayerSilhouette`, `drawItemMasked`, `readWiredTreatments`/`setWiredMask`/`maskCandidateKeys`, `currentMaskRef`/`setMaskRef`/`maskCandidates`(key-based)/`layerLabelByKey`, `wiredTreatments` computed, `staticSourceKey`/`renderStale`/`renderFrame`/`renderStaticComposite`, property keys `comfynext_wiredTreatments`/`comfynext_renderKey`. Consistent across tasks.
- **Placeholder scan:** none — every code step is concrete.
- **Risk note:** Task 3 rewrites a hot render function; Task 3 Step 5 explicitly re-runs the existing `layer-mask-composite` invariants to catch regressions, and Task 8 verifies visually.
```
