<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import {
  Loader2, Download, RefreshCw, Maximize2, Frame as FrameIcon, ImagePlus,
  MousePointer2, Check, Type, Square, Circle, Minus, Trash2,
} from 'lucide-vue-next'
import { getTypeColor } from '~/composables/useVueNodes'
import { useLocalLayerEditor } from '~/composables/useLocalLayerEditor'
import { type LocalLayer, type TextLayer, type StackItem, drawWiredImageLayer, ensureLayerFonts, ensureLayerImages, paintLayerStack } from '~/composables/useCompositorLayers'
import { readWiredTreatments } from '~/composables/useWiredTreatments'
import type { Cloner } from '~/composables/useCloner'
import CompositorInlineToolbar from '~/components/vue-canvas/CompositorInlineToolbar.vue'

// The "Frame" — the Compositor as a first-class artboard artifact. Shows its
// live composite (wired layers from `data.images` + a live local-layer overlay),
// supports inline editing on the canvas, and outputs IMAGE. The modal ("Modal")
// remains for focused / precise work.
const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title: string
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    widgetsValues: any[]
    widgetDefs?: any[]
    properties?: Record<string, any>
    mode: number
    running?: boolean
    error?: boolean
    images?: string[]
  }
}>()

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)
const imageColor = computed(() => getTypeColor('IMAGE'))
const injectedEdges = inject<any>('vueFlowEdges', null)
const injectedNodes = inject<any>('vueFlowNodes', null)
const { ensure: ensureGoogleFont } = useGoogleFontPreview()

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }
function boxHandles(cx: number, cy: number, hw: number, hh: number, rotationDeg: number) {
  const rad = (rotationDeg * Math.PI) / 180
  const cosA = Math.cos(rad), sinA = Math.sin(rad)
  const t = (dx: number, dy: number) => ({ x: cx + dx * cosA - dy * sinA, y: cy + dx * sinA + dy * cosA })
  return { tl: t(-hw, -hh), tr: t(hw, -hh), br: t(hw, hh), bl: t(-hw, hh), rot: t(0, -hh - 26), topCenter: t(0, -hh), center: { x: cx, y: cy } }
}

function outputIdx(name: string): number {
  const i = props.data.outputs?.findIndex(o => o.name === name) ?? -1
  return i >= 0 ? i : 0
}
function widgetIdx(name: string): number { return props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1 }
function widgetVal(name: string): number { const i = widgetIdx(name); return i >= 0 ? Number(props.data.widgetsValues?.[i] ?? 0) : 0 }
function setWidget(name: string, value: any) { const i = widgetIdx(name); if (i >= 0 && props.data.widgetsValues) props.data.widgetsValues[i] = value }
const imageOutIdx = computed(() => outputIdx('image'))
// Per-layer transform widgets — slot s (0-based input) maps to layer{s+1}_*.
function layerTf(slot: number, prop: string): number { const v = widgetVal(`layer${slot + 1}_${prop}`); return prop === 'scale' ? (v || 1) : v }
function setLayerTf(slot: number, prop: string, v: number) { setWidget(`layer${slot + 1}_${prop}`, v) }
function layerProtect(slot: number): boolean { return !!widgetVal(`layer${slot + 1}_protect`) }

// ── Artboard dimensions ─────────────────────────────────────────────────────
interface Preset { id: string; label: string; w: number; h: number }
const PRESETS: Preset[] = [
  { id: '1:1', label: 'Square · 1:1', w: 1024, h: 1024 },
  { id: '16:9', label: 'Wide · 16:9', w: 1280, h: 720 },
  { id: '9:16', label: 'Tall · 9:16', w: 720, h: 1280 },
  { id: '4:5', label: 'Portrait · 4:5', w: 1024, h: 1280 },
  { id: '4:3', label: 'Classic · 4:3', w: 1024, h: 768 },
  { id: 'A4', label: 'A4 · print', w: 1240, h: 1754 },
]
const frameW = computed(() => widgetVal('width'))
const frameH = computed(() => widgetVal('height'))
const hasExplicitSize = computed(() => frameW.value > 0 && frameH.value > 0)
const activePresetId = computed<string>(() => {
  const match = PRESETS.find(p => p.w === frameW.value && p.h === frameH.value)
  return match ? match.id : (hasExplicitSize.value ? 'custom' : '')
})
function applyPreset(id: string) { const p = PRESETS.find(x => x.id === id); if (!p) return; setWidget('width', p.w); setWidget('height', p.h); rememberPreset(id) }
function rememberPreset(id: string) {
  if (!props.data.properties) (props.data as any).properties = {}
  ;(props.data.properties as any).comfynext_frame = { ...(props.data.properties as any).comfynext_frame, preset: id }
}
function onPresetChange(e: Event) { const v = (e.target as HTMLSelectElement).value; if (v && v !== 'custom') applyPreset(v) }
function setDim(which: 'width' | 'height', e: Event) { setWidget(which, Math.max(0, Math.round(parseFloat((e.target as HTMLInputElement).value) || 0))); rememberPreset('custom') }

