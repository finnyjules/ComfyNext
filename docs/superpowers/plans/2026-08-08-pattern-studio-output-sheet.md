# Pattern Studio Output Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Pattern Studio an Output tab that sets the exported sheet size and the tile size inside it, so a pattern can be exported at any resolution and at any density.

**Architecture:** Four flat params in the already-reserved `'Output'` control group, resolved by one new pure module (`lib/texturefx/sheet.ts`) that every render path calls. The studio export, the node's headless bake, the studio preview and the node card all read their dimensions from `sheetFromParams` + `tilePositions` rather than deriving them independently — Pattern Studio has three render paths today and they drift the moment any two compute pixels on their own.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (happy-dom) for unit tests, canvas 2D for the repeat-fill.

**Spec:** `docs/superpowers/specs/2026-08-08-pattern-studio-output-sheet-design.md`

## Global Constraints

- Default output must stay **byte-compatible with today**: `sheetPreset` default `Tile · square` + `tilePx` default `1024` resolves to a 1024×1024 sheet from a 1024 tile. Task 1 asserts this.
- A pattern saved before this change has none of the new keys. `loadParams()`'s existing `{ ...textureDefaults(), ...cloneParams(p) }` merge backfills them; do not add migration code.
- Every `tilePx` option must be a multiple of 64. The dither patterns in `DITHER_PERIOD` (`lib/texturefx/types.ts`) need a whole number of dither periods per tile or the stylize pass seams.
- No DPI, no physical units, no snapping, no non-square tiles. Pixels only.
- Unit tests live in `frontend/tests/unit/*.unit.spec.ts` and run with `cd frontend && npx vitest run <file>`.
- Other sessions share this repo. Commit with `git add <explicit paths>` only — never `git add -A`, never `git stash`.
- Run commands from `/Users/julien/Documents/GitHub/Sailor/frontend` unless stated otherwise.

---

## File Structure

**Create:**
- `frontend/app/lib/texturefx/sheet.ts` — the only place sheet dimensions and repeat geometry are computed. Pure except for `drawSheet`.
- `frontend/tests/unit/texturefx-sheet.unit.spec.ts` — resolver tests.

**Modify:**
- `frontend/app/lib/texturefx/controls.ts` — declare the four Output controls.
- `frontend/app/components/vue-canvas/TextureStudioSurface.vue` — export path, tab strip, Output panel + readout, sheet preview.
- `frontend/app/components/vue-canvas/TextureStudioNode.vue` — headless bake, card preview.

`lib/texturefx/sections.ts` already lists `'Output'` in `TEXTURE_SECTIONS`; no change needed there.

---

### Task 1: The sheet resolver

**Files:**
- Create: `frontend/app/lib/texturefx/sheet.ts`
- Create: `frontend/tests/unit/texturefx-sheet.unit.spec.ts`
- Modify: `frontend/app/lib/texturefx/controls.ts` (imports at top; new controls appended before `...postControls`)

**Interfaces:**
- Consumes: `Params` from `~/lib/spacetype/effect`; `textureDefaults()` from `~/lib/texturefx/controls` (test only).
- Produces, and every later task depends on these exact names:
  - `type Sheet = { w: number; h: number; tile: number }`
  - `type TileOp = { x: number; y: number; size: number }`
  - `const SHEET_PRESET_TILE: 'Tile · square'`, `const SHEET_PRESET_CUSTOM: 'Custom'`
  - `const SHEET_SIZES: Record<string, [number, number]>`
  - `const SHEET_PRESETS: string[]`, `const TILE_PX_OPTIONS: string[]`
  - `sheetFromParams(p: Params): Sheet`
  - `repeatsFor(s: Sheet): { x: number; y: number }`
  - `isTileable(s: Sheet): boolean`
  - `isSheetFramed(p: Params): boolean`
  - `fitLetterbox(s: Sheet, boxW: number, boxH: number): { w: number; h: number; x: number; y: number }`
  - `tilePositions(s: Sheet, destW: number, destH: number): TileOp[]`
  - `drawSheet(ctx: CanvasRenderingContext2D, tile: CanvasImageSource, s: Sheet, destW: number, destH: number): void`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/texturefx-sheet.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TEXTURE_CONTROLS, textureDefaults } from '~/lib/texturefx/controls'
import {
  SHEET_PRESET_CUSTOM, SHEET_PRESET_TILE, SHEET_PRESETS, TILE_PX_OPTIONS,
  fitLetterbox, isSheetFramed, isTileable, repeatsFor, sheetFromParams, tilePositions,
} from '~/lib/texturefx/sheet'
import type { Params } from '~/lib/spacetype/effect'

