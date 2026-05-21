<script setup lang="ts">
import { Image as ImageIcon, X, MousePointer2, Hand, GripVertical } from 'lucide-vue-next'

const props = defineProps<{
  nodeId: string
  nodes: any[]
  edges: any[]
}>()

const emit = defineEmits<{ close: [] }>()

const PROPS_PER_LAYER = ['x', 'y', 'rotation', 'scale', 'opacity', 'blend'] as const
const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft_light',
                     'hard_light', 'difference', 'lighten', 'darken', 'add']
const CSS_BLEND: Record<string, string> = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  soft_light: 'soft-light', hard_light: 'hard-light',
  difference: 'difference', lighten: 'lighten', darken: 'darken',
  add: 'plus-lighter',
}

const compositor = computed(() => props.nodes.find((n: any) => n.id === props.nodeId))

function getNodeImageUrl(node: any): string | null {
  if (node?.data?.images?.length) return node.data.images[0]
  if (node?.data?.nodeType === 'LoadImage' && node?.data?.widgetsValues?.[0]) {
    const filename = node.data.widgetsValues[0]
    return `/view?${new URLSearchParams({ filename, type: 'input' })}`
  }
  return null
}

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

const selectedSlot = ref<number | null>(null)
const selected = computed(() => layers.value.find(l => l.slot === selectedSlot.value) ?? null)

const CANVAS_SIZE = 720
const canvasDisplay = { w: CANVAS_SIZE, h: CANVAS_SIZE }

// Track each layer's natural image dimensions so handles align with the
// visible image rectangle (object-contain fit), not the canvas rectangle.
const naturalDims = ref<Record<number, { w: number; h: number }>>({})

function onImageLoad(slot: number, e: Event) {
  const img = e.target as HTMLImageElement
  naturalDims.value = {
    ...naturalDims.value,
    [slot]: { w: img.naturalWidth, h: img.naturalHeight },
  }
}

function fitSize(slot: number) {
  const dims = naturalDims.value[slot]
  if (!dims) return { w: canvasDisplay.w, h: canvasDisplay.h }
  const cAspect = canvasDisplay.w / canvasDisplay.h
  const iAspect = dims.w / dims.h
  if (iAspect > cAspect) return { w: canvasDisplay.w, h: canvasDisplay.w / iAspect }
  return { w: canvasDisplay.h * iAspect, h: canvasDisplay.h }
}

// Layer center in canvas-screen coords.
function layerCenter(layer: Layer) {
  return {
    x: canvasDisplay.w / 2 + layer.x * canvasDisplay.w,
    y: canvasDisplay.h / 2 + layer.y * canvasDisplay.h,
  }
}

// 4 corners + rotation handle in canvas-screen coords, accounting for rotation+scale.
const handlePositions = computed(() => {
  const layer = selected.value
  if (!layer) return null
  const { w: fitW, h: fitH } = fitSize(layer.slot)
  const c = layerCenter(layer)
  const hw = (fitW / 2) * layer.scale
  const hh = (fitH / 2) * layer.scale
  const rad = (layer.rotation * Math.PI) / 180
  const cosA = Math.cos(rad), sinA = Math.sin(rad)
  const transform = (dx: number, dy: number) => ({
    x: c.x + dx * cosA - dy * sinA,
    y: c.y + dx * sinA + dy * cosA,
  })
  return {
    tl: transform(-hw, -hh),
    tr: transform(hw, -hh),
    br: transform(hw, hh),
    bl: transform(-hw, hh),
    // Rotation handle: 30px above the top-center, in the layer's rotated frame
    rot: transform(0, -hh - 30 / Math.max(layer.scale, 0.1)),
    topCenter: transform(0, -hh),
    center: c,
  }
})

// ── Drag / scale / rotate interactions ────────────────────────────────────

interface DragMove {
  type: 'move'
  slot: number
  startMouseX: number; startMouseY: number
  startX: number; startY: number
}
interface DragScale {
  type: 'scale'
  slot: number
  startMouseX: number; startMouseY: number
  startScale: number
  centerX: number; centerY: number
  startDist: number
}
interface DragRotate {
  type: 'rotate'
  slot: number
  startAngle: number
  startRotation: number
  centerX: number; centerY: number
}
type Drag = DragMove | DragScale | DragRotate | null
const drag = ref<Drag>(null)

