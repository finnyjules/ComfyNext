<script setup lang="ts">
import { ChevronLeft, ChevronRight, Dices, Download, Frame, Loader2, Play, Upload } from 'lucide-vue-next'
import { getTypeColor, getInputTooltip } from '~/composables/useVueNodes'
import { getPartnerIcon } from '~/lib/partnerIcons'
import { allowedAspectRatios, allowedDurations, modelSupportsSeed } from '~/lib/videoModelAdapt'
import { TOOLBOX_NODE_ICONS } from '~/data/toolbox-items'
import { getGeneratorIcon } from '~/data/generator-icons'
import TakesStrip from '~/components/vue-canvas/TakesStrip.vue'
import { projectTake, type Take } from '~/composables/useTakes'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title: string
    category?: string
    outputNode?: boolean
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
    errorMessage?: string | null
    // Takes (non-destructive variation loop) — flag-gated, additive.
    takes?: Take[]
    activeTakeId?: string | null
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

// Toolbox icon: surfaces the Lucide icon defined in the Toolbox catalog
// (data/toolbox-items.ts) in the node's title bar when neither a subgraph
// icon nor a partner icon takes precedence. Falls through to nothing when
// the node type isn't a toolbox item.
const toolboxIcon = computed(() => TOOLBOX_NODE_ICONS[props.data.nodeType as string] || null)

// Per-generator-node icon (Generate=Sparkles, Upscale=Maximize, …). Takes
// precedence over the provider's partner logo so the title bar reflects
// what the node does, not just who runs it.
const generatorIcon = computed(() => getGeneratorIcon(props.data.nodeType as string))

// Frontend overrides for node title-bar names. The backend display_name (e.g.
// "Flux Dev + LoRA (Replicate)") describes the model; here we relabel a node in
// terms of what the user is doing with it. Per CLAUDE.md, UI naming lives in Vue.
const NODE_TITLE_OVERRIDES: Record<string, string> = {
  FluxLoRARemoteNode: 'Generate with a style',
}
const displayTitle = computed(
  () => NODE_TITLE_OVERRIDES[props.data.nodeType as string] || props.data.title,
)

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

// Per-node Run button surfaces on:
//   1. Generator nodes (costly API calls — Replicate, BFL, OpenAI, …).
//   2. Output nodes (anything OUTPUT_NODE=True in Python — PreviewImage,
//      SaveImage, etc.). Treats the click as "run to here" since these are
//      already valid sinks, sidestepping ComfyUI's "Prompt has no outputs"
//      rejection.
//   3. Slow local compute that takes seconds to minutes — same iteration
//      value as a generator, just on-device. Curated allowlist below.
//
// Skipped on purpose: live-preview nodes (they auto-run), Load nodes (no
// execution), Note / Subgraph IO (no execution).
const HEAVY_LOCAL_COMPUTE = new Set<string>([
  'FaceSwap', 'FaceRestore', 'LipSync', 'ObjectRemove',
  'SubjectMask', 'MaskExtractor',
])

const showRunButton = computed(() => {
  const t = props.data.nodeType
  if (HEAVY_LOCAL_COMPUTE.has(t)) return true
  // OUTPUT_NODE=True covers real sinks (SaveImage, PreviewImage…) but also
  // every local image-adjust node that ships a UI preview (Blur, Sharpen,
  // AdjustCurves, …) — those already auto-run via the live-preview pipeline,
  // so suppress the button there.
  if (props.data.outputNode && !LIVE_PREVIEW_NODES.has(t)) return true
  return (props.data.category || '').startsWith('api node/')
})

function runThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running) return
  window.dispatchEvent(new CustomEvent('comfynext:runFiltered', { detail: { targetIds: [props.id] } }))
}

// "Re-roll this node": run ONLY this node, leaving everything upstream exactly
// as it was on the last run. We scope seed randomization to this node so all
// upstream inputs stay identical → ComfyUI cache-hits them (no regen, no
// re-billing) and recomputes just this node + its preview. Great for re-rolling
// a generator or iterating on one node's settings without paying for the chain.
function rerollThisNode() {
  if (isMuted.value || isBypassed.value || props.data.running) return
  window.dispatchEvent(new CustomEvent('comfynext:runFiltered', {
    detail: { targetIds: [props.id], rerollScope: 'self' },
  }))
}

// --- Takes (non-destructive variation loop) -------------------------------
// The strip renders once there's at least one take. Actions mutate props.data
// in place (same pattern as widget edits) — projectTake mirrors the chosen take
// onto images/audios/text so the preview updates.
function selectTake(id: string) {
  const t = (props.data.takes || []).find((x) => x.id === id)
  if (t) Object.assign(props.data, projectTake(props.data, t))
}
function pinTake(id: string) {
  const t = (props.data.takes || []).find((x) => x.id === id)
  if (t) t.pinned = !t.pinned
  // Phase 3: persist pinned takes to the asset library with provenance.
}
function discardTake(id: string) {
  const takes = (props.data.takes || []).filter((x) => x.id !== id)
  props.data.takes = takes
  if (props.data.activeTakeId === id) {
    // Fall back to a pinned take if there is one, else the most recent.
    const fallback = takes.find((t) => t.pinned) || takes[takes.length - 1] || null
    Object.assign(props.data, projectTake(props.data, fallback))
  }
}

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

