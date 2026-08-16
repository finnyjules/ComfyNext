# Shape Studio per-shape fills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a "Per-shape fill" mode to Shape Studio: a cycled list of `Paint` fills, one per clone (`fills[i % n]`), rendered as separate layered shapes (no even-odd holes in this mode). Default off; unified even-odd mode unchanged.

**Architecture:** `config` gains `perShapeFill: boolean` + `fills: Paint[]`. `boolean.ts`'s `composite` gets a per-shape branch (each clone → its own `GeoVectorShape` with cycled paint; symmetry mirrors inherit paint; clip intersects each). Render (`drawToCanvas`/`toSvg`) already handles N per-clone paints (from the fill system) — no change. UI gets a toggle + a fills-list editor mirroring `SpaceTypeSurface`'s structure with `FillControl` per entry.

## Global Constraints

- `config.ts` stays dependency-light: `Paint` is a type-only import; local validators only.
- Default `perShapeFill: false` and default single `fill` unchanged → the default mark is byte-identical.
- paper scope discipline: the per-shape branch runs inside the existing `try` whose `finally` calls `sc.project.clear()`; convert paper→commands BEFORE returning (same as the existing return).
- Run tests from `frontend/`: `npx vitest run <path>`.

## Files

- `frontend/app/lib/geoshape/config.ts` — perShapeFill + fills + validator (Task 1)
- `frontend/app/lib/geoshape/boolean.ts` — per-shape composite branch (Task 2)
- `frontend/app/lib/geoshape/controls.ts` — perShapeFill control + drift exclusion (Task 3)
- `frontend/app/components/vue-canvas/ShapeStudioSurface.vue` — toggle + fills list editor (Task 3)

---

### Task 1: Config — `perShapeFill` + `fills`

**Files:** Modify `config.ts`; Test `geoshape-config.unit.spec.ts` (extend).

- [ ] **Step 1: Failing test**

```ts
it('perShapeFill + fills round-trip; junk/empty fills → default non-empty', () => {
  const cfg = mergeConfig({ ...DEFAULT_CONFIG, perShapeFill: true, fills: ['#f00', { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#0f0' }, { offset: 1, color: '#00f' }] }] })
  expect(cfg.perShapeFill).toBe(true)
  expect(cfg.fills).toHaveLength(2)
  expect(cfg.fills[0]).toBe('#f00')
  // junk/empty → falls back to the default non-empty list
  expect(mergeConfig({ ...DEFAULT_CONFIG, fills: [] }).fills).toEqual(DEFAULT_CONFIG.fills)
  expect(mergeConfig({ ...DEFAULT_CONFIG, fills: 'nope' }).fills).toEqual(DEFAULT_CONFIG.fills)
  expect(mergeConfig({ ...DEFAULT_CONFIG, fills: [42, { type: 'bogus' }] }).fills).toEqual(DEFAULT_CONFIG.fills) // all entries invalid → default
})
```

- [ ] **Step 2:** Run → fail.

- [ ] **Step 3: Implement** in `config.ts`:
  - Interface: add `perShapeFill: boolean` and `fills: Paint[]`.
  - `DEFAULT_CONFIG`: `perShapeFill: false`, `fills: ['#1a1a2e', '#e5484d', '#f5a623']` (a pleasant 3-colour default; never shown unless the mode is on).
  - `mergeConfig`: `perShapeFill: bool(o.perShapeFill, d.perShapeFill)`, and a `fills` validator:
    ```ts
    function paintList(v: unknown, d: Paint[]): Paint[] {
      if (!Array.isArray(v)) return d.map((p) => (typeof p === 'string' ? p : JSON.parse(JSON.stringify(p))))
      const out: Paint[] = []
      for (const e of v) { const p = paint(e, null as any); if (p !== null) out.push(p) }
      return out.length ? out : d.map((p) => (typeof p === 'string' ? p : JSON.parse(JSON.stringify(p))))
    }
    ```
    But `paint(v, d)` returns `d` (not null) for junk — so add a sentinel: write a small `paintOrNull(v): Paint | null` that returns the string / validated object / `null`, and use it here; keep the existing `paint(v,d)` for the single-fill fields. In `mergeConfig`: `fills: paintList(o.fills, d.fills)`.

- [ ] **Step 4:** Run → pass (config + downstream geoshape suites). **Step 5: Commit** `feat(geoshape): perShapeFill + fills list config`.

---

### Task 2: Composite — per-shape branch

