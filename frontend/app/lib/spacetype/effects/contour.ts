import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect, BuildEnv } from '../effect'
import { parseFills, fillShaderTexture, fillTiling, fillTextColor, SRGB_TO_LINEAR_GLSL } from '../fills'
import { defaultFillsFor } from '../palette'
import { resolveFontFamily } from '~/data/google-fonts'
import { frameEdgeSpecs } from '../contourFrame'
import { stripAlpha } from '~/lib/color/convert'

/**
 * CONTOUR — the faithful spacetypegenerator.com/layers clone (sibling to ./tunnel, which uses a
 * single swept ring per frame). Here each nested frame is FOUR independent edge strips (top / right
 * / bottom / left — corners overlap), the whole nested stack flies inward (Droste zoom), AND the
 * text SCROLLS along the edges (circulating clockwise) on top of the zoom. Rotate twists the stack
 * into a vortex; inner width/height skews the vanishing point; the view tilts the tunnel into 3D.
 * Reuses the Space Type text-texture rails + ./tunnel's zoom layout.
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'YES I CAN. YES I MUST. ', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Work Sans', group: 'Type' },
  { key: 'typeSize', label: 'Type size', kind: 'slider', min: 10, max: 220, step: 2, default: 100, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 100, step: 1, default: 40, group: 'Type' },
  // Layers — the tunnel
  { key: 'layers', label: 'Layers', kind: 'slider', min: 3, max: 30, step: 1, default: 14, group: 'Layers' },
  { key: 'perspective', label: 'Perspective', kind: 'slider', min: 0, max: 100, step: 1, default: 35, group: 'Layers' },
  { key: 'depth', label: 'Depth', kind: 'slider', min: 0, max: 2, step: 0.05, default: 0.5, group: 'Layers' },
  { key: 'innerWidth', label: 'Inner width', kind: 'slider', min: -1.2, max: 1.2, step: 0.01, default: 0, group: 'Layers' },
  { key: 'innerHeight', label: 'Inner height', kind: 'slider', min: -1.2, max: 1.2, step: 0.01, default: 0, group: 'Layers' },
  { key: 'rotate', label: 'Twist', kind: 'slider', min: -0.5, max: 0.5, step: 0.005, default: 0, group: 'Layers' },
  { key: 'view', label: 'View', kind: 'select', options: ['Front', 'Quarter', 'Upward'], default: 'Front', group: 'Layers' },
  // Color — per-layer palette cycled across the frames
  { key: 'colors', label: 'Colors', kind: 'fillList', default: defaultFillsFor(1, 'contour'), group: 'Color' },
  { key: 'shadow', label: 'Shadow', kind: 'slider', min: 0, max: 100, step: 1, default: 0, group: 'Color' },
  // Stroke — an outline along each frame's inner + outer band edges (0 = off)
  { key: 'strokeWidth', label: 'Stroke', kind: 'slider', min: 0, max: 0.45, step: 0.01, default: 0, group: 'Stroke' },
  { key: 'strokeColor', label: 'Stroke color', kind: 'color', default: '#000000', group: 'Stroke' },
  // Motion — the structure zoom + the text flow along the edges
  { key: 'speed', label: 'Zoom speed', kind: 'slider', min: 0, max: 8, step: 1, default: 1, group: 'Motion' },
  { key: 'direction', label: 'Zoom direction', kind: 'select', options: ['forward', 'reverse'], default: 'forward', group: 'Motion' },
  { key: 'flowSpeed', label: 'Text flow', kind: 'slider', min: 0, max: 12, step: 1, default: 2, group: 'Motion' },
  { key: 'flowDir', label: 'Flow direction', kind: 'select', options: ['clockwise', 'counter'], default: 'clockwise', group: 'Motion' },
  // Transform (consumed by the engine as the view tilt)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.01, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
]

const VERT = [
  'varying vec2 vUv;',
  'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
].join('\n')

// Each edge renders its fill (solid / gradient / grid / noise) as the band background, with the
// type composited on top in uTextColor (the fillList "T" swatch). uScroll streams the text along
// the edge; uAlpha fades the newborn ring in at the vanishing point. Bands are opaque, so deeper
// frames show through the open frame centres (and while a near band fades).
const FRAG = [
  'precision highp float;',
  'uniform sampler2D uFill; uniform vec2 uFillTile; uniform float uFillGrad;',
  'uniform sampler2D uText; uniform float uTextRepeat; uniform vec3 uTextColor; uniform float uAlpha; uniform float uScroll;',
  'uniform float uStroke; uniform vec3 uStrokeColor; uniform float uShade;',
  'varying vec2 vUv;',
  SRGB_TO_LINEAR_GLSL,
  'void main(){',
  '  vec3 base = (uFillGrad > 0.5) ? stLin(texture2D(uFill, vec2(0.5, vUv.x)).rgb) : stLin(texture2D(uFill, vUv * uFillTile).rgb);',
  // Outline: paint the stroke colour within uStroke of either long (inner/outer) band edge.
  '  if (uStroke > 0.0 && min(vUv.y, 1.0 - vUv.y) < uStroke) base = uStrokeColor;',
  '  float a = texture2D(uText, vec2(vUv.x * uTextRepeat + uScroll, vUv.y)).a;',
  // uShade darkens deeper frames toward black (atmospheric depth).
  '  gl_FragColor = vec4(mix(base, uTextColor, a) * uShade, uAlpha);',
  '}',
].join('\n')

function n(p: Params, k: string): number { return Number(p[k]) }
/** The text list split into one string PER FRAME (each line lands on its own frame, cycled per layer). */
function parseTexts(p: Params): string[] {
  const lines = String(p.text ?? '').split('\n').map(s => s.trim()).filter(s => s.length)
  return lines.length ? lines : [' ']
}
function trackScale(p: Params): number {
  return Math.min(2.2, Math.max(0.66, 1 + (n(p, 'tracking') - 40) / 100 * 1.2))
}

