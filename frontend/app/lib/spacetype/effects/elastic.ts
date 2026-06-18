import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills, fillShaderTexture, fillTiling } from '../fills'
import { ELASTIC_MODES, TAU } from '../elasticMath'
import { stackPositions, lineStaggerOffsets } from '../elasticLayout'

/**
 * ELASTIC — stacked full-bleed type warped like a stretchy material
 * (kielm STG V.STRETCH ref). One subdivided plane per text line; a vertex
 * shader displaces it per the selected Mode. The five modes mirror
 * elasticMath.elasticOffset 1:1 (keep in sync). Each word is stretched to fill
 * its plane width via the atlas wordFrac, giving the full-bleed look. Works in
 * both ortho and perspective (displacement is camera-agnostic; stack centered
 * on the origin).
 */

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'OLD\nWORLD\nNEW\nSCHOOL', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'textSkew', label: 'Text skew', kind: 'slider', min: -40, max: 40, step: 1, default: 0, group: 'Type' },
  { key: 'lineSkew', label: 'Line skew', kind: 'slider', min: -40, max: 40, step: 1, default: 0, group: 'Layout' },
  { key: 'lineStagger', label: 'Line stagger', kind: 'slider', min: -4, max: 4, step: 0.05, default: 0, group: 'Layout' },
  { key: 'leading', label: 'Leading', kind: 'slider', min: -1, max: 3, step: 0.05, default: 0.2, group: 'Layout' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'mode', label: 'Mode', kind: 'select', options: [...ELASTIC_MODES], default: 'Wave', group: 'Motion' },
  { key: 'intensity', label: 'Intensity', kind: 'slider', min: 0, max: 3, step: 0.05, default: 1, group: 'Motion' },
  { key: 'stretch', label: 'Stretch', kind: 'slider', min: 0, max: 1.5, step: 0.02, default: 0.4, group: 'Motion' },
  { key: 'shear', label: 'Shear', kind: 'slider', min: 0, max: 1.5, step: 0.02, default: 0.6, group: 'Motion' },
  { key: 'waveLength', label: 'Wavelength', kind: 'slider', min: 0.2, max: 8, step: 0.1, default: 2, group: 'Motion' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1, group: 'Motion' },
  { key: 'fills', label: 'Fills', kind: 'fillList', default: '[{"type":"solid","a":"#ffffff","b":"#000000","textColor":"#000000"}]', group: 'Color' },
]

interface PlaneUniforms {
  uMode: { value: number }
  uTime: { value: number }
  uIntensity: { value: number }
  uStretch: { value: number }
  uShear: { value: number }
  uWaveLen: { value: number }
  uLineT: { value: number }
  uLineSkew: { value: number }
  uTextSkew: { value: number }
}

let planeUniforms: PlaneUniforms[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

function modeIndex(p: Params): number {
  const i = (ELASTIC_MODES as readonly string[]).indexOf(String(p.mode))
  return i < 0 ? 0 : i
}

function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  fillTex: THREE.Texture,
  tiling: number,
  textColor: THREE.Color,
  textRow: number,
  textCount: number,
  wordFrac: number,
  u: PlaneUniforms,
): THREE.MeshLambertMaterial {
  const mat = new three.MeshLambertMaterial({ map, side: three.DoubleSide })
  const uFillTex = { value: fillTex }
  const uFillTiling = { value: tiling }
  const uTextColor = { value: textColor }
  const uTextRow = { value: textRow }
  const uTextCount = { value: Math.max(1, textCount) }
  const uWordFrac = { value: Math.max(0.0001, wordFrac) }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMode = u.uMode
    shader.uniforms.uTime = u.uTime
    shader.uniforms.uIntensity = u.uIntensity
    shader.uniforms.uStretch = u.uStretch
    shader.uniforms.uShear = u.uShear
    shader.uniforms.uWaveLen = u.uWaveLen
    shader.uniforms.uLineT = u.uLineT
    shader.uniforms.uLineSkew = u.uLineSkew
    shader.uniforms.uTextSkew = u.uTextSkew
    shader.uniforms.uFillTex = uFillTex
    shader.uniforms.uFillTiling = uFillTiling
    shader.uniforms.uTextColor = uTextColor
    shader.uniforms.uTextRow = uTextRow
    shader.uniforms.uTextCount = uTextCount
    shader.uniforms.uWordFrac = uWordFrac

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec2 vRawUv;',
        'uniform float uMode; uniform float uTime; uniform float uIntensity;',
        'uniform float uStretch; uniform float uShear; uniform float uWaveLen;',
        'uniform float uLineT; uniform float uLineSkew;',
      ].join('\n'))
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawUv = uv;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'float px = position.x;',
        'float py = position.y;',
        'float md = uMode;',
        'float tau = 6.28318530718;',
        'transformed.x += position.y * uLineSkew;',
        'float dx = 0.0; float dy = 0.0;',
        'if (md < 0.5) {',
        '  float phase = px * uWaveLen + uLineT * tau + uTime;',
        '  dx = sin(phase) * uShear;',
        '  dy = cos(phase) * uStretch * py;',
        '} else if (md < 1.5) {',
        '  float env = sin(uTime) * cos(uTime * 0.5);',
        '  dx = px * env * uShear * 0.5;',
        '  dy = py * env * uStretch;',
        '} else if (md < 2.5) {',
        '  float drag = 0.5 + uLineT;',
        '  dx = sin(uTime + py * uWaveLen * 0.3) * uShear * 2.0 * drag;',
        '  dy = sin(uTime * 0.5) * uStretch * 0.25 * py;',
        '} else if (md < 3.5) {',
        '  float cx = sin(uTime) * 0.5;',
        '  float ex = px - cx; float ey = py;',
        '  float dist = sqrt(ex*ex + ey*ey) + 1e-3;',
        '  float w = sin(dist * uWaveLen - uTime) * uStretch / (1.0 + dist);',
        '  dx = (ex / dist) * w;',
        '  dy = (ey / dist) * w;',
        '} else {',
        '  dx = (sin(uTime + py * uWaveLen) + sin(2.0*uTime + py * uWaveLen * 2.0) * 0.5) * uShear;',
        '  dy = (cos(uTime + px * uWaveLen) + cos(2.0*uTime + px * uWaveLen * 2.0) * 0.5) * uStretch;',
        '}',
        'transformed.x += dx * uIntensity;',
        'transformed.y += dy * uIntensity;',
      ].join('\n'))

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform sampler2D uFillTex; uniform float uFillTiling;',
        'uniform vec3 uTextColor; uniform float uTextRow; uniform float uTextCount;',
        'uniform float uWordFrac; uniform float uTextSkew;',
        'varying vec2 vRawUv;',
      ].join('\n'))
      .replace('#include <map_fragment>', [
        'float us = (vRawUv.x + (vRawUv.y - 0.5) * uTextSkew) * uWordFrac;',
        'us = clamp(us, 0.0, 1.0);',
        'float vv = (uTextRow + clamp(vRawUv.y, 0.0, 1.0)) / uTextCount;',
        'vec4 tTex = texture2D(map, vec2(us, vv));',
        'vec3 fill = texture2D(uFillTex, vRawUv * uFillTiling).rgb;',
        'diffuseColor = vec4(mix(fill, uTextColor, tTex.a), 1.0);',
      ].join('\n'))
  }
  return mat
}

