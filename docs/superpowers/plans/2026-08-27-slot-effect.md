# Slot Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Expressive Studio (Space Type) effect, **Slot**: a row of fixed slot-window apertures, each scrolling a vertical reel that lands staggered left-to-right, rotating between multiple messages with selectable filler.

**Architecture:** One new `SpaceTypeEffect` plugin (`effects/slot.ts`) — no engine/surface changes. Rendering unit is **one quad per slot**: a tall white-mask "reel" canvas on the mesh's `alphaMap` (scrolled via its own texture matrix ⇒ hard-clipped by the aperture for free), the word fill pinned to the aperture as `map`/`color`, plus a small `onBeforeCompile` shader for motion-blur / drum-curve / edge-falloff. All timing/cell-layout math is isolated in a pure, unit-tested `slotGeometry.ts`.

**Tech Stack:** TypeScript, Three.js (r0.171), Vitest, Nuxt 4. Reuses `layoutChars` (glyph atlas), `fills.ts`/`fillTile.ts` (fill model), `palette.ts` (`defaultFillsFor`), `rng.ts` (`mulberry32`/`hashSeed`).

## Global Constraints

- Effect `id` MUST match `/^[a-z0-9]+$/` (backend validates ids for thumbnail/default saves). Use `id: 'slot'`.
- Every `ControlSpec.group` MUST be a member of `SPACE_TYPE_SECTIONS` (`app/lib/spacetype/sections.ts`) or the control is silently hidden. Allowed groups used here: `Type`, `Color`, `Stroke`, `Layout`, `Motion`, `Look`, `Transform`.
- The FIRST `fillList` control's `default` MUST equal `defaultFillsFor(JSON.parse(default).length, 'slot')` (palette guard `tests/unit/spacetype-palette.unit.spec.ts`). `wordFill` is that control ⇒ default `defaultFillsFor(1, 'slot')`.
  - **Baseline:** on `main` this guard already has 4 reds (ring, cornerpin, shutter, loft) from intentional overrides — NOT regressions. Slot must not add a 5th.
- Per-scene state lives on `root.userData`, NEVER module vars (concurrent engines share the singleton effect module).
- Paths below are relative to `frontend/`. Run all commands from `frontend/`.
- Do NOT `git add -A` — the working tree has unrelated uncommitted changes from another session. Stage only the exact files each task lists.

---

## File Structure

- **Create** `app/lib/spacetype/slotGeometry.ts` — pure helpers: `Cell` type, `buildReel`, `reelScroll`, `settleTime`, `easeOutBack`, `SHAPE_IDS`, filler selection. No THREE, no DOM.
- **Create** `app/lib/spacetype/effects/slot.ts` — the `SpaceTypeEffect` (controls, canvas painter, `buildScene`, `update`, `liveKeys`, `loopRates`).
- **Modify** `app/lib/spacetype/effects/index.ts` — import + register `slotEffect` after `loftEffect`.
- **Create** `tests/unit/slot-geometry.unit.spec.ts` — unit tests for `slotGeometry.ts`.

---

## Task 1: `slotGeometry.ts` — cell layout (`buildReel`) + shapes

**Files:**
- Create: `app/lib/spacetype/slotGeometry.ts`
- Test: `tests/unit/slot-geometry.unit.spec.ts`

**Interfaces:**
- Produces:
  - `type Cell = { kind: 'text' | 'shape' | 'blank'; value: string }`
  - `interface ReelParams { messages: string; reelUnit: 'word' | 'char'; fillerSource: 'messages' | 'glyphs' | 'shapes' | 'custom'; glyphSet: string; shapeSet: string; fillerTokens: string; fillerDensity: number; align: 'left' | 'center' }`
  - `interface Reel { slotCount: number; messageCount: number; stride: number; cells: Cell[][] }` (`cells[j]` is slot j's cell strip, length `messageCount * stride`; land cell for message m at index `m * stride`)
  - `function buildReel(p: ReelParams): Reel`
  - `const SHAPE_IDS: Record<string, string[]>` (keys: `basic`, `geometric`)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/slot-geometry.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildReel, type ReelParams } from '~/lib/spacetype/slotGeometry'

const base: ReelParams = {
  messages: 'MAKE IT REAL\nSHIP TODAY',
  reelUnit: 'word',
  fillerSource: 'messages',
  glyphSet: 'mixed',
  shapeSet: 'geometric',
  fillerTokens: 'A B C',
  fillerDensity: 3,
  align: 'left',
}

