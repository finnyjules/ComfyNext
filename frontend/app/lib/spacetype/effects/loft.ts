import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseStops, DEFAULT_STOPS_JSON } from '../loftStops'
import {
  sampleSpine, interpStopProps, resampleContour,
  buildLoftGeometry, buildRamp, shapeContour, rampFromFill, buildSlicedLoftGeometry,
  type Vec2, type LoftShape,
} from '../loftGeometry'
import { textOutline, fontCacheGet, fontSourceUrl, type Font } from '~/lib/scene3d/outlines'

/**
 * LOFT — sweep a keyframed cross-section (a parametric shape or, in word mode, a word's glyph
 * outlines) along an editable 3D bezier spine defined by a list of "stops". Renders as dense
 * stroked outlines or a solid skinned surface, with a colour gradient (a ramp texture) running
 * along the sweep, offset live by `flow`. Ignores the baked text texture; word mode builds real
 * outline contours from the font cache instead. Reference set: iridescent spirals, gradient
 * ribbons, lofted tubes.
 */

const PROFILE_POINTS = 48   // vertices resampled per contour

const controls: ControlSpec[] = [
  { key: 'stops', label: 'Stops', kind: 'profileStops', default: DEFAULT_STOPS_JSON, group: 'Layout' },
  { key: 'spinePreset', label: 'Spine preset', kind: 'select', options: ['custom', 'helix', 'wave', 'arch', 's-curve', 'loop'], default: 'helix', group: 'Layout' },
  { key: 'closed', label: 'Closed loop', kind: 'switch', default: false, group: 'Layout' },
  { key: 'copies', label: 'Copies', kind: 'slider', min: 6, max: 400, step: 1, default: 120, group: 'Layout' },
  { key: 'spacing', label: 'Spacing', kind: 'slider', min: 0, max: 0.9, step: 0.02, default: 0.35, group: 'Layout' },
  // shape picker replaces the old profileKind — word is now one of the shape options
  { key: 'shape', label: 'Shape', kind: 'select', options: ['oval', 'capsule', 'rectangle', 'polygon', 'star', 'word'], default: 'oval', group: 'Style' },
  { key: 'rectRadius', label: 'Corner radius', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.4, group: 'Style', showIf: { key: 'shape', equals: 'rectangle' } },
  { key: 'polySides', label: 'Sides', kind: 'slider', min: 3, max: 16, step: 1, default: 5, group: 'Style', showIf: { key: 'shape', equals: 'polygon' } },
  { key: 'starSides', label: 'Points', kind: 'slider', min: 3, max: 16, step: 1, default: 5, group: 'Style', showIf: { key: 'shape', equals: 'star' } },
  { key: 'starDepth', label: 'Star depth', kind: 'slider', min: 0, max: 0.9, step: 0.02, default: 0.5, group: 'Style', showIf: { key: 'shape', equals: 'star' } },
  // word-mode fields (revealed via showIf on shape)
  { key: 'text', label: 'Word', kind: 'text', default: 'LOFT', group: 'Style', showIf: { key: 'shape', equals: 'word' } },
  { key: 'font', label: 'Font', kind: 'font', default: 'google:Archivo Black@700', group: 'Style', showIf: { key: 'shape', equals: 'word' } },
  { key: 'render', label: 'Render', kind: 'select', options: ['stroke', 'fill'], default: 'fill', group: 'Style' },
  { key: 'strokeOpacity', label: 'Stroke opacity', kind: 'slider', min: 0.02, max: 1, step: 0.02, default: 0.4, group: 'Style', showIf: { key: 'render', equals: 'stroke' } },
  { key: 'fillOpacity', label: 'Fill opacity', kind: 'slider', min: 0.05, max: 1, step: 0.05, default: 1, group: 'Style', showIf: { key: 'render', equals: 'fill' } },
  { key: 'mode', label: 'Space', kind: 'select', options: ['3d', 'flat'], default: '3d', group: 'Style' },
  { key: 'colorSource', label: 'Colour source', kind: 'select', options: ['fill', 'stops'], default: 'fill', group: 'Color' },
  // Default to an ombre (smooth A→B) fill so a fresh loft shows a gradient along the sweep,
  // matching the "oval + gradient" default choice — the shared palette has no 'gradient' type,
  // and rampFromFill maps ombre A→B the same way.
  { key: 'fills', label: 'Fill', kind: 'fillList', default: JSON.stringify([{ type: 'ombre', a: '#3b5bff', b: '#ff2ea6', textColor: '#ffffff', angle: 90, density: 8 }]), group: 'Color', showIf: { key: 'colorSource', equals: 'fill' } },
  { key: 'fillMode', label: 'Fill mode', kind: 'select', options: ['blend', 'steps'], default: 'blend', group: 'Color', showIf: { key: 'colorSource', equals: 'fill' } },
  { key: 'flow', label: 'Flow', kind: 'slider', min: 0, max: 4, step: 1, default: 0, group: 'Motion' },
  { key: 'spin', label: 'Spin', kind: 'slider', min: 0, max: 4, step: 1, default: 0, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0.2, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0.4, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

interface LoftState { mat: THREE.ShaderMaterial }

function n(p: Params, k: string): number { return Number(p[k]) }

const VERT = `
attribute float aAlong;
varying float vAlong;
void main() { vAlong = aAlong; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const FRAG = `
uniform sampler2D uRamp;
uniform float uFlow;
uniform float uOpacity;
varying float vAlong;
void main() {
  float u = fract(vAlong + uFlow);
  vec3 c = texture2D(uRamp, vec2(u, 0.5)).rgb;
  gl_FragColor = vec4(c, uOpacity);
}
`

/** Coerce a font value into something the scene3d opentype outline loader can fetch.
 *  google: values and real local paths pass through; a bare family name (e.g. 'Inter',
 *  carried over from another effect via CARRY_ON_SWITCH) becomes `google:<family>` so the
 *  proxy can serve a TTF. Empty → the loft word default.
 *  NOTE: a `var:` variable-font id is not handled — not a realistic value for this control's
 *  `kind:'font'` picker, which only ever emits bare families or `google:Fam@W`. */
export function outlineFontValue(font: string | undefined): string {
  const v = String(font ?? '').trim()
  if (!v) return 'google:Archivo Black@700'
  if (v.startsWith('google:') || v.includes('/')) return v
  return 'google:' + v
}

/** Migrate the old `profileKind` control ('shape'|'word') to the new `shape` control
 *  (oval/capsule/rectangle/polygon/star/word). Returns the raw `shape` value when it's one of
 *  the valid options; otherwise falls back to migrating `profileKind` ('word'→'word', else
 *  'oval'). Exported for unit tests. */
export function resolveShape(params: Params): LoftShape | 'word' {
  const s = String(params.shape ?? '')
  if (['oval', 'capsule', 'rectangle', 'polygon', 'star', 'word'].includes(s)) return s as LoftShape | 'word'
  const pk = String(params.profileKind ?? '')   // migrate old docs
  return pk === 'word' ? 'word' : 'oval'
}

/**
 * Flatten THREE.Shape[] (outer + holes) into resampled unit-space contours centred on origin.
 * A glyph with a counter (e.g. 'o') produces TWO raw contours — its outer bowl and its hole —
 * and `buildLoftGeometry` indexes every contour by ONE shared point count derived from
 * `baseContours[0].length`, so every contour returned here MUST be resampled to the same
 * `points` (carried forward from Task 4's review: an unequal-length contour reads out of
 * bounds). Exported for unit tests.
 */
export function wordContoursFromShapes(three: typeof THREE, shapes: THREE.Shape[], points: number): Vec2[][] {
  const raw: Vec2[][] = []
  for (const shape of shapes) {
    raw.push(shape.getPoints(points).map(p => ({ x: p.x, y: p.y })))
    for (const hole of shape.holes) raw.push(hole.getPoints(points).map(p => ({ x: p.x, y: p.y })))
  }
  if (!raw.length) return []
  // normalise to unit box (max extent → 1), centred
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of raw) for (const p of c) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const scale = 2 / Math.max(maxX - minX, maxY - minY, 1e-6)
  return raw.map(c => resampleContour(c.map(p => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })), points))
}

/**
 * Word cross-section for the current params, or null when the font isn't cached yet — buildScene
 * MUST stay synchronous, so this reads `fontCacheGet` (a sync peek) rather than awaiting
 * `loadFont`; the host (SpaceTypeSurface's `ensureEffectFonts`) is what actually warms the
 * cache and re-triggers a rebuild once the font lands. Exported for unit tests.
 */
export function wordContours(three: typeof THREE, params: Params, points: number): Vec2[][] | null {
  const value = String(params.font || '')
  const font = fontCacheGet(fontSourceUrl(outlineFontValue(value))) as Font | null
  if (!font) return null
  const shapes = textOutline(String(params.text || ' '), font, { size: 1, letterSpacing: 0 })
  if (!shapes.length) return null
  return wordContoursFromShapes(three, shapes, points)
}

export const loftEffect: SpaceTypeEffect = {
  id: 'loft',
  label: 'Loft',
  controls,
  liveKeys: ['flow', 'spin'],

  buildScene(three, params, _textTexture, env) {
    void _textTexture; void env
    const root = new three.Group()
    const stops = parseStops(params.stops)
    const closed = Boolean(params.closed)
    const flat = String(params.mode) === 'flat'
    const flatStops = flat ? stops.map(s => ({ ...s, z: 0 })) : stops

    const K = Math.max(2, Math.floor(n(params, 'copies')))
    const stations = sampleSpine(flatStops, closed, K)
    const props = stations.map(st => interpStopProps(flatStops, st.t))
    // Word mode: sweep the word's glyph outlines instead of the parametric shape. buildScene
    // stays SYNCHRONOUS — wordContours only ever reads the font from the sync `fontCacheGet`
    // peek, never awaits `loadFont` — so on a cold cache it falls back to a plain oval contour
    // for one rebuild until the host (SpaceTypeSurface's `ensureEffectFonts`, awaited before
    // every rebuild call site) warms the cache and reschedules a rebuild; the async font work
    // never happens inside buildScene itself.
    // NOTE (fast-follow, not built here): a word swept perpendicular to a FLAT spine degenerates
    // toward a line, since the profile plane is orthogonal to the (z=0) sweep direction — word
    // mode is 3D-primary. Flat+word still renders (falls through to the same framing as shape
    // mode) rather than crashing; camera-facing framing for that combination is left for later.
    const shape = resolveShape(params)
    const shapeParams = { rectRadius: n(params, 'rectRadius'), polySides: shape === 'star' ? n(params, 'starSides') : n(params, 'polySides'), starDepth: n(params, 'starDepth') }
    const baseContours = shape === 'word'
      ? (wordContours(three as any, params, PROFILE_POINTS) ?? [shapeContour('oval', shapeParams, PROFILE_POINTS)])
      : [shapeContour(shape, shapeParams, PROFILE_POINTS)]

    const render = String(params.render) === 'stroke' ? 'stroke' : 'fill'
    const spacing = n(params, 'spacing')
    // Copies now drives both densities: continuous surface resolution (K, above) when spacing is
    // 0, and ring count when spacing > 0 — one slider, no separate Elements control.
    const geo = spacing > 0
      ? buildSlicedLoftGeometry({ stations, props, baseContours, closed, render, elements: Math.max(2, Math.round(n(params, 'copies'))), spacing })
      : buildLoftGeometry({ stations, props, baseContours, closed, render })

    const g = new three.BufferGeometry()
    g.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
    g.setAttribute('aAlong', new three.BufferAttribute(geo.along, 1))
    g.setIndex(new three.BufferAttribute(geo.indices, 1))

    // Uint8Array(...) copy: three's DataTexture types data as BufferSource (concrete ArrayBuffer);
    // buildRamp/rampFromFill's bare Uint8ClampedArray return widens to <ArrayBufferLike> under TS 5.7+ libs.
    const rampBytes = String(params.colorSource) === 'stops'
      ? buildRamp(stops, 256)
      : rampFromFill(three as any, String(params.fills ?? ''), 256, String(params.fillMode) === 'steps' ? 'steps' : 'blend')
    const ramp = new three.DataTexture(new Uint8Array(rampBytes), 256, 1, three.RGBAFormat)
    ramp.needsUpdate = true
    const opacity = render === 'stroke' ? n(params, 'strokeOpacity') : n(params, 'fillOpacity')
    const mat = new three.ShaderMaterial({
      uniforms: { uRamp: { value: ramp }, uFlow: { value: 0 }, uOpacity: { value: opacity } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: render === 'fill' && opacity >= 1,
      side: three.DoubleSide,
    })

    const obj = render === 'stroke' ? new three.LineSegments(g, mat) : new three.Mesh(g, mat)
    obj.frustumCulled = false
    root.add(obj)
    root.userData.tex = ramp
    root.userData.loftState = { mat } satisfies LoftState
    return root
  },

  update(t01, params, root) {
    const s = root?.userData?.loftState as LoftState | undefined
    if (!s) return
    const flow = n(params, 'flow') || 0
    const spin = n(params, 'spin') || 0
    s.mat.uniforms.uFlow!.value = flow > 0 ? t01 * flow : 0
    if (root) root.rotation.y = spin > 0 ? t01 * spin * 2 * Math.PI : 0
  },

  loopRates(params) {
    const r: number[] = []
    const flow = Math.round(n(params, 'flow') || 0); if (flow > 0) r.push(flow)
    const spin = Math.round(n(params, 'spin') || 0); if (spin > 0) r.push(spin)
    return r
  },
}