/** One phrase rendered white on transparent, mipmapped + tiled so it scrolls + minifies cleanly. */
function buildTextTexture(three: typeof THREE, p: Params, str: string): { tex: THREE.CanvasTexture; texW: number } {
  const family = resolveFontFamily(String(p.font))
  const txt = str.length ? str : ' '
  const BASE = 64
  const cell = BASE * trackScale(p)
  const R = Math.max(1, txt.length)
  const W = Math.max(1, Math.round(R * cell)), H = BASE
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `${BASE * 0.82}px "${family}", "Work Sans", sans-serif`
  ctx.fillStyle = '#ffffff'
  for (let col = 0; col < R; col++) ctx.fillText(txt[col]!, col * cell + cell / 2, H / 2)
  const t = new three.CanvasTexture(c)
  t.minFilter = three.LinearMipmapLinearFilter; t.magFilter = three.LinearFilter
  t.generateMipmaps = true; t.anisotropy = 4
  t.wrapS = three.RepeatWrapping; t.wrapT = three.ClampToEdgeWrapping
  return { tex: t, texW: W }
}

const BASE_HALF_H = 7.0   // outermost frame half-height (overflows the ~11.6-tall frame → off-screen)
const FAR_FADE = 1.8      // depth-slots over which a newborn frame fades in at the vanishing point
const OFFSET_WORLD = 6.0  // world units the inner-width/height offset maps to

interface Edge { mat: THREE.ShaderMaterial }
interface Frame { group: THREE.Group; edges: Edge[] }
interface TexInfo { tex: THREE.CanvasTexture; texW: number }
interface State {
  three: typeof THREE
  root: THREE.Group
  frames: Frame[]
  N: number
  texInfos: TexInfo[]
}
let state: State | null = null

