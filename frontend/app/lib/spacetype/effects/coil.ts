import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
import { shapedSin } from '../ribbonGeometry'
import { parseFills, fillAtlasTexture, fillTextColor, fillAnchor, fillScreenVec, type Fill } from '../fills'
import { defaultFillsFor } from '../palette'

/**
 * COIL — source-matched to spacetypegenerator.com/coil.
 *
 * STG lays `ribbonCount` repetitions of the word along a Fermat spiral. Each repeat
 * `k` is a round-capped stroke in a cycling palette colour (setRibbonColor(k)),
 * drawn OVERLAPPING its neighbour and painted in order — so the band stays CONTINUOUS
 * and full-width, and the colour boundaries come out SEMICIRCULAR (each new colour's
 * round cap paints over the previous). Letters ride on top in a palette-shifted colour
 * (setTextColor(k)). It is NOT a string of separated pills.
 *
 * We render ONE continuous swept band (no overlaps ⇒ no z-fighting) and reproduce the
 * round-cap colour boundary PER-FRAGMENT: across the band v∈[-1,1], a segment boundary
 * bulges by halfU·√(1−v²) — exactly a semicircle of radius = half the band width. So
 *   segment(frag) = floor(u + halfU·√(1−v²))      // round caps
 *   segment(frag) = floor(u)                       // flat caps (halfU forced 0)
 * giving STG's rounded colour transitions in a continuous, legible band.
 *
 * Spiral:   θ(i)=√(spacing·i), r=radius·θ, P=−r·(cosθ,sinθ);  uniform-in-θ sampling.
 * Wave:     echo=atan2(Py,Px), w=shapedSin(sin(phase+echo·waveCount),slope)·waveSize,
 *           displaced radially ⇒ a filled waveCount-point star. waveSpeed = seamless spin.
 * Text:     baked label has a trailing gap, so we shift the glyph sample by −g/2 to
 *           centre the word in its segment (colour boundaries stay at the integer u,
 *           i.e. in the inter-word gap). Palette lives in a uniform array; the texture
 *           is a glyph MASK (alpha only).
 */

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'THIS & THEN', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  { key: 'textLead', label: 'Text margin start', kind: 'slider', min: 0, max: 0.7, step: 0.01, default: 0.05, group: 'Type' },
  { key: 'textTrail', label: 'Text margin end', kind: 'slider', min: 0, max: 0.7, step: 0.01, default: 0.05, group: 'Type' },
  { key: 'ribbonCount', label: 'Ribbon count', kind: 'slider', min: 1, max: 400, step: 1, default: 16, group: 'Ribbon' },
  { key: 'bandSize', label: 'Ribbon size', kind: 'slider', min: 0.05, max: 4, step: 0.05, default: 0.7, group: 'Ribbon' },
  { key: 'caps', label: 'Caps', kind: 'select', options: ['round', 'flat'], default: 'round', group: 'Ribbon' },
  { key: 'noStripes', label: 'No stripes', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  // Spiral geometry.
  { key: 'radius', label: 'Radius', kind: 'slider', min: 0.02, max: 1.5, step: 0.01, default: 0.22, group: 'Spiral' },
  { key: 'spacing', label: 'Spacing', kind: 'slider', min: 0.1, max: 8, step: 0.1, default: 2, group: 'Spiral' },
  { key: 'spiralStart', label: 'Spiral start', kind: 'slider', min: 0, max: 200, step: 1, default: 10, group: 'Spiral' },
  // Wave → star.
  { key: 'waveSize', label: 'Wave size', kind: 'slider', min: 0, max: 6, step: 0.05, default: 0, group: 'Wave' },
  { key: 'waveCount', label: 'Wave count', kind: 'slider', min: 0, max: 12, step: 1, default: 2, group: 'Wave' },
  { key: 'waveSpeed', label: 'Wave speed', kind: 'slider', min: 0, max: 8, step: 1, default: 0, group: 'Wave' },
  { key: 'waveSlope', label: 'Wave slope', kind: 'slider', min: 0.2, max: 3.14, step: 0.1, default: 1, group: 'Wave' },
  // Motion.
  { key: 'spinSpeed', label: 'Spin speed', kind: 'slider', min: -4, max: 4, step: 0.25, default: 0, group: 'Motion' },
  // Transform.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  // Palette (cycled per ribbon, like STG's colour checkboxes).
  // Per-segment fills (solid/gradient/grid/noise) cycled around the spiral + per-fill text colour.
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(4, 'coil'), group: 'Color' },
  { key: 'shadows', label: 'Shadows', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Shadow' },
  { key: 'shadowStrength', label: 'Shadow strength', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, group: 'Shadow' },
  { key: 'shadowSoftness', label: 'Shadow softness', kind: 'slider', min: 0, max: 40, step: 0.5, default: 10, group: 'Shadow' },
  { key: 'lightAngleX', label: 'Light angle X', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.6, group: 'Shadow' },
  { key: 'lightAngleY', label: 'Light angle Y', kind: 'slider', min: -1.5, max: 1.5, step: 0.05, default: 0.5, group: 'Shadow' },
]