**Files:** Modify `boolean.ts`; Test `geoshape-boolean.unit.spec.ts` + `geoshape-render.unit.spec.ts`.

- [ ] **Step 1: Failing test** (boolean):

```ts
it('perShapeFill: one shape per clone, cycling fills', async () => {
  const placements = [
    { x: -60, y: 0, scale: 1, rotate: 0, skew: 0 },
    { x: 0, y: 0, scale: 1, rotate: 0, skew: 0 },
    { x: 60, y: 0, scale: 1, rotate: 0, skew: 0 },
  ]
  const shapes = await composite(SQUARE, placements, { ...DEFAULT_CONFIG, perShapeFill: true, fills: ['#ff0000', '#00ff00'], symmetry: false, clipMask: 'none' })
  expect(shapes).toHaveLength(3)
  expect(shapes.map(s => s.paint)).toEqual(['#ff0000', '#00ff00', '#ff0000']) // cycle
  for (const s of shapes) expect(s.fillRule).toBe('nonzero')
})
it('perShapeFill symmetry mirrors clones AND inherits their paint', async () => {
  const placements = [{ x: -40, y: 0, scale: 1, rotate: 0, skew: 0 }, { x: 40, y: 0, scale: 1, rotate: 0, skew: 0 }]
  const shapes = await composite(SQUARE, placements, { ...DEFAULT_CONFIG, perShapeFill: true, fills: ['#f00', '#0f0'], symmetry: true, clipMask: 'none' })
  expect(shapes).toHaveLength(4) // 2 originals + 2 mirrors
  expect(shapes.map(s => s.paint)).toEqual(['#f00', '#0f0', '#f00', '#0f0']) // mirror inherits source paint
})
it('unified mode (perShapeFill off) is unchanged — evenodd hole still there', async () => {
  const shapes = await composite(SQUARE, [{ x: -20, y: 0, scale: 1, rotate: 0, skew: 0 }, { x: 20, y: 0, scale: 1, rotate: 0, skew: 0 }], { ...DEFAULT_CONFIG, perShapeFill: false })
  expect(shapes[0]!.fillRule).toBe('evenodd')
})
```

- [ ] **Step 2:** Run → fail.

- [ ] **Step 3: Implement** — in `composite` (`boolean.ts`), immediately after `if (!clones.length) return []` (currently ~line 87) and BEFORE `const isEvenOdd`, insert:

```ts
// PER-SHAPE FILL: each clone is its own filled shape cycling through cfg.fills.
// No boolean fold and no even-odd holes (those need the unified single-path
// fold); clones simply layer. Symmetry mirrors each clone inheriting its paint;
// clip intersects each clone.
if (cfg.perShapeFill) {
  const fills = cfg.fills.length ? cfg.fills : [cfg.fill]
  let items: { path: paper.PathItem; pi: number }[] = clones.map((c, i) => ({ path: c as paper.PathItem, pi: i % fills.length }))
  if (cfg.symmetry) {
    const sm = new sc.Matrix()
    if (cfg.symmetryAxis === 'vertical') sm.scale(-1, 1); else sm.scale(1, -1)
    sm.translate(cfg.symmetryAxis === 'vertical' ? cfg.symmetrySpacing : 0, cfg.symmetryAxis === 'horizontal' ? cfg.symmetrySpacing : 0)
    const mirrored = items.map(({ path, pi }) => { const mc = path.clone(); mc.transform(sm); return { path: mc as paper.PathItem, pi } })
    items = items.concat(mirrored)
  }
  if (cfg.clipMask !== 'none') {
    const r = cfg.clipMaskSize
    const clip = cfg.clipMask === 'circle'
      ? new sc.Path.Circle(new sc.Point(0, 0), r)
      : cfg.clipMask === 'square'
        ? new sc.Path.Rectangle(new sc.Rectangle(-r, -r, 2 * r, 2 * r))
        : new sc.CompoundPath(hexClipD(r))
    items = items.map(({ path, pi }) => ({ path: (path as any).intersect(clip) as paper.PathItem, pi }))
    clip.remove()
  }
  return items
    .filter(({ path }) => path && path.bounds && path.bounds.width > 1e-6 && path.bounds.height > 1e-6)
    .map(({ path, pi }) => ({
      commands: paperToCommands(path),
      paint: fills[pi]!,
      fill: solidOf(fills[pi]!),
      stroke: cfg.stroke,
      strokeWidth: cfg.strokeWidth || undefined,
      fillRule: 'nonzero' as const,
    }))
}
```