// Aspect: explicit dims win; else the bottom wired image's aspect; else square.
// Matching the composite means the background image fills the artboard exactly,
// so wired-layer hit-testing/handles line up.
const aspect = computed(() => {
  if (hasExplicitSize.value) return frameW.value / frameH.value
  const base = wiredLayers.value[0]
  if (base) { const d = wiredDims.value[base.url]; if (d && d.h) return d.w / d.h }
  return 1
})
// On-canvas display size (the frame's longest edge in logical px) — the size
// you *work* at on the canvas, distinct from the output resolution (the W×H
// widgets / presets). Drag the corner grip to change it; persisted on the node.
const displayEdge = computed(() => Number((props.data.properties as any)?.comfynext_frame?.displayEdge) || 300)
function setDisplayEdge(v: number) {
  if (!props.data.properties) (props.data as any).properties = {}
  ;(props.data.properties as any).comfynext_frame = {
    ...(props.data.properties as any).comfynext_frame, displayEdge: clamp(Math.round(v), 180, 1600),
  }
}
const box = computed(() => {
  const a = aspect.value || 1
  const E = displayEdge.value
  return a >= 1 ? { w: E, h: Math.round(E / a) } : { w: Math.round(E * a), h: E }
})

// Manual node resize — zoom-aware (mirrors StickyAnnotation). zoom is derived
// from the artboard's on-screen rect vs its logical size, so no Vue Flow dep.
let resize: { startEdge: number; sx: number; sy: number; zoom: number } | null = null
function onResizeDown(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const r = artboardRef.value?.getBoundingClientRect()
  const zoom = r && box.value.w ? r.width / box.value.w : 1
  resize = { startEdge: displayEdge.value, sx: e.clientX, sy: e.clientY, zoom: zoom || 1 }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeUp, { once: true })
}
function onResizeMove(e: PointerEvent) {
  if (!resize) return
  const d = (aspect.value >= 1 ? e.clientX - resize.sx : e.clientY - resize.sy) / resize.zoom
  setDisplayEdge(resize.startEdge + d)
}
function onResizeUp() { resize = null; window.removeEventListener('pointermove', onResizeMove) }

// ── Layer input handles + wired (connected) layers ──────────────────────────
function slotConnected(slotIdx: number): boolean {
  if (props.data.inputs?.[slotIdx]?.link != null) return true
  const edges = injectedEdges?.value ?? []
  return edges.some((e: any) => e.target === props.id && e.targetHandle === `input-${slotIdx}`)
}
const layerSlots = computed<number[]>(() => {
  const connected: number[] = []
  for (let i = 0; i < 16; i++) if (slotConnected(i)) connected.push(i)
  const next = connected.length ? Math.max(...connected) + 1 : 0
  const slots = [...connected]
  if (next < 16) slots.push(next)
  return slots
})
function handleTop(idx: number, count: number): string {
  if (count <= 1) return '50%'
  const pad = 14
  return `calc(${pad}px + ${(idx / (count - 1)) * 100}% - ${(pad * 2 * idx) / (count - 1)}px)`
}

function resolveSrcUrl(src: any): string | null {
  if (src?.data?.images?.length) return src.data.images[0]
  if (src?.data?.nodeType === 'LoadImage' && src?.data?.widgetsValues?.[0]) {
    return `/view?${new URLSearchParams({ filename: src.data.widgetsValues[0], type: 'input' })}`
  }
  return null
}
function wiredOpacity(slot: number): number {
  const i = widgetIdx(`layer${slot + 1}_opacity`)
  if (i < 0) return 1
  const v = Number(props.data.widgetsValues?.[i])
  return Number.isFinite(v) ? clamp(v, 0, 1) : 1
}
interface WiredLayer { slot: number; url: string; x: number; y: number; rotation: number; scale: number; opacity: number; blend: string; cloner?: Cloner }
function wiredCloner(slot: number): Cloner | undefined {
  // Editor state on a node property (1-based slot, like layer{i}_cloner), mirrored
  // from the Compositor modal — not the widget (which only exists post-restart).
  const map = (props.data.properties as any)?.comfynext_wiredCloners
  return map?.[slot + 1] as Cloner | undefined
}
const wiredLayers = computed<WiredLayer[]>(() => {
  const edges = injectedEdges?.value ?? []
  const nodes = injectedNodes?.value ?? []
  const out: WiredLayer[] = []
  for (let s = 0; s < 16; s++) {
    if (!slotConnected(s)) continue
    const edge = edges.find((e: any) => e.target === props.id && e.targetHandle === `input-${s}`)
    if (!edge) continue
    const src = nodes.find((n: any) => n.id === edge.source)
    const url = resolveSrcUrl(src)
    if (!url) continue
    out.push({ slot: s, url, x: layerTf(s, 'x'), y: layerTf(s, 'y'), rotation: layerTf(s, 'rotation'), scale: layerTf(s, 'scale'), opacity: wiredOpacity(s), blend: blendOf(s), cloner: wiredCloner(s) })
  }
  return out
})
// Natural dimensions + decoded bitmap per wired image. Dims drive aspect-fit
// hit-testing; the bitmap is painted into the unified stack canvas.
const wiredDims = ref<Record<string, { w: number; h: number }>>({})
const wiredImages = ref<Record<string, HTMLImageElement>>({})
watch(() => wiredLayers.value.map(l => l.url).join('|'), () => {
  for (const l of wiredLayers.value) {
    if (wiredImages.value[l.url]) continue
    const im = new Image()
    im.onload = () => {
      if (!im.naturalWidth) return
      wiredDims.value = { ...wiredDims.value, [l.url]: { w: im.naturalWidth, h: im.naturalHeight } }
      wiredImages.value = { ...wiredImages.value, [l.url]: im }
    }
    im.src = l.url
  }
}, { immediate: true })