// Video nodes: hide the seed widget (and its hidden control companion) when
// the selected model's API takes no seed (registry flag supportsSeed — e.g.
// Kling v2.5 Turbo Pro 422s on it). Visibility is render-only; the positional
// widgets_values slots are untouched, so alignment is safe.
const videoSeedGate = (name: string, values: any[], defs: any[]): boolean => {
  if (name !== 'seed' && name !== 'seed_control') return true
  const modelIdx = defs.findIndex((d: any) => d?.name === 'model')
  if (modelIdx < 0) return true
  return modelSupportsSeed(String(values[modelIdx] ?? ''))
}

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

  // Video generation nodes: hide the seed/seed_control widgets when the
  // selected model's API takes no seed parameter (registry flag supportsSeed).
  // Model-specific advanced settings live in the ModelGalleryModal bag, so the
  // node body only shows shared widgets (model, prompt, aspect_ratio, seed).
  GenerateVideoNode: videoSeedGate,
  FilmShotNode: videoSeedGate,
  // Upscalers expose very different controls per engine — Clarity has the full
  // diffusion knob set, Real-ESRGAN/Topaz just face-enhance + scale, Recraft
  // Crisp takes nothing but the image. Gate them so the node only shows what
  // the selected model actually uses.
  UpscaleImageNode: (name, values, defs) => isVisibleForModel('UpscaleImageNode', name, values, defs),
  // Outpaint: Flux Fill uses a direction picker; Bria Expand uses an aspect
  // ratio. Show only the control the selected engine actually consumes.
  OutpaintImageNode: (name, values, defs) => isVisibleForModel('OutpaintImageNode', name, values, defs),
}

// Sibling of WIDGET_VISIBILITY: per-node option FILTERS for combo widgets.
// A rule returns the allowed values for a widget (null = leave schema options
// alone). The filtered list is intersected with the schema options and falls
// back to the schema when the intersection is empty — we never invent values
// the backend combo would reject.
const videoOptionsFilter = (name: string, values: any[], defs: any[]): string[] | null => {
  if (name !== 'duration' && name !== 'aspect_ratio') return null
  const modelIdx = defs.findIndex((d: any) => d?.name === 'model')
  if (modelIdx < 0) return null
  const id = String(values[modelIdx] ?? '')
  return name === 'duration' ? allowedDurations(id) : allowedAspectRatios(id)
}

const WIDGET_OPTIONS: Record<string, (name: string, values: any[], defs: any[]) => string[] | null> = {
  GenerateVideoNode: videoOptionsFilter,
  FilmShotNode: videoOptionsFilter,
}

// For each use-case node, map model-gated widget names → the Model combo value
// they belong to. If a widget appears here and the current model doesn't
// match, the widget is hidden. Widgets NOT in this map are always visible
// (the shared inputs at the top of each node).
const MODEL_GATED_WIDGETS: Record<string, Record<string, string | string[]>> = {
  // GenerateImageNode and GenerateVideoNode entries removed — their advanced
  // settings live in the ModelGalleryModal (per-model bag) instead of as
  // gated widgets on the node. Video seed gating is handled by videoSeedGate.
  // Upscale engines. `model` is ungated (always shown). Recraft Crisp takes
  // only the image, so none of these match it → it shows just the model picker.
  UpscaleImageNode: {
    prompt:                 'Clarity',
    scale_factor:           ['Clarity', 'Crystal', 'Real-ESRGAN'],   // Topaz uses topaz_upscale_factor; Recraft takes none
    creativity:             'Clarity',
    resemblance:            'Clarity',
    negative_prompt:        'Clarity',
    num_inference_steps:    'Clarity',
    seed:                   'Clarity',
    face_enhance:           ['Real-ESRGAN', 'Topaz'],
    // Topaz-only controls (topazlabs/image-upscale)
    topaz_enhance_model:    'Topaz',
    topaz_upscale_factor:   'Topaz',
    topaz_subject_detection:'Topaz',
    topaz_output_format:    'Topaz',
    topaz_face_creativity:  'Topaz',
    topaz_face_strength:    'Topaz',
    // Crystal-only controls (philz1337x/crystal-upscaler)
    crystal_creativity:     'Crystal',
    crystal_output_format:  'Crystal',
  },
  OutpaintImageNode: {
    direction:    'Flux Fill',     // directional / zoom-out picker
    aspect_ratio: 'Bria Expand',   // target canvas ratio
  },
}

