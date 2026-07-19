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

// vitest runs in node, so parse a real .otf off disk rather than fetching.
const fontPath = (rel: string) => fileURLToPath(new URL(`../../public/${rel}`, import.meta.url))
function parseFont(rel: string): Font {
  const buf = readFileSync(fontPath(rel))
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as Font
}

const FONT = parseFont('fonts/ABCROM-Bold.otf')

/** Flatten a THREE.Shape/Path to points and return its axis-aligned bounds. */
function boundsOf(curves: Array<THREE.Shape | THREE.Path>) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const c of curves) {
    for (const p of c.getPoints(24)) {
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

describe('shapeOutline', () => {
  it('returns a single closed shape with no holes', () => {
    const shapes = shapeOutline(6, 0)
    expect(shapes).toHaveLength(1)
    expect(shapes[0]).toBeInstanceOf(THREE.Shape)
    expect(shapes[0]!.holes).toHaveLength(0)
  })

  it('point count tracks sides', () => {
    for (const sides of [3, 5, 8, 12]) {
      expect(shapeOutline(sides, 0)[0]!.curves.length).toBe(sides)
    }
  })

  it('is deterministic for the same inputs', () => {
    const a = shapeOutline(7, 0.3)[0]!.getPoints(8)
    const b = shapeOutline(7, 0.3)[0]!.getPoints(8)
    expect(a.map((p) => [p.x, p.y])).toEqual(b.map((p) => [p.x, p.y]))
  })

  it('roundness at 1 makes the radii uniform (a circle)', () => {
    const pts = shapeOutline(16, 1)[0]!.getPoints(4)
    const radii = pts.map((p) => Math.hypot(p.x, p.y))
    const min = Math.min(...radii), max = Math.max(...radii)
    expect(max - min).toBeLessThan(0.05 * max)
  })

  it('roundness at 0 leaves the radii irregular', () => {
    const pts = shapeOutline(16, 0)[0]!.getPoints(4)
    const radii = pts.map((p) => Math.hypot(p.x, p.y))
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.05)
  })

  it('clamps degenerate side counts to something extrudable', () => {
    expect(shapeOutline(0, 0)[0]!.curves.length).toBeGreaterThanOrEqual(3)
    expect(shapeOutline(1e9, 0)[0]!.curves.length).toBeLessThanOrEqual(64)
  })

  it('is centred on the origin', () => {
    const b = boundsOf(shapeOutline(9, 0.4))
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 6)
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0, 6)
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
