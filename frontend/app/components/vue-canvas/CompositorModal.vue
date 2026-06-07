<script setup lang="ts">
import {
  Image as ImageIcon, X, MousePointer2,
  Type, Square, Circle, Minus, Trash2,
  AlignLeft, AlignCenter, AlignRight, Bold, ArrowUp, ArrowDown, Lock, LockOpen,
} from 'lucide-vue-next'
import { TEMPLATE_FONTS } from '~~/shared/template-fonts'
import {
  type TextLayer, type RectLayer, type EllipseLayer, type LocalLayer, type StackItem,
  drawLocalLayer, drawWiredImageLayer, ensureLayerFonts, ensureLayerImages, paintLayerStack,
} from '~/composables/useCompositorLayers'
import { useLocalLayerEditor } from '~/composables/useLocalLayerEditor'
import { useVectorPen, buildPathLayerFromAnchors } from '~/composables/useVectorPen'
import { useVectorNodeEdit } from '~/composables/useVectorNodeEdit'
import { generateVectorFromText, vectorizeImage, urlToDataUrl } from '~/composables/useVectorAi'
import { imageLayerUrl } from '~/composables/useCompositorLayers'
import { useInpaint, loadImage, capDims, imageToDataUrl } from '~/composables/useInpaint'
import { PenTool, FileUp, Sparkles, Wand2, Undo2, Redo2, Scissors } from 'lucide-vue-next'
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Group, Ungroup,
} from 'lucide-vue-next'

const props = defineProps<{
  nodeId: string
  nodes: any[]
  edges: any[]
}>()

const emit = defineEmits<{ close: [] }>()

const { ensure: ensureGoogleFont } = useGoogleFontPreview()

const PROPS_PER_LAYER = ['x', 'y', 'rotation', 'scale', 'opacity', 'blend'] as const
const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft_light',
                     'hard_light', 'difference', 'lighten', 'darken', 'add']
const FONT_NAMES = TEMPLATE_FONTS.map(f => f.name)

const compositor = computed(() => props.nodes.find((n: any) => n.id === props.nodeId))

function getNodeImageUrl(node: any): string | null {
  if (node?.data?.images?.length) return node.data.images[0]
  if (node?.data?.nodeType === 'LoadImage' && node?.data?.widgetsValues?.[0]) {
    const filename = node.data.widgetsValues[0]
    return `/view?${new URLSearchParams({ filename, type: 'input' })}`
  }
  return null
}

// ── Wired image layers (connected to the Compositor's slots) ────────────────
interface Layer {
  slot: number
  url: string
  x: number; y: number
  rotation: number; scale: number
  opacity: number; blend: string
}

const layers = computed<Layer[]>(() => {
  const node = compositor.value
  if (!node) return []
  const defs = node.data.widgetDefs as any[]
  const wv = node.data.widgetsValues as any[]
  const widgetIdx = (name: string) => defs.findIndex((d: any) => d.name === name)
  const out: Layer[] = []
  // Keep in sync with `_MAX_LAYERS` in comfy_extras/nodes_compositor.py.
  for (let i = 1; i <= 16; i++) {
    const edge = props.edges.find((e: any) =>
      e.target === props.nodeId && e.targetHandle === `input-${i - 1}`)
    if (!edge) continue
    const source = props.nodes.find((n: any) => n.id === edge.source)
    if (!source) continue
    const url = getNodeImageUrl(source)
    if (!url) continue
    out.push({
      slot: i,
      url,
      x: wv[widgetIdx(`layer${i}_x`)] ?? 0,
      y: wv[widgetIdx(`layer${i}_y`)] ?? 0,
      rotation: wv[widgetIdx(`layer${i}_rotation`)] ?? 0,
      scale: wv[widgetIdx(`layer${i}_scale`)] ?? 1,
      opacity: wv[widgetIdx(`layer${i}_opacity`)] ?? 1,
      blend: wv[widgetIdx(`layer${i}_blend`)] ?? 'normal',
    })
  }
  return out
})

function setLayerProp(slot: number, prop: string, value: any) {
  const node = compositor.value
  if (!node) return
  const defs = node.data.widgetDefs as any[]
  const idx = defs.findIndex((d: any) => d.name === `layer${slot}_${prop}`)
  if (idx >= 0) node.data.widgetsValues[idx] = value
}

// ── Canvas sizing — match the artboard/base aspect so positions are exact ───
const naturalDims = ref<Record<number, { w: number; h: number }>>({})
function onImageLoad(slot: number, e: Event) {
  const img = e.target as HTMLImageElement
  naturalDims.value = { ...naturalDims.value, [slot]: { w: img.naturalWidth, h: img.naturalHeight } }
}
const baseAspect = computed(() => {
  const node = compositor.value
  const defs = node?.data?.widgetDefs as any[] | undefined
  const wv = node?.data?.widgetsValues as any[] | undefined
  if (defs && wv) {
    const wi = defs.findIndex((d: any) => d.name === 'width')
    const hi = defs.findIndex((d: any) => d.name === 'height')
    const fw = wi >= 0 ? Number(wv[wi]) || 0 : 0
    const fh = hi >= 0 ? Number(wv[hi]) || 0 : 0
    if (fw > 0 && fh > 0) return fw / fh
  }
  const base = layers.value[0]
  if (!base) return 1
  const d = naturalDims.value[base.slot]
  return d && d.h ? d.w / d.h : 1
})
const canvasDisplay = reactive({ w: 720, h: 720 })
watchEffect(() => {
  const a = baseAspect.value || 1
  const MAX = 760
  if (a >= 1) { canvasDisplay.w = MAX; canvasDisplay.h = Math.round(MAX / a) }
  else { canvasDisplay.h = MAX; canvasDisplay.w = Math.round(MAX * a) }
})

function fitSize(slot: number) {
  const dims = naturalDims.value[slot]
  if (!dims) return { w: canvasDisplay.w, h: canvasDisplay.h }
  const cAspect = canvasDisplay.w / canvasDisplay.h
  const iAspect = dims.w / dims.h
  if (iAspect > cAspect) return { w: canvasDisplay.w, h: canvasDisplay.w / iAspect }
  return { w: canvasDisplay.h * iAspect, h: canvasDisplay.h }
}
function layerCenter(layer: Layer) {
  return { x: canvasDisplay.w / 2 + layer.x * canvasDisplay.w, y: canvasDisplay.h / 2 + layer.y * canvasDisplay.h }
}

const canvasRef = ref<HTMLDivElement | null>(null)
function canvasRect(): DOMRect | null { return canvasRef.value?.getBoundingClientRect() ?? null }

// ── Local-layer editing engine (shared with the Frame node) ─────────────────
const editor = useLocalLayerEditor({
  node: () => compositor.value,
  dims: () => ({ w: canvasDisplay.w, h: canvasDisplay.h }),
  getRect: () => canvasRect(),
})
const {
  localLayers, setLocal, deleteLocal, selectLocal,
  selectedId: selectedLocalId, selected: selectedLocal,
  editingId, editingLayer, beginEdit, endEdit,
  boxPx, handlePositions: localHandlePositions,
  startScale: onLocalScalePointerDown, startRotate: onLocalRotatePointerDown,
  onCanvasPointerDown, onCanvasDblClick,
  addText, addRect, addEllipse, addLine, addImageFromFile, addImageFromName,
  addPathLayers, addPathFromSvg,
  undo, redo, canUndo, canRedo,
  selectedIds, selectedLayers, toggleSelect, applyBoolean, alignSelected, recordHistory, commit,
  groupSelected, ungroupSelected, canGroup, canUngroup,
  snapGuides, marquee, startMarquee, moveMarquee, endMarquee,
} = editor

const selectedCount = computed(() => selectedLayers.value.length)
const ALIGN_BTNS = [
  { mode: 'left', icon: AlignStartVertical, title: 'Align left' },
  { mode: 'hcenter', icon: AlignCenterVertical, title: 'Align horizontal centers' },
  { mode: 'right', icon: AlignEndVertical, title: 'Align right' },
  { mode: 'top', icon: AlignStartHorizontal, title: 'Align top' },
  { mode: 'vcenter', icon: AlignCenterHorizontal, title: 'Align vertical centers' },
  { mode: 'bottom', icon: AlignEndHorizontal, title: 'Align bottom' },
  { mode: 'hdist', icon: AlignHorizontalSpaceAround, title: 'Distribute horizontally' },
  { mode: 'vdist', icon: AlignVerticalSpaceAround, title: 'Distribute vertically' },
] as const

// ── Node edit (direct anchor/handle selection) ──────────────────────────────
const nodeEdit = useVectorNodeEdit()
const editDims = () => ({ w: canvasDisplay.w, h: canvasDisplay.h })

async function enterNodeEdit(id: string) {
  const l = localLayers.value.find(x => x.id === id)
  if (!l || l.kind !== 'path') return false
  selectLocal(id)
  return await nodeEdit.enter(l as any, editDims())
}
function exitNodeEdit() { nodeEdit.reset() }

// Outline box for a multi-selected layer (logical coords, rotated about center).
function multiOutlineStyle(l: any) {
  const b = boxPx(l)
  return {
    left: l.x * canvasDisplay.w + 'px', top: l.y * canvasDisplay.h + 'px',
    width: b.w + 'px', height: b.h + 'px',
    transform: `translate(-50%, -50%) rotate(${l.rotation || 0}deg)`,
  }
}

// Boolean ops work on any closed-outline shapes (paths + rect/ellipse/line,
// which get converted to paths). Available when ≥2 are selected.
const BOOLEANABLE = new Set(['path', 'rect', 'ellipse', 'line'])
const selectedPathCount = computed(() => selectedLayers.value.filter((l: any) => BOOLEANABLE.has(l.kind)).length)
const BOOL_OPS = [
  { op: 'unite', label: 'Unite' }, { op: 'subtract', label: 'Subtract' },
  { op: 'intersect', label: 'Intersect' }, { op: 'exclude', label: 'Exclude' },
] as const
function onNodePointerDown(e: PointerEvent) {
  const p = clientToNorm(e); if (!p) return
  if (nodeEdit.down(p.nx, p.ny)) { e.preventDefault(); e.stopPropagation() }
}
function onNodePointerMove(e: PointerEvent) {
  if (!nodeEdit.hot.value) return
  const p = clientToNorm(e); if (!p) return
  nodeEdit.move(p.nx, p.ny)
}
async function onNodePointerUp() {
  if (!nodeEdit.hot.value) return
  nodeEdit.up()
  await commitNodeEdit()
}
async function commitNodeEdit() {
  const rebuilt = await nodeEdit.buildLayer(editDims())
  if (!rebuilt || !nodeEdit.layerId.value) return
  rebuilt.id = nodeEdit.layerId.value // keep identity → in-place edit + clean undo
  recordHistory()
  commit(localLayers.value.map(l => (l.id === rebuilt.id ? rebuilt : l)))
}
async function deleteNodeAnchor() {
  nodeEdit.deleteSelected()
  await commitNodeEdit()
}

// ── Pen tool + SVG import ────────────────────────────────────────────────────
const pen = useVectorPen()
const PEN_STYLE = { fill: '#3b82f6', stroke: '', strokeWidth: 0 }

function clientToNorm(e: PointerEvent | MouseEvent) {
  const r = canvasRect(); if (!r) return null
  return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height }
}
function onPenPointerDown(e: PointerEvent) {
  const p = clientToNorm(e); if (!p) return
  e.preventDefault(); e.stopPropagation()
  if (pen.down(p.nx, p.ny) === 'closed') finishPen()
}
function onPenPointerMove(e: PointerEvent) {
  const p = clientToNorm(e); if (!p) return
  pen.move(p.nx, p.ny)
}
function onPenPointerUp() { pen.up() }
function finishPen() {
  const layer = buildPathLayerFromAnchors(
    pen.anchors.value, pen.draftClosed.value,
    { w: canvasDisplay.w, h: canvasDisplay.h }, PEN_STYLE,
  )
  pen.setActive(false)
  if (layer) addPathLayers([layer])
}
function togglePen() { pen.setActive(!pen.active.value); if (pen.active.value) { selectLocal(null); exitNodeEdit() } }
// Return to the default Select tool: leave pen/node-edit modes.
function selectTool() { if (pen.active.value) pen.setActive(false); if (nodeEdit.active.value) exitNodeEdit() }
const isSelectTool = computed(() => !pen.active.value && !nodeEdit.active.value)

