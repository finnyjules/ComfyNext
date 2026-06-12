<script setup lang="ts">
/**
 * Dedicated inpainting editor for an Image artifact node. Focused on one job —
 * paint a region of the node's image, describe the change, and let FLUX Fill
 * replace just that area — so it isn't crammed into the Compositor's toolbox.
 *
 * Source image (in priority order): a wired upstream image → the node's own
 * image (execution output or file widget) → an image loaded inside this modal.
 * The accepted result is uploaded into ComfyUI's input dir and written back to
 * the node (file widget + preview + lock), so it flows downstream like any
 * Image artifact. Generation runs in-modal via /api/inpaint/* (your Replicate
 * token) for instant variations/compare — not at graph-execution time.
 */
import { X, Brush, Eraser, Eye, Wand2, ImagePlus, Loader2 } from 'lucide-vue-next'
import { useBrushMask, type MaskTarget } from '~/composables/useBrushMask'
import { useInpaint, loadImage, imageToDataUrl, capDims } from '~/composables/useInpaint'

const props = defineProps<{
  nodeId: string
  nodes: any[]
  edges: any[]
}>()
const emit = defineEmits<{ close: [] }>()

const node = computed(() => props.nodes.find((n: any) => n.id === props.nodeId))

// ── Locate the node's image port / widget (mirrors ArtifactImageNode) ────────
function inputIdx(name: string): number { return node.value?.data?.inputs?.findIndex((i: any) => i.name === name) ?? -1 }
function widgetIdx(name: string): number { return node.value?.data?.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1 }

function upstreamImageUrl(src: any): string | null {
  if (src?.data?.images?.length) return src.data.images[0]
  const wv = src?.data?.widgetsValues
  const wi = src?.data?.widgetDefs?.findIndex((w: any) => w.name === 'image') ?? -1
  if (wi >= 0 && wv?.[wi]) return `/view?${new URLSearchParams({ filename: String(wv[wi]), type: 'input' })}`
  if (src?.data?.nodeType === 'LoadImage' && wv?.[0]) return `/view?${new URLSearchParams({ filename: String(wv[0]), type: 'input' })}`
  return null
}

// The source the modal edits. A locally-loaded image overrides everything.
const loadedUrl = ref<string | null>(null)
const sourceUrl = computed<string | null>(() => {
  if (loadedUrl.value) return loadedUrl.value
  const n = node.value
  if (!n) return null
  // Wired upstream image?
  const inIdx = inputIdx('images')
  if (inIdx >= 0) {
    const edge = props.edges.find((e: any) => e.target === props.nodeId && e.targetHandle === `input-${inIdx}`)
    if (edge) {
      const src = props.nodes.find((x: any) => x.id === edge.source)
      const u = src ? upstreamImageUrl(src) : null
      if (u) return u
    }
  }
  // The node's own image.
  if (n.data?.images?.length) return n.data.images[0]
  const wi = widgetIdx('image')
  const fn = wi >= 0 ? n.data?.widgetsValues?.[wi] : ''
  if (fn) return `/view?${new URLSearchParams({ filename: String(fn), type: 'input' })}`
  return null
})

// ── Source load + display geometry (image is contain-fit into the stage) ─────
const MAX = 720
const sourceImg = ref<HTMLImageElement | null>(null)
const out = ref<{ w: number; h: number }>({ w: 0, h: 0 }) // native (capped) px sent to the model
const disp = reactive({ w: MAX, h: MAX })                   // on-screen display size
const loadingSrc = ref(false)

// NOTE: not `immediate` — it references engines/state declared below, so the
// initial load is kicked off from onMounted (after setup finishes) to avoid a
// temporal-dead-zone crash.
async function applySource(url: string | null) {
  brush.clear(); clearSamMask(); history.value = []; previewResult.value = null
  if (!url) { sourceImg.value = null; return }
  loadingSrc.value = true
  try {
    const img = await loadImage(url)
    sourceImg.value = img
    const nw = img.naturalWidth || MAX, nh = img.naturalHeight || MAX
    out.value = capDims(nw, nh)
    const a = nw / nh
    if (a >= 1) { disp.w = MAX; disp.h = Math.round(MAX / a) }
    else { disp.h = MAX; disp.w = Math.round(MAX * a) }
  } catch {
    sourceImg.value = null
  } finally { loadingSrc.value = false }
}
watch(sourceUrl, applySource)

