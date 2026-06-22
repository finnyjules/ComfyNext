import * as THREE from 'three'
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js'
// Thick-line stroke (LineBasicMaterial width is hardwired to 1px on WebGL; these render
// world-unit-width lines as instanced quads).
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { ombreSideTexture } from '../fills'
// Typeface fonts ship with three and import synchronously (no runtime TTF parsing).
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json'
import optimerBold from 'three/examples/fonts/optimer_bold.typeface.json'
import gentilisBold from 'three/examples/fonts/gentilis_bold.typeface.json'

/**
 * BOOST — extruded 3D type, inspired by spacetypegenerator.com/boost.
 *
 * Each letter is built from its glyph outline as: front + back CAPS (triangulated shape)
 * plus per-segment SIDE WALLS, each wall a separately-coloured quad (STG's per-edge candy
 * sides). Optional glyph STROKE outlines the contours + depth edges. Geometry is unit-depth
 * centred on z; depth/animation just scale the per-letter group's z (so depth is live).
 *
 * MODES: `static` = fixed manual depth + fixed tilt; `tumble` = per-letter random rotation +
 * depth grow-in/hold/retract over the loop (easeInOutExpo); `zoom` = depth in/out, no rotation.
 */

const FONT_JSON: Record<string, unknown> = {
  'Helvetiker Bold': helvetikerBold,
  'Optimer Bold': optimerBold,
  'Gentilis Bold': gentilisBold,
}
const FONT_NAMES = Object.keys(FONT_JSON)
const _fontLoader = new FontLoader()
const _fontCache = new Map<string, Font>()
function getFont(name: string): Font {
  const key = FONT_JSON[name] ? name : FONT_NAMES[0]!
  let f = _fontCache.get(key)
  if (!f) { f = _fontLoader.parse(FONT_JSON[key] as Parameters<FontLoader['parse']>[0]); _fontCache.set(key, f) }
  return f
}

