import * as THREE from 'three'
import { defaultsFromControls, type ControlSpec, type Params, type SpaceTypeEffect } from '../effect'
import { expandContent, parseContent } from '../tile'
import { ringTransform, bentOffset, type RingParams } from '../ringLayout'
import { layoutChars, type CharLayout } from '../charLayout'
import { resolveFontFamily, fontHasWeightAxis } from '~/lib/font/resolveFamily'
import { fillShaderTexture, fillIsTextured, fillTiling, fillPrimary, normalizeFill, type Fill } from '../fills'
import { fillIsShader } from '../fillTile'

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

const controls: ControlSpec[] = [
  {
    key: 'content',
    label: 'Content',
    kind: 'contentList',
    default: '[{"id":"d1","kind":"word","text":"NATURAL","resolution":"whole"},{"id":"d2","kind":"word","text":"FRESH","resolution":"letters"}]',
    group: 'Type',
  },
  // Global word type controls — one set of typography for every word/letter tile
  // on the ring (per-word typography is a possible later expansion, out of scope
  // here). Defaults reproduce the values these replaced (the old hardcoded
  // WORD_FONT_FAMILY/WEIGHT/SIZE_PX 'Inter'/700/160), so existing ring docs render
  // unchanged. Structural (rasterise the glyph atlas) — see `liveKeys` below.
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 160, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // GLOBAL WORD FILL (Task 2 of "Ring fills") — the ONE fill (solid/gradient/ombre/grid/
  // noise/…) painting every word/letter tile on the ring, masked to the glyph shape via
  // the glyph atlas as `alphaMap` — mirrors cylinder.ts:143-250. Stored as a single `Fill`
  // JSON object (NOT a fillList array — this is one global fill, not a per-slot palette),
  // so it's parsed by `resolveWordFill` below, not `parseFills` (which expects the
  // fillList on-disk shape, a JSON ARRAY, and would silently discard a bare object).
  // Structural (rebuilds the word/letter materials + fill texture) — NOT in `liveKeys`.
  // Replaces `typeColor` (removed): see `resolveWordFill`'s migration for old docs.
  { key: 'wordFill', label: 'Word fill', kind: 'fillList', default: '{"type":"solid","a":"#ffffff","b":"#000000","textColor":"#ffffff","angle":45,"density":8}', group: 'Color' },
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
  // Forces IMAGE tiles to a fixed card aspect, cover-cropped (no distortion) — see
  // docs/superpowers/specs/2026-08-07-ring-card-ratio-design.md. `native` (default)
  // reproduces current behaviour (each image keeps its own aspect), so existing ring
  // docs render unchanged. Words/letters ignore this entirely (see the image-tile
  // branch in buildScene below) — a word forced into a non-text aspect would
  // crop/distort its glyphs. Structural (rebuilds the mesh's shape/UVs) — a select has
  // no continuous drag, so rebuild-per-choice is fine; NOT in `liveKeys`.
  { key: 'cardRatio', label: 'Card ratio', kind: 'select', options: ['native', '1:1', '4:3', '3:4', '16:9', '9:16'], default: 'native', group: 'Ribbon' },
]

// Ratio-string → aspect (w/h) for `cardRatio`. `native` is handled separately (falls
// back to the tile's own aspect) since it isn't a fixed number.
const CARD_RATIOS: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16 }

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