describe('buildReel', () => {
  it('slotCount is the longest message token count (word mode)', () => {
    const r = buildReel(base)
    expect(r.slotCount).toBe(3)       // "MAKE IT REAL" = 3 words
    expect(r.messageCount).toBe(2)
    expect(r.stride).toBe(4)          // 1 land + 3 filler
  })

  it('each slot strip has messageCount*stride cells, land cells at m*stride', () => {
    const r = buildReel(base)
    expect(r.cells).toHaveLength(3)
    for (const strip of r.cells) expect(strip).toHaveLength(2 * 4)
    // slot 0, message 0 land cell = "MAKE"
    expect(r.cells[0]![0]).toEqual({ kind: 'text', value: 'MAKE' })
    // slot 0, message 1 land cell (index stride=4) = "SHIP"
    expect(r.cells[0]![4]).toEqual({ kind: 'text', value: 'SHIP' })
  })

  it('pads short messages with blank land cells (left align)', () => {
    // "SHIP TODAY" has 2 words; slot 2 (index 2) is blank for message 1
    const r = buildReel(base)
    expect(r.cells[2]![4]).toEqual({ kind: 'blank', value: '' })
    // but slot 2 message 0 = "REAL"
    expect(r.cells[2]![0]).toEqual({ kind: 'text', value: 'REAL' })
  })

  it('char mode makes one slot per character', () => {
    const r = buildReel({ ...base, messages: 'GO\nHEY', reelUnit: 'char' })
    expect(r.slotCount).toBe(3)       // "HEY" = 3 chars
    expect(r.cells[0]![0]).toEqual({ kind: 'text', value: 'G' })
  })

  it('shape filler emits shape cells; deterministic for same params', () => {
    const r1 = buildReel({ ...base, fillerSource: 'shapes' })
    const r2 = buildReel({ ...base, fillerSource: 'shapes' })
    expect(r1.cells).toEqual(r2.cells)
    const filler = r1.cells[0]![1]     // first filler after land 0
    expect(filler!.kind).toBe('shape')
  })

  it('fillerDensity 0 makes stride 1 (no filler)', () => {
    const r = buildReel({ ...base, fillerDensity: 0 })
    expect(r.stride).toBe(1)
    expect(r.cells[0]).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/slot-geometry.unit.spec.ts`
Expected: FAIL — `buildReel` not found / module missing.

- [ ] **Step 3: Write minimal implementation**

Create `app/lib/spacetype/slotGeometry.ts`:

```ts
import { mulberry32, hashSeed } from './rng'

/** One cell in a slot's reel strip: a word/char (`text`), a geometric shape id (`shape`), or empty (`blank`). */
export type Cell = { kind: 'text' | 'shape' | 'blank'; value: string }

export interface ReelParams {
  messages: string
  reelUnit: 'word' | 'char'
  fillerSource: 'messages' | 'glyphs' | 'shapes' | 'custom'
  glyphSet: string
  shapeSet: string
  fillerTokens: string
  fillerDensity: number
  align: 'left' | 'center'
}

export interface Reel {
  slotCount: number
  messageCount: number
  /** cells per message = 1 land + fillerDensity filler. */
  stride: number
  /** cells[slotIndex] = that slot's ordered strip (length messageCount*stride). */
  cells: Cell[][]
}

/** Curated geometric shape catalogs (ids consumed by slot.ts's drawShapeToken). */
export const SHAPE_IDS: Record<string, string[]> = {
  basic: ['circle', 'square', 'triangle'],
  geometric: ['circle', 'square', 'triangle', 'diamond', 'cross', 'ring', 'chevron'],
}

const GLYPH_SETS: Record<string, string> = {
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '$#%&@*+=?!',
  mixed: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$#%&',
}

function splitMessages(raw: string): string[] {
  const out = String(raw ?? '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
  return out.length ? out : ['SLOT']
}

/** Tokenize one message into its landing units. */
function tokensOf(message: string, unit: 'word' | 'char'): string[] {
  if (unit === 'char') return Array.from(message).filter(c => c.trim() !== '')
  return message.split(/\s+/).filter(w => w.length > 0)
}

/** The pool of possible filler tokens for a given source. Returns Cells so shapes/text mix cleanly. */
function fillerPool(p: ReelParams, allTokens: string[]): Cell[] {
  switch (p.fillerSource) {
    case 'glyphs': {
      const set = GLYPH_SETS[p.glyphSet] ?? GLYPH_SETS.mixed!
      return Array.from(set).map(v => ({ kind: 'text', value: v }) as Cell)
    }
    case 'shapes': {
      const ids = SHAPE_IDS[p.shapeSet] ?? SHAPE_IDS.geometric!
      return ids.map(v => ({ kind: 'shape', value: v }) as Cell)
    }
    case 'custom': {
      const toks = String(p.fillerTokens ?? '').split(/\s+/).filter(t => t.length > 0)
      const src = toks.length ? toks : ['A', 'B', 'C']
      return src.map(v => ({ kind: 'text', value: v }) as Cell)
    }
    case 'messages':
    default: {
      const src = allTokens.length ? allTokens : ['SLOT']
      return src.map(v => ({ kind: 'text', value: v }) as Cell)
    }
  }
}

/** Where message m's token t sits among slotCount slots, honoring align. Returns the slot index or -1. */
function slotForToken(t: number, tokenCount: number, slotCount: number, align: 'left' | 'center'): number {
  if (align === 'center') {
    const start = Math.floor((slotCount - tokenCount) / 2)
    return start + t
  }
  return t // left
}

export function buildReel(p: ReelParams): Reel {
  const messages = splitMessages(p.messages)
  const perMsgTokens = messages.map(m => tokensOf(m, p.reelUnit))
  const slotCount = Math.max(1, ...perMsgTokens.map(t => t.length))
  const messageCount = messages.length
  const F = Math.max(0, Math.floor(Number(p.fillerDensity) || 0))
  const stride = 1 + F

  // Landing token per (slot j, message m), '' when this slot is padded blank for that message.
  const landing: string[][] = Array.from({ length: slotCount }, () => Array.from({ length: messageCount }, () => ''))
  for (let m = 0; m < messageCount; m++) {
    const toks = perMsgTokens[m]!
    for (let t = 0; t < toks.length; t++) {
      const j = slotForToken(t, toks.length, slotCount, p.align)
      if (j >= 0 && j < slotCount) landing[j]![m] = toks[t]!
    }
  }

  const allTokens = perMsgTokens.flat()
  const pool = fillerPool(p, allTokens)

  const cells: Cell[][] = []
  for (let j = 0; j < slotCount; j++) {
    const strip: Cell[] = []
    for (let m = 0; m < messageCount; m++) {
      const land = landing[j]![m]!
      strip.push(land ? { kind: 'text', value: land } : { kind: 'blank', value: '' })
      // Deterministic filler: seeded by slot+message+k so a given config is reproducible.
      const rand = mulberry32(hashSeed(`slot|${j}|${m}|${p.fillerSource}`))
      for (let k = 0; k < F; k++) {
        const pick = pool.length ? pool[Math.floor(rand() * pool.length)]! : { kind: 'blank', value: '' } as Cell
        strip.push({ ...pick })
      }
    }
    cells.push(strip)
  }

  return { slotCount, messageCount, stride, cells }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/slot-geometry.unit.spec.ts`
Expected: PASS (all `buildReel` cases).

- [ ] **Step 5: Commit**

```bash
git add app/lib/spacetype/slotGeometry.ts tests/unit/slot-geometry.unit.spec.ts
git commit -m "feat(slot): buildReel cell layout + shape catalog"
```

---

## Task 2: `slotGeometry.ts` — reel scroll timing (seamless loop)

**Files:**
- Modify: `app/lib/spacetype/slotGeometry.ts`
- Test: `tests/unit/slot-geometry.unit.spec.ts`

**Interfaces:**
- Produces:
  - `interface Timing { messageCount: number; stride: number; slotCount: number; hold: number; stagger: number; overshoot: number }`
  - `function reelScroll(t01: number, slot: number, T: Timing): { offset: number; speed: number }` — `offset` = fractional cell position mod stripLen (drives `alphaMap.offset.y = offset/stripLen`); `speed` ∈ [0,1] normalized (drives blur + spin-dim).
  - `function settleTime(slot: number, slotCount: number, hold: number, stagger: number): number` — the local-segment u∈[0,1] at which this slot settles.
  - `function easeOutBack(p: number, s: number): number`

**Timing model (must match this exactly):** loop `t01∈[0,1)` splits into `messageCount` equal segments. In segment m: hold message m for `hold` fraction, then move to message m+1 over the rest; slot j settles at `settleTime(j)` (increasing in j ⇒ left→right cascade), then holds. `offset` advances exactly `stride` cells per segment ⇒ `messageCount*stride` = strip length over the loop ⇒ `alphaMap.offset.y` wraps seamlessly. `easeOutBack` overshoots then settles exactly at 1.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/slot-geometry.unit.spec.ts`)

```ts
import { reelScroll, settleTime, type Timing } from '~/lib/spacetype/slotGeometry'

const T: Timing = { messageCount: 2, stride: 4, slotCount: 3, hold: 0.4, stagger: 0.5, overshoot: 0.3 }
const L = T.messageCount * T.stride // strip length = 8

describe('reelScroll', () => {
  it('is seamless: offset at t01=0 equals offset as t01→1 (mod strip length)', () => {
    for (let j = 0; j < T.slotCount; j++) {
      const a = reelScroll(0, j, T).offset
      const b = reelScroll(0.999999, j, T).offset
      const d = Math.min(Math.abs(a - b), L - Math.abs(a - b))
      expect(d).toBeLessThan(0.02)
    }
  })

  it('holds message 0 at the start of the loop (offset 0, ~0 speed)', () => {
    const r = reelScroll(0.05, 0, T) // within hold sub-phase of segment 0
    expect(r.offset).toBeCloseTo(0, 5)
    expect(r.speed).toBeLessThan(0.02)
  })

  it('lands slot j on integer cell offsets after settling', () => {
    // End of segment 0 (t01≈0.499): every slot has settled onto message 1's land cell (offset 4).
    // (At t01≈0.999 the reel has already wrapped toward message 0's land cell, offset→0.)
    const r = reelScroll(0.499, 1, T)
    expect(r.offset).toBeCloseTo(4, 1)
  })

  it('offset is continuous across the internal segment boundary', () => {
    const before = reelScroll(0.4999, 0, T).offset
    const after = reelScroll(0.5001, 0, T).offset
    // near cell 4 on both sides (end of seg0 settles to 4; start of seg1 holds at 4)
    expect(Math.abs(before - after)).toBeLessThan(0.1)
  })

  it('staggers landings left-to-right: settleTime increases with slot index', () => {
    expect(settleTime(0, 3, 0.4, 0.5)).toBeLessThanOrEqual(settleTime(1, 3, 0.4, 0.5))
    expect(settleTime(1, 3, 0.4, 0.5)).toBeLessThanOrEqual(settleTime(2, 3, 0.4, 0.5))
    // last slot always settles at u=1
    expect(settleTime(2, 3, 0.4, 0.5)).toBeCloseTo(1, 5)
  })

  it('stagger 0 makes every slot settle at u=1', () => {
    expect(settleTime(0, 3, 0.4, 0)).toBeCloseTo(1, 5)
    expect(settleTime(1, 3, 0.4, 0)).toBeCloseTo(1, 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/slot-geometry.unit.spec.ts`
Expected: FAIL — `reelScroll`/`settleTime` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `app/lib/spacetype/slotGeometry.ts`)

```ts
export interface Timing {
  messageCount: number
  stride: number
  slotCount: number
  hold: number
  stagger: number
  overshoot: number
}

/** Overshoot easing: 0 at p=0, 1 at p=1, overshoots above 1 near the end when s>0 (settles exactly). */
export function easeOutBack(p: number, s: number): number {
  const c1 = s
  const c3 = c1 + 1
  const q = p - 1
  return 1 + c3 * q * q * q + c1 * q * q
}

/** Local-segment settle time (u∈[hold,1]) for a slot: larger slot index ⇒ later ⇒ left-to-right cascade.
 *  stagger 0 ⇒ all settle at u=1; stagger 1 ⇒ slot j settles proportionally to (j+1)/slotCount. */
export function settleTime(slot: number, slotCount: number, hold: number, stagger: number): number {
  const frac = slotCount > 0 ? (slot + 1) / slotCount : 1
  const lerped = 1 - stagger * (1 - frac) // 1 at stagger 0, frac at stagger 1
  return hold + (1 - hold) * lerped
}

export function reelScroll(t01: number, slot: number, T: Timing): { offset: number; speed: number } {
  const M = Math.max(1, T.messageCount)
  const St = Math.max(1, T.stride)
  const L = M * St
  const tt = ((t01 % 1) + 1) % 1
  const m = Math.min(M - 1, Math.floor(tt * M))
  const u = tt * M - m
  const Pm = m * St
  const h = Math.min(0.95, Math.max(0, T.hold))
  const uLand = settleTime(slot, Math.max(1, T.slotCount), h, Math.min(1, Math.max(0, T.stagger)))

  let p: number
  if (u <= h) p = 0
  else if (u >= uLand) p = 1
  else p = (u - h) / Math.max(1e-4, uLand - h)

  const s = Math.min(1, Math.max(0, T.overshoot)) * 1.70158
  const e = easeOutBack(p, s)
  const offsetRaw = Pm + St * e
  const offset = ((offsetRaw % L) + L) % L

  let speed = 0
  if (p > 0 && p < 1) {
    const q = p - 1
    const dedp = 3 * (s + 1) * q * q + 2 * s * q
    const vCells = Math.abs((St * dedp) / Math.max(1e-4, uLand - h))
    speed = Math.min(1, vCells / (St * 3))
  }
  return { offset, speed }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/slot-geometry.unit.spec.ts`
Expected: PASS (all `buildReel` + `reelScroll` cases).

- [ ] **Step 5: Commit**

```bash
git add app/lib/spacetype/slotGeometry.ts tests/unit/slot-geometry.unit.spec.ts
git commit -m "feat(slot): seamless reel-scroll timing with staggered settle"
```

---

## Task 3: `slot.ts` effect — flat working effect (paint + build + rotate)

**Files:**
- Create: `app/lib/spacetype/effects/slot.ts`
- Modify: `app/lib/spacetype/effects/index.ts` (import + register after `loftEffect`)
- Test: reuse `tests/unit/spacetype-sections.unit.spec.ts` + `tests/unit/spacetype-palette.unit.spec.ts` (must stay green for `slot`) + typecheck.

**Interfaces:**
- Consumes: `buildReel`, `reelScroll`, `type Cell`, `type Timing` from `../slotGeometry`; `layoutChars` from `../charLayout`; `normalizeFill`, `fillIsTextured`, `fillShaderTexture`, `fillTiling`, `fillPrimary`, `type Fill` from `../fills`; `fillIsShader` from `../fillTile`; `defaultsFromControls`, `type SpaceTypeEffect`, `type ControlSpec`, `type Params` from `../effect`; `defaultFillsFor` from `../palette`; `resolveFontFamily`, `fontHasWeightAxis` from `~/lib/font/resolveFamily`.
- Produces: `export const slotEffect: SpaceTypeEffect`.

- [ ] **Step 1: Write the effect module**

Create `app/lib/spacetype/effects/slot.ts`:

```ts
import * as THREE from 'three'
import { defaultsFromControls, type ControlSpec, type Params, type SpaceTypeEffect } from '../effect'
import { buildReel, reelScroll, type Cell, type Timing } from '../slotGeometry'
import { layoutChars } from '../charLayout'
import { normalizeFill, fillIsTextured, fillShaderTexture, fillTiling, fillPrimary, type Fill } from '../fills'
import { fillIsShader } from '../fillTile'
import { defaultFillsFor } from '../palette'
import { resolveFontFamily, fontHasWeightAxis } from '~/lib/font/resolveFamily'

const controls: ControlSpec[] = [
  // Type
  { key: 'messages', label: 'Messages', kind: 'textList', default: 'MAKE IT REAL\nSHIP TODAY', group: 'Type' },
  { key: 'reelUnit', label: 'Reel unit', kind: 'select', options: ['word', 'char'], default: 'word', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'typeSize', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'fillerSource', label: 'Filler', kind: 'select', options: ['messages', 'glyphs', 'shapes', 'custom'], default: 'messages', group: 'Type' },
  { key: 'glyphSet', label: 'Glyph set', kind: 'select', options: ['alpha', 'digits', 'symbols', 'mixed'], default: 'mixed', group: 'Type', showIf: { key: 'fillerSource', equals: 'glyphs' } },
  { key: 'shapeSet', label: 'Shape set', kind: 'select', options: ['basic', 'geometric'], default: 'geometric', group: 'Type', showIf: { key: 'fillerSource', equals: 'shapes' } },
  { key: 'fillerTokens', label: 'Filler tokens', kind: 'textList', default: 'A B C', group: 'Type', showIf: { key: 'fillerSource', equals: 'custom' } },
  { key: 'fillerDensity', label: 'Filler amount', kind: 'slider', min: 0, max: 12, step: 1, default: 4, group: 'Type' },
  // Color
  { key: 'wordFill', label: 'Word fill', kind: 'fillList', default: defaultFillsFor(1, 'slot'), group: 'Color' },
  { key: 'slotFill', label: 'Slot fill', kind: 'fillList', default: '[{"type":"solid","a":"#15221F","b":"#000000","textColor":"#ffffff","angle":45,"density":8}]', group: 'Color' },
  // Stroke
  { key: 'frameWidth', label: 'Frame', kind: 'slider', min: 0, max: 0.4, step: 0.01, default: 0, group: 'Stroke' },
  { key: 'frameColor', label: 'Frame color', kind: 'color', default: '#000000', group: 'Stroke', showIf: { key: 'frameWidth', notEquals: 0 } },
  // Layout
  { key: 'reelShape', label: 'Reel shape', kind: 'select', options: ['flat', 'drum'], default: 'drum', group: 'Layout' },
  { key: 'curveAmount', label: 'Drum curve', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Layout', showIf: { key: 'reelShape', equals: 'drum' } },
  { key: 'slotAspect', label: 'Slot aspect', kind: 'slider', min: 0.4, max: 3, step: 0.05, default: 0.9, group: 'Layout' },
  { key: 'slotGap', label: 'Slot gap', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.12, group: 'Layout' },
  { key: 'columns', label: 'Columns', kind: 'slider', min: 1, max: 12, step: 1, default: 6, group: 'Layout' },
  { key: 'align', label: 'Align', kind: 'select', options: ['left', 'center'], default: 'center', group: 'Layout' },
  { key: 'edgeFalloff', label: 'Edge falloff', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Layout' },
  // Motion
  { key: 'direction', label: 'Direction', kind: 'select', options: ['up', 'down'], default: 'up', group: 'Motion' },
  { key: 'stagger', label: 'Stagger', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Motion' },
  { key: 'overshoot', label: 'Overshoot', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Motion' },
  { key: 'hold', label: 'Hold', kind: 'slider', min: 0, max: 0.9, step: 0.01, default: 0.4, group: 'Motion' },
  { key: 'blur', label: 'Motion blur', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Motion' },
  // Look
  { key: 'spinDim', label: 'Spin dim', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Look' },
  // Transform (engine applies scale/rotate from these — see engine.ts:348-349)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

const SLOT_DEFAULTS = defaultsFromControls(controls)
function n(p: Params, k: string): number { return Number(p[k] ?? SLOT_DEFAULTS[k]) }
function str(p: Params, k: string): string { return String(p[k] ?? SLOT_DEFAULTS[k]) }

/** wordFill/slotFill store one Fill as JSON (bare object OR [fill]); parse tolerantly like ring's resolveWordFill. */
function resolveFill(raw: unknown, fallback: Fill): Fill {
  if (typeof raw === 'string' && raw) {
    try {
      const v = JSON.parse(raw)
      return normalizeFill(Array.isArray(v) ? v[0] : v)
    } catch { /* fall through */ }
  }
  return fallback
}

const WHITE_FILL: Fill = { type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }

// Cell height in reel-canvas px; width derived from slotAspect. Supersample-ish for crisp glyphs.
const CELL_PX = 128

/** Draw a white geometric shape token centered in [0,0,w,h]. */
function drawShapeToken(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2, cy = y + h / 2
  const r = Math.min(w, h) * 0.32
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(2, r * 0.28)
  ctx.beginPath()
  switch (id) {
    case 'square': ctx.rect(cx - r, cy - r, r * 2, r * 2); ctx.fill(); break
    case 'triangle':
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath(); ctx.fill(); break
    case 'diamond':
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill(); break
    case 'cross':
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.stroke(); break
    case 'ring':
      ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); break
    case 'chevron':
      ctx.moveTo(cx - r, cy - r * 0.5); ctx.lineTo(cx, cy + r * 0.5); ctx.lineTo(cx + r, cy - r * 0.5); ctx.stroke(); break
    case 'circle':
    default: ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); break
  }
  ctx.restore()
}

/** Paint one slot's cell strip as a tall WHITE-mask canvas (one cell per CELL_PX row). */
function paintReelCanvas(cells: Cell[], cellW: number, family: string, weight: number, hasWght: boolean, tracking: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(cellW))
  canvas.height = Math.max(2, cells.length * CELL_PX)
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!
    const y0 = i * CELL_PX
    if (cell.kind === 'blank') continue
    if (cell.kind === 'shape') { drawShapeToken(ctx, cell.value, 0, y0, canvas.width, CELL_PX); continue }
    // text: rasterize glyph atlas (white), draw contained + centered in the cell
    const layout = layoutChars({
      text: cell.value, fontFamily: family, fontWeight: hasWght ? weight : 400,
      fontSizePx: CELL_PX * 0.7, tracking, scaleX: 1, color: '#ffffff',
      axes: hasWght ? { wght: weight } : undefined,
    })
    const img = layout.texture.image as HTMLCanvasElement
    const pad = CELL_PX * 0.14
    const maxW = canvas.width - pad * 2
    const maxH = CELL_PX - pad * 2
    const scale = Math.min(maxW / img.width, maxH / img.height)
    const dw = img.width * scale, dh = img.height * scale
    ctx.drawImage(img, (canvas.width - dw) / 2, y0 + (CELL_PX - dh) / 2, dw, dh)
    layout.texture.dispose()
  }
  return canvas
}

interface SlotMesh { mesh: THREE.Mesh; alphaTex: THREE.CanvasTexture; cellCount: number; slotIndex: number }
interface SlotState { slots: SlotMesh[]; messageCount: number; stride: number; slotCount: number }

export const slotEffect: SpaceTypeEffect = {
  id: 'slot',
  label: 'Slot',
  controls,
  // Live: motion/look/placement that update() reads each frame — no structural rebuild.
  liveKeys: ['direction', 'stagger', 'overshoot', 'hold', 'blur', 'spinDim', 'edgeFalloff', 'curveAmount', 'slotGap', 'reelShape', 'scale', 'rotateX', 'rotateY', 'rotateZ'],
  // The whole message rotation is authored as ONE seamless loop (see reelScroll) — single loop.
  loopRates() { return [1] },

  buildScene(three, params) {
    const root = new three.Group()
    const reel = buildReel({
      messages: str(params, 'messages'),
      reelUnit: (str(params, 'reelUnit') as 'word' | 'char'),
      fillerSource: (str(params, 'fillerSource') as ReelSource),
      glyphSet: str(params, 'glyphSet'),
      shapeSet: str(params, 'shapeSet'),
      fillerTokens: str(params, 'fillerTokens'),
      fillerDensity: n(params, 'fillerDensity'),
      align: (str(params, 'align') as 'left' | 'center'),
    })

    const family = resolveFontFamily(str(params, 'font'))
    const hasWght = fontHasWeightAxis(family)
    const weight = n(params, 'typeWeight')
    const tracking = n(params, 'tracking')

    const wf = resolveFill(params.wordFill, WHITE_FILL)
    const sf = resolveFill(params.slotFill, { type: 'solid', a: '#15221F', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 })
    const wfTextured = fillIsTextured(wf)
    let wordFillMap: THREE.Texture | null = null
    if (wfTextured) {
      if (fillIsShader(wf)) wordFillMap = fillShaderTexture(three, wf)
      else {
        wordFillMap = fillShaderTexture(three, wf).clone()
        wordFillMap.needsUpdate = true
        wordFillMap.repeat.set(fillTiling(wf), fillTiling(wf))
        root.userData.tex = wordFillMap
      }
    }

    const aspect = n(params, 'slotAspect')            // w/h
    const H = 1                                        // slot world height (unit); scale control zooms the scene
    const W = H * aspect
    const cols = Math.min(Math.max(1, Math.round(n(params, 'columns'))), reel.slotCount)
    const rows = Math.ceil(reel.slotCount / cols)

    const slots: SlotMesh[] = []
    for (let j = 0; j < reel.slotCount; j++) {
      const cells = reel.cells[j]!
      const cellW = CELL_PX * aspect
      const canvas = paintReelCanvas(cells, cellW, family, weight, hasWght, tracking)
      const alphaTex = new three.CanvasTexture(canvas)
      alphaTex.wrapS = three.ClampToEdgeWrapping
      alphaTex.wrapT = three.RepeatWrapping
      alphaTex.repeat.set(1, 1 / cells.length)         // show one cell
      alphaTex.needsUpdate = true

      const geo = new three.PlaneGeometry(W, H, 1, 24) // vertical subdivisions for drum curve (Task 4)
      const material = new three.MeshBasicMaterial({
        map: wfTextured ? wordFillMap : null,
        color: wfTextured ? new three.Color('#ffffff') : fillPrimary(three, wf),
        alphaMap: alphaTex,
        transparent: true,
        side: three.DoubleSide,
        depthWrite: false,
      })

      // Slot background quad (behind the reel).
      const bgGeo = new three.PlaneGeometry(W, H, 1, 1)
      const bgMat = new three.MeshBasicMaterial({
        map: fillIsTextured(sf) ? fillShaderTexture(three, sf) : null,
        color: fillIsTextured(sf) ? new three.Color('#ffffff') : fillPrimary(three, sf),
        side: three.DoubleSide,
        transparent: true,
        depthWrite: false,
      })
      const bg = new three.Mesh(bgGeo, bgMat)
      bg.position.z = -0.01

      const mesh = new three.Mesh(geo, material)
      mesh.userData.tex = alphaTex

      const col = j % cols
      const rowIdx = Math.floor(j / cols)
      const gap = n(params, 'slotGap') * H
      const px = (col - (cols - 1) / 2) * (W + gap)
      const py = -(rowIdx - (rows - 1) / 2) * (H + gap)
      const cell = new three.Group()
      cell.position.set(px, py, 0)
      cell.add(bg)
      cell.add(mesh)
      root.add(cell)

      slots.push({ mesh, alphaTex, cellCount: cells.length, slotIndex: j })
    }

    root.userData.slotState = { slots, messageCount: reel.messageCount, stride: reel.stride, slotCount: reel.slotCount } as SlotState
    return root
  },

  update(t01, params, root) {
    const st = root?.userData?.slotState as SlotState | undefined
    if (!st) return
    const timing: Timing = {
      messageCount: st.messageCount,
      stride: st.stride,
      slotCount: st.slotCount,
      hold: n(params, 'hold'),
      stagger: n(params, 'stagger'),
      overshoot: n(params, 'overshoot'),
    }
    const dir = str(params, 'direction') === 'down' ? -1 : 1
    for (const s of st.slots) {
      const { offset } = reelScroll(t01, s.slotIndex, timing)
      // offset in cells → V fraction of the strip; RepeatWrapping handles the seam.
      s.alphaTex.offset.y = (dir * offset / s.cellCount) % 1
    }
  },
}

type ReelSource = 'messages' | 'glyphs' | 'shapes' | 'custom'
```

- [ ] **Step 2: Register the effect**

Modify `app/lib/spacetype/effects/index.ts`: add `import { slotEffect } from './slot'` with the other imports, and add `slotEffect,` as the last entry of `SPACE_TYPE_EFFECTS` (after `loftEffect,`).

- [ ] **Step 3: Run guards + typecheck**

Run: `npx vitest run tests/unit/spacetype-sections.unit.spec.ts tests/unit/spacetype-palette.unit.spec.ts`
Expected: sections spec fully PASS (incl. new `slot`); palette spec shows the SAME 4 pre-existing reds (ring/cornerpin/shutter/loft) and a PASS for `slot`.

Run: `npx vue-tsc --noEmit 2>&1 | grep -i "spacetype/effects/slot\|slotGeometry" || echo "no slot type errors"`
Expected: `no slot type errors`.

- [ ] **Step 4: Live verify (browser)**

Start the dev server (preview_start `{name}` from `.claude/launch.json`; if absent, add one running `npm run dev` on the dev port). Open the app, add a Space Type node, open Expressive Studio, pick **Slot** from the effect gallery. Confirm: slots render in a row, reels scroll, messages resolve and rotate, filler streams between. Use `read_console_messages` for errors, `computer {screenshot}` for proof.

- [ ] **Step 5: Commit**

```bash
git add app/lib/spacetype/effects/slot.ts app/lib/spacetype/effects/index.ts
git commit -m "feat(slot): flat working slot effect — reels, rotation, filler, fills"
```

---

## Task 4: Custom shader — motion blur, drum curve, edge falloff, spin-dim

**Files:**
- Modify: `app/lib/spacetype/effects/slot.ts`

**Interfaces:**
- Consumes: `reelScroll().speed`, `curveAmount`, `edgeFalloff`, `spinDim`, `reelShape`, `blur`.
- Produces: per-slot `mesh.userData.uniforms = { uBlur, uCurve, uEdge, uDim, uCellFrac }` driven live in `update`.

Adds an `onBeforeCompile` to the reel material that: (a) averages several `alphaMap` samples along V by `uBlur` (velocity smear); (b) in the vertex shader displaces Z by `uCurve * -cos(vUv.y*π)` and dims by distance from center (drum); (c) fades alpha near the top/bottom aperture edges by `uEdge`; (d) multiplies output by `1 - uDim` (spin desaturate/dim). `uCellFrac` = `1/cellCount` so the blur samples span cell-space, not the whole strip.

- [ ] **Step 1: Add the shader to the reel material** (inside `buildScene`, replace the plain `MeshBasicMaterial` for the reel with a version carrying `onBeforeCompile`)

```ts
const uniforms = {
  uBlur: { value: 0 }, uCurve: { value: 0 }, uEdge: { value: n(params, 'edgeFalloff') },
  uDim: { value: 0 }, uCellFrac: { value: 1 / cells.length },
}
material.onBeforeCompile = (shader) => {
  shader.uniforms.uBlur = uniforms.uBlur
  shader.uniforms.uCurve = uniforms.uCurve
  shader.uniforms.uEdge = uniforms.uEdge
  shader.uniforms.uDim = uniforms.uDim
  shader.uniforms.uCellFrac = uniforms.uCellFrac
  shader.vertexShader = ('uniform float uCurve;\nvarying vec2 vSlotUv;\n' + shader.vertexShader)
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvSlotUv = uv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed.z += -uCurve * cos((uv.y - 0.5) * 3.14159) * 0.5 + uCurve * 0.5;')
  shader.fragmentShader = ('uniform float uBlur;\nuniform float uEdge;\nuniform float uDim;\nuniform float uCellFrac;\nuniform float uCurve;\nvarying vec2 vSlotUv;\n' + shader.fragmentShader)
    // Multi-tap vertical blur of the alphaMap coverage, span scaled to one cell.
    .replace('#include <alphamap_fragment>', `
      {
        float span = uBlur * uCellFrac * 0.9;
        float a = 0.0;
        a += texture2D( alphaMap, vAlphaMapUv + vec2(0.0, -span) ).g;
        a += texture2D( alphaMap, vAlphaMapUv + vec2(0.0, -span*0.5) ).g;
        a += texture2D( alphaMap, vAlphaMapUv ).g;
        a += texture2D( alphaMap, vAlphaMapUv + vec2(0.0, span*0.5) ).g;
        a += texture2D( alphaMap, vAlphaMapUv + vec2(0.0, span) ).g;
        diffuseColor.a *= a / 5.0;
      }`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      {
        // Drum neighbour dim: fade brightness away from the slot's vertical center.
        float drum = 1.0 - uCurve * abs(vSlotUv.y - 0.5) * 1.4;
        // Aperture edge falloff: soft top/bottom.
        float edge = smoothstep(0.0, uEdge * 0.5 + 0.001, vSlotUv.y) * smoothstep(0.0, uEdge * 0.5 + 0.001, 1.0 - vSlotUv.y);
        float m = clamp(drum, 0.0, 1.0) * mix(1.0, edge, step(0.001, uEdge)) * (1.0 - uDim);
        gl_FragColor.rgb *= m;
        gl_FragColor.a *= (uEdge > 0.001 ? edge : 1.0);
      }`)
}
;(mesh.userData as Record<string, unknown>).uniforms = uniforms
```

Note: `alphaMap` sampled `.g` matches three's alphamap_fragment (it reads the green channel). `vAlphaMapUv` exists because `alphaMap` is set (USE_ALPHAMAP).

- [ ] **Step 2: Drive uniforms live in `update`** (extend the per-slot loop)

```ts
const reelShape = str(params, 'reelShape')
const curve = reelShape === 'drum' ? n(params, 'curveAmount') : 0
const edge = n(params, 'edgeFalloff')
const blurMax = n(params, 'blur')
const dimMax = n(params, 'spinDim')
for (const s of st.slots) {
  const { offset, speed } = reelScroll(t01, s.slotIndex, timing)
  s.alphaTex.offset.y = (dir * offset / s.cellCount) % 1
  const u = (s.mesh.userData as { uniforms?: Record<string, { value: number }> }).uniforms
  if (u) {
    u.uBlur.value = speed * blurMax
    u.uCurve.value = curve
    u.uEdge.value = edge
    u.uDim.value = speed * dimMax
  }
}
```

- [ ] **Step 3: Typecheck + live verify**

Run: `npx vue-tsc --noEmit 2>&1 | grep -i "effects/slot" || echo "no slot type errors"` → `no slot type errors`.
Live: reload the browser preview; confirm reels blur while spinning, sharpen on landing; drum curve bends the reel; edge falloff softens the aperture top/bottom; spin-dim darkens moving reels. Screenshot mid-spin and at-rest.

- [ ] **Step 4: Commit**

```bash
git add app/lib/spacetype/effects/slot.ts
git commit -m "feat(slot): motion blur, drum curve, edge falloff, spin-dim shader"
```

---

## Task 5: Frame stroke (aperture border)

**Files:**
- Modify: `app/lib/spacetype/effects/slot.ts`

**Interfaces:**
- Consumes: `frameWidth`, `frameColor`.
- Produces: a border rendered on the slot background material via an SDF in `onBeforeCompile` (no extra meshes). `frameWidth` is structural (rebuild) — it is NOT in `liveKeys`.

- [ ] **Step 1: Add an SDF border to the background material** (in `buildScene`, when `frameWidth > 0`)

```ts
const frameW = n(params, 'frameWidth')
if (frameW > 0) {
  const frameCol = new three.Color(str(params, 'frameColor'))
  bgMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFrameW = { value: frameW }
    shader.uniforms.uFrameCol = { value: frameCol }
    shader.vertexShader = 'varying vec2 vBgUv;\n' + shader.vertexShader
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvBgUv = uv;')
    shader.fragmentShader = ('uniform float uFrameW;\nuniform vec3 uFrameCol;\nvarying vec2 vBgUv;\n' + shader.fragmentShader)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          float b = min(min(vBgUv.x, 1.0 - vBgUv.x), min(vBgUv.y, 1.0 - vBgUv.y));
          if (b < uFrameW * 0.5) gl_FragColor.rgb = uFrameCol;
        }`)
  }
}
```

- [ ] **Step 2: Typecheck + live verify**

Run: `npx vue-tsc --noEmit 2>&1 | grep -i "effects/slot" || echo "no slot type errors"` → `no slot type errors`.
Live: set Frame > 0, pick a frame color; confirm a border rings each slot. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add app/lib/spacetype/effects/slot.ts
git commit -m "feat(slot): optional aperture frame stroke"
```

---

## Task 6: Full verification + dashboard

**Files:**
- Modify: `docs/superpowers/build-dashboard.md` (or the live dashboard doc) + the `⛵` dashboard artifact per the standing rule.

- [ ] **Step 1: Full unit suite for touched areas**

Run: `npx vitest run tests/unit/slot-geometry.unit.spec.ts tests/unit/spacetype-sections.unit.spec.ts tests/unit/spacetype-palette.unit.spec.ts`
Expected: slot-geometry all PASS; sections all PASS; palette = same 4 pre-existing reds only (slot PASSES). Record counts.

- [ ] **Step 2: Typecheck (baseline-anchored)**

Run: `npx vue-tsc --noEmit 2>&1 | grep -iE "slot" || echo "no slot type errors"`
Expected: `no slot type errors` (pre-existing unrelated errors in the working tree are not slot's).

- [ ] **Step 3: Live end-to-end verify**

In the browser preview, exercise: word vs char reelUnit; each fillerSource (messages/glyphs/shapes/custom); flat vs drum; multi-message rotation resolves left-to-right and loops seamlessly (watch the loop wrap — no jump). Capture 2-3 screenshots (mid-spin, landed, drum). Confirm no console errors.

- [ ] **Step 4: Update the build dashboard** (standing rule: update BOTH the doc and the ⛵ artifact; read the LIVE one first)

- [ ] **Step 5: Final commit**

```bash
git add docs/superpowers/build-dashboard.md
git commit -m "docs(slot): dashboard — slot effect landed"
```

---

## Self-Review

**Spec coverage:** reelUnit (word/char) ✓ Task 1/3; staggered settle ✓ Task 2; reelShape flat/drum ✓ Task 4; aperture + edge falloff ✓ Task 3/4; frame ✓ Task 5; rotating messages ✓ Task 1-3; filler messages/glyphs/shapes/custom ✓ Task 1/3; motion blur/spin-dim/hold/overshoot/direction ✓ Task 2-4; fills (wordFill/slotFill) ✓ Task 3; palette+sections guards ✓ Task 3/6; seamless loop ✓ Task 2. All spec sections have a task.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `Cell`, `ReelParams`, `Reel`, `Timing` defined in Task 1-2 and consumed with matching shapes in Task 3; `SlotState`/`SlotMesh` defined and read in `update`; `uniforms` bag shape consistent between Task 4 steps 1 and 2.

**Known risk:** the reel-canvas V orientation (CanvasTexture `flipY`) and which visual edge is "top" is verified live in Task 3-4, not by unit test — the pure math is orientation-agnostic (offset in cell units); only the sign/`flipY` is a display concern tuned in the browser.
```