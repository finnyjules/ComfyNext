/**
 * Vector Type — arc-length curve sampling.
 *
 * The highest test leverage in the skew+arc plan, because the module is plain
 * numbers in and plain numbers out: no font, no canvas, no fixture image, nothing
 * to eyeball. Every claim below is an assertion about arithmetic.
 *
 * The one that matters is the **naive control**. `utils/textOnPath.ts` maps
 * accumulated advance ÷ total length straight back to the curve parameter `t`,
 * which is only correct when the curve runs at constant speed. That naive mapping
 * is implemented here on purpose (`naiveTAtLength`) and run side by side with the
 * real inversion on the same curve, so "the inversion does work" is a measured
 * ratio rather than a claim. On a circular arc the two agree to float noise — that
 * is the control's own control, and it is what proves the comparison is measuring
 * curve speed and not a difference in the test harness.
 *
 * PURE, and proved so twice: once by running the functions with every canvas global
 * replaced by a trap, and once statically, by reading the module's own source and
 * asserting it imports nothing at all — paper.js least of all, since arc placement
 * is on the draw loop and paper is reserved for the bake-time boolean union.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  VT_CURVE_SAMPLES_MAX,
  VT_CURVE_SAMPLES_MIN,
  autoSamples,
  buildCurveTable,
  curveLength,
  evalCurve,
  pointAtLength,
  tAtLength,
  type VtArcCurve,
  type VtCurve,
  type VtLineCurve,
  type VtWaveCurve,
} from '~/lib/vectortype/curve'

const TAU = Math.PI * 2
const DEG = Math.PI / 180

// ── the deliberate control ──────────────────────────────────────────────────

/**
 * `utils/textOnPath.ts`, distilled: distance ÷ length, straight back into `t`.
 *
 * Reproduced faithfully rather than caricatured — this IS the shipped widget's
 * placement rule (`t: accumulated / refLen`, textOnPath.ts:179). It is exactly
 * right on a constant-speed curve and wrong everywhere else.
 */
function naiveTAtLength(s: number, length: number): number {
  return length > 0 ? Math.min(1, Math.max(0, s / length)) : 0
}

/** Arc length between two curve parameters, by fine quadrature. Independent of the
 *  module's own table, so it can referee it. */
function arcBetween(curve: VtCurve, ta: number, tb: number, steps = 4000): number {
  let len = 0
  let prev = evalCurve(curve, ta)
  for (let i = 1; i <= steps; i++) {
    const p = evalCurve(curve, ta + ((tb - ta) * i) / steps)
    len += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return len
}

/** min / max / mean / relative spread of a list. Spread is the headline number:
 *  0 means perfectly even. */
function stats(xs: number[]) {
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return { min, max, mean, spread: (max - min) / mean }
}

/**
 * Place `n` glyph centres evenly by arc length and report the arc length that
 * actually falls between consecutive centres — measured by independent quadrature,
 * so a bug in the table cannot hide inside the metric.
 */
function spacingByArc(curve: VtCurve, n: number, mode: 'correct' | 'naive'): number[] {
  const table = buildCurveTable(curve)
  const L = table.length
  const ts: number[] = []
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) * L) / n
    ts.push(mode === 'correct' ? tAtLength(table, s) : naiveTAtLength(s, L))
  }
  const gaps: number[] = []
  for (let i = 1; i < n; i++) gaps.push(arcBetween(curve, ts[i - 1]!, ts[i]!, 400))
  return gaps
}

/** Straight-line distance between consecutive centres — what a reader actually
 *  sees as letter spacing. */
function spacingByChord(curve: VtCurve, n: number, mode: 'correct' | 'naive'): number[] {
  const table = buildCurveTable(curve)
  const L = table.length
  const pts = Array.from({ length: n }, (_, i) => {
    const s = ((i + 0.5) * L) / n
    return mode === 'correct' ? pointAtLength(table, s) : evalCurve(curve, naiveTAtLength(s, L))
  })
  const gaps: number[] = []
  for (let i = 1; i < n; i++) gaps.push(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y))
  return gaps
}

