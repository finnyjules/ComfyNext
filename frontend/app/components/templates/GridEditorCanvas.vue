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
import { isLayoutStack, isV3 } from '~~/shared/template-grid/types'
import type { Region } from '~~/shared/template-grid/types'
import CanvasContextMenu, { type MenuItem } from '~/components/vue-canvas/CanvasContextMenu.vue'
import { columnLabelForElement, isBoundToken, nextFreeSocket, tokenizeElementContent } from '~/lib/collection/layoutPromote'
import type { SmartLayoutBindingContext } from '~/lib/collection/layoutBinding'
import { useLocalSettings } from '~/composables/useLocalSettings'
import { useLayoutTextEdit } from '~/composables/useLayoutTextEdit'

const ctx = inject<GridEditorContext>('gridEditor')!
const binding = inject<SmartLayoutBindingContext | null>('smartLayoutBinding', null)
const {
  template, format, formatClass, currentFormat, currentOutputId, metrics, resolved, selectedId,
  sampleProps, effectiveBrand, setRegion, patchElement,
  isV3Mode, resolvedSections, selectedSectionId, setSectionRegion,
  moveChildIntoStack, moveChildOutOfStack,
  scale, zoomBy, setContainerSize,
} = ctx

// -- Inline (double-click) text editing --------------------------------------
// Shared with the property panel's write-through text field so bound vs
// unbound commits behave identically (see useLayoutTextEdit).
const layoutText = useLayoutTextEdit(ctx, binding)
const editingId = ref<string | null>(null)
const editDraft = ref('')

function startTextEdit(r: ResolvedElement) {
  if (r.el.type !== 'text' || r.el.locked) return
  editingId.value = r.el.id
  // Show the resolved value while editing a bound element, the literal otherwise.
  const socket = layoutText.boundSocket(r.el)
  editDraft.value = socket ? (r.text?.content ?? '') : ((r.el as any).content ?? '')
  nextTick(() => {
    const node = document.querySelector<HTMLTextAreaElement>('[data-inline-text-edit]')
    node?.focus(); node?.select()
  })
}

function commitTextEdit() {
  if (!editingId.value) return
  const r = resolved.value.elements.find((x: any) => x.el.id === editingId.value)
  if (r) layoutText.commitText(r.el, editDraft.value)
  editingId.value = null
}
function cancelTextEdit() { editingId.value = null }

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

