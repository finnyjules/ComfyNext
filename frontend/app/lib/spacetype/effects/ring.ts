import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { expandContent, parseContent } from '../tile'
import { ringTransform, type RingParams } from '../ringLayout'
import { layoutChars, type CharLayout } from '../charLayout'

/**
 * RING — the Expressive Studio keystone effect: photos and words ride one
 * arrangement, spinning on a circle. Each `ContentItem` (word or image) expands
 * to one or more tiles (`tile.ts`); each tile becomes one quad on the ring
 * (`ringLayout.ts`'s pure placement math). Words are rasterised once per
 * sourceId via `layoutChars` (memoized for the build) — a `word` tile shows the
 * whole texture, a `letter` tile shows one glyph's UV sub-rect.
 *
 * Per-scene state (the quad list) lives on `root.userData.ringState`, NOT a
 * module var — see turntable.ts's note: concurrent engines (card preview +
 * headless export) share this singleton effect module.
 */

// Hardcoded rasterisation opts for word/letter tiles — the ring effect has no
// `font` control of its own (content items don't carry per-word typography yet).
const WORD_FONT_FAMILY = 'Inter'
const WORD_FONT_WEIGHT = 700
const WORD_FONT_SIZE_PX = 160

const controls: ControlSpec[] = [
  {
    key: 'content',
    label: 'Content',
    kind: 'contentList',
    default: '[{"id":"d1","kind":"word","text":"NATURAL","resolution":"whole"},{"id":"d2","kind":"word","text":"FRESH","resolution":"letters"}]',
    group: 'Type',
  },
  { key: 'radius', label: 'Radius', kind: 'slider', min: 2, max: 12, step: 0.1, default: 5, group: 'Ribbon' },
  { key: 'ringTilt', label: 'Ring tilt', kind: 'slider', min: -1.2, max: 1.2, step: 0.01, default: -0.28, group: 'Transform' },
  { key: 'cardSize', label: 'Card size', kind: 'slider', min: 0.3, max: 3, step: 0.05, default: 1.4, group: 'Ribbon' },
  { key: 'perspective', label: 'Perspective', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Transform' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 6, step: 1, default: 1, group: 'Motion' },
  { key: 'direction', label: 'Direction', kind: 'select', options: ['cw', 'ccw'], default: 'cw', group: 'Motion' },
]

interface RingState { quads: THREE.Mesh[] }

function n(p: Params, k: string): number { return Number(p[k]) }

export const ringEffect: SpaceTypeEffect = {
  id: 'ring',
  label: 'Ring',
  controls,
  liveKeys: ['radius', 'ringTilt', 'cardSize', 'perspective', 'speed', 'direction'],
  loopRates(params) {
    return [Math.max(1, Math.round(Number(params.speed) || 1))]
  },

  buildScene(three, params, _textTexture, env) {
    void _textTexture
    const root = new three.Group()
    const quads: THREE.Mesh[] = []

    const items = parseContent(String(params.content ?? '[]'))
    const tiles = expandContent(items)
    const layoutCache = new Map<string, CharLayout>()

    for (const tile of tiles) {
      const geo = new three.PlaneGeometry(1, 1)
      let material: THREE.MeshBasicMaterial
      let aspect = 1

      if (tile.kind === 'image') {
        const tex = env?.imageTextures?.get(tile.src)
        material = new three.MeshBasicMaterial({ map: tex ?? null, side: three.DoubleSide, transparent: true })
        aspect = tile.aspect
      } else {
        let layout = layoutCache.get(tile.sourceId)
        if (!layout) {
          layout = layoutChars({
            text: tile.text,
            fontFamily: WORD_FONT_FAMILY,
            fontWeight: WORD_FONT_WEIGHT,
            fontSizePx: WORD_FONT_SIZE_PX,
            tracking: 0,
            scaleX: 1,
            color: '#ffffff',
          })
          layoutCache.set(tile.sourceId, layout)
        }
        material = new three.MeshBasicMaterial({ map: layout.texture, side: three.DoubleSide, transparent: true })

        if (tile.kind === 'word') {
          const img = layout.texture.image as { width: number; height: number }
          aspect = img.height > 0 ? img.width / img.height : 1
        } else {
          const g = layout.glyphs[tile.letterIndex]
          aspect = g?.aspect ?? 1
          const u0 = g?.u0 ?? 0
          const u1 = g?.u1 ?? 1
          const uv = geo.attributes.uv as THREE.BufferAttribute
          for (let k = 0; k < uv.count; k++) {
            uv.setX(k, uv.getX(k) < 0.5 ? u0 : u1)
          }
          uv.needsUpdate = true
        }
      }

      const mesh = new three.Mesh(geo, material)
      mesh.userData.aspect = aspect
      root.add(mesh)
      quads.push(mesh)
    }

    root.userData.ringState = { quads } as RingState
    root.rotation.x = Number(params.ringTilt)
    return root
  },

  update(t01, params, root) {
    const st = root?.userData?.ringState as RingState | undefined
    if (!st || !root) return

    const rp: RingParams = {
      radius: n(params, 'radius'),
      ringTilt: n(params, 'ringTilt'),
      cardSize: n(params, 'cardSize'),
      speed: n(params, 'speed'),
      direction: String(params.direction) === 'ccw' ? -1 : 1,
    }

    const count = st.quads.length
    for (let i = 0; i < count; i++) {
      const quad = st.quads[i]!
      const tf = ringTransform(i, count, rp, t01)
      quad.position.set(tf.x, tf.y, tf.z)
      quad.rotation.set(0, tf.rotY, 0)
      const aspect = Number(quad.userData.aspect ?? 1)
      quad.scale.set(aspect * tf.scale, tf.scale, 1)
    }

    root.rotation.x = n(params, 'ringTilt')
    // v1: read perspective as a group Z push (depth cue) without touching the shared camera.
    root.position.z = -n(params, 'perspective') * 3
  },
}
