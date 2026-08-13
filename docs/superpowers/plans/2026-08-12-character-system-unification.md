# Character System Unification + Higgsfield Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the nine competing representations of "a character" into one shared `CharacterState` model, then build the Higgsfield sheet methodology on top: per-state composite sheets (headless bodies + ¾ portrait + smile/no-smile faces) that BOTH image and video generation consume identically, gated by a manual 10/10 stress test before Lock.

**Architecture:** A shared types module in `frontend/shared/` feeds both the Nitro server (registry, per-state PATCH with 409 stale-write guard) and the client (a single `useCharacters` store replacing five window CustomEvents with store actions + one typed bus). Sheet generation is portrait-first (Ideogram Character or Flux LoRA), with headless bodies and face close-ups derived via nano-banana edits, composited client-side into one wide image that becomes the state's identity asset. `CAST_REF_CAP = 1` survives — the one ref just carries front/back/face now.

**Tech Stack:** Nuxt 4 (Vue 3 + TS), Nitro server routes, Vitest unit tests, Playwright E2E, Replicate (ideogram-ai/ideogram-character) + nano-banana-pro via existing endpoints.

**Spec:** `docs/superpowers/specs/2026-08-12-character-system-unification-design.md`

## Global Constraints

- **Working directory for all commands:** `frontend/` unless stated. Tests: `npx vitest run tests/unit/<file>` (run targeted files; parallel full-tree runs miscount under load).
- **Typecheck discipline:** baseline is ~328 pre-existing errors. Any error mentioning a type/function THIS plan introduces is yours to fix, never "pre-existing".
- **Compile check for Vue edits without unit coverage:** `curl -sf "http://127.0.0.1:3000/_nuxt/app/components/vue-canvas/<File>.vue" -o /dev/null` against a running dev server (Vite returns 500 on compile errors), or rely on vitest importing the module.
- **Money paths:** sequential generation with abort-on-first-failure, always behind an explicit click. Never generate as a mount side effect.
- **Registry filenames:** bare filenames in ComfyUI's `../input` dir, validated by `validRefFilename` (no `/`, `\`, `..`). URLs are derived via `viewRefUrl(filename)` at the edge, never stored.
- **`CAST_REF_CAP = 1` is load-bearing** (multiple photos of one person → Seedance duplicates people). Do not raise it.
- **`'default'` is a stored state id, never a sentinel.** Client-side `stateId` is `string | null`; `normalizeStateId` maps `'default'`/`''`/`undefined` → `null` at every boundary.
- **UI:** StudioButton for action buttons, action blue only. No purple.
- **Ignore** `frontend/.claude/worktrees/**` — byte-identical scratch copies that pollute greps.
- **Do not commit** unrelated dirty files from parallel sessions. Stage only your own files (`git add <exact paths>`).

## File Structure

| File | Responsibility |
|---|---|
| `frontend/shared/characters/types.ts` (new) | THE character model: `CharacterRecord`, `CharacterState`, `CharacterPanel`, pure pick/normalize/ref-ordering helpers. Imported by server AND app. |
| `frontend/server/utils/characterRegistry.ts` | Parse/heal/migrate on-disk records (3 eras: legacy refImages → variants → states). Re-exports shared types. |
| `frontend/server/api/characters-local.patch.ts` | Full-record ops + per-state `statePatch` with `expectedUpdatedAt` 409 guard + server-side lock validation. |
| `frontend/app/composables/useCharacters.ts` | THE client store: cached list + all mutations (each mutation refreshes internally — no more `sailor:charactersChanged`). |
| `frontend/app/lib/characters/bus.ts` (new) | Typed emitter for the 4 genuinely cross-surface ops (cast edges changed, uncast, add image-gen node, add cast node). |
| `frontend/app/lib/characters/sheetComposite.ts` (new) | Pure composite layout + canvas bake for the 5-panel Higgsfield sheet. |
| `frontend/app/lib/characters/stress.ts` (new) | Pure stress-test state machine: tiles, outcome, lock/edit transitions. |
| `frontend/app/data/character-shot-scenes.ts` | `HIGGSFIELD_PANELS` replaces `CHARACTER_SHEET_CANONICAL`; 25-scene training library unchanged. |
| `frontend/app/composables/useSheetGeneration.ts` | Portrait-first pipeline: portrait gen → derived nano-banana edits, per-panel reroll. |
| `frontend/app/lib/shotdirector/{types,cast,castEdges,compile}.ts` | `CastMember.stateId: string \| null`; `castClause` gains state descriptors. |
| `frontend/app/components/vue-canvas/{CharacterLibraryPanel,CharacterSheetNode,CharacterNode,VueNodeCanvas,ShotDirectorSurface,LipSyncSurface}.vue` | Consumers migrate to store + bus + binding. |

---

## Phase 1 — One shared model

### Task 1: Shared `CharacterState` model

**Files:**
- Create: `frontend/shared/characters/types.ts`
- Modify: `frontend/vitest.config.ts` (add `#shared` alias if absent — check first)
- Test: `frontend/tests/unit/character-model.unit.spec.ts` (new)

**Interfaces (Produces — every later task consumes these):**

```ts
export type PanelSlot = 'body-front' | 'body-back' | 'portrait' | 'face-neutral' | 'face-smile'
export interface CharacterPanel { slot: PanelSlot; filename: string }
export type CharacterStateStatus = 'draft' | 'testing' | 'locked'
export interface StressResult { passes: number; total: number; at: string }
export interface CharacterState {
  id: string; label: string; descriptor: string
  refImages: string[]; coverIndex: number          // legacy ref pool (uploads, LoRA fodder, fallback)
  panels: CharacterPanel[]                          // the 5 Higgsfield source shots
  sheetImage: string | null                         // composite filename; THE identity asset once set
  status: CharacterStateStatus
  stressResult: StressResult | null
  updatedAt: string
}
export interface CharacterRecord {
  name: string; slug: string; states: CharacterState[]
  loraName: string | null; trigger: string | null; notes: string
  createdAt: string; updatedAt: string
}
export function normalizeStateId(id: string | null | undefined): string | null   // 'default' | '' | undefined → null
export function pickState(record: Pick<CharacterRecord,'states'>, stateId: string | null): CharacterState | undefined
export function defaultState(record: Pick<CharacterRecord,'states'>): CharacterState
export function coverFirstRefs(state?: Pick<CharacterState,'refImages'|'coverIndex'>): string[]
export function panelFilename(state: Pick<CharacterState,'panels'>, slot: PanelSlot): string | null
export function identityRefs(state?: CharacterState): string[]  // [sheetImage, ...coverFirstRefs] when sheet set, else coverFirstRefs
export function emptyState(id: string, label: string): CharacterState
```

- [ ] **Step 1: Check the vitest config for an alias block**

Run: `grep -n "alias" frontend/vitest.config.ts frontend/vitest.config.* 2>/dev/null`
If a `resolve.alias` map exists, add `'#shared': fileURLToPath(new URL('./shared', import.meta.url))` to it. If Nuxt's test config already resolves `#shared` (try the failing test first), skip.

