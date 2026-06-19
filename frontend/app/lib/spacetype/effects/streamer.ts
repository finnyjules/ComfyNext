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
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 6, step: 0.5, default: 0, group: 'Type' },
  // Ribbon
  { key: 'segmentSpace', label: 'Segment space', kind: 'slider', min: 6, max: 60, step: 1, default: 26, group: 'Ribbon' },
  { key: 'segmentCount', label: 'Chars per row', kind: 'slider', min: 4, max: 60, step: 1, default: 22, group: 'Ribbon' },
  { key: 'rows', label: 'Rows', kind: 'slider', min: 1, max: 8, step: 1, default: 3, group: 'Ribbon' },
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

// FRONT face: the painted ribbon (gradient + text) FLOWS together along the fixed serpentine track
// — both sampled at vUv.x + uScroll — so the colour and the letters move as one unit and the text
// stays fixed relative to the ribbon (the streamer moves, the text is static in it).
const FRONT_FRAG = [
  'precision highp float;',
  'uniform sampler2D uText; uniform sampler2D uGrad; uniform vec3 uTextColor; uniform float uScroll; uniform float uNoStripes;',
  'varying vec2 vUv;',
  'void main(){',
  '  float u = vUv.x + uScroll;',
  '  float a = texture2D(uText, vec2(u, vUv.y)).a;',
  '  if (uNoStripes > 0.5) { if (a < 0.02) discard; gl_FragColor = vec4(uTextColor, 1.0); return; }',
  '  vec3 g = texture2D(uGrad, vec2(u, 0.5)).rgb;',
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
  const txt = streamerText(p)
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

interface State {
  three: typeof THREE
  textTex: THREE.CanvasTexture
  front: THREE.ShaderMaterial
  cells: number
  // for per-frame geometry flow: slide the band's path window so the SHAPE moves (text glued)
  posAttr: THREE.BufferAttribute
  positions: Float32Array
  samples: number      // path samples (N+1)
  pathLen: number
  rowLen: number
  arcR: number
  half: number
}
let state: State | null = null

/** Resample the band's vertices for a path-window starting at arc-length `s0`, re-centered on the
 *  window's centroid so the strip stays framed while the serpentine shape flows through it (a
 *  serpentine doesn't translate uniformly, so the centroid is the stable reference, not an
 *  endpoint). The text/gradient ride along via the matching uScroll. */
function flowGeometry(s: State, s0: number): void {
  const N = s.samples - 1
  const pts: { x: number; y: number }[] = []
  let cx = 0, cy = 0
  for (let i = 0; i <= N; i++) {
    const p = serpentinePoint(s0 + (i / N) * s.pathLen, s.rowLen, s.arcR)
    pts.push(p); cx += p.x; cy += p.y
  }
  cx /= (N + 1); cy /= (N + 1)
  for (let i = 0; i <= N; i++) {
    const p = pts[i]!, a = i * 2, b = i * 2 + 1
    s.positions[a * 3] = p.x - cx; s.positions[a * 3 + 1] = p.y - cy; s.positions[a * 3 + 2] = s.half
    s.positions[b * 3] = p.x - cx; s.positions[b * 3 + 1] = p.y - cy; s.positions[b * 3 + 2] = -s.half
  }
  s.posAttr.needsUpdate = true
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

    const geo = buildStreamerGeometry(rowChars, segmentSpace, rows, depth, arcRadius)
    const cells = geo.cells
    const bufferGeo = new three.BufferGeometry()
    bufferGeo.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
    bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
    bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))

    const gradTex = buildGradientTexture(three, gradientStops(params))
    const textTex = buildTextTexture(three, params, cells)
    const noStripes = String(params.noStripes) === 'on' ? 1 : 0

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
    const backMat = new three.MeshBasicMaterial({ color: new three.Color(String(params.bSideColor)), side: three.BackSide })
    root.add(new three.Mesh(bufferGeo, backMat))
    root.add(new three.Mesh(bufferGeo, frontMat))
    root.userData.tex = textTex
    root.userData.tex2 = gradTex

    const posAttr = bufferGeo.getAttribute('position') as THREE.BufferAttribute
    const positions = geo.positions
    state = {
      three, textTex, front: frontMat, cells,
      posAttr, positions, samples: positions.length / 6,
      pathLen: rows * (rowChars * segmentSpace) + (rows - 1) * Math.PI * arcRadius,
      rowLen: rowChars * segmentSpace, arcR: arcRadius, half: depth / 2,
    }
    flowGeometry(state, 0)   // re-center on the window midpoint to match the per-frame flow

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
          frontMat.uniforms.uText!.value = next
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
    const s0 = periods === 0 ? 0 : t01 * periods * 2 * seg
    flowGeometry(state, s0)
    const u = state.front.uniforms
    u.uScroll!.value = state.pathLen > 0 ? s0 / state.pathLen : 0
    u.uTextColor!.value.set(String(params.textColor))
    u.uNoStripes!.value = String(params.noStripes) === 'on' ? 1 : 0
  },
}
