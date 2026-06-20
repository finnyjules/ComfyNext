import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import type { Fill, FillType } from '../fills'
import { parseFills, fillShaderTexture, fillTiling, SRGB_TO_LINEAR_GLSL } from '../fills'
import { resolveFontFamily } from '~/data/google-fonts'
import { buildStreamerGeometry, buildRowLengths, serpentineVariedPoint, minimalRowPeriod } from '../streamerLayout'

/**
 * STREAMER — an open serpentine ribbon: long straight rows joined by 180° half-circle arcs,
 * descending (boustrophedon), inspired by spacetypegenerator.com/ribbon. The band is one continuous
 * swept mesh with a consistent FRONT face (a fixed multi-stop gradient along the path + the text in
 * the text colour) and a BACK face (a solid B-side colour, no text). The text FLOWS along the
 * ribbon over time (it travels along the path, not a texture sliding over a static shape), looping
 * seamlessly. Geometry + gradient math are pure + unit-tested (../streamerLayout).
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'THE UNIVERSE AS A WHOLE IS PERFECT. THE CHAOS IS ON THE SURFACE. DEEP DOWN, NATURE IS PEACEFUL. ', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'IBM Plex Mono', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 0, max: 100, step: 1, default: 50, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 100, step: 1, default: 40, group: 'Type' },
  { key: 'textGap', label: 'Text spacing', kind: 'slider', min: 0, max: 30, step: 1, default: 4, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 6, step: 0.5, default: 0, group: 'Type' },
  // Ribbon
  { key: 'straightLength', label: 'Straight length', kind: 'slider', min: 80, max: 1400, step: 10, default: 572, group: 'Ribbon' },
  { key: 'lengthJitter', label: 'Length jitter', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Ribbon' },
  { key: 'lengthSeed', label: 'Jitter seed', kind: 'slider', min: 1, max: 999, step: 1, default: 1, group: 'Ribbon' },
  { key: 'arcRadius', label: 'Turn radius', kind: 'slider', min: 12, max: 320, step: 2, default: 70, group: 'Ribbon' },
  { key: 'segmentSpace', label: 'Segment space', kind: 'slider', min: 6, max: 60, step: 1, default: 26, group: 'Ribbon' },
  { key: 'rows', label: 'Rows', kind: 'slider', min: 1, max: 8, step: 1, default: 3, group: 'Ribbon' },
  { key: 'count', label: 'Streamers', kind: 'slider', min: 1, max: 5, step: 1, default: 1, group: 'Ribbon' },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 8, max: 120, step: 1, default: 44, group: 'Ribbon' },
  // Color — front face
  { key: 'frontMode', label: 'Front mode', kind: 'select', options: ['solid', 'gradient', 'grid', 'noise'], default: 'gradient', group: 'Color' },
  { key: 'fills', label: 'Front colors', kind: 'fillList', default: JSON.stringify([
      { type: 'solid', a: '#3B2BFF', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#E01B6A', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#FF7A1A', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#FFE600', b: '#000', textColor: '#fff' },
    ]), group: 'Color' },
  { key: 'textColor', label: 'Text color', kind: 'color', default: '#111111', group: 'Color' },
  { key: 'noStripes', label: 'Text only', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Color' },
  // Color — back face
  { key: 'backMode', label: 'Back mode', kind: 'select', options: ['solid', 'gradient', 'grid', 'noise'], default: 'solid', group: 'Color' },
  { key: 'backColorA', label: 'Back color', kind: 'color', default: '#111111', group: 'Color' },
  { key: 'backColorB', label: 'Back color 2', kind: 'color', default: '#444444', group: 'Color' },
  { key: 'backDensity', label: 'Back density', kind: 'slider', min: 1, max: 32, step: 1, default: 8, group: 'Color' },
  // Stroke (border along the band's long edges, per face)
  { key: 'strokeWidth', label: 'Edge stroke', kind: 'slider', min: 0, max: 0.45, step: 0.01, default: 0, group: 'Stroke' },
  { key: 'frontStrokeColor', label: 'Front edge', kind: 'color', default: '#000000', group: 'Stroke' },
  { key: 'backStrokeColor', label: 'Back edge', kind: 'color', default: '#000000', group: 'Stroke' },
  // Motion
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 100, step: 1, default: 12, group: 'Motion' },
  // Transform (consumed by the engine)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.01, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: -1.07, group: 'Transform' },
  { key: 'rotateY', label: 'Rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: -0.2, group: 'Transform' },
]

const VERT = [
  'varying vec2 vUv;',
  'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
].join('\n')

// Shared FACE shader (front + back). The fill is either a gradient PINNED to the ribbon's physical
// ends (uGradMode=1 → sampled at vUv.x so one end is always the first stop, no matter how the shape
// flows) or a tiled pattern (solid/grid/noise, uGradMode=0 → sampled at vUv·uTile, sRGB-decoded).
// The front face (uHasText=1) overlays text that FLOWS along the ribbon (vUv.x·uTextRepeat+uScroll)
// so the letters travel with the moving streamer while the colour stays anchored. An optional edge
// stroke paints a border along the band's two long edges (per-face colour).
const FACE_FRAG = [
  'precision highp float;',
  'uniform sampler2D uFace; uniform float uGradMode; uniform vec2 uTile;',
  'uniform sampler2D uText; uniform float uHasText; uniform vec3 uTextColor; uniform float uScroll; uniform float uTextRepeat; uniform float uNoStripes;',
  'uniform float uStroke; uniform vec3 uStrokeColor;',
  'varying vec2 vUv;',
  SRGB_TO_LINEAR_GLSL,
  'void main(){',
  '  float edge = min(vUv.y, 1.0 - vUv.y);',
  '  if (uStroke > 0.0 && edge < uStroke) { gl_FragColor = vec4(uStrokeColor, 1.0); return; }',
  '  vec3 base = (uGradMode > 0.5) ? texture2D(uFace, vec2(vUv.x, 0.5)).rgb : stLin(texture2D(uFace, vUv * uTile).rgb);',
  '  if (uHasText > 0.5) {',
  '    float a = texture2D(uText, vec2(vUv.x * uTextRepeat + uScroll, vUv.y)).a;',
  '    if (uNoStripes > 0.5) { if (a < 0.02) discard; gl_FragColor = vec4(uTextColor, 1.0); return; }',
  '    gl_FragColor = vec4(mix(base, uTextColor, a), 1.0); return;',
  '  }',
  '  gl_FragColor = vec4(base, 1.0);',
  '}',
].join('\n')

function n(p: Params, k: string): number { return Number(p[k]) }
function gradientStops(p: Params): string[] {
  const cols = parseFills(p.fills).map(f => f.a)
  return cols.length ? cols : ['#ffffff']
}
function streamerText(p: Params): string {
  const t = String(p.text ?? '').replace(/\n+/g, ' ')
  return t.length ? t : ' '
}

/** Fixed multi-stop gradient along the path (1px tall). */
function buildGradientTexture(three: typeof THREE, stops: string[]): THREE.CanvasTexture {
  const W = 1024
  const c = document.createElement('canvas'); c.width = W; c.height = 1
  const ctx = c.getContext('2d')!
  if (stops.length === 1) { ctx.fillStyle = stops[0]!; ctx.fillRect(0, 0, W, 1) }
  else {
    const g = ctx.createLinearGradient(0, 0, W, 0)
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s))
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 1)
  }
  const t = new three.CanvasTexture(c)
  t.minFilter = three.LinearFilter; t.magFilter = three.LinearFilter
  // mirrored repeat so the gradient flows seamlessly when scrolled (no hard last→first colour jump)
  t.wrapS = three.MirroredRepeatWrapping
  return t
}

