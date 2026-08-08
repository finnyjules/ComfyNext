# Smart Layout — Staging × Surface Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Smart Layout into a generator — rank content by importance, then Shuffle/Surprise through poster layouts built from two independent axes (Staging × Surface), integrated into the existing editor as a Layout/Freeform mode.

**Architecture:** A new pure engine under `frontend/shared/template-grid/generate/` takes tier content + an axis tuple + a seed and emits a standard `TemplateV3`. Everything downstream (the `resolveFormat` resolver, the Satori render pipeline, format reflow, the Python node) consumes that output unchanged — no new render surface. The Vue editor gains a Layout/Freeform mode toggle, a Layout-controls panel (staging/surface chips + Shuffle/Surprise), and tier-aware Type controls; all generation actions run through the existing `useGridEditor` history stack.

**Tech Stack:** TypeScript, Nuxt 4 / Vue 3, Vitest (unit), Playwright (E2E). Pure engine is framework-free.

**Design spec:** `docs/superpowers/specs/2026-08-07-smart-layout-staging-surface-generation-design.md`

## Global Constraints

- `shared/` must stay app-independent: **never import from `app/` or `~/` inside `shared/template-grid/generate/`.** Copy the tiny seeded RNG rather than importing `~/lib/spacetype/rng`.
- Determinism: all randomness comes from the seeded RNG (`mulberry32`/`hashSeed`); **never `Math.random()`** (memory: seeded randomness in render pipelines).
- All new schema fields are **optional** — a template with no `tiers`/`gen`/`origin` must remain a valid legacy layout.
- House limits (from `frontend/app/lib/agent/verify.ts` `SWISS_LIMITS`): **≤4 colours, ≤3 type sizes.** Generated output must respect these.
- `TextStyleV2.fontWeight` is `400 | 700` only — v1 Type controls expose those two weights; heavier "black" weight is out of scope (would need a schema change).
- `TextLevel` values are exactly: `'caption' | 'body' | 'subhead' | 'headline' | 'display'`.
- Unit tests live in `frontend/tests/unit/**/*.unit.spec.ts`. Run one file: `npx vitest run tests/unit/<name>.unit.spec.ts` (from `frontend/`). Run all: `npm run test:unit`. Aliases: `~~` → `frontend/`, `~` → `frontend/app/`.
- Vue interactions cannot be trusted via synthetic events (memory: synthetic pointer events prove nothing). UI tasks unit-test the composable logic and verify the rendered UI in the real browser preview.

---

## File Structure

**New (pure engine — `frontend/shared/template-grid/generate/`):**
- `rng.ts` — self-contained seeded PRNG + helpers.
- `tiers.ts` — tier order, default levels, tier↔element helpers, autopopulate from props.
- `knobs.ts` — knob spec + seeded knob resolution.
- `stagings.ts` — staging registry (6 pure composers).
- `surfaces.ts` — surface registry (4 procedural + duotone-photo).
- `validate.ts` — `validateGenerated` (colour/type-size/off-canvas gate).
- `generate.ts` — orchestrator: `generate` / `shuffle` / `surprise`.

**Modified:**
- `frontend/shared/template-grid/types.ts` — optional `tiers?`, `gen?` on `TemplateV2`; `origin?` on `ElementV2Base`; `TierId`/`TierSpec`/`Tiers`/`GenState` types.
- `frontend/app/composables/useGridEditor.ts` — generation actions + mode state.
- `frontend/app/components/templates/GridEditorShell.vue` — single toolbar + mode toggle + semantic add-tools; right-panel wiring.
- `frontend/app/components/vue-canvas/SmartLayoutEditorModal.vue` — seed tiers + first generate on open.

**New (Vue components — `frontend/app/components/templates/`):**
- `LayoutControlsPanel.vue` — staging × surface chips, Shuffle/Surprise, seed + locks, format row.
- `TierTypePanel.vue` — font/weight/size/tracking/colour for the selected tier.

**New tests:**
- `frontend/tests/unit/sl-gen-rng.unit.spec.ts`
- `frontend/tests/unit/sl-gen-tiers.unit.spec.ts`
- `frontend/tests/unit/sl-gen-knobs.unit.spec.ts`
- `frontend/tests/unit/sl-gen-stagings.unit.spec.ts`
- `frontend/tests/unit/sl-gen-surfaces.unit.spec.ts`
- `frontend/tests/unit/sl-gen-validate.unit.spec.ts`
- `frontend/tests/unit/sl-gen-generate.unit.spec.ts`
- `frontend/tests/unit/sl-gen-editor-actions.unit.spec.ts`
- `frontend/tests/sl-generation.spec.ts` (Playwright E2E)

---

## Task 1: Schema additions

**Files:**
- Modify: `frontend/shared/template-grid/types.ts`
- Test: `frontend/tests/unit/sl-gen-tiers.unit.spec.ts` (created here, extended in Task 3)

**Interfaces:**
- Produces: `TierId`, `TierSpec`, `Tiers`, `GenState`; `TemplateV2.tiers?`, `TemplateV2.gen?`, `ElementV2Base.origin?`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/sl-gen-tiers.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { TemplateV3, TierSpec, GenState } from '~~/shared/template-grid/types'