// ── Brush + inpaint engines ──────────────────────────────────────────────────
const brush = useBrushMask()
const inpaint = useInpaint()
brush.setActive(true)

const prompt = ref('')
const tier = ref<'dev' | 'pro'>('dev')
const count = ref(1)
const feather = ref(3)
const expand = ref(0)
const mode = ref<'mask' | 'describe'>('mask')
interface HistoryItem { id: string; url: string; prompt: string; mode: 'mask' | 'describe' }
const history = ref<HistoryItem[]>([])
const inpaintError = ref('')
const comparing = ref(false)

const samSelect = ref(false)
const samMask = ref<string | null>(null)
const samMaskImgEl = ref<HTMLImageElement | null>(null)
watch(samMask, async (url) => {
  if (!url) { samMaskImgEl.value = null; renderOverlay(); return }
  try { samMaskImgEl.value = await loadImage(url) } catch { samMaskImgEl.value = null }
  renderOverlay()
})
function clearSamMask() { samMask.value = null }
function clearMask() { brush.clear(); clearSamMask() }
watch(mode, (m) => { if (m === 'describe') { clearMask(); samSelect.value = false } })

// ── Stage pointer handling (the image fills the stage; coords normalize 0..1) ─
const stageRef = ref<HTMLDivElement | null>(null)
function clientToNorm(e: PointerEvent) {
  const r = stageRef.value?.getBoundingClientRect(); if (!r) return null
  return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height }
}
function onPointerDown(e: PointerEvent) {
  const p = clientToNorm(e); if (!p) return
  e.preventDefault()
  if (samSelect.value) { doSamSelect(p.nx, p.ny); return }
  clearSamMask()
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  brush.down(p.nx, p.ny, disp.w)
}
function onPointerMove(e: PointerEvent) { const p = clientToNorm(e); if (p) brush.move(p.nx, p.ny) }
function onPointerUp() { brush.up() }

// ── Overlay render (mask wash + SAM wash + result preview) ───────────────────
const overlay = ref<HTMLCanvasElement | null>(null)
function renderOverlay() {
  const cv = overlay.value; if (!cv) return
  const W = disp.w, H = disp.h
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr))
  const ctx = cv.getContext('2d'); if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  // Candidate result preview (hidden while holding compare).
  if (previewImgEl.value && !comparing.value) ctx.drawImage(previewImgEl.value, 0, 0, W, H)
  if (history.value.length) return // once results exist, show the previewed result, not the masks
  // SAM selection wash.
  if (samMaskImgEl.value) {
    const mw = samMaskImgEl.value.naturalWidth || 1, mh = samMaskImgEl.value.naturalHeight || 1
    const tmp = document.createElement('canvas'); tmp.width = mw; tmp.height = mh
    const tx = tmp.getContext('2d')!
    tx.drawImage(samMaskImgEl.value, 0, 0)
    tx.globalCompositeOperation = 'source-in'; tx.fillStyle = 'rgba(56,189,248,0.45)'; tx.fillRect(0, 0, mw, mh)
    ctx.drawImage(tmp, 0, 0, W, H)
  }
  // Brush wash.
  brush.render(ctx, W, H)
}
watch(() => [disp.w, disp.h, JSON.stringify(brush.strokes.value), comparing.value, history.value.length] as const,
  () => renderOverlay())

// ── Candidate-result preview ─────────────────────────────────────────────────
const previewResult = ref<string | null>(null)
const previewImgEl = ref<HTMLImageElement | null>(null)
watch(previewResult, async (url) => {
  if (!url) { previewImgEl.value = null; renderOverlay(); return }
  try { previewImgEl.value = await loadImage(url) } catch { previewImgEl.value = null }
  renderOverlay()
})

// ── Generate / accept ────────────────────────────────────────────────────────
const hasRegion = computed(() => brush.hasMask.value || !!samMask.value)

