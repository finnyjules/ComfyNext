# Frame Polygon & Star Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two parametric, editable vector shape kinds — polygon (n-sided) and star, with corner rounding — to the Frame (Compositor MODAL), and confirm + lightly surface the existing boolean ops.

**Architecture:** Both kinds carry `w`/`h` (normalized to canvas width, like rect/ellipse) so they inherit resize / rotate / group-resize / fills / effects with no new code in those systems. A single pure geometry module produces an SVG `d` string in the exact PathLayer convention (local units = canvas width, centered on origin); rendering reuses the existing `drawPath`, and boolean reuses `shapeToPathLayer`. Shape params are the single source of truth — the `d` is always derived, never stored.

**Tech Stack:** Nuxt 4 (Vue 3 + TypeScript), Vitest, Canvas 2D, paper.js (already wired for boolean), lucide-vue-next icons.

## Global Constraints

- Surface = the Compositor MODAL only (`frontend/app/components/vue-canvas/CompositorModal.vue`). Do NOT touch the inline `ArtifactFrameNode`.
- Work on `main`. Do NOT create feature branches. A parallel session may also commit to main — before each task, dirty-check the files you will touch and BLOCK if a foreign uncommitted change is present on them.
- Stage only your own files with explicit paths. NEVER `git add -A`.
- Coordinate model: `x,y` normalized to canvas width/height (center position); `w,h` normalized to canvas **width**. Path `d` in local units (1 unit = canvas width), centered on bbox midpoint.
- Colors: no purple/violet accents. Shape fill defaults use the existing blue/amber family.
- Commit message trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- KNOWN pre-existing unit failures (gradientfx-mesh, spacetype-palette ×2, video-model-adapt) are foreign/unrelated — note, do not block on them. Your new tests and the compositor specs must pass.
- All new geometry produces the SAME `d` convention as `PathLayer` so rendering, gradients, effects, and boolean work unchanged.
- Commands run from `frontend/`: `cd frontend && npx vitest run <path>`.

---

### Task 1: Pure geometry module `polygonGeometry.ts`

