import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills, fillPrimary, fillTextColor } from '../fills'
import { defaultFillsFor } from '../palette'
import { stripAlpha } from '~/lib/color/convert'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
import { charDeform, TAU, type DeformParams } from '../elasticDeform'

/**
 * ELASTIC — kielm STG V.STRETCH look. Stacked condensed type where each
 * character is individually elongated (vertical/horizontal stretch + skew +
 * slant), with per-letter randomness and tight vertical packing, then a smooth
 * flowing warp (curvy ↔ polygonal) rides on top.
 *
 * Pipeline: a 2D canvas rasterises the per-character deformed text as an alpha
 * matte (re-drawn each frame from the loop time, so it animates + bakes), used
 * as a texture on a flat plane; a fragment shader warps the matte UVs and
 * composites fill vs text colour. Deformation math lives in ../elasticDeform
 * (pure, unit-tested). Flat by design; works under either camera.
 */

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'OLD\nWORLD\nNEW\nSCHOOL', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 900, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -10, max: 60, step: 1, default: 0, group: 'Type' },
  { key: 'fitWidth', label: 'Fit to width', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Type' },
  { key: 'lineTight', label: 'Line tightness', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.6, group: 'Layout' },
  { key: 'base', label: 'Stretch (static)', kind: 'slider', min: 1, max: 4, step: 0.05, default: 1, group: 'Stretch' },
  { key: 'ampV', label: 'Stretch motion', kind: 'slider', min: 0, max: 3, step: 0.05, default: 1.4, group: 'Stretch' },
  { key: 'ampH', label: 'Horizontal stretch', kind: 'slider', min: 0, max: 1.5, step: 0.02, default: 0.25, group: 'Stretch' },
  { key: 'randomness', label: 'Randomness', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.8, group: 'Stretch' },
  { key: 'speed', label: 'Speed (0 = frozen)', kind: 'slider', min: 0, max: 6, step: 1, default: 1, group: 'Stretch' },
  { key: 'baseSkew', label: 'Skew°', kind: 'slider', min: -45, max: 45, step: 1, default: 0, group: 'Skew' },
  { key: 'ampSkew', label: 'Skew motion', kind: 'slider', min: 0, max: 30, step: 1, default: 12, group: 'Skew' },
  { key: 'baseSlant', label: 'Slant°', kind: 'slider', min: -30, max: 30, step: 1, default: 0, group: 'Skew' },
  { key: 'ampSlant', label: 'Slant motion', kind: 'slider', min: 0, max: 30, step: 1, default: 8, group: 'Skew' },
  { key: 'warp', label: 'Warp amount', kind: 'slider', min: 0, max: 0.12, step: 0.005, default: 0.03, group: 'Warp' },
  { key: 'warpScale', label: 'Warp scale', kind: 'slider', min: 0.3, max: 3, step: 0.1, default: 1, group: 'Warp' },
  { key: 'polygonal', label: 'Polygonal', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0, group: 'Warp' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(1, 'elastic'), group: 'Color' },
]

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
const FRAG = [
  'precision highp float;',
  'uniform sampler2D uMatte; uniform vec3 uFillColor; uniform vec3 uTextColor;',
  'uniform float uTime, uWarp, uPoly, uWarpScale;',
  'varying vec2 vUv;',
  'float wv(float p, float poly){ float s = sin(p); float t = 0.63661977 * asin(clamp(sin(p), -1.0, 1.0)); return mix(s, t, poly); }',
  'void main(){',
  '  vec2 uv = vUv; float sc = max(0.2, uWarpScale);',
  '  float dy = uWarp * ( wv(uv.x*sc*6.2831853 + uTime, uPoly) + 0.5*wv(uv.x*sc*18.0 - uTime*0.7, uPoly) );',
  '  float dx = uWarp * 0.4 * wv(uv.y*sc*6.2831853 + uTime*0.6, uPoly);',
  '  vec2 w = uv + vec2(dx, dy);',
  '  float a = 0.0;',
  '  if (w.x>=0.0 && w.x<=1.0 && w.y>=0.0 && w.y<=1.0) a = texture2D(uMatte, w).a;',
  '  gl_FragColor = vec4(mix(uFillColor, uTextColor, a), 1.0);',
  '}',
].join('\n')

function n(p: Params, k: string): number { return Number(p[k]) }

function deformParams(p: Params): DeformParams {
  return {
    base: n(p, 'base'), ampV: n(p, 'ampV'), ampH: n(p, 'ampH'),
    baseSkew: n(p, 'baseSkew'), ampSkew: n(p, 'ampSkew'),
    baseSlant: n(p, 'baseSlant'), ampSlant: n(p, 'ampSlant'),
    randomness: n(p, 'randomness'),
  }
}

function textLines(p: Params): string[] {
  const ls = String(p.text ?? '').split('\n').map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase())
  return ls.length ? ls : [' ']
}

interface Block { chars: string[]; w: number[]; d: ReturnType<typeof charDeform>[]; lineH: number; natW: number }

/** Measure per-line glyph widths + deformation at a given font size. */
function measure(
  ctx: CanvasRenderingContext2D, fs: number, family: string, weight: number,
  ls: string[], dp: DeformParams, time: number, tracking: number, tight: number,
): { blocks: Block[]; totalH: number; maxLineW: number } {
  ctx.font = `${weight} ${fs}px "${family}", Anton, Impact, "Arial Narrow", sans-serif`
  const cap = fs * 0.72
  const gap = fs * 0.05 + fs * 0.5 * (1 - tight)
  let gi = 0
  let maxLineW = 1
  const blocks = ls.map(line => {
    const chars = [...line]
    const w = chars.map(c => ctx.measureText(c).width)
    const d = chars.map((c, i) => charDeform(gi + i, time, dp))
    gi += chars.length
    const natW = w.reduce((a, wi, i) => a + wi * d[i]!.sx + tracking, 0)
    if (natW > maxLineW) maxLineW = natW
    const maxSy = Math.max(0.01, ...d.map(x => x.sy))
    return { chars, w, d, lineH: cap * maxSy + gap, natW }
  })
  const totalH = blocks.reduce((a, b) => a + b.lineH, 0)
  return { blocks, totalH, maxLineW }
}

