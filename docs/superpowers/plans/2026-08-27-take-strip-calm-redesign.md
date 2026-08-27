# Take Strip — Calm & Confident Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the take strip's presentation into a calm, confident filmstrip — pure-image tiles, a "current" anchor cell, a styled description tooltip, per-card Variations/Keep, and a bar of Cancel + white Re-roll — with zero change to what any control does.

**Architecture:** One Vue SFC, `TakeStrip.vue`, is the only component redesigned. It stays presentation-only: it emits the same events (`hover`, `select`, `keep`, `dismiss`, `moreDirections`, `variationsOf`) so its host (`StudioModalShell.vue` → `useStudioAgent`) is untouched. Per-card Keep keeps its own take by emitting `select(take)` then `keep()` (both synchronous), so the no-arg `keep` contract is preserved. One new `neutral` variant is added to the shared `StudioButton` for the white Re-roll.

**Tech Stack:** Nuxt 4 / Vue 3.5 `<script setup>` + TypeScript, Tailwind, Vitest + @vue/test-utils (jsdom). Action-blue accent token is `action` (Tailwind class `border-action` / `bg-action` etc., per `sailor-colour-conventions`).

## Global Constraints

- **Presentation only.** No change to generation, eye-pick, materialization, keep/log behavior, spread/variations logic, or any file outside `TakeStrip.vue`, its test, and `StudioButton.vue` (+ its test).
- **Emit contract unchanged:** `hover: [VibeTake|null]`, `select: [VibeTake|null]`, `keep: []`, `dismiss: []`, `moreDirections: []`, `variationsOf: [VibeTake]`. Do not add args to `keep`.
- **Colour rule:** action blue (`action`) is the only colour accent; white is contrast, not colour (`sailor-colour-conventions`). Never hand-roll a button — extend `StudioButton` (`studio-button-is-the-button`).
- **Behaviour parity is load-bearing:** every control must still emit exactly what it emits today. Parity assertions are part of every task's tests.
- **vue-tsc baseline is 420** — must not rise. Run `npx vue-tsc --noEmit` and compare.
- Run vitest with **explicit paths**, never `-t`. From `frontend/`.
- Repo tree carries foreign WIP — **stage only your own files** by exact path; never `git add -A`.

## File Structure

- `frontend/app/components/vue-canvas/studio/TakeStrip.vue` — MODIFY. The redesign lives here. Sections: current cell, take tiles (+ per-card actions + tooltip), action bar.
- `frontend/app/components/vue-canvas/studio/StudioButton.vue` — MODIFY. Add a `neutral` (white) variant.
- `frontend/tests/unit/take-strip.unit.spec.ts` — MODIFY. Update pinned structure to the new layout; keep/extend behaviour-parity assertions.
- `frontend/tests/unit/studio-button.unit.spec.ts` — MODIFY if it exists (add a `neutral` variant case); otherwise assert the variant class inline in the take-strip test. (Check existence first: `ls frontend/tests/unit/studio-button.unit.spec.ts`.)

Reference (do not modify): `frontend/app/components/vue-canvas/StudioModalShell.vue:90` (mount point), `frontend/app/composables/useStudioAgent.ts` (`keepTake`, `variationsOfTake`, `dismissTakes`, `moreDirections`).

---

### Task 1: Action bar → Cancel (left) + white Re-roll (right)

Move Keep and Variations OFF the bar (they become per-card in Task 3). The bar is now two whole-strip controls: `Cancel` (quiet text, left) and `Re-roll` (white, right). Add the `neutral` variant to `StudioButton` for the white treatment.

**Files:**
- Modify: `frontend/app/components/vue-canvas/studio/StudioButton.vue`
- Modify: `frontend/app/components/vue-canvas/studio/TakeStrip.vue` (the `<!-- ⑤ actions -->` block only)
- Test: `frontend/tests/unit/take-strip.unit.spec.ts`

