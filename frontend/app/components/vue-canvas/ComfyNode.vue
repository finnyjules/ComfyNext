<script setup lang="ts">
import { ChevronRight, Upload } from 'lucide-vue-next'
import { getTypeColor, getInputTooltip } from '~/composables/useVueNodes'
import { getPartnerIcon } from '~/lib/partnerIcons'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title: string
    category?: string
    priceBadge?: { expr: string; depends_on?: any[] } | null
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    widgetsValues: any[]
    widgetDefs?: any[]
    properties: Record<string, any>
    mode: number
    color?: string
    bgcolor?: string
    size?: [number, number]
    running?: boolean
    error?: boolean
    progress?: number
    images?: string[]
    audios?: string[]
    animated?: boolean
    // Subgraph metadata
    isSubgraph?: boolean
    subgraphName?: string | null
    subgraphId?: string | null
    innerNodeCount?: number
  }
}>()

const isVideo = computed(() => {
  if (props.data.animated) return true
  // LoadVideo / LoadVideoFrames always render as a video player.
  if (props.data.nodeType === 'LoadVideo' || props.data.nodeType === 'LoadVideoFrames') return true
  // Also detect by file extension in the URL — check both execution output
  // and the displayed list so synthetic preview URLs (e.g. /view?...mp4)
  // trigger the <video> branch too.
  const src = props.data.images?.[0] || displayedImages.value[0]
  if (!src) return false
  return /\.(mp4|webm|mov|avi|mkv)/i.test(src)
})

const accentColor = computed(() => {
  const firstOutput = props.data.outputs?.[0]
  if (firstOutput) return getTypeColor(firstOutput.type)
  const firstInput = props.data.inputs?.[0]
  if (firstInput) return getTypeColor(firstInput.type)
  return '#6b7280'
})

// Border glow colors for running animation — reflects input/output type colors
const borderColorLeft = computed(() => {
  const firstInput = props.data.inputs?.[0]
  return firstInput ? getTypeColor(firstInput.type) : '#ffffff'
})
const borderColorRight = computed(() => {
  const firstOutput = props.data.outputs?.[0]
  return firstOutput ? getTypeColor(firstOutput.type) : '#ffffff'
})

const partnerIconUrl = computed(() => getPartnerIcon(props.data.category || ''))

// Extract the minimum USD price from the price badge expression
const priceLabel = computed(() => {
  const badge = props.data.priceBadge
  if (!badge?.expr) return null
  // Extract all decimal numbers from the expression (prices are typically 0.01-10.0 range)
  const numbers = badge.expr.match(/\d+\.\d+/g)
  if (!numbers?.length) return '~$?'
  const prices = numbers.map(Number).filter(n => n > 0 && n < 100)
  if (!prices.length) return '~$?'
  const min = Math.min(...prices)
  // Format: $0.07, $0.12, $1.50
  return min < 0.01 ? '<$0.01' : `~$${min.toFixed(2)}`
})

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)

// Live-preview node types: auto-run on widget change (debounced) so the
// preview image refreshes without the user clicking Run.
const LIVE_PREVIEW_NODES = new Set([
  // Tone
  'AdjustBrightnessContrast', 'AdjustExposure', 'AdjustCurves', 'AdjustLevels',
  'AdjustShadowsHighlights', 'AdjustVignette', 'AdjustGlow',
  // Color
  'AdjustColor', 'AdjustTemperature', 'AdjustVibrance', 'AdjustColorBalance',
  'AdjustBlackWhite', 'AdjustPhotoFilter', 'AdjustGradientMap', 'AdjustChannelMixer',
  'AdjustInvert', 'AdjustPosterize', 'AdjustThreshold',
  // Sharpen & noise
  'Sharpen', 'AddNoise', 'Denoise',
  // Blur
  'Blur',
  // Geometry
  'CropImage', 'ResizeImage', 'RotateImage', 'FlipImage',
  // Distortion
  'Pinch', 'Twirl', 'Wave', 'LensCorrection',
  // Stylize
  'Pixelate', 'FindEdges', 'Emboss', 'HighPass',
  // Composite (multi-image)
  'Blend', 'ApplyMask', 'ThresholdMask', 'ColorRangeMask',
  'MatteGrowShrink', 'MergeAlpha', 'MaskByText', 'MaskExtractor',
  // Shader-style
  'ChromaticAberration', 'Halftone', 'CRT', 'Bokeh',
  'Kuwahara', 'CrossHatch', 'Dither', 'Ascii',
  'PerlinNoise', 'Voronoi', 'GradientGenerator',
  'Kaleidoscope', 'PolarCoords', 'Glitch', 'Fisheye',
  'Duotone', 'SplitToning',
  'GodRays', 'LensFlare', 'LightLeak', 'FilmGrain',
  // Round 3
  'ReactionDiffusion', 'Fractal',
  'TiltShift', 'FrequencySeparation', 'PaletteQuantize',
  'HeightmapRelief', 'Caustics', 'Blinds',
  // Unicorn batch
  'GradientMap', 'Posterize', 'Outline', 'Mirror', 'Hologram',
  'Stipple', 'Sparkle', 'TwoDLight', 'FlowField',
  // Video effects
  'FrameTrail', 'TemporalMotionBlur', 'SlitScan', 'TimeDisplacement',
  'VideoReverse', 'VideoTrim', 'VideoCrossfade', 'AnimatedNoise',
  // Video pro
  'SpeedRamp', 'KenBurns', 'AspectConvert', 'ChromaKey', 'CaptionTrack',
  'LUT', 'ThreeWayCC', 'AudioWaveform', 'Transition', 'Stabilize',
  // Timeline edits client-side via the modal (canvas + <video>); the backend
  // renderer only runs on explicit Render or when downstream consumers need it.
  // Compositor also renders client-side.
  // SmartLayout — render service is local (Nuxt /api/templates/render),
  // typical layouts complete in under a second. Re-renders one image per
  // aspect on each change; shorten `aspects` to "1x1" while editing if you
  // want faster turnaround.
  'SmartLayout',
])

