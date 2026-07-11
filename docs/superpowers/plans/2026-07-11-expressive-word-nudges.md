# Expressive Word Nudges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag individual words of an expressive Smart Layout text element; the offsets persist as relative, box-fraction nudges applied identically in the editor and the satori render.

**Architecture:** Nudges live in `style.expressive.nudges` (word index → `{dx, dy}` fractions of the element box) and are applied in the shared adapter `gridExpressiveLayout()` that BOTH the editor DOM and the satori export already call — parity is structural. The editor extends the existing double-click reposition mode to expressive text; the property panel clears nudges whenever an engine param changes.

**Tech Stack:** Vue 3 SFC (Nuxt 4), TypeScript, vitest. All frontend; no backend/ComfyUI changes.

**Spec:** `docs/superpowers/specs/2026-07-11-expressive-word-nudges-design.md`

## Global Constraints

- Working dir for all commands: `/Users/julien/Documents/GitHub/Sailor/frontend`
- The core engine `shared/text-layout/expressive.ts` must NOT change (it is shared with the Frame compositor).
- `dx`/`dy` are fractions of the element box (dx × boxWidth px), NOT pixels.
- Layouts without `nudges` must produce byte-identical output to today.
- The repo has many pre-existing typecheck errors (~328); only new errors in touched files matter.
- Other sessions have uncommitted changes in this repo — `git add` ONLY the files listed in each task's commit step, never `git add -A`.

---

### Task 1: Nudge application + merge helper in the shared adapter

**Files:**
- Modify: `shared/template-grid/types.ts` (~line 106, `TextStyleV2.expressive` field + new types near it)
- Modify: `shared/template-grid/expressive.ts`
- Test: `tests/unit/template-grid-expressive.unit.spec.ts`

