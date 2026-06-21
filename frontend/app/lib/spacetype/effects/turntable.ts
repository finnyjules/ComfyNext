import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

/**
 * Turntable — flat repeated text displaced by concentric rotating bands (a vinyl/record swirl).
 *
 * The word is tiled flat in a grid (cols × rows) filling a disc. A polar shader then splits the
 * disc into N concentric BANDS; a pixel in band k has its texture lookup ROTATED around the centre
 * by Δₖ = 2π·mₖ·t. The integer turn counts mₖ follow an inner↔outer speed gradient, so neighbouring
 * bands shear the flat text past each other — and because each band turns a whole number of times
 * over the loop, the motion is seamless (a 2π rotation lands the text back on itself).
 *
 * Keys: most params are live shader uniforms (no rebuild). `speed`/`direction` reuse the shared
 * live keys; `ttRings`/`ttRows`/`ttGradient` are namespaced so they don't collide with other
 * effects' `rings`/`rows` in the surface's live-param exclusion list.
 */
const controls: ControlSpec[] = [
  // TYPE — shared text controls.
  { key: 'text', label: 'Text', kind: 'textList', default: 'Rotation', group: 'Type' },
  { key: 'textCase', label: 'Case', kind: 'select', options: ['upper', 'asis'], default: 'asis', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // DISC + bands (under the suite's geometry section, 'Ribbon').
  { key: 'radius', label: 'Radius', kind: 'slider', min: 2, max: 10, step: 0.1, default: 5, group: 'Ribbon' },
  { key: 'ttRings', label: 'Rings', kind: 'slider', min: 1, max: 24, step: 1, default: 6, group: 'Ribbon' },
  // Grid tiling of the flat text: Columns across × Words-per-column down. Fractional steps let
  // you trade word size vs proportion (a wide word looks natural near Columns ≈ Rows ÷ word-aspect).
  { key: 'ttCols', label: 'Columns', kind: 'slider', min: 0.5, max: 12, step: 0.5, default: 1.5, group: 'Ribbon' },
  { key: 'ttRows', label: 'Words per column', kind: 'slider', min: 1, max: 20, step: 0.5, default: 7, group: 'Ribbon' },
  // MOTION.
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 8, step: 1, default: 2, group: 'Motion' },
  { key: 'ttGradient', label: 'Speed gradient', kind: 'slider', min: -4, max: 4, step: 0.1, default: 1.5, group: 'Motion' },
  // Static per-band rotation (shaped by the same gradient): pose a frozen swirl at Speed 0,
  // or bias the starting offset when animating. Constant over the loop ⇒ still seamless.
  { key: 'ttTwist', label: 'Twist (static)', kind: 'slider', min: -3, max: 3, step: 0.05, default: 0, group: 'Motion' },
  { key: 'direction', label: 'Direction', kind: 'select', options: ['cw', 'ccw'], default: 'cw', group: 'Motion' },
  // TRANSFORM — camera view (applied by the engine to the whole scene).
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Camera rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Camera rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Disc rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // COLOR.
  { key: 'textColor', label: 'Text', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#000000', group: 'Color' },
]

interface TurntableState { material: THREE.ShaderMaterial }
let state: TurntableState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const FRAG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D uAtlas;',
  'uniform vec3 uText; uniform vec3 uBg;',
  'uniform float uCols; uniform float uRows;',
  'uniform float uRings; uniform float uSpeed; uniform float uGradient; uniform float uDir; uniform float uTime; uniform float uTwist;',
  'const float PI = 3.14159265;',
  'void main(){',
  '  vec2 p = vUv - 0.5;',           // centred; uv is the disc's bounding square
  '  float r = length(p) * 2.0;',     // 0 at centre → 1 at the disc edge
  '  if (r > 1.0) discard;',          // clip to the circle
  '  float N = max(1.0, floor(uRings + 0.5));',
  '  float k = floor(clamp(r, 0.0, 0.9999) * N);',          // concentric band index
  '  float kn = (N > 1.0) ? k / (N - 1.0) : 0.0;',          // 0 (centre) → 1 (edge)
  '  float m = floor(uSpeed * (1.0 + uGradient * kn) + 0.5);', // INTEGER turns/loop → seamless
  '  float turns = m * uTime + uTwist * (1.0 + uGradient * kn);', // animated turns + static twist (constant in t)
  '  float ang = uDir * 2.0 * PI * turns;',
  '  float c = cos(-ang), s = sin(-ang);',                  // rotate the LOOKUP by the band angle
  '  vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + 0.5;',
  '  float a = texture2D(uAtlas, vec2(rp.x * uCols, rp.y * uRows)).a;', // glyph coverage (atlas alpha)
  '  vec3 col = mix(uBg, uText, a);',
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);', // linear→sRGB (ShaderMaterial)
  '}',
].join('\n')

export const turntableEffect: SpaceTypeEffect = {
  id: 'turntable',
  label: 'Turntable',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const radius = Math.max(0.5, n(params, 'radius'))

    // Flat repeated-text base: tile the atlas in both axes (cols derived per-frame from rows).
    const tex = textTexture.clone()
    tex.wrapS = tex.wrapT = three.RepeatWrapping
    // The per-band rotation is DISCONTINUOUS at band edges, so the GPU's UV derivative spikes
    // there and mipmapping drops to the coarsest level → faint dashed rings on the seams. Force
    // the base level (no mipmaps) so the sample never depends on that derivative.
    tex.minFilter = three.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true

    const material = new three.ShaderMaterial({
      side: three.DoubleSide,
      uniforms: {
        uAtlas: { value: tex },
        uText: { value: new three.Color(String(params.textColor)) },
        uBg: { value: new three.Color(String(params.bgColor)) },
        uCols: { value: 1 }, uRows: { value: 7 },
        uRings: { value: 6 }, uSpeed: { value: 2 }, uGradient: { value: 1.5 }, uDir: { value: 1 },
        uTime: { value: 0 }, uTwist: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })

    const mesh = new three.Mesh(new three.CircleGeometry(radius, 128), material)
    mesh.userData.tex = tex   // so disposeRoot() frees the cloned texture on rebuild
    root.add(mesh)

    state = { material }
    turntableEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const u = s.material.uniforms
    u.uTime!.value = t01
    u.uSpeed!.value = Math.max(0, n(params, 'speed'))
    u.uGradient!.value = n(params, 'ttGradient')
    u.uDir!.value = String(params.direction) === 'ccw' ? -1 : 1
    u.uTwist!.value = n(params, 'ttTwist')
    u.uRings!.value = Math.max(1, Math.round(n(params, 'ttRings')))
    u.uRows!.value = Math.max(0.25, n(params, 'ttRows'))
    u.uCols!.value = Math.max(0.1, n(params, 'ttCols'))
    ;(u.uText!.value as THREE.Color).set(String(params.textColor))
    ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
  },
}
