import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect, BuildEnv } from '../effect'
import { parseFills, fillShaderTexture, fillTiling, fillTextColor, SRGB_TO_LINEAR_GLSL } from '../fills'
import { defaultFillsFor } from '../palette'
import { resolveFontFamily } from '~/data/google-fonts'
import { buildTunnelRing } from '../tunnelGeometry'

/**
 * TUNNEL — an infinite text tunnel (a swept-ring take on spacetypegenerator.com/layers; see the
 * sibling ./contour for the per-edge version). The phrase is set around the perimeter of a
 * rectangular frame (../tunnelGeometry) as ONE continuous swept ring, and that frame is
 * instanced as a stack of rings receding in Z. The perspective camera turns the stack into a tunnel
 * that converges toward a vanishing point; flying the rings forward (each ring's depth slot drifts)
 * gives an endless Droste zoom that loops seamlessly. Per-layer rotation twists it into a vortex,
 * and an inner-width/height offset skews the vanishing point. Reuses the Space Type text-texture
 * rails; the FACE shader is a text-only matte so deeper rings show through the open centers.
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'YES I CAN. YES I MUST. ', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Work Sans', group: 'Type' },
  { key: 'typeSize', label: 'Type size', kind: 'slider', min: 10, max: 220, step: 2, default: 100, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 100, step: 1, default: 40, group: 'Type' },
  // Layers — the tunnel
  { key: 'shape', label: 'Shape', kind: 'select', options: ['Rectangle', 'Circle', 'Diamond'], default: 'Rectangle', group: 'Layers' },
  { key: 'shapeAspect', label: 'Aspect', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Layers' },
  { key: 'layers', label: 'Layers', kind: 'slider', min: 3, max: 30, step: 1, default: 14, group: 'Layers' },
  { key: 'perspective', label: 'Perspective', kind: 'slider', min: 0, max: 100, step: 1, default: 35, group: 'Layers' },
  { key: 'depth', label: 'Depth', kind: 'slider', min: 0, max: 2, step: 0.05, default: 0.5, group: 'Layers' },
  { key: 'innerWidth', label: 'Inner width', kind: 'slider', min: -1.2, max: 1.2, step: 0.01, default: 0, group: 'Layers' },
  { key: 'innerHeight', label: 'Inner height', kind: 'slider', min: -1.2, max: 1.2, step: 0.01, default: 0, group: 'Layers' },
  { key: 'rotate', label: 'Twist', kind: 'slider', min: -0.5, max: 0.5, step: 0.005, default: 0, group: 'Layers' },
  { key: 'view', label: 'View', kind: 'select', options: ['Front', 'Quarter', 'Upward'], default: 'Front', group: 'Layers' },
  // Color — per-layer palette cycled across the rings
  { key: 'colors', label: 'Colors', kind: 'fillList', default: defaultFillsFor(1, 'tunnel'), group: 'Color' },
  { key: 'shadow', label: 'Shadow', kind: 'slider', min: 0, max: 100, step: 1, default: 0, group: 'Color' },
  // Stroke — an outline along each ring's inner + outer band edges (0 = off)
  { key: 'strokeWidth', label: 'Stroke', kind: 'slider', min: 0, max: 0.45, step: 0.01, default: 0, group: 'Stroke' },
  { key: 'strokeColor', label: 'Stroke color', kind: 'color', default: '#000000', group: 'Stroke' },
  // Motion
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 8, step: 1, default: 1, group: 'Motion' },
  { key: 'direction', label: 'Direction', kind: 'select', options: ['forward', 'reverse'], default: 'forward', group: 'Motion' },
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

// Each ring renders its fill (solid / gradient / grid / noise) as the band background, with the
// type composited on top in uTextColor (the fillList "T" swatch). The gradient samples across the
// band thickness (vUv.y) to avoid a seam on the closed ring. uAlpha fades the ring in at the far
// end so the seamless wrap stays invisible; open frame centres show the deeper rings through.
const FRAG = [
  'precision highp float;',
  'uniform sampler2D uFill; uniform vec2 uFillTile; uniform float uFillGrad;',
  'uniform sampler2D uText; uniform float uTextRepeat; uniform vec3 uTextColor; uniform float uAlpha; uniform float uTextFlip;',
  'uniform float uStroke; uniform vec3 uStrokeColor; uniform float uShade;',
  'varying vec2 vUv;',
  SRGB_TO_LINEAR_GLSL,
  'void main(){',
  '  vec3 base = (uFillGrad > 0.5) ? stLin(texture2D(uFill, vec2(0.5, vUv.y)).rgb) : stLin(texture2D(uFill, vUv * uFillTile).rgb);',
  // Outline: paint the stroke colour within uStroke of either long (inner/outer) ring edge.
  '  if (uStroke > 0.0 && min(vUv.y, 1.0 - vUv.y) < uStroke) base = uStrokeColor;',
  '  float a = texture2D(uText, vec2(uTextFlip * vUv.x * uTextRepeat, vUv.y)).a;',
  // uShade darkens deeper rings toward black (atmospheric depth).
  '  gl_FragColor = vec4(mix(base, uTextColor, a) * uShade, uAlpha);',
  '}',
].join('\n')

function n(p: Params, k: string): number { return Number(p[k]) }
/** The text list split into one string PER RING (each line lands on its own ring, cycled per layer). */
function parseTexts(p: Params): string[] {
  const lines = String(p.text ?? '').split('\n').map(s => s.trim()).filter(s => s.length)
  return lines.length ? lines : [' ']
}

