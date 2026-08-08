import * as THREE from 'three'
import { defaultsFromControls, type ControlSpec, type Params, type SpaceTypeEffect } from '../effect'
import { expandContent, parseContent } from '../tile'
import { ringTransform, bentOffset, type RingParams } from '../ringLayout'
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
  { key: 'ringOpening', label: 'Ring opening', kind: 'slider', min: -1, max: 1, step: 0.01, default: 0.55, group: 'Transform' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 6, step: 1, default: 1, group: 'Motion' },
  { key: 'direction', label: 'Direction', kind: 'select', options: ['cw', 'ccw'], default: 'cw', group: 'Motion' },
  { key: 'backFade', label: 'Back fade', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Look' },
  { key: 'bend', label: 'Bend', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Ribbon' },
  { key: 'cornerRadius', label: 'Corner radius', kind: 'slider', min: 0, max: 0.5, step: 0.01, default: 0.06, group: 'Ribbon' },
]

// Docs saved before the "Ring tune-up" feature only have the original 7 keys
// (content, radius, ringTilt, cardSize, perspective, speed, direction) — the
// newer keys below are absent (undefined), not merely zero. The app's load
// path does not backfill control defaults onto a hydrated doc, so `n()` below
// falls back to these declared defaults for any missing key.
const RING_DEFAULTS = defaultsFromControls(controls)

// Per-card plane subdivision along its width so `applyBend` (below) can curve
// each card to the ring instead of only tilting it flat. 1 segment tall keeps
// the vertical edges straight (bend only wraps tangentially around the ring).
const BEND_SEGMENTS = 16

/** Bend one card's local plane geometry to hug the ring's curvature.
 *  See ring.ts's module doc / task-3-brief.md for the full derivation:
 *  the mesh is placed with a NON-uniform `scale.x = aspect*cardSize*(1-padding)`
 *  (scale.z stays 1), so bending in unit-local space would distort under that
 *  scale — instead we bend in world-width space (`localX * w`) and divide back
 *  by `w` so `scale.x` restores the intended world width. Cached via `bendSig`
 *  on the mesh so unchanged params skip the per-vertex work every frame. */
function applyBend(mesh: THREE.Mesh, aspect: number, cardSize: number, padding: number, R: number, bend: number) {
  const sig = `${bend.toFixed(3)}|${aspect.toFixed(3)}|${cardSize.toFixed(3)}|${padding.toFixed(3)}|${R.toFixed(3)}`
  if (mesh.userData.bendSig === sig) return
  mesh.userData.bendSig = sig
  const geo = mesh.geometry as THREE.PlaneGeometry
  const pos = geo.attributes.position as THREE.BufferAttribute
  const baseX = mesh.userData.baseX as Float32Array // captured at build: the flat local X per vertex
  const w = aspect * cardSize * (1 - padding)
  for (let k = 0; k < pos.count; k++) {
    const lx = baseX[k]!
    if (bend <= 0 || w <= 0) { pos.setX(k, lx); pos.setZ(k, 0); continue }
    const o = bentOffset(lx * w, R, bend)
    pos.setX(k, o.tangent / w)
    pos.setZ(k, -o.inward)
  }
  pos.needsUpdate = true
}

interface RingState { quads: THREE.Mesh[] }

// `??` (nullish), not `||`: a legitimately-saved 0 (e.g. ringOpening=0 = head-on)
// must be preserved — only a genuinely-missing (undefined/null) key falls back
// to the control's declared default.
function n(p: Params, k: string): number { return Number(p[k] ?? RING_DEFAULTS[k]) }

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
  liveKeys: ['radius', 'ringTilt', 'cardSize', 'perspective', 'speed', 'direction', 'padding', 'ringOpening', 'backFade', 'bend', 'cornerRadius'],
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
      const geo = new three.PlaneGeometry(1, 1, BEND_SEGMENTS, 1)
      // Captured BEFORE any UV edits (position is independent of uv) — the
      // flat, undistorted local X per vertex, so `applyBend`/`update` can
      // recompute the bent geometry from scratch each time params change.
      const basePos = geo.attributes.position as THREE.BufferAttribute
      const baseX = Float32Array.from({ length: basePos.count }, (_, k) => basePos.getX(k))
      let material: THREE.MeshBasicMaterial
      let aspect = 1
      // Set only for word/letter tiles — the glyph atlas texture to register on the mesh
      // below (once per sourceId). Stays undefined for image tiles (engine-owned textures).
      let glyphTex: THREE.Texture | undefined
      // Set only for image tiles that got a rounded-rect corner mask attached below — stashed
      // onto mesh.userData.matUniforms so `update` can drive `uCorner` live from the slider.
      let cornerUniforms: { uCorner: { value: number }; uAspect: { value: number } } | undefined

      if (tile.kind === 'image') {
        const tex = env?.imageTextures?.get(tile.src)
        material = new three.MeshBasicMaterial({ map: tex ?? null, side: three.DoubleSide, transparent: true })
        aspect = tile.aspect

        // Rounded-rect alpha mask — IMAGE TILES ONLY (glyph/letter/word tiles have no panel to
        // round, so they never get this). Guarded on `tex`: a null map means USE_MAP is never
        // defined in the compiled shader, so the injected code's `vMapUv` varying wouldn't exist
        // (a real GL compile error, not a no-op) — setImageTextures' contract guarantees a real
        // texture by build time, so this only protects a would-be no-texture edge case.
        // UV varying: three@0.171.0's meshbasic fragment shader declares `vMapUv` (not `vUv`)
        // for USE_MAP — see uv_pars_fragment.glsl.js: `varying vec2 vMapUv;` under `#ifdef
        // USE_MAP`, decoupled from the generic `vUv` since ~three r152's per-map UV transforms.
        if (tex) {
          const uniforms = { uCorner: { value: n(params, 'cornerRadius') }, uAspect: { value: aspect } }
          material.onBeforeCompile = (shader) => {
            shader.uniforms.uCorner = uniforms.uCorner
            shader.uniforms.uAspect = uniforms.uAspect
            shader.fragmentShader = 'uniform float uCorner;\nuniform float uAspect;\n' + shader.fragmentShader.replace(
              '#include <dithering_fragment>',
              `#include <dithering_fragment>
               {
                 vec2 p = (vMapUv - 0.5) * vec2(uAspect, 1.0);      // centered, aspect-corrected
                 vec2 half = vec2(0.5 * uAspect, 0.5);
                 float r = clamp(uCorner, 0.0, 0.5) * min(half.x, half.y) * 2.0;
                 vec2 q = abs(p) - (half - vec2(r));
                 float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
                 if (d > 0.0) discard;                               // outside the rounded rect
               }`,
            )
          }
          cornerUniforms = uniforms
        }
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
          // Proportional remap (not min/max): with BEND_SEGMENTS the plane has
          // interior vertices at intermediate u, not just 0/1 — map each into
          // the glyph's [u0,u1] sub-rect by its position along the strip. For
          // the old 1-segment case (u ∈ {0,1}) this is identical to min/max.
          const uv = geo.attributes.uv as THREE.BufferAttribute
          for (let k = 0; k < uv.count; k++) {
            uv.setX(k, u0 + (u1 - u0) * uv.getX(k))
          }
          uv.needsUpdate = true
        }
      }

      const mesh = new three.Mesh(geo, material)
      mesh.userData.aspect = aspect
      mesh.userData.baseX = baseX
      if (cornerUniforms) mesh.userData.matUniforms = cornerUniforms
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
    const cardSize = n(params, 'cardSize')
    const bend = n(params, 'bend')

    const count = st.quads.length
    for (let i = 0; i < count; i++) {
      const quad = st.quads[i]!
      const tf = ringTransform(i, count, rp, t01)
      quad.position.set(tf.x, tf.y, tf.z)
      quad.rotation.set(0, tf.rotY, 0)
      const aspect = Number(quad.userData.aspect ?? 1)
      quad.scale.set(aspect * tf.scale * (1 - padding), tf.scale, 1)
      applyBend(quad, aspect, cardSize, padding, radius, bend)
      // Live corner-radius drive — only image quads carry `matUniforms` (see buildScene);
      // glyph/letter/word quads have no mask attached and are silently skipped here.
      const matUniforms = quad.userData.matUniforms as { uCorner: { value: number } } | undefined
      if (matUniforms) matUniforms.uCorner.value = n(params, 'cornerRadius')
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
