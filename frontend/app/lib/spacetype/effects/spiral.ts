import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import type { Fill, FillType } from '../fills'
import { parseFills, fillShaderTexture, fillTiling, SRGB_TO_LINEAR_GLSL } from '../fills'
import { defaultFillsFor } from '../palette'
import { resolveFontFamily } from '~/data/google-fonts'
import { buildSpiralGeometry } from '../spiralGeometry'

/**
 * SPIRAL (a.k.a. SPRING) — text wound as an edge-wound helix "slinky", inspired by
 * spacetypegenerator.com's V.SPRING. One continuous swept band (geometry in ../spiralGeometry):
 * the FRONT (outer) face carries the text (white on transparent by default) and the BACK (inner /
 * underside) face shows an iridescent gradient that peeks through the gaps between coils. Motion is
 * a rigid SPIN around the column's vertical axis — because the band descends, spinning it makes the
 * coils appear to flow vertically (barber-pole), and a whole number of turns loops perfectly.
 * Forked from ./streamer (shared shader + text-texture rails); the serpentine path + path-flow were
 * swapped for the helix + spin.
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'FOR WHAT IT IS WORTH', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 0, max: 100, step: 1, default: 62, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 100, step: 1, default: 40, group: 'Type' },
  { key: 'textGap', label: 'Text spacing', kind: 'slider', min: 0, max: 30, step: 1, default: 6, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 6, step: 0.5, default: 0, group: 'Type' },
  // Spiral
  // Radius drives text-per-coil + ellipse flatness, NOT screen size (the column is framed by
  // diameter): a larger radius fits more of the phrase per coil at natural letter aspect.
  { key: 'radius', label: 'Radius', kind: 'slider', min: 80, max: 700, step: 5, default: 340, group: 'Spiral' },
  { key: 'turns', label: 'Coils', kind: 'slider', min: 2, max: 24, step: 1, default: 9, group: 'Spiral' },
  { key: 'coilPitch', label: 'Coil pitch', kind: 'slider', min: 20, max: 360, step: 2, default: 132, group: 'Spiral' },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 20, max: 280, step: 2, default: 104, group: 'Spiral' },
  // Per-region winding tightness: scales the coil spacing at the top / middle / bottom of the column
  // (1 = uniform, <1 tighter/bunched, >1 looser/splayed), smoothly blended down the helix.
  { key: 'spacingTop', label: 'Spacing · top', kind: 'slider', min: 0.3, max: 2.5, step: 0.05, default: 1, group: 'Spiral' },
  { key: 'spacingMid', label: 'Spacing · middle', kind: 'slider', min: 0.3, max: 2.5, step: 0.05, default: 1, group: 'Spiral' },
  { key: 'spacingBottom', label: 'Spacing · bottom', kind: 'slider', min: 0.3, max: 2.5, step: 0.05, default: 1, group: 'Spiral' },
  { key: 'reverse', label: 'Reverse coil', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Spiral' },
  // Color
  { key: 'frontMode', label: 'Text face', kind: 'select', options: ['text on band', 'text only'], default: 'text on band', group: 'Color' },
  { key: 'textColor', label: 'Text color', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'bandColor', label: 'Band color', kind: 'color', default: '#000000', group: 'Color' },
  // Iridescent underside ramp (multi-stop). Violet intentionally left out per house style — add a
  // stop in the control if you want the exact reference ramp.
  { key: 'fills', label: 'Underside gradient', kind: 'fillList', default: defaultFillsFor(5, 'spiral'), group: 'Color' },
  { key: 'gradRepeats', label: 'Gradient repeats', kind: 'slider', min: 1, max: 12, step: 1, default: 1, group: 'Color' },
  // Motion — whole turns/loop keep the spin seamless; direction flips the apparent vertical flow.
  { key: 'speed', label: 'Rotations / loop', kind: 'slider', min: 0, max: 8, step: 1, default: 1, group: 'Motion' },
  { key: 'spinDir', label: 'Spin direction', kind: 'select', options: ['down', 'up'], default: 'down', group: 'Motion' },
  // Transform (consumed by the engine as the view tilt)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.01, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0.12, group: 'Transform' },
  { key: 'rotateY', label: 'Rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
]

const VERT = [
  'varying vec2 vUv;',
  'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
].join('\n')

// Shared FACE shader (front + back), forked from streamer. The fill is either a gradient sampled
// along the path (uGradMode=1, tiled uGradRepeat times via vUv.x) or a tiled pattern (solid/grid/
// noise, uGradMode=0). The front face (uHasText=1) overlays text; uNoStripes=1 → text only
// (transparent elsewhere, so the black background and the gradient underside show through).
const FACE_FRAG = [
  'precision highp float;',
  'uniform sampler2D uFace; uniform float uGradMode; uniform vec2 uTile; uniform float uGradRepeat;',
  'uniform sampler2D uText; uniform float uHasText; uniform vec3 uTextColor; uniform float uTextRepeat; uniform float uNoStripes; uniform float uTextFlip;',
  'varying vec2 vUv;',
  SRGB_TO_LINEAR_GLSL,
  'void main(){',
  '  vec3 base = (uGradMode > 0.5) ? texture2D(uFace, vec2(vUv.x * uGradRepeat, 0.5)).rgb : stLin(texture2D(uFace, vUv * uTile).rgb);',
  '  if (uHasText > 0.5) {',
  // The text face's UV handedness depends on which side it rides (flips with the coil direction);
  // uTextFlip (±1) keeps the phrase reading left-to-right either way.
  '    float a = texture2D(uText, vec2(uTextFlip * vUv.x * uTextRepeat, vUv.y)).a;',
  '    if (uNoStripes > 0.5) { if (a < 0.04) discard; gl_FragColor = vec4(uTextColor, 1.0); return; }',
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
function spiralText(p: Params): string {
  const t = String(p.text ?? '').replace(/\n+/g, ' ')
  return t.length ? t : ' '
}

/** Fixed multi-stop gradient along the path (1px tall), mirrored so tiling has no hard colour jump. */
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
  t.wrapS = three.MirroredRepeatWrapping
  return t
}

