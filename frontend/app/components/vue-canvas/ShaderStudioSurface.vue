<!-- frontend/app/components/vue-canvas/ShaderStudioSurface.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { ChevronRight, Plus, Trash2 } from 'lucide-vue-next'
import CatalogModal from '~/components/CatalogModal.vue'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioLayerStack from '~/components/vue-canvas/StudioLayerStack.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import BindableRow from '~/components/vue-canvas/studio/BindableRow.vue'
import PalettePicker from '~/components/vue-canvas/studio/PalettePicker.vue'
import CanvasContextMenu from '~/components/vue-canvas/CanvasContextMenu.vue'
import { assetUrl, fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { resolveUniforms } from '~/lib/shaderfx/params'
import { shaderFx } from '~/lib/shaderfx/renderer'
import type { EffectDef, ShaderFxCatalog } from '~/lib/shaderfx/types'
import { composePasses, type EffectTextureBundle } from '~/lib/shaderstudio/passes'
import { migrateShaderConfig } from '~/lib/shaderstudio/migrate'
import { ANIMATABLE, applyMotion } from '~/lib/shaderstudio/motion'
import { ADJUST_PRESETS, applyAdjustPreset } from '~/lib/shaderstudio/presets'
import { exportClock, makeImageSource, makeLiveSource, motionConfigFor, resolveSourceKind, type ResolvedSource } from '~/lib/shaderstudio/resolve'
import { frameSourceEpoch } from '~/lib/studio/frameSource'
import { loadImage } from '~/lib/shaderstudio/source'
import { BLEND_MODES } from '~/lib/studio/blend'
import { cloneConfig, defaultConfig, hydrateConfig, LAYER_MAX, newLayerId, outputDims, type MotionTrack, type ShaderStudioConfig, type StudioEffect } from '~/lib/shaderstudio/types'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { useStudioAgent } from '~/composables/useStudioAgent'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { useStudioVarMenu } from '~/composables/useStudioVarMenu'
import { makeConfigParams } from '~/lib/agent/configParams'
import { shaderAgentControls } from '~/lib/shaderstudio/agentControls'
import { controlsForStudio } from '~/lib/collection/studioControls'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'

const props = defineProps<{ nodeId: string; nodes: any[]; edges?: any[]; wiredUrl?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()
function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

const config = ref<ShaderStudioConfig>(defaultConfig())
const catalog = ref<ShaderFxCatalog | null>(null)
const resolved = ref<ResolvedSource | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)
const baking = ref(false)
const bakeMsg = ref('')
// Preview backing-store cap. Kept high so grid-based effects (ASCII, halftone,
// dither) render enough pixels-per-cell to stay crisp on retina displays and at
// fine Size values — at 880 a dense ASCII grid mushed out. Export still upscales
// to the user's chosen resolution separately.
const PREVIEW_MAX_W = 1600

// Active effect — selected via the aside StudioLayerStack. The Stylized Effects
// section (picker/params/blend/opacity) and the agent tuner are both scoped to
// this index; motion tracks address a specific effect by dotted path
// (`effects.<idx>.params.<uniform>`), remapped on add/remove/reorder below.
const activeEffect = ref(0)
const activeEffectCfg = computed<StudioEffect>(() => config.value.effects[activeEffect.value] ?? config.value.effects[0]!)
const effectDef = computed<EffectDef | null>(
  () => catalog.value?.effects.find(e => e.id === activeEffectCfg.value?.id) ?? null)
const effectUniforms = computed(() =>
  effectDef.value ? resolveUniforms(effectDef.value, activeEffectCfg.value?.params ?? {}) : {})
/** Aside layer-stack label: the catalog def's display name, or 'Empty' if unpicked. */
function effectLabel(e: StudioEffect): string {
  return catalog.value?.effects.find(d => d.id === e.id)?.name ?? 'Empty'
}

// In-product agent — "tune" the shader in natural language (Phase 1). The nested
// `config` is bridged to a flat Params; only the controls for currently-enabled
// stages (plus the active effect's float uniforms) are offered to the model.
const { getLocalSetting } = useLocalSettings()
const agentParams = makeConfigParams(() => config.value, () => activeEffect.value)
const activeAgentControls = computed(() => shaderAgentControls(config.value, effectDef.value, activeEffect.value))
// The shell renders the prompt + results from this object (see StudioModalShell).
const shaderAgent = useStudioAgent({
  controls: () => activeAgentControls.value, params: agentParams, label: () => 'Shader studio',
  apiKey: () => getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '',
  // Force a fresh synchronous render of the current config to the preview canvas,
  // then export it for the agent's visual self-review.
  render: async () => { await renderFrame(0); return canvas.value?.toDataURL('image/png') ?? null },
})

// Collections variable binding (Slice 2a, Task 7a) — same recipe as Gradient Studio
// (Task 6): `studioControls` mirrors what the agent tuner offers (via
// `controlsForStudio`, loaded once since the composable wants a synchronous
// accessor) purely for the bind-menu's control descriptions (label/kind/min/max/
// step/options), matched by dotted key. The SAME dotted-path proxy the canvas
// agent tuner reads/writes (`agentParams` above) is reused here so onEdit/promote/
// unbind's "live value" reads and applyParam's writes address identical keys.
// Writing through this proxy mutates `config` directly, so the surface's existing
// `deep` watcher on `config` re-renders the preview — no extra watcher needed, and
// per the loop-safety note, nothing here calls onEdit from a config watch (only
// the explicit control handlers below do).
const studioControls = ref<StudioControlDesc[]>([])
onMounted(async () => { studioControls.value = await controlsForStudio(currentNode()) })

const { boundColumnFor, boundColumnKeyFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  () => studioControls.value,
  (key, value) => { agentParams[key] = value },
  { nodes: () => props.nodes, edges: () => props.edges ?? [] },
)

const { wiredColumns, sweepPopover, applySweep, varMenu, openVarMenu } = useStudioVarMenu({
  nodeId: () => props.nodeId,
  nodes: () => props.nodes,
  edges: () => props.edges ?? [],
  liveValue: (key) => agentParams[key] as string | number,
  boundColumnFor, boundColumnKeyFor, promote, unbind,
})

// ── effect textures (mirror ShaderEffectNode) ───────────────────────────────
const textureImages = new Map<string, HTMLImageElement>()

// ASCII "Custom" shape: rasterize the user's characters into a 1-row glyph atlas
// (COLS glyphs at CW×CH, matching the shader consts), auto-sorted dark→bright by
// ink coverage — same ramp logic as the baked sets. Cached by string so the same
// canvas object is reused (the renderer keys its texture cache on object identity).
const CUSTOM_CW = 192, CUSTOM_CH = 288, CUSTOM_COLS = 10
const customAtlasCache = new Map<string, HTMLCanvasElement>()
function buildCustomAtlas(raw: string): HTMLCanvasElement {
  const chars = raw && raw.length ? raw : ' .:-=+*#%@'
  const hit = customAtlasCache.get(chars)
  if (hit) return hit
  const px = Math.round(CUSTOM_CH * 0.9)
  const scored = [...new Set([...chars])].map((ch) => {
    const c = document.createElement('canvas'); c.width = CUSTOM_CW; c.height = CUSTOM_CH
    const x = c.getContext('2d')!
    x.fillStyle = '#000'; x.fillRect(0, 0, CUSTOM_CW, CUSTOM_CH)
    x.fillStyle = '#fff'; x.font = `${px}px Menlo, Monaco, "Courier New", monospace`
    x.textAlign = 'center'; x.textBaseline = 'middle'
    x.fillText(ch, CUSTOM_CW / 2, CUSTOM_CH / 2)
    const d = x.getImageData(0, 0, CUSTOM_CW, CUSTOM_CH).data
    let ink = 0; for (let i = 0; i < d.length; i += 4) ink += d[i]
    return { ink, canvas: c }
  }).sort((a, b) => a.ink - b.ink)
  const atlas = document.createElement('canvas'); atlas.width = CUSTOM_COLS * CUSTOM_CW; atlas.height = CUSTOM_CH
  const ax = atlas.getContext('2d')!
  ax.fillStyle = '#000'; ax.fillRect(0, 0, atlas.width, atlas.height)
  for (let i = 0; i < CUSTOM_COLS; i++) {
    const idx = scored.length > 1 ? Math.round(i * (scored.length - 1) / (CUSTOM_COLS - 1)) : 0
    if (scored[idx]) ax.drawImage(scored[idx].canvas, i * CUSTOM_CW, 0)
  }
  customAtlasCache.set(chars, atlas)
  if (customAtlasCache.size > 16) customAtlasCache.delete(customAtlasCache.keys().next().value!)
  return atlas
}
// `layer` is the specific stacked effect being composited; omitted only by the
// catalog thumbnail renderer, which previews a def with default params.
function texBundle(def: EffectDef | null, layer?: StudioEffect): EffectTextureBundle {
  const sources: Record<string, TexImageSource> = {}
  const uniforms: Record<string, number> = {}
  if (!def) return { sources, uniforms }
  for (const t of def.textures) {
    const img = textureImages.get(t.file)
    if (img?.complete) sources[t.uniform] = img
    else if (!img) { const el = new Image(); el.onload = () => renderFrame(0); el.src = assetUrl(t.file, t.v); textureImages.set(t.file, el) }
    for (const [k, v] of Object.entries(t.extraUniforms ?? {})) uniforms[k] = v
  }
  // ASCII "Custom" shape (u_shape == 14) → bind the runtime glyph atlas. Resolve the
  // shape AND the glyph chars from THIS layer (not the active one) so a stacked or
  // non-active ASCII effect composites its own glyphs.
  const shape = layer?.params['u_shape'] ?? def.params.find(p => p.uniform === 'u_shape')?.default ?? 0
  if (def.id === 'ascii_dither' && Math.round(shape) === 14) {
    sources['u_customGlyphs'] = buildCustomAtlas(layer?.customChars ?? '')
  }
  return { sources, uniforms }
}

// ── preview ──────────────────────────────────────────────────────────────────
const animated = computed(() => (config.value.motion?.tracks?.length ?? 0) > 0)
/** Animate when EITHER our own tracks run or the source itself moves (mirrors ShaderStudioNode). */
const sourceAnimated = computed(() => (resolved.value?.duration ?? 0) > 0)
const shouldLoop = computed(() => animated.value || sourceAnimated.value)

/** Seconds per loop — the upstream source's clock when it has one, else our own. */
function clockDuration(): number {
  const src = resolved.value
  if (src && src.duration > 0) return src.duration
  return Math.max(0.1, config.value.motion.duration)
}

async function renderFrame(t01: number) {
  const el = canvas.value
  if (!el) return
  const src = resolved.value
  if (!src) return
  const { w, h } = outputDims(src.width, src.height, PREVIEW_MAX_W)
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try {
    const base = await src.getFrame(t01, w, h)
    // A bake (generateImage/generateVideo) may have started while this frame was
    // suspended at the await above — bail before touching the shared shaderFx
    // canvas so a resumed preview frame can't corrupt the export's toBlob read.
    if (baking.value) return
    // The clock is normalized 0..1, but motion tracks and u_time run in seconds.
    const dur = clockDuration()
    const t = t01 * dur
    // motionConfigFor is REQUIRED, not cosmetic: applyMotion divides by
    // cfg.motion.duration, so passing upstream-derived seconds against our own
    // (different) duration would run every track at the wrong rate.
    const cfg = animated.value ? applyMotion(motionConfigFor(config.value, dur), t) : config.value
    const passes = composePasses(cfg, id => catalog.value?.effects.find(e => e.id === id) ?? null, t, (def, layer) => texBundle(def, layer))
    el.getContext('2d')!.drawImage(shaderFx.render(passes, base, w, h), 0, 0)
    glError.value = null
  } catch (e: any) { glError.value = String(e?.message ?? e) }
}

let raf = 0, start = 0, inFlight = false
function loop(ts: number) {
  if (!start) start = ts
  // getFrame is async; skip a tick rather than queueing, so a slow upstream
  // degrades to a lower frame rate instead of unbounded lag.
  if (!inFlight) {
    inFlight = true
    const dur = clockDuration()
    void renderFrame((((ts - start) / 1000) % dur) / dur).finally(() => { inFlight = false })
  }
  raf = requestAnimationFrame(loop)
}
function startPreview() {
  cancelAnimationFrame(raf); start = 0; inFlight = false
  if (shouldLoop.value) raf = requestAnimationFrame(loop)
  else void renderFrame(0)
}
function stopPreview() { cancelAnimationFrame(raf); raf = 0; inFlight = false }
watch(config, () => { if (!shouldLoop.value) void renderFrame(0) }, { deep: true })
watch(shouldLoop, startPreview)

// ── source loading ────────────────────────────────────────────────────────────
// Descriptor first (pure), then load if it is a file — mirrors ShaderStudioNode's
// resolution so the card and modal never disagree about what's wired in. A live
// upstream studio (e.g. Gradient Studio with flow.speed > 0) wins over the node's
// own file-based fallbacks. `wiredUrl` is intentionally NOT consulted here — it
// was the old image-only resolution and is null for a live upstream studio.
const sourceKind = computed(() => {
  frameSourceEpoch.value  // re-resolve when any studio (un)registers a frame source
  return resolveSourceKind(props.nodeId, props.nodes ?? [], props.edges ?? [])
})

const ownSourceUrl = computed(() => config.value.source.dataUrl
  ?? (config.value.source.asset
    ? `/view?${new URLSearchParams({ filename: config.value.source.asset, type: 'input' })}`
    : null))

watch([sourceKind, ownSourceUrl], async ([kind, ownUrl]) => {
  resolved.value = null
  if (kind?.kind === 'live') { resolved.value = makeLiveSource(kind.source); startPreview(); return }
  const url = kind?.kind === 'url' ? kind.url : ownUrl
  if (!url) return
  try { resolved.value = makeImageSource(await loadImage(url)); startPreview() }
  catch { glError.value = 'Could not load source image' }
}, { immediate: true })

function onUpload(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { config.value.source = { kind: 'upload', dataUrl: String(reader.result) } }
  reader.readAsDataURL(file)
}

// ── effect picker (CatalogModal) ───────────────────────────────────────────────
const pickerOpen = ref(false)
const pickerSearch = ref('')
const pickerFilter = ref('all')
const thumbs = ref<Record<string, string>>({})
const thumbCache: Record<string, string> = ((globalThis as any).__shaderStudioThumbs ??= {})
function titleCase(s: string): string { return s.replace(/(^|[_\s])(\w)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase()).trim() }
// Base image every gallery thumbnail is rendered over. Starts as a gradient and
// is replaced with the finn_shader sample once it loads (see below).
const placeholder = (() => { const c = document.createElement('canvas'); c.width = 192; c.height = 108; const g = c.getContext('2d')!; const lg = g.createLinearGradient(0, 0, 192, 108); lg.addColorStop(0, '#444'); lg.addColorStop(1, '#999'); g.fillStyle = lg; g.fillRect(0, 0, 192, 108); return c })()
;(() => {
  const img = new Image()
  img.onload = () => {
    const g = placeholder.getContext('2d')!
    const s = Math.min(img.width / 192, img.height / 108)  // cover-fit square → 16:9
    const sw = 192 * s, sh = 108 * s
    g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, 192, 108)
    for (const k of Object.keys(thumbCache)) delete thumbCache[k]  // bust stale gradient thumbs
    thumbs.value = {}
    if (pickerOpen.value) for (const def of catalog.value?.effects ?? []) ensureThumb(def)
    if (effectDef.value) ensureThumb(effectDef.value)
  }
  img.src = '/finn_shader.png'
})()
// Picker sections: image-transforming families first, generators last as
// their own shelf. Items are sorted in this order so keyboard nav follows
// the visual grouping.
const SHADER_SECTIONS = [
  { id: 'distortion', label: 'Distortion' },
  { id: 'stylize', label: 'Stylize' },
  { id: 'color', label: 'Color' },
  { id: 'lens', label: 'Lens' },
  { id: 'blur', label: 'Blur' },
  { id: 'glow', label: 'Glow' },
  { id: 'generative', label: 'Generative' },
]
const pickerFilters = computed(() => {
  const counts = new Map<string, number>()
  for (const e of catalog.value?.effects ?? []) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
  const total = (catalog.value?.effects ?? []).length
  return [{ id: 'all', label: 'All', count: total }, ...[...counts].map(([id, count]) => ({ id, label: titleCase(id), count }))]
})
const pickerItems = computed<EffectDef[]>(() => {
  const q = pickerSearch.value.trim().toLowerCase()
  return (catalog.value?.effects ?? []).filter(e =>
    (pickerFilter.value === 'all' || e.category === pickerFilter.value)
    && (!q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)))
    .sort((a, b) =>
      SHADER_SECTIONS.findIndex(s => s.id === a.category)
      - SHADER_SECTIONS.findIndex(s => s.id === b.category))
})
function renderThumb(def: EffectDef): string {
  const b = texBundle(def)
  if (def.textures.length && Object.keys(b.sources).length < def.textures.length) return ''
  try {
    const out = shaderFx.render([{ id: def.id, source: def.source, uniforms: { ...resolveUniforms(def, {}), u_time: 1.2, u_seed: 42, u_hasInput: 1, ...b.uniforms }, textures: b.sources }], placeholder, 192, 108)
    return out.toDataURL('image/jpeg', 0.82)
  } catch { return '' }
}
function ensureThumb(def: EffectDef | null | undefined) { if (!def || thumbCache[def.id]) return; const t = renderThumb(def); if (t) { thumbCache[def.id] = t; thumbs.value = { ...thumbCache } } }
function openPicker() { pickerSearch.value = ''; pickerFilter.value = 'all'; pickerOpen.value = true; for (const def of catalog.value?.effects ?? []) ensureThumb(def) }
function pickEffect(id: string) {
  // Preserve layerId/blend/opacity/enabled (and motion-track addressing, which
  // targets this effect by array index); only the id/params/customChars reset.
  config.value.effects[activeEffect.value] = { ...config.value.effects[activeEffect.value]!, id, params: {}, customChars: '' }
  pickerOpen.value = false
  renderFrame(0)
}
const currentThumb = computed(() => (effectDef.value ? thumbs.value[effectDef.value.id] ?? '' : ''))