// Rendered geometry of a wired layer in artboard (box) coords — mirrors the
// backend/preview: aspect-fit into the canvas, then translate + scale + rotate.
function wiredGeom(l: WiredLayer) {
  const W = box.value.w, H = box.value.h
  const d = wiredDims.value[l.url]
  const iAspect = d && d.h ? d.w / d.h : W / H
  const cAspect = W / H
  let fitW: number, fitH: number
  if (iAspect > cAspect) { fitW = W; fitH = W / iAspect } else { fitH = H; fitW = H * iAspect }
  return { cx: W / 2 + l.x * W, cy: H / 2 + l.y * H, hw: (fitW * l.scale) / 2, hh: (fitH * l.scale) / 2, rotation: l.rotation }
}
// Per-wired-layer visibility/lock, persisted on node properties as 1-BASED
// slot arrays (layerN numbering, same as the w:N stack keys and the modal).
// Internal WiredLayer.slot stays 0-based — hence the +1 at every lookup.
const hiddenWiredSet = computed(() =>
  new Set((((props.data.properties as any)?.comfynext_hiddenWired as number[]) ?? []).map(Number)))
const lockedWiredSet = computed(() =>
  new Set((((props.data.properties as any)?.comfynext_lockedWired as number[]) ?? []).map(Number)))

function wiredHitTest(clientX: number, clientY: number): number | null {
  const r = artboardRef.value?.getBoundingClientRect()
  if (!r) return null
  const W = box.value.w, H = box.value.h
  const px = ((clientX - r.left) / r.width) * W, py = ((clientY - r.top) / r.height) * H
  for (let i = wiredLayers.value.length - 1; i >= 0; i--) {
    const slotN = wiredLayers.value[i].slot + 1
    if (hiddenWiredSet.value.has(slotN) || lockedWiredSet.value.has(slotN)) continue
    const g = wiredGeom(wiredLayers.value[i])
    const rad = (-g.rotation * Math.PI) / 180
    const dx = px - g.cx, dy = py - g.cy
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
    if (Math.abs(lx) <= g.hw + 6 && Math.abs(ly) <= g.hh + 6) return wiredLayers.value[i].slot
  }
  return null
}
const selectedWiredSlot = ref<number | null>(null)
const wiredHandlePositions = computed(() => {
  if (selectedWiredSlot.value == null) return null
  const l = wiredLayers.value.find(x => x.slot === selectedWiredSlot.value)
  if (!l) return null
  const g = wiredGeom(l)
  return boxHandles(g.cx, g.cy, g.hw, g.hh, g.rotation)
})

const compositeUrl = computed<string | null>(() => props.data.images?.[0] ?? null)
const sizeLabel = computed(() => (hasExplicitSize.value ? `${frameW.value}×${frameH.value}` : 'auto'))

// ── Inline editing engine (local layers: text / shapes / dropped images) ────
const artboardRef = ref<HTMLDivElement | null>(null)
const editor = useLocalLayerEditor({
  node: () => ({ data: props.data }),
  dims: () => ({ w: box.value.w, h: box.value.h }),
  getRect: () => artboardRef.value?.getBoundingClientRect() ?? null,
})
const editMode = ref(false)
function toggleEdit() { editMode.value ? exitEdit() : (editMode.value = true) }
function exitEdit() { editMode.value = false; editor.endEdit(); editor.selectLocal(null); selectedWiredSlot.value = null }
function onArtboardDblClick(e: MouseEvent) {
  if (editor.onCanvasDblClick(e)) return
  if (!editMode.value) editMode.value = true
}

// Pointer down on the artboard: try local layers first (top), then wired layers.
function onArtboardPointerDown(e: PointerEvent) {
  if (!editMode.value) return
  if ((e.target as HTMLElement)?.closest?.('[data-handle]')) return
  if (editor.onCanvasPointerDown(e)) { selectedWiredSlot.value = null; return }
  const slot = wiredHitTest(e.clientX, e.clientY)
  if (slot != null) {
    e.preventDefault(); e.stopPropagation()
    editor.selectLocal(null)
    selectedWiredSlot.value = slot
    startWiredMove(slot, e)
  } else {
    selectedWiredSlot.value = null
  }
}

// ── Wired-layer drag / scale / rotate (writes layer{N}_* widgets) ───────────
let wiredDrag: any = null
function wiredCenterScreen(slot: number) {
  const r = artboardRef.value?.getBoundingClientRect()
  const l = wiredLayers.value.find(x => x.slot === slot)
  if (!r || !l) return null
  const g = wiredGeom(l)
  return { x: r.left + (g.cx / box.value.w) * r.width, y: r.top + (g.cy / box.value.h) * r.height }
}
function startWiredMove(slot: number, e: PointerEvent) {
  wiredDrag = { type: 'move', slot, sx: e.clientX, sy: e.clientY, ox: layerTf(slot, 'x'), oy: layerTf(slot, 'y') }
  attachWired()
}
function startWiredScale(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const slot = selectedWiredSlot.value; if (slot == null) return
  const c = wiredCenterScreen(slot); if (!c) return
  wiredDrag = { type: 'scale', slot, cx: c.x, cy: c.y, startDist: Math.max(1, Math.hypot(e.clientX - c.x, e.clientY - c.y)), startScale: layerTf(slot, 'scale') }
  attachWired()
}
function startWiredRotate(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const slot = selectedWiredSlot.value; if (slot == null) return
  const c = wiredCenterScreen(slot); if (!c) return
  wiredDrag = { type: 'rotate', slot, cx: c.x, cy: c.y, startAngle: Math.atan2(e.clientY - c.y, e.clientX - c.x), startRot: layerTf(slot, 'rotation') }
  attachWired()
}
function onWiredMove(e: PointerEvent) {
  if (!wiredDrag) return
  const r = artboardRef.value?.getBoundingClientRect(); if (!r) return
  if (wiredDrag.type === 'move') {
    setLayerTf(wiredDrag.slot, 'x', clamp(wiredDrag.ox + (e.clientX - wiredDrag.sx) / r.width, -1.5, 1.5))
    setLayerTf(wiredDrag.slot, 'y', clamp(wiredDrag.oy + (e.clientY - wiredDrag.sy) / r.height, -1.5, 1.5))
  } else if (wiredDrag.type === 'scale') {
    const ratio = Math.max(0.05, Math.hypot(e.clientX - wiredDrag.cx, e.clientY - wiredDrag.cy) / wiredDrag.startDist)
    setLayerTf(wiredDrag.slot, 'scale', clamp(wiredDrag.startScale * ratio, 0.1, 3))
  } else if (wiredDrag.type === 'rotate') {
    let rot = wiredDrag.startRot + ((Math.atan2(e.clientY - wiredDrag.cy, e.clientX - wiredDrag.cx) - wiredDrag.startAngle) * 180) / Math.PI
    while (rot > 180) rot -= 360
    while (rot < -180) rot += 360
    setLayerTf(wiredDrag.slot, 'rotation', Math.round(rot))
  }
}
function onWiredUp() { wiredDrag = null; window.removeEventListener('pointermove', onWiredMove) }
function attachWired() { window.addEventListener('pointermove', onWiredMove); window.addEventListener('pointerup', onWiredUp, { once: true }) }