// The curves under test.
const HALF_CIRCLE: VtArcCurve = { type: 'arc', radius: 200, startAngle: -90, endAngle: 90 }
const WAVE: VtWaveCurve = { type: 'wave', length: 600, amplitude: 100, frequency: 1, phase: 0 }

// ── equal arc length → equal spacing ────────────────────────────────────────

describe('the property: equal arc length gives equal spacing', () => {
  it('spaces evenly on an ARC — where naive t-sampling is also right', () => {
    // The control's control. A circular arc is the one constant-speed member of
    // the family, so |dP/dt| never varies and advance÷length happens to be a
    // correct inversion. If the two methods DISAGREED here, the wave comparison
    // below would be measuring the harness rather than the curve.
    const correct = stats(spacingByArc(HALF_CIRCLE, 24, 'correct'))
    const naive = stats(spacingByArc(HALF_CIRCLE, 24, 'naive'))
    expect(correct.spread).toBeLessThan(1e-6)
    expect(naive.spread).toBeLessThan(1e-6)
    expect(correct.mean).toBeCloseTo(naive.mean, 6)
  })

  it('spaces evenly on a WAVE — where naive t-sampling visibly bunches', () => {
    // The headline. y = 100·sin(2πx/600): speed runs from 1.0 at the crests to
    // √(1 + (Aω)²) ≈ 1.45 at the zero crossings, so uniform `t` lays glyphs ~45%
    // further apart through the steep parts than over the peaks.
    const n = 40
    const correct = stats(spacingByArc(WAVE, n, 'correct'))
    const naive = stats(spacingByArc(WAVE, n, 'naive'))
    const correctChord = stats(spacingByChord(WAVE, n, 'correct'))
    const naiveChord = stats(spacingByChord(WAVE, n, 'naive'))

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        `  wave: length ${WAVE.length}, amplitude ${WAVE.amplitude}, frequency ${WAVE.frequency} — ${n} glyph centres`,
        `  arc length (curveLength)          ${curveLength(WAVE).toFixed(4)}  (straight span ${WAVE.length})`,
        '  ── spacing measured as ARC LENGTH between consecutive centres ──',
        `  correct  min ${correct.min.toFixed(4)}  max ${correct.max.toFixed(4)}  spread ${(correct.spread * 100).toFixed(4)}%`,
        `  naive    min ${naive.min.toFixed(4)}  max ${naive.max.toFixed(4)}  spread ${(naive.spread * 100).toFixed(4)}%`,
        `  naive is ${(naive.spread / correct.spread).toFixed(0)}× less even; widest gap is ${(naive.max / naive.min).toFixed(3)}× the narrowest`,
        '  ── spacing measured as CHORD between consecutive centres (what you see) ──',
        `  correct  min ${correctChord.min.toFixed(4)}  max ${correctChord.max.toFixed(4)}  spread ${(correctChord.spread * 100).toFixed(4)}%`,
        `  naive    min ${naiveChord.min.toFixed(4)}  max ${naiveChord.max.toFixed(4)}  spread ${(naiveChord.spread * 100).toFixed(4)}%`,
        '',
      ].join('\n'),
    )

    // Correct: even to a fraction of a percent. The residue is the table's own
    // quantisation, not a systematic bunching.
    expect(correct.spread).toBeLessThan(0.005)
    // Naive: off by tens of percent, and the ratio between the two is the number
    // that says the inversion is load-bearing rather than decorative.
    expect(naive.spread).toBeGreaterThan(0.3)
    expect(naive.spread / correct.spread).toBeGreaterThan(50)
    // Both methods still cover the whole curve — the naive one is not short, it is
    // unevenly distributed, which is the failure that is hard to spot in a preview.
    expect(Math.abs(naive.mean - correct.mean) / correct.mean).toBeLessThan(0.05)
  })

  it('spaces evenly on a BOWED LINE, which is an arc in disguise', () => {
    // Worth saying out loud: a bowed line is a circular arc under a different
    // parameterisation, so it is ALSO constant speed. The wave is the only
    // genuinely non-constant-speed member of this family, which is exactly why the
    // comparison above uses it. Asserted anyway so a future rewrite of the closed
    // form cannot quietly break evenness.
    const line: VtLineCurve = { type: 'line', length: 500, curvature: 0.6 }
    expect(stats(spacingByArc(line, 20, 'correct')).spread).toBeLessThan(1e-6)
  })

  it('makes a fixed step in s a fixed distance, independent of where you start', () => {
    // The promise stated directly: advance s by a constant and the point moves the
    // same arc length, anywhere on the curve.
    const table = buildCurveTable(WAVE)
    const step = table.length / 60
    const moves: number[] = []
    for (let i = 0; i < 59; i++) {
      const a = tAtLength(table, i * step)
      const b = tAtLength(table, (i + 1) * step)
      moves.push(arcBetween(WAVE, a, b, 400))
    }
    expect(stats(moves).spread).toBeLessThan(0.005)
  })
})