// The whole point of the Output tab is that it changes NOTHING until you touch it.
// Every pattern already on a canvas was saved without these keys.
describe('sheetFromParams — back compatibility', () => {
  it('defaults to a 1024 square sheet from a 1024 tile', () => {
    expect(sheetFromParams(textureDefaults())).toEqual({ w: 1024, h: 1024, tile: 1024 })
  })

  it('resolves a legacy params object with no sheet keys identically', () => {
    // How loadParams() rehydrates a pattern saved before this feature existed.
    const legacy = { mode: 'procedural', motif: 'checker', cells: 8, seed: 3 } as unknown as Params
    const merged = { ...textureDefaults(), ...legacy }
    expect(sheetFromParams(merged)).toEqual({ w: 1024, h: 1024, tile: 1024 })
  })

  it('follows the tile size for the Tile preset', () => {
    const p = { ...textureDefaults(), sheetPreset: SHEET_PRESET_TILE, tilePx: '2048' } as Params
    expect(sheetFromParams(p)).toEqual({ w: 2048, h: 2048, tile: 2048 })
  })
})

describe('sheetFromParams — presets and custom', () => {
  it('reads the size table for a fixed preset', () => {
    const p = { ...textureDefaults(), sheetPreset: '1920 × 1080 (16:9)', tilePx: '512' } as Params
    expect(sheetFromParams(p)).toEqual({ w: 1920, h: 1080, tile: 512 })
  })

  // Space Type's dimsFromKey has the opposite bug: it consults the preset table for
  // Custom and silently returns stale dimensions. Custom lives in W/H, full stop.
  it('reads W/H for Custom and never the preset table', () => {
    const p = { ...textureDefaults(), sheetPreset: SHEET_PRESET_CUSTOM, sheetW: 1500, sheetH: 700 } as Params
    expect(sheetFromParams(p)).toEqual({ w: 1500, h: 700, tile: 1024 })
  })

  it('falls back to a square tile sheet for an unknown preset label', () => {
    const p = { ...textureDefaults(), sheetPreset: 'Nonsense', tilePx: '512' } as Params
    expect(sheetFromParams(p)).toEqual({ w: 512, h: 512, tile: 512 })
  })

  it('clamps a garbage custom size instead of producing NaN', () => {
    const p = { ...textureDefaults(), sheetPreset: SHEET_PRESET_CUSTOM, sheetW: 999999, sheetH: 0 } as Params
    expect(sheetFromParams(p)).toEqual({ w: 8192, h: 64, tile: 1024 })
  })
})

describe('repeatsFor / isTileable', () => {
  it('reports fractional repeats', () => {
    expect(repeatsFor({ w: 1920, h: 1080, tile: 512 })).toEqual({ x: 3.75, y: 2.109375 })
  })

  it('is tileable only when both axes are whole tiles', () => {
    expect(isTileable({ w: 2048, h: 2048, tile: 512 })).toBe(true)
    expect(isTileable({ w: 1920, h: 1080, tile: 512 })).toBe(false)
    expect(isTileable({ w: 1024, h: 1024, tile: 1024 })).toBe(true)
  })
})

describe('isSheetFramed', () => {
  it('is false for the Tile preset — that output is a material, not a framed sheet', () => {
    expect(isSheetFramed({ ...textureDefaults(), sheetPreset: SHEET_PRESET_TILE } as Params)).toBe(false)
  })

  it('is true once a real sheet is chosen', () => {
    expect(isSheetFramed({ ...textureDefaults(), sheetPreset: '1080 × 1920 (9:16)' } as Params)).toBe(true)
    expect(isSheetFramed({ ...textureDefaults(), sheetPreset: SHEET_PRESET_CUSTOM } as Params)).toBe(true)
  })
})

describe('fitLetterbox', () => {
  it('fits a portrait sheet by height and centres it horizontally', () => {
    expect(fitLetterbox({ w: 1080, h: 1920, tile: 512 }, 220, 148)).toEqual({ w: 83, h: 148, x: 69, y: 0 })
  })

  it('fits a wide sheet by width and centres it vertically', () => {
    expect(fitLetterbox({ w: 1920, h: 1080, tile: 512 }, 220, 148)).toEqual({ w: 220, h: 124, x: 0, y: 12 })
  })
})