// Per-node conditional widget visibility. Return true to show the widget,
// false to hide it based on another widget's current value.
const WIDGET_VISIBILITY: Record<string, (widgetName: string, values: any[], defs: any[]) => boolean> = {
  Blur: (name, values, defs) => {
    if (name === 'type') return true
    const typeIdx = defs.findIndex(d => d.name === 'type')
    const type = values[typeIdx]
    if (type === 'gaussian') return name === 'radius'
    if (type === 'motion') return name === 'angle' || name === 'length'
    if (type === 'zoom') return name === 'strength'
    return true
  },
  Fractal: (name, values, defs) => {
    const typeIdx = defs.findIndex(d => d.name === 'type')
    const type = values[typeIdx]
    // Hide the Julia-only seed params when in mandelbrot mode.
    if (type === 'mandelbrot' && (name === 'julia_cx' || name === 'julia_cy')) return false
    return true
  },
  // The points widget is a JSON blob managed by clicking on the preview;
  // we hide it so users don't accidentally edit raw JSON.
  MaskExtractor: (name) => name !== 'points',
  // ASCII: hide everything from the node body — all controls live in the
  // "More options" right panel.
  Ascii: () => false,
}

function isWidgetVisible(widget: any): boolean {
  const rule = WIDGET_VISIBILITY[props.data.nodeType]
  if (!rule) return true
  return rule(widget.name, props.data.widgetsValues || [], props.data.widgetDefs || [])
}

// Per-node widget groupings. Widgets in a group render together under a
// collapsible header. Widgets not listed render flat above the groups.
const WIDGET_GROUPS: Record<string, { title: string; widgets: string[] }[]> = {
  AdjustColorBalance: [
    { title: 'Shadows',    widgets: ['shadows_cr',    'shadows_mg',    'shadows_yb'] },
    { title: 'Midtones',   widgets: ['midtones_cr',   'midtones_mg',   'midtones_yb'] },
    { title: 'Highlights', widgets: ['highlights_cr', 'highlights_mg', 'highlights_yb'] },
  ],
  AdjustChannelMixer: [
    { title: 'Red output',   widgets: ['r_from_r', 'r_from_g', 'r_from_b'] },
    { title: 'Green output', widgets: ['g_from_r', 'g_from_g', 'g_from_b'] },
    { title: 'Blue output',  widgets: ['b_from_r', 'b_from_g', 'b_from_b'] },
  ],
  // Compositor: 16 optional layer slots. Per-layer widgets stay grouped/
  // collapsible — everything above layer 1 starts collapsed so the panel
  // doesn't explode when none of them are connected.
  Compositor: Array.from({ length: 16 }, (_, i) => i + 1).map((i) => ({
    title: `Layer ${i}`,
    widgets: [
      `layer${i}_x`, `layer${i}_y`, `layer${i}_rotation`,
      `layer${i}_scale`, `layer${i}_opacity`, `layer${i}_blend`,
    ],
  })),
}

// Initial collapsed state — keep every Compositor layer beyond #1 collapsed
// so a fresh node isn't a wall of accordion groups.
const collapsedGroups = ref(new Set<string>([
  'Midtones', 'Highlights', 'Green output', 'Blue output',
  ...Array.from({ length: 15 }, (_, i) => `Layer ${i + 2}`),
]))