- [ ] **Step 4: Render test** (`geoshape-render.unit.spec.ts`): `toSvg({ ...DEFAULT_CONFIG, perShapeFill: true, fills: ['#ff0000', '#0000ff'], count: 4 })` → contains both `#ff0000` and `#0000ff` and ≥3 `<path`.

- [ ] **Step 5:** Run all → pass. **Step 6: Commit** `feat(geoshape): per-shape composite branch (cycled fills, layered clones)`.

---

### Task 3: UI — toggle + fills list editor

**Files:** Modify `controls.ts`, `ShapeStudioSurface.vue`.

- [ ] **Step 1: `controls.ts`** — add `switchC('perShapeFill', 'Per-shape fill', DEFAULT_CONFIG.perShapeFill, 'Paint')`. EXCLUDE `fills` from the drift-guard key set: find how `locks` is excluded in `geoshape-controls.unit.spec.ts`'s drift test (and/or a `NON_CONTROL_KEYS`-style set) and add `fills` alongside `locks`. Keep the single `fill`/`overlapFill` controls (unified mode + agent).

- [ ] **Step 2: `ShapeStudioSurface.vue`** — in the Paint section:
  - Add a `StudioSwitch` bound to `config.perShapeFill` (via `setGeoControl('perShapeFill', $event)`).
  - Wrap the existing single `#control-fill` (+ overlapFill) FillControls in `v-if="!config.perShapeFill"`.
  - Add, `v-if="config.perShapeFill"`, a **fills list editor** mirroring `SpaceTypeSurface.vue`'s fills block STRUCTURE (read it: the reactive mirror + `addFill`/`removeFill` keep-≥1 + `dragStart`/`dragOver`/`drop` reorder), but with **`FillControl` per entry**:
    - A reactive `fills` mirror synced with `config.fills` (a `watch(() => config.value.fills, …)` to pull, and a deep `watch(fillsMirror, () => setGeoControl('fills', [...fillsMirror]))` to push — OR simpler: operate directly on `config.value.fills` with array ops + reassign to trigger the render watcher; pick whichever integrates cleanly with the existing debounced/rAF render).
    - `v-for="(f, i) in fills"`: an index badge, a `<FillControl allow-image :model-value="f" @update:model-value="updateFill(i, $event)" />`, a remove button (`v-if="fills.length > 1"`), and a drag grip for reorder.
    - A "+ Add fill" button (`addFill` pushes a solid default like `'#4c6ef5'`); helper text "Clones cycle through these fills, top to bottom."
  - Ensure every list mutation writes back so the render re-runs (the array identity change or `setGeoControl('fills', …)`).

- [ ] **Step 3: Verify (no browser):** `npx vue-tsc --noEmit -p . 2>&1 | grep -iE "ShapeStudioSurface|geoshape" | head` — no new errors. `npx vitest run tests/unit/geoshape-controls.unit.spec.ts tests/unit/geoshape-config.unit.spec.ts` — pass (drift guard green with `fills` excluded + `perShapeFill` control present).
- [ ] **Step 4: Commit** `feat(shape-studio): per-shape fill toggle + fills list editor`.

---

### Task 4: Live render-proof + final review

- [ ] **Step 1: Live (Browser pane, 127.0.0.1:3000).** Open the studio; toggle **Per-shape fill** on; confirm the fills list editor appears with 3 entries; set 3 vivid colors. Confirm the clones render in **cycling colors** and the negative-space holes are **gone** (expected). Objective: `javascript_tool` samples the canvas over the mark and asserts **≥3 distinct hues**. Toggle off → holes return, single fill. Screenshot both.
- [ ] **Step 2:** Fix anything off; re-verify.
- [ ] **Step 3:** `npx vitest run tests/unit/geoshape-*.unit.spec.ts` green; request the whole-branch review (superpowers:requesting-code-review) over the per-shape commits.

## Self-Review

- Coverage: config (T1) · composite per-shape branch incl. symmetry/clip (T2) · toggle + list editor + drift exclusion (T3) · live proof + review (T4). All spec sections mapped.
- Placeholders: T1 flags the `paint`-vs-`paintOrNull` sentinel need (a real code detail, not a TODO); T3 flags "read SpaceTypeSurface's fills block for the reactive-mirror structure" (a verification instruction against a named file).
- Types: `perShapeFill`/`fills` referenced identically across T1–T3; the per-shape branch returns `GeoVectorShape[]` (same as the unified path); `fills[pi]` cycle + symmetry-inherit tested in T2.