**Interfaces:**
- Produces (bar): `[data-testid="take-reroll"]` → emits `moreDirections` (label "↻ Re-roll", `neutral` variant). `[data-testid="take-dismiss"]` → emits `dismiss` (label "Cancel", `subtle` variant). Cancel is first (left); Re-roll is last (right).
- `StudioButton` gains `variant="neutral"` (white bg, dark text).

- [ ] **Step 1: Read `StudioButton.vue`** to see how variants are keyed (a `variant` prop mapping to class strings). Note the exact prop name and the class-map shape.

- [ ] **Step 2: Write the failing test** — append to `take-strip.unit.spec.ts` a new `describe('TakeStrip — action bar', …)`:

```ts
describe('TakeStrip — action bar', () => {
  it('bar has exactly Cancel then Re-roll, in that order', () => {
    const w = mount(TakeStrip, { props: base() })
    const bar = w.get('[data-testid="take-actions"]')
    const ids = bar.findAll('[data-testid^="take-"]').map(b => b.attributes('data-testid'))
    expect(ids).toEqual(['take-dismiss', 'take-reroll'])
  })
  it('Re-roll emits moreDirections', async () => {
    const w = mount(TakeStrip, { props: base() })
    await w.get('[data-testid="take-reroll"]').trigger('click')
    expect(w.emitted('moreDirections')).toHaveLength(1)
  })
  it('Cancel emits dismiss', async () => {
    const w = mount(TakeStrip, { props: base() })
    await w.get('[data-testid="take-dismiss"]').trigger('click')
    expect(w.emitted('dismiss')).toHaveLength(1)
  })
  it('Re-roll uses the neutral (white) variant', () => {
    const w = mount(TakeStrip, { props: base() })
    expect(w.get('[data-testid="take-reroll"]').classes().join(' ')).toContain('bg-white')
  })
  it('busy disables both bar controls', () => {
    const w = mount(TakeStrip, { props: { ...base(), busy: true } })
    expect(w.get('[data-testid="take-reroll"]').attributes('disabled')).toBeDefined()
  })
})
```

`base()` is the existing test's props factory (four takes + thumbs). If the file lacks one, add: `const base = () => ({ takes: T, thumbs: thumbsFor(T) })` reusing the file's existing fixtures `T`/`thumbsFor`.

Also DELETE the now-obsolete bar tests in this file: `'"different directions" emits moreDirections'` (line ~150, used `take-more`), and remove `take-keep`/`take-variations` from the bar-focused `gating` and `busy` tests — those move to Task 3. Leave `keep emits keep`/`variations emits variationsOf` behaviours to be re-added in Task 3.

