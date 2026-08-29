# Shared review-strip tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canvas sketch review strip look identical to the gradient-studio take strip, by extracting the shared tile chrome into one `ReviewTile` component (+ shared tray/bar style constants) that both strips compose — so they can't drift again.

**Architecture:** A new presentational `ReviewTile.vue` owns the drift-prone tile look (96px clipped tile, action-blue selection ring, hover/focus/selected action-reveal overlay, opt-in drag pointer-capture + event forwarding). A `reviewStripStyles.ts` holds the shared tray + bar class strings. `studio/TakeStrip.vue` swaps only its inline tile markup for `ReviewTile` (its tightly-tested strip-level DOM is otherwise unchanged). `SketchReviewStrip.vue` is rebuilt to the take strip's two-row layout (tiles row over a Cancel/Re-roll bar) using `ReviewTile`, with per-card Keep on hover and its drag gesture wired to `ReviewTile`'s forwarded pointer events. `VueNodeCanvas.vue` is untouched — the sketch strip's public props/emits/testids are preserved.

**Tech Stack:** Nuxt 4, Vue 3.5 (`<script setup lang="ts">`), Tailwind, Vitest + @vue/test-utils (happy-dom).

## Global Constraints

- **The look is one source of truth.** Tile size, clip, and the `border-action ring-1 ring-action` selection ring live ONLY in `ReviewTile.vue`. Tray + bar classes live ONLY in `reviewStripStyles.ts`. Neither strip re-declares them inline.
- **`take-strip.unit.spec.ts` changes by exactly ONE assertion** — widening the import-purity allowlist to permit `ReviewTile.vue` and `reviewStripStyles.ts`. Every other assertion must pass unedited. If any other take-strip assertion needs editing, a contract broke by accident — stop and reconcile, don't edit the test.
- **`VueNodeCanvas.vue` is not modified.** The sketch strip keeps props `images`/`selected`/`busy`, emits `hover/select/keep/cancel/reroll/dropAt` with identical payloads, and keeps the `sketch-tile`/`sketch-ghost`/`sketch-actions`/`sketch-cancel`/`sketch-reroll`/`sketch-keep` testids. Per-card Keep emits `select(i)` then `keep`.
- **Colour:** action-blue (`border-action`/`ring-action`/StudioButton primary) is the only accent. No new colours.
- **Vue 3.5 gotcha:** a template ref inside `v-for` is an array — not used here, but don't introduce one.
- **Commit main-direct, stage own files by exact path** (heavy foreign WIP from parallel sessions — never `git add -A`). vue-tsc baseline is polluted by parallel WIP; judge typecheck cleanliness by grepping for the files/symbols this plan adds, not the raw count.

---

### Task 1: ReviewTile.vue + shared style constants

**Files:**
- Create: `frontend/app/components/vue-canvas/studio/ReviewTile.vue`
- Create: `frontend/app/components/vue-canvas/studio/reviewStripStyles.ts`
- Test: `frontend/tests/unit/review-tile.unit.spec.ts`

**Interfaces:**
- Produces: `ReviewTile` component with props `{ tileTestid: string; selected?: boolean; label?: string; draggable?: boolean }`; emits `tilefocus`, `tileblur`, and (only when `draggable`) `tilepointerdown`/`tilepointermove`/`tilepointerup`/`tilepointercancel`, each carrying the raw `PointerEvent`. Default slot = tile content; `#actions` slot = the reveal-overlay content. Click bubbles to the component root (consumer binds `@click`).
- Produces: `reviewStripStyles.ts` named exports `TRAY_PANEL`, `TRAY_FLOATING`, `TILES_ROW`, `ACTIONS_BAR` (Tailwind class strings).

- [ ] **Step 1: Write the failing test** — `frontend/tests/unit/review-tile.unit.spec.ts`

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'

const mountTile = (props = {}, slots = {}) =>
  mount(ReviewTile, { props: { tileTestid: 'x-tile', ...props }, slots })