// "Grow as you connect" node types — the canvas shows only the slots in use
// plus one trailing empty slot ready to catch the next connection. The Python
// schema declares a generous static cap (Compositor: 16, SmartLayout: 8);
// this is purely a UI affordance to keep the node tidy.
const DYNAMIC_GROW_NODES = new Set<string>(['Compositor', 'SmartLayout'])

// Vue Flow's edges array, provided by the canvas. Needed here (and not just
// further down where the upstream-image helper uses it) because the dynamic-
// grow + live-preview logic below reads the live connection state straight
// from edges. Declared early to avoid TDZ when reactive watchers fire.
const injectedNodes = inject<any>('vueFlowNodes', null)
const injectedEdges = inject<any>('vueFlowEdges', null)

// Which input port indices to actually render. For most nodes that's
// every index 0..N-1. For dynamic-grow nodes only the connected ones plus
// one trailing empty slot are visible — SmartLayout has *two* such groups
// (image_layer_* and text_layer_*) that grow independently, so we work in
// terms of an index set rather than a count.
const visibleInputIndices = computed<number[]>(() => {
  const inputs = (props.data.inputs ?? []) as { name?: string; link?: number | null }[]
  const all = inputs.map((_, i) => i)
  if (!DYNAMIC_GROW_NODES.has(props.data.nodeType)) return all

  // Build the set of connected input indices for THIS node from live Vue Flow
  // edges. Vue Flow's `onConnect` only appends to `edges` — it never writes
  // back to `inputs[i].link`, so the previous check (which relied on `.link`)
  // never saw new connections. Reading edges directly fixes that.
  const connectedIdxs = new Set<number>()
  const liveEdges = (injectedEdges?.value ?? []) as Array<{ target?: string; targetHandle?: string | null }>
  for (const e of liveEdges) {
    if (e.target !== props.id) continue
    const m = /^input-(\d+)$/.exec(e.targetHandle ?? '')
    if (m) connectedIdxs.add(parseInt(m[1]!, 10))
  }
  // Also count anything the serialized state already records as connected
  // (e.g. when a workflow is freshly loaded — edges exist alongside the
  // .link field, both should imply "connected").
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i]?.link != null) connectedIdxs.add(i)
  }

  // Helper: of the indices in `groupIdxs`, keep "connected so far + 1 empty
  // catcher" — at least 1 slot, capped at the group's full length.
  const visibleInGroup = (groupIdxs: number[]) => {
    if (groupIdxs.length === 0) return []
    let highest = -1
    for (let p = 0; p < groupIdxs.length; p++) {
      if (connectedIdxs.has(groupIdxs[p]!)) highest = p
    }
    const showCount = Math.max(1, Math.min(groupIdxs.length, highest + 2))
    return groupIdxs.slice(0, showCount)
  }

  if (props.data.nodeType === 'SmartLayout') {
    // Two independent grow groups + non-grow inputs (brand) always visible.
    const imageIdxs = all.filter((i) => inputs[i]?.name?.startsWith('image_layer_'))
    const textIdxs  = all.filter((i) => inputs[i]?.name?.startsWith('text_layer_'))
    const nonGrowIdxs = all.filter((i) => {
      const n = inputs[i]?.name ?? ''
      return !n.startsWith('image_layer_') && !n.startsWith('text_layer_')
    })
    return [...nonGrowIdxs, ...visibleInGroup(imageIdxs), ...visibleInGroup(textIdxs)]
      .sort((a, b) => a - b)
  }

  // Compositor: single grow group covering all inputs.
  return visibleInGroup(all)
})

// The grouped widgets to actually render. For Compositor the layer index
// embedded in the title ("Layer 3") is matched against the highest visible
// layer slot so transform controls only show for layers that currently have
// a port. We derive that ceiling from visibleInputIndices to stay in sync.
const visibleWidgetGroups = computed(() => {
  const groups = WIDGET_GROUPS[props.data.nodeType] || []
  if (props.data.nodeType !== 'Compositor') return groups
  const max = visibleInputIndices.value.length
  return groups.filter((g) => {
    const m = /^Layer (\d+)$/.exec(g.title)
    return !m || Number(m[1]) <= max
  })
})
function toggleGroup(title: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(title)) next.delete(title)
  else next.add(title)
  collapsedGroups.value = next
}

const groupedWidgetNames = computed(() => {
  const groups = WIDGET_GROUPS[props.data.nodeType]
  if (!groups) return new Set<string>()
  return new Set(groups.flatMap(g => g.widgets))
})

function widgetIndex(name: string): number {
  return (props.data.widgetDefs || []).findIndex((d: any) => d.name === name)
}

