import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills } from '../fills'
import { resolveFontFamily } from '~/data/google-fonts'
import { buildStreamerGeometry, streamerRadius } from '../streamerLayout'

/**
 * STREAMER — port of spacetypegenerator.com/ribbon (Streamers preset). A continuous band is swept
 * around a racetrack/oval loop (ribbonStretch = straight-run length; 0 = oval) and stacked into
 * `ribbonCount` ribbons. The band has one consistent FRONT face (a fixed multi-stop gradient along
 * the loop + the scrolling text in the text colour) and one BACK face (a solid B-side colour, no
 * text). Because it's a single swept mesh with consistent winding, the two faces never flip per
 * segment — the gradient/text face is always the front, the B-side always the back, and the text
 * reads correctly all the way around. Geometry + gradient math are pure + unit-tested
 * (../streamerLayout).
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'THE SEA IS A DESERT OF WAVES, A WILDERNESS OF WATER. ', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'IBM Plex Mono', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 0, max: 100, step: 1, default: 25, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 100, step: 1, default: 40, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 6, step: 0.5, default: 2, group: 'Type' },
  // Ribbon
  { key: 'segmentSpace', label: 'Segment space', kind: 'slider', min: 4, max: 60, step: 1, default: 23, group: 'Ribbon' },
  { key: 'segmentCount', label: 'Segment count', kind: 'slider', min: 3, max: 50, step: 1, default: 22, group: 'Ribbon' },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 8, max: 200, step: 1, default: 56, group: 'Ribbon' },
  { key: 'ribbonStretch', label: 'Ribbon stretch', kind: 'slider', min: 0, max: 6, step: 0.1, default: 0.6, group: 'Ribbon' },
  { key: 'ribbonCount', label: 'Ribbon count', kind: 'slider', min: 1, max: 10, step: 1, default: 4, group: 'Ribbon' },
  { key: 'ribbonSpacing', label: 'Ribbon spacing', kind: 'slider', min: 1, max: 3, step: 0.01, default: 1.3, group: 'Ribbon' },
  { key: 'ribbonOffset', label: 'Ribbon offset', kind: 'slider', min: 0, max: 2, step: 0.01, default: 1.5, group: 'Ribbon' },
  { key: 'alternate', label: 'Alternate', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  // Color
  { key: 'fills', label: 'Gradient stops', kind: 'fillList', default: JSON.stringify([
      { type: 'solid', a: '#FFFC79', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#FF2F92', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#011993', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#0096FF', b: '#000', textColor: '#fff' },
    ]), group: 'Color' },
  { key: 'textColor', label: 'Text color', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#212121', group: 'Color' },
  { key: 'noStripes', label: 'No stripes', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Color' },
  // Motion
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.4, group: 'Motion' },
  // Transform (consumed by the engine)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.01, default: 0.9, group: 'Transform' },
  { key: 'rotateX', label: 'Rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0.95, group: 'Transform' },
  { key: 'rotateY', label: 'Rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
]

const VERT = [
  'varying vec2 vUv;',
  'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
].join('\n')

// FRONT face: fixed gradient (sampled at vUv.x — stays put around the loop) + the scrolling text
// matte (sampled at vUv.x + uScroll) in the text colour.
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

/** Fixed multi-stop gradient along the loop (1px tall). */
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
  t.wrapS = three.ClampToEdgeWrapping
  return t
}

/** Text matte: `cells` glyph cells across the strip (white on transparent), tiled from the input
 *  text. Maps once around the loop; scrolled via texture offset. */
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
  ctx.font = `${CELL * 0.62}px "${family}", "IBM Plex Mono", monospace`
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round'
  const dy = (n(p, 'typeHeight') / 100 - 0.5) * CELL * 0.5   // vertical nudge within the band
  for (let col = 0; col < cells; col++) {
    const ch = txt[col % txt.length]!
    const cx = col * CELL + CELL / 2, cy = CELL / 2 + dy
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
  gradTex: THREE.CanvasTexture
  fronts: THREE.ShaderMaterial[]
  cells: number
}
let state: State | null = null

export const streamerEffect: SpaceTypeEffect = {
  id: 'streamer',
  label: 'Streamer',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()

    const segmentCount = Math.max(1, Math.round(n(params, 'segmentCount')))
    const segmentSpace = n(params, 'segmentSpace')
    const ms = n(params, 'ribbonStretch')
    const depth = n(params, 'ribbonHeight')
    const radius = streamerRadius(segmentCount, segmentSpace)
    const count = Math.max(1, Math.round(n(params, 'ribbonCount')))
    const spacing = n(params, 'ribbonSpacing')
    const offset = n(params, 'ribbonOffset')
    const alt = String(params.alternate) === 'on'

    const geo = buildStreamerGeometry(segmentCount, segmentSpace, ms, depth)
    const cells = geo.cells
    const bufferGeo = new three.BufferGeometry()
    bufferGeo.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
    bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
    bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))

    const gradTex = buildGradientTexture(three, gradientStops(params))
    const textTex = buildTextTexture(three, params, cells)
    const noStripes = String(params.noStripes) === 'on' ? 1 : 0
    const fronts: THREE.ShaderMaterial[] = []

    for (let i = 0; i < count; i++) {
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
      const front = new three.Mesh(bufferGeo, frontMat)
      const back = new three.Mesh(bufferGeo, backMat)
      const sub = new three.Group()
      sub.position.set(0, alt ? (i % 2) * radius * 2 : i * offset * radius * 2, i * depth * spacing)
      sub.add(back); sub.add(front)
      root.add(sub)
      fronts.push(frontMat)
    }
    // texture cleanup on rebuild
    root.userData.tex = textTex
    root.userData.tex2 = gradTex

    // STG works in pixel units; our camera frames ~11 world units. Fit + center.
    const box = new three.Box3().setFromObject(root)
    const size = box.getSize(new three.Vector3())
    const center = box.getCenter(new three.Vector3())
    const norm = 11 / Math.max(size.x, size.y, size.z, 1)
    root.scale.setScalar(norm)
    root.position.set(-center.x * norm, -center.y * norm, -center.z * norm)

    state = { three, textTex, gradTex, fronts, cells }

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`40px "${family}"`).then(() => {
        if (state && state.textTex === textTex) {
          const next = buildTextTexture(three, params, cells)
          for (const m of fronts) m.uniforms.uText!.value = next
          textTex.dispose()
          state.textTex = next; root.userData.tex = next
        }
      }).catch(() => {})
    }
    return root
  },

  update(t01, params) {
    if (!state) return
    // text scrolls a whole number of full strips per loop ⇒ seamless; speed 0 = stopped.
    const strips = Math.max(0, Math.round(n(params, 'speed') * 2))
    const scroll = strips === 0 ? 0 : t01 * strips
    const textColor = new state.three.Color(String(params.textColor))
    const noStripes = String(params.noStripes) === 'on' ? 1 : 0
    for (const m of state.fronts) {
      m.uniforms.uScroll!.value = scroll
      m.uniforms.uTextColor!.value.copy(textColor)
      m.uniforms.uNoStripes!.value = noStripes
    }
  },
}
