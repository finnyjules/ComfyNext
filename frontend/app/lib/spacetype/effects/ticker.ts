import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { buildTickerGeometryData, tickerRow, type TickerGeoParams } from '../tickerGeometry'
import { loopTiles, scrollOffset, textVariantForBand } from '../ribbonGeometry'
import { parseFills, fillShaderTexture, fillTiling, fillTextColor, fillAlpha } from '../fills'
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
  // Seeded 'ticker', not 'ribbon': tests/unit/spacetype-palette.unit.spec.ts holds every effect's
  // fillList default to defaultFillsFor(n, <that effect's own id>).
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(1, 'ticker'), group: 'Color' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

// v2 assumes a single active engine/surface instance: buildScene populates this
// module-level array and update() reads it. Two concurrent engines would clash —
// promote to instance state (e.g. root.userData.rows) if multi-surface is ever needed.
let rows: {
  tex: THREE.Texture
  uRepeatEffective: number
  dir: 1 | -1
  rowPhase: number
  geoParams: TickerGeoParams
  posAttr: THREE.BufferAttribute
  uFillScroll: { value: number }
}[] = []

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
  textColor: THREE.Color,
  alpha: number,
  uFillScroll: { value: number },
): THREE.MeshBasicMaterial {
  const mat = new three.MeshBasicMaterial({
    map,
    side: three.DoubleSide,
    transparent: true,
    opacity: alpha,
    depthWrite: alpha >= 1,
  })
  const uFillTex = { value: fillTex }
  const uFillTiling = { value: tiling }
  const uTextColor = { value: textColor }
  const uBandAlpha = { value: alpha }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFillTex = uFillTex
    shader.uniforms.uFillTiling = uFillTiling
    shader.uniforms.uTextColor = uTextColor
    shader.uniforms.uFillScroll = uFillScroll
    shader.uniforms.uBandAlpha = uBandAlpha
    // Raw uv → the fill is pinned across the band height; the x scroll is added in the fragment.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRawUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawUv = uv;')
    // map_fragment is replaced outright (rather than appended to, as in stripes) because we need
    // the glyph coverage UNMULTIPLIED by material.opacity — the band and the glyphs get different
    // alphas. vMapUv carries the text texture's scrolled/atlas-offset uv.
    // uFillTex is tagged SRGBColorSpace → the GPU returns linear, so NO manual decode here.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFillTex;\nuniform float uFillTiling;\nuniform vec3 uTextColor;\nuniform float uFillScroll;\nuniform float uBandAlpha;\nvarying vec2 vRawUv;')
      .replace('#include <map_fragment>', '{ float cov = texture2D(map, vMapUv).a; vec2 fuv = vRawUv * uFillTiling + vec2(uFillScroll, 0.0); vec3 fillCol = texture2D(uFillTex, fuv).rgb; diffuseColor = vec4(mix(fillCol, uTextColor, cov), mix(uBandAlpha, 1.0, cov)); }')
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
    rows = []

    const uRepeat = Number(textTexture.userData?.uRepeat ?? n(params, 'textRepeat')) || 1
    const count = Math.max(1, Math.floor(n(params, 'rowCount')))
    // Multiple texts → N-row atlas; row i shows row i%N via the texture's V transform.
    const numTexts = Math.max(1, Math.floor(Number(textTexture.userData?.numTexts ?? 1)))
    const fills = parseFills(params.fills)

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
      bufferGeo.setAttribute('position', posAttr)
      bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
      bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))
      bufferGeo.computeVertexNormals()

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
        fillTextColor(three, fill),
        fillAlpha(fill),
        uFillScroll,
      )

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
        uFillScroll,
      })
    }

    return root
  },

  update(t01, params) {
    const speed = n(params, 'speed')
    const waveSpeed = n(params, 'waveSpeed')
    for (const r of rows) {
      // Text marquees along the band; a whole number of tiles per loop keeps it seamless.
      // uRepeatEffective (not uRepeat) so a waved band scrolls at the same GLYPH pace as a flat one.
      r.tex.offset.x = -scrollOffset(t01, speed, r.uRepeatEffective) * r.dir
      // Grid/noise fill drifts with the text (same offset ⇒ same direction & pace).
      r.uFillScroll.value = r.tex.offset.x

      // A travelling wave deforms the centreline, so the positions must be re-baked each frame —
      // but ONLY when the wave is actually moving. At waveSpeed 0 (the default) the band is static
      // and this whole branch is skipped. The rebuilt positions are copied INTO the existing
      // attribute buffer rather than swapped for a fresh BufferAttribute, so the GPU buffer and the
      // effect's own allocations stay put across frames.
      if (waveSpeed !== 0) {
        const next = buildTickerGeometryData({ ...r.geoParams, phase: r.rowPhase + waveSpeed * t01 * TAU })
        ;(r.posAttr.array as Float32Array).set(next.positions)
        r.posAttr.needsUpdate = true
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
