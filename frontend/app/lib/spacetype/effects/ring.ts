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
  { key: 'radius', label: 'Ring size', kind: 'slider', min: 2, max: 12, step: 0.1, default: 5, group: 'Ribbon' },
  { key: 'repeat', label: 'Repeater', kind: 'slider', min: 1, max: 8, step: 1, default: 1, group: 'Ribbon' },
  { key: 'padding', label: 'Padding', kind: 'slider', min: 0, max: 0.9, step: 0.01, default: 0, group: 'Ribbon' },
  { key: 'ringTilt', label: 'Ring tilt', kind: 'slider', min: -1.2, max: 1.2, step: 0.01, default: -0.28, group: 'Transform' },
  { key: 'cardSize', label: 'Card size', kind: 'slider', min: 0.3, max: 3, step: 0.05, default: 1.4, group: 'Ribbon' },
  { key: 'perspective', label: 'Perspective', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Transform' },
  { key: 'ringOpening', label: 'Ring opening', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.55, group: 'Transform' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 6, step: 1, default: 1, group: 'Motion' },
  { key: 'direction', label: 'Direction', kind: 'select', options: ['cw', 'ccw'], default: 'cw', group: 'Motion' },
  { key: 'backFade', label: 'Back fade', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Look' },
]

interface RingState { quads: THREE.Mesh[] }

function n(p: Params, k: string): number { return Number(p[k]) }

// Ring opening's max lean off top-down (radians, ~80deg): opening 1 reveals the
// full circle face-on to the camera path; opening 0 collapses the ring to
// head-on. See `update`/`buildScene`'s `root.rotation.set(...)` call.
const OPEN_MAX = 1.4

// Read-scratch for the back-fade world-position read in `update`'s per-quad
// loop — written then read synchronously within one call, so a single
// module-scope instance is safe to reuse across engines (see turntable.ts's
// note on why `ringState` itself must NOT be a module var, unlike this).
const _tmpVec = new THREE.Vector3()

export const ringEffect: SpaceTypeEffect = {
  id: 'ring',
  label: 'Ring',
  controls,
  liveKeys: ['radius', 'ringTilt', 'cardSize', 'perspective', 'speed', 'direction', 'padding', 'ringOpening', 'backFade'],
  loopRates(params) {
    return [Math.max(1, Math.round(Number(params.speed) || 1))]
  },

  buildScene(three, params, _textTexture, env) {
    void _textTexture
    const root = new three.Group()
    const quads: THREE.Mesh[] = []

    const items = parseContent(String(params.content ?? '[]'))
    const baseTiles = expandContent(items)
    const repeat = Math.max(1, Math.round(Number(params.repeat) || 1))
    const tiles = repeat > 1 ? Array.from({ length: repeat }, () => baseTiles).flat() : baseTiles
    const layoutCache = new Map<string, CharLayout>()
    // Register each sourceId's glyph atlas ONCE (on its first mesh) so disposeRoot() frees
    // it on rebuild — mirrors cylinder.ts's `registered` set. Image tiles are excluded: their
    // textures are owned by env.imageTextures (engine's setImageTextures/dispose already
    // tracks + frees them), so tagging userData.tex there would double-dispose.
    const registered = new Set<string>()

    for (const tile of tiles) {
      const geo = new three.PlaneGeometry(1, 1)
      let material: THREE.MeshBasicMaterial
      let aspect = 1
      // Set only for word/letter tiles — the glyph atlas texture to register on the mesh
      // below (once per sourceId). Stays undefined for image tiles (engine-owned textures).
      let glyphTex: THREE.Texture | undefined

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
        glyphTex = layout.texture

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
      // Register each sourceId's glyph atlas ONCE (on its first mesh) so disposeRoot() frees
      // it on rebuild — mirrors cylinder.ts's `registered` set (line 255 there). Image tiles
      // are excluded: their textures are owned by env.imageTextures (engine's
      // setImageTextures/dispose already tracks + frees them), so tagging userData.tex here
      // would cause a double-dispose on the next build.
      if (glyphTex && !registered.has(tile.sourceId)) {
        mesh.userData.tex = glyphTex
        registered.add(tile.sourceId)
      }
      root.add(mesh)
      quads.push(mesh)
    }

    root.userData.ringState = { quads } as RingState
    // Ring opening drives the primary X reveal; ring tilt is now a lean on Z.
    // Kept in sync with `update`'s identical composition below.
    root.rotation.set(-n(params, 'ringOpening') * OPEN_MAX, 0, n(params, 'ringTilt'))
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

    const padding = n(params, 'padding')
    const backFade = n(params, 'backFade')
    const radius = n(params, 'radius')

    const count = st.quads.length
    for (let i = 0; i < count; i++) {
      const quad = st.quads[i]!
      const tf = ringTransform(i, count, rp, t01)
      quad.position.set(tf.x, tf.y, tf.z)
      quad.rotation.set(0, tf.rotY, 0)
      const aspect = Number(quad.userData.aspect ?? 1)
      quad.scale.set(aspect * tf.scale * (1 - padding), tf.scale, 1)
    }

    // Ring opening drives the primary X reveal; ring tilt is now a lean on Z
    // (was: `root.rotation.x = ringTilt` alone — see buildScene's matching call).
    root.rotation.set(-n(params, 'ringOpening') * OPEN_MAX, 0, n(params, 'ringTilt'))
    // v1: read perspective as a group Z push (depth cue) without touching the shared camera.
    root.position.z = -n(params, 'perspective') * 3

    // Back-fade needs each quad's CURRENT world position, which depends on the
    // root rotation/position just set above — force the group's world matrix
    // current before reading it per-quad.
    root.updateMatrixWorld(true)
    for (let i = 0; i < count; i++) {
      const quad = st.quads[i]!
      const material = quad.material as THREE.MeshBasicMaterial
      if (backFade > 0) {
        const wz = quad.getWorldPosition(_tmpVec).z
        // Normalize depth to [0,1] across the ring's z-range (~[-radius, +radius]
        // before group rotation); farther from camera (smaller world z) => more fade.
        const back = Math.min(1, Math.max(0, (radius - wz) / (2 * radius)))
        material.opacity = 1 - backFade * back
      } else {
        material.opacity = 1
      }
    }
  },
}