type FaceMode = 'solid' | 'gradient' | 'ombre' | 'grid' | 'noise'

/** Resolve a face's paint: a path-sampled gradient ramp (gradMode 1) or a tiled pattern (gradMode 0). */
function faceTexture(three: typeof THREE, mode: FaceMode, stops: string[], fill: { a: string; b: string; density: number }, aspect: number): { tex: THREE.Texture; gradMode: number; tile: [number, number] } {
  if (mode === 'gradient') return { tex: buildGradientTexture(three, stops), gradMode: 1, tile: [1, 1] }
  const f: Fill = { type: mode as FillType, a: fill.a, b: fill.b, textColor: '#fff', angle: 45, density: Math.max(1, Math.round(fill.density)) }
  const tex = fillShaderTexture(three, f)
  if (mode === 'solid') return { tex, gradMode: 0, tile: [1, 1] }
  const base = fillTiling(f)
  return { tex, gradMode: 0, tile: [base * Math.max(1, aspect), base] }
}

interface FaceOpts {
  side: THREE.Side; faceTex: THREE.Texture; gradMode: number; tile: [number, number]; gradRepeat: number
  textTex: THREE.Texture; hasText: number; textColor: string; textRepeat: number; noStripes: number; textFlip: number
}
function makeFaceMaterial(three: typeof THREE, o: FaceOpts): THREE.ShaderMaterial {
  return new three.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FACE_FRAG, side: o.side,
    uniforms: {
      uFace: { value: o.faceTex },
      uGradMode: { value: o.gradMode },
      uTile: { value: new three.Vector2(o.tile[0], o.tile[1]) },
      uGradRepeat: { value: o.gradRepeat },
      uText: { value: o.textTex },
      uHasText: { value: o.hasText },
      uTextColor: { value: new three.Color(o.textColor) },
      uTextRepeat: { value: o.textRepeat },
      uNoStripes: { value: o.noStripes },
      uTextFlip: { value: o.textFlip },
    },
  })
}

