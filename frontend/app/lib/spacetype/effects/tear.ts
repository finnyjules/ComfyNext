import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

/**
 * Tear — a horizontal displacement-map glitch (the After-Effects "ripple/datamosh" technique).
 *
 * The word is drawn flat on a plane; a shader pushes each pixel HORIZONTALLY by an animated,
 * repeating gradient ramp evaluated on uv.y: offset.x = (ramp(uv.y, t) − 0.5) · amount. A high
 * frequency sawtooth gives the thin sliced/torn look; a sine gives a smooth "stone in a lake"
 * ripple. The ramp scrolls over the loop (integer scrolls ⇒ seamless); a static Phase poses a
 * frozen tear at Speed 0. White-on-black by default — pairs well with the shared post-fx chroma.
 */
const controls: ControlSpec[] = [
  // TYPE.
  { key: 'text', label: 'Text', kind: 'textList', default: 'a', group: 'Type' },
  { key: 'textCase', label: 'Case', kind: 'select', options: ['upper', 'asis'], default: 'asis', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 220, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // GLITCH — the displacement map.
  { key: 'tearAmount', label: 'Amount', kind: 'slider', min: 0, max: 0.6, step: 0.01, default: 0.07, group: 'Glitch' },
  { key: 'tearFreq', label: 'Slices', kind: 'slider', min: 1, max: 90, step: 1, default: 40, group: 'Glitch' },
  { key: 'tearShape', label: 'Map', kind: 'select', options: ['ramp', 'sine'], default: 'ramp', group: 'Glitch' },
  { key: 'tearPhase', label: 'Phase (static)', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Glitch' },
  // MOTION.
  { key: 'speed', label: 'Scroll speed', kind: 'slider', min: 0, max: 8, step: 1, default: 2, group: 'Motion' },
  // TRANSFORM.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Camera rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Camera rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // COLOR.
  { key: 'textColor', label: 'Text', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#000000', group: 'Color' },
]

interface TearState { material: THREE.ShaderMaterial }
let state: TearState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const FRAG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D uText; uniform vec3 uTextColor; uniform vec3 uBg;',
  'uniform float uWf; uniform float uVMid; uniform float uVH;',  // ink box (x frac, y centre, y height)
  'uniform float uAmount; uniform float uFreq; uniform float uPhase; uniform float uSpeed; uniform float uTime; uniform float uShape;',
  'const float PI = 3.14159265;',
  'void main(){',
  '  float coord = vUv.y * uFreq + uPhase + uTime * uSpeed;',
  '  float m = (uShape < 0.5) ? fract(coord) : 0.5 + 0.5 * sin(coord * 2.0 * PI);', // ramp (sawtooth) | sine
  '  float disp = (m - 0.5) * uAmount;',
  '  const float P = 0.12;',                       // black margin around the glyph (in ink widths)
  '  float planeX = vUv.x + disp;',                // displaced plane-x
  '  float tx = uWf * (planeX * (1.0 + 2.0 * P) - P);', // inset the glyph so displaced edges hit black
  '  float ty = uVMid - uVH * 0.5 + vUv.y * uVH;',     // map plane-y → the glyph ink box
  '  float a = (tx < 0.0 || tx > uWf) ? 0.0 : texture2D(uText, vec2(tx, ty)).a;',
  '  vec3 col = mix(uBg, uTextColor, a);',
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);', // linear→sRGB (ShaderMaterial)
  '}',
].join('\n')

export const tearEffect: SpaceTypeEffect = {
  id: 'tear',
  label: 'Tear',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()

    const tex = textTexture.clone()
    tex.wrapS = tex.wrapT = three.ClampToEdgeWrapping
    tex.needsUpdate = true
    const ud = textTexture.userData ?? {}
    const img = textTexture.image as { width?: number; height?: number } | undefined
    const texAspect = Math.max(0.1, (img?.width ?? 1) / (img?.height ?? 1))
    // Sample only the glyph INK box: x ∈ [0, wf] (word ÷ tile, drops the trailing gap), y centred
    // on the letters' actual vertical extent (so short lowercase glyphs aren't stretched).
    const wf = Number((ud.wordInkFracs as number[] | undefined)?.[0] ?? 1) || 1
    const inkVH = Math.max(0.05, Number(ud.inkHeightFrac ?? 0.6))
    const inkVMid = Number(ud.inkVMid ?? 0.5)
    // True ink aspect, then CONTAIN it in a ~square frame box so any word/letter fits without
    // distortion (wide words shrink to fit width; tall/narrow ones fit height).
    const inkAspect = Math.max(0.05, (wf * texAspect) / inkVH)
    const BOX = 9
    const planeW = inkAspect >= 1 ? BOX : BOX * inkAspect
    const planeH = inkAspect >= 1 ? BOX / inkAspect : BOX

    const geo = new three.PlaneGeometry(planeW, planeH)
    const material = new three.ShaderMaterial({
      side: three.DoubleSide,
      uniforms: {
        uText: { value: tex },
        uTextColor: { value: new three.Color(String(params.textColor)) },
        uBg: { value: new three.Color(String(params.bgColor)) },
        uWf: { value: wf }, uVMid: { value: inkVMid }, uVH: { value: inkVH },
        uAmount: { value: 0.12 }, uFreq: { value: 34 }, uPhase: { value: 0 },
        uSpeed: { value: 2 }, uTime: { value: 0 }, uShape: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    const mesh = new three.Mesh(geo, material)
    mesh.userData.tex = tex
    root.add(mesh)

    state = { material }
    tearEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const u = s.material.uniforms
    u.uTime!.value = t01
    u.uAmount!.value = Math.max(0, n(params, 'tearAmount'))
    u.uFreq!.value = Math.max(1, n(params, 'tearFreq'))
    u.uPhase!.value = n(params, 'tearPhase')
    u.uSpeed!.value = Math.round(n(params, 'speed'))   // integer scrolls/loop → seamless
    u.uShape!.value = String(params.tearShape) === 'sine' ? 1 : 0
    ;(u.uTextColor!.value as THREE.Color).set(String(params.textColor))
    ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
  },
}
