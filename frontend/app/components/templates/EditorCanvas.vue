<script setup lang="ts">
/**
 * The canvas where the template is rendered for editing.
 *
 * Approach:
 *  - All element positions stay in *template coordinates* (px in the current
 *    aspect's native dimensions). The canvas is a div sized to that.
 *  - The canvas itself is scaled via CSS transform so it fits the container —
 *    we measure the container, compute a fit-to-contain scale, and apply once.
 *  - Pointer events on elements drive drag-to-move and resize-by-handle. We
 *    convert client-space deltas back into template-space by dividing by scale.
 *  - Elements display the *effective* style for the current aspect (base merged
 *    with overrides[currentAspect]). Drag/resize writes to the base — Sprint 3
 *    will add the "if currentAspect != defaultAspect, write to overrides" logic.
 */
import type { Anchor, LayoutElement, Length } from '~~/server/templates/schema'

const ctx = inject<ReturnType<typeof useTemplateEditor>>('templateEditor')!
const { template, currentAspect, aspect, selectedId, patchEffective, sampleProps, sampleBrand } = ctx

// -- Container sizing ------------------------------------------------------

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

// Fit the template into the container with ~32px padding on each side.
const scale = computed(() => {
  if (!containerSize.value.w || !containerSize.value.h) return 1
  const padding = 64
  const sw = (containerSize.value.w - padding) / aspect.value.w
  const sh = (containerSize.value.h - padding) / aspect.value.h
  return Math.min(sw, sh, 1)  // never scale UP (avoid blurry uplift on small templates)
})

// -- Length resolution (template → px) ------------------------------------

function lengthPx(value: Length, parent: number): number {
  if (typeof value === 'number') return value
  if (value === 'auto') return -1   // sentinel: let content size itself
  if (value === 'fill') return parent
  // "<n>%"
  const n = Number.parseFloat(value)
  return (n / 100) * parent
}

// -- Effective element for current aspect ---------------------------------

function effective(el: LayoutElement): LayoutElement {
  const ov = el.overrides?.[currentAspect.value]
  if (!ov) return el
  return {
    ...el,
    ...ov,
    style: { ...(el as any).style, ...((ov as any).style ?? {}) },
  } as LayoutElement
}

// -- Element CSS positioning ----------------------------------------------

function elementPositionStyle(el: LayoutElement): Record<string, string> {
  const e = effective(el)
  const a = aspect.value
  const wPx = lengthPx(e.size.w, a.w)
  const hPx = lengthPx(e.size.h, a.h)
  const xPx = lengthPx(e.offset.x, a.w)
  const yPx = lengthPx(e.offset.y, a.h)

  const style: Record<string, string> = { position: 'absolute' }
  if (e.anchor.startsWith('top'))    style.top    = `${yPx}px`
  if (e.anchor.startsWith('bottom')) style.bottom = `${yPx}px`
  if (e.anchor.startsWith('middle')) style.top    = `${yPx}px`
  if (e.anchor.endsWith('left'))     style.left   = `${xPx}px`
  if (e.anchor.endsWith('right'))    style.right  = `${xPx}px`
  if (e.anchor.endsWith('center'))   style.left   = `${xPx}px`
  if (wPx !== -1) style.width = `${wPx}px`
  if (hPx !== -1) style.height = `${hPx}px`
  return style
}

// -- Token resolution for sample preview (mirror server-side) -------------

function resolve(s: unknown): string {
  if (typeof s !== 'string') return String(s ?? '')
  const whole = s.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
  if (whole) {
    const [scope, key] = whole[1].split('.')
    const dict = scope === 'props' ? sampleProps.value : scope === 'brand' ? sampleBrand.value : {}
    return String((dict as any)[key] ?? '')
  }
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const [scope, key] = path.split('.')
    const dict = scope === 'props' ? sampleProps.value : scope === 'brand' ? sampleBrand.value : {}
    return String((dict as any)[key] ?? '')
  })
}

const backgroundStyle = computed(() => {
  const bg = template.value.background
  if (!bg) return { background: '#000' }
  if (bg.image) {
    return { background: `url(${resolve(bg.image)}) center / cover no-repeat` }
  }
  return { background: resolve(bg.fill ?? '#000') }
})