- [ ] **Step 3: Run it, watch it fail**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts -t "action bar"`
Expected: FAIL — `take-reroll` / `take-actions` not found, `neutral` unknown.

- [ ] **Step 4: Add the `neutral` variant to `StudioButton.vue`.** Following the variant map you read in Step 1, add a key `neutral` whose classes are: `bg-white text-[#14171d] font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.3)] hover:bg-white/90`. Keep everything else (sizing, radius, disabled handling) shared with the other variants.

- [ ] **Step 5: Rewrite the `<!-- ⑤ actions -->` block** in `TakeStrip.vue` to:

```html
<div data-testid="take-actions" class="flex items-center gap-2">
  <StudioButton data-testid="take-dismiss" variant="subtle" :disabled="busy" @click="emit('dismiss')">
    Cancel
  </StudioButton>
  <span v-if="reviewing" data-testid="take-reviewing" class="pl-1 text-[11px] text-white/40">
    looking at these<span class="animate-pulse">…</span>
  </span>
  <span class="flex-1" />
  <StudioButton data-testid="take-reroll" variant="neutral" :disabled="busy" @click="emit('moreDirections')">
    ↻ Re-roll
  </StudioButton>
</div>
```

(Remove the old `take-more`, `take-variations`, `take-keep` buttons from this block entirely.)

- [ ] **Step 6: Run the whole file**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts`
Expected: the new `action bar` block PASSES. Some older tests referencing `take-keep`/`take-variations`/`take-more` still FAIL — that is expected; they're rewritten in Task 3. Note which fail so Task 3 covers them.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioButton.vue \
        frontend/app/components/vue-canvas/studio/TakeStrip.vue \
        frontend/tests/unit/take-strip.unit.spec.ts
git commit -m "feat(take-strip): bar is Cancel + white Re-roll; add StudioButton neutral variant"
```

---

### Task 2: The "current" cell — rename, un-dash, dim, marker below

"yours" becomes "current"; the dashed border is replaced with a clean solid hairline, gently dimmed, with a quiet "current" marker beneath the tile (not overlaid on it). Tiles also grow to `h-[96px]` (approved via mockup) — apply the height here to both the current tile and the take tiles so the strip is one consistent height.

**Files:**
- Modify: `frontend/app/components/vue-canvas/studio/TakeStrip.vue`
- Test: `frontend/tests/unit/take-strip.unit.spec.ts`

**Interfaces:**
- Produces: `[data-testid="take-current"]` (was `take-yours`) — the clickable tile, emits `select(null)` / `hover(null)`, `aria-label="current"`. A sibling `[data-testid="take-current-mark"]` with visible text `current`. No dashed class anywhere. Tile height `h-[96px]`.

- [ ] **Step 1: Update the layout + accessibility tests** that reference `take-yours` to `take-current`, and rename the strings. In `take-strip.unit.spec.ts`:
  - the "pins yours first" test → expect `kids[0]` testid `'take-current'`.
  - "with nothing selected, yours reads as current selection" and the aria-pressed tests → `take-current`.
  - "hovering yours emits hover(null)" / "clicking yours emits select(null)" → `take-current`.
  - Add:

```ts
it('the current cell shows a "current" marker and no on-tile label', () => {
  const w = mount(TakeStrip, { props: base() })
  expect(w.get('[data-testid="take-current-mark"]').text()).toBe('current')
  // no dashed border anywhere
  expect(w.html()).not.toContain('border-dashed')
})
```

- [ ] **Step 2: Run, watch fail**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts -t "current"`
Expected: FAIL — `take-current` not found; `border-dashed` still present.

- [ ] **Step 3: Replace the `<!-- ① yours -->` block** with a cell (tile + marker), no dashes, dimmed, taller:

```html
<!-- ① current — the anchor, and the undo -->
<div class="flex w-[76px] shrink-0 flex-col gap-1.5">
  <button data-testid="take-current" type="button" aria-label="current"
          :data-selected="selected ? 'false' : 'true'"
          :aria-pressed="selected ? 'false' : 'true'"
          :class="[TILE, 'h-[96px] w-full opacity-80',
                   selected ? 'border-white/12 hover:border-white/25' : 'border-white/20']"
          @mouseenter="onHover(null)" @focus="onHover(null)" @blur="onHover(null)"
          @click="emit('select', null)">
    <img v-if="currentSrc" :src="currentSrc" alt="" class="h-full w-full object-cover">
    <span v-else class="block h-full w-full bg-white/[0.06]" />
  </button>
  <span data-testid="take-current-mark"
        class="text-center text-[10px] uppercase tracking-[0.06em] text-white/35">current</span>
</div>
```

Note the `TILE` constant still starts `h-[52px]` — remove the `h-[52px]` from the `TILE` string (it's overridden per-tile now) so it doesn't fight the new `h-[96px]`. Update `TILE` to: `'group relative overflow-hidden rounded-[5px] border transition enabled:cursor-pointer'`.

- [ ] **Step 4: Run**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts -t "current"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/TakeStrip.vue \
        frontend/tests/unit/take-strip.unit.spec.ts
git commit -m "feat(take-strip): current cell — solid clean tile, dimmed, 'current' marker below"
```

---

### Task 3: Take tiles — drop labels, taller, per-card Variations + Keep

Remove the on-tile label (`.TAG`) from take tiles. Grow to `h-[96px]`. Wrap each take tile in a `.cell` so its own `≈ Variations` and `Keep` buttons can sit at the card's bottom without nesting buttons. Reveal the buttons on hover / focus-within / when the take is selected. Per-card Keep keeps that take via `select(take)` then `keep()`.

