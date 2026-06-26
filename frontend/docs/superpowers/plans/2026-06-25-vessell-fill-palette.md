# Vessell Fill Palette — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragmented per-effect fill defaults in Type Studio with one shared "Vessell" palette, applied as each effect's default fills via a deterministic per-effect seeded shuffle.

**Architecture:** A new THREE-free `palette.ts` exports the canonical `VESSELL_FILLS` array plus `defaultFillsFor(count, seedKey)` (seeded Fisher-Yates shuffle → first `count` fills, serialized) and `vessellColorsFor(count, seedKey)` (same shuffle, primary colors). Every fill-list effect's `default` becomes `defaultFillsFor(N, id)`; Extrude (which uses color pickers, not fills) takes 6 colors from `vessellColorsFor`.

**Tech Stack:** TypeScript, Vitest. Reuses `app/lib/spacetype/rng.ts` (`mulberry32`, `hashSeed`) and `app/lib/spacetype/fillTile.ts` (`Fill`, `serializeFills`).

## Global Constraints

- Type Studio only (Gradient/Shader/Texture/Compositor are a later project).
- `palette.ts` must stay THREE-free (import only from `rng.ts` and `fillTile.ts`).
- Never mutate `VESSELL_FILLS` — shuffle a copy.
- Seed is the effect's own `id` (e.g. `'ball'`, `'boost'`).
- The `Fill` shape is `{ type, a, b, textColor, angle, density }`.
- Run tests from `frontend/`: `npx vitest run <path>`. Typecheck `npx vue-tsc --noEmit` has a large pre-existing error baseline (~390s) — only confirm no NEW errors in touched files.
- Commit on `main` (no branches). End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: The palette module

**Files:**
- Create: `app/lib/spacetype/palette.ts`
- Test: `frontend/tests/unit/spacetype-palette.unit.spec.ts`

**Interfaces:**
- Consumes: `mulberry32(seed: number)`, `hashSeed(s: string)` from `./rng`; `type Fill`, `serializeFills(fills: Fill[])` from `./fillTile`.
- Produces:
  - `VESSELL_FILLS: Fill[]` (6 slots)
  - `defaultFillsFor(count: number, seedKey: string): string`
  - `vessellColorsFor(count: number, seedKey: string): string[]`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-palette.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { VESSELL_FILLS, defaultFillsFor, vessellColorsFor } from '~/lib/spacetype/palette'

