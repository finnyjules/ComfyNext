const TAU = Math.PI * 2

export interface RibbonGeoParams {
  segments: number
  length: number
  amplitude: number
  frequency: number
  height: number
  uRepeat: number
  phase: number
  slope?: number
  // Optional second wave on the DEPTH (Z) axis — undulates the ribbon toward/away from camera.
  // Quarter-phase offset from the Y wave so enabling both gives a 3D corkscrew. 0 amp = off.
  zAmplitude?: number
  zFrequency?: number
}

export interface RibbonGeoData {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

// STG sinEngine wave shaping: slope=1 → pure sine, slope>1 → squarer wave.
export function shapedSin(raw: number, slope: number): number {
  if (slope === 1) return raw
  const sign = raw >= 0 ? 1 : -1
  return sign * (1 - Math.pow(1 - Math.abs(raw), slope))
}

/** Centerline point at t in [0,1]. Y wave is the in-plane snake; optional Z wave undulates the
 *  centerline in depth (band 'across' is world Z, so a Z wave shifts the whole band fore/aft). */
export function snakePoint(t: number, p: RibbonGeoParams): { x: number; y: number; z: number } {
  const raw = Math.sin(TAU * p.frequency * t + p.phase)
  const y = p.amplitude * shapedSin(raw, p.slope ?? 1)
  const zAmp = p.zAmplitude ?? 0
  const zRaw = Math.sin(TAU * (p.zFrequency ?? p.frequency) * t + p.phase + Math.PI / 2)
  const z = zAmp === 0 ? 0 : zAmp * shapedSin(zRaw, p.slope ?? 1)
  return { x: (t - 0.5) * p.length, y, z }
}

/** Swept band: 2 verts per sample, band width along world Z. */
export function buildRibbonGeometryData(p: RibbonGeoParams): RibbonGeoData {
  const n = Math.max(1, Math.floor(p.segments))
  const verts = (n + 1) * 2
  const positions = new Float32Array(verts * 3)
  const uvs = new Float32Array(verts * 2)
  const half = p.height / 2
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const c = snakePoint(t, p)
    const a = i * 2, b = i * 2 + 1
    positions[a * 3] = c.x; positions[a * 3 + 1] = c.y; positions[a * 3 + 2] = c.z + half
    positions[b * 3] = c.x; positions[b * 3 + 1] = c.y; positions[b * 3 + 2] = c.z - half
    const u = t * p.uRepeat
    uvs[a * 2] = u; uvs[a * 2 + 1] = 1
    uvs[b * 2] = u; uvs[b * 2 + 1] = 0
  }
  const indices = new Uint32Array(n * 6)
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
    const o = i * 6
    indices[o] = a; indices[o + 1] = b; indices[o + 2] = c
    indices[o + 3] = c; indices[o + 4] = b; indices[o + 5] = d
  }
  return { positions, uvs, indices }
}

export interface RibbonInstanceParams { count: number; spacing: number; offset: number; alternate: boolean }
export interface RibbonInstance { y: number; phase: number; dir: 1 | -1 }

/** Per-ribbon transform: centered Y stack, phase offset, alternating direction. */
export function ribbonInstance(i: number, p: RibbonInstanceParams): RibbonInstance {
  const n = Math.max(1, Math.floor(p.count))
  const center = (n - 1) / 2
  const dir: 1 | -1 = p.alternate && i % 2 === 1 ? -1 : 1
  return { y: (i - center) * p.spacing, phase: i * p.offset * TAU, dir }
}

/** Which text (atlas row) band `i` of `count` shows, over `numTexts` texts — ordered so the FIRST
 *  text lands on the TOP band. The vertically-stacked multi-text effects (ribbon, stripes, cylinder)
 *  put band i=0 at the BOTTOM (see ribbonInstance: y = (i−center)·spacing), so we count from the top:
 *  band count−1 (top) → text 0, reading first→last going down. Field applies the same convention in
 *  its shader (flipping the row term). */
export function textVariantForBand(i: number, count: number, numTexts: number): number {
  const n = Math.max(1, Math.floor(numTexts))
  return (((count - 1 - i) % n) + n) % n
}

/** Whole number of texture tiles scrolled per loop — quantized so the loop is seamless. */
export function loopTiles(speed: number, uRepeat: number): number {
  return Math.max(0, Math.round(speed * uRepeat))
}

/** Text scroll offset (texture-repeat units) at normalized loop time t01.
 *  Seamless: offset(1) - offset(0) = loopTiles, an integer ⇒ identical wrap. */
export function scrollOffset(t01: number, speed: number, uRepeat: number): number {
  return t01 * loopTiles(speed, uRepeat)
}