**Files:**
- Modify: `frontend/app/components/vue-canvas/studio/TakeStrip.vue`
- Test: `frontend/tests/unit/take-strip.unit.spec.ts`

**Interfaces:**
- Produces per take `i`: the tile `[data-testid="take-tile"]` (unchanged testid, emits `hover`/`select`), and its actions `[data-testid="take-keep"]` and `[data-testid="take-variations"]` INSIDE that take's cell.
- Per-card `Keep` on take `t`: `emit('select', t)` then `emit('keep')`.
- Per-card `Variations` on take `t`: `emit('variationsOf', t)`.
- Keep/Variations are always in the DOM (revealed by CSS), so tests select `tiles(w)[i].find('[data-testid="take-keep"]')`.

- [ ] **Step 1: Rewrite the emits/gating tests** for the per-card model. Replace the old bar-based `keep emits keep`, `variations emits variationsOf`, and the `gating` block with:

```ts
describe('TakeStrip — per-card actions', () => {
  it('each take has its own Keep and Variations', () => {
    const w = mount(TakeStrip, { props: base() })
    for (const tile of tiles(w)) {
      expect(tile.find('[data-testid="take-keep"]').exists()).toBe(true)
      expect(tile.find('[data-testid="take-variations"]').exists()).toBe(true)
    }
  })
  it('Keep on a card selects that take then keeps it', async () => {
    const w = mount(TakeStrip, { props: base() })
    await tiles(w)[1]!.get('[data-testid="take-keep"]').trigger('click')
    expect(w.emitted('select')![0]).toEqual([w.props('takes')[1]])
    expect(w.emitted('keep')).toHaveLength(1)
  })
  it('Variations on a card emits variationsOf(thatTake)', async () => {
    const w = mount(TakeStrip, { props: base() })
    await tiles(w)[2]!.get('[data-testid="take-variations"]').trigger('click')
    expect(w.emitted('variationsOf')![0]).toEqual([w.props('takes')[2]])
  })
  it('Variations is disabled when canVary is false; Keep is not', () => {
    const w = mount(TakeStrip, { props: { ...base(), canVary: false } })
    expect(tiles(w)[0]!.get('[data-testid="take-variations"]').attributes('disabled')).toBeDefined()
    expect(tiles(w)[0]!.get('[data-testid="take-keep"]').attributes('disabled')).toBeUndefined()
  })
  it('busy disables every card action', () => {
    const w = mount(TakeStrip, { props: { ...base(), busy: true } })
    expect(tiles(w)[0]!.get('[data-testid="take-keep"]').attributes('disabled')).toBeDefined()
    expect(tiles(w)[0]!.get('[data-testid="take-variations"]').attributes('disabled')).toBeDefined()
  })
  it('takes carry no on-tile text label', () => {
    const w = mount(TakeStrip, { props: base() })
    // label text no longer stamped on the image (buttons are the only text)
    for (const tile of tiles(w))
      expect(tile.find('.take-label').exists()).toBe(false)
  })
})
```

Delete the old `'shows every take label'` test (labels are gone by design) and the old bar `gating` block.