function viewRotation(view: string): { x: number; y: number } {
  if (view === 'Quarter') return { x: 0.42, y: 0.5 }
  if (view === 'Upward') return { x: 0.95, y: 0 }
  return { x: 0, y: 0 }
}

export const contourEffect: SpaceTypeEffect = {
  id: 'contour',
  label: 'Contour',
  controls,
  liveKeys: ['rotate', 'innerWidth', 'innerHeight', 'view', 'direction', 'flowSpeed', 'flowDir',
    'strokeWidth', 'strokeColor', 'perspective', 'shadow'],

  buildScene(three, params, _textTexture, env?: BuildEnv) {
    void _textTexture
    state = null
    const root = new three.Group()
    const stack = new three.Group()
    root.add(stack)

    const aspect = env && env.height ? env.width / env.height : 1.5
    const halfH = BASE_HALF_H
    const halfW = BASE_HALF_H * Math.max(0.5, aspect)
    const thickness = Math.max(0.05, (n(params, 'typeSize') / 100) * (halfH * 0.13))

    // Mitered picture-frame lengths: horizontals run full width + into both corners, verticals fit
    // between them — so the corners are covered with no gap (see contourFrame). Two shared plane
    // geometries, one per orientation.
    const hLen = 2 * halfW + thickness
    const vLen = Math.max(0.01, 2 * halfH - thickness)
    const geoH = new three.PlaneGeometry(hLen, thickness)
    const geoV = new three.PlaneGeometry(vLen, thickness)
    root.userData.geoH = geoH; root.userData.geoV = geoV

    // One text texture PER LINE in the text list — each lands on its own frame, cycled per layer
    // (adding a second string puts it on the next frame, not merged onto the same one). Repeat per
    // edge depends on the string's pixel width, so the glyph aspect stays undistorted.
    const texInfos: TexInfo[] = parseTexts(params).map(s => buildTextTexture(three, params, s))
    const repeatH = (texW: number) => Math.max(1, Math.round(hLen / Math.max(1e-3, texW * (thickness / 64))))
    const repeatV = (texW: number) => Math.max(1, Math.round(vLen / Math.max(1e-3, texW * (thickness / 64))))

    // Per-layer fill cycled from the palette. `a`/`b`/type drive the band background (the "fill"),
    // `textColor` ("T") the type. Patterned fills tile to ~square cells via the edge's aspect.
    const fills = parseFills(params.colors)
    const specs = frameEdgeSpecs(halfW, halfH, thickness)
    const aspectH = hLen / thickness
    const aspectV = vLen / thickness
    const N = Math.max(2, Math.round(n(params, 'layers')))
    const frames: Frame[] = []
    for (let k = 0; k < N; k++) {
      const group = new three.Group()
      const fill = fills[k % fills.length]!
      const ti = texInfos[k % texInfos.length]!
      const faceTex = fillShaderTexture(three, fill)
      const tileBase = fillTiling(fill)
      const fillGrad = fill.type === 'gradient' ? 1 : 0
      const textColor = fillTextColor(three, fill)
      const edges: Edge[] = []
      for (const spec of specs) {
        const aspect = spec.orient === 'h' ? aspectH : aspectV
        const mat = new three.ShaderMaterial({
          vertexShader: VERT, fragmentShader: FRAG, side: three.DoubleSide,
          transparent: true, depthWrite: false,
          uniforms: {
            uFill: { value: faceTex },
            uFillTile: { value: new three.Vector2(tileBase * Math.max(1, aspect), tileBase) },
            uFillGrad: { value: fillGrad },
            uText: { value: ti.tex },
            uTextRepeat: { value: spec.orient === 'h' ? repeatH(ti.texW) : repeatV(ti.texW) },
            uTextColor: { value: textColor },
            uAlpha: { value: 1 },
            uScroll: { value: 0 },
            uStroke: { value: 0 },
            uStrokeColor: { value: new three.Color('#000000') },
            uShade: { value: 1 },
          },
        })
        const mesh = new three.Mesh(spec.orient === 'h' ? geoH : geoV, mat)
        mesh.position.set(spec.posX, spec.posY, 0)
        mesh.rotation.z = spec.rotZ
        mesh.userData.tex = ti.tex   // engine disposes each mesh's userData.tex on rebuild
        group.add(mesh)
        edges.push({ mat })
      }
      stack.add(group)
      frames.push({ group, edges })
    }

    state = { three, root, frames, N, texInfos }

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`40px "${family}"`).then(() => {
        if (state && state.texInfos === texInfos) {
          const next = parseTexts(params).map(s => buildTextTexture(three, params, s))
          state.frames.forEach((f, k) => {
            const ni = next[k % next.length]!
            for (const e of f.edges) e.mat.uniforms.uText!.value = ni.tex
          })
          for (const ti of texInfos) ti.tex.dispose()
          state.texInfos = next
        }
      }).catch(() => {})
    }

    layout(0, params)
    return root
  },

  update(t01, params) {
    layout(t01, params)
  },
}

