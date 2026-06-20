<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { buildRibbonLabel } from '~/lib/spacetype/effects/ribbon'
import { SPACE_TYPE_EFFECTS, getEffect } from '~/lib/spacetype/effects'
import { ensureBoostFont } from '~/lib/spacetype/effects/boost'
import { defaultsFromControls, type Params } from '~/lib/spacetype/effect'
import { SPACE_TYPE_SECTIONS } from '~/lib/spacetype/sections'
import { parseFills, serializeFills, FILL_TYPES, type Fill, type FillType } from '~/lib/spacetype/fills'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { loadGoogleCatalog, googleFontCssUrl, googleAxisList, resolveFontFamily, fontHasWeightAxis, type GoogleFont } from '~/data/google-fonts'
import type { GradientStop } from '~/lib/spacetype/gradient'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'
import StudioSegmented from '~/components/vue-canvas/studio/StudioSegmented.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StringPathEditor from '~/components/vue-canvas/StringPathEditor.vue'

const props = defineProps<{ nodeId: string; nodes: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills/videos as the current project's assets (Assets panel).
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

// Locate this node + its saved config blob on the canvas. The config lives at
// node.data.properties.comfynext_spaceType so it survives serialization
// (convertToLiteGraph stashes `properties`), letting the editor be reopened.
function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

const fps = ref(30)
const FPS_OPTIONS = ['24', '30', '60']
const DIMS: Record<string, [number, number]> = {
  '1920 × 1080 (16:9)': [1920, 1080],
  '1080 × 1920 (9:16)': [1080, 1920],
  '1080 × 1080 (1:1)': [1080, 1080],
  '1280 × 720 (16:9)': [1280, 720],
  '960 × 540 (16:9)': [960, 540],
}
const CUSTOM = 'Custom'
const dimsKey = ref('960 × 540 (16:9)')
const W = ref(960)
const H = ref(540)
// Editing W/H directly switches to Custom; clamp to an encodable range (even, 16–4096).
function onCustomDims() {
  const clamp = (v: number) => Math.max(16, Math.min(4096, Math.round((Number(v) || 16) / 2) * 2))
  W.value = clamp(W.value)
  H.value = clamp(H.value)
  dimsKey.value = CUSTOM
  engine?.setSize(W.value, H.value)
}
const effectId = ref('ribbon')
const effect = computed(() => getEffect(effectId.value))
const params = reactive<Params>(defaultsFromControls(effect.value.controls))
const loopDuration = ref(6)
const transparent = ref(false)
const bgColor = ref('#0e0e10')
const projection = ref<'perspective' | 'isometric'>('perspective')
// Off-centre framing (−1…1 = half a frame each way). View-level like projection, so it lives
// outside the per-effect `params` (which gets wiped on effect switch).
const panX = ref(0)
const panY = ref(0)

// Multi-text rows: the `textList` control edits these; they're stored back into
// params.text as a newline-separated string (so ParamValue stays scalar). Editing a
// local reactive array keeps input focus/caret stable (vs re-deriving from a string).
const textLines = reactive<string[]>([''])
let syncingText = false
function pullTextLines() {
  syncingText = true
  const raw = String(params.text ?? '')
  const parts = raw.length ? raw.split('\n') : ['']
  textLines.splice(0, textLines.length, ...(parts.length ? parts : ['']))
  syncingText = false
}
watch(textLines, () => {
  if (syncingText) return
  ;(params as Record<string, unknown>).text = textLines.join('\n')
}, { deep: true })
function addTextRow() { textLines.push('') }
function removeTextRow(i: number) { textLines.splice(i, 1); if (!textLines.length) textLines.push('') }

// Fill rows for a `fillList` control (per-slot solid/gradient/grid/noise). Mirrors textLines:
// edit a local reactive array, sync back into the (scalar) param as a JSON string. `fillKey`
// is the control's key (effects have at most one fillList). FILL_TYPES is imported from fills.ts
// (single source of truth — keeps the dropdown in sync with the renderable types).
const fills = reactive<Fill[]>([])
let syncingFills = false
function fillKey(): string | null {
  return effect.value.controls.find(c => c.kind === 'fillList')?.key ?? null
}
function pullFills() {
  const k = fillKey()
  if (!k) return
  syncingFills = true
  const parsed = parseFills((params as Record<string, unknown>)[k])
  fills.splice(0, fills.length, ...parsed.map(f => ({ ...f })))
  syncingFills = false
}
watch(fills, () => {
  if (syncingFills) return
  const k = fillKey(); if (!k) return
  ;(params as Record<string, unknown>)[k] = serializeFills(fills)
}, { deep: true })
function addFill() { fills.push({ type: 'solid', a: '#ffffff', b: '#000000', textColor: '#ffffff', angle: 45, density: 8 }) }
function removeFill(i: number) { fills.splice(i, 1); if (!fills.length) addFill() }
// Second colour only matters for textured fills; the dropdown reveals it.
function fillNeedsB(f: Fill): boolean { return f.type !== 'solid' }

const canvas = ref<HTMLCanvasElement | null>(null)
let engine: SpaceTypeEngine | null = null
let raf = 0
let previewFrame = 0
let previewStart = 0
const baking = ref(false)

// Collapsible control sections. Effect controls declare their `group`; surface-only
// controls (gradient stops, loop, dimensions, transparent) are injected per section.
const SECTION_ORDER = SPACE_TYPE_SECTIONS
const openSections = reactive<Record<string, boolean>>({
  Path: true, Type: true, Stack: true, Occlusion: true, Look: true, Blend: true, Style: true, Layout: false, Stretch: true, Skew: false, Warp: false, Ribbon: true, Spiral: true, Layers: true, Color: true, Glitch: true, Doodles: false, Shadow: false, Wave: false, Motion: false, Transform: false, Output: false,
})
const sections = computed(() =>
  SECTION_ORDER.map(name => ({ name, controls: effect.value.controls.filter(c => (c.group ?? 'Other') === name) })),
)

const gradientStops = reactive<GradientStop[]>([
  { color: '#3b5bff', on: true },
  { color: '#ff3b3b', on: true },
  { color: '#ffd23b', on: true },
  { color: '#ffffff', on: false },
])

// Full Google Fonts catalog (~1900 families), fetched once via the shared proxy and
// used to populate the searchable font picker + decide weight-axis availability.
const fontCatalog = ref<GoogleFont[]>([])
loadGoogleCatalog().then((c) => { fontCatalog.value = c })

// Custom searchable font dropdown (a native <select> can't show 1900 options nicely,
// and a datalist has no visible affordance). Open/close + live filter, capped for perf.
const fontPickerOpen = ref(false)
const fontSearch = ref('')
const variableOnly = ref(false)
// A font is variable when it has a registered axis with an actual range (max > min).
const isVar = (f: GoogleFont) => f.axes.some(a => a.max > a.min)
const varAxes = (f: GoogleFont) => f.axes.filter(a => a.max > a.min).map(a => a.tag).join(' ')
const filteredFonts = computed(() => {
  const q = fontSearch.value.trim().toLowerCase()
  let list = fontCatalog.value
  if (variableOnly.value) list = list.filter(isVar)
  const matched = q ? list.filter(f => f.family.toLowerCase().includes(q)) : list
  return matched.slice(0, 120)
})
function selectFont(key: string, family: string) {
  ;(params as Record<string, unknown>)[key] = family
  fontPickerOpen.value = false
  fontSearch.value = ''
}

// ✨ Describe-a-font search: type a description ("fonts like the Knicks logo"),
// an LLM suggests real Google families (grounded against fontCatalog), shown atop
// the literal list. Faces are loaded so each suggestion row previews in-face.
const { suggestions: fontSuggestions, loading: fontSuggestLoading, error: fontSuggestError, hasRun: fontSuggestRan, suggest: runFontSuggestApi, clear: clearFontSuggest } = useFontSuggest()
const { ensure: ensureFontFace } = useGoogleFontPreview()
function runFontSuggest() { runFontSuggestApi(fontSearch.value) }
watch(fontSuggestions, (list) => { for (const s of list) ensureFontFace(s.family) })
watch(fontSearch, () => { if (fontSuggestRan.value) clearFontSuggest() })
// Reset suggestions whenever the picker closes so a stale list doesn't reappear.
watch(fontPickerOpen, (open) => { if (!open && fontSuggestRan.value) clearFontSuggest() })
// Whether the currently-selected font has a continuous Weight axis (variable font).
// Drives the Type-weight slider's visibility (hidden for static families).
const fontIsVariable = computed(() => {
  void fontCatalog.value // re-evaluate once the catalog resolves
  return fontHasWeightAxis(resolveFontFamily(String(params.font)))
})

// Variable-font axes BEYOND weight (width / slant / optical-size / custom). Weight stays on
// the Type-weight slider; these are surfaced dynamically for the selected font and fed into
// the render via font-variation-settings (texOpts.axes → makeTextTexture / charLayout).
const fontAxes = reactive<Record<string, number>>({})
const varAxisList = computed(() => {
  void fontCatalog.value
  const f = fontCatalog.value.find(g => g.family === resolveFontFamily(String(params.font)))
  return f ? googleAxisList(f).filter(a => a.tag !== 'wght') : []
})
function syncFontAxes() {
  const keep = new Set(varAxisList.value.map(a => a.tag))
  for (const k of Object.keys(fontAxes)) if (!keep.has(k)) delete fontAxes[k]
  for (const a of varAxisList.value) if (!(a.tag in fontAxes)) fontAxes[a.tag] = a.default
}
watch(() => String(params.font), syncFontAxes)
watch(fontCatalog, syncFontAxes)
watch(fontAxes, () => rebuild(), { deep: true })

const loadedFontFamilies = new Set<string>()
async function ensureFont(value: string) {
  const family = resolveFontFamily(value)
  if (!loadedFontFamilies.has(family)) {
    const key = family.replace(/[^a-zA-Z0-9]/g, '_')
    if (!document.querySelector(`link[data-stg-font="${key}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = googleFontCssUrl(family); link.setAttribute('data-stg-font', key)
      document.head.appendChild(link)
    }
    loadedFontFamilies.add(family)
  }
  try { await document.fonts.load(`700 32px "${family}"`) } catch { /* best-effort */ }
}

// Boost needs the font's vector OUTLINE (via fontkit), not just the CSS face. Preload it
// before rebuild so buildScene has the glyph shapes; never throws (falls back internally).
async function ensureEffectFonts() {
  await ensureFont(String(params.font))
  if (effectId.value === 'boost') { try { await ensureBoostFont(String(params.font)) } catch { /* fallback */ } }
}

function texOpts() {
  const family = resolveFontFamily(String(params.font))
  // Static families have no weight axis — pin to 400 so we don't faux-bold a single cut.
  const weight = fontHasWeightAxis(family) ? Number(params.typeWeight ?? 700) : 400
  // Multiple texts (one per line) → an N-row atlas the effect alternates between.
  // Only effects that DECLARE a `textList` control are multi-text-aware; others collapse
  // to the first text so an unwired effect never renders a stacked atlas by mistake.
  const multiAware = effect.value.controls.some(c => c.kind === 'textList')
  const rawTexts = String(params.text ?? '').split('\n').map(t => t.trim()).filter(Boolean)
  const texts = rawTexts.length ? rawTexts : ['']
  // Coil/elastic/echo size to their own text (no tiling), so they take the RAW uppercased
  // word with NO trailing-gap pad — otherwise the gap is dead space that throws off centering.
  // Tiling effects (ribbon/stripes/field) keep buildRibbonLabel's trailing gap so repeated
  // text has space between copies.
  const rawWords = effectId.value === 'coil' || effectId.value === 'elastic' || effectId.value === 'echo'
  const labels = multiAware
    ? texts.map(t => (rawWords ? t.toUpperCase() : buildRibbonLabel(t, 'upper')))
    : [rawWords ? (texts[0] ?? '').toUpperCase() : buildRibbonLabel(texts[0] ?? '', 'upper')]
  return {
    label: labels[0]!,
    labels,
    fontFamily: family,
    // STG-style names (typeWeight/typeYScale/typeXScale) with fallbacks so effects
    // that still use typeHeight keep working unchanged.
    fontWeight: weight,
    axes: { wght: weight, ...fontAxes },
    typeColor: String(params.typeColor),
    fontSizePx: Number(params.typeYScale ?? params.typeHeight ?? 180),
    scaleX: Number(params.typeXScale ?? 1),
    tracking: Number(params.tracking),
    strokeColor: '#000000',
    strokeWidth: Number(params.typeStroke),
    gradientStops: gradientStops.map(s => ({ ...s })),
    gradientOn: String(params.gradientMode) === 'on',
    uRepeat: Number(params.textRepeat),
  }
}

function rebuild() {
  previewFrame = 0
  engine?.build(params, texOpts())
}

function startPreview() {
  // Drive the preview by REAL elapsed time at the intended FPS, not one frame
  // per repaint — otherwise playback runs at the display refresh rate (~2x on
  // 60Hz, ~4x on 120Hz) and faster than the baked export. The rAF timestamp
  // keeps it frame-rate independent and matched to what export produces.
  previewStart = 0
  const tick = (ts: number) => {
    if (!previewStart) previewStart = ts
    const total = Math.max(1, Math.round(fps.value * loopDuration.value))
    previewFrame = Math.floor(((ts - previewStart) / 1000) * fps.value) % total
    engine?.renderFrame(previewFrame, params)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

function stopPreview() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

// Hydrate local editor state from a previously-saved config blob, so reopening
// the editor on an existing node restores exactly what the user last authored.
function loadConfig() {
  const n = currentNode()
  const c = n?.data?.properties?.comfynext_spaceType
  if (!c) return // first edit of a fresh node — keep the defaults.
  // Restore effectId BEFORE params so the engine builds with the right effect
  // and the control panel (sections) reflects the saved effect's controls.
  if (typeof c.effectId === 'string') effectId.value = c.effectId
  if (c.params && typeof c.params === 'object') Object.assign(params, c.params)
  if (Array.isArray(c.gradientStops)) {
    gradientStops.splice(0, gradientStops.length, ...c.gradientStops.map((s: any) => ({ ...s })))
  }
  if (typeof c.fps === 'number') fps.value = c.fps
  if (typeof c.loopDuration === 'number') loopDuration.value = c.loopDuration
  if (typeof c.transparent === 'boolean') transparent.value = c.transparent
  if (typeof c.bgColor === 'string') bgColor.value = c.bgColor
  if (c.projection === 'perspective' || c.projection === 'isometric') projection.value = c.projection
  if (typeof c.panX === 'number') panX.value = c.panX
  if (typeof c.panY === 'number') panY.value = c.panY
  if (typeof c.dimsKey === 'string') {
    dimsKey.value = c.dimsKey
    const d = DIMS[c.dimsKey]
    if (d) { W.value = d[0]; H.value = d[1] }
  }
  // Explicit W/H override the preset (restores Custom dimensions).
  if (typeof c.W === 'number' && typeof c.H === 'number') { W.value = c.W; H.value = c.H }
}

// Persist the full current editor state back onto the node's properties so the
// config survives tab switches / reloads and the editor can be reopened to edit.
function saveConfig() {
  const n = currentNode(); if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  const prev = n.data.properties.comfynext_spaceType || {}
  n.data.properties.comfynext_spaceType = {
    ...prev,
    effectId: effectId.value,
    params: { ...params },
    gradientStops: gradientStops.map(s => ({ ...s })),
    fps: fps.value, loopDuration: loopDuration.value,
    dimsKey: dimsKey.value, W: W.value, H: H.value, transparent: transparent.value, bgColor: bgColor.value,
    projection: projection.value,
    panX: panX.value, panY: panY.value,
  }
}

function closeEditor() { saveConfig(); emit('close') }

onMounted(async () => {
  if (!canvas.value) return
  // Restore saved config BEFORE building the engine so the first render is
  // already the user's authored state (not the defaults).
  loadConfig()
  pullTextLines()
  pullFills()
  engine = new SpaceTypeEngine(canvas.value, {
    effect: effect.value, width: W.value, height: H.value, fps: fps.value, loopDuration: loopDuration.value,
    alpha: transparent.value, bgColor: bgColor.value, projection: projection.value,
    panX: panX.value, panY: panY.value,
  })
  await ensureEffectFonts()
  rebuild()
  startPreview()
})

onBeforeUnmount(() => { saveConfig(); stopPreview(); engine?.dispose(); engine = null })

// Most v2 params change geometry/material/texture and need a rebuild; the params
// below are live (read per-frame in update()) so we zero them out of the structural
// signature to avoid a rebuild on every drag. ribbon* and cylinder wave/tweak params
// are all live; the cylinder reads its wave uniforms each frame.
watch(
  () => JSON.stringify({
    ...params,
    speed: 0, scale: 0, rotateX: 0, rotateY: 0, rotateZ: 0,
    // string: scroll variation read live in update()
    speedVary: 0,
    ribbonRotateX: 0, ribbonRotateY: 0, ribbonRotateZ: 0,
    // cylinder live params (vertex-wave deformation + per-cylinder rotation + motion)
    waveSpeed: 0, waveCount: 0, waveLatitude: 0, waveLongitude: 0, waveRipple: 0,
    waveRotate: 0, waveXScale: 0, waveYScale: 0, tweakX: 0, tweakY: 0, tweakZ: 0,
    cylRotate: 0, cylOffset: 0, spinSpeed: 0, spinRingOffset: 0, spinAlternate: 0,
    // field live params (wave uniforms updated per-frame)
    ampZ: 0, ampX: 0, ampY: 0, waveSizeX: 0, waveSizeY: 0,
    zOffset: 0, xOffset: 0, yOffset: 0,
    // cascade live params (read per-frame in update)
    rowHeight: 0, fontHeight: 0, waveLength: 0,
    // boost live params (read per-frame in update)
    depth: 0, tumble: 0, holdFraction: 0, extrudeMode: 0, punchDistance: 0, cubeFlip: 0, cubeAlternate: 0,
    // echo live param (drift advances per-frame in update)
    driftSpeed: 0,
    // tunnel + contour live params (tunnel transform / text flow / stroke / depth read per-frame)
    rotate: 0, innerWidth: 0, innerHeight: 0, view: '', direction: '',
    flowSpeed: 0, flowDir: '', strokeWidth: 0, strokeColor: '',
    perspective: 0, depth: 0, shadow: 0,
  }) + JSON.stringify(gradientStops),
  async () => { await ensureEffectFonts(); rebuild() },
)
// Switching effect: reset params to the new effect's defaults, but carry over any
// param values the two effects share (text/font/typeColor/etc.) so they persist
// across the switch. Then point the engine at the new effect and rebuild.
// Only CONTENT carries across an effect switch (the text + font you're working on). Everything
// else — geometry, fills, colours, AND framing (scale/rotation) — resets to the NEW effect's own
// defaults: those are tuned per effect, so carrying e.g. another effect's rotation flattens the
// new one edge-on (Ribbon wants its −0.5 tilt; Coil sits at 0).
const CARRY_ON_SWITCH = new Set(['text', 'font'])
watch(effectId, async () => {
  const next = defaultsFromControls(effect.value.controls)
  for (const k of Object.keys(next)) if (CARRY_ON_SWITCH.has(k) && k in params) next[k] = (params as any)[k]
  for (const k of Object.keys(params)) delete (params as any)[k]
  Object.assign(params, next)
  pullTextLines()
  pullFills()
  await ensureEffectFonts()
  engine?.setEffect(effect.value)
  rebuild()
})
// Transparency + background apply live via render-time clear settings (no renderer rebuild).
watch([transparent, bgColor], () => engine?.setBackground(transparent.value, bgColor.value))
// Projection (perspective ↔ isometric) applies live; also re-render the held preview frame.
watch(projection, (p) => { engine?.setProjection(p); engine?.renderFrame(previewFrame, params) })
// Pan re-frames live (no rebuild) — read by the engine per frame as a camera view-offset.
watch([panX, panY], () => { engine?.setPan(panX.value, panY.value); engine?.renderFrame(previewFrame, params) })
// Loop length affects the engine's frameCount used during bake.
watch(loopDuration, d => engine?.setLoopDuration(d))
// fps affects the engine's frameCount used during bake/preview.
watch(fps, f => engine?.setFps(f))
watch(dimsKey, (k) => {
  const d = DIMS[k]
  if (!d) return
  W.value = d[0]
  H.value = d[1]
  engine?.setSize(W.value, H.value)
})

// The String effect is flat + front-locked: force the orthographic (front-on) camera
// and zero pan so the drawn path maps 1:1 to what's rendered. The Projection/Pan UI is
// hidden for it. Immediate so the very first build (and reopened nodes) lock correctly.
const frontLocked = computed(() => effectId.value === 'string')
watch(frontLocked, (fl) => {
  if (fl) { projection.value = 'isometric'; panX.value = 0; panY.value = 0 }
}, { immediate: true })

// Streamer reads best in the orthographic (parallel) projection — like STG's ribbon. Default to
// it when the effect is selected/loaded, but leave the Projection control free (unlike String's
// lock). immediate so a freshly-opened Streamer comes up orthographic; a saved node's stored
// projection is applied afterward in the load path and still wins.
watch(effectId, (id) => { if (id === 'streamer') projection.value = 'isometric' }, { immediate: true })

const cfg = computed(() => ({
  effectId: effect.value.id, params: { ...params }, fps: fps.value, loopDuration: loopDuration.value,
  W: W.value, H: H.value, alpha: transparent.value, bgColor: bgColor.value, projection: projection.value,
  panX: panX.value, panY: panY.value,
}))

async function generateImage() {
  if (!engine) return
  baking.value = true
  stopPreview()
  try {
    await ensureEffectFonts()
    engine.setSize(W.value, H.value)
    rebuild()
    engine.renderFrame(0, params)
    const blob = await engine.frameToBlob()
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'spacetype_img')
    if (filename) {
      // Stash a thumbnail on the node so its card shows a preview.
      const n = currentNode()
      if (n) {
        if (!n.data) n.data = {}
        if (!n.data.properties) n.data.properties = {}
        const prev = n.data.properties.comfynext_spaceType || {}
        n.data.properties.comfynext_spaceType = { ...prev, thumb: `/view?filename=${filename}&type=input` }
      }
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('comfynext:spaceTypeOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } finally {
    baking.value = false
    startPreview()
  }
}

async function generateVideo() {
  if (!engine) return
  baking.value = true
  stopPreview()
  try {
    await ensureEffectFonts()
    engine.setSize(W.value, H.value)
    engine.setFps(fps.value)
    engine.setLoopDuration(loopDuration.value)
    rebuild()
    const bake = await ensureSpaceTypeBake(cfg.value, undefined, {
      renderFrame: async (i) => { engine!.renderFrame(i, params); return engine!.frameToBlob() },
    })
    const res = await fetch('/comfynext/spacetype_encode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frames: bake.frames, fps: fps.value, width: W.value, height: H.value }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.filename) {
      await recordAsset(activeTab.value?.projectUuid, 'video', data.filename)
      window.dispatchEvent(new CustomEvent('comfynext:spaceTypeOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: data.filename } },
      }))
      closeEditor()
    } else {
      console.error('[spacetype] video encode failed', data)
      alert('Video encode failed — make sure ComfyUI was restarted to load the encoder. See console.')
    }
  } finally {
    baking.value = false
    startPreview()
  }
}
</script>

<template>
  <StudioModalShell title="Type studio" :breadcrumb="effect.label" @close="closeEditor">
    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg" style="background:#0e0e10" />
        <StringPathEditor
          v-if="frontLocked"
          :model-value="String(params.path ?? '')"
          :canvas="canvas"
          @update:model-value="(v: string) => (params.path = v)"
        />
      </div>
    </template>
    <template #actions>
      <StudioButton variant="primary" :disabled="baking" @click="generateImage">
        {{ baking ? 'Generating…' : 'Generate as image' }}
      </StudioButton>
      <StudioButton variant="secondary" :disabled="baking" @click="generateVideo">
        {{ baking ? 'Generating…' : 'Generate as video' }}
      </StudioButton>
    </template>
    <template #controls>
      <div class="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
          <label class="mb-1 block text-[11px] text-white/50">Effect</label>
          <select v-model="effectId" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85">
            <option v-for="e in SPACE_TYPE_EFFECTS" :key="e.id" :value="e.id" class="bg-neutral-900">{{ e.label }}</option>
          </select>
          <template v-if="!frontLocked">
            <label class="mb-1 mt-2.5 block text-[11px] text-white/50">Projection</label>
            <select v-model="projection" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85">
              <option value="perspective" class="bg-neutral-900">Perspective</option>
              <option value="isometric" class="bg-neutral-900">Isometric</option>
            </select>
            <label class="mb-1.5 mt-2.5 flex justify-between text-[11px] text-white/50">
              <span>Pan X</span><span class="font-mono text-white/80">{{ panX.toFixed(2) }}</span>
            </label>
            <input v-model.number="panX" type="range" min="-1" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
            <label class="mb-1.5 mt-2.5 flex justify-between text-[11px] text-white/50">
              <span>Pan Y</span><span class="font-mono text-white/80">{{ panY.toFixed(2) }}</span>
            </label>
            <input v-model.number="panY" type="range" min="-1" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
          </template>
        </div>
        <StudioSection
          v-for="section in sections" :key="section.name"
          v-show="section.controls.length || section.name === 'Color' || section.name === 'Output'"
          :title="section.name"
          :open="openSections[section.name]"
        >
          <div class="space-y-3">
            <div v-for="c in section.controls" :key="c.key" v-show="!(c.key === 'typeWeight' && !fontIsVariable)"
                 data-control class="text-xs">
              <label v-if="c.kind !== 'slider'" class="mb-1 block text-white/60">{{ c.label }}</label>
              <StudioSlider v-if="c.kind === 'slider'" :label="c.label"
                            :min="Number(c.min ?? 0)" :max="Number(c.max ?? 1)" :step="Number(c.step ?? 1)"
                            :default="Number(c.default ?? 0)"
                            :model-value="Number(params[c.key])"
                            @update:model-value="(v: number) => { params[c.key] = v }" />
              <input v-else-if="c.kind === 'text'" type="text" v-model="params[c.key]"
                     class="w-full rounded bg-white/10 px-2 py-1" @input="rebuild" />
              <template v-else-if="c.kind === 'textList'">
                <div v-for="(_, i) in textLines" :key="i" class="mb-1 flex items-center gap-1">
                  <input type="text" v-model="textLines[i]" class="w-full rounded bg-white/10 px-2 py-1" />
                  <button v-if="textLines.length > 1" type="button" @click="removeTextRow(i)"
                          class="shrink-0 rounded px-2 py-1 text-white/40 hover:bg-white/10 hover:text-white">−</button>
                </div>
                <button type="button" @click="addTextRow"
                        class="mt-0.5 rounded bg-white/10 px-2 py-1 text-white/60 hover:text-white">+ Add text</button>
                <p class="mt-1 text-[10px] text-white/40">Multiple texts alternate per repeat.</p>
              </template>
              <template v-else-if="c.kind === 'fillList'">
                <div v-for="(f, i) in fills" :key="i" class="mb-1.5 flex items-center gap-1">
                  <select v-model="f.type" class="min-w-0 flex-1 rounded bg-white/10 px-1 py-1">
                    <option v-for="ft in FILL_TYPES" :key="ft" :value="ft">{{ ft }}</option>
                  </select>
                  <StudioColor v-model="f.a" />
                  <StudioColor v-if="fillNeedsB(f)" v-model="f.b" />
                  <input v-if="f.type === 'stripes' || f.type === 'gradient' || f.type === 'ombre'" type="range" v-model.number="f.angle"
                         min="0" max="180" step="5" v-studio-reset class="studio-range w-14 shrink-0" :title="f.type === 'stripes' ? 'Stripe angle' : 'Fade angle'" />
                  <input v-if="f.type === 'checkerboard' || f.type === 'grid' || f.type === 'stripes' || f.type === 'qr'" type="range"
                         v-model.number="f.density" min="1" max="32" step="1" v-studio-reset class="studio-range w-14 shrink-0" title="Pattern density" />
                  <span class="shrink-0 pl-0.5 text-[9px] text-white/30">T</span>
                  <StudioColor v-model="f.textColor" />
                  <button v-if="fills.length > 1" type="button" @click="removeFill(i)"
                          class="shrink-0 rounded px-1 py-1 text-white/40 hover:bg-white/10 hover:text-white">−</button>
                </div>
                <button type="button" @click="addFill"
                        class="mt-0.5 rounded bg-white/10 px-2 py-1 text-white/60 hover:text-white">+ Add fill</button>
                <p class="mt-1 text-[10px] text-white/40">Fills cycle per row: stripe color(s) + “T” text color. 2nd swatch sets the gradient/grid/noise pair.</p>
              </template>
              <p v-else-if="c.kind === 'path'" class="text-[10px] leading-relaxed text-white/40">
                Draw on the preview: click-drag to add a point (drag sets its curve handle),
                drag points/handles to adjust. <b>Enter</b> = new string, <b>Del</b> = remove,
                <b>Reset</b> clears.
              </p>
              <StudioColor v-else-if="c.kind === 'color'" :model-value="String(params[c.key])"
                           @update:model-value="(val: string) => { params[c.key] = val; rebuild() }" />
              <StudioSegmented v-else-if="c.kind === 'select' && (c.options?.length ?? 0) <= 3"
                               :options="c.options ?? []" :model-value="String(params[c.key])"
                               @update:model-value="(v: string) => { params[c.key] = v; rebuild() }" />
              <StudioSelect v-else-if="c.kind === 'select'"
                            :options="c.options ?? []" :model-value="String(params[c.key])"
                            @update:model-value="(v: string) => { params[c.key] = v; rebuild() }" />
              <template v-else-if="c.kind === 'font'">
                <button type="button" @click="fontPickerOpen = !fontPickerOpen"
                        class="flex w-full items-center justify-between rounded bg-white/10 px-2 py-1 text-left">
                  <span class="truncate">{{ params[c.key] || 'Select font…' }}</span>
                  <span class="ml-2 shrink-0 text-white/40">{{ fontPickerOpen ? '▴' : '▾' }}</span>
                </button>
                <div v-if="fontPickerOpen" class="mt-1 rounded bg-black/40 p-1">
                  <div class="mb-1 flex items-center gap-1">
                    <input v-model="fontSearch" placeholder="Search or describe fonts…" autofocus
                           @keydown.enter.prevent="runFontSuggest"
                           class="w-full flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1" />
                    <button type="button" title="Suggest fonts from a description"
                            :disabled="fontSuggestLoading" @click="runFontSuggest"
                            class="shrink-0 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 hover:border-white/25 disabled:opacity-40">✨ Ask AI</button>
                  </div>
                  <label class="mb-1 flex items-center justify-between px-1 py-0.5 text-[11px] text-white/55">
                    <span>Variable fonts only</span>
                    <StudioSwitch v-model="variableOnly" />
                  </label>
                  <!-- ✨ Suggested (from a description) -->
                  <div v-if="fontSuggestLoading || fontSuggestError || fontSuggestions.length || fontSuggestRan" class="mb-1">
                    <p class="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wider text-white/40">✨ Suggested</p>
                    <p v-if="fontSuggestLoading" class="px-2 py-1 text-white/40">Finding fonts…</p>
                    <p v-else-if="fontSuggestError" class="px-2 py-1 text-white/40">{{ fontSuggestError }}</p>
                    <p v-else-if="!fontSuggestions.length" class="px-2 py-1 text-white/40">No matches — try describing the style differently.</p>
                    <button v-for="s in fontSuggestions" :key="'s' + s.family" type="button"
                            @click="selectFont(c.key, s.family)"
                            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10"
                            :class="{ 'bg-white/15': params[c.key] === s.family }">
                      <span class="min-w-0 flex-1">
                        <span class="block truncate" :style="{ fontFamily: s.family }">{{ s.family }}</span>
                        <span class="block truncate text-[10px] text-white/40">{{ s.reason }}</span>
                      </span>
                      <span class="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-white/40">{{ s.category }}</span>
                    </button>
                    <div class="mx-2 my-1 border-t border-white/10" />
                  </div>
                  <div class="max-h-48 overflow-y-auto">
                    <button v-for="f in filteredFonts" :key="f.family" type="button"
                            @click="selectFont(c.key, f.family)"
                            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10"
                            :class="{ 'bg-white/15': params[c.key] === f.family }">
                      <span class="truncate">{{ f.family }}</span>
                      <span v-if="isVar(f)" :title="`Variable axes: ${varAxes(f)}`"
                            class="ml-auto shrink-0 rounded bg-white/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-white/70">var</span>
                    </button>
                    <p v-if="!fontCatalog.length" class="px-2 py-1 text-white/40">Loading fonts…</p>
                    <p v-else-if="!filteredFonts.length" class="px-2 py-1 text-white/40">No matches</p>
                  </div>
                </div>
                <div v-if="varAxisList.length" class="mt-2 space-y-2.5">
                  <StudioSlider v-for="a in varAxisList" :key="a.tag"
                                :model-value="fontAxes[a.tag] ?? a.default" @update:model-value="(v: number) => { fontAxes[a.tag] = v }"
                                :label="a.label" :min="a.min" :max="a.max" :step="a.step" :default="a.default" />
                </div>
                <p v-if="!fontIsVariable" class="mt-1 text-[10px] text-white/40">Static font — weight axis unavailable.</p>
              </template>
            </div>

            <template v-if="section.name === 'Output'">
              <div data-control class="text-xs">
                <label class="mb-1 block text-white/60">Dimensions</label>
                <select v-model="dimsKey" class="w-full rounded bg-white/10 px-2 py-1">
                  <option v-for="k in Object.keys(DIMS)" :key="k" :value="k">{{ k }}</option>
                  <option :value="CUSTOM">Custom…</option>
                </select>
                <div class="mt-1 flex items-center gap-1">
                  <input type="number" min="16" max="4096" step="2" v-model.number="W" @change="onCustomDims"
                         class="w-full rounded bg-white/10 px-2 py-1" aria-label="Width" />
                  <span class="text-white/40">×</span>
                  <input type="number" min="16" max="4096" step="2" v-model.number="H" @change="onCustomDims"
                         class="w-full rounded bg-white/10 px-2 py-1" aria-label="Height" />
                </div>
              </div>
              <div data-control class="text-xs">
                <label class="mb-1 block text-white/60">FPS</label>
                <select v-model.number="fps" class="w-full rounded bg-white/10 px-2 py-1">
                  <option v-for="f in FPS_OPTIONS" :key="f" :value="Number(f)">{{ f }}</option>
                </select>
              </div>
              <div data-control class="text-xs">
                <label class="mb-1 flex justify-between text-white/60">
                  <span>Duration</span>
                  <span class="text-white/80">{{ loopDuration }}s · {{ Math.round(fps * loopDuration) }} frames</span>
                </label>
                <input type="range" min="1" max="15" step="0.5" v-studio-reset v-model.number="loopDuration" class="studio-range w-full" />
              </div>
              <label data-control class="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" v-model="transparent" /> Transparent background
              </label>
              <div v-if="!transparent" data-control class="text-xs">
                <label class="mb-1 block text-white/60">Background color</label>
                <StudioColor v-model="bgColor" />
              </div>
            </template>
          </div>
        </StudioSection>
    </template>
  </StudioModalShell>
</template>
