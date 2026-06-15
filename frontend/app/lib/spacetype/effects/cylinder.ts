import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { layoutChars } from '../charLayout'
import { VARIABLE_FONTS } from '~/data/variable-fonts'

/**
 * CYLINDER — per-character ring.
 *
 * Unlike the old surface-based cylinder (text painted onto a continuous tube),
 * each glyph is now its OWN quad placed around a vertical-axis ring, facing
 * outward. The WAVE controls move EACH glyph individually, keyed off its base
 * angle around the ring (so neighbouring letters move out of phase → snake /
 * flower / undulation), live in update() with no rebuild.
 *
 * This is the per-character text foundation: layoutChars() renders the whole
 * line to one CanvasTexture and hands back per-glyph UV regions; we remap each
 * PlaneGeometry's uv to its glyph region and sample the shared texture.
 */

const controls: ControlSpec[] = [
  // TYPE — shared text controls.
  { key: 'text', label: 'Text', kind: 'text', default: 'SPACE TYPE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'inter', group: 'Type' },
  { key: 'typeXScale', label: 'Type X-Scale', kind: 'slider', min: 0.3, max: 3, step: 0.05, default: 1, group: 'Type' },
  { key: 'typeYScale', label: 'Type Y-Scale', kind: 'slider', min: 40, max: 320, step: 2, default: 160, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  // RIBBON group (CYLINDER ring placement).
  { key: 'radius', label: 'Radius', kind: 'slider', min: 2, max: 14, step: 0.1, default: 5, group: 'Ribbon' },
  { key: 'count', label: 'Count', kind: 'slider', min: 1, max: 8, step: 1, default: 1, group: 'Ribbon' },
  { key: 'cylRotate', label: 'Cyl rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Ribbon' },
  { key: 'cylOffset', label: 'Cyl offset', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Ribbon' },
  // SNAKE group (per-glyph WAVE, angle-keyed — moves EACH letter).
  { key: 'waveCount', label: 'Wave count', kind: 'slider', min: 1, max: 8, step: 1, default: 2, group: 'Snake' },
  { key: 'waveLatitude', label: 'Wave latitude', kind: 'slider', min: 0, max: 6, step: 0.05, default: 0, group: 'Snake' },
  { key: 'waveLongitude', label: 'Wave longitude', kind: 'slider', min: 0, max: 3, step: 0.02, default: 0, group: 'Snake' },
  { key: 'waveRipple', label: 'Wave ripple', kind: 'slider', min: 0, max: 6, step: 0.05, default: 0, group: 'Snake' },
  { key: 'waveXScale', label: 'Wave X-scale', kind: 'slider', min: 0, max: 1.5, step: 0.02, default: 0, group: 'Snake' },
  { key: 'waveYScale', label: 'Wave Y-scale', kind: 'slider', min: 0, max: 1.5, step: 0.02, default: 0, group: 'Snake' },
  // MOTION.
  { key: 'waveSpeed', label: 'Wave speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0, group: 'Motion' },
  // TRANSFORM — camera + per-glyph tweak.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Camera rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.3, group: 'Transform' },
  { key: 'rotateY', label: 'Camera rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Camera rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'tweakX', label: 'Tweak X', kind: 'slider', min: -1.5, max: 1.5, step: 0.01, default: 0, group: 'Transform' },
  { key: 'tweakY', label: 'Tweak Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.01, default: 0, group: 'Transform' },
  { key: 'tweakZ', label: 'Tweak Z', kind: 'slider', min: -1.5, max: 1.5, step: 0.01, default: 0, group: 'Transform' },
  // COLOR — per-character cylinder is flat single-color (texture already in typeColor).
  { key: 'typeColor', label: 'Text', kind: 'color', default: '#101014', group: 'Color' },
  // SHADOW (copied from ribbon — directional light + ShadowMaterial catcher).
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

// Base world height of a glyph quad; width = CHAR_SIZE * glyph.aspect.
const CHAR_SIZE = 0.9
// Vertical spacing between stacked rings (multiples of glyph height).
const RING_SPACING = CHAR_SIZE * 1.6

// v2 assumes a single active engine/surface instance: buildScene populates this
// module-level array and update() reads it. Two concurrent engines would clash —
// promote to instance state (e.g. root.userData.glyphs) if multi-surface is ever needed.
let glyphs: { mesh: THREE.Mesh; a0: number; ringY: number }[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

function resolveFamily(fontId: string): string {
  const f = VARIABLE_FONTS.find(v => v.id === fontId) ?? VARIABLE_FONTS[0]
  return f?.family ?? 'Inter'
}

export const cylinderEffect: SpaceTypeEffect = {
  id: 'cylinder',
  label: 'Cylinder',
  controls,

  // We build our own per-glyph texture via layoutChars; the passed surface
  // textTexture (a tiled ribbon line) is ignored.
  buildScene(three, params, _textTexture) {
    void _textTexture
    const root = new three.Group()
    glyphs = []

    const layout = layoutChars({
      text: String(params.text),
      fontFamily: resolveFamily(String(params.font)),
      fontWeight: n(params, 'typeWeight'),
      fontSizePx: n(params, 'typeYScale'),
      tracking: n(params, 'tracking'),
      scaleX: n(params, 'typeXScale'),
      color: String(params.typeColor),
      strokeColor: '#000000',
      strokeWidth: n(params, 'typeStroke'),
    })

    const count = Math.max(1, Math.floor(n(params, 'count')))
    const radius = n(params, 'radius')
    const cylRotate = n(params, 'cylRotate')
    const cylOffset = n(params, 'cylOffset')
    const center = (count - 1) / 2

    for (let i = 0; i < count; i++) {
      const ringY = (i - center) * RING_SPACING
      for (const g of layout.glyphs) {
        const charH = CHAR_SIZE
        const charW = CHAR_SIZE * g.aspect
        const geo = new three.PlaneGeometry(charW, charH)

        // Remap the plane's uv attribute to the glyph's region of the shared
        // texture. PlaneGeometry's 4 verts are ordered TL, TR, BL, BR with uvs
        // (0,1),(1,1),(0,0),(1,0). Map x∈{0,1}→{u0,u1}, keep v as-is (full height).
        const uv = geo.attributes.uv as THREE.BufferAttribute
        for (let k = 0; k < uv.count; k++) {
          const ux = uv.getX(k) // 0 (left) or 1 (right)
          uv.setX(k, ux < 0.5 ? g.u0 : g.u1)
        }
        uv.needsUpdate = true

        const mat = new three.MeshBasicMaterial({
          map: layout.texture,
          transparent: true,
          alphaTest: 0.5, // glyph-shaped cast shadow + clean edges
          side: three.DoubleSide,
        })
        const mesh = new three.Mesh(geo, mat)
        mesh.castShadow = true
        mesh.receiveShadow = true

        // Base angle: text wraps once around the ring; cylRotate/cylOffset orient it.
        const a0 = g.centerT * Math.PI * 2 + cylRotate + cylOffset
        root.add(mesh)
        glyphs.push({ mesh, a0, ringY })
      }
    }

    // Register the shared per-glyph texture so disposeRoot() frees it on rebuild.
    root.userData.tex = layout.texture

    // SHADOW RIG — copied verbatim from ribbon.ts: a shadow-casting DirectionalLight
    // (position from lightAngleX/Y), a ShadowMaterial catcher plane behind the ring,
    // softness→mapSize, bias + radius. With alphaTest the cast shadows are glyph-shaped,
    // giving per-letter drop shadows on the catcher.
    if (String(params.shadows) === 'on') {
      const strength = n(params, 'shadowStrength')
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

  // PER-CHARACTER MOTION — live, no rebuild. Each glyph moves by its base angle a0,
  // so neighbouring letters are out of phase (snake / undulation around the ring).
  update(t01, params) {
    const t = t01 * Math.max(0, Math.round(n(params, 'waveSpeed'))) * Math.PI * 2
    const c = Math.max(1, n(params, 'waveCount'))
    const radius = n(params, 'radius')
    const waveLatitude = n(params, 'waveLatitude')
    const waveLongitude = n(params, 'waveLongitude')
    const waveRipple = n(params, 'waveRipple')
    const waveXScale = n(params, 'waveXScale')
    const waveYScale = n(params, 'waveYScale')
    const tweakX = n(params, 'tweakX')
    const tweakY = n(params, 'tweakY')
    const tweakZ = n(params, 'tweakZ')

    for (const g of glyphs) {
      const a0 = g.a0
      const phase = a0 * c + t
      const yOff = waveLatitude * Math.sin(phase)              // each letter lifts by its angle
      const rOff = waveRipple * Math.sin(phase)                // each letter pushes in/out
      const aOff = waveLongitude * Math.sin(a0 * c * 0.5 + t)  // each letter shifts around the ring
      const a = a0 + aOff
      const r = radius + rOff
      const x = Math.cos(a) * r * (1 + waveXScale)
      const z = Math.sin(a) * r
      const y = (g.ringY + yOff) * (1 + waveYScale)
      g.mesh.position.set(x, y, z)
      // Face outward: a quad's +Z normal must point along (cos a, 0, sin a). A Y
      // rotation by θ sends +Z→(sin θ,0,cos θ), so θ = π/2 − a aligns it with the
      // outward radial → the front of the ring (a≈π/2, +Z toward camera) reads
      // upright. Tweak rotations layer on top.
      g.mesh.rotation.set(tweakX, -a + Math.PI / 2 + tweakY, tweakZ)
    }
  },
}