const svgInputRef = ref<HTMLInputElement | null>(null)
function triggerImportSvg() { svgInputRef.value?.click() }
async function onImportSvgFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]; input.value = ''
  if (!file) return
  try { await addPathFromSvg(await file.text(), { targetWidth: 0.5 }) }
  catch (err) { console.error('[Compositor] SVG import failed:', err) }
}

// ── AI vector: text→SVG generate + raster→SVG vectorize ─────────────────────
const aiOpen = ref(false)
const aiPrompt = ref('')
const aiStyle = ref<'any' | 'line_art' | 'engraving' | 'linocut'>('any')
const aiBusy = ref(false)
const aiError = ref('')

// URL of the currently-selected image to vectorize (local image layer or wired).
const vectorizableUrl = computed<string | null>(() => {
  const l = selectedLocal.value
  if (l && l.kind === 'image') return imageLayerUrl(l.filename)
  if (selectedSlot.value != null) {
    const w = layers.value.find((x: any) => x.slot === selectedSlot.value)
    if (w?.url) return w.url as string
  }
  return null
})

async function runGenerate() {
  const prompt = aiPrompt.value.trim()
  if (!prompt || aiBusy.value) return
  aiBusy.value = true; aiError.value = ''
  try {
    const svg = await generateVectorFromText(prompt, { style: aiStyle.value })
    await addPathFromSvg(svg, { targetWidth: 0.7 })
    aiPrompt.value = ''
  } catch (err: any) {
    aiError.value = err?.data?.message || err?.message || 'Generation failed'
  } finally { aiBusy.value = false }
}

async function runVectorize(backend: 'local' | 'recraft') {
  const url = vectorizableUrl.value
  if (!url || aiBusy.value) return
  aiBusy.value = true; aiError.value = ''
  try {
    // Recraft needs a data URL it can ingest; local can fetch the URL itself.
    const image = backend === 'recraft' ? await urlToDataUrl(url) : url
    const svg = await vectorizeImage(image, { backend })
    await addPathFromSvg(svg, { targetWidth: 0.8 })
  } catch (err: any) {
    aiError.value = err?.data?.message || err?.message || 'Vectorize failed'
  } finally { aiBusy.value = false }
}

// Esc cancels an in-progress pen draft (before it bubbles to modal-close).
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && pen.active.value) { e.stopPropagation(); pen.setActive(false); return }
  if (e.key === 'Enter' && pen.active.value && pen.anchors.value.length >= 2) { e.preventDefault(); finishPen(); return }
  // V → Select tool (when not typing in a field).
  if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !editingId.value) {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') { selectTool(); return }
  }
  // Node edit: Esc/Enter exit, Delete removes the selected anchor.
  if (nodeEdit.active.value) {
    if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); exitNodeEdit(); return }
    if ((e.key === 'Delete' || e.key === 'Backspace') && nodeEdit.selected.value != null && !editingId.value) {
      e.preventDefault(); deleteNodeAnchor(); return
    }
  }
  // Undo/redo — skip while editing text so the textarea handles it natively.
  const meta = e.metaKey || e.ctrlKey
  if (meta && (e.key === 'z' || e.key === 'Z') && !editingId.value) {
    e.preventDefault(); e.stopPropagation()
    if (e.shiftKey) redo(); else undo()
  } else if (meta && (e.key === 'g' || e.key === 'G') && !editingId.value) {
    e.preventDefault(); e.stopPropagation()
    if (e.shiftKey) ungroupSelected(); else groupSelected()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))

// ── Selection: image slot OR local layer, mutually exclusive ────────────────
const selectedSlot = ref<number | null>(null)
const selected = computed(() => layers.value.find(l => l.slot === selectedSlot.value) ?? null)
function selectImage(slot: number) { selectedSlot.value = slot }
watch(selectedLocalId, (id) => { if (id != null) selectedSlot.value = null })
watch(selectedSlot, (s) => { if (s != null) selectLocal(null) })

// ── Unified z-order stack (mirrors ArtifactFrameNode's model) ───────────────
// Keys: `w:<slot>` for a wired image, `l:<id>` for a local layer. Persisted on
// the node as `comfynext_stackOrder`; array order is bottom→top. This is the
// single source of truth for depth — any layer can sit above or below any other.
type StackKey = string
function wiredKey(slot: number): StackKey { return `w:${slot}` }
function localKey(id: string): StackKey { return `l:${id}` }

const presentKeys = computed<StackKey[]>(() => [
  ...layers.value.map(l => wiredKey(l.slot)),
  ...localLayers.value.map(l => localKey(l.id)),
])
const stackKeys = computed<StackKey[]>(() => {
  const saved = ((compositor.value?.data?.properties as any)?.comfynext_stackOrder as StackKey[]) ?? []
  const present = new Set(presentKeys.value)
  const kept = saved.filter((k: string) => present.has(k))
  const keptSet = new Set(kept)
  return [...kept, ...presentKeys.value.filter(k => !keptSet.has(k))]
})
function moveStackZ(key: StackKey, dir: -1 | 1) {
  const arr = [...stackKeys.value]
  const i = arr.findIndex(k => k === key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  const node = compositor.value
  if (!node) return
  if (!node.data.properties) node.data.properties = {}
  ;(node.data.properties as any).comfynext_stackOrder = arr
}
function resolveStackKey(key: StackKey): { type: 'wired'; layer: Layer } | { type: 'local'; layer: any } | null {
  if (key.startsWith('w:')) {
    const slot = Number(key.slice(2))
    const layer = layers.value.find(l => l.slot === slot)
    return layer ? { type: 'wired', layer } : null
  }
  const id = key.slice(2)
  const layer = localLayers.value.find((l: any) => l.id === id)
  return layer ? { type: 'local', layer } : null
}
const selectedStackKey = computed<StackKey | null>(() => {
  if (selectedLocalId.value) return localKey(selectedLocalId.value)
  if (selectedSlot.value != null) return wiredKey(selectedSlot.value)
  return null
})
// Pre-resolved stack for the sidebar list (top-first).
const resolvedStack = computed(() =>
  [...stackKeys.value].reverse().map(key => {
    const r = resolveStackKey(key)
    return r ? { key, ...r } : null
  }).filter(Boolean) as { key: StackKey; type: 'wired' | 'local'; layer: any }[],
)

// Shared corner/rotation-handle geometry for a rotated box centered at (cx, cy).
function boxHandles(cx: number, cy: number, hw: number, hh: number, rotationDeg: number, scale = 1) {
  const rad = (rotationDeg * Math.PI) / 180
  const cosA = Math.cos(rad), sinA = Math.sin(rad)
  const transform = (dx: number, dy: number) => ({ x: cx + dx * cosA - dy * sinA, y: cy + dx * sinA + dy * cosA })
  return {
    tl: transform(-hw, -hh), tr: transform(hw, -hh), br: transform(hw, hh), bl: transform(-hw, hh),
    rot: transform(0, -hh - 30 / Math.max(scale, 0.1)), topCenter: transform(0, -hh), center: { x: cx, y: cy },
  }
}
const handlePositions = computed(() => {
  const layer = selected.value
  if (!layer || genActive.value) return null
  const { w: fitW, h: fitH } = fitSize(layer.slot)
  const c = layerCenter(layer)
  return boxHandles(c.x, c.y, (fitW / 2) * layer.scale, (fitH / 2) * layer.scale, layer.rotation, layer.scale)
})

// ── Image-layer drag / scale / rotate (wired slot transforms) ───────────────
interface DragMove { type: 'move'; slot: number; startMouseX: number; startMouseY: number; startX: number; startY: number }
interface DragScale { type: 'scale'; slot: number; startScale: number; centerX: number; centerY: number; startDist: number }
interface DragRotate { type: 'rotate'; slot: number; startAngle: number; startRotation: number; centerX: number; centerY: number }
type Drag = DragMove | DragScale | DragRotate | null
const drag = ref<Drag>(null)

function onLayerPointerDown(slot: number, e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  selectImage(slot)
  const layer = layers.value.find(l => l.slot === slot)
  if (!layer) return
  drag.value = { type: 'move', slot, startMouseX: e.clientX, startMouseY: e.clientY, startX: layer.x, startY: layer.y }
  attachPointerListeners()
}
function onScalePointerDown(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const layer = selected.value; const r = canvasRect()
  if (!layer || !r) return
  const c = layerCenter(layer)
  drag.value = { type: 'scale', slot: layer.slot, startScale: layer.scale, centerX: c.x, centerY: c.y, startDist: Math.hypot(e.clientX - r.left - c.x, e.clientY - r.top - c.y) }
  attachPointerListeners()
}
function onRotatePointerDown(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const layer = selected.value; const r = canvasRect()
  if (!layer || !r) return
  const c = layerCenter(layer)
  drag.value = { type: 'rotate', slot: layer.slot, startAngle: Math.atan2(e.clientY - r.top - c.y, e.clientX - r.left - c.x), startRotation: layer.rotation, centerX: c.x, centerY: c.y }
  attachPointerListeners()
}
function onPointerMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  if (d.type === 'move') {
    const dx = (e.clientX - d.startMouseX) / (canvasDisplay.w / 2)
    const dy = (e.clientY - d.startMouseY) / (canvasDisplay.h / 2)
    setLayerProp(d.slot, 'x', clamp(d.startX + dx, -1.5, 1.5))
    setLayerProp(d.slot, 'y', clamp(d.startY + dy, -1.5, 1.5))
  } else if (d.type === 'scale') {
    const r = canvasRect(); if (!r) return
    const dist = Math.hypot(e.clientX - r.left - d.centerX, e.clientY - r.top - d.centerY)
    setLayerProp(d.slot, 'scale', clamp(d.startScale * (d.startDist > 0 ? dist / d.startDist : 1), 0.1, 3.0))
  } else if (d.type === 'rotate') {
    const r = canvasRect(); if (!r) return
    const angle = Math.atan2(e.clientY - r.top - d.centerY, e.clientX - r.left - d.centerX)
    let rot = d.startRotation + ((angle - d.startAngle) * 180) / Math.PI
    while (rot > 180) rot -= 360
    while (rot < -180) rot += 360
    setLayerProp(d.slot, 'rotation', rot)
  }
}
function onPointerUp() { drag.value = null; detachPointerListeners() }
function attachPointerListeners() {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}
function detachPointerListeners() { window.removeEventListener('pointermove', onPointerMove) }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

// ── Canvas pointer routing ──────────────────────────────────────────────────
// Unified, z-aware hit test: walk the stack top→bottom and return the key of
// the first layer (wired image OR local shape) whose rotated box contains the
// point. Previously local shapes always won over wired images regardless of
// depth, so clicking an image sitting *on top* would grab a shape beneath it.
function hitTopStackKey(clientX: number, clientY: number): StackKey | null {
  const r = canvasRect(); if (!r) return null
  const W = canvasDisplay.w, H = canvasDisplay.h
  const px = ((clientX - r.left) / r.width) * W
  const py = ((clientY - r.top) / r.height) * H
  const inBox = (cx: number, cy: number, hw: number, hh: number, rotDeg: number) => {
    const rad = (-rotDeg * Math.PI) / 180
    const dx = px - cx, dy = py - cy
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
    return Math.abs(lx) <= hw && Math.abs(ly) <= hh
  }
  const keys = stackKeys.value
  for (let i = keys.length - 1; i >= 0; i--) {        // top → bottom
    const res = resolveStackKey(keys[i]); if (!res) continue
    if (res.type === 'wired') {
      const { w: fw, h: fh } = fitSize(res.layer.slot)
      const c = layerCenter(res.layer)
      if (inBox(c.x, c.y, (fw / 2) * res.layer.scale + 4, (fh / 2) * res.layer.scale + 4, res.layer.rotation)) return keys[i]
    } else {
      const l = res.layer
      const b = boxPx(l)
      if (inBox(l.x * W, l.y * H, b.w / 2 + 8, b.h / 2 + 8, l.rotation)) return keys[i]
    }
  }
  return null
}

