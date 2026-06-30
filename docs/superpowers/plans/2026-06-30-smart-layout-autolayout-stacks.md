# Smart Layout Auto-Layout Stacks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Figma-style auto-layout **Stacks** to Smart Layout v3 — a container that arranges its children by direction/padding/gap/align with hug/fill/fixed sizing — working in a single format.

**Architecture:** Additive evolution of `SectionV3`. A new optional `layout` field turns a section into a Stack; a new **pure** solver (`autolayout.ts`) computes child rects from intrinsic sizes; the resolver branches to it for layout-bearing sections (layout-less sections keep today's proportional projection unchanged). The editor revives the dormant section overlay as the Stack surface.

**Tech Stack:** TypeScript, Vue 3 (Nuxt 4), Vitest, the existing `frontend/shared/template-grid/` pure module, Playwright for visual sign-off.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-30-smart-layout-autolayout-stacks-design.md`.
- **Additive / back-compat:** a section with no `layout` field MUST resolve byte-identically to today. Zero v2/v3 regressions.
- **Units:** padding/gap are **fine-grid cells**; the solver itself works in **px** (caller converts cells→px via `GridMetrics.cellW/cellH`).
- **Purity:** `autolayout.ts` and `sections.ts` ops are pure — return fresh templates, never mutate input. Use JSON clone (not `structuredClone` — templates carry Vue reactive proxies).
- **Single format:** Slice 1 operates at the master/design format only. Cross-format direction-flip, safe-area, and per-format overrides are Slice 2 — do NOT build them.
- **Commit discipline:** stage only the files each task names (explicit paths, never `git add -A`). Work on `main`, no feature branch.
- **Naming:** the user-facing word is **"Stack"** (never "Frame" — taken by the Frame node). Verb: "wrap in stack."
- **Test runner:** `cd frontend && npx vitest run <file>` for a single file.

---

### Task 1: Schema — `AutoLayout`, `SizeMode`, `layoutSizing`

**Files:**
- Modify: `frontend/shared/template-grid/types.ts` (after `SectionV3`, ~line 139; and `ElementV2Base`, ~line 29)
- Test: `frontend/tests/unit/template-grid-autolayout-types.unit.spec.ts` (create)

**Interfaces:**
- Produces: `LayoutAxis`, `MainAlign`, `CrossAlign`, `SizeMode`, `AutoLayout`, `SectionV3.layout?`, `ElementV2Base.layoutSizing?`, and `isLayoutStack(section): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/template-grid-autolayout-types.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { isLayoutStack } from '../../shared/template-grid/types'
import type { SectionV3 } from '../../shared/template-grid/types'

describe('isLayoutStack', () => {
  const base: SectionV3 = { id: 's1', name: 'x', region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 }, children: [] }

  it('is false when no layout', () => {
    expect(isLayoutStack(base)).toBe(false)
  })

  it('is true when layout present', () => {
    const s: SectionV3 = { ...base, layout: {
      direction: 'vertical', padding: { top: 2, right: 2, bottom: 2, left: 2 },
      gap: 1, mainAlign: 'start', crossAlign: 'stretch',
    } }
    expect(isLayoutStack(s)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/template-grid-autolayout-types.unit.spec.ts`
Expected: FAIL — `isLayoutStack` is not exported.

- [ ] **Step 3: Add types + guard**

In `frontend/shared/template-grid/types.ts`, add to `ElementV2Base` (inside the interface, after `bleed?`):

```ts
  /** Consulted only when this element is a Stack child. */
  layoutSizing?: { main: SizeMode; cross: SizeMode }
```

Add near the top type aliases (after `TextOverflow`, ~line 9):

```ts
export type LayoutAxis = 'horizontal' | 'vertical'
export type MainAlign = 'start' | 'center' | 'end' | 'space-between'
export type CrossAlign = 'start' | 'center' | 'end' | 'stretch'
export type SizeMode = 'hug' | 'fill' | 'fixed'

export interface AutoLayout {
  direction: LayoutAxis
  /** Inner insets, in fine-grid cells. */
  padding: { top: number; right: number; bottom: number; left: number }
  /** Gap between children, in fine-grid cells. */
  gap: number
  mainAlign: MainAlign
  crossAlign: CrossAlign
}
```

Add `layout?: AutoLayout` to `SectionV3` (after `children`):

```ts
  /** Present → auto-layout Stack (engine computes child rects). Absent →
   *  absolute-region section (unchanged). */
  layout?: AutoLayout
```

Add the guard at the end of the file (after `isV3`):

```ts
/** True when a section is an auto-layout Stack (has layout rules). */
export function isLayoutStack(section: SectionV3): boolean {
  return section.layout != null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/template-grid-autolayout-types.unit.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/types.ts frontend/tests/unit/template-grid-autolayout-types.unit.spec.ts
git commit -m "feat(smart-layout): Stack schema (AutoLayout, SizeMode, isLayoutStack)"
```

---

### Task 2: Pure stack solver — `solveStack`

The heart of the feature: a single-axis flexbox solver. Pure, px-only, no grid/text/DOM coupling, so it gets exhaustive unit tests.

**Files:**
- Create: `frontend/shared/template-grid/autolayout.ts`
- Test: `frontend/tests/unit/template-grid-autolayout.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `Rect` from `./grid`; `LayoutAxis`, `MainAlign`, `CrossAlign`, `SizeMode` from `./types`.
- Produces:
  - `interface StackItem { id: string; main: number; cross: number; mainMode: SizeMode; crossMode: SizeMode }`
  - `interface StackBox { x; y; w; h: number; direction: LayoutAxis; padTop; padRight; padBottom; padLeft; gap: number; mainAlign: MainAlign; crossAlign: CrossAlign }`
  - `solveStack(box: StackBox, items: StackItem[]): Array<{ id: string; rect: Rect }>`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/unit/template-grid-autolayout.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { solveStack } from '../../shared/template-grid/autolayout'
import type { StackBox, StackItem } from '../../shared/template-grid/autolayout'

const box = (over: Partial<StackBox> = {}): StackBox => ({
  x: 0, y: 0, w: 100, h: 100, direction: 'vertical',
  padTop: 0, padRight: 0, padBottom: 0, padLeft: 0, gap: 0,
  mainAlign: 'start', crossAlign: 'stretch', ...over,
})
const item = (id: string, over: Partial<StackItem> = {}): StackItem => ({
  id, main: 20, cross: 20, mainMode: 'fixed', crossMode: 'stretch', ...over,
})

describe('solveStack', () => {
  it('stacks vertical fixed children top-down', () => {
    const out = solveStack(box(), [item('a', { main: 30 }), item('b', { main: 40 })])
    expect(out[0].rect).toEqual({ x: 0, y: 0, w: 100, h: 30 })
    expect(out[1].rect).toEqual({ x: 0, y: 30, w: 100, h: 40 })
  })

  it('applies padding and gap', () => {
    const out = solveStack(box({ padTop: 10, padLeft: 5, padRight: 5, gap: 8 }),
      [item('a', { main: 20 }), item('b', { main: 20 })])
    expect(out[0].rect).toEqual({ x: 5, y: 10, w: 90, h: 20 })
    expect(out[1].rect).toEqual({ x: 5, y: 38, w: 90, h: 20 }) // 10 + 20 + 8
  })

  it('distributes fill children across leftover main space', () => {
    const out = solveStack(box({ h: 100 }),
      [item('a', { main: 40, mainMode: 'fixed' }), item('b', { mainMode: 'fill' })])
    expect(out[1].rect.h).toBe(60)
    expect(out[1].rect.y).toBe(40)
  })

  it('splits fill equally between two fill children', () => {
    const out = solveStack(box({ h: 90, gap: 10 }),
      [item('a', { mainMode: 'fill' }), item('b', { mainMode: 'fill' })])
    expect(out[0].rect.h).toBe(40) // (90 - 10) / 2
    expect(out[1].rect.h).toBe(40)
  })

  it('centers on the main axis', () => {
    const out = solveStack(box({ h: 100, mainAlign: 'center' }), [item('a', { main: 20 })])
    expect(out[0].rect.y).toBe(40)
  })

  it('aligns to end on the main axis', () => {
    const out = solveStack(box({ h: 100, mainAlign: 'end' }), [item('a', { main: 20 })])
    expect(out[0].rect.y).toBe(80)
  })

  it('space-between pushes children to the extremes', () => {
    const out = solveStack(box({ h: 100, mainAlign: 'space-between' }),
      [item('a', { main: 20 }), item('b', { main: 20 })])
    expect(out[0].rect.y).toBe(0)
    expect(out[1].rect.y).toBe(80)
  })

  it('cross start/center/end honor intrinsic cross size', () => {
    const start = solveStack(box({ crossAlign: 'start' }), [item('a', { cross: 40, crossMode: 'hug' })])
    expect(start[0].rect).toMatchObject({ x: 0, w: 40 })
    const center = solveStack(box({ crossAlign: 'center' }), [item('a', { cross: 40, crossMode: 'hug' })])
    expect(center[0].rect).toMatchObject({ x: 30, w: 40 })
    const end = solveStack(box({ crossAlign: 'end' }), [item('a', { cross: 40, crossMode: 'hug' })])
    expect(end[0].rect).toMatchObject({ x: 60, w: 40 })
  })

  it('cross stretch fills the cross extent', () => {
    const out = solveStack(box({ crossAlign: 'start' }), [item('a', { cross: 40, crossMode: 'stretch' })])
    expect(out[0].rect).toMatchObject({ x: 0, w: 100 })
  })

  it('lays out horizontally on the x axis', () => {
    const out = solveStack(box({ direction: 'horizontal', w: 100 }),
      [item('a', { main: 30 }), item('b', { main: 30 })])
    expect(out[0].rect).toMatchObject({ x: 0, w: 30 })
    expect(out[1].rect).toMatchObject({ x: 30, w: 30 })
  })

  it('handles empty children', () => {
    expect(solveStack(box(), [])).toEqual([])
  })

  it('never makes fill negative when content overflows', () => {
    const out = solveStack(box({ h: 30 }),
      [item('a', { main: 40, mainMode: 'fixed' }), item('b', { mainMode: 'fill' })])
    expect(out[1].rect.h).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/template-grid-autolayout.unit.spec.ts`
Expected: FAIL — cannot find module `autolayout`.

- [ ] **Step 3: Implement the solver**

```ts
// frontend/shared/template-grid/autolayout.ts
/** Pure single-axis flexbox solver for auto-layout Stacks. Works entirely in
 * px — the caller (resolver) converts fine-grid cell units to px and measures
 * text/intrinsic sizes before calling. No grid, text, or DOM dependency. */

import type { Rect } from './grid'
import type { CrossAlign, LayoutAxis, MainAlign, SizeMode } from './types'

export interface StackItem {
  id: string
  /** Intrinsic main-axis extent (px) for hug/fixed; ignored for fill. */
  main: number
  /** Intrinsic cross-axis extent (px) for non-stretch cross modes. */
  cross: number
  mainMode: SizeMode
  crossMode: SizeMode
}

export interface StackBox {
  x: number; y: number; w: number; h: number
  direction: LayoutAxis
  padTop: number; padRight: number; padBottom: number; padLeft: number
  gap: number
  mainAlign: MainAlign
  crossAlign: CrossAlign
}

export function solveStack(box: StackBox, items: StackItem[]): Array<{ id: string; rect: Rect }> {
  if (!items.length) return []
  const horiz = box.direction === 'horizontal'
  const innerX = box.x + box.padLeft
  const innerY = box.y + box.padTop
  const innerW = Math.max(0, box.w - box.padLeft - box.padRight)
  const innerH = Math.max(0, box.h - box.padTop - box.padBottom)
  const mainTotal = horiz ? innerW : innerH
  const crossTotal = horiz ? innerH : innerW
  const crossOrigin = horiz ? innerY : innerX

  const n = items.length
  const fillCount = items.filter(i => i.mainMode === 'fill').length
  const fixedHugSum = items.filter(i => i.mainMode !== 'fill').reduce((s, i) => s + i.main, 0)
  const gapsTotal = box.gap * (n - 1)
  const leftover = mainTotal - fixedHugSum - gapsTotal
  const fillEach = fillCount ? Math.max(0, leftover / fillCount) : 0

  const mainExtent = (i: StackItem) => (i.mainMode === 'fill' ? fillEach : i.main)
  const usedMain = items.reduce((s, i) => s + mainExtent(i), 0) + gapsTotal

  // space-between distributes free space into the gaps; other aligns shift the block.
  let cursor = 0
  let gap = box.gap
  if (box.mainAlign === 'space-between' && n > 1) {
    const free = mainTotal - items.reduce((s, i) => s + mainExtent(i), 0)
    gap = Math.max(0, free / (n - 1))
  } else if (box.mainAlign === 'center') {
    cursor = (mainTotal - usedMain) / 2
  } else if (box.mainAlign === 'end') {
    cursor = mainTotal - usedMain
  }

  return items.map((it) => {
    const m = mainExtent(it)
    const c = it.crossMode === 'stretch' ? crossTotal : Math.min(it.cross, crossTotal)
    let crossPos = crossOrigin
    if (it.crossMode !== 'stretch') {
      if (box.crossAlign === 'center') crossPos = crossOrigin + (crossTotal - c) / 2
      else if (box.crossAlign === 'end') crossPos = crossOrigin + (crossTotal - c)
    }
    const mainPos = (horiz ? innerX : innerY) + cursor
    cursor += m + gap
    const rect: Rect = horiz
      ? { x: mainPos, y: crossPos, w: m, h: c }
      : { x: crossPos, y: mainPos, w: c, h: m }
    return { id: it.id, rect }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/template-grid-autolayout.unit.spec.ts`
Expected: PASS (all 13 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/autolayout.ts frontend/tests/unit/template-grid-autolayout.unit.spec.ts
git commit -m "feat(smart-layout): pure single-axis stack solver"
```

---

### Task 3: Resolver integration — Stacks render in the layout

Branch the v3 section block in `resolveFormat`: layout-bearing sections build `StackItem[]` (converting cells→px, measuring text/intrinsic sizes), call `solveStack`, then `fitElementAtRect`. Layout-less sections keep the existing proportional projection.

**Files:**
- Modify: `frontend/shared/template-grid/resolve.ts:172-198` (the `if (isV3(template))` block)
- Test: `frontend/tests/unit/template-grid-stack-resolve.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `solveStack`, `StackItem`, `StackBox` (Task 2); `isLayoutStack` (Task 1); existing `regionToRect`, `gridMetrics`, `wrapLines`, `typeSize`, `resolveTokens`, `fitElementAtRect`, `sectionRegionFor`.
- Produces: layout sections contribute `ResolvedElement[]` exactly like proportional sections (so the renderer/editor are unchanged downstream).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/template-grid-stack-resolve.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { resolveFormat } from '../../shared/template-grid/resolve'
import type { TemplateV3 } from '../../shared/template-grid/types'

function tpl(layout?: TemplateV3['sections'][0]['layout']): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 },
    typeScale: { base: 16, ratio: 1.25 },
    elements: [],
    sections: [{
      id: 's1', name: 'stack',
      region: { col: 1, colSpan: 10, row: 1, rowSpan: 20 },
      layout,
      children: [
        { id: 'a', type: 'shape', shape: 'rect', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 4 } },
        { id: 'b', type: 'shape', shape: 'rect', priority: 2, region: { col: 1, colSpan: 4, row: 6, rowSpan: 4 } },
      ],
    }],
  }
}

describe('resolveFormat — auto-layout stacks', () => {
  it('stacks children vertically (b below a) when layout present', () => {
    const r = resolveFormat(tpl({
      direction: 'vertical', padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0, mainAlign: 'start', crossAlign: 'stretch',
    }), 'sq')
    const a = r.elements.find(e => e.el.id === 'a')!
    const b = r.elements.find(e => e.el.id === 'b')!
    expect(a.culled).toBe(false)
    expect(b.rect.y).toBeGreaterThanOrEqual(a.rect.y + a.rect.h - 0.01) // b starts at/after a's bottom
    expect(a.rect.x).toBeCloseTo(b.rect.x) // cross stretch → same x
  })

  it('layout-less section is byte-identical to today (proportional projection)', () => {
    const withoutLayout = resolveFormat(tpl(undefined), 'sq')
    // snapshot the resolved child rects so any change to the existing path is caught
    const rects = withoutLayout.elements.map(e => ({ id: e.el.id, ...e.rect }))
    expect(rects).toMatchSnapshot()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/template-grid-stack-resolve.unit.spec.ts`
Expected: FAIL on the first test (children not stacked — current path projects them at their original regions). The snapshot test writes a baseline (passes/creates snapshot).

- [ ] **Step 3: Implement the branch**

In `resolve.ts`, update imports:

```ts
import { isV3, isLayoutStack } from './types'
import { solveStack } from './autolayout'
import type { StackBox, StackItem } from './autolayout'
```

Replace the inner `for (const section of template.sections)` body so it branches. Add this helper above `resolveFormat` (after `fitElementAtRect`):

```ts
/** Build StackItems for a layout section at the current metrics, measuring
 * text height for hug. Single-format (Slice 1): child regions are in this
 * format's grid, so regionToRect(child.region, m) is exact. */
function stackItemsFor(
  section: { children: ElementV2[]; layout: NonNullable<ElementV2['layoutSizing']> | unknown },
  children: ElementV2[],
  m: GridMetrics,
  innerCrossPx: number,
  direction: 'horizontal' | 'vertical',
  ctx: { template: AnyGridTemplate; formatKey: string },
  props: TokenScope, brand: TokenScope,
): StackItem[] {
  return children.map((child) => {
    const r = regionToRect(child.region, m)
    const sizing = child.layoutSizing
      ?? (child.type === 'text'
        ? { main: 'hug' as const, cross: 'fill' as const }
        : { main: 'fixed' as const, cross: 'fill' as const })
    let main = direction === 'horizontal' ? r.w : r.h
    const cross = direction === 'horizontal' ? r.h : r.w
    if (child.type === 'text' && sizing.main === 'hug') {
      const lineHeight = child.style?.lineHeight ?? 1.1
      let content = String(resolveTokens(child.content, props, brand) ?? '')
      if (child.style?.transform === 'uppercase') content = content.toUpperCase()
      const fontSize = typeSize(child.level, ctx.template, ctx.formatKey, child.style?.fontSize)
      const measureW = sizing.cross === 'stretch' && direction === 'vertical' ? innerCrossPx : (direction === 'horizontal' ? Infinity : r.w)
      const lines = wrapLines(content, fontSize, measureW)
      main = lines.length * fontSize * lineHeight
    }
    return { id: child.id, main, cross, mainMode: sizing.main, crossMode: sizing.cross }
  })
}
```

Then in the section loop, branch:

```ts
    for (const section of template.sections) {
      const sectionHidden = section.hidden || section.overrides?.[oid]?.hidden
      const sectionRegion = sectionRegionFor(template, section, formatKey, oid)
      const sectionRectTarget = regionToRect(sectionRegion, m)

      if (isLayoutStack(section) && section.layout) {
        const lay = section.layout
        const visible = section.children.filter(c => !(sectionHidden || c.hidden || c.overrides?.[oid]?.hidden))
        // push hidden children as culled (parity with the proportional path)
        for (const c of section.children) {
          if (sectionHidden || c.hidden || c.overrides?.[oid]?.hidden) {
            elements.push({ el: c, region: null, rect: ZERO_RECT, culled: true, cullReason: 'hidden' })
          }
        }
        const padPx = {
          top: lay.padding.top * m.cellH, bottom: lay.padding.bottom * m.cellH,
          left: lay.padding.left * m.cellW, right: lay.padding.right * m.cellW,
        }
        const innerCrossPx = lay.direction === 'vertical'
          ? sectionRectTarget.w - padPx.left - padPx.right
          : sectionRectTarget.h - padPx.top - padPx.bottom
        const items = stackItemsFor(section, visible, m, innerCrossPx, lay.direction,
          { template, formatKey }, props, brand)
        const box: StackBox = {
          x: sectionRectTarget.x, y: sectionRectTarget.y, w: sectionRectTarget.w, h: sectionRectTarget.h,
          direction: lay.direction, gap: lay.gap * (lay.direction === 'vertical' ? m.cellH : m.cellW),
          padTop: padPx.top, padRight: padPx.right, padBottom: padPx.bottom, padLeft: padPx.left,
          mainAlign: lay.mainAlign, crossAlign: lay.crossAlign,
        }
        const placed = solveStack(box, items)
        const rectById = new Map(placed.map(p => [p.id, p.rect]))
        for (const child of visible) {
          const rect = rectById.get(child.id)!
          elements.push(fitElementAtRect(child, child.region, rect, ctx, props, brand, false))
        }
        continue
      }

      // --- existing proportional projection (unchanged) ---
      const masterMetrics = gridMetrics(template, template.master)
      const sectionRectMaster = regionToRect(section.region, masterMetrics)
      for (const child of section.children) {
        if (sectionHidden || child.hidden || child.overrides?.[oid]?.hidden) {
          elements.push({ el: child, region: null, rect: ZERO_RECT, culled: true, cullReason: 'hidden' })
          continue
        }
        const childMaster = regionToRect(child.region, masterMetrics)
        const nx = sectionRectMaster.w ? (childMaster.x - sectionRectMaster.x) / sectionRectMaster.w : 0
        const ny = sectionRectMaster.h ? (childMaster.y - sectionRectMaster.y) / sectionRectMaster.h : 0
        const nw = sectionRectMaster.w ? childMaster.w / sectionRectMaster.w : 1
        const nh = sectionRectMaster.h ? childMaster.h / sectionRectMaster.h : 1
        const childRect: Rect = {
          x: sectionRectTarget.x + nx * sectionRectTarget.w,
          y: sectionRectTarget.y + ny * sectionRectTarget.h,
          w: nw * sectionRectTarget.w,
          h: nh * sectionRectTarget.h,
        }
        elements.push(fitElementAtRect(child, child.region, childRect, ctx, props, brand, false))
      }
    }
```

Note: the `masterMetrics` line moved inside the proportional branch (it's only needed there). Remove the now-duplicate `const masterMetrics = gridMetrics(...)` that sat above the loop.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/template-grid-stack-resolve.unit.spec.ts`
Expected: PASS (stacking test passes; snapshot stable).

Also run the existing section + resolve suites to prove zero regressions:

Run: `cd frontend && npx vitest run tests/unit/template-grid-sections.unit.spec.ts tests/unit/template-grid-resolve.unit.spec.ts`
Expected: PASS (no changes).

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/resolve.ts frontend/tests/unit/template-grid-stack-resolve.unit.spec.ts frontend/tests/unit/__snapshots__/template-grid-stack-resolve.unit.spec.ts.snap
git commit -m "feat(smart-layout): resolver renders auto-layout stacks"
```

---

### Task 4: Pure template ops — wrap in stack, edit layout, reparent

The editor's actions as pure functions on `TemplateV3`: create a Stack from selected elements (seeding sizing), set/patch a Stack's `layout`, and move children in/out.

**Files:**
- Modify: `frontend/shared/template-grid/sections.ts`
- Test: `frontend/tests/unit/template-grid-stack-ops.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `groupIntoSection`, `boundingRegion`, `clone` (existing in `sections.ts`); `AutoLayout`, `SizeMode`.
- Produces:
  - `DEFAULT_AUTOLAYOUT: AutoLayout`
  - `wrapInStack(t: TemplateV3, elementIds: string[], name?: string): TemplateV3`
  - `setStackLayout(t: TemplateV3, sectionId: string, patch: Partial<AutoLayout>): TemplateV3`
  - `setChildSizing(t: TemplateV3, sectionId: string, childId: string, sizing: { main: SizeMode; cross: SizeMode }): TemplateV3`
  - `addChildToStack(t: TemplateV3, sectionId: string, elementId: string): TemplateV3`
  - `removeChildFromStack(t: TemplateV3, sectionId: string, childId: string): TemplateV3`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/tests/unit/template-grid-stack-ops.unit.spec.ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTOLAYOUT, addChildToStack, removeChildFromStack,
  setChildSizing, setStackLayout, wrapInStack,
} from '../../shared/template-grid/sections'
import type { TemplateV3 } from '../../shared/template-grid/types'

function base(): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 }, typeScale: { base: 16, ratio: 1.25 },
    elements: [
      { id: 'a', type: 'text', content: 'A', level: 'headline', priority: 1, region: { col: 1, colSpan: 6, row: 1, rowSpan: 2 } },
      { id: 'b', type: 'shape', shape: 'rect', priority: 2, region: { col: 1, colSpan: 6, row: 3, rowSpan: 2 } },
    ],
    sections: [],
  }
}

describe('stack ops', () => {
  it('wrapInStack creates a layout section with default layout + seeded sizing', () => {
    const t = wrapInStack(base(), ['a', 'b'])
    expect(t.sections).toHaveLength(1)
    expect(t.elements).toHaveLength(0)
    expect(t.sections[0].layout).toEqual(DEFAULT_AUTOLAYOUT)
    const a = t.sections[0].children.find(c => c.id === 'a')!
    const b = t.sections[0].children.find(c => c.id === 'b')!
    expect(a.layoutSizing).toEqual({ main: 'hug', cross: 'fill' })   // text
    expect(b.layoutSizing).toEqual({ main: 'fixed', cross: 'fill' }) // shape
  })

  it('setStackLayout patches direction without dropping other fields', () => {
    const t0 = wrapInStack(base(), ['a'])
    const sid = t0.sections[0].id
    const t2 = setStackLayout(t0, sid, { direction: 'horizontal' })
    expect(t2.sections[0].layout!.direction).toBe('horizontal')
    expect(t2.sections[0].layout!.gap).toBe(DEFAULT_AUTOLAYOUT.gap)
  })

  it('setChildSizing updates one child', () => {
    const t0 = wrapInStack(base(), ['a', 'b'])
    const sid = t0.sections[0].id
    const t = setChildSizing(t0, sid, 'b', { main: 'fill', cross: 'fill' })
    expect(t.sections[0].children.find(c => c.id === 'b')!.layoutSizing).toEqual({ main: 'fill', cross: 'fill' })
  })

  it('addChildToStack moves an ungrouped element in and seeds sizing', () => {
    let t = wrapInStack(base(), ['a'])    // a in a stack, b still ungrouped
    const sid = t.sections[0].id
    t = addChildToStack(t, sid, 'b')
    expect(t.elements).toHaveLength(0)
    expect(t.sections[0].children.map(c => c.id)).toEqual(['a', 'b'])
    expect(t.sections[0].children.find(c => c.id === 'b')!.layoutSizing).toEqual({ main: 'fixed', cross: 'fill' })
  })

  it('removeChildFromStack returns a child to ungrouped elements', () => {
    const t0 = wrapInStack(base(), ['a', 'b'])
    const sid = t0.sections[0].id
    const t = removeChildFromStack(t0, sid, 'b')
    expect(t.sections[0].children.map(c => c.id)).toEqual(['a'])
    expect(t.elements.map(e => e.id)).toEqual(['b'])
  })

  it('does not mutate the input template', () => {
    const input = base()
    wrapInStack(input, ['a', 'b'])
    expect(input.sections).toHaveLength(0)
    expect(input.elements).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/template-grid-stack-ops.unit.spec.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement the ops**

Append to `frontend/shared/template-grid/sections.ts` (it already has `clone`, `groupIntoSection`, `boundingRegion`):

```ts
import type { AutoLayout, SizeMode, TemplateV3 } from './types'

export const DEFAULT_AUTOLAYOUT: AutoLayout = {
  direction: 'vertical',
  padding: { top: 2, right: 2, bottom: 2, left: 2 },
  gap: 1,
  mainAlign: 'start',
  crossAlign: 'stretch',
}

/** Default child sizing by element type (text hugs its content). */
function seedSizing(el: ElementV2): { main: SizeMode; cross: SizeMode } {
  return el.type === 'text' ? { main: 'hug', cross: 'fill' } : { main: 'fixed', cross: 'fill' }
}

/** Group elements into a NEW auto-layout Stack (default layout + seeded child
 * sizing). Builds on groupIntoSection, then attaches layout + sizing. */
export function wrapInStack(t: TemplateV3, elementIds: string[], name = 'Stack'): TemplateV3 {
  const grouped = groupIntoSection(t, elementIds, name)
  const section = grouped.sections[grouped.sections.length - 1]
  if (!section || section.children.length === 0) return t   // nothing grouped
  section.layout = clone(DEFAULT_AUTOLAYOUT)
  section.children = section.children.map(c => ({ ...c, layoutSizing: c.layoutSizing ?? seedSizing(c) }))
  return grouped
}

export function setStackLayout(t: TemplateV3, sectionId: string, patch: Partial<AutoLayout>): TemplateV3 {
  const next = clone(t)
  const s = next.sections.find(sec => sec.id === sectionId)
  if (!s || !s.layout) return t
  s.layout = { ...s.layout, ...patch, padding: { ...s.layout.padding, ...(patch.padding ?? {}) } }
  return next
}

export function setChildSizing(
  t: TemplateV3, sectionId: string, childId: string, sizing: { main: SizeMode; cross: SizeMode },
): TemplateV3 {
  const next = clone(t)
  const child = next.sections.find(s => s.id === sectionId)?.children.find(c => c.id === childId)
  if (!child) return t
  child.layoutSizing = sizing
  return next
}

export function addChildToStack(t: TemplateV3, sectionId: string, elementId: string): TemplateV3 {
  const next = clone(t)
  const s = next.sections.find(sec => sec.id === sectionId)
  const idx = next.elements.findIndex(e => e.id === elementId)
  if (!s || idx < 0) return t
  const [el] = next.elements.splice(idx, 1)
  el.layoutSizing = el.layoutSizing ?? seedSizing(el)
  s.children.push(el)
  return next
}

export function removeChildFromStack(t: TemplateV3, sectionId: string, childId: string): TemplateV3 {
  const next = clone(t)
  const s = next.sections.find(sec => sec.id === sectionId)
  if (!s) return t
  const idx = s.children.findIndex(c => c.id === childId)
  if (idx < 0) return t
  const [child] = s.children.splice(idx, 1)
  delete child.layoutSizing
  next.elements.push(child)
  return next
}
```

(Add `ElementV2` to the existing type import at the top of `sections.ts` if not already present — it is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/template-grid-stack-ops.unit.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/template-grid/sections.ts frontend/tests/unit/template-grid-stack-ops.unit.spec.ts
git commit -m "feat(smart-layout): pure ops for wrap-in-stack, layout edits, reparent"
```

---

### Task 5: Editor composable — expose stack ops + inspector state

Wire the pure ops into `useGridEditor` so the canvas/inspector can call them and re-render.

**Files:**
- Modify: `frontend/app/composables/useGridEditor.ts`
- Test: `frontend/tests/unit/use-grid-editor-stacks.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `wrapInStack`, `setStackLayout`, `setChildSizing`, `addChildToStack`, `removeChildFromStack`, `DEFAULT_AUTOLAYOUT` (Task 4); existing `template` ref, `selectedIds`, `isV3Mode`, `convertToV3`.
- Produces (added to the composable's return): `wrapSelectionInStack()`, `updateStackLayout(sectionId, patch)`, `updateChildSizing(sectionId, childId, sizing)`, `moveChildIntoStack(sectionId, elementId)`, `moveChildOutOfStack(sectionId, childId)`, `selectedStack` (computed: the selected section if it has `layout`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/use-grid-editor-stacks.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { useGridEditor } from '../../app/composables/useGridEditor'
import type { TemplateV3 } from '../../shared/template-grid/types'

function v3(): TemplateV3 {
  return {
    version: 3, id: 't', name: 't', master: 'sq', formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 0, margin: 40, baseline: 40 }, typeScale: { base: 16, ratio: 1.25 },
    elements: [
      { id: 'a', type: 'text', content: 'A', level: 'headline', priority: 1, region: { col: 1, colSpan: 6, row: 1, rowSpan: 2 } },
      { id: 'b', type: 'shape', shape: 'rect', priority: 2, region: { col: 1, colSpan: 6, row: 3, rowSpan: 2 } },
    ],
    sections: [],
  }
}

describe('useGridEditor — stacks', () => {
  it('wrapSelectionInStack groups the current selection into a Stack', () => {
    const ed = useGridEditor(v3())
    ed.selectIds(['a', 'b'])
    ed.wrapSelectionInStack()
    const t = ed.template.value as TemplateV3
    expect(t.sections).toHaveLength(1)
    expect(t.sections[0].layout?.direction).toBe('vertical')
  })

  it('updateStackLayout patches the layout reactively', () => {
    const ed = useGridEditor(v3())
    ed.selectIds(['a'])
    ed.wrapSelectionInStack()
    const sid = (ed.template.value as TemplateV3).sections[0].id
    ed.updateStackLayout(sid, { direction: 'horizontal' })
    expect((ed.template.value as TemplateV3).sections[0].layout?.direction).toBe('horizontal')
  })
})
```

(If the composable's selection setter is named differently than `selectIds`/`selectedIds`, match the existing names — check `useGridEditor.ts` and adapt the test + calls. The existing `groupSelectedInto` shows the selection accessor to reuse.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/use-grid-editor-stacks.unit.spec.ts`
Expected: FAIL — `wrapSelectionInStack` not a function.

- [ ] **Step 3: Implement in `useGridEditor.ts`**

Add imports:

```ts
import {
  addChildToStack, removeChildFromStack, setChildSizing, setStackLayout, wrapInStack,
} from '../../shared/template-grid/sections'
import type { AutoLayout, SizeMode, TemplateV3 } from '../../shared/template-grid/types'
import { isLayoutStack } from '../../shared/template-grid/types'
```

Add functions near the existing `groupSelectedInto` (reuse its selection accessor + the helper that assigns `template.value`; mirror its `convertToV3()` guard so wrapping works even from a v2 template):

```ts
function wrapSelectionInStack() {
  const ids = [...selectedIds.value]            // match the existing accessor name
  if (ids.length === 0) return
  if (!isV3(template.value)) convertToV3()
  template.value = wrapInStack(template.value as TemplateV3, ids)
  selectedSectionId.value = (template.value as TemplateV3).sections.at(-1)?.id ?? null
}
function updateStackLayout(sectionId: string, patch: Partial<AutoLayout>) {
  template.value = setStackLayout(template.value as TemplateV3, sectionId, patch)
}
function updateChildSizing(sectionId: string, childId: string, sizing: { main: SizeMode; cross: SizeMode }) {
  template.value = setChildSizing(template.value as TemplateV3, sectionId, childId, sizing)
}
function moveChildIntoStack(sectionId: string, elementId: string) {
  template.value = addChildToStack(template.value as TemplateV3, sectionId, elementId)
}
function moveChildOutOfStack(sectionId: string, childId: string) {
  template.value = removeChildFromStack(template.value as TemplateV3, sectionId, childId)
}

const selectedStack = computed(() => {
  const s = sections.value.find(sec => sec.id === selectedSectionId.value)
  return s && isLayoutStack(s) ? s : null
})
```

Add all six names to the composable's `return { ... }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/use-grid-editor-stacks.unit.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useGridEditor.ts frontend/tests/unit/use-grid-editor-stacks.unit.spec.ts
git commit -m "feat(smart-layout): expose stack ops on the grid editor composable"
```

---

### Task 6: Editor UI — Stack tool, inspector, drag-reparent, live re-layout

The user-facing surface. Component code is shown for the new inspector and the key handlers; layout/preview already flow through the resolver from Tasks 1–3, so the canvas re-renders automatically when `template` mutates.

**Files:**
- Create: `frontend/app/components/templates/StackInspector.vue`
- Modify: `frontend/app/components/templates/GridEditorShell.vue` (toolbar: add "Stack" button)
- Modify: `frontend/app/components/templates/GridPropertyPanel.vue` (mount `StackInspector` when `selectedStack` is set)
- Modify: `frontend/app/components/templates/GridEditorCanvas.vue` (drag-reparent: drop an element onto a Stack box)

**Interfaces:**
- Consumes: `wrapSelectionInStack`, `updateStackLayout`, `updateChildSizing`, `moveChildIntoStack`, `moveChildOutOfStack`, `selectedStack`, `resolvedSections` (Task 5).

- [ ] **Step 1: Build the Stack inspector**

```vue
<!-- frontend/app/components/templates/StackInspector.vue -->
<script setup lang="ts">
import type { AutoLayout, SectionV3, SizeMode } from '../../../shared/template-grid/types'

const props = defineProps<{ stack: SectionV3 }>()
const emit = defineEmits<{
  (e: 'patch', patch: Partial<AutoLayout>): void
  (e: 'childSizing', childId: string, sizing: { main: SizeMode; cross: SizeMode }): void
}>()

const lay = () => props.stack.layout!
const MAIN = ['start', 'center', 'end', 'space-between'] as const
const CROSS = ['start', 'center', 'end', 'stretch'] as const
const SIZES: SizeMode[] = ['hug', 'fill', 'fixed']
</script>

<template>
  <div class="stack-inspector space-y-3 text-sm">
    <div class="flex gap-2">
      <button :class="{ active: lay().direction === 'vertical' }" @click="emit('patch', { direction: 'vertical' })">Vertical</button>
      <button :class="{ active: lay().direction === 'horizontal' }" @click="emit('patch', { direction: 'horizontal' })">Horizontal</button>
    </div>

    <label>Gap
      <input type="range" min="0" max="12" :value="lay().gap"
        @input="emit('patch', { gap: +($event.target as HTMLInputElement).value })" />
    </label>

    <label>Padding
      <input type="range" min="0" max="12" :value="lay().padding.top"
        @input="emit('patch', { padding: { top: +($event.target as HTMLInputElement).value, right: +($event.target as HTMLInputElement).value, bottom: +($event.target as HTMLInputElement).value, left: +($event.target as HTMLInputElement).value } })" />
    </label>

    <div>
      <span class="block opacity-60">Align (main)</span>
      <div class="flex flex-wrap gap-1">
        <button v-for="a in MAIN" :key="a" :class="{ active: lay().mainAlign === a }" @click="emit('patch', { mainAlign: a })">{{ a }}</button>
      </div>
    </div>
    <div>
      <span class="block opacity-60">Align (cross)</span>
      <div class="flex flex-wrap gap-1">
        <button v-for="a in CROSS" :key="a" :class="{ active: lay().crossAlign === a }" @click="emit('patch', { crossAlign: a })">{{ a }}</button>
      </div>
    </div>

    <div class="space-y-1">
      <span class="block opacity-60">Children sizing</span>
      <div v-for="c in stack.children" :key="c.id" class="flex items-center gap-2">
        <span class="w-16 truncate">{{ c.role || c.type }}</span>
        <select :value="c.layoutSizing?.main || 'fixed'"
          @change="emit('childSizing', c.id, { main: ($event.target as HTMLSelectElement).value as SizeMode, cross: c.layoutSizing?.cross || 'fill' })">
          <option v-for="s in SIZES" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
button { @apply px-2 py-1 rounded border border-white/10 opacity-70; }
button.active { @apply opacity-100 border-white/40 bg-white/5; }
</style>
```

> Reviewer: ensure no purple accents per house style; the active state uses white opacity.

- [ ] **Step 2: Mount it in the property panel**

In `GridPropertyPanel.vue`, import `StackInspector` and the composable's `selectedStack` + handlers (passed via props or injected the same way the panel already receives editor state). Render:

```vue
<StackInspector
  v-if="selectedStack"
  :stack="selectedStack"
  @patch="patch => updateStackLayout(selectedStack.id, patch)"
  @childSizing="(childId, sizing) => updateChildSizing(selectedStack.id, childId, sizing)"
/>
```

- [ ] **Step 3: Add the Stack toolbar button**

In `GridEditorShell.vue` toolbar (next to Text/Image/Shape), add a button enabled when ≥1 element is selected:

```vue
<button :disabled="selectedIds.length === 0" title="Wrap selection in a Stack" @click="wrapSelectionInStack">Stack</button>
```

- [ ] **Step 4: Drag-reparent on the canvas**

In `GridEditorCanvas.vue`, on element drag-end, hit-test the pointer against each `resolvedSections` box; if it lands inside a Stack section that isn't the element's current parent, call `moveChildIntoStack(sectionId, elementId)`; if an existing child is dragged outside its Stack box, call `moveChildOutOfStack(sectionId, childId)`. Reuse the existing pointer-position + section-rect helpers already used by the section move/resize overlay (`onSectionPointerDown`).

```ts
function handleElementDropReparent(elementId: string, pointer: { x: number; y: number }) {
  const hit = resolvedSections.value.find(s => s.layout && pointInRect(pointer, s.rect))
  if (hit) { moveChildIntoStack(hit.id, elementId); return }
  const parent = sections.value.find(s => s.children.some(c => c.id === elementId))
  if (parent) moveChildOutOfStack(parent.id, elementId)
}
```

- [ ] **Step 5: Verify the build + types**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | head -30` (or the project's typecheck script)
Expected: no new errors in the touched files.

Run the full unit suite to confirm nothing regressed:
Run: `cd frontend && npx vitest run`
Expected: all green except the 2 known pre-existing spacetime-palette failures (per memory).

- [ ] **Step 6: In-app Playwright screenshot sign-off**

Start the dev server (`cd frontend && npm run dev` — note it may bump 3001→3002). Open the Smart Layout editor (or `/dev/v3editor`). Then drive Playwright (screenshot against the live port, per the v3 gotcha):
1. Add two text elements + a shape.
2. Select them → click **Stack** → screenshot (expect a vertical stack, evenly gapped).
3. Toggle direction → **Horizontal** → screenshot (expect side-by-side).
4. Change main-align to **center**, cross to **center** → screenshot.
5. Set one child to **fill** → screenshot (expect it to absorb leftover space).
Save screenshots to the scratchpad; confirm the layout visually matches the solver's intent before declaring done. **Do not mark complete on unit tests alone** (house rule).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/templates/StackInspector.vue frontend/app/components/templates/GridEditorShell.vue frontend/app/components/templates/GridPropertyPanel.vue frontend/app/components/templates/GridEditorCanvas.vue
git commit -m "feat(smart-layout): Stack tool, inspector, and drag-reparent in the editor"
```

---

## Self-Review

**Spec coverage:**
- Stack model (direction/padding/gap/align/hug-fill-fixed) → Tasks 1 (schema), 2 (solver). ✓
- Text auto-fit/reflow (hug) → Task 3 (`stackItemsFor` measures text height). ✓
- Align & distribute → Task 2 (mainAlign/crossAlign/fill). ✓
- Additive / back-compat → Task 3 (snapshot test for layout-less sections). ✓
- Fine-grid-cell units, px solver → Task 3 (cells→px conversion) + Task 2 (px-only). ✓
- "Wrap in stack" + reparent + inspector → Tasks 4 (ops), 5 (composable), 6 (UI). ✓
- Stack tool replaces Group/Ungroup verbs → Task 6 toolbar. ✓
- Default Stack values → Task 4 `DEFAULT_AUTOLAYOUT`. ✓
- In-app screenshot sign-off → Task 6 Step 6. ✓
- Slice-2 non-goals (direction-flip by aspect, safe-area, per-format overrides, nesting) → not built. ✓

**Type consistency:** `AutoLayout`/`SizeMode`/`StackBox`/`StackItem`/`solveStack` names match across Tasks 1–3. `wrapInStack`/`setStackLayout`/`setChildSizing`/`addChildToStack`/`removeChildFromStack` consistent across Tasks 4–6. Composable adders (`wrapSelectionInStack` etc.) consistent across Tasks 5–6.

**Open adaptation note for the implementer:** Task 5/6 reference selection accessors (`selectedIds`, `selectedSectionId`, `selectIds`) and the template-assignment pattern by their likely names — confirm against the actual `useGridEditor.ts` and match its existing conventions (the existing `groupSelectedInto`/`ungroupSelectedSection` are the reference). This is the one place names must be verified live, not invented.
```
