import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

const controls: ControlSpec[] = [
  // TYPE — shared text controls (typeXScale / typeYScale / typeWeight are honored
  // by textTexture via texOpts; see state.ts / SpaceTypeSurface.vue).
  { key: 'text', label: 'Text', kind: 'text', default: 'SPACE TYPE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'inter', group: 'Type' },
  { key: 'typeXScale', label: 'Type X-Scale', kind: 'slider', min: 0.3, max: 3, step: 0.05, default: 1, group: 'Type' },
  { key: 'typeYScale', label: 'Type Y-Scale', kind: 'slider', min: 40, max: 320, step: 2, default: 160, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  // CYLINDER (Ribbon group)
  { key: 'radius', label: 'Radius', kind: 'slider', min: 2, max: 14, step: 0.1, default: 5, group: 'Ribbon' },
  { key: 'count', label: 'Count', kind: 'slider', min: 1, max: 10, step: 1, default: 1, group: 'Ribbon' },
  { key: 'cylRotate', label: 'Cyl rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Ribbon' },
  { key: 'cylOffset', label: 'Cyl offset', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Ribbon' },
  // WAVE — vertex deformation (Snake group)
  { key: 'waveCount', label: 'Wave count', kind: 'slider', min: 0, max: 8, step: 1, default: 2, group: 'Snake' },
  { key: 'waveLatitude', label: 'Wave latitude', kind: 'slider', min: 0, max: 3, step: 0.02, default: 0, group: 'Snake' },
  { key: 'waveLongitude', label: 'Wave longitude', kind: 'slider', min: 0, max: 3, step: 0.02, default: 0, group: 'Snake' },
  { key: 'waveRipple', label: 'Wave ripple', kind: 'slider', min: 0, max: 3, step: 0.02, default: 0, group: 'Snake' },
  { key: 'waveXScale', label: 'Wave X-scale', kind: 'slider', min: 0, max: 2, step: 0.02, default: 0, group: 'Snake' },
  { key: 'waveYScale', label: 'Wave Y-scale', kind: 'slider', min: 0, max: 2, step: 0.02, default: 0, group: 'Snake' },
  // MOTION
  { key: 'waveSpeed', label: 'Wave speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0, group: 'Motion' },
  // CAMERA + TWEAK (Transform group)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Camera rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.3, group: 'Transform' },
  { key: 'rotateY', label: 'Camera rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Camera rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'tweakX', label: 'Tweak X', kind: 'slider', min: -1.5, max: 1.5, step: 0.01, default: 0, group: 'Transform' },
  { key: 'tweakY', label: 'Tweak Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.01, default: 0, group: 'Transform' },
  { key: 'tweakZ', label: 'Tweak Z', kind: 'slider', min: -1.5, max: 1.5, step: 0.01, default: 0, group: 'Transform' },
  // COLOR — cylinder usually flat color, gradient off by default.
  { key: 'gradientMode', label: 'Gradient', kind: 'select', options: ['on', 'off'], default: 'off', group: 'Color' },
  { key: 'typeColor', label: 'Text', kind: 'color', default: '#101014', group: 'Color' },
  { key: 'aSideColor', label: 'A-side', kind: 'color', default: '#f5f5f7', group: 'Color' },
  { key: 'bSideColor', label: 'B-side / inside', kind: 'color', default: '#0a0a0c', group: 'Color' },
  // SHADOW (copied from ribbon)
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

// Fixed cylinder height. The text wraps AROUND the circumference (texture repeat),
// so the height is purely the 3D band height; vertex segments make the wave smooth.
const CYL_HEIGHT = 2.2

// v2 assumes a single active engine/surface instance: buildScene populates this
// module-level array and update() reads it. Two concurrent engines would clash —
// promote to instance state (e.g. root.userData.cylinders) if multi-surface is ever needed.
interface WaveUniforms {
  uWaveCount: { value: number }
  uWaveLat: { value: number }
  uWaveLong: { value: number }
  uWaveRipple: { value: number }
  uWaveXS: { value: number }
  uWaveYS: { value: number }
  uWaveTime: { value: number }
}
let cylinders: { tex: THREE.Texture; baseOffset: number; group: THREE.Group; wave: WaveUniforms }[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

// GLSL injected after <begin_vertex> to deform `transformed` by the wave system,
// using the vertex's cylindrical coords. Shared by the front (Lambert) and back
// (Basic) materials so they stay aligned. The `transformed` variable holds the
// local-space position both materials' begin_vertex chunks declare.
const WAVE_PARS = `
uniform float uWaveCount;
uniform float uWaveLat;
uniform float uWaveLong;
uniform float uWaveRipple;
uniform float uWaveXS;
uniform float uWaveYS;
uniform float uWaveTime;
`
const WAVE_DEFORM = `
{
  float ang = atan(position.z, position.x);          // around the cylinder
  float hy = position.y;                             // height
  float t = uWaveTime;
  float dr = uWaveLat * sin(hy * uWaveCount + t)
           + uWaveLong * sin(ang * uWaveCount + t)
           + uWaveRipple * sin((ang * uWaveCount + hy * uWaveCount) + t);
  vec2 rad = normalize(vec2(position.x, position.z) + 1e-6);
  transformed.x += rad.x * dr;
  transformed.z += rad.y * dr;
  transformed.y += uWaveYS * sin(ang * uWaveCount + t);
  transformed.x += uWaveXS * sin(hy * uWaveCount + t);
}
`

function makeWaveUniforms(three: typeof THREE, params: Params): WaveUniforms {
  void three
  return {
    uWaveCount: { value: Math.max(0, Math.round(n(params, 'waveCount'))) },
    uWaveLat: { value: n(params, 'waveLatitude') },
    uWaveLong: { value: n(params, 'waveLongitude') },
    uWaveRipple: { value: n(params, 'waveRipple') },
    uWaveXS: { value: n(params, 'waveXScale') },
    uWaveYS: { value: n(params, 'waveYScale') },
    uWaveTime: { value: 0 },
  }
}

/**
 * Front material — copied from ribbon.ts's frontMaterial VERBATIM (uniforms,
 * vRawU vertex injection, shadowmap_pars_fragment → +shadowmask_pars_fragment,
 * map_fragment composite, opaque_fragment getShadowMask override). The ONLY
 * addition is the WAVE vertex deformation (WAVE_PARS + WAVE_DEFORM after
 * <begin_vertex>), whose uniform objects are SHARED with the back material so
 * front/back stay aligned.
 *
 * The shadow injection (shadowmask_pars_fragment + getShadowMask multiply) was hard
 * to get right (black ribbons) — it is copied verbatim and must not be re-derived.
 *
 * Uses MeshLambertMaterial so the shadow pipeline (shadowmap_pars_fragment,
 * getShadowMask(), USE_SHADOWMAP) is RELIABLY present without re-injection. We
 * override <opaque_fragment> to ignore Lambert's diffuse dimming and output the
 * flat gradient/text albedo multiplied by the shadow mask. For the cylinder,
 * vRawU = uv.x around the circumference, so the gradient pins to the circumference
 * and the text scroll does not drag it.
 */
function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  gradientTex: THREE.Texture | null,
  params: Params,
  uRepeat: number,
  wave: WaveUniforms,
): THREE.MeshLambertMaterial {
  const mat = new three.MeshLambertMaterial({ map, side: three.FrontSide })
  const uUseGradient = { value: String(params.gradientMode) === 'on' && gradientTex ? 1 : 0 }
  const uAside = { value: new three.Color(String(params.aSideColor)) }
  const uGradient = { value: gradientTex ?? null }
  const uURepeat = { value: uRepeat }
  const uShadowStrength = { value: String(params.shadows) === 'on' ? n(params, 'shadowStrength') : 0 }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uUseGradient = uUseGradient
    shader.uniforms.uAside = uAside
    shader.uniforms.uGradient = uGradient
    shader.uniforms.uURepeat = uURepeat
    shader.uniforms.uShadowStrength = uShadowStrength
    // Share the wave uniform OBJECTS so update() can drive them live.
    shader.uniforms.uWaveCount = wave.uWaveCount
    shader.uniforms.uWaveLat = wave.uWaveLat
    shader.uniforms.uWaveLong = wave.uWaveLong
    shader.uniforms.uWaveRipple = wave.uWaveRipple
    shader.uniforms.uWaveXS = wave.uWaveXS
    shader.uniforms.uWaveYS = wave.uWaveYS
    shader.uniforms.uWaveTime = wave.uWaveTime
    // Lambert already includes shadowmap_pars_vertex/shadowmap_vertex/worldpos_vertex —
    // do NOT re-inject them. Add the vRawU varying (gradient pin) + WAVE uniforms,
    // and deform `transformed` right after <begin_vertex>.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRawU;' + WAVE_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawU = uv.x;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WAVE_DEFORM)
    // Lambert includes lights_pars_begin + shadowmap_pars_fragment (getShadow), but
    // NOT shadowmask_pars_fragment — so getShadowMask() is undefined and the shader
    // fails to compile (black surfaces). Inject shadowmask_pars_fragment AFTER
    // shadowmap_pars_fragment, where all its deps are already declared.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uUseGradient;\nuniform vec3 uAside;\nuniform sampler2D uGradient;\nuniform float uURepeat;\nuniform float uShadowStrength;\nvarying float vRawU;')
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec3 fill = uAside; if (uUseGradient > 0.5) { fill = texture2D(uGradient, vec2(vRawU / uURepeat, 0.5)).rgb; } diffuseColor = vec4(mix(fill, diffuseColor.rgb, diffuseColor.a), 1.0); }')
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( diffuseColor.rgb * mix(1.0 - uShadowStrength, 1.0, getShadowMask()), 1.0 );')
  }
  return mat
}

/**
 * Back material (inside of the cylinder) — solid B-side color, BackSide. We give
 * it the SAME wave vertex deformation as the front (sharing the wave uniform
 * objects) so the inner face follows the outer face exactly.
 */
function backMaterial(three: typeof THREE, params: Params, wave: WaveUniforms): THREE.MeshBasicMaterial {
  const mat = new three.MeshBasicMaterial({
    color: new three.Color(String(params.bSideColor)),
    side: three.BackSide,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaveCount = wave.uWaveCount
    shader.uniforms.uWaveLat = wave.uWaveLat
    shader.uniforms.uWaveLong = wave.uWaveLong
    shader.uniforms.uWaveRipple = wave.uWaveRipple
    shader.uniforms.uWaveXS = wave.uWaveXS
    shader.uniforms.uWaveYS = wave.uWaveYS
    shader.uniforms.uWaveTime = wave.uWaveTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>' + WAVE_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WAVE_DEFORM)
  }
  return mat
}

export const cylinderEffect: SpaceTypeEffect = {
  id: 'cylinder',
  label: 'Cylinder',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    cylinders = []

    const gradientTex = (textTexture.userData?.gradient as THREE.Texture | undefined) ?? null
    const count = Math.max(1, Math.floor(n(params, 'count')))
    const radius = n(params, 'radius')
    const cylRotate = n(params, 'cylRotate')
    const cylOffset = n(params, 'cylOffset')

    // Tiles around the circumference: scale the repeat with circumference so the
    // text reads at a roughly constant density regardless of radius.
    const circumference = 2 * Math.PI * radius
    const tilesAround = Math.max(1, Math.round(circumference / 6))

    // Centered Y stack; spacing derived from the band height.
    const spacing = CYL_HEIGHT * 1.3
    const center = (count - 1) / 2

    for (let i = 0; i < count; i++) {
      // 160 radial + 24 height segments so the vertex wave deformation is smooth.
      const geo = new three.CylinderGeometry(radius, radius, CYL_HEIGHT, 160, 24, true)

      // Independent texture per cylinder ⇒ clone the shared text texture. The text
      // tiles `tilesAround` times around the circumference (wrapS = RepeatWrapping).
      const tex = textTexture.clone()
      tex.needsUpdate = true
      tex.wrapS = three.RepeatWrapping
      tex.repeat.x = tilesAround
      // Phase the text start per stacked cylinder by cylOffset (in tile units).
      const baseOffset = (cylOffset * (count > 1 ? i : 1))
      tex.offset.x = baseOffset

      // One wave uniform set per cylinder, shared by its front + back materials.
      const wave = makeWaveUniforms(three, params)

      const frontMat = frontMaterial(three, tex, gradientTex, params, tilesAround, wave)
      const backMat = backMaterial(three, params, wave)

      // Front (outside, readable text + shadows) + back (inside, solid B-side)
      // share ONE CylinderGeometry (FrontSide vs BackSide), both wave-deformed.
      const front = new three.Mesh(geo, frontMat)
      // Register the cloned texture so disposeRoot() frees it on rebuild.
      front.userData.tex = tex
      front.castShadow = true; front.receiveShadow = true
      const back = new three.Mesh(geo, backMat)
      back.castShadow = true

      const subGroup = new three.Group()
      subGroup.position.y = (i - center) * spacing
      subGroup.rotation.y = cylRotate
      subGroup.add(front)
      subGroup.add(back)
      root.add(subGroup)

      cylinders.push({ tex, baseOffset, group: subGroup, wave })
    }

    const strength = n(params, 'shadowStrength')
    // Front surfaces use MeshLambertMaterial with overridden output — full-bright flat
    // look, no AmbientLight needed. When shadows are on we add a shadow-casting
    // DirectionalLight + ShadowMaterial catcher; the front material multiplies in
    // getShadowMask() so only shadowed pixels darken. (Copied verbatim from ribbon.)
    if (String(params.shadows) === 'on') {
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
    // Integer cycles ⇒ seamless loop; waveSpeed 0 = static.
    const cycles = Math.max(0, Math.round(n(params, 'waveSpeed')))
    const time = t01 * cycles * Math.PI * 2
    const cylRotate = n(params, 'cylRotate')
    const tweakX = n(params, 'tweakX')
    const tweakY = n(params, 'tweakY')
    const tweakZ = n(params, 'tweakZ')
    // Read wave params live so dragging the WAVE sliders updates without a rebuild.
    const wc = Math.max(0, Math.round(n(params, 'waveCount')))
    const wlat = n(params, 'waveLatitude')
    const wlong = n(params, 'waveLongitude')
    const wrip = n(params, 'waveRipple')
    const wxs = n(params, 'waveXScale')
    const wys = n(params, 'waveYScale')
    for (const c of cylinders) {
      c.wave.uWaveTime.value = time
      c.wave.uWaveCount.value = wc
      c.wave.uWaveLat.value = wlat
      c.wave.uWaveLong.value = wlong
      c.wave.uWaveRipple.value = wrip
      c.wave.uWaveXS.value = wxs
      c.wave.uWaveYS.value = wys
      // Extra per-cylinder rotation (tweak) layered on the static cylRotate.
      c.group.rotation.set(tweakX, cylRotate + tweakY, tweakZ)
    }
  },
}
