<script setup lang="ts">
/**
 * Canvas for the v2 (Swiss grid) editor. Everything the user sees comes from
 * the shared resolver — positions, font sizes, truncation, culling — so the
 * canvas can't drift from what the node renders. Dragging and resizing snap
 * to grid cells via shared/template-grid/editor.ts.
 */
import type { GridEditorContext } from '~/composables/useGridEditor'
import { colorToRgba } from '~~/shared/template-grid/color'
import { dragRegion, resizeRegion } from '~~/shared/template-grid/editor'
import type { ResolvedElement } from '~~/shared/template-grid/resolve'
import type { Region } from '~~/shared/template-grid/types'

const ctx = inject<GridEditorContext>('gridEditor')!
const {
  template, format, formatClass, currentFormat, currentOutputId, metrics, resolved, selectedId,
  sampleProps, effectiveBrand, setRegion, patchElement,
} = ctx

// -- Render-true preview ------------------------------------------------------
// Overlays the actual server render of the current format so designers confirm
// satori wrapping/sizing before a run. Read-only while on.
const previewMode = ref(false)
const previewUrl = ref<string | null>(null)
const previewLoading = ref(false)
let previewBlobUrl: string | null = null
let previewTimer: ReturnType<typeof setTimeout> | null = null

async function loadPreview() {
  previewLoading.value = true
  try {
    const res = await fetch('/api/render-template', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template: template.value, aspect: currentFormat.value, outputId: currentOutputId.value,
        props: sampleProps.value, brand: effectiveBrand.value,
      }),
    })
    if (!res.ok) throw new Error(String(res.status))
    if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl)
    previewBlobUrl = URL.createObjectURL(await res.blob())
    previewUrl.value = previewBlobUrl
  } catch {
    previewUrl.value = null
  } finally {
    previewLoading.value = false
  }
}

function schedulePreview() {
  if (!previewMode.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(loadPreview, 300)
}

function togglePreview() {
  previewMode.value = !previewMode.value
  if (previewMode.value) loadPreview()
}

// Keep the preview current with edits + format switches while it's on.
watch([currentFormat, currentOutputId, template], schedulePreview, { deep: true })
onBeforeUnmount(() => { if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl) })

// -- Container sizing (same model as the v1 canvas) -------------------------

const containerRef = ref<HTMLDivElement | null>(null)
const containerSize = ref({ w: 0, h: 0 })

function measure() {
  if (!containerRef.value) return
  const r = containerRef.value.getBoundingClientRect()
  containerSize.value = { w: r.width, h: r.height }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    const ro = new ResizeObserver(measure)
    ro.observe(containerRef.value)
    onUnmounted(() => ro.disconnect())
  } else {
    window.addEventListener('resize', measure)
    onUnmounted(() => window.removeEventListener('resize', measure))
  }
})

// Fit-to-container scale. `zoomOverride` (null = follow fit) lets the user
// zoom in past fit; switching format resets to fit.
const fitScale = computed(() => {
  if (!containerSize.value.w || !containerSize.value.h) return 1
  const padding = 64
  const sw = (containerSize.value.w - padding) / format.value.w
  const sh = (containerSize.value.h - padding) / format.value.h
  return Math.min(sw, sh, 1)
})
const zoomOverride = ref<number | null>(null)
const scale = computed(() => zoomOverride.value ?? fitScale.value)

watch(() => ctx.currentFormat.value, () => { zoomOverride.value = null })

function zoomBy(factor: number) {
  zoomOverride.value = Math.min(4, Math.max(0.05, (zoomOverride.value ?? fitScale.value) * factor))
}
function zoomFit() { zoomOverride.value = null }

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return   // plain scroll left alone
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
}

// -- Token resolution for sample preview ------------------------------------

function resolve(s: unknown): string {
  if (typeof s !== 'string') return String(s ?? '')
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const [scope, key] = path.split('.')
    const dict = scope === 'props' ? sampleProps.value : scope === 'brand' ? effectiveBrand.value : {}
    return String((dict as any)[key] ?? '')
  })
}

const backgroundStyle = computed(() => {
  const bg = template.value.background
  if (!bg) return { background: '#000' }
  if (bg.image) return { background: `url(${resolve(bg.image)}) center / cover no-repeat` }
  return { background: resolve(bg.fill ?? '#000') }
})