/** Letter-spacing factor (1.0 at tracking 40, matching the other effects). */
function trackScale(p: Params): number {
  return Math.min(2.2, Math.max(0.66, 1 + (n(p, 'tracking') - 40) / 100 * 1.2))
}

/** One phrase rendered white on transparent, tiled with RepeatWrapping so it wraps the frame
 *  perimeter seamlessly. Returns the texture + its pixel width (to keep glyph aspect undistorted). */
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
  const px = BASE * 0.82
  ctx.font = `${px}px "${family}", "Work Sans", sans-serif`
  ctx.fillStyle = '#ffffff'
  for (let col = 0; col < R; col++) ctx.fillText(txt[col]!, col * cell + cell / 2, H / 2)
  const t = new three.CanvasTexture(c)
  // Mipmapped minification so the text on deep (tiny) rings stays crisp instead of aliasing to mush.
  t.minFilter = three.LinearMipmapLinearFilter; t.magFilter = three.LinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  t.wrapS = three.RepeatWrapping; t.wrapT = three.ClampToEdgeWrapping
  return { tex: t, texW: W }
}

const BASE_HALF_H = 7.0   // outermost ring half-height (overflows the ~11.6-tall frame → ends off-screen)
const FAR_FADE = 1.8      // depth-slots over which a newborn ring fades in at the vanishing point
const OFFSET_WORLD = 6.0  // world units the inner-width/height offset maps to (vanishing-point shift)

interface Layer { mat: THREE.ShaderMaterial; mesh: THREE.Mesh }
interface TexInfo { tex: THREE.CanvasTexture; texW: number }
interface State {
  three: typeof THREE
  group: THREE.Group
  layers: Layer[]
  N: number
  halfW: number
  halfH: number
  texInfos: TexInfo[]
}
let state: State | null = null

function viewRotation(view: string): { x: number; y: number } {
  if (view === 'Quarter') return { x: 0.42, y: 0.5 }
  if (view === 'Upward') return { x: 0.95, y: 0 }
  return { x: 0, y: 0 }
}

export const tunnelEffect: SpaceTypeEffect = {
  id: 'tunnel',
  label: 'Tunnel',
  controls,
  liveKeys: ['rotate', 'innerWidth', 'innerHeight', 'view', 'direction',
    'strokeWidth', 'strokeColor', 'perspective', 'shadow'],

  buildScene(three, params, _textTexture, env?: BuildEnv) {
    void _textTexture
    state = null
    const root = new three.Group()
    const group = new three.Group()
    root.add(group)

    const frameAspect = env && env.height ? env.width / env.height : 1.5
    const halfH = BASE_HALF_H
    const thickness = Math.max(0.05, (n(params, 'typeSize') / 100) * (halfH * 0.13))

    const shapeParam = String(params.shape ?? 'Rectangle')
    const shape = shapeParam === 'Circle' ? 'circle' : shapeParam === 'Diamond' ? 'diamond' : 'rect'
    // Width basis: the rectangle fills the frame; circle/diamond are SQUARE-based so Aspect 1 gives a
    // true circle / true square. Aspect then stretches the shape's width either way.
    const shapeAspect = Math.min(2.5, Math.max(0.4, n(params, 'shapeAspect')))
    const baseHalfW = shape === 'rect' ? BASE_HALF_H * Math.max(0.5, frameAspect) : halfH
    const halfW = baseHalfW * shapeAspect
    const geo = buildTunnelRing({ halfW, halfH, thickness, shape })
    const bufferGeo = new three.BufferGeometry()
    bufferGeo.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
    bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
    bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))

    // One text texture PER LINE in the text list — each lands on its own ring, cycled per layer
    // (so adding a second string puts it on the next band, not merged onto the same one).
    const texInfos: TexInfo[] = parseTexts(params).map(s => buildTextTexture(three, params, s))
    // Fit a whole number of phrase copies around the perimeter (closed loop → no seam) at natural
    // glyph aspect (texW : 64, with band height = thickness in world).
    const repeatFor = (texW: number) => Math.max(1, Math.round(geo.perimeter / Math.max(1e-3, texW * (thickness / 64))))

    // Per-layer fill cycled from the palette. `a`/`b`/type drive the band background (the "fill"),
    // `textColor` ("T") the type. Patterned fills tile to ~square cells via the ring aspect.
    const fills = parseFills(params.colors)
    const ringAspect = geo.perimeter / Math.max(1e-3, thickness)
    const N = Math.max(2, Math.round(n(params, 'layers')))
    const layers: Layer[] = []
    for (let k = 0; k < N; k++) {
      const fill = fills[k % fills.length]!
      const ti = texInfos[k % texInfos.length]!
      const faceTex = fillShaderTexture(three, fill)
      const tileBase = fillTiling(fill)
      const mat = new three.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, side: three.DoubleSide,
        transparent: true, depthWrite: false,
        uniforms: {
          uFill: { value: faceTex },
          uFillTile: { value: new three.Vector2(tileBase * Math.max(1, ringAspect), tileBase) },
          uFillGrad: { value: fill.type === 'gradient' ? 1 : 0 },
          uText: { value: ti.tex },
          uTextRepeat: { value: repeatFor(ti.texW) },
          uTextColor: { value: fillTextColor(three, fill) },
          uAlpha: { value: 1 },
          uTextFlip: { value: 1 },
          uStroke: { value: 0 },
          uStrokeColor: { value: new three.Color('#000000') },
          uShade: { value: 1 },
        },
      })
      const mesh = new three.Mesh(bufferGeo, mat)
      mesh.userData.tex = ti.tex   // engine disposes each mesh's userData.tex on rebuild
      group.add(mesh)
      layers.push({ mat, mesh })
    }

    state = { three, group, layers, N, halfW, halfH, texInfos }

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`40px "${family}"`).then(() => {
        if (state && state.texInfos === texInfos) {
          const next = parseTexts(params).map(s => buildTextTexture(three, params, s))
          for (let k = 0; k < state.layers.length; k++) {
            const ni = next[k % next.length]!
            state.layers[k]!.mat.uniforms.uText!.value = ni.tex
            state.layers[k]!.mat.uniforms.uTextRepeat!.value = repeatFor(ni.texW)
            state.layers[k]!.mesh.userData.tex = ni.tex
          }
          for (const ti of texInfos) ti.tex.dispose()
          state.texInfos = next
        }
      }).catch(() => {})
    }

    layoutTunnel(0, params)
    return root
  },

  update(t01, params) {
    layoutTunnel(t01, params)
  },
}

