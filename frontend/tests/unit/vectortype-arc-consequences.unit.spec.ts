/**
 * Vector Type — what a ROTATED glyph does to everything downstream of it.
 *
 * Arc placement turns each letter to the tangent. Four things had assumed a
 * horizontal baseline, and each one is a different KIND of failure:
 *
 *  - **the `glyph` fill anchor** was the only live break of this studio's
 *    0.0000 % canvas-vs-SVG guarantee. The canvas resolved the paint against the
 *    glyph's UNROTATED box while the export wrote `objectBoundingBox` and let the
 *    browser measure the ROTATED path — two derivations of one box, which agreed
 *    only for as long as the box was axis-aligned.
 *  - **the mask window** was an axis-aligned rect over a cell that is no longer
 *    horizontal, so a `top` reveal wiped a 90° letter across its SIDE.
 *  - **the taper pivot** (`origin.x + advance/2`) was a point on the OUTPUT's x,
 *    which on a turned letter is a point off the letter.
 *  - **the `word` paint box** kept the STRAIGHT run's size and position at every
 *    sweep.
 *
 * What is asserted here is the ARITHMETIC and the MARKUP. The pixel evidence —
 * 0.0000 % core at every anchor and every sweep, against broken controls at
 * 31–80 %, and the reveal made constant across sweeps — is in the task report,
 * because a unit test cannot rasterise an SVG.
 *
 * **Zero is free** is asserted throughout, with `Object.is` rather than
 * `toBeCloseTo`: a straight run must land on the same doubles and emit the same
 * bytes it did before curves existed.
 *
 * NO NETWORK: the same eight-character Inter variable subset the rest of the
 * Vector Type specs use.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { describe, expect, it } from 'vitest'
import { normaliseAxes, type VtFont } from '~/lib/vectortype/font'
import { DEFAULT_CONFIG, mergeConfig, vtLayer, type VectorTypeConfig } from '~/lib/vectortype/config'
import {
  vectorTypeFrame,
  vectorTypeSVG,
  vtGlyphPaintBox,
  vtPlacement,
  vtRunPaintBox,
} from '~/lib/vectortype/canvas'
import { glyphCellClipRect, glyphTransform, placedInkBounds } from '~/lib/vectortype/render'
import { extrudeCopyTransform, vtCellPivot } from '~/lib/vectortype/extrude'
import { solidBodyCacheKey } from '~/lib/vectortype/extrudeBodyCache'
import { shapesToSVG, type VectorWindow } from '~/lib/vector/svg'

const FIXTURE = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))

function loadFixtureFont(): VtFont {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const raw: any = (fontkit as any).create(bytes)
  return { id: 'inter-subset', axes: normaliseAxes(raw?.variationAxes), unitsPerEm: Number(raw?.unitsPerEm) || 1000, raw }
}
const font = loadFixtureFont()

const WORD = 'Sailor'
const BOX = { width: 640, height: 400 }
const DEG = Math.PI / 180

const cfg = (patch: Partial<VectorTypeConfig> = {}): VectorTypeConfig =>
  mergeConfig({ ...DEFAULT_CONFIG, text: WORD, size: 100, ...patch })

function scene(c: VectorTypeConfig, box = BOX) {
  const frame = vectorTypeFrame(font, c, 0)
  const place = vtPlacement(frame, box)
  return { frame, place, glyphs: frame.outlines.glyphs, em: place.scale * (frame.outlines.unitsPerEm || 1000) }
}

/** A point through a placement's own turn about its origin. The independent
 *  arithmetic every geometric assertion below is measured against — written out
 *  here rather than imported, so a bug in the module cannot define its own
 *  expectation. */
