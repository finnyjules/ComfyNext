import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
import { layoutChars } from '../charLayout'
import { parseFills, fillPrimary } from '../fills'

/**
 * BLEND — the Illustrator "blend tool meets 3D rotation" look. One word is replicated into
 * N echoes; each echo is the SAME glyph stepped through a cumulative 3D transform (rotate +
 * scale + spread per step) and tinted from a colour gradient. Stacked Additively on a dark
 * background it reads as glowing concentric light-trails (reference: a "6" drawn as many
 * rotated, colour-swept outlines); in Over mode it layers solid rotated cards.
 *
 * The glyph texture is rendered WHITE (solid fill, or a transparent-fill stroke for Outline
 * style) so the per-instance colour multiplies it. One InstancedMesh of N quads carries the
 * whole word; per instance we set a matrix (cumulative deltas) and a colour. `update` only does
 * work when Spin > 0 — it turntable-rotates the whole stack seamlessly across the loop.
 */

const DEFAULT_FILLS = '[{"type":"solid","a":"#2b5cff","b":"#000000","textColor":"#ffffff"},{"type":"solid","a":"#28e0ff","b":"#000000","textColor":"#ffffff"},{"type":"solid","a":"#ff8a1f","b":"#000000","textColor":"#ffffff"},{"type":"solid","a":"#ffd23b","b":"#000000","textColor":"#ffffff"}]'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: '6', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 800, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 40, step: 1, default: 4, group: 'Type' },
  // Blend — cumulative per-step deltas applied i× to echo i.
  { key: 'steps', label: 'Steps', kind: 'slider', min: 2, max: 80, step: 1, default: 40, group: 'Blend' },
  { key: 'rotStepX', label: 'Rotate X / step', kind: 'slider', min: -0.4, max: 0.4, step: 0.005, default: 0, group: 'Blend' },
  { key: 'rotStepY', label: 'Rotate Y / step', kind: 'slider', min: -0.4, max: 0.4, step: 0.005, default: 0.1, group: 'Blend' },
  { key: 'rotStepZ', label: 'Rotate Z / step', kind: 'slider', min: -0.4, max: 0.4, step: 0.005, default: 0.06, group: 'Blend' },
  { key: 'scaleStep', label: 'Scale / step', kind: 'slider', min: 0.8, max: 1.2, step: 0.001, default: 0.985, group: 'Blend' },
  { key: 'spreadX', label: 'Spread X / step', kind: 'slider', min: -0.3, max: 0.3, step: 0.005, default: 0, group: 'Blend' },
  { key: 'spreadY', label: 'Spread Y / step', kind: 'slider', min: -0.3, max: 0.3, step: 0.005, default: 0, group: 'Blend' },
  // Style.
  { key: 'style', label: 'Style', kind: 'select', options: ['outline', 'solid'], default: 'outline', group: 'Style' },
  { key: 'strokeWidth', label: 'Stroke width', kind: 'slider', min: 0.5, max: 10, step: 0.5, default: 3, group: 'Style' },
  { key: 'blendMode', label: 'Blend mode', kind: 'select', options: ['additive', 'over'], default: 'additive', group: 'Style' },
  // Colour — primaries of the fills list, cycled or lerped across the steps.
  { key: 'fills', label: 'Fills', kind: 'fillList', default: DEFAULT_FILLS, group: 'Color' },
  { key: 'gradientMode', label: 'Gradient (across steps)', kind: 'select', options: ['off', 'on'], default: 'on', group: 'Color' },
  // Motion — turntable spin of the whole stack (0 = static poster).
  { key: 'spin', label: 'Spin', kind: 'slider', min: 0, max: 4, step: 1, default: 0, group: 'Motion' },
  // Transform — applied generically by the engine.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

const WORLD_H = 6              // world height of the base (un-stepped) word

interface BlendState { mesh: THREE.InstancedMesh; count: number; additive: boolean }
let state: BlendState | null = null
const _m = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _scl = new THREE.Vector3()

function n(p: Params, k: string): number { return Number(p[k]) }