- [ ] **Step 2: Run, watch fail**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts -t "per-card"`
Expected: FAIL — no per-card keep/variations.

- [ ] **Step 3: Rewrite the `<!-- ② the takes -->` loop** so each take is a cell holding the tile-button plus its action row (siblings, not nested):

```html
<!-- ② the takes -->
<div v-for="(t, i) in takes" :key="i" class="group relative min-w-0 flex-1">
  <button data-testid="take-tile" type="button"
          :data-label="t.label" :data-selected="selected === t ? 'true' : 'false'"
          :aria-label="t.label" :aria-pressed="selected === t ? 'true' : 'false'"
          :class="[TILE, 'h-[96px] w-full',
                   selected === t ? 'border-action ring-1 ring-action' : 'border-white/12 hover:border-white/30']"
          @mouseenter="onHover(t)" @mouseleave="onHover(null)"
          @focus="onHover(t)" @blur="onHover(null)" @click="emit('select', t)">
    <img v-if="sources.get(t)" :src="sources.get(t)!" alt="" class="h-full w-full object-cover">
    <span v-else-if="pending.has(t)" data-testid="take-pending"
          class="block h-full w-full animate-pulse bg-white/[0.07]" />
    <span v-else data-testid="take-error"
          class="flex h-full w-full items-center justify-center bg-white/[0.04] text-[11px] text-white/35">
      couldn’t draw
    </span>
  </button>
  <!-- per-card actions: present always, revealed on hover / focus-within / selected -->
  <div :class="['pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-1.5 opacity-0 transition',
                'bg-gradient-to-t from-black/85 to-transparent',
                'group-hover:opacity-100 group-focus-within:opacity-100',
                selected === t ? '!opacity-100' : '']">
    <StudioButton data-testid="take-variations" variant="secondary" class="pointer-events-auto"
                  :disabled="busy || !canVary" @click.stop="emit('variationsOf', t)">
      ≈ Variations
    </StudioButton>
    <StudioButton data-testid="take-keep" variant="primary" class="pointer-events-auto"
                  :disabled="busy" @click.stop="emit('select', t); emit('keep')">
      Keep
    </StudioButton>
  </div>
</div>
```

Then delete the now-unused `TAG` constant from `<script setup>`.

- [ ] **Step 4: Run the per-card tests**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts -t "per-card"`
Expected: PASS.

- [ ] **Step 5: Run the whole file; fix any stragglers**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts`
Expected: PASS. If a leftover test still references `take-more` or the old label test, remove/adjust it (it's superseded by this redesign). The `hover`/`select`/`pending`/`error`/`Escape`/`unmount-dismiss` tests must still pass unchanged — they are the behaviour-parity guarantee; do NOT weaken them.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/TakeStrip.vue \
        frontend/tests/unit/take-strip.unit.spec.ts
git commit -m "feat(take-strip): pure-image tiles + per-card Variations/Keep (hover/focus/selected)"
```

---

### Task 4: Description → styled tooltip (replace the native title)

Replace `:title="t.rationale"` (the OS-default box) with a styled, on-brand tooltip that floats above each take's card, points down to it, shows the rationale only, and fades in after a short pause via CSS transition-delay (buttons appear immediately; the tooltip lingers behind them). Present in the DOM; revealed on hover / focus-within / selected.

**Files:**
- Modify: `frontend/app/components/vue-canvas/studio/TakeStrip.vue`
- Test: `frontend/tests/unit/take-strip.unit.spec.ts`

**Interfaces:**
- Produces per take: `[data-testid="take-tip"]` inside that take's cell, text = `t.rationale`, absolutely positioned above the tile. No `title` attribute remains on the tile button.

- [ ] **Step 1: Write the failing test**

```ts
describe('TakeStrip — description tooltip', () => {
  it('each take has a styled tooltip with its rationale, and no native title', () => {
    const w = mount(TakeStrip, { props: base() })
    const first = tiles(w)[0]!
    // native title is gone (was the unstyled OS box)
    expect(first.attributes('title')).toBeUndefined()
    const tip = tiles(w).map((_, i) =>
      w.findAll('[data-testid="take-tip"]')[i]!)
    expect(w.findAll('[data-testid="take-tip"]')).toHaveLength(w.props('takes').length)
    expect(w.findAll('[data-testid="take-tip"]')[0]!.text()).toBe(w.props('takes')[0]!.rationale)
  })
})
```

