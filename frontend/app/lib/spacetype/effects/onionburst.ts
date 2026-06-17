import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { layoutChars } from '../charLayout'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
import { parseFills, fillShaderTexture, fillTiling, hexBytes, type Fill } from '../fills'

/**
 * ONIONBURST — source-inspired by spacetypegenerator.com/onionburst. Each CHARACTER is mapped
 * onto its OWN cylinder: the glyph rides a front ARC of the tube's curved surface, the rest of the
 * tube is a coloured FILL, and each end is a concentric-ring "onion" cap. Each tube spins about its
 * (horizontal) axis with INTEGER, per-character-different cycles per loop — so the row reads the
 * word when aligned (loop ends) and scatters into a tumbling field of coloured tubes between.
 *
 * Colour cycles a fills list per character ([[fills]]): the fill paints the tube + onion caps; the
 * fill's text colour paints the glyph.
 */

const CHAR_SIZE = 1.3                 // world letter height
const DEFAULT_FILLS = '[{"type":"solid","a":"#f25c9c","b":"#ffd23b","textColor":"#ffffff"},{"type":"grid","a":"#ffd23b","b":"#f25c9c","textColor":"#101014"},{"type":"gradient","a":"#ff5a1f","b":"#ffd23b","textColor":"#ffffff"},{"type":"solid","a":"#3b5bff","b":"#ffffff","textColor":"#ffffff"},{"type":"noise","a":"#101014","b":"#ffffff","textColor":"#ff5a1f"}]'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'ALL IN\nTILL\nTHE\nEND', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 800, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -0.3, max: 1.5, step: 0.02, default: 0.15, group: 'Type' },
  { key: 'rowSpacing', label: 'Row spacing', kind: 'slider', min: 1, max: 4, step: 0.05, default: 2, group: 'Ribbon' },
  { key: 'arc', label: 'Wrap arc', kind: 'slider', min: 1, max: 3.14, step: 0.02, default: 2.2, group: 'Ribbon' },
  { key: 'radius', label: 'Radius', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Ribbon' },
  // Hollow = see-through tube (only the glyph renders; the fill wall is transparent).
  { key: 'hollow', label: 'Hollow', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  // Roll = manual base rotation about each tube's axis (turn the letter to face front when static).
  { key: 'roll', label: 'Roll', kind: 'slider', min: -3.14, max: 3.14, step: 0.02, default: 0, group: 'Motion' },
  { key: 'rollRandom', label: 'Roll random', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Motion' },
  { key: 'spin', label: 'Spin', kind: 'slider', min: 0, max: 6, step: 1, default: 1, group: 'Motion' },
  { key: 'scatter', label: 'Scatter', kind: 'slider', min: 0, max: 4, step: 1, default: 2, group: 'Motion' },
  // Tumble = per-cylinder random multi-axis rotation, grown-in/held/retracted over the loop
  // (same envelope as Extrude). 0 = off.
  { key: 'tumble', label: 'Tumble', kind: 'slider', min: 0, max: 2, step: 0.05, default: 0, group: 'Motion' },
  // animate = grow-in/hold/retract over the loop; static = held at full tumble (no motion).
  { key: 'tumbleMotion', label: 'Tumble motion', kind: 'select', options: ['animate', 'static'], default: 'animate', group: 'Motion' },
  { key: 'holdFraction', label: 'Hold fraction', kind: 'slider', min: 0, max: 0.9, step: 0.05, default: 0.35, group: 'Motion' },
  // Scatter each cylinder's position + vary its size randomly (0 = neat grid, uniform size).
  { key: 'posOffset', label: 'Position offset', kind: 'slider', min: 0, max: 5, step: 0.1, default: 0, group: 'Ribbon' },
  { key: 'sizeVary', label: 'Size variation', kind: 'slider', min: 0, max: 0.9, step: 0.02, default: 0, group: 'Ribbon' },
  { key: 'fills', label: 'Fills', kind: 'fillList', default: DEFAULT_FILLS, group: 'Color' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 0.9, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0.2, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0.6, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

function n(p: Params, k: string): number { return Number(p[k]) }
function hash01(i: number): number { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s) }
function easeInOutExpo(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2
}

// Concentric-ring "onion" cap from a fill's colours.
const _onionCache = new Map<string, THREE.Texture>()
function onionTexture(three: typeof THREE, fill: Fill): THREE.Texture {
  const key = `${fill.a}|${fill.b}|${fill.textColor}`
  const hit = _onionCache.get(key); if (hit) return hit
  const cols = [hexBytes(fill.a), hexBytes(fill.b), hexBytes(fill.textColor)]
  const N = 160, c = document.createElement('canvas'); c.width = c.height = N
  const ctx = c.getContext('2d')!
  const rings = 7
  for (let r = rings; r >= 1; r--) {
    const col = cols[r % cols.length]!
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`
    ctx.beginPath(); ctx.arc(N / 2, N / 2, (r / rings) * (N / 2), 0, Math.PI * 2); ctx.fill()
  }
  const t = new three.CanvasTexture(c)
  t.colorSpace = three.SRGBColorSpace
  _onionCache.set(key, t)
  return t
}

interface Cyl { mesh: THREE.Object3D; cycles: number; rx: number; ry: number; rz: number; rollRand: number }
let cylinders: Cyl[] = []

export const onionburstEffect: SpaceTypeEffect = {
  id: 'onionburst',          // internal id kept as 'onionburst' so saved nodes still resolve
  label: 'Rings',
  controls,

  // Builds its own per-glyph atlas via layoutChars; the shared texture is ignored.
  buildScene(three, params, _textTexture) {
    void _textTexture
    const root = new three.Group()
    cylinders = []

    const family = resolveFontFamily(String(params.font))
    const lines = String(params.text ?? '').split('\n').map(t => t.trim()).filter(Boolean)
    const usable = lines.length ? lines : [' ']
    const tracking = n(params, 'tracking')
    const rowSpacing = n(params, 'rowSpacing')
    const arc = Math.max(0.5, n(params, 'arc'))
    const radius = n(params, 'radius')
    const scatter = Math.max(0, Math.floor(n(params, 'scatter')))
    const hollow = String(params.hollow) === 'on'
    const posOffset = n(params, 'posOffset')
    const sizeVary = n(params, 'sizeVary')
    const fills = parseFills(params.fills)

    const centerLine = (usable.length - 1) / 2
    let globalIdx = 0

    usable.forEach((line, p) => {
      const layout = layoutChars({
        text: line, fontFamily: family,
        fontWeight: fontHasWeightAxis(family) ? n(params, 'typeWeight') : 400,
        fontSizePx: 200, tracking: 0, scaleX: 1,
        color: '#ffffff', strokeColor: '#ffffff', strokeWidth: 0,
      })
      const widths = layout.glyphs.map(g => CHAR_SIZE * g.aspect)
      const rowW = widths.reduce((a, w) => a + w, 0) + tracking * Math.max(0, layout.glyphs.length - 1)
      let cursor = -rowW / 2
      const y = (centerLine - p) * rowSpacing

      for (let gi = 0; gi < layout.glyphs.length; gi++) {
        const g = layout.glyphs[gi]!
        const len = widths[gi]!
        const fill = fills[globalIdx % fills.length]!
        const fillTex = fillShaderTexture(three, fill)
        const grp = new three.Group()

        // ── Tube: glyph on the front arc, fill colour everywhere else. ──
        const geo = new three.CylinderGeometry(radius, radius, len, 64, 1, true)
        geo.rotateZ(Math.PI / 2)
        const mat = new three.ShaderMaterial({
          side: three.DoubleSide,
          uniforms: {
            uAtlas: { value: layout.texture },
            uFillTex: { value: fillTex }, uFillTiling: { value: fillTiling(fill) },
            uU0: { value: g.u0 }, uU1: { value: g.u1 },
            uArc: { value: arc }, uLen: { value: len },
            uText: { value: new three.Color(fill.textColor) },
          },
          vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: [
            'precision highp float;',
            'varying vec3 vPos;',
            'uniform sampler2D uAtlas; uniform sampler2D uFillTex; uniform float uFillTiling;',
            'uniform float uU0; uniform float uU1; uniform float uArc; uniform float uLen; uniform vec3 uText;',
            'const float PI = 3.14159265;',
            'void main(){',
            '  float theta = atan(vPos.z, vPos.y);',
            '  float fv = clamp(vPos.x / uLen + 0.5, 0.0, 1.0);',
            '  vec3 fillc = texture2D(uFillTex, vec2((theta + PI) / (2.0 * PI), fv) * uFillTiling).rgb;', // GPU sRGB->linear
            '  float a = 0.0;',
            '  if (abs(theta) <= uArc * 0.5) {',
            '    float gv = clamp(0.5 - theta / uArc, 0.0, 1.0);',  // flip V: arc angle runs glyph top-to-bottom
            '    a = texture2D(uAtlas, vec2(mix(uU0, uU1, fv), gv)).a;',
            '  }',
            '  vec3 col = mix(fillc, uText, a);',
            '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);', // linear->sRGB (ShaderMaterial has no auto-encode)
            '}',
          ].join('\n'),
        })
        const tube = new three.Mesh(geo, mat)
        tube.userData.tex = layout.texture
        grp.add(tube)

        // ── Onion caps: a concentric-ring disc at each tube end (Hollow removes them). ──
        if (!hollow) {
          const capTex = onionTexture(three, fill)
          const capMat = new three.MeshBasicMaterial({ map: capTex, side: three.DoubleSide })
          const capGeo = new three.CircleGeometry(radius, 48)
          for (const sx of [1, -1]) {
            const cap = new three.Mesh(capGeo, capMat)
            cap.rotation.y = sx * Math.PI / 2
            cap.position.x = sx * len / 2
            grp.add(cap)
          }
        }

        // Random per-cylinder position scatter + size variation (deterministic by index).
        const ox = (hash01(globalIdx * 8.1) - 0.5) * posOffset
        const oy = (hash01(globalIdx * 9.7) - 0.5) * posOffset
        const oz = (hash01(globalIdx * 11.3) - 0.5) * posOffset
        grp.position.set(cursor + len / 2 + ox, y + oy, oz)
        grp.scale.setScalar(1 + (hash01(globalIdx * 13.9) - 0.5) * 2 * sizeVary)
        root.add(grp)
        const cycles = 1 + Math.floor(hash01(globalIdx * 7.3) * (scatter + 1))
        cylinders.push({
          mesh: grp, cycles,
          rx: (hash01(globalIdx * 1.3) - 0.5) * Math.PI * 2,
          ry: (hash01(globalIdx * 2.7) - 0.5) * Math.PI * 2,
          rz: (hash01(globalIdx * 3.9) - 0.5) * Math.PI * 2,
          rollRand: hash01(globalIdx * 5.1),
        })
        cursor += len + tracking
        globalIdx++
      }
    })

    onionburstEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const TAU = Math.PI * 2
    const spin = n(params, 'spin')
    const roll = n(params, 'roll')
    const rollRandom = n(params, 'rollRandom')
    const tumble = n(params, 'tumble')
    const hold = Math.min(0.9, Math.max(0, n(params, 'holdFraction')))
    // Tumble envelope a∈[0,1]: grow-in → hold → retract; `static` holds it at full tumble (no motion).
    const inOut = (1 - hold) / 2
    let a = 1
    if (String(params.tumbleMotion) !== 'static') {
      if (t01 < inOut) a = easeInOutExpo(t01 / Math.max(1e-4, inOut))
      else if (t01 > inOut + hold) a = 1 - easeInOutExpo((t01 - inOut - hold) / Math.max(1e-4, inOut))
    }
    for (const c of cylinders) {
      // X axis = manual roll + per-cyl static random offset + the spin/scatter + tumble.
      const baseX = roll + rollRandom * c.rollRand * TAU + spin * c.cycles * TAU * t01
      c.mesh.rotation.set(baseX + c.rx * tumble * a, c.ry * tumble * a, c.rz * tumble * a)
    }
  },
}