**Files:**
- Create: `frontend/app/lib/compositor/polygonGeometry.ts`
- Test: `frontend/tests/unit/polygon-geometry.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces:
  - `interface Pt { x: number; y: number }`
  - `polygonVertices(sides: number, w: number, h: number): Pt[]`
  - `starVertices(points: number, innerRatio: number, w: number, h: number): Pt[]`
  - `roundedPolygonPath(vertices: Pt[], cornerRadius: number): string`
  - `polygonPathData(sides: number, w: number, h: number, cornerRadius: number): string`
  - `starPathData(points: number, innerRatio: number, w: number, h: number, cornerRadius: number): string`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/polygon-geometry.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  polygonVertices, starVertices, roundedPolygonPath, polygonPathData, starPathData,
} from '~/lib/compositor/polygonGeometry'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('polygonVertices', () => {
  it('returns `sides` vertices, first at top', () => {
    const v = polygonVertices(4, 2, 2) // rx=ry=1
    expect(v).toHaveLength(4)
    expect(near(v[0].x, 0)).toBe(true)
    expect(near(v[0].y, -1)).toBe(true)   // top
  })
  it('a 4-gon is a diamond on the axes', () => {
    const v = polygonVertices(4, 2, 2)
    expect(near(v[1].x, 1) && near(v[1].y, 0)).toBe(true)   // right
    expect(near(v[2].x, 0) && near(v[2].y, 1)).toBe(true)   // bottom
    expect(near(v[3].x, -1) && near(v[3].y, 0)).toBe(true)  // left
  })
  it('respects the (w/2,h/2) ellipse radii', () => {
    const v = polygonVertices(4, 4, 2) // rx=2, ry=1
    expect(near(v[1].x, 2)).toBe(true)
    expect(near(v[2].y, 1)).toBe(true)
  })
  it('clamps sides below 3 up to 3', () => {
    expect(polygonVertices(2, 2, 2)).toHaveLength(3)
    expect(polygonVertices(4.6, 2, 2)).toHaveLength(5) // rounds
  })
})

describe('starVertices', () => {
  it('returns 2*points vertices, alternating outer/inner radii', () => {
    const v = starVertices(5, 0.5, 2, 2) // outer r=1, inner r=0.5
    expect(v).toHaveLength(10)
    expect(near(Math.hypot(v[0].x, v[0].y), 1)).toBe(true)    // outer
    expect(near(Math.hypot(v[1].x, v[1].y), 0.5)).toBe(true)  // inner
    expect(near(v[0].x, 0) && near(v[0].y, -1)).toBe(true)    // first outer at top
  })
  it('clamps innerRatio into (0.01, 0.99) and points to >=3', () => {
    expect(starVertices(2, 5, 2, 2)).toHaveLength(6) // points clamped to 3 -> 6 verts
    const v = starVertices(4, 5, 2, 2) // innerRatio clamped to 0.99
    expect(Math.hypot(v[1].x, v[1].y)).toBeLessThanOrEqual(0.99 + 1e-9)
  })
})

describe('roundedPolygonPath', () => {
  it('cornerRadius 0 yields a straight M/L/Z path (no arcs)', () => {
    const d = roundedPolygonPath(polygonVertices(4, 2, 2), 0)
    expect(d.startsWith('M ')).toBe(true)
    expect(d.includes('L ')).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
    expect(d.includes('Q')).toBe(false)
  })
  it('cornerRadius > 0 introduces quadratic arcs', () => {
    const d = roundedPolygonPath(polygonVertices(4, 2, 2), 0.5)
    expect(d.includes('Q')).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
  })
  it('returns empty for < 3 vertices', () => {
    expect(roundedPolygonPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.5)).toBe('')
  })
})

describe('polygonPathData / starPathData', () => {
  it('produce non-empty paths for valid sizes', () => {
    expect(polygonPathData(6, 0.24, 0.24, 0).length).toBeGreaterThan(0)
    expect(starPathData(5, 0.5, 0.24, 0.24, 0.2).length).toBeGreaterThan(0)
  })
  it('return empty string when w or h is ~0', () => {
    expect(polygonPathData(6, 0, 0.24, 0)).toBe('')
    expect(starPathData(5, 0.5, 0.24, 0, 0)).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/polygon-geometry.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/compositor/polygonGeometry`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/compositor/polygonGeometry.ts`:

```ts
export interface Pt { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const f = (v: number) => +v.toFixed(4)

// N vertices on the (w/2, h/2) ellipse, first at top (angle -90°), clockwise.
export function polygonVertices(sides: number, w: number, h: number): Pt[] {
  const n = Math.max(3, Math.round(sides))
  const rx = w / 2, ry = h / 2
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    out.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) })
  }
  return out
}

// 2*points vertices alternating outer (rx,ry) and inner (innerRatio*rx, innerRatio*ry),
// first outer at top.
export function starVertices(points: number, innerRatio: number, w: number, h: number): Pt[] {
  const n = Math.max(3, Math.round(points))
  const ir = clamp(innerRatio, 0.01, 0.99)
  const rx = w / 2, ry = h / 2
  const step = Math.PI / n // half the angular gap between outer points
  const out: Pt[] = []
  for (let i = 0; i < 2 * n; i++) {
    const a = -Math.PI / 2 + i * step
    const outer = i % 2 === 0
    const kx = outer ? rx : rx * ir
    const ky = outer ? ry : ry * ir
    out.push({ x: kx * Math.cos(a), y: ky * Math.sin(a) })
  }
  return out
}

