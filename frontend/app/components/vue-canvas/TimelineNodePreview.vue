<script setup lang="ts">
/**
 * Animated thumbnail preview for the Timeline node, embedded in the node body.
 * Runs an independent rAF loop with hidden <video> elements per connected clip,
 * advancing a virtual playhead at real time and looping at total duration.
 *
 * Independent of the modal — both can coexist; each maintains its own
 * <video> pool so neither steps on the other's currentTime/play state.
 */

const props = defineProps<{ nodeId: string }>()

const injectedNodes = inject<any>('vueFlowNodes', null)
const injectedEdges = inject<any>('vueFlowEdges', null)

const FPS = computed<number>(() => {
  const v = Number(getWidget('output_fps') ?? 30)
  return v >= 1 && v <= 120 ? v : 30
})

const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
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

const node = computed(() => injectedNodes?.value?.find((n: any) => n.id === props.nodeId))

function getWidget(name: string): any {
  const defs = node.value?.data?.widgetDefs as any[] | undefined
  const wv = node.value?.data?.widgetsValues as any[] | undefined
  if (!defs || !wv) return undefined
  const i = defs.findIndex((d: any) => d.name === name)
  return i >= 0 ? wv[i] : undefined
}

function resolveSource(slot: number): { url: string; kind: 'video' | 'image' } | null {
  if (!injectedEdges?.value || !injectedNodes?.value) return null
  const edge = injectedEdges.value.find((e: any) =>
    e.target === props.nodeId && e.targetHandle === `input-${slot - 1}`)
  if (!edge) return null
  const src = injectedNodes.value.find((n: any) => n.id === edge.source)
  if (!src) return null
  const type = src.data?.nodeType
  if (type === 'LoadVideoFrames' || type === 'LoadVideo') {
    const fileIdx = src.data.widgetDefs?.findIndex((d: any) => d.name === 'file') ?? 0
    const filename = src.data.widgetsValues?.[fileIdx >= 0 ? fileIdx : 0]
    if (filename) {
      return { url: `/view?${new URLSearchParams({ filename: String(filename), type: 'input' })}`, kind: 'video' }
    }
  }
  if (type === 'LoadImage') {
    const widgetIdx = src.data.widgetDefs?.findIndex((d: any) => d.name === 'image') ?? 0
    const filename = src.data.widgetsValues?.[widgetIdx >= 0 ? widgetIdx : 0]
    if (filename) {
      return { url: `/view?${new URLSearchParams({ filename: String(filename), type: 'input' })}`, kind: 'image' }
    }
  }
  // TextClip / any upstream node already exposing its rendered output → use its
  // first image (which the existing live preview pipeline already populates).
  if (src?.data?.images?.length) {
    return { url: String(src.data.images[0]), kind: 'image' }
  }
  return null
}

interface PreviewLayer {
  slot: number
  start: number
  length: number
  x: number; y: number
  rotation: number; scale: number
  opacity: number; blend: string
  fadeIn: number; fadeOut: number
  srcUrl: string | null
  srcKind: 'video' | 'image' | null
}

const layers = computed<PreviewLayer[]>(() => {
  const n = node.value
  if (!n) return []
  const out: PreviewLayer[] = []
  for (let i = 1; i <= 4; i++) {
    const edge = injectedEdges?.value?.find((e: any) =>
      e.target === props.nodeId && e.targetHandle === `input-${i - 1}`)
    if (!edge) continue
    const src = resolveSource(i)
    out.push({
      slot: i,
      start:    Number(getWidget(`clip${i}_start`)    ?? 0),
      length:   Number(getWidget(`clip${i}_length`)   ?? 30),
      x:        Number(getWidget(`clip${i}_x`)        ?? 0),
      y:        Number(getWidget(`clip${i}_y`)        ?? 0),
      rotation: Number(getWidget(`clip${i}_rotation`) ?? 0),
      scale:    Number(getWidget(`clip${i}_scale`)    ?? 1),
      opacity:  Number(getWidget(`clip${i}_opacity`)  ?? 1),
      blend:    String(getWidget(`clip${i}_blend`)    ?? 'normal'),
      fadeIn:   Number(getWidget(`clip${i}_fade_in`)  ?? 0),
      fadeOut:  Number(getWidget(`clip${i}_fade_out`) ?? 0),
      srcUrl:   src?.url ?? null,
      srcKind:  src?.kind ?? null,
    })
  }
  return out
})