function isVisibleForModel(nodeType: string, widgetName: string, values: any[], defs: any[]): boolean {
  const gates = MODEL_GATED_WIDGETS[nodeType]
  if (!gates) return true
  const gate = gates[widgetName]
  if (!gate) return true              // not gated → always show
  const modelIdx = defs.findIndex(d => d.name === 'model')
  if (modelIdx < 0) return true       // no model combo found → don't hide
  const currentModel = values[modelIdx]
  const allowed = Array.isArray(gate) ? gate : [gate]
  return allowed.includes(currentModel)
}

function isWidgetVisible(widget: any): boolean {
  const rule = WIDGET_VISIBILITY[props.data.nodeType]
  if (!rule) return true
  return rule(widget.name, props.data.widgetsValues || [], props.data.widgetDefs || [])
}

// The widget def handed to ComfyNodeWidget — the original, or a shallow clone
// with filtered options. node.data.widgetDefs is NEVER mutated.
function effectiveWidgetDef(widget: any): any {
  const rule = WIDGET_OPTIONS[props.data.nodeType]
  if (!rule) return widget
  const allowed = rule(widget.name, props.data.widgetsValues || [], props.data.widgetDefs || [])
  if (!allowed) return widget
  const schema: string[] = Array.isArray(widget.options) ? widget.options : []
  const filtered = schema.filter((o: any) => allowed.includes(String(o)))
  if (filtered.length === 0 || filtered.length === schema.length) return widget
  return { ...widget, options: filtered }
}

// Per-node widget groupings. Widgets in a group render together under a
// collapsible header. Widgets not listed render flat above the groups.
const WIDGET_GROUPS: Record<string, { title: string; widgets: string[] }[]> = {
  // Keep the node tidy: only prompt / LoRA / scale / aspect ratio show by
  // default; the rest live in a collapsed Advanced group.
  FluxLoRARemoteNode: [
    { title: 'Advanced', widgets: ['lora_url', 'megapixels', 'num_inference_steps', 'guidance', 'seed', 'prompt_strength'] },
  ],
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
  'Advanced',
  'Midtones', 'Highlights', 'Green output', 'Blue output',
  ...Array.from({ length: 15 }, (_, i) => `Layer ${i + 2}`),
]))

// "Grow as you connect" node types — the canvas shows only the slots in use
// plus one trailing empty slot ready to catch the next connection. The Python
// schema declares a generous static cap (Compositor: 16, SmartLayout: 8);
// this is purely a UI affordance to keep the node tidy.
const DYNAMIC_GROW_NODES = new Set<string>(['Compositor', 'SmartLayout', 'Timeline'])

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

// Seed widget lock-state read/write. Two storage paths depending on whether
// the widget follows Comfy's control_after_generate convention:
//   - Standard (KSampler etc.): widgets_values[i+1] holds "fixed"/"randomize"
//   - Non-standard (Replicate, custom): node.properties.seedLocks[name] = bool
// Treat the two uniformly from the widget's perspective via a single bool.
function isSeedWidgetDef(widget: any): boolean {
  if (!widget || widget.type !== 'INT') return false
  if (widget.control_after_generate) return true
  return /seed/i.test(String(widget.name || ''))
}
function isSeedFixed(widget: any, i: number): boolean {
  if (!isSeedWidgetDef(widget)) return false
  if (widget.control_after_generate) {
    return props.data.widgetsValues?.[i + 1] === 'fixed'
  }
  return !!(props.data.properties as any)?.seedLocks?.[widget.name]
}
function setSeedFixed(widget: any, i: number, fixed: boolean) {
  if (!isSeedWidgetDef(widget)) return
  if (widget.control_after_generate) {
    if (!props.data.widgetsValues) return
    props.data.widgetsValues[i + 1] = fixed ? 'fixed' : 'randomize'
    return
  }
  if (!props.data.properties) (props.data as any).properties = {}
  const locks = ((props.data.properties as any).seedLocks ??= {})
  locks[widget.name] = fixed
}

function widgetsInGroup(title: string): any[] {
  const groups = WIDGET_GROUPS[props.data.nodeType]
  if (!groups) return []
  const g = groups.find(gr => gr.title === title)
  if (!g) return []
  const byName = new Map((props.data.widgetDefs || []).map((d: any) => [d.name, d]))
  return g.widgets.map(n => byName.get(n)).filter(Boolean)
}