// ── duotone / adjust presets ────────────────────────────────────────────────
function applyDuotonePalette({ shadow, highlight }: { shadow: string; highlight: string }) {
  config.value.duotone.ink = shadow; config.value.duotone.paper = highlight; config.value.duotone.enabled = true
  onEdit('duotone.ink', shadow); onEdit('duotone.paper', highlight)
}

function applyGradientStops(stops: { pos: number; color: string }[]) {
  config.value.gradientMap.stops = stops.map(s => ({ pos: s.pos, color: s.color }))
  config.value.gradientMap.enabled = true
}
const gradientMapRampCss = computed(() => {
  const s = [...config.value.gradientMap.stops].sort((a, b) => a.pos - b.pos)
  if (!s.length) return 'transparent'
  return `linear-gradient(to right, ${s.map(x => `${x.color} ${Math.round(x.pos * 100)}%`).join(', ')})`
})
function pickAdjustPreset(name: string) { const p = ADJUST_PRESETS.find(x => x.name === name); if (p) { applyAdjustPreset(config.value.adjust, p); config.value.adjust.enabled = true } }

// ── focus-point drag pad ────────────────────────────────────────────────────
let draggingFocus = false
function onFocusDown(ev: PointerEvent) { draggingFocus = true; (ev.target as HTMLElement).setPointerCapture(ev.pointerId); onFocusMove(ev) }
function onFocusMove(ev: PointerEvent) {
  if (!draggingFocus || !canvas.value) return
  const r = canvas.value.getBoundingClientRect()
  config.value.post.blur.focusX = Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1)
  config.value.post.blur.focusY = Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 1)
}
function onFocusUp() { draggingFocus = false }