async function runInpaint(removeMode = false) {
  inpaintError.value = ''
  if (!sourceImg.value) { inpaintError.value = 'Load an image first.'; return }
  if (mode.value === 'mask' && !hasRegion.value) {
    inpaintError.value = removeMode ? 'Mark the area to remove first.' : 'Paint or click-select a region first.'
    return
  }
  const p = removeMode ? '' : prompt.value.trim()
  try {
    const source = imageToDataUrl(sourceImg.value, out.value.w, out.value.h)
    let images: string[]
    if (mode.value === 'describe') {
      images = await inpaint.kontext(source, p, { count: count.value })
    } else {
      let maskUrl = samMask.value
      if (!maskUrl) {
        const target: MaskTarget = {
          artW: disp.w, artH: disp.h, cxPx: disp.w / 2, cyPx: disp.h / 2,
          dwPx: disp.w, dhPx: disp.h, rotationDeg: 0, outW: out.value.w, outH: out.value.h,
        }
        const cv = brush.bakeMask(target, { featherPx: feather.value, expandPx: expand.value })
        maskUrl = cv ? cv.toDataURL('image/png') : null
      }
      if (!maskUrl) { inpaintError.value = 'Paint or click-select a region first.'; return }
      images = await inpaint.fluxFill(source, maskUrl, p, { tier: tier.value, count: count.value })
    }
    const stamp = Date.now()
    const items: HistoryItem[] = images.map((url, i) => ({ id: `${stamp}_${i}`, url, prompt: p, mode: mode.value }))
    previewResult.value = null // drop any stale hover-preview from the prior batch
    history.value = [...items, ...history.value]
  } catch (err: any) {
    inpaintError.value = err?.data?.message || err?.message || 'Inpaint failed'
  }
}

async function acceptInpaint(dataUrl: string) {
  const n = node.value; if (!n) return
  try {
    const filename = await inpaint.uploadDataUrl(dataUrl, `inpaint_${props.nodeId}`)
    // Write the result back onto the node like a locked Image artifact.
    const wi = widgetIdx('image')
    if (wi >= 0 && n.data.widgetsValues) n.data.widgetsValues[wi] = filename
    const def = n.data.widgetDefs?.find((d: any) => d.name === 'image')
    if (def && Array.isArray(def.options) && !def.options.includes(filename)) def.options.push(filename)
    n.data.images = [`/view?${new URLSearchParams({ filename, type: 'input' })}`]
    if (!n.data.properties) n.data.properties = {}
    n.data.properties.locked = true
    emit('close')
  } catch (err: any) {
    inpaintError.value = err?.data?.message || err?.message || 'Could not save result'
  }
}

// ── SAM click-to-select (beta; falls back to brushing on any error) ──────────
async function doSamSelect(nx: number, ny: number) {
  if (!sourceImg.value) { inpaintError.value = 'Load an image first.'; return }
  inpaintError.value = ''
  try {
    const source = imageToDataUrl(sourceImg.value, out.value.w, out.value.h)
    const point = { x: Math.round(nx * out.value.w), y: Math.round(ny * out.value.h) }
    const mask = await inpaint.segment(source, point)
    const m = await loadImage(mask)
    samMask.value = imageToDataUrl(m, out.value.w, out.value.h)
    brush.clear()
  } catch {
    inpaintError.value = 'Click-select unavailable (check SAM model); paint the area instead.'
    samSelect.value = false
  }
}

// ── Load an image inside the modal (empty state) ─────────────────────────────
const fileInputRef = ref<HTMLInputElement | null>(null)
function triggerLoad() { fileInputRef.value?.click() }
async function onLoadFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]; input.value = ''
  if (!file) return
  const fr = new FileReader()
  fr.onload = () => { loadedUrl.value = String(fr.result) }
  fr.readAsDataURL(file)
}

