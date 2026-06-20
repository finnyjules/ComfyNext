import { describe, it, expect } from 'vitest'
import { helixPoint, buildSpiralGeometry, pitchScaleAt } from '../../app/lib/spacetype/spiralGeometry'

const TWO_PI = Math.PI * 2

describe('helixPoint', () => {
  it('θ=0 sits on +x at y=0', () => {
    const p = helixPoint(0, 100, 5)
    expect(p.x).toBeCloseTo(100); expect(p.y).toBeCloseTo(0); expect(p.z).toBeCloseTo(0)
  })
  it('a quarter turn rotates +x → +z (counter-clockwise in xz)', () => {
    const p = helixPoint(TWO_PI / 4, 100, 5)
    expect(p.x).toBeCloseTo(0); expect(p.z).toBeCloseTo(100)
  })
  it('descends by the full pitch over one turn (h = pitch/2π)', () => {
    const pitch = 120, h = pitch / TWO_PI
    const a = helixPoint(0, 100, h)
    const b = helixPoint(TWO_PI, 100, h)
    expect(b.y - a.y).toBeCloseTo(-pitch)
    expect(b.x).toBeCloseTo(a.x); expect(b.z).toBeCloseTo(a.z)   // same angular position
  })
})

describe('buildSpiralGeometry (helix band)', () => {
  const base = { radius: 100, turns: 4, pitch: 60, ribbonHeight: 40 }

  it('emits 2 verts per sample and 6 indices per quad', () => {
    const g = buildSpiralGeometry(base)
    const verts = g.positions.length / 3
    expect(verts % 2).toBe(0)
    expect(g.indices.length).toBe((verts / 2 - 1) * 6)
  })

  it('uv.x runs 0→1 across the whole helix; uv.y spans the band (0 back, 1 front)', () => {
    const g = buildSpiralGeometry(base)
    expect(g.uvs[0]).toBeCloseTo(0)              // first sample, front edge u
    expect(g.uvs[1]).toBeCloseTo(1)              // front edge v
    expect(g.uvs[3]).toBeCloseTo(0)              // back edge v
    expect(g.uvs[g.uvs.length - 4]).toBeCloseTo(1)   // last sample front edge u
    expect(g.uvs[g.uvs.length - 2]).toBeCloseTo(1)   // last sample back edge u
  })

  it('pathLen ≈ total angle × tangent length (√(R²+h²)) for uniform pitch (chord-sum, slightly under)', () => {
    const g = buildSpiralGeometry(base)
    const h = base.pitch / TWO_PI
    const expected = base.turns * TWO_PI * Math.hypot(base.radius, h)
    expect(g.pathLen).toBeGreaterThan(expected * 0.999)   // chord sum underestimates the arc by a hair
    expect(g.pathLen).toBeLessThanOrEqual(expected + 1e-6)
  })

  it('the two band edges are offset ±ribbonHeight/2 around the centerline (vertical-ish width)', () => {
    const g = buildSpiralGeometry(base)
    // first sample: midpoint of the two edge verts is the centerline point at θ=0 = (R, 0, 0)
    const top = [g.positions[0], g.positions[1], g.positions[2]]
    const bot = [g.positions[3], g.positions[4], g.positions[5]]
    const mid = top.map((v, i) => (v + bot![i]!) / 2)
    expect(mid[0]).toBeCloseTo(base.radius); expect(mid[1]!).toBeCloseTo(0); expect(mid[2]!).toBeCloseTo(0)
    // edge separation equals the full ribbon height
    const sep = Math.hypot(top[0]! - bot[0]!, top[1]! - bot[1]!, top[2]! - bot[2]!)
    expect(sep).toBeCloseTo(base.ribbonHeight)
    // width is mostly vertical (edge-wound): the y component dominates
    expect(Math.abs(top[1]! - bot[1]!)).toBeGreaterThan(Math.abs(top[0]! - bot[0]!))
  })

  it('every centerline sample stays on the helix cylinder (radius constant in xz)', () => {
    const g = buildSpiralGeometry(base)
    const n = g.positions.length / 6
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1
      const mx = (g.positions[a * 3]! + g.positions[b * 3]!) / 2
      const mz = (g.positions[a * 3 + 2]! + g.positions[b * 3 + 2]!) / 2
      expect(Math.hypot(mx, mz)).toBeCloseTo(base.radius, 1)
    }
  })

  it('is deterministic for the same params', () => {
    const a = buildSpiralGeometry(base)
    const b = buildSpiralGeometry(base)
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
  })

  it('uniform pitch multipliers (all 1) reproduce the plain helix exactly', () => {
    const plain = buildSpiralGeometry(base)
    const ones = buildSpiralGeometry({ ...base, pitchTop: 1, pitchMid: 1, pitchBottom: 1 })
    expect(Array.from(ones.positions)).toEqual(Array.from(plain.positions))
  })

  it('reverse flips the helix chirality (z mirrored, x and y unchanged)', () => {
    const fwd = buildSpiralGeometry(base)
    const rev = buildSpiralGeometry({ ...base, reverse: true })
    expect(rev.positions.length).toBe(fwd.positions.length)
    for (let i = 0; i < fwd.positions.length; i += 3) {
      expect(rev.positions[i]!).toBeCloseTo(fwd.positions[i]!, 3)        // x same
      expect(rev.positions[i + 1]!).toBeCloseTo(fwd.positions[i + 1]!, 3) // y same
      expect(rev.positions[i + 2]!).toBeCloseTo(-fwd.positions[i + 2]!, 3) // z mirrored
    }
  })

  it('a looser bottom splays the lower coils → greater total vertical extent', () => {
    const yExtent = (g: ReturnType<typeof buildSpiralGeometry>) => {
      let lo = Infinity, hi = -Infinity
      for (let i = 1; i < g.positions.length; i += 3) { lo = Math.min(lo, g.positions[i]!); hi = Math.max(hi, g.positions[i]!) }
      return hi - lo
    }
    const uniform = yExtent(buildSpiralGeometry(base))
    const looserBottom = yExtent(buildSpiralGeometry({ ...base, pitchBottom: 2.2 }))
    expect(looserBottom).toBeGreaterThan(uniform)
  })
})

describe('pitchScaleAt', () => {
  it('hits the top / mid / bottom anchors exactly at u = 0 / 0.5 / 1', () => {
    expect(pitchScaleAt(0, 0.5, 1, 2)).toBeCloseTo(0.5)
    expect(pitchScaleAt(0.5, 0.5, 1, 2)).toBeCloseTo(1)
    expect(pitchScaleAt(1, 0.5, 1, 2)).toBeCloseTo(2)
  })
  it('blends monotonically between anchors', () => {
    // top 0.5 → mid 1 → bottom 2 is increasing, so the profile is non-decreasing across u
    let prev = -Infinity
    for (let u = 0; u <= 1.0001; u += 0.1) {
      const v = pitchScaleAt(u, 0.5, 1, 2)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
  it('all-equal anchors → constant scale everywhere', () => {
    for (const u of [0, 0.2, 0.5, 0.8, 1]) expect(pitchScaleAt(u, 1.3, 1.3, 1.3)).toBeCloseTo(1.3)
  })
})
