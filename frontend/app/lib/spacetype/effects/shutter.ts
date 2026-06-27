import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills, fillShaderTexture, fillTiling, serializeFills, DEFAULT_FILL, SRGB_TO_LINEAR_GLSL } from '../fills'

/**
 * Shutter — geometric "speed lines" sliced typography.
 *
 * Stacks N overlapping copies of each word. Every copy shares ONE horizontal stripe grid (same count
 * and positions, so the white lines stay continuous across the word), but the THICKNESS of the black
 * stripe within each line differs per copy: the bottom copy of the pile has the thinnest stripes, the
 * top copy the thickest. The copies are nudged horizontally by an even spacing and unioned — the
 * offset, differently-weighted copies interleave into geometric speed lines.
 *
 * Multi-string: a newline-separated `text` stacks into a centred poster, each line getting its own
 * shutter treatment (shared settings). Colour: `colorMode` is mono (one colour), palette (each copy
 * fades between two colours — the trailing speed lines change hue) or fill (a studio pattern fill).
 *
 * `progress` (0 = intact word, 1 = fully fanned/sliced) drives both the horizontal spread and the
 * stripe gaps, so at 0 every copy collapses back to one solid word. Parked (Animation = static) or
 * driven by loop time (sweep-in, or seamless in/out loop).
 */

// inkA sampling margins: horizontal is roomy so nudged copies can trail into transparent space;
// vertical is tight so stacked words sit close. Mirrored into the plane sizing below.
const MX = 1.5
const MY = 1.15

const FILL_DEFAULT = serializeFills([{ ...DEFAULT_FILL, type: 'gradient', a: '#ff4d2e', b: '#101010' }])

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
  // LAYOUT — multi-string stacking.
  { key: 'rowGap', label: 'Line gap', kind: 'slider', min: -0.3, max: 1, step: 0.02, default: 0.12, group: 'Layout' },
  // MOTION.
  { key: 'anim', label: 'Animation', kind: 'select', options: ['static', 'sweepin', 'loop'], default: 'static', group: 'Motion' },
  // TRANSFORM (applied by the engine from these param keys).
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // COLOR.
  { key: 'colorMode', label: 'Color mode', kind: 'select', options: ['mono', 'palette', 'fill'], default: 'mono', group: 'Color' },
  { key: 'textColor', label: 'Text (mono)', kind: 'color', default: '#000000', group: 'Color' },
  { key: 'paletteA', label: 'Palette · trailing', kind: 'color', default: '#10b981', group: 'Color' },
  { key: 'paletteB', label: 'Palette · front', kind: 'color', default: '#0a0a0a', group: 'Color' },
  { key: 'fill', label: 'Pattern fill', kind: 'fillList', default: FILL_DEFAULT, group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#ffffff', group: 'Color' },
]

