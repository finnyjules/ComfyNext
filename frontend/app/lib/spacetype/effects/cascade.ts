import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
import { layoutChars } from '../charLayout'
import { shapedSin } from '../ribbonGeometry'
import { parseFills, fillPrimary, fillTextColor, fillTexture, fillIsTextured } from '../fills'
import { defaultFillsFor } from '../palette'

/**
 * CASCADE — source-matched to spacetypegenerator.com/cascade.
 *
 * A 2D grid: each COLUMN k is one letter of the text (letter k repeated down every row),
 * so the text reads across the top and each letter "cascades" down its column. Row heights
 * vary — without a wave they decrease top→bottom (a perspective waterfall, `(rows-i)·yBlock`),
 * and with a wave they ripple via STG's sinEngine. Each cell is a colour-cycled ribbon rect
 * with the (stretched-to-fit) letter on top. Mirror adds the reflected half below.
 *
 * sinEngine(i,k) = shapedSin( sin(i·2π/rows + k·waveLength − t), slope ); t loops seamlessly.
 * yBlock = yField/Σ(1..rows) (½ that when mirrored) so the column always fills the field.
 *
 * Colour: a list of FILLS cycled per row, like STG's palette. Each fill = a STRIPE recipe
 * (solid / gradient / grid / noise) + a solid TEXT colour for the letter on that row. Letters
 * are always a flat colour ⇒ one InstancedMesh per column (per-instance colour). Stripes use
 * the same fast path for solid fills / gradient mode, but when a fill is textured they split
 * into one InstancedMesh per (column, fill-slot) since instancing can't vary a texture per
 * instance. Per-row colours/textures bake once; only cell matrices update per frame.
 */


