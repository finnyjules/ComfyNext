# Shape Studio "Split crossings" mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `crossingMode: 'depth' | 'split'` to Pieces fill mode — Split gives each overlap crossing its own face, coloured by the colour order.

**Architecture:** New geometry in `lib/geoshape/boolean.ts`: `splitFaces` breaks an exact-depth band into connected faces (holes re-attached); the pieces branch colours solo + crossings by the existing `fillOrder`/`overlapSeparate`. Config + one control. No render changes.

**Tech Stack:** Nuxt 4 / TypeScript; paper.js booleans (detached PaperScope); Vitest.

## Global Constraints

- `config.ts` stays dependency-light (`Paint` type-only; reuse `oneOf`).
- Pieces MUST remain a disjoint partition in BOTH modes (sum of piece areas ≈ union area). Splitting a band into faces must not change covered area or introduce overlaps — holes belong to the deeper piece and must stay holes.
- `crossingMode` default `'depth'` → today's output is byte-for-byte unchanged.
- Paper hygiene: all new geometry inside the existing `try {} finally { sc.project.clear() }`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Stage only geoshape/Shape-Studio paths; never `git add -A` (parallel-session edits are on disk).

---

### Task 1: Config — `crossingMode`

**Files:** Modify `frontend/app/lib/geoshape/config.ts`; Test `frontend/tests/unit/geoshape-config.unit.spec.ts`

**Interfaces:** Produces `GeoCrossingMode = 'depth' | 'split'`; config field `crossingMode: GeoCrossingMode`.

- [ ] **Step 1:** Add the type near the other unions: `export type GeoCrossingMode = 'depth' | 'split'`. In `GeoShapeConfig`, after `overlapFills`, add:
```ts
  /** pieces mode: 'depth' merges overlaps per depth (one colour per depth level);
   *  'split' makes each crossing its own face, coloured by `fillOrder`. */
  crossingMode: GeoCrossingMode
```
In `DEFAULT_CONFIG`, after `overlapFills: ['#ffffff'],` add `crossingMode: 'depth',`.

- [ ] **Step 2:** Add the enum list near `FILL_ORDERS`: `const CROSSING_MODES = ['depth', 'split'] as const`. In `mergeConfig`'s return, after `overlapFills: …,` add: `crossingMode: oneOf(o.crossingMode, CROSSING_MODES, d.crossingMode),`.

- [ ] **Step 3:** Add to `geoshape-config.unit.spec.ts` (inside the existing migration/round-trip test or a new `it`):
```ts
  it('crossingMode round-trips and defaults to depth', () => {
    expect(mergeConfig({}).crossingMode).toBe('depth')
    expect(mergeConfig({ crossingMode: 'split' }).crossingMode).toBe('split')
    expect(mergeConfig({ crossingMode: 'nope' }).crossingMode).toBe('depth')
  })
```

- [ ] **Step 4:** Run `cd frontend && npx vitest run tests/unit/geoshape-config.unit.spec.ts` → PASS.
- [ ] **Step 5:** Commit (`config.ts` + test): `feat(geoshape): crossingMode config field`.

---

### Task 2: Composite — `splitFaces` + split-mode colouring

**Files:** Modify `frontend/app/lib/geoshape/boolean.ts`; Test `frontend/tests/unit/geoshape-boolean.unit.spec.ts`

**Interfaces:** Consumes `crossingMode`, `rankOrder`. In the `pieces` branch, when `crossingMode === 'split'` each crossing is emitted as its own paint-carrying `GeoVectorShape`.

- [ ] **Step 1: Add `splitFaces`** as a module-level helper in `boolean.ts` (near `hexClipD`), using the module `paperScope`'s types:
```ts
/** Split one exact-depth band into connected FACES, each an outer contour with its
 *  holes re-attached (a hole is a deeper region subtracted out — it belongs to the
 *  deeper piece, so it must stay a hole here or the pieces stop being disjoint).
 *  A child is a hole iff its interior point sits inside an ODD number of sibling
 *  contours (crossings are one level deep; nested holes-in-holes are out of scope). */
function splitFaces(sc: paper.PaperScope, band: paper.PathItem): paper.PathItem[] {
  const anyBand = band as any
  if (band.className !== 'CompoundPath' || !anyBand.children || anyBand.children.length <= 1) return [band]
  const kids: paper.Path[] = anyBand.children.slice()
  const pt = (k: any): paper.Point => (k.interiorPoint ?? k.bounds.center)
  const isHole = (i: number) => {
    let inside = 0
    for (let j = 0; j < kids.length; j++) { if (j !== i && (kids[j] as any).contains(pt(kids[i]))) inside++ }
    return inside % 2 === 1
  }
  const holeFlags = kids.map((_, i) => isHole(i))
  const faces: paper.PathItem[] = []
  kids.forEach((outer, i) => {
    if (holeFlags[i]) return
    const face = new sc.CompoundPath({ children: [outer.clone()] })
    kids.forEach((h, j) => { if (holeFlags[j] && (outer as any).contains(pt(h))) (face as any).addChild(h.clone()) })
    ;(face as any).fillRule = anyBand.fillRule ?? 'nonzero'
    faces.push(face as any)
  })
  return faces.length ? faces : [band]
}
```

