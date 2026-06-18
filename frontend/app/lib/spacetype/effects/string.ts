import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect, BuildEnv } from '../effect'
import { parsePath, forwardHandle, backHandle, type PathPoint } from '../stringPath'
import { sampleString, buildStrip, stripSpeedFactor, type WorldPoint } from '../stringGeometry'
import { loopTiles } from '../ribbonGeometry'
import { makeTextTile, makeGradient1Tile, makeGradient2Tile, makeStripesTile, type Tile, type TextureMode } from '../stringTextures'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'

/**
 * STRING — STG /string port. Text becomes flowing ribbons that follow hand-drawn
 * bézier paths (the `path` control = the StringPathEditor overlay). Each ribbon is
 * swept along the curve, sliced into 1–6 strips, and each strip wrapped with a
 * repeating, scrolling texture (text / two gradients / stripes / mixtures).
 *
 * Flat + front-locked: no scene rotate/scale/pan (the surface forces ortho for this
 * effect). Geometry math lives in ../stringGeometry (pure, unit-tested); the path
 * model in ../stringPath; the tiles in ../stringTextures.
 */

const TEXTURE_MODES = ['Text', 'Gradient 1', 'Gradient 2', 'Stripes', 'Mixture per strip', 'Mixture per string'] as const
// STG mixture cycling order (sketch_string.js:263–292): text, grad1(pgGH), stripes, grad2(pgG).
const MIX_ORDER: TextureMode[] = ['text', 'grad1', 'stripes', 'grad2']