// ── motion tracks ────────────────────────────────────────────────────────────
const animatablePaths = computed(() => [
  ...ANIMATABLE,
  ...(effectDef.value?.params ?? [])
    .filter(p => p.type !== 'enum')
    .map(p => ({ path: `effects.${activeEffect.value}.params.${p.uniform}`, label: `Effect · ${p.label}`, min: p.min ?? 0, max: p.max ?? 1 })),
])
function addTrack() {
  const a = animatablePaths.value[0]!
  config.value.motion.tracks.push({ path: a.path, from: a.min, to: a.max, easing: 'pingpong', loops: 1, delay: 0, hold: 0, cycleOffset: 0 } as MotionTrack)
}
function removeTrack(i: number) { config.value.motion.tracks.splice(i, 1) }

// ── persistence ────────────────────────────────────────────────────────────────
function loadConfig() { const c = currentNode()?.data?.properties?.sailor_shaderStudio; if (c && typeof c === 'object') config.value = hydrateConfig(migrateShaderConfig(c)) }
function saveConfig() { const n = currentNode(); if (!n) return; n.data ||= {}; n.data.properties ||= {}; n.data.properties.sailor_shaderStudio = cloneConfig(config.value) }
function closeEditor() { try { saveConfig() } catch (e) { console.error('[shader-studio] saveConfig failed', e) } emit('close') }

