import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { buildRibbonGeometryData, ribbonInstance, scrollU } from '../ribbonGeometry'
import { buildRibbonLabel } from '../ribbonMath'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'SPACE TYPE' },
  { key: 'font', label: 'Font', kind: 'font', default: 'inter' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180 },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0 },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0 },
  { key: 'textRepeat', label: 'Text repeat', kind: 'slider', min: 1, max: 16, step: 1, default: 4 },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 0.4, max: 3, step: 0.05, default: 1.1 },
  { key: 'ribbonStretch', label: 'Ribbon stretch', kind: 'slider', min: 8, max: 36, step: 0.5, default: 18 },
  { key: 'ribbonCount', label: 'Ribbon count', kind: 'slider', min: 1, max: 12, step: 1, default: 1 },
  { key: 'ribbonSpacing', label: 'Ribbon spacing', kind: 'slider', min: 0.6, max: 4, step: 0.05, default: 2 },
  { key: 'ribbonOffset', label: 'Ribbon offset', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.2 },
  { key: 'alternate', label: 'Alternate', kind: 'select', options: ['on', 'off'], default: 'on' },
  { key: 'segmentCount', label: 'Segment count', kind: 'slider', min: 16, max: 240, step: 2, default: 120 },
  { key: 'snakeAmplitude', label: 'Snake amount', kind: 'slider', min: 0, max: 6, step: 0.05, default: 2.4 },
  { key: 'snakeFrequency', label: 'Snake freq', kind: 'slider', min: 0.5, max: 5, step: 0.1, default: 1.5 },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6 },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2 },
  { key: 'rotateX', label: 'Rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.5 },
  { key: 'rotateY', label: 'Rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0 },
  { key: 'rotateZ', label: 'Rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0 },
  { key: 'gradientMode', label: 'Gradient', kind: 'select', options: ['on', 'off'], default: 'on' },
  { key: 'typeColor', label: 'Text', kind: 'color', default: '#101014' },
  { key: 'aSideColor', label: 'A-side', kind: 'color', default: '#f5f5f7' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#101014' },
]

// v2 assumes a single active engine/surface instance: buildScene populates this
// module-level array and update() reads it. Two concurrent engines would clash —
// promote to instance state (e.g. root.userData.ribbons) if multi-surface is ever needed.
let ribbons: { tex: THREE.Texture; uRepeat: number; dir: 1 | -1 }[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

/**
 * Front material: text glyph map composited ON TOP of an opaque fill — the
 * gradient ramp (Gradient on) or a flat A-side color. The text map sets
 * diffuseColor (rgb=text color, a=glyph coverage); after <map_fragment> we
 * mix the fill under the glyph and force alpha to 1 (opaque front face).
 */
function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  gradientTex: THREE.Texture | null,
  params: Params,
  uRepeat: number,
): THREE.MeshBasicMaterial {
  const mat = new three.MeshBasicMaterial({ map, side: three.FrontSide })
  const uUseGradient = { value: String(params.gradientMode) === 'on' && gradientTex ? 1 : 0 }
  const uAside = { value: new three.Color(String(params.aSideColor)) }
  const uGradient = { value: gradientTex ?? null }
  const uURepeat = { value: uRepeat }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uUseGradient = uUseGradient
    shader.uniforms.uAside = uAside
    shader.uniforms.uGradient = uGradient
    shader.uniforms.uURepeat = uURepeat
    // Fix 2: pass the raw (un-scrolled) geometry UV through a new varying so the
    // gradient is pinned to the ribbon and does not drift with the text scroll.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRawU;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawU = uv.x;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vRawU;\nuniform float uUseGradient;\nuniform vec3 uAside;\nuniform sampler2D uGradient;\nuniform float uURepeat;',
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n{\n  vec3 fill = uAside;\n  if (uUseGradient > 0.5) { fill = texture2D(uGradient, vec2(vRawU / uURepeat, 0.5)).rgb; }\n  diffuseColor = vec4(mix(fill, diffuseColor.rgb, diffuseColor.a), 1.0);\n}',
      )
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
      const back = new three.Mesh(bufferGeo, backMat)

      const subGroup = new three.Group()
      subGroup.position.y = inst.y
      subGroup.add(front)
      subGroup.add(back)
      root.add(subGroup)

      ribbons.push({ tex, uRepeat, dir: inst.dir })
    }

    return root
  },

  update(t01, params) {
    const speed = n(params, 'speed')
    for (const r of ribbons) {
      // Text scrolls along the ribbon; integer speed keeps it seamless.
      r.tex.offset.x = -scrollU(t01, speed) * r.uRepeat * r.dir
    }
  },
}

/** Re-exported so the surface can compose the label the same way the texture does. */
export { buildRibbonLabel }
