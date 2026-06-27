import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

/**
 * Shutter — a sliced / shuttered halftone-line treatment.
 *
 * The baked text matte is cut into `slices` horizontal bands. Bands are grouped (`groupSize` each)
 * and each group is sheared horizontally by an amount from the selected `pattern` (diagonal lean /
 * seeded random / sine / alternating), scaled by `offset` and the master `progress`. Within each
 * band the bottom `gap * progress` fraction is clipped transparent, opening thin venetian-blind
 * lines without squishing the glyphs. `progress` (0 = intact text, 1 = fully sliced) is either
 * parked (Animation = static) or driven by loop time (sweep-in, or seamless in/out loop).
 */
const controls: ControlSpec[] = [
  // TYPE.
  { key: 'text', label: 'Text', kind: 'textList', default: 'NO\nWANT\nZERO\nDAYS', group: 'Type' },
  { key: 'textCase', label: 'Case', kind: 'select', options: ['upper', 'asis'], default: 'upper', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 220, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 800, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // SLICE — the shutter field.
  { key: 'slices', label: 'Slices', kind: 'slider', min: 4, max: 160, step: 1, default: 48, group: 'Slice' },
  { key: 'groupSize', label: 'Group size', kind: 'slider', min: 1, max: 16, step: 1, default: 4, group: 'Slice' },
  { key: 'pattern', label: 'Pattern', kind: 'select', options: ['diagonal', 'random', 'sine', 'alternating'], default: 'diagonal', group: 'Slice' },
  { key: 'offset', label: 'Offset amount', kind: 'slider', min: 0, max: 0.7, step: 0.005, default: 0.16, group: 'Slice' },
  { key: 'gap', label: 'Gap', kind: 'slider', min: 0, max: 0.6, step: 0.01, default: 0.06, group: 'Slice' },
  { key: 'seed', label: 'Seed', kind: 'slider', min: 1, max: 60, step: 1, default: 1, group: 'Slice' },
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

const FRAG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D uText; uniform vec3 uTextColor; uniform vec3 uBg;',
  'uniform float uWf; uniform float uVMid; uniform float uVH;',        // glyph placement in the tile
  'uniform float uSlices; uniform float uGroup; uniform float uPattern;',
  'uniform float uOffset; uniform float uGap; uniform float uSeed; uniform float uProgress;',
  'float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }',
  // Centre the glyph in the plane with a margin so sheared slices can travel into transparent space.
  'float inkA(vec2 p){',
  '  float tx = (p.x - 0.5) * uWf * 1.6 + uWf * 0.5;',
  '  float ty = uVMid + (p.y - 0.5) * uVH * 1.6;',
  '  float a = texture2D(uText, vec2(clamp(tx, 0.0, 1.0), clamp(ty, 0.0, 1.0))).a;',
  '  return a * step(0.0, tx) * step(tx, uWf) * step(0.0, ty) * step(ty, 1.0);',
  '}',
  'void main(){',
  '  float band = floor(vUv.y * uSlices);',                            // which horizontal slice
  '  float gsize = max(1.0, uGroup);',
  '  float group = floor(band / gsize);',
  '  float groups = max(1.0, ceil(uSlices / gsize));',
  '  float off;',                                                       // signed -1..1 per group
  '  if (uPattern < 0.5) off = ((group + 0.5) / groups - 0.5) * 2.0;',  // diagonal lean
  '  else if (uPattern < 1.5) off = hash(group + uSeed) * 2.0 - 1.0;',  // seeded random
  '  else if (uPattern < 2.5) off = sin(group * 0.9);',                 // sine ripple
  '  else off = (mod(group, 2.0) < 1.0) ? 1.0 : -1.0;',                 // alternating
  '  float shift = off * uOffset * uProgress;',
  // Vertical gap: clip the bottom (uGap*progress) fraction of each band to transparent.
  '  float bandPos = fract(vUv.y * uSlices);',
  '  float gapAmt = uGap * uProgress;',
  '  float vis = 1.0;',
  '  if (gapAmt > 0.001) vis = smoothstep(gapAmt - 0.012, gapAmt + 0.012, bandPos);',
  '  vec2 puv = vUv; puv.x -= shift;',
  '  float a = inkA(puv) * vis;',
  '  vec3 col = mix(uBg, uTextColor, a);',
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);',
  '}',
].join('\n')

const PATTERN_INDEX: Record<string, number> = { diagonal: 0, random: 1, sine: 2, alternating: 3 }

export const shutterEffect: SpaceTypeEffect = {
  id: 'shutter',
  label: 'Shutter',
  controls,
  liveKeys: ['slices', 'groupSize', 'pattern', 'offset', 'gap', 'seed', 'progress', 'anim', 'scale', 'rotateZ', 'textColor', 'bgColor'],

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
        uSlices: { value: 48 }, uGroup: { value: 4 }, uPattern: { value: 0 },
        uOffset: { value: 0.22 }, uGap: { value: 0.08 }, uSeed: { value: 1 }, uProgress: { value: 1 },
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
    u.uSlices!.value = Math.max(1, Math.round(n(params, 'slices')))
    u.uGroup!.value = Math.max(1, Math.round(n(params, 'groupSize')))
    u.uPattern!.value = PATTERN_INDEX[String(params.pattern)] ?? 0
    u.uOffset!.value = Math.max(0, n(params, 'offset'))
    u.uGap!.value = Math.max(0, n(params, 'gap'))
    u.uSeed!.value = Math.max(1, Math.round(n(params, 'seed')))
    u.uProgress!.value = effectiveProgress(String(params.anim), n(params, 'progress'), t01)
    ;(u.uTextColor!.value as THREE.Color).set(String(params.textColor))
    ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
  },
}
