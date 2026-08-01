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
 *  which the caller renders as the placeholder, not to a broken studio. */
export function pathToShapes(d: string): THREE.Shape[] {
  if (!d) return []
  const hit = cache.get(d)
  if (hit) return hit
  let shapes: THREE.Shape[] = []
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d.replace(/"/g, "'")}"/></svg>`
    const parsed = loader.parse(svg)
    shapes = parsed.paths.flatMap((p) => SVGLoader.createShapes(p))
    // SVG Y-down -> three Y-up. Scaling by -1 on Y also reverses winding, which
    // is what keeps holes reading as holes after the flip.
    const flip = new THREE.Matrix3().scale(1, -1)
    for (const s of shapes) {
      applyMatrix3(s, flip)
      for (const h of s.holes) applyMatrix3(h, flip)
    }
  } catch {
    shapes = []
  }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(d, shapes)
  return shapes
}

/** THREE.Path has no transform of its own — walk the curves and move their
 *  control points. Covers the curve types SVGLoader emits from a `d`. */
function applyMatrix3(path: THREE.Path, m: THREE.Matrix3): void {
  const v = new THREE.Vector2()
  const move = (p: THREE.Vector2 | undefined) => {
    if (!p) return
    v.set(p.x, p.y).applyMatrix3(m)
    p.set(v.x, v.y)
  }
  for (const c of path.curves) {
    const anyC = c as unknown as Record<string, THREE.Vector2 | undefined>
    move(anyC.v0); move(anyC.v1); move(anyC.v2); move(anyC.v3)
  }
}