// -- Grid overlay geometry ---------------------------------------------------

const gridCells = computed(() => {
  const m = metrics.value
  const innerH = m.rows * m.cellH + (m.rows - 1) * m.gutter
  const cols = Array.from({ length: m.cols }, (_, i) => ({
    left: m.originX + i * (m.cellW + m.gutter),
    top: m.originY,
    width: m.cellW,
    height: innerH,
  }))
  const rowLines = Array.from({ length: Math.max(0, m.rows - 1) }, (_, i) => ({
    left: m.originX,
    top: m.originY + (i + 1) * (m.cellH + m.gutter) - m.gutter / 2,
    width: m.cols * m.cellW + (m.cols - 1) * m.gutter,
  }))
  return { cols, rowLines }
})

const safeStrips = computed(() => {
  const sa = format.value.safeArea
  if (!sa) return []
  const { w, h } = format.value
  const strips: Array<{ left: number; top: number; width: number; height: number }> = []
  if (sa.top) strips.push({ left: 0, top: 0, width: w, height: sa.top })
  if (sa.bottom) strips.push({ left: 0, top: h - sa.bottom, width: w, height: sa.bottom })
  if (sa.left) strips.push({ left: 0, top: 0, width: sa.left, height: h })
  if (sa.right) strips.push({ left: w - sa.right, top: 0, width: sa.right, height: h })
  return strips
})

// -- Element rendering (from resolver output) --------------------------------

const visible = computed(() => resolved.value.elements.filter(r => !r.culled))
// Hidden elements are intentional, not a layout problem — keep them out of the
// "dropped here" chips.
const culled = computed(() => resolved.value.elements.filter(r => r.culled && r.cullReason !== 'hidden'))

function rectStyle(r: ResolvedElement): Record<string, string> {
  return {
    position: 'absolute',
    left: `${r.rect.x}px`,
    top: `${r.rect.y}px`,
    width: `${r.rect.w}px`,
    height: `${r.rect.h}px`,
  }
}

function textStyle(r: ResolvedElement): Record<string, string | number> {
  const el = r.el
  if (el.type !== 'text') return {}
  const s = el.style ?? {}
  const align = s.align ?? 'left'
  const valign = s.valign ?? (formatClass.value === 'strip' ? 'middle' : 'top')
  const panel = s.panel
  return {
    color: resolve(s.color ?? '#fff'),
    fontSize: `${r.text?.fontSize ?? 16}px`,
    fontWeight: s.fontWeight ?? 400,
    fontFamily: s.fontFamily ?? 'Inter, system-ui, sans-serif',
    textAlign: align,
    lineHeight: s.lineHeight ?? 1.1,
    letterSpacing: s.letterSpacing != null ? `${s.letterSpacing}px` : 'normal',
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    justifyContent: valign === 'bottom' ? 'flex-end' : valign === 'middle' ? 'center' : 'flex-start',
    alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    ...(panel?.fill
      ? { background: colorToRgba(resolve(panel.fill), panel.opacity ?? 1), borderRadius: `${panel.radius ?? 0}px` }
      : {}),
  }
}

function shapeStyle(r: ResolvedElement): Record<string, string> {
  const el = r.el
  if (el.type !== 'shape') return {}
  const s = el.style ?? {}
  return {
    width: '100%', height: '100%',
    background: resolve(s.fill ?? '#000'),
    borderRadius: el.shape === 'circle' ? '9999px' : `${s.borderRadius ?? 0}px`,
    border: s.borderWidth ? `${s.borderWidth}px solid ${resolve(s.borderColor ?? '#000')}` : 'none',
  }
}

function imageStyle(r: ResolvedElement): Record<string, string> {
  const el = r.el
  if (el.type !== 'image') return {}
  const fit = el.style?.fit ?? 'cover'
  const focal = el.focal ?? { x: 0.5, y: 0.5 }
  return {
    width: '100%', height: '100%', display: 'block',
    objectFit: fit === 'contain' ? 'contain' : fit === 'stretch' ? 'fill' : 'cover',
    objectPosition: `${Math.round(focal.x * 100)}% ${Math.round(focal.y * 100)}%`,
    borderRadius: `${el.style?.borderRadius ?? 0}px`,
  }
}

