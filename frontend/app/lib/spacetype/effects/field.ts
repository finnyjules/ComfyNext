import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills, fillShaderTexture, fillTiling } from '../fills'
import { defaultFillsFor } from '../palette'

/**
 * FIELD — tiled text grid on a waved plane (source-matched to spacetypegenerator.com/field).
 *
 * STG field places discrete characters on a cols×rows grid in 3D (WEBGL), each
 * displaced by independent Z/X/Y sine waves with separate X and Y spatial
 * frequencies, per-axis phase offset toggles (add PI), and auto-orientation
 * to the Z surface. We approximate this with a single subdivided PlaneGeometry
 * and vertex-shader displacement — the auto-tilt is inherent (mesh normals
 * follow the displaced surface).
 *
 * STG wave formula: sin(time·speed/100 + col/xSize + row/ySize + offset)
 * where offset = 0 or PI (checkbox toggle).
 */

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'SPACE TYPE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  { key: 'cols', label: 'Columns', kind: 'slider', min: 4, max: 60, step: 1, default: 16, group: 'Ribbon' },
  { key: 'rows', label: 'Rows', kind: 'slider', min: 4, max: 60, step: 1, default: 12, group: 'Ribbon' },
  { key: 'fieldScale', label: 'Field scale', kind: 'slider', min: 6, max: 24, step: 0.5, default: 14, group: 'Ribbon' },
  // Wave: separate X/Y spatial frequency (STG's "X Size" / "Y Size").
  { key: 'waveSizeX', label: 'Wave X size', kind: 'slider', min: 0.5, max: 12, step: 0.1, default: 3.1, group: 'Wave' },
  { key: 'waveSizeY', label: 'Wave Y size', kind: 'slider', min: 0.5, max: 12, step: 0.1, default: 3.1, group: 'Wave' },
  // Amplitude per axis (STG's Z/X/Y axis sliders).
  { key: 'ampZ', label: 'Z axis', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1.2, group: 'Wave' },
  { key: 'ampX', label: 'X axis', kind: 'slider', min: 0, max: 4, step: 0.05, default: 0, group: 'Wave' },
  { key: 'ampY', label: 'Y axis', kind: 'slider', min: 0, max: 4, step: 0.05, default: 0, group: 'Wave' },
  // Per-axis offset toggles (add PI to the phase — inverts the wave for that axis).
  { key: 'zOffset', label: 'Z offset', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Wave' },
  { key: 'xOffset', label: 'X offset', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Wave' },
  { key: 'yOffset', label: 'Y offset', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Wave' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.4, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  // Field fill (solid/gradient/grid/noise) + text colour. (Uses the first fill in the list.)
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(1, 'field'), group: 'Color' },
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

let waveUniforms: {
  uAmpZ: { value: number }
  uAmpX: { value: number }
  uAmpY: { value: number }
  uFreqX: { value: number }
  uFreqY: { value: number }
  uZOffset: { value: number }
  uXOffset: { value: number }
  uYOffset: { value: number }
  uWaveTime: { value: number }
} | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  fillTex: THREE.Texture,
  tiling: number,
  textColor: THREE.Color,
  params: Params,
  numTexts: number,
  waveUniforms: {
    uAmpZ: { value: number }
    uAmpX: { value: number }
    uAmpY: { value: number }
    uFreqX: { value: number }
    uFreqY: { value: number }
    uZOffset: { value: number }
    uXOffset: { value: number }
    uYOffset: { value: number }
    uWaveTime: { value: number }
  },
): THREE.MeshLambertMaterial {
  const mat = new three.MeshLambertMaterial({ map, side: three.DoubleSide })
  const uFillTex = { value: fillTex }
  const uFillTiling = { value: tiling }
  const uTextColor = { value: textColor }
  const uNumTexts = { value: Math.max(1, Math.round(numTexts)) }
  const uRows = { value: Math.max(1, Math.floor(n(params, 'rows'))) }
  const uShadowStrength = { value: String(params.shadows) === 'on' ? n(params, 'shadowStrength') : 0 }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFillTex = uFillTex
    shader.uniforms.uFillTiling = uFillTiling
    shader.uniforms.uTextColor = uTextColor
    shader.uniforms.uNumTexts = uNumTexts
    shader.uniforms.uShadowStrength = uShadowStrength
    shader.uniforms.uRows = uRows
    shader.uniforms.uAmpZ = waveUniforms.uAmpZ
    shader.uniforms.uAmpX = waveUniforms.uAmpX
    shader.uniforms.uAmpY = waveUniforms.uAmpY
    shader.uniforms.uFreqX = waveUniforms.uFreqX
    shader.uniforms.uFreqY = waveUniforms.uFreqY
    shader.uniforms.uZOffset = waveUniforms.uZOffset
    shader.uniforms.uXOffset = waveUniforms.uXOffset
    shader.uniforms.uYOffset = waveUniforms.uYOffset
    shader.uniforms.uWaveTime = waveUniforms.uWaveTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec2 vRawUv;',
        'uniform float uAmpZ; uniform float uAmpX; uniform float uAmpY;',
        'uniform float uFreqX; uniform float uFreqY;',
        'uniform float uZOffset; uniform float uXOffset; uniform float uYOffset;',
        'uniform float uWaveTime;',
      ].join('\n'))
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawUv = uv;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'float px = position.x / uFreqX;',
        'float py = position.y / uFreqY;',
        'float t = uWaveTime;',
        // Z: direct displacement (STG: sinEngine * zWave)
        'transformed.z += sin(px + py + t + uZOffset) * uAmpZ;',
        // X: mapped to [0, amp] like STG (map(sin,-1,1,0,xWave))
        'transformed.x += (sin(px + py + t + uXOffset) + 1.0) * 0.5 * uAmpX;',
        // Y: direct displacement
        'transformed.y += sin(px + py + t + uYOffset) * uAmpY;',
      ].join('\n'))
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFillTex;\nuniform float uFillTiling;\nuniform vec3 uTextColor;\nuniform float uNumTexts;\nuniform float uRows;\nuniform float uShadowStrength;\nvarying vec2 vRawUv;')
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
      // Alternate texts: each grid tile shows one of the N atlas rows. Count rows from the TOP
      // ((uRows-1-ftRow)) so the FIRST string lands on the top row — matches the band effects'
      // textVariantForBand convention. The field fill is sampled at the plane uv; text colour flat.
      .replace('#include <map_fragment>', [
        'float ftCol = floor(vMapUv.x); float ftRow = floor(vMapUv.y);',
        'float ftVariant = mod(ftCol + (uRows - 1.0 - ftRow), uNumTexts);',
        'vec2 ftUv = vec2(fract(vMapUv.x), (ftVariant + fract(vMapUv.y)) / uNumTexts);',
        'vec4 ftTex = texture2D(map, ftUv);',
        'vec3 fill = texture2D(uFillTex, vRawUv * uFillTiling).rgb;',
        'diffuseColor = vec4(mix(fill, uTextColor, ftTex.a), 1.0);',
      ].join('\n'))
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( diffuseColor.rgb * mix(1.0 - uShadowStrength, 1.0, getShadowMask()), 1.0 );')
  }
  return mat
}

