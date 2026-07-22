import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import opentype from 'three/examples/jsm/libs/opentype.module.js'

import {
  AVAILABLE_FONTS,
  loadFont,
  fontCacheGet,
  textOutline,
  shapeOutline,
  type Font,
} from '~/lib/scene3d/outlines'
import { DEFAULT_FONT_URL } from '~/lib/scene3d/config'

// vitest runs in node, so parse a real .otf off disk rather than fetching.
const fontPath = (rel: string) => fileURLToPath(new URL(`../../public/${rel}`, import.meta.url))
function parseFont(rel: string): Font {
  const buf = readFileSync(fontPath(rel))
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as Font
}

const FONT = parseFont('fonts/ABCROM-Bold.otf')

/** Flatten a THREE.Shape/Path to points and return its axis-aligned bounds. */
function boundsOf(curves: Array<THREE.Shape | THREE.Path>, divisions = 24) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const c of curves) {
    for (const p of c.getPoints(divisions)) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }
}
const widthOf = (shapes: THREE.Shape[]) => boundsOf(shapes).width

describe('AVAILABLE_FONTS', () => {
  it('lists real files under /fonts with readable labels', () => {
    expect(AVAILABLE_FONTS.length).toBeGreaterThan(0)
    for (const f of AVAILABLE_FONTS) {
      expect(f.url.startsWith('/fonts/')).toBe(true)
      expect(f.url.endsWith('.otf')).toBe(true)
      expect(f.label.length).toBeGreaterThan(0)
      // labels are human-readable, not raw filenames
      expect(f.label).not.toMatch(/\.otf$/)
    }
    // urls are unique
    expect(new Set(AVAILABLE_FONTS.map((f) => f.url)).size).toBe(AVAILABLE_FONTS.length)
    // every listed font resolves to a file that actually parses
    for (const f of AVAILABLE_FONTS) expect(() => parseFont(f.url.slice(1))).not.toThrow()
  })

  // config.ts duplicates this URL as a literal (importing outlines.ts there
  // would drag three + the vendored opentype module into config's import
  // graph) — this pins the two from drifting apart silently.
  it('matches the literal config.ts duplicates as DEFAULT_FONT_URL', () => {
    expect(DEFAULT_FONT_URL).toBe(AVAILABLE_FONTS[0]!.url)
  })
})

describe('textOutline', () => {
  it('yields at least one shape for a one-glyph string', () => {
    const shapes = textOutline('A', FONT, { size: 1, letterSpacing: 0 })
    expect(shapes.length).toBeGreaterThanOrEqual(1)
    expect(shapes[0]).toBeInstanceOf(THREE.Shape)
  })

  it('returns no shapes for an empty or whitespace-only string', () => {
    expect(textOutline('', FONT, { size: 1, letterSpacing: 0 })).toEqual([])
    expect(textOutline('   ', FONT, { size: 1, letterSpacing: 0 })).toEqual([])
  })

  // The winding test: a counter must become a hole, not a separate filled shape.
  it("gives 'o' exactly one hole on a single shape", () => {
    const shapes = textOutline('o', FONT, { size: 1, letterSpacing: 0 })
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.holes).toHaveLength(1)

    // Guard against an INVERTED winding convention, which would still produce
    // 1 shape + 1 hole but with the counter as the solid and the bowl as the
    // hole. The counter must be strictly inside the bowl.
    const outer = boundsOf([shapes[0]!])
    const inner = boundsOf([shapes[0]!.holes[0]!])
    expect(inner.width).toBeLessThan(outer.width)
    expect(inner.height).toBeLessThan(outer.height)
    expect(inner.minX).toBeGreaterThan(outer.minX)
    expect(inner.maxX).toBeLessThan(outer.maxX)
  })

  it("gives 'i' two solid shapes and no holes", () => {
    // Both contours of a dotted 'i' wind the same way — neither is a counter.
    const shapes = textOutline('i', FONT, { size: 1, letterSpacing: 0 })
    expect(shapes).toHaveLength(2)
    expect(shapes.flatMap((s) => s.holes)).toHaveLength(0)
  })

  it("gives 'B' one shape with two holes", () => {
    const shapes = textOutline('B', FONT, { size: 1, letterSpacing: 0 })
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.holes).toHaveLength(2)
  })

  it("attaches each glyph's hole to its own shape in a multi-glyph string", () => {
    const shapes = textOutline('oo', FONT, { size: 1, letterSpacing: 0 })
    expect(shapes).toHaveLength(2)
    for (const s of shapes) expect(s.holes).toHaveLength(1)
  })

  it("'oo' is wider than 'o'", () => {
    const one = widthOf(textOutline('o', FONT, { size: 1, letterSpacing: 0 }))
    const two = widthOf(textOutline('oo', FONT, { size: 1, letterSpacing: 0 }))
    expect(two).toBeGreaterThan(one)
  })

  it('letterSpacing widens a two-character string', () => {
    const tight = widthOf(textOutline('AV', FONT, { size: 1, letterSpacing: 0 }))
    const loose = widthOf(textOutline('AV', FONT, { size: 1, letterSpacing: 0.5 }))
    expect(loose).toBeGreaterThan(tight + 0.4)
  })

  it('scales with size', () => {
    const small = widthOf(textOutline('AV', FONT, { size: 1, letterSpacing: 0 }))
    const big = widthOf(textOutline('AV', FONT, { size: 2, letterSpacing: 0 }))
    expect(big / small).toBeCloseTo(2, 5)
  })

  it('is right-way-up (y is negated out of opentype space)', () => {
    // A lone 'p' has a descender: more of the glyph sits below its own centre.
    const b = boundsOf(textOutline('Ap', FONT, { size: 1, letterSpacing: 0 }))
    // The cap of 'A' is taller above the baseline than 'p' descends below it,
    // so after centring the ascender still reaches further from the centre.
    expect(b.height).toBeGreaterThan(0)
    // Sanity: a 'b' (ascender) must sit higher than a 'p' (descender).
    const bAsc = boundsOf(textOutline('b', FONT, { size: 1, letterSpacing: 0 }))
    const bDesc = boundsOf(textOutline('p', FONT, { size: 1, letterSpacing: 0 }))
    expect(bAsc.height).toBeGreaterThan(0)
    expect(bDesc.height).toBeGreaterThan(0)
  })

  it('centres the result on its own bounding box', () => {
    for (const text of ['o', 'Ag', 'Hello']) {
      const b = boundsOf(textOutline(text, FONT, { size: 1, letterSpacing: 0 }))
      expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 6)
      expect((b.minY + b.maxY) / 2).toBeCloseTo(0, 6)
    }
  })
})