function imageSrc(r: ResolvedElement): string {
  return r.el.type === 'image' ? resolve(r.el.content) : ''
}

// -- Drag to move (snaps to cells) -------------------------------------------

let dragState: {
  id: string
  startRegion: Region
  startClientX: number
  startClientY: number
  moved: boolean
} | null = null

// -- Reposition (pan) mode: double-click an image, then drag it to pan the
// focal point (object-position). satori renders object-position faithfully, so
// what you pan here matches the output. Esc / click-out / select-other exits.
const repositionId = ref<string | null>(null)
let panState: {
  id: string; startFocal: { x: number; y: number }
  startClientX: number; startClientY: number; w: number; h: number
} | null = null

function enterReposition(r: ResolvedElement) {
  if (previewMode.value || r.el.type !== 'image' || r.el.locked) return
  selectedId.value = r.el.id
  repositionId.value = r.el.id
}

watch(selectedId, (id) => { if (id !== repositionId.value) repositionId.value = null })
function onRepositionKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && repositionId.value) { e.stopPropagation(); repositionId.value = null }
}
onMounted(() => window.addEventListener('keydown', onRepositionKey, true))
onUnmounted(() => window.removeEventListener('keydown', onRepositionKey, true))

function onElementPointerDown(e: PointerEvent, r: ResolvedElement) {
  e.stopPropagation()
  if (previewMode.value) return        // read-only while previewing the render
  selectedId.value = r.el.id
  // In reposition mode, body-drag pans the image instead of moving the element.
  if (repositionId.value === r.el.id && r.el.type === 'image') {
    const focal = (r.el as any).focal ?? { x: 0.5, y: 0.5 }
    panState = {
      id: r.el.id, startFocal: { ...focal },
      startClientX: e.clientX, startClientY: e.clientY, w: r.rect.w, h: r.rect.h,
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    return
  }
  if (r.el.locked || !r.region) return
  dragState = {
    id: r.el.id,
    startRegion: { ...r.region },
    startClientX: e.clientX,
    startClientY: e.clientY,
    moved: false,
  }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onElementPointerMove(e: PointerEvent) {
  if (panState) {
    const s = scale.value || 1
    // Drag the image right → reveal its left side → object-position decreases.
    const dx = (e.clientX - panState.startClientX) / s
    const dy = (e.clientY - panState.startClientY) / s
    const nx = Math.min(1, Math.max(0, panState.startFocal.x - dx / panState.w))
    const ny = Math.min(1, Math.max(0, panState.startFocal.y - dy / panState.h))
    patchElement(panState.id, { focal: { x: nx, y: ny } })
    return
  }
  if (!dragState) return
  const s = scale.value || 1
  const next = dragRegion(
    dragState.startRegion,
    (e.clientX - dragState.startClientX) / s,
    (e.clientY - dragState.startClientY) / s,
    metrics.value,
  )
  const cur = resolved.value.elements.find(r => r.el.id === dragState!.id)?.region
  if (cur && (cur.col !== next.col || cur.row !== next.row)) {
    dragState.moved = true
    setRegion(dragState.id, next)
  }
}

function onElementPointerUp(e: PointerEvent) {
  if (panState) {
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    panState = null
    return
  }
  if (!dragState) return
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  dragState = null
}

// -- Resize handles (snap spans to cells) ------------------------------------

type HandleDir = 'nw' | 'ne' | 'sw' | 'se'
let resizeState: {
  id: string
  dir: HandleDir
  startRegion: Region
  startClientX: number
  startClientY: number
} | null = null

function onHandlePointerDown(e: PointerEvent, r: ResolvedElement, dir: HandleDir) {
  e.stopPropagation()
  e.preventDefault()
  selectedId.value = r.el.id
  if (!r.region) return
  resizeState = {
    id: r.el.id,
    dir,
    startRegion: { ...r.region },
    startClientX: e.clientX,
    startClientY: e.clientY,
  }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onHandlePointerMove(e: PointerEvent) {
  if (!resizeState) return
  const s = scale.value || 1
  const next = resizeRegion(
    resizeState.startRegion,
    resizeState.dir,
    (e.clientX - resizeState.startClientX) / s,
    (e.clientY - resizeState.startClientY) / s,
    metrics.value,
  )
  const cur = resolved.value.elements.find(r => r.el.id === resizeState!.id)?.region
  if (cur && (cur.col !== next.col || cur.row !== next.row
    || cur.colSpan !== next.colSpan || cur.rowSpan !== next.rowSpan)) {
    setRegion(resizeState.id, next)
  }
}

function onHandlePointerUp(e: PointerEvent) {
  if (!resizeState) return
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  resizeState = null
}

function onCanvasClick(e: MouseEvent) {
  if (e.target === e.currentTarget) selectedId.value = null
}
</script>

<template>
  <div
    ref="containerRef"
    class="absolute inset-0 flex items-center justify-center select-none"
    @pointermove="(e) => { onElementPointerMove(e); onHandlePointerMove(e) }"
    @pointerup="(e) => { onElementPointerUp(e); onHandlePointerUp(e) }"
    @wheel="onWheel"
  >
    <!-- Scaled wrapper; inner div is template coordinate space. -->
    <div
      class="relative shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
      :style="{
        width: format.w + 'px',
        height: format.h + 'px',
        transform: `scale(${scale})`,
        transformOrigin: 'center',
        ...backgroundStyle,
      }"
      @click="onCanvasClick"
    >
      <!-- Grid overlay (under elements, non-interactive) -->
      <div class="absolute inset-0 pointer-events-none">
        <div
          v-for="(c, i) in gridCells.cols"
          :key="`c${i}`"
          class="absolute"
          :style="{
            left: c.left + 'px', top: c.top + 'px',
            width: c.width + 'px', height: c.height + 'px',
            background: 'rgba(150,180,255,0.05)',
            borderLeft: '1px solid rgba(150,180,255,0.16)',
            borderRight: '1px solid rgba(150,180,255,0.16)',
          }"
        />
        <div
          v-for="(l, i) in gridCells.rowLines"
          :key="`r${i}`"
          class="absolute"
          :style="{
            left: l.left + 'px', top: l.top + 'px',
            width: l.width + 'px', height: '1px',
            background: 'rgba(150,180,255,0.14)',
          }"
        />
        <!-- Safe-area hatching (platform UI zones) -->
        <div
          v-for="(s, i) in safeStrips"
          :key="`s${i}`"
          class="absolute"
          :style="{
            left: s.left + 'px', top: s.top + 'px',
            width: s.width + 'px', height: s.height + 'px',
            background: 'repeating-linear-gradient(45deg, rgba(255,90,90,0.08) 0 8px, transparent 8px 16px)',
            boxShadow: 'inset 0 0 0 1px rgba(255,90,90,0.15)',
          }"
        />
      </div>

      <!-- Elements (resolver output; culled ones don't render) -->
      <div
        v-for="r in visible"
        :key="r.el.id"
        :style="[rectStyle(r), { cursor: repositionId === r.el.id ? 'grab' : r.el.locked ? 'default' : 'move' }]"
        class="group"
        :class="repositionId === r.el.id
          ? 'outline outline-2 outline-[#96b4ff] outline-dashed'
          : selectedId === r.el.id
            ? (r.el.locked ? 'outline outline-2 outline-white/30 outline-dashed' : 'outline outline-2 outline-[#96b4ff] outline-offset-0')
            : 'hover:outline hover:outline-1 hover:outline-white/30'"
        @pointerdown="(e) => onElementPointerDown(e, r)"
        @dblclick="(e) => { if (r.el.type === 'image') { e.stopPropagation(); enterReposition(r) } }"
      >
        <template v-if="r.el.type === 'text'">
          <div :style="textStyle(r)">{{ r.text?.content ?? '' }}</div>
        </template>
        <template v-else-if="r.el.type === 'image'">
          <div class="size-full overflow-hidden">
            <img v-if="imageSrc(r)" :src="imageSrc(r)" :style="imageStyle(r)" draggable="false">
            <div v-else class="size-full bg-white/[0.05] border border-dashed border-white/15 flex items-center justify-center text-center text-white/30 text-xs p-2">
              {{ r.mark ? 'mark' : 'image — wired preview appears after the first run' }}
            </div>
          </div>
        </template>
        <template v-else-if="r.el.type === 'shape'">
          <div :style="shapeStyle(r)" />
        </template>

        <!-- Resize handles — hidden while repositioning so they don't fight the pan drag. -->
        <template v-if="selectedId === r.el.id && !r.el.locked && repositionId !== r.el.id">
          <div
            v-for="dir in (['nw', 'ne', 'sw', 'se'] as const)"
            :key="dir"
            class="absolute size-3 bg-white border border-[#96b4ff] rounded-sm"
            :style="{
              top:    dir.startsWith('n') ? '-6px' : 'auto',
              bottom: dir.startsWith('s') ? '-6px' : 'auto',
              left:   dir.endsWith('w')   ? '-6px' : 'auto',
              right:  dir.endsWith('e')   ? '-6px' : 'auto',
              cursor: dir === 'nw' || dir === 'se' ? 'nwse-resize' : 'nesw-resize',
            }"
            @pointerdown="(e) => onHandlePointerDown(e, r, dir)"
          />
        </template>

        <!-- Reposition hints (images only) -->
        <div
          v-if="repositionId === r.el.id"
          class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-[#96b4ff]/90 text-black text-[10px] font-medium pointer-events-none whitespace-nowrap"
        >Drag to reposition · Esc to finish</div>
        <div
          v-else-if="selectedId === r.el.id && r.el.type === 'image' && !r.el.locked"
          class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white/80 text-[10px] pointer-events-none whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity"
        >Double-click to reposition</div>
      </div>

      <!-- Render-true preview overlay (actual server render) -->
      <img
        v-if="previewMode && previewUrl"
        :src="previewUrl"
        class="absolute inset-0 w-full h-full"
        :alt="`Rendered ${currentFormat}`"
      >
    </div>

    <!-- Culled-here chips -->
    <div v-if="culled.length" class="absolute bottom-3 left-3 flex flex-wrap gap-1.5 max-w-[60%]">
      <button
        v-for="r in culled"
        :key="r.el.id"
        class="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/25 text-[10px] text-amber-200/90 hover:bg-amber-500/20 transition-colors cursor-pointer"
        :title="r.cullReason === 'no-slot'
          ? 'No slot in this format class — select it and set a region in the properties panel to place it here'
          : 'Region too small in this format'"
        @click="selectedId = r.el.id"
      >
        {{ r.el.id }} · culled ({{ r.cullReason === 'no-slot' ? 'no slot' : 'too small' }})
      </button>
    </div>

    <!-- Bottom-right: preview toggle + zoom controls + readout -->
    <div class="absolute bottom-3 right-3 flex items-center gap-2">
      <button
        class="h-7 px-2.5 rounded flex items-center gap-1.5 text-[11px] backdrop-blur-sm transition-colors cursor-pointer"
        :class="previewMode ? 'bg-[#96b4ff]/25 text-[#c9d6ff]' : 'bg-black/50 text-white/60 hover:text-white'"
        :title="previewMode ? 'Editing view' : 'Preview the actual rendered output for this format'"
        @click="togglePreview"
      >
        {{ previewLoading ? 'Rendering…' : previewMode ? 'Editing' : 'Preview' }}
      </button>
      <div class="flex items-center gap-0.5 bg-black/50 rounded backdrop-blur-sm p-0.5">
        <button class="size-6 rounded hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white cursor-pointer text-sm leading-none" title="Zoom out" @click="zoomBy(1 / 1.2)">−</button>
        <button
          class="px-1.5 h-6 rounded hover:bg-white/10 flex items-center justify-center text-[10px] hover:text-white cursor-pointer tabular-nums min-w-[3.5rem]"
          :class="zoomOverride === null ? 'text-white/60' : 'text-[#c9d6ff]'"
          :title="zoomOverride === null ? 'Fitted to view' : 'Click to fit to view'"
          @click="zoomFit"
        >
          {{ Math.round(scale * 100) }}%
        </button>
        <button class="size-6 rounded hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white cursor-pointer text-sm leading-none" title="Zoom in" @click="zoomBy(1.2)">+</button>
      </div>
      <div class="text-[10px] text-white/40 tabular-nums bg-black/40 px-2 py-1 rounded backdrop-blur-sm">
        {{ format.w }} × {{ format.h }} · {{ formatClass }} · {{ metrics.cols }}×{{ metrics.rows }} grid
      </div>
    </div>
  </div>
</template>