// ── the table itself ────────────────────────────────────────────────────────

describe('curveLength — the cumulative chord table', () => {
  it('matches the closed form on an arc, to a thousandth of a percent', () => {
    // radius · sweep. 512 samples per turn puts the chord deficit at ~6.3e-6 of
    // the length — 0.004px on this 628px arc — and it is a systematic UNDER-count,
    // never an over-count, because a chord is always shorter than its arc.
    for (const [curve, exact] of [
      [HALF_CIRCLE, 200 * Math.PI],
      [{ type: 'circle', radius: 137 } as VtCurve, 137 * TAU],
      [{ type: 'arc', radius: 40, startAngle: 20, endAngle: 200 } as VtCurve, 40 * Math.PI],
    ] as [VtCurve, number][]) {
      const got = curveLength(curve)
      expect(got).toBeLessThanOrEqual(exact)
      expect(Math.abs(got - exact) / exact).toBeLessThan(1e-5)
    }
  })

  it('matches an independent quadrature on a wave', () => {
    // 256 samples per period leaves the table 8e-6 short of the truth — 0.006 of
    // a unit on a 740-unit curve, and short rather than long, as a chord must be.
    const truth = arcBetween(WAVE, 0, 1, 200_000)
    const got = curveLength(WAVE)
    expect(got).toBeLessThanOrEqual(truth)
    expect(Math.abs(got - truth) / truth).toBeLessThan(2e-5)
    // …and is longer than the straight span it is drawn across, which is the whole
    // reason the widget's "estimate then reuse as t" shortcut misbehaves.
    expect(curveLength(WAVE)).toBeGreaterThan(WAVE.length)
  })

  it('keeps a bowed line the SAME arc length at every curvature', () => {
    // The closed form's radius is `length / sweep`, so `radius · sweep` is
    // `length` identically. Bowing a run bends it without lengthening it, which is
    // what a "curvature" slider ought to do — and it means a run that fits at 0
    // still fits at 0.8.
    for (const curvature of [0, 0.01, 0.25, 0.6, 1, -0.6, -1]) {
      expect(curveLength({ type: 'line', length: 400, curvature }), `curvature ${curvature}`).toBeCloseTo(400, 1)
    }
  })

  it('is monotone non-decreasing — the binary search depends on it', () => {
    for (const c of [HALF_CIRCLE, WAVE, { type: 'line', length: 300, curvature: -0.8 } as VtLineCurve]) {
      const { cum } = buildCurveTable(c)
      for (let i = 1; i < cum.length; i++) expect(cum[i]!).toBeGreaterThanOrEqual(cum[i - 1]!)
    }
  })

  it('scales its resolution with how much the curve turns, inside hard bounds', () => {
    // A flat sample count would be wasteful on a 10° arc and wrong on a spiral.
    expect(autoSamples({ type: 'arc', radius: 10, startAngle: 0, endAngle: 10 })).toBe(VT_CURVE_SAMPLES_MIN)
    expect(autoSamples({ type: 'circle', radius: 10 })).toBe(512)
    expect(autoSamples({ type: 'arc', radius: 10, startAngle: 0, endAngle: 720 })).toBe(1024)
    expect(autoSamples({ ...WAVE, frequency: 8 })).toBe(2048)
    // Pathological configs degrade in ACCURACY, not in frame time or memory.
    expect(autoSamples({ ...WAVE, frequency: 400 })).toBe(VT_CURVE_SAMPLES_MAX)
    expect(autoSamples({ type: 'arc', radius: 1, startAngle: 0, endAngle: 1e9 })).toBe(VT_CURVE_SAMPLES_MAX)
    expect(autoSamples({ ...WAVE, frequency: NaN })).toBe(VT_CURVE_SAMPLES_MIN)
  })

  it('still holds a very tight or a very long curve to a usable error', () => {
    // Tight: a 2px-radius circle. Long: a 20,000px one. Both are the SAME relative
    // error, because the sample count follows the swept angle rather than the size
    // — that is the point of scaling by turns instead of by length.
    for (const radius of [2, 20_000]) {
      const rel = Math.abs(curveLength({ type: 'circle', radius }) - radius * TAU) / (radius * TAU)
      expect(rel, `radius ${radius}`).toBeLessThan(1e-4)
    }
    // 40 turns hits the sample ceiling, so the error grows — bounded, and still
    // well under a tenth of a percent.
    const spiralish = { type: 'arc', radius: 300, startAngle: 0, endAngle: 40 * 360 } as VtArcCurve
    const exact = 300 * 40 * TAU
    expect(Math.abs(curveLength(spiralish) - exact) / exact).toBeLessThan(1e-3)
  })
})

