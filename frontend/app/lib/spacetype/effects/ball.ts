import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills } from '../fills'

/**
 * Ball — the text atlas wrapped around a spinning globe (a sibling of Cylinder/Coil).
 *
 * The shared text texture (one tile, glyph coverage in its alpha channel) is tiled
 * `around × rows` over a SphereGeometry with RepeatWrapping. The sphere's UVs pinch
 * at the poles, which gives the natural "starburst" where the bands converge. The
 * material uses ONLY the texture's alpha (coverage) and composites a base colour →
 * text colour, so the globe is solid (FrontSide) and you see white glyphs on a black
 * sphere by default — exactly the reference look. Spins around a tilted axis, one
 * revolution per loop at speed 1 (seamless).
 */
const controls: ControlSpec[] = [
  // TYPE — shared text controls.
  { key: 'text', label: 'Text', kind: 'textList', default: 'MASD.LAB', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // SPHERE shape (grouped under the suite's geometry section, 'Ribbon').
  { key: 'radius', label: 'Radius', kind: 'slider', min: 2, max: 10, step: 0.1, default: 5, group: 'Ribbon' },
  { key: 'around', label: 'Around', kind: 'slider', min: 1, max: 20, step: 1, default: 4, group: 'Ribbon' },
  { key: 'rows', label: 'Rows', kind: 'slider', min: 2, max: 28, step: 1, default: 11, group: 'Ribbon' },
  { key: 'axisTilt', label: 'Axis tilt', kind: 'slider', min: -1, max: 1, step: 0.01, default: 0.18, group: 'Ribbon' },
  // MOTION.
  { key: 'spinSpeed', label: 'Spin speed', kind: 'slider', min: -4, max: 4, step: 0.25, default: 1, group: 'Motion' },
  // TRANSFORM — camera view (applied by the engine to the whole scene).
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.3, group: 'Transform' },
  { key: 'rotateX', label: 'Camera rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.12, group: 'Transform' },
  { key: 'rotateY', label: 'Camera rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Camera rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  // COLOR — first fill drives base (sphere) colour + text colour. Black base + white text = reference.
  { key: 'fills', label: 'Fills', kind: 'fillList', default: '[{"type":"solid","a":"#000000","b":"#000000","textColor":"#ffffff"}]', group: 'Color' },
  // SHADING — flat = crisp uniform text (reference); lit = subtle directional shading for roundness.
  { key: 'shading', label: 'Shading', kind: 'select', options: ['flat', 'lit'], default: 'flat', group: 'Shadow' },
  { key: 'shadeStrength', label: 'Shade depth', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
]

interface BallState { mesh: THREE.Mesh; spinGroup: THREE.Group }
// Single active engine/surface instance (see the other effects): buildScene populates
// this module-level handle and update() reads it.
let state: BallState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

/**
 * Globe material: use ONLY the text texture's alpha (glyph coverage) and composite
 * uBaseColor → uTextColor, so the sphere is a solid colour with text painted on it
 * (NOT the texture's own RGB). flat = MeshBasic (uniform), lit = MeshLambert (shaded
 * by the scene light for dimensional roundness).
 */
function ballMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  baseColor: THREE.Color,
  textColor: THREE.Color,
  lit: boolean,
): THREE.Material {
  const MatClass = lit ? three.MeshLambertMaterial : three.MeshBasicMaterial
  const mat = new MatClass({ map, side: three.FrontSide })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBaseColor = { value: baseColor }
    shader.uniforms.uTextColor = { value: textColor }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBaseColor;\nuniform vec3 uTextColor;')
      // map_fragment leaves glyph coverage in diffuseColor.a → mix the two solid colours by it.
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor = vec4(mix(uBaseColor, uTextColor, diffuseColor.a), 1.0);')
  }
  return mat
}

export const ballEffect: SpaceTypeEffect = {
  id: 'ball',
  label: 'Ball',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const fills = parseFills(params.fills)
    const f0 = fills[0]!
    const radius = Math.max(0.5, n(params, 'radius'))
    const around = Math.max(1, Math.round(n(params, 'around')))
    const rows = Math.max(1, Math.round(n(params, 'rows')))
    const lit = String(params.shading) === 'lit'

    // Clone the shared atlas so our wrap/repeat doesn't mutate the engine's texture.
    const tex = textTexture.clone()
    tex.needsUpdate = true
    tex.wrapS = three.RepeatWrapping
    tex.wrapT = three.RepeatWrapping
    tex.repeat.set(around, rows)

    const geo = new three.SphereGeometry(radius, 128, 96)
    const mat = ballMaterial(three, tex, new three.Color(f0.a), new three.Color(f0.textColor), lit)
    const mesh = new three.Mesh(geo, mat)
    mesh.userData.tex = tex   // so disposeRoot() frees the cloned texture on rebuild

    // Pole axis tilts within spinGroup; the mesh spins around its (now-tilted) local Y.
    const spinGroup = new three.Group()
    spinGroup.add(mesh)
    root.add(spinGroup)

    if (lit) {
      const key = new three.DirectionalLight(0xffffff, 1.0)
      key.position.set(6, 8, 14)
      root.add(key)
      root.add(new three.AmbientLight(0xffffff, Math.max(0.15, 1 - n(params, 'shadeStrength') * 0.7)))
    }

    state = { mesh, spinGroup }
    ballEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    s.spinGroup.rotation.z = n(params, 'axisTilt')
    // One full revolution per loop at speed 1 → always seamless (integer speed stays seamless).
    s.mesh.rotation.y = t01 * Math.PI * 2 * n(params, 'spinSpeed')
  },
}