const CAP_SEGS = 14   // arc resolution of a spiral-end round cap
const Z_EPS = 0.004   // tiny per-u depth layering so waved turns that cross don't z-fight

function n(p: Params, k: string): number { return Number(p[k]) }

interface CoilState {
  group: THREE.Group
  geo: THREE.BufferGeometry
  baseX: Float64Array
  baseY: Float64Array
  echo: Float64Array
  half: number
  waveSize: number
  waveCount: number
  waveSlope: number
  waveTurns: number
  positions: Float32Array
  sampleCount: number
  roundCaps: boolean
  innerCapOff: number   // -1 when flat
  outerCapOff: number
  uArr: Float64Array    // segment-space u per sample (drives the z-layering)
  ribbonCount: number
}

/** Semicircular end-cap fan: center at (cx,cy), bulging along `outward`·tangent. */
function writeCap(
  pos: Float32Array, off: number, cx: number, cy: number,
  tx: number, ty: number, outward: number, half: number, z: number,
): void {
  const len = Math.hypot(tx, ty) || 1
  const ux = tx / len, uy = ty / len
  const nx = -uy, ny = ux
  const ox = ux * outward, oy = uy * outward
  pos[off * 3] = cx; pos[off * 3 + 1] = cy; pos[off * 3 + 2] = z
  for (let k = 0; k <= CAP_SEGS; k++) {
    const phi = (k / CAP_SEGS) * Math.PI
    const dx = Math.cos(phi) * nx + Math.sin(phi) * ox
    const dy = Math.cos(phi) * ny + Math.sin(phi) * oy
    const v = off + 1 + k
    pos[v * 3] = cx + dx * half
    pos[v * 3 + 1] = cy + dy * half
    pos[v * 3 + 2] = z
  }
}

let coilState: CoilState | null = null

