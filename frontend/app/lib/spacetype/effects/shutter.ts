import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

/**
 * Shutter — geometric "speed lines" sliced typography.
 *
 * Stacks N overlapping copies of the word. Every copy shares ONE horizontal stripe grid (same count
 * and positions, so the white lines stay continuous across the word), but the THICKNESS of the black
 * stripe within each line differs per copy: the bottom copy of the pile has the thinnest stripes,
 * the top copy the thickest. The copies are then nudged horizontally by an even spacing and unioned
 * — the offset, differently-weighted copies interleave into geometric speed lines. `progress`
 * (0 = intact word, 1 = fully fanned/sliced) drives both the horizontal spread and the stripe gaps,
 * so at 0 every copy collapses back to one solid word. `progress` is parked (Animation = static) or
 * driven by loop time (sweep-in, or seamless in/out loop).
 */
const controls: ControlSpec[] = [
  // TYPE.
  { key: 'text', label: 'Text', kind: 'textList', default: 'NO\nWANT\nZERO\nDAYS', group: 'Type' },
  { key: 'textCase', label: 'Case', kind: 'select', options: ['upper', 'asis'], default: 'upper', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 220, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 800, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // SLICE — the stacked, horizontally-nudged striped copies.
  { key: 'copies', label: 'Copies', kind: 'slider', min: 1, max: 6, step: 1, default: 4, group: 'Slice' },
  { key: 'spacing', label: 'Horizontal spacing', kind: 'slider', min: 0, max: 0.3, step: 0.005, default: 0.02, group: 'Slice' },
  { key: 'stripes', label: 'Stripes', kind: 'slider', min: 4, max: 120, step: 1, default: 22, group: 'Slice' },
  { key: 'thicknessBottom', label: 'Thickness · bottom copy', kind: 'slider', min: 0.05, max: 1, step: 0.02, default: 0.32, group: 'Slice' },
  { key: 'thicknessTop', label: 'Thickness · top copy', kind: 'slider', min: 0.05, max: 1, step: 0.02, default: 0.86, group: 'Slice' },
  { key: 'progress', label: 'Progress', kind: 'slider', min: 0, max: 1, step: 0.01, default: 1, group: 'Slice' },
  // MOTION.
  { key: 'anim', label: 'Animation', kind: 'select', options: ['static', 'sweepin', 'loop'], default: 'static', group: 'Motion' },
  // TRANSFORM (applied by the engine from these param keys).
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // COLOR.
  { key: 'textColor', label: 'Text', kind: 'color', default: '#000000', group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#ffffff', group: 'Color' },
]

interface ShutterState { material: THREE.ShaderMaterial }
let state: ShutterState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Map the animation mode to a 0..1 displacement amount for loop time t01. Pure in t01. */
export function effectiveProgress(anim: string, progress: number, t01: number): number {
  const p = clamp01(progress)
  if (anim === 'sweepin') return clamp01(p * t01)
  if (anim === 'loop') return clamp01(p * (1 - Math.abs(2 * t01 - 1)))
  return p // static
}

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const MAX_LAYERS = 6

const FRAG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D uText; uniform vec3 uTextColor; uniform vec3 uBg;',
  'uniform float uWf; uniform float uVMid; uniform float uVH;',        // glyph placement in the tile
  'uniform float uCopies; uniform float uSpacing; uniform float uStripes;',
  'uniform float uThickA; uniform float uThickB; uniform float uProgress;',
  // Centre the glyph in the plane with a margin so nudged copies can travel into transparent space.
  'float inkA(vec2 p){',
  '  float tx = (p.x - 0.5) * uWf * 1.7 + uWf * 0.5;',
  '  float ty = uVMid + (p.y - 0.5) * uVH * 1.7;',
  '  float a = texture2D(uText, vec2(clamp(tx, 0.0, 1.0), clamp(ty, 0.0, 1.0))).a;',
  '  return a * step(0.0, tx) * step(tx, uWf) * step(0.0, ty) * step(ty, 1.0);',
  '}',
  // One copy: the word nudged horizontally by dx, masked by the SHARED stripe grid (uStripes lines).
  // `duty` is the fraction of each stripe period that is ink (the rest is a transparent gap) — this
  // is the per-copy stripe thickness; the grid count/positions are the same for every copy.
  'float stripeCopy(vec2 uv, float dx, float duty){',
  '  float w = inkA(vec2(uv.x - dx, uv.y));',
  '  if (duty >= 0.999) return w;',                                    // no gaps -> solid word
  '  float s = fract(uv.y * uStripes);',
  '  float m = 1.0 - smoothstep(duty - 0.02, duty + 0.02, s);',        // 1 in stripe, 0 in gap
  '  return w * m;',
  '}',
  'const int MAX_LAYERS = ' + MAX_LAYERS + ';',
  'void main(){',
  // Stack uCopies overlapping copies (union of ink). Each copy k shares the same stripe grid but has
  // its own stripe thickness (bottom copy thin -> top copy thick) and is nudged horizontally by an
  // even spacing. Both the spread and the thinning scale with progress, so progress 0 collapses
  // every copy to one solid word.
  '  float a = 0.0;',
  '  for (int k = 0; k < MAX_LAYERS; k++){',
  '    if (float(k) >= uCopies) break;',
  '    float t = (uCopies > 1.0) ? float(k) / (uCopies - 1.0) : 0.0;', // 0 = bottom of pile, 1 = top
  '    float dx = (float(k) - (uCopies - 1.0) * 0.5) * uSpacing * uProgress;',
  '    float duty = mix(1.0, mix(uThickA, uThickB, t), uProgress);',   // bottom thin (A) -> top thick (B)
  '    a = max(a, stripeCopy(vUv, dx, duty));',
  '  }',
  '  vec3 col = mix(uBg, uTextColor, a);',
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);',
  '}',
].join('\n')

export const shutterEffect: SpaceTypeEffect = {
  id: 'shutter',
  label: 'Shutter',
  controls,
  liveKeys: ['copies', 'spacing', 'stripes', 'thicknessBottom', 'thicknessTop', 'progress', 'anim', 'scale', 'rotateZ', 'textColor', 'bgColor'],

  loopRates() { return [1] },

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
        uCopies: { value: 4 }, uSpacing: { value: 0.02 }, uStripes: { value: 22 },
        uThickA: { value: 0.32 }, uThickB: { value: 0.86 }, uProgress: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), material)
    mesh.userData.tex = tex
    root.add(mesh)

    state = { material }
    shutterEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const u = s.material.uniforms
    u.uCopies!.value = Math.min(MAX_LAYERS, Math.max(1, Math.round(n(params, 'copies'))))
    u.uSpacing!.value = Math.max(0, n(params, 'spacing'))
    u.uStripes!.value = Math.max(1, n(params, 'stripes'))
    u.uThickA!.value = clamp01(n(params, 'thicknessBottom'))
    u.uThickB!.value = clamp01(n(params, 'thicknessTop'))
    u.uProgress!.value = effectiveProgress(String(params.anim), n(params, 'progress'), t01)
    ;(u.uTextColor!.value as THREE.Color).set(String(params.textColor))
    ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
  },
}