const totalDuration = computed<number>(() => {
  const explicit = Number(getWidget('total_duration') ?? 0)
  if (explicit > 0) return explicit
  return layers.value.reduce((m, L) => Math.max(m, L.start + L.length), 1)
})
const bgColor = computed(() => String(getWidget('bg_color') ?? '#000000'))

// Per-slot media elements, owned by this component.
const videos: Record<number, HTMLVideoElement> = {}
const images: Record<number, HTMLImageElement> = {}

function ensureVideo(slot: number, url: string): HTMLVideoElement {
  let v = videos[slot]
  const targetSrc = new URL(url, window.location.href).href
  if (!v) {
    v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    videos[slot] = v
  }
  if (v.src !== targetSrc) {
    v.src = url
    v.load()
  }
  return v
}

function ensureImage(slot: number, url: string): HTMLImageElement {
  let img = images[slot]
  const targetSrc = new URL(url, window.location.href).href
  if (!img) {
    img = new Image()
    img.crossOrigin = 'anonymous'
    images[slot] = img
  }
  if (img.src !== targetSrc) {
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
  for (const k of Object.keys(videos).map(Number)) {
    if (!liveVideos.has(k)) {
      try { videos[k]!.pause(); videos[k]!.removeAttribute('src'); videos[k]!.load() } catch {}
      delete videos[k]
    }
  }
  for (const k of Object.keys(images).map(Number)) {
    if (!liveImages.has(k)) {
      delete images[k]
    }
  }
}, { immediate: true, deep: true })

// Playhead in seconds, advances at real time, loops at totalDuration / FPS.
const playheadSec = ref(0)
let lastTickAt = performance.now()
let rafId = 0

// Canvas size auto-detected from the first loaded video, clamped for thumbnail.
const canvasRef = ref<HTMLCanvasElement | null>(null)
const cW = ref(240)
const cH = ref(135)

function refreshCanvasSize() {
  for (const L of layers.value) {
    let w = 0, h = 0
    if (L.srcKind === 'video') {
      const v = videos[L.slot]
      if (v) { w = v.videoWidth; h = v.videoHeight }
    } else if (L.srcKind === 'image') {
      const img = images[L.slot]
      if (img && img.complete) { w = img.naturalWidth; h = img.naturalHeight }
    }
    if (w > 0 && h > 0) {
      const max = 320
      const longEdge = Math.max(w, h)
      const scale = longEdge > max ? max / longEdge : 1
      cW.value = Math.max(1, Math.round(w * scale))
      cH.value = Math.max(1, Math.round(h * scale))
      return
    }
  }
}