// Feed the container size to the composable, which owns the shared zoom scale
// (the zoom toolbar lives in the shell).
function measure() {
  if (!containerRef.value) return
  const r = containerRef.value.getBoundingClientRect()
  setContainerSize(r.width, r.height)
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

// Persisted overlay toggles. Fine grid defaults ON (always-visible placement
// aid per the creator-flow ask); column guides keep today's default (also
// on) — both write-through to localStorage via the shared settings helper so
// the shell's toolbar buttons and this canvas agree on state without prop
// plumbing.
const { getLocalSetting, setLocalSetting } = useLocalSettings()
const FINE_GRID_KEY = 'ComfyNext.SmartLayout.FineGrid'
const COLUMN_GUIDES_KEY = 'ComfyNext.SmartLayout.ColumnGuides'
const fineGridOn = ref(getLocalSetting(FINE_GRID_KEY) !== 'false')
const columnGuidesOn = ref(getLocalSetting(COLUMN_GUIDES_KEY) !== 'false')

function onSettingChanged(e: Event) {
  const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail ?? {}
  if (key === `comfynext:${FINE_GRID_KEY}`) fineGridOn.value = value !== 'false'
  else if (key === `comfynext:${COLUMN_GUIDES_KEY}`) columnGuidesOn.value = value !== 'false'
}
onMounted(() => window.addEventListener('comfynext:setting-changed', onSettingChanged))
onUnmounted(() => window.removeEventListener('comfynext:setting-changed', onSettingChanged))

// Fine placement lattice — two repeating-linear-gradient backgrounds (not an
// SVG line-per-cell, which would mean hundreds of DOM nodes on a dense v3
// baseline grid) sized to the metrics' cell dimensions, offset by the grid
// origin so lines land exactly on cell boundaries. A second, larger-period
// pair draws an emphasis line every 4th cell for rhythm.
const fineGridStyle = computed(() => {
  const m = metrics.value
  const cw = Math.max(1, m.cellW + m.gutter)
  const ch = Math.max(1, m.cellH + m.gutter)
  const hair = 'rgba(255,255,255,0.06)'
  const emph = 'rgba(255,255,255,0.12)'
  return {
    position: 'absolute' as const,
    inset: '0',
    pointerEvents: 'none' as const,
    backgroundImage: [
      `repeating-linear-gradient(to right, ${emph} 0, ${emph} 1px, transparent 1px, transparent ${cw * 4}px)`,
      `repeating-linear-gradient(to bottom, ${emph} 0, ${emph} 1px, transparent 1px, transparent ${ch * 4}px)`,
      `repeating-linear-gradient(to right, ${hair} 0, ${hair} 1px, transparent 1px, transparent ${cw}px)`,
      `repeating-linear-gradient(to bottom, ${hair} 0, ${hair} 1px, transparent 1px, transparent ${ch}px)`,
    ].join(', '),
    backgroundPosition: `${m.originX}px ${m.originY}px`,
    backgroundRepeat: 'repeat',
  }
})

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

// -- Turn into variable: badges + context menu -------------------------------
// "Mega unintuitive and hidden" is the problem this fixes — right-click a
// text/image element to bind it to a Collection column, see it live-badged
// once bound. Shapes get no menu (nothing to bind them to yet).

/** Socket name (e.g. `text_layer_1`) when the element's content is a bound
 *  `{{ props.x }}` token AND that binding actually exists on the node — a
 *  token with no live binding (e.g. hand-typed) shows no chip/menu items. */
function boundSocket(el: ResolvedElement['el']): string | null {
  if (el.type !== 'text' && el.type !== 'image') return null
  const socket = isBoundToken((el as any).content)
  if (!socket || !binding) return null
  return binding.bindings.value[`props.${socket}`] ? socket : null
}

/** Column key shown on the badge — falls back to the socket name if the
 *  wired collection is momentarily unreachable (still indicates "bound"). */
function boundColumnLabel(el: ResolvedElement['el']): string {
  const socket = boundSocket(el)
  if (!socket || !binding) return ''
  return binding.bindings.value[`props.${socket}`]?.columnKey ?? socket
}

const varMenu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)

function goToCollection() {
  if (!binding) return
  const colNode = binding.collectionNode.value
  if (colNode) window.dispatchEvent(new CustomEvent('comfynext:openCollection', { detail: { nodeId: String(colNode.id) } }))
}

/** Unbind: freeze the element's content back to the resolved live value (so
 *  it doesn't silently revert to some stale literal), then delete the
 *  binding. The canvas has no direct node-mutation access (only `ctx`'s
 *  template-scoped ops), so the binding delete goes through the same
 *  `comfynext:unbindControl` fallback event VueNodeCanvas already handles
 *  for surfaces without composable access (Slice 2a). */
function unbindElement(r: ResolvedElement) {
  const socket = boundSocket(r.el)
  if (!socket || !binding) return
  // Resolve straight from the token via `resolve()` (reads sampleProps, which
  // already carries the live collection value per the modal's initialProps
  // merge) rather than `r.text?.content` — that's the FIT result and may be
  // truncated/ellipsized for the current region, which would freeze a
  // clipped string as the literal instead of the true value.
  const resolvedValue = resolve((r.el as any).content)
  patchElement(r.el.id, { content: resolvedValue } as any)
  window.dispatchEvent(new CustomEvent('comfynext:unbindControl', {
    detail: { nodeId: binding.nodeId, path: `props.${socket}` },
  }))
}

function turnIntoVariable(r: ResolvedElement) {
  if (!binding) return
  const el = r.el
  if (el.type !== 'text' && el.type !== 'image') return
  const kind = el.type
  const socketName = nextFreeSocket(template.value, kind)
  const { priorContent } = tokenizeElementContent(el as any, socketName)
  const label = columnLabelForElement(el as any, priorContent, socketName)
  patchElement(el.id, { content: `{{ props.${socketName} }}` } as any)
  window.dispatchEvent(new CustomEvent('comfynext:promoteLayoutElement', {
    detail: {
      nodeId: binding.nodeId,
      socketName,
      columnLabel: label,
      currentValue: priorContent,
      kind,
    },
  }))
}