function onLayerPointerDown(slot: number, e: PointerEvent) {
  e.preventDefault()
  e.stopPropagation()
  selectedSlot.value = slot
  const layer = layers.value.find(l => l.slot === slot)
  if (!layer) return
  drag.value = {
    type: 'move', slot,
    startMouseX: e.clientX, startMouseY: e.clientY,
    startX: layer.x, startY: layer.y,
  }
  attachPointerListeners()
}

function onScalePointerDown(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const layer = selected.value
  if (!layer) return
  const c = layerCenter(layer)
  const r = canvasRect()
  if (!r) return
  const mx = e.clientX - r.left
  const my = e.clientY - r.top
  drag.value = {
    type: 'scale', slot: layer.slot,
    startMouseX: e.clientX, startMouseY: e.clientY,
    startScale: layer.scale,
    centerX: c.x, centerY: c.y,
    startDist: Math.hypot(mx - c.x, my - c.y),
  }
  attachPointerListeners()
}

function onRotatePointerDown(e: PointerEvent) {
  e.preventDefault(); e.stopPropagation()
  const layer = selected.value
  if (!layer) return
  const c = layerCenter(layer)
  const r = canvasRect()
  if (!r) return
  const mx = e.clientX - r.left
  const my = e.clientY - r.top
  drag.value = {
    type: 'rotate', slot: layer.slot,
    startAngle: Math.atan2(my - c.y, mx - c.x),
    startRotation: layer.rotation,
    centerX: c.x, centerY: c.y,
  }
  attachPointerListeners()
}

const canvasRef = ref<HTMLDivElement | null>(null)
function canvasRect(): DOMRect | null {
  return canvasRef.value?.getBoundingClientRect() ?? null
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
    const r = canvasRect()
    if (!r) return
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const dist = Math.hypot(mx - d.centerX, my - d.centerY)
    const ratio = d.startDist > 0 ? dist / d.startDist : 1
    setLayerProp(d.slot, 'scale', clamp(d.startScale * ratio, 0.1, 3.0))
  } else if (d.type === 'rotate') {
    const r = canvasRect()
    if (!r) return
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const angle = Math.atan2(my - d.centerY, mx - d.centerX)
    const delta = ((angle - d.startAngle) * 180) / Math.PI
    let rot = d.startRotation + delta
    while (rot > 180) rot -= 360
    while (rot < -180) rot += 360
    setLayerProp(d.slot, 'rotation', rot)
  }
}

function onPointerUp() {
  drag.value = null
  detachPointerListeners()
}