/** Cumulative pose of echo `i` from the per-step deltas. Pure — unit-tested. */
export function stepPose(i: number, p: Params): { px: number; py: number; pz: number; rx: number; ry: number; rz: number; s: number } {
  return {
    px: n(p, 'spreadX') * i,
    py: n(p, 'spreadY') * i,
    pz: -i * 0.015,                                  // gentle recede → readable Over depth
    rx: n(p, 'rotStepX') * i,
    ry: n(p, 'rotStepY') * i,
    rz: n(p, 'rotStepZ') * i,
    s: Math.pow(n(p, 'scaleStep'), i),
  }
}

/** Smooth multi-stop lerp across the fill primaries (gradient mode). */
function lerpColors(colors: THREE.Color[], t: number): THREE.Color {
  if (colors.length === 1) return colors[0]!.clone()
  const x = Math.min(1, Math.max(0, t)) * (colors.length - 1)
  const i0 = Math.floor(x)
  const i1 = Math.min(i0 + 1, colors.length - 1)
  return colors[i0]!.clone().lerp(colors[i1]!, x - i0)
}

/** Normalised blend position of echo `i` of `count` (0 at the original, 1 at the last echo). */
export function gradientT(i: number, count: number): number {
  return count <= 1 ? 0 : i / (count - 1)
}

function setMatrix(mesh: THREE.InstancedMesh, slot: number, i: number, aspect: number): void {
  const pose = poseCache!
  _e.set(pose[i]!.rx, pose[i]!.ry, pose[i]!.rz)
  _q.setFromEuler(_e)
  _pos.set(pose[i]!.px, pose[i]!.py, pose[i]!.pz)
  _scl.set(aspect * WORLD_H * pose[i]!.s, WORLD_H * pose[i]!.s, 1)
  _m.compose(_pos, _q, _scl)
  mesh.setMatrixAt(slot, _m)
}

let poseCache: ReturnType<typeof stepPose>[] | null = null

export const blendEffect: SpaceTypeEffect = {
  id: 'blend',
  label: 'Blend',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()

    const family = resolveFontFamily(String(params.font))
    const text = (String(params.text ?? '').split('\n')[0] || ' ')
    const outline = String(params.style) !== 'solid'
    const layout = layoutChars({
      text,
      fontFamily: family,
      fontWeight: fontHasWeightAxis(family) ? n(params, 'typeWeight') : 400,
      fontSizePx: 220,
      tracking: n(params, 'tracking'),
      scaleX: 1,
      color: outline ? 'rgba(0,0,0,0)' : '#ffffff',
      strokeColor: '#ffffff',
      strokeWidth: outline ? Math.max(0.5, n(params, 'strokeWidth')) : 0,
    })
    const tex = layout.texture
    const canvas = tex.image as HTMLCanvasElement
    const aspect = canvas.width / Math.max(1, canvas.height)

    const additive = String(params.blendMode) !== 'over'
    const mat = new three.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: additive ? 0.0 : 0.02,
      depthWrite: false,
      side: three.DoubleSide,
      blending: additive ? three.AdditiveBlending : three.NormalBlending,
    })

    const count = Math.max(1, Math.floor(n(params, 'steps')))
    const mesh = new three.InstancedMesh(new three.PlaneGeometry(1, 1), mat, count)
    mesh.frustumCulled = false

    const fills = parseFills(params.fills)
    const primaries = fills.map(f => fillPrimary(three, f))
    const gradient = String(params.gradientMode) === 'on'

    // Precompute poses once; reused by update() when spinning.
    poseCache = []
    for (let i = 0; i < count; i++) poseCache.push(stepPose(i, params))

    for (let slot = 0; slot < count; slot++) {
      // Over mode draws in instance order, so map the ORIGINAL (i=0) to the last slot → on top.
      const i = additive ? slot : (count - 1 - slot)
      setMatrix(mesh, slot, i, aspect)
      const col = gradient
        ? lerpColors(primaries, gradientT(i, count))
        : primaries[((i % primaries.length) + primaries.length) % primaries.length]!.clone()
      mesh.setColorAt(slot, col)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    root.add(mesh)
    root.userData.tex = tex
    state = { mesh, count, additive }
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const spin = n(params, 'spin') || 0
    // Static poster when spin is off; otherwise turntable the whole stack (seamless at loop ends).
    s.mesh.rotation.y = spin > 0 ? t01 * spin * 2 * Math.PI : 0
  },
}