function onElementContextMenu(e: MouseEvent, r: ResolvedElement) {
  if (previewMode.value || r.el.locked) return
  if (r.el.type !== 'text' && r.el.type !== 'image') return   // shapes: no variable menu
  if (!binding) return
  selectedId.value = r.el.id
  const socket = boundSocket(r.el)
  const items: MenuItem[] = socket
    ? [
        { label: 'Go to collection', action: goToCollection },
        { divider: true },
        { label: 'Unbind', action: () => unbindElement(r) },
      ]
    : [
        { label: 'Turn into variable', action: () => turnIntoVariable(r) },
      ]
  varMenu.value = { x: e.clientX, y: e.clientY, items }
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
  if (editingId.value === r.el.id) return   // let the textarea handle its own clicks
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

/** True when point p lies within rect r (all in canvas/template px). */
function pointInRect(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

function onElementPointerUp(e: PointerEvent) {
  if (panState) {
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    panState = null
    return
  }
  if (!dragState) return
  const finishedDrag = dragState
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  dragState = null

  // Drag-reparent: after a move, hit-test the element's centre against each
  // resolved Stack section and move it in/out as needed.
  if (finishedDrag.moved && isV3Mode.value) {
    const elementId = finishedDrag.id
    const el = resolved.value.elements.find(r => r.el.id === elementId)
    if (el) {
      const centre = { x: el.rect.x + el.rect.w / 2, y: el.rect.y + el.rect.h / 2 }

      // Determine which stack (if any) this element already belongs to.
      const tpl = template.value
      let currentStackId: string | null = null
      if (isV3(tpl)) {
        for (const sec of tpl.sections) {
          if (isLayoutStack(sec) && sec.children.some(c => c.id === elementId)) {
            currentStackId = sec.id
            break
          }
        }
      }

      // Find the target stack under the drop point.
      let targetStackId: string | null = null
      for (const rs of resolvedSections.value) {
        if (rs.section.layout != null && pointInRect(centre, rs.rect)) {
          targetStackId = rs.section.id
          break
        }
      }

      if (targetStackId !== currentStackId) {
        if (currentStackId) moveChildOutOfStack(currentStackId, elementId)
        if (targetStackId) moveChildIntoStack(targetStackId, elementId)
      }
    }
  }
}

// -- Resize handles (snap spans to cells) ------------------------------------

type HandleDir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'
const HANDLE_DIRS = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] as const

// Position a resize handle on the element's edge/corner. Corners pin to two
// sides; edge handles pin to one side and centre on the free axis. Cursor
// reflects the axis: corners diagonal, edges single-axis.
function handleStyle(dir: HandleDir): Record<string, string> {
  const n = dir.includes('n'), s = dir.includes('s'), e = dir.includes('e'), w = dir.includes('w')
  const style: Record<string, string> = {}
  const transforms: string[] = []
  if (n) style.top = '-6px'
  else if (s) style.bottom = '-6px'
  else { style.top = '50%'; transforms.push('translateY(-50%)') }
  if (w) style.left = '-6px'
  else if (e) style.right = '-6px'
  else { style.left = '50%'; transforms.push('translateX(-50%)') }
  if (transforms.length) style.transform = transforms.join(' ')
  const corner = (n || s) && (e || w)
  style.cursor = corner
    ? (dir === 'nw' || dir === 'se' ? 'nwse-resize' : 'nesw-resize')
    : (e || w ? 'ew-resize' : 'ns-resize')
  return style
}

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
  if (e.target === e.currentTarget) { selectedId.value = null; selectedSectionId.value = null }
}

// -- Contextual toolbar (Task 4) ---------------------------------------------
// Floats above the selected element, in the same template-coordinate space as
// `rectStyle` — it lives inside the scaled wrapper so the parent's
// `transform: scale(...)` sizes it visually along with everything else (same
// trick the resize handles use), no manual scale multiplication needed.
const { selectedResolved } = ctx
const showToolbar = computed(() => !!selectedResolved.value && !editingId.value)
const toolbarStyle = computed(() => {
  const rect = selectedResolved.value?.rect
  if (!rect) return { display: 'none' }
  return {
    position: 'absolute',
    left: `${rect.x + rect.w / 2}px`,
    top: `${rect.y - 8}px`,
    transform: 'translate(-50%, -100%)',
    zIndex: '40',
  } as Record<string, string>
})