// ── the inversion at the edges ──────────────────────────────────────────────

describe('pointAtLength — edges and degeneracies', () => {
  const table = buildCurveTable(HALF_CIRCLE)

  it('returns the start at s = 0 and the end at s = length', () => {
    const start = pointAtLength(table, 0)
    expect(start.x).toBeCloseTo(200 * Math.cos(-90 * DEG), 9)
    expect(start.y).toBeCloseTo(200 * Math.sin(-90 * DEG), 9)
    const end = pointAtLength(table, table.length)
    expect(end.x).toBeCloseTo(200 * Math.cos(90 * DEG), 6)
    expect(end.y).toBeCloseTo(200 * Math.sin(90 * DEG), 6)
  })

  it('clamps past either end instead of extrapolating off the curve', () => {
    // A run longer than its curve is ordinary — a long word on a small arc. Letters
    // piling up at the end is a legible failure; letters spiralling off into
    // nowhere is not.
    for (const s of [table.length * 1.5, table.length + 1e6, Number.POSITIVE_INFINITY]) {
      const p = pointAtLength(table, s)
      expect(p.x).toBeCloseTo(200 * Math.cos(90 * DEG), 6)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    for (const s of [-1, -1e6, Number.NEGATIVE_INFINITY]) {
      const p = pointAtLength(table, s)
      expect(p.y).toBeCloseTo(-200, 6)
    }
    // NaN is a number that reaches a transform matrix and blanks the glyph. It
    // lands at the start instead.
    expect(pointAtLength(table, NaN).y).toBeCloseTo(-200, 6)
  })

  it('survives a zero-length curve — every s gives the one point, no NaN', () => {
    const zeroSweep: VtArcCurve = { type: 'arc', radius: 200, startAngle: 45, endAngle: 45 }
    expect(curveLength(zeroSweep)).toBe(0)
    for (const s of [0, 10, -10, 1e9, NaN]) {
      const p = pointAtLength(zeroSweep, s)
      expect(p.x).toBeCloseTo(200 * Math.cos(45 * DEG), 9)
      expect(p.y).toBeCloseTo(200 * Math.sin(45 * DEG), 9)
      // Tangent falls back to perpendicular-to-radius rather than a flat 0, so a
      // degenerate arc still reads as an arc.
      expect(p.angle).toBeCloseTo(45 * DEG + Math.PI / 2, 9)
    }
  })

  it('survives a degenerate radius — 0, negative, and non-finite', () => {
    expect(curveLength({ type: 'arc', radius: 0, startAngle: 0, endAngle: 180 })).toBe(0)
    const p = pointAtLength({ type: 'arc', radius: 0, startAngle: 0, endAngle: 180 }, 50)
    // The point collapses to the centre, but the tangent keeps the arc's own
    // convention — perpendicular to the radius, in the sweep's direction — so a
    // radius animating down through 0 rotates its glyphs smoothly instead of
    // snapping them all to 0°.
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
    expect(p.angle).toBeCloseTo(Math.PI / 2, 9)

    // A negative radius traverses the mirrored circle; the LENGTH is the magnitude.
    expect(curveLength({ type: 'arc', radius: -200, startAngle: -90, endAngle: 90 })).toBeCloseTo(200 * Math.PI, 2)

    // Non-finite anything degrades to 0 rather than propagating NaN.
    for (const bad of [NaN, Infinity, undefined, null, 'big'] as unknown[]) {
      const q = pointAtLength({ type: 'arc', radius: bad as number, startAngle: 0, endAngle: 90 }, 5)
      expect(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.angle)).toBe(true)
    }
    for (const bad of [NaN, undefined, null] as unknown[]) {
      const q = pointAtLength({ type: 'wave', length: 600, amplitude: 80, frequency: 1, phase: bad as number }, 5)
      expect(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.angle)).toBe(true)
    }
    // An unknown curve is one point at the origin, not a throw: a config that has
    // not migrated should draw a flat run, not a red screen.
    expect(pointAtLength({ type: 'spiral' } as unknown as VtCurve, 10)).toEqual({ x: 0, y: 0, angle: 0 })
    expect(curveLength({ type: 'spiral' } as unknown as VtCurve)).toBe(0)
  })

  it('inverts exactly at every sample boundary, and monotonically between them', () => {
    const { cum, samples } = table
    for (const i of [0, 1, 7, samples >> 1, samples - 1, samples]) {
      expect(tAtLength(table, cum[i]!), `sample ${i}`).toBeCloseTo(i / samples, 6)
    }
    let prev = -1
    for (let i = 0; i <= 500; i++) {
      const t = tAtLength(table, (i / 500) * table.length)
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
  })
})

