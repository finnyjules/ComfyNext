# Shape Studio → 2D-vector geologo generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repurpose the `shape-studio` node from a 3D gem generator into a flat 2D-vector clone-and-arrange logo generator (base shape → clone → arrange → boolean composite with hole-or-new-shape overlaps → symmetry → clip → SVG/PNG).

**Architecture:** New `frontend/app/lib/geoshape/` module. Geometry stays in paper.js path space end-to-end: base shapes are SVG `d` strings; cloning/arrangement/symmetry/clip are paper `Matrix` transforms + boolean ops; the result converts to `VectorShape[]` for `shapesToSVG` (export) and `Path2D` (live canvas preview + PNG bake). The `shape-studio` node identity, persistence key `sailor_shapeStudio`, and cascade-baker contract are unchanged; only the engine behind them changes.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, paper.js (`paper@^0.12.18`, already a dep), Vitest, the Browser pane for render-proof.

## Global Constraints

- **paper.js scope discipline:** all paper work goes through the shared `paperScope()` (from `~/composables/useVectorSvg`); call `sc.project.clear()` after each composite so scopes don't leak between renders (the codebase already does this — see `pathLayerBoolean`).
- **Reuse, don't reinvent:** base shapes from `~/lib/compositor/polygonGeometry` (`polygonPathData`/`starPathData`/`polygonVertices`/`starVertices`); SVG output from `~/lib/vector/svg` (`shapesToSVG`, `VectorShape`, `VectorPaint`); studio scaffolding from `StudioModalShell` / `studio/StudioControlPanel` / `~/lib/studio/autosave` / `~/composables/useStudioAgent`; node + cascade from `ShapeStudioNode.vue` + `~/lib/studio/cascade`.
- **Clean break:** old 3D-gem configs won't load. `mergeConfig` must default every field so a stray old `sailor_shapeStudio` blob degrades to a valid default config rather than throwing.
- **Overlap option (explicit user requirement):** the boolean stage must support `overlapMode: 'hole' | 'shape'` — overlaps are either even-odd negative space (hole) OR extracted as their own separately-filled shape.
- **Render-proof rule:** a render succeeding is not evidence it's correct. Assert real signal (SVG contains `fill-rule="evenodd"` + expected subpath count; rasterized canvas is non-blank AND has interior negative space) — never just "it didn't throw".
- **Run unit tests from `frontend/`:** `npx vitest run <path>`.

## File structure

- `frontend/app/lib/geoshape/shapes.ts` — base shape `d` strings (+ irregular jitter). Task 1.
- `frontend/app/lib/geoshape/config.ts` — `GeoShapeConfig`, `DEFAULT_CONFIG`, `mergeConfig`. Task 2.
- `frontend/app/lib/geoshape/arrange.ts` — clone placements (`ClonePlacement[]`). Task 3.
- `frontend/app/lib/geoshape/boolean.ts` — paper composite (fillMode, overlapMode, symmetry, clip) → `VectorShape[]`. Task 4.
- `frontend/app/lib/geoshape/paint.ts` — config paint → `VectorPaint`. Task 5.
- `frontend/app/lib/geoshape/render.ts` — orchestration → `VectorShape[]` + `toSvg` + `toCanvas`. Task 6.
- `frontend/app/lib/geoshape/controls.ts` + `agentControls.ts` + `randomize.ts` — Task 7.
- `frontend/app/components/vue-canvas/ShapeStudioSurface.vue` — rewrite to 2D. Task 8.
- `frontend/app/components/vue-canvas/ShapeStudioNode.vue` + retire `lib/shapefx/` engine — Task 9.

---

### Task 1: Base shapes (`geoshape/shapes.ts`)

**Files:** Create `frontend/app/lib/geoshape/shapes.ts`; Test `frontend/tests/unit/geoshape-shapes.unit.spec.ts`.

**Interfaces:**
- Produces: `type BaseShapeKind = 'polygon' | 'star' | 'hexagon' | 'irregular'`; `baseShapePath(kind, opts: { sides: number; starInner: number; irregularSeed: number; size: number; roundCorners: number; roundRadius: number }): string` — returns one SVG `d` string, centered on the origin.

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/unit/geoshape-shapes.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { baseShapePath } from '~/lib/geoshape/shapes'