function attachPointerListeners() {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}
function detachPointerListeners() {
  window.removeEventListener('pointermove', onPointerMove)
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function onCanvasClick(e: MouseEvent) {
  if (e.target === canvasRef.value) selectedSlot.value = null
}

// ── Layer reordering ───────────────────────────────────────────────────────
// Display list is top-to-bottom (slot 4 first by default). We move the entry
// at position `fromIdx` to `toIdx` in that list, then re-derive slot order
// from the result, permuting both widget values and edge target handles so
// the image + its transform travel together.

const reversedLayers = computed(() => [...layers.value].reverse())

const draggingSlot = ref<number | null>(null)
const dragOverIdx = ref<number | null>(null)

function onLayerDragStart(slot: number, e: DragEvent) {
  draggingSlot.value = slot
  e.dataTransfer?.setData('text/plain', String(slot))
  e.dataTransfer && (e.dataTransfer.effectAllowed = 'move')
}
function onLayerDragOver(idx: number, e: DragEvent) {
  e.preventDefault()
  dragOverIdx.value = idx
  e.dataTransfer && (e.dataTransfer.dropEffect = 'move')
}
function onLayerDragLeave() {
  dragOverIdx.value = null
}
function onLayerDrop(toIdx: number) {
  const fromSlot = draggingSlot.value
  draggingSlot.value = null
  dragOverIdx.value = null
  if (fromSlot == null) return
  const display = reversedLayers.value
  const fromIdx = display.findIndex(l => l.slot === fromSlot)
  if (fromIdx < 0 || fromIdx === toIdx) return
  reorderDisplay(fromIdx, toIdx)
}

function reorderDisplay(fromIdx: number, toIdx: number) {
  const node = compositor.value
  if (!node) return
  const defs = node.data.widgetDefs as any[]
  const wv = node.data.widgetsValues as any[]
  const widgetIdx = (slot: number, prop: string) =>
    defs.findIndex((d: any) => d.name === `layer${slot}_${prop}`)

  // Current display order (top→bottom) of slot numbers
  const displaySlots = reversedLayers.value.map(l => l.slot)
  // Insert the dragged entry at the target position
  const [moved] = displaySlots.splice(fromIdx, 1)
  displaySlots.splice(toIdx, 0, moved)
  // Convert back to compositor slot order (slot 1 = bottom in our schema,
  // which is the LAST entry in display top→bottom order)
  const newSlotOrder = [...displaySlots].reverse()

  // Snapshot every connected slot's payload so we can shuffle without races.
  // Each entry is { sourceSlot, transform, edgeId }
  type Snap = { transform: Record<string, any>; edgeId: string | null }
  const snapshot: Record<number, Snap> = {}
  for (const oldSlot of displaySlots) {  // only the connected ones
    const transform: Record<string, any> = {}
    for (const prop of PROPS_PER_LAYER) {
      transform[prop] = wv[widgetIdx(oldSlot, prop)]
    }
    const edge = props.edges.find((e: any) =>
      e.target === props.nodeId && e.targetHandle === `input-${oldSlot - 1}`)
    snapshot[oldSlot] = { transform, edgeId: edge?.id ?? null }
  }

  // Apply: for each NEW slot position, take payload from the source slot it
  // should now hold. newSlotOrder[k] is the OLD slot that goes to NEW slot
  // index k+1 from the BOTTOM. Build mapping new_slot → old_slot.
  // newSlotOrder is bottom-to-top: index 0 = bottom (slot 1).
  for (let k = 0; k < newSlotOrder.length; k++) {
    const oldSlot = newSlotOrder[k]
    const newSlot = 4 - (displaySlots.length - 1 - k) // map display position back to compositor slot
    // Hmm, that's confusing — simpler: if we have N connected layers and they
    // should keep occupying slots 1..N in their new order, then newSlot is k+1
    // counting from the bottom. But we need a stable mapping that doesn't
    // collide with disconnected slots. Easiest: shuffle within the SET of
    // currently-occupied slots, preserving which slots are filled.
  }

  // Simpler, correct algorithm:
  //  - Connected slots stay connected; we permute within the set of occupied slots.
  //  - sourceSlots = displaySlots (the OLD order, still listing which slots have layers)
  //  - targetSlots = same set, but assigning each old slot's data to a new slot
  //    based on the user's new ordering.
  // Read the new ordering from `displaySlots` (after splice): display position k
  // (top-to-bottom) should hold what was in OLD slot displaySlots[k].
  // The set of OCCUPIED slots (before/after reorder) is the same: occupied = sourceSlots sorted.
  const occupied = Object.keys(snapshot).map(Number).sort((a, b) => b - a) // top→bottom
  // occupied[k] is the slot that holds display position k after reorder.
  // We want display position k to now contain data from OLD slot displaySlots[k].
  for (let k = 0; k < occupied.length; k++) {
    const newSlot = occupied[k]
    const sourceSlot = displaySlots[k]
    const snap = snapshot[sourceSlot]
    // Write widget values
    for (const prop of PROPS_PER_LAYER) {
      wv[widgetIdx(newSlot, prop)] = snap.transform[prop]
    }
    // Move the edge to point at newSlot's input handle
    if (snap.edgeId) {
      const edge = props.edges.find((e: any) => e.id === snap.edgeId)
      if (edge) edge.targetHandle = `input-${newSlot - 1}`
    }
  }
  // If the selected layer was one of the moved ones, keep selection by slot
  // (which now holds different data — that's the intent, the selection follows
  // the VISUAL position, not the layer image. So pick the slot at the same
  // display position as before, which is `toIdx`).
  selectedSlot.value = occupied[toIdx]
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
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
        <div class="text-xs text-white/60 px-1 py-1 flex items-center gap-1.5">
          <span class="text-white/40">#</span>
          <span>Canvas</span>
        </div>
        <div
          v-for="(layer, idx) in reversedLayers"
          :key="layer.slot"
          draggable="true"
          class="group flex items-center gap-2 pl-5 pr-2 py-1.5 rounded cursor-pointer transition-colors relative"
          :class="[
            selectedSlot === layer.slot ? 'bg-white/10' : 'hover:bg-white/[0.04]',
            draggingSlot === layer.slot ? 'opacity-40' : '',
          ]"
          @click="selectedSlot = layer.slot"
          @dragstart="onLayerDragStart(layer.slot, $event)"
          @dragover="onLayerDragOver(idx, $event)"
          @dragleave="onLayerDragLeave"
          @drop="onLayerDrop(idx)"
          @dragend="draggingSlot = null; dragOverIdx = null"
        >
          <!-- Drop indicator line -->
          <div
            v-if="dragOverIdx === idx && draggingSlot != null && draggingSlot !== layer.slot"
            class="absolute -top-px left-0 right-0 h-0.5 bg-yellow-400"
          />
          <GripVertical class="size-3 text-white/30 group-hover:text-white/60 shrink-0" />
          <ImageIcon class="size-3.5 text-white/60 shrink-0" />
          <span class="text-sm">Layer {{ layer.slot }}</span>
        </div>
        <div v-if="!layers.length" class="text-xs text-white/30 px-1 py-2 italic">
          Connect images to the Compositor's layer ports.
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
      >
        <img
          v-for="layer in layers"
          :key="layer.slot"
          :src="layer.url"
          draggable="false"
          class="absolute inset-0 w-full h-full object-contain origin-center select-none touch-none"
          :style="{
            transform: `translate(${layer.x * 100}%, ${layer.y * 100}%) rotate(${layer.rotation}deg) scale(${layer.scale})`,
            opacity: layer.opacity,
            mixBlendMode: CSS_BLEND[layer.blend] || 'normal',
            cursor: drag?.type === 'move' && drag.slot === layer.slot ? 'grabbing' : 'grab',
          }"
          @load="onImageLoad(layer.slot, $event)"
          @pointerdown="onLayerPointerDown(layer.slot, $event)"
        />

        <!-- Selection / handles overlay -->
        <svg
          v-if="handlePositions"
          class="absolute inset-0 w-full h-full pointer-events-none"
          :viewBox="`0 0 ${canvasDisplay.w} ${canvasDisplay.h}`"
        >
          <polygon
            :points="`${handlePositions.tl.x},${handlePositions.tl.y} ${handlePositions.tr.x},${handlePositions.tr.y} ${handlePositions.br.x},${handlePositions.br.y} ${handlePositions.bl.x},${handlePositions.bl.y}`"
            fill="none"
            stroke="#facc15"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
          <line
            :x1="handlePositions.topCenter.x" :y1="handlePositions.topCenter.y"
            :x2="handlePositions.rot.x" :y2="handlePositions.rot.y"
            stroke="#facc15"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <template v-if="handlePositions">
          <!-- Corner scale handles -->
          <div
            v-for="corner in ['tl', 'tr', 'br', 'bl']"
            :key="corner"
            class="absolute size-2.5 bg-white border border-yellow-400 cursor-nwse-resize"
            :style="{
              left: handlePositions[corner].x + 'px',
              top: handlePositions[corner].y + 'px',
              transform: 'translate(-50%, -50%)',
            }"
            @pointerdown="onScalePointerDown($event)"
          />
          <!-- Rotation handle -->
          <div
            class="absolute size-3 rounded-full bg-yellow-400 cursor-grab border-2 border-[#1a1a1a]"
            :style="{
              left: handlePositions.rot.x + 'px',
              top: handlePositions.rot.y + 'px',
              transform: 'translate(-50%, -50%)',
            }"
            @pointerdown="onRotatePointerDown($event)"
          />
        </template>
      </div>

      <!-- Bottom toolbar -->
      <div class="absolute bottom-4 flex items-center gap-1 bg-[#1a1a1a]/95 backdrop-blur-sm rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg">
        <button class="flex items-center justify-center size-8 rounded-[8px] bg-yellow-400/90 text-black cursor-pointer">
          <MousePointer2 class="size-4" />
        </button>
        <button class="flex items-center justify-center size-8 rounded-[8px] hover:bg-white/5 text-white/60 cursor-not-allowed opacity-40" disabled>
          <Hand class="size-4" />
        </button>
      </div>
    </div>

    <!-- Right sidebar: properties -->
    <div class="w-72 border-l border-white/10 shrink-0 flex flex-col">
      <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <ImageIcon class="size-3.5 text-white/60" />
        <span class="text-sm font-medium">{{ selected ? `Layer ${selected.slot}` : 'No selection' }}</span>
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
        Select a layer to edit its properties.
      </div>
    </div>
    </div>
  </div>
</template>