function onCanvasPointerDownCapture(e: PointerEvent) {
  // Generate mode: brush/box paint the region; shape mode falls through so a
  // shape can still be selected (then promoted via "Use shape").
  if (genActive.value && (genTool.value === 'brush' || genTool.value === 'box')) { onGenPointerDown(e); return }
  if (pen.active.value) { onPenPointerDown(e); return } // pen mode owns the canvas
  if (nodeEdit.active.value) { onNodePointerDown(e); return } // node edit owns the canvas
  if ((e.target as HTMLElement)?.closest?.('[data-handle]')) return // a handle's own drag
  const key = hitTopStackKey(e.clientX, e.clientY)
  const res = key ? resolveStackKey(key) : null
  if (res?.type === 'wired') {
    // Topmost layer here is a wired image → move it, not a shape beneath it.
    lastDownHitLayer = true
    selectLocal(null)
    onLayerPointerDown(res.layer.slot, e) // selects slot + starts move (+ stops propagation)
  } else if (res?.type === 'local') {
    lastDownHitLayer = true
    onCanvasPointerDown(e) // local editor selects + starts move (+ stops propagation)
  } else {
    // Empty space → begin a marquee (rubber-band) selection.
    lastDownHitLayer = false
    selectedSlot.value = null
    if (!e.shiftKey) selectLocal(null)
    const p = clientToNorm(e)
    if (p) startMarquee(p.nx, p.ny)
  }
}
function onCanvasPointerMoveCapture(e: PointerEvent) {
  if (genActive.value) {
    if (genTool.value === 'brush') { const p = genPointFromEvent(e); if (p) { genCursor.x = p.x; genCursor.y = p.y; genCursor.on = true } }
    if (genDraw.value) { onGenPointerMove(e); return }
    if (genTool.value === 'brush' || genTool.value === 'box') return
  }
  if (pen.active.value) onPenPointerMove(e)
  else if (nodeEdit.active.value) onNodePointerMove(e)
  else if (marquee.value) { const p = clientToNorm(e); if (p) moveMarquee(p.nx, p.ny) }
}
function onCanvasPointerUpCapture(e: PointerEvent) {
  if (genActive.value && genDraw.value) { onGenPointerUp(e); return }
  if (pen.active.value) onPenPointerUp()
  else if (nodeEdit.active.value) onNodePointerUp()
  else if (marquee.value) endMarquee(e.shiftKey)
}
function onCanvasDblClickCapture(e: MouseEvent) {
  // Double-click a path → enter node edit; otherwise fall back to text edit.
  if (!pen.active.value && !nodeEdit.active.value) {
    const id = hitTopStackKey(e.clientX, e.clientY)
    const res = id ? resolveStackKey(id) : null
    if (res?.type === 'local' && res.layer.kind === 'path') {
      e.preventDefault(); e.stopPropagation(); enterNodeEdit(res.layer.id); return
    }
  }
  onCanvasDblClick(e)
}
// Set in onCanvasPointerDownCapture: was the just-completed press on a layer?
// Local shapes are painted on a pointer-events-none canvas, so the trailing
// `click` targets the artboard div — without this guard it would deselect the
// shape we just selected on pointer-down.
let lastDownHitLayer = false
function onCanvasClick(e: MouseEvent) {
  if (genActive.value && genTool.value !== 'shape') return // region-paint owns the canvas
  if (lastDownHitLayer) { lastDownHitLayer = false; return }
  if (e.target === canvasRef.value) { selectedSlot.value = null; selectLocal(null) }
}

// ── Text editing: focus the inline textarea when editing starts ─────────────
const editRef = ref<HTMLTextAreaElement | null>(null)
watch(editingId, (id) => { if (id) nextTick(() => { editRef.value?.focus(); editRef.value?.select() }) })
const editingStyle = computed(() => {
  const l = editingLayer.value
  if (!l) return {}
  const box = boxPx(l)
  return {
    left: l.x * canvasDisplay.w + 'px', top: l.y * canvasDisplay.h + 'px',
    width: Math.max(box.w + 8, 40) + 'px', height: Math.max(box.h + 6, 24) + 'px',
    transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
    fontFamily: /\s/.test(l.fontFamily) ? `"${l.fontFamily}", sans-serif` : `${l.fontFamily}, sans-serif`,
    fontWeight: String(l.fontWeight), fontSize: l.fontSize * canvasDisplay.w + 'px',
    lineHeight: String(l.lineHeight), color: l.color, textAlign: l.align as any,
    opacity: String(l.opacity), caretColor: l.color,
  }
})

// ── Unified stack canvas (wired + local layers in z-order → WYSIWYG) ────────
// One canvas draws everything interleaved by the unified stackKeys, so a local
// shape can sit below a wired image. Wired drawing uses the shared
// `drawWiredImageLayer` so the node and modal render pixel-identically.
const wiredImageEls = ref<Record<number, HTMLImageElement>>({})
function onWiredImageReady(slot: number, img: HTMLImageElement) {
  if (img.complete && img.naturalWidth) wiredImageEls.value = { ...wiredImageEls.value, [slot]: img }
}
function drawWiredLayer(ctx: CanvasRenderingContext2D, layer: Layer, W: number, H: number) {
  drawWiredImageLayer(ctx, wiredImageEls.value[layer.slot], layer, W, H)
}

const overlayCanvas = ref<HTMLCanvasElement | null>(null)
function renderStack() {
  const cv = overlayCanvas.value
  if (!cv) return
  const W = canvasDisplay.w, H = canvasDisplay.h
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  cv.width = Math.max(1, Math.round(W * dpr))
  cv.height = Math.max(1, Math.round(H * dpr))
  const ctx = cv.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const items = stackKeys.value.map((key): StackItem | null => {
    const r = resolveStackKey(key)
    if (!r) return null
    return r.type === 'wired'
      ? { type: 'wired', draw: (c, w, h) => drawWiredLayer(c, r.layer as Layer, w, h) }
      : { type: 'local', layer: r.layer as LocalLayer }
  }).filter((x): x is StackItem => x != null)
  paintLayerStack(ctx, W, H, items, localLayers.value as LocalLayer[], l =>
    l.id === editingId.value || (nodeEdit.active.value && l.id === nodeEdit.layerId.value))
}
watch(
  () => [
    JSON.stringify(localLayers.value), editingId.value,
    canvasDisplay.w, canvasDisplay.h,
    JSON.stringify(layers.value), JSON.stringify(stackKeys.value),
    Object.keys(wiredImageEls.value).length,
    nodeEdit.active.value, nodeEdit.layerId.value,
  ] as const,
  async () => {
    for (const l of localLayers.value) if (l.kind === 'text') ensureGoogleFont((l as TextLayer).fontFamily)
    await ensureLayerFonts(localLayers.value, canvasDisplay.w)
    await ensureLayerImages(localLayers.value)
    renderStack()
  },
  { immediate: true },
)

// ── Property-panel helpers ───────────────────────────────────────────────────
// Sizes read in true output px when the artboard has an explicit resolution
// (so the number is stable regardless of display/zoom); else fall back to the
// editor-canvas width.
const outWidth = computed(() => {
  const node = compositor.value
  const defs = node?.data?.widgetDefs as any[] | undefined
  const wv = node?.data?.widgetsValues as any[] | undefined
  const wi = defs?.findIndex((d: any) => d.name === 'width') ?? -1
  const w = wi >= 0 ? Number(wv?.[wi]) || 0 : 0
  return w || canvasDisplay.w
})
function pxW(norm: number) { return Math.round(norm * outWidth.value) }
function setSizePx(id: string, key: string, px: number) { setLocal(id, { [key]: Math.max(0, px) / outWidth.value }) }