// FluxLoRARemoteNode "Style" field — the aesthetic, stored as a node
// PROPERTY (not a ComfyUI input, so the schema stays stable) and folded into the
// prompt at submit time. Collapsed by default to keep the prompt area clean.
const styleOpen = ref(false)
const loraStyleProp = computed<string>({
  // `tasteProfile` fallback keeps workflows saved before the rename working.
  get: () => String((props.data.properties as any)?.aesthetic ?? (props.data.properties as any)?.tasteProfile ?? ''),
  set: (v: string) => {
    if (!props.data.properties) (props.data as any).properties = {}
    ;(props.data.properties as any).aesthetic = v
  },
})
// Inputs flagged `advanced` in the node schema collapse into an "Advanced"
// section (closed by default) so a node shows only its core controls. Honors
// the same hidden/internal/grouped exclusions as the main widget loop.
const advancedOpen = ref(false)
const advancedWidgets = computed(() =>
  (props.data.widgetDefs || []).filter((w: any) =>
    w.advanced && !w.hidden && w.comfynext_widget !== 'internal'
    && isWidgetVisible(w) && !groupedWidgetNames.value.has(w.name)))

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

// --- Outpaint zone visualization (OutpaintImageNode only) -------------------
// A schematic on the node showing the original image inside the expanded
// canvas, with the new (to-be-generated) area hatched. Updates live as the
// model / direction / aspect-ratio widgets change. Geometry is exact for
// Zoom-out / Make-square / Bria aspect ratios; directional outpaints use a
// representative extent (the API doesn't expose the exact amount).
const outpaintSrcAR = ref(1)
function onOutpaintImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) {
    outpaintSrcAR.value = img.naturalWidth / img.naturalHeight
  }
}
const outpaintSrc = computed(() =>
  props.data.nodeType === 'OutpaintImageNode' ? getUpstreamImage('image') : null)

const outpaintGeom = computed(() => {
  if (props.data.nodeType !== 'OutpaintImageNode') return null
  const wv = props.data.widgetsValues || []
  const model = wv[widgetIndex('model')] ?? 'Flux Fill'
  const ar = outpaintSrcAR.value || 1
  // Original rect, normalized so its longer side = 1.
  const ow = ar >= 1 ? 1 : ar
  const oh = ar >= 1 ? 1 / ar : 1
  let cw = ow, ch = oh, ox = 0, oy = 0
  let approx = false

  if (model === 'Bria Expand') {
    const [rw, rh] = String(wv[widgetIndex('aspect_ratio')] ?? '16:9').split(':').map(Number)
    const targetAR = (rw || 16) / (rh || 9)
    if (targetAR >= ow / oh) { ch = oh; cw = oh * targetAR } else { cw = ow; ch = ow / targetAR }
    ox = (cw - ow) / 2; oy = (ch - oh) / 2
  } else {
    const dir = wv[widgetIndex('direction')] ?? 'Zoom out 1.5x'
    const ext = 0.5  // representative directional extent
    if (dir === 'Zoom out 1.5x') { cw = ow * 1.5; ch = oh * 1.5; ox = (cw - ow) / 2; oy = (ch - oh) / 2 }
    else if (dir === 'Zoom out 2x') { cw = ow * 2; ch = oh * 2; ox = (cw - ow) / 2; oy = (ch - oh) / 2 }
    else if (dir === 'Make square') { const s = Math.max(ow, oh); cw = s; ch = s; ox = (s - ow) / 2; oy = (s - oh) / 2 }
    else if (dir === 'Left outpaint') { cw = ow * (1 + ext); ch = oh; ox = ow * ext; oy = 0; approx = true }
    else if (dir === 'Right outpaint') { cw = ow * (1 + ext); ch = oh; ox = 0; oy = 0; approx = true }
    else if (dir === 'Top outpaint') { cw = ow; ch = oh * (1 + ext); ox = 0; oy = oh * ext; approx = true }
    else if (dir === 'Bottom outpaint') { cw = ow; ch = oh * (1 + ext); ox = 0; oy = 0; approx = true }
  }
  // Fit the whole canvas into a display box, preserving aspect.
  const MAXW = 232, MAXH = 150
  const s = Math.min(MAXW / cw, MAXH / ch)
  const pct = Math.round((ow * oh) / (cw * ch) * 100)
  // Display-space (px) rects for the HTML/CSS render.
  return {
    dispW: Math.round(cw * s), dispH: Math.round(ch * s),
    thumbLeft: ox * s, thumbTop: oy * s, thumbW: ow * s, thumbH: oh * s,
    pct, approx,
  }
})

// --- Edit as Frame (layer-splitting nodes) -----------------------------------
// Layerize / Split-photo deconstruct a flat image into layers; this hands the
// result to a Frame artifact (wired image layers + — for Layerize — the text
// containers converted into editable local text layers). The canvas owns the
// node/edge creation; we just announce the intent.
const showEditAsFrame = computed(() =>
  props.data.nodeType === 'LayerizeGraphicNode' || props.data.nodeType === 'SplitPhotoLayersNode')