// Build an SVG `d`. cornerRadius 0..1: per corner r = cr * min(prevEdge, nextEdge) / 2;
// inset along both adjacent edges by r, join with a quadratic (control = the vertex).
export function roundedPolygonPath(vertices: Pt[], cornerRadius: number): string {
  const n = vertices.length
  if (n < 3) return ''
  const cr = clamp(cornerRadius, 0, 1)
  if (cr <= 0) {
    let d = `M ${f(vertices[0].x)} ${f(vertices[0].y)}`
    for (let i = 1; i < n; i++) d += ` L ${f(vertices[i].x)} ${f(vertices[i].y)}`
    return d + ' Z'
  }
  const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
  const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  let d = ''
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n]
    const curr = vertices[i]
    const next = vertices[(i + 1) % n]
    const lenPrev = dist(curr, prev)
    const lenNext = dist(curr, next)
    // radius as a length, clamped to half of each adjacent edge so arcs never overlap
    const r = (cr * Math.min(lenPrev, lenNext)) / 2
    const tPrev = lenPrev > 0 ? r / lenPrev : 0
    const tNext = lenNext > 0 ? r / lenNext : 0
    const p1 = lerp(curr, prev, tPrev) // entry tangent point (on edge toward prev)
    const p2 = lerp(curr, next, tNext) // exit tangent point (on edge toward next)
    d += i === 0 ? `M ${f(p1.x)} ${f(p1.y)}` : ` L ${f(p1.x)} ${f(p1.y)}`
    d += ` Q ${f(curr.x)} ${f(curr.y)} ${f(p2.x)} ${f(p2.y)}`
  }
  return d + ' Z'
}

export function polygonPathData(sides: number, w: number, h: number, cornerRadius: number): string {
  if (w <= 1e-6 || h <= 1e-6) return ''
  return roundedPolygonPath(polygonVertices(sides, w, h), cornerRadius)
}

export function starPathData(points: number, innerRatio: number, w: number, h: number, cornerRadius: number): string {
  if (w <= 1e-6 || h <= 1e-6) return ''
  return roundedPolygonPath(starVertices(points, innerRatio, w, h), cornerRadius)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/polygon-geometry.unit.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/polygonGeometry.ts frontend/tests/unit/polygon-geometry.unit.spec.ts
git commit -m "feat(frame): polygon & star geometry (vertices, rounded path)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Layer types, factories, and shape→path conversion

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (union type ~line 16; interfaces near the other shape interfaces ~209-259; factories near line 328; `shapeToPathLayer` ~line 372)
- Test: `frontend/tests/unit/polygon-shape.unit.spec.ts` (Create)

**Interfaces:**
- Consumes: `polygonPathData`, `starPathData` from Task 1; existing `createPathLayer`, `newId`, `LayerCommon`, `PathLayer` in this file.
- Produces:
  - `PolygonLayer` (`kind:'polygon'`, `w,h,sides,cornerRadius,fill,stroke,strokeWidth`)
  - `StarLayer` (`kind:'star'`, `w,h,points,innerRatio,cornerRadius,fill,stroke,strokeWidth`)
  - `createPolygonLayer(partial?: Partial<PolygonLayer>): PolygonLayer`
  - `createStarLayer(partial?: Partial<StarLayer>): StarLayer`
  - `shapeToPathLayer` now also converts `polygon` and `star`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/polygon-shape.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  createPolygonLayer, createStarLayer, shapeToPathLayer,
} from '~/composables/useCompositorLayers'

describe('createPolygonLayer', () => {
  it('has parametric defaults (6 sides, sharp)', () => {
    const p = createPolygonLayer()
    expect(p.kind).toBe('polygon')
    expect(p.sides).toBe(6)
    expect(p.cornerRadius).toBe(0)
    expect(p.w).toBeGreaterThan(0)
    expect(p.h).toBeGreaterThan(0)
  })
  it('honors partial overrides', () => {
    const p = createPolygonLayer({ sides: 3, cornerRadius: 0.4 })
    expect(p.sides).toBe(3)
    expect(p.cornerRadius).toBe(0.4)
  })
})

