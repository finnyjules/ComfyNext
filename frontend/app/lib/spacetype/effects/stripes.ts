import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { buildRibbonGeometryData, ribbonInstance, scrollOffset, textVariantForBand } from '../ribbonGeometry'
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
  { key: 'stripeCount', label: 'Stripe count', kind: 'slider', min: 3, max: 40, step: 1, default: 9, group: 'Ribbon' },
  { key: 'stripeHeight', label: 'Stripe height', kind: 'slider', min: 0.4, max: 3, step: 0.05, default: 1.0, group: 'Ribbon' },
  { key: 'stripeSpacing', label: 'Y spacing', kind: 'slider', min: 0.2, max: 2.5, step: 0.05, default: 1.05, group: 'Ribbon' },
  { key: 'stripeSpaceX', label: 'X spacing', kind: 'slider', min: -2, max: 2, step: 0.02, default: 0, group: 'Ribbon' },
  { key: 'stripeStretch', label: 'Stripe stretch', kind: 'slider', min: 8, max: 36, step: 0.5, default: 18, group: 'Ribbon' },
  { key: 'waveAmplitude', label: 'Wave amount', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1.4, group: 'Wave' },
  { key: 'waveFrequency', label: 'Wave freq', kind: 'slider', min: 0.5, max: 5, step: 0.1, default: 1.2, group: 'Wave' },
  { key: 'waveSlope', label: 'Wave slope', kind: 'slider', min: 0.2, max: 4, step: 0.1, default: 1, group: 'Wave' },
  { key: 'rowPhase', label: 'Row phase', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.12, group: 'Wave' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.5, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.4, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateX', label: 'Stripe rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateY', label: 'Stripe rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'ribbonRotateZ', label: 'Stripe rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // Per-band fills (solid/gradient/grid/noise) cycled across stripes + per-band text colour.
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(6, 'stripes'), group: 'Color' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#101014', group: 'Color' },
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

// Per-scene state lives on the built root's userData (see update()), NOT a module var: the
// card preview and the headless frame source run two concurrent engines over this singleton
// effect, and the engine caches multiple roots per instance — a shared array would freeze
// every surface that didn't build last. buildScene stashes `stripes` on root.userData.stripeRows.
interface StripeRow { tex: THREE.Texture; uRepeat: number; dir: 1 | -1; group: THREE.Group; uFillScroll: { value: number } }

function n(p: Params, k: string): number { return Number(p[k]) }

/**
 * Front material — copied from ribbon.ts's frontMaterial and adapted for stripes:
 * the gradient ramp is forced OFF and `uAside` is set PER BAND to a solid palette
 * color, so each stripe is a flat solid color with the text glyphs composited on
 * top. The shadow injection (shadowmask_pars_fragment + getShadowMask multiply)
 * is IDENTICAL to ribbon's — this is the part that was hard to get right (black
 * ribbons), so it is copied verbatim and must not be re-derived.
 *
 * Uses MeshLambertMaterial so the shadow pipeline (shadowmap_pars_fragment,
 * getShadowMask(), USE_SHADOWMAP) is RELIABLY present; <opaque_fragment> is
 * overridden to output the flat solid/text albedo multiplied by the shadow mask.
 */
function stripeFrontMaterial(
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
  // Each band is painted by its fill (a 2D texture: solid 1×1, gradient ramp, grid or noise),
  // sampled at the band's raw uv but with the SAME scroll offset as the text (uFillScroll,
  // updated per frame) so grid/noise drift along with the glyphs. The glyph coverage (map
  // alpha) composites the per-band text colour on top.
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
    // Raw uv → the fill is pinned across the band height; the x scroll is added in the fragment.
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

export const stripesEffect: SpaceTypeEffect = {
  id: 'stripes',
  label: 'Stripes',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const stripes: StripeRow[] = []

    const uRepeat = Number(textTexture.userData?.uRepeat ?? n(params, 'textRepeat')) || 1
    const count = Math.max(1, Math.floor(n(params, 'stripeCount')))
    const xSpacing = n(params, 'stripeSpaceX')
    // Multiple texts → N-row atlas; stripe i shows row i%N via the texture's V transform.
    const numTexts = Math.max(1, Math.floor(Number(textTexture.userData?.numTexts ?? 1)))

    // Cycling per-band fills (solid/gradient/grid/noise) + per-band text colour.
    const fills = parseFills(params.fills)

    for (let i = 0; i < count; i++) {
      const inst = ribbonInstance(i, {
        count,
        spacing: n(params, 'stripeSpacing'),
        offset: n(params, 'rowPhase'),
        alternate: false,
      })

      const geo = buildRibbonGeometryData({
        segments: 120,
        length: n(params, 'stripeStretch'),
        amplitude: n(params, 'waveAmplitude') * 1,
        frequency: n(params, 'waveFrequency'),
        height: n(params, 'stripeHeight'),
        uRepeat,
        phase: inst.phase,
        slope: n(params, 'waveSlope'),
      })

      const bufferGeo = new three.BufferGeometry()
      bufferGeo.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
      bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
      bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))
      bufferGeo.computeVertexNormals()

      // Independent scroll per stripe ⇒ clone the shared text texture.
      const tex = textTexture.clone()
      tex.needsUpdate = true
      tex.wrapS = three.RepeatWrapping
      // Alternate texts across stripes — first string on the TOP stripe (shared convention).
      if (numTexts > 1) {
        tex.repeat.y = 1 / numTexts
        tex.offset.y = textVariantForBand(i, count, numTexts) / numTexts
      }

      const fill = fills[i % fills.length]!
      const fillTex = fillShaderTexture(three, fill)
      const uFillScroll = { value: 0 }
      const frontMat = stripeFrontMaterial(three, tex, fillTex, fillTiling(fill), fillAnchor(fill), fillTextColor(three, fill), uFillScroll, params)
      const backMat = new three.MeshBasicMaterial({
        color: new three.Color(stripAlpha(String(params.bSideColor))),
        side: three.BackSide,
      })

      // Front + back share ONE BufferGeometry (front face vs back face).
      const front = new three.Mesh(bufferGeo, frontMat)
      // Register the cloned texture so disposeRoot() frees it on rebuild.
      front.userData.tex = tex
      front.castShadow = true; front.receiveShadow = true
      const back = new three.Mesh(bufferGeo, backMat)
      back.castShadow = true; back.receiveShadow = true

      const subGroup = new three.Group()
      subGroup.position.y = inst.y
      subGroup.position.x = i * xSpacing
      subGroup.add(front)
      subGroup.add(back)
      root.add(subGroup)

      stripes.push({ tex, uRepeat, dir: inst.dir, group: subGroup, uFillScroll })
    }

    const strength = n(params, 'shadowStrength')
    // Front bands use MeshLambertMaterial with overridden output — full-bright flat
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

    root.userData.stripeRows = stripes
    return root
  },

  update(t01, params, root) {
    const stripes = (root?.userData?.stripeRows as StripeRow[] | undefined) ?? []
    const speed = n(params, 'speed')
    for (const s of stripes) {
      // Text scrolls along the band; integer speed keeps it seamless.
      s.tex.offset.x = -scrollOffset(t01, speed, s.uRepeat) * s.dir
      // Grid/noise fill drifts with the text (same offset → same direction & pace).
      s.uFillScroll.value = s.tex.offset.x
      // Per-stripe in-place rotation (each band around its own sub-group origin).
      s.group.rotation.set(n(params, 'ribbonRotateX'), n(params, 'ribbonRotateY'), n(params, 'ribbonRotateZ'))
    }
  },
}