function elementInnerStyle(el: LayoutElement): Record<string, string | number> {
  const e = effective(el)
  if (e.type === 'text') {
    const s = e.style ?? {}
    return {
      color: resolve(s.color ?? '#fff'),
      fontSize: `${s.fontSize ?? 48}px`,
      fontWeight: s.fontWeight ?? 400,
      fontFamily: s.fontFamily ?? 'Inter, system-ui, sans-serif',
      textAlign: s.align ?? 'left',
      lineHeight: s.lineHeight ?? 1.2,
      letterSpacing: s.letterSpacing != null ? `${s.letterSpacing}px` : 'normal',
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      justifyContent: e.anchor.startsWith('top') ? 'flex-start'
        : e.anchor.startsWith('bottom') ? 'flex-end' : 'center',
      overflow: 'hidden',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }
  }
  if (e.type === 'shape') {
    const s = e.style ?? {}
    return {
      width: '100%', height: '100%',
      background: resolve(s.fill ?? '#000'),
      borderRadius: e.shape === 'circle' ? '9999px' : `${s.borderRadius ?? 0}px`,
      border: s.borderWidth ? `${s.borderWidth}px solid ${resolve(s.borderColor ?? '#000')}` : 'none',
    } as Record<string, string | number>
  }
  return { width: '100%', height: '100%' }
}

function imageInnerStyle(el: LayoutElement) {
  if (el.type !== 'image') return {}
  const fit = el.style?.fit ?? 'cover'
  return {
    width: '100%',
    height: '100%',
    objectFit: fit === 'contain' ? 'contain' : fit === 'stretch' ? 'fill' : 'cover',
    borderRadius: `${el.style?.borderRadius ?? 0}px`,
    display: 'block',
  } as Record<string, string>
}

function imageSrc(el: LayoutElement): string {
  if (el.type !== 'image') return ''
  return resolve(el.content)
}

function textContent(el: LayoutElement): string {
  if (el.type !== 'text') return ''
  return resolve(el.content)
}

// -- Drag-to-move ----------------------------------------------------------

let dragState: {
  id: string
  // Original offset values (numbers in template px) at drag start
  startOffsetXPx: number
  startOffsetYPx: number
  // Pointer client coords at start
  startClientX: number
  startClientY: number
  // Whether offset was originally a % so we preserve units on save
  xPct: boolean
  yPct: boolean
  // Anchor sign: dragging right increases left-anchored offsets, decreases right-anchored ones
  xSign: 1 | -1
  ySign: 1 | -1
} | null = null

