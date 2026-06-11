# Smart Layout v2 — Swiss Grid Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace anchor/offset positioning with a Swiss modular-grid engine so one master layout deterministically reflows into social + IAB ad formats.

**Architecture:** A pure-TS resolver module in `frontend/shared/template-grid/` (single source of truth for all grid math) consumed by the satori render path (`server/templates/translate.ts`) and later by the editor. The Python node ships a v2 starter template with format presets; v1 templates keep the existing render path untouched.

**Tech Stack:** TypeScript (Nuxt 4 `shared/` folder), vitest (`tests/unit/*.unit.spec.ts`, run with `npm run test:unit`), satori + resvg (unchanged), Python ComfyUI node, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-06-10-smart-layout-swiss-grid-design.md`

**Scope note:** This plan delivers the engine, render path, Python node, and a minimal editor compatibility mode (server-rendered format previews + JSON editing for v2). The full visual grid editor (snap-to-cell drag, class tabs, focal picker, convert button UI) is a separate follow-up plan — the engine is shippable without it.

**Conventions:**
- All commands run from `/Users/julien/Documents/GitHub/ComfyNext/frontend` unless noted.
- Imports: inside `server/` use relative paths to `shared/`; inside `app/` and `tests/` use the `~~/` root alias.
- Commit after every green test run. Branch: `feat/smart-layout-swiss-grid`.

---

### Task 1: Shared types + token interpolation module

**Files:**
- Create: `frontend/shared/template-grid/types.ts`
- Create: `frontend/shared/template-grid/tokens.ts`
- Modify: `frontend/server/templates/schema.ts` (re-export v2 types, add `AnyTemplate`)
- Modify: `frontend/server/templates/translate.ts` (import `resolveTokens` from shared, delete local copy)
- Test: `frontend/tests/unit/template-grid-tokens.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/template-grid-tokens.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { resolveTokens } from '~~/shared/template-grid/tokens'

