import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'SPACE TYPE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  // Ribbon group = field structure (subdivided plane resolution + size).
  { key: 'cols', label: 'Columns', kind: 'slider', min: 4, max: 40, step: 1, default: 16, group: 'Ribbon' },
  { key: 'rows', label: 'Rows', kind: 'slider', min: 4, max: 40, step: 1, default: 12, group: 'Ribbon' },
  { key: 'fieldScale', label: 'Field scale', kind: 'slider', min: 6, max: 24, step: 0.5, default: 14, group: 'Ribbon' },
  // Snake group = the per-axis displacement waves.
  { key: 'ampZ', label: 'Amp Z', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1.2, group: 'Snake' },
  { key: 'ampX', label: 'Amp X', kind: 'slider', min: 0, max: 2, step: 0.05, default: 0, group: 'Snake' },
  { key: 'ampY', label: 'Amp Y', kind: 'slider', min: 0, max: 2, step: 0.05, default: 0, group: 'Snake' },
  { key: 'waveFreq', label: 'Wave freq', kind: 'slider', min: 0.1, max: 3, step: 0.05, default: 0.6, group: 'Snake' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.4, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'gradientMode', label: 'Gradient', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Color' },
  { key: 'typeColor', label: 'Text', kind: 'color', default: '#101014', group: 'Color' },
  { key: 'aSideColor', label: 'Fill', kind: 'color', default: '#f5f5f7', group: 'Color' },
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

// v2 assumes a single active engine/surface instance: buildScene populates these
// module-level references and update() reads them. Two concurrent engines would
// clash — promote to instance state (e.g. root.userData.field) if multi-surface
// is ever needed.
let waveTime: { value: number } | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

/**
 * Front material — copied from ribbon.ts's frontMaterial VERBATIM (text glyph map
 * composited ON TOP of an opaque fill — the gradient ramp when Gradient is on, or a
 * flat fill color; the shadow injection of shadowmask_pars_fragment + the
 * getShadowMask() multiply in <opaque_fragment>) and then EXTENDED with a vertex
 * wave: after <begin_vertex> each vertex is displaced by per-axis sine waves so the
 * flat plane undulates into a 3D field. The wave uniforms are passed in so update()
 * can advance uWaveTime.
 *
 * The shadow injection was hard to get right (black surfaces) — it is copied
 * verbatim and must not be re-derived. Uses MeshLambertMaterial so the shadow
 * pipeline (shadowmap_pars_fragment, getShadowMask(), USE_SHADOWMAP) is RELIABLY
 * present without re-injection; <opaque_fragment> is overridden to output the flat
 * gradient/text albedo multiplied by the shadow mask.
 */
function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  gradientTex: THREE.Texture | null,
  params: Params,
  uRepeat: number,
  waveUniforms: {
    uAmpZ: { value: number }
    uAmpX: { value: number }
    uAmpY: { value: number }
    uWaveFreq: { value: number }
    uWaveTime: { value: number }
  },
): THREE.MeshLambertMaterial {
  // Lambert is a lit material, so getShadowMask()/USE_SHADOWMAP are reliably available.
  // We override the output to ignore Lambert's diffuse shading and show the flat
  // gradient/text albedo multiplied by the shadow mask → full-bright flat surfaces
  // that darken only where shadowed.
  const mat = new three.MeshLambertMaterial({ map, side: three.DoubleSide })
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
    // Wave-displacement uniforms (the only addition over ribbon's verbatim material).
    shader.uniforms.uAmpZ = waveUniforms.uAmpZ
    shader.uniforms.uAmpX = waveUniforms.uAmpX
    shader.uniforms.uAmpY = waveUniforms.uAmpY
    shader.uniforms.uWaveFreq = waveUniforms.uWaveFreq
    shader.uniforms.uWaveTime = waveUniforms.uWaveTime
    // Lambert already includes shadowmap_pars_vertex/shadowmap_vertex/worldpos_vertex —
    // do NOT re-inject them (would redefine symbols and break compilation).
    // Add the vRawU varying (so the gradient is pinned to the plane and does not
    // drift with the text scroll) AND the wave uniforms + per-vertex displacement
    // after <begin_vertex>. Displacing `transformed` before the shadow/worldpos
    // includes means casters and the lit surface use the SAME undulated geometry.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRawU;\nuniform float uAmpZ;\nuniform float uAmpX;\nuniform float uAmpY;\nuniform float uWaveFreq;\nuniform float uWaveTime;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawU = uv.x;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat fx = position.x * uWaveFreq;\nfloat fy = position.y * uWaveFreq;\ntransformed.z += sin(fx + uWaveTime) * uAmpZ + cos(fy + uWaveTime) * uAmpZ * 0.5;\ntransformed.x += sin(fy * 0.7 + uWaveTime) * uAmpX;\ntransformed.y += cos(fx * 0.7 + uWaveTime) * uAmpY;')
    // Lambert includes lights_pars_begin + shadowmap_pars_fragment (getShadow), but
    // NOT shadowmask_pars_fragment — so getShadowMask() is undefined and the shader
    // fails to compile (black surfaces). Inject shadowmask_pars_fragment AFTER
    // shadowmap_pars_fragment, where all its deps (directionalLightShadows,
    // directionalShadowMap, getShadow, receiveShadow) are already declared.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uUseGradient;\nuniform vec3 uAside;\nuniform sampler2D uGradient;\nuniform float uURepeat;\nuniform float uShadowStrength;\nvarying float vRawU;')
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec3 fill = uAside; if (uUseGradient > 0.5) { fill = texture2D(uGradient, vec2(vRawU / uURepeat, 0.5)).rgb; } diffuseColor = vec4(mix(fill, diffuseColor.rgb, diffuseColor.a), 1.0); }')
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( diffuseColor.rgb * mix(1.0 - uShadowStrength, 1.0, getShadowMask()), 1.0 );')
  }
  return mat
}

