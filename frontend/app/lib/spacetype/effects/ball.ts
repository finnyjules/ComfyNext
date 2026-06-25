import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills, fillShaderTexture, fillTiling } from '../fills'

/**
 * Ball — the text atlas wrapped around a spinning globe (a sibling of Cylinder/Coil).
 *
 * The sphere is split into `segments` LONGITUDE wedges (vertical beach-ball panels), each
 * painted by one fill from the list (cycled), so a multi-fill list reads as a beach ball.
 * Every fill type is supported (solid / gradient / ombre / grid / noise / …) via the shared
 * fill-texture rails. The text atlas (glyph coverage in its alpha) is tiled `around × rows`
 * over the wedges and composited on top in each fill's text colour. Solid globe (FrontSide).
 * Spins around a tilted axis, one revolution per loop at speed 1 (seamless).
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
  // fixed = the Panels slider sets the count; per-word = one panel per text repeat (Around),
  // each word centred on its own panel so the panels track the text as you resize.
  { key: 'panelMode', label: 'Panel sizing', kind: 'select', options: ['fixed', 'per-word'], default: 'fixed', group: 'Ribbon' },
  { key: 'segments', label: 'Panels', kind: 'slider', min: 1, max: 16, step: 1, default: 6, group: 'Ribbon' },
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
  // COLOR — one fill PER PANEL (cycled). Each fill: panel colour/pattern (a/b/type) + text colour.
  // Default = a 6-colour beach ball; add/remove fills or change types (gradient/ombre/…) freely.
  { key: 'fills', label: 'Panels', kind: 'fillList', default: '[{"type":"solid","a":"#e23b3b","b":"#000000","textColor":"#ffffff"},{"type":"solid","a":"#f5c542","b":"#000000","textColor":"#1a1a1a"},{"type":"solid","a":"#3b78e2","b":"#000000","textColor":"#ffffff"},{"type":"solid","a":"#36b37e","b":"#000000","textColor":"#ffffff"},{"type":"solid","a":"#ffffff","b":"#000000","textColor":"#1a1a1a"},{"type":"solid","a":"#e2843b","b":"#000000","textColor":"#ffffff"}]', group: 'Color' },
  // SHADING — flat = uniform panels; lit = directional shading for a round, ball-like read.
  { key: 'shading', label: 'Shading', kind: 'select', options: ['flat', 'lit'], default: 'lit', group: 'Shadow' },
  { key: 'shadeStrength', label: 'Shade depth', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
]

interface BallState { spinGroup: THREE.Group; tiltGroup: THREE.Group }
// Single active engine/surface instance (see the other effects).
let state: BallState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }

/**
 * Per-panel material: paint the panel with its fill (any type → a tiling texture, sampled at the
 * panel's raw UV) and composite the text on top in the fill's text colour. Uses ONLY the text
 * atlas's alpha for coverage (its RGB is ignored). flat = MeshBasic, lit = MeshLambert (shaded by
 * the scene light for roundness). Mirrors stripes.ts's fill-compositing.
 */
function panelMaterial(
  three: typeof THREE,
  textMap: THREE.Texture,
  fillTex: THREE.Texture,
  fillScale: THREE.Vector2,
  textColor: THREE.Color,
  lit: boolean,
): THREE.Material {
  const MatClass = lit ? three.MeshLambertMaterial : three.MeshBasicMaterial
  const mat = new MatClass({ map: textMap, side: three.FrontSide })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFillTex = { value: fillTex }
    shader.uniforms.uFillScale = { value: fillScale }
    shader.uniforms.uTextColor = { value: textColor }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRawUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFillTex;\nuniform vec2 uFillScale;\nuniform vec3 uTextColor;\nvarying vec2 vRawUv;')
      // uFillTex is SRGB-tagged → texture2D returns linear (no manual decode), same as stripes.
      // uFillScale carries the wedge aspect (V scaled by height:width) so patterns read square
      // instead of vertically stretched. map_fragment leaves glyph coverage in diffuseColor.a.
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ vec3 panel = texture2D(uFillTex, vRawUv * uFillScale).rgb; diffuseColor = vec4(mix(panel, uTextColor, diffuseColor.a), 1.0); }')
  }
  return mat
}