function through(o: { x: number; y: number; rotate: number }, lx: number, ly: number): [number, number] {
  const r = o.rotate * DEG
  const c = Math.cos(r), s = Math.sin(r)
  return [o.x + lx * c - ly * s, o.y + lx * s + ly * c]
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE MASK WINDOW — it turns with the glyph, and that is still "fixed"
// ═══════════════════════════════════════════════════════════════════════════

describe('the mask window turns with the glyph', () => {
  it('is EXACTLY inert at rotate 0 — the same numbers and no extra fields', () => {
    const o = { x: 120, y: 300 }
    const bare = glyphCellClipRect(o, 60, 100, { side: 'top', amount: 0.4 })
    const zero = glyphCellClipRect({ ...o, rotate: 0 }, 60, 100, { side: 'top', amount: 0.4 })
    expect(zero).toEqual(bare)
    // Not merely equal-valued: a straight run must not GROW a rotation field, or
    // every `<clipPath>` in every existing export would key differently.
    expect(Object.keys(bare).sort()).toEqual(['height', 'width', 'x', 'y'])
    expect('rotate' in bare).toBe(false)
    // And the rect itself is the cell arithmetic, unchanged.
    expect(bare.x).toBe(120 - 100)
    expect(bare.y).toBe(300 + 100 * 0.2 - 100 + 100 * 0.4)
    expect(bare.width).toBe(60 + 200)
  })

  it('carries the placement’s OWN angle, about the glyph’s OWN origin', () => {
    const o = { x: 120, y: 300, rotate: -73.5 }
    const w = glyphCellClipRect(o, 60, 100, { side: 'top', amount: 0.4 })
    expect(w.rotate).toBe(-73.5)
    // The origin, not the rect's centre: the perpendicular padding moves the
    // centre a whole em off the letter, so turning about it would swing the
    // window away from the cell it is supposed to mask.
    expect(w.pivotX).toBe(120)
    expect(w.pivotY).toBe(300)
    // The rect's own numbers are untouched — the turn is the only addition, which
    // is what keeps the two renderers on one derivation.
    const flat = glyphCellClipRect({ x: 120, y: 300 }, 60, 100, { side: 'top', amount: 0.4 })
    expect({ x: w.x, y: w.y, width: w.width, height: w.height }).toEqual(flat)
  })

  it('puts the window on the glyph’s OWN cell — the tangent is its horizontal', () => {
    // A fully-open `top` window on a glyph laid on its side. Turned through the
    // placement, its corners must be the cell's corners in the GLYPH's frame.
    const o = { x: 200, y: 200, rotate: 90 }
    const w = glyphCellClipRect(o, 80, 100, { side: 'top', amount: 0 })
    const r = (w.rotate as number) * DEG
    const c = Math.cos(r), s = Math.sin(r)
    // The window's top-left, taken through its own rotation about the pivot.
    const lx = w.x - (w.pivotX as number), ly = w.y - (w.pivotY as number)
    const cx = (w.pivotX as number) + lx * c - ly * s
    const cy = (w.pivotY as number) + lx * s + ly * c
    // At +90° the glyph's local +x points DOWN the screen and its local +y points
    // LEFT, so the cell's local top-left (−em, −em + 0.2em) lands here:
    const [ex, ey] = through(o, -100, 0.2 * 100 - 100)
    expect(cx).toBeCloseTo(ex, 9)
    expect(cy).toBeCloseTo(ey, 9)
  })

  it('BROKEN CONTROL: the axis-aligned window covers a different region entirely', () => {
    // The pre-fix window: the identical rect, read axis-aligned. Take the point
    // that IS the letter's own top-centre at +90° and ask each window about it.
    const o = { x: 200, y: 200, rotate: 90 }
    const adv = 80, em = 100, amount = 0.5
    const w = glyphCellClipRect(o, adv, em, { side: 'top', amount })
    // The cell's top is `em·CELL_DESCENT − em` below the baseline in the GLYPH's
    // own frame, so a `top` reveal's revealing edge is `amount·em` down from
    // there. A point just inside that edge, at the cell's centre:
    const [px, py] = through(o, adv / 2, em * 0.2 - em + amount * em + 4)
    const inTurned = (() => {
      const r = -(w.rotate as number) * DEG // back into the window's own frame
      const dx = px - (w.pivotX as number), dy = py - (w.pivotY as number)
      const lx = (w.pivotX as number) + dx * Math.cos(r) - dy * Math.sin(r)
      const ly = (w.pivotY as number) + dx * Math.sin(r) + dy * Math.cos(r)
      return lx >= w.x && lx <= w.x + w.width && ly >= w.y && ly <= w.y + w.height
    })()
    const inFlat = px >= w.x && px <= w.x + w.width && py >= w.y && py <= w.y + w.height
    expect(inTurned).toBe(true)
    expect(inFlat).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE SPINE — a generic turned window, and it keys apart
// ═══════════════════════════════════════════════════════════════════════════

describe('the spine writes a turned window', () => {
  const commands = [
    { command: 'moveTo' as const, args: [0, 0] },
    { command: 'lineTo' as const, args: [10, 0] },
    { command: 'lineTo' as const, args: [10, 10] },
    { command: 'closePath' as const, args: [] },
  ]
  const rect: VectorWindow = { x: 1, y: 2, width: 30, height: 40 }

  it('emits NOTHING extra for an unturned window — byte-identical markup', () => {
    const a = shapesToSVG([{ commands, clip: rect }])
    const b = shapesToSVG([{ commands, clip: { ...rect, rotate: 0 } }])
    expect(a).toBe(b)
    expect(a).toContain('<rect x="1" y="2" width="30" height="40"/>')
    expect(a).not.toContain('transform="rotate')
  })

  it('emits the turn as a transform ON THE RECT, about the given pivot', () => {
    const svg = shapesToSVG([{ commands, clip: { ...rect, rotate: 37.5, pivotX: 5, pivotY: 6 } }])
    expect(svg).toContain('<rect x="1" y="2" width="30" height="40" transform="rotate(37.5 5 6)"/>')
    // Still `userSpaceOnUse` on a wrapper `<g>` with no transform of its own —
    // the shape's own transform must still slide it THROUGH the window.
    expect(svg).toContain('clipPathUnits="userSpaceOnUse"')
  })

  it('falls back to the rect’s own centre when no pivot is given', () => {
    const svg = shapesToSVG([{ commands, clip: { ...rect, rotate: 90 } }])
    expect(svg).toContain('transform="rotate(90 16 22)"')
  })

  it('KEYS them apart — the same rect turned two ways is two windows', () => {
    const svg = shapesToSVG([
      { commands, clip: { ...rect, rotate: 10, pivotX: 0, pivotY: 0 } },
      { commands, clip: { ...rect, rotate: 40, pivotX: 0, pivotY: 0 } },
      { commands, clip: { ...rect, rotate: 10, pivotX: 0, pivotY: 0 } },
    ])
    // Three shapes, two distinct windows — and the third shares the first's.
    expect(svg.match(/<clipPath/g)).toHaveLength(2)
    const ids = [...svg.matchAll(/clip-path="url\(#([^)]+)\)"/g)].map(m => m[1])
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe(ids[2])
    expect(ids[0]).not.toBe(ids[1])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE PIVOT — one derivation, four surfaces
// ═══════════════════════════════════════════════════════════════════════════

describe('vtCellPivot — the ONE pivot a glyph scales about', () => {
  it('is EXACTLY inert at 0 — the same double the old expression produced', () => {
    for (const adv of [0, 1, 55.25, 1234.5678]) {
      expect(Object.is(vtCellPivot(adv, 0).x, adv / 2)).toBe(true)
      expect(Object.is(vtCellPivot(adv, undefined).x, adv / 2)).toBe(true)
      expect(vtCellPivot(adv, 0).y).toBe(0)
    }
  })

  it('walks half an advance along the GLYPH’s baseline, not the output’s', () => {
    const p = vtCellPivot(80, 90)
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(40, 9)
    const q = vtCellPivot(80, 180)
    expect(q.x).toBeCloseTo(-40, 9)
    expect(q.y).toBeCloseTo(0, 9)
    // Its LENGTH is always half the advance — a rotation cannot change that, and
    // if it ever did the taper would shrink at a different rate per letter.
    for (const deg of [-137, -91.1, 0, 21.1, 103, 359]) {
      const v = vtCellPivot(80, deg)
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(40, 9)
    }
  })

  it('survives junk — a NaN angle or advance falls back rather than propagating', () => {
    expect(vtCellPivot(NaN, 30)).toEqual({ x: 0, y: 0 })
    expect(vtCellPivot(80, NaN)).toEqual({ x: 40, y: 0 })
    expect(vtCellPivot(80, Infinity)).toEqual({ x: 40, y: 0 })
  })
})

describe('extrudeCopyTransform on a turned glyph', () => {
  const copy = { dx: 12, dy: -7, scale: 0.4 }

  it('is bit-identical on a straight run — every existing extrude is untouched', () => {
    const origin = { x: 100, y: 250 }
    const a = extrudeCopyTransform(copy, origin, 55)
    const b = extrudeCopyTransform(copy, { ...origin, rotate: 0 }, 55)
    expect(a).toEqual(b)
    expect(Object.is(a.x, 12 + (100 + 55 / 2) * (1 - 0.4))).toBe(true)
    expect(Object.is(a.y, -7 + 250 * (1 - 0.4))).toBe(true)
  })

  it('pivots on the cell centre IN THE GLYPH’S FRAME, and the copy still lands there', () => {
    const origin = { x: 100, y: 250, rotate: -91.1 }
    const advance = 55
    const t = extrudeCopyTransform(copy, origin, advance)
    const [px, py] = through(origin, advance / 2, 0)
    // The fold `p' = p·s + (d + pivot·(1−s))` means the PIVOT is the one point a
    // copy leaves exactly where it was, plus the step. Assert that directly.
    const fixedX = px * t.scale + t.x
    const fixedY = py * t.scale + t.y
    expect(fixedX).toBeCloseTo(px + copy.dx, 9)
    expect(fixedY).toBeCloseTo(py + copy.dy, 9)
  })

  it('BROKEN CONTROL: the pre-fix pivot is a point off the letter', () => {
    const origin = { x: 100, y: 250, rotate: -91.1 }
    const advance = 55
    const [px, py] = through(origin, advance / 2, 0)
    const preFix = { x: origin.x + advance / 2, y: origin.y }
    // At −91° the letter's own cell centre is nearly straight UP from the origin;
    // the old pivot is straight RIGHT. They are most of an advance apart.
    const drift = Math.hypot(preFix.x - px, preFix.y - py)
    expect(drift).toBeGreaterThan(advance * 0.7)
    // And the copy it produces is displaced by `drift · (1 − s)` — visible at any
    // real taper.
    const good = extrudeCopyTransform(copy, origin, advance)
    const bad = extrudeCopyTransform(copy, { x: origin.x, y: origin.y }, advance)
    expect(Math.hypot(good.x - bad.x, good.y - bad.y)).toBeCloseTo(drift * (1 - copy.scale), 9)
  })

  it('keeps ONE absolute light direction — the step never turns with the letter', () => {
    // The decision, asserted rather than described: `dx`/`dy` reach the transform
    // unrotated whatever angle the glyph sits at, so every block shadow falls the
    // same way. A per-glyph frame would fan them over the whole sweep.
    const untapered = { dx: -39.6, dy: 39.6, scale: 1 }
    for (const rotate of [-125.3, -50.7, 0, 29.1, 81.2, 141.7]) {
      const t = extrudeCopyTransform(untapered, { x: 100, y: 250, rotate }, 55)
      expect(t.x).toBe(-39.6)
      expect(t.y).toBe(39.6)
      expect(t.rotate).toBe(0)
    }
  })
})

describe('the solid body cache key carries the turn', () => {
  it('appends nothing on a straight run, and separates two angles', () => {
    const cmds = [{ command: 'moveTo' as const, args: [0, 0] }]
    const copies = [{ dx: 1, dy: 2, scale: 1 }]
    const flat = solidBodyCacheKey(cmds, copies, { x: 5, y: 6 }, 7)
    expect(solidBodyCacheKey(cmds, copies, { x: 5, y: 6, rotate: 0 }, 7)).toBe(flat)
    const turned = solidBodyCacheKey(cmds, copies, { x: 5, y: 6, rotate: 30 }, 7)
    expect(turned).not.toBe(flat)
    expect(solidBodyCacheKey(cmds, copies, { x: 5, y: 6, rotate: 31 }, 7)).not.toBe(turned)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. THE PAINT BOXES
// ═══════════════════════════════════════════════════════════════════════════

describe('vtGlyphPaintBox is the PLACED ink box', () => {
  it('is bit-identical on a straight run', () => {
    const { glyphs, place, em } = scene(cfg({ arc: 0 }))
    for (const g of glyphs) {
      const o = glyphTransform(g, place)
      expect(o.rotate).toBe(0)
      const s = place.scale, fy = place.flipY ? -s : s
      const b = g.bbox
      const x0 = o.x + b.minX * s, x1 = o.x + b.maxX * s
      const y0 = o.y + b.minY * fy, y1 = o.y + b.maxY * fy
      const box = vtGlyphPaintBox(g, place, em)
      expect(Object.is(box.cx, (Math.min(x0, x1) + Math.max(x0, x1)) / 2)).toBe(true)
      expect(Object.is(box.cy, (Math.min(y0, y1) + Math.max(y0, y1)) / 2)).toBe(true)
    }
  })

  it('CONTAINS every corner of the turned letter, at every sweep', () => {
    for (const arc of [60, 150, 240, 330, -200]) {
      const { glyphs, place, em } = scene(cfg({ arc }))
      for (const g of glyphs) {
        if (!g.commands.length) continue
        const o = glyphTransform(g, place)
        const box = vtGlyphPaintBox(g, place, em)
        const s = place.scale, fy = place.flipY ? -s : s
        const b = g.bbox
        for (const [lx, ly] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]] as const) {
          const [x, y] = through(o, lx * s, ly * fy)
          expect(x).toBeGreaterThanOrEqual(box.cx - box.w / 2 - 1e-9)
          expect(x).toBeLessThanOrEqual(box.cx + box.w / 2 + 1e-9)
          expect(y).toBeGreaterThanOrEqual(box.cy - box.h / 2 - 1e-9)
          expect(y).toBeLessThanOrEqual(box.cy + box.h / 2 + 1e-9)
        }
      }
    }
  })

  it('BROKEN CONTROL: the unrotated box leaves the letter’s corners outside it', () => {
    const arc = 330
    const { glyphs, place, em } = scene(cfg({ arc }))
    let escaped = 0, corners = 0
    let worst = 0
    for (const g of glyphs) {
      if (!g.commands.length) continue
      const o = glyphTransform(g, place)
      const s = place.scale, fy = place.flipY ? -s : s
      const b = g.bbox
      // The pre-fix box: translate and scale, no turn.
      const px0 = Math.min(o.x + b.minX * s, o.x + b.maxX * s)
      const px1 = Math.max(o.x + b.minX * s, o.x + b.maxX * s)
      const py0 = Math.min(o.y + b.minY * fy, o.y + b.maxY * fy)
      const py1 = Math.max(o.y + b.minY * fy, o.y + b.maxY * fy)
      for (const [lx, ly] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]] as const) {
        const [x, y] = through(o, lx * s, ly * fy)
        corners++
        if (x < px0 || x > px1 || y < py0 || y > py1) escaped++
        worst = Math.max(worst, x - px1, px0 - x, y - py1, py0 - y)
      }
      // ...and the SHIPPED box holds every one of them (asserted above).
      void vtGlyphPaintBox(g, place, em)
    }
    expect(corners).toBeGreaterThan(0)
    // Most of the letter's own corners sit outside the box its paint was
    // resolved against — which is what a 76.7 % colour divergence looks like as
    // arithmetic.
    expect(escaped / corners).toBeGreaterThan(0.5)
    // eslint-disable-next-line no-console
    console.log(`PRE-FIX glyph box @arc${arc}: ${escaped}/${corners} of the letters’ own corners fall OUTSIDE it, worst ${worst.toFixed(1)} px`)
  })
})

describe('vtRunPaintBox on a curve', () => {
  it('is bit-identical on a straight run — this box is also the shear’s pivot', () => {
    const { frame, place } = scene(cfg({ arc: 0 }))
    const b = frame.outlines.bbox
    const s = place.scale, fy = place.flipY ? -s : s
    const x0 = place.x + b.minX * s, x1 = place.x + b.maxX * s
    const y0 = place.y + b.minY * fy, y1 = place.y + b.maxY * fy
    const box = vtRunPaintBox(frame.outlines, place, BOX)
    expect(Object.is(box.cx, (Math.min(x0, x1) + Math.max(x0, x1)) / 2)).toBe(true)
    expect(Object.is(box.cy, (Math.min(y0, y1) + Math.max(y0, y1)) / 2)).toBe(true)
    expect(Object.is(box.w, Math.abs(x1 - x0))).toBe(true)
  })

  it('lands EXACTLY on the placed ink at every sweep, where the old box did not', () => {
    for (const arc of [60, 150, 240, 330]) {
      const { frame, place } = scene(cfg({ arc }))
      const ink = placedInkBounds(frame.outlines, place)
      const box = vtRunPaintBox(frame.outlines, place, BOX)
      expect(box.cx).toBeCloseTo((ink.minX + ink.maxX) / 2, 9)
      expect(box.cy).toBeCloseTo((ink.minY + ink.maxY) / 2, 9)
      expect(box.w).toBeCloseTo(ink.maxX - ink.minX, 9)
      expect(box.h).toBeCloseTo(ink.maxY - ink.minY, 9)

      // BROKEN CONTROL — the pre-fix box: the STRAIGHT run's bounds, scaled and
      // translated. It keeps one size at every sweep and drifts off the ink.
      const b = frame.outlines.bbox
      const s = place.scale, fy = place.flipY ? -s : s
      const oldCx = (place.x + b.minX * s + place.x + b.maxX * s) / 2
      const oldCy = (place.y + b.minY * fy + place.y + b.maxY * fy) / 2
      const drift = Math.hypot(oldCx - box.cx, oldCy - box.cy)
      expect(drift).toBeGreaterThan(10)
      // eslint-disable-next-line no-console
      console.log(`arc ${arc}: run paint box ${box.w.toFixed(1)}×${box.h.toFixed(1)} on the ink; PRE-FIX ${(Math.abs((b.maxX - b.minX) * s)).toFixed(1)}×${(Math.abs((b.maxY - b.minY) * fy)).toFixed(1)} at ${drift.toFixed(1)} px off centre`)
    }
  })

  it('spans the arc’s BOUNDING BOX and says so — not the arc itself', () => {
    // The decision, pinned: `word` is one ramp over a rectangle. The box is
    // axis-aligned at every sweep, which is what makes it a rectangle rather than
    // a ribbon along the curve.
    const { frame, place } = scene(cfg({ arc: 240 }))
    const box = vtRunPaintBox(frame.outlines, place, BOX)
    expect(Object.keys(box).sort()).toEqual(['cx', 'cy', 'h', 'w'])
    // Bent hard, the run is nearly as tall as it is wide — the bounding box of a
    // ring, not a band along it.
    expect(box.h / box.w).toBeGreaterThan(0.5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE EXPORT — a turned run stops delegating its box to the browser
// ═══════════════════════════════════════════════════════════════════════════

describe('the `glyph` anchor’s paint server, on a curve', () => {
  const gradientCfg = (arc: number) => cfg({
    arc,
    appearance: [vtLayer({
      kind: 'fill',
      anchor: 'glyph',
      paint: { type: 'gradient', a: '#ff2d55', b: '#0a84ff', angle: 90, density: 8 } as any,
    })],
  })

  it('keeps `objectBoundingBox` on a straight run', () => {
    const { svg } = vectorTypeSVG(font, gradientCfg(0), 0, BOX)
    expect(svg).toContain('gradientUnits="objectBoundingBox"')
    expect(svg).not.toContain('gradientUnits="userSpaceOnUse"')
  })

  it('writes `userSpaceOnUse` over the canvas’s OWN box once the letters turn', () => {
    const { svg, frame } = vectorTypeSVG(font, gradientCfg(240), 0, BOX)
    expect(svg).toContain('gradientUnits="userSpaceOnUse"')
    expect(svg).not.toContain('gradientUnits="objectBoundingBox"')
    // And the box it spans is `vtGlyphPaintBox`'s, letter for letter — the one
    // derivation, replayed, rather than the browser's own measurement of the
    // rotated path.
    const place = vtPlacement(frame, BOX)
    const em = place.scale * (frame.outlines.unitsPerEm || 1000)
    const axes = [...svg.matchAll(/<linearGradient[^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)]
    const inked = frame.outlines.glyphs.filter(g => g.commands.length)
    expect(axes).toHaveLength(inked.length)
    inked.forEach((g, i) => {
      const box = vtGlyphPaintBox(g, place, em)
      const [, x1, y1, , y2] = axes[i]!.map(Number) as unknown as number[]
      // A 90° ramp runs down the box's own centre line, top edge to bottom edge.
      expect(x1).toBeCloseTo(box.cx, 2)
      expect(y1).toBeCloseTo(box.cy - box.h / 2, 2)
      expect(y2).toBeCloseTo(box.cy + box.h / 2, 2)
    })
  })

  it('still RIDES the letter — no gradientTransform is written for this anchor', () => {
    // The `glyph` anchor has nothing to cancel: a user-space server with no
    // transform resolves in the painted element's own user space, so it travels
    // with that letter's motion exactly as a bounding-box one does.
    const { svg } = vectorTypeSVG(font, gradientCfg(240), 0, BOX)
    expect(svg).not.toContain('gradientTransform')
  })
})

describe('the export carries the turned window', () => {
  it('writes a rotated `<rect>` in the `<clipPath>` for a masked arc’d run', () => {
    const c = cfg({
      arc: 240,
      motion: {
        in: { presetId: 'mask-up', duration: 1 },
        duration: 4, fps: 30,
        stagger: { delay: 0, order: 'forward', seed: 0 },
      },
    } as Partial<VectorTypeConfig>)
    const { svg } = vectorTypeSVG(font, c, 0.3, BOX)
    const rects = [...svg.matchAll(/<clipPath[^>]*><rect[^>]*transform="rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)"/g)]
    expect(rects.length).toBeGreaterThan(0)
    // Every window's pivot is a glyph's own placed origin, and its angle that
    // glyph's own tangent — the same two numbers the canvas turns its context by.
    const frame = vectorTypeFrame(font, c, 0.3)
    const place = vtPlacement(frame, BOX)
    const origins = frame.outlines.glyphs.map(g => glyphTransform(g, place))
    for (const m of rects) {
      const [deg, px, py] = [Number(m[1]), Number(m[2]), Number(m[3])]
      expect(origins.some(o =>
        Math.abs(o.rotate - deg) < 0.01 && Math.abs(o.x - px) < 0.01 && Math.abs(o.y - py) < 0.01,
      )).toBe(true)
    }
    // And the straight run writes no transform at all.
    const flat = vectorTypeSVG(font, { ...c, arc: 0 }, 0.3, BOX).svg
    expect(flat).toContain('<clipPath')
    expect(flat).not.toContain('transform="rotate')
  })
})
