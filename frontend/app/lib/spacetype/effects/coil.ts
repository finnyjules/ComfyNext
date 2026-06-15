import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { scrollOffset } from '../ribbonGeometry'

const TAU = Math.PI * 2

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'SPACE TYPE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  { key: 'textRepeat', label: 'Text repeat', kind: 'slider', min: 1, max: 32, step: 1, default: 10, group: 'Type' },
  // Spiral geometry lives in the "Ribbon" section (shared section name across effects).
  { key: 'turns', label: 'Turns', kind: 'slider', min: 2, max: 12, step: 0.5, default: 6, group: 'Ribbon' },
  { key: 'startRadius', label: 'Start radius', kind: 'slider', min: 0.5, max: 6, step: 0.1, default: 1.5, group: 'Ribbon' },
  { key: 'spacing', label: 'Spacing', kind: 'slider', min: 0.4, max: 3, step: 0.05, default: 1.1, group: 'Ribbon' },
  { key: 'bandSize', label: 'Band size', kind: 'slider', min: 0.2, max: 2, step: 0.02, default: 0.7, group: 'Ribbon' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.5, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'spin', label: 'Spin', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'gradientMode', label: 'Gradient', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Color' },
  { key: 'typeColor', label: 'Text', kind: 'color', default: '#101014', group: 'Color' },
  { key: 'aSideColor', label: 'A-side', kind: 'color', default: '#f5f5f7', group: 'Color' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#0a0a0c', group: 'Color' },
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

// v2 assumes a single active engine/surface instance: buildScene populates this
// module-level array and update() reads it. Two concurrent engines would clash —
// promote to instance state (e.g. root.userData.coils) if multi-surface is ever needed.
let coils: { tex: THREE.Texture; uRepeat: number; dir: 1 | -1; group: THREE.Group }[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

export interface CoilGeoParams {
  turns: number
  startRadius: number
  spacing: number
  bandSize: number
  uRepeat: number
  segments?: number
}

export interface CoilGeoData {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

/**
 * PURE helper: build a swept-band geometry following an Archimedean spiral.
 *
 * Spiral: θ ∈ [0, turns·2π]. Radius r(θ) = startRadius + spacing·(θ / 2π) — so the
 * radius grows by `spacing` every full turn (concentric rings spiraling outward;
 * read inward → outward). Centerline P(θ) = (r·cosθ, r·sinθ, 0).
 *
 * At each sample we take the in-plane tangent and rotate it 90° in XY to get the
 * band's "across" direction, then emit two verts at P ± (bandSize/2)·across, z=0.
 *
 * UVs: u = (cumulative arc length / total arc length) × uRepeat so the text tiles
 * evenly along the (variable-pitch) spiral; v = 0/1 across the band. Returns flat
 * typed arrays — wrap into a BufferGeometry the same way ribbon.ts does.
 */
export function buildCoilGeometryData(p: CoilGeoParams): CoilGeoData {
  const turns = Math.max(0.1, p.turns)
  const seg = p.segments ?? Math.round(turns * 64)
  const segments = Math.min(4096, Math.max(64, Math.floor(seg)))
  const half = p.bandSize / 2
  const thetaMax = turns * TAU

  const count = segments + 1
  // Centerline points + a parallel cumulative arc-length array.
  const cx = new Float64Array(count)
  const cy = new Float64Array(count)
  const arc = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const theta = (i / segments) * thetaMax
    const r = p.startRadius + p.spacing * (theta / TAU)
    cx[i] = r * Math.cos(theta)
    cy[i] = r * Math.sin(theta)
    if (i > 0) {
      const dx = cx[i]! - cx[i - 1]!
      const dy = cy[i]! - cy[i - 1]!
      arc[i] = arc[i - 1]! + Math.hypot(dx, dy)
    }
  }
  const total = arc[count - 1]! || 1

  const positions = new Float32Array(count * 2 * 3)
  const uvs = new Float32Array(count * 2 * 2)
  for (let i = 0; i < count; i++) {
    // In-plane tangent via central/forward difference.
    const ip = Math.min(count - 1, i + 1)
    const im = Math.max(0, i - 1)
    let tx = cx[ip]! - cx[im]!
    let ty = cy[ip]! - cy[im]!
    const len = Math.hypot(tx, ty) || 1
    tx /= len; ty /= len
    // "across" = tangent rotated 90° in XY.
    const ax = -ty
    const ay = tx

    const a = i * 2
    const b = i * 2 + 1
    positions[a * 3] = cx[i]! + ax * half
    positions[a * 3 + 1] = cy[i]! + ay * half
    positions[a * 3 + 2] = 0
    positions[b * 3] = cx[i]! - ax * half
    positions[b * 3 + 1] = cy[i]! - ay * half
    positions[b * 3 + 2] = 0

    const u = (arc[i]! / total) * p.uRepeat
    uvs[a * 2] = u; uvs[a * 2 + 1] = 1
    uvs[b * 2] = u; uvs[b * 2 + 1] = 0
  }

  const indices = new Uint32Array(segments * 6)
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
    const o = i * 6
    indices[o] = a; indices[o + 1] = b; indices[o + 2] = c
    indices[o + 3] = c; indices[o + 4] = b; indices[o + 5] = d
  }
  return { positions, uvs, indices }
}

/**
 * Front material: text glyph map composited ON TOP of an opaque fill — the
 * gradient ramp (Gradient on) sampled along the spiral via vRawU, or a flat
 * A-side color. COPIED VERBATIM from ribbon.ts's frontMaterial (the shadow
 * injection — shadowmask_pars_fragment + getShadowMask multiply — was hard to
 * get right (black ribbons), so it must not be re-derived).
 *
 * Uses MeshLambertMaterial so the shadow pipeline (shadowmap_pars_fragment,
 * getShadowMask(), USE_SHADOWMAP) is RELIABLY present; <opaque_fragment> is
 * overridden to output the flat gradient/text albedo multiplied by the shadow mask.
 */
function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  gradientTex: THREE.Texture | null,
  params: Params,
  uRepeat: number,
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
    // Lambert already includes shadowmap_pars_vertex/shadowmap_vertex/worldpos_vertex —
    // do NOT re-inject them (would redefine symbols and break compilation).
    // Only add the vRawU varying so the gradient is pinned to the band and does
    // not drift with the text scroll.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRawU;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawU = uv.x;')
    // Lambert includes lights_pars_begin + shadowmap_pars_fragment (getShadow), but
    // NOT shadowmask_pars_fragment — so getShadowMask() is undefined and the shader
    // fails to compile (black ribbons). Inject shadowmask_pars_fragment AFTER
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

export const coilEffect: SpaceTypeEffect = {
  id: 'coil',
  label: 'Coil',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    coils = []

    const gradientTex = (textTexture.userData?.gradient as THREE.Texture | undefined) ?? null
    const uRepeat = Number(textTexture.userData?.uRepeat ?? n(params, 'textRepeat')) || 1

    const geo = buildCoilGeometryData({
      turns: n(params, 'turns'),
      startRadius: n(params, 'startRadius'),
      spacing: n(params, 'spacing'),
      bandSize: n(params, 'bandSize'),
      uRepeat,
    })

    const bufferGeo = new three.BufferGeometry()
    bufferGeo.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
    bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
    bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))
    bufferGeo.computeVertexNormals()

    // Independent scroll ⇒ clone the shared text texture.
    const tex = textTexture.clone()
    tex.needsUpdate = true
    tex.wrapS = three.RepeatWrapping

    // Gradient fill is sampled along the spiral via vRawU / uURepeat, so set
    // uURepeat = uRepeat (= textRepeat) → colors flow along the coil.
    const frontMat = frontMaterial(three, tex, gradientTex, params, uRepeat)
    const backMat = new three.MeshBasicMaterial({
      color: new three.Color(String(params.bSideColor)),
      side: three.BackSide,
    })

    // Front + back share ONE BufferGeometry (front face vs back face).
    const front = new three.Mesh(bufferGeo, frontMat)
    // Register the cloned texture so disposeRoot() frees it on rebuild.
    front.userData.tex = tex
    front.castShadow = true; front.receiveShadow = true
    const back = new three.Mesh(bufferGeo, backMat)
    back.castShadow = true

    // The whole coil lives in one sub-group so `spin` can rotate it about Z.
    const subGroup = new three.Group()
    subGroup.add(front)
    subGroup.add(back)
    root.add(subGroup)

    coils.push({ tex, uRepeat, dir: 1, group: subGroup })

    const strength = n(params, 'shadowStrength')
    // Front band uses MeshLambertMaterial with overridden output — full-bright flat
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
    const spin = n(params, 'spin')
    for (const c of coils) {
      // Text scrolls along the spiral; integer speed keeps it seamless.
      c.tex.offset.x = -scrollOffset(t01, speed, c.uRepeat) * c.dir
      // Static rotation of the whole coil about Z.
      c.group.rotation.z = spin
    }
  },
}
