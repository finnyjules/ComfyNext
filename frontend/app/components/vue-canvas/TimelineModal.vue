<script setup lang="ts">
import { X, Image as ImageIcon, Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight, RotateCw } from 'lucide-vue-next'
import { resolveClipSource, type ClipSource } from '~~/shared/timeline/resolveClipSource'

const props = defineProps<{
  nodeId: string
  nodes: any[]
  edges: any[]
}>()

const emit = defineEmits<{ close: [] }>()

// -- Constants ---------------------------------------------------------------

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft_light',
                     'hard_light', 'difference', 'lighten', 'darken', 'add'] as const

// Canvas blend mapping — every backend mode has a direct canvas equivalent.
const CANVAS_BLEND: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  soft_light: 'soft-light',
  hard_light: 'hard-light',
  difference: 'difference',
  lighten: 'lighten',
  darken: 'darken',
  add: 'lighter',
}

const LAYER_COLORS = [
  { bar: 'bg-white/70',  edge: 'bg-white/50',  ring: 'ring-white/40' },
  { bar: 'bg-white/55',  edge: 'bg-white/40',  ring: 'ring-white/30' },
  { bar: 'bg-white/40',  edge: 'bg-white/30',  ring: 'ring-white/25' },
  { bar: 'bg-white/25',  edge: 'bg-white/20',  ring: 'ring-white/20' },
]

// Output frame rate. Read from the `output_fps` widget if present (Timeline
// nodes added after this widget was introduced). Defaults to 30 otherwise.
const FPS = computed<number>(() => {
  const v = Number(getValue('output_fps') ?? 30)
  return v >= 1 && v <= 120 ? v : 30
})

// -- Node + widget access ----------------------------------------------------

const timeline = computed(() => props.nodes.find((n: any) => n.id === props.nodeId))

function widgetIdx(name: string): number {
  return (timeline.value?.data?.widgetDefs as any[] | undefined)
    ?.findIndex((d: any) => d.name === name) ?? -1
}
function getValue(name: string): any {
  const i = widgetIdx(name)
  if (i < 0) return undefined
  return timeline.value.data.widgetsValues[i]
}
function setValue(name: string, v: any) {
  const i = widgetIdx(name)
  if (i < 0) return
  timeline.value.data.widgetsValues[i] = v
}
function hasWidget(name: string): boolean {
  return widgetIdx(name) >= 0
}
function getDef(name: string): any {
  return (timeline.value?.data?.widgetDefs as any[] | undefined)?.find((d: any) => d.name === name)
}

// -- Layers ------------------------------------------------------------------

interface Layer {
  slot: number
  start: number
  length: number
  x: number
  y: number
  rotation: number
  scale: number
  opacity: number
  blend: string
  fadeIn: number
  fadeOut: number
  srcUrl: string | null
  srcKind: 'video' | 'image' | null
}

// Walk the graph: for each connected clip port, find the upstream node and
// resolve its file/preview. Supports video sources (LoadVideoFrames/LoadVideo),
// image sources (LoadImage), and any node that has published an image preview
// (e.g., TextClip → its rendered output).
function resolveSource(clipSlot: number): ClipSource | null {
  const edge = props.edges.find((e: any) =>
    e.target === props.nodeId && e.targetHandle === `input-${clipSlot - 1}`)
  if (!edge) return null
  const src = props.nodes.find((n: any) => n.id === edge.source)
  // This preview pairs stills/clips — collapse a KineticType to a single
  // mid-sequence frame rather than a playable sequence.
  return resolveClipSource(src, { kinetic: 'mid' })
}

const layers = computed<Layer[]>(() => {
  const t = timeline.value
  if (!t) return []
  const out: Layer[] = []
  for (let i = 1; i <= 4; i++) {
    const edge = props.edges.find((e: any) =>
      e.target === props.nodeId && e.targetHandle === `input-${i - 1}`)
    if (!edge) continue
    out.push({
      slot: i,
      start:    Number(getValue(`clip${i}_start`)    ?? 0),
      length:   Number(getValue(`clip${i}_length`)   ?? 30),
      x:        Number(getValue(`clip${i}_x`)        ?? 0),
      y:        Number(getValue(`clip${i}_y`)        ?? 0),
      rotation: Number(getValue(`clip${i}_rotation`) ?? 0),
      scale:    Number(getValue(`clip${i}_scale`)    ?? 1),
      opacity:  Number(getValue(`clip${i}_opacity`)  ?? 1),
      blend:    String(getValue(`clip${i}_blend`)    ?? 'normal'),
      fadeIn:   Number(getValue(`clip${i}_fade_in`)  ?? 0),
      fadeOut:  Number(getValue(`clip${i}_fade_out`) ?? 0),
      srcUrl:   resolveSource(i)?.url ?? null,
      srcKind:  resolveSource(i)?.kind ?? null,
    })
  }
  return out
})