const base = { sides: 6, starInner: 0.45, irregularSeed: 1, size: 180, roundCorners: 6, roundRadius: 0 }

describe('geoshape base shapes', () => {
  it('polygon/hexagon/star produce a closed path d', () => {
    for (const kind of ['polygon', 'hexagon', 'star'] as const) {
      const d = baseShapePath(kind, base)
      expect(d).toMatch(/^M/)
      expect(d.trim().endsWith('Z')).toBe(true)
    }
  })
  it('hexagon equals a 6-sided polygon', () => {
    expect(baseShapePath('hexagon', base)).toBe(baseShapePath('polygon', { ...base, sides: 6 }))
  })
  it('irregular is deterministic in its seed and differs across seeds', () => {
    expect(baseShapePath('irregular', base)).toBe(baseShapePath('irregular', base))
    expect(baseShapePath('irregular', base)).not.toBe(baseShapePath('irregular', { ...base, irregularSeed: 2 }))
  })
})
```

- [ ] **Step 2: Run → fail** `cd frontend && npx vitest run tests/unit/geoshape-shapes.unit.spec.ts` (module missing).

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/geoshape/shapes.ts
import { polygonVertices, starVertices, roundedPolygonPath, type Pt } from '~/lib/compositor/polygonGeometry'

export type BaseShapeKind = 'polygon' | 'star' | 'hexagon' | 'irregular'

export interface BaseShapeOpts {
  sides: number; starInner: number; irregularSeed: number
  size: number; roundCorners: number; roundRadius: number
}

// Small seeded RNG (mulberry32 over an xmur3 hash) — self-contained.
function rng(seed: number): () => number {
  const s = `geo|${seed}`
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909)
  let a = (h ^= h >>> 16) >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function irregularVertices(sides: number, size: number, seed: number): Pt[] {
  const base = polygonVertices(sides, size, size)
  const r = rng(seed)
  // jitter each vertex radially by ±30% of size/2
  return base.map((p) => { const k = 0.7 + r() * 0.6; return { x: p.x * k, y: p.y * k } })
}

/** One SVG `d` (centered on origin) for the chosen base shape. `roundCorners`
 *  gates rounding (0 = off) and `roundRadius`/100 is the corner-radius fraction. */
export function baseShapePath(kind: BaseShapeKind, o: BaseShapeOpts): string {
  const cr = o.roundCorners > 0 ? Math.max(0, Math.min(1, o.roundRadius / 100)) : 0
  switch (kind) {
    case 'polygon':   return roundedPolygonPath(polygonVertices(o.sides, o.size, o.size), cr)
    case 'hexagon':   return roundedPolygonPath(polygonVertices(6, o.size, o.size), cr)
    case 'star':      return roundedPolygonPath(starVertices(o.sides, o.starInner, o.size, o.size), cr)
    case 'irregular': return roundedPolygonPath(irregularVertices(o.sides, o.size, o.irregularSeed), cr)
  }
}
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `git add frontend/app/lib/geoshape/shapes.ts frontend/tests/unit/geoshape-shapes.unit.spec.ts && git commit -m "feat(geoshape): base shape path generation"`

---

### Task 2: Config + mergeConfig (`geoshape/config.ts`)

**Files:** Create `frontend/app/lib/geoshape/config.ts`; Test `frontend/tests/unit/geoshape-config.unit.spec.ts`.

**Interfaces:**
- Produces: `GeoShapeConfig` (all geologo params), `DEFAULT_CONFIG`, `mergeConfig(raw: unknown): GeoShapeConfig`. Paint fields typed as `VectorPaint` from `~/lib/vector/svg`.

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/unit/geoshape-config.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '~/lib/geoshape/config'

describe('geoshape config', () => {
  it('mergeConfig on junk returns defaults', () => {
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(mergeConfig({ count: 'nope', layout: 'bogus' }).count).toBe(DEFAULT_CONFIG.count)
    expect(mergeConfig({ layout: 'bogus' }).layout).toBe(DEFAULT_CONFIG.layout)
  })
  it('round-trips a full config', () => {
    const cfg = { ...DEFAULT_CONFIG, count: 8, layout: 'grid' as const, overlapMode: 'shape' as const, seed: 42 }
    expect(mergeConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg)
  })
  it('defaults overlapMode to hole (geologo default)', () => {
    expect(DEFAULT_CONFIG.overlapMode).toBe('hole')
  })
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.** Define `GeoShapeConfig` with fields: `shape: BaseShapeKind`, `sides`, `starInner`, `irregularSeed`, `size`, `count`, `layout: 'radial'|'grid'|'linear'`, `radius`, `spacing`, `angleStep`, `rotateBase`, `rotateStep`, `scaleStart`, `scaleEnd`, `skew`, `spin`, `fillMode: 'evenodd'|'unite'|'subtract'|'intersect'|'exclude'`, `overlapMode: 'hole'|'shape'`, `roundCorners`, `roundRadius`, `symmetry: boolean`, `symmetryAxis: 'vertical'|'horizontal'`, `symmetrySpacing`, `clipMask: 'none'|'circle'|'square'|'hexagon'`, `clipMaskSize`, `invert: boolean`, `padding`, `strokeWidth`, `seed`, `fill: VectorPaint`, `stroke: string | null`, `overlapFill: VectorPaint` (used when overlapMode='shape'), plus `gridCols`, `gridRows` for grid layout, and `locks: Record<string, boolean>`. Provide `DEFAULT_CONFIG` matching the geologo reference (`shape:'hexagon', count:6, layout:'radial', radius:180, spacing:220, size:180, fillMode:'evenodd', overlapMode:'hole', strokeWidth:8, seed:1, fill:'#111111', stroke:null, ...`). Write `mergeConfig` with per-field validators (`num`, `str`, `oneOf`, `bool`, and a `paint` validator that accepts a string or a well-formed gradient/pattern object else falls back). Model the validator style on `frontend/app/lib/shapefx/config.ts`'s `mergeConfig` (read it for the pattern). No `three` import.

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(geoshape): config schema + defensive mergeConfig`.

