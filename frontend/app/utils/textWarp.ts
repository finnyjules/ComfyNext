/**
 * textWarp — pure geometry for the Text Mask widget's 3D text transforms.
 * (Originally written for the Font Playground, retired 2026-07-27.)
 *
 * One source of truth for both the live preview and the baked PNG:
 *  - the preview applies `cssTransform()` (the browser does the projection), and
 *  - the bake reproduces the *same* matrix with `composeMatrix()` + `projectPoint()`,
 *    so what you see is what gets rasterised.
 *
 * The matrix order mirrors CSS exactly — `perspective() rotateX() rotateY()
 * rotateZ() skewX() skewY()` — and the perspective distance scales with the
 * target's width (`depthToDistance`) so the small preview and the 2× bake
 * foreshorten by the same proportion.
 *
 * No Vue, no DOM: just numbers, so it can be reasoned about (and reused) alone.
 */

export interface Transform3D {
  rotate: number   // deg, in-plane Z rotation
  skewX: number    // deg, horizontal shear
  skewY: number    // deg, vertical shear
  tiltX: number    // deg, rotateX — top/bottom edge recedes (perspective)
  tiltY: number    // deg, rotateY — left/right edge recedes (perspective)
  depth: number    // 0..100, perspective strength (0 = flat, 100 = dramatic)
}

export const IDENTITY_TRANSFORM: Transform3D = {
  rotate: 0, skewX: 0, skewY: 0, tiltX: 0, tiltY: 0, depth: 40,
}

export type Mat4 = number[]  // length 16, row-major: index = row*4 + col

const rad = (d: number) => (d * Math.PI) / 180

/** True when the transform leaves the text untouched (skip all warp work). */
export function isIdentity(t: Transform3D): boolean {
  return !t.rotate && !t.skewX && !t.skewY && !t.tiltX && !t.tiltY
}

/** True when a 3D tilt is active — the only case needing the perspective mesh warp. */
export function hasTilt(t: Transform3D): boolean {
  return !!t.tiltX || !!t.tiltY
}

// ---- 4×4 matrix builders (row-major; point is a column vector, out = M·v) ----

function mul(a: Mat4, b: Mat4): Mat4 {
  const c = new Array(16).fill(0)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++)
        c[i * 4 + j] += a[i * 4 + k]! * b[k * 4 + j]!
  return c
}

const rotX = (a: number): Mat4 => {
  const c = Math.cos(rad(a)), s = Math.sin(rad(a))
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
}
const rotY = (a: number): Mat4 => {
  const c = Math.cos(rad(a)), s = Math.sin(rad(a))
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}
const rotZ = (a: number): Mat4 => {
  const c = Math.cos(rad(a)), s = Math.sin(rad(a))
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
const shearX = (a: number): Mat4 => [1, Math.tan(rad(a)), 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const shearY = (a: number): Mat4 => [1, 0, 0, 0, Math.tan(rad(a)), 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const persp = (d: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1 / d, 1]

/**
 * Perspective viewer distance in px. Scales with the box width so the preview
 * and the (larger) bake foreshorten identically. depth 0 → ~flat, 100 → strong.
 */
export function depthToDistance(depth: number, widthPx: number): number {
  const t = Math.min(100, Math.max(0, depth)) / 100
  const mult = 6 - (6 - 0.8) * t          // 6× width (subtle) → 0.8× width (dramatic)
  return Math.max(1, mult * Math.max(1, widthPx))
}

/** The full 4×4, matching CSS `perspective rotateX rotateY rotateZ skewX skewY`. */
export function composeMatrix(t: Transform3D, widthPx: number): Mat4 {
  const d = depthToDistance(t.depth, widthPx)
  let m = persp(d)
  m = mul(m, rotX(t.tiltX))
  m = mul(m, rotY(t.tiltY))
  m = mul(m, rotZ(t.rotate))
  m = mul(m, shearX(t.skewX))
  m = mul(m, shearY(t.skewY))
  return m
}

/** Project a 2D point (z=0) through the matrix, with perspective divide. */
export function projectPoint(m: Mat4, x: number, y: number): [number, number] {
  const ox = m[0]! * x + m[1]! * y + m[3]!
  const oy = m[4]! * x + m[5]! * y + m[7]!
  const ow = m[12]! * x + m[13]! * y + m[15]!
  const w = Math.abs(ow) < 1e-6 ? 1e-6 : ow
  return [ox / w, oy / w]
}

/** 2×3 affine [a,b,c,d,e,f] for the no-tilt path (ctx.setTransform args). */
export function affineFromMatrix(m: Mat4): [number, number, number, number, number, number] {
  // x' = m0·x + m1·y + m3 ; y' = m4·x + m5·y + m7  → setTransform(a,b,c,d,e,f)
  return [m[0]!, m[4]!, m[1]!, m[5]!, m[3]!, m[7]!]
}

/**
 * Project the four corners of a w×h box (about its centre) and return the
 * axis-aligned bounds of the result. Callers size the output canvas to this
 * and translate by (-minX, -minY) so the warped quad sits at the origin.
 */
export function transformedBounds(m: Mat4, w: number, h: number) {
  const hw = w / 2, hh = h / 2
  const pts = [
    projectPoint(m, -hw, -hh),
    projectPoint(m, hw, -hh),
    projectPoint(m, hw, hh),
    projectPoint(m, -hw, hh),
  ]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** CSS transform string for the live preview (browser does the projection). */
export function cssTransform(t: Transform3D, widthPx: number): string {
  if (isIdentity(t)) return 'none'
  const d = depthToDistance(t.depth, widthPx)
  return [
    hasTilt(t) ? `perspective(${d.toFixed(1)}px)` : '',
    `rotateX(${t.tiltX}deg)`,
    `rotateY(${t.tiltY}deg)`,
    `rotateZ(${t.rotate}deg)`,
    `skewX(${t.skewX}deg)`,
    `skewY(${t.skewY}deg)`,
  ].filter(Boolean).join(' ')
}