/** Trailing-gap fraction of the baked label tile, used to centre the word. */
function gapFraction(params: Params): number {
  try {
    const family = resolveFontFamily(String(params.font))
    const weight = fontHasWeightAxis(family) ? Number(params.typeWeight ?? 700) : 400
    const fontPx = Number(params.typeYScale ?? params.typeHeight ?? 180)
    const tracking = Number(params.tracking) || 0
    // params.text may hold several newline-separated texts; measure the longest single
    // one (newlines would make measureText unreliable and mis-size the gap).
    const lines = String(params.text ?? '').split('\n').map(t => t.trim()).filter(Boolean)
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), lines[0] ?? '')
    const label = `${longest.toUpperCase()}   `  // mirrors buildRibbonLabel
    const word = label.replace(/\s+$/, '')
    if (!word) return 0.4
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return 0.3
    ctx.font = `${weight} ${fontPx}px "${family}", sans-serif`
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${tracking}px`
    const lw = ctx.measureText(label).width
    const ww = ctx.measureText(word).width
    if (lw <= 0) return 0
    return Math.max(0, Math.min(0.95, (lw - ww) / lw))
  } catch { return 0.3 }
}

/** Recompute the continuous swept-band positions at a wave phase. */
function rebuildPositions(s: CoilState, phase: number): void {
  const count = s.baseX.length
  const wx = new Float64Array(count)
  const wy = new Float64Array(count)
  for (let j = 0; j < count; j++) {
    let x = s.baseX[j]!
    let y = s.baseY[j]!
    if (s.waveSize && s.waveCount) {
      const e = s.echo[j]!
      const w = shapedSin(Math.sin(phase + e * s.waveCount), s.waveSlope) * s.waveSize
      x += w * Math.cos(e)
      y += w * Math.sin(e)
    }
    wx[j] = x; wy[j] = y
  }
  const pos = s.positions
  let t0x = 1, t0y = 0, tLx = 1, tLy = 0
  for (let j = 0; j < count; j++) {
    const jp = Math.min(count - 1, j + 1)
    const jm = Math.max(0, j - 1)
    let tx = wx[jp]! - wx[jm]!
    let ty = wy[jp]! - wy[jm]!
    const len = Math.hypot(tx, ty) || 1
    tx /= len; ty /= len
    const ax = -ty * s.half
    const ay = tx * s.half
    // Layer the band in z by its u-position so waved turns that cross resolve by depth
    // (painter's order, like STG's 2D draw order) instead of z-fighting at z=0.
    const z = s.uArr[j]! * Z_EPS
    const a = j * 2, b = j * 2 + 1
    pos[a * 3] = wx[j]! + ax; pos[a * 3 + 1] = wy[j]! + ay; pos[a * 3 + 2] = z
    pos[b * 3] = wx[j]! - ax; pos[b * 3 + 1] = wy[j]! - ay; pos[b * 3 + 2] = z
    if (j === 0) { t0x = tx; t0y = ty }
    if (j === count - 1) { tLx = tx; tLy = ty }
  }
  // Round caps on the two SPIRAL ENDS only (continuous band ⇒ no per-segment caps).
  if (s.roundCaps) {
    writeCap(pos, s.innerCapOff, wx[0]!, wy[0]!, t0x, t0y, -1, s.half, s.uArr[0]! * Z_EPS)
    writeCap(pos, s.outerCapOff, wx[count - 1]!, wy[count - 1]!, tLx, tLy, 1, s.half, s.uArr[count - 1]! * Z_EPS)
  }
  ;(s.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
}

function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  params: Params,
  fills: Fill[],
  fillAtlas: THREE.Texture,
  gap: number,
  numTexts: number,
  wordFracs: number[],
): THREE.MeshLambertMaterial {
  const mat = new three.MeshLambertMaterial({ map, side: three.DoubleSide })
  const uNumTexts = { value: Math.max(1, Math.round(numTexts)) }
  // Each text's width fraction (its atlas-row word width ÷ widest), so the shader samples
  // exactly the word in row `variant`. Padded to 5; last value fills the unused slots.
  const uWordFrac = { value: Array.from({ length: 5 }, (_, i) => wordFracs[Math.min(i, wordFracs.length - 1)] ?? 1) }
  // Ribbon = the fill atlas (one band per fill, sampled per segment). Text = each fill's flat
  // text colour (padded to 5). Both indexed by segment slot.
  const paletteCount = Math.max(1, fills.length)
  const uFillAtlas = { value: fillAtlas }
  const uFillAnchor = { value: fillAnchor(fills[0]!) }
  const uFillScreen = { value: fillScreenVec(three) }
  const uTextColors = { value: Array.from({ length: 5 }, (_, i) => {
    const c = fillTextColor(three, fills[Math.min(i, fills.length - 1)]!)
    return new three.Vector3(c.r, c.g, c.b)
  }) }
  const uPaletteCount = { value: paletteCount }
  const uRoundCaps = { value: String(params.caps) !== 'flat' ? 1 : 0 }
  const uGap = { value: gap }
  const uTextLead = { value: Math.max(0, n(params, 'textLead')) }
  const uTextTrail = { value: Math.max(0, n(params, 'textTrail')) }
  const uNoStripes = { value: String(params.noStripes) === 'on' ? 1 : 0 }
  const uShadowStrength = { value: String(params.shadows) === 'on' ? n(params, 'shadowStrength') : 0 }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFillAtlas = uFillAtlas
    shader.uniforms.uFillAnchor = uFillAnchor
    shader.uniforms.uFillScreen = uFillScreen
    shader.uniforms.uTextColors = uTextColors
    shader.uniforms.uPaletteCount = uPaletteCount
    shader.uniforms.uNumTexts = uNumTexts
    shader.uniforms.uWordFrac = uWordFrac
    shader.uniforms.uRoundCaps = uRoundCaps
    shader.uniforms.uGap = uGap
    shader.uniforms.uTextLead = uTextLead
    shader.uniforms.uTextTrail = uTextTrail
    shader.uniforms.uNoStripes = uNoStripes
    shader.uniforms.uShadowStrength = uShadowStrength
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHalfU;\nvarying float vHalfU;\nvarying float vU;\nvarying float vV;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvHalfU = aHalfU;\nvU = uv.x;\nvV = uv.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform sampler2D uFillAtlas;',
        'uniform float uFillAnchor; uniform vec2 uFillScreen;',   // 0=object(glyph UV) 1=frame(screen space)
        'uniform vec3 uTextColors[5];',
        'uniform float uPaletteCount;',
        'uniform float uNumTexts;',
        'uniform float uWordFrac[5];',
        'uniform float uRoundCaps;',
        'uniform float uGap;',
        'uniform float uTextLead;',
        'uniform float uTextTrail;',
        'uniform float uNoStripes;',
        'uniform float uShadowStrength;',
        'varying float vHalfU; varying float vU; varying float vV;',
        'vec3 coilText(float idx){ vec3 c = uTextColors[0]; for(int k=0;k<5;k++){ if(float(k)==idx) c = uTextColors[k]; } return c; }',
        'float coilPickF(float idx){ float v = uWordFrac[0]; for(int k=0;k<5;k++){ if(float(k)==idx) v = uWordFrac[k]; } return v; }',
      ].join('\n'))
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
      .replace('#include <map_fragment>', [
        // Segment index with a SEMICIRCULAR (round-cap) boundary across the band.
        'float across = vV * 2.0 - 1.0;',
        'float bulge = uRoundCaps > 0.5 ? vHalfU * sqrt(max(0.0, 1.0 - across * across)) : 0.0;',
        'float segf = floor(vU + bulge);',
        // Ribbon fill = sample this segment's atlas band (slot + localV)/count; localU tiles
        // the band along the segment. Text colour = this segment's flat fill text colour.
        'float coilSlot = mod(segf, uPaletteCount);',
        'vec2 fillUv = uFillAnchor > 0.5 ? gl_FragCoord.xy / uFillScreen : vec2(fract(vU), vV);',
        'vec3 ribbonCol = texture2D(uFillAtlas, vec2(fillUv.x, (coilSlot + fillUv.y) / uPaletteCount)).rgb;',
        'vec3 textCol = coilText(mod(segf, uPaletteCount));',
        // The rounded fill boundary shifts each colour BLOCK back by the cap bulge. Inset
        // the word by uTextLead on the leading side and uTextTrail + 2·vHalfU on the
        // trailing side; equal lead/trail ⇒ word centred in its colour block, unequal ⇒
        // word pushed toward a cap. vHalfU is constant across the band width ⇒ no shear.
        'float bulgeMax = (uRoundCaps > 0.5 ? vHalfU : 0.0);',
        'float wordSpan = max(0.05, 1.0 - uTextLead - uTextTrail - 2.0 * bulgeMax);',
        'float tt = (fract(vU) - uTextLead) / wordSpan;',    // 0..1 across the word region
        'float variant = mod(floor(vU), uNumTexts);',
        'float atlasV = (variant + vV) / uNumTexts;',
        // Word occupies [0, wordFrac] of its atlas row (raw word, no trailing pad). The word
        // FILLS the band height; aspect is kept by sizing the segment ARC to the band (CPU `L`).
        'float wfrac = coilPickF(variant);',
        'float glyph = 0.0;',
        'if (tt >= 0.0 && tt <= 1.0) { glyph = texture2D(map, vec2(tt * wfrac, atlasV)).a; }',
        'if (uNoStripes > 0.5) {',
        '  if (glyph < 0.03) discard;',
        '  diffuseColor = vec4(textCol, 1.0);',
        '} else {',
        '  diffuseColor = vec4(mix(ribbonCol, textCol, glyph), 1.0);',
        '}',
      ].join('\n'))
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( diffuseColor.rgb * mix(1.0 - uShadowStrength, 1.0, getShadowMask()), 1.0 );')
  }
  return mat
}

export const coilEffect: SpaceTypeEffect = {
  id: 'coil',
  label: 'Coil',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    coilState = null

    const ribbonCount = Math.max(1, Math.floor(n(params, 'ribbonCount')))
    const radius = n(params, 'radius')
    const spacing = Math.max(0.001, n(params, 'spacing'))
    const iStart = Math.max(0, n(params, 'spiralStart'))
    const half = n(params, 'bandSize') / 2
    const gap = gapFraction(params)

    // L = index span of ONE word (sets spiral extent). params.text may now hold several
    // newline-separated texts (one per segment) — use the LONGEST single text, not the
    // joined string, or the spiral balloons by the combined length.
    const texts = String(params.text ?? '').split('\n').map(t => t.trim()).filter(Boolean)
    const maxLen = texts.reduce((m, t) => Math.max(m, t.length), 1)
    // Index span per word = arc allocated to each segment. Scale it with BAND THICKNESS so a
    // thicker ribbon gets proportionally longer segments → the text fills the band at a constant
    // aspect (bigger ribbon = bigger readable text, never compressed). radius/spacing cancel out
    // of the aspect (they only set the spiral's overall size). Clamped so extreme sizes don't
    // explode the spiral.
    const L = Math.max(maxLen + 1, Math.min(28, Math.round(1.7 * maxLen * half * 2 / (radius * spacing))))
    const iEnd = iStart + ribbonCount * L

    // θ-uniform sampling: even angular resolution (index-uniform undersamples the core).
    const thetaStart = Math.sqrt(spacing * iStart)
    const thetaEnd = Math.sqrt(spacing * iEnd)
    const sweep = Math.max(0.001, thetaEnd - thetaStart)
    const segments = Math.min(12000, Math.max(256, Math.round(sweep / 0.012)))
    const sampleCount = segments + 1

    const baseX = new Float64Array(sampleCount)
    const baseY = new Float64Array(sampleCount)
    const echo = new Float64Array(sampleCount)
    const arcCum = new Float64Array(sampleCount)   // cumulative arc length along the spiral

    for (let j = 0; j < sampleCount; j++) {
      const theta = thetaStart + (j / segments) * sweep
      const r = radius * theta
      const x = -r * Math.cos(theta)
      const y = -r * Math.sin(theta)
      baseX[j] = x; baseY[j] = y
      echo[j] = Math.atan2(y, x)
      if (j > 0) arcCum[j] = arcCum[j - 1]! + Math.hypot(x - baseX[j - 1]!, y - baseY[j - 1]!)
    }

    const totalArc = arcCum[sampleCount - 1]! || 1

    // Multi-text + per-text width fractions, so each segment can be ARC-SIZED to its text
    // (longer texts get longer segments). u still steps 1 per segment (integer boundaries),
    // but the arc↔u mapping is piecewise: segment seg spans arc ∝ wordFracs[seg%numTexts].
    const numTexts = Math.max(1, Math.floor(Number(textTexture.userData?.numTexts ?? 1)))
    const wfRaw = (textTexture.userData?.wordFracs as number[] | undefined) ?? [1]
    const wordFracs = Array.from({ length: numTexts }, (_, k) => Math.max(0.08, wfRaw[k] ?? 1))

    const segStart = new Float64Array(ribbonCount + 1)
    let totalWeight = 0
    for (let seg = 0; seg < ribbonCount; seg++) totalWeight += wordFracs[seg % numTexts]!
    let acc = 0
    for (let seg = 0; seg < ribbonCount; seg++) {
      segStart[seg] = acc / totalWeight
      acc += wordFracs[seg % numTexts]!
    }
    segStart[ribbonCount] = 1

    // Map each sample's arc-fraction → piecewise u + a per-segment round-cap size.
    const uArr = new Float64Array(sampleCount)
    const halfUArr = new Float64Array(sampleCount)
    {
      let seg = 0
      for (let j = 0; j < sampleCount; j++) {
        const arcFrac = arcCum[j]! / totalArc
        while (seg < ribbonCount - 1 && arcFrac >= segStart[seg + 1]!) seg++
        const segFrac = Math.max(1e-6, segStart[seg + 1]! - segStart[seg]!)
        uArr[j] = seg + (arcFrac - segStart[seg]!) / segFrac
        halfUArr[j] = Math.min(0.5, half / Math.max(1e-4, totalArc * segFrac))
      }
    }

    // Per-segment fills (capped at 5 → the shader's palette-array size).
    const fills = parseFills(params.fills).slice(0, 5)
    const fillAtlas = fillAtlasTexture(three, fills)

    // Round caps live on the two SPIRAL ENDS only; the band itself is continuous.
    const roundCaps = String(params.caps) !== 'flat'
    const stripVerts = sampleCount * 2
    const capVerts = roundCaps ? (CAP_SEGS + 2) : 0
    const totalVerts = stripVerts + 2 * capVerts
    const innerCapOff = roundCaps ? stripVerts : -1
    const outerCapOff = roundCaps ? stripVerts + capVerts : -1

    const positions = new Float32Array(totalVerts * 3)
    const uvs = new Float32Array(totalVerts * 2)
    const halfU = new Float32Array(totalVerts)

    for (let j = 0; j < sampleCount; j++) {
      const u = uArr[j]!
      const a = j * 2, b = j * 2 + 1
      uvs[a * 2] = u; uvs[a * 2 + 1] = 1
      uvs[b * 2] = u; uvs[b * 2 + 1] = 0
      halfU[a] = halfUArr[j]!; halfU[b] = halfUArr[j]!
    }

    // Cap verts: solid end-segment colour (uv.x = segment centre), uv.y = 0 (band edge
    // ⇒ no glyph), aHalfU = 0 (no rounded-boundary bulge inside the cap).
    if (roundCaps) {
      const fillCap = (off: number, uCenter: number) => {
        for (let v = 0; v < capVerts; v++) {
          uvs[(off + v) * 2] = uCenter
          uvs[(off + v) * 2 + 1] = 0
          halfU[off + v] = 0
        }
      }
      fillCap(innerCapOff, 0.5)
      fillCap(outerCapOff, Math.max(0.5, ribbonCount - 0.5))
    }

    const stripTris = segments * 2
    const capTris = roundCaps ? 2 * CAP_SEGS : 0
    const indices = new Uint32Array((stripTris + capTris) * 3)
    let io = 0
    for (let j = 0; j < segments; j++) {
      const a = j * 2, b = j * 2 + 1, c = (j + 1) * 2, d = (j + 1) * 2 + 1
      indices[io++] = a; indices[io++] = b; indices[io++] = c
      indices[io++] = c; indices[io++] = b; indices[io++] = d
    }
    if (roundCaps) {
      for (const off of [innerCapOff, outerCapOff]) {
        for (let k = 0; k < CAP_SEGS; k++) {
          indices[io++] = off; indices[io++] = off + 1 + k; indices[io++] = off + 2 + k
        }
      }
    }

    const geo = new three.BufferGeometry()
    geo.setAttribute('position', new three.BufferAttribute(positions, 3))
    geo.setAttribute('uv', new three.BufferAttribute(uvs, 2))
    geo.setAttribute('aHalfU', new three.BufferAttribute(halfU, 1))
    geo.setIndex(new three.BufferAttribute(indices, 1))

    const tex = textTexture.clone()
    tex.needsUpdate = true
    tex.wrapS = three.RepeatWrapping

    const mat = frontMaterial(three, tex, params, fills, fillAtlas, gap, numTexts, wordFracs)
    const mesh = new three.Mesh(geo, mat)
    mesh.userData.tex = tex
    mesh.castShadow = true; mesh.receiveShadow = true

    const subGroup = new three.Group()
    subGroup.add(mesh)
    root.add(subGroup)

    const waveSpeed = Math.round(n(params, 'waveSpeed'))
    coilState = {
      group: subGroup,
      geo,
      baseX, baseY, echo,
      half,
      waveSize: n(params, 'waveSize'),
      waveCount: Math.round(n(params, 'waveCount')),
      waveSlope: n(params, 'waveSlope'),
      waveTurns: Math.max(0, waveSpeed),
      positions,
      sampleCount,
      roundCaps,
      innerCapOff,
      outerCapOff,
      uArr,
      ribbonCount,
    }
    rebuildPositions(coilState, 0)
    geo.computeVertexNormals()

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

  update(t01, params) {
    const s = coilState
    if (!s) return
    if (s.waveSize && s.waveCount && s.waveTurns > 0) {
      rebuildPositions(s, t01 * Math.PI * 2 * s.waveTurns)
    }
    const spinSpeed = Number(params.spinSpeed ?? 0)
    const spinTurns = Math.max(0, Math.round(Math.abs(spinSpeed))) * Math.sign(spinSpeed)
    s.group.rotation.z = spinTurns * t01 * Math.PI * 2
  },
}