- [ ] **Step 2: Rework the overlap collection + colouring** in the pieces branch. Replace the current `const overlaps: Piece[] = [] … ` band-collection loop AND the colouring block for overlaps with:
```ts
      // exact-depth bands (depth ≥ 2) from the nested atLeast sets — as today.
      const depthBands: { path: paper.PathItem; depth: number }[] = []
      for (let d = 2; d <= atLeast.length; d++) {
        const cur = atLeast[d - 1]; if (!nonEmpty(cur)) continue
        const deeper = atLeast[d]
        const band = nonEmpty(deeper) ? (cur as any).subtract(deeper) : (cur as any)
        if (nonEmpty(band)) depthBands.push({ path: band as paper.PathItem, depth: d })
      }
      // crossings: one Piece per depth band (depth mode) or per connected face (split mode)
      const overlaps: Piece[] = []
      for (const { path, depth } of depthBands) {
        const parts = cfg.crossingMode === 'split' ? splitFaces(sc, path) : [path]
        for (const p of parts) {
          if (!nonEmpty(p)) continue
          overlaps.push({ path: p, cx: (p as any).bounds.center.x, cy: (p as any).bounds.center.y, depth })
        }
      }
```
Then the colouring block becomes (keep the existing `bandSize`/`soloRanks`/`colored`/`ov` scaffolding; only the overlaps colouring changes):
```ts
      const colored: { path: paper.PathItem; paint: Paint }[] = []
      const ov = cfg.overlapSeparate ? (cfg.overlapFills.length ? cfg.overlapFills : fills) : null
      const spatial = cfg.fillOrder !== 'depth' && cfg.fillOrder !== 'created'
      if (cfg.crossingMode === 'split' && !cfg.overlapSeparate && spatial) {
        // ALL pieces (solo + crossings) flow through `fills` as one ordered sequence.
        const all = [...solo, ...overlaps]
        const ranks = rankOrder(all.map((p, i) => ({ cx: p.cx, cy: p.cy, i })), cfg.fillOrder, bandSize)
        all.forEach((p, i) => colored.push({ path: p.path, paint: fills[ranks[i]! % fills.length]! }))
      } else {
        // solo coloured by order (as today)
        solo.forEach((p, i) => colored.push({ path: p.path, paint: fills[soloRanks[i]! % fills.length]! }))
        if (cfg.crossingMode === 'split' && cfg.overlapSeparate && spatial) {
          const ranks = rankOrder(overlaps.map((p, i) => ({ cx: p.cx, cy: p.cy, i })), cfg.fillOrder, bandSize)
          overlaps.forEach((p, i) => colored.push({ path: p.path, paint: ov![ranks[i]! % ov!.length]! }))
        } else {
          // depth-indexed (depth mode, or split with depth/created order)
          overlaps.forEach((p) => {
            const paint = cfg.overlapSeparate ? ov![(p.depth - 2) % ov!.length]! : fills[(p.depth - 1) % fills.length]!
            colored.push({ path: p.path, paint })
          })
        }
      }
```
(Remove the now-duplicated old `solo.forEach(... colored.push ...)` and `overlaps.forEach(...)` lines so colouring happens exactly once. `soloRanks`/`bandSize` stay above this block.)

- [ ] **Step 3: Tests** — append to `geoshape-boolean.unit.spec.ts`. Reuse the ring helper pattern.
  - `splitFaces` via composite behaviour: a ring where the depth-2 band has ≥3 separate lenses → `crossingMode:'split'` returns MORE shapes than `'depth'`.