function widgetsInGroup(title: string): any[] {
  const groups = WIDGET_GROUPS[props.data.nodeType]
  if (!groups) return []
  const g = groups.find(gr => gr.title === title)
  if (!g) return []
  const byName = new Map((props.data.widgetDefs || []).map((d: any) => [d.name, d]))
  return g.widgets.map(n => byName.get(n)).filter(Boolean)
}
const isLivePreview = computed(() => LIVE_PREVIEW_NODES.has(props.data.nodeType))

let liveRunTimer: ReturnType<typeof setTimeout> | null = null

// Build a fresh "is input N connected?" snapshot from edges + .link fallback,
// so live-preview connection-change watching sees Vue Flow wires (which only
// update edges, never `inputs[i].link`).
function connectionFingerprint(): string {
  const inputs = (props.data.inputs ?? []) as any[]
  const connected = new Set<number>()
  const liveEdges = (injectedEdges?.value ?? []) as Array<{ target?: string; targetHandle?: string | null }>
  for (const e of liveEdges) {
    if (e.target !== props.id) continue
    const m = /^input-(\d+)$/.exec(e.targetHandle ?? '')
    if (m) connected.add(parseInt(m[1]!, 10))
  }
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i]?.link != null) connected.add(i)
  }
  return inputs.map((_, i) => connected.has(i) ? '1' : '0').join('')
}

function scheduleLiveRun() {
  if (!isLivePreview.value) return
  // Skip if any *required* input port is unconnected — server would error.
  // Optional inputs are fine to leave dangling. Same edge-aware check as
  // connectionFingerprint above.
  const inputs = (props.data.inputs ?? []) as any[]
  const connected = new Set<number>()
  const liveEdges = (injectedEdges?.value ?? []) as Array<{ target?: string; targetHandle?: string | null }>
  for (const e of liveEdges) {
    if (e.target !== props.id) continue
    const m = /^input-(\d+)$/.exec(e.targetHandle ?? '')
    if (m) connected.add(parseInt(m[1]!, 10))
  }
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i]?.link != null) connected.add(i)
  }
  if (inputs.some((inp: any, i: number) => !inp.optional && !connected.has(i))) return

  if (liveRunTimer) clearTimeout(liveRunTimer)
  liveRunTimer = setTimeout(() => {
    window.dispatchEvent(new CustomEvent('comfynext:liveRun'))
  }, 150)
}
// JSON-stringifying the watch source so Vue compares with `===` instead of
// chasing reactive references. Without this, `executed` event updates that
// replace `props.data` (or `.inputs?.map(...)` returning a fresh array each
// run) keep tripping the watch and queue endless live-runs. Same trick the
// Compositor's render watcher uses.
watch(() => JSON.stringify(props.data.widgetsValues ?? []), scheduleLiveRun)
// Fire when input connections change (via live edges or pre-loaded .link).
watch(connectionFingerprint, scheduleLiveRun)

function openCompositorEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openCompositor', { detail: { nodeId: props.id } }))
}

function openAsciiOptions() {
  window.dispatchEvent(new CustomEvent('comfynext:openAsciiOptions', { detail: { nodeId: props.id } }))
}

function openTimelineEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openTimeline', { detail: { nodeId: props.id } }))
}

function openCrossfadeEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openCrossfade', { detail: { nodeId: props.id } }))
}

function openSmartLayoutEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openSmartLayout', { detail: { nodeId: props.id } }))
}

// MaskExtractor: clicking on the preview updates the `points` JSON widget so
// the next live-preview run uses those clicks as SAM prompts.
// - Plain click: reset to a single positive point at the click location.
// - Shift-click: add a positive point.
// - Alt-Shift-click: add a negative point (subtract).
const previewNaturalDims = ref<{ w: number; h: number } | null>(null)
function onPreviewImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    previewNaturalDims.value = { w: img.naturalWidth, h: img.naturalHeight }
  }
}

function _maskExtractorPointsRaw(): { x: number; y: number; label: number }[] {
  if (props.data.nodeType !== 'MaskExtractor') return []
  const defs = props.data.widgetDefs as any[]
  const idx = defs.findIndex((d: any) => d.name === 'points')
  if (idx < 0) return []
  try {
    const arr = JSON.parse(props.data.widgetsValues?.[idx] ?? '[]')
    if (Array.isArray(arr)) return arr
  } catch {}
  return []
}

const maskExtractorPoints = computed(() => _maskExtractorPointsRaw())