describe('resolveTokens', () => {
  it('substitutes props and brand scopes', () => {
    expect(resolveTokens('{{ props.headline }}', { headline: 'Brew bold' })).toBe('Brew bold')
    expect(resolveTokens('{{ brand.primary }}', {}, { primary: '#E2362B' })).toBe('#E2362B')
  })
  it('preserves type for whole-string tokens', () => {
    expect(resolveTokens('{{ props.count }}', { count: 42 })).toBe(42)
  })
  it('coerces mixed strings and blanks missing tokens', () => {
    expect(resolveTokens('Score: {{ props.count }}', { count: 42 })).toBe('Score: 42')
    expect(resolveTokens('x {{ props.missing }} y', {})).toBe('x  y')
  })
  it('returns non-strings untouched', () => {
    expect(resolveTokens(7, {})).toBe(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/template-grid-tokens.unit.spec.ts`
Expected: FAIL — cannot resolve `~~/shared/template-grid/tokens`

- [ ] **Step 3: Create `shared/template-grid/types.ts`**

```typescript
/**
 * Smart Layout schema v2 — Swiss modular grid.
 * Elements are placed by grid region (column/row spans), not anchor+offset.
 * See docs/superpowers/specs/2026-06-10-smart-layout-swiss-grid-design.md.
 */

export type FormatClass = 'square' | 'portrait' | 'landscape' | 'strip' | 'skyscraper'
export type TextLevel = 'caption' | 'body' | 'subhead' | 'headline' | 'display'
export type TextOverflow = 'shrink' | 'shrink-then-truncate' | 'grow'

export interface SafeArea { top: number; right: number; bottom: number; left: number }

export interface FormatSpec {
  w: number
  h: number
  label?: string
  class?: FormatClass            // explicit override; otherwise derived from w/h
  cols?: number                  // defaults per class
  rows?: number
  safeArea?: Partial<SafeArea>   // px insets reserved for platform UI chrome
}

// 1-based, inclusive spans: { col: 1, colSpan: 6 } fills columns 1..6.
export interface Region { col: number; colSpan: number; row: number; rowSpan: number }

export interface GridSpec { gutter: number; margin: number; baseline: number }  // master px
export interface TypeScaleSpec { base: number; ratio: number }                  // base = caption size, master px

export interface ElementV2Base {
  id: string
  role?: string                  // HEADLINE, LOGO, CTA, IMAGE_LAYER_1, …
  priority: number               // 1 = most important; drives slot assignment + culling
  region: Region                 // placement on the master grid
  regionByClass?: Partial<Record<FormatClass, Region>>
  overrides?: Record<string, { region?: Region }>   // per-format-key escape hatch
}

export interface TextStyleV2 {
  fontFamily?: string
  fontWeight?: 400 | 700
  color?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
  letterSpacing?: number
}

export interface TextElementV2 extends ElementV2Base {
  type: 'text'
  content: string                // supports {{ props.* }} / {{ brand.* }}
  level: TextLevel               // resolved via the type scale, never a raw px size
  overflow?: TextOverflow        // default 'shrink-then-truncate'
  maxLines?: number
  style?: TextStyleV2
}

export interface ImageElementV2 extends ElementV2Base {
  type: 'image'
  content: string
  focal?: { x: number; y: number }   // 0–1 cover-crop focus, default center
  collapse?: 'mark'                   // logo-style: render as centered square mark when small
  style?: { fit?: 'cover' | 'contain' | 'stretch'; borderRadius?: number }
}

export interface ShapeElementV2 extends ElementV2Base {
  type: 'shape'
  shape: 'rect' | 'circle'
  style?: { fill?: string; borderRadius?: number; borderColor?: string; borderWidth?: number }
}

export type ElementV2 = TextElementV2 | ImageElementV2 | ShapeElementV2

export interface TemplateV2 {
  version: 2
  id: string
  name: string
  master: string                          // key into formats; the design-time format
  formats: Record<string, FormatSpec>
  grid: GridSpec
  typeScale: TypeScaleSpec
  background?: { fill?: string; image?: string }
  elements: ElementV2[]
}
```

- [ ] **Step 4: Create `shared/template-grid/tokens.ts`** (moved verbatim from translate.ts so there is exactly one implementation)

```typescript
/** {{ props.x }} / {{ brand.y }} interpolation — single implementation shared
 * by the render path, the resolver (copy fitting), and the editor. */

export type TokenScope = Record<string, unknown>

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g

export function resolveTokens<T>(value: T, props: TokenScope = {}, brand: TokenScope = {}): T {
  if (typeof value !== 'string') return value
  const lookup = (path: string): unknown => {
    const [scope, key] = path.split('.')
    if (scope === 'props') return props[key]
    if (scope === 'brand') return brand[key]
    return undefined
  }
  const whole = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
  if (whole) {
    const v = lookup(whole[1])
    return (v ?? value) as unknown as T
  }
  return value.replace(TOKEN_RE, (_, path) => {
    const v = lookup(path)
    return v == null ? '' : String(v)
  }) as unknown as T
}
```

- [ ] **Step 5: Update `server/templates/schema.ts`** — append at the end:

```typescript
// ---------- Schema v2 (Swiss grid) ----------
// Types live in shared/ so the resolver, render path, and editor share one
// definition. Re-exported here so existing `~~/server/templates/schema`
// importers keep working.
export type {
  ElementV2, FormatClass, FormatSpec, GridSpec, ImageElementV2, Region,
  SafeArea, ShapeElementV2, TemplateV2, TextElementV2, TextLevel,
  TextOverflow, TypeScaleSpec,
} from '../../shared/template-grid/types'

export type AnyTemplate = Template | import('../../shared/template-grid/types').TemplateV2
```

- [ ] **Step 6: Update `server/templates/translate.ts`** — delete the local `TOKEN_RE` constant and `resolveTokens` function (lines 14–45), add to imports:

```typescript
import { resolveTokens } from '../../shared/template-grid/tokens'
```

- [ ] **Step 7: Run tests**

Run: `npm run test:unit -- tests/unit/template-grid-tokens.unit.spec.ts`
Expected: PASS (4 tests)
Run: `npx nuxt typecheck 2>/dev/null || npx vue-tsc --noEmit -p tsconfig.json` — if the project has no typecheck setup, skip; vitest import success is the gate.

- [ ] **Step 8: Commit**

```bash
git add shared/template-grid server/templates tests/unit/template-grid-tokens.unit.spec.ts
git commit -m "Smart Layout v2: shared schema types + token interpolation module"
```

---

### Task 2: Grid geometry — classification, metrics, rects, remap

**Files:**
- Create: `frontend/shared/template-grid/grid.ts`
- Test: `frontend/tests/unit/template-grid-geometry.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/template-grid-geometry.unit.spec.ts
import { describe, expect, it } from 'vitest'
import {
  classifyFormat, formatDims, gridMetrics, regionToRect, remapRegion,
} from '~~/shared/template-grid/grid'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const T: TemplateV2 = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: {
    '1x1':    { w: 1080, h: 1080 },
    '9x16':   { w: 1080, h: 1920, safeArea: { top: 270, bottom: 380 } },
    '728x90': { w: 728, h: 90 },
  },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  elements: [],
}

describe('classifyFormat', () => {
  it('classifies by ratio with spec boundaries', () => {
    expect(classifyFormat({ w: 1080, h: 1080 })).toBe('square')
    expect(classifyFormat({ w: 1080, h: 1350 })).toBe('square')      // 4:5 = 0.8 boundary
    expect(classifyFormat({ w: 300, h: 250 })).toBe('square')         // 1.2
    expect(classifyFormat({ w: 1080, h: 1920 })).toBe('portrait')     // 0.5625
    expect(classifyFormat({ w: 300, h: 600 })).toBe('portrait')       // 0.5
    expect(classifyFormat({ w: 1920, h: 1080 })).toBe('landscape')
    expect(classifyFormat({ w: 728, h: 90 })).toBe('strip')           // 8.09
    expect(classifyFormat({ w: 970, h: 250 })).toBe('strip')          // 3.88
    expect(classifyFormat({ w: 160, h: 600 })).toBe('skyscraper')     // 0.267
  })
  it('explicit class wins', () => {
    expect(classifyFormat({ w: 1080, h: 1080, class: 'strip' })).toBe('strip')
  })
})

describe('formatDims', () => {
  it('uses class defaults, allows overrides', () => {
    expect(formatDims({ w: 1080, h: 1080 })).toEqual({ cols: 6, rows: 6 })
    expect(formatDims({ w: 728, h: 90 })).toEqual({ cols: 12, rows: 1 })
    expect(formatDims({ w: 160, h: 600 })).toEqual({ cols: 3, rows: 10 })
    expect(formatDims({ w: 1080, h: 1080, cols: 12, rows: 8 })).toEqual({ cols: 12, rows: 8 })
  })
})

describe('gridMetrics', () => {
  it('computes master metrics: margins, gutters, cell sizes', () => {
    const m = gridMetrics(T, '1x1')
    expect(m.cols).toBe(6)
    expect(m.margin).toBe(72)
    expect(m.gutter).toBe(24)
    expect(m.originX).toBe(72)
    // inner = 1080 - 144 = 936; cells = (936 - 5*24)/6 = 136
    expect(m.cellW).toBeCloseTo(136, 5)
    expect(m.cellH).toBeCloseTo(136, 5)
  })
  it('scales metrics by min-dimension and applies safe areas', () => {
    const m = gridMetrics(T, '9x16')   // s = 1080/1080 = 1
    expect(m.originY).toBe(270 + 72)
    // innerH = 1920 - 270 - 380 - 144 = 1126; rows=8 → cellH = (1126 - 7*24)/8
    expect(m.cellH).toBeCloseTo((1126 - 7 * 24) / 8, 5)
  })
  it('floors gutter/margin on tiny formats', () => {
    const m = gridMetrics(T, '728x90')   // s = 90/1080 = 0.0833 → gutter 2, margin 6
    expect(m.gutter).toBeCloseTo(2, 5)
    expect(m.margin).toBeCloseTo(6, 5)
  })
})

describe('regionToRect', () => {
  it('maps a region to pixels on the master grid', () => {
    const m = gridMetrics(T, '1x1')
    const r = regionToRect({ col: 1, colSpan: 6, row: 4, rowSpan: 2 }, m)
    expect(r.x).toBe(72)
    expect(r.w).toBeCloseTo(936, 5)
    expect(r.y).toBeCloseTo(72 + 3 * (136 + 24), 5)
    expect(r.h).toBeCloseTo(2 * 136 + 24, 5)
  })
  it('clamps out-of-range regions instead of overflowing', () => {
    const m = gridMetrics(T, '1x1')
    const r = regionToRect({ col: 5, colSpan: 9, row: 1, rowSpan: 1 }, m)
    expect(r.x + r.w).toBeLessThanOrEqual(1080 - 72 + 0.001)
  })
})

describe('remapRegion', () => {
  it('remaps proportionally with rounding (6x6 → 4x8)', () => {
    const out = remapRegion(
      { col: 1, colSpan: 6, row: 4, rowSpan: 2 },
      { cols: 6, rows: 6 }, { cols: 4, rows: 8 },
    )
    expect(out).toEqual({ col: 1, colSpan: 4, row: 5, rowSpan: 3 })
  })
  it('is the identity on same dims', () => {
    const r = { col: 2, colSpan: 3, row: 1, rowSpan: 2 }
    expect(remapRegion(r, { cols: 6, rows: 6 }, { cols: 6, rows: 6 })).toEqual(r)
  })
  it('never produces zero spans', () => {
    const out = remapRegion(
      { col: 6, colSpan: 1, row: 1, rowSpan: 1 },
      { cols: 6, rows: 6 }, { cols: 3, rows: 1 },
    )
    expect(out.colSpan).toBeGreaterThanOrEqual(1)
    expect(out.col).toBeLessThanOrEqual(3)
    expect(out.rowSpan).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/template-grid-geometry.unit.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `shared/template-grid/grid.ts`**

```typescript
/** Grid geometry: format classification, metric scaling, region→pixel
 * resolution, and proportional remapping. Pure functions — the single source
 * of truth for both the renderer and the editor. */

import type { FormatClass, FormatSpec, Region, TemplateV2 } from './types'

export const CLASS_DEFAULTS: Record<FormatClass, { cols: number; rows: number; typeMultiplier: number }> = {
  skyscraper: { cols: 3,  rows: 10, typeMultiplier: 2 },
  portrait:   { cols: 4,  rows: 8,  typeMultiplier: 1 },
  square:     { cols: 6,  rows: 6,  typeMultiplier: 1 },
  landscape:  { cols: 8,  rows: 4,  typeMultiplier: 1 },
  strip:      { cols: 12, rows: 1,  typeMultiplier: 3 },
}

// Tunable constants — keep them here and only here.
export const FONT_FLOOR = 10     // px; absolute minimum rendered font size
export const MIN_GUTTER = 2      // px; scaled gutter never drops below this
export const MIN_MARGIN = 4      // px
export const MIN_VISIBLE = 24    // px; image/shape regions smaller than this are culled

export function classifyFormat(f: FormatSpec): FormatClass {
  if (f.class) return f.class
  const r = f.w / f.h
  if (r <= 0.35) return 'skyscraper'
  if (r < 0.8) return 'portrait'
  if (r <= 1.25) return 'square'
  if (r < 3.5) return 'landscape'
  return 'strip'
}

export function formatDims(f: FormatSpec): { cols: number; rows: number } {
  const d = CLASS_DEFAULTS[classifyFormat(f)]
  return { cols: f.cols ?? d.cols, rows: f.rows ?? d.rows }
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface GridMetrics {
  cols: number; rows: number
  originX: number; originY: number
  cellW: number; cellH: number
  gutter: number; margin: number; baseline: number
  scale: number
}

/** Metric scale factor relative to the master format: min-dimension ratio, so
 * width-bound text stays stable across portrait/landscape flips. */
export function metricScale(template: TemplateV2, f: FormatSpec): number {
  const master = template.formats[template.master]
  return Math.min(f.w, f.h) / Math.min(master.w, master.h)
}

export function gridMetrics(template: TemplateV2, formatKey: string): GridMetrics {
  const f = template.formats[formatKey]
  if (!f) throw new Error(`Unknown format '${formatKey}' on template '${template.id}'`)
  const s = metricScale(template, f)
  const gutter = Math.max(MIN_GUTTER, template.grid.gutter * s)
  const margin = Math.max(MIN_MARGIN, template.grid.margin * s)
  const baseline = Math.max(1, template.grid.baseline * s)
  const safe = { top: 0, right: 0, bottom: 0, left: 0, ...(f.safeArea ?? {}) }
  const { cols, rows } = formatDims(f)
  // Clamp so degenerate safe areas/margins can't push cells non-positive.
  const innerW = Math.max(cols, f.w - safe.left - safe.right - 2 * margin)
  const innerH = Math.max(rows, f.h - safe.top - safe.bottom - 2 * margin)
  return {
    cols, rows,
    originX: safe.left + margin,
    originY: safe.top + margin,
    cellW: (innerW - gutter * (cols - 1)) / cols,
    cellH: (innerH - gutter * (rows - 1)) / rows,
    gutter, margin, baseline, scale: s,
  }
}

export function regionToRect(region: Region, m: GridMetrics): Rect {
  const col = Math.min(m.cols, Math.max(1, Math.round(region.col)))
  const row = Math.min(m.rows, Math.max(1, Math.round(region.row)))
  const colSpan = Math.max(1, Math.min(m.cols - col + 1, Math.round(region.colSpan)))
  const rowSpan = Math.max(1, Math.min(m.rows - row + 1, Math.round(region.rowSpan)))
  return {
    x: m.originX + (col - 1) * (m.cellW + m.gutter),
    y: m.originY + (row - 1) * (m.cellH + m.gutter),
    w: colSpan * m.cellW + (colSpan - 1) * m.gutter,
    h: rowSpan * m.cellH + (rowSpan - 1) * m.gutter,
  }
}

/** Proportionally remap a region between grids of different dimensions.
 * Used between square/portrait/landscape only — strip and skyscraper get
 * default class layouts instead (see layouts.ts). */
export function remapRegion(
  r: Region,
  from: { cols: number; rows: number },
  to: { cols: number; rows: number },
): Region {
  const sc = to.cols / from.cols
  const sr = to.rows / from.rows
  const col = Math.min(to.cols, Math.max(1, Math.round((r.col - 1) * sc) + 1))
  const row = Math.min(to.rows, Math.max(1, Math.round((r.row - 1) * sr) + 1))
  return {
    col, row,
    colSpan: Math.max(1, Math.min(to.cols - col + 1, Math.round(r.colSpan * sc))),
    rowSpan: Math.max(1, Math.min(to.rows - row + 1, Math.round(r.rowSpan * sr))),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- tests/unit/template-grid-geometry.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/template-grid/grid.ts tests/unit/template-grid-geometry.unit.spec.ts
git commit -m "Smart Layout v2: grid geometry (classify, metrics, rects, remap)"
```

---

### Task 3: Type scale + copy fitting

**Files:**
- Create: `frontend/shared/template-grid/text.ts`
- Test: `frontend/tests/unit/template-grid-text.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/template-grid-text.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { fitText, typeSize, wrapLines } from '~~/shared/template-grid/text'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const T: TemplateV2 = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: {
    '1x1':    { w: 1080, h: 1080 },
    '728x90': { w: 728, h: 90 },
    '320x50': { w: 320, h: 50 },
    '160x600': { w: 160, h: 600 },
  },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  elements: [],
}

describe('typeSize', () => {
  it('resolves the modular scale on the master', () => {
    expect(typeSize('caption', T, '1x1')).toBe(28)
    expect(typeSize('body', T, '1x1')).toBe(Math.round(28 * 1.414))
    expect(typeSize('display', T, '1x1')).toBe(Math.round(28 * 1.414 ** 4))
  })
  it('applies min-dim scaling with strip/skyscraper multipliers', () => {
    // 728x90: s = 90/1080, strip multiplier 3 → display ≈ 28*1.414^4*0.0833*3 ≈ 28
    expect(typeSize('display', T, '728x90')).toBe(Math.round(28 * 1.414 ** 4 * (90 / 1080) * 3))
    // skyscraper multiplier 2
    expect(typeSize('display', T, '160x600')).toBe(Math.round(28 * 1.414 ** 4 * (160 / 1080) * 2))
  })
  it('never goes below the floor', () => {
    expect(typeSize('caption', T, '320x50')).toBeGreaterThanOrEqual(10)
  })
})

describe('wrapLines', () => {
  it('wraps greedily by estimated chars per line', () => {
    // 200px at 20px font → cpl = floor(200 / (20*0.55)) = 18
    const lines = wrapLines('single origin espresso delivered monthly', 20, 200)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(18)
  })
  it('hard-breaks overlong words', () => {
    const lines = wrapLines('a'.repeat(50), 20, 200)
    expect(lines.length).toBeGreaterThan(1)
  })
})

describe('fitText', () => {
  it('keeps the max size when copy fits', () => {
    const r = fitText({ content: 'Hi', maxFontSize: 80, w: 900, h: 200, lineHeight: 1.1, overflow: 'shrink' })
    expect(r.fontSize).toBe(80)
    expect(r.clipped).toBe(false)
  })
  it('shrinks long copy', () => {
    const long = 'word '.repeat(40).trim()
    const r = fitText({ content: long, maxFontSize: 80, w: 400, h: 120, lineHeight: 1.1, overflow: 'shrink' })
    expect(r.fontSize).toBeLessThan(80)
  })
  it('truncates with an ellipsis when even the floor overflows', () => {
    const long = 'word '.repeat(300).trim()
    const r = fitText({ content: long, maxFontSize: 80, w: 200, h: 40, lineHeight: 1.1, overflow: 'shrink-then-truncate' })
    expect(r.fontSize).toBe(10)
    expect(r.content.endsWith('…')).toBe(true)
    expect(r.clipped).toBe(false)
  })
  it('marks clipped under plain shrink when floor overflows', () => {
    const long = 'word '.repeat(300).trim()
    const r = fitText({ content: long, maxFontSize: 80, w: 200, h: 40, lineHeight: 1.1, overflow: 'shrink' })
    expect(r.clipped).toBe(true)
  })
  it('respects maxLines', () => {
    const long = 'word '.repeat(40).trim()
    const r = fitText({ content: long, maxFontSize: 30, w: 300, h: 500, lineHeight: 1.1, overflow: 'shrink-then-truncate', maxLines: 2 })
    expect(r.lines.length).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/template-grid-text.unit.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `shared/template-grid/text.ts`**

```typescript
/** Type scale resolution and estimate-based copy fitting. The estimate uses
 * an average glyph width (CHAR_W × fontSize) — deterministic and identical in
 * the editor and the renderer, which matters more than per-glyph accuracy.
 * Satori re-wraps at render time; fitting only decides size and truncation. */

import { CLASS_DEFAULTS, FONT_FLOOR, classifyFormat, metricScale } from './grid'
import type { TemplateV2, TextLevel, TextOverflow } from './types'

export const LEVELS: TextLevel[] = ['caption', 'body', 'subhead', 'headline', 'display']
export const CHAR_W = 0.55

export function typeSize(level: TextLevel, template: TemplateV2, formatKey: string): number {
  const f = template.formats[formatKey]
  if (!f) throw new Error(`Unknown format '${formatKey}' on template '${template.id}'`)
  const raw = template.typeScale.base
    * template.typeScale.ratio ** LEVELS.indexOf(level)
    * metricScale(template, f)
    * CLASS_DEFAULTS[classifyFormat(f)].typeMultiplier
  return Math.max(FONT_FLOOR, Math.round(raw))
}

export function wrapLines(text: string, fontSize: number, width: number): string[] {
  const cpl = Math.max(1, Math.floor(width / (fontSize * CHAR_W)))
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (w.length > cpl) {
      if (cur) { lines.push(cur); cur = '' }
      lines.push(w.slice(0, cpl))
      w = w.slice(cpl)
    }
    if (!w) continue
    const cand = cur ? `${cur} ${w}` : w
    if (cand.length <= cpl) cur = cand
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines
}

export interface FitResult {
  fontSize: number
  content: string     // possibly truncated (overflow: shrink-then-truncate)
  lines: string[]     // wrap estimate; rendering re-wraps
  clipped: boolean    // floor size still overflows and policy allows clipping
}

export function fitText(opts: {
  content: string
  maxFontSize: number
  w: number
  h: number
  lineHeight: number
  overflow: TextOverflow
  maxLines?: number
}): FitResult {
  const { content, lineHeight } = opts
  const maxLines = opts.maxLines ?? Number.POSITIVE_INFINITY
  const tryFit = (fs: number): string[] | null => {
    const lines = wrapLines(content, fs, opts.w)
    const ok = lines.length <= maxLines && lines.length * fs * lineHeight <= opts.h
    return ok ? lines : null
  }

  let fs = Math.max(FONT_FLOOR, Math.round(opts.maxFontSize))
  for (;;) {
    const lines = tryFit(fs)
    if (lines) return { fontSize: fs, content, lines, clipped: false }
    if (fs === FONT_FLOOR) break
    fs = Math.max(FONT_FLOOR, Math.floor(fs * 0.9))
  }

  const floorLines = wrapLines(content, FONT_FLOOR, opts.w)
  if (opts.overflow !== 'shrink-then-truncate') {
    // 'shrink' clips; 'grow' only reaches here when the grid ran out of rows.
    return { fontSize: FONT_FLOOR, content, lines: floorLines, clipped: true }
  }
  const byHeight = Math.floor(opts.h / (FONT_FLOOR * lineHeight))
  const keep = Math.max(1, Math.min(
    Number.isFinite(maxLines) ? maxLines : byHeight,
    byHeight,
  ))
  const kept = floorLines.slice(0, keep)
  const last = kept[kept.length - 1] ?? ''
  kept[kept.length - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`
  return { fontSize: FONT_FLOOR, content: kept.join(' '), lines: kept, clipped: false }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- tests/unit/template-grid-text.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/template-grid/text.ts tests/unit/template-grid-text.unit.spec.ts
git commit -m "Smart Layout v2: type scale + estimate-based copy fitting"
```

---

### Task 4: Default class layouts for strip & skyscraper

**Files:**
- Create: `frontend/shared/template-grid/layouts.ts`
- Test: `frontend/tests/unit/template-grid-layouts.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/template-grid-layouts.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { defaultClassRegion, slotOf } from '~~/shared/template-grid/layouts'
import type { ElementV2 } from '~~/shared/template-grid/types'

const R = { col: 1, colSpan: 1, row: 1, rowSpan: 1 }
const headline: ElementV2 = { id: 'h', type: 'text', content: 'x', level: 'display', priority: 1, region: R }
const subhead: ElementV2 = { id: 's', type: 'text', content: 'x', level: 'subhead', priority: 5, region: R }
const cta: ElementV2 = { id: 'c', type: 'text', content: 'x', level: 'caption', role: 'CTA', priority: 2, region: R }
const logo: ElementV2 = { id: 'l', type: 'image', content: 'x', role: 'LOGO', priority: 3, region: R }
const hero: ElementV2 = { id: 'i', type: 'image', content: 'x', priority: 4, region: R }
const shape: ElementV2 = { id: 'sh', type: 'shape', shape: 'rect', priority: 9, region: R }

describe('slotOf', () => {
  it('maps roles and types to slots', () => {
    expect(slotOf(headline)).toBe('headline')
    expect(slotOf(subhead)).toBe('subhead')
    expect(slotOf(cta)).toBe('cta')
    expect(slotOf(logo)).toBe('logo')
    expect(slotOf(hero)).toBe('image')
    expect(slotOf(shape)).toBeNull()
  })
})

describe('defaultClassRegion: strip', () => {
  const dims = { cols: 12, rows: 1 }
  it('places logo, headline, image, cta on the 12-col strip', () => {
    const taken = new Set<never>() as Set<any>
    expect(defaultClassRegion(logo, 'strip', dims, taken)).toEqual({ col: 1, colSpan: 2, row: 1, rowSpan: 1 })
    expect(defaultClassRegion(headline, 'strip', dims, taken)).toEqual({ col: 3, colSpan: 6, row: 1, rowSpan: 1 })
    expect(defaultClassRegion(hero, 'strip', dims, taken)).toEqual({ col: 9, colSpan: 1, row: 1, rowSpan: 1 })
    expect(defaultClassRegion(cta, 'strip', dims, taken)).toEqual({ col: 10, colSpan: 3, row: 1, rowSpan: 1 })
  })
  it('culls subhead in strips (no slot)', () => {
    expect(defaultClassRegion(subhead, 'strip', dims, new Set())).toBeNull()
  })
  it('gives a contested slot to the first claimant only', () => {
    const taken = new Set<any>()
    expect(defaultClassRegion(headline, 'strip', dims, taken)).not.toBeNull()
    const second: ElementV2 = { ...headline, id: 'h2' }
    expect(defaultClassRegion(second, 'strip', dims, taken)).toBeNull()
  })
})

describe('defaultClassRegion: skyscraper', () => {
  it('stacks logo/image/headline/subhead/cta top to bottom', () => {
    const dims = { cols: 3, rows: 10 }
    const taken = new Set<any>()
    expect(defaultClassRegion(logo, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 1, rowSpan: 1 })
    expect(defaultClassRegion(hero, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 2, rowSpan: 3 })
    expect(defaultClassRegion(headline, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 5, rowSpan: 3 })
    expect(defaultClassRegion(subhead, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 8, rowSpan: 1 })
    expect(defaultClassRegion(cta, 'skyscraper', dims, taken)).toEqual({ col: 1, colSpan: 3, row: 9, rowSpan: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/template-grid-layouts.unit.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `shared/template-grid/layouts.ts`**

```typescript
/** Default class layouts for strip and skyscraper formats. Proportional
 * remap from a square master to a 12×1 banner produces garbage compositions,
 * so these classes use fixed slot tables on a reference grid, remapped to
 * the format's actual column count. Elements claim slots in priority order;
 * losers and slotless elements (shapes, extra texts) are culled. */

import { remapRegion } from './grid'
import type { ElementV2, Region } from './types'

export type Slot = 'logo' | 'image' | 'headline' | 'subhead' | 'cta'

export function slotOf(el: ElementV2): Slot | null {
  const role = (el.role ?? '').toUpperCase()
  if (role.includes('LOGO')) return 'logo'
  if (role.includes('CTA')) return 'cta'
  if (el.type === 'image') return el.collapse === 'mark' ? 'logo' : 'image'
  if (el.type === 'text') {
    return el.level === 'display' || el.level === 'headline' ? 'headline' : 'subhead'
  }
  return null
}

const REF = {
  strip:      { cols: 12, rows: 1 },
  skyscraper: { cols: 3,  rows: 10 },
} as const

const SLOTS: Record<'strip' | 'skyscraper', Partial<Record<Slot, Region>>> = {
  strip: {
    logo:     { col: 1,  colSpan: 2, row: 1, rowSpan: 1 },
    headline: { col: 3,  colSpan: 6, row: 1, rowSpan: 1 },
    image:    { col: 9,  colSpan: 1, row: 1, rowSpan: 1 },
    cta:      { col: 10, colSpan: 3, row: 1, rowSpan: 1 },
    // subhead intentionally absent: strips cull it by default
  },
  skyscraper: {
    logo:     { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
    image:    { col: 1, colSpan: 3, row: 2, rowSpan: 3 },
    headline: { col: 1, colSpan: 3, row: 5, rowSpan: 3 },
    subhead:  { col: 1, colSpan: 3, row: 8, rowSpan: 1 },
    cta:      { col: 1, colSpan: 3, row: 9, rowSpan: 2 },
  },
}

export function defaultClassRegion(
  el: ElementV2,
  cls: 'strip' | 'skyscraper',
  dims: { cols: number; rows: number },
  taken: Set<Slot>,
): Region | null {
  const slot = slotOf(el)
  if (!slot || taken.has(slot)) return null
  const ref = SLOTS[cls][slot]
  if (!ref) return null
  taken.add(slot)
  return remapRegion(ref, REF[cls], dims)
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- tests/unit/template-grid-layouts.unit.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/template-grid/layouts.ts tests/unit/template-grid-layouts.unit.spec.ts
git commit -m "Smart Layout v2: default class layouts for strip/skyscraper"
```

---

### Task 5: Resolver orchestrator (regions, culling, grow, marks)

**Files:**
- Create: `frontend/shared/template-grid/resolve.ts`
- Create: `frontend/shared/template-grid/index.ts`
- Test: `frontend/tests/unit/template-grid-resolve.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/template-grid-resolve.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import type { TemplateV2 } from '~~/shared/template-grid/types'

function fixture(): TemplateV2 {
  return {
    version: 2, id: 't', name: 't', master: '1x1',
    formats: {
      '1x1':     { w: 1080, h: 1080 },
      '9x16':    { w: 1080, h: 1920 },
      '728x90':  { w: 728, h: 90 },
      '320x50':  { w: 320, h: 50 },
      '160x600': { w: 160, h: 600 },
    },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    background: { fill: '#0a0a0a' },
    elements: [
      { id: 'hero', type: 'image', content: '{{ props.image_layer_1 }}', priority: 4,
        region: { col: 1, colSpan: 6, row: 1, rowSpan: 6 } },
      { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
        region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 } },
      { id: 'subhead', type: 'text', content: 'Single-origin espresso', level: 'subhead', priority: 5,
        region: { col: 1, colSpan: 4, row: 6, rowSpan: 1 } },
      { id: 'cta', type: 'text', content: 'Shop now', level: 'caption', role: 'CTA', priority: 2,
        region: { col: 5, colSpan: 2, row: 6, rowSpan: 1 } },
      { id: 'logo', type: 'image', content: '{{ brand.logo }}', role: 'LOGO', priority: 3, collapse: 'mark',
        region: { col: 1, colSpan: 2, row: 1, rowSpan: 1 } },
    ],
  }
}

describe('resolveFormat', () => {
  it('resolves the master format with no surprises', () => {
    const r = resolveFormat(fixture(), '1x1', { text_layer_1: 'Brew bold' })
    expect(r.formatClass).toBe('square')
    expect(r.elements).toHaveLength(5)
    const headline = r.elements.find(e => e.el.id === 'headline')!
    expect(headline.culled).toBe(false)
    expect(headline.text!.content).toBe('Brew bold')
    expect(headline.text!.fontSize).toBeGreaterThan(50)
  })
  it('keeps template order for z, assigns slots by priority', () => {
    const r = resolveFormat(fixture(), '728x90', { text_layer_1: 'Brew bold' })
    expect(r.elements.map(e => e.el.id)).toEqual(['hero', 'headline', 'subhead', 'cta', 'logo'])
  })
  it('culls the subhead on strips and places the rest', () => {
    const r = resolveFormat(fixture(), '728x90', { text_layer_1: 'Brew bold' })
    const byId = Object.fromEntries(r.elements.map(e => [e.el.id, e]))
    expect(byId.subhead.culled).toBe(true)
    expect(byId.subhead.cullReason).toBe('no-slot')
    expect(byId.headline.culled).toBe(false)
    expect(byId.cta.culled).toBe(false)
    expect(byId.logo.culled).toBe(false)
  })
  it('collapse:mark renders as a centered square instead of culling', () => {
    const r = resolveFormat(fixture(), '728x90', {})
    const logo = r.elements.find(e => e.el.id === 'logo')!
    expect(logo.mark).toBe(true)
    expect(logo.rect.w).toBeCloseTo(logo.rect.h, 5)
  })
  it('remaps square→portrait proportionally', () => {
    const r = resolveFormat(fixture(), '9x16', { text_layer_1: 'Brew bold' })
    const headline = r.elements.find(e => e.el.id === 'headline')!
    expect(headline.culled).toBe(false)
    expect(headline.region).toEqual({ col: 1, colSpan: 4, row: 5, rowSpan: 3 })
  })
  it('respects regionByClass over defaults', () => {
    const t = fixture()
    ;(t.elements[2] as any).regionByClass = { strip: { col: 9, colSpan: 4, row: 1, rowSpan: 1 } }
    const r = resolveFormat(t, '728x90', {})
    const subhead = r.elements.find(e => e.el.id === 'subhead')!
    expect(subhead.culled).toBe(false)
  })
  it('grow extends the region downward for long copy', () => {
    const t = fixture()
    ;(t.elements[1] as any).overflow = 'grow'
    const long = 'a very long headline that absolutely will not fit in two rows '.repeat(6)
    const grown = resolveFormat(t, '1x1', { text_layer_1: long })
      .elements.find(e => e.el.id === 'headline')!
    const normal = resolveFormat(fixture(), '1x1', { text_layer_1: long })
      .elements.find(e => e.el.id === 'headline')!
    expect(grown.rect.h).toBeGreaterThan(normal.rect.h)
  })
  it('throws on unknown format keys', () => {
    expect(() => resolveFormat(fixture(), 'nope')).toThrow(/Unknown format/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/template-grid-resolve.unit.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `shared/template-grid/resolve.ts`**

```typescript
/** The resolver: template + format key + props → absolutely positioned,
 * culled, copy-fitted elements. The renderer and the editor both consume
 * this output; neither does grid math of its own. */

import {
  FONT_FLOOR, MIN_VISIBLE, classifyFormat, formatDims, gridMetrics,
  regionToRect, remapRegion,
} from './grid'
import type { GridMetrics, Rect } from './grid'
import { defaultClassRegion } from './layouts'
import type { Slot } from './layouts'
import { fitText, typeSize, wrapLines } from './text'
import type { FitResult } from './text'
import { resolveTokens } from './tokens'
import type { TokenScope } from './tokens'
import type { ElementV2, FormatClass, FormatSpec, Region, TemplateV2 } from './types'

export type CullReason = 'no-slot' | 'too-small'

export interface ResolvedElement {
  el: ElementV2
  region: Region | null
  rect: Rect
  culled: boolean
  cullReason?: CullReason
  text?: FitResult        // text elements only
  mark?: boolean          // image collapsed to a centered square mark
}

export interface ResolvedLayout {
  formatKey: string
  format: FormatSpec
  formatClass: FormatClass
  metrics: GridMetrics
  elements: ResolvedElement[]   // template order = z-order
}

const ZERO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 }
const MIN_MARK = 8   // px; marks smaller than this are culled outright

export function resolveFormat(
  template: TemplateV2,
  formatKey: string,
  props: TokenScope = {},
  brand: TokenScope = {},
): ResolvedLayout {
  const format = template.formats[formatKey]
  if (!format) throw new Error(`Unknown format '${formatKey}' on template '${template.id}'`)
  const cls = classifyFormat(format)
  const m = gridMetrics(template, formatKey)
  const masterDims = formatDims(template.formats[template.master])

  // Region assignment runs in priority order so high-priority elements win
  // contested default slots. Rendering below keeps template order (z-order).
  const regions = new Map<string, Region | null>()
  const taken = new Set<Slot>()
  const byPriority = [...template.elements].sort((a, b) => a.priority - b.priority)
  for (const el of byPriority) {
    const explicit = el.overrides?.[formatKey]?.region ?? el.regionByClass?.[cls]
    if (explicit) {
      regions.set(el.id, explicit)
    } else if (cls === 'strip' || cls === 'skyscraper') {
      regions.set(el.id, defaultClassRegion(el, cls, m, taken))
    } else {
      regions.set(el.id, remapRegion(el.region, masterDims, m))
    }
  }

  const elements = template.elements.map((el): ResolvedElement => {
    let region = regions.get(el.id) ?? null
    if (!region) return { el, region: null, rect: ZERO_RECT, culled: true, cullReason: 'no-slot' }

    if (el.type === 'text') {
      const lineHeight = el.style?.lineHeight ?? 1.1
      const overflow = el.overflow ?? 'shrink-then-truncate'
      const content = String(resolveTokens(el.content, props, brand) ?? '')
      const maxFontSize = typeSize(el.level, template, formatKey)
      let rect = regionToRect(region, m)
      if (overflow === 'grow') {
        const fullFits = () => {
          const lines = wrapLines(content, maxFontSize, rect.w)
          const okLines = el.maxLines == null || lines.length <= el.maxLines
          return okLines && lines.length * maxFontSize * lineHeight <= rect.h
        }
        while (!fullFits() && region.row + region.rowSpan - 1 < m.rows) {
          region = { ...region, rowSpan: region.rowSpan + 1 }
          rect = regionToRect(region, m)
        }
      }
      if (rect.h < FONT_FLOOR * lineHeight) {
        return { el, region, rect, culled: true, cullReason: 'too-small' }
      }
      const text = fitText({ content, maxFontSize, w: rect.w, h: rect.h, lineHeight, overflow, maxLines: el.maxLines })
      return { el, region, rect, culled: false, text }
    }

    const rect = regionToRect(region, m)
    if (el.type === 'image' && el.collapse === 'mark') {
      const side = Math.min(rect.w, rect.h)
      if (side < MIN_MARK) return { el, region, rect, culled: true, cullReason: 'too-small' }
      const markRect = { x: rect.x + (rect.w - side) / 2, y: rect.y + (rect.h - side) / 2, w: side, h: side }
      return { el, region, rect: markRect, culled: false, mark: true }
    }
    if (rect.w < MIN_VISIBLE || rect.h < MIN_VISIBLE) {
      return { el, region, rect, culled: true, cullReason: 'too-small' }
    }
    return { el, region, rect, culled: false }
  })

  return { formatKey, format, formatClass: cls, metrics: m, elements }
}
```

- [ ] **Step 4: Create `shared/template-grid/index.ts`**

```typescript
export * from './grid'
export * from './layouts'
export * from './resolve'
export * from './text'
export * from './tokens'
export * from './types'
```

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS (all template-grid tests + pre-existing unit tests)

- [ ] **Step 6: Commit**

```bash
git add shared/template-grid tests/unit/template-grid-resolve.unit.spec.ts
git commit -m "Smart Layout v2: resolver (regions, culling, grow, marks)"
```

---

### Task 6: v1 → v2 converter

**Files:**
- Create: `frontend/shared/template-grid/convert.ts`
- Modify: `frontend/shared/template-grid/index.ts` (add `export * from './convert'`)
- Test: `frontend/tests/unit/template-grid-convert.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/template-grid-convert.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { convertV1toV2 } from '~~/shared/template-grid/convert'
import type { Template } from '~~/server/templates/schema'

const V1: Template = {
  version: 1, id: 'legacy', name: 'Legacy',
  aspects: { '1x1': { w: 1080, h: 1080 }, '9x16': { w: 1080, h: 1920 } },
  defaultAspect: '1x1',
  background: { fill: '#0a0a0a' },
  elements: [
    { id: 'headline', type: 'text', role: 'HEADLINE', anchor: 'top-center',
      offset: { x: 0, y: '58%' }, size: { w: '84%', h: 'auto' },
      style: { fontSize: 96, fontWeight: 700, color: '#fff', align: 'center' },
      content: '{{ props.text_layer_1 }}' },
    { id: 'hero', type: 'image', role: 'IMAGE_LAYER_1', anchor: 'top-left',
      offset: { x: 0, y: 0 }, size: { w: '100%', h: '100%' },
      style: { fit: 'cover' }, content: '{{ props.image_layer_1 }}' },
  ],
}

describe('convertV1toV2', () => {
  it('produces a valid v2 template with formats from aspects', () => {
    const t2 = convertV1toV2(V1)
    expect(t2.version).toBe(2)
    expect(t2.master).toBe('1x1')
    expect(Object.keys(t2.formats)).toEqual(['1x1', '9x16'])
    expect(t2.grid.gutter).toBe(24)
    expect(t2.background).toEqual({ fill: '#0a0a0a' })
  })
  it('snaps a full-bleed image to the full grid', () => {
    const t2 = convertV1toV2(V1)
    const hero = t2.elements.find(e => e.id === 'hero')!
    expect(hero.region).toEqual({ col: 1, colSpan: 6, row: 1, rowSpan: 6 })
  })
  it('snaps the headline into the lower grid rows and maps size to a level', () => {
    const t2 = convertV1toV2(V1)
    const h = t2.elements.find(e => e.id === 'headline')! as any
    expect(h.region.row).toBeGreaterThanOrEqual(4)
    expect(h.level).toBe('display')   // 96px is closest to display (≈112)
    expect(h.priority).toBe(1)        // HEADLINE role
  })
  it('assigns priorities by role heuristic', () => {
    const t2 = convertV1toV2(V1)
    expect(t2.elements.find(e => e.id === 'hero')!.priority).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/template-grid-convert.unit.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `shared/template-grid/convert.ts`**

```typescript
/** One-way, best-effort v1 → v2 conversion: anchor/offset boxes snap to the
 * nearest grid cells on the master aspect; raw font sizes map to the nearest
 * type-scale level; priorities come from a role heuristic. User-initiated
 * from the editor — never automatic. */

import type {
  LayoutElement, Length, Template,
} from '../../server/templates/schema'
import { gridMetrics } from './grid'
import { LEVELS, typeSize } from './text'
import type { ElementV2, Region, TemplateV2, TextLevel } from './types'

function lenPx(v: Length | undefined, parent: number, fallback: number): number {
  if (v == null) return fallback
  if (typeof v === 'number') return v
  if (v === 'fill') return parent
  if (v === 'auto') return fallback
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? (n / 100) * parent : fallback
}

/** Pixel box of a v1 element on the master aspect (anchor + offset + size). */
function v1Box(el: LayoutElement, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const w = lenPx(el.size.w, W, W * 0.5)
  const h = lenPx(el.size.h, H, H * 0.15)
  const ox = lenPx(el.offset.x, W, 0)
  const oy = lenPx(el.offset.y, H, 0)
  const a = el.anchor
  const x = a.endsWith('left') ? ox
    : a.endsWith('right') ? W - ox - w
    : W / 2 + ox - w / 2
  const y = a.startsWith('top') ? oy
    : a.startsWith('bottom') ? H - oy - h
    : H / 2 + oy - h / 2
  return { x, y, w, h }
}

function rolePriority(el: LayoutElement): number {
  const role = (el.role ?? '').toUpperCase()
  if (role.includes('HEADLINE') || role === 'TEXT_LAYER_1') return 1
  if (role.includes('CTA')) return 2
  if (role.includes('LOGO')) return 3
  if (role === 'IMAGE_LAYER_1' || role.includes('HERO')) return 4
  if (el.type === 'text') return 5
  if (el.type === 'image') return 6
  return 7
}

export function convertV1toV2(t: Template): TemplateV2 {
  const masterKey = t.defaultAspect ?? Object.keys(t.aspects)[0]
  const master = t.aspects[masterKey]
  const s = Math.min(master.w, master.h) / 1080

  const t2: TemplateV2 = {
    version: 2, id: t.id, name: t.name,
    master: masterKey,
    formats: Object.fromEntries(
      Object.entries(t.aspects).map(([k, a]) => [k, { w: a.w, h: a.h, label: a.label }]),
    ),
    grid: { gutter: Math.round(24 * s), margin: Math.round(72 * s), baseline: Math.round(12 * s) },
    typeScale: { base: Math.round(28 * s), ratio: 1.414 },
    background: t.background,
    elements: [],
  }

  const m = gridMetrics(t2, masterKey)
  const step = (cell: number, gutter: number) => cell + gutter
  const snapRegion = (box: { x: number; y: number; w: number; h: number }): Region => {
    const col = Math.min(m.cols, Math.max(1, Math.round((box.x - m.originX) / step(m.cellW, m.gutter)) + 1))
    const row = Math.min(m.rows, Math.max(1, Math.round((box.y - m.originY) / step(m.cellH, m.gutter)) + 1))
    return {
      col, row,
      colSpan: Math.max(1, Math.min(m.cols - col + 1, Math.round(box.w / step(m.cellW, m.gutter)))),
      rowSpan: Math.max(1, Math.min(m.rows - row + 1, Math.round(box.h / step(m.cellH, m.gutter)))),
    }
  }
  const nearestLevel = (px: number): TextLevel => {
    let best: TextLevel = 'body'
    let bestD = Number.POSITIVE_INFINITY
    for (const level of LEVELS) {
      const d = Math.abs(typeSize(level, t2, masterKey) - px)
      if (d < bestD) { bestD = d; best = level }
    }
    return best
  }

  for (const el of t.elements) {
    const region = snapRegion(v1Box(el, master.w, master.h))
    const priority = rolePriority(el)
    if (el.type === 'text') {
      t2.elements.push({
        id: el.id, type: 'text', role: el.role, priority, region,
        content: el.content,
        level: nearestLevel(el.style?.fontSize ?? 48),
        style: {
          fontFamily: el.style?.fontFamily,
          fontWeight: (el.style?.fontWeight ?? 400) >= 600 ? 700 : 400,
          color: el.style?.color,
          align: el.style?.align,
          lineHeight: el.style?.lineHeight,
          letterSpacing: el.style?.letterSpacing,
        },
      })
    } else if (el.type === 'image') {
      t2.elements.push({
        id: el.id, type: 'image', role: el.role, priority, region,
        content: el.content,
        collapse: (el.role ?? '').toUpperCase().includes('LOGO') ? 'mark' : undefined,
        style: {
          fit: el.style?.fit === 'smart_crop' ? 'cover' : (el.style?.fit === 'contain' ? 'contain' : el.style?.fit === 'stretch' ? 'stretch' : 'cover'),
          borderRadius: el.style?.borderRadius,
        },
      })
    } else {
      t2.elements.push({
        id: el.id, type: 'shape', role: el.role, priority, region,
        shape: el.shape,
        style: el.style,
      })
    }
  }
  return t2
}
```

- [ ] **Step 4: Add to `shared/template-grid/index.ts`**

```typescript
export * from './convert'
```

- [ ] **Step 5: Run tests**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add shared/template-grid tests/unit/template-grid-convert.unit.spec.ts
git commit -m "Smart Layout v2: best-effort v1→v2 converter"
```

---

### Task 7: Render path — translate v2 + endpoint guard

**Files:**
- Modify: `frontend/server/templates/translate.ts` (dispatch on version; add `templateV2ToSatori`)
- Modify: `frontend/server/api/render-template.post.ts` (accept v2 templates in validation)
- Test: `frontend/tests/unit/template-grid-translate.unit.spec.ts`

- [ ] **Step 1: Read `server/api/render-template.post.ts` in full** and note its template validation (it currently expects `template.aspects`). The change below assumes a validation block that rejects templates without `aspects`; adjust it to accept `version === 2` with `formats`.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/unit/template-grid-translate.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { templateToSatori } from '~~/server/templates/translate'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const T: TemplateV2 = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: { '1x1': { w: 1080, h: 1080 }, '728x90': { w: 728, h: 90 } },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  background: { fill: '#101418' },
  elements: [
    { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
      region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 },
      style: { color: '#ffffff', valign: 'bottom' } },
    { id: 'subhead', type: 'text', content: 'Espresso monthly', level: 'subhead', priority: 5,
      region: { col: 1, colSpan: 4, row: 6, rowSpan: 1 } },
    { id: 'hero', type: 'image', content: 'http://x/img.png', priority: 4,
      region: { col: 4, colSpan: 3, row: 1, rowSpan: 3 }, focal: { x: 0.3, y: 0.7 } },
  ],
}

function flatten(node: any, out: any[] = []): any[] {
  out.push(node)
  const kids = node?.props?.children
  if (Array.isArray(kids)) kids.forEach((k: any) => typeof k === 'object' && flatten(k, out))
  else if (kids && typeof kids === 'object') flatten(kids, out)
  return out
}

describe('templateToSatori (v2)', () => {
  it('renders at the format size with absolute-positioned children', () => {
    const { width, height, tree } = templateToSatori(T as any, '1x1', { text_layer_1: 'Brew bold' })
    expect(width).toBe(1080)
    expect(height).toBe(1080)
    const nodes = flatten(tree)
    const text = nodes.find(n => n?.props?.children === 'Brew bold')
    expect(text).toBeTruthy()
    expect(text.props.style.position).toBe('absolute')
    expect(text.props.style.justifyContent).toBe('flex-end')   // valign: bottom
    expect(Number.parseFloat(text.props.style.fontSize)).toBeGreaterThan(50)
  })
  it('passes focal point through as objectPosition', () => {
    const { tree } = templateToSatori(T as any, '1x1', {})
    const img = flatten(tree).find(n => n?.type === 'img' && n.props.src === 'http://x/img.png')
    expect(img.props.style.objectPosition).toBe('30% 70%')
  })
  it('drops culled elements (subhead on strips)', () => {
    const { width, tree } = templateToSatori(T as any, '728x90', { text_layer_1: 'Brew bold' })
    expect(width).toBe(728)
    const texts = flatten(tree).filter(n => typeof n?.props?.children === 'string')
    expect(texts.some(n => n.props.children === 'Espresso monthly')).toBe(false)
    expect(texts.some(n => n.props.children === 'Brew bold')).toBe(true)
  })
  it('still renders v1 templates through the legacy path', () => {
    const v1 = {
      version: 1, id: 'v1', name: 'v1',
      aspects: { '1x1': { w: 512, h: 512 } }, defaultAspect: '1x1',
      elements: [{ id: 't', type: 'text', anchor: 'center', offset: { x: 0, y: 0 },
        size: { w: '80%', h: 'auto' }, style: { fontSize: 64 }, content: 'legacy' }],
    }
    const { width } = templateToSatori(v1 as any, '1x1', {})
    expect(width).toBe(512)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/template-grid-translate.unit.spec.ts`
Expected: FAIL — v2 template hits the v1 path and throws (no `aspects`)

- [ ] **Step 4: Add the v2 branch to `server/templates/translate.ts`**

Add imports at the top:

```typescript
import { resolveFormat } from '../../shared/template-grid/resolve'
import type { ResolvedElement } from '../../shared/template-grid/resolve'
import type {
  ImageElementV2, ShapeElementV2, TemplateV2, TextElementV2,
} from '../../shared/template-grid/types'
```

Change the signature of `templateToSatori` to accept both versions and dispatch first:

```typescript
export function templateToSatori(
  template: Template | TemplateV2, aspectKey: string | undefined,
  props: RenderProps = {}, brand: RenderBrand = {},
  explicitSize?: { width: number; height: number },
): TranslatedLayout {
  if ((template as TemplateV2).version === 2) {
    return templateV2ToSatori(template as TemplateV2, aspectKey, props, brand, explicitSize)
  }
  const t = template as Template
  // … existing v1 body unchanged, with `template` references renamed to `t` …
}
```

Append the v2 translator at the end of the file:

```typescript
// ---------- v2 (Swiss grid) ----------

function v2ElementNode(r: ResolvedElement, props: RenderProps, brand: RenderBrand): SatoriNode | null {
  const base: Record<string, unknown> = {
    position: 'absolute',
    left: `${r.rect.x}px`, top: `${r.rect.y}px`,
    width: `${r.rect.w}px`, height: `${r.rect.h}px`,
    display: 'flex',
  }
  switch (r.el.type) {
    case 'text': {
      const t = r.el as TextElementV2
      const s = t.style ?? {}
      const align = s.align ?? 'left'
      const valign = s.valign ?? 'top'
      return el('div', {
        style: {
          ...base,
          color: resolveTokens(s.color ?? '#fff', props, brand),
          fontSize: r.text!.fontSize,
          fontWeight: s.fontWeight ?? 400,
          fontFamily: s.fontFamily ?? 'Inter',
          textAlign: align,
          lineHeight: s.lineHeight ?? 1.1,
          letterSpacing: s.letterSpacing != null ? `${s.letterSpacing}px` : undefined,
          flexDirection: 'column',
          justifyContent: valign === 'bottom' ? 'flex-end' : valign === 'middle' ? 'center' : 'flex-start',
          alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
          overflow: 'hidden',
        },
        children: r.text!.content,
      })
    }
    case 'image': {
      const im = r.el as ImageElementV2
      const s = im.style ?? {}
      const focal = im.focal ?? { x: 0.5, y: 0.5 }
      const fit = s.fit ?? 'cover'
      return el('div', {
        style: { ...base, overflow: 'hidden', borderRadius: s.borderRadius ?? 0 },
        children: el('img', {
          src: String(resolveTokens(im.content, props, brand)),
          width: '100%' as unknown as number,
          height: '100%' as unknown as number,
          style: {
            objectFit: fit === 'contain' ? 'contain' : fit === 'stretch' ? 'fill' : 'cover',
            objectPosition: `${Math.round(focal.x * 100)}% ${Math.round(focal.y * 100)}%`,
            width: '100%', height: '100%',
          },
        }),
      })
    }
    case 'shape': {
      const sh = r.el as ShapeElementV2
      const s = sh.style ?? {}
      const style: Record<string, unknown> = {
        ...base,
        background: resolveTokens(s.fill ?? '#000', props, brand),
        borderRadius: sh.shape === 'circle' ? 9999 : (s.borderRadius ?? 0),
      }
      if (s.borderWidth) {
        style.border = `${s.borderWidth}px solid ${resolveTokens(s.borderColor ?? '#000', props, brand)}`
      }
      return el('div', { style })
    }
    default:
      return null
  }
}

function templateV2ToSatori(
  template: TemplateV2, formatKey: string | undefined,
  props: RenderProps, brand: RenderBrand,
  explicitSize?: { width: number; height: number },
): TranslatedLayout {
  let tpl = template
  let key = formatKey ?? template.master ?? Object.keys(template.formats)[0]
  if (explicitSize) {
    // Explicit w/h renders through a transient format so all grid math
    // (classification, scaling, culling) still applies.
    tpl = {
      ...template,
      formats: { ...template.formats, __explicit__: { w: explicitSize.width, h: explicitSize.height } },
    }
    key = '__explicit__'
  } else if (!template.formats[key]) {
    throw new Error(`Unknown format '${key}' on template '${template.id}'.`)
  }

  const resolved = resolveFormat(tpl, key, props as Record<string, unknown>, brand as Record<string, unknown>)
  const { w, h } = resolved.format

  const children: SatoriNode[] = []
  const bg = backgroundNode(tpl.background, { w, h }, props, brand)
  if (bg) children.push(bg)
  for (const r of resolved.elements) {
    if (r.culled) continue
    const node = v2ElementNode(r, props, brand)
    if (node) children.push(node)
  }

  const root: SatoriNode = el('div', {
    style: {
      position: 'relative', width: w, height: h,
      display: 'flex', background: '#000', overflow: 'hidden',
    },
    children,
  })
  return { width: w, height: h, tree: root }
}
```

Note: `backgroundNode`'s `aspect` parameter only uses `.w`/`.h` — passing `{ w, h }` satisfies it. If its signature types `AspectSpec`, widen the param type to `{ w: number; h: number }`.

- [ ] **Step 5: Update `server/api/render-template.post.ts` validation** so a template with `version === 2` and a `formats` object passes (and one with neither `aspects` nor `formats` still 4xxs). Keep `RenderRequest` typed as `AnyTemplate` via:

```typescript
import type { AnyTemplate, RenderRequest } from '~~/server/templates/schema'
```

with the body's template cast accordingly. The exact edit depends on the current validation block — preserve its error style.

- [ ] **Step 6: Run tests**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 7: Add a Playwright golden fixture** — append to `tests/smart-layout.spec.ts` inside the render-endpoint describe block:

```typescript
const TEMPLATE_V2 = {
  version: 2 as const,
  id: 'pw-v2', name: 'Playwright V2',
  master: '1x1',
  formats: {
    '1x1': { w: 512, h: 512 },
    '728x90': { w: 728, h: 90 },
    '160x600': { w: 160, h: 600 },
  },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  background: { fill: '#101418' },
  elements: [
    { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
      region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 }, style: { color: '#ffffff' } },
    { id: 'cta', type: 'text', content: 'Shop now', level: 'caption', role: 'CTA', priority: 2,
      region: { col: 5, colSpan: 2, row: 6, rowSpan: 1 }, style: { color: '#ffffff' } },
  ],
}

for (const [key, w, h] of [['1x1', 512, 512], ['728x90', 728, 90], ['160x600', 160, 600]] as const) {
  test(`v2 grid template renders ${key} at declared size`, async ({ request }) => {
    const res = await request.post('/api/render-template', {
      data: { template: TEMPLATE_V2, aspect: key, props: { text_layer_1: 'Brew bold' } },
    })
    expect(res.status()).toBe(200)
    const buf = await res.body()
    expect(buf.subarray(0, 8).toString('hex').toLowerCase()).toBe('89504e470d0a1a0a')
    expect(buf.readUInt32BE(16)).toBe(w)
    expect(buf.readUInt32BE(20)).toBe(h)
  })
}
```

- [ ] **Step 8: Run the Playwright render-endpoint tests** (requires the Nuxt dev server; skipped automatically when down)

Run: `npx playwright test tests/smart-layout.spec.ts --grep "render endpoint|v2 grid"`
Expected: PASS (or auto-skip if no server — then verify manually before finishing the branch)

- [ ] **Step 9: Commit**

```bash
git add server tests
git commit -m "Smart Layout v2: satori render path + endpoint support"
```

---

### Task 8: Python node — v2 starter, format presets, v2 autopopulate

**Files:**
- Modify: `comfy_extras/nodes_smart_layout.py`

- [ ] **Step 1: Replace `_STARTER_LAYOUT` (lines 74–88)** with the v2 starter + preset table:

```python
# Built-in format presets: social aspects + the IAB display set. Keys are what
# users type into the `aspects` widget; safeArea reserves platform UI chrome.
_FORMAT_PRESETS = {
    "1x1":     {"w": 1080, "h": 1080, "label": "Square"},
    "4x5":     {"w": 1080, "h": 1350, "label": "Feed portrait"},
    "9x16":    {"w": 1080, "h": 1920, "label": "Story",
                "safeArea": {"top": 270, "bottom": 380}},
    "16x9":    {"w": 1920, "h": 1080, "label": "Wide"},
    "300x250": {"w": 300,  "h": 250,  "label": "MPU"},
    "300x600": {"w": 300,  "h": 600,  "label": "Half page"},
    "728x90":  {"w": 728,  "h": 90,   "label": "Leaderboard"},
    "970x250": {"w": 970,  "h": 250,  "label": "Billboard"},
    "320x50":  {"w": 320,  "h": 50,   "label": "Mobile banner"},
    "160x600": {"w": 160,  "h": 600,  "label": "Skyscraper"},
}

_STARTER_LAYOUT = {
    "version": 2,
    "id": "starter",
    "name": "New Layout",
    "master": "1x1",
    "formats": _FORMAT_PRESETS,
    "grid": {"gutter": 24, "margin": 72, "baseline": 12},
    "typeScale": {"base": 28, "ratio": 1.414},
    "background": {"fill": "#0a0a0a"},
    "elements": [],
}
```

- [ ] **Step 2: Update `_parse_layout` validation** (line 106) to accept either schema version:

```python
    if not isinstance(layout, dict) or ("aspects" not in layout and "formats" not in layout):
        raise RuntimeError("Layout must be a JSON object with an `aspects` (v1) or `formats` (v2) field.")
```

- [ ] **Step 3: Update `_parse_aspects`** to read v2 `formats`/`master` with v1 fallback:

```python
def _parse_aspects(aspects_str: str, template: dict) -> list[str]:
    """Comma-separated format keys; empty falls back to the template default."""
    defined = template.get("formats") or template.get("aspects") or {}
    keys = [k.strip() for k in aspects_str.split(",") if k.strip()]
    if not keys:
        default = template.get("master") or template.get("defaultAspect") or next(iter(defined), None)
        if not default:
            raise RuntimeError("Template has no formats defined.")
        return [default]
    bad = [k for k in keys if k not in defined]
    if bad:
        raise RuntimeError(f"Unknown format(s) {bad}. Template defines: {sorted(defined)}")
    return keys
```

- [ ] **Step 4: Add `_autopopulate_elements_v2`** after the existing `_autopopulate_elements`, and dispatch on version. Defaults mirror the spec (priorities: headline 1, CTA 2, logo 3, hero 4, subhead 5; master grid is the 6×6 square):

```python
def _autopopulate_elements_v2(template: dict, props: dict) -> None:
    """v2 twin of _autopopulate_elements: grid regions instead of anchors.
    Strip/skyscraper placement comes from the resolver's default class
    layouts, so only master regions are needed here.
    """
    if template.get("elements"):
        return
    image_keys = sorted([k for k in props if k.startswith("image_layer_")],
                       key=lambda s: int(s.split("_")[-1]))
    text_keys = sorted([k for k in props if k.startswith("text_layer_")],
                      key=lambda s: int(s.split("_")[-1]))

    for i, key in enumerate(image_keys):
        idx = i + 1
        if idx == 1:
            template["elements"].append({
                "id": key, "type": "image", "role": f"IMAGE_LAYER_{idx}", "priority": 4,
                "region": {"col": 1, "colSpan": 6, "row": 1, "rowSpan": 6},
                "focal": {"x": 0.5, "y": 0.5},
                "style": {"fit": "cover"},
                "content": "{{ props." + key + " }}",
            })
        else:
            template["elements"].append({
                "id": key, "type": "image", "role": f"IMAGE_LAYER_{idx}", "priority": 5 + idx,
                "region": {"col": 6, "colSpan": 1, "row": min(6, idx - 1), "rowSpan": 1},
                "collapse": "mark",
                "style": {"fit": "cover"},
                "content": "{{ props." + key + " }}",
            })

    for i, key in enumerate(text_keys):
        idx = i + 1
        if idx == 1:
            template["elements"].append({
                "id": key, "type": "text", "role": f"TEXT_LAYER_{idx}", "priority": 1,
                "level": "display",
                "region": {"col": 1, "colSpan": 6, "row": 4, "rowSpan": 2},
                "overflow": "shrink-then-truncate",
                "style": {"fontWeight": 700, "color": "#ffffff"},
                "content": "{{ props." + key + " }}",
            })
        else:
            template["elements"].append({
                "id": key, "type": "text", "role": f"TEXT_LAYER_{idx}", "priority": 5,
                "level": "subhead",
                "region": {"col": 1, "colSpan": 4, "row": 6, "rowSpan": 1},
                "style": {"color": "#ffffff"},
                "content": "{{ props." + key + " }}",
            })
```

In `execute`, replace the `_autopopulate_elements(template, props_d)` call with:

```python
        if template.get("version") == 2:
            _autopopulate_elements_v2(template, props_d)
        else:
            _autopopulate_elements(template, props_d)
```

- [ ] **Step 5: Syntax-check**

Run (repo root): `.venv/bin/python -c "import ast; ast.parse(open('comfy_extras/nodes_smart_layout.py').read())"`
Expected: silent success

- [ ] **Step 6: Verify end-to-end** — with both servers running (ComfyUI must be restarted to pick up the Python change — kill it and let the supervisor restart, per dev-environment conventions), run:

Run: `npx playwright test tests/smart-layout.spec.ts`
Expected: PASS, including the execute-path test (its v1 fixture exercises the legacy path; the starter default exercises v2)

- [ ] **Step 7: Commit**

```bash
git add ../comfy_extras/nodes_smart_layout.py tests
git commit -m "Smart Layout v2: Python node — v2 starter, IAB presets, grid autopopulate"
```

---

### Task 9: Editor compatibility mode for v2

**Files:**
- Modify: `frontend/app/components/vue-canvas/SmartLayoutEditorModal.vue`
- Create: `frontend/app/components/templates/GridFormatPreviews.vue`

The full grid editor is the follow-up plan. This task only prevents breakage and gives v2 templates an honest preview: when the modal opens a `version: 2` template it must NOT run the v1 auto-create (which would inject anchor/offset elements into a v2 doc), and instead of the v1 canvas it shows server-rendered thumbnails of every target format plus the raw JSON for editing.

- [ ] **Step 1: Read `SmartLayoutEditorModal.vue` in full** and find (a) where the template JSON is parsed on mount, (b) the v1 auto-create block, (c) where the editor shell is rendered.

- [ ] **Step 2: Create `app/components/templates/GridFormatPreviews.vue`**

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref, watchEffect } from 'vue'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const props = defineProps<{
  template: TemplateV2
  props?: Record<string, unknown>
  brand?: Record<string, unknown>
}>()

interface Thumb { key: string; label: string; url: string | null; error: boolean }
const thumbs = ref<Thumb[]>([])
let urls: string[] = []

watchEffect(async () => {
  urls.forEach(u => URL.revokeObjectURL(u))
  urls = []
  const entries = Object.entries(props.template.formats ?? {})
  thumbs.value = entries.map(([key, f]) => ({ key, label: f.label ?? key, url: null, error: false }))
  await Promise.all(entries.map(async ([key], i) => {
    try {
      const res = await fetch('/api/render-template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template: props.template, aspect: key, props: props.props ?? {}, brand: props.brand ?? {} }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      urls.push(url)
      thumbs.value[i] = { ...thumbs.value[i], url }
    } catch {
      thumbs.value[i] = { ...thumbs.value[i], error: true }
    }
  }))
})

onBeforeUnmount(() => urls.forEach(u => URL.revokeObjectURL(u)))
</script>

<template>
  <div class="grid grid-cols-3 gap-4 overflow-y-auto p-4">
    <figure v-for="t in thumbs" :key="t.key" class="flex flex-col gap-1">
      <div class="flex min-h-24 items-center justify-center rounded bg-neutral-900 p-2">
        <img v-if="t.url" :src="t.url" class="max-h-48 w-auto max-w-full rounded-sm" :alt="t.label">
        <span v-else-if="t.error" class="text-xs text-red-400">render failed</span>
        <span v-else class="text-xs text-neutral-500">rendering…</span>
      </div>
      <figcaption class="text-xs text-neutral-400">
        {{ t.label }} · {{ template.formats[t.key].w }}×{{ template.formats[t.key].h }}
      </figcaption>
    </figure>
  </div>
</template>
```

- [ ] **Step 3: Branch in `SmartLayoutEditorModal.vue`**
  - Guard the v1 auto-create: wrap it in `if (parsedTemplate.version !== 2) { … }`.
  - When `parsedTemplate.version === 2`, render `GridFormatPreviews` (passing the template plus the same upstream props the modal already resolves for the v1 canvas) and a `<textarea>` bound to the layout JSON with the modal's existing save path, instead of the v1 editor shell. Keep the v1 path byte-for-byte identical. Match the modal's existing markup/styling conventions.

- [ ] **Step 4: Verify in the browser** — with both servers running, drop a SmartLayout node (it now starts as v2), open "Edit layout", confirm: format thumbnails render for all 10 presets, JSON edits save back to the widget, and a v1 workflow's node still opens the old editor.

Run: `npx playwright test tests/smart-layout.spec.ts --grep "editor modal"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components
git commit -m "Smart Layout v2: editor compat — format previews + JSON editing"
```

---

### Final verification

- [ ] `npm run test:unit` — all green
- [ ] `npx playwright test tests/smart-layout.spec.ts` — all green with both servers up
- [ ] Manual: queue a SmartLayout with one image + two text layers wired and `aspects = "1x1,9x16,728x90,320x50,160x600"`; confirm the carousel shows 5 correctly-composed variants (subhead culled on strips, logo collapsed to mark on 320×50)
- [ ] Update `MEMORY.md` project notes if conventions emerged worth keeping

## Follow-up plan (separate)

Visual grid editor: snap-to-cell drag/resize on the grid overlay, format strip + class tabs writing `regionByClass`, culling indicators, worst-case copy toggle, safe-area hatching, focal-point picker, "Convert to grid" button wired to `convertV1toV2`. Fast-follows from the spec: brand fonts in the render endpoint, text panels.