const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'CASCADE', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'typeX', label: 'Type width', kind: 'slider', min: 4, max: 100, step: 1, default: 20, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 6, step: 0.5, default: 0, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 100, step: 1, default: 10, group: 'Type' },
  { key: 'lineSpace', label: 'Line space', kind: 'slider', min: 0, max: 90, step: 1, default: 20, group: 'Type' },
  { key: 'fontHeight', label: 'Font height', kind: 'slider', min: 0.3, max: 2.5, step: 0.05, default: 1, group: 'Type' },
  { key: 'rowHeight', label: 'Row height', kind: 'slider', min: 0.3, max: 3, step: 0.05, default: 1, group: 'Type' },
  // Grid.
  { key: 'rows', label: 'Rows', kind: 'slider', min: 2, max: 80, step: 1, default: 14, group: 'Ribbon' },
  { key: 'mirror', label: 'Mirror', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  { key: 'noStripes', label: 'No stripes', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  // Wave.
  { key: 'waveLength', label: 'Wave length', kind: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.13, group: 'Wave' },
  { key: 'waveSpeed', label: 'Wave speed', kind: 'slider', min: 0, max: 8, step: 0.05, default: 1, group: 'Wave' },
  { key: 'waveSlope', label: 'Wave slope', kind: 'slider', min: 0.2, max: 3.14, step: 0.1, default: 1, group: 'Wave' },
  // Transform.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  // Colour — per-row fills (stripe solid/gradient/grid/noise + text colour), cycled like STG.
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(2, 'cascade'), group: 'Color' },
  { key: 'gradientMode', label: 'Gradient (across rows)', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Color' },
]

const YFIELD = 700              // internal px height of the cascade field
const WORLD = 12 / YFIELD       // px → world scale

interface CascadeState {
  subGroup: THREE.Group
  nCols: number
  rows: number
  rowsPerCol: number               // rows, or 2·rows when mirrored
  mirror: boolean
  typeX: number
  tracking: number
  lineSpacePct: number
  gridW: number
  // Letters: always one InstancedMesh per column (flat text colour).
  letters: (THREE.InstancedMesh | null)[]
  // Stripes: fast single mesh (solid/gradient) OR split per fill slot (textured).
  splitRibbons: boolean
  ribbons: THREE.InstancedMesh | null
  ribSlotOf: number[]              // per local row r → ribbon fill slot
  ribLocalOf: number[]             // per r → instance index within its slot (per column)
  ribRowsInSlot: number[]          // count of rows mapping to each ribbon slot
  ribbonSlotMeshes: (THREE.InstancedMesh | null)[]
}

// Per-scene state lives on the built root's userData (see update()), NOT a module var: the card
// preview and the headless frame source run two concurrent engines over this singleton effect, and
// the engine caches multiple roots per instance — a shared var would let whichever built last own
// it, freezing every other surface. buildScene stashes it on root.userData.cascadeState.
const _m = new THREE.Matrix4()
const _scl = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _q = new THREE.Quaternion()

function n(p: Params, k: string): number { return Number(p[k]) }

/** Multi-stop lerp across the fill primaries at t∈[0,1] (gradient mode). */
function lerpColors(colors: THREE.Color[], t: number): THREE.Color {
  if (colors.length === 1) return colors[0]!.clone()
  const x = Math.min(1, Math.max(0, t)) * (colors.length - 1)
  const i0 = Math.floor(x)
  const i1 = Math.min(i0 + 1, colors.length - 1)
  return colors[i0]!.clone().lerp(colors[i1]!, x - i0)
}

export const cascadeEffect: SpaceTypeEffect = {
  id: 'cascade',
  label: 'Cascade',
  controls,
  liveKeys: ['rowHeight', 'fontHeight', 'waveLength'],

  // Cascade builds its own per-glyph texture via layoutChars; the shared one is ignored.
  buildScene(three, params, _textTexture, env) {
    void _textTexture
    const root = new three.Group()

    const family = resolveFontFamily(String(params.font))
    const firstLine = String(params.text ?? '').split('\n')[0] ?? ''
    const text = firstLine.length ? firstLine : ' '
    const layout = layoutChars({ axes: env?.axes,
      text,
      fontFamily: family,
      fontWeight: fontHasWeightAxis(family) ? n(params, 'typeWeight') : 400,
      fontSizePx: 200,
      tracking: 0,
      scaleX: 1,
      color: '#ffffff',
      strokeColor: '#ffffff',
      strokeWidth: n(params, 'typeStroke') * 1.5,
    })

    const chars = Array.from(text)
    const colGlyph: number[] = []
    { let gi = 0; for (const ch of chars) colGlyph.push(ch.trim() === '' ? -1 : gi++) }
    const nCols = Math.max(1, chars.length)
    const rows = Math.max(2, Math.floor(n(params, 'rows')))
    const mirror = String(params.mirror) === 'on'
    const noStripes = String(params.noStripes) === 'on'
    const gradient = String(params.gradientMode) === 'on'
    const typeX = n(params, 'typeX')
    const tracking = n(params, 'tracking')
    const lineSpacePct = Math.min(0.95, n(params, 'lineSpace') / 100)
    const rowsPerCol = mirror ? rows * 2 : rows
    const gridW = nCols * typeX + tracking * (nCols - 1)

    const fills = parseFills(params.fills)
    const pc = fills.length
    const primaries = fills.map(f => fillPrimary(three, f))
    const textColors = fills.map(f => fillTextColor(three, f))

    const rowIndexOf = (r: number) => (r < rows ? r : (2 * rows - 1 - r))
    const slotOf = (rowIdx: number) => ((rowIdx % pc) + pc) % pc
    const ribbonColorAt = (rowIdx: number): THREE.Color =>
      gradient ? lerpColors(primaries, rowIdx / Math.max(1, rows - 1)) : primaries[slotOf(rowIdx)]!.clone()
    const textColorAt = (rowIdx: number): THREE.Color => textColors[slotOf(rowIdx)]!.clone()

    // ── Letters: always one InstancedMesh per non-space column, flat text colour per row. ──
    const letters: (THREE.InstancedMesh | null)[] = []
    for (let k = 0; k < nCols; k++) {
      const gIdx = colGlyph[k] ?? -1
      const g = gIdx >= 0 ? layout.glyphs[gIdx] : undefined
      if (!g) { letters.push(null); continue }
      const geo = new three.PlaneGeometry(1, 1)
      const uv = geo.attributes.uv as THREE.BufferAttribute
      for (let v = 0; v < uv.count; v++) uv.setX(v, uv.getX(v) < 0.5 ? g.u0 : g.u1)
      uv.needsUpdate = true
      const mat = new three.MeshBasicMaterial({ map: layout.texture, transparent: true, alphaTest: 0.35, side: three.DoubleSide })
      const im = new three.InstancedMesh(geo, mat, rowsPerCol)
      im.frustumCulled = false
      for (let r = 0; r < rowsPerCol; r++) im.setColorAt(r, textColorAt(rowIndexOf(r)))
      if (im.instanceColor) im.instanceColor.needsUpdate = true
      letters.push(im)
      root.add(im)
    }

    // ── Stripes: split per fill slot only when textured (else single fast mesh). ──
    const totalCells = nCols * rowsPerCol
    const splitRibbons = !noStripes && !gradient && fills.some(fillIsTextured)
    let ribbons: THREE.InstancedMesh | null = null
    let ribbonSlotMeshes: (THREE.InstancedMesh | null)[] = []
    const ribSlotOf: number[] = [], ribLocalOf: number[] = [], ribRowsInSlot: number[] = new Array(pc).fill(0)

    if (!noStripes && !splitRibbons) {
      const ribGeo = new three.PlaneGeometry(1, 1)
      const ribMat = new three.MeshBasicMaterial({ side: three.DoubleSide })
      ribbons = new three.InstancedMesh(ribGeo, ribMat, totalCells)
      ribbons.frustumCulled = false
      for (let k = 0; k < nCols; k++)
        for (let r = 0; r < rowsPerCol; r++)
          ribbons.setColorAt(k * rowsPerCol + r, ribbonColorAt(rowIndexOf(r)))
      if (ribbons.instanceColor) ribbons.instanceColor.needsUpdate = true
      root.add(ribbons)
    } else if (splitRibbons) {
      // Row→slot map + per-slot counts/local indices (cycle depends on row only, not column).
      for (let r = 0; r < rowsPerCol; r++) {
        const slot = slotOf(rowIndexOf(r))
        ribSlotOf[r] = slot; ribLocalOf[r] = ribRowsInSlot[slot]!; ribRowsInSlot[slot] = ribRowsInSlot[slot]! + 1
      }
      ribbonSlotMeshes = new Array(pc).fill(null)
      for (let slot = 0; slot < pc; slot++) {
        const count = ribRowsInSlot[slot]! * nCols
        if (!count) continue
        const tex = fillTexture(three, fills[slot]!)
        const mat = tex
          ? new three.MeshBasicMaterial({ map: tex, side: three.DoubleSide })
          : new three.MeshBasicMaterial({ color: fillPrimary(three, fills[slot]!), side: three.DoubleSide })
        const im = new three.InstancedMesh(new three.PlaneGeometry(1, 1), mat, count)
        im.frustumCulled = false
        ribbonSlotMeshes[slot] = im
        root.add(im)
      }
    }

    root.userData.tex = layout.texture

    const subGroup = new three.Group()
    subGroup.scale.setScalar(WORLD)
    for (const c of [...root.children]) subGroup.add(c)
    root.add(subGroup)

    const cascadeState: CascadeState = {
      subGroup, nCols, rows, rowsPerCol, mirror, typeX, tracking, lineSpacePct, gridW,
      letters, splitRibbons, ribbons, ribSlotOf, ribLocalOf, ribRowsInSlot, ribbonSlotMeshes,
    }
    root.userData.cascadeState = cascadeState
    cascadeEffect.update(0, params, root)
    return root
  },

  update(t01, params, root) {
    const s = root?.userData?.cascadeState as CascadeState | undefined
    if (!s) return
    const { rows, nCols, rowsPerCol, mirror, typeX, tracking, lineSpacePct, gridW } = s

    const waveTurns = Math.max(0, Number(params.waveSpeed ?? 1))
    const waveLength = Number(params.waveLength ?? 0)
    const waveSlope = Math.max(0.05, Number(params.waveSlope ?? 1))

    const rowHeight = Math.max(0.05, Number(params.rowHeight ?? 1))
    const fontHeight = Math.max(0.05, Number(params.fontHeight ?? 1))
    s.subGroup.scale.set(WORLD, WORLD * rowHeight, WORLD)

    const step = (rows * rows + rows) / 2
    const yBlock = mirror ? YFIELD / (step * 2) : YFIELD / step
    const waveBlock = (2 * Math.PI) / rows
    const t = t01 * waveTurns * 2 * Math.PI
    const halfField = YFIELD / 2

    const figure = (i: number, k: number): number => {
      if (waveTurns > 0) {
        const s2 = shapedSin(Math.sin(i * waveBlock + k * waveLength - t), waveSlope)
        return yBlock + ((s2 + 1) / 2) * (rows * yBlock - yBlock)
      }
      return (rows - i) * yBlock
    }

    for (let k = 0; k < nCols; k++) {
      const cx = (typeX * k + tracking * k + typeX / 2) - gridW / 2
      const letterMesh = s.letters[k] ?? null
      let yc = 0
      for (let r = 0; r < rowsPerCol; r++) {
        const tyf = r < rows ? figure(r, k) : figure(rows - (r - rows + 1), k)
        const lineSp = tyf * lineSpacePct
        const cellLetterY = tyf - lineSp
        const typeY = cellLetterY * fontHeight

        const ribY = halfField - (yc + tyf / 2)
        const letY = halfField - (yc + lineSp / 2 + cellLetterY / 2)

        // Ribbon matrix → fast single mesh or the row's slot mesh.
        _scl.set(typeX + tracking, tyf, 1)
        _pos.set(cx, ribY, 0)
        _m.compose(_pos, _q, _scl)
        if (!s.splitRibbons) {
          if (s.ribbons) s.ribbons.setMatrixAt(k * rowsPerCol + r, _m)
        } else {
          const rs = s.ribSlotOf[r]!
          const rm = s.ribbonSlotMeshes[rs]
          if (rm) rm.setMatrixAt(k * s.ribRowsInSlot[rs]! + s.ribLocalOf[r]!, _m)
        }

        // Letter matrix.
        if (letterMesh) {
          _scl.set(typeX, Math.max(0.001, typeY), 1)
          _pos.set(cx, letY, 1)   // 1px in front of the ribbon
          _m.compose(_pos, _q, _scl)
          letterMesh.setMatrixAt(r, _m)
        }

        yc += tyf
      }
      if (letterMesh) letterMesh.instanceMatrix.needsUpdate = true
    }

    if (!s.splitRibbons) {
      if (s.ribbons) s.ribbons.instanceMatrix.needsUpdate = true
    } else {
      for (const rm of s.ribbonSlotMeshes) if (rm) rm.instanceMatrix.needsUpdate = true
    }
  },
}