function onPreviewClick(e: MouseEvent) {
  if (props.data.nodeType !== 'MaskExtractor') return
  const img = e.currentTarget as HTMLImageElement
  const rect = img.getBoundingClientRect()
  const natW = img.naturalWidth || rect.width
  const natH = img.naturalHeight || rect.height
  const imgAspect = natW / natH
  const boxAspect = rect.width / rect.height
  let drawW: number, drawH: number, offX: number, offY: number
  if (imgAspect > boxAspect) {
    drawW = rect.width
    drawH = rect.width / imgAspect
    offX = 0
    offY = (rect.height - drawH) / 2
  } else {
    drawH = rect.height
    drawW = rect.height * imgAspect
    offY = 0
    offX = (rect.width - drawW) / 2
  }
  const px = e.clientX - rect.left - offX
  const py = e.clientY - rect.top - offY
  if (px < 0 || py < 0 || px > drawW || py > drawH) return
  const nx = Math.max(0, Math.min(1, px / drawW))
  const ny = Math.max(0, Math.min(1, py / drawH))

  const defs = props.data.widgetDefs as any[]
  const idx = defs.findIndex((d: any) => d.name === 'points')
  if (idx < 0) return
  const newPoint = { x: nx, y: ny, label: e.altKey ? 0 : 1 }
  let next: any[]
  if (e.shiftKey) {
    next = [..._maskExtractorPointsRaw(), newPoint]
  } else {
    next = [newPoint]
  }
  props.data.widgetsValues[idx] = JSON.stringify(next)
}

// LoadImage / LoadVideo / LoadAudio upload handling. All go through /upload/image
// (Comfy's endpoint writes whatever file you give it). The widget name that
// holds the filename differs by node.
const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const UPLOAD_WIDGET_NAME: Record<string, string> = {
  LoadImage: 'image',
  LoadVideo: 'file',
  LoadVideoFrames: 'file',
  LoadAudio: 'audio',
}

async function handleUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  const nodeType = props.data.nodeType
  const widgetName = UPLOAD_WIDGET_NAME[nodeType] ?? 'image'
  const widgetIdx = props.data.widgetDefs?.findIndex((d: any) => d.name === widgetName) ?? 0

  uploading.value = true
  try {
    const formData = new FormData()
    formData.append('image', file)
    formData.append('overwrite', 'true')
    const res = await fetch('/upload/image', { method: 'POST', body: formData })
    if (!res.ok) throw new Error(`upload returned ${res.status}`)
    const data = await res.json()
    const name = data?.name ?? file.name
    if (props.data.widgetsValues) {
      props.data.widgetsValues[widgetIdx >= 0 ? widgetIdx : 0] = name
    }
    // Add to combo options if not already present, so the dropdown stays useful.
    const def = props.data.widgetDefs?.find((d: any) => d.name === widgetName)
    if (def && Array.isArray(def.options) && !def.options.includes(name)) {
      def.options.push(name)
    }
  } catch (err) {
    console.error(`[${nodeType}] upload failed:`, err)
  } finally {
    uploading.value = false
    target.value = ''
  }
}

// Optional access to the live VueFlow graph (provided by VueNodeCanvas).
// (injectedNodes / injectedEdges are declared above the dynamic-grow logic.)

function getUpstreamImage(portName: string): string | null {
  if (!injectedNodes?.value || !injectedEdges?.value) return null
  const portIdx = (props.data.inputs as any[])?.findIndex((i: any) => i.name === portName)
  if (portIdx == null || portIdx < 0) return null
  const edge = injectedEdges.value.find((e: any) =>
    e.target === props.id && e.targetHandle === `input-${portIdx}`)
  if (!edge) return null
  const src = injectedNodes.value.find((n: any) => n.id === edge.source)
  if (!src) return null
  if (src.data?.images?.length) return src.data.images[0]
  if (src.data?.nodeType === 'LoadImage' && src.data.widgetsValues?.[0]) {
    return `/view?${new URLSearchParams({ filename: src.data.widgetsValues[0], type: 'input' })}`
  }
  return null
}

// Compute preview images: from execution output or LoadImage widget value
const previewImages = computed(() => {
  // Execution output images (PreviewImage, SaveImage, etc.)
  if (props.data.images?.length) return props.data.images

  // LoadImage: first widget value is the filename, served from /view?type=input
  if (props.data.nodeType === 'LoadImage' && props.data.widgetsValues?.[0]) {
    const filename = props.data.widgetsValues[0]
    return [`/view?${new URLSearchParams({ filename, type: 'input' })}`]
  }

  // LoadVideo / LoadVideoFrames: the 'file' widget holds the filename.
  // `isVideo` keys off the extension to render a <video> element instead of an <img>.
  if (props.data.nodeType === 'LoadVideo' || props.data.nodeType === 'LoadVideoFrames') {
    const fileIdx = props.data.widgetDefs?.findIndex((d: any) => d.name === 'file') ?? 0
    const filename = props.data.widgetsValues?.[fileIdx >= 0 ? fileIdx : 0]
    if (filename) {
      return [`/view?${new URLSearchParams({ filename, type: 'input' })}`]
    }
  }

  // MaskExtractor: show the upstream source image as a fallback so the user
  // can click on it before SAM has produced its first output.
  if (props.data.nodeType === 'MaskExtractor') {
    const upstream = getUpstreamImage('image')
    if (upstream) return [upstream]
  }

  return []
})

