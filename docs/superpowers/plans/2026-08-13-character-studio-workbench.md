# Character Studio Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six-section Character Library panel with a thin roster + a workbench modal studio where the composite sheet is the stage, speaking only the quiet-readiness vocabulary (Not built · Not tested · N/10 poses · Ready).

**Architecture:** Presentation-only refactor on top of the just-landed character system. A pure `readiness` module maps the hidden state machine to the four-word vocabulary; the panel's ~700 lines of orchestration logic (sheet generation, reroll, stress, CRUD) extract verbatim into a `useCharacterStudio` composable; two new focused SFCs (`CharacterRosterPanel`, `CharacterStudioModal`) consume it; the old panel and the `CharacterSheetNode` canvas node are deleted. Zero server/model/store changes.

**Tech Stack:** Vue 3 SFCs (Nuxt 4 auto-import), existing `useCharacters` store + character bus, `StudioButton`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-character-studio-workbench-design.md`

## Global Constraints

- **Working dir:** `frontend/`. Tests: `npx vitest run tests/unit/<file>` (targeted files only). Compile checks: `npx vue-tsc --noEmit 2>&1 | grep -E "<touched files>"` → zero new errors.
- **Quiet readiness is absolute:** the words `locked`, `draft`, `stress`, `variant` never appear in user-facing text. The ONLY status vocabulary is: **Not built** (grey) · **Not tested** (grey) · **N/10 poses** (amber) · **Ready** (action-blue). Machine values (`status`, `stressResult`) are unchanged under the hood.
- **Presentation-only:** no changes to `shared/characters/types.ts`, `characterRegistry.ts`, `characterStatePatch.ts`, `characters-local.*` routes, `useCharacters.ts`, `bus.ts`, `useSheetGeneration.ts`, `sheetComposite.ts`, `stress.ts`, cast/compile. If a task seems to need one, STOP and report BLOCKED.
- **Ported logic is moved verbatim** unless a step says otherwise — the orchestration in `CharacterLibraryPanel.vue` is review-hardened (money guards, 409 handling, re-entrancy); do not "improve" it in flight.
- **Money paths stay behind explicit clicks.** Test-mode tile generation and sheet generation must remain reachable only from button handlers.
- **New components use `StudioButton`** for action buttons (action blue only, purple banned). The old panel's hand-rolled buttons die with it.
- Shared main-direct checkout; parallel sessions commit concurrently. Stage ONLY files you touch; record exact commit SHAs; review packages are built per-commit.
- Ignore `frontend/.claude/worktrees/**`.

## File Structure

| File | Responsibility |
|---|---|
| `app/lib/characters/readiness.ts` (new) | Pure: `CharacterState` → readiness descriptor (key/label/tone). The single place UI wording comes from. |
| `app/composables/useCharacterStudio.ts` (new) | Per-character orchestration moved out of the old panel: sheet gen, reroll, stress run, auto-ready, state CRUD, descriptor save, dress. |
| `app/components/vue-canvas/CharacterRosterPanel.vue` (new) | Thin roster: cards + Image/Shot actions + New character. |
| `app/components/vue-canvas/CharacterStudioModal.vue` (new) | The workbench: header, looks rail, sheet stage, descriptor line, photos drawer, footer, test mode. |
| `app/components/vue-canvas/CharacterLibraryPanel.vue` | DELETED (Task 4). |
| `app/components/vue-canvas/CharacterSheetNode.vue` | DELETED (Task 5), registration removed, saved-graph degrade verified. |
| `app/components/vue-canvas/{CharacterNode,CharacterPickerModal}.vue` | Badges/labels reworded via `readiness.ts`. |
| `app/layouts/default.vue:4165` | Mount swap. |
| `tests/character-sheet.spec.ts` | Selector updates for roster/studio. |

---

### Task 1: `readiness.ts` — the four-word vocabulary

**Files:**
- Create: `frontend/app/lib/characters/readiness.ts`
- Test: `frontend/tests/unit/character-readiness.unit.spec.ts` (new)

**Interfaces:**
- Consumes: `CharacterState` from `#shared/characters/types`; `STRESS_TILE_COUNT` from `~/lib/characters/stress`.
- Produces (every later task renders status through this — nothing else invents wording):

```ts
export type ReadinessKey = 'not-built' | 'not-tested' | 'partial' | 'ready'
export interface Readiness { key: ReadinessKey; label: string; tone: 'grey' | 'amber' | 'blue' }
export function readiness(state: Pick<CharacterState, 'status' | 'sheetImage' | 'stressResult'>): Readiness
```

Mapping (exact): `status === 'locked'` → `{ key: 'ready', label: 'Ready', tone: 'blue' }`. Else no `sheetImage` → `{ key: 'not-built', label: 'Not built', tone: 'grey' }`. Else `status === 'testing' && stressResult` → `{ key: 'partial', label: '${passes}/${total} poses', tone: 'amber' }` (e.g. `6/10 poses`). Else → `{ key: 'not-tested', label: 'Not tested', tone: 'grey' }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { readiness } from '~/lib/characters/readiness'

const base = { status: 'draft' as const, sheetImage: null, stressResult: null }

describe('readiness', () => {
  it('locked → Ready/blue regardless of other fields', () => {
    expect(readiness({ ...base, status: 'locked', sheetImage: 's.png', stressResult: { passes: 10, total: 10, at: 't' } }))
      .toEqual({ key: 'ready', label: 'Ready', tone: 'blue' })
  })
  it('no sheet → Not built/grey (even while testing)', () => {
    expect(readiness(base)).toEqual({ key: 'not-built', label: 'Not built', tone: 'grey' })
    expect(readiness({ ...base, status: 'testing' })).toEqual({ key: 'not-built', label: 'Not built', tone: 'grey' })
  })
  it('sheet, draft → Not tested/grey', () => {
    expect(readiness({ ...base, sheetImage: 's.png' })).toEqual({ key: 'not-tested', label: 'Not tested', tone: 'grey' })
  })
  it('testing with a partial result → N/10 poses, amber', () => {
    expect(readiness({ ...base, status: 'testing', sheetImage: 's.png', stressResult: { passes: 6, total: 10, at: 't' } }))
      .toEqual({ key: 'partial', label: '6/10 poses', tone: 'amber' })
  })
  it('testing without a saved result → Not tested (no fake numbers)', () => {
    expect(readiness({ ...base, status: 'testing', sheetImage: 's.png' }))
      .toEqual({ key: 'not-tested', label: 'Not tested', tone: 'grey' })
  })
  it('never emits machine words', () => {
    for (const s of [base, { ...base, sheetImage: 's.png' }, { ...base, status: 'testing' as const, sheetImage: 's.png' }]) {
      expect(readiness(s).label).not.toMatch(/lock|draft|stress|variant/i)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/character-readiness.unit.spec.ts` — Expected: FAIL (module not found)
- [ ] **Step 3: Implement** (~20 lines, direct transcription of the mapping above; `label` for partial built with a template literal from `stressResult.passes`/`total`).
- [ ] **Step 4: Run to verify pass**, then commit: `git add app/lib/characters/readiness.ts tests/unit/character-readiness.unit.spec.ts && git commit -m "feat(characters): readiness module — the four-word status vocabulary"`

### Task 2: Extract `useCharacterStudio` (panel behavior unchanged)

**Files:**
- Create: `frontend/app/composables/useCharacterStudio.ts`
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue` (script slims to consume the composable; template untouched)
- Test: `frontend/tests/unit/character-studio-composable.unit.spec.ts` (new, thin)

**Interfaces:**
- Consumes: everything the panel already imports (`useCharacters`, `useSheetGeneration`, `bakeCompositeSheet`, stress module, `uploadRefFilename`, dress kit, `usePendingTrainerSeed`, bus).
- Produces — `useCharacterStudio()` returns the panel's current orchestration surface, names preserved so the move is mechanical:

```ts
export function useCharacterStudio(): {
  // state CRUD + selection (old panel lines ~209-323)
  selectedStateId, selectState, activeState, sortedStates,
  replaceState, saveDescriptor, addRefFiles, removeRef, setCover, deleteState, createState,
  // sheet generation (old lines ~325-501)
  expanding, sheetFor, buildSource, sheetCostLabel, panelUrl, generateSheet, rerollTile,
  // stress + ready (old lines ~503-591) — plus the two NEW behaviors below
  stressTiles, stressBusy, stressTilesFor, stressPassCount, runStressTest,
  markTile, exitTestMode, autoReadyIfComplete,
  // dress + train (old lines ~593+)
  dressState, trainIdentity,
  STALE_MESSAGE,
}
```

Two NEW behaviors (the only non-verbatim code in this task, both TDD'd where pure):
1. **Auto-ready:** `autoReadyIfComplete(c, state)` — when `canLock(tiles)`, send the existing lock patch (the old `lockStress` body moves here) WITHOUT a button; called after every `markTile`. The old exported `lockStress` name dies.
2. **Partial persistence:** `exitTestMode(c, state)` — if ≥1 tile judged and not complete, `patchState(... { patch: { stressResult: { passes: passCount, total: STRESS_TILE_COUNT, at: new Date().toISOString() } } })` (status stays `testing` — the server allows a non-passing stressResult on a testing state; only locking demands 10/10). This is what makes `readiness`'s `N/10 poses` survive a modal close.

- [ ] **Step 1: Write the failing tests** — pure-logic level only (the composable is glue): `exitTestMode`'s payload builder and `autoReadyIfComplete`'s gate extracted as two small pure functions in the composable file and exported for test:

```ts
export function partialResultPatch(tiles: StressTile[], now: string): { stressResult: StressResult } | null
// null when zero judged or when complete (complete → auto-ready path instead)
export function shouldAutoReady(tiles: StressTile[]): boolean  // === canLock(tiles)
```

```ts
import { partialResultPatch, shouldAutoReady } from '~/composables/useCharacterStudio'
import { freshTiles } from '~/lib/characters/stress'

it('partialResultPatch: null when nothing judged; counts passes when partial; null when complete', () => {
  expect(partialResultPatch(freshTiles(), 'T')).toBe(null)
  const tiles = freshTiles().map((t, i) => ({ ...t, dataUrl: 'd', pass: i < 6 ? true : i < 8 ? false : null }))
  expect(partialResultPatch(tiles, 'T')).toEqual({ stressResult: { passes: 6, total: 10, at: 'T' } })
  const done = freshTiles().map(t => ({ ...t, dataUrl: 'd', pass: true }))
  expect(partialResultPatch(done, 'T')).toBe(null)
})
it('shouldAutoReady mirrors canLock', () => {
  const done = freshTiles().map(t => ({ ...t, dataUrl: 'd', pass: true }))
  expect(shouldAutoReady(done)).toBe(true)
  expect(shouldAutoReady(freshTiles())).toBe(false)
})
```

- [ ] **Step 2: RED**, then move the panel's script blocks listed in the Interfaces mapping into the composable **verbatim** (rename only `variant`→`state` in identifiers where free: `replaceVariant`→`replaceState`, `deleteVariant`→`deleteState`, `createVariant`→`createState`, `selectedVariantId`→`selectedStateId`, `activeVariant`→`activeState`; user-facing strings unchanged this task). The panel's `<script setup>` becomes `const studio = useCharacterStudio()` + destructure + the roster-only bits that stay (`runAbsorbOnce`, use-in-image menu, `castInShot`, `statusFor`/`trainingPct`/`loraChip`, expand/collapse). Template updates only identifier renames.
- [ ] **Step 3: GREEN** — `npx vitest run tests/unit/character-studio-composable.unit.spec.ts tests/unit/character-stress.unit.spec.ts tests/unit/characters-composable.unit.spec.ts` + `npx vue-tsc --noEmit 2>&1 | grep -E "CharacterLibraryPanel|useCharacterStudio"` → zero. Hand-check on the dev server: panel still generates/rerolls/tests exactly as before (no paid clicks — verify reachability and one descriptor save).
- [ ] **Step 4: Commit** — `git commit -m "refactor(characters): extract useCharacterStudio composable — panel behavior unchanged"`

### Task 3: `CharacterStudioModal.vue` — the workbench

**Files:**
- Create: `frontend/app/components/vue-canvas/CharacterStudioModal.vue`
- Create: `frontend/app/pages/dev/character-studio.vue` (dev harness: mounts the modal open with the first character)
- Modify: none else (old panel keeps working until Task 4)

**Interfaces:**
- Consumes: `useCharacterStudio()` (Task 2), `readiness()` (Task 1), `useCharacters()`, `StudioButton`, `bakeCompositeSheet`'s `compositeLayout()` (for stage hover regions), modal chrome idiom from `ShotDirectorSurface.vue`/`LipSyncSurface.vue` (Teleport + overlay + Escape/backdrop dismissal — copy the pattern, cite which file you copied in the report).
- Produces: `<CharacterStudioModal :slug="string|null" :createMode="boolean" @close />` — `slug=null && createMode` renders the creation state (name field + photo drop; first photo becomes cover, then the workbench appears in-place).

Layout contract (matches the approved mockups; wireframes in `.superpowers/brainstorm/72662-1786640415/content/workbench-design.html`):

- **Header:** inline-editable name (`patchCharacter` on blur), readiness badge from `readiness(activeState)` (tone→class: grey `bg-white/10 text-white/50`, amber `text-amber-300 bg-amber-300/10`, blue `text-sky-300 bg-sky-300/10` — match the exact action-blue token the panel's Ready chip already uses; grep `sky` in the old panel), close ✕.
- **Left rail:** one row per `sortedStates(c)` — label + mini readiness label; active row highlighted; bottom "+ New look" expands two inline creators: *Describe* (name + descriptor inputs → `createState`) and *Dress her* (the ported dress flow → creates the state).
- **Stage:** when `activeState.sheetImage` → single `<img>` of `viewRefUrl(sheetImage)` with 5 absolutely-positioned hover regions computed from `compositeLayout()` rects scaled to the rendered size, each offering "Redo this shot" → `rerollTile`. When no sheet → empty stage: one sentence + `StudioButton` "Build her sheet · {sheetCostLabel}" → `generateSheet`. While `expanding.has(key)` → progress overlay on the stage (reuse the old panel's busy presentation).
- **Descriptor line:** one inline input under the stage, italic, placeholder `What she wears in this look — it travels into every shot.`, saves via `saveDescriptor` (blur/Enter), STALE toast preserved.
- **Photos drawer:** horizontal thumb strip + "+" tile (`addRefFiles`), hover affordances for set-cover/remove, small label "her photos". No headline, no explainer paragraph, no per-photo Sheet buttons.
- **Footer:** left `StudioButton` ghost "Test 10 poses · ~$0.80" (only when sheet exists) → test mode; center hint `hover any panel to redo just that shot`; right: ⋯ menu (Train identity → `trainIdentity`; Delete character → confirm + `removeCharacter` + close) + primary `StudioButton` "Rebuild sheet / Build her sheet".
- **Test mode:** replaces the stage: 10-tile grid (port the old stress grid markup), ✓/✕ via `markTile`, tally line `**N of M held up so far** — mark each: is this her?`; after every mark `autoReadyIfComplete` fires — on success show a brief confirmation (toast "‹Name› is ready") and exit test mode; "Back to sheet" → `exitTestMode` then swap back. Failure hint under the grid when all judged but not 10/10: `Fix the description, not the model — edit what she wears, redo a panel, then test again.`
- **Forbidden strings** (grep-proof in the report): `locked`, `draft`, `stress`, `variant`, `Reference sheet`, `Uploaded photos` in any user-facing text of the new file.

- [ ] **Step 1:** Build the SFC per the contract; dev harness page mounts it (`<CharacterStudioModal :slug="characters[0]?.slug ?? null" :createMode="!characters.length" @close="() => {}" />`).
- [ ] **Step 2:** Verify: `npx vue-tsc --noEmit 2>&1 | grep CharacterStudioModal` → zero; suites `npx vitest run tests/unit/character-readiness.unit.spec.ts tests/unit/character-studio-composable.unit.spec.ts` green; live on `/dev/character-studio` (127.0.0.1:3000): rail renders looks, stage shows sheet or empty state, descriptor saves, drawer uploads, test-mode swap works WITHOUT clicking any generation button. Grep-proof the forbidden strings.
- [ ] **Step 3: Commit** — `git commit -m "feat(characters): Character Studio workbench modal"`

### Task 4: Roster panel + mount swap + old panel deleted

**Files:**
- Create: `frontend/app/components/vue-canvas/CharacterRosterPanel.vue`
- Modify: `frontend/app/layouts/default.vue:4165` (`<VueCanvasCharacterLibraryPanel @close=…/>` → `<VueCanvasCharacterRosterPanel @close=…/>`), `frontend/app/pages/dev/character-panel.vue` (points at roster)
- Delete: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue`

**Interfaces:**
- Consumes: `useCharacters()`, `readiness()`, bus emits (`addCharacterImageGen`, `addCharacterCastNode`), the use-in-image sheet/LoRA menu + `castInShot` + `runAbsorbOnce` + training chip logic (`statusFor`/`trainingPct`/`loraChip`) — ported from the old panel verbatim; `CharacterStudioModal` (Task 3).
- Produces: the roster card contract — portrait thumb (`portraitUrl(c, null)` → cover → blank), name, ONE readiness line (`readiness(defaultState(c))` + the training chip when a LoRA job is in flight), `StudioButton` **Image** / **Shot**, card click (outside those buttons) opens `<CharacterStudioModal :slug="c.slug">`; dashed "+ New character" card opens it with `createMode`. The modal is rendered by the roster component (one instance, `slug` ref).

- [ ] **Step 1:** Build roster + wire modal; delete the old panel file; swap the mount; grep `CharacterLibraryPanel` across `app/` (excluding worktrees) → zero references (list survivors + fixes).
- [ ] **Step 2:** Verify: vue-tsc grep for `CharacterRosterPanel|default.vue` → zero new; live: panel opens as roster, cards show readiness lines, Image/Shot buttons work (nodes created), card click opens the studio, New character creates. All free actions only.
- [ ] **Step 3: Commit** — `git commit -m "feat(characters): thin roster panel; library panel retired"`

### Task 5: Retire `CharacterSheetNode`; pickers speak readiness

**Files:**
- Delete: `frontend/app/components/vue-canvas/CharacterSheetNode.vue`
- Modify: wherever it's registered — find with `grep -rn "CharacterSheet" app/ --include='*.ts' --include='*.vue' | grep -v worktrees` (expect: node-type registry/component map in `useVueNodes.ts` or the canvas component map, `action-catalog.ts` entry, `castEdges.ts`'s `nodeType === 'CharacterSheet'` check STAYS — saved graphs still contain such nodes and must keep casting), `frontend/app/components/vue-canvas/CharacterNode.vue` + `CharacterPickerModal.vue` (badge wording via `readiness()`)
- Test: extend `tests/unit/shotdirector-cast-edges.unit.spec.ts` only if the degrade path changes `CastNodeLite` handling (it must NOT — assert existing tests stay green)

**Interfaces:**
- Consumes: `readiness()` (Task 1).
- Produces: saved graphs containing a `CharacterSheet` node degrade gracefully: the node renders via the fallback/unknown-node path (verify what the canvas does with an unregistered nodeType — if it crashes, register the type to the plain `CharacterNode` component instead of deleting outright, and say which you did in the report), and its cast wiring keeps working (`castEdges.ts` check untouched). Pickers: `CharacterPickerModal`'s "draft — not stress-tested" badge and `CharacterNode`'s select labels become `readiness(state).label` with tone classes; the "No reference photos…" warning wording survives only where `identityRefs` is genuinely empty.

- [ ] **Step 1:** Grep, remove registration + file (or remap type → CharacterNode per the degrade check), rewrite picker badges through `readiness()`. Grep-proof: no user-facing `draft`/`stress` strings remain in `app/components/vue-canvas/Character*.vue`.
- [ ] **Step 2:** Verify: `npx vitest run tests/unit/shotdirector-cast-edges.unit.spec.ts tests/unit/character-readiness.unit.spec.ts` green; vue-tsc grep clean; live: load a saved graph with an old sheet node if one exists in the sessions dir (`grep -rl CharacterSheet ../user/default/workflows 2>/dev/null | head -1`) or synthesize one via the persistence round-trip test pattern — the graph loads without crashing and the cast edge still materializes.
- [ ] **Step 3: Commit** — `git commit -m "refactor(characters): sheet-builder node retired; pickers speak readiness"`

### Task 6: E2E + verification + docs

**Files:**
- Modify: `frontend/tests/character-sheet.spec.ts` (roster/studio selectors), `docs/STATE.md`
- Dashboard: controller-owned — SKIP in this task.

- [ ] **Step 1:** Update the E2E: Scenario A's cast flow now goes roster card → "Shot" button (same bus event) — assert unchanged (`image_urls[0]` carries the sheet filename + descriptor clause). Scenario B via roster "Image". Add scenario C (new, cheap): open a character card → studio modal renders, the readiness badge text is one of the four vocabulary words, and the forbidden-word grep of the rendered modal DOM (`page.locator('.studio-modal').innerText()` match against `/lock|draft|stress|variant/i`) is empty. Run: `npx playwright test tests/character-sheet.spec.ts` → green.
- [ ] **Step 2:** Full targeted suite: `npx vitest run tests/unit/character-readiness.unit.spec.ts tests/unit/character-studio-composable.unit.spec.ts tests/unit/character-model.unit.spec.ts tests/unit/character-registry.unit.spec.ts tests/unit/character-state-patch.unit.spec.ts tests/unit/characters-composable.unit.spec.ts tests/unit/character-bus.unit.spec.ts tests/unit/character-stress.unit.spec.ts tests/unit/sheet-generation.unit.spec.ts tests/unit/sheet-composite.unit.spec.ts tests/unit/shotdirector-cast.unit.spec.ts tests/unit/shotdirector-cast-edges.unit.spec.ts` → all green. Typecheck: total ≤ current baseline (~415) AND zero errors naming `readiness|CharacterStudio|CharacterRoster`.
- [ ] **Step 3:** `docs/STATE.md`: append a "Character Studio workbench — LANDED" subsection to the character-system entry (what changed, kill list, the paid verifications still owed). Commit: `git commit -m "test(characters): studio E2E + docs — workbench landed"`

## Self-review notes (applied)

- **Spec coverage:** §1→T3/T4 (shell+entry, creation state, harness), §2→T2/T3 (workbench, dress-in-new-look, train-in-overflow), §3→T1/T2/T3 (vocabulary, partial persistence, auto-ready, test mode), §4→T4/T5 (splits, deletions, StudioButton, degrade), kill list→T3 forbidden-strings grep + T5 picker rewording.
- **Spec deviation, deliberate:** the spec's readiness table maps bare `testing` → "N/10 poses"; without persisted counts that's unknowable, so bare `testing` (no stressResult) shows "Not tested" and Task 2's partial-persistence makes real counts exist. Honest data beats invented numbers.
- **Type consistency:** `readiness()` (T1) consumed in T3/T4/T5; `useCharacterStudio` names fixed in T2's Interfaces block and reused verbatim in T3; `partialResultPatch`/`shouldAutoReady` exported for tests only.
