// @vitest-environment happy-dom
// SVGLoader needs DOMParser; nothing here needs WebGL.
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { pathToShapes } from '~/lib/scene3d/svgPath'

// happy-dom 20.10.6's CSSStyleDeclaration implements indexed access only for
// camelCase IDL names (`style.fillOpacity`) and returns `undefined` — not the
// spec's `''` — for the dashed CSS names (`style['fill-opacity']`), even
// though its own camelCase getters already default to `''` (verified against
// Chrome, which returns '' for both forms). SVGLoader.parseStyle reads the
// dashed names directly via `node.style[name]` and calls `.startsWith()` on
// the result, so happy-dom's `undefined` throws where a real browser's `''`
// would not. This aliases the handful of dashed names SVGLoader touches to
// their existing camelCase getters, so the REAL SVGLoader parser runs
// unmodified under happy-dom rather than being swapped for a fake one.
const DASHED_STYLE_ALIASES: Record<string, string> = {
  'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule',
  'stroke-opacity': 'strokeOpacity',
  'stroke-width': 'strokeWidth',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-linecap': 'strokeLinecap',
  'stroke-miterlimit': 'strokeMiterlimit',
}
const styleProto = CSSStyleDeclaration.prototype as unknown as Record<string, unknown>
for (const [dashed, camel] of Object.entries(DASHED_STYLE_ALIASES)) {
  if (dashed in styleProto) continue
  Object.defineProperty(styleProto, dashed, {
    configurable: true,
    get(this: Record<string, string>) {
      return this[camel] ?? ''
    },
  })
}

/** Signed shoelace area of a contour. The SIGN is the winding direction, which
 *  is what distinguishes a hole from a solid — see the winding test below. */
function signedArea(path: THREE.Path): number {
  const pts = path.getPoints(24)
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Unsigned area of a shape's outer contour, in path units. */
function area(shape: THREE.Shape): number {
  return Math.abs(signedArea(shape))
}

describe('scene3d svgPath', () => {
  // A 10x10 square with a 4x4 square hole, wound so nonzero treats the inner
  // subpath as a hole.
  const SQUARE_WITH_HOLE =
    'M0 0 L10 0 L10 10 L0 10 Z M3 3 L3 7 L7 7 L7 3 Z'
  // Same 10x10 vertical extent as the plain square, but the right edge is an
  // `A` arc command — what Illustrator and Figma emit for a rounded corner or
  // a circle. SVGLoader turns this into a THREE.EllipseCurve, whose geometry
  // lives in aY/aStartAngle/aClockwise, NOT in v0..v3 control points.
  const SQUARE_WITH_ARC = 'M0 0 L10 0 A5 5 0 0 1 10 10 L0 10 Z'

  it('resolves an inner subpath as a hole, not a second solid', () => {
    const shapes = pathToShapes(SQUARE_WITH_HOLE)
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.holes).toHaveLength(1)
    // 100 minus the 16-unit hole, not 100 and not 116.
    const net = area(shapes[0]!) - area(new THREE.Shape(shapes[0]!.holes[0]!.getPoints(24)))
    expect(net).toBeCloseTo(84, 0)
  })

  it('flips Y: the topmost point of the SVG becomes the MAXIMUM y in scene space', () => {
    // In SVG, y=0 is the TOP. After the flip it must be the largest scene y.
    const shapes = pathToShapes('M0 0 L10 0 L10 10 L0 10 Z')
    const ys = shapes.flatMap((s) => s.getPoints(4).map((p) => p.y))
    // The SVG's y=0 edge is the top; flipped, it is at scene y = 0, and the
    // SVG's y=10 edge (visually lower) is at scene y = -10.
    expect(Math.max(...ys)).toBeCloseTo(0, 5)
    expect(Math.min(...ys)).toBeCloseTo(-10, 5)
  })

  it('winds a hole opposite its outer contour, so it reads as a hole after the flip', () => {
    // The extruder decides hole-vs-solid from winding direction, not nesting.
    // If the flip ever left the two contours wound the SAME way, the hole would
    // extrude as a second solid lid and the letter counter would fill in.
    const shapes = pathToShapes(SQUARE_WITH_HOLE)
    const outer = signedArea(shapes[0]!)
    const hole = signedArea(shapes[0]!.holes[0]!)
    expect(outer).not.toBeCloseTo(0, 3)
    expect(hole).not.toBeCloseTo(0, 3)
    expect(Math.sign(outer)).toBe(-Math.sign(hole))
  })

  it('flips arcs too: an `A` command lands in the same half-space as the lines', () => {
    const shapes = pathToShapes(SQUARE_WITH_ARC)
    // Guard the fixture itself: if SVGLoader ever stopped emitting an
    // EllipseCurve here, the assertions below would pass vacuously and stop
    // covering the arc path at all.
    const curves = shapes.flatMap((s) => s.curves)
    expect(curves.some((c) => c instanceof THREE.EllipseCurve)).toBe(true)
    // Same expectation as the plain square: every point at or below y=0. An
    // arc left unflipped strands its half of the outline at POSITIVE y, tearing
    // the contour into a self-crossing extrusion with no error thrown.
    const ys = shapes.flatMap((s) => s.getPoints(24).map((p) => p.y))
    expect(Math.max(...ys)).toBeCloseTo(0, 5)
    expect(Math.min(...ys)).toBeCloseTo(-10, 5)
  })

  it('returns no shapes for an unparseable d, and does not throw', () => {
    expect(() => pathToShapes('not a path')).not.toThrow()
    expect(pathToShapes('not a path')).toEqual([])
  })

  it('returns no shapes for an empty d', () => {
    expect(pathToShapes('')).toEqual([])
  })

  it('caches: the same d returns shape data equal to a fresh parse', () => {
    const a = pathToShapes(SQUARE_WITH_HOLE)
    const b = pathToShapes(SQUARE_WITH_HOLE)
    expect(area(b[0]!)).toBeCloseTo(area(a[0]!), 5)
  })
})