// Displayed images lag `previewImages` by one preload — we only swap the
// rendered <img> src once the new image is fully loaded in the browser cache.
// This eliminates the white flicker that live-preview cache-busting would
// otherwise cause on every slider tweak.
const displayedImages = ref<string[]>([])
let preloadBatch = 0

watch(previewImages, (urls) => {
  if (!urls || !urls.length) {
    displayedImages.value = []
    return
  }
  // Tag this batch so a slower-completing earlier batch can't overwrite the
  // commit from a newer batch when the user drags sliders rapidly.
  const myBatch = ++preloadBatch
  let pending = urls.length
  const onDone = () => {
    pending--
    if (pending === 0 && myBatch === preloadBatch) {
      displayedImages.value = urls
    }
  }
  for (const url of urls) {
    const img = new window.Image()
    img.onload = onDone
    img.onerror = onDone  // commit anyway so a broken URL doesn't freeze the preview
    img.src = url
  }
}, { immediate: true })
</script>

<template>
  <div
    class="comfy-node rounded-xl border w-[260px] select-none backdrop-blur-sm"
    :class="{
      'opacity-40': isMuted,
      'opacity-60 border-dashed': isBypassed,
      'ring-2 ring-red-500': data.error,
      'border-indigo-500/30': data.isSubgraph,
      'border-white/10': !data.isSubgraph,
    }"
    :data-running="data.running || undefined"
    :style="{
      background: data.bgcolor
        ? `linear-gradient(180deg, color-mix(in srgb, ${data.bgcolor} 35%, #1a1a1a) 0%, color-mix(in srgb, ${data.bgcolor} 20%, #1a1a1a) 100%)`
        : 'linear-gradient(180deg, #252525 0%, #1e1e1e 100%)',
      '--border-color-left': borderColorLeft,
      '--border-color-right': borderColorRight,
    } as any"
  >
    <!-- Title bar -->
    <div
      class="flex items-center gap-2 px-3 py-2 border-b border-white/5"
      :style="{ background: `linear-gradient(135deg, ${accentColor}15 0%, transparent 60%)` }"
    >
      <!-- Subgraph icon -->
      <svg v-if="data.isSubgraph" class="size-4 shrink-0 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="8" height="8" rx="1" /><rect x="14" y="2" width="8" height="8" rx="1" /><rect x="8" y="14" width="8" height="8" rx="1" />
      </svg>
      <img v-else-if="partnerIconUrl" :src="partnerIconUrl" class="size-4 shrink-0 rounded-sm" />
      <div v-else class="size-2 rounded-full shrink-0" :style="{ backgroundColor: accentColor }" />
      <span class="text-xs font-semibold text-white/90 truncate flex-1">{{ data.subgraphName || data.title }}</span>
      <!-- Subgraph node count badge -->
      <span
        v-if="data.isSubgraph && data.innerNodeCount"
        class="shrink-0 text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/20"
      >{{ data.innerNodeCount }} nodes</span>
      <span
        v-else-if="priceLabel"
        class="shrink-0 text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/20"
      >{{ priceLabel }}</span>
    </div>

    <!-- Ports: inputs left, outputs right, same row.
         For dynamic-grow nodes (Compositor, SmartLayout) we iterate over
         visibleInputIndices so non-contiguous "always show + grow group"
         layouts (SmartLayout) render correctly. -->
    <div class="py-2 flex flex-col gap-0.5 bg-black/15 shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]">
      <div
        v-for="i in Math.max(visibleInputIndices.length, data.outputs.length)"
        :key="i"
        class="flex items-center justify-between"
      >
        <VueCanvasComfyNodePort
          v-if="visibleInputIndices[i - 1] !== undefined"
          :id="`input-${visibleInputIndices[i - 1]}`"
          type="target"
          position="left"
          :data-type="data.inputs[visibleInputIndices[i - 1]].type"
          :label="data.inputs[visibleInputIndices[i - 1]].name"
          :tooltip="getInputTooltip(data.nodeType, data.inputs[visibleInputIndices[i - 1]].name)"
        />
        <span v-else class="flex-1" />
        <VueCanvasComfyNodePort
          v-if="data.outputs[i - 1]"
          :id="`output-${i - 1}`"
          type="source"
          position="right"
          :data-type="data.outputs[i - 1].type"
          :label="data.outputs[i - 1].name"
        />
        <span v-else class="flex-1" />
      </div>
    </div>

    <!-- Widgets (Compositor edits via its dedicated modal, so we hide its inline controls) -->
    <div v-if="data.widgetDefs?.some(w => !w.hidden) && data.nodeType !== 'Compositor' && data.nodeType !== 'Timeline'" class="border-t border-[#2a2a2a] py-1.5 flex flex-col gap-1.5">
      <!-- Ungrouped widgets render first -->
      <template v-for="(widget, i) in data.widgetDefs" :key="widget.name">
        <VueCanvasComfyNodeWidget
          v-if="!widget.hidden && isWidgetVisible(widget) && !groupedWidgetNames.has(widget.name)"
          :widget-def="widget"
          :node-type="data.nodeType"
          :model-value="data.widgetsValues?.[i]"
          @update:model-value="data.widgetsValues[i] = $event"
        />
      </template>
      <!-- Grouped widgets render under collapsible headers. For Compositor we
           hide layer groups whose layer index is beyond the visible-input
           count, so the body stays in sync with the grow-on-connect ports. -->
      <template v-for="group in visibleWidgetGroups" :key="group.title">
        <div class="px-2 nopan nodrag">
          <button
            class="flex items-center gap-1 w-full text-[10px] uppercase tracking-[0.08em] text-white/50 hover:text-white/80 cursor-pointer py-1 transition-colors"
            @click="toggleGroup(group.title)"
          >
            <ChevronRight class="size-3 transition-transform" :class="!collapsedGroups.has(group.title) ? 'rotate-90' : ''" />
            <span>{{ group.title }}</span>
          </button>
        </div>
        <template v-if="!collapsedGroups.has(group.title)">
          <VueCanvasComfyNodeWidget
            v-for="widget in widgetsInGroup(group.title)"
            :key="widget.name"
            :widget-def="widget"
            :node-type="data.nodeType"
            :model-value="data.widgetsValues?.[widgetIndex(widget.name)]"
            @update:model-value="data.widgetsValues[widgetIndex(widget.name)] = $event"
          />
        </template>
      </template>
    </div>

    <!-- Compositor: open the editor modal -->
    <div v-if="data.nodeType === 'Compositor'" class="px-2 pb-2 nopan nodrag">
      <button
        class="flex items-center justify-center gap-1.5 w-full h-7 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/70 hover:text-white/90 text-xs transition-colors cursor-pointer border border-white/10"
        @click="openCompositorEditor"
      >
        Open editor
      </button>
    </div>

    <!-- Ascii: open the glyph-dither options panel -->
    <div v-if="data.nodeType === 'Ascii'" class="px-2 pb-2 nopan nodrag">
      <button
        class="flex items-center justify-center gap-1.5 w-full h-7 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/70 hover:text-white/90 text-xs transition-colors cursor-pointer border border-white/10"
        @click="openAsciiOptions"
      >
        More options
      </button>
    </div>

    <!-- Timeline: open the timeline editor modal -->
    <div v-if="data.nodeType === 'Timeline'" class="px-2 pb-2 nopan nodrag">
      <button
        class="flex items-center justify-center gap-1.5 w-full h-7 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/70 hover:text-white/90 text-xs transition-colors cursor-pointer border border-white/10"
        @click="openTimelineEditor"
      >
        Open timeline
      </button>
    </div>

    <!-- Crossfade: open the visual editor modal -->
    <div v-if="data.nodeType === 'VideoCrossfade'" class="px-2 pb-2 nopan nodrag">
      <button
        class="flex items-center justify-center gap-1.5 w-full h-7 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-white/70 hover:text-white/90 text-xs transition-colors cursor-pointer border border-white/10"
        @click="openCrossfadeEditor"
      >
        Open editor
      </button>
    </div>

    <!-- SmartLayout: open the visual layout editor modal -->
    <div v-if="data.nodeType === 'SmartLayout'" class="px-2 pb-2 nopan nodrag">
      <button
        class="flex items-center justify-center gap-1.5 w-full h-7 rounded-md bg-[#96b4ff]/15 hover:bg-[#96b4ff]/25 text-[#c9d6ff] hover:text-white text-xs transition-colors cursor-pointer border border-[#96b4ff]/20"
        @click="openSmartLayoutEditor"
      >
        Edit layout
      </button>
    </div>

    <!-- LoadImage / LoadVideo / LoadVideoFrames / LoadAudio upload button -->
    <div v-if="['LoadImage', 'LoadVideo', 'LoadVideoFrames', 'LoadAudio'].includes(data.nodeType)" class="px-2 pb-2 nopan nodrag">
      <input
        ref="fileInputRef"
        type="file"
        :accept="data.nodeType === 'LoadImage' ? 'image/*' : data.nodeType === 'LoadAudio' ? 'audio/*' : 'video/*'"
        class="hidden"
        @change="handleUpload"
      />
      <button
        class="flex items-center justify-center gap-1.5 w-full h-7 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-xs text-white/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
        :disabled="uploading"
        @click="fileInputRef?.click()"
      >
        <Upload class="size-3.5" />
        <span>
          {{ uploading
              ? 'Uploading…'
              : data.nodeType === 'LoadImage' ? 'Upload image'
              : data.nodeType === 'LoadAudio' ? 'Upload audio'
              : 'Upload video' }}
        </span>
      </button>
    </div>

    <!-- Timeline: live animated preview (separate from the image-blob path). -->
    <div v-if="data.nodeType === 'Timeline'" class="border-t border-[#2a2a2a] p-2">
      <VueCanvasTimelineNodePreview :node-id="id" />
    </div>

    <!-- Audio previews (PreviewAudio, SaveAudio*, etc.) -->
    <div v-if="data.audios?.length" class="border-t border-[#2a2a2a] p-2 flex flex-col gap-1.5">
      <audio
        v-for="(src, i) in data.audios"
        :key="i"
        :src="src"
        controls
        preload="metadata"
        class="w-full nopan nodrag"
      />
    </div>

    <!-- Text output (PreviewAny "Preview as Text" + any node that returns ui.text) -->
    <div v-if="data.text" class="border-t border-[#2a2a2a] p-2">
      <pre class="text-[10.5px] text-white/80 whitespace-pre-wrap break-words font-mono leading-snug max-h-[200px] overflow-auto nopan nodrag select-text">{{ data.text }}</pre>
    </div>

    <!-- Media previews (images or video) -->
    <div v-else-if="displayedImages.length" class="border-t border-[#2a2a2a] p-2">
      <template v-if="isVideo">
        <video
          v-for="(src, i) in displayedImages"
          :key="i"
          :src="src"
          class="w-full rounded-lg object-contain max-h-[300px]"
          controls
          autoplay
          muted
          playsinline
        />
      </template>
      <template v-else>
        <div v-for="(src, i) in displayedImages" :key="i" class="relative">
          <img
            :src="src"
            class="w-full rounded-lg object-contain max-h-[300px]"
            :class="{ 'cursor-crosshair': data.nodeType === 'MaskExtractor' }"
            loading="lazy"
            @load="onPreviewImgLoad"
            @click="onPreviewClick"
          />
          <!-- SAM click markers: green = positive, red = negative -->
          <svg
            v-if="data.nodeType === 'MaskExtractor' && previewNaturalDims && maskExtractorPoints.length"
            class="absolute inset-0 w-full h-full max-h-[300px] pointer-events-none rounded-lg"
            :viewBox="`0 0 ${previewNaturalDims.w} ${previewNaturalDims.h}`"
            preserveAspectRatio="xMidYMid meet"
          >
            <circle
              v-for="(p, pi) in maskExtractorPoints"
              :key="pi"
              :cx="p.x * previewNaturalDims.w"
              :cy="p.y * previewNaturalDims.h"
              :r="Math.max(previewNaturalDims.w, previewNaturalDims.h) * 0.012"
              :fill="p.label === 1 ? '#22c55e' : '#ef4444'"
              stroke="white"
              stroke-width="3"
              vector-effect="non-scaling-stroke"
            />
          </svg>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.comfy-node {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}

/* Sweeping glow border when running */
.comfy-node[data-running] {
  --border-left: var(--border-color-left, #fff);
  --border-right: var(--border-color-right, #fff);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.4),
    0 1px 4px rgba(0, 0, 0, 0.2);
  border-color: transparent;
}

.comfy-node[data-running]::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  padding: 2px;
  /* Static positional color: input color on left, output color on right */
  background: linear-gradient(to right, var(--border-left), var(--border-right));
  /* Three-layer mask: sweep visibility ∩ border ring */
  -webkit-mask:
    conic-gradient(from var(--sweep-angle), transparent 0%, white 6%, white 18%, transparent 26%),
    linear-gradient(white 0 0) content-box,
    linear-gradient(white 0 0);
  -webkit-mask-composite: source-in, xor;
  mask:
    conic-gradient(from var(--sweep-angle), transparent 0%, white 6%, white 18%, transparent 26%),
    linear-gradient(white 0 0) content-box,
    linear-gradient(white 0 0);
  mask-composite: intersect, exclude;
  animation: border-sweep 2s linear infinite;
  pointer-events: none;
  z-index: -1;
}
</style>
