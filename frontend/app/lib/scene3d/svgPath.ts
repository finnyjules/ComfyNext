// frontend/app/lib/scene3d/svgPath.ts
// Turns a stored SVG path `d` into the THREE.Shape[] the extruder wants.
//
// The stored `d` is a FAITHFUL SVG path — transforms baked, but still in SVG
// convention where Y points DOWN. The flip to scene space happens HERE, in one
// place, for two reasons: the stored string stays debuggable and re-exportable,
// and this module needs only DOMParser (no WebGL), so the flip is unit-testable.
// A missed flip renders plausibly on a symmetric logo and upside-down on
// everything else, which is exactly the kind of bug that ships.
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'

const loader = new SVGLoader()
const cache = new Map<string, THREE.Shape[]>()
/** Bounded so a long editing session can't grow this without limit; imports are
 *  small and repeated, so a modest cap keeps every live object's path resident. */
const CACHE_MAX = 256

/** Parse one `d` into shapes, Y-flipped into scene space. Returns [] on anything
 *  unparseable rather than throwing — a bad path must degrade to "no geometry",
 *  which the caller renders as the placeholder, not to a broken studio.
 *
 *  `fillRule` decides how nested subpaths resolve. It is NOT inferable from `d`
 *  — an inner contour wound the same way as its outer one is a hole under
 *  `evenodd` and a solid under `nonzero` — so the source SVG's rule has to be
 *  passed in. Absent means 'nonzero', matching both the SVG default and
 *  SVGLoader's own fallback for a missing attribute.
 *
 *  The returned array and its shapes are CACHED and handed out BY REFERENCE:
 *  treat them as read-only. Mutating a returned Shape (or its holes) corrupts
 *  every later consumer of the same `d`, including other objects on the canvas.
 *  Clone first if you need to transform one. */
export function pathToShapes(d: string, fillRule: 'nonzero' | 'evenodd' = 'nonzero'): THREE.Shape[] {
  if (!d) return []
  // The rule is part of the KEY, not just the parse: the same `d` under the two
  // rules is two different geometries, so keying on `d` alone would hand a
  // holed shape to a nonzero object (or a filled blob to an evenodd one)
  // depending only on which happened to be built first.
  const key = `${fillRule}|${d}`
  const hit = cache.get(key)
  if (hit) return hit
  let shapes: THREE.Shape[] = []
  try {
    // The flip lives in a `<g transform="scale(1,-1)">` wrapper rather than a
    // hand-rolled matrix walk over the parsed curves, because SVGLoader itself
    // owns transforming EVERY curve type it can emit. A hand-rolled walk over
    // v0..v3 silently misses THREE.EllipseCurve — what `A`/`a` arc commands and
    // circles become — whose geometry is aX/aY/radii/angles/aClockwise instead.
    // That left arcs unflipped while lines and béziers moved, tearing routine
    // Illustrator and Figma output into self-crossing extrusions with no error.
    // Node transforms are also the code path every real-world SVG exercises,
    // mirroring (negative determinant) included.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g transform="scale(1,-1)"><path fill-rule="${fillRule}" d="${d.replace(/"/g, "'")}"/></g></svg>`
    const parsed = loader.parse(svg)
    // createShapes runs on already-flipped curves. Scaling Y by -1 reverses
    // winding for outer contours and holes alike, so their relative direction —
    // the only thing hole detection reads — is preserved.
    shapes = parsed.paths.flatMap((p) => SVGLoader.createShapes(p))
  } catch {
    shapes = []
  }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, shapes)
  return shapes
}