// ── Keyboard: Esc close, [ ] brush size, X paint/erase ───────────────────────
function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  if (e.key === 'Escape') { e.stopPropagation(); emit('close'); return }
  if (typing) return
  if (e.key === '[' || e.key === ']') { e.preventDefault(); brush.sizePx.value = Math.max(4, Math.min(400, brush.sizePx.value + (e.key === ']' ? 8 : -8))) }
  else if (e.key === 'x' || e.key === 'X') { e.preventDefault(); brush.mode.value = brush.mode.value === 'add' ? 'erase' : 'add' }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  applySource(sourceUrl.value) // initial load (watches above are non-immediate)
  renderOverlay()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" @click.self="emit('close')">
    <div class="w-full h-full max-w-[1200px] max-h-[860px] bg-[#0a0a0a] rounded-xl border border-white/10 shadow-2xl flex text-white/85 overflow-hidden">
      <!-- Stage -->
      <div class="flex-1 relative flex items-center justify-center overflow-hidden bg-[#0d0d0d]">
        <button class="absolute top-4 right-4 z-10 flex items-center justify-center size-8 rounded-md bg-white/5 hover:bg-white/10 cursor-pointer" title="Close (Esc)" @click="emit('close')">
          <X class="size-4" />
        </button>

        <!-- Empty: load an image -->
        <button v-if="!sourceUrl" class="flex flex-col items-center justify-center gap-2 text-white/45 hover:text-white/80" @click="triggerLoad">
          <ImagePlus class="size-9" :stroke-width="1.5" />
          <span class="text-sm">Load an image to inpaint</span>
        </button>

        <!-- Image + mask stage -->
        <div
          v-else
          ref="stageRef"
          class="relative rounded-md overflow-hidden ring-1 ring-white/10"
          :class="samSelect ? 'cursor-crosshair' : 'cursor-none'"
          :style="{ width: disp.w + 'px', height: disp.h + 'px' }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
        >
          <img v-if="sourceImg" :src="sourceImg.src" class="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" draggable="false" />
          <canvas ref="overlay" class="absolute inset-0 pointer-events-none" :style="{ width: disp.w + 'px', height: disp.h + 'px' }" />
          <!-- brush cursor ring -->
          <div
            v-if="!samSelect && brush.cursor.value"
            class="absolute pointer-events-none rounded-full border-2"
            :class="brush.mode.value === 'erase' ? 'border-rose-400/90' : 'border-cyan-300/90'"
            :style="{ left: brush.cursor.value.x * disp.w + 'px', top: brush.cursor.value.y * disp.h + 'px', width: brush.sizePx.value + 'px', height: brush.sizePx.value + 'px', transform: 'translate(-50%, -50%)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55)' }"
          />
          <div v-if="loadingSrc" class="absolute inset-0 flex items-center justify-center bg-black/30"><Loader2 class="size-6 animate-spin text-white/60" /></div>
        </div>
        <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onLoadFile" />
      </div>

      <!-- Controls -->
      <div class="w-80 border-l border-white/10 shrink-0 flex flex-col">
        <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Brush class="size-4 text-emerald-400" />
          <span class="text-sm font-semibold tracking-tight">Inpaint</span>
        </div>

        <div class="p-4 flex flex-col gap-3 overflow-y-auto">
          <!-- Mode -->
          <div class="flex gap-1 bg-white/[0.04] rounded-md p-0.5">
            <button class="flex-1 h-7 rounded text-[11px] cursor-pointer" :class="mode === 'mask' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'" @click="mode = 'mask'">Paint mask</button>
            <button class="flex-1 h-7 rounded text-[11px] cursor-pointer" :class="mode === 'describe' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'" @click="mode = 'describe'">Describe (no mask)</button>
          </div>

          <!-- Brush controls -->
          <template v-if="mode === 'mask'">
            <div class="flex items-center gap-1.5">
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="brush.mode.value === 'add' ? 'bg-cyan-400/90 text-black' : 'bg-white/[0.06] text-white/70'" title="Paint (X)" @click="brush.mode.value = 'add'"><Brush class="size-3.5" /> Paint</button>
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="brush.mode.value === 'erase' ? 'bg-rose-400/90 text-black' : 'bg-white/[0.06] text-white/70'" title="Erase (X)" @click="brush.mode.value = 'erase'"><Eraser class="size-3.5" /> Erase</button>
              <button class="ml-auto h-7 px-2 rounded-md bg-white/[0.06] text-white/70 text-[11px] cursor-pointer" title="Clear mask" @click="clearMask()">Clear</button>
            </div>
            <label class="flex items-center gap-2 text-[11px] text-white/50">Size
              <input type="range" min="4" max="200" :value="brush.sizePx.value" class="flex-1 accent-cyan-400 cursor-pointer" title="Brush size ([ / ])" @input="brush.sizePx.value = +($event.target as HTMLInputElement).value" />
            </label>
            <div class="flex items-center gap-2">
              <button class="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] cursor-pointer" :class="samSelect ? 'bg-emerald-400/90 text-black' : 'bg-white/[0.06] text-white/70'" title="Click an object to auto-select it (SAM)" @click="samSelect = !samSelect"><Wand2 class="size-3.5" /> Click-select</button>
              <span class="text-[10px] text-white/30">{{ samSelect ? 'Click an object' : 'beta · falls back to brushing' }}</span>
            </div>
          </template>

          <!-- Prompt -->
          <textarea
            v-model="prompt" rows="3"
            :placeholder="mode === 'describe' ? 'describe the edit, e.g. make the sky a sunset' : 'what goes in the painted area, e.g. a red brick wall with ivy'"
            class="w-full bg-white/[0.06] rounded-md text-[12px] px-2 py-1.5 outline-none resize-none placeholder:text-white/25"
            @keydown.enter.exact.prevent="runInpaint(false)"
          />

          <!-- Options -->
          <div class="grid grid-cols-2 gap-2">
            <label class="flex items-center gap-1.5 text-[11px] text-white/50">Model
              <select v-model="tier" class="flex-1 h-7 bg-white/[0.06] rounded text-[11px] px-1 outline-none cursor-pointer">
                <option value="dev">Dev · cheap</option>
                <option value="pro">Pro · best</option>
              </select>
            </label>
            <label class="flex items-center gap-1.5 text-[11px] text-white/50">Variations
              <select v-model.number="count" class="flex-1 h-7 bg-white/[0.06] rounded text-[11px] px-1 outline-none cursor-pointer">
                <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
              </select>
            </label>
          </div>
          <div v-if="mode === 'mask'" class="grid grid-cols-2 gap-2">
            <label class="flex items-center gap-1.5 text-[11px] text-white/50">Feather
              <input type="range" min="0" max="40" v-model.number="feather" class="flex-1 accent-cyan-400 cursor-pointer" />
            </label>
            <label class="flex items-center gap-1.5 text-[11px] text-white/50">Expand
              <input type="range" min="0" max="40" v-model.number="expand" class="flex-1 accent-cyan-400 cursor-pointer" />
            </label>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1.5">
            <button class="flex-1 h-9 rounded-md bg-emerald-500/90 hover:bg-emerald-500 text-black text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default" :disabled="inpaint.busy.value || !sourceImg" @click="runInpaint(false)">
              {{ inpaint.busy.value ? 'Generating…' : (history.length ? 'Regenerate' : 'Generate') }}
            </button>
            <button v-if="mode === 'mask'" class="h-9 px-3 rounded-md bg-white/10 hover:bg-white/15 text-[12px] cursor-pointer disabled:opacity-40" :disabled="inpaint.busy.value || !sourceImg" title="Remove what's under the mask" @click="runInpaint(true)">Remove</button>
          </div>

          <!-- History -->
          <div v-if="history.length" class="pt-2 border-t border-white/10">
            <div class="flex items-center justify-between mb-2 text-[11px] uppercase tracking-wide text-white/40">
              <span>History</span>
              <button class="flex items-center gap-1 normal-case tracking-normal text-white/50 hover:text-white cursor-pointer select-none" title="Hold to see the original"
                @pointerdown.stop="comparing = true" @pointerup="comparing = false" @pointerleave="comparing = false"><Eye class="size-3.5" /> Compare</button>
            </div>
            <div class="grid grid-cols-4 gap-2">
              <button v-for="item in history" :key="item.id"
                class="relative group rounded-md overflow-hidden border cursor-pointer"
                :class="previewResult === item.url ? 'border-emerald-400/90 ring-1 ring-emerald-400/60' : 'border-white/10 hover:border-emerald-400/80'"
                :title="item.prompt || (item.mode === 'describe' ? 'described edit' : 'inpaint')"
                @mouseenter="previewResult = item.url" @mouseleave="previewResult = null" @click="acceptInpaint(item.url)">
                <img :src="item.url" class="w-full aspect-square object-cover" draggable="false" />
                <span class="absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] bg-black/60 opacity-0 group-hover:opacity-100">Use</span>
              </button>
            </div>
            <p class="mt-1.5 text-[10px] text-white/30">Newest first · hover to preview · click to apply.</p>
          </div>

          <div v-if="inpaintError" class="text-[11px] text-rose-400">{{ inpaintError }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