// ── Drop-shadow layer effect ────────────────────────────────────────────────
// Stored on layer.effects as a single drop_shadow; rendered by drawLocalLayer
// (and baked identically). color is an rgba string (hex picker + opacity).
function parseRgba(s: string): { hex: string, a: number } {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s || '')
  if (m) {
    const hex = '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')
    return { hex, a: m[4] != null ? parseFloat(m[4]) : 1 }
  }
  return { hex: (s && s.startsWith('#')) ? s.slice(0, 7) : '#000000', a: 1 }
}
function composeRgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`
}
function localShadow(l: any): any | undefined { return l?.effects?.find((e: any) => e.type === 'drop_shadow') }
function shadowHex(l: any): string { return parseRgba(localShadow(l)?.color || '').hex }
function shadowAlpha(l: any): number { return parseRgba(localShadow(l)?.color || '').a }
function setLocalShadow(l: any, patch: Record<string, any>) {
  if (!l) return
  const cur = localShadow(l) || { type: 'drop_shadow', color: 'rgba(0, 0, 0, 0.35)', x: 0, y: 0.012, blur: 0.03, visible: true }
  const next = { ...cur, ...patch }
  setLocal(l.id, { effects: [...((l.effects || []).filter((e: any) => e.type !== 'drop_shadow')), next] })
}
function toggleLocalShadow(l: any) {
  if (!l) return
  if (localShadow(l)) setLocal(l.id, { effects: (l.effects || []).filter((e: any) => e.type !== 'drop_shadow') })
  else setLocalShadow(l, {})
}
function setShadowHex(l: any, raw: string) {
  let h = '#' + (raw || '').trim().replace(/^#/, '')
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(h)
  if (m3) h = '#' + m3[1].split('').map(c => c + c).join('')
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return // ignore partial/invalid input
  setLocalShadow(l, { color: composeRgba(h, shadowAlpha(l)) })
}

// ── Clip mask ───────────────────────────────────────────────────────────────
function layerMask(l: any): any | undefined { return l?.mask }
function setLayerMask(l: any, patch: Record<string, any>) {
  if (!l) return
  const cur = l.mask || {
    kind: 'ellipse',
    x: l.x ?? 0.5, y: l.y ?? 0.5,
    w: (l.w ?? 0.4), h: (l.h ?? l.w ?? 0.4),
  }
  setLocal(l.id, { mask: { ...cur, ...patch } })
}
function toggleLayerMask(l: any) {
  if (!l) return
  if (l.mask) setLocal(l.id, { mask: undefined })
  else setLayerMask(l, {})
}

// ── Layer blur effect ───────────────────────────────────────────────────────
function layerBlur(l: any): any | undefined { return l?.effects?.find((e: any) => e.type === 'layer_blur') }
function setLayerBlur(l: any, radius: number) {
  if (!l) return
  const others = (l.effects || []).filter((e: any) => e.type !== 'layer_blur')
  setLocal(l.id, { effects: radius > 0 ? [...others, { type: 'layer_blur', radius, visible: true }] : others })
}
function toggleLayerBlur(l: any) {
  if (!l) return
  if (layerBlur(l)) setLocal(l.id, { effects: (l.effects || []).filter((e: any) => e.type !== 'layer_blur') })
  else setLayerBlur(l, 0.02)
}

// ── Layer mask (this layer is clipped by another layer's silhouette) ─────────
function maskCandidates(l: any): any[] { return (localLayers.value as any[]).filter((o: any) => o.id !== l?.id) }
function layerLabel(l: any): string { return `${l.kind} ${String(l.id).slice(-4)}` }
function setLayerMaskedBy(l: any, id: string) { if (l) setLocal(l.id, { maskedById: id || undefined }) }

// ── Generative Fill: regenerate a region of an image in place ────────────────
// A "Generate" mode where you mark a region directly on the canvas — drag a Box,
// paint with a Brush, or promote a selected Shape — and inpaint ONLY that region
// of the target image (surrounding pixels are kept). The region is painted in
// artboard pixels and projected onto the target image's own pixels through the
// inverse of its draw transform, so it's correct under scale and rotation.
const inpaint = useInpaint()
const genPrompt = ref('')

type GenTool = 'box' | 'brush' | 'shape'
const GEN_TOOLS: GenTool[] = ['box', 'brush', 'shape']
const genActive = ref(false)
const genTool = ref<GenTool>('brush')
const genBrush = ref(56)                  // brush diameter, artboard px
const genTargetId = ref<string | null>(null)
const genVersion = ref(0)                 // bump → repaint the tinted overlay
const genHasMask = ref(false)
const genCursor = reactive({ x: -999, y: -999, on: false })

// Source-of-truth region mask: opaque white on transparent, in artboard px.
let genMaskCanvas: HTMLCanvasElement | null = null
function genMaskCtx(): CanvasRenderingContext2D | null {
  const W = Math.max(1, Math.round(canvasDisplay.w)), H = Math.max(1, Math.round(canvasDisplay.h))
  if (!genMaskCanvas) genMaskCanvas = document.createElement('canvas')
  if (genMaskCanvas.width !== W || genMaskCanvas.height !== H) { genMaskCanvas.width = W; genMaskCanvas.height = H }
  return genMaskCanvas.getContext('2d')
}
function clearGenMask() {
  const ctx = genMaskCtx()
  if (ctx && genMaskCanvas) ctx.clearRect(0, 0, genMaskCanvas.width, genMaskCanvas.height)
  genHasMask.value = false; genVersion.value++
}

// Target image layer: explicit pick → currently-selected image → topmost image.
const genTarget = computed<any | null>(() => {
  const pick = genTargetId.value && localLayers.value.find((l: any) => l.id === genTargetId.value && l.kind === 'image')
  if (pick) return pick
  if (selectedLocal.value?.kind === 'image') return selectedLocal.value
  return [...localLayers.value].reverse().find((l: any) => l.kind === 'image') || null
})
const genTargetLabel = computed(() => {
  const t = genTarget.value
  if (!t) return 'New layer'   // no image target → generate against the composite
  return `Image ${localLayers.value.filter((l: any) => l.kind === 'image').indexOf(t) + 1}`
})
const genShapeCandidate = computed(() => {
  const l = selectedLocal.value
  return l && (l.kind === 'rect' || l.kind === 'ellipse' || l.kind === 'path' || l.kind === 'line') ? l : null
})

function enterGenMode() {
  selectTool(); exitNodeEdit()
  if (pen.active.value) pen.setActive(false)
  aiOpen.value = false
  genActive.value = true
  genTargetId.value = genTarget.value?.id ?? null
  clearGenMask()
}
function exitGenMode() { genActive.value = false; genCursor.on = false; clearGenMask() }
function toggleGenMode() { genActive.value ? exitGenMode() : enterGenMode() }

// ── Region painting (all tools write into the one artboard-space mask) ───────
const genDraw = ref<{ tool: GenTool; x0: number; y0: number; lx: number; ly: number } | null>(null)
function genPointFromEvent(e: PointerEvent) {
  const p = clientToNorm(e); if (!p) return null
  return { x: p.nx * canvasDisplay.w, y: p.ny * canvasDisplay.h }
}
function genStrokeTo(x: number, y: number) {
  const ctx = genMaskCtx(); if (!ctx) return
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = genBrush.value
  if (genDraw.value) { ctx.beginPath(); ctx.moveTo(genDraw.value.lx, genDraw.value.ly); ctx.lineTo(x, y); ctx.stroke() }
  ctx.beginPath(); ctx.arc(x, y, genBrush.value / 2, 0, Math.PI * 2); ctx.fill()
}
function genBoxTo(x0: number, y0: number, x1: number, y1: number) {
  const ctx = genMaskCtx(); if (!ctx || !genMaskCanvas) return
  ctx.clearRect(0, 0, genMaskCanvas.width, genMaskCanvas.height)
  ctx.fillStyle = '#fff'
  ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
}
function onGenPointerDown(e: PointerEvent) {
  const p = genPointFromEvent(e); if (!p) return
  e.preventDefault(); e.stopPropagation()
  canvasRef.value?.setPointerCapture?.(e.pointerId)
  genDraw.value = { tool: genTool.value, x0: p.x, y0: p.y, lx: p.x, ly: p.y }
  if (genTool.value === 'brush') genStrokeTo(p.x, p.y)
  else genBoxTo(p.x, p.y, p.x, p.y)
  genHasMask.value = true; genVersion.value++
}
function onGenPointerMove(e: PointerEvent) {
  if (!genDraw.value) return
  const p = genPointFromEvent(e); if (!p) return
  e.preventDefault(); e.stopPropagation()
  if (genDraw.value.tool === 'brush') { genStrokeTo(p.x, p.y); genDraw.value.lx = p.x; genDraw.value.ly = p.y }
  else genBoxTo(genDraw.value.x0, genDraw.value.y0, p.x, p.y)
  genHasMask.value = true; genVersion.value++
}
function onGenPointerUp(e: PointerEvent) {
  if (!genDraw.value) return
  e.preventDefault(); e.stopPropagation()
  genDraw.value = null
}

// Fill a shape/path silhouette (the current fillStyle) — mirrors the renderer's
// per-kind geometry (1 unit = artboard width), so "Use shape" matches the canvas.
function drawMaskShape(ctx: CanvasRenderingContext2D, l: any, W: number) {
  if (l.kind === 'rect') {
    const w = l.w * W, h = l.h * W, r = Math.max(0, Math.min((l.radius || 0) * W, Math.min(w, h) / 2))
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r); ctx.fill()
  } else if (l.kind === 'ellipse') {
    const w = l.w * W, h = l.h * W
    ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill()
  } else if (l.kind === 'path') {
    try {
      const p = new Path2D(l.d), s = (l.scale || 1) * W
      ctx.save(); ctx.scale(s, s); ctx.fill(p, l.fillRule || 'nonzero'); ctx.restore()
    } catch { /* bad path data */ }
  } else if (l.kind === 'line') {
    const w = l.w * W
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0)
    ctx.lineCap = 'round'; ctx.lineWidth = Math.max(10, (l.strokeWidth || 0.01) * W); ctx.stroke()
  }
}
function genUseShape() {
  const l = genShapeCandidate.value; const ctx = genMaskCtx()
  if (!l || !ctx) return
  ctx.save()
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'
  ctx.translate(l.x * canvasDisplay.w, l.y * canvasDisplay.h)
  if (l.rotation) ctx.rotate((l.rotation * Math.PI) / 180)
  drawMaskShape(ctx, l, canvasDisplay.w)
  ctx.restore()
  genHasMask.value = true; genVersion.value++
}

// Tinted preview of the region mask (a separate visible canvas above the stack).
const genOverlayCanvas = ref<HTMLCanvasElement | null>(null)
function renderGenOverlay() {
  const cv = genOverlayCanvas.value; if (!cv) return
  const W = canvasDisplay.w, H = canvasDisplay.h
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr))
  const ctx = cv.getContext('2d'); if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  if (genMaskCanvas && genHasMask.value) {
    ctx.drawImage(genMaskCanvas, 0, 0, W, H)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = '#10b981'                 // emerald region tint
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
  }
}
watch([genVersion, genActive, () => canvasDisplay.w, () => canvasDisplay.h],
  () => nextTick(renderGenOverlay))

// Render the whole stack (wired + local, in z-order) to an offscreen canvas —
// the composited artboard, used as the inpaint base when no single image layer
// is the target (so generative fill works over wired images too).
function bakeStack(W: number, H: number): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!
  const items = stackKeys.value.map((key): StackItem | null => {
    const r = resolveStackKey(key)
    if (!r) return null
    return r.type === 'wired'
      ? { type: 'wired', draw: (c, w, h) => drawWiredLayer(c, r.layer as Layer, w, h) }
      : { type: 'local', layer: r.layer as LocalLayer }
  }).filter((x): x is StackItem => x != null)
  paintLayerStack(ctx, W, H, items, localLayers.value as LocalLayer[])
  return cv
}

// flux-dev's supported aspect ratios → nearest match for a region's bbox.
const FLUX_ASPECTS: [string, number][] = [
  ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['3:2', 3 / 2], ['2:3', 2 / 3],
  ['4:5', 4 / 5], ['5:4', 5 / 4], ['4:3', 4 / 3], ['3:4', 3 / 4], ['21:9', 21 / 9], ['9:21', 9 / 21],
]
function pickAspectRatio(r: number): string {
  let best = '1:1', bd = Infinity
  for (const [s, v] of FLUX_ASPECTS) { const d = Math.abs(Math.log(r / v)); if (d < bd) { bd = d; best = s } }
  return best
}
// Bounding box of the painted region (artboard px), or null if empty.
function genMaskBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!genMaskCanvas) return null
  const W = genMaskCanvas.width, H = genMaskCanvas.height
  const d = genMaskCanvas.getContext('2d')!.getImageData(0, 0, W, H).data
  let minX = W, minY = H, maxX = 0, maxY = 0, found = false
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 20) { found = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  }
  return found ? { minX, minY, maxX, maxY } : null
}
// Fraction of the painted region that overlaps real baked content (0..1) — the
// signal for smart routing: low → conjure a subject (text→image), high → inpaint.
function regionCoverage(baked: HTMLCanvasElement): number {
  if (!genMaskCanvas) return 0
  const S = 96
  const mc = document.createElement('canvas'); mc.width = S; mc.height = S
  const mctx = mc.getContext('2d')!; mctx.drawImage(genMaskCanvas, 0, 0, S, S)
  const md = mctx.getImageData(0, 0, S, S).data
  const bc = document.createElement('canvas'); bc.width = S; bc.height = S
  const bctx = bc.getContext('2d')!; bctx.drawImage(baked, 0, 0, S, S)
  const bd = bctx.getImageData(0, 0, S, S).data
  let region = 0, content = 0
  for (let i = 3; i < md.length; i += 4) { if (md[i] > 20) { region++; if (bd[i] > 20) content++ } }
  return region ? content / region : 0
}

// Generate inside the painted region. Two paths:
//  • a local image is the target → inpaint within its own pixels (project the
//    artboard region through the inverse of its draw transform) and replace it.
//  • otherwise → inpaint the composited artboard (context-aware, includes wired
//    images), keep ONLY the region, and drop it in as a new top layer so the
//    layers underneath stay intact.
async function runRegionFill() {
  if (!genHasMask.value || inpaint.busy.value || !genMaskCanvas) return
  const layer = genTarget.value
  try {
    if (layer) {
      const img = await loadImage(imageLayerUrl(layer.filename))
      const { w: capW, h: capH } = capDims(img.naturalWidth || 1024, img.naturalHeight || 1024)
      const imageData = imageToDataUrl(img, capW, capH)
      // Affine (artboard px → image px): inverse of the image's draw transform.
      const W = canvasDisplay.w, H = canvasDisplay.h
      const cx = layer.x * W, cy = layer.y * H
      const bw = (layer.w || 0.0001) * W, bh = (layer.h || 0.0001) * W
      const th = ((layer.rotation || 0) * Math.PI) / 180
      const cos = Math.cos(th), sin = Math.sin(th)
      const a = (capW * cos) / bw, c = (capW * sin) / bw
      const b = (-capH * sin) / bh, d = (capH * cos) / bh
      const e = capW / 2 - a * cx - c * cy
      const f = capH / 2 - b * cx - d * cy
      const mc = document.createElement('canvas'); mc.width = capW; mc.height = capH
      const mctx = mc.getContext('2d')!
      mctx.fillStyle = '#000'; mctx.fillRect(0, 0, capW, capH)   // BLACK = keep
      mctx.setTransform(a, b, c, d, e, f)
      mctx.drawImage(genMaskCanvas, 0, 0)                        // WHITE region = inpaint
      mctx.setTransform(1, 0, 0, 1, 0, 0)
      const results = await inpaint.fluxFill(imageData, mc.toDataURL('image/png'), genPrompt.value.trim())
      if (!results.length) return
      const newName = await inpaint.uploadDataUrl(results[0], 'compinpaint')
      setLocal(layer.id, { filename: newName })
    } else {
      // Composite path. Bake at artboard aspect (long side 1024).
      const W = canvasDisplay.w, H = canvasDisplay.h
      const long = 1024
      const bw = Math.max(1, Math.round(W >= H ? long : long * (W / H)))
      const bh = Math.max(1, Math.round(W >= H ? long * (H / W) : long))
      const baked = bakeStack(bw, bh)
      const prompt = genPrompt.value.trim()

      if (regionCoverage(baked) < 0.12) {
        // Little/no real content under the region → flux-fill would just sketch
        // on a blank base. Conjure a fresh subject (text→image) sized to the
        // region's bbox and drop it in there instead.
        const bnd = genMaskBounds(); if (!bnd) return
        const cx = (bnd.minX + bnd.maxX) / 2, cy = (bnd.minY + bnd.maxY) / 2
        const boxW = Math.max(1, bnd.maxX - bnd.minX), boxH = Math.max(1, bnd.maxY - bnd.minY)
        const results = await inpaint.text2img(prompt || 'subject, isolated on plain background', pickAspectRatio(boxW / boxH))
        if (!results.length) return
        const gi = await loadImage(results[0])
        const genAspect = (gi.naturalWidth || 1) / (gi.naturalHeight || 1)
        const name = await inpaint.uploadDataUrl(results[0], 'compgen')
        addImageFromName(name, genAspect, { x: cx / W, y: cy / H, w: boxW / W })
      } else {
        // Real content under the region → context-aware inpaint, keep only the
        // region as a patch so the layers underneath stay intact.
        const baseC = document.createElement('canvas'); baseC.width = bw; baseC.height = bh
        const bctx = baseC.getContext('2d')!
        bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, bw, bh)  // fill any transparent gaps
        bctx.drawImage(baked, 0, 0)
        const maskC = document.createElement('canvas'); maskC.width = bw; maskC.height = bh
        const xctx = maskC.getContext('2d')!
        xctx.fillStyle = '#000'; xctx.fillRect(0, 0, bw, bh)
        xctx.drawImage(genMaskCanvas, 0, 0, bw, bh)              // WHITE region = inpaint
        const results = await inpaint.fluxFill(baseC.toDataURL('image/png'), maskC.toDataURL('image/png'), prompt)
        if (!results.length) return
        const full = await loadImage(results[0])
        const patch = document.createElement('canvas'); patch.width = bw; patch.height = bh
        const pctx = patch.getContext('2d')!
        pctx.drawImage(full, 0, 0, bw, bh)
        pctx.globalCompositeOperation = 'destination-in'
        pctx.drawImage(genMaskCanvas, 0, 0, bw, bh)
        pctx.globalCompositeOperation = 'source-over'
        const newName = await inpaint.uploadDataUrl(patch.toDataURL('image/png'), 'compinpaint')
        addImageFromName(newName, bw / bh, { x: 0.5, y: 0.5, w: 1, h: H / W })
      }
    }
    clearGenMask()
  } catch (err) {
    console.error('[compositor inpaint]', err)
  }
}

// Cloud background removal — replace an image layer with its transparent cutout.
async function removeImageBg(layer: any) {
  if (!layer || layer.kind !== 'image' || inpaint.busy.value) return
  try {
    const img = await loadImage(imageLayerUrl(layer.filename))
    const { w, h } = capDims(img.naturalWidth || 1024, img.naturalHeight || 1024)
    const dataUrl = imageToDataUrl(img, w, h)
    const cutout = await inpaint.removeBackground(dataUrl)
    const name = await inpaint.uploadDataUrl(cutout, 'compnobg')
    setLocal(layer.id, { filename: name })
  } catch (err) {
    console.error('[compositor remove-bg]', err)
  }
}

// W/H editing for shapes, with an optional aspect-ratio lock. Both w and h are
// normalized to the artboard width (the layer model's convention), so a single
// outWidth conversion works for either axis. When locked, editing one axis
// scales the other by the same factor.
const lockRatio = ref(true)
function setDimPx(l: any, key: 'w' | 'h', px: number) {
  const next = Math.max(0, px) / outWidth.value
  const other = key === 'w' ? 'h' : 'w'
  if (lockRatio.value && l[key] > 0 && typeof l[other] === 'number') {
    const ratio = next / l[key]
    setLocal(l.id, { [key]: next, [other]: Math.max(0.002, l[other] * ratio) })
  } else {
    setLocal(l.id, { [key]: next })
  }
}
function toggleFill(l: RectLayer | EllipseLayer) { setLocal(l.id, { fill: l.fill && l.fill !== 'none' ? 'none' : '#3b82f6' }) }
function kindIcon(kind: string) {
  return kind === 'text' ? Type : kind === 'rect' ? Square
    : kind === 'ellipse' ? Circle : kind === 'image' ? ImageIcon : Minus
}

// ── Add an image layer from the toolbar ─────────────────────────────────────
const imageInputRef = ref<HTMLInputElement | null>(null)
function triggerAddImage() { imageInputRef.value?.click() }
async function onAddImageFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) { try { await addImageFromFile(file) } catch (err) { console.error('[Compositor] add image failed:', err) } }
}

function handleKeydown(e: KeyboardEvent) {
  const ae = document.activeElement
  const typing = ae instanceof Element && ae.matches('input, textarea, [contenteditable]')
  if (e.key === 'Escape') {
    if (editingId.value) { endEdit(); return }
    if (typing) return
    if (genActive.value) { exitGenMode(); return }
    emit('close')
    return
  }
  // Don't delete the target layer while painting a generative-fill region.
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLocalId.value && !typing && !genActive.value) {
    e.preventDefault()
    deleteLocal(selectedLocalId.value)
  }
}
onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  detachPointerListeners()
})
</script>

<template>
  <div
    class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
    @click.self="emit('close')"
  >
    <div class="w-full h-full max-w-[1400px] max-h-[900px] bg-[#0a0a0a] rounded-xl border border-white/10 shadow-2xl flex text-white/85 overflow-hidden">
    <!-- Left sidebar -->
    <div class="w-64 border-r border-white/10 flex flex-col shrink-0">
      <div class="px-4 py-3 border-b border-white/10">
        <h2 class="text-sm font-semibold tracking-tight">Compositor</h2>
      </div>
      <div class="p-3 flex-1 overflow-y-auto">
        <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-2 px-1">Layers</div>

        <!-- Unified z-order stack (top-first, same model as the Frame) -->
        <template v-for="item in resolvedStack" :key="item.key">
          <div
            v-if="item.type === 'local'"
            class="group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors"
            :class="selectedLocalId === item.layer.id ? 'bg-white/10' : 'hover:bg-white/[0.04]'"
            @click="selectLocal(item.layer.id)"
            @dblclick="item.layer.kind === 'text' && beginEdit(item.layer.id)"
          >
            <component :is="kindIcon(item.layer.kind)" class="size-3.5 text-white/60 shrink-0" />
            <span class="text-sm truncate flex-1">
              {{ item.layer.kind === 'text' ? (item.layer.text?.split('\n')[0] || 'Text') : item.layer.kind }}
            </span>
            <button
              class="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition"
              title="Delete"
              @click.stop="deleteLocal(item.layer.id)"
            >
              <Trash2 class="size-3.5" />
            </button>
          </div>
          <div
            v-else
            class="group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors"
            :class="selectedSlot === item.layer.slot ? 'bg-white/10' : 'hover:bg-white/[0.04]'"
            @click="selectImage(item.layer.slot)"
          >
            <ImageIcon class="size-3.5 text-white/60 shrink-0" />
            <span class="text-sm">Layer {{ item.layer.slot }}</span>
          </div>
        </template>
        <div v-if="!layers.length && !localLayers.length" class="text-xs text-white/30 px-1 py-2 italic">
          Connect images to the Compositor's layer ports, or add text/shapes below.
        </div>
      </div>
    </div>

    <!-- Center canvas -->
    <div class="flex-1 relative flex items-center justify-center overflow-hidden">
      <button
        class="absolute top-4 right-4 z-10 flex items-center justify-center size-8 rounded-md bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
        title="Close (Esc)"
        @click="emit('close')"
      >
        <X class="size-4" />
      </button>

      <div
        ref="canvasRef"
        class="relative bg-[#1a1a1a] rounded-md overflow-hidden ring-1 ring-white/5"
        :class="(pen.active.value || nodeEdit.active.value || (genActive && genTool === 'box')) ? 'cursor-crosshair' : (genActive && genTool === 'brush') ? 'cursor-none' : ''"
        :style="{ width: canvasDisplay.w + 'px', height: canvasDisplay.h + 'px' }"
        @click="onCanvasClick"
        @pointerdown.capture="onCanvasPointerDownCapture"
        @pointermove="onCanvasPointerMoveCapture"
        @pointerup="onCanvasPointerUpCapture"
        @pointerleave="genCursor.on = false"
        @dblclick.capture="onCanvasDblClickCapture"
      >
        <!-- Invisible <img> elements: kept for @load (natural dims) and pointer interaction.
             The unified stack canvas below handles all visual rendering. -->
        <img
          v-for="layer in layers"
          :key="layer.slot"
          :src="layer.url"
          draggable="false"
          class="absolute inset-0 w-full h-full object-contain origin-center select-none touch-none"
          :style="{
            transform: `translate(${layer.x * 100}%, ${layer.y * 100}%) rotate(${layer.rotation}deg) scale(${layer.scale})`,
            opacity: 0,
            cursor: drag?.type === 'move' && drag.slot === layer.slot ? 'grabbing' : 'grab',
            zIndex: 10,
          }"
          @load="(e: Event) => { onImageLoad(layer.slot, e); onWiredImageReady(layer.slot, e.target as HTMLImageElement) }"
          @pointerdown="onLayerPointerDown(layer.slot, $event)"
        />

        <!-- Unified stack canvas: wired + local layers in z-order (WYSIWYG) -->
        <canvas
          ref="overlayCanvas"
          class="absolute inset-0 pointer-events-none"
          :style="{ width: canvasDisplay.w + 'px', height: canvasDisplay.h + 'px' }"
        />

        <!-- Generative-fill region overlay (tinted mask preview) -->
        <canvas
          v-show="genActive"
          ref="genOverlayCanvas"
          class="absolute inset-0 pointer-events-none"
          :style="{ width: canvasDisplay.w + 'px', height: canvasDisplay.h + 'px', opacity: 0.55 }"
        />
        <!-- Brush cursor ring -->
        <div
          v-if="genActive && genTool === 'brush' && genCursor.on"
          class="absolute pointer-events-none rounded-full border border-emerald-300/90 bg-emerald-300/10"
          :style="{ left: (genCursor.x - genBrush / 2) + 'px', top: (genCursor.y - genBrush / 2) + 'px', width: genBrush + 'px', height: genBrush + 'px', zIndex: 30 }"
        />

        <!-- Multi-select outlines (when 2+ layers selected) -->
        <template v-if="selectedCount > 1 && !nodeEdit.active.value && !genActive">
          <div v-for="l in selectedLayers" :key="'ms-' + l.id"
            class="absolute pointer-events-none border border-cyan-400/70 rounded-[1px]"
            :style="multiOutlineStyle(l)" />
        </template>

        <!-- Snap guides (while dragging) -->
        <div v-if="snapGuides.vx != null" class="absolute top-0 bottom-0 w-px bg-fuchsia-400/80 pointer-events-none"
          :style="{ left: snapGuides.vx * canvasDisplay.w + 'px' }" />
        <div v-if="snapGuides.hy != null" class="absolute left-0 right-0 h-px bg-fuchsia-400/80 pointer-events-none"
          :style="{ top: snapGuides.hy * canvasDisplay.h + 'px' }" />

        <!-- Marquee (rubber-band) selection rect -->
        <div v-if="marquee" class="absolute border border-cyan-300/80 bg-cyan-300/10 pointer-events-none"
          :style="{
            left: Math.min(marquee.x0, marquee.x1) * canvasDisplay.w + 'px',
            top: Math.min(marquee.y0, marquee.y1) * canvasDisplay.h + 'px',
            width: Math.abs(marquee.x1 - marquee.x0) * canvasDisplay.w + 'px',
            height: Math.abs(marquee.y1 - marquee.y0) * canvasDisplay.h + 'px',
          }" />

        <!-- Pen-tool draft overlay: live path preview + anchor dots (0..100 vb) -->
        <svg
          v-if="pen.active.value"
          class="absolute inset-0 pointer-events-none"
          :style="{ width: canvasDisplay.w + 'px', height: canvasDisplay.h + 'px' }"
          viewBox="0 0 100 100" preserveAspectRatio="none"
        >
          <path :d="pen.previewD.value" fill="none" stroke="#22d3ee" stroke-width="0.4"
            vector-effect="non-scaling-stroke" />
          <g v-for="(a, i) in pen.anchors.value" :key="i">
            <circle :cx="a.x * 100" :cy="a.y * 100" r="0.8" :fill="i === 0 ? '#fde047' : '#22d3ee'"
              vector-effect="non-scaling-stroke" stroke="#0a0a0a" stroke-width="0.3" />
          </g>
        </svg>

        <!-- Node-edit overlay: live path + bezier handles + anchor points -->
        <svg
          v-if="nodeEdit.active.value"
          class="absolute inset-0 pointer-events-none"
          :style="{ width: canvasDisplay.w + 'px', height: canvasDisplay.h + 'px' }"
          viewBox="0 0 100 100" preserveAspectRatio="none"
        >
          <path :d="nodeEdit.previewD.value" fill="none" stroke="#22d3ee" stroke-width="0.4" vector-effect="non-scaling-stroke" />
          <template v-for="(s, i) in nodeEdit.segments.value" :key="i">
            <template v-if="i === nodeEdit.selected.value">
              <line v-if="s.inH" :x1="s.point.x*100" :y1="s.point.y*100" :x2="s.inH.x*100" :y2="s.inH.y*100"
                stroke="#22d3ee" stroke-width="0.25" vector-effect="non-scaling-stroke" />
              <line v-if="s.outH" :x1="s.point.x*100" :y1="s.point.y*100" :x2="s.outH.x*100" :y2="s.outH.y*100"
                stroke="#22d3ee" stroke-width="0.25" vector-effect="non-scaling-stroke" />
              <circle v-if="s.inH" :cx="s.inH.x*100" :cy="s.inH.y*100" r="0.7" fill="#0a0a0a" stroke="#22d3ee" stroke-width="0.3" vector-effect="non-scaling-stroke" />
              <circle v-if="s.outH" :cx="s.outH.x*100" :cy="s.outH.y*100" r="0.7" fill="#0a0a0a" stroke="#22d3ee" stroke-width="0.3" vector-effect="non-scaling-stroke" />
            </template>
            <rect :x="s.point.x*100 - 0.8" :y="s.point.y*100 - 0.8" width="1.6" height="1.6"
              :fill="i === nodeEdit.selected.value ? '#fde047' : '#22d3ee'" stroke="#0a0a0a" stroke-width="0.3" vector-effect="non-scaling-stroke" />
          </template>
        </svg>

        <!-- Inline text editor -->
        <textarea
          v-if="editingLayer"
          ref="editRef"
          :value="editingLayer.text"
          class="absolute bg-transparent outline-none resize-none overflow-hidden border border-dashed border-yellow-400/70 px-0.5 nopan nodrag"
          :style="editingStyle"
          @input="setLocal(editingLayer!.id, { text: ($event.target as HTMLTextAreaElement).value })"
          @blur="endEdit"
          @keydown.escape.prevent="endEdit"
          @pointerdown.stop
        />

        <!-- Image-layer selection / handles -->
        <svg
          v-if="handlePositions"
          class="absolute inset-0 w-full h-full pointer-events-none"
          :viewBox="`0 0 ${canvasDisplay.w} ${canvasDisplay.h}`"
        >
          <polygon
            :points="`${handlePositions.tl.x},${handlePositions.tl.y} ${handlePositions.tr.x},${handlePositions.tr.y} ${handlePositions.br.x},${handlePositions.br.y} ${handlePositions.bl.x},${handlePositions.bl.y}`"
            fill="none" stroke="#facc15" stroke-width="2" vector-effect="non-scaling-stroke"
          />
          <line
            :x1="handlePositions.topCenter.x" :y1="handlePositions.topCenter.y"
            :x2="handlePositions.rot.x" :y2="handlePositions.rot.y"
            stroke="#facc15" stroke-width="2" vector-effect="non-scaling-stroke"
          />
        </svg>
        <template v-if="handlePositions">
          <div
            v-for="corner in ['tl', 'tr', 'br', 'bl']"
            :key="corner"
            data-handle
            class="absolute z-20 size-2.5 bg-white border border-yellow-400 cursor-nwse-resize"
            :style="{ left: handlePositions[corner].x + 'px', top: handlePositions[corner].y + 'px', transform: 'translate(-50%, -50%)' }"
            @pointerdown="onScalePointerDown($event)"
          />
          <div
            data-handle
            class="absolute z-20 size-3 rounded-full bg-yellow-400 cursor-grab border-2 border-[#1a1a1a]"
            :style="{ left: handlePositions.rot.x + 'px', top: handlePositions.rot.y + 'px', transform: 'translate(-50%, -50%)' }"
            @pointerdown="onRotatePointerDown($event)"
          />
        </template>

        <!-- Local-layer selection / handles -->
        <svg
          v-if="localHandlePositions && !editingId && !genActive"
          class="absolute inset-0 w-full h-full pointer-events-none"
          :viewBox="`0 0 ${canvasDisplay.w} ${canvasDisplay.h}`"
        >
          <polygon
            :points="`${localHandlePositions.tl.x},${localHandlePositions.tl.y} ${localHandlePositions.tr.x},${localHandlePositions.tr.y} ${localHandlePositions.br.x},${localHandlePositions.br.y} ${localHandlePositions.bl.x},${localHandlePositions.bl.y}`"
            fill="none" stroke="#22d3ee" stroke-width="2" vector-effect="non-scaling-stroke"
          />
          <line
            :x1="localHandlePositions.topCenter.x" :y1="localHandlePositions.topCenter.y"
            :x2="localHandlePositions.rot.x" :y2="localHandlePositions.rot.y"
            stroke="#22d3ee" stroke-width="2" vector-effect="non-scaling-stroke"
          />
        </svg>
        <template v-if="localHandlePositions && !editingId && !genActive">
          <div
            v-for="corner in ['tl', 'tr', 'br', 'bl']"
            :key="'l-' + corner"
            data-handle
            class="absolute z-20 size-2.5 bg-white border border-cyan-400 cursor-nwse-resize"
            :style="{ left: localHandlePositions[corner].x + 'px', top: localHandlePositions[corner].y + 'px', transform: 'translate(-50%, -50%)' }"
            @pointerdown="onLocalScalePointerDown($event)"
          />
          <div
            data-handle
            class="absolute z-20 size-3 rounded-full bg-cyan-400 cursor-grab border-2 border-[#1a1a1a]"
            :style="{ left: localHandlePositions.rot.x + 'px', top: localHandlePositions.rot.y + 'px', transform: 'translate(-50%, -50%)' }"
            @pointerdown="onLocalRotatePointerDown($event)"
          />
        </template>
      </div>

      <!-- Multi-select bar: align/distribute (any ≥2) + booleans (≥2 paths) -->
      <div
        v-if="selectedCount >= 2 && !nodeEdit.active.value"
        class="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#1a1a1a]/95 backdrop-blur-sm rounded-[10px] p-1 border border-[#2a2a2a] shadow-lg"
        @pointerdown.stop
      >
        <button v-for="a in ALIGN_BTNS" :key="a.mode"
          class="flex items-center justify-center size-7 rounded-md hover:bg-white/12 text-white/80 cursor-pointer disabled:opacity-25"
          :disabled="(a.mode === 'hdist' || a.mode === 'vdist') && selectedCount < 3"
          :title="a.title" @click="alignSelected(a.mode)">
          <component :is="a.icon" class="size-4" />
        </button>
        <div class="w-px h-5 bg-white/10 mx-0.5" />
        <button class="flex items-center justify-center size-7 rounded-md hover:bg-white/12 text-white/80 cursor-pointer disabled:opacity-25"
          :disabled="!canGroup" title="Group (⌘G)" @click="groupSelected"><Group class="size-4" /></button>
        <button class="flex items-center justify-center size-7 rounded-md hover:bg-white/12 text-white/80 cursor-pointer disabled:opacity-25"
          :disabled="!canUngroup" title="Ungroup (⌘⇧G)" @click="ungroupSelected"><Ungroup class="size-4" /></button>
        <template v-if="selectedPathCount >= 2">
          <div class="w-px h-5 bg-white/10 mx-0.5" />
          <button v-for="b in BOOL_OPS" :key="b.op"
            class="h-7 px-2 rounded-md bg-white/[0.06] hover:bg-white/12 text-[11px] text-white/85 cursor-pointer"
            @click="applyBoolean(b.op)">{{ b.label }}</button>
        </template>
      </div>
      <div
        v-else-if="nodeEdit.active.value"
        class="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-cyan-500/15 backdrop-blur-sm rounded-[10px] px-3 py-1.5 border border-cyan-400/30 shadow-lg text-[11px] text-cyan-200"
        @pointerdown.stop
      >
        Editing path nodes — drag points & handles · Del removes a point ·
        <button class="underline hover:text-white cursor-pointer" @click="exitNodeEdit">Done (Esc)</button>
      </div>

      <!-- AI vector panel (floats above the toolbar) -->
      <div
        v-if="aiOpen"
        class="absolute bottom-[68px] w-[340px] bg-[#1a1a1a]/97 backdrop-blur-sm rounded-[12px] p-3 border border-[#2a2a2a] shadow-xl text-white/85"
        @pointerdown.stop
      >
        <div class="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wide text-white/40">
          <Sparkles class="size-3.5" /> Generate vector
        </div>
        <textarea
          v-model="aiPrompt"
          rows="2"
          placeholder="a minimalist mountain logo, flat vector…"
          class="w-full bg-white/[0.06] rounded-md text-[12px] px-2 py-1.5 outline-none resize-none placeholder:text-white/25"
          @keydown.enter.exact.prevent="runGenerate"
        />
        <div class="flex items-center gap-1.5 mt-2">
          <select v-model="aiStyle" class="h-7 bg-white/[0.06] rounded text-[11px] px-1 outline-none cursor-pointer">
            <option value="any">Any</option>
            <option value="line_art">Line art</option>
            <option value="engraving">Engraving</option>
            <option value="linocut">Linocut</option>
          </select>
          <button
            class="flex-1 h-7 rounded-md bg-fuchsia-500/90 hover:bg-fuchsia-500 text-black text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default"
            :disabled="aiBusy || !aiPrompt.trim()"
            @click="runGenerate"
          >{{ aiBusy ? 'Generating…' : 'Generate' }}</button>
        </div>

        <div class="mt-3 pt-2.5 border-t border-white/10">
          <div class="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wide text-white/40">
            <Wand2 class="size-3.5" /> Vectorize selected image
          </div>
          <div v-if="vectorizableUrl" class="flex items-center gap-1.5">
            <button
              class="flex-1 h-7 rounded-md bg-white/10 hover:bg-white/15 text-[12px] cursor-pointer disabled:opacity-40"
              :disabled="aiBusy" title="Free local VTracer"
              @click="runVectorize('local')"
            >{{ aiBusy ? '…' : 'Trace (free)' }}</button>
            <button
              class="flex-1 h-7 rounded-md bg-white/10 hover:bg-white/15 text-[12px] cursor-pointer disabled:opacity-40"
              :disabled="aiBusy" title="Recraft — higher fidelity, paid"
              @click="runVectorize('recraft')"
            >Recraft</button>
          </div>
          <div v-else class="text-[11px] text-white/30">Select an image layer to vectorize.</div>
        </div>

        <div v-if="aiError" class="mt-2 text-[11px] text-rose-400">{{ aiError }}</div>
      </div>

      <!-- Bottom toolbar -->
      <div class="absolute bottom-4 flex items-center gap-1 bg-[#1a1a1a]/95 backdrop-blur-sm rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg">
        <button
          class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer"
          :class="isSelectTool ? 'bg-yellow-400/90 text-black' : 'hover:bg-white/10 text-white/80'"
          title="Select (V)" @click="selectTool">
          <MousePointer2 class="size-4" />
        </button>
        <div class="w-px h-5 bg-white/10 mx-0.5" />
        <button class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer disabled:opacity-30 hover:bg-white/10 text-white/80"
          title="Undo (⌘Z)" :disabled="!canUndo" @click="undo">
          <Undo2 class="size-4" />
        </button>
        <button class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer disabled:opacity-30 hover:bg-white/10 text-white/80"
          title="Redo (⌘⇧Z)" :disabled="!canRedo" @click="redo">
          <Redo2 class="size-4" />
        </button>
        <div class="w-px h-5 bg-white/10 mx-0.5" />
        <button class="flex items-center justify-center size-8 rounded-[8px] hover:bg-white/10 text-white/80 cursor-pointer" title="Add text" @click="addText">
          <Type class="size-4" />
        </button>
        <button class="flex items-center justify-center size-8 rounded-[8px] hover:bg-white/10 text-white/80 cursor-pointer" title="Add rectangle" @click="addRect">
          <Square class="size-4" />
        </button>
        <button class="flex items-center justify-center size-8 rounded-[8px] hover:bg-white/10 text-white/80 cursor-pointer" title="Add ellipse" @click="addEllipse">
          <Circle class="size-4" />
        </button>
        <button class="flex items-center justify-center size-8 rounded-[8px] hover:bg-white/10 text-white/80 cursor-pointer" title="Add line" @click="addLine">
          <Minus class="size-4" />
        </button>
        <button
          class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer"
          :class="pen.active.value ? 'bg-cyan-400/90 text-black' : 'hover:bg-white/10 text-white/80'"
          title="Pen — click to add points, drag for curves, click the first point or Enter to finish, Esc to cancel"
          @click="togglePen"
        >
          <PenTool class="size-4" />
        </button>
        <button class="flex items-center justify-center size-8 rounded-[8px] hover:bg-white/10 text-white/80 cursor-pointer" title="Import SVG" @click="triggerImportSvg">
          <FileUp class="size-4" />
        </button>
        <button
          class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer"
          :class="aiOpen ? 'bg-fuchsia-400/90 text-black' : 'hover:bg-white/10 text-white/80'"
          title="AI vector — generate from text or vectorize a selected image"
          @click="aiOpen = !aiOpen"
        >
          <Sparkles class="size-4" />
        </button>
        <button
          class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer"
          :class="genActive ? 'bg-emerald-400/90 text-black' : 'hover:bg-white/10 text-white/80'"
          title="Generate in region — mark an area (box, brush, or shape) and regenerate just that part of an image"
          @click="toggleGenMode"
        >
          <Wand2 class="size-4" />
        </button>
        <button class="flex items-center justify-center size-8 rounded-[8px] hover:bg-white/10 text-white/80 cursor-pointer" title="Add image" @click="triggerAddImage">
          <ImageIcon class="size-4" />
        </button>
        <input ref="imageInputRef" type="file" accept="image/*" class="hidden" @change="onAddImageFile" />
        <input ref="svgInputRef" type="file" accept=".svg,image/svg+xml" class="hidden" @change="onImportSvgFile" />
      </div>
    </div>

    <!-- Right sidebar: properties -->
    <div class="w-72 border-l border-white/10 shrink-0 flex flex-col">
      <!-- Generate-in-region controls (mode owns the inspector) -->
      <template v-if="genActive">
        <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Wand2 class="size-3.5 text-emerald-400" />
          <span class="text-sm font-medium">Generate in region</span>
          <button class="ml-auto text-white/40 hover:text-white/80 p-1" title="Done (Esc)" @click="exitGenMode"><X class="size-3.5" /></button>
        </div>
        <div class="p-4 flex flex-col gap-3 overflow-y-auto">
          <!-- Target -->
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-white/40">Target</span>
            <span class="text-emerald-300/90">{{ genTargetLabel }}</span>
          </div>

          <!-- Region tool -->
          <div>
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Region</div>
            <div class="flex items-center gap-1 p-0.5 rounded-md bg-white/[0.05]">
              <button v-for="t in GEN_TOOLS" :key="t"
                class="flex-1 h-7 rounded text-[11px] capitalize cursor-pointer transition-colors"
                :class="genTool === t ? 'bg-emerald-500/90 text-black font-medium' : 'text-white/70 hover:bg-white/10'"
                @click="genTool = t">{{ t }}</button>
            </div>
            <div v-if="genTool === 'brush'" class="flex items-center gap-2 mt-2">
              <span class="text-[10px] text-white/40 w-9 shrink-0">Brush</span>
              <input type="range" min="8" max="240" step="2" v-model.number="genBrush" class="flex-1 accent-emerald-400 cursor-pointer" />
              <span class="text-[10px] text-white/50 w-8 text-right tabular-nums">{{ genBrush }}</span>
            </div>
            <button v-else-if="genTool === 'shape'"
              class="w-full h-7 mt-2 rounded-md bg-white/10 hover:bg-white/15 text-[12px] cursor-pointer disabled:opacity-40 disabled:cursor-default"
              :disabled="!genShapeCandidate" @click="genUseShape"
            >{{ genShapeCandidate ? 'Use selected shape →' : 'Select a shape/path first' }}</button>
            <p v-else class="text-[10px] text-white/35 mt-2">Drag a box over the canvas.</p>
          </div>

          <!-- Prompt -->
          <div>
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Prompt</div>
            <textarea
              v-model="genPrompt"
              rows="3"
              placeholder="what to generate in the region…"
              class="w-full bg-white/[0.06] rounded-md text-[12px] px-2 py-1.5 outline-none resize-none placeholder:text-white/25"
              @keydown.enter.exact.prevent="runRegionFill"
            />
          </div>

          <div class="flex items-center gap-1.5">
            <button
              class="h-8 px-2.5 rounded-md bg-white/[0.06] hover:bg-white/12 text-[11px] cursor-pointer disabled:opacity-30 disabled:cursor-default"
              :disabled="!genHasMask" title="Clear region" @click="clearGenMask"
            >Clear</button>
            <button
              class="flex-1 h-8 rounded-md bg-emerald-500/90 hover:bg-emerald-500 text-black text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default"
              :disabled="inpaint.busy.value || !genHasMask"
              @click="runRegionFill"
            >{{ inpaint.busy.value ? 'Generating…' : 'Generate' }}</button>
          </div>
          <p v-if="!genHasMask" class="text-[10px] text-white/30 -mt-1">Mark a region on the canvas to enable Generate.</p>
          <div v-if="inpaint.error.value" class="text-[11px] text-rose-400">{{ inpaint.error.value }}</div>
        </div>
      </template>

      <!-- Local-layer properties -->
      <template v-else-if="selectedLocal">
        <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <component :is="kindIcon(selectedLocal.kind)" class="size-3.5 text-white/60" />
          <span class="text-sm font-medium capitalize">{{ selectedLocal.kind }}</span>
          <div class="ml-auto flex items-center gap-1">
            <button class="text-white/40 hover:text-white/80 p-1" title="Bring forward" @click="moveStackZ(localKey(selectedLocal.id), 1)"><ArrowUp class="size-3.5" /></button>
            <button class="text-white/40 hover:text-white/80 p-1" title="Send backward" @click="moveStackZ(localKey(selectedLocal.id), -1)"><ArrowDown class="size-3.5" /></button>
            <button class="text-white/40 hover:text-red-400 p-1" title="Delete" @click="deleteLocal(selectedLocal.id)"><Trash2 class="size-3.5" /></button>
          </div>
        </div>
        <div class="p-4 flex flex-col gap-4 overflow-y-auto">
          <!-- Text controls -->
          <template v-if="selectedLocal.kind === 'text'">
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Text</div>
              <textarea
                :value="(selectedLocal as any).text" rows="2"
                class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none resize-none"
                @input="setLocal(selectedLocal!.id, { text: ($event.target as HTMLTextAreaElement).value })"
              />
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Font</div>
              <select :value="(selectedLocal as any).fontFamily"
                class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none cursor-pointer"
                @change="setLocal(selectedLocal!.id, { fontFamily: ($event.target as HTMLSelectElement).value })">
                <option v-for="f in FONT_NAMES" :key="f" :value="f">{{ f }}</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Size</div>
                <input type="number" min="1" :value="pxW((selectedLocal as any).fontSize)"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                  @input="setSizePx(selectedLocal!.id, 'fontSize', parseFloat(($event.target as HTMLInputElement).value) || 1)" />
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Style</div>
                <div class="flex gap-1">
                  <button class="flex-1 flex items-center justify-center bg-[#1a1a1a] border border-[#2a2a2a] rounded py-1.5"
                    :class="(selectedLocal as any).fontWeight === 700 ? 'text-yellow-400 border-yellow-400/50' : 'text-white/60'"
                    @click="setLocal(selectedLocal!.id, { fontWeight: (selectedLocal as any).fontWeight === 700 ? 400 : 700 })">
                    <Bold class="size-3.5" />
                  </button>
                  <button v-for="a in (['left','center','right'] as const)" :key="a"
                    class="flex-1 flex items-center justify-center bg-[#1a1a1a] border border-[#2a2a2a] rounded py-1.5"
                    :class="(selectedLocal as any).align === a ? 'text-yellow-400 border-yellow-400/50' : 'text-white/60'"
                    @click="setLocal(selectedLocal!.id, { align: a })">
                    <component :is="a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight" class="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Color</div>
                <input type="color" :value="(selectedLocal as any).color"
                  class="w-full h-8 bg-[#1a1a1a] border border-[#2a2a2a] rounded cursor-pointer"
                  @input="setLocal(selectedLocal!.id, { color: ($event.target as HTMLInputElement).value })" />
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Outline</div>
                <div class="flex gap-1.5 items-center">
                  <input type="color" :value="(selectedLocal as any).strokeColor"
                    class="h-8 w-8 bg-[#1a1a1a] border border-[#2a2a2a] rounded cursor-pointer"
                    @input="setLocal(selectedLocal!.id, { strokeColor: ($event.target as HTMLInputElement).value })" />
                  <input type="number" min="0" step="1" :value="pxW((selectedLocal as any).strokeWidth)"
                    class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                    @input="setSizePx(selectedLocal!.id, 'strokeWidth', parseFloat(($event.target as HTMLInputElement).value) || 0)" />
                </div>
              </div>
            </div>
          </template>

          <!-- Rect / ellipse controls -->
          <template v-if="selectedLocal.kind === 'rect' || selectedLocal.kind === 'ellipse'">
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Fill</div>
              <div class="flex gap-1.5 items-center">
                <input type="color" :value="(selectedLocal as any).fill === 'none' ? '#3b82f6' : (selectedLocal as any).fill"
                  class="h-8 w-8 bg-[#1a1a1a] border border-[#2a2a2a] rounded cursor-pointer"
                  @input="setLocal(selectedLocal!.id, { fill: ($event.target as HTMLInputElement).value })" />
                <button class="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs"
                  :class="(selectedLocal as any).fill === 'none' ? 'text-yellow-400' : 'text-white/60'"
                  @click="toggleFill(selectedLocal as any)">
                  {{ (selectedLocal as any).fill === 'none' ? 'No fill' : 'Filled' }}
                </button>
              </div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Stroke</div>
              <div class="flex gap-1.5 items-center">
                <input type="color" :value="(selectedLocal as any).stroke || '#ffffff'"
                  class="h-8 w-8 bg-[#1a1a1a] border border-[#2a2a2a] rounded cursor-pointer"
                  @input="setLocal(selectedLocal!.id, { stroke: ($event.target as HTMLInputElement).value })" />
                <input type="number" min="0" step="1" :value="pxW((selectedLocal as any).strokeWidth)"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                  @input="setSizePx(selectedLocal!.id, 'strokeWidth', parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              </div>
            </div>
            <div v-if="selectedLocal.kind === 'rect'">
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Corner radius</div>
              <input type="number" min="0" step="1" :value="pxW((selectedLocal as any).radius)"
                class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                @input="setSizePx(selectedLocal!.id, 'radius', parseFloat(($event.target as HTMLInputElement).value) || 0)" />
            </div>
          </template>

          <!-- Line controls -->
          <template v-if="selectedLocal.kind === 'line'">
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Color</div>
              <input type="color" :value="(selectedLocal as any).stroke"
                class="w-full h-8 bg-[#1a1a1a] border border-[#2a2a2a] rounded cursor-pointer"
                @input="setLocal(selectedLocal!.id, { stroke: ($event.target as HTMLInputElement).value })" />
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Thickness</div>
              <input type="number" min="1" step="1" :value="pxW((selectedLocal as any).strokeWidth)"
                class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                @input="setSizePx(selectedLocal!.id, 'strokeWidth', parseFloat(($event.target as HTMLInputElement).value) || 1)" />
            </div>
          </template>

          <!-- Size: W / H with aspect-ratio lock (shapes & images) -->
          <div v-if="selectedLocal.kind === 'rect' || selectedLocal.kind === 'ellipse' || selectedLocal.kind === 'image'">
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Size</div>
            <div class="flex items-center gap-2">
              <label class="flex-1 flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5">
                <span class="text-xs text-white/40">W</span>
                <input type="number" min="1" :value="pxW((selectedLocal as any).w)"
                  class="w-full bg-transparent text-xs text-white/90 outline-none"
                  @input="setDimPx(selectedLocal!, 'w', parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              </label>
              <button
                class="shrink-0 size-7 rounded flex items-center justify-center border border-[#2a2a2a] cursor-pointer transition-colors"
                :class="lockRatio ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/40' : 'text-white/40 hover:text-white/80'"
                :title="lockRatio ? 'Aspect ratio locked — click to unlock' : 'Aspect ratio unlocked — click to lock'"
                @click="lockRatio = !lockRatio"
              >
                <Lock v-if="lockRatio" class="size-3.5" />
                <LockOpen v-else class="size-3.5" />
              </button>
              <label class="flex-1 flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5">
                <span class="text-xs text-white/40">H</span>
                <input type="number" min="1" :value="pxW((selectedLocal as any).h)"
                  class="w-full bg-transparent text-xs text-white/90 outline-none"
                  @input="setDimPx(selectedLocal!, 'h', parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              </label>
            </div>
          </div>
          <!-- Line: single length value -->
          <div v-else-if="selectedLocal.kind === 'line'">
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Length</div>
            <input type="number" min="1" :value="pxW((selectedLocal as any).w)"
              class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
              @input="setSizePx(selectedLocal!.id, 'w', parseFloat(($event.target as HTMLInputElement).value) || 1)" />
          </div>

          <!-- Common: rotation + opacity -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Rotation</div>
              <input type="number" step="1" :value="Math.round(selectedLocal.rotation)"
                class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                @input="setLocal(selectedLocal!.id, { rotation: parseFloat(($event.target as HTMLInputElement).value) || 0 })" />
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Opacity</div>
              <input type="number" min="0" max="100" step="1" :value="Math.round(selectedLocal.opacity * 100)"
                class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                @input="setLocal(selectedLocal!.id, { opacity: Math.max(0, Math.min(1, (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100)) })" />
            </div>
          </div>

          <!-- Drop shadow effect -->
          <div class="mt-3">
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40">Drop shadow</div>
              <button class="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white/90"
                @click="toggleLocalShadow(selectedLocal!)">{{ localShadow(selectedLocal) ? 'Remove' : 'Add' }}</button>
            </div>
            <div v-if="localShadow(selectedLocal)" class="space-y-1.5">
              <div class="flex items-center gap-1.5">
                <input type="color" :value="shadowHex(selectedLocal)" title="Shadow color"
                  class="w-8 h-8 rounded bg-transparent border border-[#2a2a2a] cursor-pointer shrink-0"
                  @input="setLocalShadow(selectedLocal!, { color: composeRgba(($event.target as HTMLInputElement).value, shadowAlpha(selectedLocal)) })" />
                <input type="text" spellcheck="false" maxlength="7" :value="shadowHex(selectedLocal)" title="Hex color"
                  class="flex-1 min-w-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs font-mono uppercase text-white/90 outline-none"
                  @change="setShadowHex(selectedLocal!, ($event.target as HTMLInputElement).value)" />
                <div class="flex items-center gap-0.5 shrink-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1.5 py-1.5" title="Shadow opacity (alpha)">
                  <input type="number" min="0" max="100" step="1" :value="Math.round(shadowAlpha(selectedLocal) * 100)"
                    class="w-7 bg-transparent text-xs text-white/90 outline-none text-right"
                    @input="setLocalShadow(selectedLocal!, { color: composeRgba(shadowHex(selectedLocal), (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100) })" />
                  <span class="text-[10px] text-white/35 select-none">%</span>
                </div>
              </div>
              <div class="grid grid-cols-3 gap-1.5">
                <div>
                  <div class="text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">X</div>
                  <input type="number" step="0.5" :value="Math.round((localShadow(selectedLocal)?.x || 0) * 1000) / 10"
                    class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                    @input="setLocalShadow(selectedLocal!, { x: (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100 })" />
                </div>
                <div>
                  <div class="text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">Y</div>
                  <input type="number" step="0.5" :value="Math.round((localShadow(selectedLocal)?.y || 0) * 1000) / 10"
                    class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                    @input="setLocalShadow(selectedLocal!, { y: (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100 })" />
                </div>
                <div>
                  <div class="text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">Blur</div>
                  <input type="number" min="0" step="0.5" :value="Math.round((localShadow(selectedLocal)?.blur || 0) * 1000) / 10"
                    class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                    @input="setLocalShadow(selectedLocal!, { blur: Math.max(0, (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100) })" />
                </div>
              </div>
            </div>
          </div>

          <!-- Layer blur -->
          <div class="mt-3">
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40">Layer blur</div>
              <button class="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white/90"
                @click="toggleLayerBlur(selectedLocal!)">{{ layerBlur(selectedLocal) ? 'Remove' : 'Add' }}</button>
            </div>
            <div v-if="layerBlur(selectedLocal)" class="flex items-center gap-2">
              <div class="text-[9px] uppercase tracking-[0.1em] text-white/35 shrink-0">Radius</div>
              <input type="number" min="0" step="0.5" :value="Math.round((layerBlur(selectedLocal)?.radius || 0) * 1000) / 10"
                class="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                @input="setLayerBlur(selectedLocal!, Math.max(0, (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100))" />
            </div>
          </div>

          <!-- Layer mask: clip this layer to another layer's silhouette -->
          <div class="mt-3">
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Mask</div>
            <select :value="(selectedLocal as any).maskedById || ''"
              class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
              @change="setLayerMaskedBy(selectedLocal!, ($event.target as HTMLSelectElement).value)">
              <option value="">No mask</option>
              <option v-for="o in maskCandidates(selectedLocal)" :key="o.id" :value="o.id">Mask with {{ layerLabel(o) }}</option>
            </select>
          </div>

          <!-- Crop to a rect/ellipse region -->
          <div class="mt-3">
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40">Crop</div>
              <button class="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-white/60 hover:text-white/90"
                @click="toggleLayerMask(selectedLocal!)">{{ layerMask(selectedLocal) ? 'Remove' : 'Add' }}</button>
            </div>
            <div v-if="layerMask(selectedLocal)" class="space-y-1.5">
              <div class="flex gap-1">
                <button class="flex-1 py-1 rounded text-[11px] border"
                  :class="layerMask(selectedLocal)?.kind === 'rect' ? 'bg-white/10 border-white/20 text-white/90' : 'border-[#2a2a2a] text-white/50 hover:text-white/80'"
                  @click="setLayerMask(selectedLocal!, { kind: 'rect' })">Rect</button>
                <button class="flex-1 py-1 rounded text-[11px] border"
                  :class="layerMask(selectedLocal)?.kind === 'ellipse' ? 'bg-white/10 border-white/20 text-white/90' : 'border-[#2a2a2a] text-white/50 hover:text-white/80'"
                  @click="setLayerMask(selectedLocal!, { kind: 'ellipse' })">Ellipse</button>
              </div>
              <div class="grid grid-cols-4 gap-1.5">
                <div v-for="k in (['x','y','w','h'] as const)" :key="k">
                  <div class="text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">{{ k }}</div>
                  <input type="number" step="0.5" :value="Math.round((layerMask(selectedLocal)?.[k] || 0) * 1000) / 10"
                    class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none"
                    @input="setLayerMask(selectedLocal!, { [k]: Math.max(0, (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100) })" />
                </div>
              </div>
            </div>
          </div>

          <!-- Image AI actions -->
          <div v-if="selectedLocal.kind === 'image'" class="mt-3 flex flex-col gap-1.5">
            <button
              class="w-full py-1.5 rounded text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer"
              :class="genActive ? 'bg-emerald-500/90 text-black' : 'bg-white/[0.06] hover:bg-white/12 text-white/85'"
              @click="enterGenMode"
            ><Wand2 class="size-3" /> Generate in region…</button>
            <button
              class="w-full py-1.5 rounded text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer bg-white/[0.06] hover:bg-white/12 text-white/85 disabled:opacity-40 disabled:cursor-default"
              :disabled="inpaint.busy.value"
              title="Cloud background removal — replaces the image with a transparent cutout"
              @click="removeImageBg(selectedLocal)"
            ><Scissors class="size-3" /> {{ inpaint.busy.value ? 'Removing…' : 'Remove background' }}</button>
            <div v-if="inpaint.error.value" class="text-[10px] text-rose-400">{{ inpaint.error.value }}</div>
          </div>
        </div>
      </template>

      <!-- Image-layer properties -->
      <template v-else>
        <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <ImageIcon class="size-3.5 text-white/60" />
          <span class="text-sm font-medium">{{ selected ? `Layer ${selected.slot}` : 'No selection' }}</span>
          <div v-if="selected" class="ml-auto flex items-center gap-1">
            <button class="text-white/40 hover:text-white/80 p-1" title="Bring forward" @click="moveStackZ(wiredKey(selected.slot), 1)"><ArrowUp class="size-3.5" /></button>
            <button class="text-white/40 hover:text-white/80 p-1" title="Send backward" @click="moveStackZ(wiredKey(selected.slot), -1)"><ArrowDown class="size-3.5" /></button>
          </div>
        </div>
        <div v-if="selected" class="p-4 flex flex-col gap-4 overflow-y-auto">
          <div>
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Position</div>
            <div class="flex gap-2">
              <label class="flex-1 flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5">
                <span class="text-xs text-white/40">X</span>
                <input type="number" step="0.01" :value="selected.x.toFixed(2)" class="w-full bg-transparent text-xs text-white/90 outline-none"
                  @input="setLayerProp(selected.slot, 'x', parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              </label>
              <label class="flex-1 flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5">
                <span class="text-xs text-white/40">Y</span>
                <input type="number" step="0.01" :value="selected.y.toFixed(2)" class="w-full bg-transparent text-xs text-white/90 outline-none"
                  @input="setLayerProp(selected.slot, 'y', parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              </label>
            </div>
          </div>

          <div>
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Rotation</div>
            <div class="flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5">
              <input type="number" step="1" :value="selected.rotation.toFixed(1)" class="w-full bg-transparent text-xs text-white/90 outline-none"
                @input="setLayerProp(selected.slot, 'rotation', parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              <span class="text-xs text-white/40">°</span>
            </div>
          </div>

          <div>
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Scale</div>
            <div class="flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5">
              <input type="number" step="0.05" min="0.1" max="3" :value="selected.scale.toFixed(2)" class="w-full bg-transparent text-xs text-white/90 outline-none"
                @input="setLayerProp(selected.slot, 'scale', parseFloat(($event.target as HTMLInputElement).value) || 1)" />
              <span class="text-xs text-white/40">×</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Opacity</div>
              <div class="flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5">
                <input type="number" min="0" max="100" step="1" :value="Math.round(selected.opacity * 100)" class="w-full bg-transparent text-xs text-white/90 outline-none"
                  @input="setLayerProp(selected.slot, 'opacity', Math.max(0, Math.min(1, (parseFloat(($event.target as HTMLInputElement).value) || 0) / 100)))" />
                <span class="text-xs text-white/40">%</span>
              </div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1.5">Blend mode</div>
              <select :value="selected.blend" class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs text-white/90 outline-none cursor-pointer"
                @change="setLayerProp(selected.slot, 'blend', ($event.target as HTMLSelectElement).value)">
                <option v-for="m in BLEND_MODES" :key="m" :value="m">{{ m.replace('_', ' ') }}</option>
              </select>
            </div>
          </div>
        </div>
        <div v-else class="p-4 text-xs text-white/40 italic">
          Select a layer to edit its properties, or use the toolbar to add text and shapes.
        </div>
      </template>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* Strip the native number-input spinner arrows in the inspector. */
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}
</style>