- [ ] **Step 2: Write the failing test** — `frontend/tests/unit/character-model.unit.spec.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  coverFirstRefs, defaultState, emptyState, identityRefs,
  normalizeStateId, panelFilename, pickState,
} from '#shared/characters/types'

const state = (over: Partial<ReturnType<typeof emptyState>> = {}) => ({ ...emptyState('default', 'Default'), ...over })

describe('normalizeStateId', () => {
  it('maps the default sentinel and empties to null', () => {
    expect(normalizeStateId('default')).toBe(null)
    expect(normalizeStateId('')).toBe(null)
    expect(normalizeStateId(undefined)).toBe(null)
    expect(normalizeStateId(null)).toBe(null)
  })
  it('passes real ids through', () => { expect(normalizeStateId('wet')).toBe('wet') })
})

describe('pickState', () => {
  const rec = { states: [state(), state({ id: 'wet', label: 'Wet' })] }
  it('null → default state', () => { expect(pickState(rec, null)?.id).toBe('default') })
  it('named → that state', () => { expect(pickState(rec, 'wet')?.id).toBe('wet') })
  it('unknown → default fallback', () => { expect(pickState(rec, 'gone')?.id).toBe('default') })
  it('no default → first', () => {
    expect(pickState({ states: [state({ id: 'only' })] }, null)?.id).toBe('only')
  })
})

describe('coverFirstRefs', () => {
  it('cover leads, order otherwise preserved', () => {
    expect(coverFirstRefs({ refImages: ['a', 'b', 'c'], coverIndex: 1 })).toEqual(['b', 'a', 'c'])
  })
  it('empty/undefined → []', () => { expect(coverFirstRefs(undefined)).toEqual([]) })
})

describe('identityRefs', () => {
  it('sheet leads when present', () => {
    const s = state({ sheetImage: 'sheet.png', refImages: ['a.png'], coverIndex: 0 })
    expect(identityRefs(s)).toEqual(['sheet.png', 'a.png'])
  })
  it('falls back to cover-first refs without a sheet', () => {
    const s = state({ refImages: ['a.png', 'b.png'], coverIndex: 1 })
    expect(identityRefs(s)).toEqual(['b.png', 'a.png'])
  })
})

describe('panelFilename', () => {
  it('finds a slot, null when missing', () => {
    const s = state({ panels: [{ slot: 'portrait', filename: 'p.png' }] })
    expect(panelFilename(s, 'portrait')).toBe('p.png')
    expect(panelFilename(s, 'body-back')).toBe(null)
  })
})
```

- [ ] **Step 3: Run to verify failure** — `cd frontend && npx vitest run tests/unit/character-model.unit.spec.ts` — Expected: FAIL (cannot resolve `#shared/characters/types`)

- [ ] **Step 4: Implement** — `frontend/shared/characters/types.ts`

```ts
/**
 * THE character model. One character = a set of STATES (Higgsfield: one asset
 * per state — Cal-clean / Cal-wet / Cal-bloody), each with its own composite
 * sheet that is the identity asset every generator consumes. Imported by both
 * the Nitro server (registry) and the app (store) — no more hand-copied mirrors.
 */
export type PanelSlot = 'body-front' | 'body-back' | 'portrait' | 'face-neutral' | 'face-smile'

export interface CharacterPanel { slot: PanelSlot; filename: string }

export type CharacterStateStatus = 'draft' | 'testing' | 'locked'

export interface StressResult { passes: number; total: number; at: string }

export interface CharacterState {
  /** Stable id. 'default' is an ordinary stored id — client-side addressing uses null for "the default". */
  id: string
  label: string
  /** State look descriptor ("soaked navy jacket, wet hair") — feeds sheet prompts AND the shot's cast clause. */
  descriptor: string
  /** Legacy free-form ref pool (uploads, LoRA training fodder, pre-sheet fallback). */
  refImages: string[]
  coverIndex: number
  /** The 5 Higgsfield source shots, kept for per-panel reroll. */
  panels: CharacterPanel[]
  /** Composite sheet filename in the input dir — THE identity asset once generated. */
  sheetImage: string | null
  status: CharacterStateStatus
  stressResult: StressResult | null
  updatedAt: string
}

export interface CharacterRecord {
  name: string
  slug: string
  states: CharacterState[]
  loraName: string | null
  trigger: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

/** 'default' | '' | undefined → null. The ONLY place the sentinel is understood. */
export function normalizeStateId(id: string | null | undefined): string | null {
  return id && id !== 'default' ? id : null
}

export function defaultState<T extends Pick<CharacterRecord, 'states'>>(record: T): T['states'][number] {
  return record.states.find(s => s.id === 'default') ?? record.states[0]!
}

export function pickState<T extends Pick<CharacterRecord, 'states'>>(
  record: T, stateId: string | null,
): T['states'][number] | undefined {
  const byId = stateId ? record.states.find(s => s.id === stateId) : undefined
  return byId ?? record.states.find(s => s.id === 'default') ?? record.states[0]
}

/** Ref filenames cover-first, so `slice(0, 1)` is the cover the user picked. */
export function coverFirstRefs(state?: Pick<CharacterState, 'refImages' | 'coverIndex'>): string[] {
  const refs = state?.refImages ?? []
  if (refs.length <= 1) return [...refs]
  const ci = Math.min(Math.max(state?.coverIndex ?? 0, 0), refs.length - 1)
  return [refs[ci]!, ...refs.slice(0, ci), ...refs.slice(ci + 1)]
}

export function panelFilename(state: Pick<CharacterState, 'panels'>, slot: PanelSlot): string | null {
  return state.panels.find(p => p.slot === slot)?.filename ?? null
}

/**
 * The consumption list, identity-asset-first: once a composite sheet exists it
 * leads (so CAST_REF_CAP=1 sends the sheet); before that, cover-first refs.
 */
export function identityRefs(state?: CharacterState): string[] {
  if (!state) return []
  const rest = coverFirstRefs(state)
  return state.sheetImage ? [state.sheetImage, ...rest] : rest
}

export function emptyState(id: string, label: string): CharacterState {
  return {
    id, label, descriptor: '', refImages: [], coverIndex: 0,
    panels: [], sheetImage: null, status: 'draft', stressResult: null,
    updatedAt: '',
  }
}
```

- [ ] **Step 5: Run to verify pass** — `npx vitest run tests/unit/character-model.unit.spec.ts` — Expected: PASS
- [ ] **Step 6: Commit** — `git add shared/characters/types.ts tests/unit/character-model.unit.spec.ts vitest.config.ts && git commit -m "feat(characters): shared CharacterState model — the one representation"`

### Task 2: Registry parses three eras into states

**Files:**
- Modify: `frontend/server/utils/characterRegistry.ts` (full rewrite of parse/heal; re-export shared types)
- Test: `frontend/tests/unit/character-registry.unit.spec.ts` (update + extend)

**Interfaces:**
- Consumes: Task 1 types (`CharacterRecord`, `CharacterState`, `emptyState`, `defaultState`).
- Produces: `parseCharacterRecord(raw, slug): CharacterRecord | null` (now returns `states`), `healRefImages(record, exists)` (heals `refImages`, `panels`, AND `sheetImage` — a locked state whose sheet file vanished demotes to `draft`), `slugifyCharacterName`, `validRefFilename` unchanged. **`defaultVariant` is deleted; import `defaultState` from `#shared/characters/types` instead** (grep consumers: `characters-local.patch.ts`, `absorb.post.ts`, `characterLink.ts`).

- [ ] **Step 1: Write the failing tests** — add to `frontend/tests/unit/character-registry.unit.spec.ts` (keep existing cases, mechanically rename `variants` → `states` where they assert shape):