/** Position every ring by its continuous depth slot D = (k − dir·t·speed) mod N. Tying the
 *  rotation/offset/fade to D (not the ring's identity) keeps the vortex + vanishing point stable in
 *  space while the rings fly through, so the loop is seamless. */
function layoutTunnel(t01: number, params: Params): void {
  if (!state) return
  const { layers, N, group } = state
  const dir = String(params.direction ?? 'forward') === 'reverse' ? -1 : 1
  const speed = Math.max(0, Math.round(n(params, 'speed')))
  const rot = n(params, 'rotate')
  const offX = n(params, 'innerWidth')
  const offY = n(params, 'innerHeight')
  const phase = dir * t01 * speed

  const vx = offX * OFFSET_WORLD, vy = offY * OFFSET_WORLD   // world position the tunnel converges to
  const strokeW = Math.max(0, n(params, 'strokeWidth'))
  const strokeCol = String(params.strokeColor ?? '#000000')
  // Perspective → shrink ratio (flat 0.95 → deep 0.63); Depth → Z spacing; Shadow → deepest darkness.
  const ratio = 0.95 - Math.min(100, Math.max(0, n(params, 'perspective'))) / 100 * 0.32
  const zStep = Math.max(0, n(params, 'depth'))
  const shadow = Math.min(100, Math.max(0, n(params, 'shadow'))) / 100
  const denom = Math.max(1, N - 1)
  for (let k = 0; k < layers.length; k++) {
    const l = layers[k]!
    let d = (k - phase) % N
    if (d < 0) d += N
    const s = Math.pow(ratio, d)                  // geometric shrink → even nesting
    l.mesh.scale.setScalar(s)
    // Each ring drifts toward the vanishing point (vx,vy) as it shrinks: d=0 sits at the origin,
    // deep rings approach (vx,vy). A small Z step gives the tilt views genuine depth.
    l.mesh.position.set(vx * (1 - s), vy * (1 - s), -d * zStep)
    l.mesh.rotation.z = rot * d
    // Fade the newborn (far) ring in over the last FAR_FADE slots so its sub-pixel appearance and
    // the modulo wrap are invisible. The near ring overflows the frame, so it needs no fade.
    const fade = d > N - FAR_FADE ? Math.max(0, (N - d) / FAR_FADE) : 1
    l.mat.uniforms.uAlpha!.value = fade
    l.mat.uniforms.uStroke!.value = strokeW
    l.mat.uniforms.uStrokeColor!.value.set(strokeCol)
    l.mat.uniforms.uShade!.value = 1 - shadow * (d / denom)
  }

  const vr = viewRotation(String(params.view ?? 'Front'))
  group.rotation.set(vr.x, vr.y, 0)
}