/** Fly the nested frames inward (depth slot D = (k − dir·t·speed) mod N) AND scroll the text along
 *  every edge. Rotation / offset / fade are tied to D (not frame identity) so the vortex + vanishing
 *  point stay fixed in space as frames fly through → seamless loop. */
function layout(t01: number, params: Params): void {
  if (!state) return
  const { frames, N, root } = state
  const dir = String(params.direction ?? 'forward') === 'reverse' ? -1 : 1
  const speed = Math.max(0, Math.round(n(params, 'speed')))
  const rot = n(params, 'rotate')
  const offX = n(params, 'innerWidth') * OFFSET_WORLD
  const offY = n(params, 'innerHeight') * OFFSET_WORLD
  const phase = dir * t01 * speed

  // Text scroll: same offset on every edge → clockwise circulation (CCW when reversed). Whole
  // phrase-units per loop keep it seamless.
  const flowDir = String(params.flowDir ?? 'clockwise') === 'counter' ? -1 : 1
  const scroll = flowDir * t01 * Math.max(0, Math.round(n(params, 'flowSpeed')))
  const strokeW = Math.max(0, n(params, 'strokeWidth'))
  const strokeCol = stripAlpha(String(params.strokeColor ?? '#000000'))
  // Perspective → geometric shrink ratio (flat 0.95 → deep 0.63); Depth → Z spacing; Shadow → how
  // dark the deepest frame goes. All live (read per frame, no rebuild).
  const ratio = 0.95 - Math.min(100, Math.max(0, n(params, 'perspective'))) / 100 * 0.32
  const zStep = Math.max(0, n(params, 'depth'))
  const shadow = Math.min(100, Math.max(0, n(params, 'shadow'))) / 100
  const denom = Math.max(1, N - 1)

  for (let k = 0; k < frames.length; k++) {
    const f = frames[k]!
    let d = (k - phase) % N
    if (d < 0) d += N
    const s = Math.pow(ratio, d)
    f.group.scale.setScalar(s)
    f.group.position.set(offX * (1 - s), offY * (1 - s), -d * zStep)
    f.group.rotation.z = rot * d
    const fade = d > N - FAR_FADE ? Math.max(0, (N - d) / FAR_FADE) : 1
    const shade = 1 - shadow * (d / denom)
    for (const e of f.edges) {
      e.mat.uniforms.uAlpha!.value = fade
      e.mat.uniforms.uScroll!.value = scroll
      e.mat.uniforms.uStroke!.value = strokeW
      e.mat.uniforms.uStrokeColor!.value.set(strokeCol)
      e.mat.uniforms.uShade!.value = shade
    }
  }

  const vr = viewRotation(String(params.view ?? 'Front'))
  root.rotation.set(vr.x, vr.y, 0)
}
