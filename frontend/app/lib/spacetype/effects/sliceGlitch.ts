import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills } from '../fills'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
import { mulberry32, hashSeed } from '../rng'
import {
  revealGlitch, churnSeed, bandLayout, segmentRow, scaleXForGlitch, pickTypeColor, stripOffsets,
  type TypeColorMode,
} from '../sliceGlitchLayout'
import { doodleField } from '../doodleField'

/**
 * SLICE GLITCH — kinetic color-slice poster. A heavy condensed stack
 * (clean white-on-near-black) morphs into horizontally-displaced, vibrantly
 * colored slices with hand-drawn doodles. One `glitch` driver (0..1) controls
 * width-morph, color-block opacity, strip displacement and doodle presence;
 * `revealMode` switches between an animated ramp+churn and a held still.
 *
 * Pipeline (per frame, all on 2D canvas): type matte → per-band color blocks +
 * masked type → horizontal strip displacement → doodles. The visible canvas is
 * a CanvasTexture on a flat plane; a tiny shader does the optional RGB split.
 * Layout/displacement/doodle math is pure + unit-tested (../sliceGlitchLayout,
 * ../doodleField). Flat by design; works under either camera.
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'THE\nMEANING\nOF ALL\nMOTIONS\nSHAPES &\nSOUNDS', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 400, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 20, step: 1, default: -4, group: 'Type' },
  { key: 'lineTight', label: 'Line tightness', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.85, group: 'Type' },
  { key: 'fitWidth', label: 'Stretch to width', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.92, group: 'Type' },
  // Color
  { key: 'palette', label: 'Palette', kind: 'fillList', default: JSON.stringify([
      { type: 'solid', a: '#33dd33', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#7a3cff', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#ff5ad1', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#ff5a1f', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#eaff00', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#3b5bff', b: '#000000', textColor: '#ffffff' },
    ]), group: 'Color' },
  { key: 'blockDensity', label: 'Blocks / band', kind: 'slider', min: 1, max: 8, step: 1, default: 3, group: 'Color' },
  { key: 'typeColorMode', label: 'Type color', kind: 'select', options: ['white', 'palette', 'mixed'], default: 'mixed', group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#141414', group: 'Color' },
  // Glitch
  { key: 'revealMode', label: 'Reveal mode', kind: 'select', options: ['animate', 'hold'], default: 'animate', group: 'Glitch' },
  { key: 'glitchAmount', label: 'Glitch (hold)', kind: 'slider', min: 0, max: 1, step: 0.02, default: 1, group: 'Glitch' },
  { key: 'revealFrac', label: 'Reveal length', kind: 'slider', min: 0, max: 0.9, step: 0.02, default: 0.4, group: 'Glitch' },
  { key: 'bandShift', label: 'Band shift', kind: 'slider', min: 0, max: 200, step: 2, default: 70, group: 'Glitch' },
  { key: 'tearAmount', label: 'Tear', kind: 'slider', min: 0, max: 80, step: 1, default: 22, group: 'Glitch' },
  { key: 'tearFrequency', label: 'Tear frequency', kind: 'slider', min: 1, max: 60, step: 1, default: 24, group: 'Glitch' },
  { key: 'sliceH', label: 'Slice height', kind: 'slider', min: 2, max: 40, step: 1, default: 8, group: 'Glitch' },
  { key: 'rgbSplit', label: 'RGB split', kind: 'slider', min: 0, max: 0.02, step: 0.0005, default: 0.004, group: 'Glitch' },
  { key: 'churnRate', label: 'Churn rate', kind: 'slider', min: 0, max: 24, step: 1, default: 8, group: 'Glitch' },
  // Doodles
  { key: 'doodlesOn', label: 'Doodles', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Doodles' },
  { key: 'doodleCount', label: 'Doodle count', kind: 'slider', min: 0, max: 40, step: 1, default: 16, group: 'Doodles' },
  { key: 'doodleSize', label: 'Doodle size', kind: 'slider', min: 20, max: 160, step: 2, default: 60, group: 'Doodles' },
  { key: 'doodleColorMode', label: 'Doodle color', kind: 'select', options: ['palette', 'white'], default: 'palette', group: 'Doodles' },
  { key: 'doodleWidth', label: 'Doodle stroke', kind: 'slider', min: 1, max: 12, step: 0.5, default: 3, group: 'Doodles' },
  // Motion
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 4, step: 1, default: 1, group: 'Motion' },
]

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
const FRAG = [
  'precision highp float;',
  'uniform sampler2D uTex; uniform float uSplit;',
  'varying vec2 vUv;',
  'void main(){',
  '  float r = texture2D(uTex, vUv + vec2(uSplit, 0.0)).r;',
  '  vec4 g = texture2D(uTex, vUv);',
  '  float b = texture2D(uTex, vUv - vec2(uSplit, 0.0)).b;',
  '  gl_FragColor = vec4(r, g.g, b, 1.0);',
  '}',
].join('\n')

function n(p: Params, k: string): number { return Number(p[k]) }
function paletteColors(p: Params): string[] {
  const fills = parseFills(p.palette)
  const cols = fills.map(f => f.a)
  return cols.length ? cols : ['#ffffff']
}
function textLines(p: Params): string[] {
  const ls = String(p.text ?? '').split('\n').map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase())
  return ls.length ? ls : [' ']
}

interface LineMetric { chars: string[]; widths: number[]; natW: number; fs: number }

function measure(ctx: CanvasRenderingContext2D, W: number, H: number, p: Params): { lines: LineMetric[]; fs: number } {
  const ls = textLines(p)
  const family = resolveFontFamily(String(p.font))
  const weight = fontHasWeightAxis(family) ? n(p, 'typeWeight') : 400
  const tight = n(p, 'lineTight')
  const tracking = n(p, 'tracking')
  const lineFactor = 1.06 - 0.32 * tight
  let fs = (H / ls.length) / lineFactor
  ctx.font = `${weight} ${fs}px "${family}", Anton, Impact, "Arial Narrow", sans-serif`
  const measureLine = (line: string) => {
    const chars = [...line]
    const widths = chars.map(c => ctx.measureText(c).width + tracking)
    return { chars, widths, natW: widths.reduce((a, b) => a + b, 0), fs }
  }
  let lines = ls.map(measureLine)
  const maxNat = Math.max(1, ...lines.map(l => l.natW))
  if (maxNat > W * 0.98) { fs *= (W * 0.98) / maxNat; ctx.font = `${weight} ${fs}px "${family}", Anton, Impact, "Arial Narrow", sans-serif`; lines = ls.map(measureLine) }
  return { lines, fs }
}

interface State {
  typeCtx: CanvasRenderingContext2D
  compCtx: CanvasRenderingContext2D
  outCtx: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  uniforms: { uTex: { value: THREE.Texture }; uSplit: { value: number } }
  W: number; H: number
}
let state: State | null = null

function mkCanvas(W: number, H: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  return c.getContext('2d')!
}

function draw(s: State, p: Params, glitch: number, seed: number): void {
  const { W, H } = s
  const pal = paletteColors(p)
  const bg = String(p.bgColor)

  // 1) type matte (white on transparent)
  const tctx = s.typeCtx
  tctx.clearRect(0, 0, W, H)
  tctx.fillStyle = '#ffffff'; tctx.textAlign = 'left'; tctx.textBaseline = 'middle'
  const family = resolveFontFamily(String(p.font))
  const weight = fontHasWeightAxis(family) ? n(p, 'typeWeight') : 400
  const { lines, fs } = measure(tctx, W, H, p)
  tctx.font = `${weight} ${fs}px "${family}", Anton, Impact, "Arial Narrow", sans-serif`
  const bands = bandLayout(lines.length, H)
  const targetW = W * n(p, 'fitWidth')
  const lineScale = lines.map(l => scaleXForGlitch(l.natW, targetW, glitch))
  lines.forEach((l, i) => {
    const band = bands[i]!; const sx = lineScale[i]!
    const total = l.natW * sx
    let x = (W - total) / 2
    const cy = band.y + band.h / 2
    for (let c = 0; c < l.chars.length; c++) {
      tctx.save(); tctx.translate(x + (l.widths[c]! * sx) / 2, cy); tctx.scale(sx, 1)
      tctx.fillText(l.chars[c]!, -l.widths[c]! / 2, 0); tctx.restore()
      x += l.widths[c]! * sx
    }
  })

  // 2) blocks + masked type
  const cctx = s.compCtx
  cctx.clearRect(0, 0, W, H)
  cctx.globalCompositeOperation = 'source-over'
  cctx.fillStyle = bg; cctx.fillRect(0, 0, W, H)
  cctx.save(); cctx.globalAlpha = glitch
  const blockSeedRng = mulberry32((seed >>> 0) ^ 0xc2b2ae35)
  const density = n(p, 'blockDensity')
  bands.forEach(band => {
    for (const seg of segmentRow(blockSeedRng, 0, W, density, pal.length)) {
      if (blockSeedRng() < 0.22) continue
      cctx.fillStyle = pal[seg.colorIndex]!
      cctx.fillRect(seg.x, band.y, seg.w, band.h)
    }
  })
  cctx.restore()
  const typeMode = String(p.typeColorMode) as TypeColorMode
  const typeRng = mulberry32((seed >>> 0) ^ 0x27d4eb2f)
  lines.forEach((_, i) => {
    const band = bands[i]!
    const ci = pickTypeColor(typeRng, typeMode, pal.length)
    const color = ci < 0 ? '#ffffff' : pal[ci]!
    cctx.save()
    cctx.beginPath(); cctx.rect(0, band.y, W, band.h); cctx.clip()
    cctx.globalCompositeOperation = 'source-over'
    cctx.drawImage(s.typeCtx.canvas, 0, 0)
    if (ci >= 0) {
      cctx.globalCompositeOperation = 'source-atop'
      cctx.fillStyle = color
      cctx.fillRect(0, band.y, W, band.h)
    }
    cctx.restore()
  })

  // 3) strip displacement → outCtx
  const octx = s.outCtx
  octx.clearRect(0, 0, W, H)
  octx.globalCompositeOperation = 'source-over'
  octx.fillStyle = bg; octx.fillRect(0, 0, W, H)
  const sliceH = n(p, 'sliceH')
  const offs = stripOffsets({ height: H, sliceH, glitch, seed, bandShift: n(p, 'bandShift'), tearAmount: n(p, 'tearAmount'), tearFrequency: n(p, 'tearFrequency') })
  for (let i = 0; i < offs.length; i++) {
    const sy = i * sliceH; const h = Math.min(sliceH, H - sy)
    if (h <= 0) break
    octx.drawImage(s.compCtx.canvas, 0, sy, W, h, offs[i]!, sy, W, h)
  }

  // 4) doodles
  if (String(p.doodlesOn) === 'on') {
    const dRng = mulberry32((seed >>> 0) ^ 0x165667b1)
    const size = n(p, 'doodleSize')
    const field = doodleField(dRng, n(p, 'doodleCount'), W, H, [size * 0.6, size * 1.4])
    octx.lineCap = 'round'; octx.lineJoin = 'round'; octx.lineWidth = n(p, 'doodleWidth')
    const dmode = String(p.doodleColorMode)
    for (const d of field) {
      if (glitch < d.appearAt) continue
      octx.strokeStyle = dmode === 'white' ? '#ffffff' : pal[d.colorIndex % pal.length]!
      octx.save(); octx.translate(d.x, d.y); octx.rotate(d.rotation); octx.scale(d.scale, d.scale)
      octx.beginPath()
      d.points.forEach((pt, k) => { if (k === 0) octx.moveTo(pt.x, pt.y); else octx.lineTo(pt.x, pt.y) })
      octx.restore()
      octx.stroke()
    }
  }

  s.tex.needsUpdate = true
  s.uniforms.uSplit.value = n(p, 'rgbSplit') * glitch
}

export const sliceGlitchEffect: SpaceTypeEffect = {
  id: 'sliceglitch',
  label: 'Slice Glitch',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()
    const W = 900, H = 1150
    const typeCtx = mkCanvas(W, H)
    const compCtx = mkCanvas(W, H)
    const outCtx = mkCanvas(W, H)

    const tex = new three.CanvasTexture(outCtx.canvas)
    tex.minFilter = three.LinearFilter; tex.magFilter = three.LinearFilter
    const uniforms = { uTex: { value: tex as THREE.Texture }, uSplit: { value: 0 } }
    const mat = new three.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: three.DoubleSide })

    const planeH = 11.6, planeW = planeH * (W / H)
    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), mat)
    mesh.userData.tex = tex
    root.add(mesh)

    state = { typeCtx, compCtx, outCtx, tex, uniforms, W, H }
    draw(state, params, 0, hashSeed(textLines(params).join('|')))

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`400 40px "${family}"`).then(() => {
        if (state && state.outCtx === outCtx) draw(state, params, currentGlitch(params, 0), currentSeed(params, 0))
      }).catch(() => {})
    }
    return root
  },

  update(t01, params) {
    if (!state) return
    draw(state, params, currentGlitch(params, t01), currentSeed(params, t01))
  },
}

function currentGlitch(p: Params, t01: number): number {
  if (String(p.revealMode) === 'hold') return n(p, 'glitchAmount')
  const cycles = Math.max(1, Math.round(n(p, 'speed')) || 1)
  const tt = (t01 * cycles) % 1
  return revealGlitch(tt, n(p, 'revealFrac'))
}

function currentSeed(p: Params, t01: number): number {
  const base = hashSeed(textLines(p).join('|'))
  if (String(p.revealMode) === 'hold') return base
  return churnSeed(t01, n(p, 'churnRate'), base)
}