// ── the angle is the tangent ────────────────────────────────────────────────

/** Signed difference between two angles, wrapped into (−π, π]. */
const wrap = (d: number): number => {
  let x = d % TAU
  if (x > Math.PI) x -= TAU
  if (x <= -Math.PI) x += TAU
  return x
}

describe('the returned angle is the TANGENT, and it is continuous', () => {
  const curves: [string, VtCurve][] = [
    ['arc', HALF_CIRCLE],
    ['circle', { type: 'circle', radius: 90 }],
    ['wave', WAVE],
    ['line bowed', { type: 'line', length: 500, curvature: 0.7 }],
    ['line bowed negative', { type: 'line', length: 500, curvature: -0.7 }],
    ['line straight', { type: 'line', length: 500, curvature: 0 }],
  ]

  it.each(curves)('%s — matches a finite difference of the position', (_name, curve) => {
    // The analytic tangent and the direction the point is actually travelling must
    // be the same thing. A tangent derived from the wrong branch (the widget's
    // hard-coded `a + π/2`) passes an "it looks rotated" eyeball test and fails
    // this one.
    const table = buildCurveTable(curve)
    const h = table.length / 20_000
    for (let i = 1; i < 20; i++) {
      const s = (i / 20) * table.length
      const p = pointAtLength(table, s)
      const a = pointAtLength(table, s - h)
      const b = pointAtLength(table, s + h)
      const fd = Math.atan2(b.y - a.y, b.x - a.x)
      expect(Math.abs(wrap(p.angle - fd)), `s ${s.toFixed(2)}`).toBeLessThan(1e-3)
    }
  })

  it.each(curves)('%s — turns smoothly, with no jump between samples', (_name, curve) => {
    const table = buildCurveTable(curve)
    const n = 400
    let prev = pointAtLength(table, 0).angle
    let total = 0
    for (let i = 1; i <= n; i++) {
      const a = pointAtLength(table, (i / n) * table.length).angle
      const d = Math.abs(wrap(a - prev))
      // A full circle over 400 steps turns 0.0157 rad per step. Anything an order
      // of magnitude past that is a discontinuity, not a bend.
      expect(d, `step ${i}`).toBeLessThan(0.2)
      total += d
      prev = a
    }
    expect(Number.isFinite(total)).toBe(true)
  })

  it('follows the direction of TRAVEL on a reversed arc', () => {
    // `endAngle < startAngle` runs the arc backwards. textOnPath.ts returns
    // `a + π/2` regardless, so its letters face the way they would have gone had
    // the arc run forwards — i.e. backwards. The derivative gets this right for
    // free, and this is the test that says so.
    const fwd: VtArcCurve = { type: 'arc', radius: 200, startAngle: -90, endAngle: 90 }
    const rev: VtArcCurve = { type: 'arc', radius: 200, startAngle: 90, endAngle: -90 }
    const f = pointAtLength(fwd, curveLength(fwd) / 2)
    const r = pointAtLength(rev, curveLength(rev) / 2)
    // Same point on the circle (both pass through angle 0 at the midpoint)…
    expect(r.x).toBeCloseTo(f.x, 4)
    expect(r.y).toBeCloseTo(f.y, 4)
    // …opposite tangents.
    expect(Math.abs(wrap(r.angle - f.angle))).toBeCloseTo(Math.PI, 4)
  })

  it('stays continuous as a bowed line is animated through straight', () => {
    // The midpoint of a bowed line sits `L·π·c/4` off the chord as c → 0. This
    // module tracks that limit all the way down to c = 1e-9; the widget snaps to a
    // straight line below |curvature| 0.01 and so JUMPS by ~3.9px mid-animation on
    // a 500-unit run — small, but it is a pop, and it is the reason the dead zone
    // here is nine orders of magnitude smaller.
    const L = 500
    const at = (c: number) => pointAtLength({ type: 'line', length: L, curvature: c }, L / 2)
    expect(at(0)).toEqual({ x: 250, y: 0, angle: 0 })
    for (const c of [1e-9, 1e-7, 1e-5, 1e-3, 0.0099]) {
      const p = at(c)
      // x is the midpoint at every curvature, to the table's own resolution; only
      // y bows.
      expect(p.x, `curvature ${c}`).toBeCloseTo(250, 4)
      const predicted = (L * Math.PI * c) / 4
      expect(Math.abs(p.y), `curvature ${c}`).toBeGreaterThan(predicted * 0.99)
      expect(Math.abs(p.y), `curvature ${c}`).toBeLessThan(predicted * 1.01)
    }
    // The size of the widget's snap, stated as a number rather than a worry.
    expect(Math.abs(at(0.0099).y)).toBeCloseTo(3.887, 2)
  })
})