/** Rasterise the per-character deformed text as a white-on-transparent alpha matte. */
function drawMatte(ctx: CanvasRenderingContext2D, W: number, H: number, params: Params, time: number): void {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const ls = textLines(params)
  const family = resolveFontFamily(String(params.font))
  const weight = fontHasWeightAxis(family) ? n(params, 'typeWeight') : 400
  const dp = deformParams(params)
  const fitW = String(params.fitWidth) === 'on'
  const tight = n(params, 'lineTight')
  const tracking = n(params, 'tracking')

  // Size to fit the matte: shrink so the block fits vertically (always) and
  // horizontally (unless fit-to-width is expanding lines to fill anyway).
  let fs = (H / ls.length) * 0.42
  let m = measure(ctx, fs, family, weight, ls, dp, time, tracking, tight)
  const fit = Math.min(1, (H * 0.94) / m.totalH, fitW ? 1 : (W * 0.92) / m.maxLineW)
  if (fit < 0.999) { fs *= fit; m = measure(ctx, fs, family, weight, ls, dp, time, tracking, tight) }

  let y = (H - m.totalH) / 2
  for (const blk of m.blocks) {
    const cyc = y + blk.lineH / 2
    const advNat = blk.w.map((wi, i) => wi * blk.d[i]!.sx + tracking)
    const natTotal = advNat.reduce((a, b) => a + b, 0) || 1
    const fitScale = fitW ? (W * 0.92) / natTotal : 1
    const adv = advNat.map(a => a * fitScale)
    let x = (W - adv.reduce((a, b) => a + b, 0)) / 2
    for (let i = 0; i < blk.chars.length; i++) {
      const dd = blk.d[i]!
      ctx.save()
      ctx.translate(x + adv[i]! / 2, cyc)
      ctx.rotate(dd.slantRad)
      ctx.transform(1, 0, dd.skewTan, 1, 0, 0)
      ctx.scale(dd.sx * fitScale, dd.sy)
      ctx.fillText(blk.chars[i]!, -blk.w[i]! / 2, 0)
      ctx.restore()
      x += adv[i]!
    }
    y += blk.lineH
  }
}

interface State {
  ctx: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  uniforms: {
    uMatte: { value: THREE.Texture }
    uFillColor: { value: THREE.Color }
    uTextColor: { value: THREE.Color }
    uTime: { value: number }
    uWarp: { value: number }
    uPoly: { value: number }
    uWarpScale: { value: number }
  }
  W: number
  H: number
  lastKey: string
}

let state: State | null = null

export const elasticEffect: SpaceTypeEffect = {
  id: 'elastic',
  label: 'Elastic',
  hidden: true,
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()

    const W = 900, H = 1150
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')!
    drawMatte(ctx, W, H, params, 0)

    const tex = new three.CanvasTexture(canvas)
    tex.minFilter = three.LinearFilter
    tex.magFilter = three.LinearFilter

    const fill = parseFills(params.fills)[0]!
    const uniforms = {
      uMatte: { value: tex as THREE.Texture },
      uFillColor: { value: fillPrimary(three, fill) },
      uTextColor: { value: fillTextColor(three, fill) },
      uTime: { value: 0 },
      uWarp: { value: n(params, 'warp') },
      uPoly: { value: n(params, 'polygonal') },
      uWarpScale: { value: n(params, 'warpScale') },
    }
    const mat = new three.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: three.DoubleSide })

    const planeH = 11.6
    const planeW = planeH * (W / H)
    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), mat)
    mesh.userData.tex = tex
    root.add(mesh)

    state = { ctx, tex, uniforms, W, H, lastKey: '' }

    // Best-effort: ensure the chosen font is loaded, then re-rasterise once.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`900 40px "${family}"`).then(() => {
        if (state && state.ctx === ctx) { drawMatte(ctx, W, H, params, 0); tex.needsUpdate = true }
      }).catch(() => {})
    }

    return root
  },

  update(t01, params) {
    if (!state) return
    const cycles = Math.max(0, Math.round(n(params, 'speed')))
    const time = cycles === 0 ? 0 : t01 * cycles * TAU
    // drawMatte is a full 2D-canvas raster + GPU re-upload — skip it when the inputs are
    // unchanged (notably when frozen at cycles=0, time stays 0 and params don't move).
    const key = time + '|' + JSON.stringify(params)
    if (key !== state.lastKey) {
      drawMatte(state.ctx, state.W, state.H, params, time)
      state.tex.needsUpdate = true
      state.lastKey = key
    }
    state.uniforms.uTime.value = time
    state.uniforms.uWarp.value = n(params, 'warp')
    state.uniforms.uPoly.value = n(params, 'polygonal')
    state.uniforms.uWarpScale.value = n(params, 'warpScale')
    const fill = parseFills(params.fills)[0]!
    // .set() accepts a hex string directly — avoids allocating a throwaway THREE.Color every
    // frame just to copy its r/g/b into the existing uniform and discard it (fillPrimary/
    // fillTextColor are still used at construction time above, where a real Color is needed).
    state.uniforms.uFillColor.value.set(stripAlpha(fill.a))
    state.uniforms.uTextColor.value.set(stripAlpha(fill.textColor))
  },
}