// Inline text editor positioning (mirrors the modal).
const editingStyle = computed(() => {
  const l = editor.editingLayer.value
  if (!l) return {}
  const b = editor.boxPx(l)
  const W = box.value.w, H = box.value.h
  return {
    left: l.x * W + 'px', top: l.y * H + 'px',
    width: Math.max(b.w + 8, 30) + 'px', height: Math.max(b.h + 6, 20) + 'px',
    transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
    fontFamily: /\s/.test(l.fontFamily) ? `"${l.fontFamily}", sans-serif` : `${l.fontFamily}, sans-serif`,
    fontWeight: String(l.fontWeight), fontSize: l.fontSize * W + 'px',
    lineHeight: String(l.lineHeight), color: l.color, textAlign: l.align as any,
    opacity: String(l.opacity), caretColor: l.color,
  }
})

// ── Unified z-order stack (wired + local layers in ONE ordered list) ─────────
// Keys: `w:<slot>` for a wired/connected layer, `l:<id>` for a local layer.
// Persisted on the node as `comfynext_stackOrder`; array order is bottom→top.
// This is the single source of truth for depth, so any layer — a dropped shape
// or a wired image — can sit above or below any other, like Figma/Photoshop.
type StackKey = string
// Wired keys are 1-BASED (`w:1` = the backend's layer1) so the persisted
// order round-trips with CompositorModal, which numbers slots the same way.
// The frame's internal WiredLayer.slot stays 0-based (input-port index), so
// the +1/-1 happens only at the persistence boundary here.
function wiredKey(slot: number): StackKey { return `w:${slot + 1}` }
function localKey(id: string): StackKey { return `l:${id}` }