/** Letter-spacing factor (1.0 at tracking 40, matching streamer). */
function trackScale(p: Params): number {
  return Math.min(2.2, Math.max(0.66, 1 + (n(p, 'tracking') - 40) / 100 * 1.2))
}

/** One string-unit (string + trailing gap) rendered white on transparent, tiled with RepeatWrapping
 *  so it repeats seamlessly along the helix. Mirrors streamer's text matte. Returns the texture and
 *  its pixel width so the caller can keep glyph aspect undistorted when fitting copies to the path. */
function buildTextTexture(three: typeof THREE, p: Params): { tex: THREE.CanvasTexture; texW: number } {
  const family = resolveFontFamily(String(p.font))
  const txt = spiralText(p) + ' '.repeat(Math.max(0, Math.round(n(p, 'textGap'))))
  const BASE = 64
  const cell = BASE * trackScale(p)
  const R = Math.max(1, txt.length)
  const W = Math.max(1, Math.round(R * cell)), H = BASE
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const stroke = n(p, 'typeStroke')
  const px = Math.min(BASE * (0.45 + (n(p, 'typeHeight') / 100) * 0.5), cell * 0.95)
  ctx.font = `${px}px "${family}", "Inter", sans-serif`
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'; ctx.lineJoin = 'round'
  for (let col = 0; col < R; col++) {
    const ch = txt[col]!
    const cx = col * cell + cell / 2, cy = H / 2
    if (stroke > 0) { ctx.lineWidth = stroke * 1.5; ctx.strokeText(ch, cx, cy) } else { ctx.fillText(ch, cx, cy) }
  }
  const t = new three.CanvasTexture(c)
  t.minFilter = three.LinearFilter; t.magFilter = three.LinearFilter
  t.wrapS = three.RepeatWrapping; t.wrapT = three.ClampToEdgeWrapping
  return { tex: t, texW: W }
}

interface State {
  three: typeof THREE
  textTex: THREE.CanvasTexture
  root: THREE.Group
  spin: THREE.Group       // inner group we rotate (keeps engine's scene tilt independent)
  front: THREE.ShaderMaterial
}
let state: State | null = null