describe('tilePositions', () => {
  it('emits exactly one op for a single-tile sheet', () => {
    expect(tilePositions({ w: 1024, h: 1024, tile: 1024 }, 1024, 1024))
      .toEqual([{ x: 0, y: 0, size: 1024 }])
  })

  it('covers a partial repeat by overdrawing past the edge', () => {
    // 1920/512 = 3.75 across, 1080/512 = 2.11 down -> 4 x 3 draws, last ones cropped.
    const ops = tilePositions({ w: 1920, h: 1080, tile: 512 }, 1920, 1080)
    expect(ops).toHaveLength(12)
    expect(ops[0]).toEqual({ x: 0, y: 0, size: 512 })
    expect(ops[11]).toEqual({ x: 1536, y: 1024, size: 512 })
  })

  it('scales the tile when drawing into a smaller destination', () => {
    // Half-size destination -> half-size tiles, same repeat count. This is what keeps
    // a 4K sheet preview from allocating a 4K canvas.
    const ops = tilePositions({ w: 2048, h: 1024, tile: 512 }, 1024, 512)
    expect(ops).toHaveLength(8)
    expect(ops[0]).toEqual({ x: 0, y: 0, size: 256 })
  })
})

describe('control declarations', () => {
  it('offers only tile sizes that keep the dither patterns seamless', () => {
    // DITHER_PERIOD tops out at 128 (blue noise 2x); every option must be a
    // multiple of 64 or stylizeTile seams at the tile edge.
    for (const opt of TILE_PX_OPTIONS) expect(Number(opt) % 64).toBe(0)
  })

  it('lists Tile first and Custom last', () => {
    expect(SHEET_PRESETS[0]).toBe(SHEET_PRESET_TILE)
    expect(SHEET_PRESETS[SHEET_PRESETS.length - 1]).toBe(SHEET_PRESET_CUSTOM)
  })

  it('declares the four Output controls in the Output group', () => {
    const keys = TEXTURE_CONTROLS.filter(c => c.group === 'Output').map(c => c.key)
    expect(keys).toEqual(['sheetPreset', 'sheetW', 'sheetH', 'tilePx'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/texturefx-sheet.unit.spec.ts
```

Expected: FAIL — `Failed to resolve import "~/lib/texturefx/sheet"`.

- [ ] **Step 3: Write `sheet.ts`**

Create `frontend/app/lib/texturefx/sheet.ts`:

```ts
import type { Params } from '~/lib/spacetype/effect'

// The exported image ("sheet") and the seamless unit repeated inside it ("tile").
// Pattern Studio renders in four places — studio preview, studio export, node card,
// node headless bake — and every one of them gets its dimensions from here. Deriving
// them locally is how three render paths end up disagreeing.
export type Sheet = { w: number; h: number; tile: number }

/** One drawImage instruction in destination space. */
export type TileOp = { x: number; y: number; size: number }

/** The sheet is exactly one square tile — the pre-Output-tab behaviour, and the default. */
export const SHEET_PRESET_TILE = 'Tile · square'
/** The sheet comes from sheetW/sheetH. */
export const SHEET_PRESET_CUSTOM = 'Custom'

/** Fixed-size presets. Excludes the two special labels above, which are not sizes. */
export const SHEET_SIZES: Record<string, [number, number]> = {
  '1920 × 1080 (16:9)': [1920, 1080],
  '1080 × 1920 (9:16)': [1080, 1920],
  '2048 × 2048': [2048, 2048],
  '3840 × 2160 (4K)': [3840, 2160],
}

export const SHEET_PRESETS: string[] = [SHEET_PRESET_TILE, ...Object.keys(SHEET_SIZES), SHEET_PRESET_CUSTOM]

// Multiples of 64 only: DITHER_PERIOD (types.ts) goes up to 128, and stylizeTile seams
// unless the tile holds a whole number of dither periods. Capped at 2048 — a sheet of
// 2048 tiles is already 16MB of RGBA per tile before the repeat.
export const TILE_PX_OPTIONS: string[] = ['128', '256', '512', '1024', '2048']

const MIN_DIM = 64
const MAX_DIM = 8192

function clampDim(v: number): number {
  if (!Number.isFinite(v)) return 1024
  return Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(v)))
}

function clampTile(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1024
  return Math.max(MIN_DIM, Math.min(4096, Math.round(v / 64) * 64))
}

/**
 * Resolve the sheet from flat params. Custom reads sheetW/sheetH and MUST NOT consult
 * the size table — Space Type's dimsFromKey does exactly that and returns stale
 * dimensions for custom sizes.
 */
export function sheetFromParams(p: Params): Sheet {
  const tile = clampTile(Number(p.tilePx ?? 1024))
  const preset = String(p.sheetPreset ?? SHEET_PRESET_TILE)
  if (preset === SHEET_PRESET_CUSTOM) {
    return { w: clampDim(Number(p.sheetW ?? tile)), h: clampDim(Number(p.sheetH ?? tile)), tile }
  }
  const fixed = SHEET_SIZES[preset]
  if (fixed) return { w: fixed[0], h: fixed[1], tile }
  // Tile preset, and any label from a future/legacy build we don't recognise.
  return { w: tile, h: tile, tile }
}

/** How many tiles fit across and down — fractional on purpose, for the readout. */
export function repeatsFor(s: Sheet): { x: number; y: number } {
  return { x: s.w / s.tile, y: s.h / s.tile }
}

/** True when the exported PNG itself repeats edge-to-edge (both axes whole tiles). */
export function isTileable(s: Sheet): boolean {
  const r = repeatsFor(s)
  return Number.isInteger(r.x) && Number.isInteger(r.y)
}

/**
 * True when the user chose a real sheet rather than "just give me the tile".
 * The node card uses this to decide between a full-bleed material swatch and a
 * letterboxed frame — a bare tile has no aspect worth honouring.
 */
export function isSheetFramed(p: Params): boolean {
  return String(p.sheetPreset ?? SHEET_PRESET_TILE) !== SHEET_PRESET_TILE
}

/** Largest rect with the sheet's aspect that fits in boxW x boxH, centred. */
export function fitLetterbox(s: Sheet, boxW: number, boxH: number): { w: number; h: number; x: number; y: number } {
  const k = Math.min(boxW / s.w, boxH / s.h)
  const w = Math.max(1, Math.round(s.w * k))
  const h = Math.max(1, Math.round(s.h * k))
  return { w, h, x: Math.round((boxW - w) / 2), y: Math.round((boxH - h) / 2) }
}

/**
 * Repeat geometry in destination space. `destW` may be smaller than `s.w` — the tile
 * scales with it, so a preview of a 4K sheet costs a preview-sized canvas.
 * Partial repeats overdraw past the edge and get clipped by the canvas; that is what
 * "free crop" means.
 */
export function tilePositions(s: Sheet, destW: number, destH: number): TileOp[] {
  const size = s.tile * (destW / s.w)
  if (!(size > 0)) return []
  const cols = Math.ceil(destW / size)
  const rows = Math.ceil(destH / size)
  const ops: TileOp[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) ops.push({ x: c * size, y: r * size, size })
  }
  return ops
}

/** Repeat-fill `tile` across a destW x destH region of `ctx`, at the sheet's density. */
export function drawSheet(
  ctx: CanvasRenderingContext2D,
  tile: CanvasImageSource,
  s: Sheet,
  destW: number,
  destH: number,
): void {
  for (const op of tilePositions(s, destW, destH)) ctx.drawImage(tile, op.x, op.y, op.size, op.size)
}
```

- [ ] **Step 4: Declare the four controls**

In `frontend/app/lib/texturefx/controls.ts`, add to the import block at the top (after the `types` import on line 2):

```ts
import { SHEET_PRESET_CUSTOM, SHEET_PRESET_TILE, SHEET_PRESETS, TILE_PX_OPTIONS } from '~/lib/texturefx/sheet'
```

Then insert these four entries immediately **before** the `// --- Post (shared stack: ...` comment block near the end of `TEXTURE_CONTROLS`:

```ts
  // --- Output: the exported sheet. `Tile · square` (the default) makes the sheet
  //     exactly one tile — 1024x1024 from a 1024 tile, i.e. what this studio produced
  //     before the sheet existed, so every already-saved pattern exports unchanged.
  //     lib/texturefx/sheet.ts resolves these into the {w,h,tile} every render path uses.
  { key: 'sheetPreset', label: 'Sheet', kind: 'select', options: [...SHEET_PRESETS], default: SHEET_PRESET_TILE, group: 'Output' },
  { key: 'sheetW', label: 'Width', kind: 'slider', min: 128, max: 8192, step: 64, default: 1024, group: 'Output', when: (p) => String(p.sheetPreset) === SHEET_PRESET_CUSTOM },
  { key: 'sheetH', label: 'Height', kind: 'slider', min: 128, max: 8192, step: 64, default: 1024, group: 'Output', when: (p) => String(p.sheetPreset) === SHEET_PRESET_CUSTOM },
  // Tile size is the density dial: the same motif reads fine or coarse depending on how
  // many times the tile fits the sheet.
  { key: 'tilePx', label: 'Tile size', kind: 'select', options: [...TILE_PX_OPTIONS], default: '1024', group: 'Output' },

```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/texturefx-sheet.unit.spec.ts
```

Expected: PASS, 19 tests.

- [ ] **Step 6: Confirm the existing texture tests still pass**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/texturefx-pattern.unit.spec.ts tests/unit/texturefx-sheet.unit.spec.ts
```

Expected: PASS. `texturefx-pattern.unit.spec.ts` guards the controls/sections contract, so this catches a mis-grouped control. If it reports a control whose group is not in `TEXTURE_SECTIONS`, check the spelling of `'Output'`.

Note: vitest counts under load are unreliable here — if the run looks odd, check `uptime` and re-run before concluding anything.

- [ ] **Step 7: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor && git add frontend/app/lib/texturefx/sheet.ts frontend/app/lib/texturefx/controls.ts frontend/tests/unit/texturefx-sheet.unit.spec.ts && git commit -m "feat(pattern-studio): sheet resolver + Output controls"
```

---

### Task 2: Both export paths honour the sheet

**Files:**
- Modify: `frontend/app/components/vue-canvas/TextureStudioSurface.vue:455-461` (`exportBlob`)
- Modify: `frontend/app/components/vue-canvas/TextureStudioNode.vue:77-83` (`bakeOutput`)

**Interfaces:**
- Consumes: `sheetFromParams`, `drawSheet` from Task 1.
- Produces: nothing new. `sendToCanvas`, `downloadPng` and `renderBlobWithOverrides` already route through `exportBlob`, so they inherit the sheet with no edit.

This task has no unit test — it is canvas work. Task 1's `tilePositions` tests cover the geometry; Task 6 verifies the actual exported pixels.

- [ ] **Step 1: Rewrite `exportBlob` in the surface**

Add to the imports at the top of `TextureStudioSurface.vue` (after the `types` import on line 10):

```ts
import { drawSheet, fitLetterbox, isTileable, repeatsFor, sheetFromParams } from '~/lib/texturefx/sheet'
```

(`fitLetterbox`, `isTileable` and `repeatsFor` are used by Tasks 3 and 4 — import them now so the import line is written once.)

Replace lines 455-461 entirely:

```ts
// Render the tile at its full size, stylize it, then repeat-fill the sheet. The tile
// is always square so cells stay undistorted; the sheet's aspect comes from how much
// of that repeating field we keep. Tile sizes are multiples of 64 so dither stays
// seamless (see TILE_PX_OPTIONS).
async function exportBlob(): Promise<Blob> {
  const sheet = sheetFromParams(params)
  const tile = stylizeTile(
    textureFx.render(params, sheet.tile, sheet.tile, 0), params, sheet.tile, sheet.tile)
  const out = document.createElement('canvas')
  out.width = sheet.w
  out.height = sheet.h
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  drawSheet(ctx, tile, sheet, sheet.w, sheet.h)
  return await new Promise<Blob>((res, rej) =>
    out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}
```

- [ ] **Step 2: Rewrite `bakeOutput` in the node**

Add to the imports at the top of `TextureStudioNode.vue` (after the `raster` import on line 7):

```ts
import { drawSheet, fitLetterbox, isSheetFramed, sheetFromParams } from '~/lib/texturefx/sheet'
```

(`fitLetterbox` and `isSheetFramed` are used by Task 5.)

Replace lines 77-83 entirely:

```ts
// Headless full-res sheet for the render cascade (generative — no input). Same
// resolver as the studio's exportBlob, so the cascade and the studio agree.
async function bakeOutput(): Promise<Blob | null> {
  await preloadStylize().catch(() => {})
  const sheet = sheetFromParams(params.value)
  const tile = stylizeTile(
    textureFx.render(params.value, sheet.tile, sheet.tile, 0), params.value, sheet.tile, sheet.tile)
  const out = document.createElement('canvas')
  out.width = sheet.w
  out.height = sheet.h
  const ctx = out.getContext('2d')
  if (!ctx) return null
  drawSheet(ctx, tile, sheet, sheet.w, sheet.h)
  return await new Promise<Blob | null>(res => out.toBlob(b => res(b), 'image/png'))
}
```

The `BAKE_TILE` const on line 78 is now unused — delete it.

- [ ] **Step 3: Typecheck the two files**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TextureStudio|texturefx" || echo "no texture errors"
```

Expected: `no texture errors`. The project has a large pre-existing error baseline (~328); only errors naming these files matter. If an error names `Sheet`, `tilePositions` or `sheetFromParams`, it is yours — do not wave it through as pre-existing.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor && git add frontend/app/components/vue-canvas/TextureStudioSurface.vue frontend/app/components/vue-canvas/TextureStudioNode.vue && git commit -m "feat(pattern-studio): export and headless bake render the sheet"
```

---

### Task 3: Design | Output tab strip and the Output panel

**Files:**
- Modify: `frontend/app/components/vue-canvas/TextureStudioSurface.vue` (script: after line 79; `controlVisible` at line 230; template `#controls` at line 609)

**Interfaces:**
- Consumes: `sheetFromParams`, `repeatsFor`, `isTileable` (imported in Task 2 Step 1).
- Produces: `inspectorTab` ref (`'design' | 'output'`) and `onDesign` computed, both used by Task 4.

- [ ] **Step 1: Add the tab state and sheet computeds**

In `TextureStudioSurface.vue`, immediately after the `const genError = ref('')` line (line 79):

```ts
// Inspector tabs — Design (the pattern) vs Output (the sheet it gets printed on),
// matching Type Studio's and Gradient Studio's Design|Motion strip. Pattern Studio
// has no motion, so Output takes that slot in the family.
const inspectorTab = ref<'design' | 'output'>('design')
const onDesign = computed(() => inspectorTab.value === 'design')

const sheet = computed(() => sheetFromParams(params))
const sheetRepeats = computed(() => repeatsFor(sheet.value))
const sheetTileable = computed(() => isTileable(sheet.value))
// Whole numbers read as "4", partials as "3.75" — the point of the readout is telling
// those two apart at a glance.
function fmtRepeat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
```

- [ ] **Step 2: Gate controls by tab**

Replace the body of `controlVisible` (line 230-236):

```ts
function controlVisible(c: ControlSpec): boolean {
  const tc = c as TextureControl
  // Tab gate: the Output group is the Output tab, everything else is Design.
  if ((c.group === 'Output') !== (inspectorTab.value === 'output')) return false
  // `showIf` too, not just `when`: the shared post stack's param rows declare it so
  // they appear only once their effect's switch is on. Checking `when` alone showed
  // all 21 of them permanently.
  return (!tc.when || tc.when(params)) && showIfVisible(c, k => params[k])
}
```

- [ ] **Step 3: Add the tab strip, the readout, and hide Fills on the Output tab**

In the `<template #controls>` block (line 609), insert the tab strip as the **first** child, before `<StudioControlPanel>`:

```html
      <div class="flex shrink-0 gap-1 rounded-lg bg-white/[0.04] p-1 text-[11px]">
        <button type="button" class="flex-1 rounded px-2 py-1"
                :class="inspectorTab === 'design' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="inspectorTab = 'design'">Design</button>
        <button type="button" class="flex-1 rounded px-2 py-1"
                :class="inspectorTab === 'output' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="inspectorTab = 'output'">Output</button>
      </div>
```

Immediately **after** the closing `</StudioControlPanel>` tag (line 620), add the readout:

```html
      <!-- Not controls — the consequences of the controls above. The chip is the only
           thing that tells you whether the exported PNG itself repeats edge-to-edge;
           any sheet is allowed, this just says what you got. -->
      <div v-if="inspectorTab === 'output'" class="flex flex-col gap-1 px-1 pt-1 text-[11px]">
        <div class="text-white/70">{{ sheet.w }} × {{ sheet.h }} px</div>
        <div class="text-white/45">
          {{ fmtRepeat(sheetRepeats.x) }} × {{ fmtRepeat(sheetRepeats.y) }} repeats
        </div>
        <div class="pt-0.5">
          <span class="rounded px-1.5 py-0.5"
                :class="sheetTileable ? 'bg-white/10 text-white/70' : 'bg-white/[0.04] text-white/35'">
            {{ sheetTileable ? 'tiles edge-to-edge' : 'not self-tiling' }}
          </span>
        </div>
      </div>
```

Finally, on the hand-rolled Fills section at line 624 — it is not driven by `TEXTURE_CONTROLS`, so the tab gate does not reach it — change its opening tag from:

```html
      <StudioSection v-if="params.mode !== 'raster'" title="Fills">
```

to:

```html
      <StudioSection v-if="onDesign && params.mode !== 'raster'" title="Fills">
```

- [ ] **Step 4: Verify it compiles**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TextureStudioSurface" || echo "no surface errors"
```

Expected: `no surface errors`.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor && git add frontend/app/components/vue-canvas/TextureStudioSurface.vue && git commit -m "feat(pattern-studio): Design|Output tab strip and sheet readout"
```

---

### Task 4: The Output tab previews the real sheet

**Files:**
- Modify: `frontend/app/components/vue-canvas/TextureStudioSurface.vue` (`renderPreview` at line 253; template `#preview` at line 550)

**Interfaces:**
- Consumes: `inspectorTab`, `onDesign`, `sheet` from Task 3; `drawSheet`, `fitLetterbox` from Task 1.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Branch `renderPreview` on the tab**

In `TextureStudioSurface.vue`, replace the `renderPreview` function (lines 253-273) with:

```ts
function renderPreview() {
  if (inspectorTab.value === 'output') return renderSheetPreview()
  const el = canvas.value; if (!el) return
  const n = repeat.value
  el.width = TILE * n; el.height = TILE * n
  const ctx = el.getContext('2d')!
  // Base tile → stylize (dither/posterize/duotone). TILE=256 is a multiple of 64
  // so the dither pattern stays seamless across the repeat.
  const tile = stylizeTile(textureFx.render(params, TILE, TILE, 0), params, TILE, TILE)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.drawImage(tile, x * TILE, y * TILE)
    }
  }
  if (seams.value) {
    ctx.strokeStyle = 'rgba(159,232,208,0.7)'; ctx.lineWidth = 1
    for (let i = 1; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(i * TILE, 0); ctx.lineTo(i * TILE, el.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * TILE); ctx.lineTo(el.width, i * TILE); ctx.stroke()
    }
  }
}

// The Output tab shows what actually exports: the sheet's aspect, at the sheet's
// density. The canvas element IS the sheet (scaled down), so no letterbox bars are
// drawn here — the CSS box centres it. fitLetterbox only picks a sane pixel size.
const SHEET_PREVIEW_BOX = 720
function renderSheetPreview() {
  const el = canvas.value; if (!el) return
  const s = sheet.value
  const box = fitLetterbox(s, SHEET_PREVIEW_BOX, SHEET_PREVIEW_BOX)
  el.width = box.w; el.height = box.h
  const ctx = el.getContext('2d')!
  ctx.clearRect(0, 0, el.width, el.height)
  // Render the tile at roughly its on-screen size — never the sheet's true tile size,
  // or previewing a 4K sheet would cost a 4K render.
  const px = Math.max(32, Math.min(512, Math.round(s.tile * (box.w / s.w))))
  const tile = stylizeTile(textureFx.render(params, px, px, 0), params, px, px)
  drawSheet(ctx, tile, s, box.w, box.h)
}
```

- [ ] **Step 2: Re-render when the tab changes**

Immediately after the `renderSheetPreview` function, add:

```ts
// Switching tabs changes what the canvas is showing, not just which controls are listed.
watch(inspectorTab, () => renderPreview())
```

Add `watch` to the vue import on line 2 so it reads:

```ts
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
```

- [ ] **Step 3: Hide the tile-inspector buttons on the Output tab**

In the `#preview` template block, change the wrapper of the repeat/seam buttons (line 553) from:

```html
        <div class="flex items-center gap-2 text-xs">
```

to:

```html
        <div v-if="onDesign" class="flex items-center gap-2 text-xs">
```

The `1×/2×/3×` buttons and `Highlight seams` exist to judge the tile's repeat; on the Output tab the repeat is set by the sheet, so they would be two contradicting controls for one thing.

- [ ] **Step 4: Verify it compiles**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TextureStudioSurface" || echo "no surface errors"
```

Expected: `no surface errors`.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor && git add frontend/app/components/vue-canvas/TextureStudioSurface.vue && git commit -m "feat(pattern-studio): Output tab previews the framed sheet"
```

---

### Task 5: The node card shows the sheet's shape

**Files:**
- Modify: `frontend/app/components/vue-canvas/TextureStudioNode.vue:41-65` (`renderFrame`)

**Interfaces:**
- Consumes: `sheetFromParams`, `fitLetterbox`, `isSheetFramed`, `drawSheet` (imported in Task 2 Step 2).
- Produces: nothing.

A pattern on the default `Tile · square` preset keeps its full-bleed 3:2 swatch — that output is a material, not a framed picture, and letterboxing every existing pattern into a 148px square would be a visual regression for work that did not change. Once a real sheet is chosen, the card letterboxes it.

- [ ] **Step 1: Rewrite `renderFrame`**

Replace lines 41-65 of `TextureStudioNode.vue`:

```ts
function renderFrame() {
  const canvas = canvasEl.value
  if (!canvas) return
  if (canvas.width !== PREVIEW_W || canvas.height !== PREVIEW_H) {
    canvas.width = PREVIEW_W
    canvas.height = PREVIEW_H
  }
  try {
    const p = params.value
    const s = sheetFromParams(p)
    // On the Tile preset the output is a material sample, so fill the card edge to
    // edge as it always has. Once a sheet is chosen the card shows that sheet's
    // shape, letterboxed — otherwise a 9:16 pattern would look 3:2 on the canvas.
    const box = isSheetFramed(p)
      ? fitLetterbox(s, PREVIEW_W, PREVIEW_H)
      : { w: PREVIEW_W, h: PREVIEW_H, x: 0, y: 0 }
    // Render the seamless tile SQUARE (so cells stay square / undistorted), then
    // repeat-fill. Drawing a square tile straight into a 3:2 canvas stretched the
    // pattern horizontally.
    const TILE = Math.max(32, Math.min(256, Math.round(s.tile * (box.w / s.w))))
    const base = textureFx.render(p, TILE, TILE, 0)
    const out = stylizeTile(base, p, TILE, TILE)
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H)
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.x, box.y, box.w, box.h)
    ctx.clip()
    ctx.translate(box.x, box.y)
    drawSheet(ctx, out, s, box.w, box.h)
    ctx.restore()
    glError.value = null
  }
  catch (e: any) {
    glError.value = String(e?.message ?? e)
  }
}
```

Note the unframed branch passes `box.w = PREVIEW_W` while `s.w` may be 1024, so `drawSheet`'s scale is `220/1024` — the tile lands at ~PREVIEW-appropriate size and repeat-fills the card exactly as the old `createPattern` did.

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TextureStudioNode" || echo "no node errors"
```

Expected: `no node errors`.

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor && git add frontend/app/components/vue-canvas/TextureStudioNode.vue && git commit -m "feat(pattern-studio): node card letterboxes a framed sheet"
```

---

### Task 6: Verify it in the running app

**Files:** none — this task produces evidence, not code.

A preview that "looks right" is not evidence that the export path ran; a graceful fallback renders something plausible either way. Every check below must produce a number you read, or a difference you caused.

- [ ] **Step 1: Start the dev server**

Use `preview_start` with `.claude/launch.json`, or from a terminal:

```bash
cd /Users/julien/Documents/GitHub/Sailor && ./dev.sh
```

`./dev.sh` kills any stale server and takes over ports 3000 + 8188. Check `ps` for orphaned nuxt servers from parallel sessions first. Use `127.0.0.1`, not `localhost` — localhost hits the IPv6 WS listener and 426s.

- [ ] **Step 2: Open Pattern Studio and confirm the tab strip**

Add a Pattern Studio node, open it, and confirm: a `Design | Output` strip sits above the controls; Design shows Lattice/Cell/Fills and no sheet controls; Output shows Sheet / Tile size and no Fills.

- [ ] **Step 3: Confirm the default is unchanged**

On the default pattern (`Tile · square`, tile 1024), the Output readout must read **1024 × 1024 px · 1 × 1 repeats · tiles edge-to-edge**. Click Download PNG and check the file's real dimensions:

```bash
cd ~/Downloads && ls -t texture_*.png | head -1 | xargs -I{} sips -g pixelWidth -g pixelHeight {}
```

Expected: 1024 × 1024. This is the back-compat check on the real export path.

- [ ] **Step 4: Change the sheet and prove the export followed**

Set Sheet to `1920 × 1080 (16:9)` and Tile size to `512`. The readout must say `3.75 × 2.11 repeats` and `not self-tiling`. The Output preview must be visibly 16:9 with roughly 4 tiles across. Download again:

```bash
cd ~/Downloads && ls -t texture_*.png | head -1 | xargs -I{} sips -g pixelWidth -g pixelHeight {}
```

Expected: 1920 × 1080. If it still says 1024 × 1024, `exportBlob` is not reading the sheet — do not proceed.

- [ ] **Step 5: Prove the density dial is real, not decorative**

Keep the 16:9 sheet and switch Tile size 512 → 2048. The readout must change to `0.94 × 0.53 repeats`, and the preview must show a single large partial tile rather than a fine field. A tile-size control that changes the readout but not the image means `drawSheet` is being handed the wrong scale.

- [ ] **Step 6: Check the node card**

Close the studio. With the 16:9 sheet set, the node card preview must be a letterboxed wide strip with dark bars above and below. Then set Sheet back to `Tile · square` — the card must return to a full-bleed swatch.

- [ ] **Step 7: Check a reloaded pattern**

Reload the page. The pattern must come back with the same sheet settings and the same card framing — the params are saved through the studio's existing autosave, so a reset here means the keys are not reaching `sailor_textureStudio`.

- [ ] **Step 8: Report**

Report each step's actual observed value — the two `sips` outputs in particular. Do not report "verified" for any step that was not run.

---

## Notes for the implementer

- `sections.ts` already contains `'Output'` in `TEXTURE_SECTIONS`; the comment there calling it "reserved for future export controls" can be updated to describe what it now holds.
- The new controls flow into the in-studio agent (`describeTexture` / `applyTextureCommand`) and Collections bindables automatically, because both derive from `TEXTURE_CONTROLS`. That is intended — one declaration, all capabilities. Sweeping `tilePx` across a Collection is odd but harmless, and v1 does not exclude it.
- `StudioColor`-style validation is not involved here; all four controls are plain select/slider.
- If a `sips` command is unavailable, `python3 -c "from PIL import Image; print(Image.open('f.png').size)"` works, or open Get Info in Finder.
