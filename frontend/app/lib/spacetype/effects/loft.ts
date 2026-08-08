import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseStops, DEFAULT_STOPS_JSON, type LoftStop } from '../loftStops'
import {
  sampleSpine, interpStopProps, parametricProfileContour, resampleContour,
  buildLoftGeometry, buildRamp, type Vec2,
} from '../loftGeometry'

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
  { key: 'profileKind', label: 'Profile', kind: 'select', options: ['shape', 'word'], default: 'shape', group: 'Style' },
  // word-mode fields (revealed via showIf on profileKind)
  { key: 'text', label: 'Word', kind: 'text', default: 'LOFT', group: 'Style', showIf: { key: 'profileKind', equals: 'word' } },
  { key: 'font', label: 'Font', kind: 'font', default: 'google:Archivo Black@700', group: 'Style', showIf: { key: 'profileKind', equals: 'word' } },
  { key: 'render', label: 'Render', kind: 'select', options: ['stroke', 'fill'], default: 'fill', group: 'Style' },
  { key: 'strokeOpacity', label: 'Stroke opacity', kind: 'slider', min: 0.02, max: 1, step: 0.02, default: 0.4, group: 'Style', showIf: { key: 'render', equals: 'stroke' } },
  { key: 'fillOpacity', label: 'Fill opacity', kind: 'slider', min: 0.05, max: 1, step: 0.05, default: 1, group: 'Style', showIf: { key: 'render', equals: 'fill' } },
  { key: 'mode', label: 'Space', kind: 'select', options: ['3d', 'flat'], default: '3d', group: 'Style' },
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

/** Build the cross-section contours for these params. Shape kind only here; word mode overrides
 *  `baseContours` in buildScene. Exported for unit tests. */
export function loftContours(params: Params, stops: LoftStop[]): Vec2[][] {
  const props = interpStopProps(stops, 0)
  return [resampleContour(parametricProfileContour(props, PROFILE_POINTS), PROFILE_POINTS)]
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
    const baseContours = loftContours(params, flatStops)          // word mode replaces this in Task 8

    const render = String(params.render) === 'stroke' ? 'stroke' : 'fill'
    const geo = buildLoftGeometry({ stations, props, baseContours, closed, render })

    const g = new three.BufferGeometry()
    g.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
    g.setAttribute('aAlong', new three.BufferAttribute(geo.along, 1))
    g.setIndex(new three.BufferAttribute(geo.indices, 1))

    // Uint8Array(...) copy: three's DataTexture types data as BufferSource (concrete ArrayBuffer);
    // buildRamp's bare Uint8ClampedArray return widens to <ArrayBufferLike> under TS 5.7+ libs.
    const ramp = new three.DataTexture(new Uint8Array(buildRamp(stops, 256)), 256, 1, three.RGBAFormat)
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
    root.userData.loftGeo = g
    root.userData.loftRamp = ramp
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
