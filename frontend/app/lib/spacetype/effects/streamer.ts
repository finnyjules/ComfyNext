import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills } from '../fills'
import { resolveFontFamily } from '~/data/google-fonts'
import { tilePose, streamerCycle, streamerRadius, gradientColorAt } from '../streamerLayout'

/**
 * STREAMER — faithful port of spacetypegenerator.com/ribbon (Streamers preset). Flat per-character
 * tiles arranged around a racetrack/oval loop (ribbonStretch = straight-run length; 0 = oval),
 * stacked into `ribbonCount` ribbons, gradient-colored along the text run, scrolling around the
 * loop and looping seamlessly. Instanced: one InstancedMesh of unit planes; a glyph-atlas texture
 * supplies the letters; a custom shader composites tile face (gradient front / B-side back) + glyph
 * (text color). Layout/gradient math is pure + unit-tested (../streamerLayout).
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'THE SEA IS A DESERT OF WAVES, A WILDERNESS OF WATER. ', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'IBM Plex Mono', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 0, max: 100, step: 1, default: 25, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 100, step: 1, default: 40, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 6, step: 0.5, default: 2, group: 'Type' },
  // Ribbon
  { key: 'segmentSpace', label: 'Segment space', kind: 'slider', min: 4, max: 60, step: 1, default: 23, group: 'Ribbon' },
  { key: 'segmentCount', label: 'Segment count', kind: 'slider', min: 3, max: 50, step: 1, default: 22, group: 'Ribbon' },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 8, max: 200, step: 1, default: 56, group: 'Ribbon' },
  { key: 'ribbonStretch', label: 'Ribbon stretch', kind: 'slider', min: 0, max: 6, step: 0.1, default: 0, group: 'Ribbon' },
  { key: 'ribbonCount', label: 'Ribbon count', kind: 'slider', min: 1, max: 10, step: 1, default: 4, group: 'Ribbon' },
  { key: 'ribbonSpacing', label: 'Ribbon spacing', kind: 'slider', min: 1, max: 3, step: 0.01, default: 1.62, group: 'Ribbon' },
  { key: 'ribbonOffset', label: 'Ribbon offset', kind: 'slider', min: 0, max: 2, step: 0.01, default: 1.3, group: 'Ribbon' },
  { key: 'alternate', label: 'Alternate', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  // Color
  { key: 'fills', label: 'Gradient stops', kind: 'fillList', default: JSON.stringify([
      { type: 'solid', a: '#FFFC79', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#FF2F92', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#011993', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#0096FF', b: '#000', textColor: '#fff' },
    ]), group: 'Color' },
  { key: 'textColor', label: 'Text color', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#212121', group: 'Color' },
  { key: 'noStripes', label: 'No stripes', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Color' },
  // Motion
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.4, group: 'Motion' },
  // Transform (consumed by the engine)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.01, default: 2.5, group: 'Transform' },
  { key: 'rotateX', label: 'Rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 1.79, group: 'Transform' },
  { key: 'rotateY', label: 'Rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: -0.31, group: 'Transform' },
]

// Shared vertex shader for both faces.
const VERT = [
  'attribute vec4 aCellUV;', 'attribute vec3 aColor;',
  'varying vec2 vUv; varying vec4 vCell; varying vec3 vColor;',
  'void main(){',
  '  vUv = uv; vCell = aCellUV; vColor = aColor;',
  '  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
  '}',
].join('\n')

// FRONT (A-side): per-tile gradient colour + the glyph in the text colour. Rendered with
// side: FrontSide so it only shows on the physical front of each tile.
const FRONT_FRAG = [
  'precision highp float;',
  'uniform sampler2D uAtlas; uniform vec3 uTextColor; uniform float uNoStripes;',
  'varying vec2 vUv; varying vec4 vCell; varying vec3 vColor;',
  'void main(){',
  '  float a = texture2D(uAtlas, vCell.xy + vUv * vCell.zw).a;',
  '  if (uNoStripes > 0.5) { if (a < 0.02) discard; gl_FragColor = vec4(uTextColor, 1.0); return; }',
  '  gl_FragColor = vec4(mix(vColor, uTextColor, a), 1.0);',
  '}',
].join('\n')

// BACK (B-side): a flat colour, NO glyph. Rendered with side: BackSide so it only shows on the
// physical back of each tile. (A second back-string could be added here later.)
const BACK_FRAG = [
  'precision highp float;',
  'uniform vec3 uBSide; uniform float uNoStripes;',
  'void main(){ if (uNoStripes > 0.5) discard; gl_FragColor = vec4(uBSide, 1.0); }',
].join('\n')

function n(p: Params, k: string): number { return Number(p[k]) }
function gradientStops(p: Params): string[] {
  const fills = parseFills(p.fills)
  const cols = fills.map(f => f.a)
  return cols.length ? cols : ['#ffffff']
}
function streamerText(p: Params): string {
  const t = String(p.text ?? '').replace(/\n+/g, ' ')
  return t.length ? t : ' '
}

const MAX_INSTANCES = 2400

interface AtlasCell { u: number; v: number; du: number; dv: number }
interface Atlas { tex: THREE.CanvasTexture; cells: Map<string, AtlasCell> }

function buildAtlas(three: typeof THREE, p: Params): Atlas {
  const family = resolveFontFamily(String(p.font))
  const chars = Array.from(new Set(streamerText(p).split('')))
  const CELL = 96
  const cols = Math.ceil(Math.sqrt(chars.length))
  const rows = Math.ceil(chars.length / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * CELL; canvas.height = rows * CELL
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const fontPx = CELL * 0.62
  ctx.font = `${fontPx}px "${family}", "IBM Plex Mono", monospace`
  const stroke = n(p, 'typeStroke')
  const dy = (n(p, 'typeHeight') / 100) * CELL * 0.25
  const dx = (n(p, 'tracking') / 100 - 0.4) * CELL * 0.15
  const cells = new Map<string, AtlasCell>()
  chars.forEach((ch, i) => {
    const cx = (i % cols) * CELL, cy = Math.floor(i / cols) * CELL
    const gx = cx + CELL / 2 + dx, gy = cy + CELL / 2 + dy
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'
    if (stroke > 0) { ctx.lineWidth = stroke * 2; ctx.lineJoin = 'round'; ctx.strokeText(ch, gx, gy) }
    else { ctx.fillText(ch, gx, gy) }
    cells.set(ch, { u: cx / canvas.width, v: 1 - (cy + CELL) / canvas.height, du: CELL / canvas.width, dv: CELL / canvas.height })
  })
  const tex = new three.CanvasTexture(canvas)
  tex.minFilter = three.LinearFilter; tex.magFilter = three.LinearFilter
  return { tex, cells }
}

interface State {
  three: typeof THREE
  front: THREE.InstancedMesh
  back: THREE.InstancedMesh
  aCellUV: THREE.InstancedBufferAttribute
  aColor: THREE.InstancedBufferAttribute
  atlas: Atlas
  dummy: THREE.Object3D
  W: number
}
let state: State | null = null

function layout(s: State, p: Params, t01: number): void {
  const segmentCount = Math.max(1, Math.round(n(p, 'segmentCount')))
  const segmentSpace = n(p, 'segmentSpace')
  const ms = n(p, 'ribbonStretch')
  const depth = n(p, 'ribbonHeight')
  const radius = streamerRadius(segmentCount, segmentSpace)
  const cycle = streamerCycle(segmentCount, ms)
  const count = Math.max(1, Math.round(n(p, 'ribbonCount')))
  const spacing = n(p, 'ribbonSpacing')
  const offset = n(p, 'ribbonOffset')
  const alt = String(p.alternate) === 'on'
  const txt = streamerText(p)
  const runLength = Math.min(txt.length, Math.floor(MAX_INSTANCES / count))
  // Each letter is glued to its tile slot `k` (like STG): the whole ribbon crawls as a rigid unit,
  // letters don't re-index per frame. Seamless loop = scroll a whole number of cycles so positions
  // realign; the (fixed) letters need no tiling. speed → cycles/loop; 0 = stopped.
  const loops = Math.max(0, Math.round(n(p, 'speed') * 4))
  const scroll = loops === 0 ? 0 : t01 * loops * cycle
  const stops = gradientStops(p)

  const dummy = s.dummy
  let inst = 0
  const total = count * runLength
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let j = 0; j < count; j++) {
    const ribY = alt ? (j % 2) * radius * 2 : j * offset * radius * 2
    const ribZ = j * depth * spacing
    for (let k = 0; k < runLength; k++) {
      const i = scroll + k
      const pose = tilePose(i, segmentCount, segmentSpace, ms)
      dummy.position.set(pose.x, pose.y + ribY, ribZ)
      dummy.rotation.set(0, 0, 0)
      dummy.rotateZ(pose.rot); dummy.translateY(-radius); dummy.rotateX(Math.PI / 2)
      dummy.scale.set(segmentSpace, depth, 1)
      dummy.updateMatrix()
      s.front.setMatrixAt(inst, dummy.matrix)
      s.back.setMatrixAt(inst, dummy.matrix)
      // track the tile-center bounds for framing/centering (dummy.position is the final center)
      const px = dummy.position.x, py = dummy.position.y, pz = dummy.position.z
      if (px < minX) minX = px; if (px > maxX) maxX = px
      if (py < minY) minY = py; if (py > maxY) maxY = py
      if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz
      // letter is fixed to the tile slot k (glued to the tile; the ribbon crawls rigidly)
      const ch = txt[((k % txt.length) + txt.length) % txt.length]!
      const cell = s.atlas.cells.get(ch) ?? s.atlas.cells.values().next().value
      s.aCellUV.setXYZW(inst, cell!.u, cell!.v, cell!.du, cell!.dv)
      const col = gradientColorAt(k, runLength, stops)
      s.aColor.setXYZ(inst, col.r, col.g, col.b)
      inst++
    }
  }
  s.front.count = total; s.back.count = total
  s.front.instanceMatrix.needsUpdate = true; s.back.instanceMatrix.needsUpdate = true
  s.aCellUV.needsUpdate = true; s.aColor.needsUpdate = true
  // STG works in pixel units; our camera frames ~11 world units. Normalize the loop's largest
  // extent to that and recenter, so the `scale`/rotate params fine-tune from a framed start.
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1) + Math.max(segmentSpace, depth)
  const norm = 11 / ext
  const cx = -norm * (minX + maxX) / 2, cy = -norm * (minY + maxY) / 2, cz = -norm * (minZ + maxZ) / 2
  s.front.scale.setScalar(norm); s.front.position.set(cx, cy, cz)
  s.back.scale.setScalar(norm); s.back.position.set(cx, cy, cz)
}

export const streamerEffect: SpaceTypeEffect = {
  id: 'streamer',
  label: 'Streamer',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()

    const atlas = buildAtlas(three, params)
    // One shared geometry carries the per-instance attributes; two single-sided InstancedMeshes
    // (front + back) draw the two physical faces with different content — deterministic per face,
    // no camera/gl_FrontFacing test, and the back never shows the glyph.
    const geo = new three.PlaneGeometry(1, 1)
    const aCellUV = new three.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4)
    const aColor = new three.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3)
    geo.setAttribute('aCellUV', aCellUV)
    geo.setAttribute('aColor', aColor)

    const frontUniforms = {
      uAtlas: { value: atlas.tex as THREE.Texture },
      uTextColor: { value: new three.Color(String(params.textColor)) },
      uNoStripes: { value: String(params.noStripes) === 'on' ? 1 : 0 },
    }
    const backUniforms = {
      uBSide: { value: new three.Color(String(params.bSideColor)) },
      uNoStripes: { value: String(params.noStripes) === 'on' ? 1 : 0 },
    }
    const frontMat = new three.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRONT_FRAG, uniforms: frontUniforms, side: three.FrontSide })
    const backMat = new three.ShaderMaterial({ vertexShader: VERT, fragmentShader: BACK_FRAG, uniforms: backUniforms, side: three.BackSide })
    const front = new three.InstancedMesh(geo, frontMat, MAX_INSTANCES)
    const back = new three.InstancedMesh(geo, backMat, MAX_INSTANCES)
    front.frustumCulled = false; back.frustumCulled = false
    front.userData.tex = atlas.tex
    root.add(back); root.add(front)

    state = { three, front, back, aCellUV, aColor, atlas, dummy: new three.Object3D(), W: 1500 }
    layout(state, params, 0)

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`40px "${family}"`).then(() => {
        if (state && state.front === front) {
          const next = buildAtlas(three, params)
          state.atlas.tex.dispose()
          state.atlas = next
          frontUniforms.uAtlas.value = next.tex
          front.userData.tex = next.tex
          layout(state, params, 0)
        }
      }).catch(() => {})
    }
    return root
  },

  update(t01, params) {
    if (!state) return
    const fu = (state.front.material as THREE.ShaderMaterial).uniforms
    const bu = (state.back.material as THREE.ShaderMaterial).uniforms
    const noStripes = String(params.noStripes) === 'on' ? 1 : 0
    fu['uTextColor']!.value.set(String(params.textColor))
    fu['uNoStripes']!.value = noStripes
    bu['uBSide']!.value.set(String(params.bSideColor))
    bu['uNoStripes']!.value = noStripes
    layout(state, params, t01)
  },
}
