import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { buildTickerGeometryData, buildTickerStrokeData, rebakeTickerRow, tickerRow, type TickerGeoParams } from '../tickerGeometry'
import { loopTiles, scrollOffset, textVariantForBand } from '../ribbonGeometry'
import { parseFills, fillShaderTexture, fillTiling, fillTextColor, fillAlpha, fillTextAlpha, fillAnchor, fillScreenVec } from '../fills'
import { stripAlpha, parseHexA } from '~/lib/color/convert'
import { defaultFillsFor } from '../palette'

const TAU = Math.PI * 2

/**
 * Ticker — flat 2D rows of text marqueeing along a path, like a news crawl or stock ticker.
 *
 * Deliberately NOT a ribbon preset. Ribbon maps u uniformly in the curve parameter (so glyphs
 * stretch through bends) and sweeps its band along world Z (edge-on in depth, a 3D object by
 * construction). Ticker consumes tickerGeometry.ts instead, which parameterises u by ARC LENGTH
 * and sweeps along the IN-PLANE normal — so text RIDES a wave at constant glyph size, and the
 * band stays face-on. Defaults are flat and face-on (waveAmplitude 0, rotateX 0) to lead with
 * the 2D reading that ribbon's defaults bury.
 */
const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'Sailor', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'textRepeat', label: 'Text repeat', kind: 'slider', min: 1, max: 16, step: 1, default: 4, group: 'Type' },
  { key: 'bandHeight', label: 'Band height', kind: 'slider', min: 0.3, max: 3, step: 0.05, default: 1, group: 'Ribbon' },
  { key: 'bandLength', label: 'Band length', kind: 'slider', min: 8, max: 36, step: 0.5, default: 20, group: 'Ribbon' },
  { key: 'rowCount', label: 'Rows', kind: 'slider', min: 1, max: 12, step: 1, default: 3, group: 'Ribbon' },
  { key: 'rowSpacing', label: 'Row spacing', kind: 'slider', min: 0.4, max: 4, step: 0.05, default: 1.4, group: 'Ribbon' },
  { key: 'rowPhase', label: 'Row phase', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Ribbon' },
  { key: 'alternate', label: 'Alternate', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Ribbon' },
  { key: 'segments', label: 'Segments', kind: 'slider', min: 16, max: 400, step: 2, default: 160, group: 'Wave' },
  { key: 'waveAmplitude', label: 'Wave amount', kind: 'slider', min: 0, max: 6, step: 0.05, default: 0, group: 'Wave' },
  { key: 'waveFrequency', label: 'Wave freq', kind: 'slider', min: 0.5, max: 5, step: 0.1, default: 1.5, group: 'Wave' },
  { key: 'waveSpeed', label: 'Wave speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0, group: 'Wave' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Motion' },
  // Rails along the band's two long edges. Default 0 (off) so existing scenes are unchanged.
  { key: 'strokeWidth', label: 'Stroke', kind: 'slider', min: 0, max: 0.4, step: 0.01, default: 0, group: 'Stroke' },
  { key: 'strokeColor', label: 'Stroke color', kind: 'color', default: '#000000', group: 'Stroke' },
  // Seeded 'ticker', not 'ribbon': tests/unit/spacetype-palette.unit.spec.ts holds every effect's
  // fillList default to defaultFillsFor(n, <that effect's own id>).
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(1, 'ticker'), group: 'Color' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

// Per-scene state lives on the built root's userData (see update()), NOT a module var: the
// card preview and the headless frame source run two concurrent engines over this same
// singleton effect, and the engine caches multiple roots per instance — a shared array would
// let whichever built last own it, freezing every other surface (that was the multi-surface
// clash this used to warn about). buildScene stashes `rows` on root.userData.tickerRows.
interface TickerRow {
  tex: THREE.Texture
  uRepeatEffective: number
  dir: 1 | -1
  rowPhase: number
  geoParams: TickerGeoParams
  posAttr: THREE.BufferAttribute
  uvAttr: THREE.BufferAttribute
  /** Null when strokeWidth is 0 — no stroke mesh is built at all. */
  strokePosAttr: THREE.BufferAttribute | null
  /** Phase last written into the buffers, so a wave that stops can be settled back to rest. */
  bakedPhase: number
  uFillScroll: { value: number }
}

function n(p: Params, k: string): number { return Number(p[k]) }

/** The geometry params for row `i`, shared by buildScene and update()'s per-frame wave rebuild. */
function rowGeoParams(params: Params, phase: number, uRepeat: number): TickerGeoParams {
  return {
    segments: Math.max(1, Math.floor(n(params, 'segments'))),
    length: n(params, 'bandLength'),
    amplitude: n(params, 'waveAmplitude'),
    frequency: n(params, 'waveFrequency'),
    phase,
    height: n(params, 'bandHeight'),
    uRepeat,
  }
}

/**
 * Band material. Flat and unlit — Ticker is a 2D form, so there is no shadow/light pipeline
 * (that is ribbon's and stripes' business) and MeshBasicMaterial is enough.
 *
 * The band is painted by its FILL (solid 1×1 / gradient / grid / noise, sampled at the raw uv
 * plus the same scroll offset as the text so patterns drift with the glyphs), with the glyphs
 * composited on top in the fill's text colour.
 *
 * Alpha is per-pixel rather than uniform: the BAND takes the fill's alpha while GLYPHS stay
 * opaque (`mix(uBandAlpha, 1.0, coverage)`). That is what makes alpha 0 the text-only mode —
 * the band vanishes and the type keeps rendering. `depthWrite` is disabled below 1 so
 * translucent rows don't occlude each other.
 */
function bandMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  fillTex: THREE.Texture,
  tiling: number,
  anchor: number,
  textColor: THREE.Color,
  alpha: number,
  textAlpha: number,
  uFillScroll: { value: number },
): THREE.MeshBasicMaterial {
  const mat = new three.MeshBasicMaterial({
    map,
    side: three.DoubleSide,
    transparent: true,
    opacity: 1,
    // Opaque only when BOTH the band and the type are fully opaque; otherwise this mesh has to
    // blend against whatever is behind it.
    depthWrite: alpha >= 1 && textAlpha >= 1,
  })
  const uFillTex = { value: fillTex }
  const uFillTiling = { value: tiling }
  const uFillAnchor = { value: anchor }
  const uFillScreen = { value: fillScreenVec(three) }
  const uTextColor = { value: textColor }
  const uBandAlpha = { value: alpha }
  const uTextAlpha = { value: textAlpha }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFillTex = uFillTex
    shader.uniforms.uFillTiling = uFillTiling
    shader.uniforms.uFillAnchor = uFillAnchor
    shader.uniforms.uFillScreen = uFillScreen
    shader.uniforms.uTextColor = uTextColor
    shader.uniforms.uFillScroll = uFillScroll
    shader.uniforms.uBandAlpha = uBandAlpha
    shader.uniforms.uTextAlpha = uTextAlpha
    // Raw uv → the fill is pinned across the band height; the x scroll is added in the fragment.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRawUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawUv = uv;')
    // map_fragment is replaced outright (rather than appended to, as in stripes) because we need
    // the glyph coverage UNMULTIPLIED by material.opacity — the band and the glyphs get different
    // alphas. vMapUv carries the text texture's scrolled/atlas-offset uv.
    // uFillTex is tagged SRGBColorSpace → the GPU returns linear, so NO manual decode here.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFillTex;\nuniform float uFillTiling;\nuniform float uFillAnchor;\nuniform vec2 uFillScreen;\nuniform vec3 uTextColor;\nuniform float uFillScroll;\nuniform float uBandAlpha;\nuniform float uTextAlpha;\nvarying vec2 vRawUv;')
      // The band's RGB is weighted by its OWN alpha, so an invisible band contributes no colour.
      // A plain mix() would leave a halo of band fill ringing the type at antialiased glyph edges
      // (cov ~0.5) in the alpha-0 text-only mode — exactly the mode the transparency work is for.
      // The band's RGB is weighted by its own alpha and the glyphs' by theirs, so an invisible
      // band contributes no colour and text alpha is honoured independently.
      // Reduces to the naive form at uBandAlpha = uTextAlpha = 1: bandW = 1-cov, ta = cov, a = 1,
      // rgb = mix(fillCol, uTextColor, cov).
      .replace('#include <map_fragment>', '{ float cov = texture2D(map, vMapUv).a; vec2 fuv = uFillAnchor > 0.5 ? gl_FragCoord.xy / uFillScreen : vRawUv * uFillTiling + vec2(uFillScroll, 0.0); vec3 fillCol = texture2D(uFillTex, fuv).rgb; float ta = uTextAlpha * cov; float bandW = uBandAlpha * (1.0 - cov); float a = bandW + ta; diffuseColor = vec4((fillCol * bandW + uTextColor * ta) / max(a, 1e-4), a); }')
  }
  return mat
}