```ts
it('migrates era-1 legacy top-level refImages into a default draft state', () => {
  const rec = parseCharacterRecord(JSON.stringify({ name: 'Cal', refImages: ['a.png'], coverIndex: 0 }), 'cal')!
  expect(rec.states).toHaveLength(1)
  expect(rec.states[0]).toMatchObject({
    id: 'default', refImages: ['a.png'], panels: [], sheetImage: null, status: 'draft', stressResult: null,
  })
})

it('migrates era-2 variants into draft states, preserving descriptor/refs/cover', () => {
  const rec = parseCharacterRecord(JSON.stringify({
    name: 'Cal',
    variants: [
      { id: 'default', label: 'Default', descriptor: '', refImages: ['a.png', 'b.png'], coverIndex: 1 },
      { id: 'wet', label: 'Wet', descriptor: 'soaked jacket', refImages: ['w.png'], coverIndex: 0 },
    ],
  }), 'cal')!
  expect(rec.states.map(s => s.id)).toEqual(['default', 'wet'])
  expect(rec.states[1]).toMatchObject({ descriptor: 'soaked jacket', status: 'draft', panels: [], sheetImage: null })
})

it('parses era-3 states natively, dropping invalid panels and unknown statuses', () => {
  const rec = parseCharacterRecord(JSON.stringify({
    name: 'Cal',
    states: [{
      id: 'default', label: 'Default', descriptor: '', refImages: [], coverIndex: 0,
      panels: [{ slot: 'portrait', filename: 'p.png' }, { slot: 'nope', filename: 'x.png' }, { slot: 'body-front', filename: '../evil' }],
      sheetImage: 'sheet.png', status: 'locked', stressResult: { passes: 10, total: 10, at: 't' }, updatedAt: 'u',
    }],
  }), 'cal')!
  expect(rec.states[0]!.panels).toEqual([{ slot: 'portrait', filename: 'p.png' }])
  expect(rec.states[0]!.status).toBe('locked')
  const bad = parseCharacterRecord(JSON.stringify({
    name: 'Cal', states: [{ id: 'default', label: 'D', refImages: [], coverIndex: 0, panels: [], sheetImage: null, status: 'gold', stressResult: null }],
  }), 'cal')!
  expect(bad.states[0]!.status).toBe('draft')
})

it('healRefImages heals panels and demotes a locked state whose sheet vanished', () => {
  const rec = parseCharacterRecord(JSON.stringify({
    name: 'Cal',
    states: [{
      id: 'default', label: 'D', descriptor: '', refImages: ['a.png', 'gone.png'], coverIndex: 1,
      panels: [{ slot: 'portrait', filename: 'p.png' }, { slot: 'body-back', filename: 'gone2.png' }],
      sheetImage: 'gone3.png', status: 'locked', stressResult: { passes: 10, total: 10, at: 't' }, updatedAt: '',
    }],
  }), 'cal')!
  const { record, dropped } = healRefImages(rec, f => !f.startsWith('gone'))
  expect(dropped).toBe(3)
  const s = record.states[0]!
  expect(s.refImages).toEqual(['a.png'])
  expect(s.panels).toEqual([{ slot: 'portrait', filename: 'p.png' }])
  expect(s.sheetImage).toBe(null)
  expect(s.status).toBe('draft')   // locked promise broken — back to draft
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/character-registry.unit.spec.ts` — Expected: FAIL (`states` undefined)
- [ ] **Step 3: Implement.** Rewrite `characterRegistry.ts`: delete the local `CharacterVariant`/`CharacterRecord` interfaces, `import { emptyState, validPanelSlot? … }` — concretely:

```ts
import type { CharacterPanel, CharacterRecord, CharacterState } from '#shared/characters/types'
import { emptyState } from '#shared/characters/types'
export type { CharacterRecord, CharacterState }
export { defaultState } from '#shared/characters/types'

const PANEL_SLOTS = new Set(['body-front', 'body-back', 'portrait', 'face-neutral', 'face-smile'])
const STATUSES = new Set(['draft', 'testing', 'locked'])

// slugifyCharacterName + validRefFilename: unchanged from current file.

function stateHygiene(v: Record<string, unknown>): CharacterState | null {
  if (typeof v.id !== 'string' || !v.id || typeof v.label !== 'string' || !v.label) return null
  const refImages = (Array.isArray(v.refImages) ? v.refImages : [])
    .filter((f): f is string => validRefFilename(f as string))
  const cover = typeof v.coverIndex === 'number' ? v.coverIndex : 0
  const panels = (Array.isArray(v.panels) ? v.panels : [])
    .filter((p): p is CharacterPanel =>
      !!p && typeof p === 'object'
      && PANEL_SLOTS.has((p as CharacterPanel).slot)
      && validRefFilename((p as CharacterPanel).filename))
  const sheetImage = typeof v.sheetImage === 'string' && validRefFilename(v.sheetImage) ? v.sheetImage : null
  const sr = v.stressResult as StressResult | null | undefined
  return {
    id: v.id, label: v.label,
    descriptor: typeof v.descriptor === 'string' ? v.descriptor : '',
    refImages,
    coverIndex: Math.min(Math.max(0, cover), Math.max(0, refImages.length - 1)),
    panels,
    sheetImage,
    status: STATUSES.has(v.status as string) ? v.status as CharacterState['status'] : 'draft',
    stressResult: sr && typeof sr === 'object' && typeof sr.passes === 'number' && typeof sr.total === 'number'
      ? { passes: sr.passes, total: sr.total, at: typeof sr.at === 'string' ? sr.at : '' } : null,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '',
  }
}
```

`parseCharacterRecord`: parse `r.states` with `stateHygiene`; if empty and `r.variants` is an array, map each variant through `stateHygiene` (variants lack panels/status → hygiene defaults fill them); if still empty and `r.refImages` exists, era-1 path exactly like today but through `stateHygiene`. Then the same "ensure exactly one `default` leads" block as today (with `emptyState('default', 'Default')` for the synthesized one). `healRefImages`: extend per the test — heal `refImages` (as today), filter `panels` by `exists`, null a vanished `sheetImage`; when the sheet vanished on a non-draft state also set `status: 'draft'` and `stressResult: null`; count all three in `dropped`.