const controls: ControlSpec[] = [
  { key: 'path', label: 'Path', kind: 'path', default: '', group: 'Path' },
  { key: 'text', label: 'Text', kind: 'textList', default: 'SPACE TYPE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'typeSize', label: 'Type size', kind: 'slider', min: 30, max: 140, step: 2, default: 70, group: 'Type' },
  { key: 'stripHeight', label: 'Strip height', kind: 'slider', min: 0.4, max: 5, step: 0.05, default: 1.6, group: 'Ribbon' },
  { key: 'stripCount', label: 'Strip count', kind: 'slider', min: 1, max: 6, step: 1, default: 1, group: 'Ribbon' },
  { key: 'textureMode', label: 'Texture', kind: 'select', options: [...TEXTURE_MODES], default: 'Gradient 2', group: 'Ribbon' },
  { key: 'roundCap', label: 'Round caps', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  { key: 'outline', label: 'Outlines', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  { key: 'speed', label: 'Scroll speed', kind: 'slider', min: 0, max: 8, step: 0.5, default: 2, group: 'Motion' },
  { key: 'speedVary', label: 'Speed variation', kind: 'slider', min: 0, max: 1, step: 0.05, default: 0.3, group: 'Motion' },
  { key: 'fore', label: 'Foreground', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'g1', label: 'Knot 1', kind: 'color', default: '#2955d9', group: 'Color' },
  { key: 'g2', label: 'Knot 2', kind: 'color', default: '#2793f2', group: 'Color' },
  { key: 'g3', label: 'Knot 3', kind: 'color', default: '#f2c12e', group: 'Color' },
  { key: 'g4', label: 'Knot 4', kind: 'color', default: '#f23e2e', group: 'Color' },
  { key: 'g5', label: 'Knot 5', kind: 'color', default: '#0d0d0d', group: 'Color' },
]

function n(p: Params, k: string): number { return Number(p[k]) }
function s(p: Params, k: string): string { return String(p[k]) }

// World half-extents the engine's camera frames (engine.ts ORTHO_HALF_H = tan(22.5°)·14).
const H0 = Math.tan((45 / 2) * Math.PI / 180) * 14

interface StripEntry { tex: THREE.Texture; stripIndex: number }
let entries: StripEntry[] = []

function textLines(p: Params): string[] {
  const ls = s(p, 'text').split('\n').map(t => t.trim()).filter(Boolean).map(t => t.toUpperCase())
  return ls.length ? ls : [' ']
}

function resolveMode(mode: string, stringIdx: number, stripIdx: number): TextureMode {
  switch (mode) {
    case 'Text': return 'text'
    case 'Gradient 1': return 'grad1'
    case 'Gradient 2': return 'grad2'
    case 'Stripes': return 'stripes'
    case 'Mixture per strip': return MIX_ORDER[stripIdx % MIX_ORDER.length]!
    case 'Mixture per string': return MIX_ORDER[stringIdx % MIX_ORDER.length]!
    default: return 'grad2'
  }
}

export const stringEffect: SpaceTypeEffect = {
  id: 'string',
  label: 'String',
  controls,

  buildScene(three, params, _textTexture, env?: BuildEnv) {
    void _textTexture
    entries = []
    const root = new three.Group()

    const aspect = env ? env.width / env.height : 16 / 9
    const halfW = H0 * aspect
    const halfH = H0
    // Normalized [0,1] (screen, y down) → world (y up). Handles map as positions too.
    const mapXY = (x: number, y: number) => ({ x: (x - 0.5) * 2 * halfW, y: (0.5 - y) * 2 * halfH })

    const doc = parsePath(params.path)
    const texts = textLines(params)
    const family = resolveFontFamily(s(params, 'font'))
    const weight = fontHasWeightAxis(family) ? n(params, 'typeWeight') : 400
    const fontSizePx = n(params, 'typeSize')
    const fore = s(params, 'fore')
    const knots = ['g1', 'g2', 'g3', 'g4', 'g5'].map(k => s(params, k))
    const outline = s(params, 'outline') === 'on'
    const roundCap = s(params, 'roundCap') === 'on'
    const count = Math.max(1, Math.floor(n(params, 'stripCount')))
    const stripHeight = n(params, 'stripHeight')
    const mode = s(params, 'textureMode')

    const buildTile = (m: TextureMode, text: string): Tile => {
      switch (m) {
        case 'text': return makeTextTile({ text, fontFamily: family, fontWeight: weight, fore, bg: knots[0]!, fontSizePx, outline })
        case 'grad1': return makeGradient1Tile(knots, outline)
        case 'stripes': return makeStripesTile(fore, knots[0]!, outline)
        case 'grad2':
        default: return makeGradient2Tile(knots, outline)
      }
    }

    doc.strings.forEach((str, sIdx) => {
      const worldPts: WorldPoint[] = str.points.map((p: PathPoint) => {
        const pos = mapXY(p.x, p.y)
        const f = forwardHandle(p); const b = backHandle(p)
        const fw = mapXY(f.x, f.y); const bw = mapXY(b.x, b.y)
        return { x: pos.x, y: pos.y, fhx: fw.x, fhy: fw.y, bhx: bw.x, bhy: bw.y }
      })
      const samples = sampleString(worldPts, 70)
      if (samples.length < 2) return
      const text = texts[sIdx % texts.length]!

      for (let m = 0; m < count; m++) {
        const tm = resolveMode(mode, sIdx, m)
        const tile = buildTile(tm, text)
        const geo = buildStrip(samples, { index: m, count, stripHeight, texAspect: tile.aspect, roundCap })
        if (geo.indices.length === 0) { tile.texture.dispose(); continue }

        const bufferGeo = new three.BufferGeometry()
        bufferGeo.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
        bufferGeo.setAttribute('uv', new three.BufferAttribute(geo.uvs, 2))
        bufferGeo.setIndex(new three.BufferAttribute(geo.indices, 1))

        const mat = new three.MeshBasicMaterial({ map: tile.texture, side: three.DoubleSide })
        const mesh = new three.Mesh(bufferGeo, mat)
        mesh.userData.tex = tile.texture // freed by engine disposeRoot()
        root.add(mesh)
        entries.push({ tex: tile.texture, stripIndex: m })
      }
    })

    return root
  },

  update(t01, params) {
    const speed = n(params, 'speed')
    const vary = n(params, 'speedVary')
    for (const e of entries) {
      // Integer tiles/loop per strip ⇒ seamless; speedVary spreads strips deterministically.
      const k = loopTiles(speed * stripSpeedFactor(e.stripIndex, vary), 1)
      e.tex.offset.x = -t01 * k
    }
  },
}