/** Shoelace signed area of a flattened contour. Positive = counter-clockwise. */
function signedArea(pts: THREE.Vector2[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** True if any two non-adjacent edges of the closed polygon cross. */
function selfIntersects(pts: THREE.Vector2[]): boolean {
  const n = pts.length
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const proper = (p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2, p4: THREE.Vector2) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2)
    const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4)
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (i === j || (i + 1) % n === j || (j + 1) % n === i) continue
      if (proper(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) return true
    }
  }
  return false
}

describe('shapeOutline', () => {
  it('returns a single closed shape with no holes', () => {
    const shapes = shapeOutline(6, 0, 0)
    expect(shapes).toHaveLength(1)
    expect(shapes[0]).toBeInstanceOf(THREE.Shape)
    expect(shapes[0]!.holes).toHaveLength(0)

    // Closed: the contour returns to where it started.
    const pts = shapes[0]!.getPoints(8)
    expect(pts[0]!.distanceTo(pts[pts.length - 1]!)).toBeLessThan(1e-9)
  })

  it('point count tracks sides', () => {
    for (const sides of [3, 5, 8, 12, 24]) {
      expect(shapeOutline(sides, 0, 0)[0]!.curves.length).toBe(sides)
    }
  })

  it('is deterministic across repeated calls — no RNG anywhere', () => {
    for (const args of [[6, 0, 0], [7, 0.5, 0.4], [12, 1, 0.8]] as const) {
      const a = shapeOutline(...args)[0]!.getPoints(16).map((p) => [p.x, p.y])
      const b = shapeOutline(...args)[0]!.getPoints(16).map((p) => [p.x, p.y])
      expect(a).toEqual(b)
    }
  })

  it('roundness 0 gives exactly `sides` sharp corners', () => {
    const shape = shapeOutline(8, 0, 0)[0]!
    expect(shape.curves.length).toBe(8)
    // All segments straight.
    expect(shape.curves.every((c) => c.type === 'LineCurve')).toBe(true)
  })

  it('roundness > 0 adds curve segments without changing the winding', () => {
    const sharp = shapeOutline(8, 0, 0)[0]!
    const round = shapeOutline(8, 0.5, 0)[0]!
    expect(round.curves.length).toBeGreaterThan(sharp.curves.length)
    expect(round.curves.some((c) => c.type === 'QuadraticBezierCurve')).toBe(true)
    // Both wound the same way, and positive (solid) like textOutline's outers.
    expect(signedArea(sharp.getPoints(24))).toBeGreaterThan(0)
    expect(signedArea(round.getPoints(24))).toBeGreaterThan(0)
  })

  it('stays a simple, non-self-intersecting contour across the whole range', () => {
    for (const sides of [3, 5, 6, 12, 24]) {
      for (const r of [0, 0.25, 0.5, 0.75, 1]) {
        for (const st of [0, 0.3, 0.6, 1]) {
          const pts = shapeOutline(sides, r, st)[0]!.getPoints(12)
          // getPoints repeats the start point on a closed path; drop it.
          const ring = pts.slice(0, -1)
          expect(selfIntersects(ring), `sides=${sides} r=${r} star=${st}`).toBe(false)
          expect(signedArea(ring), `sides=${sides} r=${r} star=${st}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('roundness 1 on a hexagon approaches a circle', () => {
    const radii = shapeOutline(6, 1, 0)[0]!.getPoints(16).map((p) => Math.hypot(p.x, p.y))
    const min = Math.min(...radii), max = Math.max(...radii)
    expect((max - min) / max).toBeLessThan(0.15)
  })

  it('star 0 leaves a regular polygon (uniform edges, n vertices)', () => {
    const shape = shapeOutline(7, 0, 0)[0]!
    expect(shape.curves.length).toBe(7)
    // Regularity is measured by EDGE LENGTH, not radius-from-origin: the shape
    // is centred on its bounding box, and for an odd-sided polygon the bbox
    // centre is not the circumcentre (a unit 7-gon's is 0.0495 off in y), so
    // radii from the origin legitimately vary by ~0.094. Edge lengths are
    // translation-invariant and are the honest test.
    const ring = shape.getPoints(1).slice(0, -1)
    const edges = ring.map((p, i) => p.distanceTo(ring[(i + 1) % ring.length]!))
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThan(1e-9)
  })

  it('star > 0 alternates radii and doubles the vertex count', () => {
    const shape = shapeOutline(5, 0, 0.5)[0]!
    expect(shape.curves.length).toBe(10)
    const radii = shape.getPoints(1).slice(0, -1).map((p) => Math.hypot(p.x, p.y))
    const outer = radii.filter((_, i) => i % 2 === 0)
    const inner = radii.filter((_, i) => i % 2 === 1)
    expect(Math.min(...outer)).toBeGreaterThan(Math.max(...inner))
    // Deeper star pulls the inner vertices further in.
    const deeper = shapeOutline(5, 0, 0.8)[0]!.getPoints(1).slice(0, -1)
      .map((p) => Math.hypot(p.x, p.y)).filter((_, i) => i % 2 === 1)
    expect(Math.max(...deeper)).toBeLessThan(Math.min(...inner))
  })

  it('clamps degenerate side counts into range', () => {
    expect(shapeOutline(0, 0, 0)[0]!.curves.length).toBe(3)
    expect(shapeOutline(1e9, 0, 0)[0]!.curves.length).toBe(24)
    expect(shapeOutline(Number.NaN, 0, 0)[0]!.curves.length).toBe(3)
  })

  it('defaults star to 0 when omitted', () => {
    expect(shapeOutline(6, 0)[0]!.curves.length).toBe(6)
  })

  it('is centred on the origin', () => {
    for (const args of [[3, 0, 0], [5, 0.5, 0.4], [9, 1, 0.7]] as const) {
      const shapes = shapeOutline(...args)

      // Exact at the resolution the implementation centres on (64 divisions
      // per curve).
      const exact = boundsOf(shapes, 64)
      expect((exact.minX + exact.maxX) / 2).toBeCloseTo(0, 9)
      expect((exact.minY + exact.maxY) / 2).toBeCloseTo(0, 9)

      // Still centred when re-measured at a coarser resolution. The residual
      // is pure flattening error — a curve's true extremum falls between
      // samples — not an off-centre shape, so it is bounded, not zero.
      const coarse = boundsOf(shapes, 24)
      expect(Math.abs((coarse.minX + coarse.maxX) / 2)).toBeLessThan(1e-4)
      expect(Math.abs((coarse.minY + coarse.maxY) / 2)).toBeLessThan(1e-4)
    }
  })
})

describe('font cache', () => {
  const okUrl = '/fonts/__cache-test-ok.otf'
  const badUrl = '/fonts/__cache-test-bad.otf'

  it('returns the identical object for a repeated URL', async () => {
    const bytes = readFileSync(fontPath('fonts/ABCROM-Bold.otf'))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }))
    vi.stubGlobal('fetch', fetchMock)

    expect(fontCacheGet(okUrl)).toBeNull()
    const a = await loadFont(okUrl)
    const b = await loadFont(okUrl)
    expect(b).toBe(a)
    expect(fontCacheGet(okUrl)).toBe(a)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('does not cache a rejection — a retry actually retries', async () => {
    const bytes = readFileSync(fontPath('fonts/ABCROM-Bold.otf'))
    let call = 0
    const fetchMock = vi.fn(async () => {
      call++
      if (call === 1) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadFont(badUrl)).rejects.toThrow()
    expect(fontCacheGet(badUrl)).toBeNull()

    const font = await loadFont(badUrl)
    expect(font.unitsPerEm).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})