export const fieldEffect: SpaceTypeEffect = {
  id: 'field',
  label: 'Field',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    waveTime = null

    const gradientTex = (textTexture.userData?.gradient as THREE.Texture | undefined) ?? null
    const cols = Math.max(1, Math.floor(n(params, 'cols')))
    const rows = Math.max(1, Math.floor(n(params, 'rows')))
    const fieldScale = n(params, 'fieldScale')

    // Square-ish plane sized by fieldScale, biased by the cols/rows aspect so the
    // tiled text keeps roughly square cells.
    const aspect = cols / Math.max(1, rows)
    const fieldW = fieldScale * Math.sqrt(aspect)
    const fieldH = fieldScale / Math.sqrt(aspect)

    // One big subdivided plane (cols×rows segments) lying in XY, facing the camera.
    const geo = new three.PlaneGeometry(fieldW, fieldH, cols, rows)

    // Tile the text texture across the plane as a GRID. The single text line is
    // wide, so it tiles ~cols/4 times horizontally (each tile ≈ one "cell" line)
    // and `rows` times vertically — a tiled-text field (v1 approximation; the user
    // tunes cols/rows for the look they want).
    const tex = textTexture.clone()
    tex.needsUpdate = true
    tex.wrapS = three.RepeatWrapping
    tex.wrapT = three.RepeatWrapping
    tex.repeat.set(Math.max(1, cols / 4), rows)

    // The effective horizontal repeat drives the gradient pinning (vRawU / uURepeat).
    const uRepeat = Math.max(1, cols / 4)

    const waveUniforms = {
      uAmpZ: { value: n(params, 'ampZ') },
      uAmpX: { value: n(params, 'ampX') },
      uAmpY: { value: n(params, 'ampY') },
      uWaveFreq: { value: n(params, 'waveFreq') },
      uWaveTime: { value: 0 },
    }
    waveTime = waveUniforms.uWaveTime

    const mat = frontMaterial(three, tex, gradientTex, params, uRepeat, waveUniforms)

    const mesh = new three.Mesh(geo, mat)
    // Register the cloned texture so disposeRoot() frees it on rebuild.
    mesh.userData.tex = tex
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)

    const strength = n(params, 'shadowStrength')
    // The field uses MeshLambertMaterial with overridden output — full-bright flat
    // look, no AmbientLight needed (Lambert's diffuse is overridden entirely).
    // When shadows are on we add a shadow-casting DirectionalLight + ShadowMaterial
    // catcher; the front material multiplies in getShadowMask() so only shadowed
    // pixels darken.
    if (String(params.shadows) === 'on') {
      const lx = n(params, 'lightAngleX')
      const ly = n(params, 'lightAngleY')
      const light = new three.DirectionalLight(0xffffff, 1)
      light.position.set(Math.sin(lx) * 30, 12 + Math.sin(ly) * 16, 26)
      light.castShadow = true
      // Shadow softness → lower shadow-map resolution = naturally blurrier edges
      // (PCFSoft smooths them), with none of VSM's light-bleeding / wash-out.
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
    const speed = n(params, 'speed')
    if (!waveTime) return
    // Advance the wave seamlessly: an INTEGER number of cycles per loop so the
    // field returns exactly to its start at the loop boundary (same loop-
    // quantization idea as ribbon's scroll, which rounds speed to whole tiles).
    waveTime.value = t01 * Math.max(1, Math.round(speed)) * Math.PI * 2
  },
}
