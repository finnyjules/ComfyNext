import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { layoutChars } from '../charLayout'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
import { parseFills, fillShaderTexture, fillTiling, fillTextColor, hexBytes, fillAnchor, fillScreenVec, type Fill } from '../fills'
import { defaultFillsFor } from '../palette'

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

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'ALL IN\nTILL\nTHE\nEND', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 800, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -0.3, max: 1.5, step: 0.02, default: 0.15, group: 'Type' },
  { key: 'rowSpacing', label: 'Row spacing', kind: 'slider', min: 1, max: 4, step: 0.05, default: 2, group: 'Ribbon' },
  { key: 'arc', label: 'Wrap arc', kind: 'slider', min: 1, max: 3.14, step: 0.02, default: 2.2, group: 'Ribbon' },
  { key: 'radius', label: 'Radius', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Ribbon' },
  // Tile the glyph N times evenly around the tube's circumference (1 = once, today's look).
  { key: 'repeat', label: 'Repeat around ring', kind: 'slider', min: 1, max: 12, step: 1, default: 1, group: 'Ribbon' },
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
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(5, 'onionburst'), group: 'Color' },
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
// Per-scene state lives on the built root's userData (see update()), NOT a module var: the card
// preview and the headless frame source run two concurrent engines over this singleton effect,
// and the engine caches multiple roots per instance — a shared module var would let whichever
// built last own it, freezing every other surface. buildScene stashes it on root.userData.cylinders.

export const onionburstEffect: SpaceTypeEffect = {
  id: 'onionburst',          // internal id kept as 'onionburst' so saved nodes still resolve
  label: 'Rings',
  controls,

  // Builds its own per-glyph atlas via layoutChars; the shared texture is ignored.
  buildScene(three, params, _textTexture, env) {
    void _textTexture
    const root = new three.Group()
    const cylinders: Cyl[] = []

    const family = resolveFontFamily(String(params.font))
    const lines = String(params.text ?? '').split('\n').map(t => t.trim()).filter(Boolean)
    const usable = lines.length ? lines : [' ']
    const tracking = n(params, 'tracking')
    const rowSpacing = n(params, 'rowSpacing')
    const arc = Math.max(0.5, n(params, 'arc'))
    const radius = n(params, 'radius')
    const repeat = Math.max(1, Math.floor(Number(params.repeat) || 1))
    const scatter = Math.max(0, Math.floor(n(params, 'scatter')))
    const hollow = String(params.hollow) === 'on'
    const posOffset = n(params, 'posOffset')
    const sizeVary = n(params, 'sizeVary')
    const fills = parseFills(params.fills)

    const centerLine = (usable.length - 1) / 2
    let globalIdx = 0

    usable.forEach((line, p) => {
      const layout = layoutChars({ axes: env?.axes,
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
            uFillAnchor: { value: fillAnchor(fill) }, uFillScreen: { value: fillScreenVec(three) },
            uU0: { value: g.u0 }, uU1: { value: g.u1 },
            uArc: { value: arc }, uLen: { value: len }, uRepeat: { value: repeat },
            uText: { value: fillTextColor(three, fill) },
          },
          vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: [
            'precision highp float;',
            'varying vec3 vPos;',
            'uniform sampler2D uAtlas; uniform sampler2D uFillTex; uniform float uFillTiling;',
            'uniform float uFillAnchor; uniform vec2 uFillScreen;',   // 0=object(glyph UV) 1=frame(screen space)
            'uniform float uU0; uniform float uU1; uniform float uArc; uniform float uLen; uniform float uRepeat; uniform vec3 uText;',
            'const float PI = 3.14159265;',
            'void main(){',
            '  float theta = atan(vPos.z, vPos.y);',
            '  float fv = clamp(vPos.x / uLen + 0.5, 0.0, 1.0);',
            '  vec2 fillUv = uFillAnchor > 0.5 ? gl_FragCoord.xy / uFillScreen : vec2((theta + PI) / (2.0 * PI), fv) * uFillTiling;',
            '  vec3 fillc = texture2D(uFillTex, fillUv).rgb;', // GPU sRGB->linear
            '  float a = 0.0;',
            // Tile the glyph uRepeat times around the circumference: fold theta into equal
            // segments, clamp the glyph arc to a segment so copies do not overlap.
            '  float seg = (2.0 * PI) / uRepeat;',
            '  float local = mod(theta + PI, seg) - seg * 0.5;',
            '  float arcEff = min(uArc, seg);',
            '  if (abs(local) <= arcEff * 0.5) {',
            '    float gv = clamp(0.5 - local / arcEff, 0.0, 1.0);',  // flip V: arc angle runs glyph top-to-bottom
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

    root.userData.cylinders = cylinders
    onionburstEffect.update(0, params, root)
    return root
  },

  update(t01, params, root) {
    const cylinders = (root?.userData?.cylinders as Cyl[] | undefined) ?? []
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