const selectedSlot = ref<number | null>(null)
watchEffect(() => {
  if (selectedSlot.value == null && layers.value.length > 0) {
    selectedSlot.value = layers.value[0]!.slot
  }
})
const selected = computed(() => layers.value.find(l => l.slot === selectedSlot.value) ?? null)

// -- Global timeline -----------------------------------------------------------

const totalDuration = computed<number>(() => {
  const explicit = Number(getValue('total_duration') ?? 0)
  if (explicit > 0) return explicit
  return layers.value.reduce((m, L) => Math.max(m, L.start + L.length), 1)
})
const totalSec = computed(() => totalDuration.value / FPS.value)

const bgColor = computed(() => String(getValue('bg_color') ?? '#000000'))

// -- Media elements: video + image pools, one per slot --------------------

const videoEls: Record<number, HTMLVideoElement> = {}
const imageEls: Record<number, HTMLImageElement> = {}

function ensureVideo(slot: number, url: string): HTMLVideoElement {
  let v = videoEls[slot]
  if (!v) {
    v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    v.addEventListener('loadedmetadata', () => {
      setTimeout(refreshCanvasSize, 0)
    })
    videoEls[slot] = v
  }
  if (v.src !== new URL(url, window.location.href).href) {
    v.src = url
    v.load()
  }
  return v
}

function ensureImage(slot: number, url: string): HTMLImageElement {
  let img = imageEls[slot]
  if (!img) {
    img = new Image()
    img.crossOrigin = 'anonymous'
    img.addEventListener('load', () => setTimeout(refreshCanvasSize, 0))
    imageEls[slot] = img
  }
  if (img.src !== new URL(url, window.location.href).href) {
    img.src = url
  }
  return img
}

watch(layers, (curr) => {
  const liveVideos = new Set<number>()
  const liveImages = new Set<number>()
  for (const L of curr) {
    if (!L.srcUrl) continue
    if (L.srcKind === 'video') {
      liveVideos.add(L.slot)
      ensureVideo(L.slot, L.srcUrl)
    } else if (L.srcKind === 'image') {
      liveImages.add(L.slot)
      ensureImage(L.slot, L.srcUrl)
    }
  }
  for (const slot of Object.keys(videoEls).map(Number)) {
    if (!liveVideos.has(slot)) {
      const v = videoEls[slot]
      if (v) { v.pause(); v.removeAttribute('src'); v.load() }
      delete videoEls[slot]
    }
  }
  for (const slot of Object.keys(imageEls).map(Number)) {
    if (!liveImages.has(slot)) delete imageEls[slot]
  }
}, { immediate: true, deep: true })

// -- Canvas + render loop ----------------------------------------------------

const canvasRef = ref<HTMLCanvasElement | null>(null)
const canvasContainerRef = ref<HTMLDivElement | null>(null)

// Canvas internal pixel size. Pulled from the first connected video's natural
// dimensions when known; capped to 1280 on the long edge for editing perf.
// CSS-scaled to fit the center pane.
const canvasW = ref(1280)
const canvasH = ref(720)
function refreshCanvasSize() {
  // Find the first loaded source (video or image) for dimensions.
  for (const L of layers.value) {
    let w = 0, h = 0
    if (L.srcKind === 'video') {
      const v = videoEls[L.slot]
      if (v) { w = v.videoWidth; h = v.videoHeight }
    } else if (L.srcKind === 'image') {
      const img = imageEls[L.slot]
      if (img && img.complete) { w = img.naturalWidth; h = img.naturalHeight }
    }
    if (w > 0 && h > 0) {
      const long = Math.max(w, h)
      const scale = long > 1280 ? 1280 / long : 1
      canvasW.value = Math.round(w * scale)
      canvasH.value = Math.round(h * scale)
      return
    }
  }
}

// Playhead state — in SECONDS. Source of truth for the editor.
const playhead = ref(0)
const isPlaying = ref(false)
let playStartedAt = 0
let playStartedAtPlayhead = 0

let rafId: number | null = null