export const fieldEffect: SpaceTypeEffect = {
  id: 'field',
  label: 'Field',
  controls,
  liveKeys: ['ampZ', 'ampX', 'ampY', 'waveSizeX', 'waveSizeY', 'zOffset', 'xOffset', 'yOffset'],

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    waveUniforms = null

    const fills = parseFills(params.fills)
    const cols = Math.max(1, Math.floor(n(params, 'cols')))
    const rows = Math.max(1, Math.floor(n(params, 'rows')))
    const fieldScale = n(params, 'fieldScale')

    const aspect = cols / Math.max(1, rows)
    const fieldW = fieldScale * Math.sqrt(aspect)
    const fieldH = fieldScale / Math.sqrt(aspect)

    const geo = new three.PlaneGeometry(fieldW, fieldH, cols, rows)

    const tex = textTexture.clone()
    tex.needsUpdate = true
    tex.wrapS = three.RepeatWrapping
    tex.wrapT = three.RepeatWrapping
    tex.repeat.set(Math.max(1, cols / 4), rows)

    const uRepeat = Math.max(1, cols / 4)

    const PI = Math.PI
    const wu = {
      uAmpZ: { value: n(params, 'ampZ') },
      uAmpX: { value: n(params, 'ampX') },
      uAmpY: { value: n(params, 'ampY') },
      uFreqX: { value: n(params, 'waveSizeX') },
      uFreqY: { value: n(params, 'waveSizeY') },
      uZOffset: { value: String(params.zOffset) === 'on' ? PI : 0 },
      uXOffset: { value: String(params.xOffset) === 'on' ? PI : 0 },
      uYOffset: { value: String(params.yOffset) === 'on' ? PI : 0 },
      uWaveTime: { value: 0 },
    }
    waveUniforms = wu

    const numTexts = Math.max(1, Math.floor(Number(textTexture.userData?.numTexts ?? 1)))
    const fill = fills[0]!
    const mat = frontMaterial(three, tex, fillShaderTexture(three, fill), fillTiling(fill), new three.Color(fill.textColor), params, numTexts, wu)

    const mesh = new three.Mesh(geo, mat)
    mesh.userData.tex = tex
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)

    if (String(params.shadows) === 'on') {
      const strength = n(params, 'shadowStrength')
      const lx = n(params, 'lightAngleX')
      const ly = n(params, 'lightAngleY')
      const light = new three.DirectionalLight(0xffffff, 1)
      light.position.set(Math.sin(lx) * 30, 12 + Math.sin(ly) * 16, 26)
      light.castShadow = true
      const soft = Math.max(0, n(params, 'shadowSoftness'))
      const ms = Math.max(256, Math.round(2048 - soft * 44))
      light.shadow.mapSize.set(ms, ms)
      const cam = light.shadow.camera as THREE.OrthographicCamera
      cam.left = -40; cam.right = 40; cam.top = 40; cam.bottom = -40; cam.near = 0.1; cam.far = 120
      cam.updateProjectionMatrix()
      light.shadow.bias = -0.0008
      light.shadow.radius = 4
      root.add(light)
      root.add(light.target)

      const catcher = new three.Mesh(
        new three.PlaneGeometry(200, 200),
        new three.ShadowMaterial({ opacity: strength, transparent: true }),
      )
      catcher.position.z = -8
      catcher.receiveShadow = true
      root.add(catcher)
    }

    return root
  },

  update(t01, params) {
    if (!waveUniforms) return
    const speed = n(params, 'speed')
    const PI = Math.PI
    waveUniforms.uWaveTime.value = t01 * Math.max(1, Math.round(speed)) * PI * 2
    waveUniforms.uAmpZ.value = n(params, 'ampZ')
    waveUniforms.uAmpX.value = n(params, 'ampX')
    waveUniforms.uAmpY.value = n(params, 'ampY')
    waveUniforms.uFreqX.value = n(params, 'waveSizeX')
    waveUniforms.uFreqY.value = n(params, 'waveSizeY')
    waveUniforms.uZOffset.value = String(params.zOffset) === 'on' ? PI : 0
    waveUniforms.uXOffset.value = String(params.xOffset) === 'on' ? PI : 0
    waveUniforms.uYOffset.value = String(params.yOffset) === 'on' ? PI : 0
  },
}