// ── outputs (mirror Gradient Studio) ───────────────────────────────────────────
async function renderBlob(t01: number): Promise<Blob> {
  const src = resolved.value!
  const { w, h } = outputDims(src.width, src.height, config.value.resolution, { upscale: true })
  const dur = clockDuration()
  const t = t01 * dur
  const cfg = animated.value ? applyMotion(motionConfigFor(config.value, dur), t) : config.value
  const base = await src.getFrame(t01, w, h)
  shaderFx.render(composePasses(cfg, id => catalog.value?.effects.find(e => e.id === id) ?? null, t, (def, layer) => texBundle(def, layer)), base, w, h)
  const c = shaderFx.outputCanvas!
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png', 0.95))
}

// Studio param-baker (Slice 2a Task 8c) — bakes ONE frame with a set of
// `params.*` overrides applied (a collection sweep/generate row), without
// disturbing the studio's live on-screen config: snapshot the current value
// of every overridden key via the same dotted-path proxy onEdit/promote use
// (`agentParams` — single-arg `makeConfigParams`, no layer scoping unlike
// Gradient, so no pinning is needed here), write the overrides through that
// same proxy (mutating the reactive `config` — identical to a user edit),
// render one full-res frame via the shared `renderBlob` capture path, then
// restore the snapshots in `finally` regardless of success/failure.
// `renderBlob` calls `shaderFx.render(...)` directly with `cfg` as an
// argument (not read off a watcher) and only awaits the `toBlob` callback —
// same as Gradient's `renderToBlob`, so no `nextTick`/rAF wait is needed
// between the override-write and the capture call.
async function renderBlobWithOverrides(overrides: Record<string, string | number>): Promise<Blob | null> {
  // Guard the shared shaderFx canvas the same way generateImage/generateVideo
  // do: a straggling async preview renderFrame bails right after its await if
  // baking.value is set, so it can't corrupt the bake this function performs
  // for a collection sweep. Set before the (synchronous) snapshot loop so no
  // window exists where a resumed preview frame could slip in.
  baking.value = true
  const keys = Object.keys(overrides)
  const snapshot = new Map<string, string | number | undefined>()
  for (const key of keys) snapshot.set(key, agentParams[key] as string | number | undefined)
  try {
    for (const key of keys) agentParams[key] = overrides[key]!
    return await renderBlob(0)
  } catch (e) {
    console.error('[shader-studio] param-baker render failed', e)
    return null
  } finally {
    for (const key of keys) {
      const prev = snapshot.get(key)
      if (prev !== undefined) agentParams[key] = prev
    }
    baking.value = false
  }
}

