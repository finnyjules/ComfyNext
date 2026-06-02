<script setup lang="ts">
import {
  Image as ImageIcon, X, MousePointer2,
  Type, Square, Circle, Minus, Trash2,
  AlignLeft, AlignCenter, AlignRight, Bold, ArrowUp, ArrowDown, Lock, LockOpen,
} from 'lucide-vue-next'
import { TEMPLATE_FONTS } from '~~/shared/template-fonts'
import {
  type TextLayer, type RectLayer, type EllipseLayer,
  drawLocalLayer, drawWiredImageLayer, ensureLayerFonts, ensureLayerImages,
} from '~/composables/useCompositorLayers'
import { useLocalLayerEditor } from '~/composables/useLocalLayerEditor'

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
  addText, addRect, addEllipse, addLine, addImageFromFile,
} = editor

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
  if (!layer) return null
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
  if ((e.target as HTMLElement)?.closest?.('[data-handle]')) return // a handle's own drag
  const key = hitTopStackKey(e.clientX, e.clientY)
  const res = key ? resolveStackKey(key) : null
  if (res?.type === 'wired') {
    // Topmost layer here is a wired image → move it, not a shape beneath it.
    selectLocal(null)
    onLayerPointerDown(res.layer.slot, e) // selects slot + starts move (+ stops propagation)
  } else if (res?.type === 'local') {
    onCanvasPointerDown(e) // local editor selects + starts move (+ stops propagation)
  } else {
    selectLocal(null); selectedSlot.value = null // empty space → clear selection
  }
}
function onCanvasDblClickCapture(e: MouseEvent) { onCanvasDblClick(e) }
function onCanvasClick(e: MouseEvent) {
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
  for (const key of stackKeys.value) {
    const r = resolveStackKey(key)
    if (!r) continue
    if (r.type === 'wired') { drawWiredLayer(ctx, r.layer as Layer, W, H); continue }
    if (r.layer.id === editingId.value) continue
    drawLocalLayer(ctx, r.layer, W, H)
  }
}
watch(
  () => [
    JSON.stringify(localLayers.value), editingId.value,
    canvasDisplay.w, canvasDisplay.h,
    JSON.stringify(layers.value), JSON.stringify(stackKeys.value),
    Object.keys(wiredImageEls.value).length,
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
    emit('close')
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLocalId.value && !typing) {
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
        :style="{ width: canvasDisplay.w + 'px', height: canvasDisplay.h + 'px' }"
        @click="onCanvasClick"
        @pointerdown.capture="onCanvasPointerDownCapture"
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
          v-if="localHandlePositions && !editingId"
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
        <template v-if="localHandlePositions && !editingId">
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

      <!-- Bottom toolbar -->
      <div class="absolute bottom-4 flex items-center gap-1 bg-[#1a1a1a]/95 backdrop-blur-sm rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg">
        <button class="flex items-center justify-center size-8 rounded-[8px] bg-yellow-400/90 text-black cursor-pointer" title="Select">
          <MousePointer2 class="size-4" />
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
        <button class="flex items-center justify-center size-8 rounded-[8px] hover:bg-white/10 text-white/80 cursor-pointer" title="Add image" @click="triggerAddImage">
          <ImageIcon class="size-4" />
        </button>
        <input ref="imageInputRef" type="file" accept="image/*" class="hidden" @change="onAddImageFile" />
      </div>
    </div>

    <!-- Right sidebar: properties -->
    <div class="w-72 border-l border-white/10 shrink-0 flex flex-col">
      <!-- Local-layer properties -->
      <template v-if="selectedLocal">
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
