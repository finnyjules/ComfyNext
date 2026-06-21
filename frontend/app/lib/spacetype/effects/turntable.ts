import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills, fillShaderTexture, fillTiling } from '../fills'

/**
 * Turntable — flat repeated text displaced by concentric rotating bands (a vinyl/record swirl).
 *
 * The disc is built as N concentric RING meshes (one per band). Each ring carries its own FILL
 * (cycled from the fills list — solid/gradient/ombre/grid/noise/… via the shared fill rails) as a
 * STATIC background, and a polar shader composites the text on top after ROTATING the text lookup
 * by that band's angle Δₖ = 2π·(mₖ·t + twist·gradₖ). Integer turns mₖ (inner↔outer gradient) make
 * the loop seamless; the static `twist` term poses a frozen swirl at Speed 0.
 *
 * Keys: `speed`/`direction` reuse the shared live keys; `ttCols`/`ttRows`/`ttGradient`/`ttTwist`
 * are namespaced live uniforms. `ttRings` is STRUCTURAL here (it changes the mesh count → rebuild).
 */
const controls: ControlSpec[] = [
  // TYPE.
  { key: 'text', label: 'Text', kind: 'textList', default: 'Rotation', group: 'Type' },
  { key: 'textCase', label: 'Case', kind: 'select', options: ['upper', 'asis'], default: 'asis', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // DISC + bands.
  { key: 'radius', label: 'Radius', kind: 'slider', min: 2, max: 10, step: 0.1, default: 5, group: 'Ribbon' },
  { key: 'ttRings', label: 'Rings', kind: 'slider', min: 1, max: 24, step: 1, default: 6, group: 'Ribbon' },
  { key: 'ttCols', label: 'Columns', kind: 'slider', min: 0.5, max: 12, step: 0.5, default: 1.5, group: 'Ribbon' },
  { key: 'ttRows', label: 'Words per column', kind: 'slider', min: 1, max: 20, step: 0.5, default: 7, group: 'Ribbon' },
  // MOTION.
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 8, step: 1, default: 2, group: 'Motion' },
  { key: 'ttGradient', label: 'Speed gradient', kind: 'slider', min: -4, max: 4, step: 0.1, default: 1.5, group: 'Motion' },
  { key: 'ttTwist', label: 'Twist (static)', kind: 'slider', min: -3, max: 3, step: 0.05, default: 0, group: 'Motion' },
  { key: 'direction', label: 'Direction', kind: 'select', options: ['cw', 'ccw'], default: 'cw', group: 'Motion' },
  // TRANSFORM.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Camera rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Camera rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Disc rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // COLOR — one fill PER CONCENTRIC BAND (cycled): band background (a/b/type) + text colour.
  { key: 'fills', label: 'Bands', kind: 'fillList', default: '[{"type":"solid","a":"#000000","b":"#000000","textColor":"#ffffff"}]', group: 'Color' },
]

interface TurntableState { materials: THREE.ShaderMaterial[] }
let state: TurntableState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

const VERT = 'varying vec2 vPos; void main(){ vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const FRAG = [
  'precision highp float;',
  'varying vec2 vPos;',
  'uniform sampler2D uAtlas; uniform sampler2D uFill;',
  'uniform float uFillTiling; uniform vec3 uTextColor;',
  'uniform float uRadius; uniform float uCols; uniform float uRows;',
  'uniform float uBand; uniform float uRingsN;',
  'uniform float uSpeed; uniform float uGradient; uniform float uDir; uniform float uTime; uniform float uTwist;',
  'const float PI = 3.14159265;',
  'void main(){',
  '  vec2 ph = vPos / (2.0 * uRadius);',          // -0.5..0.5 at the disc edge
  '  float r = length(ph) * 2.0;',                 // 0 centre → 1 edge
  '  float k = uBand;',
  '  float kn = (uRingsN > 1.0) ? k / (uRingsN - 1.0) : 0.0;',
  '  float m = floor(uSpeed * (1.0 + uGradient * kn) + 0.5);',     // INTEGER turns/loop → seamless
  '  float turns = m * uTime + uTwist * (1.0 + uGradient * kn);',  // + static twist (constant in t)
  '  float ang = uDir * 2.0 * PI * turns;',
  '  float c = cos(-ang), s = sin(-ang);',          // rotate the TEXT lookup by the band angle
  '  vec2 rp = vec2(ph.x * c - ph.y * s, ph.x * s + ph.y * c) + 0.5;',
  '  float a = texture2D(uAtlas, vec2(rp.x * uCols, rp.y * uRows)).a;',
  '  float theta = atan(ph.y, ph.x);',              // STATIC fill for this band (no rotation)
  '  float bandInner = k / uRingsN, bandOuter = (k + 1.0) / uRingsN;',
  '  float fv = clamp((r - bandInner) / max(1e-4, bandOuter - bandInner), 0.0, 1.0);',
  '  float fu = (theta + PI) / (2.0 * PI);',
  '  vec3 fillc = texture2D(uFill, vec2(fu, fv) * uFillTiling).rgb;', // SRGB-tagged → returns linear
  '  vec3 col = mix(fillc, uTextColor, a);',
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
    const rings = Math.max(1, Math.round(n(params, 'ttRings')))
    const fills = parseFills(params.fills)

    // One shared text atlas. The per-band rotation is discontinuous at band edges, so the GPU UV
    // derivative spikes there — disable mipmaps so sampling never drops to a coarse level (dashed
    // ring artifact). RepeatWrapping for the flat-text grid tiling.
    const atlas = textTexture.clone()
    atlas.wrapS = atlas.wrapT = three.RepeatWrapping
    atlas.minFilter = three.LinearFilter
    atlas.generateMipmaps = false
    atlas.needsUpdate = true

    const materials: THREE.ShaderMaterial[] = []
    for (let k = 0; k < rings; k++) {
      const innerR = (k / rings) * radius
      const outerR = ((k + 1) / rings) * radius
      const geo = new three.RingGeometry(innerR, outerR, 128, 1)

      const fill = fills[k % fills.length]!
      const material = new three.ShaderMaterial({
        side: three.DoubleSide,
        uniforms: {
          uAtlas: { value: atlas },
          uFill: { value: fillShaderTexture(three, fill) },
          uFillTiling: { value: fillTiling(fill) },
          uTextColor: { value: new three.Color(fill.textColor) },
          uRadius: { value: radius }, uCols: { value: 1.5 }, uRows: { value: 7 },
          uBand: { value: k }, uRingsN: { value: rings },
          uSpeed: { value: 2 }, uGradient: { value: 1.5 }, uDir: { value: 1 },
          uTime: { value: 0 }, uTwist: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
      })
      const mesh = new three.Mesh(geo, material)
      if (k === 0) mesh.userData.tex = atlas   // free the cloned atlas once on rebuild
      root.add(mesh)
      materials.push(material)
    }

    state = { materials }
    turntableEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const speed = Math.max(0, n(params, 'speed'))
    const gradient = n(params, 'ttGradient')
    const dir = String(params.direction) === 'ccw' ? -1 : 1
    const twist = n(params, 'ttTwist')
    const cols = Math.max(0.1, n(params, 'ttCols'))
    const rows = Math.max(0.25, n(params, 'ttRows'))
    for (const u of s.materials) {
      u.uniforms.uTime!.value = t01
      u.uniforms.uSpeed!.value = speed
      u.uniforms.uGradient!.value = gradient
      u.uniforms.uDir!.value = dir
      u.uniforms.uTwist!.value = twist
      u.uniforms.uCols!.value = cols
      u.uniforms.uRows!.value = rows
    }
  },
}