const selectedBound = computed(() => {
  const el = selectedResolved.value?.el
  const socket = el ? boundSocket(el) : null
  return socket ? (binding?.bindings.value[`props.${socket}`]?.columnKey ?? socket) : null
})

/** Reuses the exact context-menu "Turn into variable" derivation/dispatch
 *  (see `turnIntoVariable` above) for whatever element is currently selected. */
function promoteSelected() {
  if (!selectedResolved.value) return
  turnIntoVariable(selectedResolved.value)
}

// -- v3 section boxes (move/resize the section; children ride it) ------------
type ResolvedSection = (typeof resolvedSections.value)[number]

let sectionDrag: { id: string; startRegion: Region; startClientX: number; startClientY: number } | null = null

function onSectionPointerDown(e: PointerEvent, rs: ResolvedSection) {
  e.stopPropagation()
  if (previewMode.value) return
  selectedSectionId.value = rs.section.id
  selectedId.value = null
  sectionDrag = { id: rs.section.id, startRegion: { ...rs.region }, startClientX: e.clientX, startClientY: e.clientY }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onSectionPointerMove(e: PointerEvent) {
  if (!sectionDrag) return
  const s = scale.value || 1
  const next = dragRegion(
    sectionDrag.startRegion,
    (e.clientX - sectionDrag.startClientX) / s,
    (e.clientY - sectionDrag.startClientY) / s,
    metrics.value,
  )
  setSectionRegion(sectionDrag.id, next)
}

function onSectionPointerUp(e: PointerEvent) {
  if (!sectionDrag) return
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  sectionDrag = null
}

let sectionResize: { id: string; dir: HandleDir; startRegion: Region; startClientX: number; startClientY: number } | null = null

function onSectionHandlePointerDown(e: PointerEvent, rs: ResolvedSection, dir: HandleDir) {
  e.stopPropagation()
  e.preventDefault()
  selectedSectionId.value = rs.section.id
  selectedId.value = null
  sectionResize = { id: rs.section.id, dir, startRegion: { ...rs.region }, startClientX: e.clientX, startClientY: e.clientY }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onSectionHandlePointerMove(e: PointerEvent) {
  if (!sectionResize) return
  const s = scale.value || 1
  const next = resizeRegion(
    sectionResize.startRegion,
    sectionResize.dir,
    (e.clientX - sectionResize.startClientX) / s,
    (e.clientY - sectionResize.startClientY) / s,
    metrics.value,
  )
  setSectionRegion(sectionResize.id, next)
}

function onSectionHandlePointerUp(e: PointerEvent) {
  if (!sectionResize) return
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  sectionResize = null
}
</script>

<template>
  <div
    ref="containerRef"
    class="absolute inset-0 flex items-center justify-center select-none"
    @pointermove="(e) => { onElementPointerMove(e); onHandlePointerMove(e); onSectionPointerMove(e); onSectionHandlePointerMove(e) }"
    @pointerup="(e) => { onElementPointerUp(e); onHandlePointerUp(e); onSectionPointerUp(e); onSectionHandlePointerUp(e) }"
    @wheel="onWheel"
  >
    <!-- Scaled wrapper; inner div is template coordinate space. -->
    <div
      class="relative shrink-0 shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
      :style="{
        width: format.w + 'px',
        height: format.h + 'px',
        transform: `scale(${scale})`,
        transformOrigin: 'center',
        ...backgroundStyle,
      }"
      @click="onCanvasClick"
    >
      <!-- Fine placement lattice (always-on by default) — single element, two
           repeating-gradient backgrounds; cheap even at hundreds of cells. -->
      <div v-if="fineGridOn" :style="fineGridStyle" />

      <!-- Grid overlay (under elements, non-interactive) -->
      <div class="absolute inset-0 pointer-events-none">
        <template v-if="columnGuidesOn">
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
        </template>
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
        @dblclick="(e) => { if (r.el.type === 'image') { e.stopPropagation(); enterReposition(r) } else if (r.el.type === 'text') { e.stopPropagation(); startTextEdit(r) } }"
        @contextmenu.prevent.stop="(e) => onElementContextMenu(e, r)"
      >
        <template v-if="r.el.type === 'text'">
          <div v-if="editingId !== r.el.id" :style="textStyle(r)">{{ r.text?.content ?? '' }}</div>
          <textarea
            v-else
            data-inline-text-edit
            v-model="editDraft"
            class="absolute inset-0 w-full h-full resize-none bg-transparent outline outline-1 outline-[var(--var-accent)] p-0 m-0"
            :style="{ font: 'inherit', color: 'inherit', textAlign: (r.el.style?.align || 'left') }"
            @pointerdown.stop
            @dblclick.stop
            @keydown.enter.prevent="commitTextEdit"
            @keydown.escape.prevent="cancelTextEdit"
            @blur="commitTextEdit"
          />
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

        <!-- Variable-bound badge — bound text/image elements only. -->
        <div
          v-if="boundSocket(r.el)"
          class="absolute top-1 right-1 bg-white/15 rounded-full text-[9px] px-1 text-white/80 pointer-events-none truncate max-w-[80%]"
          :title="`Bound to column · ${boundColumnLabel(r.el)}`"
        >{{ boundColumnLabel(r.el) }}</div>

        <!-- Resize handles — hidden while repositioning so they don't fight the pan drag. -->
        <template v-if="selectedId === r.el.id && !r.el.locked && repositionId !== r.el.id">
          <div
            v-for="dir in HANDLE_DIRS"
            :key="dir"
            class="absolute size-3 bg-white border border-[#96b4ff] rounded-sm"
            :style="handleStyle(dir)"
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

      <!-- Contextual toolbar — floats above the selection; `.group` so the
           VariableGlyph's hover-reveal (opacity-0 group-hover:opacity-60) has
           an ancestor to key off, same as the per-element wrappers above. -->
      <TemplatesGridInlineToolbar
        v-if="showToolbar && selectedResolved"
        class="group"
        :style="toolbarStyle"
        :element="selectedResolved.el"
        :bound="selectedBound"
        @style="(patch) => ctx.patchStyle(selectedResolved!.el.id, patch)"
        @promote="promoteSelected"
        @remove="() => ctx.removeElement(selectedResolved!.el.id)"
      />

      <!-- v3 section frames (drag/resize the box; children ride it) -->
      <template v-if="isV3Mode && !previewMode">
        <div
          v-for="rs in resolvedSections"
          :key="rs.section.id"
          class="absolute"
          :style="{
            left: rs.rect.x + 'px', top: rs.rect.y + 'px',
            width: rs.rect.w + 'px', height: rs.rect.h + 'px',
            cursor: 'move',
            outline: selectedSectionId === rs.section.id ? '2px solid #34D399' : '1px dashed rgba(52,211,153,0.5)',
            outlineOffset: '0px',
            background: selectedSectionId === rs.section.id ? 'rgba(52,211,153,0.06)' : 'transparent',
          }"
          @pointerdown="(e) => onSectionPointerDown(e, rs)"
        >
          <!-- Section label tab -->
          <div
            class="absolute -top-5 left-0 px-1.5 h-5 flex items-center rounded-t text-[10px] font-medium whitespace-nowrap pointer-events-none"
            :style="{
              background: selectedSectionId === rs.section.id ? '#34D399' : 'rgba(52,211,153,0.5)',
              color: '#06281d',
            }"
          >◳ {{ rs.section.name }}</div>

          <!-- Resize handles when selected -->
          <template v-if="selectedSectionId === rs.section.id">
            <div
              v-for="dir in (['nw', 'ne', 'sw', 'se'] as const)"
              :key="dir"
              class="absolute size-3 bg-white border border-[#34D399] rounded-sm"
              :style="{
                top:    dir.startsWith('n') ? '-6px' : 'auto',
                bottom: dir.startsWith('s') ? '-6px' : 'auto',
                left:   dir.endsWith('w')   ? '-6px' : 'auto',
                right:  dir.endsWith('e')   ? '-6px' : 'auto',
                cursor: dir === 'nw' || dir === 'se' ? 'nwse-resize' : 'nesw-resize',
              }"
              @pointerdown="(e) => onSectionHandlePointerDown(e, rs, dir)"
            />
          </template>
        </div>
      </template>

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

    <CanvasContextMenu
      v-if="varMenu"
      :x="varMenu.x"
      :y="varMenu.y"
      :items="varMenu.items"
      @close="varMenu = null"
    />

  </div>
</template>
