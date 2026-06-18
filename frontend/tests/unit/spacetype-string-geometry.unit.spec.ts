import { describe, it, expect } from 'vitest'
import { parsePath, serializePath, defaultPath, forwardHandle, backHandle, autoSmooth, type PathPoint } from '~/lib/spacetype/stringPath'
import { cubicPoint, cubicTangent, sampleString, buildStrip, stripSpeedFactor, type WorldPoint } from '~/lib/spacetype/stringGeometry'
import { loopTiles } from '~/lib/spacetype/ribbonGeometry'

describe('stringPath', () => {
  it('round-trips serialize/parse', () => {
    const doc = defaultPath()
    const back = parsePath(serializePath(doc))
    expect(back).toEqual(doc)
  })

  it('garbage → default path', () => {
    expect(parsePath('not json')).toEqual(defaultPath())
    expect(parsePath({})).toEqual(defaultPath())
    expect(parsePath({ strings: [{ points: [] }] })).toEqual(defaultPath())
    expect(parsePath(null)).toEqual(defaultPath())
  })

  it('default seed is one string of 3 points down the centre', () => {
    const d = defaultPath()
    expect(d.strings).toHaveLength(1)
    expect(d.strings[0]!.points).toHaveLength(3)
    expect(d.strings[0]!.points.every(p => p.x === 0.5)).toBe(true)
  })

  it('handle positions derive from (a, hl, althl)', () => {
    const p: PathPoint = { x: 0.5, y: 0.5, a: 0, hl: 0.1, althl: 0.2 }
    const f = forwardHandle(p)
    const b = backHandle(p)
    expect(f.x).toBeCloseTo(0.6); expect(f.y).toBeCloseTo(0.5)
    expect(b.x).toBeCloseTo(0.3); expect(b.y).toBeCloseTo(0.5)
  })

  it('fills missing althl from hl', () => {
    const d = parsePath({ strings: [{ points: [{ x: 0.5, y: 0.5, a: 1, hl: 0.3 }] }] })
    expect(d.strings[0]!.points[0]!.althl).toBe(0.3)
  })

  it('round-trips mode + tension', () => {
    const d = parsePath({ strings: [{ points: [{ x: 0.5, y: 0.5 }] }], mode: 'manual', tension: 0.8 })
    expect(d.mode).toBe('manual')
    expect(d.tension).toBe(0.8)
    const back = parsePath(serializePath(d))
    expect(back.mode).toBe('manual')
    expect(back.tension).toBe(0.8)
  })
})

