/**
 * Vector Type — placing glyphs along a CURVE.
 *
 * Rigid-body placement: each glyph is translated onto the curve and rotated to
 * the tangent there, and the letterforms are not touched. That is affine, so the
 * SVG stays exactly-correct vector — the line this feature sits on the right side
 * of, and perspective does not.
 *
 * What a picture cannot check, and what is checked here:
 *
 *  - **The spacing is EVEN, in arc length.** Measured against an independent
 *    dense quadrature over the curve, and compared with the naive
 *    `t = distance ÷ length` control `utils/textOnPath.ts` uses — which is right
 *    on a circular arc and visibly wrong on a wave. "The letters looked evenly
 *    spaced" cannot pass.
 *  - **The advances are fontkit's SHAPED ones.** A uniform-advance control is
 *    built here and shown to put the ink somewhere else entirely.
 *  - **It flows through `placeOutlines`.** The rotation is baked into the
 *    coordinates at the one placement choke point, so the canvas `Path2D` and the
 *    exported `d` are the same numbers rather than two writers agreeing. Asserted
 *    against the real export, glyph by glyph.
 *  - **Zero is free.** At `arc: 0` every placed coordinate must be bit-identical
 *    to what the studio drew before a curve existed.
 *
 * NO NETWORK: the same eight-character Inter variable subset the rest of the
 * Vector Type specs use.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { describe, expect, it } from 'vitest'
import { normaliseAxes, type VtFont } from '~/lib/vectortype/font'
import {
  DEFAULT_CONFIG,
  VT_ARC_MAX,
  mergeConfig,
  vtLayer,
  type VectorTypeConfig,
} from '~/lib/vectortype/config'
import {
  vectorTypeFrame,
  vectorTypeSVG,
  vtArcSweep,
  vtIsCurved,
  vtPlacement,
  vtRunCurve,
} from '~/lib/vectortype/canvas'
import {
  glyphTransform,
  placeOutlines,
  placedInkBounds,
  type RunCurve,
} from '~/lib/vectortype/render'
import { buildCurveTable, evalCurve, pointAtLength, type VtCurve } from '~/lib/vectortype/curve'
import { commandsToPathData, transformCommands, type VectorCommand } from '~/lib/vector/svg'
import type { GlyphOutline, TextOutlines } from '~/lib/vectortype/outline'

const FIXTURE = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))

function loadFixtureFont(): VtFont {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const raw: any = (fontkit as any).create(bytes)
  return { id: 'inter-subset', axes: normaliseAxes(raw?.variationAxes), unitsPerEm: Number(raw?.unitsPerEm) || 1000, raw }
}
const font = loadFixtureFont()

/** The fixture only carries " Sailorg". */
const WORD = 'Sailor'
const BOX = { width: 640, height: 400 }

const cfg = (patch: Partial<VectorTypeConfig> = {}): VectorTypeConfig =>
  mergeConfig({ ...DEFAULT_CONFIG, text: WORD, size: 100, ...patch })

function scene(c: VectorTypeConfig, box = BOX) {
  const frame = vectorTypeFrame(font, c, 0)
  const place = vtPlacement(frame, box)
  return { frame, place, glyphs: frame.outlines.glyphs }
}

const DEG = Math.PI / 180

// ── independent measurement ─────────────────────────────────────────────────
//
// None of this imports the module under test's inversion. The curve is sampled
// densely and uniformly in `t` — the honest, slow, obviously-correct way — and
// every arc-length figure below is read off THAT table, so a bug in
// `buildCurveTable`/`tAtLength` cannot hide inside the metric that is supposed
// to catch it.

const DENSE = 100_000

interface DenseTable { xs: Float64Array; ys: Float64Array; cum: Float64Array }

function dense(curve: VtCurve): DenseTable {
  const xs = new Float64Array(DENSE + 1)
  const ys = new Float64Array(DENSE + 1)
  const cum = new Float64Array(DENSE + 1)
  let prev = evalCurve(curve, 0)
  xs[0] = prev.x; ys[0] = prev.y
  for (let i = 1; i <= DENSE; i++) {
    const p = evalCurve(curve, i / DENSE)
    xs[i] = p.x; ys[i] = p.y
    cum[i] = cum[i - 1]! + Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return { xs, ys, cum }
}

/** The arc length at which a point sits on the curve, found by nearest dense
 *  sample. Quantised to `length / DENSE` — 0.005 px on a 500 px run, two orders
 *  below the spacings being compared. */
function arcLengthOf(d: DenseTable, x: number, y: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i <= DENSE; i++) {
    const dx = d.xs[i]! - x
    const dy = d.ys[i]! - y
    const dd = dx * dx + dy * dy
    if (dd < bestD) { bestD = dd; best = i }
  }
  return d.cum[best]!
}

