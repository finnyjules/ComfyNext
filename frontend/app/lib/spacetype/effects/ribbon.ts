import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { buildRibbonGeometryData, ribbonInstance, scrollOffset, textVariantForBand } from '../ribbonGeometry'
import { buildRibbonLabel } from '../ribbonMath'
import { parseFills, fillShaderTexture, fillTiling, fillTextColor, fillAnchor, fillScreenVec } from '../fills'
import { defaultFillsFor } from '../palette'
import { stripAlpha } from '~/lib/color/convert'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'Sailor', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
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
  { key: 'segmentCount', label: 'Segment count', kind: 'slider', min: 16, max: 240, step: 2, default: 120, group: 'Wave' },
  { key: 'snakeAmplitude', label: 'Snake amount', kind: 'slider', min: 0, max: 6, step: 0.05, default: 2.4, group: 'Wave' },
  { key: 'snakeFrequency', label: 'Snake freq', kind: 'slider', min: 0.5, max: 5, step: 0.1, default: 1.5, group: 'Wave' },
  // Second wave on the depth axis (toward/away from camera). 0 = flat (off); raise for a 3D snake.
  { key: 'snakeAmplitudeZ', label: 'Depth wave amount', kind: 'slider', min: 0, max: 6, step: 0.05, default: 0, group: 'Wave' },
  { key: 'snakeFrequencyZ', label: 'Depth wave freq', kind: 'slider', min: 0.5, max: 5, step: 0.1, default: 1.5, group: 'Wave' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.5, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateX', label: 'Ribbon rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateY', label: 'Ribbon rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateZ', label: 'Ribbon rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // Per-ribbon fills (solid/gradient/grid/noise) cycled across ribbons + per-fill text colour.
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(1, 'ribbon'), group: 'Color' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#101014', group: 'Color' },
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

// v2 assumes a single active engine/surface instance: buildScene populates this
// module-level array and update() reads it. Two concurrent engines would clash —
// promote to instance state (e.g. root.userData.ribbons) if multi-surface is ever needed.
let ribbons: { tex: THREE.Texture; uRepeat: number; dir: 1 | -1; group: THREE.Group; uFillScroll: { value: number } }[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

/**
 * Front material: the ribbon is painted by its FILL (a 2D texture: solid 1×1, gradient ramp,
 * grid or noise), with the text glyphs composited ON TOP in the fill's text colour. The fill is
 * sampled at the ribbon's raw uv plus the SAME scroll offset as the text (uFillScroll) so
 * grid/noise drift along with the glyphs.
 *
 * Uses MeshLambertMaterial so the shadow pipeline (shadowmap_pars_fragment, getShadowMask(),
 * USE_SHADOWMAP) is RELIABLY present without re-injection. We override <opaque_fragment> to
 * ignore Lambert's diffuse dimming and output the flat albedo × the shadow mask.
 */
function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  fillTex: THREE.Texture,
  tiling: number,
  anchor: number,
  textColor: THREE.Color,
  uFillScroll: { value: number },
  params: Params,
): THREE.MeshLambertMaterial {
  const mat = new three.MeshLambertMaterial({ map, side: three.FrontSide })
  const uFillTex = { value: fillTex }
  const uFillTiling = { value: tiling }
  const uFillAnchor = { value: anchor }
  const uFillScreen = { value: fillScreenVec(three) }
  const uTextColor = { value: textColor }
  const uShadowStrength = { value: String(params.shadows) === 'on' ? n(params, 'shadowStrength') : 0 }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFillTex = uFillTex
    shader.uniforms.uFillTiling = uFillTiling
    shader.uniforms.uFillAnchor = uFillAnchor
    shader.uniforms.uFillScreen = uFillScreen
    shader.uniforms.uTextColor = uTextColor
    shader.uniforms.uFillScroll = uFillScroll
    shader.uniforms.uShadowStrength = uShadowStrength
    // Raw uv → fill pinned across the ribbon; the x scroll is added in the fragment.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRawUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawUv = uv;')
    // Inject shadowmask_pars_fragment after shadowmap_pars_fragment (getShadowMask deps ready).
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFillTex;\nuniform float uFillTiling;\nuniform float uFillAnchor;\nuniform vec2 uFillScreen;\nuniform vec3 uTextColor;\nuniform float uFillScroll;\nuniform float uShadowStrength;\nvarying vec2 vRawUv;')
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
      // uFillTex is tagged SRGBColorSpace → the GPU returns linear, so NO manual decode here.
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec2 fuv = uFillAnchor > 0.5 ? gl_FragCoord.xy / uFillScreen : vRawUv * uFillTiling + vec2(uFillScroll, 0.0); vec3 fill = texture2D(uFillTex, fuv).rgb; diffuseColor = vec4(mix(fill, uTextColor, diffuseColor.a), 1.0); }')
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( diffuseColor.rgb * mix(1.0 - uShadowStrength, 1.0, getShadowMask()), 1.0 );')
  }
  return mat
}

export const ribbonEffect: SpaceTypeEffect = {
  id: 'ribbon',
  label: 'Ribbon',
  controls,
  liveKeys: ['ribbonRotateX', 'ribbonRotateY', 'ribbonRotateZ'],

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    ribbons = []

    const uRepeat = Number(textTexture.userData?.uRepeat ?? n(params, 'textRepeat')) || 1
    const count = Math.max(1, Math.floor(n(params, 'ribbonCount')))
    const fills = parseFills(params.fills)
    // Multiple texts → N-row atlas; ribbon i shows row i%N via the texture's V transform.
    const numTexts = Math.max(1, Math.floor(Number(textTexture.userData?.numTexts ?? 1)))

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
        zAmplitude: n(params, 'snakeAmplitudeZ') * inst.dir,
        zFrequency: n(params, 'snakeFrequencyZ'),
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
      // Alternate texts across ribbons — first string on the TOP ribbon (shared convention).
      if (numTexts > 1) {
        tex.repeat.y = 1 / numTexts
        tex.offset.y = textVariantForBand(i, count, numTexts) / numTexts
      }

      const fill = fills[i % fills.length]!
      const uFillScroll = { value: 0 }
      const frontMat = frontMaterial(three, tex, fillShaderTexture(three, fill), fillTiling(fill), fillAnchor(fill), fillTextColor(three, fill), uFillScroll, params)
      const backMat = new three.MeshBasicMaterial({
        color: new three.Color(stripAlpha(String(params.bSideColor))),
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

      ribbons.push({ tex, uRepeat, dir: inst.dir, group: subGroup, uFillScroll })
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
    for (const r of ribbons) {
      // Text scrolls along the ribbon; integer speed keeps it seamless.
      r.tex.offset.x = -scrollOffset(t01, speed, r.uRepeat) * r.dir
      // Grid/noise fill drifts with the text (same offset → same direction & pace).
      r.uFillScroll.value = r.tex.offset.x
      // Per-ribbon in-place rotation (each ribbon around its own sub-group origin).
      r.group.rotation.set(n(params, 'ribbonRotateX'), n(params, 'ribbonRotateY'), n(params, 'ribbonRotateZ'))
    }
  },
}

/** Re-exported so the surface can compose the label the same way the texture does. */
export { buildRibbonLabel }