type FaceMode = 'solid' | 'gradient' | 'grid' | 'noise'

/** Resolve a face's paint: a length-pinned gradient ramp (gradMode 1), or a tiled solid/grid/noise
 *  pattern (gradMode 0). `aspect` = band length / width, so patterned cells stay roughly square. */
function faceTexture(three: typeof THREE, mode: FaceMode, stops: string[], fill: { a: string; b: string; density: number }, aspect: number): { tex: THREE.Texture; gradMode: number; tile: [number, number] } {
  if (mode === 'gradient') return { tex: buildGradientTexture(three, stops), gradMode: 1, tile: [1, 1] }
  const f: Fill = { type: mode as FillType, a: fill.a, b: fill.b, textColor: '#fff', angle: 45, density: Math.max(1, Math.round(fill.density)) }
  const tex = fillShaderTexture(three, f)
  if (mode === 'solid') return { tex, gradMode: 0, tile: [1, 1] }
  const base = fillTiling(f)                       // 1 grid, 3 noise
  return { tex, gradMode: 0, tile: [base * Math.max(1, aspect), base] }
}

interface FaceOpts {
  side: THREE.Side; faceTex: THREE.Texture; gradMode: number; tile: [number, number]
  textTex: THREE.Texture; hasText: number; textColor: string; textRepeat: number; noStripes: number
  stroke: number; strokeColor: string
}
function makeFaceMaterial(three: typeof THREE, o: FaceOpts): THREE.ShaderMaterial {
  return new three.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FACE_FRAG, side: o.side,
    uniforms: {
      uFace: { value: o.faceTex },
      uGradMode: { value: o.gradMode },
      uTile: { value: new three.Vector2(o.tile[0], o.tile[1]) },
      uText: { value: o.textTex },
      uHasText: { value: o.hasText },
      uTextColor: { value: new three.Color(o.textColor) },
      uScroll: { value: 0 },
      uTextRepeat: { value: o.textRepeat },
      uNoStripes: { value: o.noStripes },
      uStroke: { value: o.stroke },
      uStrokeColor: { value: new three.Color(o.strokeColor) },
    },
  })
}

