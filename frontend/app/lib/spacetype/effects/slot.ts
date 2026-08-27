import * as THREE from 'three'
import { defaultsFromControls, type ControlSpec, type Params, type SpaceTypeEffect } from '../effect'
import { buildReel, reelScroll, type Cell, type Timing } from '../slotGeometry'
import { layoutChars } from '../charLayout'
import { normalizeFill, fillIsTextured, fillShaderTexture, fillTiling, fillPrimary, type Fill } from '../fills'
import { fillIsShader } from '../fillTile'
import { defaultFillsFor } from '../palette'
import { resolveFontFamily, fontHasWeightAxis } from '~/lib/font/resolveFamily'

const controls: ControlSpec[] = [
  // Type
  // Key MUST be 'text': SpaceTypeSurface's multi-text editor is a singleton bound to params.text
  // (a textList control is not rendered per its own key) — see tests/unit/spacetype-sections. Each
  // newline-separated row is one message the reels rotate between.
  { key: 'text', label: 'Messages', kind: 'textList', default: 'MAKE IT REAL\nSHIP TODAY', group: 'Type' },
  { key: 'reelUnit', label: 'Reel unit', kind: 'select', options: ['word', 'char'], default: 'word', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 700, group: 'Type' },
  { key: 'typeSize', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'fillerSource', label: 'Filler', kind: 'select', options: ['messages', 'glyphs', 'shapes', 'custom'], default: 'messages', group: 'Type' },
  { key: 'glyphSet', label: 'Glyph set', kind: 'select', options: ['alpha', 'digits', 'symbols', 'mixed'], default: 'mixed', group: 'Type', showIf: { key: 'fillerSource', equals: 'glyphs' } },
  { key: 'shapeSet', label: 'Shape set', kind: 'select', options: ['basic', 'geometric'], default: 'geometric', group: 'Type', showIf: { key: 'fillerSource', equals: 'shapes' } },
  // kind 'text' (single-line, space-separated), NOT 'textList': the surface allows only one
  // textList (the singleton above). buildReel splits fillerTokens on whitespace. kind 'text' binds
  // per-key (params.fillerTokens), so it doesn't collide with the messages editor.
  { key: 'fillerTokens', label: 'Filler tokens', kind: 'text', default: 'A B C', group: 'Type', showIf: { key: 'fillerSource', equals: 'custom' } },
  { key: 'fillerDensity', label: 'Filler amount', kind: 'slider', min: 0, max: 12, step: 1, default: 4, group: 'Type' },
  // Color
  { key: 'wordFill', label: 'Word fill', kind: 'fillList', default: defaultFillsFor(1, 'slot'), group: 'Color' },
  { key: 'slotFill', label: 'Slot fill', kind: 'fillList', default: '[{"type":"solid","a":"#15221F","b":"#000000","textColor":"#ffffff","angle":45,"density":8}]', group: 'Color' },
  // Stroke
  { key: 'frameWidth', label: 'Frame', kind: 'slider', min: 0, max: 0.4, step: 0.01, default: 0, group: 'Stroke' },
  { key: 'frameColor', label: 'Frame color', kind: 'color', default: '#000000', group: 'Stroke', showIf: { key: 'frameWidth', notEquals: 0 } },
  // Layout
  { key: 'reelShape', label: 'Reel shape', kind: 'select', options: ['flat', 'drum'], default: 'drum', group: 'Layout' },
  { key: 'curveAmount', label: 'Drum curve', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Layout', showIf: { key: 'reelShape', equals: 'drum' } },
  { key: 'slotAspect', label: 'Slot aspect', kind: 'slider', min: 0.4, max: 3, step: 0.05, default: 0.9, group: 'Layout' },
  { key: 'slotGap', label: 'Slot gap', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.12, group: 'Layout' },
  { key: 'columns', label: 'Columns', kind: 'slider', min: 1, max: 12, step: 1, default: 6, group: 'Layout' },
  { key: 'align', label: 'Align', kind: 'select', options: ['left', 'center'], default: 'center', group: 'Layout' },
  { key: 'edgeFalloff', label: 'Edge falloff', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Layout' },
  // Motion
  { key: 'direction', label: 'Direction', kind: 'select', options: ['up', 'down'], default: 'up', group: 'Motion' },
  { key: 'stagger', label: 'Stagger', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.4, group: 'Motion' },
  { key: 'overshoot', label: 'Overshoot', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Motion' },
  { key: 'hold', label: 'Hold', kind: 'slider', min: 0, max: 0.9, step: 0.01, default: 0.4, group: 'Motion' },
  { key: 'blur', label: 'Motion blur', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.6, group: 'Motion' },
  // Look
  { key: 'spinDim', label: 'Spin dim', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.3, group: 'Look' },
  // Transform (engine applies scale/rotate from these — see engine.ts:348-349)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

const SLOT_DEFAULTS = defaultsFromControls(controls)
function n(p: Params, k: string): number { return Number(p[k] ?? SLOT_DEFAULTS[k]) }
function str(p: Params, k: string): string { return String(p[k] ?? SLOT_DEFAULTS[k]) }

/** wordFill/slotFill store one Fill as JSON (bare object OR [fill]); parse tolerantly like ring's resolveWordFill. */
function resolveFill(raw: unknown, fallback: Fill): Fill {
  if (typeof raw === 'string' && raw) {
    try {
      const v = JSON.parse(raw)
      return normalizeFill(Array.isArray(v) ? v[0] : v)
    } catch { /* fall through */ }
  }
  return fallback
}

const WHITE_FILL: Fill = { type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }
const DARK_SLOT_FILL: Fill = { type: 'solid', a: '#15221F', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }

// Cell height in reel-canvas px; width derived from slotAspect. Supersample-ish for crisp glyphs.
const CELL_PX = 128

/** Draw a white geometric shape token centered in [0,0,w,h]. */
function drawShapeToken(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2, cy = y + h / 2
  const r = Math.min(w, h) * 0.32
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(2, r * 0.28)
  ctx.beginPath()
  switch (id) {
    case 'square': ctx.rect(cx - r, cy - r, r * 2, r * 2); ctx.fill(); break
    case 'triangle':
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath(); ctx.fill(); break
    case 'diamond':
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill(); break
    case 'cross':
      ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.stroke(); break
    case 'ring':
      ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); break
    case 'chevron':
      ctx.moveTo(cx - r, cy - r * 0.5); ctx.lineTo(cx, cy + r * 0.5); ctx.lineTo(cx + r, cy - r * 0.5); ctx.stroke(); break
    case 'circle':
    default: ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); break
  }
  ctx.restore()
}

/** Paint one slot's cell strip as a tall WHITE-mask canvas (one cell per CELL_PX row). */
function paintReelCanvas(cells: Cell[], cellW: number, family: string, weight: number, hasWght: boolean, tracking: number, sizeScale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(cellW))
  canvas.height = Math.max(2, cells.length * CELL_PX)
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!
    // Paint cell i BOTTOM-up: the CanvasTexture keeps three's default flipY=true, so
    // texture V∈[k/n,(k+1)/n] samples the canvas row (n-1-k). Painting cell i at row
    // (n-1-i) makes `alphaTex.offset.y = k/n` (update()) display LOGICAL cell k — i.e.
    // the aperture rests on land cell m*stride, not its mirror image. Same convention as
    // textTexture.ts's `cy = (n-1-k)*rowH`. Glyphs stay upright (flipY is the natural
    // canvas→UV mapping); only the row's V-position is reflected.
    const y0 = (cells.length - 1 - i) * CELL_PX
    if (cell.kind === 'blank') continue
    if (cell.kind === 'shape') { drawShapeToken(ctx, cell.value, 0, y0, canvas.width, CELL_PX); continue }
    // text: rasterize glyph atlas (white), draw contained + centered in the cell
    const layout = layoutChars({
      text: cell.value, fontFamily: family, fontWeight: hasWght ? weight : 400,
      fontSizePx: CELL_PX * 0.7, tracking, scaleX: 1, color: '#ffffff',
      axes: hasWght ? { wght: weight } : undefined,
    })
    const img = layout.texture.image as HTMLCanvasElement
    const pad = CELL_PX * 0.14
    const maxW = (canvas.width - pad * 2) * sizeScale
    const maxH = (CELL_PX - pad * 2) * sizeScale
    const scale = Math.min(maxW / img.width, maxH / img.height)
    const dw = img.width * scale, dh = img.height * scale
    ctx.drawImage(img, (canvas.width - dw) / 2, y0 + (CELL_PX - dh) / 2, dw, dh)
    layout.texture.dispose()
  }
  return canvas
}