- [ ] **Step 4: Fix the two other registry consumers that reference `variants`/`defaultVariant`** — `frontend/server/api/characters-local/absorb.post.ts` and `frontend/server/utils/characterLink.ts`: mechanical rename to `states`/`defaultState` (their logic reads/writes the default entry's `refImages` — the field survives on `CharacterState`). Leave `characters-local.patch.ts` compiling by renaming its `variants` handling to `states` minimally (Task 3 rewrites it properly).
- [ ] **Step 5: Run the registry + link + absorb-adjacent suites** — `npx vitest run tests/unit/character-registry.unit.spec.ts tests/unit/character-link.unit.spec.ts tests/unit/training-finalize-link.unit.spec.ts` — Expected: PASS (update any suite fixtures still saying `variants` — same shape, new key)
- [ ] **Step 6: Commit** — `git commit -m "feat(characters): registry parses three record eras into CharacterState[]"` (stage the four touched files + tests)

### Task 3: Per-state PATCH with 409 stale-write guard

**Files:**
- Modify: `frontend/server/api/characters-local.patch.ts`
- Test: `frontend/tests/unit/character-state-patch.unit.spec.ts` (new — extract the pure apply logic so it unit-tests without Nitro)
- Create: `frontend/server/utils/characterStatePatch.ts` (pure apply function; the route stays IO-only)

**Interfaces:**
- Consumes: Task 2 registry.
- Produces:
```ts
// server/utils/characterStatePatch.ts
export interface StatePatchBody {
  stateId: string
  expectedUpdatedAt?: string
  patch: Partial<Pick<CharacterState, 'label' | 'descriptor' | 'refImages' | 'coverIndex' | 'panels' | 'sheetImage' | 'status' | 'stressResult'>>
}
export type StatePatchResult = { ok: true; record: CharacterRecord } | { ok: false; code: 400 | 404 | 409; message: string }
export function applyStatePatch(record: CharacterRecord, body: StatePatchBody, now: string): StatePatchResult
```
- HTTP contract (later tasks call this): `PATCH /api/characters-local` with `{ slug, statePatch: StatePatchBody }` → 200 `{ ok: true }` | 409 `{ statusCode: 409 }` on stale `expectedUpdatedAt` | 400 on invalid patch. Full-array `{ slug, states: CharacterState[] }` remains for structural ops (add/remove state). **The legacy top-level `refImages`/`coverIndex` alias stays for now** (callers migrate in Task 8; removal is Task 9).

- [ ] **Step 1: Write the failing tests** — `frontend/tests/unit/character-state-patch.unit.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyStatePatch } from '~~/server/utils/characterStatePatch'
import { parseCharacterRecord } from '~~/server/utils/characterRegistry'

const rec = () => parseCharacterRecord(JSON.stringify({
  name: 'Cal',
  states: [{ id: 'default', label: 'Default', descriptor: '', refImages: ['a.png'], coverIndex: 0, panels: [], sheetImage: null, status: 'draft', stressResult: null, updatedAt: 'T1' }],
}), 'cal')!

it('patches named fields and stamps updatedAt', () => {
  const r = applyStatePatch(rec(), { stateId: 'default', patch: { descriptor: 'wet hair' } }, 'T2')
  expect(r.ok && r.record.states[0]!.descriptor).toBe('wet hair')
  expect(r.ok && r.record.states[0]!.updatedAt).toBe('T2')
})
it('404 on unknown state', () => {
  expect(applyStatePatch(rec(), { stateId: 'gone', patch: {} }, 'T2')).toMatchObject({ ok: false, code: 404 })
})
it('409 when expectedUpdatedAt is stale', () => {
  expect(applyStatePatch(rec(), { stateId: 'default', expectedUpdatedAt: 'T0', patch: { label: 'X' } }, 'T2'))
    .toMatchObject({ ok: false, code: 409 })
})
it('matching expectedUpdatedAt writes', () => {
  expect(applyStatePatch(rec(), { stateId: 'default', expectedUpdatedAt: 'T1', patch: { label: 'X' } }, 'T2'))
    .toMatchObject({ ok: true })
})
it('400 on bad filenames / unknown patch keys / bad status', () => {
  expect(applyStatePatch(rec(), { stateId: 'default', patch: { refImages: ['../evil'] } }, 'T2')).toMatchObject({ ok: false, code: 400 })
  expect(applyStatePatch(rec(), { stateId: 'default', patch: { nope: 1 } as never }, 'T2')).toMatchObject({ ok: false, code: 400 })
  expect(applyStatePatch(rec(), { stateId: 'default', patch: { status: 'gold' as never } }, 'T2')).toMatchObject({ ok: false, code: 400 })
})
it('locking requires a passing full stress result (in patch or already on state)', () => {
  expect(applyStatePatch(rec(), { stateId: 'default', patch: { status: 'locked' } }, 'T2')).toMatchObject({ ok: false, code: 400 })
  expect(applyStatePatch(rec(), {
    stateId: 'default',
    patch: { status: 'locked', stressResult: { passes: 10, total: 10, at: 'T2' } },
  }, 'T2')).toMatchObject({ ok: true })
  expect(applyStatePatch(rec(), {
    stateId: 'default',
    patch: { status: 'locked', stressResult: { passes: 9, total: 10, at: 'T2' } },
  }, 'T2')).toMatchObject({ ok: false, code: 400 })
})
it('content edits on a locked state revert it to draft and clear stressResult', () => {
  const locked = rec()
  locked.states[0]! = { ...locked.states[0]!, status: 'locked', stressResult: { passes: 10, total: 10, at: 'T1' } }
  const r = applyStatePatch(locked, { stateId: 'default', patch: { descriptor: 'new coat' } }, 'T2')
  expect(r.ok && r.record.states[0]!.status).toBe('draft')
  expect(r.ok && r.record.states[0]!.stressResult).toBe(null)
})
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL (module missing)
- [ ] **Step 3: Implement `applyStatePatch`.** Allowed keys via an explicit `const ALLOWED = new Set([...])`; reject unknown keys, invalid filenames (`refImages`, `panels[].filename`, `sheetImage` through `validRefFilename` + panel-slot check reusing the registry's hygiene by round-tripping the patched state through `stateHygiene` — export it from `characterRegistry.ts`), invalid `status`. Lock rule: patching `status: 'locked'` requires `(patch.stressResult ?? state.stressResult)` with `passes === total && total >= 10`. Content-edit rule: if the state was `locked` and the patch touches any of `descriptor | refImages | coverIndex | panels | sheetImage`, force `status: 'draft'`, `stressResult: null` (unless the same patch explicitly re-locks, which the lock rule then re-validates). Return a NEW record (no mutation) with the state replaced, `state.updatedAt = now`, `record.updatedAt = now`.
- [ ] **Step 4: Wire the route.** In `characters-local.patch.ts`, after the existing top-level field handling, add:

```ts
if (body.statePatch) {
  const result = applyStatePatch(record, body.statePatch, new Date().toISOString())
  if (!result.ok) throw createError({ statusCode: result.code, message: result.message })
  record = result.record
  await fs.writeFile(file, JSON.stringify(record, null, 2))
  return { ok: true }
}
```
Also rename the full-array branch's key from `variants` to `states` (validation logic identical; keep the round-trip-hygiene 400 check; new states get `emptyState` defaults through `stateHygiene`).
- [ ] **Step 5: Run** — `npx vitest run tests/unit/character-state-patch.unit.spec.ts tests/unit/character-registry.unit.spec.ts` — Expected: PASS
- [ ] **Step 6: Commit** — `git commit -m "feat(characters): per-state PATCH with expectedUpdatedAt 409 guard + server-side lock validation"`

## Phase 2 — One store, typed calls

### Task 4: `useCharacters` becomes the store

**Files:**
- Modify: `frontend/app/composables/useCharacters.ts`
- Test: `frontend/tests/unit/characters-composable.unit.spec.ts` (update)

**Interfaces:**
- Consumes: shared types, Task 3 HTTP contract.
- Produces (the ONLY client character API from here on):
```ts
export function useCharacters(): {
  characters: Ref<CharacterRecord[]>; loading: Ref<boolean>; error: Ref<string>
  refresh(): Promise<void>
  resolveStateRefs(picks: { slug: string; stateId: string | null }[]): Record<string, string[]>  // identity-first /view URLs
  resolveRefs(slugs: string[]): Record<string, string[]>
  coverUrl(c: CharacterRecord, stateId?: string | null): string | null
  portraitUrl(c: CharacterRecord, stateId?: string | null): string | null   // portrait panel → cover fallback
  stateDescriptors(picks: { slug: string; stateId: string | null }[]): Record<string, string>  // slug → descriptor ('' dropped)
  patchCharacter(slug: string, fields: { name?: string; notes?: string; loraName?: string | null; trigger?: string | null }): Promise<boolean>
  patchState(slug: string, statePatch: StatePatchBody): Promise<'ok' | 'stale' | 'error'>   // 'stale' on 409
  replaceStates(slug: string, states: CharacterState[]): Promise<boolean>
  removeCharacter(slug: string): Promise<boolean>
}
// module-level exports kept: coverFirstRefs re-exported from shared; missingStateIssues replaces missingVariantIssues
export function missingStateIssues(
  picks: { slug: string; name: string; stateId: string | null }[],
  catalog: { slug: string; states: { id: string }[] }[],
): { level: 'warning'; code: 'cast-state-missing'; message: string }[]
```
Every mutator awaits the PATCH then `refresh()` internally — the `sailor:charactersChanged` listener AND all its dispatchers die in Task 5. `CharacterVariantClient`/`CharacterClient` are deleted; consumers import `CharacterRecord`/`CharacterState` from `#shared/characters/types`. `characterStatus`/`useTrainingJobs` (training-pipeline concerns) stay as-is but retype `c: Pick<CharacterRecord, 'name' | 'loraName'>`.

- [ ] **Step 1: Update the failing tests** — in `characters-composable.unit.spec.ts`: rename `missingVariantIssues` cases to `missingStateIssues` (picks use `stateId: string | null`; code `'cast-state-missing'`), and add:

```ts
it('resolveStateRefs is identity-first: sheet leads when set, else cover-first', () => { /* seed characters ref directly, assert /view?filename=sheet.png&type=input leads */ })
it('patchState returns "stale" on a 409 response', async () => { /* stub global fetch → { status: 409, ok: false }; expect 'stale'; assert refresh() was still called */ })
```
Test mechanics: the suite already stubs `fetch` for `refresh` — follow its existing pattern (module-level `characters` seeds through a stubbed GET then calling `refresh()`).
- [ ] **Step 2: Run to verify failure** — Expected: FAIL
- [ ] **Step 3: Implement.** Keep the module-level `characters/loading/error/fetchedOnce` pattern. `resolveStateRefs` = `identityRefs(pickState(c, stateId)).map(viewRefUrl)`. `portraitUrl` = `panelFilename(state,'portrait') ?? cover` → `viewRefUrl`. Mutators:

```ts
async function patchState(slug: string, statePatch: StatePatchBody): Promise<'ok' | 'stale' | 'error'> {
  try {
    const res = await fetch('/api/characters-local', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, statePatch }),
    })
    return res.ok ? 'ok' : res.status === 409 ? 'stale' : 'error'
  } catch { return 'error' }
  finally { await refresh() }  // even on stale/error — pull the truth
}
```
(`replaceStates`, `patchCharacter`, `removeCharacter` analogous, boolean returns; `removeCharacter` sends `{ slug, remove: true }`.) Delete the `sailor:charactersChanged` listener + `listenerBound`.
- [ ] **Step 4: Run** — `npx vitest run tests/unit/characters-composable.unit.spec.ts` — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(characters): useCharacters is the store — mutations + identity-first resolution"`

### Task 5: Typed bus replaces the window events

**Files:**
- Create: `frontend/app/lib/characters/bus.ts`
- Modify: `frontend/app/components/vue-canvas/CharacterNode.vue`, `CharacterSheetNode.vue`, `CharacterLibraryPanel.vue`, `ShotDirectorSurface.vue`, `ArtifactImageNode.vue`, `VueNodeCanvas.vue`
- Test: `frontend/tests/unit/character-bus.unit.spec.ts` (new)

**Interfaces:**
- Produces:
```ts
export interface CharacterBusEvents {
  castEdgesChanged: undefined
  uncastCharacter: { nodeId: string; slug: string }
  addCharacterImageGen: { slug: string; use: 'sheet' | 'lora' }
  addCharacterCastNode: { slug: string; name: string; stateId: string | null }
}
export function onCharacterEvent<K extends keyof CharacterBusEvents>(k: K, fn: (p: CharacterBusEvents[K]) => void): () => void  // returns unsubscribe
export function emitCharacterEvent<K extends keyof CharacterBusEvents>(k: K, ...p: CharacterBusEvents[K] extends undefined ? [] : [CharacterBusEvents[K]]): void
```

- [ ] **Step 1: Write the failing test** — subscribe/emit/unsubscribe round-trip, payload typing, multiple listeners, emit-with-no-listeners is a no-op.
- [ ] **Step 2: Run to verify failure**, then implement (module-level `Map<string, Set<Function>>`, ~25 lines, no deps), run to pass.
- [ ] **Step 3: Migrate every dispatch/listen site.** Full inventory (verified by grep — excluding `.claude/worktrees`):
  - `VueNodeCanvas.vue:4853-4856` + `4920-4923`: replace the 4 add/removeEventListener pairs with `const off = [onCharacterEvent('castEdgesChanged', syncAllShotDirectorCasts), onCharacterEvent('uncastCharacter', handleUncastCharacter), …]` and `off.forEach(f => f())` on unmount. Handler signatures change from `(e: Event)` + detail-unwrap to direct typed payloads.
  - `VueNodeCanvas.vue:3883`, `CharacterNode.vue:34,41`, `CharacterSheetNode.vue:275,297`: `emitCharacterEvent('castEdgesChanged')`.
  - `CharacterLibraryPanel.vue:237`: `emitCharacterEvent('addCharacterImageGen', { slug: c.slug, use: 'sheet' })` (the `use` fork is wired for real in Task 12; pass `'sheet'` now).
  - `CharacterLibraryPanel.vue:250`: `emitCharacterEvent('addCharacterCastNode', { slug, name, stateId: normalizeStateId(variantId) })`.
  - `ShotDirectorSurface.vue:91`: `emitCharacterEvent('uncastCharacter', { nodeId: props.nodeId, slug: m.slug })`.
  - `sailor:charactersChanged` dies: `CharacterLibraryPanel.vue:64` `changed()` → delete (its callers become store mutations in Task 8); `CharacterSheetNode.vue:274` + `ArtifactImageNode.vue:506` → replace the manual `fetch PATCH` + dispatch with `useCharacters().patchState(...)` / `replaceStates(...)` calls where the surrounding code already has the data (where the caller sends the legacy `refImages` body shape, keep that fetch for now but follow it with `await refresh()` from the store — full migration of those write shapes is Task 8).
- [ ] **Step 4: Compile-check the six components** (dev-server Vite curl per Global Constraints) and run `npx vitest run tests/unit/character-bus.unit.spec.ts tests/unit/characters-composable.unit.spec.ts` — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "refactor(characters): typed character bus replaces five window CustomEvents"`

### Task 6: `stateId: string | null` end-to-end + one node binding

**Files:**
- Modify: `frontend/app/lib/shotdirector/types.ts:224-230` (CastMember), `frontend/app/lib/shotdirector/castEdges.ts`, `frontend/app/lib/shotdirector/hydrate.ts` (or wherever `hydrateShotSheet` lives — `grep -rn "function hydrateShotSheet" app/lib/shotdirector/`), `CharacterNode.vue`, `CharacterSheetNode.vue:272-273`, `CharacterLibraryPanel.vue:240-249`, `VueNodeCanvas.vue:3870-3884`
- Test: update `tests/unit/shotdirector-cast-edges.unit.spec.ts`, `tests/unit/shotdirector-cast.unit.spec.ts`; extend the hydrate suite

**Interfaces:**
- Produces:
```ts
export interface CastMember { slug: string; name: string; via: 'wire' | 'picker'; stateId: string | null }
// node property (single key, replaces sailor_characterSlug/Name/VariantId):
// properties.sailor_characterBinding = { slug: string; name: string; stateId: string | null }
export interface CastNodeLite { id: string; nodeType?: string; binding?: { slug: string; name: string; stateId: string | null } | null }
```
- Migration is **read-time**: the canvas's lite-mapper and `CharacterNode.vue` read `sailor_characterBinding` and FALL BACK to the three legacy props (`sailor_characterSlug` / `sailor_characterName` / `sailor_characterVariantId`, normalized). Writes only ever produce the binding. `hydrateShotSheet` maps persisted cast members: `stateId: normalizeStateId(m.stateId ?? m.variantId)`.

- [ ] **Step 1: Write failing tests.**
  - `shotdirector-cast-edges`: `wireCastFor` consumes `binding`, normalizes `'default'` → `null` in one place; `syncCast` equality compares `stateId` (a member persisted with `stateId: null` vs wire `stateId: null` must be `same` → returns null — this test IS the sentinel-bug regression guard).
  - hydrate suite: legacy persisted `{ cast: [{ slug, name, via: 'picker', variantId: 'wet' }] }` hydrates to `stateId: 'wet'`; `variantId: 'default'` → `stateId: null`.
  - cast suite: mechanical `variantId` → `stateId` updates; the no-refs error message branches on `m.stateId`.
- [ ] **Step 2: Run to verify failure**, implement:
  - `castEdges.ts`: `CastNodeLite.binding`; `wireCastFor` maps `binding` → member with `stateId: normalizeStateId(binding.stateId)`; `syncCast` compares `stateId`.
  - `VueNodeCanvas.vue` lite-mapper (search `characterSlug:` in the file — the place CastNodeLite is built): produce `binding` from `properties.sailor_characterBinding ?? legacy props`. `handleAddCharacterCastNode` (`:3870`) writes `sailor_characterBinding: { slug, name, stateId }` — DELETE the `:3873-3876` sentinel comment+guard (normalization lives in `normalizeStateId` at the bus boundary now).
  - `CharacterNode.vue`: read/write the binding with legacy fallback; DELETE the `:40` sentinel guard.
  - `CharacterSheetNode.vue:272-273`: write the binding.
  - `CharacterLibraryPanel.vue:240-249`: DELETE the sentinel-stripping block; pass `normalizeStateId(...)` straight to the bus emit (already typed `string | null`).
- [ ] **Step 3:** `npx vitest run tests/unit/shotdirector-cast-edges.unit.spec.ts tests/unit/shotdirector-cast.unit.spec.ts tests/unit/shotdirector-hydrate.unit.spec.ts` (adjust the hydrate spec filename to what exists — `ls tests/unit | grep hydrate`) — Expected: PASS. Compile-check the four components.
- [ ] **Step 4: Persistence round-trip guard.** `convertToLiteGraph` silently drops unknown `node.data` fields — bindings live under `data.properties` (same bag as `sailor_shotDirector`, which survives). Add one unit assertion to the existing convert/persistence suite (`grep -rln "convertToLiteGraph" tests/unit/`): a node with `properties.sailor_characterBinding` survives the round-trip.
- [ ] **Step 5: Commit** — `git commit -m "refactor(characters): stateId string|null end-to-end; one sailor_characterBinding node property; sentinel guards deleted"`

### Task 7: Canvas adopts the store (kills resolver forks #2 and #4)

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue:3411-3443` (`handleShotDirectorGenerate`) and `:3814-3866` (`handleAddCharacterImageGen`)

**Interfaces:**
- Consumes: Task 4 store (`refresh`, `resolveStateRefs`, `stateDescriptors`, `characters`), Task 6 `CastMember.stateId`.

- [ ] **Step 1: Rewrite the generate-time resolution** (`:3422-3439`) — delete the inline fetch + variant-picking and replace with:

```ts
if (sheet.cast.length) {
  const store = useCharacters()
  await store.refresh()  // generate-time truth, same guarantee the old re-fetch gave
  const picks = sheet.cast.map(m => ({ slug: m.slug, stateId: m.stateId }))
  const resolved = store.resolveStateRefs(picks)
  const mat = materializeCast(sheet, resolved, getProfile('seedance-2.0'))
  effectiveSheet = mat.sheet
  castIssues = mat.issues
}
```
Remove the now-unused `coverFirstRefs`/`viewRefUrl` imports if nothing else in the file uses them.
- [ ] **Step 2: Rewrite `handleAddCharacterImageGen`** to the same pattern: payload is now `{ slug, use }` from the bus (Task 5); `await store.refresh()`; find `c = store.characters.value.find(...)`. Behavior stays IDENTICAL for now except the ref it seeds: the `Image` node's `image` widget gets `identityRefs(defaultState(c))[0]` instead of the raw cover (sheet-first once sheets exist). The `use` fork gets its real UI in Task 12 — until then `use === 'lora' && c.loraName` keeps the FluxLoRARemoteNode branch, `'sheet'` takes the Image→ConsistentFaceNode branch.
- [ ] **Step 3: Verify.** Compile-check. Run the cast + compile suites (`npx vitest run tests/unit/shotdirector-cast.unit.spec.ts tests/unit/shotdirector-compile.unit.spec.ts` — adjust names to `ls tests/unit | grep -E "cast|compile"`). Then live: with dev servers up (`./dev.sh`), add a Character node via the panel, wire to Shot Director, hit Generate with an intercepted/invalid key or just verify via the FilmShotNode's `model_options` widget that `image_urls[0]` is a `/view?filename=…&type=input` URL. Expected: identical behavior to before (sheet-first only changes anything once sheets exist).
- [ ] **Step 4: Commit** — `git commit -m "refactor(characters): canvas resolves cast + image-gen through the store — inline resolver forks deleted"`

## Phase 3 — Higgsfield sheet generation

### Task 8: Panel canon + generation pipeline v2

**Files:**
- Modify: `frontend/app/data/character-shot-scenes.ts` (replace `CHARACTER_SHEET_CANONICAL` with `HIGGSFIELD_PANELS`), `frontend/app/composables/useSheetGeneration.ts` (rewrite), `frontend/app/lib/shotdirector/refUpload.ts` (add `uploadRefFilename`)
- Test: `tests/unit/character-shot-scenes.unit.spec.ts`, `tests/unit/sheet-generation.unit.spec.ts` (both updated)

**Interfaces:**
- Produces:
```ts
// character-shot-scenes.ts
export interface SheetPanelSpec { slot: PanelSlot; kind: 'portrait-gen' | 'derived-edit'; prompt: string; aspect: '1:1' | '3:4' }
export const HIGGSFIELD_PANELS: SheetPanelSpec[]   // order: portrait, body-front, body-back, face-neutral, face-smile
// useSheetGeneration.ts
export type SheetSource =
  | { mode: 'photo'; referenceImageDataUrl: string; descriptor?: string }
  | { mode: 'lora'; loraFilename: string; trigger: string | null; descriptor?: string }
export interface PanelShot { spec: SheetPanelSpec; dataUrl: string | null; loading: boolean; error: boolean }
export function buildPortraitPrompt(spec: SheetPanelSpec, opts: { trigger?: string | null; descriptor?: string }): string
export function buildDerivedPrompt(spec: SheetPanelSpec, descriptor?: string): string
export function useSheetGeneration(): {
  panels: Ref<PanelShot[]>; reset(): void
  expandAll(source: SheetSource): Promise<void>       // portrait first; abort-on-first-failure
  rerollPanel(slot: PanelSlot, source: SheetSource): Promise<void>  // derived panels re-use the CURRENT portrait dataUrl
}
// refUpload.ts
export async function uploadRefFilename(file: File): Promise<string>  // bare input-dir filename; uploadRefFile becomes viewRefUrl(await uploadRefFilename(f))
```
The five panel prompts (copy verbatim):

```ts
export const HIGGSFIELD_PANELS: SheetPanelSpec[] = [
  { slot: 'portrait', kind: 'portrait-gen', aspect: '3:4',
    prompt: 'solo, one person only, large three-quarter view portrait, head and shoulders filling the frame, neutral expression, mouth closed, sharp facial detail, soft even studio light, plain neutral grey studio background' },
  { slot: 'body-front', kind: 'derived-edit', aspect: '3:4',
    prompt: 'Show the same person as a full-body figure from the front, standing naturally with arms relaxed, with the head removed — the figure ends cleanly at the neckline, no head or face visible. Keep the exact same wardrobe and body type. Plain neutral grey studio background, even soft light, photorealistic.' },
  { slot: 'body-back', kind: 'derived-edit', aspect: '3:4',
    prompt: 'Show the same person as a full-body figure from behind, standing naturally with arms relaxed, with the head removed — the figure ends cleanly at the neckline, no head visible. Keep the exact same wardrobe and body type. Plain neutral grey studio background, even soft light, photorealistic.' },
  { slot: 'face-neutral', kind: 'derived-edit', aspect: '1:1',
    prompt: 'Close-up of the same face, neutral expression, mouth closed, looking at camera, sharp detail on the eyes and skin, soft even studio light, plain neutral grey background, photorealistic.' },
  { slot: 'face-smile', kind: 'derived-edit', aspect: '1:1',
    prompt: 'Close-up of the same face with a natural open smile showing teeth, looking at camera, sharp detail on the eyes, teeth and skin, soft even studio light, plain neutral grey background, photorealistic.' },
]
```

- [ ] **Step 1: Write failing tests.**
  - scenes suite: replace the `CHARACTER_SHEET_CANONICAL` cases with: `HIGGSFIELD_PANELS` has exactly the 5 slots in the canonical order; the `portrait-gen` prompt carries `'solo, one person only'` (the Flux-LoRA duplicate-subject guard — keep the existing test's rationale comment); both body prompts contain `'head removed'` and `'no head'`; face-smile contains `'teeth'`; every `derived-edit` prompt contains `'the same'` (identity anchor). The 25-scene `CHARACTER_SHOT_SCENES` cases stay untouched.
  - sheet-generation suite: `buildPortraitPrompt` joins trigger/descriptor/prompt dropping falsy (existing `buildScenePrompt` cases retarget); `buildDerivedPrompt` appends the descriptor as `'The person wears <descriptor>.'` when present; `expandAll` with a stubbed `fetch`: portrait failure → zero derived calls (abort-on-first-failure, the money guard); portrait success + body-front failure → stops before body-back; `rerollPanel('face-smile', …)` with a present portrait issues exactly one nano-gen call carrying the portrait dataUrl in `images`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Pipeline mechanics: `expandAll` runs the `portrait-gen` spec first — photo mode → `POST /api/cloud-train/character-shot` `{ referenceImageDataUrl, prompt: buildPortraitPrompt(spec, { descriptor }), aspectRatio: spec.aspect }`; lora mode → `useInpaint().loraGen(loraFilename, buildPortraitPrompt(spec, { trigger, descriptor }), spec.aspect)`. Each `derived-edit` then → `POST /api/inpaint/nano-gen` `{ prompt: buildDerivedPrompt(spec, descriptor), images: [portraitDataUrl], aspect_ratio: spec.aspect }` → `{ images: [dataUrl] }`. Sequential, abort-on-first-failure exactly like the current `expandAll`. Delete `CHARACTER_SHEET_CANONICAL` and fix its imports (`grep -rn CHARACTER_SHEET_CANONICAL app/ tests/`): `CharacterSheetNode.vue` + `CharacterLibraryPanel.vue` switch to `HIGGSFIELD_PANELS` (their full wiring is Task 9 — here just make them compile: the shot-grid arrays they render come from `panels` now).
- [ ] **Step 4: Run** — `npx vitest run tests/unit/character-shot-scenes.unit.spec.ts tests/unit/sheet-generation.unit.spec.ts` — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(characters): Higgsfield 5-panel canon + portrait-first generation pipeline"`

### Task 9: Composite bake + panel/node wiring + auto-spend removal + legacy alias removal

**Files:**
- Create: `frontend/app/lib/characters/sheetComposite.ts`
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue`, `CharacterSheetNode.vue`, `frontend/server/api/characters-local.patch.ts` (drop legacy alias), `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (last legacy caller)
- Test: `tests/unit/sheet-composite.unit.spec.ts` (new), `tests/unit/character-state-patch.unit.spec.ts` (extend)

**Interfaces:**
- Produces:
```ts
// sheetComposite.ts — layout is pure and unit-tested; bake is thin DOM glue
export interface CompositeRect { slot: PanelSlot; x: number; y: number; w: number; h: number }
export const COMPOSITE_W = 1920
export const COMPOSITE_H = 1080
export function compositeLayout(): CompositeRect[]
// body-front (0,0,420,1080) · body-back (420,0,420,1080) · portrait (840,0,660,1080)
// face-neutral (1500,0,420,540) · face-smile (1500,540,420,540)
export async function bakeCompositeSheet(panelDataUrls: Record<PanelSlot, string>): Promise<File>  // PNG 'sheet.png', cover-fit crops, #808080 gaps
```

- [ ] **Step 1: Write failing layout tests** — rects cover exactly 1920×1080 (sum of areas = W·H, no pairwise overlap, all within bounds), portrait is the widest single rect, faces stack in one column. Pure math — no DOM.
- [ ] **Step 2: Implement layout + bake** (bake: offscreen canvas, `drawImage` cover-fit crop per rect — centered crop of the source to the rect's aspect; `toBlob('image/png')` → `File`). Run tests — PASS.
- [ ] **Step 3: Wire the panel's per-state generation** (`CharacterLibraryPanel.vue`, replacing the old per-variant sheet generation at `:374-462`): the "Generate sheet" action for a state = `expandAll(source)` (source: state cover photo as dataUrl for draft characters — the panel already has `fetchAsDataUrl`; LoRA source when `loraName` set, exactly the old source-pick logic) → on 5/5 success: upload the 5 panel PNGs via `uploadRefFilename` → `bakeCompositeSheet` → upload composite → ONE `store.patchState(slug, { stateId, expectedUpdatedAt: state.updatedAt, patch: { panels, sheetImage, status: 'draft', stressResult: null } })` → `'stale'` result shows the existing conflict toast pattern ("Someone else edited this character — reloaded, try again"). Per-panel reroll button = `rerollPanel(slot, source)` → re-upload that panel + re-bake + one `patchState`. **Delete the auto-spend block** (`:77-113` absorb stays — it's free and mints records only; `:114-170` auto sheet generation goes entirely, along with `autoGenInFlight`). **Delete the five stale-closure guards** (`:277-338`, `:454-457` re-derive blocks) — `expectedUpdatedAt` + `'stale'` handling replaces them; every panel mutation goes through `store.patchState`/`replaceStates` now (uploads at `:277-337`, looks/states CRUD at `:339-372`, dress flow write-back at `:475-564`).
- [ ] **Step 4: Same treatment for `CharacterSheetNode.vue`** (`:197-280`): its save path uploads panels + composite then `POST /api/characters-local` (create) + `store.patchState` — no more legacy `refImages` PATCH. `ArtifactImageNode.vue:~506` (save-as-character): switch its write to `replaceStates`/`patchState` (it seeds `refImages` on the default state — `patch: { refImages, coverIndex: 0 }`).
- [ ] **Step 5: Remove the legacy alias.** Delete `characters-local.patch.ts` top-level `refImages`/`coverIndex` handling (`:76-87` in the pre-plan file). Extend the state-patch unit suite: a body with top-level `refImages` no longer mutates anything (route-level: the pure test asserts `applyStatePatch` is the only mutation path; add a route-shape comment). Grep-verify no remaining callers: `grep -rn "refImages" app/ --include='*.vue' | grep -i "patch\|body"` → expect zero legacy PATCH bodies.
- [ ] **Step 6: Run** — `npx vitest run tests/unit/sheet-composite.unit.spec.ts tests/unit/character-state-patch.unit.spec.ts tests/unit/sheet-generation.unit.spec.ts` + compile-check both components. Expected: PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(characters): composite sheet bake wired into panel + sheet node; auto-spend and legacy PATCH alias removed"`

## Phase 4 — Uniform consumption

### Task 10: Descriptor reaches the prompt; messages say "look"

**Files:**
- Modify: `frontend/app/lib/shotdirector/cast.ts` (castClause signature), `frontend/app/lib/shotdirector/compile.ts` (compileShot opts), `frontend/app/composables/useShotDirector.ts:44-52`, `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (generate path — pass descriptors)
- Test: `tests/unit/shotdirector-cast.unit.spec.ts`, compile golden suite

**Interfaces:**
- Produces:
```ts
export function castClause(sheet: ShotSheet, profile: ModelProfile, descriptors?: Record<string, string>): string
// "Characters: Cal (soaked navy jacket, wet hair) @Image1; Marcus @Image2."
export function compileShot(sheet: ShotSheet, profile: ModelProfile, opts?: { castDescriptors?: Record<string, string> }): CompileResult
```
- Consumes: `useCharacters().stateDescriptors(picks)`.

- [ ] **Step 1: Failing tests:** clause with a descriptor renders `Name (descriptor) @ImageN`; empty/absent descriptor renders exactly today's output (golden tests unchanged when no descriptors passed — THE back-compat guard); descriptor text is trimmed; compile splices the descriptor clause and word-count includes it.
- [ ] **Step 2: Implement** — `castClause` interpolates `const d = descriptors?.[m.slug]?.trim()` → `d ? `${m.name} (${d}) ${tags}` : `${m.name} ${tags}``. `compileShot` threads `opts?.castDescriptors` through. Both call sites pass `store.stateDescriptors(sheet.cast.map(m => ({ slug: m.slug, stateId: m.stateId })))` (useShotDirector already holds the store; the canvas generate path got the store in Task 7). Also rename user-facing "variant" strings: `cast.ts:58-60` no-refs messages → "…in the selected look"; `missingStateIssues` message stays as written in Task 4.
- [ ] **Step 3: Run cast + compile suites** — Expected: PASS (existing goldens byte-identical without descriptors).
- [ ] **Step 4: Commit** — `git commit -m "feat(characters): state descriptor reaches the cast clause — no more retyping outfits into subject"`

### Task 11: Lip-sync resolves through the store

**Files:**
- Modify: `frontend/app/components/vue-canvas/LipSyncSurface.vue:~58` (character pick)

- [ ] **Step 1:** The character face pick sets `face.src = store.portraitUrl(c, null)` (portrait panel → cover fallback) — replacing its direct cover read. `face.characterSlug` stays (the persisted shape is untouched — the SRC just resolves through the one path now).
- [ ] **Step 2:** Compile-check; hand-verify in the browser pane (open Lip-Sync, pick a character, portrait/cover appears). Commit — `git commit -m "refactor(characters): lip-sync face resolves via store portraitUrl"`.

### Task 12: "Use in image" — visible choice, no silent fork

**Files:**
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue` (`useInImage` action, `:230-238` area), `VueNodeCanvas.vue` `handleAddCharacterImageGen` (finish the Task 7 fork)

- [ ] **Step 1:** Panel: when the character has `loraName`, the "Use in image" button opens a two-option menu — "Reference sheet" (`use: 'sheet'`, subtitle "works everywhere · sends the sheet") and "Trained identity (LoRA)" (`use: 'lora'`, subtitle "Flux only · uses the trigger word") — StudioButton/menu idiom copied from an existing panel dropdown; without `loraName` the click emits `'sheet'` directly. Canvas: `'sheet'` ALWAYS takes the Image→ConsistentFaceNode branch seeded with `identityRefs(...)[0]` even when a LoRA exists (delete the `if (character.loraName)` early-return that made the fork silent); `'lora'` requires `loraName` (toast if absent).
- [ ] **Step 2:** Compile-check + hand-verify both menu paths create the right nodes. Commit — `git commit -m "feat(characters): Use-in-image offers sheet vs LoRA explicitly — silent fork removed"`.

## Phase 5 — Stress test and locking

### Task 13: Pure stress module

**Files:**
- Create: `frontend/app/lib/characters/stress.ts`
- Test: `tests/unit/character-stress.unit.spec.ts` (new)

**Interfaces:**
```ts
export const STRESS_TILE_COUNT = 10
export interface StressTile { idx: number; scene: CharacterShotScene; dataUrl: string | null; loading: boolean; error: boolean; pass: boolean | null }
export function stressScenes(): CharacterShotScene[]              // pickScenes(STRESS_TILE_COUNT) — reuses the 25-scene library
export function freshTiles(): StressTile[]
export function stressOutcome(tiles: StressTile[]): StressResult | null  // null until every generated tile is judged; at = '' (caller stamps)
export function canLock(tiles: StressTile[]): boolean             // 10/10 generated AND passed
```

- [ ] **Step 1: Failing tests:** `stressScenes()` returns 10 with ≥1 `full` and ≥1 `closeup` (pickScenes quota); `stressOutcome` null while any tile un-judged or un-generated; `canLock` false at 9/10 pass, false at 10 passes with 1 error tile, true only at 10 generated+passed; `freshTiles` all-null.
- [ ] **Step 2:** Implement (~40 lines, pure), run, PASS. Commit — `git commit -m "feat(characters): pure stress-test module — 10/10 gate"`.

### Task 14: Stress grid + Lock UI, pickers flag drafts

**Files:**
- Modify: `frontend/app/components/vue-canvas/CharacterLibraryPanel.vue` (state card grows a Stress test section), `CharacterNode.vue` + the ShotDirector cast picker (status chip), `CharacterLibraryPanel.vue` card ordering

**Interfaces:**
- Consumes: Task 13 module, Task 3 lock validation, Task 4 `patchState`.

- [ ] **Step 1: Grid generation.** "Stress test (~$0.80)" button on a state with a `sheetImage`: `freshTiles()`, then sequential per tile → `POST /api/cloud-train/character-shot` `{ referenceImageDataUrl: <sheet as dataUrl via fetchAsDataUrl(viewRefUrl(sheetImage))>, prompt: scene.prompt + ', the exact same person as the reference sheet', aspectRatio: aspectForFraming(scene.framing, idx) }` — abort-on-first-failure. On first tile landing: `patchState(... { status: 'testing' })`. (Ideogram Character is the same model the image path's ConsistentFaceNode uses — the test exercises the real consumption path.)
- [ ] **Step 2: Judging + Lock.** Each tile gets ✓/✗ toggles (pass/fail, tri-state from `null`). Footer: "N/10 recognizable". When `canLock(tiles)`: enabled **Lock** (StudioButton) → `patchState(... { status: 'locked', stressResult: { ...stressOutcome(tiles)!, at: new Date().toISOString() } })`. Under 10/10: inline hint "Fix the description, not the model — edit the descriptor or reroll a panel, then re-test." (server re-validates the 10/10 — Task 3).
- [ ] **Step 3: Status visibility.** State cards show a status chip (`draft` grey / `testing` amber / `locked` action-blue check). Cast picker + panel lists sort locked states first and badge drafts "draft — not stress-tested" (visible but flagged, never hidden). Content edits reverting locked→draft need no UI code — the server does it (Task 3); the store refresh makes it visible.
- [ ] **Step 4:** Compile-check; hand-run one full cycle on a dev server against a real character (10 tiles ≈ $0.80 — **ask Julien before spending, or stub the endpoint and verify the state machine free**; the paid run can ride the owed-verification checklist). Commit — `git commit -m "feat(characters): stress-test grid gates Lock; drafts flagged in pickers"`.

## Phase 6 — Verification

### Task 15: E2E + full-suite + docs

**Files:**
- Create: `frontend/tests/character-sheet.spec.ts` (Playwright)
- Modify: `docs/STATE.md`, dashboard artifact

- [ ] **Step 1: Playwright spec** (pattern: `tests/generators.spec.ts` + the `sailor:addNode` / `sailor:applyEffect` headless-wiring recipe). Route-intercept `/api/characters-local` with a fixture character whose default state has `sheetImage: 'sheet.png'` + descriptor `'soaked jacket'`. Scenario A (video): add Character node → wire to Shot Director → Generate → assert the FilmShotNode's `model_options` widget JSON has `image_urls[0]` containing `filename=sheet.png` AND prompt containing `(soaked jacket)`. Scenario B (image): emit the use-in-image flow → assert an Image node whose `image` widget is `sheet.png` wired into a ConsistentFaceNode. Both assert THE SAME filename — the "images AND video consume the same asset" acceptance test. (Assert the path ran — a rendered canvas is not evidence.)
- [ ] **Step 2: Full targeted suite** — `npx vitest run tests/unit/character-model.unit.spec.ts tests/unit/character-registry.unit.spec.ts tests/unit/character-state-patch.unit.spec.ts tests/unit/characters-composable.unit.spec.ts tests/unit/character-bus.unit.spec.ts tests/unit/character-shot-scenes.unit.spec.ts tests/unit/sheet-generation.unit.spec.ts tests/unit/sheet-composite.unit.spec.ts tests/unit/character-stress.unit.spec.ts tests/unit/shotdirector-cast.unit.spec.ts tests/unit/shotdirector-cast-edges.unit.spec.ts tests/unit/character-link.unit.spec.ts` — all PASS; then `npx playwright test tests/character-sheet.spec.ts`.
- [ ] **Step 3: Typecheck** — `npx nuxt typecheck 2>&1 | tail -5`; error count ≤ baseline (~328) and zero errors naming plan-introduced symbols.
- [ ] **Step 4: Docs + dashboard** — STATE.md gains the LANDED entry (surface map: Character/Sheet row notes states+sheets+stress); update the ⛵ artifact (read the LIVE one first). Note the owed paid verifications: one real sheet generation (5 panels ≈ $0.40–0.70), one real stress grid (≈$0.80), one Seedance render with a sheet-cast character.
- [ ] **Step 5: Commit** — `git commit -m "test(characters): E2E — images and video consume the same sheet; docs updated"`

---

## Self-review notes (applied)

- **Spec coverage:** §1→Tasks 1-2, 6 · §2→Tasks 3-5, 9 · §3→Tasks 8-9 · §4→Tasks 7, 10-12 · §5→Tasks 13-14 · §6→Tasks 2 (parse-time migration), 6 (read-time binding fallback + hydrate), 15.
- **Deviation from spec, deliberate:** stress tiles render via `ideogram-character` (the existing `/api/cloud-train/character-shot` rail, $0.08/tile — inside the spec's cost estimate), not Seedream — no Seedream reference-edit endpoint exists, and ideogram IS the image path's production model (ConsistentFaceNode), so the "same consumption path" requirement is better honored. Sheet-generation derived panels use nano-banana-pro (existing `/api/inpaint/nano-gen`, fal failover built in).
- **Kept `refImages` on `CharacterState`** (spec implied panels replace refs): the ref pool is load-bearing for LoRA training datasets, upload UX, and the migration fallback. `identityRefs` makes the sheet win once it exists.
- **Type consistency check:** `StatePatchBody` (T3) is what `patchState` (T4) sends and the panel (T9) + stress UI (T14) call; `CastMember.stateId` (T6) is what T7/T10 read; `HIGGSFIELD_PANELS` slots = `PanelSlot` union (T1) = `compositeLayout` rects (T9).