---

### Task 3: Arrange (`geoshape/arrange.ts`)

**Files:** Create `frontend/app/lib/geoshape/arrange.ts`; Test `frontend/tests/unit/geoshape-arrange.unit.spec.ts`.

**Interfaces:**
- Consumes: `GeoShapeConfig` (Task 2).
- Produces: `interface ClonePlacement { x: number; y: number; scale: number; rotate: number; skew: number }`; `arrange(cfg: GeoShapeConfig): ClonePlacement[]` — one placement per clone, in output units, ready to become a paper `Matrix`.

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/unit/geoshape-arrange.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { arrange } from '~/lib/geoshape/arrange'
import { DEFAULT_CONFIG } from '~/lib/geoshape/config'

describe('geoshape arrange', () => {
  it('radial places `count` clones on a circle of `radius`', () => {
    const p = arrange({ ...DEFAULT_CONFIG, layout: 'radial', count: 6, radius: 100, rotateStep: 0, scaleStart: 1, scaleEnd: 1 })
    expect(p).toHaveLength(6)
    for (const c of p) expect(Math.hypot(c.x, c.y)).toBeCloseTo(100, 1)
  })
  it('scaleStart→scaleEnd interpolates across clones', () => {
    const p = arrange({ ...DEFAULT_CONFIG, count: 5, scaleStart: 1, scaleEnd: 2 })
    expect(p[0]!.scale).toBeCloseTo(1, 3)
    expect(p[4]!.scale).toBeCloseTo(2, 3)
  })
  it('rotateStep accumulates linearly', () => {
    const p = arrange({ ...DEFAULT_CONFIG, count: 4, rotateBase: 10, rotateStep: 5 })
    expect(p[0]!.rotate).toBeCloseTo(10, 3)
    expect(p[3]!.rotate).toBeCloseTo(25, 3)
  })
  it('grid places cols*rows clones', () => {
    const p = arrange({ ...DEFAULT_CONFIG, layout: 'grid', gridCols: 3, gridRows: 2 })
    expect(p).toHaveLength(6)
  })
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.** For `radial`: clone `i` sits at angle `spin + i*angleStep` (degrees) on radius `radius`, `x=radius*cos, y=radius*sin`; `rotate = rotateBase + i*rotateStep`; `scale = lerp(scaleStart, scaleEnd, i/(count-1))`; `skew` constant. For `linear`: `x = (i-(count-1)/2)*spacing`, `y=0`. For `grid`: iterate `gridCols*gridRows`, `x=(cx-(cols-1)/2)*spacing`, `y=(cy-(rows-1)/2)*spacing`, ramps indexed by flat i. Guard `count>=1`; `i/(count-1)` uses `count>1?…:0`.

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(geoshape): clone arrangement (radial/grid/linear + ramps)`.

---

### Task 4: Boolean composite (`geoshape/boolean.ts`) — the core

**Files:** Create `frontend/app/lib/geoshape/boolean.ts`; Modify `frontend/app/lib/vectortype/extrudeSolid.ts` (export its `paperToCommands`); Test `frontend/tests/unit/geoshape-boolean.unit.spec.ts`.

**Interfaces:**
- Consumes: base `d` string (Task 1), `ClonePlacement[]` (Task 3), `GeoShapeConfig` (Task 2), `paperToCommands` (from extrudeSolid).
- Produces: `async composite(baseD: string, placements: ClonePlacement[], cfg: GeoShapeConfig): Promise<VectorShape[]>` — one shape for `hole` mode; a base shape + an overlap shape for `shape` mode. Applies fillMode fold, then symmetry, then clip.

- [ ] **Step 1: Export `paperToCommands`** — in `extrudeSolid.ts`, change `function paperToCommands` to `export function paperToCommands`. (Read it first to confirm the name/signature: `paperToCommands(item: paper.PathItem): VectorCommand[]`.)

- [ ] **Step 2: Failing test**

```ts
// frontend/tests/unit/geoshape-boolean.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { composite } from '~/lib/geoshape/boolean'
import { DEFAULT_CONFIG } from '~/lib/geoshape/config'
import { shapesToSVG } from '~/lib/vector/svg'

// two overlapping squares as the base+placement stand-in
const SQUARE = 'M -50 -50 L 50 -50 L 50 50 L -50 50 Z'
const twoOverlap = [
  { x: -20, y: 0, scale: 1, rotate: 0, skew: 0 },
  { x: 20, y: 0, scale: 1, rotate: 0, skew: 0 },
]

describe('geoshape boolean composite', () => {
  it('evenodd hole: overlap becomes negative space (multiple subpaths, evenodd)', async () => {
    const shapes = await composite(SQUARE, twoOverlap, { ...DEFAULT_CONFIG, fillMode: 'evenodd', overlapMode: 'hole', symmetry: false, clipMask: 'none' })
    expect(shapes.length).toBeGreaterThanOrEqual(1)
    const svg = shapesToSVG(shapes)
    expect(svg).toContain('fill-rule="evenodd"')
    // an even-odd union of two overlapping squares has an interior hole → >1 subpath (M appears ≥2×)
    const ms = (shapes[0]!.commands.filter(c => c.command === 'moveTo')).length
    expect(ms).toBeGreaterThanOrEqual(2)
  })
  it('overlapMode shape: the intersection is emitted as a separate filled shape', async () => {
    const shapes = await composite(SQUARE, twoOverlap, { ...DEFAULT_CONFIG, overlapMode: 'shape', overlapFill: '#ff0000', symmetry: false, clipMask: 'none' })
    // base + overlap = 2 shapes; the overlap shape carries overlapFill
    expect(shapes.length).toBe(2)
    expect(shapes[1]!.fill).toBe('#ff0000')
    // the overlap region is non-empty (has commands)
    expect(shapes[1]!.commands.length).toBeGreaterThan(0)
  })
  it('clip removes geometry outside the clip shape', async () => {
    const wide = [{ x: -200, y: 0, scale: 1, rotate: 0, skew: 0 }, { x: 200, y: 0, scale: 1, rotate: 0, skew: 0 }]
    const clipped = await composite(SQUARE, wide, { ...DEFAULT_CONFIG, overlapMode: 'hole', clipMask: 'circle', clipMaskSize: 60 })
    // clipping to a small circle drops the far-apart squares' outer extent
    const unclipped = await composite(SQUARE, wide, { ...DEFAULT_CONFIG, overlapMode: 'hole', clipMask: 'none' })
    const bbox = (s: any[]) => s.flatMap(x => x.commands).flatMap((c: any) => c.args).filter((_: any, i: number) => i % 2 === 0)
    expect(Math.max(...bbox(clipped).map(Math.abs))).toBeLessThan(Math.max(...bbox(unclipped).map(Math.abs)))
  })
})
```

- [ ] **Step 3: Implement `composite`** using the `pathLayerBoolean` paper pattern (read `useVectorSvg.ts:412-467` for reference):

```ts
// frontend/app/lib/geoshape/boolean.ts
import { paperScope } from '~/composables/useVectorSvg'
import { paperToCommands } from '~/lib/vectortype/extrudeSolid'
import type { VectorShape } from '~/lib/vector/svg'
import type { GeoShapeConfig } from './config'
import type { ClonePlacement } from './arrange'

const OP: Record<GeoShapeConfig['fillMode'], 'unite'|'subtract'|'intersect'|'exclude'> = {
  evenodd: 'unite', // evenodd is a fill-rule, not an op — we unite geometry and set windingRule
  unite: 'unite', subtract: 'subtract', intersect: 'intersect', exclude: 'exclude',
}

export async function composite(baseD: string, placements: ClonePlacement[], cfg: GeoShapeConfig): Promise<VectorShape[]> {
  const sc = await paperScope()
  try {
    // 1. build a transformed paper path per placement
    const clones = placements.map((pl) => {
      const p = new sc.CompoundPath(baseD)
      const m = new sc.Matrix()
      m.translate(pl.x, pl.y)
      m.rotate(pl.rotate, new sc.Point(0, 0))
      if (pl.skew) m.shear(Math.tan((pl.skew * Math.PI) / 180), 0)
      m.scale(pl.scale)
      p.transform(m)
      return p
    })
    if (!clones.length) { sc.project.clear(); return [] }

    // 2. fold with the fillMode op (or unite for evenodd)
    let acc: any = clones[0]
    for (let i = 1; i < clones.length; i++) { const c = acc[OP[cfg.fillMode]](clones[i]); acc = c }

    // 3. overlap-as-shape: the region covered by >=2 clones = union of pairwise intersections
    let overlap: any = null
    if (cfg.overlapMode === 'shape' && clones.length >= 2) {
      for (let i = 0; i < clones.length; i++) for (let j = i + 1; j < clones.length; j++) {
        const inter = clones[i].intersect(clones[j])
        if (inter && inter.bounds && inter.bounds.width > 1e-6) overlap = overlap ? overlap.unite(inter) : inter
      }
    }

    // 4. symmetry mirror
    const mirror = (item: any) => {
      const m = new sc.Matrix()
      if (cfg.symmetryAxis === 'vertical') m.scale(-1, 1); else m.scale(1, -1)
      m.translate(cfg.symmetryAxis === 'vertical' ? cfg.symmetrySpacing : 0, cfg.symmetryAxis === 'horizontal' ? cfg.symmetrySpacing : 0)
      const mi = item.clone(); mi.transform(m); const u = item.unite(mi); return u
    }
    if (cfg.symmetry) { acc = mirror(acc); if (overlap) overlap = mirror(overlap) }

    // 5. clip mask (paper intersect with a clip shape)
    if (cfg.clipMask !== 'none') {
      const r = cfg.clipMaskSize
      const clip = cfg.clipMask === 'circle'
        ? new sc.Path.Circle(new sc.Point(0, 0), r)
        : cfg.clipMask === 'square'
          ? new sc.Path.Rectangle(new sc.Rectangle(-r, -r, 2 * r, 2 * r))
          : new sc.CompoundPath(hexClipD(r))
      acc = acc.intersect(clip); if (overlap) overlap = overlap.intersect(clip)
    }

    // 6. paper → VectorShape[]. evenodd sets the fill-rule; shape mode adds the overlap shape on top.
    const fillRule = cfg.fillMode === 'evenodd' ? 'evenodd' : 'nonzero'
    const out: VectorShape[] = [{
      commands: paperToCommands(acc),
      fill: cfg.fill, stroke: cfg.stroke ?? undefined, strokeWidth: cfg.strokeWidth || undefined,
      fillRule,
    }]
    if (overlap) out.push({ commands: paperToCommands(overlap), fill: cfg.overlapFill, fillRule: 'nonzero' })
    return out
  } finally {
    sc.project.clear()
  }
}

function hexClipD(r: number): string {
  let d = ''
  for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 3; const x = r * Math.cos(a), y = r * Math.sin(a); d += (i === 0 ? 'M' : 'L') + ` ${x} ${y}` }
  return d + ' Z'
}
```

Note the `evenodd` mapping: paper's boolean `unite` produces a `nonzero`-wound union, so to get the geologo even-odd holes we set `fillRule='evenodd'` on the emitted shape while uniting geometry — the serializer + canvas then apply even-odd winding, which is what carves the negative space. Confirm against the test (`ms >= 2` and `fill-rule="evenodd"`); if uniting collapses the holes, fall back to appending clones as CompoundPath children (one path, no boolean) with `fillRule='evenodd'` — adjust in Step 4 based on the test outcome.

- [ ] **Step 4: Run → iterate to pass** `cd frontend && npx vitest run tests/unit/geoshape-boolean.unit.spec.ts`. paper.js runs headless in Vitest (jsdom); if it needs a canvas, `paperScope()` already handles setup. If the evenodd hole test fails because `unite` flattened the holes, switch the evenodd branch to build ONE `CompoundPath` whose children are the raw clones (no fold) and set `windingRule='evenodd'` — that preserves per-clone subpaths so even-odd carves holes.

- [ ] **Step 5: Commit** `feat(geoshape): paper boolean composite with hole/new-shape overlaps, symmetry, clip`.

---

### Task 5: Paint (`geoshape/paint.ts`)

**Files:** Create `frontend/app/lib/geoshape/paint.ts`; Test `frontend/tests/unit/geoshape-paint.unit.spec.ts`.

**Interfaces:** Produces `resolvePaint(cfg): { fill: VectorPaint; stroke: string | null; overlapFill: VectorPaint }` — normalizes the config's paint fields (solid string / gradient / pattern) into `VectorPaint` values the composite consumes, applying `invert` (swap fill/background sense) if set.

- [ ] **Step 1: Test** — assert a solid fill passes through, a gradient object passes through as a `VectorGradient`, and `invert:true` swaps fill↔stroke-or-background per the geologo `invert` semantics. **Step 2: fail. Step 3: implement (thin — mostly validation + invert). Step 4: pass. Step 5: commit** `feat(geoshape): paint resolution`.

(If Task 2's `mergeConfig` already validates paint fully, this task is just the `invert` transform + a pass-through — keep it small.)

---

### Task 6: Render orchestration (`geoshape/render.ts`)

**Files:** Create `frontend/app/lib/geoshape/render.ts`; Test `frontend/tests/unit/geoshape-render.unit.spec.ts`.

**Interfaces:**
- Consumes: everything above.
- Produces: `async renderShapes(cfg: GeoShapeConfig): Promise<VectorShape[]>`; `async toSvg(cfg, opts?): Promise<string>` (via `shapesToSVG`); `drawToCanvas(shapes: VectorShape[], ctx: CanvasRenderingContext2D, w: number, h: number): void` (Path2D fill with even-odd; used by preview + bake).

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/unit/geoshape-render.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { renderShapes, toSvg } from '~/lib/geoshape/render'
import { DEFAULT_CONFIG } from '~/lib/geoshape/config'

describe('geoshape render', () => {
  it('produces shapes and an evenodd SVG for the default (geologo) config', async () => {
    const shapes = await renderShapes(DEFAULT_CONFIG)
    expect(shapes.length).toBeGreaterThanOrEqual(1)
    const svg = await toSvg(DEFAULT_CONFIG)
    expect(svg).toContain('<svg')
    expect(svg).toContain('fill-rule="evenodd"')
  })
  it('overlapMode shape yields an extra filled shape vs hole', async () => {
    const hole = await renderShapes({ ...DEFAULT_CONFIG, overlapMode: 'hole' })
    const shape = await renderShapes({ ...DEFAULT_CONFIG, overlapMode: 'shape' })
    expect(shape.length).toBeGreaterThan(hole.length)
  })
})
```

- [ ] **Step 2: fail. Step 3: implement** — `renderShapes` = `baseShapePath(cfg.shape, …)` → `arrange(cfg)` → `composite(baseD, placements, cfg)` → apply `resolvePaint`. `toSvg` wraps `shapesToSVG(shapes, { width, height })` sized to `size + padding`. `drawToCanvas` builds a `Path2D(commandsToPathData(s.commands))` per shape and `ctx.fill(path, s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')`. **Step 4: pass. Step 5: commit** `feat(geoshape): render orchestration (shapes + SVG + canvas)`.

- [ ] **Step 6: Render-proof (add to the same spec, browser-independent).** Render the default config to a node-canvas or asserted VectorShape geometry: assert the SVG's `<path` count matches expectation for `hole` (1) vs `shape` (2), and that the composite bbox is non-degenerate (width & height > 0). (The full pixel/negative-space proof happens live in Task 8.)

---

### Task 7: Controls + agent + randomize

**Files:** Create `frontend/app/lib/geoshape/controls.ts`, `agentControls.ts`, `randomize.ts`; Test `frontend/tests/unit/geoshape-controls.unit.spec.ts`.

**Interfaces:** `GEO_CONTROLS` (array consumed by `StudioControlPanel`), `GEO_SECTIONS`; `geoAgentControls`; `reroll(cfg, locks)`. Model the schema shape on `frontend/app/lib/shapefx/controls.ts` (`SHAPE_CONTROLS`/`SHAPE_SECTIONS`/`ShapeControl` with `when?`) — read it as the template.

- [ ] **Step 1: Test** — assert every `GeoShapeConfig` key that should be user-facing has a control in `GEO_CONTROLS` (drift guard: iterate expected keys), sections are non-empty, and `reroll` is deterministic in a passed seed and honors `locks` (a locked section's values are unchanged). **Steps 2-5** as usual. Commit `feat(geoshape): control schema + agent vocab + randomize`.

---

### Task 8: Surface — rewrite `ShapeStudioSurface.vue` to 2D

**Files:** Modify `frontend/app/components/vue-canvas/ShapeStudioSurface.vue`.

**Interfaces:** Consumes `geoshape/*`. Persists `{ config, canvasW, canvasH, aspectKey }` under `sailor_shapeStudio` (drop `orbit`).

- [ ] **Step 1:** Replace the Three viewport + `ShapeEngine` rAF loop with a `<canvas>` and a `renderPreview()` that calls `renderShapes(config)` then `drawToCanvas(...)`, re-run on config change (debounced) — NOT a rAF loop (2D is cheap, event-driven is enough; per the "per-frame writes stomp event state" lesson, don't rAF-reassert). Keep `StudioModalShell` `#preview`/`#controls`/`#actions` slots.
- [ ] **Step 2:** Feed `GEO_CONTROLS`/`GEO_SECTIONS` into `StudioControlPanel`; wire `setControl`/`controlVisible`; add bespoke `#control-*` slots for the paint pickers (reuse `StudioColor`/paint widgets used by Vector Type).
- [ ] **Step 3:** Wire `useStudioAutosave(getSnapshot)` and `useStudioAgent`. Actions footer: **Download SVG** (`toSvg(config)` → Blob download) and **As image** (rasterize canvas → PNG, existing `sailor:shapeStudioOutput` path).
- [ ] **Step 4: Browser render-proof** (drive the live dev server on `127.0.0.1:3000`, per the localhost-426 note; reuse a running server, don't kill parallel sessions):
  1. Open the shape studio (dev harness or canvas node). Confirm the default renders the geologo-style radial hexagon mark with **visible even-odd negative space**.
  2. Toggle `overlapMode` hole→shape → confirm the overlap regions become a distinctly-filled shape.
  3. Change layout radial→grid→linear, bump count, drag rotateStep/scaleEnd → confirm live updates.
  4. Enable symmetry; set a clip mask → confirm mirror + clip.
  5. `read_console_messages` clean; `computer{action:"screenshot"}`.
  6. **Objective proof (not eyeball):** via `javascript_tool`, read the preview canvas pixels and assert (a) non-blank, and (b) interior negative space exists (some interior pixels match the background, proving even-odd carved a hole) — mirroring the Phase-1 pixel-diff rigor.
- [ ] **Step 5: Commit** `feat(shape-studio): 2D-vector surface (live canvas + SVG export)`.

---

### Task 9: Node rewire + retire 3D `shapefx`

**Files:** Modify `frontend/app/components/vue-canvas/ShapeStudioNode.vue`; delete/retire `frontend/app/lib/shapefx/{engine,surface,geometry,points,post,ombre,color}.ts` and Three imports; keep the node registration + cascade wiring.

- [ ] **Step 1:** Rewrite `bakeOutput()` to render the config to an offscreen 2D canvas (`renderShapes` + `drawToCanvas`) and read back a **PNG** blob (drop the offscreen `ShapeEngine`). The `StudioBaker` contract (`() => Promise<Blob|null>`) is unchanged.
- [ ] **Step 2:** Update the node card thumbnail to draw the 2D preview (or keep the last-bake still). Keep `sailor:openShapeStudio` / `sailor:shapeStudioOutput` events and the `'shape-studio'` type mapping.
- [ ] **Step 3:** Remove the now-unused 3D engine files. FIRST grep for any other importer of `~/lib/shapefx/*` beyond the surface/node/cascade/agent-tune (`cd frontend && grep -rn "lib/shapefx" app/ | grep -v ShapeStudio`). If a parallel session's `shapefx-post-adoption` test still imports them, coordinate — leave the file present but unused, or delete the test if it's the retired 3D path. Note what you dropped in `log()`/the report.
- [ ] **Step 4:** Update any `shapefx` unit tests that test the retired 3D engine — delete the ones exercising `engine.ts`/`geometry.ts` (3D), keep none that now have no subject. Run `cd frontend && npx vitest run tests/unit/geoshape-*.unit.spec.ts` (all green) and confirm the app boots (Vite compile-check).
- [ ] **Step 5: Browser proof:** add a shape-studio node on the canvas, confirm it bakes a PNG into the cascade (downstream image consumers work), and the node card shows the 2D mark. Screenshot.
- [ ] **Step 6: Commit** `feat(shape-studio): rewire node to 2D bake; retire 3D shapefx engine`.

---

## Self-Review

**Spec coverage:** base shapes (T1) · config incl. overlapMode+paint (T2) · arrange radial/grid/linear+ramps (T3) · boolean composite + hole/new-shape overlaps + symmetry + clip (T4) · full paint (T2/T5) · SVG + canvas render + render-proof (T6/T8) · controls/agent/randomize (T7) · live 2D surface + SVG download (T8) · node rewire + retire 3D + PNG bake (T9). All spec sections mapped.

**Placeholder scan:** the Task 4 evenodd branch has an explicit "iterate based on test outcome" fallback (union-flattens-holes → CompoundPath-children) — that's a real, test-driven decision point with both branches specified, not a TODO. Task 5 may collapse into T2 if paint validation is already complete — flagged inline.

**Type consistency:** `GeoShapeConfig` fields referenced identically across T2–T8; `ClonePlacement` shape (x/y/scale/rotate/skew) defined in T3 and consumed in T4; `composite` signature stable T4→T6; `paperToCommands` exported in T4 Step 1 before use; `VectorShape`/`VectorPaint`/`shapesToSVG` from `~/lib/vector/svg` used consistently.

**Scope:** one coherent feature (repurpose one node). Task 4 (boolean core) and Task 8 (surface) are the heavy ones; both are independently testable/reviewable.
