import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

/**
 * Tear — a sliced / fluted-glass displacement effect.
 *
 * A procedural displacement map of repeating STRIPES (each a black→white linear ramp) is sampled per
 * pixel and used to offset the text along ONE axis (the same axis the stripes vary on — so the text
 * bends within each slice, like ribbed/fluted glass). Vertical stripes (Direction = vertical) bend
 * the text horizontally; horizontal stripes bend it vertically. The map pans over the loop (integer
 * periods/loop ⇒ seamless); a static Phase poses a frozen slice. Map shapes: ramp (sawtooth, hard
 * slices) | ripple (sine, smooth bend) | slabs (rigid per-stripe offset). Optional Edge bevel makes
 * the slices read as thick glass; Overlap adds a translucent ghost for a shattered look.
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
  { key: 'tearStyle', label: 'Map', kind: 'select', options: ['ramp', 'ripple', 'slabs'], default: 'ramp', group: 'Glitch' },
  { key: 'tearDir', label: 'Direction', kind: 'select', options: ['vertical', 'horizontal'], default: 'vertical', group: 'Glitch' },
  { key: 'tearAmount', label: 'Amount', kind: 'slider', min: 0, max: 0.6, step: 0.005, default: 0.05, group: 'Glitch' },
  { key: 'tearFreq', label: 'Slices', kind: 'slider', min: 1, max: 90, step: 1, default: 12, group: 'Glitch' },
  { key: 'tearSlant', label: 'Slant', kind: 'slider', min: -3, max: 3, step: 0.05, default: 0, group: 'Glitch' },
  { key: 'tearEdge', label: 'Edge / bevel', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Glitch' },
  { key: 'tearOverlap', label: 'Overlap (ghost)', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Glitch' },
  { key: 'tearPhase', label: 'Phase (static)', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Glitch' },
  // MOTION — pan the displacement map.
  { key: 'speed', label: 'Pan speed', kind: 'slider', min: 0, max: 8, step: 1, default: 2, group: 'Motion' },
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
  'uniform float uWf; uniform float uVMid; uniform float uVH;',       // glyph placement in the tile
  'uniform float uAmount; uniform float uFreq; uniform float uPhase; uniform float uSpeed; uniform float uTime;',
  'uniform float uStyle; uniform float uDir; uniform float uEdge; uniform float uOverlap; uniform float uSlant;',
  'const float PI = 3.14159265;',
  'float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }',
  // Centre the glyph in the plane (small margin); tile is transparent above/below/right, only the
  // left needs a clip. Sample coords clamped so ClampToEdge never streaks an edge column.
  'float inkA(vec2 p){',
  '  float tx = (p.x - 0.5) * uWf * 1.55 + uWf * 0.5;',                // ~26% black margin each side
  '  float ty = uVMid + (p.y - 0.5) * uVH * 1.55;',                    // so edge slices refract into black
  '  float a = texture2D(uText, vec2(clamp(tx, 0.0, 1.0), clamp(ty, 0.0, 1.0))).a;',
  '  return a * step(0.0, tx) * step(tx, uWf) * step(0.0, ty) * step(ty, 1.0);',
  '}',
  'void main(){',
  // Displacement MAP: repeating stripes along the flute axis (vertical stripes vary on x). Slant
  // shears the slice coordinate by the perpendicular axis so the slices tilt diagonally.
  '  float axis = (uDir < 0.5) ? (vUv.x + (vUv.y - 0.5) * uSlant) : (vUv.y + (vUv.x - 0.5) * uSlant);',
  '  float coord = axis * uFreq + uPhase + uTime * uSpeed;',
  '  float mlum;',
  '  if (uStyle < 0.5) mlum = fract(coord);',                          // ramp: black→white ramp per stripe
  '  else if (uStyle < 1.5) mlum = 0.5 + 0.5 * sin(coord * 2.0 * PI);', // ripple: smooth
  '  else mlum = hash(floor(coord));',                                  // slabs: rigid per stripe
  '  float disp = (mlum - 0.5) * uAmount;',                            // black shifts -, white shifts +
  // Offset the text along the SAME axis the stripes vary on (X for vertical flutes).
  '  vec2 puv = vUv; if (uDir < 0.5) puv.x += disp; else puv.y += disp;',
  '  float a = inkA(puv);',
  '  if (uOverlap > 0.001) {',
  '    vec2 g = vUv; if (uDir < 0.5) g.x += disp * 2.0; else g.y += disp * 2.0;',
  '    a = max(a, inkA(g) * uOverlap);',
  '  }',
  '  vec3 col = mix(uBg, uTextColor, a);',
  '  if (uEdge > 0.001) col *= 1.0 + uEdge * (mlum - 0.5) * 1.6;',     // per-slice glass bevel shading
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);',
  '}',
].join('\n')

export const tearEffect: SpaceTypeEffect = {
  id: 'tear',
  label: 'Tear',
  controls,
  liveKeys: ['tearAmount', 'tearFreq', 'tearPhase', 'tearStyle', 'tearDir', 'tearEdge', 'tearOverlap', 'tearSlant'],

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const tex = textTexture.clone()
    tex.wrapS = tex.wrapT = three.ClampToEdgeWrapping
    tex.needsUpdate = true

    const ud = textTexture.userData ?? {}
    const img = textTexture.image as { width?: number; height?: number } | undefined
    const texAspect = Math.max(0.1, (img?.width ?? 1) / (img?.height ?? 1))
    const wf = Number((ud.wordInkFracs as number[] | undefined)?.[0] ?? 1) || 1
    const inkVH = Math.max(0.05, Number(ud.inkHeightFrac ?? 0.6))
    const inkVMid = Number(ud.inkVMid ?? 0.5)
    const inkAspect = Math.max(0.05, (wf * texAspect) / inkVH)
    const BOX = 9
    const planeW = inkAspect >= 1 ? BOX : BOX * inkAspect
    const planeH = inkAspect >= 1 ? BOX / inkAspect : BOX

    const material = new three.ShaderMaterial({
      side: three.DoubleSide,
      uniforms: {
        uText: { value: tex },
        uTextColor: { value: new three.Color(String(params.textColor)) },
        uBg: { value: new three.Color(String(params.bgColor)) },
        uWf: { value: wf }, uVMid: { value: inkVMid }, uVH: { value: inkVH },
        uAmount: { value: 0.05 }, uFreq: { value: 12 }, uPhase: { value: 0 },
        uSpeed: { value: 2 }, uTime: { value: 0 },
        uStyle: { value: 0 }, uDir: { value: 0 }, uEdge: { value: 0 }, uOverlap: { value: 0 }, uSlant: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), material)
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
    u.uSpeed!.value = Math.round(n(params, 'speed'))   // integer periods/loop → seamless pan
    u.uStyle!.value = String(params.tearStyle) === 'slabs' ? 2 : String(params.tearStyle) === 'ripple' ? 1 : 0
    u.uDir!.value = String(params.tearDir) === 'horizontal' ? 1 : 0
    u.uEdge!.value = Math.max(0, n(params, 'tearEdge'))
    u.uOverlap!.value = Math.max(0, n(params, 'tearOverlap'))
    u.uSlant!.value = n(params, 'tearSlant')
    ;(u.uTextColor!.value as THREE.Color).set(String(params.textColor))
    ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
  },
}