describe('autoSmooth', () => {
  const pts = (): PathPoint[] => [
    { x: 0, y: 0, a: 0, hl: 0, althl: 0 },
    { x: 1, y: 0, a: 0, hl: 0, althl: 0 },
    { x: 2, y: 0, a: 0, hl: 0, althl: 0 },
  ]

  it('< 2 points returns a copy unchanged', () => {
    const one = [pts()[0]!]
    expect(autoSmooth(one, 0.5)).toEqual(one)
  })

  it('handles are symmetric (hl === althl)', () => {
    for (const p of autoSmooth(pts(), 0.5)) expect(p.hl).toBeCloseTo(p.althl)
  })

  it('forward = P − T and back = P + T (Catmull-Rom symmetric tangent)', () => {
    const s = autoSmooth(pts(), 0.5) // f = 0.25; mid tangent T = 0.25·(C−A) = (0.5,0)
    const mid = s[1]!
    const f = forwardHandle(mid); const b = backHandle(mid)
    expect(f.x).toBeCloseTo(0.5); expect(f.y).toBeCloseTo(0) // 1 − 0.5
    expect(b.x).toBeCloseTo(1.5); expect(b.y).toBeCloseTo(0) // 1 + 0.5
  })

  it('curviness 0 collapses handles to the point (straight corners)', () => {
    for (const p of autoSmooth(pts(), 0)) expect(p.hl).toBeCloseTo(0)
  })

  it('higher curviness → longer handles', () => {
    const lo = autoSmooth(pts(), 0.3)[1]!.hl
    const hi = autoSmooth(pts(), 0.9)[1]!.hl
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('cubic bézier', () => {
  it('hits endpoints at t=0 and t=1', () => {
    expect(cubicPoint(0, 1, 2, 3, 0)).toBe(0)
    expect(cubicPoint(0, 1, 2, 3, 1)).toBe(3)
  })

  it('midpoint of a straight bézier is the average', () => {
    // collinear controls → straight line; midpoint = 1.5
    expect(cubicPoint(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5)
  })

  it('tangent points along the curve direction', () => {
    // straight x-line → positive x tangent, zero y tangent
    expect(cubicTangent(0, 1, 2, 3, 0.5)).toBeGreaterThan(0)
  })
})

function line(): WorldPoint[] {
  // Two points making a straight horizontal segment from (1,0) to (-1,0).
  // STG traverses last→first: points[1](t=0) → points[0](t=1), using
  // c1 = points[1].forward and c2 = points[0].back. Keep both controls INTERIOR
  // (between the endpoints) so the curve is a clean monotonic straight line.
  return [
    { x: -1, y: 0, fhx: -1.3, fhy: 0, bhx: -0.33, bhy: 0 },
    { x: 1, y: 0, fhx: 0.33, fhy: 0, bhx: 1.3, bhy: 0 },
  ]
}

describe('sampleString', () => {
  it('returns empty for < 2 points', () => {
    expect(sampleString([line()[0]!], 10)).toEqual([])
  })

  it('arc length is monotonic non-decreasing and starts at 0', () => {
    const s = sampleString(line(), 20)
    expect(s[0]!.s).toBe(0)
    for (let i = 1; i < s.length; i++) expect(s[i]!.s).toBeGreaterThanOrEqual(s[i - 1]!.s)
    expect(s[s.length - 1]!.s).toBeGreaterThan(0)
  })

  it('joins multi-segment strings without duplicating the joint vertex', () => {
    const pts: WorldPoint[] = [
      { x: 0, y: 0, fhx: 0.3, fhy: 0, bhx: -0.3, bhy: 0 },
      { x: 1, y: 0, fhx: 1.3, fhy: 0, bhx: 0.7, bhy: 0 },
      { x: 2, y: 0, fhx: 2.3, fhy: 0, bhx: 1.7, bhy: 0 },
    ]
    const steps = 10
    const s = sampleString(pts, steps)
    // 2 segments, (steps+1) for the first, steps for each subsequent (joint skipped).
    expect(s.length).toBe((steps + 1) + steps)
  })

  it('perpendicular is unit length', () => {
    const s = sampleString(line(), 8)
    for (const p of s) expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1)
  })
})

describe('buildStrip', () => {
  const samples = sampleString(line(), 20)

  it('partitions V into {0,1} and keeps indices in-bounds', () => {
    const g = buildStrip(samples, { index: 0, count: 4, stripHeight: 2, texAspect: 3, roundCap: false })
    const vertCount = g.positions.length / 3
    expect(vertCount).toBeGreaterThan(0)
    for (let i = 0; i < g.uvs.length; i += 2) {
      const v = g.uvs[i + 1]!
      expect(v === 0 || v === 1).toBe(true)
    }
    for (const idx of g.indices) expect(idx).toBeLessThan(vertCount)
  })

  it('strip m occupies its perpendicular slice of the height', () => {
    // For a horizontal line, perpendicular is vertical → strip Y range is its slice.
    const g0 = buildStrip(samples, { index: 0, count: 2, stripHeight: 4, texAspect: 1, roundCap: false })
    const g1 = buildStrip(samples, { index: 1, count: 2, stripHeight: 4, texAspect: 1, roundCap: false })
    const ys0 = [...Array(g0.positions.length / 3)].map((_, i) => g0.positions[i * 3 + 1]!)
    const ys1 = [...Array(g1.positions.length / 3)].map((_, i) => g1.positions[i * 3 + 1]!)
    // strip 0 spans y∈[-2,0], strip 1 spans y∈[0,2] (count=2, H=4)
    expect(Math.min(...ys0)).toBeCloseTo(-2)
    expect(Math.max(...ys0)).toBeCloseTo(0)
    expect(Math.min(...ys1)).toBeCloseTo(0)
    expect(Math.max(...ys1)).toBeCloseTo(2)
  })

  it('U scales by arc length / (texAspect · perStripHeight)', () => {
    const g = buildStrip(samples, { index: 0, count: 1, stripHeight: 2, texAspect: 5, roundCap: false })
    const maxU = Math.max(...[...Array(g.uvs.length / 2)].map((_, i) => g.uvs[i * 2]!))
    const totalArc = samples[samples.length - 1]!.s
    expect(maxU).toBeCloseTo(totalArc / (5 * 2))
  })

  it('round caps add extra vertices', () => {
    const plain = buildStrip(samples, { index: 0, count: 1, stripHeight: 2, texAspect: 1, roundCap: false })
    const capped = buildStrip(samples, { index: 0, count: 1, stripHeight: 2, texAspect: 1, roundCap: true, capSegs: 5 })
    expect(capped.positions.length).toBeGreaterThan(plain.positions.length)
  })
})

describe('seamless scroll', () => {
  it('per-strip tile count is an integer ⇒ loop returns to start', () => {
    for (let i = 0; i < 6; i++) {
      const k = loopTiles(0.5 * stripSpeedFactor(i, 0.6), 1)
      expect(Number.isInteger(k)).toBe(true)
    }
  })
})