function drawOnce() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (canvas.width !== cW.value) canvas.width = cW.value
  if (canvas.height !== cH.value) canvas.height = cH.value

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = bgColor.value
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const totalSec = totalDuration.value / FPS.value

  for (const L of layers.value) {
    const startSec = L.start / FPS.value
    const endSec = (L.start + L.length) / FPS.value
    const active = playheadSec.value >= startSec && playheadSec.value < endSec

    // Pick the source element + drive video playback.
    let media: HTMLVideoElement | HTMLImageElement | null = null
    let srcW = 0, srcH = 0
    if (L.srcKind === 'video') {
      const v = videos[L.slot]
      if (!v) continue
      if (!active) { if (!v.paused) v.pause(); continue }
      const dur = v.duration
      if (!isFinite(dur) || dur <= 0) continue
      const localSec = playheadSec.value - startSec
      const target = ((localSec % dur) + dur) % dur
      if (v.paused) {
        try { v.currentTime = target } catch {}
        v.play().catch(() => {})
      } else if (Math.abs(v.currentTime - target) > 0.2) {
        try { v.currentTime = target } catch {}
      }
      media = v
      srcW = v.videoWidth; srcH = v.videoHeight
    } else if (L.srcKind === 'image') {
      const img = images[L.slot]
      if (!img || !img.complete || img.naturalWidth === 0) continue
      if (!active) continue
      media = img
      srcW = img.naturalWidth; srcH = img.naturalHeight
    } else {
      continue
    }
    if (!media || srcW === 0 || srcH === 0) continue

    const localSec = playheadSec.value - startSec
    const localFrame = localSec * FPS.value
    let fade = 1
    if (L.fadeIn > 0 && localFrame < L.fadeIn) fade *= localFrame / L.fadeIn
    if (L.fadeOut > 0 && localFrame > L.length - L.fadeOut) {
      fade *= (L.length - localFrame) / L.fadeOut
    }
    fade = Math.max(0, Math.min(1, fade))

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, L.opacity * fade))
    ctx.globalCompositeOperation = BLEND_MAP[L.blend] ?? 'source-over'

    const cAspect = canvas.width / canvas.height
    const sAspect = srcW / srcH
    let fitW: number, fitH: number
    if (sAspect > cAspect) { fitW = canvas.width; fitH = canvas.width / sAspect }
    else                   { fitH = canvas.height; fitW = canvas.height * sAspect }

    const cx = canvas.width / 2 + L.x * canvas.width
    const cy = canvas.height / 2 + L.y * canvas.height
    ctx.translate(cx, cy)
    ctx.rotate((L.rotation * Math.PI) / 180)
    ctx.scale(L.scale, L.scale)
    try { ctx.drawImage(media as CanvasImageSource, -fitW / 2, -fitH / 2, fitW, fitH) } catch {}
    ctx.restore()
  }

  // Advance global playhead for the next frame.
  const now = performance.now()
  const dt = (now - lastTickAt) / 1000
  lastTickAt = now
  if (totalSec > 0) {
    playheadSec.value = (playheadSec.value + dt) % totalSec
  }
}

function loop() {
  drawOnce()
  rafId = requestAnimationFrame(loop)
}

onMounted(() => {
  lastTickAt = performance.now()
  loop()
  // Refresh canvas size as videos finish loading metadata.
  for (const slot of Object.keys(videos).map(Number)) {
    const v = videos[slot]
    if (v) v.addEventListener('loadedmetadata', () => setTimeout(refreshCanvasSize, 0))
  }
  setTimeout(refreshCanvasSize, 200)
})

// Add loadedmetadata listeners to newly-created videos too.
watch(layers, () => {
  for (const L of layers.value) {
    const v = videos[L.slot]
    if (v && !v.dataset.metaWired) {
      v.dataset.metaWired = '1'
      v.addEventListener('loadedmetadata', () => setTimeout(refreshCanvasSize, 0))
    }
  }
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  for (const slot of Object.keys(videos).map(Number)) {
    const v = videos[slot]
    if (v) { try { v.pause(); v.removeAttribute('src'); v.load() } catch {} }
    delete videos[slot]
  }
})

const hasAnySource = computed(() => layers.value.some(L => L.srcUrl))
</script>

<template>
  <div class="w-full bg-black rounded-lg overflow-hidden ring-1 ring-white/5">
    <canvas
      ref="canvasRef"
      class="w-full block"
      :style="{ aspectRatio: `${cW}/${cH}` }"
    />
    <div v-if="!hasAnySource" class="absolute inset-0 flex items-center justify-center text-[10px] text-white/30 italic pointer-events-none">
      Connect clips
    </div>
  </div>
</template>
