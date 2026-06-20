export type EdgeOrient = 'h' | 'v'

export interface EdgeSpec {
  /** 'h' = horizontal strip (top/bottom), 'v' = vertical strip (left/right). */
  orient: EdgeOrient
  /** Strip length along its reading direction (world units). */
  length: number
  /** Strip centre position (world units). */
  posX: number
  posY: number
  /** Z-rotation so the strip's local +x follows the CLOCKWISE perimeter direction (text circulates). */
  rotZ: number
}

const HALF_PI = Math.PI / 2

/**
 * The four independent edge strips of one rectangular text frame (half-extents halfW × halfH, band
 * thickness `t`). Built as a MITERED picture frame so the corners are fully covered with no gap and
 * no double-overlap: the top/bottom strips run the FULL width plus half a band each side (into the
 * corners), and the left/right strips are INSET by half a band top & bottom so they butt cleanly
 * against the horizontal strips. Orientations make each strip's local +x point CLOCKWISE around the
 * perimeter (top→right→bottom→left), so a single positive scroll circulates the text: top reads
 * L→R, right reads downward, bottom is inverted R→L, left reads upward. Pure.
 */
export function frameEdgeSpecs(halfW: number, halfH: number, t = 0): EdgeSpec[] {
  const a = Math.max(0.01, halfW), b = Math.max(0.01, halfH)
  const th = Math.max(0, t)
  const hLen = 2 * a + th                       // top/bottom span the full width + into both corners
  const vLen = Math.max(0.01, 2 * b - th)       // left/right fit BETWEEN the horizontal strips
  return [
    { orient: 'h', length: hLen, posX: 0, posY: b, rotZ: 0 },         // top    (+x)
    { orient: 'v', length: vLen, posX: a, posY: 0, rotZ: -HALF_PI },  // right  (−y, downward)
    { orient: 'h', length: hLen, posX: 0, posY: -b, rotZ: Math.PI },  // bottom (−x, inverted)
    { orient: 'v', length: vLen, posX: -a, posY: 0, rotZ: HALF_PI },  // left   (+y, upward)
  ]
}