async function generateImage() {
  if (!resolved.value) { bakeMsg.value = 'Add a source first'; return }
  baking.value = true; bakeMsg.value = 'Rendering…'; stopPreview()
  try {
    const blob = await renderBlob(0)
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'shader_img')
    if (filename) {
      saveConfig()
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:shaderStudioOutput', { detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } } }))
      closeEditor()
    }
  } catch (e) { console.error('[shader-studio] image failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

async function generateVideo() {
  if (!resolved.value) { bakeMsg.value = 'Add a source first'; return }
  baking.value = true; stopPreview()
  try {
    const src = resolved.value!
    // Whoever supplies the frames owns the clock: an animated upstream (e.g. a
    // Gradient Studio loop) overrides our own duration/fps; a still source
    // leaves our own Motion controls in charge. See resolve.ts's exportClock.
    const clock = exportClock(src, config.value.motion.duration, config.value.motion.fps)
    const { w, h } = outputDims(src.width, src.height, config.value.resolution, { upscale: true })
    const total = Math.max(1, Math.round(clock.fps * clock.duration))
    const bakeCfg = { fps: clock.fps, loopDuration: clock.duration, W: w, H: h, seed: 'shader', sig: JSON.stringify(config.value) }
    const bake = await ensureSpaceTypeBake(bakeCfg as any, undefined, {
      // Normalized (i / total), not i / fps: renderBlob now takes 0..1 so the
      // last frame lands just before the loop point instead of duplicating
      // frame 0 — this is what keeps a seamless upstream loop closing on itself.
      renderFrame: async (i) => { bakeMsg.value = `Baking ${i + 1}/${total}`; return await renderBlob(i / total) },
    })
    bakeMsg.value = 'Encoding…'
    const res = await fetch('/sailor/spacetype_encode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frames: bake.frames, fps: clock.fps, width: w, height: h }) })
    const data = await res.json().catch(() => ({}))
    if (data.filename) {
      await recordAsset(activeTab.value?.projectUuid, 'video', data.filename)
      window.dispatchEvent(new CustomEvent('sailor:shaderStudioOutput', { detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: data.filename } } }))
      closeEditor()
    } else { bakeMsg.value = 'Encode failed — restart ComfyUI to load the encoder.'; console.error('[shader-studio] encode failed', data) }
  } catch (e) { console.error('[shader-studio] video failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

const RESOLUTIONS = [1024, 1536, 2048, 4096]

// Live readout of the baked output size (the preview is a fixed-size proxy, so
// this is the only place the resolution choice is visible before exporting).
const outputSizeLabel = computed(() => {
  const src = resolved.value
  if (!src) return null
  const { w, h } = outputDims(src.width, src.height, config.value.resolution, { upscale: true })
  return `${w} × ${h}`
})

// Derived export clock, shown beside the Motion duration/fps controls when a
// live upstream studio is driving the loop (those controls are disabled then —
// see the Motion section below and exportClock in resolve.ts).
const clockLabel = computed(() => {
  const src = resolved.value
  if (!src || src.duration <= 0) return null
  const frames = Math.max(1, Math.round(src.fps * src.duration))
  return `${src.duration.toFixed(1)}s · ${frames} frames — from upstream`
})

onMounted(async () => {
  loadConfig(); catalog.value = await fetchShaderFxCatalog().catch(() => null); startPreview()
  registerStudioParamBaker(props.nodeId, renderBlobWithOverrides)
})
onBeforeUnmount(() => { saveConfig(); stopPreview(); unregisterStudioParamBaker(props.nodeId) })

function setParam(uniform: string, value: number) { const e = activeEffectCfg.value; if (e) e.params = { ...e.params, [uniform]: value } }

// ── effect stack (aside StudioLayerStack) ───────────────────────────────────
function addEffect() {
  if (config.value.effects.length >= LAYER_MAX) return
  config.value.effects.push({ layerId: newLayerId(), id: '', params: {}, enabled: true, blend: 'normal', opacity: 1 })
  activeEffect.value = config.value.effects.length - 1
}
function removeEffect(i: number) {
  if (config.value.effects.length <= 1) return
  config.value.effects.splice(i, 1)
  remapEffectTracks('remove', i)
  activeEffect.value = Math.min(activeEffect.value, config.value.effects.length - 1)
}
function duplicateEffect(i: number) {
  if (config.value.effects.length >= LAYER_MAX) return
  const clone = { ...structuredClone(toRaw(config.value.effects[i]!)), layerId: newLayerId() }
  config.value.effects.splice(i + 1, 0, clone)
  remapEffectTracks('insert', i + 1)
  activeEffect.value = i + 1
}
function reorderEffect(from: number, to: number) {
  const [m] = config.value.effects.splice(from, 1)
  config.value.effects.splice(to, 0, m!)
  remapEffectTracks('move', from, to)
  activeEffect.value = to
}
function toggleEffect(i: number) { const e = config.value.effects[i]!; e.enabled = !e.enabled }

// Rewrites motion track `path`s of the form `effects.<idx>.params.<uniform>` to
// follow an effect through add/remove/reorder — mirrors gradientfx/motion.ts's
// `remapTracksOnReorder`/`dropTracksForLayer`, adapted to path-string addressing
// (shader tracks target an arbitrary dotted leaf, not just a layer's shape param).
const EFFECT_PATH_RE = /^effects\.(\d+)\.params\.(.+)$/
function remapEffectTracks(kind: 'move' | 'insert' | 'remove', a: number, b?: number): void {
  const rewrite = (idx: number, rest: string) => `effects.${idx}.params.${rest}`
  if (kind === 'remove') {
    config.value.motion.tracks = config.value.motion.tracks
      .filter((t) => { const m = EFFECT_PATH_RE.exec(t.path); return !m || Number(m[1]) !== a })
      .map((t) => {
        const m = EFFECT_PATH_RE.exec(t.path)
        if (!m) return t
        const idx = Number(m[1])
        return idx > a ? { ...t, path: rewrite(idx - 1, m[2]!) } : t
      })
    return
  }
  if (kind === 'insert') {
    for (const t of config.value.motion.tracks) {
      const m = EFFECT_PATH_RE.exec(t.path)
      if (!m) continue
      const idx = Number(m[1])
      if (idx >= a) t.path = rewrite(idx + 1, m[2]!)
    }
    return
  }
  // move: same swap math as gradientfx/motion.ts's remapTracksOnReorder.
  const from = a, to = b!
  const move = (l: number): number => {
    if (l === from) return to
    if (from < to && l > from && l <= to) return l - 1
    if (from > to && l >= to && l < from) return l + 1
    return l
  }
  for (const t of config.value.motion.tracks) {
    const m = EFFECT_PATH_RE.exec(t.path)
    if (!m) continue
    const idx = Number(m[1])
    const ni = move(idx)
    if (ni !== idx) t.path = rewrite(ni, m[2]!)
  }
}
</script>

<template>
  <StudioModalShell
    title="Shader studio" :breadcrumb="effectDef?.name"
    :agent="shaderAgent"
    agent-placeholder="Describe the look — e.g. punchier, warmer, more glow…"
    @close="closeEditor"
  >
    <template #aside>
      <StudioLayerStack
        :layers="config.effects.map((e, i) => ({ label: effectLabel(e), enabled: e.enabled }))"
        :active-index="activeEffect" :max="LAYER_MAX"
        @select="activeEffect = $event"
        @add="addEffect" @remove="removeEffect" @duplicate="duplicateEffect"
        @reorder="reorderEffect" @toggle="toggleEffect" />
    </template>

    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg shadow-2xl" />
        <!-- Focus point overlay when lens blur is on -->
        <div v-if="config.post.blur.enabled"
          class="nopan nodrag absolute size-3 -ml-1.5 -mt-1.5 cursor-move rounded-full border-2 border-white bg-black/30"
          :style="{ left: `${config.post.blur.focusX * 100}%`, top: `${config.post.blur.focusY * 100}%` }"
          @pointerdown="onFocusDown" @pointermove="onFocusMove" @pointerup="onFocusUp" />
        <span v-if="!resolved" class="absolute text-xs text-white/40">Add a source image to begin</span>
      </div>
    </template>

    <template #actions>
      <StudioButton variant="primary" :disabled="baking" @click="generateImage">{{ baking ? (bakeMsg || 'Working…') : 'Generate as image' }}</StudioButton>
      <StudioButton variant="secondary" :disabled="baking" @click="generateVideo">{{ baking ? (bakeMsg || 'Working…') : 'Generate as video' }}</StudioButton>
      <span v-if="glError" class="ml-2 truncate text-xs text-red-300/80">{{ glError }}</span>
    </template>

    <template #controls>
      <!-- Source -->
      <StudioSection title="Source">
        <p v-if="wiredUrl" class="mb-2 text-[11px] text-white/50">Using wired input</p>
        <label class="mb-1 block cursor-pointer rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-center text-[11px] text-white/80 hover:bg-white/20">
          Upload image<input type="file" accept="image/*" class="hidden" @change="onUpload" />
        </label>
      </StudioSection>

      <!-- Stylized Effects -->
      <StudioSection title="Stylized Effects">
        <template #badge><StudioSwitch v-model="activeEffectCfg.enabled" /></template>
        <button class="mb-2 flex w-full items-center gap-2 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left hover:bg-white/[0.08]" @click="openPicker">
          <span class="size-5 overflow-hidden rounded bg-white/[0.06]"><img v-if="currentThumb" :src="currentThumb" class="h-full w-full object-cover" /></span>
          <span class="min-w-0 flex-1 truncate text-[11px] text-white/90">{{ effectDef?.name ?? 'Pick an effect' }}</span>
          <ChevronRight class="size-3.5 shrink-0 text-white/30" />
        </button>
        <div v-for="p in effectDef?.params ?? []" :key="p.uniform">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60">
            <span>{{ p.label }}</span>
            <span v-if="p.type !== 'enum'" class="text-white/40">{{ (effectUniforms[p.uniform] ?? 0).toFixed(2) }}</span>
          </label>
          <select
            v-if="p.type === 'enum'"
            class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs"
            :value="effectUniforms[p.uniform]"
            @change="setParam(p.uniform, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="o in p.options" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <input
            v-else type="range" v-studio-reset class="studio-range mb-2 w-full" :min="p.min" :max="p.max" :step="p.step"
            :value="effectUniforms[p.uniform]" @input="setParam(p.uniform, Number(($event.target as HTMLInputElement).value))"
          />
          <div v-if="effectDef?.id === 'ascii_dither' && p.uniform === 'u_shape' && Math.round(effectUniforms[p.uniform] ?? 0) === 14" class="mb-2">
            <label class="mb-0.5 block text-[11px] text-white/40">Characters (sorted by density)</label>
            <input
              v-model="activeEffectCfg.customChars" type="text" spellcheck="false" placeholder=" .:-=+*#%@"
              class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-xs tracking-wider"
            />
          </div>
        </div>
        <!-- Blend/opacity for the active non-base effect — effect 0 is the base
             layer (chains straight from the source), matching the gradient studio. -->
        <template v-if="activeEffect > 0">
          <label class="mb-0.5 block text-[11px] text-white/60">Blend</label>
          <select v-model="activeEffectCfg.blend" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs capitalize">
            <option v-for="b in BLEND_MODES" :key="b" :value="b">{{ b }}</option>
          </select>
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60">
            <span>Opacity</span><span class="text-white/40">{{ activeEffectCfg.opacity.toFixed(2) }}</span>
          </label>
          <input v-model.number="activeEffectCfg.opacity" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
        </template>
      </StudioSection>

      <!-- Duotone -->
      <StudioSection title="Duotone" :open="false">
        <template #badge><StudioSwitch v-model="config.duotone.enabled" /></template>
        <div class="mb-2 flex items-center gap-2">
          <label class="text-[11px] text-white/60">Ink</label>
          <BindableRow control-key="duotone.ink" label="Ink" kind="color" :bound="boundColumnFor('duotone.ink')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <StudioColor v-model="config.duotone.ink" @update:model-value="(v: string) => onEdit('duotone.ink', v)" />
          </BindableRow>
          <label class="text-[11px] text-white/60">Paper</label>
          <BindableRow control-key="duotone.paper" label="Paper" kind="color" :bound="boundColumnFor('duotone.paper')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <StudioColor v-model="config.duotone.paper" @update:model-value="(v: string) => onEdit('duotone.paper', v)" />
          </BindableRow>
        </div>
        <PalettePicker mode="duotone" :seed="config.duotone.paper" @apply-duotone="applyDuotonePalette" />
      </StudioSection>

      <!-- Gradient Map -->
      <StudioSection title="Gradient Map" :open="false">
        <template #badge><StudioSwitch v-model="config.gradientMap.enabled" /></template>
        <div class="mb-2 h-6 overflow-hidden rounded border border-white/10" :style="{ background: gradientMapRampCss }" />
        <PalettePicker mode="stops" :stop-count="config.gradientMap.stops.length" :seed="config.gradientMap.stops[0]?.color ?? '#4f8ad9'" @apply-stops="applyGradientStops" />
        <div class="mt-3">
          <label class="mb-1 block text-[11px] text-white/60">Mix</label>
          <input
            v-model.number="config.gradientMap.mix" type="range" min="0" max="1" step="0.01"
            v-studio-reset class="studio-range w-full" @input="onEdit('gradientMap.mix', config.gradientMap.mix)"
          />
        </div>
      </StudioSection>

      <!-- Adjustments -->
      <StudioSection title="Adjustments" :open="false">
        <template #badge><StudioSwitch v-model="config.adjust.enabled" /></template>
        <select class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs" @change="pickAdjustPreset(($event.target as HTMLSelectElement).value)">
          <option v-for="p in ADJUST_PRESETS" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
        <template v-for="f in ([['exposure','Exposure',-2,2],['brightness','Brightness',-1,1],['contrast','Contrast',-1,1],['saturation','Saturation',-1,1],['hue','Hue',-180,180],['temperature','Temperature',-1,1],['tint','Tint',-1,1]] as const)" :key="f[0]">
          <BindableRow :control-key="`adjust.${f[0]}`" :label="f[1]" kind="slider" :min="f[2]" :max="f[3]" :step="0.01" :bound="boundColumnFor(`adjust.${f[0]}`)" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>{{ f[1] }}</span><span class="text-white/40">{{ (config.adjust as any)[f[0]].toFixed(2) }}</span></label>
            <input v-model.number="(config.adjust as any)[f[0]]" type="range" :min="f[2]" :max="f[3]" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit(`adjust.${f[0]}`, (config.adjust as any)[f[0]])" />
          </BindableRow>
        </template>
      </StudioSection>

      <!-- Post-processing -->
      <StudioSection title="Post-processing" :open="false">
        <div class="mb-1 flex items-center justify-between"><span class="text-xs text-white/70">Lens Blur</span><StudioSwitch v-model="config.post.blur.enabled" /></div>
        <template v-if="config.post.blur.enabled">
          <BindableRow control-key="post.blur.range" label="Focus range" kind="slider" :min="0" :max="1" :step="0.01" :bound="boundColumnFor('post.blur.range')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Focus range</span><span class="text-white/40">{{ config.post.blur.range.toFixed(2) }}</span></label>
            <input v-model.number="config.post.blur.range" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('post.blur.range', config.post.blur.range)" />
          </BindableRow>
          <BindableRow control-key="post.blur.aperture" label="Aperture" kind="slider" :min="0" :max="1" :step="0.01" :bound="boundColumnFor('post.blur.aperture')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Aperture</span><span class="text-white/40">{{ config.post.blur.aperture.toFixed(2) }}</span></label>
            <input v-model.number="config.post.blur.aperture" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('post.blur.aperture', config.post.blur.aperture)" />
          </BindableRow>
          <BindableRow control-key="post.blur.maxBlur" label="Max blur" kind="slider" :min="0" :max="40" :step="1" :bound="boundColumnFor('post.blur.maxBlur')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Max blur</span><span class="text-white/40">{{ config.post.blur.maxBlur.toFixed(0) }}</span></label>
            <input v-model.number="config.post.blur.maxBlur" type="range" min="0" max="40" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('post.blur.maxBlur', config.post.blur.maxBlur)" />
          </BindableRow>
        </template>
        <div class="mb-1 mt-2 flex items-center justify-between"><span class="text-xs text-white/70">Chromatic</span><StudioSwitch v-model="config.post.chromatic.enabled" /></div>
        <template v-if="config.post.chromatic.enabled">
          <BindableRow control-key="post.chromatic.amount" label="Chromatic amount" kind="slider" :min="0" :max="1" :step="0.01" :bound="boundColumnFor('post.chromatic.amount')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Amount</span><span class="text-white/40">{{ config.post.chromatic.amount.toFixed(2) }}</span></label>
            <input v-model.number="config.post.chromatic.amount" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range w-full" @input="onEdit('post.chromatic.amount', config.post.chromatic.amount)" />
          </BindableRow>
        </template>

        <div class="mb-1 mt-2 flex items-center justify-between"><span class="text-xs text-white/70">Bloom</span><StudioSwitch v-model="config.post.bloom.enabled" /></div>
        <template v-if="config.post.bloom.enabled">
          <BindableRow control-key="post.bloom.threshold" label="Bloom threshold" kind="slider" :min="0" :max="1" :step="0.01" :bound="boundColumnFor('post.bloom.threshold')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Threshold</span><span class="text-white/40">{{ config.post.bloom.threshold.toFixed(2) }}</span></label>
            <input v-model.number="config.post.bloom.threshold" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('post.bloom.threshold', config.post.bloom.threshold)" />
          </BindableRow>
          <BindableRow control-key="post.bloom.intensity" label="Bloom intensity" kind="slider" :min="0" :max="3" :step="0.01" :bound="boundColumnFor('post.bloom.intensity')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Intensity</span><span class="text-white/40">{{ config.post.bloom.intensity.toFixed(2) }}</span></label>
            <input v-model.number="config.post.bloom.intensity" type="range" min="0" max="3" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onEdit('post.bloom.intensity', config.post.bloom.intensity)" />
          </BindableRow>
          <BindableRow control-key="post.bloom.radius" label="Bloom radius" kind="slider" :min="4" :max="200" :step="2" :bound="boundColumnFor('post.bloom.radius')" @menu="openVarMenu" @promote="(control) => promote(control, agentParams[control.key] as string | number)">
            <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Radius</span><span class="text-white/40">{{ config.post.bloom.radius.toFixed(0) }}</span></label>
            <input v-model.number="config.post.bloom.radius" type="range" min="4" max="200" step="2" v-studio-reset class="studio-range w-full" @input="onEdit('post.bloom.radius', config.post.bloom.radius)" />
          </BindableRow>
        </template>
      </StudioSection>

      <!-- Output -->
      <StudioSection title="Output" :open="false">
        <label class="mb-1 block text-xs text-white/60">Resolution (long edge)</label>
        <select v-model.number="config.resolution" class="mb-1 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs">
          <option v-for="r in RESOLUTIONS" :key="r" :value="r">{{ r }}px</option>
        </select>
        <p v-if="outputSizeLabel" class="text-[11px] text-white/40">Output: {{ outputSizeLabel }}px</p>
      </StudioSection>

      <StudioSection title="Motion" :open="false">
        <template #badge><button class="flex items-center gap-1 normal-case text-white/40 hover:text-white" @click.stop="addTrack"><Plus class="h-3 w-3" /> Track</button></template>
        <p v-if="clockLabel" class="mb-2 text-[11px] text-white/40">{{ clockLabel }}</p>
        <p v-if="!config.motion.tracks.length" class="text-[11px] text-white/30">Add a track to animate a parameter and export video.</p>
        <div v-for="(tk, i) in config.motion.tracks" :key="i" class="mb-2 rounded border border-white/10 p-2">
          <div class="mb-1 flex items-center gap-1">
            <select v-model="tk.path" class="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]"><option v-for="a in animatablePaths" :key="a.path" :value="a.path">{{ a.label }}</option></select>
            <button class="text-white/30 hover:text-white/70" @click="removeTrack(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <div class="flex items-center gap-1 text-[11px] text-white/50">
            <span>from</span><input v-model.number="tk.from" type="number" step="0.05" class="w-14 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5" />
            <span>to</span><input v-model.number="tk.to" type="number" step="0.05" class="w-14 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5" />
            <select v-model="tk.easing" class="rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5"><option value="linear">Linear</option><option value="pingpong">Ping-pong</option><option value="easeinout">Ease</option></select>
          </div>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <div><label class="mb-1 flex justify-between text-[11px] text-white/60"><span>Duration</span><span class="text-white/40">{{ config.motion.duration }}s</span></label><input v-studio-reset v-model.number="config.motion.duration" type="range" min="1" max="12" step="0.5" class="studio-range w-full disabled:cursor-not-allowed disabled:opacity-40" :disabled="sourceAnimated" /></div>
          <div><label class="mb-1 block text-[11px] text-white/60">FPS</label><select v-model.number="config.motion.fps" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-40" :disabled="sourceAnimated"><option :value="24">24</option><option :value="30">30</option><option :value="60">60</option></select></div>
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>

  <CatalogModal :open="pickerOpen" title="Shader Effects" subtitle="Pick an effect to apply"
    :items="pickerItems" :selected-id="activeEffectCfg.id" :filters="pickerFilters" :active-filter-id="pickerFilter" :search-query="pickerSearch"
    :sections="SHADER_SECTIONS" :section-of="(e: any) => e.category"
    search-placeholder="Search effects…" confirm-label="Use effect" empty-message="No effects match your search."
    @close="pickerOpen = false" @confirm="pickEffect(($event as EffectDef).id)" @update:active-filter-id="pickerFilter = $event" @update:search-query="pickerSearch = $event">
    <template #card="{ item }">
      <div class="aspect-video overflow-hidden bg-black/20"><img v-if="thumbs[(item as EffectDef).id]" :src="thumbs[(item as EffectDef).id]" class="h-full w-full object-cover" /></div>
      <div class="px-2 py-1.5"><div class="truncate text-[11px] text-white/85">{{ (item as EffectDef).name }}</div><div class="text-[10px] capitalize text-white/35">{{ (item as EffectDef).category }}</div></div>
    </template>
  </CatalogModal>
  <CanvasContextMenu
    v-if="varMenu"
    :x="varMenu.x"
    :y="varMenu.y"
    :items="varMenu.items"
    @close="varMenu = null"
  />
  <SweepPopover
    v-if="sweepPopover"
    :control="sweepPopover.control"
    :anchor="sweepPopover.anchor"
    @apply="applySweep"
    @close="sweepPopover = null"
  />
</template>