function onElementPointerDown(e: PointerEvent, el: LayoutElement) {
  e.stopPropagation()
  selectedId.value = el.id
  const eff = effective(el)
  const a = aspect.value
  const xSign: 1 | -1 = eff.anchor.endsWith('right') ? -1 : 1
  const ySign: 1 | -1 = eff.anchor.startsWith('bottom') ? -1 : 1
  dragState = {
    id: el.id,
    startOffsetXPx: lengthPx(eff.offset.x, a.w),
    startOffsetYPx: lengthPx(eff.offset.y, a.h),
    startClientX: e.clientX,
    startClientY: e.clientY,
    xPct: typeof eff.offset.x === 'string' && eff.offset.x.endsWith('%'),
    yPct: typeof eff.offset.y === 'string' && eff.offset.y.endsWith('%'),
    xSign, ySign,
  }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onElementPointerMove(e: PointerEvent) {
  if (!dragState) return
  const s = scale.value || 1
  const dx = (e.clientX - dragState.startClientX) / s
  const dy = (e.clientY - dragState.startClientY) / s
  const a = aspect.value
  const newXPx = dragState.startOffsetXPx + dx * dragState.xSign
  const newYPx = dragState.startOffsetYPx + dy * dragState.ySign
  const newX: Length = dragState.xPct ? (`${((newXPx / a.w) * 100).toFixed(2)}%` as Length) : Math.round(newXPx)
  const newY: Length = dragState.yPct ? (`${((newYPx / a.h) * 100).toFixed(2)}%` as Length) : Math.round(newYPx)
  patchEffective(dragState.id, { offset: { x: newX, y: newY } } as any)
}

function onElementPointerUp(e: PointerEvent) {
  if (!dragState) return
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  dragState = null
}

// -- Resize handles --------------------------------------------------------

type HandleDir = 'se' | 'sw' | 'ne' | 'nw'
let resizeState: {
  id: string
  startWPx: number
  startHPx: number
  startClientX: number
  startClientY: number
  wPct: boolean
  hPct: boolean
  dir: HandleDir
} | null = null

function onHandlePointerDown(e: PointerEvent, el: LayoutElement, dir: HandleDir) {
  e.stopPropagation()
  e.preventDefault()
  selectedId.value = el.id
  const eff = effective(el)
  const a = aspect.value
  resizeState = {
    id: el.id,
    startWPx: Math.max(0, lengthPx(eff.size.w, a.w)),
    startHPx: Math.max(0, lengthPx(eff.size.h, a.h)),
    startClientX: e.clientX,
    startClientY: e.clientY,
    wPct: typeof eff.size.w === 'string' && eff.size.w.endsWith('%'),
    hPct: typeof eff.size.h === 'string' && eff.size.h.endsWith('%'),
    dir,
  }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onHandlePointerMove(e: PointerEvent) {
  if (!resizeState) return
  const s = scale.value || 1
  const dx = (e.clientX - resizeState.startClientX) / s
  const dy = (e.clientY - resizeState.startClientY) / s
  const a = aspect.value
  const xSign = resizeState.dir.endsWith('w') ? -1 : 1
  const ySign = resizeState.dir.startsWith('n') ? -1 : 1
  const newWPx = Math.max(10, resizeState.startWPx + dx * xSign)
  const newHPx = Math.max(10, resizeState.startHPx + dy * ySign)
  const newW: Length = resizeState.wPct ? (`${((newWPx / a.w) * 100).toFixed(2)}%` as Length) : Math.round(newWPx)
  const newH: Length = resizeState.hPct ? (`${((newHPx / a.h) * 100).toFixed(2)}%` as Length) : Math.round(newHPx)
  patchEffective(resizeState.id, { size: { w: newW, h: newH } } as any)
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
  >
    <!-- Scaled wrapper. Inner div is the *real* template coordinate space. -->
    <div
      class="relative shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
      :style="{
        width: aspect.w + 'px',
        height: aspect.h + 'px',
        transform: `scale(${scale})`,
        transformOrigin: 'center',
        ...backgroundStyle,
      }"
      @click="onCanvasClick"
    >
      <!-- Elements -->
      <div
        v-for="el in template.elements"
        :key="el.id"
        :style="elementPositionStyle(el)"
        class="relative group"
        :class="selectedId === el.id ? 'outline outline-2 outline-action outline-offset-0' : 'hover:outline hover:outline-1 hover:outline-white/30'"
        @pointerdown="(e) => onElementPointerDown(e, el)"
      >
        <!-- Visual -->
        <template v-if="el.type === 'text'">
          <div :style="elementInnerStyle(el)">{{ textContent(el) }}</div>
        </template>
        <template v-else-if="el.type === 'image'">
          <div :style="elementInnerStyle(el)">
            <img v-if="imageSrc(el)" :src="imageSrc(el)" :style="imageInnerStyle(el)" draggable="false" />
            <div v-else class="size-full bg-white/[0.04] flex items-center justify-center text-white/30 text-xs">image</div>
          </div>
        </template>
        <template v-else-if="el.type === 'shape'">
          <div :style="elementInnerStyle(el)" />
        </template>

        <!-- Resize handles, shown only when selected -->
        <template v-if="selectedId === el.id">
          <div
            v-for="dir in (['nw', 'ne', 'sw', 'se'] as const)"
            :key="dir"
            class="absolute size-3 bg-white border border-action rounded-sm"
            :style="{
              top:    dir.startsWith('n') ? '-6px' : 'auto',
              bottom: dir.startsWith('s') ? '-6px' : 'auto',
              left:   dir.endsWith('w')   ? '-6px' : 'auto',
              right:  dir.endsWith('e')   ? '-6px' : 'auto',
              cursor: dir === 'nw' || dir === 'se' ? 'nwse-resize' : 'nesw-resize',
            }"
            @pointerdown="(e) => onHandlePointerDown(e, el, dir)"
          />
        </template>
      </div>
    </div>

    <!-- Bottom-right scale readout -->
    <div class="absolute bottom-3 right-3 text-[10px] text-white/40 tabular-nums bg-black/40 px-2 py-1 rounded backdrop-blur-sm">
      {{ aspect.w }} × {{ aspect.h }} · {{ Math.round(scale * 100) }}%
    </div>
  </div>
</template>
