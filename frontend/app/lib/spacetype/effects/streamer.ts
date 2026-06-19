import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills } from '../fills'
import { resolveFontFamily } from '~/data/google-fonts'
import { buildStreamerGeometry, serpentinePoint } from '../streamerLayout'

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
  { key: 'segmentSpace', label: 'Segment space', kind: 'slider', min: 6, max: 60, step: 1, default: 26, group: 'Ribbon' },
  { key: 'segmentCount', label: 'Chars per row', kind: 'slider', min: 4, max: 60, step: 1, default: 22, group: 'Ribbon' },
  { key: 'rows', label: 'Rows', kind: 'slider', min: 1, max: 8, step: 1, default: 3, group: 'Ribbon' },
  { key: 'count', label: 'Streamers', kind: 'slider', min: 1, max: 5, step: 1, default: 1, group: 'Ribbon' },
  { key: 'arcRadius', label: 'Arc radius', kind: 'slider', min: 20, max: 200, step: 2, default: 70, group: 'Ribbon' },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 8, max: 120, step: 1, default: 44, group: 'Ribbon' },
  // Color
  { key: 'fills', label: 'Gradient stops', kind: 'fillList', default: JSON.stringify([
      { type: 'solid', a: '#3B2BFF', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#E01B6A', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#FF7A1A', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#FFE600', b: '#000', textColor: '#fff' },
    ]), group: 'Color' },
  { key: 'textColor', label: 'Text color', kind: 'color', default: '#111111', group: 'Color' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#111111', group: 'Color' },
  { key: 'noStripes', label: 'No stripes', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Color' },
  // Motion
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 4, step: 1, default: 1, group: 'Motion' },
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

// FRONT face: the gradient is PINNED to the ribbon's physical ends (sampled at vUv.x, 0→1 across the
// whole band) so one end is always the first stop and the other the last, no matter how the shape
// flows. The TEXT flows along the ribbon (sampled at vUv.x + uScroll) so the letters travel with the
// moving streamer while the colour stays anchored.
const FRONT_FRAG = [
  'precision highp float;',
  'uniform sampler2D uText; uniform sampler2D uGrad; uniform vec3 uTextColor; uniform float uScroll; uniform float uNoStripes;',
  'varying vec2 vUv;',
  'void main(){',
  '  float a = texture2D(uText, vec2(vUv.x + uScroll, vUv.y)).a;',
  '  if (uNoStripes > 0.5) { if (a < 0.02) discard; gl_FragColor = vec4(uTextColor, 1.0); return; }',
  '  vec3 g = texture2D(uGrad, vec2(vUv.x, 0.5)).rgb;',
  '  gl_FragColor = vec4(mix(g, uTextColor, a), 1.0);',
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

/** Text matte: `cells` glyph cells across the strip (white on transparent), tiled from the input
 *  text. Maps once across the whole path; the text flows by scrolling the texture offset. */
function buildTextTexture(three: typeof THREE, p: Params, cells: number): THREE.CanvasTexture {
  const family = resolveFontFamily(String(p.font))
  // Append blank cells so each repetition of the string is separated by a visible gap.
  const txt = streamerText(p) + ' '.repeat(Math.max(0, Math.round(n(p, 'textGap'))))
  const CELL = 64
  const W = Math.max(1, cells) * CELL
  const c = document.createElement('canvas'); c.width = W; c.height = CELL
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, W, CELL)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const stroke = n(p, 'typeStroke')
  const px = CELL * (0.45 + (n(p, 'typeHeight') / 100) * 0.4)
  ctx.font = `${px}px "${family}", "IBM Plex Mono", monospace`
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round'
  for (let col = 0; col < cells; col++) {
    const ch = txt[col % txt.length]!
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
  pathLen: number
  rowLen: number
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
    const p = serpentinePoint(s0 + (i / N) * s.pathLen, s.rowLen, s.arcR)
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

    const rowChars = Math.max(1, Math.round(n(params, 'segmentCount')))
    const segmentSpace = n(params, 'segmentSpace')
    const rows = Math.max(1, Math.round(n(params, 'rows')))
    const depth = n(params, 'ribbonHeight')
    const arcRadius = n(params, 'arcRadius')
    const count = Math.max(1, Math.round(n(params, 'count')))

    const geo = buildStreamerGeometry(rowChars, segmentSpace, rows, depth, arcRadius)
    const cells = geo.cells
    const samples = geo.positions.length / 6
    const seg = rowChars * segmentSpace + Math.PI * arcRadius
    const pathLen = rows * (rowChars * segmentSpace) + (rows - 1) * Math.PI * arcRadius

    const gradTex = buildGradientTexture(three, gradientStops(params))
    const textTex = buildTextTexture(three, params, cells)
    const noStripes = String(params.noStripes) === 'on' ? 1 : 0
    const backMat = new three.MeshBasicMaterial({ color: new three.Color(String(params.bSideColor)), side: three.BackSide })

    state = {
      three, textTex, cells, samples, pathLen,
      rowLen: rowChars * segmentSpace, arcR: arcRadius, half: depth / 2,
      instances: [],
    }
    root.userData.tex = textTex
    root.userData.tex2 = gradTex

    // Stack the ribbons vertically as parallel snaking bands, centered as a group. Each instance is
    // centroid-centered by flowGeometry, so spacing one (rows+1)·2r step apart keeps a clean gap.
    const stepY = (rows + 1) * 2 * arcRadius
    for (let k = 0; k < count; k++) {
      const positions = geo.positions.slice()   // own mutable copy (flowed independently)
      const bufferGeo = new three.BufferGeometry()
      bufferGeo.setAttribute('position', new three.BufferAttribute(positions, 3))
      bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
      bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))

      const frontMat = new three.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRONT_FRAG, side: three.FrontSide,
        uniforms: {
          uText: { value: textTex as THREE.Texture },
          uGrad: { value: gradTex as THREE.Texture },
          uTextColor: { value: new three.Color(String(params.textColor)) },
          uScroll: { value: 0 },
          uNoStripes: { value: noStripes },
        },
      })

      const sub = new three.Group()
      sub.add(new three.Mesh(bufferGeo, backMat))
      sub.add(new three.Mesh(bufferGeo, frontMat))
      sub.position.y = (k - (count - 1) / 2) * stepY
      root.add(sub)

      const inst: Instance = {
        posAttr: bufferGeo.getAttribute('position') as THREE.BufferAttribute,
        positions, front: frontMat,
        phase: (k * 2 * seg) / count,   // spread starts across one 2-row period
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
          const next = buildTextTexture(three, params, cells)
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
    // The SHAPE flows: slide the path window by whole 2-row periods (seamless), re-centered each
    // frame. The text/gradient ride along (uScroll = same offset in uv units) so the text stays
    // fixed IN the moving ribbon. speed 0 = stopped.
    const seg = state.rowLen + Math.PI * state.arcR
    const periods = Math.max(0, Math.round(n(params, 'speed')))
    const base = periods === 0 ? 0 : t01 * periods * 2 * seg
    const tc = String(params.textColor)
    const ns = String(params.noStripes) === 'on' ? 1 : 0
    for (const inst of state.instances) {
      const s0 = base + inst.phase   // constant phase keeps the loop seamless, staggers the ribbons
      flowGeometry(state, inst, s0)
      const u = inst.front.uniforms
      u.uScroll!.value = state.pathLen > 0 ? s0 / state.pathLen : 0
      u.uTextColor!.value.set(tc)
      u.uNoStripes!.value = ns
    }
  },
}