/** One glyph cells per character of the string + trailing gap. */
function textUnitCells(p: Params): number {
  return streamerText(p).length + Math.max(0, Math.round(n(p, 'textGap')))
}

/** Text matte: exactly ONE string-unit (string + trailing gap) rendered white on transparent. The
 *  shader tiles it with RepeatWrapping, so the matte repeats seamlessly with no partial-copy seam
 *  (the canvas is the whole repeat unit), and it realigns cleanly at the motion loop. */
function buildTextTexture(three: typeof THREE, p: Params): THREE.CanvasTexture {
  const family = resolveFontFamily(String(p.font))
  // Append blank cells so each repetition of the string is separated by a visible gap.
  const txt = streamerText(p) + ' '.repeat(Math.max(0, Math.round(n(p, 'textGap'))))
  const CELL = 64
  const R = Math.max(1, txt.length)
  const W = R * CELL
  const c = document.createElement('canvas'); c.width = W; c.height = CELL
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, W, CELL)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const stroke = n(p, 'typeStroke')
  const px = CELL * (0.45 + (n(p, 'typeHeight') / 100) * 0.4)
  ctx.font = `${px}px "${family}", "IBM Plex Mono", monospace`
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round'
  for (let col = 0; col < R; col++) {
    const ch = txt[col]!
    const cx = col * CELL + CELL / 2, cy = CELL / 2
    if (stroke > 0) { ctx.lineWidth = stroke * 1.5; ctx.strokeText(ch, cx, cy) } else { ctx.fillText(ch, cx, cy) }
  }
  const t = new three.CanvasTexture(c)
  t.minFilter = three.LinearFilter; t.magFilter = three.LinearFilter
  t.wrapS = three.RepeatWrapping; t.wrapT = three.ClampToEdgeWrapping
  return t
}

// One serpentine ribbon. Each has its own mutable position buffer + front material (so it can flow
// at its own motion phase), but shares the immutable uv/index data and the gradient texture.
interface Instance {
  posAttr: THREE.BufferAttribute
  positions: Float32Array
  front: THREE.ShaderMaterial
  phase: number        // constant arc-length offset → staggered motion + distinct visible text
}
interface State {
  three: typeof THREE
  textTex: THREE.CanvasTexture
  cells: number
  samples: number      // path samples (N+1)
  pathLen: number        // constant sampling window width (nominal, uniform-based)
  periodArc: number      // arc-length of the MINIMAL seamless motion period (the speed unit)
  textPeriodArc: number  // arc-length of one text-string repetition (divides the period)
  rowLens: number[]      // repeating per-row straight lengths
  arcR: number
  half: number
  instances: Instance[]
}
let state: State | null = null