export const tickerEffect: SpaceTypeEffect = {
  id: 'ticker',
  label: 'Ticker',
  controls,

  // waveSpeed only shifts the wave's PHASE, which update() re-bakes per frame — no rebuild.
  // waveAmplitude/waveFrequency change the band's shape and arc length (and therefore its UVs),
  // so they stay structural. rotate* are read straight off params by the engine each frame.
  liveKeys: ['waveSpeed', 'rotateX', 'rotateY', 'rotateZ'],

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const rows: TickerRow[] = []

    const uRepeat = Number(textTexture.userData?.uRepeat ?? n(params, 'textRepeat')) || 1
    const count = Math.max(1, Math.floor(n(params, 'rowCount')))
    // Multiple texts → N-row atlas; row i shows row i%N via the texture's V transform.
    const numTexts = Math.max(1, Math.floor(Number(textTexture.userData?.numTexts ?? 1)))
    const fills = parseFills(params.fills)
    const strokeWidth = n(params, 'strokeWidth')
    const strokeAlpha = parseHexA(String(params.strokeColor)).alpha

    for (let i = 0; i < count; i++) {
      const row = tickerRow(i, {
        count,
        spacing: n(params, 'rowSpacing'),
        offset: n(params, 'rowPhase'),
        alternate: String(params.alternate) === 'on',
      })

      const geoParams = rowGeoParams(params, row.phase, uRepeat)
      const geo = buildTickerGeometryData(geoParams)

      const bufferGeo = new three.BufferGeometry()
      const posAttr = new three.BufferAttribute(geo.positions, 3)
      const uvAttr = new three.BufferAttribute(geo.uvs, 2)
      bufferGeo.setAttribute('position', posAttr)
      bufferGeo.setAttribute('uv', uvAttr)
      bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))
      // No computeVertexNormals: MeshBasicMaterial ignores normals, and they would go stale
      // after every per-frame re-bake anyway.

      // Independent scroll per row ⇒ clone the shared text texture.
      const tex = textTexture.clone()
      tex.needsUpdate = true
      tex.wrapS = three.RepeatWrapping
      // Alternate texts across rows — first string on the TOP row (shared convention).
      if (numTexts > 1) {
        tex.repeat.y = 1 / numTexts
        tex.offset.y = textVariantForBand(i, count, numTexts) / numTexts
      }

      const fill = fills[i % fills.length]!
      const uFillScroll = { value: 0 }
      const mat = bandMaterial(
        three,
        tex,
        fillShaderTexture(three, fill),
        fillTiling(fill),
        fillAnchor(fill),
        fillTextColor(three, fill),
        fillAlpha(fill),
        fillTextAlpha(fill),
        uFillScroll,
      )

      // Rails: a separate mesh so the band keeps its own textured material. Skipped entirely at
      // width 0 rather than added as degenerate geometry.
      let strokePosAttr: THREE.BufferAttribute | null = null
      if (strokeWidth > 0) {
        const sg = buildTickerStrokeData(geoParams, strokeWidth)
        const sGeo = new three.BufferGeometry()
        strokePosAttr = new three.BufferAttribute(sg.positions, 3)
        sGeo.setAttribute('position', strokePosAttr)
        sGeo.setIndex(new three.BufferAttribute(sg.indices, 1))
        const sMat = new three.MeshBasicMaterial({
          color: new three.Color(stripAlpha(String(params.strokeColor))),
          side: three.DoubleSide,
          transparent: strokeAlpha < 1,
          opacity: strokeAlpha,
          depthWrite: strokeAlpha >= 1,
        })
        const sMesh = new three.Mesh(sGeo, sMat)
        sMesh.position.y = row.y
        root.add(sMesh)
      }

      const mesh = new three.Mesh(bufferGeo, mat)
      // Register the cloned texture so disposeRoot() frees it on rebuild.
      mesh.userData.tex = tex
      mesh.position.y = row.y
      root.add(mesh)

      rows.push({
        tex,
        uRepeatEffective: geo.uRepeatEffective,
        dir: row.dir,
        rowPhase: row.phase,
        geoParams,
        posAttr,
        uvAttr,
        strokePosAttr,
        bakedPhase: row.phase,
        uFillScroll,
      })
    }

    root.userData.tickerRows = rows
    return root
  },

  update(t01, params, root) {
    const rows = (root?.userData?.tickerRows as TickerRow[] | undefined) ?? []
    const speed = n(params, 'speed')
    const waveSpeed = n(params, 'waveSpeed')
    const strokeWidth = n(params, 'strokeWidth')
    for (const r of rows) {
      // Text marquees along the band; a whole number of tiles per loop keeps it seamless.
      // uRepeatEffective (not uRepeat) so a waved band scrolls at the same GLYPH pace as a flat one.
      r.tex.offset.x = -scrollOffset(t01, speed, r.uRepeatEffective) * r.dir
      // Grid/noise fill drifts with the text (same offset ⇒ same direction & pace).
      r.uFillScroll.value = r.tex.offset.x

      // A travelling wave deforms the centreline, so the geometry must be re-baked each frame —
      // but ONLY when the wave is actually moving. At waveSpeed 0 (the default) the band is static
      // and no rebuild happens at all. Buffers are written IN PLACE rather than swapped for fresh
      // BufferAttributes, so the GPU buffers and our own allocations stay put across frames.
      //
      // waveSpeed is a liveKey, so dragging it to 0 does NOT rebuild the scene. Without the
      // bakedPhase check the geometry would freeze at whatever phase was last written instead of
      // settling back to rest, leaving update() impure in t01 (see effect.ts's contract).
      const phase = waveSpeed !== 0 ? r.rowPhase + waveSpeed * t01 * TAU : r.rowPhase
      if (phase !== r.bakedPhase) {
        // One centreline sample writes band positions + UVs and (in lockstep) the stroke rails, in
        // place — no fresh BufferAttributes, no index buffers. The rails MUST re-bake with the band
        // or they drift off its edge as the wave travels.
        //
        // UVs are re-baked too: u_i = cum_i * uRepeat / length, so a travelling wave redistributes
        // u by CURRENT arc length — leaving them stale would let glyphs breathe and creep,
        // defeating the constant-glyph-size guarantee this effect exists for. The total u RANGE
        // drifts with arc length, but scroll and loopRates deliberately keep using the cached
        // build-time uRepeatEffective, so the only effect is a slight change in how much text is
        // truncated at the band's END — where glyphs already scroll out of view. The loop stays
        // seamless because loopRates reports waveSpeed and loop.ts renders enough loops that the
        // slider's 0.05 step completes whole cycles — NOT because t01 0 and 1 coincide, which only
        // holds for an integer waveSpeed.
        rebakeTickerRow(
          { ...r.geoParams, phase },
          strokeWidth,
          r.posAttr.array as Float32Array,
          r.uvAttr.array as Float32Array,
          r.strokePosAttr ? (r.strokePosAttr.array as Float32Array) : null,
        )
        r.posAttr.needsUpdate = true
        r.uvAttr.needsUpdate = true
        if (r.strokePosAttr) r.strokePosAttr.needsUpdate = true
        r.bakedPhase = phase
      }
    }
  },

  /** Two independent motions: the per-row marquee scroll, and (when moving) the travelling wave.
   *  The seamless-loop export renders enough loops for every rate to complete whole cycles. */
  loopRates(params) {
    const speed = n(params, 'speed')
    const uRepeat = n(params, 'textRepeat') || 1
    const count = Math.max(1, Math.floor(n(params, 'rowCount')))
    const rates = new Set<number>()
    for (let i = 0; i < count; i++) {
      const row = tickerRow(i, {
        count,
        spacing: n(params, 'rowSpacing'),
        offset: n(params, 'rowPhase'),
        alternate: String(params.alternate) === 'on',
      })
      // Rows can differ in arc length (different wave phase ⇒ different curve), so the effective
      // repeat — and thus the scroll rate — is computed per row exactly as buildScene does.
      const geo = buildTickerGeometryData(rowGeoParams(params, row.phase, uRepeat))
      rates.add(loopTiles(speed, geo.uRepeatEffective))
    }
    const waveSpeed = n(params, 'waveSpeed')
    if (waveSpeed !== 0) rates.add(waveSpeed)
    return [...rates]
  },
}