export const spiralEffect: SpaceTypeEffect = {
  id: 'spiral',
  label: 'Spiral',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()
    const spin = new three.Group()
    root.add(spin)

    const radius = n(params, 'radius')
    const turns = Math.max(2, Math.round(n(params, 'turns')))
    const pitch = n(params, 'coilPitch')
    const ribbonHeight = n(params, 'ribbonHeight')

    const reverse = String(params.reverse ?? 'off') === 'on'
    const geo = buildSpiralGeometry({
      radius, turns, pitch, ribbonHeight, reverse,
      pitchTop: n(params, 'spacingTop'), pitchMid: n(params, 'spacingMid'), pitchBottom: n(params, 'spacingBottom'),
    })
    const bufferGeo = new three.BufferGeometry()
    bufferGeo.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
    bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
    bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))

    const { tex: textTex, texW } = buildTextTexture(three, params)
    // Fit a whole number of phrase copies along the helix at the glyph's natural aspect (texW:64),
    // so letters aren't stretched. Band height in world = ribbonHeight (uv.y spans it).
    const naturalWorldPerPhrase = texW * (ribbonHeight / 64)
    const textRepeat = Math.max(1, Math.round(geo.pathLen / Math.max(1, naturalWorldPerPhrase)))

    // 'text only' → transparent base (the far-side gradient / background shows through the letters);
    // 'text on band' → an opaque band colour behind the text that occludes the far side (the default,
    // matching the reference's white-on-black coils).
    const noStripes = String(params.frontMode ?? 'text on band') === 'text only' ? 1 : 0
    // Gradient repeats PER COIL: one full ramp wraps each coil at the default (gradRepeats=1), so
    // every coil shows the whole iridescent spectrum (matching the reference) regardless of coil count.
    const gradRepeat = Math.max(1, Math.round(n(params, 'gradRepeats'))) * turns
    const aspect = geo.pathLen / Math.max(1, ribbonHeight)
    const stops = gradientStops(params)
    const bandColor = String(params.bandColor ?? '#000000')

    // OUTER face: the text on an opaque band (or transparent). INNER / underside face: the underside
    // is the multi-stop holographic gradient by default, but if the first fill picks a single-fill
    // type (ombre/grid/noise/solid) the underside renders THAT instead (a/b from the fill).
    const f0 = parseFills(params.fills)[0]!
    const underMode: FaceMode = (f0.type === 'ombre' || f0.type === 'grid' || f0.type === 'noise' || f0.type === 'solid') ? f0.type : 'gradient'
    const front = faceTexture(three, 'solid', stops, { a: bandColor, b: bandColor, density: 8 }, aspect)
    const back = underMode === 'gradient'
      ? faceTexture(three, 'gradient', stops, { a: stops[0]!, b: stops[stops.length - 1]!, density: 8 }, aspect)
      : faceTexture(three, underMode, stops, { a: f0.a, b: f0.b, density: f0.density }, aspect)

    // The helix winding puts the OUTER (viewer-facing) surface on one geometric side — BackSide
    // normally, FrontSide when the coil is reversed (winding flips). Text rides the outer face (the
    // broad band); the gradient rides the inner / underside. The outer face's UV handedness also
    // flips with the winding, so textFlip (±1) keeps the phrase reading correctly either way.
    const textSide = reverse ? three.FrontSide : three.BackSide
    const gradSide = reverse ? three.BackSide : three.FrontSide
    const textFlip = reverse ? 1 : -1
    const frontMat = makeFaceMaterial(three, {
      side: textSide, faceTex: front.tex, gradMode: front.gradMode, tile: front.tile, gradRepeat,
      textTex, hasText: 1, textColor: String(params.textColor ?? '#ffffff'), textRepeat, noStripes, textFlip,
    })
    const backMat = makeFaceMaterial(three, {
      side: gradSide, faceTex: back.tex, gradMode: back.gradMode, tile: back.tile, gradRepeat,
      textTex, hasText: 0, textColor: '#000000', textRepeat: 1, noStripes: 0, textFlip: 1,
    })

    spin.add(new three.Mesh(bufferGeo, backMat))
    spin.add(new three.Mesh(bufferGeo, frontMat))

    // Frame by DIAMETER (not height): a fixed on-screen column width independent of coil count, so
    // the column overflows top/bottom and its open ends sit off-screen, like the reference. Center
    // on the helix's vertical midpoint.
    const box = new three.Box3().setFromObject(spin)
    const center = box.getCenter(new three.Vector3())
    const FRAME_DIAMETER = 5.0   // world units the column diameter maps to (camera frames ~11.6 tall)
    const norm = FRAME_DIAMETER / Math.max(2 * Math.max(0.001, radius), 1)
    root.scale.setScalar(norm)
    root.position.set(-center.x * norm, -center.y * norm, -center.z * norm)

    state = { three, textTex, root, spin, front: frontMat }
    root.userData.tex = textTex
    root.userData.tex2 = front.tex
    root.userData.tex3 = back.tex

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`40px "${family}"`).then(() => {
        if (state && state.textTex === textTex) {
          const next = buildTextTexture(three, params)
          state.front.uniforms.uText!.value = next.tex
          textTex.dispose()
          state.textTex = next.tex; root.userData.tex = next.tex
        }
      }).catch(() => {})
    }
    return root
  },

  update(t01, params) {
    if (!state) return
    // Rigid spin around the column axis. Whole turns/loop → the end orientation equals the start
    // (perfectly seamless). Because the band descends, spinning reads as a vertical barber-pole flow.
    const turnsPerLoop = Math.max(0, Math.round(n(params, 'speed')))
    const dir = String(params.spinDir ?? 'down') === 'up' ? -1 : 1
    state.spin.rotation.y = dir * t01 * turnsPerLoop * Math.PI * 2
    state.front.uniforms.uTextColor!.value.set(String(params.textColor ?? '#ffffff'))
    state.front.uniforms.uNoStripes!.value = String(params.frontMode ?? 'text on band') === 'text only' ? 1 : 0
  },
}
