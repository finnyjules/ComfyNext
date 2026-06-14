import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { buildRibbonGeometryData, ribbonInstance, scrollOffset } from '../ribbonGeometry'
import { buildRibbonLabel } from '../ribbonMath'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'SPACE TYPE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  { key: 'textRepeat', label: 'Text repeat', kind: 'slider', min: 1, max: 16, step: 1, default: 4, group: 'Type' },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 0.4, max: 3, step: 0.05, default: 1.1, group: 'Ribbon' },
  { key: 'ribbonStretch', label: 'Ribbon stretch', kind: 'slider', min: 8, max: 36, step: 0.5, default: 18, group: 'Ribbon' },
  { key: 'ribbonCount', label: 'Ribbon count', kind: 'slider', min: 1, max: 12, step: 1, default: 1, group: 'Ribbon' },
  { key: 'ribbonSpacing', label: 'Ribbon spacing', kind: 'slider', min: 0.6, max: 4, step: 0.05, default: 2, group: 'Ribbon' },
  { key: 'ribbonOffset', label: 'Ribbon offset', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.2, group: 'Ribbon' },
  { key: 'alternate', label: 'Alternate', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Ribbon' },
  { key: 'segmentCount', label: 'Segment count', kind: 'slider', min: 16, max: 240, step: 2, default: 120, group: 'Snake' },
  { key: 'snakeAmplitude', label: 'Snake amount', kind: 'slider', min: 0, max: 6, step: 0.05, default: 2.4, group: 'Snake' },
  { key: 'snakeFrequency', label: 'Snake freq', kind: 'slider', min: 0.5, max: 5, step: 0.1, default: 1.5, group: 'Snake' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.5, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateX', label: 'Ribbon rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateY', label: 'Ribbon rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateZ', label: 'Ribbon rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'gradientMode', label: 'Gradient', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Color' },
  { key: 'typeColor', label: 'Text', kind: 'color', default: '#101014', group: 'Color' },
  { key: 'aSideColor', label: 'A-side', kind: 'color', default: '#f5f5f7', group: 'Color' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#101014', group: 'Color' },
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.4, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

// v2 assumes a single active engine/surface instance: buildScene populates this
// module-level array and update() reads it. Two concurrent engines would clash —
// promote to instance state (e.g. root.userData.ribbons) if multi-surface is ever needed.
let ribbons: { tex: THREE.Texture; uRepeat: number; dir: 1 | -1; group: THREE.Group }[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

/**
 * Front material: text glyph map composited ON TOP of an opaque fill — the
 * gradient ramp (Gradient on) or a flat A-side color. The text map sets
 * diffuseColor (rgb=text color, a=glyph coverage); after <map_fragment> we
 * mix the fill under the glyph and force alpha to 1 (opaque front face).
 *
 * Uses MeshLambertMaterial so the shadow pipeline (shadowmap_pars_fragment,
 * getShadowMask(), USE_SHADOWMAP) is RELIABLY present without re-injection.
 * We override <opaque_fragment> to ignore Lambert's diffuse dimming and output
 * the flat gradient/text albedo multiplied by the shadow mask — full-bright
 * flat ribbons that darken only where shadowed.
 */
function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  gradientTex: THREE.Texture | null,
  params: Params,
  uRepeat: number,
): THREE.MeshLambertMaterial {
  // Lambert is a lit material, so getShadowMask()/USE_SHADOWMAP are reliably available.
  // We override the output to ignore Lambert's diffuse shading and show the flat
  // gradient/text albedo multiplied by the shadow mask → full-bright flat ribbons
  // that darken only where shadowed.
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
    // Only add the vRawU varying so the gradient is pinned to the ribbon and does
    // not drift with the text scroll.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRawU;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawU = uv.x;')
    // Lambert already includes packing/lights_pars_begin/shadowmap_pars_fragment —
    // do NOT re-inject them. Only add our composite uniforms + varying.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uUseGradient;\nuniform vec3 uAside;\nuniform sampler2D uGradient;\nuniform float uURepeat;\nuniform float uShadowStrength;\nvarying float vRawU;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec3 fill = uAside; if (uUseGradient > 0.5) { fill = texture2D(uGradient, vec2(vRawU / uURepeat, 0.5)).rgb; } diffuseColor = vec4(mix(fill, diffuseColor.rgb, diffuseColor.a), 1.0); }')
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( diffuseColor.rgb * mix(1.0 - uShadowStrength, 1.0, getShadowMask()), 1.0 );')
  }
  return mat
}

export const ribbonEffect: SpaceTypeEffect = {
  id: 'ribbon',
  label: 'Ribbon',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    ribbons = []

    const gradientTex = (textTexture.userData?.gradient as THREE.Texture | undefined) ?? null
    const uRepeat = Number(textTexture.userData?.uRepeat ?? n(params, 'textRepeat')) || 1
    const count = Math.max(1, Math.floor(n(params, 'ribbonCount')))

    for (let i = 0; i < count; i++) {
      const inst = ribbonInstance(i, {
        count,
        spacing: n(params, 'ribbonSpacing'),
        offset: n(params, 'ribbonOffset'),
        alternate: String(params.alternate) === 'on',
      })

      const geo = buildRibbonGeometryData({
        segments: n(params, 'segmentCount'),
        length: n(params, 'ribbonStretch'),
        amplitude: n(params, 'snakeAmplitude') * inst.dir,
        frequency: n(params, 'snakeFrequency'),
        height: n(params, 'ribbonHeight'),
        uRepeat,
        phase: inst.phase,
      })

      const bufferGeo = new three.BufferGeometry()
      bufferGeo.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
      bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
      bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))
      bufferGeo.computeVertexNormals()

      // Independent scroll per ribbon ⇒ clone the shared text texture.
      const tex = textTexture.clone()
      tex.needsUpdate = true
      tex.wrapS = three.RepeatWrapping

      const frontMat = frontMaterial(three, tex, gradientTex, params, uRepeat)
      const backMat = new three.MeshBasicMaterial({
        color: new three.Color(String(params.bSideColor)),
        side: three.BackSide,
      })

      // Front + back share ONE BufferGeometry (front face vs back face).
      const front = new three.Mesh(bufferGeo, frontMat)
      // Fix 1: register the cloned texture so disposeRoot() frees it on rebuild.
      front.userData.tex = tex
      front.castShadow = true; front.receiveShadow = true
      const back = new three.Mesh(bufferGeo, backMat)
      back.castShadow = true; back.receiveShadow = true

      const subGroup = new three.Group()
      subGroup.position.y = inst.y
      subGroup.add(front)
      subGroup.add(back)
      root.add(subGroup)

      ribbons.push({ tex, uRepeat, dir: inst.dir, group: subGroup })
    }

    const strength = n(params, 'shadowStrength')
    // Front ribbons use MeshLambertMaterial with overridden output — full-bright flat
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
      light.shadow.mapSize.set(2048, 2048)
      const cam = light.shadow.camera as THREE.OrthographicCamera
      cam.left = -40; cam.right = 40; cam.top = 40; cam.bottom = -40; cam.near = 0.1; cam.far = 120
      cam.updateProjectionMatrix()
      light.shadow.bias = -0.0005
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
    for (const r of ribbons) {
      // Text scrolls along the ribbon; integer speed keeps it seamless.
      r.tex.offset.x = -scrollOffset(t01, speed, r.uRepeat) * r.dir
      // Per-ribbon in-place rotation (each ribbon around its own sub-group origin).
      r.group.rotation.set(n(params, 'ribbonRotateX'), n(params, 'ribbonRotateY'), n(params, 'ribbonRotateZ'))
    }
  },
}

/** Re-exported so the surface can compose the label the same way the texture does. */
export { buildRibbonLabel }