interface SlotUniforms { uBlur: { value: number }; uCurve: { value: number }; uEdge: { value: number }; uDim: { value: number }; uCellFrac: { value: number } }
interface SlotMesh { mesh: THREE.Mesh; alphaTex: THREE.CanvasTexture; cellCount: number; slotIndex: number }
interface SlotState { slots: SlotMesh[]; messageCount: number; stride: number; slotCount: number }

export const slotEffect: SpaceTypeEffect = {
  id: 'slot',
  label: 'Slot',
  controls,
  // Live: motion/look/placement that update() reads each frame — no structural rebuild.
  liveKeys: ['direction', 'stagger', 'overshoot', 'hold', 'blur', 'spinDim', 'edgeFalloff', 'curveAmount', 'reelShape', 'scale', 'rotateX', 'rotateY', 'rotateZ'],
  // The whole message rotation is authored as ONE seamless loop (see reelScroll) — single loop.
  loopRates() { return [1] },

  buildScene(three, params) {
    const root = new three.Group()
    const reel = buildReel({
      messages: str(params, 'text'),
      reelUnit: (str(params, 'reelUnit') as 'word' | 'char'),
      fillerSource: (str(params, 'fillerSource') as ReelSource),
      glyphSet: str(params, 'glyphSet'),
      shapeSet: str(params, 'shapeSet'),
      fillerTokens: str(params, 'fillerTokens'),
      fillerDensity: n(params, 'fillerDensity'),
      align: (str(params, 'align') as 'left' | 'center'),
    })

    const family = resolveFontFamily(str(params, 'font'))
    const hasWght = fontHasWeightAxis(family)
    const weight = n(params, 'typeWeight')
    const tracking = n(params, 'tracking')
    const sizeScale = n(params, 'typeSize') / 180

    const wf = resolveFill(params.wordFill, WHITE_FILL)
    const sf = resolveFill(params.slotFill, DARK_SLOT_FILL)
    const wfTextured = fillIsTextured(wf)
    let wordFillMap: THREE.Texture | null = null
    if (wfTextured) {
      if (fillIsShader(wf)) wordFillMap = fillShaderTexture(three, wf)
      else {
        wordFillMap = fillShaderTexture(three, wf).clone()
        wordFillMap.needsUpdate = true
        wordFillMap.repeat.set(fillTiling(wf), fillTiling(wf))
        root.userData.tex = wordFillMap
      }
    }

    const aspect = n(params, 'slotAspect')            // w/h
    const H = 1                                        // slot world height (unit); scale control zooms the scene
    const W = H * aspect
    const cols = Math.min(Math.max(1, Math.round(n(params, 'columns'))), reel.slotCount)
    const rows = Math.ceil(reel.slotCount / cols)

    const slots: SlotMesh[] = []
    for (let j = 0; j < reel.slotCount; j++) {
      const cells = reel.cells[j]!
      const cellW = CELL_PX * aspect
      const canvas = paintReelCanvas(cells, cellW, family, weight, hasWght, tracking, sizeScale)
      const alphaTex = new three.CanvasTexture(canvas)
      alphaTex.wrapS = three.ClampToEdgeWrapping
      alphaTex.wrapT = three.RepeatWrapping
      alphaTex.repeat.set(1, 1 / cells.length)         // show one cell
      alphaTex.needsUpdate = true

      const geo = new three.PlaneGeometry(W, H, 1, 24) // vertical subdivisions for drum curve (Task 4)
      const material = new three.MeshBasicMaterial({
        map: wfTextured ? wordFillMap : null,
        color: wfTextured ? new three.Color('#ffffff') : fillPrimary(three, wf),
        alphaMap: alphaTex,
        transparent: true,
        side: three.DoubleSide,
        depthWrite: false,
      })

      // Slot background quad (behind the reel).
      const bgGeo = new three.PlaneGeometry(W, H, 1, 1)
      const bgMat = new three.MeshBasicMaterial({
        map: fillIsTextured(sf) ? fillShaderTexture(three, sf) : null,
        color: fillIsTextured(sf) ? new three.Color('#ffffff') : fillPrimary(three, sf),
        side: three.DoubleSide,
        transparent: true,
        depthWrite: false,
      })
      const frameW = n(params, 'frameWidth')
      if (frameW > 0) {
        const frameCol = new three.Color(str(params, 'frameColor'))
        bgMat.onBeforeCompile = (shader) => {
          shader.uniforms.uFrameW = { value: frameW }
          shader.uniforms.uFrameCol = { value: frameCol }
          shader.vertexShader = 'varying vec2 vBgUv;\n' + shader.vertexShader
            .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvBgUv = uv;')
          shader.fragmentShader = ('uniform float uFrameW;\nuniform vec3 uFrameCol;\nvarying vec2 vBgUv;\n' + shader.fragmentShader)
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
              {
                float b = min(min(vBgUv.x, 1.0 - vBgUv.x), min(vBgUv.y, 1.0 - vBgUv.y));
                if (b < uFrameW * 0.5) gl_FragColor.rgb = uFrameCol;
              }`)
        }
      }

      const bg = new three.Mesh(bgGeo, bgMat)
      bg.position.z = -0.01

      const mesh = new three.Mesh(geo, material)
      mesh.userData.tex = alphaTex

      const uniforms = {
        uBlur: { value: 0 }, uCurve: { value: 0 }, uEdge: { value: n(params, 'edgeFalloff') },
        uDim: { value: 0 }, uCellFrac: { value: 1 / cells.length },
      }
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uBlur = uniforms.uBlur
        shader.uniforms.uCurve = uniforms.uCurve
        shader.uniforms.uEdge = uniforms.uEdge
        shader.uniforms.uDim = uniforms.uDim
        shader.uniforms.uCellFrac = uniforms.uCellFrac
        shader.vertexShader = ('uniform float uCurve;\nvarying vec2 vSlotUv;\n' + shader.vertexShader)
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvSlotUv = uv;')
          // Drum: center (uv.y=0.5) stays frontmost (Δz=0); top/bottom edges RECEDE (Δz=-0.5·uCurve).
          // A real reel drum curves away at its edges — and this matches the edge-dim shading below
          // (dimmer = further), which the earlier +z form contradicted by bulging edges toward the camera.
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed.z += uCurve * (cos((uv.y - 0.5) * 3.14159) - 1.0) * 0.5;')
        shader.fragmentShader = ('uniform float uBlur;\nuniform float uEdge;\nuniform float uDim;\nuniform float uCellFrac;\nuniform float uCurve;\nvarying vec2 vSlotUv;\n' + shader.fragmentShader)
          // Multi-tap vertical blur of the alphaMap coverage, span scaled to one cell.
          .replace('#include <alphamap_fragment>', `
            {
              float span = uBlur * uCellFrac * 0.9;
              float a = 0.0;
              a += texture2D( alphaMap, vAlphaMapUv + vec2(0.0, -span) ).g;
              a += texture2D( alphaMap, vAlphaMapUv + vec2(0.0, -span*0.5) ).g;
              a += texture2D( alphaMap, vAlphaMapUv ).g;
              a += texture2D( alphaMap, vAlphaMapUv + vec2(0.0, span*0.5) ).g;
              a += texture2D( alphaMap, vAlphaMapUv + vec2(0.0, span) ).g;
              diffuseColor.a *= a / 5.0;
            }`)
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            {
              // Drum neighbour dim: fade brightness away from the slot's vertical center.
              float drum = 1.0 - uCurve * abs(vSlotUv.y - 0.5) * 1.4;
              // Aperture edge falloff: soft top/bottom.
              float edge = smoothstep(0.0, uEdge * 0.5 + 0.001, vSlotUv.y) * smoothstep(0.0, uEdge * 0.5 + 0.001, 1.0 - vSlotUv.y);
              float m = clamp(drum, 0.0, 1.0) * mix(1.0, edge, step(0.001, uEdge)) * (1.0 - uDim);
              gl_FragColor.rgb *= m;
              gl_FragColor.a *= (uEdge > 0.001 ? edge : 1.0);
            }`)
      }
      ;(mesh.userData as Record<string, unknown>).uniforms = uniforms

      const col = j % cols
      const rowIdx = Math.floor(j / cols)
      const gap = n(params, 'slotGap') * H
      const px = (col - (cols - 1) / 2) * (W + gap)
      const py = -(rowIdx - (rows - 1) / 2) * (H + gap)
      const cell = new three.Group()
      cell.position.set(px, py, 0)
      cell.add(bg)
      cell.add(mesh)
      root.add(cell)

      slots.push({ mesh, alphaTex, cellCount: cells.length, slotIndex: j })
    }

    root.userData.slotState = { slots, messageCount: reel.messageCount, stride: reel.stride, slotCount: reel.slotCount } as SlotState
    return root
  },

  update(t01, params, root) {
    const st = root?.userData?.slotState as SlotState | undefined
    if (!st) return
    const timing: Timing = {
      messageCount: st.messageCount,
      stride: st.stride,
      slotCount: st.slotCount,
      hold: n(params, 'hold'),
      stagger: n(params, 'stagger'),
      overshoot: n(params, 'overshoot'),
    }
    const dir = str(params, 'direction') === 'down' ? -1 : 1
    const reelShape = str(params, 'reelShape')
    const curve = reelShape === 'drum' ? n(params, 'curveAmount') : 0
    const edge = n(params, 'edgeFalloff')
    const blurMax = n(params, 'blur')
    const dimMax = n(params, 'spinDim')
    for (const s of st.slots) {
      const { offset, speed } = reelScroll(t01, s.slotIndex, timing)
      // offset in cells → V fraction of the strip; RepeatWrapping handles the seam.
      s.alphaTex.offset.y = (dir * offset / s.cellCount) % 1
      const u = (s.mesh.userData as { uniforms?: SlotUniforms }).uniforms
      if (u) {
        u.uBlur.value = speed * blurMax
        u.uCurve.value = curve
        u.uEdge.value = edge
        u.uDim.value = speed * dimMax
      }
    }
  },
}

type ReelSource = 'messages' | 'glyphs' | 'shapes' | 'custom'
