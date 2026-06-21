import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

/**
 * Slit Scan — time-displacement typography.
 *
 * The BASE is a looping horizontal squish-wipe of the word (one copy compresses toward the left edge
 * to zero width while a duplicate expands from the right) — a continuous, predictable cycle that is a
 * pure function of normalized time τ. A displacement MAP (linear gradient + optional soft bumps) gives
 * each pixel a TIME delay: we evaluate the base at `τ = time·speed − luminance·delaySpread`. Because
 * different bands sit at different points on the animation timeline, the text smears/stretches like
 * elastic. No frame buffer needed — the base is analytic, so τ can be any value. Seamless: the base
 * depends only on `fract(τ)` and τ advances by an integer (speed) over the loop, with a constant
 * per-pixel delay offset.
 */
const controls: ControlSpec[] = [
  // TYPE.
  { key: 'text', label: 'Text', kind: 'textList', default: 'Slitscan', group: 'Type' },
  { key: 'textCase', label: 'Case', kind: 'select', options: ['upper', 'asis'], default: 'asis', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // WARP — the displacement map / time delay.
  { key: 'ssDelay', label: 'Delay spread', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1.5, group: 'Warp' },
  { key: 'ssBands', label: 'Bands', kind: 'slider', min: 0, max: 40, step: 1, default: 10, group: 'Warp' },
  { key: 'ssBandSpeed', label: 'Band speed', kind: 'slider', min: 0, max: 6, step: 1, default: 2, group: 'Warp' },
  { key: 'ssSpeedMode', label: 'Speed pattern', kind: 'select', options: ['random', 'progressive'], default: 'random', group: 'Warp' },
  { key: 'ssEase', label: 'Speed ease', kind: 'slider', min: 0, max: 1, step: 0.05, default: 1, group: 'Warp' },
  { key: 'ssMapDir', label: 'Gradient', kind: 'select', options: ['vertical', 'horizontal'], default: 'vertical', group: 'Warp' },
  { key: 'ssBump', label: 'Bumps', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Warp' },
  { key: 'ssBumpFreq', label: 'Bump freq', kind: 'slider', min: 1, max: 10, step: 0.5, default: 3, group: 'Warp' },
  // MOTION — base wipe cycles per loop (integer ⇒ seamless).
  { key: 'speed', label: 'Speed', kind: 'slider', min: 1, max: 8, step: 1, default: 2, group: 'Motion' },
  // TRANSFORM.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Camera rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Camera rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // COLOR.
  { key: 'textColor', label: 'Text', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#000000', group: 'Color' },
]

interface SlitState { material: THREE.ShaderMaterial }
let state: SlitState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const FRAG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D uText; uniform vec3 uTextColor; uniform vec3 uBg;',
  'uniform float uWf; uniform float uVMid; uniform float uVH;',
  'uniform float uTime; uniform float uSpeed; uniform float uDelay; uniform float uMapDir;',
  'uniform float uBump; uniform float uBumpFreq; uniform float uBands; uniform float uBandSpeed; uniform float uSpeedMode; uniform float uEase;',
  'const float TAU = 6.2831853;',
  'float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }',
  // glyph alpha at word-space x (tx∈[0,1]) and screen vy
  'float glyph(float tx, float vy){',
  '  float ix = tx * uWf;',
  '  float iy = uVMid + (vy - 0.5) * uVH * 1.35;',
  '  if (ix < 0.0 || ix > uWf || iy < 0.0 || iy > 1.0) return 0.0;',
  '  return texture2D(uText, vec2(clamp(ix, 0.0, 1.0), clamp(iy, 0.0, 1.0))).a;',
  '}',
  // base squish-wipe at normalized time tau: copy A shrinks to the left, copy B grows from the right.
  // The squish minifies the text hard, so supersample across the horizontal footprint (dFdx) to
  // anti-alias — using dFdx (not fwidth) avoids the vertical band-boundary spike.
  'float base(vec2 uv, float tau){',
  '  float p = fract(tau);',
  '  float b = 1.0 - p;',
  '  float tx = (uv.x < b) ? uv.x / max(1e-3, b) : (uv.x - b) / max(1e-3, p);',
  '  float foot = clamp(abs(dFdx(tx)), 0.0, 0.25);',
  '  float a = 0.0;',
  '  for (int i = 0; i < 5; i++) a += glyph(tx + (float(i) - 2.0) * foot, uv.y);',
  '  return a * 0.2;',
  '}',
  'void main(){',
  '  float coord = (uMapDir < 0.5) ? vUv.y : vUv.x;',                   // gradient axis
  '  float g = coord;',
  '  float spd = uSpeed;',
  '  if (uBands >= 2.0) {',                                             // quantise into N bands…
  '    float band = floor(coord * uBands);',
  '    float bn = band / max(1.0, uBands - 1.0);',                      // 0..1 band index
  '    float bne = mix(bn, bn * bn * (3.0 - 2.0 * bn), uEase);',        // eased index (smoothstep)
  '    float extra;',                                                   // …each its own integer speed:
  '    if (uSpeedMode < 0.5) {',
  '      g = bn;',                                                      // random: linear delay offset
  '      extra = floor(hash(band * 1.73) * (uBandSpeed + 0.999));',     // …random speed
  '    } else {',
  '      g = bne;',                                                     // progressive: EASED delay offset (continuous → visible)
  '      extra = floor(bne * uBandSpeed + 0.5);',                       // …eased progressive speed
  '    }',
  '    spd = uSpeed + extra;',
  '  }',
  '  g = clamp(g + uBump * 0.5 * sin(vUv.x * TAU * uBumpFreq) * sin(vUv.y * TAU * uBumpFreq), 0.0, 1.0);',
  '  float tau = uTime * spd - g * uDelay;',                            // per-pixel TIME offset
  '  float a = base(vUv, tau);',
  '  vec3 col = mix(uBg, uTextColor, a);',
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);',
  '}',
].join('\n')

export const slitScanEffect: SpaceTypeEffect = {
  id: 'slitscan',
  label: 'Slit Scan',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const tex = textTexture.clone()
    tex.wrapS = tex.wrapT = three.ClampToEdgeWrapping
    // No mipmaps: the per-band time jumps spike the GPU's LOD derivative → coarse-mip gray streaks.
    // Squish minification is anti-aliased manually in the shader (dFdx supersample) instead.
    tex.minFilter = three.LinearFilter
    tex.generateMipmaps = false
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
        uTime: { value: 0 }, uSpeed: { value: 2 }, uDelay: { value: 1.5 }, uMapDir: { value: 0 },
        uBump: { value: 0 }, uBumpFreq: { value: 3 }, uBands: { value: 10 }, uBandSpeed: { value: 2 }, uSpeedMode: { value: 0 }, uEase: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,   // dFdx (used for squish anti-alias) is built in under WebGL2
    })
    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), material)
    mesh.userData.tex = tex
    root.add(mesh)

    state = { material }
    slitScanEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const u = s.material.uniforms
    u.uTime!.value = t01
    u.uSpeed!.value = Math.max(1, Math.round(n(params, 'speed')))   // integer cycles/loop → seamless
    u.uDelay!.value = Math.max(0, n(params, 'ssDelay'))
    u.uMapDir!.value = String(params.ssMapDir) === 'horizontal' ? 1 : 0
    u.uBump!.value = Math.max(0, n(params, 'ssBump'))
    u.uBumpFreq!.value = Math.max(1, n(params, 'ssBumpFreq'))
    u.uBands!.value = Math.max(0, Math.round(n(params, 'ssBands')))
    u.uBandSpeed!.value = Math.max(0, Math.round(n(params, 'ssBandSpeed')))
    u.uSpeedMode!.value = String(params.ssSpeedMode) === 'progressive' ? 1 : 0
    u.uEase!.value = Math.min(1, Math.max(0, n(params, 'ssEase')))
    ;(u.uTextColor!.value as THREE.Color).set(String(params.textColor))
    ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
  },
}