export const ballEffect: SpaceTypeEffect = {
  id: 'ball',
  label: 'Ball',
  controls,
  liveKeys: ['axisTilt', 'spinSpeed'],

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const fills = parseFills(params.fills)
    const radius = Math.max(0.5, n(params, 'radius'))
    const around = Math.max(0.001, n(params, 'around'))
    const rows = Math.max(1, Math.round(n(params, 'rows')))
    const lit = String(params.shading) === 'lit'
    // per-word: one panel per text repeat (panel count = Around), each word centred on its
    // panel. fixed: the Panels slider sets the count and the text tiles continuously across.
    const perWord = String(params.panelMode) === 'per-word'
    const segments = perWord ? Math.max(1, Math.round(around)) : Math.max(1, Math.round(n(params, 'segments')))
    // Word INK fraction of its (word + trailing gap) tile, to centre it in per-word mode.
    const wordFrac = Number((textTexture.userData?.wordInkFracs as number[] | undefined)?.[0] ?? 1) || 1

    // axisTilt tilts the pole; spinGroup spins the panels around the (tilted) Y axis.
    const tiltGroup = new three.Group()
    const spinGroup = new three.Group()
    tiltGroup.add(spinGroup)
    root.add(tiltGroup)

    const TWO_PI = Math.PI * 2
    // Width segments per panel — keep the wedge smooth without exploding the vert count.
    const wSeg = Math.max(6, Math.round(128 / segments))
    // Each wedge spans 2π/segments of longitude but the full π of latitude, so it's
    // (segments/2)× taller than wide at the equator. Scale the fill's V sampling by that
    // ratio so patterns (grid/checkerboard/stripes/noise/ombre grain) read SQUARE, not
    // vertically stretched. Gradients are excepted (they should fade once pole-to-pole).
    const aspect = Math.max(0.25, segments / 2)

    for (let i = 0; i < segments; i++) {
      const fill = fills[i % fills.length]!
      // One LONGITUDE wedge (a vertical beach-ball panel).
      const geo = new three.SphereGeometry(radius, wSeg, 96, (i / segments) * TWO_PI, (1 / segments) * TWO_PI)

      const tex = textTexture.clone()
      tex.needsUpdate = true
      tex.wrapS = three.RepeatWrapping
      tex.wrapT = three.RepeatWrapping
      if (perWord) {
        // One full text repeat per panel, centred (symmetric gaps from the trailing space).
        tex.repeat.set(1, rows)
        tex.offset.x = i - (0.5 - wordFrac / 2)
      } else {
        // The panel's slice of the global text tiling: local u 0→1 maps to global
        // u ∈ [i/segments,(i+1)/segments], so the text stays continuous across panels.
        tex.repeat.set(around / segments, rows)
        tex.offset.x = (i * around) / segments
      }

      const fillTex = fillShaderTexture(three, fill)
      const tiling = fillTiling(fill)
      // Gradient = a single smooth fade across the panel → don't aspect-scale V (no repeat).
      const fillScale = fill.type === 'gradient'
        ? new three.Vector2(tiling, tiling)
        : new three.Vector2(tiling, tiling * aspect)
      const mat = panelMaterial(three, tex, fillTex, fillScale, new three.Color(fill.textColor), lit)
      const mesh = new three.Mesh(geo, mat)
      mesh.userData.tex = tex   // so disposeRoot() frees the cloned text texture on rebuild
      spinGroup.add(mesh)
    }

    if (lit) {
      const key = new three.DirectionalLight(0xffffff, 1.0)
      key.position.set(6, 8, 14)
      root.add(key)
      root.add(new three.AmbientLight(0xffffff, Math.max(0.15, 1 - n(params, 'shadeStrength') * 0.7)))
    }

    state = { spinGroup, tiltGroup }
    ballEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    s.tiltGroup.rotation.z = n(params, 'axisTilt')
    // One full revolution per loop at speed 1 → always seamless (integer speed stays seamless).
    s.spinGroup.rotation.y = t01 * Math.PI * 2 * n(params, 'spinSpeed')
  },
}
