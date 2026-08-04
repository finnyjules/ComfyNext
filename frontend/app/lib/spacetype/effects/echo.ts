import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { easeSpacing, rampScalar, driftQ, wrapFade, perspScale } from '../echoMath'
import { stripAlpha } from '~/lib/color/convert'

/**
 * ECHO — one string duplicated into a stack of copies ("a pile of papers").
 * Each echo is a Group: an opaque CARD quad (the occluder, sized to the text box
 * + padding) plus a TEXT mesh that samples the shared text texture's ALPHA and is
 * tinted per-copy (melt-style alpha-only ink, so RGB comes from a uColor uniform).
 * Copies are offset by a cumulative, spacing-eased X/Y/Z vector; the perspective
 * camera + a per-copy perspScale give controllable depth. Occlusion is real depth
 * + renderOrder by zOrder. The base (copy 0) is static; echoes can DRIFT and loop.
 */

const controls: ControlSpec[] = [
  // Type — note: NO typeColor (we use the texture's alpha only and tint per copy).
  { key: 'text', label: 'Text', kind: 'text', default: 'ECHO', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 130, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // Stack — count is the number of echoes IN ADDITION to the static base.
  { key: 'count', label: 'Echoes', kind: 'slider', min: 1, max: 40, step: 1, default: 6, group: 'Stack' },
  { key: 'offsetX', label: 'Offset X', kind: 'slider', min: -3, max: 3, step: 0.02, default: 0, group: 'Stack' },
  { key: 'offsetY', label: 'Offset Y', kind: 'slider', min: -3, max: 3, step: 0.02, default: -0.9, group: 'Stack' },
  { key: 'offsetZ', label: 'Depth (Z)', kind: 'slider', min: -1.5, max: 1.5, step: 0.02, default: 0, group: 'Stack' },
  { key: 'perspective', label: 'Perspective', kind: 'slider', min: 0, max: 1, step: 0.01, default: 1, group: 'Stack' },
  { key: 'spacingCurve', label: 'Spacing curve', kind: 'slider', min: -1, max: 1, step: 0.02, default: 0, group: 'Stack' },
  { key: 'layout', label: 'Spread', kind: 'select', options: ['directional', 'bidirectional', 'mirror'], default: 'directional', group: 'Stack' },
  // Occlusion — the "pile of papers". The card occludes the layers behind it; by default it is
  // an INVISIBLE occluder (writes depth only) so it cuts the echoes yet reveals the background
  // instead of a visible box. Turn "Show box" on to paint it as a solid colored card.
  { key: 'showBox', label: 'Show box', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Occlusion' },
  { key: 'cardPadX', label: 'Card pad X', kind: 'slider', min: 0, max: 4, step: 0.05, default: 0.4, group: 'Occlusion' },
  { key: 'cardPadY', label: 'Card pad Y', kind: 'slider', min: 0, max: 4, step: 0.05, default: 0.15, group: 'Occlusion' },
  { key: 'cardColor', label: 'Card color', kind: 'color', default: '#000000', group: 'Occlusion' },
  { key: 'cardOpacity', label: 'Card opacity', kind: 'slider', min: 0, max: 1, step: 0.02, default: 1, group: 'Occlusion' },
  { key: 'zOrder', label: 'On top', kind: 'select', options: ['base', 'last'], default: 'base', group: 'Occlusion' },
  // Look — base → end ramp (color / opacity / fill↔outline / scale).
  { key: 'baseColor', label: 'Base color', kind: 'color', default: '#ffffff', group: 'Look' },
  { key: 'endColor', label: 'End color', kind: 'color', default: '#ffffff', group: 'Look' },
  { key: 'baseOpacity', label: 'Base opacity', kind: 'slider', min: 0, max: 1, step: 0.02, default: 1, group: 'Look' },
  { key: 'endOpacity', label: 'End opacity', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.35, group: 'Look' },
  { key: 'baseStroke', label: 'Base outline', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Look' },
  { key: 'endStroke', label: 'End outline', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Look' },
  { key: 'baseScale', label: 'Base scale', kind: 'slider', min: 0.2, max: 2, step: 0.02, default: 1, group: 'Look' },
  { key: 'endScale', label: 'End scale', kind: 'slider', min: 0.2, max: 2, step: 0.02, default: 1, group: 'Look' },
  // Motion — drift only (integer slots per loop; 0 = static).
  { key: 'driftSpeed', label: 'Drift', kind: 'slider', min: 0, max: 6, step: 1, default: 0, group: 'Motion' },
  // Transform — global scene framing, read by the engine.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

const n = (p: Params, k: string): number => Number(p[k])
const CAM_Z = 14            // matches engine.ts perspective camera position
const PLANE_H = 5           // world height of one text plane before per-copy scale
const Z_BIAS = 0.012        // per-slot depth stagger to force a deterministic order

interface CopyHandle {
  group: THREE.Group
  card: THREE.Mesh
  text: THREE.Mesh
  uColor: { value: THREE.Color }
  uOpacity: { value: number }
  uStroke: { value: number }
  cardMat: THREE.MeshBasicMaterial
}

interface EchoState {
  copies: CopyHandle[]   // index 0 = base (static), 1..count = echoes
  // The actual glyph's world-space bounds + centre within the text plane (measured from the
  // texture's alpha), so the card hugs and centres on the letters — not the font em-box.
  glyphW: number
  glyphH: number
  glyphCX: number
  glyphCY: number
}

/** Measure the glyph's pixel bounds from the texture's alpha and convert to world-space size +
 *  centre offset within a plane of `planeW`×`planeH`. Falls back to the full plane if empty. */
function measureGlyph(canvas: HTMLCanvasElement | undefined, planeW: number, planeH: number) {
  const fallback = { glyphW: planeW, glyphH: planeH, glyphCX: 0, glyphCY: 0 }
  const ctx = canvas?.getContext?.('2d')
  if (!canvas || !ctx) return fallback
  const cw = canvas.width, ch = canvas.height
  if (!cw || !ch) return fallback
  const d = ctx.getImageData(0, 0, cw, ch).data
  let minX = cw, maxX = -1, minY = ch, maxY = -1
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (d[(y * cw + x) * 4 + 3]! > 16) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return fallback
  return {
    glyphW: ((maxX - minX + 1) / cw) * planeW,
    glyphH: ((maxY - minY + 1) / ch) * planeH,
    glyphCX: (((minX + maxX + 1) / 2) / cw - 0.5) * planeW,
    // canvas y is top-down; the plane (flipY texture) is bottom-up → invert.
    glyphCY: (0.5 - ((minY + maxY + 1) / 2) / ch) * planeH,
  }
}

// Per-scene state lives on the built root's userData (see update()), NOT a module var: the card
// preview and the headless frame source run two concurrent engines over this singleton effect, and
// the engine caches multiple roots per instance — a shared var would let whichever built last own
// it, freezing every other surface. buildScene stashes it on root.userData.echoState.

/** Alpha-only ink material: glyph alpha from the texture, RGB from uColor, and a
 *  fill↔outline blend (uStroke) using the screen-space derivative of the alpha. */
function makeInk(three: typeof THREE, tex: THREE.Texture) {
  const uColor = { value: new three.Color('#ffffff') }
  const uOpacity = { value: 1 }
  const uStroke = { value: 0 }
  const mat = new three.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: three.DoubleSide })
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uColor = uColor
    sh.uniforms.uOpacity = uOpacity
    sh.uniforms.uStroke = uStroke
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEchoUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvEchoUv = uv;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uColor; uniform float uOpacity; uniform float uStroke; varying vec2 vEchoUv;')
      .replace('#include <map_fragment>', [
        'float aFill = texture2D(map, vEchoUv).a;',
        'float edge = length(vec2(dFdx(aFill), dFdy(aFill)));',
        'float aOut = clamp(edge * 6.0, 0.0, 1.0);',
        'float a = mix(aFill, aOut, uStroke);',
        'diffuseColor = vec4(uColor, a * uOpacity);',
      ].join('\n'))
  }
  return { mat, uColor, uOpacity, uStroke }
}

export const echoEffect: SpaceTypeEffect = {
  id: 'echo',
  label: 'Echo',
  controls,
  liveKeys: ['driftSpeed', 'perspective'],

  buildScene(three, params, textTexture) {
    const root = new three.Group()

    // The shared texture ships RepeatWrapping (for tiling effects); clamp so the
    // plane edges don't wrap the glyph.
    textTexture.wrapS = textTexture.wrapT = three.ClampToEdgeWrapping
    textTexture.needsUpdate = true

    const img = textTexture.image as { width?: number; height?: number } | undefined
    const aspect = img && img.width && img.height ? img.width / img.height : 4
    const planeH = PLANE_H
    const planeW = Math.max(0.5, planeH * aspect)
    // Measure the real glyph bounds so the card hugs + centres on the letters (the texture has
    // transparent em/leading margins around the glyphs).
    const { glyphW, glyphH, glyphCX, glyphCY } = measureGlyph(
      textTexture.image as HTMLCanvasElement | undefined, planeW, planeH)

    const count = Math.max(1, Math.round(n(params, 'count')))
    const total = count + 1
    const copies: CopyHandle[] = []

    for (let i = 0; i < total; i++) {
      const grp = new three.Group()

      const cardMat = new three.MeshBasicMaterial({ color: new three.Color(stripAlpha(String(params.cardColor))), side: three.DoubleSide })
      const card = new three.Mesh(new three.PlaneGeometry(1, 1), cardMat)

      const ink = makeInk(three, textTexture)
      const text = new three.Mesh(new three.PlaneGeometry(planeW, planeH), ink.mat)
      text.userData.tex = textTexture

      grp.add(card)
      grp.add(text)
      root.add(grp)

      copies.push({ group: grp, card, text, uColor: ink.uColor, uOpacity: ink.uOpacity, uStroke: ink.uStroke, cardMat })
    }

    root.userData.echoState = { copies, glyphW, glyphH, glyphCX, glyphCY } as EchoState
    echoEffect.update(0, params, root)
    return root
  },

  update(t01, params, root) {
    const s = root?.userData?.echoState as EchoState | undefined
    if (!s) return
    const { copies, glyphW, glyphH, glyphCX, glyphCY } = s
    const count = copies.length - 1
    if (count < 1) return

    const ox = n(params, 'offsetX'), oy = n(params, 'offsetY'), oz = n(params, 'offsetZ')
    const persp = n(params, 'perspective')
    const curve = n(params, 'spacingCurve')
    const layout = String(params.layout)
    const padX = n(params, 'cardPadX'), padY = n(params, 'cardPadY')
    const cardColor = new THREE.Color(stripAlpha(String(params.cardColor)))
    const cardOpacity = n(params, 'cardOpacity')
    const showBox = String(params.showBox) === 'on'
    const baseOnTop = String(params.zOrder) === 'base'
    const drift = Math.max(0, Math.round(n(params, 'driftSpeed')))
    const frac = drift > 0 ? (t01 * drift) % 1 : 0

    const baseColor = new THREE.Color(stripAlpha(String(params.baseColor)))
    const endColor = new THREE.Color(stripAlpha(String(params.endColor)))
    const baseOp = n(params, 'baseOpacity'), endOp = n(params, 'endOpacity')
    const baseStroke = n(params, 'baseStroke'), endStroke = n(params, 'endStroke')
    const baseScale = n(params, 'baseScale'), endScale = n(params, 'endScale')

    const placeCopy = (h: CopyHandle, q: number, tRamp: number, env: number) => {
      // Eased cumulative offset: linear cumulative = perStep * q; easing redistributes
      // but keeps the far point (q=count) identical to linear.
      const eased = easeSpacing(q / count, curve) * count
      let dirSign = 1
      let flip = false
      if (layout === 'bidirectional') {
        // alternate echoes to +/- sides; base stays centred
        dirSign = (Math.round(q) % 2 === 0) ? 1 : -1
      } else if (layout === 'mirror') {
        dirSign = (Math.round(q) % 2 === 0) ? 1 : -1
        flip = dirSign < 0
      }
      const px = ox * eased * dirSign
      const py = oy * eased * dirSign
      const pz = oz * eased * dirSign

      // Deterministic depth stagger so order is stable even when oz == 0.
      const orderSign = baseOnTop ? -1 : 1
      const zBias = orderSign * Z_BIAS * q
      h.group.position.set(px, py, pz + zBias)
      // renderOrder must be set on the MESHES (Three ignores Group.renderOrder for sorting).
      // Nearer-to-top draws later so transparent copies composite back-to-front.
      const ord = baseOnTop ? -q : q
      h.card.renderOrder = ord
      h.text.renderOrder = ord + 0.5 // each copy's text draws just after its own card

      // Per-copy perspective compensation (scale held flat at persp=0).
      const ps = perspScale(pz + zBias, persp, CAM_Z)
      const lookScale = rampScalar(baseScale, endScale, tRamp) * ps
      h.group.scale.set(lookScale, lookScale * (flip ? -1 : 1), lookScale)

      // Card: hugs + centres on the measured GLYPH (+ padding), behind the text by a sliver.
      h.card.scale.set(glyphW + padX * 2, glyphH + padY * 2, 1)
      h.card.position.set(glyphCX, glyphCY, -Z_BIAS * 0.4)
      if (showBox) {
        // Visible card: paint cardColor, occlude via the depth buffer when opaque.
        h.cardMat.colorWrite = true
        h.cardMat.color.copy(cardColor)
        h.cardMat.opacity = cardOpacity
        h.cardMat.transparent = cardOpacity < 1
        h.cardMat.depthWrite = cardOpacity >= 1
      } else {
        // Invisible occluder: write DEPTH only (no colour) so it still hides the layers behind
        // it but reveals the background instead of a box — the "paper" is there but unseen.
        h.cardMat.colorWrite = false
        h.cardMat.transparent = false
        h.cardMat.opacity = 1
        h.cardMat.depthWrite = true
      }

      // Text: in front of its own card; ramped ink.
      h.text.position.set(0, 0, Z_BIAS * 0.4)
      h.uColor.value.copy(baseColor).lerp(endColor, tRamp)
      h.uOpacity.value = rampScalar(baseOp, endOp, tRamp) * env
      h.uStroke.value = rampScalar(baseStroke, endStroke, tRamp)
    }

    // ── Base (copy 0): static, full base look, slot 0. ──
    placeCopy(copies[0]!, 0, 0, 1)

    // ── Echoes 1..count. ──
    for (let j = 0; j < count; j++) {
      const handle = copies[j + 1]!
      const q = drift > 0 ? driftQ(j, frac, count) : (j + 1) // slot in (0, count]
      const tRamp = q / count                                 // 0 at base → 1 at far end
      const env = drift > 0 ? wrapFade(tRamp, 0.18) : 1
      placeCopy(handle, q, tRamp, env)
    }
  },
}