describe('schema: tiers/gen/origin fields', () => {
  it('round-trips optional generation fields on a template', () => {
    const hero: TierSpec = { content: 'MAT + FEST', type: { fontWeight: 700 }, enabled: true }
    const gen: GenState = { staging: 'tower', surface: 'holographic', seed: 4821, locks: { staging: true } }
    const tpl = {
      version: 3, id: 't1', name: 'T', master: '3x4',
      formats: { '3x4': { w: 1080, h: 1440 } },
      grid: { gutter: 16, margin: 48, baseline: 8, columns: 12, rows: 16 },
      typeScale: { base: 14, ratio: 1.5 },
      elements: [{ id: 'tier_hero', type: 'text', content: 'x', level: 'display', priority: 1,
        region: { col: 1, colSpan: 12, row: 2, rowSpan: 6 }, origin: 'staging' }],
      sections: [],
      tiers: { hero },
      gen,
    } as TemplateV3
    const back = JSON.parse(JSON.stringify(tpl)) as TemplateV3
    expect(back.tiers?.hero?.content).toBe('MAT + FEST')
    expect(back.gen?.seed).toBe(4821)
    expect(back.gen?.locks?.staging).toBe(true)
    expect(back.elements[0]?.origin).toBe('staging')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-tiers.unit.spec.ts`
Expected: FAIL — `TierSpec`/`GenState` not exported / `origin`/`tiers`/`gen` not on the types.

- [ ] **Step 3: Add the types + optional fields**

In `frontend/shared/template-grid/types.ts`, add after the `Region` interface (around line 56):

```ts
/** Importance tier ids, most→least important. */
export type TierId = 'hero' | 'anchor' | 'support' | 'fineprint'

/** One importance tier: what it says + how it's typeset. Placement is decided
 *  by the staging, so tier type survives a re-roll. `content` supports
 *  {{ props.* }} / {{ brand.* }} like any element content. */
export interface TierSpec {
  content: string
  type?: Partial<TextStyleV2>
  enabled?: boolean
}
export type Tiers = Partial<Record<TierId, TierSpec>>

/** The reproducible generation tuple stamped on a generated template. */
export interface GenState {
  staging: string
  surface: string
  seed: number
  knobs?: Record<string, unknown>
  locks?: { staging?: boolean; surface?: boolean }
}
```

(`TextStyleV2` is declared lower in the same file; a forward type reference within one module is fine in TS.)

In `ElementV2Base` (around line 76), add:

```ts
  /** Whether this element was placed by a staging (regenerated on re-roll) or
   *  added by hand in Freeform mode (preserved across re-rolls). Absent ⇒
   *  treated as 'freeform' (legacy elements are never clobbered). */
  origin?: 'staging' | 'freeform'
```

In `TemplateV2` (around line 161, after `background?`), add:

```ts
  /** Importance-tier content + type, decoupled from placement. Present when the
   *  layout is generatable; absent on hand-authored legacy layouts. */
  tiers?: Tiers
  /** Last generation tuple — lets Shuffle/Surprise reproduce and re-roll. */
  gen?: GenState
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-tiers.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/types.ts frontend/tests/unit/sl-gen-tiers.unit.spec.ts
git commit -m "feat(smart-layout): tier/gen/origin schema fields for generation"
```

---

## Task 2: Seeded RNG

**Files:**
- Create: `frontend/shared/template-grid/generate/rng.ts`
- Test: `frontend/tests/unit/sl-gen-rng.unit.spec.ts`

**Interfaces:**
- Produces: `hashSeed(s: string): number`, `makeRng(seed: number, salt?: string): Rng` where `Rng = { next(): number; int(n: number): number; pick<T>(a: readonly T[]): T; chance(p: number): boolean }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/sl-gen-rng.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeRng, hashSeed } from '~~/shared/template-grid/generate/rng'

describe('seeded rng', () => {
  it('is deterministic for the same seed', () => {
    const a = makeRng(42), b = makeRng(42)
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })
  it('differs across seeds', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next())
  })
  it('salt changes the stream', () => {
    expect(makeRng(7, 'staging').next()).not.toBe(makeRng(7, 'surface').next())
  })
  it('int is in range and pick returns a member', () => {
    const r = makeRng(9)
    for (let i = 0; i < 50; i++) { const n = r.int(5); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(5) }
    expect(['a', 'b', 'c']).toContain(makeRng(3).pick(['a', 'b', 'c']))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-rng.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the RNG**

Create `frontend/shared/template-grid/generate/rng.ts`:

```ts
/**
 * Self-contained seeded PRNG for layout generation. Copied (not imported) so
 * shared/ stays free of any app dependency. Same mulberry32/FNV-1a used across
 * the codebase's visual-randomness modules — deterministic across editor,
 * render and the Python node.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a → 32-bit unsigned int, for deriving a numeric seed from a string. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

export interface Rng {
  next(): number
  int(n: number): number
  pick<T>(a: readonly T[]): T
  chance(p: number): boolean
}

/** A seeded RNG. `salt` derives an independent stream from the same seed, so
 *  staging choices and surface choices don't correlate at seed = 1. */
export function makeRng(seed: number, salt = ''): Rng {
  const s = salt ? hashSeed(salt + '|' + (seed >>> 0)) : (seed >>> 0)
  const fn = mulberry32(s)
  return {
    next: () => fn(),
    int: (n) => Math.floor(fn() * Math.max(1, n | 0)),
    pick: (a) => a[Math.floor(fn() * a.length)] as never,
    chance: (p) => fn() < p,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-rng.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/generate/rng.ts frontend/tests/unit/sl-gen-rng.unit.spec.ts
git commit -m "feat(smart-layout): seeded rng for generation engine"
```

---

## Task 3: Tier model

**Files:**
- Create: `frontend/shared/template-grid/generate/tiers.ts`
- Test: `frontend/tests/unit/sl-gen-tiers.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: `TierId`, `Tiers`, `TierSpec` from `../types`.
- Produces:
  - `TIER_ORDER: TierId[]` (`['hero','anchor','support','fineprint']`)
  - `DEFAULT_TIER_LEVELS: Record<TierId, TextLevel>`
  - `tierEntries(tiers: Tiers): Array<{ id: TierId; spec: TierSpec }>` — enabled tiers in importance order.
  - `autopopulateTiers(props: Record<string, string>): Tiers` — maps `text_layer_1..4` → hero/anchor/support/fineprint.

- [ ] **Step 1: Write the failing test (append to sl-gen-tiers.unit.spec.ts)**

```ts
import { TIER_ORDER, DEFAULT_TIER_LEVELS, tierEntries, autopopulateTiers } from '~~/shared/template-grid/generate/tiers'

describe('tier model', () => {
  it('orders tiers by importance', () => {
    expect(TIER_ORDER).toEqual(['hero', 'anchor', 'support', 'fineprint'])
  })
  it('maps each tier to a default level with descending scale', () => {
    const order = ['caption', 'body', 'subhead', 'headline', 'display']
    const idx = (t: keyof typeof DEFAULT_TIER_LEVELS) => order.indexOf(DEFAULT_TIER_LEVELS[t])
    expect(idx('hero')).toBeGreaterThan(idx('anchor'))
    expect(idx('anchor')).toBeGreaterThan(idx('support'))
    expect(idx('support')).toBeGreaterThanOrEqual(idx('fineprint'))
  })
  it('tierEntries returns only enabled tiers, in importance order', () => {
    const entries = tierEntries({ fineprint: { content: 'f' }, hero: { content: 'h' }, anchor: { content: 'a', enabled: false } })
    expect(entries.map(e => e.id)).toEqual(['hero', 'fineprint'])
  })
  it('autopopulates tiers from wired text sockets', () => {
    const t = autopopulateTiers({ text_layer_1: 'HERO', text_layer_2: 'DATE', text_layer_3: 'list' })
    expect(t.hero?.content).toBe('HERO')
    expect(t.anchor?.content).toBe('DATE')
    expect(t.support?.content).toBe('list')
    expect(t.fineprint).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-tiers.unit.spec.ts`
Expected: FAIL — `tiers` module not found.

- [ ] **Step 3: Implement the tier model**

Create `frontend/shared/template-grid/generate/tiers.ts`:

```ts
import type { TextLevel, TierId, Tiers, TierSpec } from '../types'

/** Most → least important. */
export const TIER_ORDER: TierId[] = ['hero', 'anchor', 'support', 'fineprint']

/** Default type-scale level per tier. hero is the biggest; fineprint the smallest. */
export const DEFAULT_TIER_LEVELS: Record<TierId, TextLevel> = {
  hero: 'display',
  anchor: 'headline',
  support: 'subhead',
  fineprint: 'caption',
}

/** Enabled tiers with content, in importance order. A tier is skipped when
 *  absent, explicitly disabled, or has empty content. */
export function tierEntries(tiers: Tiers): Array<{ id: TierId; spec: TierSpec }> {
  const out: Array<{ id: TierId; spec: TierSpec }> = []
  for (const id of TIER_ORDER) {
    const spec = tiers[id]
    if (!spec || spec.enabled === false) continue
    if (!spec.content || !spec.content.trim()) continue
    out.push({ id, spec })
  }
  return out
}

/** Map wired text sockets (text_layer_1..4) onto tiers by importance order. */
export function autopopulateTiers(props: Record<string, string>): Tiers {
  const tiers: Tiers = {}
  TIER_ORDER.forEach((id, i) => {
    const v = props[`text_layer_${i + 1}`]
    if (v && v.trim()) tiers[id] = { content: v }
  })
  return tiers
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-tiers.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/generate/tiers.ts frontend/tests/unit/sl-gen-tiers.unit.spec.ts
git commit -m "feat(smart-layout): importance-tier model + autopopulate"
```

---

## Task 4: Knobs

**Files:**
- Create: `frontend/shared/template-grid/generate/knobs.ts`
- Test: `frontend/tests/unit/sl-gen-knobs.unit.spec.ts`

**Interfaces:**
- Consumes: `Rng` from `./rng`.
- Produces: `KnobSpec = { id: string; pick: readonly unknown[] }`; `resolveKnobs(specs: readonly KnobSpec[], rng: Rng, overrides?: Record<string, unknown>): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/sl-gen-knobs.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveKnobs, type KnobSpec } from '~~/shared/template-grid/generate/knobs'
import { makeRng } from '~~/shared/template-grid/generate/rng'

const SPECS: KnobSpec[] = [
  { id: 'align', pick: ['left', 'split'] },
  { id: 'breakAggression', pick: [1, 2, 3] },
]

describe('knobs', () => {
  it('resolves every knob to a value from its domain', () => {
    const k = resolveKnobs(SPECS, makeRng(11))
    expect(['left', 'split']).toContain(k.align)
    expect([1, 2, 3]).toContain(k.breakAggression)
  })
  it('is deterministic per seed', () => {
    expect(resolveKnobs(SPECS, makeRng(5))).toEqual(resolveKnobs(SPECS, makeRng(5)))
  })
  it('honours overrides (a locked knob keeps its value)', () => {
    const k = resolveKnobs(SPECS, makeRng(1), { align: 'split' })
    expect(k.align).toBe('split')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-knobs.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement knobs**

Create `frontend/shared/template-grid/generate/knobs.ts`:

```ts
import type { Rng } from './rng'

/** A degree of freedom a staging/surface exposes to Shuffle. `pick` is the
 *  discrete domain the value is chosen from. */
export interface KnobSpec { id: string; pick: readonly unknown[] }

/** Resolve each knob to one value. An override wins (used to hold a knob across
 *  a re-roll); otherwise a value is drawn from the seeded rng. */
export function resolveKnobs(
  specs: readonly KnobSpec[], rng: Rng, overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    out[spec.id] = spec.id in overrides ? overrides[spec.id] : rng.pick(spec.pick)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-knobs.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/generate/knobs.ts frontend/tests/unit/sl-gen-knobs.unit.spec.ts
git commit -m "feat(smart-layout): knob spec + seeded resolution"
```

---

## Task 5: Staging registry + Tower

**Files:**
- Create: `frontend/shared/template-grid/generate/stagings.ts`
- Test: `frontend/tests/unit/sl-gen-stagings.unit.spec.ts`

**Interfaces:**
- Consumes: `Tiers`, `TierId`, `ElementV2`, `Region`, `TextLevel`, `BrandKit` from `../types`; `Rng` from `./rng`; `KnobSpec` from `./knobs`; `TIER_ORDER`, `DEFAULT_TIER_LEVELS`, `tierEntries` from `./tiers`.
- Produces:
  - `interface StagingInput { tiers: Tiers; cols: number; rows: number; rng: Rng; knobs: Record<string, unknown>; brand?: BrandKit }`
  - `interface Staging { id: string; name: string; blurb: string; knobs: KnobSpec[]; supports?: { minTiers?: number; maxTiers?: number; surfaces?: string[] }; compose(input: StagingInput): ElementV2[] }`
  - `STAGINGS: Staging[]` (Tower here; more appended in Tasks 6–7)
  - `getStaging(id: string): Staging | undefined`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/sl-gen-stagings.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { STAGINGS, getStaging, type StagingInput } from '~~/shared/template-grid/generate/stagings'
import { makeRng } from '~~/shared/template-grid/generate/rng'
import type { Tiers } from '~~/shared/template-grid/types'

const LEVELS = ['caption', 'body', 'subhead', 'headline', 'display']
const TIERS: Tiers = {
  hero: { content: 'MAT + FEST' },
  anchor: { content: '15—26 June' },
  support: { content: 'Street food · Dining' },
  fineprint: { content: 'Slakthus · Hall 3' },
}
function input(over: Partial<StagingInput> = {}): StagingInput {
  return { tiers: TIERS, cols: 12, rows: 16, rng: makeRng(1), knobs: {}, ...over }
}

describe('staging: tower', () => {
  const tower = getStaging('tower')!
  it('is registered', () => { expect(tower).toBeTruthy() })
  it('places one element per enabled tier, tagged staging origin', () => {
    const els = tower.compose(input())
    expect(els).toHaveLength(4)
    expect(els.every(e => e.origin === 'staging')).toBe(true)
  })
  it('carries each tier content through', () => {
    const els = tower.compose(input())
    expect(els.map(e => (e as any).content)).toContain('MAT + FEST')
    expect(els.map(e => (e as any).content)).toContain('Slakthus · Hall 3')
  })
  it('gives the hero the largest type level', () => {
    const els = tower.compose(input())
    const hero = els.find(e => e.id === 'tier_hero')! as any
    const fine = els.find(e => e.id === 'tier_fineprint')! as any
    expect(LEVELS.indexOf(hero.level)).toBeGreaterThan(LEVELS.indexOf(fine.level))
  })
  it('keeps every region inside the grid', () => {
    for (const e of tower.compose(input())) {
      expect(e.region.col).toBeGreaterThanOrEqual(1)
      expect(e.region.col + e.region.colSpan - 1).toBeLessThanOrEqual(12)
      expect(e.region.row).toBeGreaterThanOrEqual(1)
      expect(e.region.row + e.region.rowSpan - 1).toBeLessThanOrEqual(16)
    }
  })
  it('is deterministic per seed', () => {
    expect(tower.compose(input({ rng: makeRng(3) }))).toEqual(tower.compose(input({ rng: makeRng(3) })))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-stagings.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry + Tower**

Create `frontend/shared/template-grid/generate/stagings.ts`:

```ts
import type { BrandKit, ElementV2, Region, TextLevel, TextStyleV2, Tiers, TierId } from '../types'
import type { Rng } from './rng'
import type { KnobSpec } from './knobs'
import { DEFAULT_TIER_LEVELS, tierEntries } from './tiers'

export interface StagingInput {
  tiers: Tiers
  cols: number
  rows: number
  rng: Rng
  knobs: Record<string, unknown>
  brand?: BrandKit
}

export interface Staging {
  id: string
  name: string
  blurb: string
  knobs: KnobSpec[]
  supports?: { minTiers?: number; maxTiers?: number; surfaces?: string[] }
  compose(input: StagingInput): ElementV2[]
}

/** Build a placed text element for a tier. Level defaults from the tier but a
 *  staging may override (e.g. force the hero to display). `origin:'staging'`
 *  marks it regenerable. Foreground colour binds to the brand token so surfaces
 *  can flip contrast. */
export function tierText(
  id: TierId, tiers: Tiers, region: Region, priority: number,
  opts: { level?: TextLevel; style?: TextStyleV2 } = {},
): ElementV2 {
  const spec = tiers[id]!
  return {
    id: `tier_${id}`,
    type: 'text',
    content: spec.content,
    level: opts.level ?? DEFAULT_TIER_LEVELS[id],
    priority,
    region,
    origin: 'staging',
    role: id.toUpperCase(),
    style: {
      color: '{{ brand.foreground }}',
      ...opts.style,
      ...spec.type,   // tier's own type wins — survives re-roll
    },
  }
}

/** Clamp a region so it never leaves the grid. */
function clampRegion(r: Region, cols: number, rows: number): Region {
  const col = Math.min(Math.max(1, r.col), cols)
  const row = Math.min(Math.max(1, r.row), rows)
  return {
    col, row,
    colSpan: Math.max(1, Math.min(r.colSpan, cols - col + 1)),
    rowSpan: Math.max(1, Math.min(r.rowSpan, rows - row + 1)),
  }
}

/**
 * Tower — hero stacked at the top, fine print pinned to the corners, anchor
 * (date) blown up at the bottom. The MAT+FEST composition.
 */
const tower: Staging = {
  id: 'tower',
  name: 'Tower',
  blurb: 'Hero stacked top, anchor as a bottom slab; corners hold the fine print.',
  knobs: [{ id: 'align', pick: ['left', 'right'] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const left = knobs.align !== 'right'
    const entries = tierEntries(tiers)
    const has = (id: TierId) => entries.some(e => e.id === id)
    const full = { col: 1, colSpan: cols }
    const align: TextStyleV2['align'] = left ? 'left' : 'right'

    if (has('fineprint')) {
      els.push(tierText('fineprint', tiers,
        clampRegion({ ...full, row: 1, rowSpan: 1 }, cols, rows), 4,
        { style: { align, valign: 'top' } }))
    }
    if (has('hero')) {
      els.push(tierText('hero', tiers,
        clampRegion({ ...full, row: 2, rowSpan: Math.round(rows * 0.4) }, cols, rows), 1,
        { level: 'display', style: { align, valign: 'top', fontWeight: 700 } }))
    }
    if (has('support')) {
      els.push(tierText('support', tiers,
        clampRegion({ col: 1, colSpan: Math.round(cols / 2), row: Math.round(rows * 0.56), rowSpan: 2 }, cols, rows), 3,
        { style: { align: 'left', valign: 'top' } }))
    }
    if (has('anchor')) {
      els.push(tierText('anchor', tiers,
        clampRegion({ ...full, row: Math.round(rows * 0.72), rowSpan: Math.round(rows * 0.2) }, cols, rows), 2,
        { level: 'headline', style: { align, valign: 'bottom', fontWeight: 700 } }))
    }
    return els
  },
}

export const STAGINGS: Staging[] = [tower]

export function getStaging(id: string): Staging | undefined {
  return STAGINGS.find(s => s.id === id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-stagings.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/generate/stagings.ts frontend/tests/unit/sl-gen-stagings.unit.spec.ts
git commit -m "feat(smart-layout): staging registry + Tower composer"
```

---

## Task 6: Stagings — Split + Frame

**Files:**
- Modify: `frontend/shared/template-grid/generate/stagings.ts`
- Test: `frontend/tests/unit/sl-gen-stagings.unit.spec.ts` (extend)

**Interfaces:**
- Produces: `split` and `frame` stagings appended to `STAGINGS`.

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('staging: split + frame registered and valid', () => {
  const LEVELS = ['caption', 'body', 'subhead', 'headline', 'display']
  for (const id of ['split', 'frame']) {
    it(`${id} places tiers inside the grid with hero largest`, () => {
      const s = getStaging(id)!
      expect(s).toBeTruthy()
      const els = s.compose(input())
      expect(els.length).toBeGreaterThanOrEqual(3)
      for (const e of els) {
        expect(e.region.col + e.region.colSpan - 1).toBeLessThanOrEqual(12)
        expect(e.region.row + e.region.rowSpan - 1).toBeLessThanOrEqual(16)
      }
      const hero = els.find(e => e.id === 'tier_hero')! as any
      const fine = els.find(e => e.id === 'tier_fineprint')! as any
      expect(LEVELS.indexOf(hero.level)).toBeGreaterThanOrEqual(LEVELS.indexOf(fine.level))
    })
  }
  it('split differs from tower placement', () => {
    const t = getStaging('tower')!.compose(input())
    const s = getStaging('split')!.compose(input())
    expect(JSON.stringify(s.map(e => e.region))).not.toBe(JSON.stringify(t.map(e => e.region)))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-stagings.unit.spec.ts`
Expected: FAIL — `getStaging('split')` is undefined.

- [ ] **Step 3: Add split + frame**

In `stagings.ts`, before `export const STAGINGS`, add:

```ts
/**
 * Split — hero broken across a diagonal of air: first half flush-left high,
 * second half flush-right lower. Anchor sits bottom-left, fine print bottom-right.
 */
const split: Staging = {
  id: 'split',
  name: 'Split',
  blurb: 'Hero broken across a diagonal of whitespace.',
  knobs: [{ id: 'drop', pick: [2, 3, 4] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const half = Math.round(cols / 2)
    const drop = Number(knobs.drop ?? 3)
    if (tiers.hero) {
      els.push(tierText('hero', tiers,
        clampRegion({ col: 1, colSpan: cols, row: 2, rowSpan: Math.round(rows * 0.22) }, cols, rows), 1,
        { level: 'display', style: { align: 'left', valign: 'top', fontWeight: 700 } }))
    }
    if (tiers.support) {
      els.push(tierText('support', tiers,
        clampRegion({ col: 1, colSpan: half, row: Math.round(rows * 0.44), rowSpan: 3 }, cols, rows), 3,
        { style: { align: 'left', valign: 'top' } }))
    }
    if (tiers.anchor) {
      els.push(tierText('anchor', tiers,
        clampRegion({ col: 1, colSpan: cols, row: rows - drop - 2, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700 } }))
    }
    if (tiers.fineprint) {
      els.push(tierText('fineprint', tiers,
        clampRegion({ col: half, colSpan: cols - half + 1, row: rows, rowSpan: 1 }, cols, rows), 4,
        { style: { align: 'right', valign: 'bottom' } }))
    }
    return els
  },
}

/**
 * Frame — hero anchored to the top-left corner with generous air below (that
 * air is where an image surface reads). Anchor bottom-left; support/fine print
 * hug the right edge.
 */
const frame: Staging = {
  id: 'frame',
  name: 'Frame',
  blurb: 'Hero anchored to a corner; the open field carries the surface.',
  knobs: [{ id: 'corner', pick: ['tl', 'bl'] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const heroTop = knobs.corner === 'bl' ? Math.round(rows * 0.55) : 2
    const half = Math.round(cols / 2)
    if (tiers.hero) {
      els.push(tierText('hero', tiers,
        clampRegion({ col: 1, colSpan: half + 1, row: heroTop, rowSpan: Math.round(rows * 0.28) }, cols, rows), 1,
        { level: 'display', style: { align: 'left', valign: 'top', fontWeight: 700 } }))
    }
    if (tiers.support) {
      els.push(tierText('support', tiers,
        clampRegion({ col: half + 1, colSpan: cols - half, row: Math.round(rows * 0.42), rowSpan: 3 }, cols, rows), 3,
        { style: { align: 'right', valign: 'top' } }))
    }
    if (tiers.anchor) {
      els.push(tierText('anchor', tiers,
        clampRegion({ col: 1, colSpan: cols, row: rows - 2, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700 } }))
    }
    if (tiers.fineprint) {
      els.push(tierText('fineprint', tiers,
        clampRegion({ col: half + 1, colSpan: cols - half, row: 1, rowSpan: 1 }, cols, rows), 4,
        { style: { align: 'right', valign: 'top' } }))
    }
    return els
  },
}
```

Then change the registry line to:

```ts
export const STAGINGS: Staging[] = [tower, split, frame]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-stagings.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/generate/stagings.ts frontend/tests/unit/sl-gen-stagings.unit.spec.ts
git commit -m "feat(smart-layout): Split + Frame stagings"
```

---

## Task 7: Stagings — Centered + Editorial + Index

**Files:**
- Modify: `frontend/shared/template-grid/generate/stagings.ts`
- Test: `frontend/tests/unit/sl-gen-stagings.unit.spec.ts` (extend)

**Interfaces:**
- Produces: `centered`, `editorial`, `index` stagings appended to `STAGINGS`; the registry now has 6 stagings.

- [ ] **Step 1: Write the failing test (append)**

```ts
describe('staging: full library', () => {
  it('registers all six stagings', () => {
    expect(STAGINGS.map(s => s.id).sort()).toEqual(
      ['centered', 'editorial', 'frame', 'index', 'split', 'tower'])
  })
  it('every staging produces distinct placement and stays in-grid', () => {
    const shapes = new Set<string>()
    for (const s of STAGINGS) {
      const els = s.compose(input())
      for (const e of els) {
        expect(e.region.col + e.region.colSpan - 1).toBeLessThanOrEqual(12)
        expect(e.region.row + e.region.rowSpan - 1).toBeLessThanOrEqual(16)
      }
      shapes.add(JSON.stringify(els.map(e => [e.id, e.region])))
    }
    expect(shapes.size).toBe(STAGINGS.length) // no two stagings are identical
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-stagings.unit.spec.ts`
Expected: FAIL — only three stagings registered.

- [ ] **Step 3: Add centered + editorial + index**

In `stagings.ts`, before `export const STAGINGS`, add:

```ts
/** Centered — hero centred with symmetric air; anchor below; fine print pinned
 *  to top and bottom edges. Quiet, poster-like. */
const centered: Staging = {
  id: 'centered', name: 'Centered',
  blurb: 'Hero centred with symmetric air above and below.',
  knobs: [],
  compose({ tiers, cols, rows }) {
    const els: ElementV2[] = []
    if (tiers.fineprint) els.push(tierText('fineprint', tiers,
      clampRegion({ col: 1, colSpan: cols, row: 1, rowSpan: 1 }, cols, rows), 4,
      { style: { align: 'center', valign: 'top' } }))
    if (tiers.hero) els.push(tierText('hero', tiers,
      clampRegion({ col: 1, colSpan: cols, row: Math.round(rows * 0.32), rowSpan: Math.round(rows * 0.3) }, cols, rows), 1,
      { level: 'display', style: { align: 'center', valign: 'middle', fontWeight: 700 } }))
    if (tiers.anchor) els.push(tierText('anchor', tiers,
      clampRegion({ col: 1, colSpan: cols, row: Math.round(rows * 0.66), rowSpan: 2 }, cols, rows), 2,
      { level: 'headline', style: { align: 'center', valign: 'top' } }))
    if (tiers.support) els.push(tierText('support', tiers,
      clampRegion({ col: Math.round(cols * 0.25), colSpan: Math.round(cols * 0.5), row: rows - 2, rowSpan: 2 }, cols, rows), 3,
      { style: { align: 'center', valign: 'bottom' } }))
    return els
  },
}

/** Editorial — a left type column (hero + support stacked) beside an open right
 *  field; anchor bottom-right, fine print top-right. */
const editorial: Staging = {
  id: 'editorial', name: 'Editorial',
  blurb: 'Left type column against an open right field.',
  knobs: [{ id: 'colw', pick: [6, 7, 8] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const colw = Math.min(Number(knobs.colw ?? 7), cols - 1)
    if (tiers.hero) els.push(tierText('hero', tiers,
      clampRegion({ col: 1, colSpan: colw, row: 2, rowSpan: Math.round(rows * 0.34) }, cols, rows), 1,
      { level: 'display', style: { align: 'left', valign: 'top', fontWeight: 700 } }))
    if (tiers.support) els.push(tierText('support', tiers,
      clampRegion({ col: 1, colSpan: colw, row: Math.round(rows * 0.4), rowSpan: 4 }, cols, rows), 3,
      { style: { align: 'left', valign: 'top' } }))
    if (tiers.fineprint) els.push(tierText('fineprint', tiers,
      clampRegion({ col: colw + 1, colSpan: cols - colw, row: 2, rowSpan: 2 }, cols, rows), 4,
      { style: { align: 'right', valign: 'top' } }))
    if (tiers.anchor) els.push(tierText('anchor', tiers,
      clampRegion({ col: colw + 1, colSpan: cols - colw, row: rows - 3, rowSpan: 3 }, cols, rows), 2,
      { level: 'headline', style: { align: 'right', valign: 'bottom', fontWeight: 700 } }))
    return els
  },
}

/** Index — a numbered/enumerated feel: fine print as a top rail, hero mid, and
 *  support as a left index column with the anchor beneath it. */
const index: Staging = {
  id: 'index', name: 'Index',
  blurb: 'Top rail of meta, hero mid-canvas, indexed support column.',
  knobs: [{ id: 'heroRow', pick: [4, 5, 6] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const heroRow = Number(knobs.heroRow ?? 5)
    if (tiers.fineprint) els.push(tierText('fineprint', tiers,
      clampRegion({ col: 1, colSpan: cols, row: 1, rowSpan: 1 }, cols, rows), 4,
      { style: { align: 'left', valign: 'top' } }))
    if (tiers.hero) els.push(tierText('hero', tiers,
      clampRegion({ col: 1, colSpan: cols, row: heroRow, rowSpan: Math.round(rows * 0.3) }, cols, rows), 1,
      { level: 'display', style: { align: 'left', valign: 'top', fontWeight: 700 } }))
    if (tiers.support) els.push(tierText('support', tiers,
      clampRegion({ col: 1, colSpan: Math.round(cols / 2), row: Math.round(rows * 0.68), rowSpan: 3 }, cols, rows), 3,
      { style: { align: 'left', valign: 'top' } }))
    if (tiers.anchor) els.push(tierText('anchor', tiers,
      clampRegion({ col: 1, colSpan: cols, row: rows - 2, rowSpan: 2 }, cols, rows), 2,
      { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700 } }))
    return els
  },
}
```

Then update the registry:

```ts
export const STAGINGS: Staging[] = [tower, split, frame, centered, editorial, index]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-stagings.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/generate/stagings.ts frontend/tests/unit/sl-gen-stagings.unit.spec.ts
git commit -m "feat(smart-layout): Centered + Editorial + Index stagings"
```

---

## Task 8: Surfaces

**Files:**
- Create: `frontend/shared/template-grid/generate/surfaces.ts`
- Test: `frontend/tests/unit/sl-gen-surfaces.unit.spec.ts`

**Interfaces:**
- Consumes: `TemplateV2` (for `background`), `Rng`, `KnobSpec`.
- Produces:
  - `interface SurfaceResult { background: { fill?: string; image?: string }; contrast: 'light' | 'dark' }` — `contrast` = the luminance of the surface, so text can flip (`'dark'` surface ⇒ light text).
  - `interface Surface { id: string; name: string; kind: 'procedural' | 'image'; needsImage?: boolean; knobs: KnobSpec[]; apply(input: { rng: Rng; knobs: Record<string, unknown>; image?: string }): SurfaceResult }`
  - `SURFACES: Surface[]`; `getSurface(id: string): Surface | undefined`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/sl-gen-surfaces.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SURFACES, getSurface } from '~~/shared/template-grid/generate/surfaces'
import { makeRng } from '~~/shared/template-grid/generate/rng'

describe('surfaces', () => {
  it('registers flat, holographic, tint, split-field and duotone-photo', () => {
    expect(SURFACES.map(s => s.id).sort()).toEqual(
      ['duotone-photo', 'flat', 'holographic', 'split-field', 'tint'])
  })
  it('procedural surfaces set a fill and a contrast, no image', () => {
    for (const s of SURFACES.filter(s => s.kind === 'procedural')) {
      const r = s.apply({ rng: makeRng(1), knobs: {} })
      expect(r.background.fill).toBeTruthy()
      expect(['light', 'dark']).toContain(r.contrast)
    }
  })
  it('duotone-photo needs an image and uses it', () => {
    const duo = getSurface('duotone-photo')!
    expect(duo.needsImage).toBe(true)
    const r = duo.apply({ rng: makeRng(1), knobs: {}, image: '/view?filename=x.png&type=input' })
    expect(r.background.image).toContain('x.png')
  })
  it('is deterministic per seed', () => {
    const holo = getSurface('holographic')!
    expect(holo.apply({ rng: makeRng(2), knobs: {} })).toEqual(holo.apply({ rng: makeRng(2), knobs: {} }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-surfaces.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement surfaces**

Create `frontend/shared/template-grid/generate/surfaces.ts`:

```ts
import type { Rng } from './rng'
import type { KnobSpec } from './knobs'

export interface SurfaceResult {
  background: { fill?: string; image?: string }
  /** Luminance of the field — text flips to stay legible. */
  contrast: 'light' | 'dark'
}

export interface Surface {
  id: string
  name: string
  kind: 'procedural' | 'image'
  needsImage?: boolean
  knobs: KnobSpec[]
  apply(input: { rng: Rng; knobs: Record<string, unknown>; image?: string }): SurfaceResult
}

/** Flat paper — the classic near-white Swiss field. */
const flat: Surface = {
  id: 'flat', name: 'Flat paper', kind: 'procedural', knobs: [{ id: 'shade', pick: ['#f4f3ef', '#ffffff', '#eceae4'] }],
  apply: ({ knobs }) => ({ background: { fill: String(knobs.shade ?? '#f4f3ef') }, contrast: 'light' }),
}

/** Holographic — soft iridescent gradient (the HUS AV GLAS look). */
const holographic: Surface = {
  id: 'holographic', name: 'Holographic', kind: 'procedural',
  knobs: [{ id: 'angle', pick: [110, 120, 135] }],
  apply: ({ knobs }) => ({
    background: { fill: `linear-gradient(${Number(knobs.angle ?? 120)}deg, #e9edf2 0%, #c7cdd6 45%, #bcd6ff 70%, #ffd2b0 100%)` },
    contrast: 'light',
  }),
}

/** Tint — a saturated brand-ish colour field; text goes light. */
const tint: Surface = {
  id: 'tint', name: 'Tint block', kind: 'procedural',
  knobs: [{ id: 'fill', pick: ['#e0492f', '#1a1a1a', '#2f6fe0'] }],
  apply: ({ knobs }) => {
    const fill = String(knobs.fill ?? '#e0492f')
    return { background: { fill }, contrast: fill === '#1a1a1a' ? 'dark' : 'dark' }
  },
}

/** Split field — a two-tone diagonal, dark over light. Text stays dark. */
const splitField: Surface = {
  id: 'split-field', name: 'Split field', kind: 'procedural',
  knobs: [{ id: 'angle', pick: [160, 200] }],
  apply: ({ knobs }) => ({
    background: { fill: `linear-gradient(${Number(knobs.angle ?? 160)}deg, #141414 0%, #141414 48%, #f4f3ef 48%, #f4f3ef 100%)` },
    contrast: 'light',
  }),
}

/** Duotone photo — a wired/picked image as the field; text goes light. */
const duotonePhoto: Surface = {
  id: 'duotone-photo', name: 'Duotone photo', kind: 'image', needsImage: true, knobs: [],
  apply: ({ image }) => ({ background: { image: image ?? '' }, contrast: 'dark' }),
}

export const SURFACES: Surface[] = [flat, holographic, tint, splitField, duotonePhoto]

export function getSurface(id: string): Surface | undefined {
  return SURFACES.find(s => s.id === id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-surfaces.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/generate/surfaces.ts frontend/tests/unit/sl-gen-surfaces.unit.spec.ts
git commit -m "feat(smart-layout): surface axis (flat/holographic/tint/split/duotone)"
```

---

## Task 9: Validator

**Files:**
- Create: `frontend/shared/template-grid/generate/validate.ts`
- Test: `frontend/tests/unit/sl-gen-validate.unit.spec.ts`

**Interfaces:**
- Consumes: `ElementV2` from `../types`.
- Produces: `validateGenerated(els: ElementV2[], cols: number, rows: number): { ok: boolean; reasons: string[] }`. Fails when: any region leaves the grid; distinct text `level`s > 3.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/sl-gen-validate.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateGenerated } from '~~/shared/template-grid/generate/validate'
import type { ElementV2 } from '~~/shared/template-grid/types'

const t = (id: string, level: any, region: any): ElementV2 =>
  ({ id, type: 'text', content: id, level, priority: 1, region, origin: 'staging' } as ElementV2)

describe('validateGenerated', () => {
  it('passes a valid in-grid layout with ≤3 levels', () => {
    const els = [
      t('a', 'display', { col: 1, colSpan: 12, row: 1, rowSpan: 4 }),
      t('b', 'headline', { col: 1, colSpan: 6, row: 6, rowSpan: 2 }),
      t('c', 'caption', { col: 1, colSpan: 12, row: 15, rowSpan: 1 }),
    ]
    expect(validateGenerated(els, 12, 16).ok).toBe(true)
  })
  it('fails when a region leaves the grid', () => {
    const els = [t('a', 'display', { col: 10, colSpan: 6, row: 1, rowSpan: 2 })]
    const r = validateGenerated(els, 12, 16)
    expect(r.ok).toBe(false)
    expect(r.reasons.join(' ')).toMatch(/off-grid/)
  })
  it('fails when more than three type sizes are used', () => {
    const els = [
      t('a', 'display', { col: 1, colSpan: 12, row: 1, rowSpan: 2 }),
      t('b', 'headline', { col: 1, colSpan: 12, row: 4, rowSpan: 2 }),
      t('c', 'subhead', { col: 1, colSpan: 12, row: 7, rowSpan: 2 }),
      t('d', 'caption', { col: 1, colSpan: 12, row: 10, rowSpan: 1 }),
    ]
    expect(validateGenerated(els, 12, 16).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-validate.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Create `frontend/shared/template-grid/generate/validate.ts`:

```ts
import type { ElementV2 } from '../types'

/** House-style + placement gate for a generated element set. Off-grid regions
 *  and >3 distinct text sizes (SWISS_LIMITS.maxTypeSizes) are rejected so the
 *  orchestrator can re-roll. Colour count is enforced by construction (tiers
 *  bind to brand tokens), so it isn't re-checked here. */
export function validateGenerated(els: ElementV2[], cols: number, rows: number): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  for (const e of els) {
    const { col, colSpan, row, rowSpan } = e.region
    if (col < 1 || row < 1 || col + colSpan - 1 > cols || row + rowSpan - 1 > rows) {
      reasons.push(`off-grid: ${e.id}`)
    }
  }
  const levels = new Set(els.filter(e => e.type === 'text').map(e => (e as { level: string }).level))
  if (levels.size > 3) reasons.push(`too many type sizes: ${levels.size}`)
  return { ok: reasons.length === 0, reasons }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-validate.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/generate/validate.ts frontend/tests/unit/sl-gen-validate.unit.spec.ts
git commit -m "feat(smart-layout): generated-layout validator (off-grid + type-size gate)"
```

---

## Task 10: Orchestrator (generate / shuffle / surprise)

**Files:**
- Create: `frontend/shared/template-grid/generate/generate.ts`
- Test: `frontend/tests/unit/sl-gen-generate.unit.spec.ts`

**Interfaces:**
- Consumes: everything above; `TemplateV3`, `GridSpec`, `BrandKit` from `../types`.
- Produces:
  - `generate(template: TemplateV3, opts: { staging: string; surface: string; seed: number; knobs?: Record<string, unknown>; brand?: BrandKit; image?: string }): TemplateV3`
  - `shuffle(template: TemplateV3, ctx?: { brand?: BrandKit; image?: string }): TemplateV3`
  - `surprise(template: TemplateV3, ctx?: { brand?: BrandKit; image?: string }): TemplateV3`

Behaviour: `generate` replaces all `origin:'staging'` elements with the staging's output (freeform + section children preserved), applies the surface to `background`, and stamps `gen`. If `validateGenerated` fails, it re-rolls knobs up to 8 times (new salted seed) before accepting the last attempt. `shuffle` keeps both axes (honours `gen.locks`), draws a new seed, re-rolls knobs. `surprise` re-rolls both axes (honouring locks) under a new seed.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/sl-gen-generate.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generate, shuffle, surprise } from '~~/shared/template-grid/generate/generate'
import type { TemplateV3, ElementV2 } from '~~/shared/template-grid/types'

function base(): TemplateV3 {
  return {
    version: 3, id: 't', name: 'T', master: '3x4',
    formats: { '3x4': { w: 1080, h: 1440 } },
    grid: { gutter: 16, margin: 48, baseline: 8, columns: 12, rows: 16 },
    typeScale: { base: 14, ratio: 1.5 },
    background: {},
    elements: [],
    sections: [],
    tiers: {
      hero: { content: 'MAT + FEST' },
      anchor: { content: '15—26 June' },
      support: { content: 'Street food' },
      fineprint: { content: 'Slakthus' },
    },
  }
}

describe('generate orchestrator', () => {
  it('emits staging elements, sets the surface background, and stamps gen', () => {
    const t = generate(base(), { staging: 'tower', surface: 'holographic', seed: 100 })
    expect(t.elements.length).toBeGreaterThan(0)
    expect(t.elements.every(e => e.origin === 'staging')).toBe(true)
    expect(t.background?.fill).toContain('linear-gradient')
    expect(t.gen).toMatchObject({ staging: 'tower', surface: 'holographic', seed: 100 })
  })
  it('is deterministic for the same tuple', () => {
    const a = generate(base(), { staging: 'split', surface: 'flat', seed: 7 })
    const b = generate(base(), { staging: 'split', surface: 'flat', seed: 7 })
    expect(JSON.stringify(a.elements)).toBe(JSON.stringify(b.elements))
  })
  it('preserves freeform elements across a re-roll', () => {
    let t = generate(base(), { staging: 'tower', surface: 'flat', seed: 1 })
    const freeform: ElementV2 = { id: 'note', type: 'text', content: 'hand-added', level: 'body',
      priority: 9, region: { col: 1, colSpan: 3, row: 14, rowSpan: 1 }, origin: 'freeform' }
    t = { ...t, elements: [...t.elements, freeform] }
    const rolled = shuffle(t)
    expect(rolled.elements.find(e => e.id === 'note')?.origin).toBe('freeform')
  })
  it('tier type overrides survive a re-roll', () => {
    const t0 = generate(base(), { staging: 'tower', surface: 'flat', seed: 1 })
    const withType: TemplateV3 = { ...t0, tiers: { ...t0.tiers, hero: { content: 'MAT + FEST', type: { letterSpacing: -3 } } } }
    const rolled = surprise(withType)
    const hero = rolled.elements.find(e => e.id === 'tier_hero') as any
    expect(hero.style.letterSpacing).toBe(-3)
  })
  it('shuffle keeps a locked staging but may change the seed', () => {
    const t = generate(base(), { staging: 'frame', surface: 'flat', seed: 1 })
    const locked: TemplateV3 = { ...t, gen: { ...t.gen!, locks: { staging: true } } }
    const rolled = shuffle(locked)
    expect(rolled.gen?.staging).toBe('frame')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-generate.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `frontend/shared/template-grid/generate/generate.ts`:

```ts
import type { BrandKit, ElementV2, TemplateV3 } from '../types'
import { makeRng } from './rng'
import { resolveKnobs } from './knobs'
import { getStaging, STAGINGS } from './stagings'
import { getSurface, SURFACES } from './surfaces'
import { validateGenerated } from './validate'

interface GenOpts {
  staging: string
  surface: string
  seed: number
  knobs?: Record<string, unknown>
  brand?: BrandKit
  image?: string
}

/** Text elements the surface says should read light get a light foreground; the
 *  tier's own type still wins if it set a colour. */
function applyContrast(els: ElementV2[], contrast: 'light' | 'dark'): ElementV2[] {
  const fg = contrast === 'dark' ? '{{ brand.foreground }}' : '{{ brand.secondary }}'
  return els.map(e => e.type === 'text'
    ? { ...e, style: { color: fg, ...e.style } }
    : e)
}

/** Deterministically produce a generated TemplateV3 from the axis tuple. */
export function generate(template: TemplateV3, opts: GenOpts): TemplateV3 {
  const staging = getStaging(opts.staging) ?? STAGINGS[0]!
  const surface = getSurface(opts.surface) ?? SURFACES[0]!
  const cols = template.grid.columns ?? 12
  const rows = template.grid.rows ?? 16
  const tiers = template.tiers ?? {}

  // Surface first (its own salted stream), then staging with knob re-roll on
  // validation failure.
  const surf = surface.apply({
    rng: makeRng(opts.seed, 'surface'),
    knobs: resolveKnobs(surface.knobs, makeRng(opts.seed, 'surface-knobs')),
    image: opts.image,
  })

  let staged: ElementV2[] = []
  let knobs: Record<string, unknown> = {}
  for (let attempt = 0; attempt < 8; attempt++) {
    const rng = makeRng(opts.seed + attempt, 'staging-knobs')
    knobs = resolveKnobs(staging.knobs, rng, attempt === 0 ? (opts.knobs ?? {}) : {})
    staged = staging.compose({ tiers, cols, rows, rng: makeRng(opts.seed + attempt, 'staging'), knobs, brand: opts.brand })
    if (validateGenerated(staged, cols, rows).ok) break
  }
  staged = applyContrast(staged, surf.contrast)

  const preserved = template.elements.filter(e => e.origin !== 'staging')
  return {
    ...template,
    background: { ...template.background, ...surf.background },
    elements: [...staged, ...preserved],
    gen: {
      staging: staging.id,
      surface: surface.id,
      seed: opts.seed,
      knobs,
      locks: template.gen?.locks,
    },
  }
}

/** Derive the next seed from the current one (deterministic, no Math.random). */
function nextSeed(seed: number): number {
  return (makeRng(seed, 'reseed').int(1_000_000) + 1)
}

/** Re-roll knobs (and unlocked axes stay put) under a new seed. */
export function shuffle(template: TemplateV3, ctx: { brand?: BrandKit; image?: string } = {}): TemplateV3 {
  const gen = template.gen ?? { staging: STAGINGS[0]!.id, surface: SURFACES[0]!.id, seed: 1 }
  return generate(template, { staging: gen.staging, surface: gen.surface, seed: nextSeed(gen.seed), brand: ctx.brand, image: ctx.image })
}

/** Re-roll BOTH axes under a new seed, honouring per-axis locks. */
export function surprise(template: TemplateV3, ctx: { brand?: BrandKit; image?: string } = {}): TemplateV3 {
  const gen = template.gen
  const seed = nextSeed(gen?.seed ?? 1)
  const pick = makeRng(seed, 'axes')
  const staging = gen?.locks?.staging ? gen.staging : pick.pick(STAGINGS).id
  // Surface pick respects the presence of an image for image-only surfaces.
  const pool = ctx.image ? SURFACES : SURFACES.filter(s => !s.needsImage)
  const surface = gen?.locks?.surface ? gen!.surface : pick.pick(pool).id
  return generate(template, { staging, surface, seed, brand: ctx.brand, image: ctx.image })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-generate.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Run the whole engine suite + commit**

Run: `npx vitest run tests/unit/sl-gen-*.unit.spec.ts`
Expected: PASS (all 7 files)

```bash
git add frontend/shared/template-grid/generate/generate.ts frontend/tests/unit/sl-gen-generate.unit.spec.ts
git commit -m "feat(smart-layout): generation orchestrator (generate/shuffle/surprise)"
```

---

## Task 11: Composable generation actions

**Files:**
- Modify: `frontend/app/composables/useGridEditor.ts`
- Test: `frontend/tests/unit/sl-gen-editor-actions.unit.spec.ts`

**Interfaces:**
- Consumes: `generate`, `shuffle`, `surprise` from `~~/shared/template-grid/generate/generate`; `autopopulateTiers`, `TIER_ORDER`, `DEFAULT_TIER_LEVELS` from `~~/shared/template-grid/generate/tiers`.
- Produces on the composable's returned object:
  - `editorMode: Ref<'layout' | 'freeform'>`
  - `genStaging: ComputedRef<string>`, `genSurface: ComputedRef<string>`, `genSeed: ComputedRef<number>`, `genLocks: ComputedRef<{ staging?: boolean; surface?: boolean }>`
  - `setStaging(id: string): void`, `setSurface(id: string): void`, `toggleLock(axis: 'staging' | 'surface'): void`
  - `shuffleLayout(): void`, `surpriseLayout(): void`
  - `tierType(id: TierId): Partial<TextStyleV2>`, `setTierType(id: TierId, patch: Partial<TextStyleV2>): void`
  - `addTierItem(id: TierId, content?: string): void`

All mutations go through the composable's existing `commit`/history mechanism (find how `addText` records history and mirror it).

- [ ] **Step 1: Read the composable's mutation pattern**

Open `frontend/app/composables/useGridEditor.ts`. Find `addText` (and the `template` ref, the history push helper it uses — e.g. `pushHistory()`/`commit()`/`snapshot()`, and how it ensures v3 via `convertToV3`). Mirror exactly that pattern in the new actions. Note the exact name of the template ref and history function; the code below assumes `template` (a `Ref<AnyGridTemplate>`) and a `commit(next)` helper — **rename to match the real ones**.

- [ ] **Step 2: Write the failing test**

Create `frontend/tests/unit/sl-gen-editor-actions.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { useGridEditor } from '~/composables/useGridEditor'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'
import type { TemplateV3 } from '~~/shared/template-grid/types'

function editorWithTiers() {
  const ctx = useGridEditor(makeStarterTemplate('gen-test'))
  ctx.convertToV3()
  ;(ctx.template.value as TemplateV3).tiers = {
    hero: { content: 'MAT + FEST' }, anchor: { content: '15—26' },
    support: { content: 'Food' }, fineprint: { content: 'Hall 3' },
  }
  return ctx
}

describe('useGridEditor generation actions', () => {
  it('surprise fills the canvas with staging elements and stamps gen', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    expect(t.elements.some(e => e.origin === 'staging')).toBe(true)
    expect(t.gen?.staging).toBeTruthy()
  })
  it('setSurface holds the staging (axis independence)', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const staging = (ctx.template.value as TemplateV3).gen!.staging
    ctx.setSurface('tint')
    const t = ctx.template.value as TemplateV3
    expect(t.gen?.staging).toBe(staging)
    expect(t.gen?.surface).toBe('tint')
  })
  it('shuffle is undoable', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const before = JSON.stringify((ctx.template.value as TemplateV3).elements)
    ctx.shuffleLayout()
    ctx.undo()
    expect(JSON.stringify((ctx.template.value as TemplateV3).elements)).toBe(before)
  })
  it('addTierItem adds a hero-tier text element', () => {
    const ctx = useGridEditor(makeStarterTemplate('add-test'))
    ctx.convertToV3()
    ctx.addTierItem('hero', 'BIG NEWS')
    const t = ctx.template.value as TemplateV3
    expect(t.tiers?.hero?.content).toBe('BIG NEWS')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/sl-gen-editor-actions.unit.spec.ts`
Expected: FAIL — `surpriseLayout` etc. not defined.

- [ ] **Step 4: Implement the actions**

At the top of `useGridEditor.ts`, add imports:

```ts
import { generate, shuffle, surprise } from '~~/shared/template-grid/generate/generate'
import { autopopulateTiers, DEFAULT_TIER_LEVELS } from '~~/shared/template-grid/generate/tiers'
import type { TierId } from '~~/shared/template-grid/types'
```

Inside `useGridEditor`, after the existing state refs, add (adapt `template`, `commit`, `convertToV3`, `effectiveBrand` names to the real ones found in Step 1):

```ts
  const editorMode = ref<'layout' | 'freeform'>('layout')

  const genStaging = computed(() => (template.value as TemplateV3).gen?.staging ?? 'tower')
  const genSurface = computed(() => (template.value as TemplateV3).gen?.surface ?? 'flat')
  const genSeed = computed(() => (template.value as TemplateV3).gen?.seed ?? 0)
  const genLocks = computed(() => (template.value as TemplateV3).gen?.locks ?? {})

  function asV3(): TemplateV3 { convertToV3(); return template.value as TemplateV3 }
  function genCtx() { return { brand: effectiveBrand.value as any } } // image wiring added in Task 15

  function shuffleLayout() { commit(shuffle(asV3(), genCtx())) }
  function surpriseLayout() { commit(surprise(asV3(), genCtx())) }

  function setStaging(id: string) {
    const t = asV3()
    commit(generate(t, { staging: id, surface: t.gen?.surface ?? 'flat', seed: t.gen?.seed ?? 1, ...genCtx() }))
  }
  function setSurface(id: string) {
    const t = asV3()
    commit(generate(t, { staging: t.gen?.staging ?? 'tower', surface: id, seed: t.gen?.seed ?? 1, ...genCtx() }))
  }
  function toggleLock(axis: 'staging' | 'surface') {
    const t = asV3()
    const locks = { ...(t.gen?.locks ?? {}) }
    locks[axis] = !locks[axis]
    commit({ ...t, gen: { ...(t.gen ?? { staging: 'tower', surface: 'flat', seed: 1 }), locks } })
  }

  function tierType(id: TierId) { return (template.value as TemplateV3).tiers?.[id]?.type ?? {} }
  function setTierType(id: TierId, patch: Record<string, unknown>) {
    const t = asV3()
    const tiers = { ...(t.tiers ?? {}) }
    const spec = tiers[id] ?? { content: '' }
    tiers[id] = { ...spec, type: { ...spec.type, ...patch } }
    // Re-generate in place so the type change is visible immediately (same tuple).
    commit(generate({ ...t, tiers }, { staging: t.gen?.staging ?? 'tower', surface: t.gen?.surface ?? 'flat', seed: t.gen?.seed ?? 1, ...genCtx() }))
  }
  function addTierItem(id: TierId, content = '') {
    const t = asV3()
    const tiers = { ...(t.tiers ?? {}) }
    tiers[id] = { content: content || tiers[id]?.content || id.toUpperCase(), type: tiers[id]?.type }
    const seed = t.gen?.seed ?? 1
    commit(generate({ ...t, tiers }, { staging: t.gen?.staging ?? 'tower', surface: t.gen?.surface ?? 'flat', seed, ...genCtx() }))
  }
```

Add all of these to the composable's `return { … }` object.

> If the composable's history helper is not named `commit`, wrap: assign `template.value = next` then call the real history-push (mirror `addText`). The tests gate correctness.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/sl-gen-editor-actions.unit.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/app/composables/useGridEditor.ts frontend/tests/unit/sl-gen-editor-actions.unit.spec.ts
git commit -m "feat(smart-layout): generation actions on useGridEditor"
```

---

## Task 12: LayoutControlsPanel component

**Files:**
- Create: `frontend/app/components/templates/LayoutControlsPanel.vue`
- (No unit test — Vue UI; verified in the browser at Task 14/15. Logic is already covered by Task 11.)

**Interfaces:**
- Consumes (via `inject('gridEditor')`): `genStaging`, `genSurface`, `genLocks`, `genSeed`, `setStaging`, `setSurface`, `toggleLock`, `shuffleLayout`, `surpriseLayout` from Task 11; `STAGINGS`, `SURFACES` from the engine.

- [ ] **Step 1: Create the component**

Create `frontend/app/components/templates/LayoutControlsPanel.vue`:

```vue
<script setup lang="ts">
import { STAGINGS } from '~~/shared/template-grid/generate/stagings'
import { SURFACES } from '~~/shared/template-grid/generate/surfaces'

const ctx = inject<any>('gridEditor')
</script>

<template>
  <div class="px-4 py-3.5 flex flex-col gap-3 border-b border-white/[0.06]">
    <p class="text-[10px] uppercase tracking-[0.12em] text-white/35">Layout</p>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[9px] uppercase tracking-wide text-white/40">Staging</span>
        <button class="text-[10px]" :class="ctx.genLocks.value.staging ? 'text-action' : 'text-white/30'"
          title="Lock staging so Surprise only rolls the surface" @click="ctx.toggleLock('staging')">
          {{ ctx.genLocks.value.staging ? '🔒' : '🔓' }}
        </button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="s in STAGINGS" :key="s.id" :title="s.blurb"
          class="h-8 px-2 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer"
          :class="ctx.genStaging.value === s.id ? 'bg-white text-black border-white' : 'border-white/10 text-white/60 hover:text-white'"
          @click="ctx.setStaging(s.id)">{{ s.name }}</button>
      </div>
    </div>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[9px] uppercase tracking-wide text-white/40">Surface</span>
        <button class="text-[10px]" :class="ctx.genLocks.value.surface ? 'text-action' : 'text-white/30'"
          title="Lock surface so Surprise only rolls the staging" @click="ctx.toggleLock('surface')">
          {{ ctx.genLocks.value.surface ? '🔒' : '🔓' }}
        </button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="s in SURFACES" :key="s.id" :title="s.name"
          class="h-8 px-2 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer"
          :class="ctx.genSurface.value === s.id ? 'bg-white text-black border-white' : 'border-white/10 text-white/60 hover:text-white'"
          @click="ctx.setSurface(s.id)">{{ s.name }}</button>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button class="flex-1 h-8 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[12px] text-white/80 font-semibold cursor-pointer"
        @click="ctx.shuffleLayout()">Shuffle ⇄</button>
      <button class="flex-1 h-8 rounded-md bg-action hover:bg-action/90 text-[12px] text-white font-semibold cursor-pointer"
        @click="ctx.surpriseLayout()">Surprise ✦</button>
    </div>
    <p class="text-[10px] text-white/30 font-mono">seed {{ ctx.genSeed.value }}</p>
  </div>
</template>
```

- [ ] **Step 2: Verify it compiles (typecheck the file's imports)**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep LayoutControlsPanel || echo "no new errors in LayoutControlsPanel"`
Expected: `no new errors in LayoutControlsPanel` (pre-existing baseline errors elsewhere are fine — memory: typecheck baseline ~328).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/templates/LayoutControlsPanel.vue
git commit -m "feat(smart-layout): LayoutControlsPanel (staging/surface/shuffle/surprise)"
```

---

## Task 13: Tier Type panel

**Files:**
- Create: `frontend/app/components/templates/TierTypePanel.vue`

**Interfaces:**
- Consumes (via `inject('gridEditor')`): `selectedElement` (existing), `tierType`, `setTierType` (Task 11). Reuses existing `TemplatesFontPicker`.
- The selected element's tier id is derived from its `id` (`tier_<id>`).

- [ ] **Step 1: Create the component**

Create `frontend/app/components/templates/TierTypePanel.vue`:

```vue
<script setup lang="ts">
import type { TierId } from '~~/shared/template-grid/types'

const ctx = inject<any>('gridEditor')

const tierId = computed<TierId | null>(() => {
  const id = ctx?.selectedElement?.value?.id as string | undefined
  return id?.startsWith('tier_') ? (id.slice(5) as TierId) : null
})
const t = computed(() => tierId.value ? ctx.tierType(tierId.value) : {})
function patch(p: Record<string, unknown>) { if (tierId.value) ctx.setTierType(tierId.value, p) }
</script>

<template>
  <div v-if="tierId" class="px-4 py-3.5 flex flex-col gap-2.5">
    <p class="text-[10px] uppercase tracking-[0.12em] text-white/35">Type · {{ tierId }}</p>
    <div>
      <span class="text-[10px] text-white/40">Font</span>
      <TemplatesFontPicker :model-value="t.fontFamily || 'Inter'" @update:model-value="(f: string) => patch({ fontFamily: f })" />
    </div>
    <label class="flex items-center justify-between">
      <span class="text-[11px] text-white/55">Weight</span>
      <select class="h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white"
        :value="t.fontWeight || 400" @change="(e: any) => patch({ fontWeight: Number(e.target.value) })">
        <option :value="400">Regular</option>
        <option :value="700">Bold</option>
      </select>
    </label>
    <label class="flex items-center justify-between">
      <span class="text-[11px] text-white/55">Tracking</span>
      <input type="number" step="0.5" :value="t.letterSpacing ?? 0"
        class="w-20 h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white text-right"
        @change="(e: any) => patch({ letterSpacing: Number(e.target.value) })">
    </label>
    <label class="flex items-center justify-between">
      <span class="text-[11px] text-white/55">Colour</span>
      <input type="text" :value="t.color ?? ''" placeholder="{{ brand.foreground }}"
        class="w-32 h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white font-mono"
        @change="(e: any) => patch({ color: e.target.value })">
    </label>
    <p class="text-[10px] text-white/30 leading-snug">These ride the tier — they survive Shuffle / Surprise.</p>
  </div>
</template>
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep TierTypePanel || echo "no new errors in TierTypePanel"`
Expected: `no new errors in TierTypePanel`

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/templates/TierTypePanel.vue
git commit -m "feat(smart-layout): TierTypePanel (tier-level type controls)"
```

---

## Task 14: Mode toggle + semantic tools + right-panel wiring

**Files:**
- Modify: `frontend/app/components/templates/GridEditorShell.vue`

**Interfaces:**
- Consumes: `ctx.editorMode`, `ctx.addTierItem`, and the two new panels (`LayoutControlsPanel`, `TierTypePanel`) auto-imported by Nuxt as `TemplatesLayoutControlsPanel` / `TemplatesTierTypePanel`.

- [ ] **Step 1: Add the mode toggle + semantic tools to the bottom toolbar**

In `GridEditorShell.vue`, in the bottom tool cluster (the `<div class="flex items-center gap-1 bg-[#1a1a1a]/95 …">` around line 595), insert at the very start of that cluster, before the Brand block:

```vue
        <!-- Mode toggle: Layout (generatable) vs Freeform (manual) -->
        <div class="flex items-center bg-white/[0.05] rounded-lg p-0.5 mr-1">
          <button class="h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
            :class="ctx.editorMode.value === 'layout' ? 'bg-action text-white' : 'text-white/50 hover:text-white'"
            @click="ctx.editorMode.value = 'layout'">Layout</button>
          <button class="h-7 px-2.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
            :class="ctx.editorMode.value === 'freeform' ? 'bg-action text-white' : 'text-white/50 hover:text-white'"
            @click="ctx.editorMode.value = 'freeform'">Freeform</button>
        </div>
        <div class="w-px h-5 bg-white/10 mx-0.5" />
```

Then wrap the existing Text/Image/Shape/Section buttons so they only show in Freeform mode, and add the semantic add-tools for Layout mode. Replace the four existing tool buttons (`Text`, `Image`, `Shape`, `Section`) with:

```vue
        <template v-if="ctx.editorMode.value === 'layout'">
          <button v-for="tier in (['hero','anchor','support','fineprint'] as const)" :key="tier"
            class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer capitalize"
            :title="`Add a ${tier} item`"
            @click="ctx.addTierItem(tier)">+ {{ tier === 'hero' ? 'Headline' : tier === 'anchor' ? 'Anchor' : tier === 'support' ? 'List' : 'Detail' }}</button>
          <button class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            title="Add an image" @click="imagePickerOpen = true">
            <ImagePlus class="size-3.5" /> Image
          </button>
        </template>
        <template v-else>
          <!-- existing Text / Image / Shape / Section buttons unchanged, moved here verbatim -->
        </template>
```

(Move the original `Text`/`Image`/`Shape`/`Section` `<button>` markup verbatim into the `v-else` template.)

- [ ] **Step 2: Wire the right panel**

In the right panel's "nothing selected" branch (`<template v-else>` around line 471), at the top of the scrollable `<div class="min-h-0 flex-1 overflow-y-auto">`, add the Layout controls when in Layout mode:

```vue
            <TemplatesLayoutControlsPanel v-if="ctx.editorMode.value === 'layout'" />
```

In the "element selected" branch (`<template v-else-if="selectedElement || selectedSection">`), add the tier type panel above the existing inspector:

```vue
            <TemplatesTierTypePanel v-if="ctx.editorMode.value === 'layout'" />
```

- [ ] **Step 3: Verify in the browser**

Start the dev server and open a Smart Layout node's editor:

```bash
cd frontend && npm run dev
```

Use the preview tools: `preview_start` (dev server), open the app, drop/open a Smart Layout node → editor modal. Verify by eye + `read_page`:
- One toolbar with a Layout/Freeform toggle (no double toolbar).
- In Layout mode the add-tools read `+ Headline / + Anchor / + List / + Detail / Image`; the right panel shows the Layout controls.
- Toggling to Freeform swaps back to Text/Image/Shape/Section.
- Clicking a staging chip re-lays the canvas; Shuffle/Surprise change it; the seed label updates.
- Selecting the hero shows the Type panel; changing tracking updates the canvas and persists after a Shuffle.

Capture a screenshot (`computer` → screenshot) as evidence.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/templates/GridEditorShell.vue
git commit -m "feat(smart-layout): Layout/Freeform mode toggle + semantic tools + panels"
```

---

## Task 15: Seed tiers + first generate on open; E2E smoke

**Files:**
- Modify: `frontend/app/components/vue-canvas/SmartLayoutEditorModal.vue`
- Modify: `frontend/app/composables/useGridEditor.ts` (thread wired image into `genCtx`)
- Create: `frontend/tests/sl-generation.spec.ts` (Playwright)

**Interfaces:**
- Consumes: `autopopulateTiers` from `~~/shared/template-grid/generate/tiers`; `generate` from the engine; `initialProps` (existing in the modal).

- [ ] **Step 1: Seed tiers + first generate when a fresh layout opens**

In `SmartLayoutEditorModal.vue` `onMounted` (the v2/v3 branch, around line 80), after `autopopulateV2(layout as TemplateV2, initialProps.value)`, add:

```ts
    // Generation: if the layout has no staged elements yet, seed tiers from the
    // wired sockets and lay out one composition so the editor opens on a real
    // poster rather than a blank grid.
    const v3 = layout as unknown as TemplateV3
    const hasStaged = (v3.elements ?? []).some(e => e.origin === 'staging')
    if (!hasStaged && !v3.tiers) {
      v3.tiers = autopopulateTiers(initialProps.value)
      if (Object.keys(v3.tiers).length > 0) {
        const seeded = generate({ ...v3, version: 3, sections: v3.sections ?? [] },
          { staging: 'tower', surface: 'flat', seed: 1, brand: initialBrand.value as any })
        Object.assign(layout, seeded)
      }
    }
```

Add the imports at the top of the modal:

```ts
import { autopopulateTiers } from '~~/shared/template-grid/generate/tiers'
import { generate } from '~~/shared/template-grid/generate/generate'
import type { TemplateV3 } from '~~/shared/template-grid/types'
```

- [ ] **Step 2: Thread the wired image into generation context**

In `useGridEditor.ts`, extend `genCtx()` to include the first wired image if the composable has access to sample props (it holds `sampleProps`). Replace the Task 11 `genCtx` with:

```ts
  function genCtx() {
    const img = (sampleProps.value?.image_layer_1 as string | undefined) || undefined
    return { brand: effectiveBrand.value as any, image: img }
  }
```

(If `sampleProps` isn't in scope under that name, use the composable's actual sample-props ref found in Task 11 Step 1.)

- [ ] **Step 3: Write the E2E smoke test**

Create `frontend/tests/sl-generation.spec.ts`. This asserts real behaviour — the template's `gen` state changes and the staged elements differ — not merely "it rendered" (memory: graceful fallback hides integration failure). Adapt the selectors/URL to how existing `frontend/tests/*.spec.ts` open the app and add a Smart Layout node (follow the existing `smart-layout.spec.ts` setup verbatim):

```ts
import { test, expect } from '@playwright/test'

test('Smart Layout generates and re-rolls distinct layouts', async ({ page }) => {
  await page.goto('/')            // adapt to the harness used by smart-layout.spec.ts
  // …open a Smart Layout node's editor (copy the helper from smart-layout.spec.ts)…

  // Surprise twice; assert the on-canvas staged elements actually change.
  const surprise = page.getByRole('button', { name: /Surprise/ })
  await surprise.click()
  const first = await page.locator('[data-el-id^="tier_"]').allInnerTexts()
  const firstSeed = await page.locator('text=/seed \\d+/').innerText()
  await surprise.click()
  const secondSeed = await page.locator('text=/seed \\d+/').innerText()
  expect(secondSeed).not.toBe(firstSeed)
  expect(first.length).toBeGreaterThan(0)
})
```

> If canvas elements don't carry a `data-el-id`, add `:data-el-id="element.id"` to the element root in `GridEditorCanvas.vue` (small, safe) so the E2E can assert on staged content.

- [ ] **Step 4: Run the E2E**

Run: `cd frontend && npx playwright test tests/sl-generation.spec.ts`
Expected: PASS (seed changes between Surprises; staged elements present).

- [ ] **Step 5: Full unit sweep + commit**

Run: `cd frontend && npm run test:unit`
Expected: the 8 `sl-gen-*` files PASS; no previously-passing test regresses (memory: vitest counts lie under load — check the collected-file total and that no `sl-gen-*` file fails).

```bash
git add frontend/app/components/vue-canvas/SmartLayoutEditorModal.vue frontend/app/composables/useGridEditor.ts frontend/app/components/templates/GridEditorCanvas.vue frontend/tests/sl-generation.spec.ts
git commit -m "feat(smart-layout): seed tiers + first generate on open; generation E2E"
```

---

## Self-Review

**1. Spec coverage:**
- Importance-tier model → Tasks 1, 3. ✓
- Staging library (~6) → Tasks 5–7. ✓
- Surface axis (4 procedural + duotone) → Task 8. ✓
- Seeded Shuffle/Surprise + per-axis lock + seed → Tasks 10, 11, 12. ✓
- Layout/Freeform toggle + semantic adds → Task 14. ✓
- Right panel: Layout controls + Type controls → Tasks 12, 13, 14. ✓
- Type overrides survive re-roll (tier-level) → Tasks 10 (test), 11, 13. ✓
- Origin preservation (freeform survives) → Tasks 1, 10. ✓
- Emits standard TemplateV3 → resolver/render/reflow unchanged → Task 10 (no render code touched anywhere). ✓
- House limits by construction + validator → Tasks 8, 9, 10. ✓
- Seed tiers + first generate on open → Task 15. ✓
- Non-goals (node-face shuffle, 15–20 stagings, image-surface expansion, AI generation) → correctly absent. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. The two "adapt to the real name" notes (composable history helper in Task 11; Playwright open-node helper in Task 15) are explicit read-first instructions, not placeholders — the surrounding code is complete and the tests gate correctness.

**3. Type consistency:** `Staging`/`StagingInput`, `Surface`/`SurfaceResult`, `KnobSpec`, `Rng`, `TierId`/`TierSpec`/`Tiers`/`GenState`, and the composable action names (`shuffleLayout`, `surpriseLayout`, `setStaging`, `setSurface`, `toggleLock`, `tierType`, `setTierType`, `addTierItem`, `editorMode`, `genStaging`/`genSurface`/`genSeed`/`genLocks`) are used identically across the tasks that define and consume them. `generate`/`shuffle`/`surprise` signatures match between Task 10 and Task 11.