- [ ] **Step 2: Run, watch fail**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts -t "tooltip"`
Expected: FAIL — no `take-tip`; title still present.

- [ ] **Step 3: In the take loop**, remove `:title="t.rationale"` from the tile `<button>`, and add the tooltip as a sibling inside the cell (above the tile). Insert directly after the closing `</button>` of the tile, before the per-card actions div:

```html
<!-- styled description tooltip: supplementary weight, above its own card -->
<div v-if="t.rationale" data-testid="take-tip"
     :class="['pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 z-10 w-[210px] -translate-x-1/2',
              'rounded-[8px] border border-white/15 bg-[#161a21] px-2.5 py-2',
              'text-[11.5px] leading-normal text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.45)]',
              'opacity-0 transition-opacity duration-150 delay-[350ms]',
              'group-hover:opacity-100 group-focus-within:opacity-100',
              selected === t ? '!opacity-100 !delay-0' : '']">
    {{ t.rationale }}
  <span class="absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45
               border-b border-r border-white/15 bg-[#161a21]" />
</div>
```

- [ ] **Step 4: Run**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts -t "tooltip"`
Expected: PASS.

- [ ] **Step 5: Full file + typecheck**

Run: `npx vitest run tests/unit/take-strip.unit.spec.ts && npx vue-tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: all take-strip tests PASS; typecheck count `420` (baseline held).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/TakeStrip.vue \
        frontend/tests/unit/take-strip.unit.spec.ts
git commit -m "feat(take-strip): styled on-brand description tooltip, replacing the native title"
```

---

### Task 5: Live visual verification + Re-roll intensity call

Confirm the redesign reads calm in the real studio and settle the one open taste call (white Re-roll intensity).

**Files:** none unless an adjustment is needed (then `TakeStrip.vue`).

- [ ] **Step 1: Start the dev server and open the gradient studio.** From repo root: `./dev.sh` (full stack) or `cd frontend && npm run dev` (frontend only, 127.0.0.1:3000). Open the gradient studio, run a compose ("a dreamy sunset-like gradient"). HARD-RELOAD first (shader/HMR staleness).

- [ ] **Step 2: Verify against the spec, tile-by-tile:** pure-image tiles (no text); "current" cell dimmed with marker, no dashed stroke; hovering a take shows the styled tooltip above + Variations/Keep at its base; the bar is Cancel (left) + white Re-roll (right); Keep is the only blue. Screenshot the strip idle and mid-hover.

- [ ] **Step 3: Judge the white Re-roll.** If it shouts against the calm bar, soften to off-white: change the `neutral` variant `bg-white` → `bg-white/85` (or add a hairline `border border-white/20` and `bg-white/[0.9]`). Re-run `tests/unit/take-strip.unit.spec.ts` (the `bg-white` assertion in Task 1 still matches `bg-white/85`). Owner confirms from the screenshot.

- [ ] **Step 4: Behaviour smoke:** hover a take (preview updates), click Keep on a card (commits that take, strip closes), re-open, Re-roll (four new), Variations on a card (tight set), Cancel (restores original). Nothing changed in what the controls do.

- [ ] **Step 5: Send the owner the before/after screenshot and the intensity decision. Commit only if Step 3 changed a file:**

```bash
git add frontend/app/components/vue-canvas/studio/StudioButton.vue
git commit -m "fix(take-strip): soften white Re-roll to sit calmer on the bar"
```

---

## Self-Review

- **Spec coverage:** pure-image tiles (T3) ✓; current cell no-dash/dim/marker/"current" (T2) ✓; styled tooltip supplementary (T4) ✓; labels dropped from UI, still logged — logging is host-side and untouched, UI removal in T2/T3 ✓; per-card Variations/Keep on hover/focus/selected (T3) ✓; bar Cancel-left/Re-roll-white-right (T1) ✓; hierarchy Keep-accent/Re-roll-white/Cancel-text (T1+T3) ✓; reveal on hover/focus/selected (T3+T4) ✓; tooltip delay ~350ms (T4) ✓; Re-roll intensity taste call (T5) ✓; terminology mapping (T1+T3) ✓; behaviour parity pinned (every task keeps hover/select/keep/dismiss/moreDirections/variationsOf) ✓.
- **Placeholder scan:** all steps carry real code, exact testids, exact commands. No TBD/TODO.
- **Type/name consistency:** testids consistent across tasks (`take-current`, `take-current-mark`, `take-tile`, `take-keep`, `take-variations`, `take-tip`, `take-actions`, `take-dismiss`, `take-reroll`, `take-pending`, `take-error`, `take-reviewing`); emit names match the unchanged contract; `neutral` variant defined in T1 and used in T1/T5; per-card Keep uses `select(t)` then `keep()` consistently.