// Present layers in the legacy default order: wired at the bottom, locals on top
// (matches how the editor behaved before unification). Used to seed/append.
const presentKeys = computed<StackKey[]>(() => [
  ...wiredLayers.value.map(l => wiredKey(l.slot)),
  ...editor.localLayers.value.map(l => localKey(l.id)),
])
// Reconcile the saved order against what's actually present: keep saved order
// for layers still here, then append any newcomers on top. So adding a shape or
// wiring an image floats it to the top, and removing one just drops out.
const stackKeys = computed<StackKey[]>(() => {
  const saved = ((props.data.properties as any)?.comfynext_stackOrder as StackKey[]) ?? []
  const present = new Set(presentKeys.value)
  const kept = saved.filter(k => present.has(k))
  const keptSet = new Set(kept)
  return [...kept, ...presentKeys.value.filter(k => !keptSet.has(k))]
})
function resolveKey(key: StackKey):
  | { type: 'wired'; layer: WiredLayer }
  | { type: 'local'; layer: LocalLayer }
  | null {
  if (key.startsWith('w:')) {
    const slot = Number(key.slice(2)) - 1 // persisted keys are 1-based (layerN)
    const layer = wiredLayers.value.find(l => l.slot === slot)
    return layer ? { type: 'wired', layer } : null
  }
  const id = key.slice(2)
  const layer = editor.localLayers.value.find(l => l.id === id)
  return layer ? { type: 'local', layer } : null
}
const selectedStackKey = computed<StackKey | null>(() => {
  if (editor.selectedId.value) return localKey(editor.selectedId.value)
  if (selectedWiredSlot.value != null) return wiredKey(selectedWiredSlot.value)
  return null
})
// Reorder by swapping a key with its neighbour, then persist the full present
// order (which also bakes in the current reconciliation).
function moveStackZ(key: StackKey, dir: -1 | 1) {
  const arr = [...stackKeys.value]
  const i = arr.findIndex(k => k === key)
  const j = i + dir
  if (i < 0 || j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  if (!props.data.properties) (props.data as any).properties = {}
  ;(props.data.properties as any).comfynext_stackOrder = arr
}
function moveSelectedZ(dir: number) {
  const key = selectedStackKey.value
  if (key) moveStackZ(key, dir < 0 ? -1 : 1)
}

// ── Unified stack render (one canvas, wired + local in z-order → WYSIWYG) ─────
// Wired drawing uses the shared `drawWiredImageLayer` (computing fit from the
// actual image) so the node and the Compositor modal render pixel-identically.
// `wiredGeom` is kept only for hit-testing / handle placement.
function drawWiredLayer(ctx: CanvasRenderingContext2D, l: WiredLayer, W: number, H: number) {
  drawWiredImageLayer(ctx, wiredImages.value[l.url], l, W, H)
}
// Shared by the live preview AND the export/download so masking and z-order are
// applied identically (drawn in logical W×H coords; export scales the ctx up).
function buildStackItems(): StackItem[] {
  return stackKeys.value.map((key): StackItem | null => {
    const r = resolveKey(key)
    if (!r) return null
    if (r.type === 'wired') {
      if (hiddenWiredSet.value.has(r.layer.slot + 1)) return null
      return { type: 'wired', key, draw: (c, w, h) => drawWiredLayer(c, r.layer, w, h) }
    }
    return { type: 'local', key, layer: r.layer }
  }).filter((x): x is StackItem => x != null)
}

const stackCanvas = ref<HTMLCanvasElement | null>(null)
function renderStack() {
  const cv = stackCanvas.value
  if (!cv) return
  const W = box.value.w, H = box.value.h
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  cv.width = Math.max(1, Math.round(W * dpr))
  cv.height = Math.max(1, Math.round(H * dpr))
  const ctx = cv.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  paintLayerStack(ctx, W, H, buildStackItems(), editor.localLayers.value, l => l.id === editor.editingId.value,
    undefined, undefined, wiredTreatments.value)
}
// Declared BEFORE the `{ immediate: true }` watch below — that watch's getter reads
// wiredTreatments during setup, so a later `const` would throw a TDZ ReferenceError
// (which cascaded into VueFlow and broke adding any node).
const wiredTreatments = computed(() => readWiredTreatments({ data: props.data }))
watch(
  () => [
    JSON.stringify(editor.localLayers.value), editor.editingId.value,
    box.value.w, box.value.h,
    JSON.stringify(wiredLayers.value), JSON.stringify(stackKeys.value),
    Object.keys(wiredImages.value).length,
    JSON.stringify([...hiddenWiredSet.value]),
    JSON.stringify(wiredTreatments.value),
  ] as const,
  async () => {
    for (const l of editor.localLayers.value) if (l.kind === 'text') ensureGoogleFont((l as TextLayer).fontFamily)
    await ensureLayerFonts(editor.localLayers.value, box.value.w)
    await ensureLayerImages(editor.localLayers.value)
    renderStack()
  },
  { immediate: true },
)
const hasAnyLayer = computed(() => wiredLayers.value.length > 0 || editor.localLayers.value.length > 0)

// ── Inline add-toolbar (image upload) ───────────────────────────────────────
const imageInputRef = ref<HTMLInputElement | null>(null)
function triggerAddImage() { imageInputRef.value?.click() }
async function onAddImageFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) { try { await editor.addImageFromFile(file) } catch (err) { console.error('[Frame] add image:', err) } }
}

// ── Actions ──────────────────────────────────────────────────────────────────
function openEditor() { window.dispatchEvent(new CustomEvent('comfynext:openCompositor', { detail: { nodeId: props.id } })) }
function runThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running) return
  window.dispatchEvent(new CustomEvent('comfynext:runFiltered', { detail: { targetIds: [props.id] } }))
}
// Render the WYSIWYG stack (wired + local layers, in z-order) to an offscreen
// canvas at full output resolution. This is what the artboard shows — so Save
// matches the canvas exactly, including local shapes/text, with no dependency
// on a backend run having happened or the live-preview being fresh.
function exportCompositeCanvas(): HTMLCanvasElement | null {
  const keys = stackKeys.value
  if (!keys.length) return null
  const W = box.value.w, H = box.value.h
  if (!(W > 0 && H > 0)) return null
  // Target resolution: explicit artboard size, else bottom wired image's native
  // size, else a 4× upscale of the display box.
  let outW = frameW.value, outH = frameH.value
  if (!(outW > 0 && outH > 0)) {
    const base = wiredLayers.value[0]
    const d = base ? wiredDims.value[base.url] : undefined
    if (d && d.w && d.h) { outW = d.w; outH = d.h }
    else { outW = W * 4; outH = H * 4 }
  }
  const sx = outW / W, sy = outH / H
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(W * sx))
  cv.height = Math.max(1, Math.round(H * sy))
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  ctx.scale(sx, sy)  // draw in logical box coords; output is full resolution
  // Route through the same masked renderer as the preview (no editing-skip — an
  // export includes every visible layer), so silhouette masks apply on download.
  paintLayerStack(ctx, W, H, buildStackItems(), editor.localLayers.value,
    undefined, undefined, undefined, wiredTreatments.value)
  return cv
}

// Record the baked composite as a project asset so saved frames show up in the
// Assets panel — same treatment as generator outputs. Best-effort: never blocks
// or breaks the local download.
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()
async function recordFrameToAssets(blob: Blob) {
  try {
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'frame')
    if (filename) await recordAsset(activeTab.value?.projectUuid, 'image', filename)
  } catch (err) {
    console.warn('[Frame] record to Assets failed:', err)
  }
}