const editAsFrameReady = computed(() => {
  // Layerize needs its run result — the text layers live in the layers_json
  // payload (mirrored to data.text). Split-photo only wires outputs, so the
  // Frame can be created before the first run.
  if (props.data.nodeType === 'LayerizeGraphicNode') return !!(props.data as any).text
  return true
})
function editAsFrame() {
  window.dispatchEvent(new CustomEvent('comfynext:editAsFrame', { detail: { nodeId: props.id } }))
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

// Carousel state — used by nodes that produce a set of related images
// (SmartLayout: one PNG per aspect). Resets to 0 whenever the image set
// changes so a fresh render always lands on the first card.
const carouselIndex = ref(0)

// Derive a human-readable label for each carousel slot. SmartLayout's preview
// filenames embed the aspect key (live_preview_<id>_<aspect>.png) so we can
// pluck it back out; fall back to the index when the pattern doesn't match.
function carouselLabel(url: string, fallback: number): string {
  const m = /live_preview_[^_]+_([^/?]+?)\.png/.exec(url)
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]) } catch { return m[1] }
  }
  return String(fallback + 1)
}

// Trigger a browser download for the currently visible image. Uses a fetch
// → blob → anchor.download pattern so the file lands with a friendly name
// (template_<aspect>.png) even though the URL is `/view?filename=…`.
async function downloadCarouselImage(url: string, label: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const obj = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = obj
    a.download = `smartlayout_${label}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(obj)
  } catch (err) {
    console.error('[ComfyNode] carousel download failed:', err)
  }
}

async function downloadAllCarouselImages(urls: string[]) {
  for (let i = 0; i < urls.length; i++) {
    await downloadCarouselImage(urls[i]!, carouselLabel(urls[i]!, i))
  }
}

watch(previewImages, (urls) => {
  if (!urls || !urls.length) {
    displayedImages.value = []
    carouselIndex.value = 0
    return
  }
  // Snap back to the first slot so a new render set is shown from the start.
  carouselIndex.value = 0
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
    class="comfy-node relative rounded-xl border w-[260px] select-none backdrop-blur-sm"
    :class="{
      'comfy-node--muted': isMuted,
      'comfy-node--bypassed': isBypassed,
      'ring-2 ring-red-500': data.error,
      'border-indigo-500/30': data.isSubgraph,
      'border-white/10': !data.isSubgraph,
    }"
    :data-running="data.running || undefined"
    :data-mode="data.mode || 0"
    :style="{
      background: data.bgcolor
        ? `linear-gradient(180deg, color-mix(in srgb, ${data.bgcolor} 35%, #1a1a1a) 0%, color-mix(in srgb, ${data.bgcolor} 20%, #1a1a1a) 100%)`
        : 'linear-gradient(180deg, #252525 0%, #1e1e1e 100%)',
      '--border-color-left': borderColorLeft,
      '--border-color-right': borderColorRight,
    } as any"
  >
    <!-- Mode overlay: bypass shows diagonal stripes; mute shows soft scrim -->
    <div
      v-if="isMuted || isBypassed"
      class="pointer-events-none absolute inset-0 rounded-xl z-[5]"
      :class="isBypassed ? 'comfy-node-stripes' : 'bg-black/30'"
    />
    <!-- Mode badge (top-right) -->
    <div
      v-if="isMuted || isBypassed"
      class="pointer-events-none absolute top-1.5 right-1.5 z-[6] text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
      :class="isBypassed
        ? 'bg-amber-500/25 text-amber-200 border border-amber-400/30'
        : 'bg-white/15 text-white/70 border border-white/15'"
    >
      {{ isBypassed ? 'Bypass' : 'Mute' }}
    </div>
    <!-- Title bar -->
    <div
      class="flex items-center gap-2 px-3 py-2 border-b border-white/5 rounded-t-xl"
      :style="{ background: `linear-gradient(135deg, ${accentColor}15 0%, transparent 60%)` }"
    >
      <!-- Subgraph icon → partner icon → toolbox icon. No fallback dot:
           if nothing resolves, the title fills the space instead. -->
      <svg v-if="data.isSubgraph" class="size-4 shrink-0 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="8" height="8" rx="1" /><rect x="14" y="2" width="8" height="8" rx="1" /><rect x="8" y="14" width="8" height="8" rx="1" />
      </svg>
      <!-- Per-node generator icon takes precedence over provider logo: a
           Flux Dev card and a Veo card from the same provider should read
           differently at a glance, not as two identical Replicate clouds. -->
      <component v-else-if="generatorIcon" :is="generatorIcon" class="size-4 shrink-0 text-white/70" :stroke-width="1.75" />
      <img v-else-if="partnerIconUrl" :src="partnerIconUrl" class="size-4 shrink-0 rounded-sm" />
      <component v-else-if="toolboxIcon" :is="toolboxIcon" class="size-4 shrink-0 text-white/70" :stroke-width="1.75" />
      <span class="text-xs font-semibold text-white/90 truncate flex-1">{{ data.subgraphName || displayTitle }}</span>
      <!-- Re-roll this node: runs ONLY this node, re-rolling its seed and reusing
           cached upstream (no regen / re-billing of the chain). See rerollThisNode. -->
      <button
        v-if="showRunButton"
        class="nopan nodrag shrink-0 size-5 rounded-md flex items-center justify-center transition-colors cursor-pointer"
        :class="(isMuted || isBypassed || data.running)
          ? 'text-white/25 cursor-not-allowed'
          : 'text-white/55 hover:text-violet-300 hover:bg-violet-400/15'"
        :disabled="isMuted || isBypassed || data.running"
        :title="isMuted ? 'Node is muted'
          : isBypassed ? 'Node is bypassed'
          : data.running ? 'Running…'
          : 'Re-run only this node — new seed, everything upstream stays as-is'"
        @click.stop="rerollThisNode"
      >
        <Dices class="size-3" />
      </button>
      <!-- Per-node Run: runs this node + its upstream deps via filtered queue.
           Shows on generators, output sinks (OUTPUT_NODE=True), and heavy
           local compute — see showRunButton above. -->
      <button
        v-if="showRunButton"
        class="nopan nodrag shrink-0 size-5 rounded-md flex items-center justify-center transition-colors cursor-pointer"
        :class="(isMuted || isBypassed)
          ? 'text-white/25 cursor-not-allowed'
          : data.running
            ? 'text-emerald-300 bg-emerald-400/15'
            : 'text-white/55 hover:text-emerald-300 hover:bg-emerald-400/15'"
        :disabled="isMuted || isBypassed || data.running"
        :title="isMuted ? 'Node is muted'
          : isBypassed ? 'Node is bypassed'
          : data.running ? 'Running…'
          : 'Run this node and everything before it'"
        @click.stop="runThisNode"
      >
        <Loader2 v-if="data.running" class="size-3 animate-spin" />
        <Play v-else class="size-3" :fill="(isMuted || isBypassed) ? 'none' : 'currentColor'" />
      </button>
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

    <!-- Inline error banner — persists until the next successful run on
         this node. Toasts disappear; this keeps the failure reason visible
         next to the node that actually failed. -->
    <div
      v-if="data.error && data.errorMessage"
      class="px-3 py-1.5 bg-red-500/15 border-b border-red-500/20 text-[10.5px] text-red-200 leading-snug max-h-[80px] overflow-auto nopan nodrag select-text"
      :title="data.errorMessage"
    >
      {{ data.errorMessage }}
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

    <!-- Outpaint zone preview: original image inside the expanded canvas,
         new area hatched. OutpaintImageNode only. Pure HTML/CSS so it never
         re-decodes the source image during canvas pan/zoom (SVG <image> did). -->
    <div v-if="data.nodeType === 'OutpaintImageNode' && outpaintGeom"
         class="border-t border-[#2a2a2a] pt-2 pb-1 flex flex-col items-center gap-1">
      <div class="op-canvas relative overflow-hidden rounded-[3px]"
           :style="{ width: outpaintGeom.dispW + 'px', height: outpaintGeom.dispH + 'px' }">
        <!-- Original image (thumbnail if wired, else solid block) -->
        <img v-if="outpaintSrc" :src="outpaintSrc" alt="" draggable="false"
             class="absolute object-fill select-none pointer-events-none"
             :style="{ left: outpaintGeom.thumbLeft + 'px', top: outpaintGeom.thumbTop + 'px',
                       width: outpaintGeom.thumbW + 'px', height: outpaintGeom.thumbH + 'px',
                       outline: '1px solid #e8e8e8', outlineOffset: '-1px' }"
             @load="onOutpaintImgLoad">
        <div v-else class="absolute bg-[#3a3a3a]"
             :style="{ left: outpaintGeom.thumbLeft + 'px', top: outpaintGeom.thumbTop + 'px',
                       width: outpaintGeom.thumbW + 'px', height: outpaintGeom.thumbH + 'px' }" />
      </div>
      <span class="text-[9px] text-[#6f6f6f] leading-none">
        new area · original {{ outpaintGeom.pct }}% of canvas{{ outpaintGeom.approx ? ' (approx)' : '' }}
      </span>
    </div>

    <!-- Edit as Frame: hand the split layers to a Frame artifact -->
    <div v-if="showEditAsFrame" class="border-t border-[#2a2a2a] px-2 py-1.5">
      <button
        class="w-full flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium transition-colors"
        :class="editAsFrameReady
          ? 'bg-white/[0.07] hover:bg-white/[0.14] text-white/85 cursor-pointer'
          : 'bg-white/[0.03] text-white/30 cursor-not-allowed'"
        :disabled="!editAsFrameReady"
        :title="editAsFrameReady
          ? 'Create a Frame with these results as editable layers'
          : 'Run the node first — the editable text layers come from the result'"
        @click.stop="editAsFrame"
      >
        <Frame class="size-3.5" />
        Edit as Frame
      </button>
    </div>

    <!-- Widgets (Compositor edits via its dedicated modal, so we hide its inline controls) -->
    <div v-if="data.widgetDefs?.some(w => !w.hidden) && data.nodeType !== 'Compositor' && data.nodeType !== 'Timeline'" class="border-t border-[#2a2a2a] py-1.5 flex flex-col gap-1.5">
      <!-- Ungrouped widgets render first. Seed widgets carry a lock state
           that controls whether the pre-Run randomizer touches them. For
           Comfy-standard seeds it lives at widgets_values[i+1] (the
           control_after_generate slot); everything else stores it in
           node.properties.seedLocks so non-standard generators (Replicate,
           custom nodes) get the same toggle. -->
      <template v-for="(widget, i) in data.widgetDefs" :key="widget.name">
        <VueCanvasComfyNodeWidget
          v-if="!widget.hidden && !widget.advanced && widget.comfynext_widget !== 'internal' && isWidgetVisible(widget) && !groupedWidgetNames.has(widget.name)"
          :widget-def="effectiveWidgetDef(widget)"
          :node-type="data.nodeType"
          :node-id="id"
          :model-value="data.widgetsValues?.[i]"
          :is-fixed="isSeedFixed(widget, i)"
          @update:model-value="data.widgetsValues[i] = $event"
          @update:is-fixed="setSeedFixed(widget, i, $event)"
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
            :widget-def="effectiveWidgetDef(widget)"
            :node-type="data.nodeType"
            :model-value="data.widgetsValues?.[widgetIndex(widget.name)]"
            :is-fixed="isSeedFixed(widget, widgetIndex(widget.name))"
            @update:model-value="data.widgetsValues[widgetIndex(widget.name)] = $event"
            @update:is-fixed="setSeedFixed(widget, widgetIndex(widget.name), $event)"
          />
        </template>
      </template>

      <!-- Advanced inputs (collapsed by default) — any input flagged
           `advanced` in the schema, e.g. the multi-LoRA node's URL overrides
           and sampler knobs, so the node shows only its core controls. -->
      <template v-if="advancedWidgets.length">
        <div class="px-2 nopan nodrag">
          <button
            class="flex items-center gap-1 w-full text-[10px] uppercase tracking-[0.08em] text-white/50 hover:text-white/80 cursor-pointer py-1 transition-colors"
            @click="advancedOpen = !advancedOpen"
          >
            <ChevronRight class="size-3 transition-transform" :class="advancedOpen ? 'rotate-90' : ''" />
            <span>Advanced</span>
          </button>
        </div>
        <template v-if="advancedOpen">
          <VueCanvasComfyNodeWidget
            v-for="widget in advancedWidgets"
            :key="widget.name"
            :widget-def="effectiveWidgetDef(widget)"
            :node-type="data.nodeType"
            :node-id="id"
            :model-value="data.widgetsValues?.[widgetIndex(widget.name)]"
            :is-fixed="isSeedFixed(widget, widgetIndex(widget.name))"
            @update:model-value="data.widgetsValues[widgetIndex(widget.name)] = $event"
            @update:is-fixed="setSeedFixed(widget, widgetIndex(widget.name), $event)"
          />
        </template>
      </template>

      <!-- FluxLoRARemoteNode / FluxMultiLoRARemoteNode: schema-free "Style"
           field. Stored as a node property and prepended to the prompt at run
           time, so the prompt area stays clean for the user's scene. -->
      <template v-if="data.nodeType === 'FluxLoRARemoteNode' || data.nodeType === 'FluxMultiLoRARemoteNode'">
        <div class="px-2 nopan nodrag">
          <button
            class="flex items-center gap-1 w-full text-[10px] uppercase tracking-[0.08em] text-white/50 hover:text-white/80 cursor-pointer py-1 transition-colors"
            @click="styleOpen = !styleOpen"
          >
            <ChevronRight class="size-3 transition-transform" :class="styleOpen ? 'rotate-90' : ''" />
            <span>Style</span>
            <span v-if="loraStyleProp.trim()" class="ml-1 normal-case text-[8.5px] text-white/60 bg-white/10 px-1 py-px rounded">added to prompt</span>
          </button>
          <div v-if="styleOpen" class="pb-1">
            <textarea
              v-model="loraStyleProp"
              rows="4"
              placeholder="Style / aesthetic — automatically added to the front of your prompt at run time. Keeps the prompt box clean for your scene."
              class="nodrag nopan nowheel w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] leading-relaxed text-foreground placeholder:text-white/25 outline-none focus-visible:border-ring resize-y"
            />
          </div>
        </div>
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

    <!-- SmartLayout carousel: one card per rendered aspect, with prev/next
         arrows and a download icon on the active card. Falls back to the
         generic image branch below when the node only produced a single
         image (single-aspect render). -->
    <div
      v-else-if="data.nodeType === 'SmartLayout' && displayedImages.length"
      class="border-t border-[#2a2a2a] p-2 nopan nodrag"
    >
      <div class="relative">
        <img
          :src="displayedImages[Math.min(carouselIndex, displayedImages.length - 1)]"
          class="w-full rounded-lg object-contain max-h-[300px] bg-black/30"
          loading="lazy"
          @load="onPreviewImgLoad"
        />
        <!-- Download current -->
        <button
          class="absolute top-1.5 right-1.5 size-7 rounded-md bg-black/55 hover:bg-black/75 backdrop-blur-sm text-white/85 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          title="Download this image"
          @click.stop="downloadCarouselImage(
            displayedImages[Math.min(carouselIndex, displayedImages.length - 1)]!,
            carouselLabel(displayedImages[Math.min(carouselIndex, displayedImages.length - 1)]!, carouselIndex),
          )"
        >
          <Download class="size-3.5" />
        </button>
        <!-- Prev / Next — only when >1 image -->
        <template v-if="displayedImages.length > 1">
          <button
            class="absolute top-1/2 -translate-y-1/2 left-1.5 size-7 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur-sm text-white/85 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Previous"
            @click.stop="carouselIndex = (carouselIndex - 1 + displayedImages.length) % displayedImages.length"
          >
            <ChevronLeft class="size-4" />
          </button>
          <button
            class="absolute top-1/2 -translate-y-1/2 right-1.5 size-7 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur-sm text-white/85 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Next"
            @click.stop="carouselIndex = (carouselIndex + 1) % displayedImages.length"
          >
            <ChevronRight class="size-4" />
          </button>
        </template>
      </div>
      <!-- Bottom strip: dots (jump to image) + active label + "Save all" -->
      <div v-if="displayedImages.length > 1" class="mt-2 flex items-center gap-2">
        <div class="flex items-center gap-1">
          <button
            v-for="(_, i) in displayedImages"
            :key="i"
            class="size-1.5 rounded-full transition-colors cursor-pointer"
            :class="i === Math.min(carouselIndex, displayedImages.length - 1)
              ? 'bg-[#96b4ff]'
              : 'bg-white/25 hover:bg-white/45'"
            :title="carouselLabel(displayedImages[i]!, i)"
            @click.stop="carouselIndex = i"
          />
        </div>
        <span class="text-[10px] text-white/45 tabular-nums">
          {{ carouselLabel(displayedImages[Math.min(carouselIndex, displayedImages.length - 1)]!, carouselIndex) }}
          <span class="text-white/25">·</span>
          {{ Math.min(carouselIndex, displayedImages.length - 1) + 1 }}/{{ displayedImages.length }}
        </span>
        <span class="flex-1" />
        <button
          class="h-6 px-2 rounded text-[10px] text-white/65 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] transition-colors cursor-pointer flex items-center gap-1"
          title="Download all aspects as PNGs"
          @click.stop="downloadAllCarouselImages(displayedImages)"
        >
          <Download class="size-3" />
          Save all
        </button>
      </div>
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

    <!-- Takes strip (flag-gated): switch / pin / discard this node's results -->
    <TakesStrip
      v-if="(data.takes?.length ?? 0) >= 1"
      :takes="data.takes!"
      :active-take-id="data.activeTakeId"
      @select="selectTake"
      @pin="pinTake"
      @discard="discardTake"
    />
  </div>
</template>

<style scoped>
.comfy-node {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}

/* Outpaint zone preview: dark base + blue diagonal hatch marks the new area,
   dashed edge marks the expanded canvas. The original thumbnail sits on top. */
.op-canvas {
  box-sizing: border-box;
  background-color: #161d33;
  background-image: repeating-linear-gradient(
    45deg, transparent 0 5px, rgba(91, 123, 214, 0.55) 5px 6px);
  border: 1px dashed rgba(91, 123, 214, 0.8);
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

/* Muted: dimmed + desaturated. Skipped at execution time. */
.comfy-node--muted {
  opacity: 0.45;
  filter: grayscale(0.8);
}

/* Bypassed: pass-through. Faint amber accent + striped overlay rendered above. */
.comfy-node--bypassed {
  opacity: 0.85;
  border-style: dashed;
  border-color: rgba(251, 191, 36, 0.35);
}

.comfy-node-stripes {
  background-image: repeating-linear-gradient(
    -45deg,
    rgba(251, 191, 36, 0.06) 0,
    rgba(251, 191, 36, 0.06) 6px,
    transparent 6px,
    transparent 14px
  );
}
</style>