/** Resample one instance's band vertices for a path-window starting at arc-length `s0`, re-centered
 *  on the window's centroid so the strip stays framed while the serpentine shape flows through it (a
 *  serpentine doesn't translate uniformly, so the centroid is the stable reference, not an
 *  endpoint). The text/gradient ride along via the matching uScroll. */
function flowGeometry(s: State, inst: Instance, s0: number): void {
  const N = s.samples - 1
  const pts: { x: number; y: number }[] = []
  let cx = 0, cy = 0
  for (let i = 0; i <= N; i++) {
    const p = serpentineVariedPoint(s0 + (i / N) * s.pathLen, s.rowLens, s.arcR)
    pts.push(p); cx += p.x; cy += p.y
  }
  cx /= (N + 1); cy /= (N + 1)
  const pos = inst.positions
  for (let i = 0; i <= N; i++) {
    const p = pts[i]!, a = i * 2, b = i * 2 + 1
    pos[a * 3] = p.x - cx; pos[a * 3 + 1] = p.y - cy; pos[a * 3 + 2] = s.half
    pos[b * 3] = p.x - cx; pos[b * 3 + 1] = p.y - cy; pos[b * 3 + 2] = -s.half
  }
  inst.posAttr.needsUpdate = true
}

export const streamerEffect: SpaceTypeEffect = {
  id: 'streamer',
  label: 'Streamer',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()

    const segmentSpace = n(params, 'segmentSpace')
    const straightLen = Math.max(segmentSpace, n(params, 'straightLength'))
    const rowChars = straightLen / segmentSpace   // straight length in glyph-cell units (may be fractional)
    const rows = Math.max(1, Math.round(n(params, 'rows')))
    const depth = n(params, 'ribbonHeight')
    const arcRadius = n(params, 'arcRadius')
    const count = Math.max(1, Math.round(n(params, 'count')))

    const geo = buildStreamerGeometry(rowChars, segmentSpace, rows, depth, arcRadius)
    const cells = geo.cells
    const samples = geo.positions.length / 6
    const pathLen = rows * (rowChars * segmentSpace) + (rows - 1) * Math.PI * arcRadius

    // Repeating per-row length cycle (jitter 0 → uniform = the original look). The MINIMAL period
    // (2 rows when uniform, the full cycle when jittered) is the seamless motion unit: advancing by
    // whole multiples of it reproduces the shape (translated), so the loop never jumps.
    const rowLens = buildRowLengths(straightLen, rows, n(params, 'lengthJitter'), Math.round(n(params, 'lengthSeed')))
    const period = minimalRowPeriod(rowLens)
    const periodArc = rowLens.slice(0, period).reduce((a, L) => a + L + Math.PI * arcRadius, 0)

    const textTex = buildTextTexture(three, params)
    const noStripes = String(params.noStripes) === 'on' ? 1 : 0
    const strokeWidth = Math.max(0, n(params, 'strokeWidth'))

    // Resolve each face's paint (mode + colours). Patterned fills tile to ~square cells via aspect.
    const aspect = pathLen / Math.max(1, depth)
    const f0 = parseFills(params.fills)[0] ?? { a: '#ffffff', b: '#000000', density: 8 }
    const front = faceTexture(three, String(params.frontMode ?? 'gradient') as FaceMode, gradientStops(params), { a: f0.a, b: f0.b, density: f0.density }, aspect)
    const backA = String(params.backColorA ?? '#111111'), backB = String(params.backColorB ?? '#444444')
    const back = faceTexture(three, String(params.backMode ?? 'solid') as FaceMode, [backA, backB], { a: backA, b: backB, density: n(params, 'backDensity') }, aspect)

    // Back face is identical for every ribbon and never animates (gradient is end-pinned, no text),
    // so a single material is shared; only the front carries the per-instance scroll.
    const backMat = makeFaceMaterial(three, {
      side: three.BackSide, faceTex: back.tex, gradMode: back.gradMode, tile: back.tile,
      textTex, hasText: 0, textColor: '#000000', textRepeat: 1, noStripes: 0,
      stroke: strokeWidth, strokeColor: String(params.backStrokeColor ?? '#000000'),
    })

    // Tie the text repeat to the geometry: fit a whole number of string-units into the period (so
    // the text realigns every period → seamless loop, no scroll seam). Pick the unit count nearest
    // to the natural glyph density (one cell ≈ segmentSpace).
    const unitCells = textUnitCells(params)
    const m = Math.max(1, Math.round(periodArc / (unitCells * segmentSpace)))
    const textPeriodArc = periodArc / m
    const textRepeat = pathLen / textPeriodArc   // string-units across the whole band

    state = {
      three, textTex, cells, samples, pathLen, periodArc, textPeriodArc,
      rowLens, arcR: arcRadius, half: depth / 2,
      instances: [],
    }
    root.userData.tex = textTex
    root.userData.tex2 = front.tex

    // Stack the ribbons vertically as parallel snaking bands, centered as a group. Each instance is
    // centroid-centered by flowGeometry, so spacing one (rows+1)·2r step apart keeps a clean gap.
    const stepY = (rows + 1) * 2 * arcRadius
    for (let k = 0; k < count; k++) {
      const positions = geo.positions.slice()   // own mutable copy (flowed independently)
      const bufferGeo = new three.BufferGeometry()
      bufferGeo.setAttribute('position', new three.BufferAttribute(positions, 3))
      bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
      bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))

      const frontMat = makeFaceMaterial(three, {
        side: three.FrontSide, faceTex: front.tex, gradMode: front.gradMode, tile: front.tile,
        textTex, hasText: 1, textColor: String(params.textColor), textRepeat, noStripes,
        stroke: strokeWidth, strokeColor: String(params.frontStrokeColor ?? '#000000'),
      })

      const sub = new three.Group()
      sub.add(new three.Mesh(bufferGeo, backMat))
      sub.add(new three.Mesh(bufferGeo, frontMat))
      sub.position.y = (k - (count - 1) / 2) * stepY
      root.add(sub)

      const inst: Instance = {
        posAttr: bufferGeo.getAttribute('position') as THREE.BufferAttribute,
        positions, front: frontMat,
        phase: (k * periodArc) / count,   // spread starts across one period
      }
      state.instances.push(inst)
      flowGeometry(state, inst, inst.phase)
    }

    // STG works in pixel units; our camera frames ~11 world units. Fit + center.
    const box = new three.Box3().setFromObject(root)
    const size = box.getSize(new three.Vector3())
    const center = box.getCenter(new three.Vector3())
    const norm = 11 / Math.max(size.x, size.y, size.z, 1)
    root.scale.setScalar(norm)
    root.position.set(-center.x * norm, -center.y * norm, -center.z * norm)

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`40px "${family}"`).then(() => {
        if (state && state.textTex === textTex) {
          const next = buildTextTexture(three, params)
          for (const inst of state.instances) inst.front.uniforms.uText!.value = next
          textTex.dispose()
          state.textTex = next; root.userData.tex = next
        }
      }).catch(() => {})
    }
    return root
  },

  update(t01, params) {
    if (!state) return
    // The SHAPE flows: slide the path window by whole minimal-periods (seamless), re-centered each
    // frame. The text rides along, scrolled in units of its repeat period (s0 / textPeriodArc) so
    // it stays glued to the moving ribbon AND wraps cleanly — over one period s0 advances a whole
    // number of text-units, so the loop has no jump. speed 0 = stopped.
    // Speed is 0–100 % of one full looping cycle per loop: 100 advances exactly one minimal period
    // (perfectly seamless), low values barely move (1 ≈ nearly still). The loop seam grows with the
    // fractional part but is negligible at the slow end where the whole advance is tiny.
    const pct = Math.max(0, n(params, 'speed')) / 100
    const base = pct === 0 ? 0 : t01 * pct * state.periodArc
    const tc = String(params.textColor)
    const ns = String(params.noStripes) === 'on' ? 1 : 0
    for (const inst of state.instances) {
      const s0 = base + inst.phase   // constant phase keeps the loop seamless, staggers the ribbons
      flowGeometry(state, inst, s0)
      const u = inst.front.uniforms
      u.uScroll!.value = state.textPeriodArc > 0 ? s0 / state.textPeriodArc : 0
      u.uTextColor!.value.set(tc)
      u.uNoStripes!.value = ns
    }
  },
}