// Resolve the ONE global word fill for this build (see the `wordFill` control's doc
// above). `wordFill` stores a single Fill as a bare JSON object — NOT the fillList's
// JSON-array shape — so it's parsed here directly via `normalizeFill` rather than
// `parseFills` (which treats a non-array string as junk and silently falls back to
// its own module default, discarding whatever the user actually authored). Tolerant
// of BOTH a bare object and an array (`[fill]`) on the wire, in case anything upstream
// (e.g. a future fillList-shaped editor) ever serializes it that way.
//
// Migration: docs saved before this control existed have no `wordFill` key at all —
// only the OLD `typeColor` control (now removed). Those docs keep rendering their
// saved colour by lifting `typeColor` into an equivalent solid Fill. A doc with
// neither key (never customized) falls back to the same solid-white default the
// control itself declares.
function resolveWordFill(params: Params): Fill {
  const raw = params.wordFill
  if (typeof raw === 'string' && raw) {
    try {
      const v = JSON.parse(raw)
      return normalizeFill(Array.isArray(v) ? v[0] : v)
    } catch { /* fall through to legacy/default below */ }
  }
  if (params.typeColor !== undefined && params.typeColor !== null && params.typeColor !== '') {
    return { type: 'solid', a: String(params.typeColor), b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }
  }
  return { type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }
}

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
    // Global word type controls (see `controls` above) — resolved ONCE for the whole
    // build, not per tile, mirroring cylinder.ts:172-182. `hasWght` gates whether the
    // weight slider drives a variable-font axis or falls back to a fixed 400 (matches
    // cylinder's non-variable-font fallback).
    const family = resolveFontFamily(String(params.font))
    const hasWght = fontHasWeightAxis(family)

    // The ONE global word fill, resolved ONCE for the whole build (not per tile) —
    // mirrors cylinder.ts:142-170. Rasterise the glyph atlas WHITE (pure mask); the fill
    // paints THROUGH it as `map` (textured fill) or a tinted `color` (solid fill) below.
    // `wordFillMap` is left null for a solid fill (fillShaderTexture/canvas work is
    // skipped entirely — no cost, and no `document` dependency, when every ring doc's
    // word fill is the solid default). A SHADER fill's texture is ANIMATED — fills.ts's
    // `refreshLiveShaderFills` mutates that exact cached Texture's `.image`/`.needsUpdate`
    // in place every frame, so it must be sampled live (NOT cloned, which would freeze it
    // on whatever frame existed at clone time) and must NOT be registered on
    // `root.userData.tex` (the shader-fill cache owns its disposal for the engine's whole
    // lifetime, not this one root/rebuild) — mirrors cylinder.ts:146-159. Any other
    // textured fill (gradient/ombre/grid/noise) is static, so it's cloned + given its own
    // `.repeat` (like cylinder's pattern-fill clone) so this build's tiling doesn't mutate
    // the shared module cache; registered on `root.userData.tex` for disposeRoot() to free
    // on rebuild — the SAME texture is reused by every word/letter mesh below, so it's
    // registered ONCE here, not per-mesh (that would double-dispose) — mirrors
    // cylinder.ts:160-169.
    const wf = resolveWordFill(params)
    const wfTextured = fillIsTextured(wf)
    let wordFillMap: THREE.Texture | null = null
    if (wfTextured) {
      if (fillIsShader(wf)) {
        wordFillMap = fillShaderTexture(three, wf)
      } else {
        wordFillMap = fillShaderTexture(three, wf).clone()
        wordFillMap.needsUpdate = true
        wordFillMap.repeat.set(fillTiling(wf), fillTiling(wf))
        root.userData.tex = wordFillMap
      }
    }

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

      // NOTE (Task 2 scope note, not this task's real work): Task 1 (tile.ts) renamed the
      // `image` ExpandedTile to `card` (`fillKind: 'image'|'solid'|'gradient'|…`). This
      // predicate is updated from the old `=== 'image'` to `=== 'card'` ONLY so existing
      // card/image ring docs keep routing here instead of falling into the word/letter
      // branch below (which would wrongly try to rasterise a card as text). The BODY of
      // this branch is untouched — it still only handles an image card (`tile.src`) and
      // has no dispatch on `fillKind` for solid/gradient/ombre/grid/noise cards; that
      // dispatch is Task 3's job (see task-3-brief.md).
      if (tile.kind === 'card') {
        const tex = env?.imageTextures?.get(tile.src)
        material = new three.MeshBasicMaterial({ map: tex ?? null, side: three.DoubleSide, transparent: true })

        // Card ratio: `native` keeps the image's own aspect (current behaviour);
        // any other option forces the CARD's shape to that ratio while the photo
        // itself is cover-cropped to fill it (see uvScale below) — no distortion.
        // `aspect` (mesh.userData.aspect) drives the live scale/bend/corner-SDF
        // downstream, so setting it to `cardR` here is what makes ring cards
        // uniform under a non-native ratio.
        const ratioKey = String(params.cardRatio ?? 'native')
        const A = tile.aspect
        const cardR = ratioKey === 'native' ? A : (CARD_RATIOS[ratioKey] ?? A)
        aspect = cardR
        // Cover-crop: sample a centered sub-rect of the native image (aspect A) so
        // it fills a cardR card without stretching. native → [1,1] (no crop).
        const uvScale: [number, number] = A >= cardR ? [cardR / A, 1] : [1, A / cardR]

        // Rounded-rect alpha mask — IMAGE TILES ONLY (glyph/letter/word tiles have no panel to
        // round, so they never get this). Guarded on `tex`: a null map means USE_MAP is never
        // defined in the compiled shader, so the injected code's `vMapUv` varying wouldn't exist
        // (a real GL compile error, not a no-op) — setImageTextures' contract guarantees a real
        // texture by build time, so this only protects a would-be no-texture edge case.
        // UV varying: three@0.171.0's meshbasic fragment shader declares `vMapUv` (not `vUv`)
        // for USE_MAP — see uv_pars_fragment.glsl.js: `varying vec2 vMapUv;` under `#ifdef
        // USE_MAP`, decoupled from the generic `vUv` since ~three r152's per-map UV transforms.
        if (tex) {
          const uniforms = {
            uCorner: { value: n(params, 'cornerRadius') },
            uAspect: { value: aspect },
            uUvScale: { value: new three.Vector2(uvScale[0], uvScale[1]) },
          }
          material.onBeforeCompile = (shader) => {
            shader.uniforms.uCorner = uniforms.uCorner
            shader.uniforms.uAspect = uniforms.uAspect
            shader.uniforms.uUvScale = uniforms.uUvScale
            shader.fragmentShader = 'uniform float uCorner;\nuniform float uAspect;\nuniform vec2 uUvScale;\n' + shader.fragmentShader.replace(
              '#include <map_fragment>',
              // Same as three@0.171.0's map_fragment chunk (verified against
              // node_modules/three/src/renderers/shaders/ShaderChunk/map_fragment.glsl.js),
              // with ONLY the sampled UV changed to the cover-cropped coordinate — every
              // other line (DECODE_VIDEO_TEXTURE branch included) is untouched.
              `#ifdef USE_MAP

	vec4 sampledDiffuseColor = texture2D( map, (vMapUv - 0.5) * uUvScale + 0.5 );

	#ifdef DECODE_VIDEO_TEXTURE

		// use inline sRGB decode until browsers properly support SRGB8_ALPHA8 with video textures (#26516)

		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );

	#endif

	diffuseColor *= sampledDiffuseColor;

#endif`,
            ).replace(
              '#include <dithering_fragment>',
              `#include <dithering_fragment>
               {
                 // Corner SDF uses the UNCROPPED vMapUv (card space, 0..1) with uAspect =
                 // cardR, so corners round on the card's shape, not the cropped photo —
                 // independent of the map_fragment crop above by design.
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
            fontFamily: family,
            fontWeight: hasWght ? n(params, 'typeWeight') : 400,
            fontSizePx: n(params, 'typeYScale'),
            tracking: n(params, 'tracking'),
            scaleX: 1,
            // The fill (solid/gradient/ombre/grid/noise) paints the glyphs — see `wf`
            // above — so rasterise the atlas WHITE and treat it as a pure shape mask,
            // same as cylinder.ts:140-141/172-182. `typeColor` (the old flat-colour
            // control this replaces) no longer feeds the atlas at all.
            color: '#ffffff',
            axes: hasWght ? { wght: n(params, 'typeWeight') } : undefined,
          })
          // Glyph atlas lives on uv CHANNEL 1 (glyph region); channel 0 (0…1, PlaneGeometry's
          // default, untouched below) carries the word fill — mirrors cylinder.ts:193-194.
          layout.texture.channel = 1
          layoutCache.set(tile.sourceId, layout)
        }
        glyphTex = layout.texture

        // uv (channel 0) stays PlaneGeometry's default 0…1 so the fill map tiles across the
        // whole tile. uv1 (channel 1, the alphaMap channel) carries the glyph atlas's region:
        // the full 0…1 atlas for a `word` tile, or one glyph's [u0,u1] sub-rect for a `letter`
        // tile — this is the same sub-rect remap the old code applied to channel 0, MOVED to
        // channel 1 (see ring's module doc / task-2-brief.md).
        const uv0 = geo.attributes.uv as THREE.BufferAttribute
        const uv1 = new Float32Array(uv0.count * 2)
        if (tile.kind === 'word') {
          const img = layout.texture.image as { width: number; height: number }
          aspect = img.height > 0 ? img.width / img.height : 1
          for (let k = 0; k < uv0.count; k++) {
            uv1[k * 2] = uv0.getX(k)
            uv1[k * 2 + 1] = uv0.getY(k)
          }
        } else {
          const g = layout.glyphs[tile.letterIndex]
          aspect = g?.aspect ?? 1
          const u0 = g?.u0 ?? 0
          const u1 = g?.u1 ?? 1
          // Proportional remap (not min/max): with BEND_SEGMENTS the plane has
          // interior vertices at intermediate u, not just 0/1 — map each into
          // the glyph's [u0,u1] sub-rect by its position along the strip. For
          // the old 1-segment case (u ∈ {0,1}) this is identical to min/max.
          for (let k = 0; k < uv0.count; k++) {
            uv1[k * 2] = u0 + (u1 - u0) * uv0.getX(k)
            uv1[k * 2 + 1] = uv0.getY(k)
          }
        }
        geo.setAttribute('uv1', new three.BufferAttribute(uv1, 2))

        // The glyph atlas is ALWAYS the `alphaMap` (shape mask, channel 1). A textured word
        // fill (gradient/ombre/grid/noise/shader) paints through it as `map` (channel 0,
        // white-tinted so the texture's own colours show through unmodified); a solid word
        // fill has no map — it's a flat `color` fill masked by the same alphaMap. Mirrors
        // task-2-brief.md's Step 2 material / cylinder.ts:243-245's textured/solid split.
        material = new three.MeshBasicMaterial({
          map: wfTextured ? wordFillMap : null,
          color: wfTextured ? new three.Color('#ffffff') : fillPrimary(three, wf),
          alphaMap: layout.texture,
          transparent: true,
          alphaTest: 0.5,
          side: three.DoubleSide,
        })
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