**Interfaces:**
- Consumes: `layoutExpressive`, `ExpressiveParams` from `shared/text-layout/expressive.ts` (unchanged).
- Produces:
  - `interface WordNudge { dx: number; dy: number }` and `interface GridExpressiveParams extends ExpressiveParams { nudges?: Record<number, WordNudge> }` exported from `shared/template-grid/types.ts`.
  - `gridExpressiveLayout(opts)` — same signature, but `opts.params: GridExpressiveParams`; applies `params.nudges` post-layout with clamping.
  - `mergeExpressivePatch(current: GridExpressiveParams, patch: Partial<GridExpressiveParams>): GridExpressiveParams` exported from `shared/template-grid/expressive.ts` — merges a panel patch, dropping `nudges` when the patch touches any engine key (`wordsPerLine`, `placement`, `jitterX`, `jitterY`, `seed`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/template-grid-expressive.unit.spec.ts` (keep the existing `params()` helper; add `mergeExpressivePatch` to the import from `~~/shared/template-grid/expressive`):

```ts
import { gridExpressiveLayout, expressiveVOffset, mergeExpressivePatch } from '~~/shared/template-grid/expressive'

describe('word nudges', () => {
  const base = () => gridExpressiveLayout({
    content: 'alpha beta', fontSize: 20, boxWidth: 300, boxHeight: 400, lineHeight: 1.5,
    params: params(),
  })
  const nudged = (nudges: any, boxWidth = 300) => gridExpressiveLayout({
    content: 'alpha beta', fontSize: 20, boxWidth, boxHeight: 400, lineHeight: 1.5,
    params: params({ nudges } as any),
  })

  it('moves the nudged word by dx×boxWidth / dy×boxHeight, leaves others alone', () => {
    const lay = nudged({ 1: { dx: 0.1, dy: 0.05 } })
    expect(lay.words[0]).toEqual(base().words[0])
    expect(lay.words[1]!.x).toBeCloseTo(base().words[1]!.x + 30)   // 0.1 × 300
    expect(lay.words[1]!.y).toBeCloseTo(base().words[1]!.y + 20)   // 0.05 × 400
  })

  it('scales proportionally with the box (same fraction, bigger box → bigger px)', () => {
    const at300 = nudged({ 1: { dx: 0.1, dy: 0 } }, 300).words[1]!.x - base().words[1]!.x
    const at600base = gridExpressiveLayout({
      content: 'alpha beta', fontSize: 20, boxWidth: 600, boxHeight: 400, lineHeight: 1.5, params: params(),
    })
    const at600 = nudged({ 1: { dx: 0.1, dy: 0 } }, 600).words[1]!.x - at600base.words[1]!.x
    expect(at300).toBeCloseTo(30)
    expect(at600).toBeCloseTo(60)
  })

  it('clamps to the box: a word can touch but never escape', () => {
    const lay = nudged({ 0: { dx: -5, dy: -5 }, 1: { dx: 5, dy: 5 } })
    expect(lay.words[0]!.x).toBe(0)
    expect(lay.words[0]!.y).toBe(0)
    // maxLeft = boxWidth - wordWidth ('beta' = 4 × 20 × 0.55 = 44 → 256)
    expect(lay.words[1]!.x).toBeCloseTo(256)
    // y max = boxHeight - lineBand = 400 - 30 = 370
    expect(lay.words[1]!.y).toBeCloseTo(370)
  })

  it('ignores out-of-range indices and non-finite values', () => {
    expect(nudged({ 7: { dx: 0.5, dy: 0.5 } }).words).toEqual(base().words)
    expect(nudged({ 1: { dx: Number.NaN, dy: undefined } }).words).toEqual(base().words)
  })

  it('no nudges / empty nudges → identical output', () => {
    expect(nudged({}).words).toEqual(base().words)
  })
})

describe('mergeExpressivePatch', () => {
  const cur = () => ({ ...params(), nudges: { 0: { dx: 0.1, dy: 0.2 } } })

  it('drops nudges when an engine param changes', () => {
    for (const patch of [{ seed: 2 }, { placement: 'edges' as const }, { wordsPerLine: 2 }, { jitterX: 0.5 }, { jitterY: 0.5 }]) {
      const merged = mergeExpressivePatch(cur(), patch)
      expect(merged.nudges).toBeUndefined()
      expect(merged).toMatchObject(patch)
    }
  })

  it('keeps nudges for non-engine patches (e.g. writing nudges themselves)', () => {
    const merged = mergeExpressivePatch(cur(), { nudges: { 1: { dx: 0.3, dy: 0 } } })
    expect(merged.nudges).toEqual({ 1: { dx: 0.3, dy: 0 } })
    expect(merged.seed).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/template-grid-expressive.unit.spec.ts`
Expected: FAIL — `mergeExpressivePatch` is not exported; nudge tests fail (words identical to base).

- [ ] **Step 3: Add the types**

In `shared/template-grid/types.ts`, directly below the existing `export type { ExpressiveParams } from '../text-layout/expressive'` (line 8):

```ts
/** Manual per-word offset, stored as FRACTIONS of the element box
 *  (dx × boxWidth px) so a nudge scales proportionally across formats. */
export interface WordNudge { dx: number; dy: number }

/** ExpressiveParams + Smart-Layout-only manual per-word overrides. The core
 *  engine never sees `nudges`; the grid adapter applies them post-layout. */
export interface GridExpressiveParams extends ExpressiveParams {
  /** Word index (0-based, reading order) → offset. Cleared by any engine-param
   *  change (see mergeExpressivePatch); out-of-range indices are ignored. */
  nudges?: Record<number, WordNudge>
}
```

Then change the text style field (~line 106) from `expressive?: ExpressiveParams` to:

```ts
  expressive?: GridExpressiveParams
```

- [ ] **Step 4: Implement in the adapter**

Replace the whole `gridExpressiveLayout` function in `shared/template-grid/expressive.ts` and add the helper + merge function (keep `expressiveVOffset` as is; add the `types` import):

```ts
import { CHAR_W } from './text'
import { layoutExpressive, type ExpressiveLayout } from '../text-layout/expressive'
import type { ExpressiveParams } from '../text-layout/expressive'
import type { GridExpressiveParams, WordNudge } from './types'

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export function gridExpressiveLayout(opts: {
  content: string
  fontSize: number      // px
  boxWidth: number      // px (the element's resolved rect width)
  boxHeight?: number    // px (the element's resolved rect height) — for vertical justify
  lineHeight: number    // multiplier
  params: GridExpressiveParams
  justifyX?: boolean
  justifyY?: boolean
}): ExpressiveLayout {
  const lay = layoutExpressive({
    text: opts.content,
    boxWidth: opts.boxWidth,
    boxHeight: opts.boxHeight,
    lineHeight: opts.fontSize * opts.lineHeight,
    measure: (word) => word.length * opts.fontSize * CHAR_W,
    params: opts.params,
    justifyX: opts.justifyX,
    justifyY: opts.justifyY,
  })
  return applyWordNudges(lay, opts)
}

/** Apply manual per-word nudges (box-fraction dx/dy) on top of the engine
 *  layout, clamped so a word can touch but never escape the element box.
 *  Out-of-range indices and non-finite values are ignored. */
function applyWordNudges(
  lay: ExpressiveLayout,
  opts: { boxWidth: number; boxHeight?: number; fontSize: number; lineHeight: number; params: GridExpressiveParams },
): ExpressiveLayout {
  const nudges = opts.params.nudges
  if (!nudges || typeof nudges !== 'object') return lay
  const boxH = opts.boxHeight ?? lay.height
  const lineBand = opts.fontSize * opts.lineHeight
  const words = lay.words.map((w, i) => {
    const n = (nudges as Record<number, WordNudge>)[i]
    if (!n) return w
    const dx = Number.isFinite(n.dx) ? n.dx : 0
    const dy = Number.isFinite(n.dy) ? n.dy : 0
    if (!dx && !dy) return w
    return {
      ...w,
      x: clamp(w.x + dx * opts.boxWidth, 0, Math.max(0, opts.boxWidth - w.w)),
      y: clamp(w.y + dy * boxH, 0, Math.max(0, boxH - lineBand)),
    }
  })
  return { ...lay, words }
}

const ENGINE_KEYS: (keyof ExpressiveParams)[] = ['wordsPerLine', 'placement', 'jitterX', 'jitterY', 'seed']

/** Merge an inspector patch into the current expressive params. Any engine
 *  param change (Shuffle, placement, words-per-line, jitter) rearranges the
 *  anchors manual nudges were relative to, so those patches drop `nudges` —
 *  "re-roll means start over". Content and cosmetic edits never route here. */
export function mergeExpressivePatch(
  current: GridExpressiveParams,
  patch: Partial<GridExpressiveParams>,
): GridExpressiveParams {
  const merged: GridExpressiveParams = { ...current, ...patch }
  if (ENGINE_KEYS.some(k => k in patch)) delete merged.nudges
  return merged
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/template-grid-expressive.unit.spec.ts tests/unit/template-grid-translate.unit.spec.ts tests/unit/template-grid-text.unit.spec.ts`
Expected: ALL PASS (translate/text suites prove no regression from the types change).

- [ ] **Step 6: Commit**

```bash
git add shared/template-grid/types.ts shared/template-grid/expressive.ts tests/unit/template-grid-expressive.unit.spec.ts
git commit -m "feat(template-grid): word nudges in the expressive grid adapter"
```

---

### Task 2: Export parity test (translate boundary)

**Files:**
- Test: `tests/unit/template-grid-translate.unit.spec.ts`

**Interfaces:**
- Consumes: `gridExpressiveLayout` nudge behavior from Task 1 (via `templateToSatori`); the `T` fixture, `flatten()` helper, and the existing expressive test in this file.
- Produces: nothing new — a regression lock only. `server/templates/translate.ts` needs NO changes (it already routes through the shared adapter).

- [ ] **Step 1: Write the test** (goes green immediately if Task 1 is correct — that's the point: it proves the export inherits nudges with zero translate changes)

Append inside `describe('templateToSatori (v2)')`:

```ts
it('applies manual word nudges in the export (editor parity, no translate code)', () => {
  const mk = (nudges?: Record<number, { dx: number; dy: number }>): any => ({
    ...T,
    elements: [
      { id: 'h', type: 'text', content: 'alpha beta', level: 'body', priority: 1,
        region: { col: 2, colSpan: 14, row: 2, rowSpan: 14 },
        style: { color: '#fff', fontSize: 100,
          expressive: { wordsPerLine: 1, placement: 'random', jitterX: 0, jitterY: 0, seed: 1,
            ...(nudges ? { nudges } : {}) } } },
    ],
  })
  const px = (v: unknown) => Number.parseFloat(String(v))
  const wordNode = (tree: any, text: string) => flatten(tree).find(n => n?.props?.children === text)
  const container = flatten(templateToSatori(mk(), '1x1', {}).tree)
    .find(n => Array.isArray(n?.props?.children) && n.props.children.some((c: any) => c?.props?.children === 'beta'))
  const boxW = px(container.props.style.width)
  const boxH = px(container.props.style.height)

  const before = wordNode(templateToSatori(mk(), '1x1', {}).tree, 'beta')
  const after = wordNode(templateToSatori(mk({ 1: { dx: 0.1, dy: 0.1 } }), '1x1', {}).tree, 'beta')
  expect(px(after.props.style.left)).toBeCloseTo(px(before.props.style.left) + 0.1 * boxW, 1)
  expect(px(after.props.style.top)).toBeCloseTo(px(before.props.style.top) + 0.1 * boxH, 1)
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/template-grid-translate.unit.spec.ts`
Expected: PASS. If it FAILS, translate is not inheriting nudges — debug Task 1's adapter (do NOT add nudge code to translate.ts).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/template-grid-translate.unit.spec.ts
git commit -m "test(template-grid): lock word-nudge parity at the satori export boundary"
```

---

### Task 3: Property panel — engine-param changes clear nudges

**Files:**
- Modify: `app/components/templates/GridPropertyPanel.vue` (~lines 16 and 350–362)

**Interfaces:**
- Consumes: `mergeExpressivePatch`, `GridExpressiveParams` from Task 1.
- Produces: `setExpressive(patch)` now routes through `mergeExpressivePatch`. All expressive controls (Shuffle/`rerollExpressive`, placement, words-per-line, jitter sliders) already call `setExpressive`, so they clear nudges with no per-control changes. Behavior is covered by Task 1's `mergeExpressivePatch` unit tests.

- [ ] **Step 1: Update the imports (line 16)**

```ts
import { defaultExpressiveParams } from '~~/shared/text-layout/expressive'
import { mergeExpressivePatch } from '~~/shared/template-grid/expressive'
import type { GridExpressiveParams } from '~~/shared/template-grid/types'
```

(Replace the existing `import { defaultExpressiveParams, type ExpressiveParams } from '~~/shared/text-layout/expressive'`. If `ExpressiveParams` is referenced elsewhere in the file, keep that type import too.)

- [ ] **Step 2: Rewire setExpressive (lines 351–355)**

```ts
const expressive = computed<GridExpressiveParams | undefined>(() => styleOf().expressive)
function setExpressive(patch: Partial<GridExpressiveParams>) {
  if (!el.value) return
  patchStyle(el.value.id, { expressive: mergeExpressivePatch(expressive.value ?? defaultExpressiveParams(), patch) })
}
```

(`toggleExpressive` and `rerollExpressive` stay as they are — toggle replaces the whole object, which correctly discards nudges; reroll routes through `setExpressive({ seed })`, which now clears them.)

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/unit/template-grid-expressive.unit.spec.ts && npx nuxt typecheck 2>&1 | grep "GridPropertyPanel" ; true`
Expected: tests PASS; typecheck grep shows no NEW errors in GridPropertyPanel.vue (pre-existing ones at other line numbers are fine — compare against `git stash`-free baseline by line: only lines you touched matter).

- [ ] **Step 4: Commit**

```bash
git add app/components/templates/GridPropertyPanel.vue
git commit -m "feat(smart-layout): expressive param changes clear manual word nudges"
```

---

### Task 4: Editor word mode — double-click, drag, commit

**Files:**
- Modify: `app/components/templates/GridEditorCanvas.vue`
  - ctx destructure (~line 25)
  - `expressiveWords()` (~line 348)
  - `enterReposition()` (~line 513)
  - `onElementPointerDown()` (~line 526)
  - new word-drag state + handlers (below the pan handlers, ~line 590)
  - template: element `@dblclick` (~line 927), word spans (~line 933), hint chip (~line 972)

**Interfaces:**
- Consumes: `gridExpressiveLayout` with `params.nudges` (Task 1); existing `repositionId` mode, `scale`, `ctx.patchStyle`.
- Produces: user-facing word-drag mode. No exports.

- [ ] **Step 1: Add `patchStyle` to the ctx destructure (line 25)**

```ts
  sampleProps, effectiveBrand, setRegion, patchElement, patchStyle,
```

- [ ] **Step 2: Extend `enterReposition` to expressive text**

```ts
function enterReposition(r: ResolvedElement) {
  const canReposition = r.el.type === 'image'
    || (r.el.type === 'text' && !!(r.el as any).style?.expressive)
  if (previewMode.value || !canReposition || r.el.locked) return
  selectedId.value = r.el.id
  repositionId.value = r.el.id
}
```

- [ ] **Step 3: Keep the element body inert in word mode**

In `onElementPointerDown`, directly after the image pan branch (the `if (repositionId.value === r.el.id && r.el.type === 'image') { ... return }` block):

```ts
  // Word mode (expressive text): the word spans own the drag — pressing the
  // element body must neither move the element nor start a region drag.
  if (repositionId.value === r.el.id && r.el.type === 'text') return
```

- [ ] **Step 4: Add word-drag state + handlers** (below the reposition/pan section, near `onElementPointerUp`)

```ts
// -- Word-nudge drag: in reposition mode on an expressive text element each
// word drags individually. Deltas are stored as fractions of the element box
// (style.expressive.nudges, applied by gridExpressiveLayout on both surfaces).
// Live feedback goes through `liveWordDrag` (merged into expressiveWords);
// the template write happens once on pointerup — one undo step per drag.
let wordDragState: {
  elId: string; index: number
  startClientX: number; startClientY: number
  startNudge: { dx: number; dy: number }
  boxW: number; boxH: number
} | null = null
const liveWordDrag = ref<{ elId: string; index: number; dx: number; dy: number } | null>(null)

function onWordPointerDown(e: PointerEvent, r: ResolvedElement, index: number) {
  if (repositionId.value !== r.el.id || previewMode.value) return
  e.stopPropagation()
  const cur = (r.el as any).style?.expressive?.nudges?.[index]
  const startNudge = {
    dx: Number.isFinite(cur?.dx) ? cur.dx : 0,
    dy: Number.isFinite(cur?.dy) ? cur.dy : 0,
  }
  wordDragState = {
    elId: r.el.id, index,
    startClientX: e.clientX, startClientY: e.clientY,
    startNudge, boxW: r.rect.w, boxH: r.rect.h,
  }
  liveWordDrag.value = { elId: r.el.id, index, ...startNudge }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onWordPointerMove(e: PointerEvent) {
  if (!wordDragState) return
  const s = scale.value || 1
  liveWordDrag.value = {
    elId: wordDragState.elId,
    index: wordDragState.index,
    dx: wordDragState.startNudge.dx + (e.clientX - wordDragState.startClientX) / s / wordDragState.boxW,
    dy: wordDragState.startNudge.dy + (e.clientY - wordDragState.startClientY) / s / wordDragState.boxH,
  }
}

function onWordPointerUp(e: PointerEvent) {
  if (!wordDragState) return
  const drag = wordDragState
  wordDragState = null
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  const live = liveWordDrag.value
  liveWordDrag.value = null
  if (!live || (live.dx === drag.startNudge.dx && live.dy === drag.startNudge.dy)) return
  const el = resolved.value.elements.find(x => x.el.id === drag.elId)?.el as any
  const cur = el?.style?.expressive
  if (!cur) return
  patchStyle(drag.elId, {
    expressive: { ...cur, nudges: { ...(cur.nudges ?? {}), [drag.index]: { dx: live.dx, dy: live.dy } } },
  })
}
```

- [ ] **Step 5: Merge the live drag into `expressiveWords`**

Replace the `const lay = gridExpressiveLayout({ ... })` call inside `expressiveWords` with:

```ts
  const exParams = { ...el.style.expressive }
  const live = liveWordDrag.value
  if (live && live.elId === el.id) {
    exParams.nudges = { ...(exParams.nudges ?? {}), [live.index]: { dx: live.dx, dy: live.dy } }
  }
  const lay = gridExpressiveLayout({
    content: r.text?.content ?? '', fontSize, boxWidth: r.rect.w, boxHeight: r.rect.h,
    lineHeight, params: exParams, justifyX, justifyY,
  })
```

- [ ] **Step 6: Template — dblclick routing, word-span handlers, hint chip**

Element `@dblclick` (line ~927) becomes:

```
@dblclick="(e) => { if (r.el.type === 'image' || (r.el.type === 'text' && r.el.style?.expressive)) { e.stopPropagation(); enterReposition(r) } else if (r.el.type === 'text') { e.stopPropagation(); startTextEdit(r) } }"
```

(Behavior change: double-click on an *expressive* text element now enters word mode instead of inline text editing — content editing stays available in the property panel's text field.)

Word spans (line ~933) become:

```
<span v-for="(w, i) in expressiveWords(r)" :key="i"
  :style="{ position: 'absolute', left: `${w.x}px`, top: `${w.y}px`, whiteSpace: 'nowrap',
            cursor: repositionId === r.el.id ? 'grab' : undefined }"
  @pointerdown="(e) => onWordPointerDown(e, r, i)"
  @pointermove="onWordPointerMove"
  @pointerup="onWordPointerUp"
>{{ w.text }}</span>
```

(`onWordPointerDown` returns without `stopPropagation` when not in word mode, so normal element drag/selection is untouched.)

Hint chip (line ~972, the `v-if="repositionId === r.el.id"` div) — make the label type-aware:

```
>{{ r.el.type === 'text' ? 'Drag words · Esc to finish' : 'Drag to reposition · Esc to finish' }}</div>
```

- [ ] **Step 7: Automated verification**

Run: `npx vitest run tests/unit/template-grid-expressive.unit.spec.ts tests/unit/template-grid-translate.unit.spec.ts tests/unit/template-grid-editor-math.unit.spec.ts tests/unit/template-grid-fine-editor.unit.spec.ts && npx nuxt typecheck 2>&1 | grep -c "GridEditorCanvas" ; true`
Expected: tests PASS; the GridEditorCanvas error count matches the pre-change baseline (run the grep on a clean checkout first if unsure — there are pre-existing errors in this file).

- [ ] **Step 8: Manual verification (dev server)**

1. Start a dev server (`preview_start` with `frontend-harness`, or reuse the user's on :3000 after HMR).
2. Open a project → add a Smart Layout node → Edit layout → add a text element, enable Expressive in the panel.
3. Double-click the element → hint reads "Drag words · Esc to finish"; drag a word — it follows the pointer and stays inside the box.
4. Esc → drag the element body — the whole element moves (word mode exited).
5. Hit Shuffle → all nudges reset (words re-place from the seed alone).
6. Re-nudge a word, close and reopen the modal → the nudge persists.
7. Run Generate → the rendered PNG shows the word where the editor shows it.

- [ ] **Step 9: Commit**

```bash
git add app/components/templates/GridEditorCanvas.vue
git commit -m "feat(smart-layout): drag individual words in expressive text (word-nudge mode)"
```