interface ShutterState { materials: THREE.ShaderMaterial[]; bg: THREE.MeshBasicMaterial }
let state: ShutterState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const COLOR_MODE: Record<string, number> = { mono: 0, palette: 1, fill: 2 }

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
  'uniform sampler2D uText; uniform vec3 uBg;',
  'uniform float uWf; uniform float uVMid; uniform float uVH;',        // this word's placement in the atlas
  'uniform float uCopies; uniform float uSpacing; uniform float uStripes;',
  'uniform float uThickA; uniform float uThickB; uniform float uProgress;',
  'uniform float uColorMode; uniform vec3 uTextColor; uniform vec3 uPalA; uniform vec3 uPalB;',
  'uniform sampler2D uFill; uniform float uFillTiling;',
  SRGB_TO_LINEAR_GLSL,
  // Centre this word's glyphs in the plane (roomy in x for the nudge, tight in y so lines stack close).
  'float inkA(vec2 p){',
  '  float tx = (p.x - 0.5) * uWf * ' + MX.toFixed(3) + ' + uWf * 0.5;',
  '  float ty = uVMid + (p.y - 0.5) * uVH * ' + MY.toFixed(3) + ';',
  '  float a = texture2D(uText, vec2(clamp(tx, 0.0, 1.0), clamp(ty, 0.0, 1.0))).a;',
  '  return a * step(0.0, tx) * step(tx, uWf) * step(0.0, ty) * step(ty, 1.0);',
  '}',
  // One copy: the word nudged horizontally by dx, masked by the SHARED stripe grid (uStripes lines).
  // `duty` is the per-copy stripe thickness (ink fraction of each line); the grid is the same for all.
  'float stripeCopy(vec2 uv, float dx, float duty){',
  '  float w = inkA(vec2(uv.x - dx, uv.y));',
  '  if (duty >= 0.999) return w;',                                    // no gaps -> solid word
  '  float s = fract(uv.y * uStripes);',
  '  float m = 1.0 - smoothstep(duty - 0.02, duty + 0.02, s);',        // 1 in stripe, 0 in gap
  '  return w * m;',
  '}',
  // Colour for copy k (t = 0 bottom .. 1 top): one colour, a two-colour palette fade, or a fill pattern.
  'vec3 copyColor(float t, vec2 uv){',
  '  if (uColorMode < 0.5) return uTextColor;',
  '  if (uColorMode < 1.5) return mix(uPalA, uPalB, t);',
  '  return stLin(texture2D(uFill, uv * uFillTiling).rgb);',
  '}',
  'const int MAX_LAYERS = ' + MAX_LAYERS + ';',
  'void main(){',
  // Paint uCopies overlapping copies bottom-to-top over the background. Each copy k shares the stripe
  // grid but has its own thickness (bottom thin -> top thick) and an even horizontal nudge. Both the
  // spread and the thinning scale with progress, so progress 0 collapses every copy to one solid word.
  '  vec3 col = uBg;',
  '  for (int k = 0; k < MAX_LAYERS; k++){',
  '    if (float(k) >= uCopies) break;',
  '    float t = (uCopies > 1.0) ? float(k) / (uCopies - 1.0) : 0.0;', // 0 = bottom of pile, 1 = top
  '    float dx = (float(k) - (uCopies - 1.0) * 0.5) * uSpacing * uProgress;',
  '    float duty = mix(1.0, mix(uThickA, uThickB, t), uProgress);',
  '    float ink = stripeCopy(vUv, dx, duty);',
  '    col = mix(col, copyColor(t, vUv), ink);',
  '  }',
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);',
  '}',
].join('\n')