function drawOnce() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) return

  if (canvas.width !== canvasW.value) canvas.width = canvasW.value
  if (canvas.height !== canvasH.value) canvas.height = canvasH.value

  // Advance playhead if playing.
  if (isPlaying.value) {
    const elapsed = (performance.now() - playStartedAt) / 1000
    playhead.value = playStartedAtPlayhead + elapsed
    if (playhead.value >= totalSec.value) {
      // Loop.
      playStartedAt = performance.now()
      playStartedAtPlayhead = 0
      playhead.value = 0
    }
  }

  // Background.
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = bgColor.value
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Layers, in slot order (1 below, 4 on top — matches the strip's top-to-bottom = back-to-front).
  for (const L of layers.value) {
    const startSec = L.start / FPS.value
    const endSec = (L.start + L.length) / FPS.value
    const active = playhead.value >= startSec && playhead.value < endSec

    let media: HTMLVideoElement | HTMLImageElement | null = null
    let sw = 0, sh = 0

    if (L.srcKind === 'video') {
      const v = videoEls[L.slot]
      if (!v) continue
      if (!active) { if (!v.paused) v.pause(); continue }
      const dur = v.duration
      if (!isFinite(dur) || dur <= 0) continue
      const localSec = playhead.value - startSec
      const targetTime = ((localSec % dur) + dur) % dur
      if (isPlaying.value) {
        if (v.paused) {
          try { v.currentTime = targetTime } catch {}
          v.play().catch(() => {})
        } else if (Math.abs(v.currentTime - targetTime) > 0.15) {
          try { v.currentTime = targetTime } catch {}
        }
      } else {
        if (!v.paused) v.pause()
        if (Math.abs(v.currentTime - targetTime) > 0.05) {
          try { v.currentTime = targetTime } catch {}
        }
      }
      media = v
      sw = v.videoWidth; sh = v.videoHeight
    } else if (L.srcKind === 'image') {
      if (!active) continue
      const img = imageEls[L.slot]
      if (!img || !img.complete || img.naturalWidth === 0) continue
      media = img
      sw = img.naturalWidth; sh = img.naturalHeight
    } else {
      continue
    }
    if (!media || sw === 0 || sh === 0) continue

    // Fade alpha (computed in frame units to match widget semantics).
    const localSec = playhead.value - startSec
    const localFrame = localSec * FPS.value
    let fadeAlpha = 1
    if (L.fadeIn > 0 && localFrame < L.fadeIn) fadeAlpha *= localFrame / L.fadeIn
    if (L.fadeOut > 0 && localFrame > L.length - L.fadeOut) {
      fadeAlpha *= (L.length - localFrame) / L.fadeOut
    }
    fadeAlpha = Math.max(0, Math.min(1, fadeAlpha))

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, L.opacity * fadeAlpha))
    ctx.globalCompositeOperation = CANVAS_BLEND[L.blend] ?? 'source-over'

    const cx = canvas.width / 2 + L.x * canvas.width
    const cy = canvas.height / 2 + L.y * canvas.height
    ctx.translate(cx, cy)
    ctx.rotate((L.rotation * Math.PI) / 180)
    ctx.scale(L.scale, L.scale)

    // Object-contain fit within canvas.
    const cAspect = canvas.width / canvas.height
    const sAspect = sw / sh
    let dw: number, dh: number
    if (sAspect > cAspect) {
      dw = canvas.width
      dh = canvas.width / sAspect
    } else {
      dh = canvas.height
      dw = canvas.height * sAspect
    }
    try {
      ctx.drawImage(media as CanvasImageSource, -dw / 2, -dh / 2, dw, dh)
    } catch {
      // Browsers throw on drawImage before first decode; harmless.
    }
    ctx.restore()
  }
}

function loop() {
  drawOnce()
  rafId = requestAnimationFrame(loop)
}

onMounted(() => {
  loop()
})
onUnmounted(() => {
  if (rafId != null) cancelAnimationFrame(rafId)
  // Stop and detach all videos.
  for (const slot of Object.keys(videoEls).map(Number)) {
    const v = videoEls[slot]
    if (v) { v.pause(); v.removeAttribute('src'); v.load() }
    delete videoEls[slot]
  }
})

// When any video reports a loadedmetadata event, refresh canvas size.
watch(layers, () => {
  // Defer until next tick so freshly created videos have time to fetch metadata.
  setTimeout(refreshCanvasSize, 100)
}, { immediate: true })

// -- Transport ---------------------------------------------------------------

function play() {
  if (isPlaying.value) return
  isPlaying.value = true
  playStartedAt = performance.now()
  playStartedAtPlayhead = playhead.value
}
function pause() {
  if (!isPlaying.value) return
  isPlaying.value = false
  // Pause every video so they don't keep playing in the background.
  for (const v of Object.values(videoEls)) v.pause()
}
function toggle() {
  if (isPlaying.value) pause()
  else play()
}
function stepFrames(delta: number) {
  const total = totalSec.value
  if (total <= 0) return
  let next = playhead.value + delta / FPS.value
  if (next < 0) next = total + (next % total)
  if (next >= total) next = next % total
  playhead.value = next
  if (isPlaying.value) {
    // Re-anchor the play timer to the new position.
    playStartedAt = performance.now()
    playStartedAtPlayhead = playhead.value
  }
}
function goToStart() { playhead.value = 0; rebaseIfPlaying() }
function goToEnd()   { playhead.value = Math.max(0, totalSec.value - 1 / FPS.value); rebaseIfPlaying() }
function rebaseIfPlaying() {
  if (isPlaying.value) {
    playStartedAt = performance.now()
    playStartedAtPlayhead = playhead.value
  }
}