```ts
  it('crossingMode split makes each crossing its own piece (more pieces, ≥2 hues)', async () => {
    const count = 7, radius = 150
    const ring = Array.from({ length: count }, (_, i) => { const a = (i / count) * Math.PI * 2; return { x: Math.cos(a) * radius, y: Math.sin(a) * radius, scale: 1, rotate: 0, skew: 0 } })
    const base = { ...DEFAULT_CONFIG, shape: 'hexagon' as const, fillStrategy: 'pieces' as const, fills: ['#f00', '#0f0', '#00f'], overlapSeparate: false, fillOrder: 'rows' as const, symmetry: false, clipMask: 'none' as const }
    const depth = await composite(HEX, ring, { ...base, crossingMode: 'depth' })
    const split = await composite(HEX, ring, { ...base, crossingMode: 'split' })
    expect(split.length).toBeGreaterThan(depth.length)
    // crossings vary in split; in depth all same-depth crossings share one colour
    const splitPaints = new Set(split.map((s) => s.paint))
    expect(splitPaints.size).toBeGreaterThanOrEqual(3)
  })
```
  (Define `HEX` = a hexagon `d` string at the top of the file, or import `baseShapePath` and build it — a regular hexagon radius ~90.)
  - Partition still exact in split mode: reuse the area-partition assertion (sum piece areas ≈ union area, ratio in [0.97, 1.03]) with `crossingMode: 'split'` on the deep-overlap ring.
  - Regression: `crossingMode:'depth'` output equals the pre-change output for an existing pieces test (the depth tests already cover this — confirm they still pass unchanged).

- [ ] **Step 4:** Run `cd frontend && npx vitest run tests/unit/geoshape-boolean.unit.spec.ts` → PASS. Also run the full geoshape suite.
- [ ] **Step 5:** Commit (`boolean.ts` + test): `feat(geoshape): split-crossings mode (per-face overlap colouring)`.

---

### Task 3: Controls — `crossingMode` select

**Files:** Modify `frontend/app/lib/geoshape/controls.ts`; Test `frontend/tests/unit/geoshape-controls.unit.spec.ts`

- [ ] **Step 1:** Add the enum + control. Near the other lists add `export const CROSSING_MODES: GeoCrossingMode[] = ['depth', 'split']` (import `GeoCrossingMode` from config). In `GEO_CONTROLS`, in the Paint section after `overlapSeparate`, add:
```ts
  select('crossingMode', 'Crossings', ['depth', 'split'], DEFAULT_CONFIG.crossingMode, 'Paint',
    'depth = one colour per overlap depth; split = each crossing its own piece, coloured by the colour order', { when: isPieces }),
```

- [ ] **Step 2:** Extend `GEO_GUIDANCE`'s Paint paragraph with one sentence naming `crossingMode` (real key only, camelCase — the guidance drift test extracts camelCase tokens and requires each be a control key).

- [ ] **Step 3:** Test in `geoshape-controls.unit.spec.ts`:
```ts
  it('shows Crossings only for pieces', () => {
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'pieces' }).map(c => c.key)).toContain('crossingMode')
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'perClone' }).map(c => c.key)).not.toContain('crossingMode')
    expect(visibleGeoControls({ ...DEFAULT_CONFIG, fillStrategy: 'single' }).map(c => c.key)).not.toContain('crossingMode')
  })
```

- [ ] **Step 4:** Run `cd frontend && npx vitest run tests/unit/geoshape-controls.unit.spec.ts` → PASS (drift guard now expects `crossingMode` to have a control — it does).
- [ ] **Step 5:** Commit (`controls.ts` + test): `feat(geoshape): Crossings (depth/split) control + guidance`.

---

### Task 4: Live proof + final review

- [ ] **Step 1: Live proof** (`http://127.0.0.1:3000/dev/shape-studio-lab`). 7-hexagon ring, radius so adjacent hexagons overlap, Pieces + Rows + separate off, fills navy/red/amber. Drive config via the ShapeStudioSurface reactive `config` (Vue-instance scan) — set `crossingMode:'depth'` then `'split'`. Pixel-check: the crossing regions carry ONE hue in depth and ≥2 hues in split; solo shapes unchanged. Screenshot both. Broken-control check: revert the `splitFaces` call to `[path]` → the split preview collapses back to the single band; restore.
- [ ] **Step 2:** Full geoshape suite green (config/order/arrange/boolean/paint/render/controls/shapes).
- [ ] **Step 3: Final whole-branch review** (opus) over the Task-1..3 commit range via `scripts/review-package`. Focus: the face-split hole handling (partition stays exact — no spurious hole-pieces), the colouring branch matrix (depth vs split × separate vs not × spatial vs depth order), and that depth-mode output is unchanged. Dispatch ONE fix subagent for any Critical/Important. Update ledger + memory.