export const shutterEffect: SpaceTypeEffect = {
  id: 'shutter',
  label: 'Shutter',
  controls,
  liveKeys: ['copies', 'spacing', 'stripes', 'thicknessBottom', 'thicknessTop', 'progress', 'anim', 'scale', 'rotateZ', 'colorMode', 'textColor', 'paletteA', 'paletteB', 'bgColor'],

  loopRates() { return [1] },

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const tex = textTexture.clone()
    tex.wrapS = tex.wrapT = three.ClampToEdgeWrapping
    tex.needsUpdate = true

    const ud = textTexture.userData ?? {}
    const img = textTexture.image as { width?: number; height?: number } | undefined
    const texAspect = Math.max(0.1, (img?.width ?? 1) / (img?.height ?? 1))
    const numTexts = Math.max(1, Math.round(Number(ud.numTexts ?? 1)))
    const wordFracs = (ud.wordFracs as number[] | undefined) ?? [1]
    const wordInkFracs = (ud.wordInkFracs as number[] | undefined) ?? [1]
    const inkVH = Math.max(0.02, Number(ud.inkHeightFrac ?? 0.6))
    const inkVMid0 = Number(ud.inkVMid ?? 0.5)

    // The shared pattern-fill texture (solid -> 1×1 swatch); cached singleton, not disposed by engine.
    const fill = parseFills(params.fill)[0]!
    const fillTex = fillShaderTexture(three, fill)
    const fillTile = fillTiling(fill)

    // Per-word ink aspect (width / height), used for plane sizing.
    const aspects: number[] = []
    for (let wi = 0; wi < numTexts; wi++) {
      const wf = Math.max(0.02, (wordFracs[wi] ?? 1) * (wordInkFracs[wi] ?? 1))
      aspects.push(Math.max(0.05, (wf * texAspect) / inkVH))
    }

    // Poster layout: each word gets an equal world-height window H; word 0 (first line) on top.
    // Fit vertically first, then shrink to fit the widest word horizontally so nothing overflows.
    const BOX = 9
    const gapFrac = Math.max(-0.6, n(params, 'rowGap'))
    let H = BOX / (numTexts + gapFrac * (numTexts - 1))
    const widthAt = (h: number) => Math.max(...aspects.map(a => (MX / MY) * h * a))
    if (widthAt(H) > BOX) H *= BOX / widthAt(H)
    const step = H * (1 + gapFrac)
    const topY = (step * (numTexts - 1)) / 2

    // Full-field background behind every word so the poster reads as one continuous colour
    // (the line gaps between words show this, not the studio backdrop).
    const bgMat = new three.MeshBasicMaterial({ color: new three.Color(String(params.bgColor)) })
    const bgMesh = new three.Mesh(new three.PlaneGeometry(60, 60), bgMat)
    bgMesh.position.z = -0.5
    root.add(bgMesh)

    const materials: THREE.ShaderMaterial[] = []
    for (let wi = 0; wi < numTexts; wi++) {
      const wf = Math.max(0.02, (wordFracs[wi] ?? 1) * (wordInkFracs[wi] ?? 1))
      const vmid = inkVMid0 + wi / numTexts                 // this row's ink centre in full-atlas v
      const planeH = H
      const planeW = (MX / MY) * H * aspects[wi]!           // preserve ink aspect under the asymmetric margins
      const yc = topY - wi * step                           // word 0 highest

      const material = new three.ShaderMaterial({
        side: three.DoubleSide,
        uniforms: {
          uText: { value: tex },
          uBg: { value: new three.Color(String(params.bgColor)) },
          uWf: { value: wf }, uVMid: { value: vmid }, uVH: { value: inkVH },
          uCopies: { value: 4 }, uSpacing: { value: 0.02 }, uStripes: { value: 22 },
          uThickA: { value: 0.32 }, uThickB: { value: 0.86 }, uProgress: { value: 1 },
          uColorMode: { value: 0 },
          uTextColor: { value: new three.Color(String(params.textColor)) },
          uPalA: { value: new three.Color(String(params.paletteA)) },
          uPalB: { value: new three.Color(String(params.paletteB)) },
          uFill: { value: fillTex }, uFillTiling: { value: fillTile },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
      })
      const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), material)
      mesh.position.y = yc
      mesh.userData.tex = tex
      root.add(mesh)
      materials.push(material)
    }

    state = { materials, bg: bgMat }
    shutterEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const copies = Math.min(MAX_LAYERS, Math.max(1, Math.round(n(params, 'copies'))))
    const spacing = Math.max(0, n(params, 'spacing'))
    const stripes = Math.max(1, n(params, 'stripes'))
    const thickA = clamp01(n(params, 'thicknessBottom'))
    const thickB = clamp01(n(params, 'thicknessTop'))
    const prog = effectiveProgress(String(params.anim), n(params, 'progress'), t01)
    const mode = COLOR_MODE[String(params.colorMode)] ?? 0
    for (const m of s.materials) {
      const u = m.uniforms
      u.uCopies!.value = copies
      u.uSpacing!.value = spacing
      u.uStripes!.value = stripes
      u.uThickA!.value = thickA
      u.uThickB!.value = thickB
      u.uProgress!.value = prog
      u.uColorMode!.value = mode
      ;(u.uTextColor!.value as THREE.Color).set(String(params.textColor))
      ;(u.uPalA!.value as THREE.Color).set(String(params.paletteA))
      ;(u.uPalB!.value as THREE.Color).set(String(params.paletteB))
      ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
    }
    s.bg.color.set(String(params.bgColor))
  },
}