// ── Font outlines. The bundled typefaces are the reliable fallback; the chosen Google font
//    is loaded at runtime via fontkit (parses woff2) from the CORS-friendly fontsource CDN.
//    Everything degrades gracefully: any failure ⇒ the bundled fallback, never a hard error.
interface BoostFont {
  shapes(ch: string, size: number): THREE.Shape[]
  advance(ch: string, size: number): number
}
function bundledFont(): BoostFont {
  const f = getFont(FONT_NAMES[0]!)
  return { shapes: (ch, size) => f.generateShapes(ch, size), advance: (ch, size) => advance(f, ch, size) }
}
const _boostFontCache = new Map<string, BoostFont>()
/** Synchronous lookup used by buildScene — returns the loaded font or the bundled fallback. */
function getBoostFont(family: string): BoostFont {
  return _boostFontCache.get(family) ?? bundledFont()
}
/** Preload + cache a Google font's outlines (call + await before rebuild). Never throws. */
export async function ensureBoostFont(family: string): Promise<void> {
  if (_boostFontCache.has(family)) return
  try {
    _boostFontCache.set(family, await loadFontkitFont(family))
    if (typeof console !== 'undefined') console.info('[boost] loaded outline for', family)
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[boost] outline load failed → bundled fallback for', family, e)
    _boostFontCache.set(family, bundledFont())   // cache the fallback so we don't retry endlessly
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadFontkitFont(family: string): Promise<BoostFont> {
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  // Probe candidate weights in PARALLEL, then pick the best available (heaviest first
  // for the bold extrude look). Sequential probing cost a single-weight font FOUR 404
  // round-trips before the 400 hit — measured at 3–6s, which read as "the font never
  // changed" (boost shows the fallback until the real outline finally lands).
  const weights = [800, 700, 900, 600, 500, 400]
  const fetched = await Promise.all(weights.map(w =>
    fetch(`https://cdn.jsdelivr.net/npm/@fontsource/${slug}/files/${slug}-latin-${w}-normal.woff2`)
      .then(r => (r.ok ? r.arrayBuffer().then(buf => ({ w, buf })) : null))
      .catch(() => null),
  ))
  let buf: ArrayBuffer | null = null
  for (const w of weights) { const f = fetched.find(x => x && x.w === w); if (f) { buf = f.buf; break } }
  if (!buf) throw new Error(`no fontsource file for "${family}"`)
  const fontkitUrl = 'https://esm.sh/fontkit@2'   // variable ⇒ TS treats the import as dynamic
  const mod: any = await import(/* @vite-ignore */ fontkitUrl)
  const fontkit: any = mod.default ?? mod
  const fk: any = fontkit.create(new Uint8Array(buf))
  const upm: number = fk.unitsPerEm || 1000
  const glyphOf = (ch: string) => fk.glyphForCodePoint(ch.codePointAt(0) ?? 32)
  return {
    advance: (ch, size) => { const g = glyphOf(ch); return (g?.advanceWidth ?? upm * 0.5) / upm * size },
    shapes: (ch, size) => {
      const g = glyphOf(ch)
      if (!g?.path?.commands?.length) return []
      const sc = size / upm
      const sp = new THREE.ShapePath()
      for (const c of g.path.commands as { command: string; args: number[] }[]) {
        const a = c.args
        if (c.command === 'moveTo') sp.moveTo(a[0]! * sc, a[1]! * sc)
        else if (c.command === 'lineTo') sp.lineTo(a[0]! * sc, a[1]! * sc)
        else if (c.command === 'quadraticCurveTo') sp.quadraticCurveTo(a[0]! * sc, a[1]! * sc, a[2]! * sc, a[3]! * sc)
        else if (c.command === 'bezierCurveTo') sp.bezierCurveTo(a[0]! * sc, a[1]! * sc, a[2]! * sc, a[3]! * sc, a[4]! * sc, a[5]! * sc)
      }
      // isCCW=false: TrueType solids are CW; flip to true if glyph counters (O/A/D) fill in.
      return sp.toShapes(false)
    },
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'A\nSAD\nWILD\nTHING', group: 'Type' },
  // Full Google picker; the outline is loaded via fontkit (bold weight), falling back to a
  // bundled typeface if the font can't be fetched/parsed.
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type', hint: 'typeface of the letters' },
  { key: 'typeSize', label: 'Type size', kind: 'slider', min: 0.5, max: 6, step: 0.1, default: 2.6, group: 'Type', hint: 'higher = larger text' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -0.5, max: 1.5, step: 0.02, default: 0, group: 'Type', hint: 'higher = wider letter spacing; lower = tighter' },
  { key: 'leading', label: 'Line spacing', kind: 'slider', min: 0.6, max: 2.5, step: 0.05, default: 1.1, group: 'Type', hint: 'higher = more space between lines' },
  { key: 'align', label: 'Align', kind: 'select', options: ['center', 'left', 'right'], default: 'center', group: 'Type', hint: 'align text within the frame' },
  // Extrude.
  { key: 'depth', label: 'Extrude depth', kind: 'slider', min: 0, max: 6, step: 0.05, default: 1.2, group: 'Ribbon', hint: 'higher = thicker/heavier 3D extrusion; lower = flatter' },
  // Direction the body leans (oblique extrude): angle picks the screen direction, lean is how
  // far it shears per unit depth. Lean 0 = straight back (unchanged). Distinct from Perspective,
  // which CONVERGES the body to a point — this is a PARALLEL lean. Both are live (no rebuild).
  { key: 'extrudeAngle', label: 'Direction', kind: 'slider', min: 0, max: 360, step: 1, default: 0, group: 'Ribbon', hint: 'direction the extrusion leans (0–360°)' },
  { key: 'extrudeLean', label: 'Lean', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0, group: 'Ribbon', hint: 'higher = more pronounced lean angle on the extrusion' },
  // key is 'extrudePerspective' (not 'perspective') so it's NOT in the surface's live-param
  // exclusion list — this taper is baked into geometry and must trigger a rebuild on change.
  { key: 'extrudePerspective', label: 'Perspective', kind: 'slider', min: 0, max: 100, step: 1, default: 0, group: 'Ribbon', hint: 'higher = more dramatic perspective convergence to a point; lower = parallel sides' },
  { key: 'convergeX', label: 'Center X', kind: 'slider', min: -1, max: 1, step: 0.02, default: 0, group: 'Ribbon', hint: 'horizontal position of the vanishing point' },
  { key: 'convergeY', label: 'Center Y', kind: 'slider', min: -1, max: 1, step: 0.02, default: 0, group: 'Ribbon', hint: 'vertical position of the vanishing point' },
  { key: 'centerGlow', label: 'Center glow', kind: 'slider', min: 0, max: 100, step: 1, default: 0, group: 'Ribbon', hint: 'higher = sides fade to center color near the vanishing point' },
  { key: 'arc', label: 'Arc', kind: 'slider', min: -1, max: 1, step: 0.02, default: 0, group: 'Ribbon', hint: 'higher = text wraps upward around the vanishing point; lower = downward' },
  { key: 'curveRes', label: 'Curve detail', kind: 'slider', min: 1, max: 12, step: 1, default: 5, group: 'Ribbon', hint: 'higher = smoother curved outlines; lower = more angular' },
  { key: 'extrudeMode', label: 'Mode', kind: 'select', options: ['static', 'tumble', 'zoom', 'punch'], default: 'static', group: 'Ribbon', hint: 'animation style of the 3D letters' },
  { key: 'tumble', label: 'Tumble', kind: 'slider', min: 0, max: 2, step: 0.05, default: 0.6, group: 'Ribbon', hint: 'higher = stronger rotating tumble effect (in tumble/punch/zoom modes)' },
  // Letters tilt up/down (around X) onto cube faces. Alternate = even up / odd down (the
  // iso-cube weave); off = every letter tilts the same way.
  { key: 'cubeFlip', label: 'Cube flip', kind: 'slider', min: 0, max: 90, step: 1, default: 0, group: 'Ribbon', hint: 'higher = letters tilt more onto cube-like faces' },
  { key: 'cubeAlternate', label: 'Alternate flip', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Ribbon', hint: 'on = alternating letters flip up/down for iso-cube weave; off = all tilt the same' },
  { key: 'punchDistance', label: 'Punch distance', kind: 'slider', min: 0, max: 8, step: 0.1, default: 3, group: 'Ribbon', hint: 'higher = letters blast farther outward (in punch mode)' },
  { key: 'holdFraction', label: 'Hold fraction', kind: 'slider', min: 0, max: 0.9, step: 0.05, default: 0.35, group: 'Motion', hint: 'higher = animation holds at peak longer before retracting' },
  // Transform — defaults give a 3/4 tilt so the extrude reads without touching anything.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform', hint: 'higher = larger overall scene; lower = smaller' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0.34, group: 'Transform', hint: 'rotate the entire scene around the X axis' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.5, group: 'Transform', hint: 'rotate the entire scene around the Y axis' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform', hint: 'rotate the entire scene around the Z axis' },
  // Colour.
  { key: 'faceColor', label: 'Face', kind: 'color', default: '#ffffff', group: 'Color', hint: 'color of the front face of the letters' },
  { key: 'centerColor', label: 'Center color', kind: 'color', default: '#ffffff', group: 'Color', hint: 'color sides fade to near the vanishing point when center glow is active' },
  { key: 'sideMode', label: 'Sides', kind: 'select', options: ['palette', 'gradient', 'ombre', 'rainbow', 'grid', 'noise', 'solid', 'mixed', 'custom'], default: 'palette', group: 'Color', hint: 'how the extrusion sides are colored' },
  // `custom` ⇒ assign a style per letter from this list (cycles if shorter than the text).
  // Tokens are separated by spaces/commas, e.g. "rainbow grid noise solid".
  { key: 'letterStyles', label: 'Per-letter styles', kind: 'text', default: 'rainbow, grid, noise, solid', group: 'Color' },
  { key: 'depthBands', label: 'Side bands', kind: 'slider', min: 2, max: 16, step: 1, default: 8, group: 'Color', hint: 'higher = more color bands along the extrusion depth; lower = fewer bands' },
  { key: 'sideColor', label: 'Side (solid)', kind: 'color', default: '#f26666', group: 'Color', hint: 'color of the sides in solid mode' },
  // Grid style: cell fill + line colour. Noise style: the two ends the grain lerps between.
  { key: 'gridCell', label: 'Grid cell', kind: 'color', default: '#ffffff', group: 'Color', hint: 'cell fill color of the grid pattern on sides' },
  { key: 'gridLine', label: 'Grid line', kind: 'color', default: '#111111', group: 'Color', hint: 'line color of the grid pattern on sides' },
  { key: 'noiseColor1', label: 'Noise dark', kind: 'color', default: '#000000', group: 'Color', hint: 'dark end of the noise grain on sides' },
  { key: 'noiseColor2', label: 'Noise light', kind: 'color', default: '#ffffff', group: 'Color', hint: 'light end of the noise grain on sides' },
  { key: 'paletteCount', label: 'Palette colors', kind: 'slider', min: 1, max: 5, step: 1, default: 5, group: 'Color', hint: 'how many palette colors to use (1–5)' },
  { key: 'boostColor1', label: 'Color 1', kind: 'color', default: '#ffffff', group: 'Color', hint: 'first palette color used on sides' },
  { key: 'boostColor2', label: 'Color 2', kind: 'color', default: '#4e7cd9', group: 'Color', hint: 'second palette color used on sides' },
  { key: 'boostColor3', label: 'Color 3', kind: 'color', default: '#02733e', group: 'Color', hint: 'third palette color used on sides' },
  { key: 'boostColor4', label: 'Color 4', kind: 'color', default: '#f23030', group: 'Color', hint: 'fourth palette color used on sides' },
  { key: 'boostColor5', label: 'Color 5', kind: 'color', default: '#f26666', group: 'Color', hint: 'fifth palette color used on sides' },
  // Stroke (glyph outline along the extrude).
  { key: 'stroke', label: 'Stroke', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Color', hint: 'toggle outline stroke along the letter edges' },
  { key: 'strokeColor', label: 'Stroke color', kind: 'color', default: '#000000', group: 'Color', hint: 'color of the stroke outline' },
  { key: 'strokeWidth', label: 'Stroke weight', kind: 'slider', min: 0.005, max: 0.3, step: 0.005, default: 0.03, group: 'Color', hint: 'higher = thicker stroke; lower = thinner' },
  { key: 'shadows', label: 'Shading', kind: 'select', options: ['flat', 'lit'], default: 'lit', group: 'Shadow', hint: 'flat = no shading; lit = directional lighting with shadows' },
]

interface BoostLetter {
  group: THREE.Group
  baseX: number; baseY: number       // layout position (group origin)
  rx: number; ry: number; rz: number // tumble base rotation
  bx: number; by: number             // unit blast direction from scene centre (punch)
}
interface BoostState {
  letters: BoostLetter[]
}
let state: BoostState | null = null

// Reused per-frame scratch for the oblique-lean matrix (T·R·Shear·S) so we don't
// allocate a Matrix4 per letter per frame.
const _m = new THREE.Matrix4()
const _mShear = new THREE.Matrix4()
const _mScale = new THREE.Matrix4()
const _mRot = new THREE.Matrix4()
const _euler = new THREE.Euler()

function n(p: Params, k: string): number { return Number(p[k]) }

/** Deterministic [0,1) from an integer (stable across rebuilds, unlike Math.random). */
function hash01(i: number): number {
  const s = Math.sin((i + 1) * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

function easeInOutExpo(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2
}

/** Multi-stop lerp across the palette at t∈[0,1] (gradient sides). */
function lerpPalette(palette: THREE.Color[], t: number): THREE.Color {
  if (palette.length === 1) return palette[0]!.clone()
  const x = Math.min(1, Math.max(0, t)) * (palette.length - 1)
  const i0 = Math.floor(x)
  const i1 = Math.min(i0 + 1, palette.length - 1)
  return palette[i0]!.clone().lerp(palette[i1]!, x - i0)
}

// Procedural side textures (built once, reused). grid = white cell + dark border (tiles into a
// wireframe grid); noise = grayscale static. Both multiply the per-segment vertex colour.
// Procedural side textures are colour-driven and cached per (colour) combo — distinct colours
// build distinct textures, but a repeated combo reuses one (no per-rebuild churn). The texture
// carries the FULL colour, so the side material's vertex colour is white (identity multiply).
const _gridCache = new Map<string, THREE.Texture>()
const _noiseCache = new Map<string, THREE.Texture>()
function gridTexture(three: typeof THREE, cell: string, line: string): THREE.Texture {
  const key = `${cell}|${line}`
  const hit = _gridCache.get(key); if (hit) return hit
  const c = document.createElement('canvas'); c.width = 64; c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = cell; ctx.fillRect(0, 0, 64, 64)
  ctx.strokeStyle = line; ctx.lineWidth = 6
  ctx.strokeRect(0, 0, 64, 64)
  const t = new three.CanvasTexture(c); t.wrapS = t.wrapT = three.RepeatWrapping; t.anisotropy = 4
  _gridCache.set(key, t); return t
}
function noiseTexture(three: typeof THREE, darkHex: string, lightHex: string): THREE.Texture {
  const key = `${darkHex}|${lightHex}`
  const hit = _noiseCache.get(key); if (hit) return hit
  const dark = new three.Color(darkHex), light = new three.Color(lightHex)
  // Lower-res grain (chunkier texels) so it survives minification on the steep side walls
  // instead of averaging out to a flat mid-tone.
  const N = 64
  const c = document.createElement('canvas'); c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  for (let i = 0; i < img.data.length; i += 4) {
    // Hard threshold → near-binary grain (only a thin grey transition band), so the two chosen
    // colours read as distinct speckle rather than blending to grey.
    const raw = hash01(i * 0.123)
    const f = raw < 0.5 ? 0 : 1
    img.data[i] = (dark.r + (light.r - dark.r) * f) * 255
    img.data[i + 1] = (dark.g + (light.g - dark.g) * f) * 255
    img.data[i + 2] = (dark.b + (light.b - dark.b) * f) * 255
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const t = new three.CanvasTexture(c)
  t.wrapS = t.wrapT = three.RepeatWrapping
  // No mipmaps + nearest sampling: keeps the grain crisp black/white at grazing angles rather
  // than trilinear-averaging it into grey.
  t.generateMipmaps = false
  t.minFilter = three.NearestFilter
  t.magFilter = three.NearestFilter
  _noiseCache.set(key, t); return t
}

function advance(font: Font, ch: string, size: number): number {
  const data = font.data as unknown as { glyphs: Record<string, { ha?: number }>; resolution: number }
  const g = data.glyphs[ch] ?? data.glyphs['?']
  const ha = g?.ha ?? data.resolution * 0.5
  return (ha / data.resolution) * size
}

/**
 * Build one letter's geometry: front+back CAPS (group 0, faceColor) plus SIDE WALLS (group 1)
 * around every contour. Sides are split into `zSub` bands along the depth, each band coloured
 * by `sideColorAt(seg, t)` (t = 0 front → 1 back) — that's how gradient/rainbow sides ramp down
 * the extrude. UVs (u = arc length, v = depth) let grid/noise textures map onto the walls.
 */
function buildLetterGeo(
  three: typeof THREE,
  shapes: THREE.Shape[],
  faceColor: THREE.Color,
  sideColorAt: (seg: number, t: number) => THREE.Color,
  zSub: number,
  curveRes: number,
  centerColor: THREE.Color,
  centerGlow: number,
  depthV = false,
): { geo: THREE.BufferGeometry; strokePts: number[] } {
  const fr = -0.5, bk = 0.5
  const capPos: number[] = [], capCol: number[] = []
  const sidePos: number[] = [], sideCol: number[] = [], sideUV: number[] = []

  // Caps: triangulate the shapes (holes handled), duplicate front + back. The face is flat,
  // so it stays high-res regardless of Curve detail — only the side walls get simplified.
  const capGeo = new three.ShapeGeometry(shapes, 12).toNonIndexed()
  const cp = capGeo.attributes.position as THREE.BufferAttribute
  for (const z of [fr, bk]) {
    for (let i = 0; i < cp.count; i++) {
      capPos.push(cp.getX(i), cp.getY(i), z)
      capCol.push(faceColor.r, faceColor.g, faceColor.b)
    }
  }
  capGeo.dispose()

  // Side walls: per contour segment, split into zSub bands; each band a quad coloured by t.
  const TILE = 0.28   // world units per texture cell (grid/noise tiling)
  const strokePts: number[] = []
  let seg = 0
  const pushSideTri = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number, c: THREE.Color,
  ) => {
    sidePos.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    sideCol.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b)
    sideUV.push(au, av, bu, bv, cu, cv)
  }
  for (const shape of shapes) {
    const pts = shape.extractPoints(curveRes)
    const contours: THREE.Vector2[][] = [pts.shape, ...pts.holes]
    for (const contour of contours) {
      const nP = contour.length
      let arc = 0
      for (let i = 0; i < nP; i++) {
        const a = contour[i]!, b = contour[(i + 1) % nP]!
        const segLen = Math.hypot(b.x - a.x, b.y - a.y)
        const u0 = arc / TILE, u1 = (arc + segLen) / TILE
        for (let j = 0; j < zSub; j++) {
          const t0 = j / zSub, t1 = (j + 1) / zSub
          const z0 = fr + (bk - fr) * t0, z1 = fr + (bk - fr) * t1
          // ombre maps V across the full 0→1 depth (one fade); grid/noise tile V by TILE.
          const v0 = depthV ? t0 : t0 / TILE, v1 = depthV ? t1 : t1 / TILE
          // t=0 is the far/centre end (converges to the convergence point) → fade toward centerColor.
          const tt = (j + 0.5) / zSub
          const c0 = sideColorAt(seg, tt)
          const c = centerGlow > 0 ? c0.clone().lerp(centerColor, centerGlow * Math.pow(1 - tt, 1.5)) : c0
          pushSideTri(a.x, a.y, z0, u0, v0, a.x, a.y, z1, u0, v1, b.x, b.y, z0, u1, v0, c)
          pushSideTri(b.x, b.y, z0, u1, v0, a.x, a.y, z1, u0, v1, b.x, b.y, z1, u1, v1, c)
        }
        strokePts.push(a.x, a.y, fr, b.x, b.y, fr, a.x, a.y, bk, b.x, b.y, bk, a.x, a.y, fr, a.x, a.y, bk)
        arc += segLen
        seg++
      }
    }
  }

  const pos = capPos.concat(sidePos)
  const col = capCol.concat(sideCol)
  const uv = new Array(capPos.length / 3 * 2).fill(0).concat(sideUV)
  const capVerts = capPos.length / 3
  const sideVerts = sidePos.length / 3
  const geo = new three.BufferGeometry()
  geo.setAttribute('position', new three.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new three.Float32BufferAttribute(col, 3))
  geo.setAttribute('uv', new three.Float32BufferAttribute(uv, 2))
  geo.addGroup(0, capVerts, 0)        // caps → material 0
  geo.addGroup(capVerts, sideVerts, 1) // sides → material 1
  geo.computeVertexNormals()
  return { geo, strokePts }
}

export const boostEffect: SpaceTypeEffect = {
  id: 'boost',          // internal id kept as 'boost' so saved nodes/configs still resolve
  label: 'Extrude',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    const root = new three.Group()
    state = null

    const font = getBoostFont(String(params.font))
    const curveRes = Math.max(1, Math.floor(n(params, 'curveRes')))
    const size = n(params, 'typeSize')
    const tracking = n(params, 'tracking') * size
    const leading = n(params, 'leading') * size
    const align = String(params.align)
    // Perspective taper: rake the far end of each glyph's extrude toward a SHARED convergence point
    // so the walls all meet there (0 = parallel prism). vx/vy move that point; centerGlow fades the
    // walls toward centerColor as they near it; arc bends each line into a curve. Baked into geometry.
    const persp = Math.min(0.92, Math.max(0, n(params, 'extrudePerspective') / 100))
    const vx = n(params, 'convergeX') * 6, vy = n(params, 'convergeY') * 6   // convergence point (world)
    const centerGlow = Math.min(1, Math.max(0, n(params, 'centerGlow') / 100))
    const centerColor = new three.Color(String(params.centerColor))
    const arcAmt = n(params, 'arc')

    const lines = String(params.text ?? '').split('\n')
    const usable = lines.length ? lines : ['']

    const paletteCount = Math.max(1, Math.min(5, Math.floor(n(params, 'paletteCount'))))
    const palette = [
      params.boostColor1, params.boostColor2, params.boostColor3, params.boostColor4, params.boostColor5,
    ].slice(0, paletteCount).map(c => new three.Color(String(c)))
    const faceColor = new three.Color(String(params.faceColor))
    const sideSolid = new three.Color(String(params.sideColor))
    const sideMode = String(params.sideMode)
    const depthBands = Math.max(2, Math.floor(n(params, 'depthBands')))
    const gridCell = String(params.gridCell), gridLine = String(params.gridLine)
    const noiseDark = String(params.noiseColor1), noiseLight = String(params.noiseColor2)
    const WHITE = new three.Color(0xffffff)
    // Resolve a side style → its geometry/colour recipe. `mixed` gives each letter a random
    // style (by index); `custom` reads an explicit per-letter list. The catalog below is what
    // both pick from. grid/noise carry their colour in the TEXTURE, so the vertex colour is
    // white (identity multiply) for those.
    const STYLES = ['palette', 'gradient', 'ombre', 'rainbow', 'grid', 'noise', 'solid'] as const
    const resolveSide = (style: string, letterIdx: number) => {
      const zSub = (style === 'gradient' || style === 'rainbow' || style === 'ombre') ? depthBands : 1
      const ombreB = paletteCount > 1 ? palette[1]! : sideSolid   // grainy fade colours
      const mapped = style === 'grid' ? gridTexture(three, gridCell, gridLine)
        : style === 'noise' ? noiseTexture(three, noiseDark, noiseLight)
        // ombre = a 256px DITHER texture (fine pointillist grain) along the depth — NOT per-band
        // vertex cells (those read as blocky QR squares at low band counts).
        : style === 'ombre' ? ombreSideTexture(three, '#' + palette[0]!.getHexString(), '#' + ombreB.getHexString())
        : null
      const sideColorAt = (seg: number, t: number): THREE.Color => {
        // grid / noise / ombre carry colour in the texture → white identity multiply.
        if (style === 'grid' || style === 'noise' || style === 'ombre') return WHITE
        if (style === 'solid') return sideSolid
        if (style === 'gradient') return lerpPalette(palette, t)
        if (style === 'rainbow') return new three.Color().setHSL(t * 0.85, 0.95, 0.55)
        return palette[Math.floor(hash01(letterIdx * 97 + seg * 13) * paletteCount) % paletteCount]!
      }
      return { zSub, sideMap: mapped, sideColorAt, depthV: style === 'ombre' }
    }
    // Parse the per-letter list once: lowercase tokens, keep only known styles (cycled per letter).
    const KNOWN = new Set(STYLES as readonly string[])
    const customStyles = String(params.letterStyles ?? '')
      .split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(s => KNOWN.has(s))
    const pickStyle = (letterIdx: number): string => {
      if (sideMode === 'mixed') return STYLES[Math.floor(hash01(letterIdx * 31) * STYLES.length) % STYLES.length]!
      if (sideMode === 'custom') return customStyles.length ? customStyles[letterIdx % customStyles.length]! : 'palette'
      return sideMode
    }
    const lit = String(params.shadows) === 'lit'
    const MatClass = lit ? three.MeshLambertMaterial : three.MeshBasicMaterial
    const strokeOn = String(params.stroke) === 'on'
    const strokeColor = new three.Color(String(params.strokeColor))
    const strokeWidth = Math.max(0.002, n(params, 'strokeWidth'))

    const blockH = (usable.length - 1) * leading
    const letters: BoostLetter[] = []
    let li = 0

    usable.forEach((line, p) => {
      const chars = Array.from(line)
      let lineW = 0
      for (let m = 0; m < chars.length; m++) lineW += font.advance(chars[m]!, size) + (m > 0 ? tracking : 0)
      let cursor = align === 'center' ? -lineW / 2 : align === 'right' ? -lineW : 0
      const y = blockH / 2 - p * leading

      for (let m = 0; m < chars.length; m++) {
        const ch = chars[m]!
        const adv = font.advance(ch, size)
        if (ch.trim() !== '') {
          const shapes = font.shapes(ch, size)
          if (shapes.length) {
            const letterIdx = li
            const { zSub, sideMap, sideColorAt, depthV } = resolveSide(pickStyle(letterIdx), letterIdx)
            const { geo, strokePts } = buildLetterGeo(three, shapes, faceColor, sideColorAt, zSub, curveRes, centerColor, centerGlow, depthV)

            geo.computeBoundingBox()
            const bb = geo.boundingBox!
            const cx = (bb.min.x + bb.max.x) / 2
            const cy = (bb.min.y + bb.max.y) / 2
            geo.translate(-cx, -cy, 0)   // pivot at glyph centre (so rotation tumbles in place)
            let baseX = cursor + cx, baseY = y + cy   // glyph centre in the (origin-centred) layout

            // Arc: bend each line into a curve around the convergence point. A glyph swings on a
            // circle whose radius is its distance from the centre line and rotates to stay tangent
            // (top line bows ∩, bottom ∪, so the lines wrap the point). Rotation baked into the geo.
            if (Math.abs(arcAmt) > 1e-3) {
              const fx = baseX - vx, fy = baseY - vy
              const kc = Math.abs(arcAmt) * 0.14
              if (Math.abs(fy) > 1e-3) {
                const R = 1 / kc, psi = fx / R
                const dip = Math.sign(arcAmt) * -Math.sign(fy)   // curve toward (arc>0) / away (arc<0) from centre
                baseX = vx + R * Math.sin(psi)
                baseY = baseY + dip * R * (1 - Math.cos(psi))
                const arcRot = psi * dip
                geo.rotateZ(arcRot)
                for (let q = 0; q < strokePts.length; q += 3) {
                  const rx = strokePts[q]! - cx, ry = strokePts[q + 1]! - cy
                  strokePts[q] = cx + rx * Math.cos(arcRot) - ry * Math.sin(arcRot)
                  strokePts[q + 1] = cy + rx * Math.sin(arcRot) + ry * Math.cos(arcRot)
                }
              }
            }

            // Perspective taper: rake the BACK of every glyph's extrude toward the SHARED scene
            // centre (0,0) as a function of depth (z), so ALL the extrusions converge to one point
            // in the middle (the deeper the perspective, the harder they rake in). 0 = parallel
            // prism. Recompute normals for shading.
            if (persp > 0.001) {
              const pa = geo.attributes.position as THREE.BufferAttribute
              for (let vi = 0; vi < pa.count; vi++) {
                const k = persp * (0.5 - pa.getZ(vi))            // 0 at the near cap (+0.5) → persp at the far cap (−0.5)
                pa.setX(vi, pa.getX(vi) * (1 - k) + (vx - baseX) * k)   // local → world (vx,vy) as k→1
                pa.setY(vi, pa.getY(vi) * (1 - k) + (vy - baseY) * k)
              }
              pa.needsUpdate = true
              geo.computeVertexNormals()
              // Stroke outline converges to the same point (its coords are uncentred glyph space).
              for (let q = 0; q < strokePts.length; q += 3) {
                const k = persp * (0.5 - strokePts[q + 2]!)
                strokePts[q] = (baseX - cx + strokePts[q]!) * (1 - k) + vx * k - (baseX - cx)
                strokePts[q + 1] = (baseY - cy + strokePts[q + 1]!) * (1 - k) + vy * k - (baseY - cy)
              }
            }

            // Caps (material 0) = faceColor via vertex colour; sides (material 1) = vertex colour
            // (× grid/noise texture when chosen). DoubleSide so thin walls read from both sides.
            const capMat = new MatClass({ vertexColors: true, side: three.DoubleSide })
            const sideMat = new MatClass({ vertexColors: true, side: three.DoubleSide, map: sideMap ?? undefined })
            const mesh = new three.Mesh(geo, [capMat, sideMat])

            const grp = new three.Group()
            grp.add(mesh)
            if (strokeOn && strokePts.length) {
              // World-unit thick line (linewidth honoured; worldUnits keeps it resolution-stable).
              const sgeo = new LineSegmentsGeometry()
              sgeo.setPositions(strokePts)
              const line = new LineSegments2(sgeo, new LineMaterial({
                color: strokeColor.getHex(), linewidth: strokeWidth, worldUnits: true,
              }))
              line.position.set(-cx, -cy, 0)   // match the mesh geo's centring translate
              grp.add(line)
            }
            grp.position.set(baseX, baseY, 0)
            root.add(grp)
            // Blast direction = radial from scene centre; centred letters fall back to a hash angle.
            const mag = Math.hypot(baseX, baseY)
            const ang = mag > 1e-3 ? Math.atan2(baseY, baseX) : hash01(letterIdx * 17) * Math.PI * 2
            letters.push({
              group: grp,
              baseX, baseY,
              rx: (hash01(letterIdx * 3) - 0.5) * (Math.PI / 4),
              ry: (hash01(letterIdx * 5) - 0.5) * (Math.PI / 3),
              rz: (hash01(letterIdx * 11) - 0.5) * (Math.PI / 3),
              bx: Math.cos(ang), by: Math.sin(ang),
            })
            li++
          }
        }
        cursor += adv + tracking
      }
    })

    if (lit) {
      const key = new three.DirectionalLight(0xffffff, 1.6)
      key.position.set(6, 10, 14)
      root.add(key)
      const fill = new three.DirectionalLight(0xffffff, 0.5)
      fill.position.set(-8, -4, 6)
      root.add(fill)
      root.add(new three.AmbientLight(0xffffff, 0.5))
    }

    state = { letters }
    boostEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const depth = n(params, 'depth')
    const mode = String(params.extrudeMode)
    const tumble = n(params, 'tumble')
    const punchDist = n(params, 'punchDistance')
    const hold = Math.min(0.9, Math.max(0, n(params, 'holdFraction')))

    // Animation envelope a∈[0,1]: grow-in (easeInOutExpo) → hold → retract. Static = held at 1.
    let a = 1
    if (mode !== 'static') {
      const inOut = (1 - hold) / 2
      if (t01 < inOut) a = easeInOutExpo(t01 / Math.max(1e-4, inOut))
      else if (t01 < inOut + hold) a = 1
      else a = 1 - easeInOutExpo((t01 - inOut - hold) / Math.max(1e-4, inOut))
    }

    const cubeFlip = (n(params, 'cubeFlip') * Math.PI) / 180   // up/down tilt onto cube faces (radians)
    const alternate = String(params.cubeAlternate) !== 'off'

    // Oblique lean: shear the extruded body toward a screen direction (face stays put).
    // Keyed on the SCALED local z, so the lean grows with depth and vanishes at depth 0.
    const lean = n(params, 'extrudeLean') || 0
    const angle = (n(params, 'extrudeAngle') || 0) * Math.PI / 180
    const useShear = lean > 1e-4
    const shearX = Math.cos(angle) * lean
    const shearY = Math.sin(angle) * lean

    for (let i = 0; i < s.letters.length; i++) {
      const L = s.letters[i]!
      // Alternate: even up / odd down (opposite cube faces). Off: every letter tilts the same.
      const flipX = (alternate ? (i % 2 === 0 ? 1 : -1) : 1) * cubeFlip
      const scaleZ = Math.max(0.0001, depth * a)
      let scaleXY = 1, posX = L.baseX, posY = L.baseY
      let rotX = 0, rotY = 0, rotZ = 0

      if (mode === 'tumble') {
        rotX = L.rx * tumble * a + flipX; rotY = L.ry * tumble * a; rotZ = L.rz * tumble * a
      } else if (mode === 'zoom') {
        scaleXY = 0.3 + 0.7 * a; rotX = flipX
      } else if (mode === 'punch') {
        const blast = punchDist * a
        posX = L.baseX + L.bx * blast; posY = L.baseY + L.by * blast
        rotX = L.rx * tumble * a + flipX; rotY = L.ry * tumble * a; rotZ = L.rz * tumble * a
      } else {
        // static: fixed extrude + fixed tumble tilt + cube flip (no time animation).
        rotX = L.rx * tumble + flipX; rotY = L.ry * tumble; rotZ = L.rz * tumble
      }

      if (useShear) {
        // group.matrix = T · R · Shear · S. Shear maps scaled z into x/y (e8,e9) and the
        // translation columns (e12,e13) anchor the camera-facing (+z) cap so the readable
        // face stays put and ONLY the body trails toward the lean direction (no face skew).
        _mScale.makeScale(scaleXY, scaleXY, scaleZ)
        _mShear.identity()
        _mShear.elements[8] = -shearX; _mShear.elements[9] = -shearY
        _mShear.elements[12] = 0.5 * shearX * scaleZ; _mShear.elements[13] = 0.5 * shearY * scaleZ
        _euler.set(rotX, rotY, rotZ); _mRot.makeRotationFromEuler(_euler)
        _m.makeTranslation(posX, posY, 0)
        _m.multiply(_mRot).multiply(_mShear).multiply(_mScale)
        L.group.matrixAutoUpdate = false
        L.group.matrix.copy(_m)
        L.group.matrixWorldNeedsUpdate = true
      } else {
        if (!L.group.matrixAutoUpdate) L.group.matrixAutoUpdate = true
        L.group.scale.set(scaleXY, scaleXY, scaleZ)
        L.group.position.set(posX, posY, 0)
        L.group.rotation.set(rotX, rotY, rotZ)
      }
    }
  },
}