describe('ReviewTile — chrome', () => {
  it('renders default slot inside a button carrying the given testid', () => {
    const w = mountTile({}, { default: '<img src="a">' })
    const btn = w.get('[data-testid="x-tile"]')
    expect(btn.element.tagName).toBe('BUTTON')
    expect(btn.find('img').attributes('src')).toBe('a')
  })
  it('selected toggles the action-blue ring and the forced-reveal on the overlay', () => {
    const on = mountTile({ selected: true }, { actions: '<button>Keep</button>' })
    const tile = on.get('[data-testid="x-tile"]')
    expect(tile.classes().join(' ')).toContain('ring-action')
    // the overlay wrapping #actions is forced open when selected
    const overlay = on.get('[data-testid="x-tile-actions"]')
    expect(overlay.classes()).toContain('!opacity-100')
    const off = mountTile({ selected: false }, { actions: '<button>Keep</button>' })
    expect(off.get('[data-testid="x-tile"]').classes().join(' ')).not.toContain('ring-action')
    expect(off.get('[data-testid="x-tile-actions"]').classes()).not.toContain('!opacity-100')
  })
  it('data-selected + aria-pressed track selected', () => {
    const w = mountTile({ selected: true })
    const t = w.get('[data-testid="x-tile"]')
    expect(t.attributes('data-selected')).toBe('true')
    expect(t.attributes('aria-pressed')).toBe('true')
  })
  it('label sets data-label + aria-label; absent when no label', () => {
    const withL = mountTile({ label: 'golden warm' }).get('[data-testid="x-tile"]')
    expect(withL.attributes('data-label')).toBe('golden warm')
    expect(withL.attributes('aria-label')).toBe('golden warm')
    const noL = mountTile().get('[data-testid="x-tile"]')
    expect(noL.attributes('aria-label')).toBeUndefined()
  })
  it('no #actions slot => no overlay', () => {
    const w = mountTile()
    expect(w.find('[data-testid="x-tile-actions"]').exists()).toBe(false)
  })
})

describe('ReviewTile — focus forwarding', () => {
  it('button focus/blur emit tilefocus/tileblur', async () => {
    const w = mountTile()
    const t = w.get('[data-testid="x-tile"]')
    await t.trigger('focus')
    await t.trigger('blur')
    expect(w.emitted('tilefocus')).toHaveLength(1)
    expect(w.emitted('tileblur')).toHaveLength(1)
  })
})

