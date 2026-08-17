# Shape Studio "Pieces" fill mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third `fillStrategy: 'pieces'` to Shape Studio that splits the mark into solo + overlap pieces and colors them by depth and/or a chosen spatial order, plus a `fillOrder` for the existing per-clone mode.

**Architecture:** All geometry stays in `lib/geoshape/boolean.ts` (a new `pieces` branch, parallel to today's per-shape branch, before the unified fold). A new pure `lib/geoshape/order.ts` ranks items for color assignment. Config gains `fillStrategy`/`fillOrder`/`overlapSeparate`/`overlapFills` (replacing the boolean `perShapeFill`). No render-layer changes — pieces are paint-carrying `GeoVectorShape`s.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript; paper.js boolean ops (lazy-imported detached `PaperScope`); Vitest.

## Global Constraints

- `config.ts` stays dependency-light: `Paint` is a **type-only** import; no `three`/`paper`/`fillTile` value imports. Reuse the existing `PAINT_TYPES`/`paintOrNull`/`paint`/`paintList` validators.
- Migration is mandatory: old saved nodes have `perShapeFill: boolean`, not `fillStrategy`. `perShapeFill:true → 'perClone'`, absent/false → `'single'`, an explicit `fillStrategy` wins.
- Both fill lists (`fills`, `overlapFills`) are guaranteed **non-empty** (via `paintList`) and are excluded from the GEO_CONTROLS drift guard (edited by bespoke list editors).
- Paper hygiene unchanged: one cached detached `PaperScope`, `sc.project.clear()` in `finally`.
- Pieces are disjoint regions → `fillRule: 'nonzero'`, draw order irrelevant.
- House rule: verify the live proof with a broken control (revert one arm → proof must fail).
- Colours: action blue is the only accent; no purple. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Stage only geoshape/Shape-Studio paths.

---

### Task 1: Config migration — `perShapeFill` boolean → `fillStrategy` enum + new fields

Mechanical rename across every consumer, **no new behaviour** (perClone == today's per-shape). Leaves the tree compiling and all tests green.

**Files:**
- Modify: `frontend/app/lib/geoshape/config.ts`
- Modify: `frontend/app/lib/geoshape/boolean.ts` (gate only)
- Modify: `frontend/app/lib/geoshape/controls.ts` (gate + swap perShapeFill switch → fillStrategy select)
- Modify: `frontend/app/components/vue-canvas/ShapeStudioSurface.vue` (perShapeFill refs → fillStrategy)
- Test: `frontend/tests/unit/geoshape-config.unit.spec.ts`, `geoshape-boolean.unit.spec.ts`, `geoshape-controls.unit.spec.ts`

**Interfaces:**
- Produces: `GeoFillStrategy = 'single' | 'perClone' | 'pieces'`; `GeoFillOrder = 'created' | 'depth' | 'leftRight' | 'topBottom' | 'rows' | 'columns' | 'centerOut' | 'around'`. Config fields `fillStrategy: GeoFillStrategy`, `fillOrder: GeoFillOrder`, `overlapSeparate: boolean`, `overlapFills: Paint[]`. `perShapeFill` removed.

- [ ] **Step 1: Update config types + defaults.** In `config.ts`, add near the other exported unions:
```ts
export type GeoFillStrategy = 'single' | 'perClone' | 'pieces'
export type GeoFillOrder = 'created' | 'depth' | 'leftRight' | 'topBottom' | 'rows' | 'columns' | 'centerOut' | 'around'
```
In `GeoShapeConfig`, replace the `perShapeFill: boolean` line with:
```ts
  /** How clones/pieces are coloured. single = unified fold + one `fill`;
   *  perClone = each clone its own cycled `fills`; pieces = split into solo +
   *  overlap pieces, coloured by `fillOrder`/`overlapSeparate`/`overlapFills`. */
  fillStrategy: GeoFillStrategy
  /** Order colours are handed out in (perClone: over clones; pieces: over solo pieces). */
  fillOrder: GeoFillOrder
  /** pieces mode: overlaps use `overlapFills` (true) or the same `fills` (false). */
  overlapSeparate: boolean
  /** pieces mode: the SEPARATE overlap palette, coloured by depth. Always non-empty.
   *  NOTE: distinct from `overlapFill` (a single Paint used by `overlapMode: 'shape'`
   *  in single mode) — different feature, do not conflate. */
  overlapFills: Paint[]
```
Keep `fills: Paint[]` as-is. In `DEFAULT_CONFIG`, replace `perShapeFill: false,` with:
```ts
  fillStrategy: 'single',
  fillOrder: 'created',
  overlapSeparate: false,
  overlapFills: ['#ffffff'],
```

- [ ] **Step 2: Update `mergeConfig` with migration.** Add the enum lists near the other `const LAYOUTS = …`:
```ts
const FILL_STRATEGIES = ['single', 'perClone', 'pieces'] as const
const FILL_ORDERS = ['created', 'depth', 'leftRight', 'topBottom', 'rows', 'columns', 'centerOut', 'around'] as const
```
Replace the `perShapeFill: bool(o.perShapeFill, d.perShapeFill),` line in the returned object with:
```ts
    fillStrategy: (typeof o.fillStrategy === 'string' && (FILL_STRATEGIES as readonly string[]).includes(o.fillStrategy))
      ? (o.fillStrategy as GeoFillStrategy)
      : (o.perShapeFill === true ? 'perClone' : 'single'),
    fillOrder: oneOf(o.fillOrder, FILL_ORDERS, d.fillOrder),
    overlapSeparate: bool(o.overlapSeparate, d.overlapSeparate),
    overlapFills: paintList(o.overlapFills, d.overlapFills),
```

- [ ] **Step 3: Update `boolean.ts` gate.** Change `if (cfg.perShapeFill) {` (the per-shape branch) to `if (cfg.fillStrategy === 'perClone') {`. No other change in this task (the `pieces` branch is Task 3).

- [ ] **Step 4: Update `controls.ts`.** Change the gate helper `const isSingleFill = (c: GeoShapeConfig) => !c.perShapeFill` to `const isSingleFill = (c: GeoShapeConfig) => c.fillStrategy === 'single'`. Replace the `switchC('perShapeFill', …)` control line with:
```ts
  select('fillStrategy', 'Fill', ['single', 'perClone', 'pieces'], DEFAULT_CONFIG.fillStrategy, 'Paint',
    'single = unified holes; perClone = one colour per shape; pieces = colour solo + overlap regions'),
```
Update the `fills` exclusion comment above it to name `fillStrategy` and both `fills` + `overlapFills` as list-editor fields.

- [ ] **Step 5: Update `ShapeStudioSurface.vue`.** Replace the `#control-perShapeFill` slot with `#control-fillStrategy`. Inside it, render a segmented/select bound to `config.fillStrategy` (reuse the existing StudioControlPanel select rendering by simply removing the bespoke slot — a plain `select` control renders generically — OR keep a bespoke slot with a small segmented control). Simplest: **remove the bespoke `#control-perShapeFill` slot entirely** so `fillStrategy` renders as a generic select, and move the fills-list editor to render right under the Paint card when `config.fillStrategy !== 'single'`. Change the `v-if="config.perShapeFill"` on the fills-list `<div>` to `v-if="config.fillStrategy !== 'single'"`. Update the helper text string to "Shapes cycle through these colours." Keep `addFill/removeFill/updateFill/fillDrop` unchanged.

- [ ] **Step 6: Update the three test files (rename only).** In `geoshape-boolean.unit.spec.ts`, change every `perShapeFill: true` → `fillStrategy: 'perClone'` and `perShapeFill: false` → `fillStrategy: 'single'`. In `geoshape-config.unit.spec.ts`, rename the perShapeFill round-trip test to `fillStrategy` and add migration assertions:
```ts
  it('migrates legacy perShapeFill and honors explicit fillStrategy', () => {
    expect(mergeConfig({ ...DEFAULT_CONFIG, perShapeFill: true }).fillStrategy).toBe('perClone')
    expect(mergeConfig({ ...DEFAULT_CONFIG, perShapeFill: false }).fillStrategy).toBe('single')
    expect(mergeConfig({ ...DEFAULT_CONFIG }).fillStrategy).toBe('single')
    expect(mergeConfig({ fillStrategy: 'pieces', perShapeFill: true }).fillStrategy).toBe('pieces')
    expect(mergeConfig({ fillStrategy: 'bogus' }).fillStrategy).toBe('single')
    expect(mergeConfig({ overlapFills: [] }).overlapFills).toEqual(DEFAULT_CONFIG.overlapFills)
    expect(mergeConfig({ fillOrder: 'rows' }).fillOrder).toBe('rows')
    expect(mergeConfig({ fillOrder: 'nope' }).fillOrder).toBe('created')
  })
```
In `geoshape-controls.unit.spec.ts`, update `NON_CONTROL_FIELDS` to `new Set(['locks', 'fills', 'overlapFills'])` and its comment; the drift guard expects `fillStrategy`/`fillOrder`/`overlapSeparate` to have controls (fillOrder + overlapSeparate arrive in Task 4 — for now add `fillStrategy` only, and temporarily also add `fillOrder`,`overlapSeparate` to a second exclusion note **only if** the guard fails; prefer to land their controls in Task 4 and let this task exclude them). To keep Task 1 green without Task 4's controls, ALSO exclude `fillOrder` and `overlapSeparate` here with a `// added in Task 4` comment, then Task 4 removes the exclusion.

- [ ] **Step 7: Run tests.**
Run: `cd frontend && npx vitest run tests/unit/geoshape-config.unit.spec.ts tests/unit/geoshape-boolean.unit.spec.ts tests/unit/geoshape-controls.unit.spec.ts`
Expected: PASS (all).

- [ ] **Step 8: Commit.**
```bash
git add frontend/app/lib/geoshape/config.ts frontend/app/lib/geoshape/boolean.ts frontend/app/lib/geoshape/controls.ts frontend/app/components/vue-canvas/ShapeStudioSurface.vue frontend/tests/unit/geoshape-config.unit.spec.ts frontend/tests/unit/geoshape-boolean.unit.spec.ts frontend/tests/unit/geoshape-controls.unit.spec.ts
git commit -m "refactor(geoshape): perShapeFill bool → fillStrategy enum + migration"
```

---

### Task 2: `rankOrder` helper (`lib/geoshape/order.ts`)

**Files:**
- Create: `frontend/app/lib/geoshape/order.ts`
- Test: `frontend/tests/unit/geoshape-order.unit.spec.ts`

**Interfaces:**
- Produces: `rankOrder(items: { cx: number; cy: number; i: number }[], order: GeoFillOrder, band: number): number[]` — returns `rank[k]` = the 0-based position of item `k` under `order`. `created`/`depth` → identity `[0,1,2,…]`. Ties broken by original index. `band` buckets rows/columns.

- [ ] **Step 1: Write the failing test** `geoshape-order.unit.spec.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { rankOrder } from '../../app/lib/geoshape/order'

// 2x2 grid: index 0=TL,1=TR,2=BL,3=BR (row-major). cx/cy in a grid, band=100.
const grid = [
  { cx: 0, cy: 0, i: 0 }, { cx: 200, cy: 0, i: 1 },
  { cx: 0, cy: 200, i: 2 }, { cx: 200, cy: 200, i: 3 },
]
describe('rankOrder', () => {
  it('created/depth are identity', () => {
    expect(rankOrder(grid, 'created', 100)).toEqual([0, 1, 2, 3])
    expect(rankOrder(grid, 'depth', 100)).toEqual([0, 1, 2, 3])
  })
  it('leftRight ranks by x (ties by index)', () => {
    // x: TL,BL=0 (ranks 0,1 by index) ; TR,BR=200 (ranks 2,3)
    expect(rankOrder(grid, 'leftRight', 100)).toEqual([0, 2, 1, 3])
  })
  it('topBottom ranks by y', () => {
    expect(rankOrder(grid, 'topBottom', 100)).toEqual([0, 1, 2, 3])
  })
  it('rows = reading order (row band, then x)', () => {
    // row0: TL(rank0),TR(rank1); row1: BL(rank2),BR(rank3)
    expect(rankOrder(grid, 'rows', 100)).toEqual([0, 1, 2, 3])
  })
  it('columns = down a column, then next column', () => {
    // col0: TL(rank0),BL(rank1); col1: TR(rank2),BR(rank3)
    expect(rankOrder(grid, 'columns', 100)).toEqual([0, 2, 1, 3])
  })
  it('centerOut ranks by distance from centroid', () => {
    const r = rankOrder(grid, 'centerOut', 100)
    expect(new Set(r)).toEqual(new Set([0, 1, 2, 3])) // a permutation; symmetric grid → all equidistant, stable by index
    expect(r).toEqual([0, 1, 2, 3])
  })
  it('around sweeps by angle', () => {
    const r = rankOrder(grid, 'around', 100)
    expect(new Set(r)).toEqual(new Set([0, 1, 2, 3]))
  })
})
```

- [ ] **Step 2: Run it, verify it fails** (`rankOrder` not defined).
Run: `cd frontend && npx vitest run tests/unit/geoshape-order.unit.spec.ts`

- [ ] **Step 3: Implement `order.ts`:**
```ts
/**
 * geoshape colour-order — ranks items (clones or pieces) for palette assignment.
 * Pure arithmetic, dependency-light (same posture as arrange.ts): no paper/three.
 */
import type { GeoFillOrder } from './config'

export interface OrderItem { cx: number; cy: number; i: number }

/** rank[k] = the 0-based position of item k under `order`. Ties → original index. */
export function rankOrder(items: OrderItem[], order: GeoFillOrder, band: number): number[] {
  const n = items.length
  const idx = items.map((_, k) => k)
  if (order === 'created' || order === 'depth') return idx.slice()
  let mx = 0, my = 0
  for (const p of items) { mx += p.cx; my += p.cy }
  mx /= (n || 1); my /= (n || 1)
  const b = band > 1e-6 ? band : 1
  const key = (k: number): number => {
    const p = items[k]!
    switch (order) {
      case 'leftRight': return p.cx
      case 'topBottom': return p.cy
      case 'centerOut': return Math.hypot(p.cx - mx, p.cy - my)
      case 'around': return Math.atan2(p.cy - my, p.cx - mx)
      case 'rows': return Math.round(p.cy / b) * 1e6 + p.cx
      case 'columns': return Math.round(p.cx / b) * 1e6 + p.cy
      default: return p.i
    }
  }
  const sorted = idx.slice().sort((a, c) => (key(a) - key(c)) || (a - c))
  const rank = new Array<number>(n)
  sorted.forEach((s, r) => { rank[s] = r })
  return rank
}
```

- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit.**
```bash
git add frontend/app/lib/geoshape/order.ts frontend/tests/unit/geoshape-order.unit.spec.ts
git commit -m "feat(geoshape): rankOrder helper for colour ordering"
```

---

### Task 3: Composite — perClone honors `fillOrder` + new `pieces` branch

**Files:**
- Modify: `frontend/app/lib/geoshape/boolean.ts`
- Test: `frontend/tests/unit/geoshape-boolean.unit.spec.ts`

**Interfaces:**
- Consumes: `rankOrder` (Task 2), config fields (Task 1).
- Produces: for `fillStrategy: 'pieces'`, one `GeoVectorShape` per solo piece + one per overlap depth band, each `fillRule: 'nonzero'`.

- [ ] **Step 1: Import `rankOrder`** at the top of `boolean.ts`: `import { rankOrder } from './order'`.

- [ ] **Step 2: Update the perClone branch to honor `fillOrder`.** In the `if (cfg.fillStrategy === 'perClone')` branch, before building `items`, compute clone ranks from placement centroids and use them for `pi`:
```ts
      const band = Math.max(1, cfg.size)
      const ranks = rankOrder(placements.map((pl, i) => ({ cx: pl.x, cy: pl.y, i })), cfg.fillOrder, band)
      let items: { path: paper.PathItem; pi: number }[] = clones.map((c, i) => ({ path: c as paper.PathItem, pi: ranks[i]! % fills.length }))
```
(The rest of the perClone branch — symmetry mirror inheriting `pi`, clip, map — is unchanged.)

- [ ] **Step 3: Add the `pieces` branch** immediately after the perClone branch (still before `const isEvenOdd`):
```ts
    if (cfg.fillStrategy === 'pieces') {
      const fills = cfg.fills.length ? cfg.fills : [cfg.fill]
      const ov = cfg.overlapFills.length ? cfg.overlapFills : fills
      const nonEmpty = (p: any): boolean => !!(p && p.bounds && p.bounds.width > 1e-6 && p.bounds.height > 1e-6)

      // Symmetry: mirror the clones BEFORE splitting so the split sees the full set.
      let cl = clones as paper.PathItem[]
      if (cfg.symmetry) {
        const sm = new sc.Matrix()
        if (cfg.symmetryAxis === 'vertical') sm.scale(-1, 1); else sm.scale(1, -1)
        sm.translate(cfg.symmetryAxis === 'vertical' ? cfg.symmetrySpacing : 0, cfg.symmetryAxis === 'horizontal' ? cfg.symmetrySpacing : 0)
        const mir = clones.map((c) => { const mc = c.clone(); mc.transform(sm); return mc as paper.PathItem })
        cl = (clones as paper.PathItem[]).concat(mir)
      }
      const N = cl.length

      type Piece = { path: paper.PathItem; cx: number; cy: number; depth: number }

      // 1. solo pieces: clone_i − union(others)
      const solo: Piece[] = []
      for (let i = 0; i < N; i++) {
        let others: any = null
        for (let j = 0; j < N; j++) {
          if (j === i) continue
          others = others ? others.unite(cl[j]) : (cl[j] as any).clone()
        }
        const s = others ? (cl[i] as any).subtract(others) : (cl[i] as any).clone()
        if (nonEmpty(s)) solo.push({ path: s, cx: s.bounds.center.x, cy: s.bounds.center.y, depth: 1 })
      }

      // 2. overlap depth bands (depth ≥ 2), incremental
      const bands: (paper.PathItem | null)[] = []
      for (let k = 0; k < N; k++) {
        const c = cl[k]
        let prevCovered: any = null
        for (const bd of bands) { if (bd) prevCovered = prevCovered ? prevCovered.unite(bd) : (bd as any).clone() }
        for (let d = bands.length; d >= 1; d--) {
          const band = bands[d - 1]
          if (!band) continue
          const moved = (band as any).intersect(c)
          if (nonEmpty(moved)) {
            const rest = (band as any).subtract(c)
            bands[d - 1] = nonEmpty(rest) ? rest : null
            bands[d] = bands[d] ? (bands[d] as any).unite(moved) : moved
          }
        }
        const fresh = prevCovered ? (c as any).subtract(prevCovered) : (c as any).clone()
        bands[0] = bands[0] ? (bands[0] as any).unite(fresh) : fresh
      }
      const overlaps: Piece[] = []
      for (let d = 2; d <= bands.length; d++) {
        const band = bands[d - 1]
        if (nonEmpty(band)) overlaps.push({ path: band as paper.PathItem, cx: (band as any).bounds.center.x, cy: (band as any).bounds.center.y, depth: d })
      }

      // 3. colouring
      const bandSize = solo.length
        ? [...solo].map((p) => Math.max(p.path.bounds.width, p.path.bounds.height)).sort((a, b) => a - b)[Math.floor(solo.length / 2)]!
        : Math.max(1, cfg.size)
      const soloRanks = cfg.fillOrder === 'depth'
        ? solo.map(() => 0)
        : rankOrder(solo.map((p, i) => ({ cx: p.cx, cy: p.cy, i })), cfg.fillOrder, bandSize)
      const colored: { path: paper.PathItem; paint: Paint }[] = []
      solo.forEach((p, i) => colored.push({ path: p.path, paint: fills[soloRanks[i]! % fills.length]! }))
      overlaps.forEach((p) => {
        const paint = cfg.overlapSeparate ? ov[(p.depth - 2) % ov.length]! : fills[(p.depth - 1) % fills.length]!
        colored.push({ path: p.path, paint })
      })

      // 4. clip mask
      let clipped = colored
      if (cfg.clipMask !== 'none') {
        const r = cfg.clipMaskSize
        const clip = cfg.clipMask === 'circle'
          ? new sc.Path.Circle(new sc.Point(0, 0), r)
          : cfg.clipMask === 'square'
            ? new sc.Path.Rectangle(new sc.Rectangle(-r, -r, 2 * r, 2 * r))
            : new sc.CompoundPath(hexClipD(r))
        clipped = colored.map(({ path, paint }) => ({ path: (path as any).intersect(clip) as paper.PathItem, paint }))
        clip.remove()
      }

      return clipped
        .filter(({ path }) => nonEmpty(path))
        .map(({ path, paint }) => ({
          commands: paperToCommands(path),
          paint,
          fill: solidOf(paint),
          stroke: cfg.stroke,
          strokeWidth: cfg.strokeWidth || undefined,
          fillRule: 'nonzero' as const,
        }))
    }
```

- [ ] **Step 4: Write pieces tests** (append to `geoshape-boolean.unit.spec.ts`). Use 3 mutually-overlapping diamonds with a real triple overlap. Helper `SQUARE`/existing `composite` import already present.
```ts
  const three = [
    { x: -40, y: -24, scale: 1, rotate: 45, skew: 0 },
    { x: 40, y: -24, scale: 1, rotate: 45, skew: 0 },
    { x: 0, y: 40, scale: 1, rotate: 45, skew: 0 },
  ]
  const pcfg = (over: Partial<any>) => ({ ...DEFAULT_CONFIG, fillStrategy: 'pieces', fills: ['#f00', '#0f0', '#00f'], overlapFills: ['#fff', '#000'], symmetry: false, clipMask: 'none', ...over })

  it('pieces: depth order → solo=fills[0], 2-deep=fills[1], 3-deep=fills[2]', async () => {
    const shapes = await composite(SQUARE, three, pcfg({ fillOrder: 'depth', overlapSeparate: false }))
    const paints = new Set(shapes.map((s) => s.paint))
    expect(paints.has('#f00')).toBe(true)   // solo
    expect(paints.has('#0f0')).toBe(true)   // 2-deep
    expect(paints.has('#00f')).toBe(true)   // 3-deep (triple center exists for this arrangement)
    for (const s of shapes) expect(s.fillRule).toBe('nonzero')
  })
  it('pieces: overlapSeparate uses overlapFills by depth', async () => {
    const shapes = await composite(SQUARE, three, pcfg({ fillOrder: 'depth', overlapSeparate: true }))
    const paints = new Set(shapes.map((s) => s.paint))
    expect(paints.has('#f00')).toBe(true)   // solo from fills[0]
    expect(paints.has('#fff')).toBe(true)   // 2-deep from overlapFills[0]
    expect(paints.has('#000')).toBe(true)   // 3-deep from overlapFills[1]
    expect(paints.has('#0f0')).toBe(false)  // shape fills 1/2 NOT used for overlaps
  })
  it('pieces: solo pieces follow fillOrder (leftRight)', async () => {
    const shapes = await composite(SQUARE, three, pcfg({ fillOrder: 'leftRight', overlapSeparate: true, overlapFills: ['#fff'] }))
    // solo pieces are the non-#fff shapes; their paints should include ≥2 distinct shape colours ordered by x
    const solo = shapes.filter((s) => s.paint !== '#fff')
    expect(new Set(solo.map((s) => s.paint)).size).toBeGreaterThanOrEqual(2)
  })
  it('perClone honors fillOrder (around changes the cycle vs created)', async () => {
    const ring = Array.from({ length: 6 }, (_, i) => ({ x: Math.cos(i * Math.PI / 3) * 120, y: Math.sin(i * Math.PI / 3) * 120, scale: 1, rotate: 0, skew: 0 }))
    const made = await composite(SQUARE, ring, { ...DEFAULT_CONFIG, fillStrategy: 'perClone', fills: ['#f00', '#0f0', '#00f'], fillOrder: 'created', symmetry: false })
    const around = await composite(SQUARE, ring, { ...DEFAULT_CONFIG, fillStrategy: 'perClone', fills: ['#f00', '#0f0', '#00f'], fillOrder: 'around', symmetry: false })
    expect(made.map((s) => s.paint)).not.toEqual(around.map((s) => s.paint))
  })
```
If the chosen `three` placements don't yield a triple overlap at `SQUARE`'s size, adjust the offsets so all three share a common region (verify by a scratch dump, then delete the scratch). Do NOT weaken the assertion to hide a missing depth.

- [ ] **Step 5: Run tests, verify PASS.**
Run: `cd frontend && npx vitest run tests/unit/geoshape-boolean.unit.spec.ts`

- [ ] **Step 6: Commit.**
```bash
git add frontend/app/lib/geoshape/boolean.ts frontend/tests/unit/geoshape-boolean.unit.spec.ts
git commit -m "feat(geoshape): pieces fill mode (solo + overlap-depth regions) + perClone order"
```

---

### Task 4: Controls — `fillOrder` + `overlapSeparate` + agent vocabulary

**Files:**
- Modify: `frontend/app/lib/geoshape/controls.ts`
- Test: `frontend/tests/unit/geoshape-controls.unit.spec.ts`

**Interfaces:**
- Consumes: config fields (Task 1). Produces: `fillOrder`/`overlapSeparate` controls in GEO_CONTROLS.

- [ ] **Step 1: Add gate helpers** in `controls.ts`:
```ts
const isMultiFill = (c: GeoShapeConfig) => c.fillStrategy !== 'single'
const isPieces = (c: GeoShapeConfig) => c.fillStrategy === 'pieces'
const isPiecesAndSeparate = (c: GeoShapeConfig) => c.fillStrategy === 'pieces' && c.overlapSeparate
```

- [ ] **Step 2: Add the two controls** in the Paint section, after the `fillStrategy` select:
```ts
  select('fillOrder', 'Colour order', ['created', 'depth', 'leftRight', 'topBottom', 'rows', 'columns', 'centerOut', 'around'], DEFAULT_CONFIG.fillOrder, 'Paint',
    'order colours are handed out in (rows = reading order; around = colour wheel)', { when: isMultiFill }),
  switchC('overlapSeparate', 'Separate overlap colours', DEFAULT_CONFIG.overlapSeparate, 'Paint', { when: isPieces }),
```
(`fillStrategy` select already added in Task 1.)

- [ ] **Step 3: Extend the drift-guard exclusion note** — `overlapFills` is a list-editor field (like `fills`); update the Paint-section comment to mention both. Extend `GEO_GUIDANCE`'s PAINT paragraph with one sentence on the three strategies and the order/overlap options.

- [ ] **Step 4: Update `geoshape-controls.unit.spec.ts`.** Remove the Task-1 temporary exclusions of `fillOrder`/`overlapSeparate` from `NON_CONTROL_FIELDS` (keep `overlapFills` excluded). Add visibility assertions:
```ts
  it('shows Colour order for perClone/pieces, hides for single', () => {
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'single' }).map(c => c.key)).not.toContain('fillOrder')
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'perClone' }).map(c => c.key)).toContain('fillOrder')
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'pieces' }).map(c => c.key)).toContain('fillOrder')
  })
  it('shows Separate overlap colours only for pieces', () => {
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'pieces' }).map(c => c.key)).toContain('overlapSeparate')
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'perClone' }).map(c => c.key)).not.toContain('overlapSeparate')
  })
  it('shows single Fill only for single strategy', () => {
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'single' }).map(c => c.key)).toContain('fill')
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'pieces' }).map(c => c.key)).not.toContain('fill')
  })
```

- [ ] **Step 5: Run tests, verify PASS.**
Run: `cd frontend && npx vitest run tests/unit/geoshape-controls.unit.spec.ts`

- [ ] **Step 6: Commit.**
```bash
git add frontend/app/lib/geoshape/controls.ts frontend/tests/unit/geoshape-controls.unit.spec.ts
git commit -m "feat(geoshape): fillOrder + overlapSeparate controls + agent vocabulary"
```

---

### Task 5: Surface UI — order select + separate switch + overlap-fills list

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShapeStudioSurface.vue`

(No new unit test — this is Vue wiring; covered by the Task 6 live proof. StudioControlPanel renders `fillOrder`/`overlapSeparate` generically from GEO_CONTROLS, so those need no bespoke slot.)

- [ ] **Step 1: Add `overlapFills` list helpers** mirroring the `fills` ones (add below `fillDragEnd`):
```ts
function addOverlapFill() { setGeoControl('overlapFills', [...config.value.overlapFills, '#ffffff']) }
function removeOverlapFill(i: number) {
  if (config.value.overlapFills.length <= 1) return
  setGeoControl('overlapFills', config.value.overlapFills.filter((_, j) => j !== i))
}
function updateOverlapFill(i: number, p: Paint) {
  setGeoControl('overlapFills', config.value.overlapFills.map((x, j) => (j === i ? p : x)))
}
```
(Reuse the same `fillDrag` reorder for the shapes list; a simple list without drag is acceptable for the overlap list — omit drag to keep it small, or add a parallel `ovDrag`. Prefer no-drag for overlapFills in v1.)

- [ ] **Step 2: Render the overlap-fills editor.** After the shapes fills-list `<div>` (the one now gated `v-if="config.fillStrategy !== 'single'"`), add:
```vue
          <div v-if="config.fillStrategy === 'pieces' && config.overlapSeparate" class="mt-3 space-y-2">
            <p class="text-[10px] font-medium uppercase tracking-wide text-white/40">Overlap colours</p>
            <div v-for="(f, i) in config.overlapFills" :key="'ov' + i"
                 class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
              <div class="flex items-center gap-1.5">
                <span class="w-3 shrink-0 text-center text-[10px] tabular-nums text-white/30">{{ i + 2 }}</span>
                <FillControl class="flex-1" allow-image :show-anchor="false" :model-value="f" @update:model-value="(v: Paint) => updateOverlapFill(i, v)" />
                <button v-if="config.overlapFills.length > 1" type="button" @click="removeOverlapFill(i)" aria-label="Remove overlap colour"
                        class="shrink-0 rounded p-1 text-white/30 hover:bg-white/10 hover:text-rose-300">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                </button>
              </div>
            </div>
            <button type="button" @click="addOverlapFill"
                    class="w-full rounded border border-dashed border-white/15 py-1.5 text-[11px] text-white/50 hover:border-white/30 hover:text-white/80">+ Add overlap colour</button>
            <p class="text-[10px] leading-relaxed text-white/35">By how many shapes cross — 2-deep, 3-deep, …</p>
          </div>
```
The index badge starts at `{{ i + 2 }}` (2-deep is the first overlap colour).

- [ ] **Step 3: Adapt the shapes-list helper text** (the existing `<p>`): change to reflect order, e.g. "Shapes cycle through these, in the chosen colour order." Confirm the shapes fills-list `v-if` is `config.fillStrategy !== 'single'` (from Task 1).

- [ ] **Step 4: Compile-check.** Restart isn't needed for Vue HMR, but verify no template/type error:
Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "ShapeStudioSurface\|geoshape" || echo "no new geoshape/surface errors"`
Expected: no new errors attributable to this change (baseline unrelated errors may exist — see [typecheck-baseline-anchoring]).

- [ ] **Step 5: Commit.**
```bash
git add frontend/app/components/vue-canvas/ShapeStudioSurface.vue
git commit -m "feat(geoshape): Pieces UI — colour order, separate-overlap switch + overlap list"
```

---

### Task 6: Live render-proof + final whole-branch review

**Files:** none (verification + review).

- [ ] **Step 1: Live proof in the dev studio** (`http://127.0.0.1:3000/dev/shape-studio-lab`). Set a 3-diamond stack (Diamond, radial count 3, moderate radius so all three overlap with a triple centre). Set Fill = Pieces, fillOrder = depth, overlapSeparate off → pixel-check that the mark shows ≥3 distinct hues (solo / 2-deep / 3-deep). Flip overlapSeparate on with vivid overlap colours → the crossing regions change to the overlap palette while solo areas stay put (pixel-check the overlap region hue changed, solo unchanged). Set a radial ring + perClone + fillOrder=around → solo hues sweep. Capture a screenshot per state.

- [ ] **Step 2: Broken-control check.** Temporarily force `overlapSeparate` colouring to reuse `fills` (revert the `ov[...]` arm) and confirm the "separate overlap" pixel-check FAILS; restore. (Per house rule — proof that the assertion bites.)

- [ ] **Step 3: Full geoshape suite.**
Run: `cd frontend && npx vitest run tests/unit/geoshape-config.unit.spec.ts tests/unit/geoshape-order.unit.spec.ts tests/unit/geoshape-arrange.unit.spec.ts tests/unit/geoshape-boolean.unit.spec.ts tests/unit/geoshape-paint.unit.spec.ts tests/unit/geoshape-render.unit.spec.ts tests/unit/geoshape-controls.unit.spec.ts tests/unit/geoshape-shapes.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 4: Final whole-branch review** via superpowers:requesting-code-review's code-reviewer template, opus model, over the Task-1..5 commit range (`scripts/review-package <base> HEAD`). Dispatch ONE fix subagent for any Critical/Important findings. Then update the ledger + the ⛵ dashboard/`docs/STATE.md` per the standing rule.