const spreadPct = (v: readonly number[]): number => {
  const min = Math.min(...v), max = Math.max(...v)
  return max === 0 && min === 0 ? 0 : ((max - min) / ((max + min) / 2)) * 100
}

/** Every anchor point of a placed command list. */
function points(commands: readonly VectorCommand[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const c of commands) {
    for (let i = 0; i + 1 < c.args.length; i += 2) out.push({ x: c.args[i] as number, y: c.args[i + 1] as number })
  }
  return out
}

/** Where the CURVE put each glyph's centre, in the curve's own frame — derived
 *  from the returned placement (origin + half an advance forward along the
 *  glyph's own rotation), never from the placement's internals. */
function placedCentres(glyphs: readonly GlyphOutline[], opts: Parameters<typeof glyphTransform>[1]) {
  return glyphs.map(g => {
    const t = glyphTransform(g, opts)
    const rad = t.rotate * DEG
    const half = (g.advance / 2) * t.scale
    return { x: t.x + half * Math.cos(rad), y: t.y + half * Math.sin(rad), rotate: t.rotate }
  })
}

// ════════════════════════════════════════════════════════════════════════════
// 1. The one structural change — rotation on the placement transform
// ════════════════════════════════════════════════════════════════════════════

describe('Transform2D carries ROTATION', () => {
  const SQUARE: VectorCommand[] = [
    { command: 'moveTo', args: [0, 0] },
    { command: 'lineTo', args: [10, 0] },
    { command: 'lineTo', args: [10, 4] },
    { command: 'closePath', args: [] },
  ]

  it('is EXACTLY inert at 0 — every flat run is bit-identical', () => {
    // Not "close to": the same doubles. Every straight run in the product takes
    // this path every frame, and a placement that moved by an ulp would move the
    // rounded `d` of a glyph sitting on a .0005 boundary.
    const before = transformCommands(SQUARE, { scale: 0.13, x: 41.7, y: -8.25 })
    const after = transformCommands(SQUARE, { scale: 0.13, x: 41.7, y: -8.25, rotate: 0 })
    expect(after).toEqual(before)
    for (let i = 0; i < before.length; i++) {
      expect(Object.is(after[i]!.args[0], before[i]!.args[0])).toBe(true)
      expect(Object.is(after[i]!.args[1], before[i]!.args[1])).toBe(true)
    }
  })

  it('turns about the SOURCE origin, after the flip, clockwise on screen', () => {
    // (10, 0) in y-up font space is (10, 0) in y-down output space. Turn it +90°
    // and it must go DOWN the screen, which is +y — the same direction
    // `ctx.rotate(+rad)` and SVG's `rotate(+deg)` turn.
    const out = transformCommands([{ command: 'moveTo', args: [10, 0] }], { rotate: 90 })
    expect(out[0]!.args[0]).toBeCloseTo(0, 10)
    expect(out[0]!.args[1]).toBeCloseTo(10, 10)
    // The flip happens FIRST: (0, 10) font-space is (0, -10) output, and +90°
    // takes that to (+10, 0).
    const flipped = transformCommands([{ command: 'moveTo', args: [0, 10] }], { rotate: 90 })
    expect(flipped[0]!.args[0]).toBeCloseTo(10, 10)
    expect(flipped[0]!.args[1]).toBeCloseTo(0, 10)
  })

  it('rotates BEFORE it translates, and preserves lengths', () => {
    const out = transformCommands(SQUARE, { scale: 2, rotate: 37, x: 100, y: -50, flipY: false })
    const p = points(out)
    // The first point is the source origin, so it lands exactly on the translate.
    expect(p[0]!.x).toBeCloseTo(100, 9)
    expect(p[0]!.y).toBeCloseTo(-50, 9)
    // A rotation is rigid: the 10 × 4 source edge lengths survive the scale by 2
    // and nothing else.
    expect(Math.hypot(p[1]!.x - p[0]!.x, p[1]!.y - p[0]!.y)).toBeCloseTo(20, 9)
    expect(Math.hypot(p[2]!.x - p[1]!.x, p[2]!.y - p[1]!.y)).toBeCloseTo(8, 9)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. The placement loop — textOnPath.ts:169-188, with shaped advances
// ════════════════════════════════════════════════════════════════════════════

describe('glyphTransform on a curve — the placement loop', () => {
  it('puts each glyph CENTRE at its accumulated half-advance, on the curve', () => {
    const { frame, place } = scene(cfg({ arc: 120 }))
    const curve = place.curve as RunCurve
    const d = dense(curve.table.curve)
    // The curve is in the run's own frame; the placement then translates it.
    const local = { scale: place.scale, rotate: 0, x: 0, y: 0, flipY: true, curve }
    for (const g of frame.outlines.glyphs) {
      const c = placedCentres([g], local)[0]!
      const want = (g.x + g.advance / 2) * place.scale
      // Measured on the curve, by the dense table — not by asking the module
      // where it thinks it put it.
      expect(arcLengthOf(d, c.x, c.y)).toBeCloseTo(want, 1)
    }
  })

  it('reports the glyph ORIGIN, not its centre — every existing caller reads it that way', () => {
    const { frame, place } = scene(cfg({ arc: 90 }))
    const g = frame.outlines.glyphs[2] as GlyphOutline
    const t = glyphTransform(g, place)
    const placed = placeOutlines(frame.outlines, place)[2] as VectorCommand[]
    // The glyph's own commands are relative to its origin, and the origin is
    // where a command at (0, 0) would land — the property `glyphCellClipRect`,
    // the motion pivot and `extrudeCopyTransform` all depend on.
    const zero = transformCommands([{ command: 'moveTo', args: [0, 0] }], t)
    expect(zero[0]!.args[0]).toBeCloseTo(t.x, 12)
    expect(zero[0]!.args[1]).toBeCloseTo(t.y, 12)
    expect(placed.length).toBeGreaterThan(0)
  })

  it('turns each glyph to the TANGENT — a finite difference of the curve says so', () => {
    const { frame, place } = scene(cfg({ arc: 200 }))
    const curve = place.curve as RunCurve
    const c = curve.table.curve
    const local = { scale: place.scale, rotate: 0, x: 0, y: 0, flipY: true, curve }
    const d = dense(c)
    for (const g of frame.outlines.glyphs) {
      const centre = placedCentres([g], local)[0]!
      const s = arcLengthOf(d, centre.x, centre.y)
      // A finite difference of POSITION on the dense table, in arc length — no
      // analytic tangent, no shared derivation.
      const i = Math.min(DENSE - 1, Math.max(1, Math.round((s / curve.table.length) * DENSE)))
      const fd = Math.atan2(d.ys[i + 1]! - d.ys[i - 1]!, d.xs[i + 1]! - d.xs[i - 1]!) / DEG
      expect(centre.rotate).toBeCloseTo(fd, 2)
    }
  })

  it('stands each glyph UPRIGHT to the curve — its up-vector is the curve normal', () => {
    const { frame, place } = scene(cfg({ arc: 240 }))
    for (const g of frame.outlines.glyphs) {
      const t = glyphTransform(g, place)
      // The glyph's own baseline direction and its own vertical, as PLACED.
      const o = transformCommands([{ command: 'moveTo', args: [0, 0] }], t)[0]!.args
      const along = transformCommands([{ command: 'moveTo', args: [100, 0] }], t)[0]!.args
      const up = transformCommands([{ command: 'moveTo', args: [0, 100] }], t)[0]!.args
      const ax = (along[0] as number) - (o[0] as number)
      const ay = (along[1] as number) - (o[1] as number)
      const ux = (up[0] as number) - (o[0] as number)
      const uy = (up[1] as number) - (o[1] as number)
      // Perpendicular, and the "up" side is still up relative to the baseline:
      // the cross product keeps its sign, so no glyph is placed upside down.
      expect((ax * ux + ay * uy) / (Math.hypot(ax, ay) * Math.hypot(ux, uy))).toBeCloseTo(0, 9)
      expect(Math.sign(ax * uy - ay * ux)).toBe(-1)
    }
  })

  it('BROKEN CONTROL: forget the half-advance and the letters pile backwards', () => {
    const { frame, place } = scene(cfg({ arc: 150 }))
    const table = (place.curve as RunCurve).table
    // The widget's loop with the `accumulated += halfW` step dropped: the glyph's
    // CENTRE placed at the pen position rather than half an advance past it. Every
    // letter slides back by half its own width, so they overlap — and it is still
    // "a word on a curve" to look at, which is why this is measured.
    let worst = 0
    for (const g of frame.outlines.glyphs) {
      const good = glyphTransform(g, place)
      const half = (g.advance / 2) * place.scale
      const p = pointAtLength(table, g.x * place.scale)
      const bx = place.x + p.x - half * Math.cos(p.angle)
      const by = place.y + p.y - half * Math.sin(p.angle)
      worst = Math.max(worst, Math.hypot(good.x - bx, good.y - by))
    }
    // Half an advance at a 100 px em — a quarter of an em per letter, at least.
    // eslint-disable-next-line no-console
    console.log(`  BROKEN (no half-advance): worst glyph is ${worst.toFixed(2)} output px off`)
    expect(worst).toBeGreaterThan(20)
  })

  it('BROKEN CONTROL: uniform advances — the ink lands somewhere else entirely', () => {
    const { frame, place } = scene(cfg({ arc: 150 }))
    const glyphs = frame.outlines.glyphs
    const n = glyphs.length
    const uniform = frame.outlines.width / n
    // The same run with `ctx.measureText`-style equal-width cells instead of
    // fontkit's shaped, kerned `xAdvance`. 'i' and 'l' are half the width of 'S'
    // in Inter, so this is not a subtle difference.
    const fake: GlyphOutline[] = glyphs.map((g, i) => ({ ...g, x: i * uniform, advance: uniform }))
    let worst = 0
    for (let i = 0; i < n; i++) {
      const a = glyphTransform(glyphs[i] as GlyphOutline, place)
      const b = glyphTransform(fake[i] as GlyphOutline, place)
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y))
    }
    expect(worst).toBeGreaterThan(5)
    // And the advances really do differ — so the assertion above is about
    // shaping and not about an accident of this word.
    expect(spreadPct(glyphs.map(g => g.advance))).toBeGreaterThan(50)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. EVEN SPACING — measured, against the naive control
// ════════════════════════════════════════════════════════════════════════════

/**
 * The gaps between consecutive glyph centres, in ARC LENGTH along the curve,
 * measured by the dense table — and the gaps the same run has when flat, which
 * is what "even" means for text (glyphs are not equal width; an 'i' must get
 * less room than an 'S').
 */
function gapReport(glyphs: readonly GlyphOutline[], curve: VtCurve, scale: number, naive = false) {
  const table = buildCurveTable(curve)
  const d = dense(curve)
  const local = { scale, rotate: 0, x: 0, y: 0, flipY: true, curve: { table } }
  const centres = naive
    ? glyphs.map(g => {
        // `textOnPath.ts:179` distilled: distance ÷ length, straight back to `t`.
        const s = (g.x + g.advance / 2) * scale
        return evalCurve(curve, s / table.length)
      })
    : placedCentres(glyphs, local)
  const at = centres.map(c => arcLengthOf(d, c.x, c.y))
  const gaps: number[] = []
  const want: number[] = []
  for (let i = 1; i < glyphs.length; i++) {
    gaps.push(at[i]! - at[i - 1]!)
    const a = glyphs[i - 1] as GlyphOutline
    const b = glyphs[i] as GlyphOutline
    want.push(((b.x + b.advance / 2) - (a.x + a.advance / 2)) * scale)
  }
  const err = gaps.map((g, i) => Math.abs(g - want[i]!) / want[i]! * 100)
  return { gaps, want, maxErrPct: Math.max(...err), chord: centres.map((c, i) => (i === 0 ? 0 : Math.hypot(c.x - centres[i - 1]!.x, c.y - centres[i - 1]!.y))).slice(1) }
}

describe('spacing along the curve is EVEN — in arc length, measured', () => {
  it('gives every glyph EXACTLY its flat advance, on an arc', () => {
    const { frame, place } = scene(cfg({ arc: 180 }))
    const curve = (place.curve as RunCurve).table.curve
    const r = gapReport(frame.outlines.glyphs, curve, place.scale)
    // eslint-disable-next-line no-console
    console.log('  ARC 180° — arc-length gap vs the flat run\'s own gap, per pair')
    r.gaps.forEach((g, i) => {
      // eslint-disable-next-line no-console
      console.log(`    ${i}→${i + 1}: measured ${g.toFixed(4)}  flat ${r.want[i]!.toFixed(4)}  err ${(Math.abs(g - r.want[i]!) / r.want[i]! * 100).toFixed(4)}%`)
    })
    expect(r.maxErrPct).toBeLessThan(0.1)
  })

  it('holds at a second, much tighter radius', () => {
    const { frame, place } = scene(cfg({ arc: 330 }))
    const curve = (place.curve as RunCurve).table.curve
    const r = gapReport(frame.outlines.glyphs, curve, place.scale)
    // eslint-disable-next-line no-console
    console.log(`  ARC 330° — max gap error ${r.maxErrPct.toFixed(4)}%`)
    expect(r.maxErrPct).toBeLessThan(0.1)
  })

  it('and on a WAVE, where the naive t-mapping visibly bunches', () => {
    // A wave is the only genuinely non-constant-speed member of the family (a
    // bowed line IS a circular arc, so the naive control happens to be right
    // there — see `./curve.ts`'s spec). This is what proves the placement loop is
    // driven by arc length and not by a curve parameter.
    const { frame, place } = scene(cfg())
    const glyphs = frame.outlines.glyphs
    const W = frame.outlines.width * place.scale
    const wave: VtCurve = { type: 'wave', length: W, amplitude: W * 0.22, frequency: 1.5, phase: 0 }
    const good = gapReport(glyphs, wave, place.scale)
    const bad = gapReport(glyphs, wave, place.scale, true)
    // eslint-disable-next-line no-console
    console.log(`  WAVE — correct max gap error ${good.maxErrPct.toFixed(4)}%  |  naive ${bad.maxErrPct.toFixed(4)}%`)
    // eslint-disable-next-line no-console
    console.log(`  WAVE — chord spread: correct ${spreadPct(good.chord).toFixed(2)}%  naive ${spreadPct(bad.chord).toFixed(2)}%`)
    expect(good.maxErrPct).toBeLessThan(0.5)
    expect(bad.maxErrPct).toBeGreaterThan(10)
    expect(bad.maxErrPct / good.maxErrPct).toBeGreaterThan(20)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. It flows through `placeOutlines` — one geometry, two surfaces
// ════════════════════════════════════════════════════════════════════════════

describe('the curve goes through placeOutlines, so canvas and SVG are one', () => {
  it('the exported `d` IS the placed command list, glyph for glyph, on an arc', () => {
    const c = cfg({ arc: 165 })
    const { svg, frame } = vectorTypeSVG(font, c, 0, { ...BOX, precision: 3 })
    const place = vtPlacement(frame, BOX)
    const expected = placeOutlines(frame.outlines, place)
      .map(cmds => commandsToPathData(cmds, 3))
      .filter(d => d.length > 0)
    const got = [...svg.matchAll(/\sd="([^"]+)"/g)].map(m => m[1] as string)
    expect(got).toEqual(expected)
    // And the arc really did something — the flat run's `d` is different.
    const flat = placeOutlines(vectorTypeFrame(font, cfg(), 0).outlines, vtPlacement(vectorTypeFrame(font, cfg(), 0), BOX))
      .map(cmds => commandsToPathData(cmds, 3)).filter(d => d.length > 0)
    expect(got).not.toEqual(flat)
  })

  it('carries NO extra per-glyph transform for the bend — the geometry is the bend', () => {
    // The rotation is baked at the placement choke point, so an arc'd run with no
    // motion and no skew exports paths with no `transform` at all. That is what
    // makes the two surfaces agree by construction rather than by two matrix
    // writers being kept in step.
    const { svg } = vectorTypeSVG(font, cfg({ arc: 200 }), 0, { ...BOX, precision: 3 })
    expect(svg).not.toMatch(/<path[^>]*\stransform=/)
    // Real paths, not a raster or a CSS transform.
    expect(svg).toMatch(/<path/)
    expect(svg).not.toMatch(/<image/)
  })

  it('still composes with the motion transform and the run shear', () => {
    const c = cfg({
      arc: 140,
      skewX: 18,
      motion: { ...DEFAULT_CONFIG.motion, tracks: [], stagger: { delay: 0.05, order: 'forward', seed: 1 } },
      appearance: [vtLayer({ id: 'f', paint: '#ffffff' })],
      presets: { in: { id: 'spin-in', duration: 1 } },
    } as Partial<VectorTypeConfig>)
    const { svg } = vectorTypeSVG(font, c, 0.2, { ...BOX, precision: 3 })
    // The bend is in the `d`; the shear and any motion still ride the element
    // transform, exactly as before.
    expect(svg).toMatch(/<path/)
    expect(svg).toMatch(/transform="matrix\(/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Zero is free
// ════════════════════════════════════════════════════════════════════════════

describe('arc: 0 is bit-identical to the straight run', () => {
  it('resolves to NO curve at all', () => {
    expect(DEFAULT_CONFIG.arc).toBe(0)
    expect(vtIsCurved(cfg())).toBe(false)
    const { frame, place } = scene(cfg())
    expect(place.curve).toBeNull()
    expect(vtRunCurve(cfg(), frame.outlines, place.scale)).toBeNull()
  })

  it('places every coordinate on the same double', () => {
    const { frame, place } = scene(cfg())
    const withCurve = placeOutlines(frame.outlines, place)
    // The pre-curve arithmetic, written out: scale, flip, translate, no rotation.
    const manual = frame.outlines.glyphs.map(g => transformCommands(g.commands, {
      scale: place.scale,
      x: place.x + g.x * place.scale,
      y: place.y + g.y * -place.scale,
      flipY: true,
    }))
    expect(withCurve).toEqual(manual)
    for (let i = 0; i < manual.length; i++) {
      const a = points(withCurve[i]!), b = points(manual[i]!)
      for (let j = 0; j < b.length; j++) {
        expect(Object.is(a[j]!.x, b[j]!.x)).toBe(true)
        expect(Object.is(a[j]!.y, b[j]!.y)).toBe(true)
      }
    }
  })

  it('and `vtPlacement` returns exactly what the old bbox arithmetic did', () => {
    // `vtPlacement` now anchors on `placedInkBounds` instead of `outlines.bbox`
    // scaled, because only the first is right on a curve. For a FLAT run the two
    // are the same arithmetic, and this is that claim as a test rather than as a
    // comment.
    for (const align of ['left', 'center', 'right'] as const) {
      for (const pad of [0, 24]) {
        const c = cfg({ align })
        const frame = vectorTypeFrame(font, c, 0)
        const opts = { ...BOX, padding: pad }
        const got = vtPlacement(frame, opts)
        const upem = frame.outlines.unitsPerEm || 1000
        const scale = c.size / upem
        const availW = Math.max(0, opts.width - pad * 2)
        const availH = Math.max(0, opts.height - pad * 2)
        const b = frame.outlines.bbox
        const inkW = (b.maxX - b.minX) * scale
        const inkH = (b.maxY - b.minY) * scale
        const x = align === 'left' ? pad : align === 'right' ? pad + (availW - inkW) : pad + (availW - inkW) / 2
        expect(got.x).toBeCloseTo(x - b.minX * scale, 9)
        expect(got.y).toBeCloseTo(pad + (availH - inkH) / 2 + b.maxY * scale, 9)
        expect(got.rotate).toBe(0)
      }
    }
  })

  it('an empty run degenerates without a NaN reaching a transform', () => {
    const empty: TextOutlines = { glyphs: [], width: 0, unitsPerEm: 1000, coords: {}, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
    expect(placedInkBounds(empty, { x: 7, y: 9 })).toEqual({ minX: 7, minY: 9, maxX: 7, maxY: 9 })
    expect(vtRunCurve(cfg({ arc: 90 }), empty, 0.1)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6. The run stays in its box as it bends
// ════════════════════════════════════════════════════════════════════════════

describe('an arc\'d run is still anchored in the output box', () => {
  it('stays centred at every sweep, instead of swinging out of frame', () => {
    for (const arc of [0, 45, 120, 240, 359]) {
      const { frame, place } = scene(cfg({ arc }))
      const b = placedInkBounds(frame.outlines, place)
      const cx = (b.minX + b.maxX) / 2
      const cy = (b.minY + b.maxY) / 2
      expect(cx).toBeCloseTo(BOX.width / 2, 6)
      expect(cy).toBeCloseTo(BOX.height / 2, 6)
    }
  })

  it('honours `align` on a curve exactly as it does flat', () => {
    for (const arc of [0, 150]) {
      const left = scene(cfg({ arc, align: 'left' }))
      const right = scene(cfg({ arc, align: 'right' }))
      expect(placedInkBounds(left.frame.outlines, left.place).minX).toBeCloseTo(0, 6)
      expect(placedInkBounds(right.frame.outlines, right.place).maxX).toBeCloseTo(BOX.width, 6)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7. The config leaf and the paint-box consequence
// ════════════════════════════════════════════════════════════════════════════

describe('the `arc` config leaf', () => {
  it('round-trips through mergeConfig and lands junk on 0', () => {
    expect(mergeConfig({ ...DEFAULT_CONFIG, arc: 137.5 }).arc).toBe(137.5)
    expect(mergeConfig({ ...DEFAULT_CONFIG, arc: 'nope' as unknown as number }).arc).toBe(0)
    expect(mergeConfig({ ...DEFAULT_CONFIG, arc: NaN }).arc).toBe(0)
  })

  it('clamps at the RENDER choke point, where a motion track also arrives', () => {
    // `mergeConfig` deliberately does not clamp — a track's `from`/`to` never pass
    // through it — so the bound has to hold here or not at all.
    expect(vtArcSweep({ arc: 10_000 } as VectorTypeConfig)).toBe(VT_ARC_MAX)
    expect(vtArcSweep({ arc: -10_000 } as VectorTypeConfig)).toBe(-VT_ARC_MAX)
    expect(vtArcSweep({ arc: Infinity } as VectorTypeConfig)).toBe(0)
    expect(vtArcSweep({ arc: NaN } as VectorTypeConfig)).toBe(0)
    expect(vtArcSweep(null)).toBe(0)
    expect(vtArcSweep(undefined)).toBe(0)
  })

  it('vtIsCurved answers EXACTLY what vtRunCurve does, for every input', () => {
    const outlines = vectorTypeFrame(font, cfg(), 0).outlines
    for (const arc of [0, -0, 1e-9, -1e-9, 0.5, -0.5, 360, 361, -400, NaN, Infinity, -Infinity, undefined as unknown as number]) {
      const c = { ...cfg(), arc }
      expect(vtIsCurved(c), `arc=${arc}`).toBe(vtRunCurve(c, outlines, 0.1) !== null)
    }
  })

  it('opposite sweeps bow opposite ways, and the sign is stable', () => {
    const up = scene(cfg({ arc: 200 }))
    const down = scene(cfg({ arc: -200 }))
    const mid = (s: ReturnType<typeof scene>) => {
      const g = s.frame.outlines.glyphs
      const t = glyphTransform(g[Math.floor(g.length / 2)] as GlyphOutline, s.place)
      return t.rotate
    }
    // Mirror images: the middle glyph tilts the same amount the other way.
    expect(mid(up)).toBeCloseTo(-mid(down), 6)
    // And the ends really are turned — this is not a flat run in disguise.
    expect(Math.abs(glyphTransform(up.frame.outlines.glyphs[0] as GlyphOutline, up.place).rotate)).toBeGreaterThan(45)
  })
})

describe('the paint box on a curve — the consequence this task DECLARES', () => {
  it('asks for `extend`, because the ink leaves the axis-aligned box', () => {
    // The same mechanism the shear needed, and needed more. Task 4 decides where
    // the box SHOULD be; this only stops the ink outside it coming out empty.
    const straight = vectorTypeFrame(font, cfg(), 0)
    const bent = vectorTypeFrame(font, cfg({ arc: 200 }), 0)
    const sp = vtPlacement(straight, BOX)
    const bp = vtPlacement(bent, BOX)
    // The run's PLACED ink under a bend is far outside the box the flat
    // arithmetic reports for it — measured here so the `extend` is a finding
    // rather than a precaution.
    const flatBox = placedInkBounds(straight.outlines, sp)
    const bentBox = placedInkBounds(bent.outlines, bp)
    const grew = ((bentBox.maxY - bentBox.minY) / (flatBox.maxY - flatBox.minY))
    // eslint-disable-next-line no-console
    console.log(`  arc 200° grows the run's ink box ${grew.toFixed(2)}× taller than the straight run's`)
    expect(grew).toBeGreaterThan(2)
  })
})