// ── purity ──────────────────────────────────────────────────────────────────

describe('purity — proved, not asserted', () => {
  it('runs with every canvas and DOM global replaced by a trap', () => {
    const traps = ['document', 'window', 'Path2D', 'DOMMatrix', 'CanvasRenderingContext2D', 'OffscreenCanvas', 'fetch'] as const
    const had = traps.map(k => [k, (globalThis as Record<string, unknown>)[k]] as const)
    for (const k of traps) {
      Object.defineProperty(globalThis, k, {
        configurable: true,
        get() { throw new Error(`curve.ts touched ${k}`) },
      })
    }
    try {
      const t = buildCurveTable(WAVE)
      expect(t.length).toBeGreaterThan(600)
      const p = pointAtLength(t, t.length / 3)
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle)).toBe(true)
      expect(curveLength(HALF_CIRCLE)).toBeGreaterThan(0)
    } finally {
      for (const [k, v] of had) {
        Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v })
      }
    }
  })

  it('imports NOTHING — paper.js above all', () => {
    // Static, and stricter than the runtime trap: arc placement runs every frame,
    // and `canvas.ts` is proved three separate ways not to reach paper. A bare
    // `import 'paper'` anywhere on that side of the line turns the extrude body
    // cache's import-graph test red; this catches it one file earlier.
    const src = readFileSync(fileURLToPath(new URL('../../app/lib/vectortype/curve.ts', import.meta.url)), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/^\s*import\s/m)
    expect(code).not.toMatch(/\brequire\s*\(/)
    for (const forbidden of ['paper', 'document', 'canvas', 'Path2D', 'DOMMatrix', 'fetch']) {
      expect(code, `mentions ${forbidden}`).not.toContain(forbidden)
    }
  })
})