describe('createStarLayer', () => {
  it('has parametric defaults (5 points, innerRatio 0.5)', () => {
    const s = createStarLayer()
    expect(s.kind).toBe('star')
    expect(s.points).toBe(5)
    expect(s.innerRatio).toBe(0.5)
    expect(s.cornerRadius).toBe(0)
  })
})

describe('shapeToPathLayer for polygon/star', () => {
  it('converts a polygon to a path layer carrying a derived d', () => {
    const path = shapeToPathLayer(createPolygonLayer({ sides: 4 }))
    expect(path).not.toBeNull()
    expect(path!.kind).toBe('path')
    expect(path!.d.length).toBeGreaterThan(0)
    expect(path!.bbox.w).toBeCloseTo(0.24, 5)
  })
  it('converts a star to a path layer', () => {
    const path = shapeToPathLayer(createStarLayer({ points: 5 }))
    expect(path).not.toBeNull()
    expect(path!.kind).toBe('path')
    expect(path!.d.includes('Q') || path!.d.includes('L')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/polygon-shape.unit.spec.ts`
Expected: FAIL — `createPolygonLayer` not exported.

- [ ] **Step 3: Add the import, union, interfaces, factories, and conversion**

In `useCompositorLayers.ts`:

Add the import at the top (near other lib imports):

```ts
import { polygonPathData, starPathData } from '~/lib/compositor/polygonGeometry'
```

Extend the union (line ~16):

```ts
export type LocalLayerKind = 'text' | 'rect' | 'ellipse' | 'line' | 'path' | 'image' | 'polygon' | 'star'
```

Add interfaces beside the other shape interfaces (after `EllipseLayer`):

```ts
export interface PolygonLayer extends LayerCommon {
  kind: 'polygon'
  w: number; h: number
  sides: number          // integer >= 3
  cornerRadius: number   // 0..1 ratio (scale-invariant)
  fill: string; stroke: string; strokeWidth: number
}
export interface StarLayer extends LayerCommon {
  kind: 'star'
  w: number; h: number
  points: number         // integer >= 3
  innerRatio: number     // 0.01..0.99 (inner radius / outer radius)
  cornerRadius: number   // 0..1 ratio
  fill: string; stroke: string; strokeWidth: number
}
```

Add `PolygonLayer | StarLayer` to the `LocalLayer` union (find the `export type LocalLayer = RectLayer | EllipseLayer | ... ` union and append them).

Add factories near `createEllipseLayer`:

```ts
export function createPolygonLayer(partial: Partial<PolygonLayer> = {}): PolygonLayer {
  return {
    id: newId(), kind: 'polygon',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.24, h: 0.24, sides: 6, cornerRadius: 0,
    fill: '#3b82f6', stroke: '', strokeWidth: 0,
    ...partial,
  }
}
export function createStarLayer(partial: Partial<StarLayer> = {}): StarLayer {
  return {
    id: newId(), kind: 'star',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.24, h: 0.24, points: 5, innerRatio: 0.5, cornerRadius: 0,
    fill: '#f59e0b', stroke: '', strokeWidth: 0,
    ...partial,
  }
}
```

Extend `shapeToPathLayer` — add before its final `return null`:

```ts
if (layer.kind === 'polygon') {
  const d = polygonPathData(layer.sides, layer.w, layer.h, layer.cornerRadius)
  if (!d) return null
  return createPathLayer({
    d, bbox: { w: layer.w, h: layer.h }, scale: 1,
    x: layer.x, y: layer.y, rotation: layer.rotation, opacity: layer.opacity,
    fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
  })
}
if (layer.kind === 'star') {
  const d = starPathData(layer.points, layer.innerRatio, layer.w, layer.h, layer.cornerRadius)
  if (!d) return null
  return createPathLayer({
    d, bbox: { w: layer.w, h: layer.h }, scale: 1,
    x: layer.x, y: layer.y, rotation: layer.rotation, opacity: layer.opacity,
    fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
  })
}
```

- [ ] **Step 4: Run the new tests + the compositor regression suite**

Run: `cd frontend && npx vitest run tests/unit/polygon-shape.unit.spec.ts tests/unit/compositor.unit.spec.ts tests/unit/compositor-fills.unit.spec.ts`
Expected: PASS (new file green; compositor specs still green).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/polygon-shape.unit.spec.ts
git commit -m "feat(frame): polygon & star layer types, factories, path conversion

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Render branch + toolbar creation + resize enablement

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (`drawLayerContent` ~line 903-946)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (add handlers near `addRect` ~line 635; add `polygon`/`star` to `resizableKind`)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (toolbar ~line 2701-2707; lucide import)

**Interfaces:**
- Consumes: `polygonPathData`/`starPathData` (Task 1); `createPolygonLayer`/`createStarLayer` (Task 2); existing `drawPath(ctx, layer, W)`, `addLocal`, `resizableKind` in the editor.
- Produces: `addPolygon()`, `addStar()` exported from `useLocalLayerEditor`; polygon/star render on canvas; polygon/star show 2D resize handles.

- [ ] **Step 1: Add the render branch**

In `useCompositorLayers.ts` `drawLayerContent`, after the `ellipse` and `line` branches and alongside the `path` branch, add:

```ts
else if (layer.kind === 'polygon' || layer.kind === 'star') {
  const d = layer.kind === 'polygon'
    ? polygonPathData(layer.sides, layer.w, layer.h, layer.cornerRadius)
    : starPathData(layer.points, layer.innerRatio, layer.w, layer.h, layer.cornerRadius)
  if (d) {
    drawPath(ctx, {
      ...layer, kind: 'path', d, bbox: { w: layer.w, h: layer.h }, scale: 1, fillRule: 'nonzero',
      fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    } as any, W)
  }
}
```

(`drawPath` is already called from `drawLayerContent` for the `path` kind, so this is the same pipeline stage — transform/opacity are already applied by `drawLocalLayer`. The synthesized object is cast `as any` because it is a transient PathLayer-shaped value, not a stored layer.)

- [ ] **Step 2: Add creation handlers + resize enablement in the editor**

In `useLocalLayerEditor.ts`, import the factories if not already star-imported, then near `addRect`:

```ts
function addPolygon() { addLocal(createPolygonLayer()) }
function addStar() { addLocal(createStarLayer()) }
```

Add both to the composable's `return { ... }` so the modal can call them.

Find `resizableKind` (a Set or function gating 2D resize handles — currently rect/ellipse/image) and add `'polygon'` and `'star'` so they get full edge+corner resize. Example if it is a Set:

```ts
const resizableKind = new Set(['rect', 'ellipse', 'image', 'polygon', 'star'])
```

(If it is a function/inline check, add the two kinds to that check identically.)

- [ ] **Step 3: Add the toolbar buttons + lucide import**

In `CompositorModal.vue`, add `Hexagon, Star` to the existing `lucide-vue-next` import (explicit import is required in vue-canvas — established project gotcha). Then after the "Add line" button (~line 2707):

```vue
<button class="[copy the exact class list from the sibling shape buttons]" title="Add polygon" @click="addPolygon">
  <Hexagon class="size-4" />
</button>
<button class="[same class list]" title="Add star" @click="addStar">
  <Star class="size-4" />
</button>
```

Ensure `addPolygon`/`addStar` are destructured from `useLocalLayerEditor()` where `addRect` already is.

- [ ] **Step 4: Typecheck + regression suite**

Run: `cd frontend && npx vitest run tests/unit/polygon-shape.unit.spec.ts tests/unit/compositor.unit.spec.ts`
Expected: PASS. Also run the project's typecheck if quick (`npx vue-tsc --noEmit` may surface only pre-existing strict-null noise — confirm no NEW errors reference polygon/star).

Note: canvas rendering + toolbar are not unit-testable here; the CONTROLLER browser-verifies in Task 6. This task's gate is: compiles, existing tests green, handlers wired.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/app/composables/useLocalLayerEditor.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): render polygon/star + toolbar buttons + resize handles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Inspector parameter controls

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (per-kind inspector blocks, near the rect Corner-radius block ~line 3096)

**Interfaces:**
- Consumes: the selected layer + the existing inspector patch/commit path (whatever helper writes a field on the selected layer, e.g. `updateSelected({ ... })` / `patchLayer`; mirror exactly how the rect Corner-radius input writes `radius`).
- Produces: live editing of `sides` (polygon); `points`, `innerRatio`, `cornerRadius` (star); `cornerRadius` (polygon).

- [ ] **Step 1: Add the polygon inspector block**

Locate the rect-specific inspector block (the one rendering Corner radius, gated on the selected layer being a rect). Add a sibling block gated on `polygon`. Mirror the existing input markup/classes used for rect's numeric fields:

```vue
<template v-if="selectedLayer?.kind === 'polygon'">
  <div class="[same wrapper classes as the rect radius block]">
    <label class="[same label classes]">Sides</label>
    <input type="number" min="3" step="1"
      :value="selectedLayer.sides"
      @input="patchSelected({ sides: Math.max(3, Math.round(+($event.target as HTMLInputElement).value || 3)) })"
      class="[same input classes]" />
  </div>
  <div class="[same wrapper classes]">
    <label class="[same label classes]">Corner radius</label>
    <input type="range" min="0" max="1" step="0.01"
      :value="selectedLayer.cornerRadius"
      @input="patchSelected({ cornerRadius: +($event.target as HTMLInputElement).value })"
      class="[same slider classes used elsewhere]" />
  </div>
</template>
```

(`patchSelected` is a placeholder for whatever the file already uses to write a field on the selected local layer — use the SAME function the rect Corner-radius input uses. Do not invent a new writer.)

- [ ] **Step 2: Add the star inspector block**

```vue
<template v-if="selectedLayer?.kind === 'star'">
  <div class="[same wrapper classes]">
    <label class="[same label classes]">Points</label>
    <input type="number" min="3" step="1"
      :value="selectedLayer.points"
      @input="patchSelected({ points: Math.max(3, Math.round(+($event.target as HTMLInputElement).value || 3)) })"
      class="[same input classes]" />
  </div>
  <div class="[same wrapper classes]">
    <label class="[same label classes]">Inner radius</label>
    <input type="range" min="0.01" max="0.99" step="0.01"
      :value="selectedLayer.innerRatio"
      @input="patchSelected({ innerRatio: +($event.target as HTMLInputElement).value })"
      class="[same slider classes]" />
  </div>
  <div class="[same wrapper classes]">
    <label class="[same label classes]">Corner radius</label>
    <input type="range" min="0" max="1" step="0.01"
      :value="selectedLayer.cornerRadius"
      @input="patchSelected({ cornerRadius: +($event.target as HTMLInputElement).value })"
      class="[same slider classes]" />
  </div>
</template>
```

- [ ] **Step 3: Typecheck + regression suite**

Run: `cd frontend && npx vitest run tests/unit/polygon-shape.unit.spec.ts tests/unit/compositor.unit.spec.ts`
Expected: PASS. Confirm no new typecheck errors reference the inspector edits. CONTROLLER browser-verifies live editing in Task 6.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): polygon/star inspector controls (sides/points/inner/corner)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Boolean participation + discoverability polish

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (`BOOLEANABLE` set ~line 383; the boolean button cluster markup)
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (`applyBoolean` operand filter ~line 688-706)

**Interfaces:**
- Consumes: existing `applyBoolean(op)`, `pathLayerBoolean`, `shapeToPathLayer` (now polygon/star-aware from Task 2), `selectedPathCount`, `BOOL_OPS`.
- Produces: polygon/star are booleanable; boolean cluster clearly presented when `selectedPathCount >= 2`.

- [ ] **Step 1: Add polygon/star to the booleanable sets**

In `CompositorModal.vue`:

```ts
const BOOLEANABLE = new Set(['path', 'rect', 'ellipse', 'line', 'polygon', 'star'])
```

In `useLocalLayerEditor.ts` `applyBoolean`, extend the operand filter to include the new kinds:

```ts
const originals = selectedLayers.value.filter(l =>
  l.kind === 'path' || l.kind === 'rect' || l.kind === 'ellipse' || l.kind === 'line'
  || l.kind === 'polygon' || l.kind === 'star'
)
```

(The `shapeToPathLayer` conversion for polygon/star already exists from Task 2, so the rest of `applyBoolean` works unchanged.)

- [ ] **Step 2: Discoverability polish**

Find where `BOOL_OPS` buttons render relative to the multi-select toolbar. Ensure the four boolean buttons appear as a clearly-grouped, labeled cluster when `selectedPathCount >= 2` (e.g. a small separator + the four ops with icons/labels). If they are already clearly placed, make the minimal change to ensure they are visible and legible — do NOT re-architect the toolbar. Keep styling consistent with the existing align/distribute cluster.

- [ ] **Step 3: Regression suite**

Run: `cd frontend && npx vitest run tests/unit/polygon-shape.unit.spec.ts tests/unit/compositor.unit.spec.ts`
Expected: PASS. CONTROLLER verifies a real boolean (subtract a star from a rect) live in Task 6.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue frontend/app/composables/useLocalLayerEditor.ts
git commit -m "feat(frame): polygon/star boolean participation + boolean UI polish

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Controller browser verification + final whole-branch review

**Files:** none (verification only).

This task is performed by the CONTROLLER (not a fresh implementer subagent), because it requires the live browser on `:3017` /dev/frame-lab.

- [ ] **Step 1: Browser-verify the full loop on `:3017` /dev/frame-lab**

Reload the modal (SFC edits committed by subagents need a full page reload — stale-HMR gotcha). Then verify and screenshot each:
1. Click the Polygon toolbar button → a hexagon appears and renders.
2. Select it → inspector shows Sides; change Sides to 3 (triangle) and 8 (octagon) → shape re-renders live.
3. Raise Corner radius → corners round.
4. Click the Star button → 5-point star appears; change Points and Inner radius → re-renders; raise Corner radius → rounds.
5. Resize a polygon by an edge handle and a corner handle (2D resize works).
6. Multi-select a polygon + a rect → group proportional resize scales both.
7. Select a star + a rect (2 shapes) → boolean cluster appears; click Subtract → the star is cut out of the rect; screenshot the result.

Reliable multi-select note: canvas synthetic shift-click and marquee have been flaky in this harness — prefer clicking a group row, or create shapes and select via a real drag if needed; verify `selectedIds` count > 1 before expecting the boolean/group UI.

- [ ] **Step 2: Dispatch the final whole-branch review**

Dispatch a reviewer subagent over the slice commits (Task 1–5 SHAs). It must hand-verify: (a) geometry correctness (first-vertex-at-top, alternating star radii, rounded-path arc inset + per-corner clamp), (b) render reuses drawPath at the correct pipeline stage with no double transform, (c) params are the single source of truth (no stored `d`), (d) group-resize else-branch + resizableKind cover polygon/star, (e) boolean conversion + sets, (f) inspector writes via the existing patch path with history coalescing, (g) regression: existing compositor specs green. Fold any Minor into a polish commit.

- [ ] **Step 3: Update ledger + memory + mark task complete**

Update `.superpowers/sdd/` progress notes, update `project_frame_parity_audit` memory + MEMORY.md index, and give the user the wrap-up.

---

## Notes for the executor

- Suggested models: Task 1 (code-given math) → haiku; Tasks 2–5 (wiring/UI) + reviews → sonnet.
- Each task ends green (its own tests + compositor regression) before commit.
- The four Figma-parity slices this builds on are unpushed on main; this slice stays unpushed too unless the user says otherwise.