describe('ReviewTile — drag (opt-in)', () => {
  it('with draggable, pointer events forward the PointerEvent', async () => {
    const w = mountTile({ draggable: true }, { default: '<img src="a">' })
    const t = w.get('[data-testid="x-tile"]')
    await t.trigger('pointerdown', { clientX: 1, clientY: 1, pointerId: 7 })
    await t.trigger('pointermove', { clientX: 9, clientY: 9, pointerId: 7 })
    await t.trigger('pointerup', { clientX: 9, clientY: 9, pointerId: 7 })
    await t.trigger('pointercancel', { pointerId: 7 })
    expect(w.emitted('tilepointerdown')).toHaveLength(1)
    expect(w.emitted('tilepointermove')).toHaveLength(1)
    expect(w.emitted('tilepointerup')).toHaveLength(1)
    expect(w.emitted('tilepointercancel')).toHaveLength(1)
    expect((w.emitted('tilepointerdown')![0][0] as PointerEvent).clientX).toBe(1)
  })
  it('without draggable, pointer events do NOT emit', async () => {
    const w = mountTile({ draggable: false })
    await w.get('[data-testid="x-tile"]').trigger('pointerdown', { pointerId: 1 })
    expect(w.emitted('tilepointerdown')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run tests/unit/review-tile.unit.spec.ts`
Expected: FAIL — module `ReviewTile.vue` not found.

- [ ] **Step 3: Create the shared styles** — `frontend/app/components/vue-canvas/studio/reviewStripStyles.ts`

```ts
/**
 * Shared review-strip layout classes — the tray + bar, one source of truth so
 * the studio take strip and the canvas sketch strip stay identical. The tile
 * chrome (size, clip, selection ring, action-reveal overlay) lives in
 * ReviewTile.vue; these are only the strip-level containers around it.
 */
// In-studio-modal tray: subtle translucent panel under the preview.
export const TRAY_PANEL = 'flex flex-col gap-2 rounded-[8px] border border-white/10 bg-white/[0.03] p-2'
// Over-canvas tray: solid dark floating card with lift + blur.
export const TRAY_FLOATING = 'flex flex-col gap-2 rounded-[9px] border border-white/10 bg-[#0b0d11]/95 p-2 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur'
// The row of tiles.
export const TILES_ROW = 'flex items-stretch gap-[5px]'
// The actions bar under the tiles.
export const ACTIONS_BAR = 'flex items-center gap-2'
```

- [ ] **Step 4: Create ReviewTile** — `frontend/app/components/vue-canvas/studio/ReviewTile.vue`

```vue
<script setup lang="ts">
/**
 * ReviewTile — the shared review-strip tile chrome, and the ONE source of
 * truth for the look both the studio take strip and the canvas sketch strip
 * must share: a fixed 96px clipped tile, the action-blue selection ring, and
 * the per-card action overlay revealed on hover / focus-within / selection.
 * Presentation only — knows nothing about takes, sketches, nodes, studios.
 *
 * DOM shape matters: the tile is a <button>, and its action (#actions, e.g.
 * Keep) is a SIBLING overlay inside a wrapping cell — never a descendant,
 * because a <button> cannot nest inside a <button>. The wrapper is the single
 * root, so a consumer's fall-through @click (which bubbles up from the button)
 * and @mouseenter/@mouseleave land on it; focus/blur don't bubble, so the
 * button forwards them as tilefocus/tileblur.
 *
 * Drag (opt-in via `draggable`): the tile owns its <button>, so it owns
 * pointer capture — capture MUST sit on the pointerdown target or the browser
 * re-targets move/up the instant the pointer leaves the tile, which is the
 * whole point of dragging onto the canvas. jsdom can't model capture, so this
 * is verified live, not in units. It captures here and forwards the raw
 * PointerEvents; the consumer runs the gesture (threshold, ghost, drop).
 */
const props = withDefaults(defineProps<{
  tileTestid: string
  selected?: boolean
  label?: string
  draggable?: boolean
}>(), { selected: false, label: undefined, draggable: false })

const emit = defineEmits<{
  tilefocus: []
  tileblur: []
  tilepointerdown: [e: PointerEvent]
  tilepointermove: [e: PointerEvent]
  tilepointerup: [e: PointerEvent]
  tilepointercancel: [e: PointerEvent]
}>()

// The clip + `group` (reveal trigger) live on the WRAPPER, matching the take
// strip exactly, so the button's ring and the Keep overlay both sit inside one
// rounded box and the overlay's corners are clipped like the tile's. The
// button carries only the border + selection ring.
const WRAP = 'group relative h-[96px] w-full min-w-0 flex-1 overflow-hidden rounded-[5px]'
const TILE = 'relative h-full w-full border transition enabled:cursor-pointer'
const RING_ON = 'border-action ring-1 ring-action'
const RING_OFF = 'border-white/12 hover:border-white/30'
const OVERLAY = 'pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-1.5 opacity-0 transition bg-gradient-to-t from-black/85 to-transparent group-hover:opacity-100 group-focus-within:opacity-100'

function capture(e: PointerEvent) {
  const el = e.currentTarget as Element
  if (el?.setPointerCapture) { try { el.setPointerCapture(e.pointerId) } catch { /* no-op in test env */ } }
}
function release(e: PointerEvent) {
  const el = e.currentTarget as Element
  if (el?.releasePointerCapture) { try { el.releasePointerCapture(e.pointerId) } catch { /* no-op in test env */ } }
}
function onDown(e: PointerEvent) { if (!props.draggable) return; capture(e); emit('tilepointerdown', e) }
function onMove(e: PointerEvent) { if (props.draggable) emit('tilepointermove', e) }
function onUp(e: PointerEvent) { if (!props.draggable) return; release(e); emit('tilepointerup', e) }
function onCancel(e: PointerEvent) { if (!props.draggable) return; release(e); emit('tilepointercancel', e) }
</script>

<template>
  <!-- single-root wrapper: clip + sizing + the `group` reveal-trigger live
       here so the button and the sibling overlay share one rounded box.
       Consumer @click (bubbles up from the button) and @mouseenter/@mouseleave
       fall through to this root. -->
  <div :class="WRAP">
    <button type="button"
            :data-testid="tileTestid"
            :data-selected="selected ? 'true' : 'false'"
            :aria-pressed="selected ? 'true' : 'false'"
            :data-label="label"
            :aria-label="label"
            :class="[TILE, selected ? RING_ON : RING_OFF]"
            @focus="emit('tilefocus')" @blur="emit('tileblur')"
            @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onCancel">
      <slot />
    </button>
    <div v-if="$slots.actions"
         :data-testid="`${tileTestid}-actions`"
         :class="[OVERLAY, selected ? '!opacity-100' : '']">
      <slot name="actions" />
    </div>
  </div>
</template>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/review-tile.unit.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/ReviewTile.vue frontend/app/components/vue-canvas/studio/reviewStripStyles.ts frontend/tests/unit/review-tile.unit.spec.ts
git commit -m "feat(studio): ReviewTile — shared review-strip tile chrome + tray/bar style constants"
```

---

### Task 2: TakeStrip consumes ReviewTile

**Files:**
- Modify: `frontend/app/components/vue-canvas/studio/TakeStrip.vue` (the per-take cell markup + the tray/bar class strings)
- Modify: `frontend/tests/unit/take-strip.unit.spec.ts` (ONE assertion — the import-purity allowlist)
- Test: `frontend/tests/unit/take-strip.unit.spec.ts` (the existing suite is the oracle)

**Interfaces:**
- Consumes: `ReviewTile` (Task 1) props/emits; `TRAY_PANEL`, `TILES_ROW`, `ACTIONS_BAR` from `reviewStripStyles.ts`.
- Produces: no public change — same props (`takes`, `thumbs`, `current`, `selected`, `busy`, `reviewing`), same emits (`hover/select/keep/dismiss/moreDirections`), same testids.

- [ ] **Step 1: Widen the import-purity allowlist** (the only test edit)

In `frontend/tests/unit/take-strip.unit.spec.ts`, the "imports nothing but its own button" test currently asserts each import is `vue` OR ends with `StudioButton.vue` OR is `~/lib/vibePrompt`. Change that single boolean to also allow the two new presentational siblings:

```ts
for (const i of imports) {
  expect(
    i === 'vue'
    || i.endsWith('StudioButton.vue')
    || i.endsWith('ReviewTile.vue')
    || i.endsWith('reviewStripStyles')
    || i === '~/lib/vibePrompt',
  ).toBe(true)
}
```

Leave every other assertion in the file exactly as-is.

- [ ] **Step 2: Run the take suite to see the baseline** (before touching the component)

Run: `cd frontend && npx vitest run tests/unit/take-strip.unit.spec.ts`
Expected: PASS (the allowlist edit alone doesn't break anything; the component still uses its inline tiles).

- [ ] **Step 3: Swap the per-take cell's tile markup for ReviewTile**

In `TakeStrip.vue`: import the shared units and replace the inline tile+overlay inside the `v-for="(t, i) in takes"` cell with `ReviewTile`, and replace the tray/row/actions-bar class strings with the shared constants. The cell wrapper (with its `@mouseenter/@mouseleave` hover and the rationale tooltip sibling), the `take-current` anchor, the `take-divider`, and the actions bar CONTENTS stay exactly as they are.

Add to the script imports:

```ts
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'
import { TRAY_PANEL, TILES_ROW, ACTIONS_BAR } from '~/components/vue-canvas/studio/reviewStripStyles'
```

Replace the root container class `"flex flex-col gap-2 rounded-[8px] border border-white/10 bg-white/[0.03] p-2"` with `TRAY_PANEL`, the take-row class `"flex items-stretch gap-[5px]"` with `TILES_ROW`, and the take-actions class `"flex items-center gap-2"` with `ACTIONS_BAR` (bind them: `:class="TRAY_PANEL"` etc.).

Replace the current per-take cell body — the `<div class="relative h-[96px] w-full overflow-hidden rounded-[5px]"> <button data-testid="take-tile" …> …thumb/pending/error… </button> <div …overlay…><StudioButton take-keep/></div> </div>` — with:

```vue
        <ReviewTile tile-testid="take-tile" :selected="selected === t" :label="t.label"
                    @click="emit('select', t)" @tilefocus="onHover(t)" @tileblur="onHover(null)">
          <img v-if="sources.get(t)" :src="sources.get(t)!" alt="" class="h-full w-full object-cover">
          <span v-else-if="pending.has(t)" data-testid="take-pending"
                class="block h-full w-full animate-pulse bg-white/[0.07]" />
          <span v-else data-testid="take-error"
                class="flex h-full w-full items-center justify-center bg-white/[0.04] text-[11px] text-white/35">
            couldn’t draw
          </span>
          <template #actions>
            <StudioButton data-testid="take-keep" variant="primary" class="pointer-events-auto"
                          :disabled="busy" @click.stop="emit('select', t); emit('keep')">
              Keep
            </StudioButton>
          </template>
        </ReviewTile>
```

Notes that keep the existing tests green:
- Hover stays on the CELL wrapper (`take-cell`, unchanged) — do NOT move it onto ReviewTile; the "preview holds while reaching for Keep" test depends on hover being cell-scoped and the tile having no `mouseleave`.
- Keyboard preview comes through `@tilefocus`/`@tileblur` (the button forwards focus/blur, which don't bubble to the cell).
- `@click="emit('select', t)"` on ReviewTile catches the button's bubbled click; Keep's `@click.stop` prevents Keep-clicks from also selecting.
- The `take-tile` testid, `data-label`, `aria-label`, `aria-pressed`, `data-selected` now come from ReviewTile props — same attributes, same values.
- The overlay's forced `!opacity-100`-when-selected is now ReviewTile's job; the "revealed when selected" test reads `take-keep`'s `parentElement` (the `take-tile-actions` overlay) — still correct.

- [ ] **Step 4: Run the take suite — it is the oracle**

Run: `cd frontend && npx vitest run tests/unit/take-strip.unit.spec.ts`
Expected: PASS, all cases. If any assertion OTHER than the allowlist fails, the swap changed a contract — fix the COMPONENT to restore the original DOM/attributes/behaviour; do not edit the test.

- [ ] **Step 5: Typecheck the touched file**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "TakeStrip|ReviewTile|reviewStripStyles"`
Expected: no errors naming these files.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/TakeStrip.vue frontend/tests/unit/take-strip.unit.spec.ts
git commit -m "refactor(studio): TakeStrip composes ReviewTile + shared tray/bar styles (behaviour unchanged)"
```

---

### Task 3: SketchReviewStrip rebuilt to the two-row layout

**Files:**
- Modify (rewrite template + trim script): `frontend/app/components/vue-canvas/SketchReviewStrip.vue`
- Modify: `frontend/tests/unit/sketch-review-strip.unit.spec.ts` (update for the intended interaction change)

**Interfaces:**
- Consumes: `ReviewTile` props/emits; `TRAY_FLOATING`, `TILES_ROW`, `ACTIONS_BAR`; `StudioButton`.
- Produces: unchanged public contract — props `images`/`selected`/`busy`; emits `hover/select/keep/cancel/reroll/dropAt`; testids `sketch-strip`/`sketch-tile`/`sketch-ghost`/`sketch-actions`/`sketch-cancel`/`sketch-reroll`/`sketch-keep`. (Removed: `sketch-tip`.)

- [ ] **Step 1: Update the spec's tests for the new interaction** — `frontend/tests/unit/sketch-review-strip.unit.spec.ts`

Keep the file's core (drag suite, hover/select emits) and make these edits:

Replace the "bar order is Cancel then Re-roll then Keep" test with per-card Keep + a two-item bar:
```ts
  it('bar order is Cancel then Re-roll (Keep is per-card, not in the bar)', () => {
    const w = mount(SketchReviewStrip, { props: base() })
    const ids = w.get('[data-testid="sketch-actions"]').findAll('[data-testid^="sketch-"]')
      .map(b => b.attributes('data-testid'))
    expect(ids).toEqual(['sketch-cancel', 'sketch-reroll'])
  })
  it('every sketch tile has its own Keep', () => {
    const w = mount(SketchReviewStrip, { props: base() })
    expect(tiles(w).length).toBe(4)
    for (const t of tiles(w)) {
      const cell = t.element.closest('.relative') as HTMLElement
      expect(cell.querySelector('[data-testid="sketch-keep"]')).toBeTruthy()
    }
  })
```
Replace the "Keep is disabled until a tile is selected" test with per-card Keep behaviour (Keep on a card selects then keeps that card):
```ts
  it('Keep on a card selects that card then keeps it', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    const keep = w.findAll('[data-testid="sketch-keep"]')[1]!
    await keep.trigger('click')
    expect(w.emitted('select')!.at(-1)).toEqual([1])
    expect(w.emitted('keep')).toHaveLength(1)
  })
```
In "Keep emits keep, Cancel emits cancel, Re-roll emits reroll", drive Keep from a card (not the bar):
```ts
    await w.findAll('[data-testid="sketch-keep"]')[0]!.trigger('click')
    await w.get('[data-testid="sketch-cancel"]').trigger('click')
    await w.get('[data-testid="sketch-reroll"]').trigger('click')
```
In "busy disables Keep and Re-roll", read a per-card Keep:
```ts
    expect(w.findAll('[data-testid="sketch-keep"]')[0]!.attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="sketch-reroll"]').attributes('disabled')).toBeDefined()
```
DELETE the "the hovered tile shows a preview above it" test (the `sketch-tip` popup is gone), AND DELETE the "hovering a tile emits hover(index); leaving emits hover(null)" test — `hover` is dropped entirely (its only consumer was the popup; the host never bound `@hover`). Keep "clicking a tile emits select(index)".

Leave the whole `describe('SketchReviewStrip — drag to place', …)` block unchanged — its `sketch-tile`/`sketch-ghost` testids and pointer sequences are preserved by the rewrite.

- [ ] **Step 2: Run it to see the expected failures**

Run: `cd frontend && npx vitest run tests/unit/sketch-review-strip.unit.spec.ts`
Expected: FAIL — the current component still has the bar-Keep / popup / 64px layout.

- [ ] **Step 3: Rewrite SketchReviewStrip.vue**

Full new file:

```vue
<script setup lang="ts">
/**
 * Canvas sketch review strip — four instant sketches, docked above the prompt
 * bar, reviewed before any land. A twin of the studio take strip: same tray,
 * same 96px ReviewTile chrome, same per-card Keep on hover, same Cancel/Re-roll
 * bar below. PRESENTATION + gesture only — reports what the user did
 * (hover/select/keep/cancel/reroll/dropAt); the canvas host turns a commit into
 * one image node and tears down the transient sketch-pad state.
 */
import { ref } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'
import { TRAY_FLOATING, TILES_ROW, ACTIONS_BAR } from '~/components/vue-canvas/studio/reviewStripStyles'

const props = withDefaults(defineProps<{
  images: string[]
  selected: number | null
  busy?: boolean
}>(), { busy: false })

const emit = defineEmits<{
  select: [index: number]
  keep: []
  cancel: []
  reroll: []
  dropAt: [payload: { index: number; clientX: number; clientY: number }]
}>()

// Drag-to-place: press-move past threshold lifts the tile into a ghost that
// follows the pointer; release reports the drop point in screen space. A
// press-release under threshold stays a click (select) — draggedThisPress
// tells the two apart. ReviewTile owns pointer capture + forwards the events.
const DRAG_THRESHOLD = 4
const drag = ref<{ index: number; x: number; y: number; started: boolean } | null>(null)
const draggedThisPress = ref(false)

function onDown(i: number, e: PointerEvent) {
  draggedThisPress.value = false
  drag.value = { index: i, x: e.clientX, y: e.clientY, started: false }
}
function onMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  if (!d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return
  d.started = true
  d.x = e.clientX; d.y = e.clientY
}
function onUp(e: PointerEvent) {
  const d = drag.value
  drag.value = null
  draggedThisPress.value = !!d?.started
  if (d?.started) emit('dropAt', { index: d.index, clientX: e.clientX, clientY: e.clientY })
}
// The OS can steal a gesture mid-drag — clear drag state, never emit dropAt.
function onCancel() {
  const d = drag.value
  drag.value = null
  draggedThisPress.value = !!d?.started
}
function onTileClick(i: number) {
  if (draggedThisPress.value) return
  emit('select', i)
}
</script>

<template>
  <div data-testid="sketch-strip" :class="TRAY_FLOATING">
    <div :class="TILES_ROW">
      <ReviewTile v-for="(src, i) in images" :key="i"
                  tile-testid="sketch-tile" :selected="selected === i" draggable
                  @click="onTileClick(i)"
                  @tilepointerdown="onDown(i, $event)" @tilepointermove="onMove"
                  @tilepointerup="onUp" @tilepointercancel="onCancel">
        <!-- draggable="false": a native <img> drag fires a spurious
             pointercancel that would kill our drag-to-place before the ghost
             appears (live-only; jsdom never starts native drag). -->
        <img :src="src" alt="" draggable="false" class="h-full w-full object-cover">
        <template #actions>
          <StudioButton data-testid="sketch-keep" variant="primary" class="pointer-events-auto"
                        :disabled="busy" @click.stop="emit('select', i); emit('keep')">
            Keep
          </StudioButton>
        </template>
      </ReviewTile>
    </div>

    <div data-testid="sketch-actions" :class="ACTIONS_BAR">
      <StudioButton data-testid="sketch-cancel" variant="subtle" @click="emit('cancel')">Cancel</StudioButton>
      <span class="flex-1" />
      <StudioButton data-testid="sketch-reroll" variant="neutral" :disabled="busy" @click="emit('reroll')">↻ Re-roll</StudioButton>
    </div>

    <div v-if="drag?.started" data-testid="sketch-ghost"
         class="pointer-events-none fixed z-50 h-[80px] w-[80px] overflow-hidden rounded-[6px] border border-white/25 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
         :style="{ left: drag.x + 'px', top: drag.y + 'px', transform: 'translate(-50%, -50%) rotate(-3deg)' }">
      <img :src="images[drag.index]" alt="" class="h-full w-full object-cover">
    </div>
  </div>
</template>
```

Notes:
- `sketch-tile` click: `@click` on ReviewTile catches the button's bubbled click → `onTileClick(i)` (guarded by `draggedThisPress`). The drag suite's "trailing click after a real drag is swallowed" test passes because `onUp` sets `draggedThisPress` before the trailing click, and `onDown` re-arms it per press.
- Per-card Keep: `@click.stop` selects that card then keeps — the host's `onSketchSelect` + `onSketchKeep` (reading `sketchReview.selected`) already handle this order.
- `hover` is dropped: the host never bound `@hover` and the popup that used it is gone. No `@mouseenter` wiring, no `hover` emit.

- [ ] **Step 4: Run the sketch suite to green**

Run: `cd frontend && npx vitest run tests/unit/sketch-review-strip.unit.spec.ts`
Expected: PASS (updated presentation tests + unchanged drag suite).

- [ ] **Step 5: Typecheck the touched file**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "SketchReviewStrip"`
Expected: no errors naming this file.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/SketchReviewStrip.vue frontend/tests/unit/sketch-review-strip.unit.spec.ts
git commit -m "refactor(sketch): SketchReviewStrip becomes a twin of the take strip (96px tiles, per-card Keep, ReviewTile)"
```

---

### Task 4: Parity test + live verification

**Files:**
- Create: `frontend/tests/unit/review-strip-parity.unit.spec.ts`
- Test: live browser verification of both strips.

**Interfaces:**
- Consumes: `TakeStrip`, `SketchReviewStrip`, `ReviewTile`.

- [ ] **Step 1: Write the parity test** — `frontend/tests/unit/review-strip-parity.unit.spec.ts`

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TakeStrip from '~/components/vue-canvas/studio/TakeStrip.vue'
import SketchReviewStrip from '~/components/vue-canvas/SketchReviewStrip.vue'
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'
import type { VibeTake } from '~/lib/vibePrompt'

const TAKES: VibeTake[] = [
  { label: 'a', rationale: 'ra', changes: [] },
  { label: 'b', rationale: 'rb', changes: [] },
]
const thumbs = new Map(TAKES.map((t, i) => [t, `data:img/${i}`]))
const IMGS = ['data:img/a', 'data:img/b', 'data:img/c', 'data:img/d']

describe('review-strip parity — one tile chrome, no drift', () => {
  it('both strips render their tiles via ReviewTile', () => {
    const take = mount(TakeStrip, { props: { takes: TAKES, thumbs, current: 'data:c' } })
    const sketch = mount(SketchReviewStrip, { props: { images: IMGS, selected: null } })
    expect(take.findAllComponents(ReviewTile).length).toBe(TAKES.length)
    expect(sketch.findAllComponents(ReviewTile).length).toBe(IMGS.length)
  })
  it('a selected tile carries the identical action-blue ring in both', () => {
    const take = mount(TakeStrip, { props: { takes: TAKES, thumbs, selected: TAKES[1] } })
    const sketch = mount(SketchReviewStrip, { props: { images: IMGS, selected: 1 } })
    const ring = (w: any, testidIndex: number) => {
      const t = w.findAll('[data-testid$="-tile"]').filter((e: any) => e.attributes('data-selected') === 'true')[0]
      return t.classes().filter((c: string) => c.includes('ring') || c.includes('border-action')).sort().join(' ')
    }
    expect(ring(take, 1)).toContain('ring-action')
    expect(ring(sketch, 1)).toBe(ring(take, 1))
  })
})
```

- [ ] **Step 2: Run it**

Run: `cd frontend && npx vitest run tests/unit/review-strip-parity.unit.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run all four suites together**

Run: `cd frontend && npx vitest run tests/unit/review-tile.unit.spec.ts tests/unit/take-strip.unit.spec.ts tests/unit/sketch-review-strip.unit.spec.ts tests/unit/review-strip-parity.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 4: Live verify both strips in the browser**

Start the dev server (repo root `./dev.sh`, or `cd frontend && npm run dev`), open the canvas, HARD-RELOAD.
- **Sketch strip:** fabricate the review state (set the canvas's `sketchReview` open with four data-URL images, to avoid a paid run) and confirm: the strip docks above the prompt bar as a twin of the studio strip — four 96px tiles, hovering a tile reveals its Keep, a Cancel/Re-roll bar sits below, the selected tile shows the action-blue ring. Drag a tile → the ghost follows and drops one node under the cursor at a non-default pan/zoom.
- **Take strip:** open a studio (e.g. Gradient), trigger takes, confirm the strip still renders + behaves as before (current anchor, per-card Keep, Cancel/Re-roll, rationale tooltip).
- Screenshot both to `scratchpad/review-strip-sketch.png` and `scratchpad/review-strip-take.png`.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/unit/review-strip-parity.unit.spec.ts
git commit -m "test(studio): review-strip parity — both strips share ReviewTile chrome"
```
