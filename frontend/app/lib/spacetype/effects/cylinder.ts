import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { scrollOffset } from '../ribbonGeometry'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'SPACE TYPE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  { key: 'textRepeat', label: 'Text repeat', kind: 'slider', min: 1, max: 16, step: 1, default: 8, group: 'Type' },
  { key: 'radius', label: 'Radius', kind: 'slider', min: 2, max: 12, step: 0.1, default: 5, group: 'Ribbon' },
  { key: 'count', label: 'Count', kind: 'slider', min: 1, max: 10, step: 1, default: 1, group: 'Ribbon' },
  { key: 'cylHeight', label: 'Cylinder height', kind: 'slider', min: 0.5, max: 4, step: 0.05, default: 1.4, group: 'Ribbon' },
  { key: 'spacing', label: 'Spacing', kind: 'slider', min: 0.6, max: 4, step: 0.05, default: 2, group: 'Ribbon' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.3, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'spinY', label: 'Spin', kind: 'slider', min: -1.5, max: 1.5, step: 0.01, default: 0, group: 'Transform' },
  { key: 'gradientMode', label: 'Gradient', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Color' },
  { key: 'typeColor', label: 'Text', kind: 'color', default: '#101014', group: 'Color' },
  { key: 'aSideColor', label: 'A-side', kind: 'color', default: '#f5f5f7', group: 'Color' },
  { key: 'bSideColor', label: 'B-side / inside', kind: 'color', default: '#0a0a0c', group: 'Color' },
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

// v2 assumes a single active engine/surface instance: buildScene populates this
// module-level array and update() reads it. Two concurrent engines would clash —
// promote to instance state (e.g. root.userData.cylinders) if multi-surface is ever needed.
let cylinders: { tex: THREE.Texture; uRepeat: number; dir: 1 | -1; group: THREE.Group }[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

/**
 * Front material — copied from ribbon.ts's frontMaterial VERBATIM. The text glyph
 * map is composited ON TOP of an opaque fill — the gradient ramp (Gradient on) or a
 * flat A-side color. The text map sets diffuseColor (rgb=text color, a=glyph
 * coverage); after <map_fragment> we mix the fill under the glyph and force alpha
 * to 1 (opaque front face).
 *
 * The shadow injection (shadowmask_pars_fragment + getShadowMask multiply) was hard
 * to get right (black ribbons) — it is copied verbatim and must not be re-derived.
 *
 * Uses MeshLambertMaterial so the shadow pipeline (shadowmap_pars_fragment,
 * getShadowMask(), USE_SHADOWMAP) is RELIABLY present without re-injection. We
 * override <opaque_fragment> to ignore Lambert's diffuse dimming and output the
 * flat gradient/text albedo multiplied by the shadow mask — full-bright flat
 * surfaces that darken only where shadowed. For the cylinder, vRawU = uv.x around
 * the circumference, so the gradient pins to the circumference and the text scroll
 * does not drag it.
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
  // gradient/text albedo multiplied by the shadow mask → full-bright flat surfaces
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
    // Only add the vRawU varying so the gradient is pinned to the surface and does
    // not drift with the text scroll.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRawU;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawU = uv.x;')
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
    const cylHeight = n(params, 'cylHeight')
    const spacing = n(params, 'spacing')
    const textRepeat = Math.max(1, Math.round(n(params, 'textRepeat')))
    const center = (count - 1) / 2

    for (let i = 0; i < count; i++) {
      // Open-ended cylinder: text wraps around the circumference. 96 radial
      // segments keeps the ring smooth; v in [0,1] runs up the height.
      const geo = new three.CylinderGeometry(radius, radius, cylHeight, 96, 1, true)

      // Independent scroll per cylinder ⇒ clone the shared text texture. The text
      // tiles `textRepeat` times around the circumference (wrapS = RepeatWrapping).
      const tex = textTexture.clone()
      tex.needsUpdate = true
      tex.wrapS = three.RepeatWrapping
      tex.repeat.x = textRepeat

      const frontMat = frontMaterial(three, tex, gradientTex, params, textRepeat)
      const backMat = new three.MeshBasicMaterial({
        color: new three.Color(String(params.bSideColor)),
        side: three.BackSide,
      })

      // Front (outside, readable text + shadows) + back (inside, solid B-side)
      // share ONE CylinderGeometry (FrontSide vs BackSide).
      const front = new three.Mesh(geo, frontMat)
      // Register the cloned texture so disposeRoot() frees it on rebuild.
      front.userData.tex = tex
      front.castShadow = true; front.receiveShadow = true
      const back = new three.Mesh(geo, backMat)
      back.castShadow = true

      const subGroup = new three.Group()
      // Centered Y stack.
      subGroup.position.y = (i - center) * spacing
      subGroup.add(front)
      subGroup.add(back)
      root.add(subGroup)

      // Scroll seamlessness is quantized against the EFFECTIVE repeat around the
      // circumference (textRepeat), not the texture's base uRepeat.
      cylinders.push({ tex, uRepeat: textRepeat, dir: 1, group: subGroup })
    }

    const strength = n(params, 'shadowStrength')
    // Front surfaces use MeshLambertMaterial with overridden output — full-bright flat
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
    const spinY = n(params, 'spinY')
    for (const c of cylinders) {
      // Text flows AROUND the circumference; integer speed keeps it seamless.
      c.tex.offset.x = -scrollOffset(t01, speed, c.uRepeat) * c.dir
      // Static cylinder orientation around Y so the user can orient the ring.
      c.group.rotation.y = spinY
    }
  },
}