async function downloadImage() {
  const triggerDownload = (obj: string) => {
    const a = document.createElement('a'); a.href = obj; a.download = `frame-${props.id}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }
  // Prefer the live WYSIWYG composite so Save matches the artboard exactly.
  try {
    const cv = exportCompositeCanvas()
    if (cv) {
      const blob: Blob | null = await new Promise(res => cv.toBlob(res, 'image/png'))
      if (blob) {
        const obj = URL.createObjectURL(blob)
        triggerDownload(obj); URL.revokeObjectURL(obj)
        void recordFrameToAssets(blob)
        return
      }
    }
  } catch (err) {
    // A tainted canvas (cross-origin wired image without CORS) blocks toBlob —
    // fall through to the backend composite below.
    console.warn('[Frame] client composite export failed, using backend output:', err)
  }
  // Fallback: the backend composite output, if any.
  const url = compositeUrl.value
  if (!url) return
  try {
    const res = await fetch(url); const blob = await res.blob()
    const obj = URL.createObjectURL(blob)
    triggerDownload(obj); URL.revokeObjectURL(obj)
    void recordFrameToAssets(blob)
  } catch (err) { console.error('[Frame] download failed:', err) }
}

const dragOver = ref(false)
function onDragOver(e: DragEvent) { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); dragOver.value = true } }
function onDragLeave() { dragOver.value = false }
function onDrop(e: DragEvent) {
  if (!e.dataTransfer?.files?.length) return
  e.preventDefault(); dragOver.value = false
  window.dispatchEvent(new CustomEvent('comfynext:frameDropImage', { detail: { nodeId: props.id, files: e.dataTransfer.files } }))
}

function onKeydown(e: KeyboardEvent) {
  if (!editMode.value) return
  const ae = document.activeElement
  const typing = ae instanceof Element && ae.matches('input, textarea, [contenteditable]')
  if (e.key === 'Escape') { if (editor.editingId.value) editor.endEdit(); else exitEdit() }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selectedId.value && !typing) {
    e.preventDefault(); editor.deleteLocal(editor.selectedId.value)
  }
}
// ── Floating inline toolbar — screen-space, tracks the active selection ──────
// Works for local layers (full per-kind controls) AND wired/generated layers
// (opacity + blend; their transform is handled by the amber handles).
function blendOf(slot: number): string {
  const i = widgetIdx(`layer${slot + 1}_blend`)
  return i >= 0 ? String(props.data.widgetsValues?.[i] ?? 'normal') : 'normal'
}
const toolbarLayer = computed<any>(() => {
  if (editor.selected.value) return editor.selected.value
  if (selectedWiredSlot.value != null) {
    const wl = wiredLayers.value.find(x => x.slot === selectedWiredSlot.value)
    if (wl) return { kind: 'wired', slot: wl.slot, opacity: layerTf(wl.slot, 'opacity'), blend: blendOf(wl.slot), protect: layerProtect(wl.slot) }
  }
  return null
})
function onToolbarSet(patch: Record<string, any>) {
  const slot = selectedWiredSlot.value
  if (slot != null && !editor.selectedId.value) {
    for (const k in patch) {
      if (k === 'blend') setWidget(`layer${slot + 1}_blend`, patch[k])
      else if (k === 'protect') setWidget(`layer${slot + 1}_protect`, !!patch[k])
      else setLayerTf(slot, k, patch[k])
    }
  } else if (editor.selectedId.value) {
    editor.setLocal(editor.selectedId.value, patch)
  }
}

const toolbarPos = ref<{ left: number; top: number; below: boolean } | null>(null)
let toolbarRaf = 0
function updateToolbarPos() {
  const r = artboardRef.value?.getBoundingClientRect()
  if (!editMode.value || !r) { toolbarPos.value = null; return }
  const zoom = box.value.w ? r.width / box.value.w : 1
  let cx: number, cy: number, halfH: number
  const l = editor.selected.value
  if (l) {
    cx = r.left + l.x * r.width
    cy = r.top + l.y * r.height
    halfH = (editor.boxPx(l).h / 2) * zoom
  } else if (selectedWiredSlot.value != null) {
    const wl = wiredLayers.value.find(x => x.slot === selectedWiredSlot.value)
    if (!wl) { toolbarPos.value = null; return }
    const g = wiredGeom(wl)
    cx = r.left + (g.cx / box.value.w) * r.width
    cy = r.top + (g.cy / box.value.h) * r.height
    halfH = g.hh * zoom
  } else { toolbarPos.value = null; return }
  const aboveTop = cy - halfH - 12
  const below = aboveTop < 52
  toolbarPos.value = { left: cx, top: below ? cy + halfH + 12 : aboveTop, below }
}
function toolbarTick() { updateToolbarPos(); toolbarRaf = requestAnimationFrame(toolbarTick) }
watch(() => editMode.value && (editor.selectedId.value != null || selectedWiredSlot.value != null), (on) => {
  cancelAnimationFrame(toolbarRaf)
  if (on) toolbarTick()
  else toolbarPos.value = null
}, { immediate: true })
const toolbarStyle = computed(() => {
  const p = toolbarPos.value
  if (!p) return {}
  return {
    position: 'fixed', left: p.left + 'px', top: p.top + 'px',
    transform: p.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
    zIndex: 60,
  } as any
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointermove', onWiredMove)
  window.removeEventListener('pointermove', onResizeMove)
  cancelAnimationFrame(toolbarRaf)
})
</script>

<template>
  <div
    class="artifact-frame-node relative select-none"
    :class="{ 'opacity-45 grayscale': isMuted, 'opacity-85': isBypassed }"
    :style="{ width: box.w + 'px', '--port-color': imageColor } as any"
    :data-running="data.running || undefined"
    @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop"
  >
    <Handle
      v-for="(slot, i) in layerSlots" :key="slot" :id="`input-${slot}`"
      type="target" :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: handleTop(i, layerSlots.length) }"
    />
    <Handle
      :id="`output-${imageOutIdx}`" type="source" :position="Position.Right"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />

    <div
      class="frame-shell rounded-lg overflow-hidden bg-[#0e0e0e] border"
      :class="data.error ? 'border-red-500 ring-2 ring-red-500' : editMode ? 'border-cyan-400/70 ring-2 ring-cyan-400/40' : 'border-white/10'"
    >
      <!-- Header: title + dimensions -->
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/5">
        <FrameIcon class="size-3 text-white/45 shrink-0" />
        <select
          class="nopan nodrag bg-transparent text-[10.5px] text-white/70 outline-none cursor-pointer hover:text-white/90 max-w-[120px]"
          :value="activePresetId" @change="onPresetChange"
        >
          <option value="" disabled hidden>Size…</option>
          <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
          <option value="custom" disabled hidden>Custom</option>
        </select>
        <span class="flex-1" />
        <div class="flex items-center gap-1 text-[10px] text-white/40 tabular-nums">
          <input type="number" min="0" :value="frameW || ''" placeholder="W"
            class="nopan nodrag w-14 bg-white/[0.04] rounded px-1.5 py-0.5 text-right text-white/70 outline-none focus:bg-white/[0.08] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            @change="setDim('width', $event)" />
          <span>×</span>
          <input type="number" min="0" :value="frameH || ''" placeholder="H"
            class="nopan nodrag w-14 bg-white/[0.04] rounded px-1.5 py-0.5 text-right text-white/70 outline-none focus:bg-white/[0.08] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            @change="setDim('height', $event)" />
        </div>
      </div>

      <!-- Artboard -->
      <div
        ref="artboardRef"
        class="artboard relative bg-checker overflow-hidden"
        :class="editMode ? 'nopan nodrag cursor-default' : 'cursor-pointer'"
        :style="{ width: box.w + 'px', height: box.h + 'px' }"
        @dblclick.capture="onArtboardDblClick"
        @pointerdown.capture="onArtboardPointerDown"
      >
        <canvas ref="stackCanvas" class="absolute inset-0 pointer-events-none" :style="{ width: box.w + 'px', height: box.h + 'px' }" />

        <div v-if="!hasAnyLayer" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/35 pointer-events-none">
          <ImagePlus class="size-7" :stroke-width="1.5" />
          <span class="text-[11px]">Empty frame</span>
          <span class="text-[10px] text-white/25">Wire or drop images · double-click to edit</span>
        </div>

        <!-- Wired-layer selection (amber = connected/composited layer) -->
        <template v-if="editMode && wiredHandlePositions">
          <svg class="absolute inset-0 w-full h-full pointer-events-none" :viewBox="`0 0 ${box.w} ${box.h}`">
            <polygon
              :points="`${wiredHandlePositions.tl.x},${wiredHandlePositions.tl.y} ${wiredHandlePositions.tr.x},${wiredHandlePositions.tr.y} ${wiredHandlePositions.br.x},${wiredHandlePositions.br.y} ${wiredHandlePositions.bl.x},${wiredHandlePositions.bl.y}`"
              fill="none" stroke="#fbbf24" stroke-width="1.5" vector-effect="non-scaling-stroke" />
            <line :x1="wiredHandlePositions.topCenter.x" :y1="wiredHandlePositions.topCenter.y" :x2="wiredHandlePositions.rot.x" :y2="wiredHandlePositions.rot.y" stroke="#fbbf24" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          </svg>
          <div v-for="corner in ['tl', 'tr', 'br', 'bl']" :key="'w-' + corner" data-handle
            class="nopan nodrag absolute size-2.5 bg-white border border-amber-400 cursor-nwse-resize"
            :style="{ left: (wiredHandlePositions as any)[corner].x + 'px', top: (wiredHandlePositions as any)[corner].y + 'px', transform: 'translate(-50%, -50%)' }"
            @pointerdown="startWiredScale($event)" />
          <div data-handle class="nopan nodrag absolute size-3 rounded-full bg-amber-400 cursor-grab border-2 border-[#0e0e0e]"
            :style="{ left: wiredHandlePositions.rot.x + 'px', top: wiredHandlePositions.rot.y + 'px', transform: 'translate(-50%, -50%)' }"
            @pointerdown="startWiredRotate($event)" />
        </template>

        <!-- Local-layer selection (cyan = overlay layer) -->
        <template v-if="editMode && editor.handlePositions.value">
          <svg class="absolute inset-0 w-full h-full pointer-events-none" :viewBox="`0 0 ${box.w} ${box.h}`">
            <polygon
              :points="`${editor.handlePositions.value.tl.x},${editor.handlePositions.value.tl.y} ${editor.handlePositions.value.tr.x},${editor.handlePositions.value.tr.y} ${editor.handlePositions.value.br.x},${editor.handlePositions.value.br.y} ${editor.handlePositions.value.bl.x},${editor.handlePositions.value.bl.y}`"
              fill="none" stroke="#22d3ee" stroke-width="1.5" vector-effect="non-scaling-stroke" />
            <line :x1="editor.handlePositions.value.topCenter.x" :y1="editor.handlePositions.value.topCenter.y" :x2="editor.handlePositions.value.rot.x" :y2="editor.handlePositions.value.rot.y" stroke="#22d3ee" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          </svg>
          <div v-for="corner in ['tl', 'tr', 'br', 'bl']" :key="'h-' + corner" data-handle
            class="nopan nodrag absolute size-2.5 bg-white border border-cyan-400 cursor-nwse-resize"
            :style="{ left: (editor.handlePositions.value as any)[corner].x + 'px', top: (editor.handlePositions.value as any)[corner].y + 'px', transform: 'translate(-50%, -50%)' }"
            @pointerdown="editor.startScale($event)" />
          <div data-handle class="nopan nodrag absolute size-3 rounded-full bg-cyan-400 cursor-grab border-2 border-[#0e0e0e]"
            :style="{ left: editor.handlePositions.value.rot.x + 'px', top: editor.handlePositions.value.rot.y + 'px', transform: 'translate(-50%, -50%)' }"
            @pointerdown="editor.startRotate($event)" />
        </template>

        <!-- Inline text editor -->
        <textarea v-if="editMode && editor.editingLayer.value" :value="editor.editingLayer.value.text"
          class="nopan nodrag absolute bg-transparent outline-none resize-none overflow-hidden border border-dashed border-cyan-400/70 px-0.5"
          :style="editingStyle"
          @input="editor.setLocal(editor.editingLayer.value!.id, { text: ($event.target as HTMLTextAreaElement).value })"
          @blur="editor.endEdit()" @keydown.escape.prevent="editor.endEdit()" @pointerdown.stop />
      </div>

      <!-- Inline edit toolbar -->
      <div v-if="editMode" class="flex items-center gap-0.5 px-1.5 py-1 border-t border-white/5 bg-cyan-400/[0.04]">
        <button class="nopan nodrag size-6 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10" title="Add text" @click="editor.addText()"><Type class="size-3" /></button>
        <button class="nopan nodrag size-6 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10" title="Add rectangle" @click="editor.addRect()"><Square class="size-3" /></button>
        <button class="nopan nodrag size-6 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10" title="Add ellipse" @click="editor.addEllipse()"><Circle class="size-3" /></button>
        <button class="nopan nodrag size-6 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10" title="Add line" @click="editor.addLine()"><Minus class="size-3" /></button>
        <button class="nopan nodrag size-6 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10" title="Add image" @click="triggerAddImage"><ImagePlus class="size-3" /></button>
        <input ref="imageInputRef" type="file" accept="image/*" class="hidden" @change="onAddImageFile" />
        <span class="w-px h-4 bg-white/10 mx-0.5" />
        <button v-if="editor.selectedId.value" class="nopan nodrag size-6 rounded flex items-center justify-center text-white/50 hover:text-rose-300 hover:bg-rose-500/10" title="Delete layer" @click="editor.deleteLocal(editor.selectedId.value)"><Trash2 class="size-3" /></button>
        <span class="flex-1" />
        <button class="nopan nodrag h-6 px-2 rounded flex items-center gap-1 text-[10px] text-cyan-300 hover:bg-cyan-400/10" title="Done editing" @click="exitEdit"><Check class="size-3" /> Done</button>
      </div>

      <!-- Footer -->
      <div v-else class="flex items-center gap-1.5 px-2 py-1.5 border-t border-white/5">
        <span class="text-[10px] text-white/45 tabular-nums">{{ sizeLabel }}</span>
        <span class="flex-1" />
        <button class="nopan nodrag h-5 px-1.5 rounded flex items-center gap-1 text-[10px] text-white/55 hover:text-white/90 hover:bg-white/[0.08] cursor-pointer" title="Edit directly on the canvas" @click.stop="toggleEdit">
          <MousePointer2 class="size-2.5" /> Edit here
        </button>
        <button class="nopan nodrag h-5 px-1.5 rounded flex items-center gap-1 text-[10px] text-white/55 hover:text-white/90 hover:bg-white/[0.08] cursor-pointer" title="Open the full editor for precise / blend / focused work" @click.stop="openEditor">
          <Maximize2 class="size-2.5" /> Open editor
        </button>
        <button class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] cursor-pointer disabled:opacity-40" :disabled="!hasAnyLayer && !compositeUrl" title="Download" @click.stop="downloadImage"><Download class="size-2.5" /></button>
        <button class="nopan nodrag shrink-0 size-5 rounded flex items-center justify-center text-white/45 hover:text-white/85 hover:bg-white/[0.08] cursor-pointer disabled:opacity-40" :disabled="data.running || isMuted || isBypassed" :title="data.running ? 'Running…' : 'Render'" @click.stop="runThisNode">
          <Loader2 v-if="data.running" class="size-3 animate-spin" />
          <RefreshCw v-else class="size-3" />
        </button>
      </div>
    </div>

    <!-- Corner resize grip — sets the on-canvas display size (not output res) -->
    <div
      class="nopan nodrag absolute -bottom-1.5 -right-1.5 size-4 cursor-nwse-resize group/resize"
      title="Resize frame (display size)"
      @pointerdown="onResizeDown"
    >
      <div class="absolute bottom-1 right-1 size-2 border-b-2 border-r-2 border-white/30 group-hover/resize:border-cyan-400 rounded-[1px]" />
    </div>

    <!-- Floating contextual toolbar (screen-space, above the selected layer) -->
    <Teleport to="body">
      <CompositorInlineToolbar
        v-if="toolbarPos && editMode && toolbarLayer"
        :layer="toolbarLayer"
        :px-base="frameW || box.w"
        :style="toolbarStyle"
        @set="onToolbarSet"
        @movez="moveSelectedZ"
        @remove="() => editor.selectedId.value && editor.deleteLocal(editor.selectedId.value)"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.frame-shell { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2); }
.artifact-frame-node[data-running] .frame-shell { box-shadow: 0 0 0 2px var(--port-color, #fff), 0 4px 16px rgba(0, 0, 0, 0.4); }
.bg-checker {
  background-color: #141414;
  background-image:
    linear-gradient(45deg, #1c1c1c 25%, transparent 25%),
    linear-gradient(-45deg, #1c1c1c 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1c1c1c 75%),
    linear-gradient(-45deg, transparent 75%, #1c1c1c 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
</style>