// Frame-domain accessor for the strip + counter (computed from seconds).
const playheadFrame = computed(() => Math.floor(playhead.value * FPS.value))

// -- Strip drag mechanics ----------------------------------------------------

const stripRef = ref<HTMLDivElement | null>(null)
const stripWidth = ref(800)
function measureStrip() {
  if (stripRef.value) stripWidth.value = stripRef.value.clientWidth
}

function framesToPx(frames: number): number {
  if (totalDuration.value <= 0) return 0
  return (frames / totalDuration.value) * stripWidth.value
}
function pxToFrames(px: number): number {
  if (stripWidth.value <= 0) return 0
  return (px / stripWidth.value) * totalDuration.value
}

const drag = ref<null | {
  slot: number
  mode: 'move' | 'resize-right' | 'resize-left' | 'playhead'
  startMouseX: number
  startStart: number
  startLength: number
}>(null)

function onBarPointerDown(slot: number, mode: 'move' | 'resize-right' | 'resize-left', e: PointerEvent) {
  e.stopPropagation()
  e.preventDefault()
  const L = layers.value.find(l => l.slot === slot)
  if (!L) return
  selectedSlot.value = slot
  drag.value = {
    slot, mode,
    startMouseX: e.clientX,
    startStart: L.start,
    startLength: L.length,
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onPlayheadPointerDown(e: PointerEvent) {
  e.preventDefault()
  drag.value = { slot: -1, mode: 'playhead', startMouseX: e.clientX, startStart: 0, startLength: 0 }
  const rect = stripRef.value!.getBoundingClientRect()
  const frame = Math.round(pxToFrames(e.clientX - rect.left))
  playhead.value = frame / FPS.value
  rebaseIfPlaying()
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onStripPointerDown(e: PointerEvent) {
  if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('strip-bg')) return
  onPlayheadPointerDown(e)
}
function onPointerMove(e: PointerEvent) {
  if (!drag.value) return
  const dx = e.clientX - drag.value.startMouseX
  const dframes = Math.round(pxToFrames(dx))
  if (drag.value.mode === 'move') {
    setValue(`clip${drag.value.slot}_start`, drag.value.startStart + dframes)
  } else if (drag.value.mode === 'resize-right') {
    setValue(`clip${drag.value.slot}_length`, Math.max(1, drag.value.startLength + dframes))
  } else if (drag.value.mode === 'resize-left') {
    const newLen = Math.max(1, drag.value.startLength - dframes)
    const newStart = drag.value.startStart + (drag.value.startLength - newLen)
    setValue(`clip${drag.value.slot}_start`, newStart)
    setValue(`clip${drag.value.slot}_length`, newLen)
  } else if (drag.value.mode === 'playhead') {
    const rect = stripRef.value!.getBoundingClientRect()
    const frame = Math.round(pxToFrames(e.clientX - rect.left))
    playhead.value = frame / FPS.value
    rebaseIfPlaying()
  }
}
function onPointerUp() {
  drag.value = null
}

// -- Strip tick marks --------------------------------------------------------

const ticks = computed<{ frame: number; major: boolean }[]>(() => {
  const T = totalDuration.value
  if (T <= 0) return []
  const target = 12
  const raw = T / target
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000]
  let step = niceSteps[niceSteps.length - 1]!
  for (const s of niceSteps) if (s >= raw) { step = s; break }
  const out: { frame: number; major: boolean }[] = []
  for (let f = 0; f <= T; f += step) {
    out.push({ frame: f, major: (f % (step * 5)) === 0 })
  }
  return out
})

// -- Explicit Render (FFmpeg direct) -----------------------------------------
// Bypasses the Comfy graph entirely. Walks the connected clips to collect their
// source filenames, packages the edit state as JSON, posts to a custom endpoint
// that uses PyAV (FFmpeg under the hood) to render straight to a file. No
// intermediate frame-tensor batch.

const isRendering = ref(false)
const renderResult = ref<null | { url: string; filename: string; durationSec: number }>(null)
const renderError = ref<string | null>(null)

interface RenderClip {
  kind: 'video' | 'image' | 'text'
  path?: string
  text?: Record<string, any>
  start_frame: number
  length: number
  x: number; y: number
  rotation: number; scale: number
  opacity: number; blend: string
  fade_in: number; fade_out: number
}

function resolveClipForRender(slot: number):
  | { kind: 'video' | 'image'; filename: string }
  | { kind: 'text'; text: Record<string, any> }
  | null {
  const edge = props.edges.find((e: any) =>
    e.target === props.nodeId && e.targetHandle === `input-${slot - 1}`)
  if (!edge) return null
  const src = props.nodes.find((n: any) => n.id === edge.source)
  if (!src) return null
  const type = src.data?.nodeType
  if (type === 'LoadVideoFrames' || type === 'LoadVideo') {
    const idx = src.data.widgetDefs?.findIndex((d: any) => d.name === 'file') ?? 0
    const filename = src.data.widgetsValues?.[idx >= 0 ? idx : 0]
    if (filename) return { kind: 'video', filename: String(filename) }
  }
  if (type === 'LoadImage') {
    const idx = src.data.widgetDefs?.findIndex((d: any) => d.name === 'image') ?? 0
    const filename = src.data.widgetsValues?.[idx >= 0 ? idx : 0]
    if (filename) return { kind: 'image', filename: String(filename) }
  }
  // Universal artifact nodes (Video / Image): export the uploaded input file.
  if (type === 'Video' || type === 'Image') {
    const kind: 'video' | 'image' = type === 'Video' ? 'video' : 'image'
    const widgetName = type === 'Video' ? 'file' : 'image'
    const idx = src.data.widgetDefs?.findIndex((d: any) => d.name === widgetName) ?? -1
    const filename = idx >= 0 ? src.data.widgetsValues?.[idx] : undefined
    if (filename) return { kind, filename: String(filename) }
  }
  if (type === 'TextClip') {
    const defs = src.data.widgetDefs as any[] | undefined
    const wv = src.data.widgetsValues as any[] | undefined
    const wIdx = (name: string) => defs?.findIndex((d: any) => d.name === name) ?? -1
    const wGet = (name: string) => { const i = wIdx(name); return i >= 0 ? wv?.[i] : undefined }
    return {
      kind: 'text',
      text: {
        text:         wGet('text') ?? '',
        width:        Number(wGet('width') ?? 1280),
        height:       Number(wGet('height') ?? 720),
        font_size:    Number(wGet('font_size') ?? 72),
        color:        String(wGet('color') ?? '#ffffff'),
        bg_color:     String(wGet('bg_color') ?? '#000000'),
        align:        String(wGet('align') ?? 'center'),
        v_align:      String(wGet('v_align') ?? 'middle'),
        padding:      Number(wGet('padding') ?? 0.06),
        line_spacing: Number(wGet('line_spacing') ?? 1.2),
      },
    }
  }
  return null
}

async function renderViaFFmpeg() {
  if (isRendering.value) return
  renderError.value = null
  renderResult.value = null

  // Collect clips. Skips only when an upstream node type isn't recognized.
  const renderClips: RenderClip[] = []
  let skipped = 0
  for (const L of layers.value) {
    const resolved = resolveClipForRender(L.slot)
    if (!resolved) { skipped++; continue }
    const common = {
      start_frame: L.start,
      length: L.length,
      x: L.x, y: L.y,
      rotation: L.rotation, scale: L.scale,
      opacity: L.opacity, blend: L.blend,
      fade_in: L.fadeIn, fade_out: L.fadeOut,
    }
    if (resolved.kind === 'text') {
      renderClips.push({ kind: 'text', text: resolved.text, ...common })
    } else {
      renderClips.push({ kind: resolved.kind, path: resolved.filename, ...common })
    }
  }
  if (!renderClips.length) {
    renderError.value = 'No clips to render.'
    return
  }

  // Plumb the user-selected audio file (the widget stores "(none)" when off).
  const audioFile = String(getValue('audio_file') ?? '(none)')
  const payload: Record<string, any> = {
    fps: FPS.value,
    total_frames: totalDuration.value,
    canvas_width: canvasW.value,
    canvas_height: canvasH.value,
    bg_color: bgColor.value,
    output_basename: 'timeline',
    clips: renderClips,
  }
  if (audioFile && audioFile !== '(none)') {
    payload.audio_path = audioFile
  }

  isRendering.value = true
  try {
    const res = await fetch('/sailor/render_timeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const data = await res.json()
    const filename = String(data.filename)
    const url = `/view?${new URLSearchParams({ filename, type: 'output' })}`
    renderResult.value = { url, filename, durationSec: Number(data.duration_sec ?? 0) }
    if (skipped > 0) {
      renderError.value = `${skipped} clip(s) without a source file were skipped.`
    }
  } catch (err: any) {
    renderError.value = err?.message ?? 'render failed'
  } finally {
    isRendering.value = false
  }
}

// -- Keyboard ----------------------------------------------------------------

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { emit('close'); return }
  // Space toggles playback (not when the user is typing into an input).
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
  if (e.key === ' ') {
    e.preventDefault()
    toggle()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('resize', measureStrip)
  measureStrip()
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('resize', measureStrip)
  pause()
})

function colorFor(slot: number) {
  return LAYER_COLORS[(slot - 1) % LAYER_COLORS.length]!
}
</script>

<template>
  <div
    class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
    @click.self="emit('close')"
  >
    <div class="w-full h-full max-w-[1400px] max-h-[900px] bg-[#0a0a0a] rounded-xl border border-white/10 shadow-2xl flex flex-col text-white/85 overflow-hidden">

      <!-- Top: 3-pane area -->
      <div class="flex-1 flex min-h-0">

        <!-- Left sidebar: clip list -->
        <div class="w-64 border-r border-white/10 flex flex-col shrink-0">
          <div class="px-4 py-3 border-b border-white/10">
            <h2 class="text-sm font-semibold tracking-tight">Timeline</h2>
          </div>
          <div class="p-3 flex-1 overflow-y-auto">
            <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-2 px-1">Clips</div>
            <div
              v-for="layer in layers"
              :key="layer.slot"
              class="group flex items-center gap-2 pl-2 pr-2 py-1.5 rounded cursor-pointer transition-colors"
              :class="selectedSlot === layer.slot ? 'bg-white/10' : 'hover:bg-white/[0.04]'"
              @click="selectedSlot = layer.slot"
            >
              <div class="size-2 rounded-sm" :class="colorFor(layer.slot).bar" />
              <ImageIcon class="size-3.5 text-white/60 shrink-0" />
              <span class="text-sm">Clip {{ layer.slot }}</span>
              <span class="ml-auto text-[10px] tabular-nums" :class="layer.srcUrl ? 'text-white/35' : 'text-amber-400/70'">
                {{ layer.srcUrl ? `${layer.length}f` : 'no src' }}
              </span>
            </div>
            <div v-if="!layers.length" class="text-xs text-white/30 px-1 py-2 italic">
              Connect clips to the Timeline's ports.
            </div>
          </div>
        </div>

        <!-- Center: canvas preview -->
        <div ref="canvasContainerRef" class="flex-1 relative flex items-center justify-center overflow-hidden bg-[#080808]">
          <button
            class="absolute top-4 right-4 z-10 flex items-center justify-center size-8 rounded-md bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
            title="Close (Esc)"
            @click="emit('close')"
          >
            <X class="size-4" />
          </button>
          <canvas
            ref="canvasRef"
            class="max-w-full max-h-full object-contain ring-1 ring-white/5 rounded bg-black"
            :style="{ aspectRatio: `${canvasW}/${canvasH}` }"
          />
          <div class="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] text-white/40 tabular-nums">
            Frame {{ playheadFrame }} / {{ totalDuration }}
            <span v-if="isPlaying" class="ml-1 text-white/70">▶</span>
            <span v-else class="ml-1 text-white/25">⏸</span>
          </div>
        </div>

        <!-- Right: properties for the selected clip -->
        <div class="w-72 border-l border-white/10 shrink-0 overflow-y-auto">
          <div class="px-4 py-3 border-b border-white/10">
            <h3 class="text-sm font-semibold tracking-tight">
              {{ selected ? `Clip ${selected.slot}` : 'Properties' }}
            </h3>
          </div>
          <div v-if="selected" class="p-4 space-y-3 text-xs">

            <div class="grid grid-cols-2 gap-2">
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Start</div>
                <input type="number" :value="selected.start"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none"
                  @input="setValue(`clip${selected.slot}_start`, parseInt(($event.target as HTMLInputElement).value) || 0)" />
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Length</div>
                <input type="number" min="1" :value="selected.length"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none"
                  @input="setValue(`clip${selected.slot}_length`, Math.max(1, parseInt(($event.target as HTMLInputElement).value) || 1))" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">X</div>
                <input type="number" step="0.01" :value="selected.x"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none"
                  @input="setValue(`clip${selected.slot}_x`, parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Y</div>
                <input type="number" step="0.01" :value="selected.y"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none"
                  @input="setValue(`clip${selected.slot}_y`, parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Rotation</div>
                <input type="number" step="1" :value="selected.rotation"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none"
                  @input="setValue(`clip${selected.slot}_rotation`, parseFloat(($event.target as HTMLInputElement).value) || 0)" />
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Scale</div>
                <input type="number" step="0.05" :value="selected.scale"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none"
                  @input="setValue(`clip${selected.slot}_scale`, parseFloat(($event.target as HTMLInputElement).value) || 1)" />
              </div>
            </div>

            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Opacity</div>
              <div class="flex items-center gap-2">
                <input type="range" min="0" max="1" step="0.01" :value="selected.opacity"
                  class="flex-1"
                  @input="setValue(`clip${selected.slot}_opacity`, parseFloat(($event.target as HTMLInputElement).value))" />
                <span class="text-xs text-white/60 w-10 text-right tabular-nums">{{ Math.round(selected.opacity * 100) }}%</span>
              </div>
            </div>

            <div>
              <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Blend mode</div>
              <select :value="selected.blend"
                class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none cursor-pointer"
                @change="setValue(`clip${selected.slot}_blend`, ($event.target as HTMLSelectElement).value)">
                <option v-for="m in BLEND_MODES" :key="m" :value="m">{{ m.replace('_', ' ') }}</option>
              </select>
            </div>

            <div class="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Fade in</div>
                <input type="number" min="0" :value="selected.fadeIn"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none"
                  @input="setValue(`clip${selected.slot}_fade_in`, Math.max(0, parseInt(($event.target as HTMLInputElement).value) || 0))" />
              </div>
              <div>
                <div class="text-[10px] uppercase tracking-[0.12em] text-white/40 mb-1">Fade out</div>
                <input type="number" min="0" :value="selected.fadeOut"
                  class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-white/90 outline-none"
                  @input="setValue(`clip${selected.slot}_fade_out`, Math.max(0, parseInt(($event.target as HTMLInputElement).value) || 0))" />
              </div>
            </div>
          </div>
          <div v-else class="p-4 text-xs text-white/40 italic">
            Select a clip to edit its properties.
          </div>
        </div>
      </div>

      <!-- Bottom: timeline strip -->
      <div class="h-48 border-t border-white/10 flex flex-col shrink-0">
        <!-- Strip header: transport + global controls -->
        <div class="flex items-center gap-3 px-4 py-2 border-b border-white/5">
          <div class="flex items-center gap-0.5">
            <button class="flex items-center justify-center size-7 rounded hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white/95" title="Go to start" @click="goToStart">
              <ChevronsLeft class="size-4" />
            </button>
            <button class="flex items-center justify-center size-7 rounded hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white/95" title="Step back" @click="stepFrames(-1)">
              <SkipBack class="size-4" />
            </button>
            <button class="flex items-center justify-center size-8 rounded bg-white/10 hover:bg-white/15 transition-colors cursor-pointer text-white/95" :title="isPlaying ? 'Pause (Space)' : 'Play (Space)'" @click="toggle">
              <Pause v-if="isPlaying" class="size-4" />
              <Play v-else class="size-4 translate-x-px" />
            </button>
            <button class="flex items-center justify-center size-7 rounded hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white/95" title="Step forward" @click="stepFrames(1)">
              <SkipForward class="size-4" />
            </button>
            <button class="flex items-center justify-center size-7 rounded hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white/95" title="Go to end" @click="goToEnd">
              <ChevronsRight class="size-4" />
            </button>
          </div>

          <div class="w-px h-5 bg-white/10 mx-1" />

          <button
            class="flex items-center gap-1.5 px-2.5 h-7 rounded text-xs transition-colors cursor-pointer border border-white/10 disabled:opacity-50 disabled:cursor-wait"
            :class="renderResult ? 'bg-action/20 hover:bg-action/30 text-action' : 'bg-white/15 hover:bg-white/20 text-white/70'"
            :disabled="isRendering"
            title="Render the timeline directly to a video file (FFmpeg/PyAV)"
            @click="renderViaFFmpeg"
          >
            <RotateCw class="size-3" :class="isRendering ? 'animate-spin' : ''" />
            <span>{{ isRendering ? 'Rendering…' : (renderResult ? 'Re-render' : 'Render to file') }}</span>
          </button>
          <a
            v-if="renderResult"
            :href="renderResult.url"
            target="_blank"
            class="text-xs text-action hover:text-action/80 underline underline-offset-2"
            :title="`Open ${renderResult.filename}`"
          >Open {{ renderResult.filename }}</a>
          <span v-if="renderError" class="text-xs text-amber-400 truncate max-w-[300px]">{{ renderError }}</span>

          <div class="flex items-center gap-2 text-xs text-white/70 ml-3">
            <span class="text-white/40" title="In frames">Duration</span>
            <input type="number" min="0" :value="Number(getValue('total_duration') ?? 0)"
              class="w-16 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 outline-none text-white/90 tabular-nums"
              @input="setValue('total_duration', Math.max(0, parseInt(($event.target as HTMLInputElement).value) || 0))" />
            <span class="text-white/30 text-[10px] tabular-nums">
              {{ Number(getValue('total_duration') ?? 0) > 0
                  ? `f · ${(totalDuration / FPS).toFixed(1)}s`
                  : '(auto)' }}
            </span>
          </div>

          <!-- FPS -->
          <div v-if="hasWidget('output_fps')" class="flex items-center gap-2 text-xs text-white/70">
            <span class="text-white/40">FPS</span>
            <input type="number" min="1" max="120" :value="FPS"
              class="w-12 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 outline-none text-white/90 tabular-nums"
              @input="setValue('output_fps', Math.max(1, Math.min(120, parseInt(($event.target as HTMLInputElement).value) || 30)))" />
          </div>

          <!-- Audio -->
          <div v-if="hasWidget('audio_file')" class="flex items-center gap-2 text-xs text-white/70">
            <span class="text-white/40">Audio</span>
            <select :value="String(getValue('audio_file') ?? '(none)')"
              class="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 outline-none text-white/90 max-w-[160px]"
              @change="setValue('audio_file', ($event.target as HTMLSelectElement).value)">
              <option v-for="opt in (getDef('audio_file')?.options ?? ['(none)'])" :key="opt" :value="opt">
                {{ opt === '(none)' ? '(no audio)' : opt }}
              </option>
            </select>
          </div>
          <div class="flex items-center gap-2 text-xs text-white/70 ml-auto">
            <span class="text-white/40" title="In frames">Playhead</span>
            <input type="number" min="0" :max="totalDuration - 1" :value="playheadFrame"
              class="w-16 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 outline-none text-white/90 tabular-nums"
              @input="playhead = (parseInt(($event.target as HTMLInputElement).value) || 0) / FPS.value; rebaseIfPlaying()" />
            <span class="text-white/30 tabular-nums">/ {{ totalDuration }}f · {{ (playheadFrame / FPS.value).toFixed(1) }}s</span>
          </div>
        </div>

        <!-- Strip body -->
        <div
          ref="stripRef"
          class="strip-bg relative flex-1 select-none touch-none cursor-pointer overflow-hidden"
          @pointerdown="onStripPointerDown"
        >
          <!-- Tick marks -->
          <div class="absolute inset-0 pointer-events-none">
            <template v-for="t in ticks" :key="t.frame">
              <div
                class="absolute top-0 bottom-0 border-l"
                :class="t.major ? 'border-white/15' : 'border-white/[0.06]'"
                :style="{ left: framesToPx(t.frame) + 'px' }"
              />
              <div
                v-if="t.major"
                class="absolute top-1 text-[9px] text-white/35 tabular-nums px-1"
                :style="{ left: framesToPx(t.frame) + 'px' }"
              >{{ t.frame }}</div>
            </template>
          </div>

          <!-- Layer bars -->
          <div class="absolute inset-0 pt-5 px-0">
            <div
              v-for="(layer, idx) in layers"
              :key="layer.slot"
              class="absolute h-6 rounded transition-shadow"
              :class="[
                colorFor(layer.slot).bar,
                selectedSlot === layer.slot ? `ring-2 ${colorFor(layer.slot).ring}` : '',
              ]"
              :style="{
                left: framesToPx(layer.start) + 'px',
                width: Math.max(8, framesToPx(layer.length)) + 'px',
                top: (idx * 28 + 4) + 'px',
              }"
              @pointerdown="(e) => onBarPointerDown(layer.slot, 'move', e)"
            >
              <div
                class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize"
                :class="colorFor(layer.slot).edge"
                @pointerdown="(e) => onBarPointerDown(layer.slot, 'resize-left', e)"
              />
              <div class="px-3 h-full flex items-center text-[11px] text-black/85 font-medium select-none pointer-events-none">
                Clip {{ layer.slot }} <span class="ml-1 text-black/55 tabular-nums">· {{ layer.length }}f</span>
              </div>
              <div
                class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize"
                :class="colorFor(layer.slot).edge"
                @pointerdown="(e) => onBarPointerDown(layer.slot, 'resize-right', e)"
              />
            </div>
          </div>

          <!-- Playhead -->
          <div
            class="absolute top-0 bottom-0 w-px bg-yellow-400 pointer-events-none"
            :style="{ left: framesToPx(playheadFrame) + 'px' }"
          >
            <div class="absolute -top-px -left-1 w-2 h-2 bg-yellow-400 rotate-45" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