export const elasticEffect: SpaceTypeEffect = {
  id: 'elastic',
  label: 'Elastic',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    planeUniforms = []

    const textCount = Math.max(1, Math.floor(Number(textTexture.userData?.numTexts ?? 1)))
    const wordFracs: number[] = (textTexture.userData?.wordFracs as number[] | undefined) ?? new Array(textCount).fill(1)

    const fills = parseFills(params.fills)
    const fill = fills[0]!
    const textColor = new three.Color(fill.textColor)

    const scale = n(params, 'scale')
    const baseW = 12 * scale
    const lineH = (n(params, 'typeHeight') / 180) * 2.0 * scale
    const leading = n(params, 'leading') * scale
    const segX = 120
    const segY = 16   // enough vertical resolution for non-linear Y modes (Pinch/Jelly)

    const ys = stackPositions(textCount, lineH, leading)
    const xs = lineStaggerOffsets(textCount, n(params, 'lineStagger') * scale)
    const lineSkewSlope = Math.tan((n(params, 'lineSkew') * Math.PI) / 180)
    const textSkewSlope = Math.tan((n(params, 'textSkew') * Math.PI) / 180)
    const mode = modeIndex(params)

    for (let i = 0; i < textCount; i++) {
      const geo = new three.PlaneGeometry(baseW, lineH, segX, segY)
      const tex = textTexture.clone()
      tex.needsUpdate = true

      const u: PlaneUniforms = {
        uMode: { value: mode },
        uTime: { value: 0 },
        uIntensity: { value: n(params, 'intensity') },
        uStretch: { value: n(params, 'stretch') },
        uShear: { value: n(params, 'shear') },
        uWaveLen: { value: n(params, 'waveLength') },
        uLineT: { value: textCount > 1 ? i / (textCount - 1) : 0 },
        uLineSkew: { value: lineSkewSlope },
        uTextSkew: { value: textSkewSlope },
      }

      const mat = frontMaterial(
        three, tex, fillShaderTexture(three, fill), fillTiling(fill), textColor,
        i, textCount, wordFracs[i] ?? 1, u,
      )
      const mesh = new three.Mesh(geo, mat)
      mesh.position.set(xs[i] ?? 0, ys[i] ?? 0, 0)
      mesh.userData.tex = tex
      root.add(mesh)
      planeUniforms.push(u)
    }

    return root
  },

  update(t01, params) {
    if (!planeUniforms.length) return
    const cycles = Math.max(1, Math.round(n(params, 'speed')))
    const time = t01 * cycles * TAU
    const mode = modeIndex(params)
    for (const u of planeUniforms) {
      // uLineT is a per-line structural constant (set in buildScene), not animated.
      u.uTime.value = time
      u.uMode.value = mode
      u.uIntensity.value = n(params, 'intensity')
      u.uStretch.value = n(params, 'stretch')
      u.uShear.value = n(params, 'shear')
      u.uWaveLen.value = n(params, 'waveLength')
      u.uLineSkew.value = Math.tan((n(params, 'lineSkew') * Math.PI) / 180)
      u.uTextSkew.value = Math.tan((n(params, 'textSkew') * Math.PI) / 180)
    }
  },
}