describe('vessell palette', () => {
  it('has 6 canonical slots, each a well-formed Fill', () => {
    expect(VESSELL_FILLS).toHaveLength(6)
    for (const f of VESSELL_FILLS) {
      expect(typeof f.type).toBe('string')
      expect(f.a).toMatch(/^#/); expect(f.b).toMatch(/^#/); expect(f.textColor).toMatch(/^#/)
    }
  })
  it('defaultFillsFor is deterministic for a given (count, seed)', () => {
    expect(defaultFillsFor(4, 'ball')).toBe(defaultFillsFor(4, 'ball'))
  })
  it('returns exactly count fills', () => {
    expect(JSON.parse(defaultFillsFor(3, 'coil'))).toHaveLength(3)
    expect(JSON.parse(defaultFillsFor(1, 'field'))).toHaveLength(1)
  })
  it('cycles when count exceeds the palette length', () => {
    expect(JSON.parse(defaultFillsFor(8, 'x'))).toHaveLength(8)
  })
  it('different seeds generally produce different orderings', () => {
    const a = defaultFillsFor(6, 'ball'), b = defaultFillsFor(6, 'coil'), c = defaultFillsFor(6, 'blend')
    expect(new Set([a, b, c]).size).toBeGreaterThan(1)
  })
  it('vessellColorsFor returns count primary colors matching the shuffled fills', () => {
    const cols = vessellColorsFor(6, 'boost')
    const fills = JSON.parse(defaultFillsFor(6, 'boost'))
    expect(cols).toHaveLength(6)
    expect(cols).toEqual(fills.map((f: any) => f.a))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-palette.unit.spec.ts`
Expected: FAIL — module `~/lib/spacetype/palette` not found.

- [ ] **Step 3: Implement `palette.ts`**

Create `app/lib/spacetype/palette.ts`:

```ts
import { mulberry32, hashSeed } from './rng'
import { type Fill, serializeFills } from './fillTile'

/**
 * The canonical "Vessell" fill palette — one ordered source of truth for every Type Studio
 * effect's default fills. Each effect takes a per-effect seeded shuffle of these (see
 * defaultFillsFor), so effects look varied but each effect's default is stable + reproducible.
 */
export const VESSELL_FILLS: Fill[] = [
  { type: 'solid',        a: '#2563ff', b: '#0a0a2e', textColor: '#0a0a2e', angle: 45, density: 8 },
  { type: 'stripes',      a: '#ef8fcb', b: '#e3685a', textColor: '#101014', angle: 45, density: 8 },
  { type: 'grid',         a: '#e3685a', b: '#edb07f', textColor: '#ffffff', angle: 45, density: 8 },
  { type: 'ombre',        a: '#86e8c0', b: '#eef07f', textColor: '#2a1838', angle: 45, density: 8 },
  { type: 'qr',           a: '#edb07f', b: '#e98fcf', textColor: '#ffffff', angle: 45, density: 8 },
  { type: 'checkerboard', a: '#eef07f', b: '#e98fcf', textColor: '#0a0a0a', angle: 45, density: 8 },
]

/** A deterministic Fisher-Yates shuffle of a COPY of VESSELL_FILLS, seeded by seedKey. */
function shuffledPalette(seedKey: string): Fill[] {
  const rand = mulberry32(hashSeed(seedKey))
  const out = VESSELL_FILLS.map(f => ({ ...f }))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** The first `count` fills of this effect's seeded shuffle, serialized for params. Cycles the
 *  palette if count exceeds its length. */
export function defaultFillsFor(count: number, seedKey: string): string {
  const shuffled = shuffledPalette(seedKey)
  const out: Fill[] = []
  for (let i = 0; i < count; i++) out.push({ ...shuffled[i % shuffled.length]! })
  return serializeFills(out)
}

/** The first `count` PRIMARY colors of this effect's seeded shuffle (for Extrude's side palette). */
export function vessellColorsFor(count: number, seedKey: string): string[] {
  const shuffled = shuffledPalette(seedKey)
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(shuffled[i % shuffled.length]!.a)
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-palette.unit.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck the new file**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "spacetype/palette.ts" || echo "(clean)"`
Expected: `(clean)`. If `Fill` lacks `angle`/`density` as required fields, adjust the literals to match the actual `Fill` type (it's a union — check `fillTile.ts` and drop any field the type rejects).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/palette.ts frontend/tests/unit/spacetype-palette.unit.spec.ts
git commit -m "feat(space-type): canonical Vessell fill palette + seeded helpers

VESSELL_FILLS (solid/stripes/grid/ombre/qr/checkerboard) + defaultFillsFor
(per-effect seeded shuffle) + vessellColorsFor.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wire the 17 fill-list effects to the palette

Replace each fill-list effect's `default:` with `defaultFillsFor(N, '<id>')` (N = current fill count, structure preserved), except **stripes 3→6**. Delete the three divergent `DEFAULT_FILLS` constants.

**Files (modify):** all under `app/lib/spacetype/effects/`:
`field.ts, cylinder.ts, melt.ts, elastic.ts, ribbon.ts, turntable.ts, contour.ts, tunnel.ts` (N=1) · `cascade.ts` (N=2) · `coil.ts, blend.ts, streamer.ts` (N=4) · `onionburst.ts, spiral.ts` (N=5) · `ball.ts, sliceGlitch.ts, stripes.ts` (N=6)
**Test:** `frontend/tests/unit/spacetype-palette.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: `defaultFillsFor` from `~/lib/spacetype/palette`; `SPACE_TYPE_EFFECTS` from `~/lib/spacetype/effects`.
- Produces: every fill-list control's `default` is now `defaultFillsFor(N, id)`.

- [ ] **Step 1: Add the consistency guard test (write it first — it will fail)**

Append to `frontend/tests/unit/spacetype-palette.unit.spec.ts`:

```ts
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'

describe('effect fill defaults all come from the palette', () => {
  for (const e of SPACE_TYPE_EFFECTS) {
    const fillControl = e.controls.find(c => c.kind === 'fillList')
    if (!fillControl) continue
    it(`${e.id} fillList default is a seeded palette prefix`, () => {
      const n = JSON.parse((fillControl as any).default).length
      expect((fillControl as any).default).toBe(defaultFillsFor(n, e.id))
    })
  }
})
```

- [ ] **Step 2: Run it — expect failures**

Run: `cd frontend && npx vitest run tests/unit/spacetype-palette.unit.spec.ts`
Expected: FAIL for every fill-list effect (their defaults are still bespoke JSON).

- [ ] **Step 3: Wire each effect**

In each effect file, import the helper at the top:

```ts
import { defaultFillsFor } from '../palette'
```

Then replace the fill-list control's `default:` value. The control keeps its `key`/`label`/`kind`/`group`; only `default` changes. Examples (apply the matching N + id to every file):

```ts
// field.ts (N=1, id 'field') — was '[{"type":"solid",...}]'
{ key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(1, 'field'), group: 'Color' },

// ball.ts (N=6, id 'ball')
{ key: 'fills', label: 'Panels', kind: 'fillList', default: defaultFillsFor(6, 'ball'), group: 'Color' },

// stripes.ts (N=6 — RAISED from 3, id 'stripes')
{ key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(6, 'stripes'), group: 'Color' },

// contour.ts (N=1, id 'contour', key stays 'colors')
{ key: 'colors', label: 'Colors', kind: 'fillList', default: defaultFillsFor(1, 'contour'), group: 'Color' },

// tunnel.ts (N=1, id 'tunnel', key 'colors')  → defaultFillsFor(1, 'tunnel')
// sliceGlitch.ts (N=6, id 'sliceGlitch', key 'palette') → defaultFillsFor(6, 'sliceGlitch')
// spiral.ts (N=5, id 'spiral', key 'fills') → defaultFillsFor(5, 'spiral')
// streamer.ts (N=4, id 'streamer', key 'fills') → defaultFillsFor(4, 'streamer')
```

Full N/id map: field 1, cylinder 1, melt 1, elastic 1, ribbon 1, turntable 1, contour 1, tunnel 1, cascade 2, coil 4, blend 4, streamer 4, onionburst 5, spiral 5, ball 6, sliceGlitch 6, stripes 6. **Use the effect's actual `id`** (open the file and read its `id:` field — most match the filename, but verify `sliceGlitch` → `id: 'sliceglitch'` and use that exact string).

In `cascade.ts`, `blend.ts`, `onionburst.ts`: delete the now-unused `const DEFAULT_FILLS = '...'` line.

- [ ] **Step 4: Run the guard test**

Run: `cd frontend && npx vitest run tests/unit/spacetype-palette.unit.spec.ts`
Expected: PASS. If an effect fails, its `id` string in the call doesn't match its real `id` (fix the seed) or its N is wrong (match the parsed count).

- [ ] **Step 5: Run the full spacetype suite + typecheck touched files**

Run: `cd frontend && npx vitest run tests/unit/spacetype-*.unit.spec.ts && npx vue-tsc --noEmit 2>&1 | grep "effects/" | grep -vE "boost\.ts" || echo "(no new effect errors)"`
Expected: tests PASS; no new typecheck errors in the wired effect files. (Removing `DEFAULT_FILLS` must not leave a dangling reference — if any effect still references it, replace that reference with the inline `defaultFillsFor(...)`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects frontend/tests/unit/spacetype-palette.unit.spec.ts
git commit -m "feat(space-type): all fill-list effects default to the Vessell palette

Each effect's fill default is now defaultFillsFor(N, id) (seeded shuffle,
structure preserved); stripes raised 3->6. Removes the 3 divergent
DEFAULT_FILLS constants + inline JSON. Guard test prevents drift.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Extrude (boost) — 6 palette colors, colors-only

Extrude uses individual side-color pickers (`boostColor1…5`), not a fill list. Extend to 6 and seed from the palette.

**Files (modify):** `app/lib/spacetype/effects/boost.ts`
**Test:** `frontend/tests/unit/spacetype-palette.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: `vessellColorsFor` from `../palette`.
- Produces: `boostColor1…6` controls whose defaults are `vessellColorsFor(6, 'boost')`; `paletteCount` max 6, default 6.

- [ ] **Step 1: Add the guard test (write first)**

Append to `frontend/tests/unit/spacetype-palette.unit.spec.ts`:

```ts
import { vessellColorsFor } from '~/lib/spacetype/palette'
import { getEffect } from '~/lib/spacetype/effects'

it('Extrude side palette (boostColor1..6) comes from the Vessell palette', () => {
  const boost = getEffect('boost')
  const cols = vessellColorsFor(6, 'boost')
  for (let i = 0; i < 6; i++) {
    const ctrl = boost.controls.find(c => c.key === `boostColor${i + 1}`) as any
    expect(ctrl, `boostColor${i + 1}`).toBeTruthy()
    expect(ctrl.default).toBe(cols[i])
  }
})
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd frontend && npx vitest run tests/unit/spacetype-palette.unit.spec.ts`
Expected: FAIL — `boostColor6` doesn't exist; `boostColor1..5` defaults are hardcoded hexes.

- [ ] **Step 3: Edit `boost.ts`**

Import at the top:

```ts
import { vessellColorsFor } from '../palette'
```

Just above the `controls` array (near the top of the effect object / module), compute the side palette once:

```ts
const BOOST_SIDE_COLORS = vessellColorsFor(6, 'boost')
```

Replace the five `boostColor1..5` control lines (boost.ts:165-169) and add a sixth:

```ts
  { key: 'boostColor1', label: 'Color 1', kind: 'color', default: BOOST_SIDE_COLORS[0], group: 'Color', hint: 'first palette color used on sides' },
  { key: 'boostColor2', label: 'Color 2', kind: 'color', default: BOOST_SIDE_COLORS[1], group: 'Color', hint: 'second palette color used on sides' },
  { key: 'boostColor3', label: 'Color 3', kind: 'color', default: BOOST_SIDE_COLORS[2], group: 'Color', hint: 'third palette color used on sides' },
  { key: 'boostColor4', label: 'Color 4', kind: 'color', default: BOOST_SIDE_COLORS[3], group: 'Color', hint: 'fourth palette color used on sides' },
  { key: 'boostColor5', label: 'Color 5', kind: 'color', default: BOOST_SIDE_COLORS[4], group: 'Color', hint: 'fifth palette color used on sides' },
  { key: 'boostColor6', label: 'Color 6', kind: 'color', default: BOOST_SIDE_COLORS[5], group: 'Color', hint: 'sixth palette color used on sides' },
```

Update the `paletteCount` control (boost.ts:164) to allow/default 6:

```ts
  { key: 'paletteCount', label: 'Palette colors', kind: 'slider', min: 1, max: 6, step: 1, default: 6, group: 'Color', hint: 'how many palette colors to use (1–6)' },
```

Update the clamp (boost.ts:395):

```ts
    const paletteCount = Math.max(1, Math.min(6, Math.floor(n(params, 'paletteCount'))))
```

Add `boostColor6` to the palette array (boost.ts:397):

```ts
    const palette = [
      params.boostColor1, params.boostColor2, params.boostColor3, params.boostColor4, params.boostColor5, params.boostColor6,
    ].slice(0, paletteCount).map(c => new three.Color(String(c)))
```

Note: `vessellColorsFor` returns `string[]`; `default` expects a string. `BOOST_SIDE_COLORS[i]` is typed `string | undefined` — if `vue-tsc` complains, use `BOOST_SIDE_COLORS[i]!` (the array always has 6 entries).

- [ ] **Step 4: Run the test + full suite**

Run: `cd frontend && npx vitest run tests/unit/spacetype-palette.unit.spec.ts tests/unit/spacetype-*.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck boost.ts**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "effects/boost.ts" || echo "(clean)"`
Expected: `(clean)` (or fix with the `!` non-null assertions noted above).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects/boost.ts frontend/tests/unit/spacetype-palette.unit.spec.ts
git commit -m "feat(space-type): Extrude side palette uses 6 Vessell colors

Adds boostColor6, raises paletteCount to 6 (default 6), seeds
boostColor1..6 from vessellColorsFor(6,'boost'). Colors-only (Extrude's
grid/noise patterns are separate controls).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd frontend && npm run test:unit` — full suite green.
- [ ] `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "palette.ts|effects/" | grep -v "pre-existing"` — no new errors in touched files.
- [ ] **In-app sign-off (pending, per project convention):** open Type Studio, cycle several effects, confirm each opens with palette-derived fills in a varied (per-effect) order; check Extrude shows 6 palette side colors. Visual look is the real proof — unit tests only assert the default *values*.

## Notes / deferred

- Exact palette hexes are approximations from the reference screenshot — easy to retune later by editing `VESSELL_FILLS` (one array; all effects + the guard test follow automatically).
- Spiral's "Underside gradient", Streamer's "Front colors", Contour/Tunnel "Colors" now adopt the shared palette too (intended).
- Propagating Vessell to the other studios + Compositor is the next project.
