<!-- frontend/app/components/vue-canvas/ShaderStudioSurface.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight, Plus, Trash2 } from 'lucide-vue-next'
import CatalogModal from '~/components/CatalogModal.vue'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import { assetUrl, fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { resolveUniforms } from '~/lib/shaderfx/params'
import { shaderFx } from '~/lib/shaderfx/renderer'
import type { EffectDef, ShaderFxCatalog } from '~/lib/shaderfx/types'
import { composePasses, type EffectTextureBundle } from '~/lib/shaderstudio/passes'
import { ANIMATABLE, applyMotion } from '~/lib/shaderstudio/motion'
import { ADJUST_PRESETS, DUOTONE_PRESETS, applyAdjustPreset } from '~/lib/shaderstudio/presets'
import { loadImage } from '~/lib/shaderstudio/source'
import { cloneConfig, defaultConfig, hydrateConfig, outputDims, type MotionTrack, type ShaderStudioConfig } from '~/lib/shaderstudio/types'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { useStudioAgent } from '~/composables/useStudioAgent'
import { makeConfigParams } from '~/lib/agent/configParams'
import { shaderAgentControls } from '~/lib/shaderstudio/agentControls'

const props = defineProps<{ nodeId: string; nodes: any[]; wiredUrl?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()
function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

const config = ref<ShaderStudioConfig>(defaultConfig())
const catalog = ref<ShaderFxCatalog | null>(null)
const baseImage = ref<HTMLImageElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)
const baking = ref(false)
const bakeMsg = ref('')
// Preview backing-store cap. Kept high so grid-based effects (ASCII, halftone,
// dither) render enough pixels-per-cell to stay crisp on retina displays and at
// fine Size values — at 880 a dense ASCII grid mushed out. Export still upscales
// to the user's chosen resolution separately.
const PREVIEW_MAX_W = 1600

const effectDef = computed<EffectDef | null>(
  () => catalog.value?.effects.find(e => e.id === config.value.effect.id) ?? null)
const effectUniforms = computed(() =>
  effectDef.value ? resolveUniforms(effectDef.value, config.value.effect.params) : {})

// In-product agent — "tune" the shader in natural language (Phase 1). The nested
// `config` is bridged to a flat Params; only the controls for currently-enabled
// stages (plus the active effect's float uniforms) are offered to the model.
const { getLocalSetting } = useLocalSettings()
const agentParams = makeConfigParams(() => config.value)
const activeAgentControls = computed(() => shaderAgentControls(config.value, effectDef.value))
// The shell renders the prompt + results from this object (see StudioModalShell).
const shaderAgent = useStudioAgent({
  controls: () => activeAgentControls.value, params: agentParams, label: () => 'Shader studio',
  apiKey: () => getLocalSetting('ComfyNext.AI.AnthropicApiKey') ?? '',
  // Force a fresh synchronous render of the current config to the preview canvas,
  // then export it for the agent's visual self-review.
  render: () => { renderFrame(0); return canvas.value?.toDataURL('image/png') ?? null },
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
function texBundle(def: EffectDef | null): EffectTextureBundle {
  const sources: Record<string, TexImageSource> = {}
  const uniforms: Record<string, number> = {}
  if (!def) return { sources, uniforms }
  for (const t of def.textures) {
    const img = textureImages.get(t.file)
    if (img?.complete) sources[t.uniform] = img
    else if (!img) { const el = new Image(); el.onload = () => renderFrame(0); el.src = assetUrl(t.file, t.v); textureImages.set(t.file, el) }
    for (const [k, v] of Object.entries(t.extraUniforms ?? {})) uniforms[k] = v
  }
  // ASCII "Custom" shape (u_shape == 14) → bind the runtime glyph atlas.
  if (def.id === 'ascii_dither' && Math.round(effectUniforms.value['u_shape'] ?? 0) === 14) {
    sources['u_customGlyphs'] = buildCustomAtlas(config.value.effect.customChars ?? '')
  }
  return { sources, uniforms }
}

// ── preview ──────────────────────────────────────────────────────────────────
const animated = computed(() => (config.value.motion?.tracks?.length ?? 0) > 0)
function renderFrame(t: number) {
  const el = canvas.value
  if (!el) return
  const base = baseImage.value
  if (!base) return
  const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, PREVIEW_MAX_W)
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try {
    const cfg = animated.value ? applyMotion(config.value, t) : config.value
    const passes = composePasses(cfg, effectDef.value, t, texBundle(effectDef.value))
    el.getContext('2d')!.drawImage(shaderFx.render(passes, base, w, h), 0, 0)
    glError.value = null
  } catch (e: any) { glError.value = String(e?.message ?? e) }
}

let raf = 0, start = 0
function loop(ts: number) {
  if (!start) start = ts
  renderFrame(((ts - start) / 1000) % Math.max(0.1, config.value.motion.duration))
  raf = requestAnimationFrame(loop)
}
function startPreview() { cancelAnimationFrame(raf); start = 0; if (animated.value) raf = requestAnimationFrame(loop); else renderFrame(0) }
function stopPreview() { cancelAnimationFrame(raf); raf = 0 }
watch(config, () => { if (!animated.value) renderFrame(0) }, { deep: true })
watch(animated, startPreview)

// ── source loading ────────────────────────────────────────────────────────────
const sourceUrl = computed(() => props.wiredUrl ?? config.value.source.dataUrl
  ?? (config.value.source.asset ? `/view?${new URLSearchParams({ filename: config.value.source.asset, type: 'input' })}` : null))
watch(sourceUrl, async (url) => {
  baseImage.value = null
  if (!url) return
  try { baseImage.value = await loadImage(url); startPreview() } catch { glError.value = 'Could not load source image' }
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
    if (pickerOpen.value) for (const def of catalog.value?.effects ?? []) if (!def.generative) ensureThumb(def)
    if (effectDef.value) ensureThumb(effectDef.value)
  }
  img.src = '/finn_shader.png'
})()
const pickerFilters = computed(() => {
  const counts = new Map<string, number>()
  for (const e of catalog.value?.effects ?? []) if (!e.generative) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
  const total = (catalog.value?.effects ?? []).filter(e => !e.generative).length
  return [{ id: 'all', label: 'All', count: total }, ...[...counts].map(([id, count]) => ({ id, label: titleCase(id), count }))]
})
const pickerItems = computed<EffectDef[]>(() => {
  const q = pickerSearch.value.trim().toLowerCase()
  return (catalog.value?.effects ?? []).filter(e => !e.generative
    && (pickerFilter.value === 'all' || e.category === pickerFilter.value)
    && (!q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)))
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
function openPicker() { pickerSearch.value = ''; pickerFilter.value = 'all'; pickerOpen.value = true; for (const def of catalog.value?.effects ?? []) if (!def.generative) ensureThumb(def) }
function pickEffect(id: string) { config.value.effect = { id, params: {}, enabled: true, customChars: '' }; pickerOpen.value = false; renderFrame(0) }
const currentThumb = computed(() => (effectDef.value ? thumbs.value[effectDef.value.id] ?? '' : ''))

// ── duotone / adjust presets ────────────────────────────────────────────────
function pickDuotone(p: { ink: string; paper: string }) { config.value.duotone.ink = p.ink; config.value.duotone.paper = p.paper; config.value.duotone.enabled = true }
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
    .map(p => ({ path: `effect.params.${p.uniform}`, label: `Effect · ${p.label}`, min: p.min ?? 0, max: p.max ?? 1 })),
])
function addTrack() {
  const a = animatablePaths.value[0]!
  config.value.motion.tracks.push({ path: a.path, from: a.min, to: a.max, easing: 'pingpong', loops: 1, delay: 0, hold: 0, cycleOffset: 0 } as MotionTrack)
}
function removeTrack(i: number) { config.value.motion.tracks.splice(i, 1) }

// ── persistence ────────────────────────────────────────────────────────────────
function loadConfig() { const c = currentNode()?.data?.properties?.comfynext_shaderStudio; if (c && typeof c === 'object') config.value = hydrateConfig(c) }
function saveConfig() { const n = currentNode(); if (!n) return; n.data ||= {}; n.data.properties ||= {}; n.data.properties.comfynext_shaderStudio = cloneConfig(config.value) }
function closeEditor() { try { saveConfig() } catch (e) { console.error('[shader-studio] saveConfig failed', e) } emit('close') }

// ── outputs (mirror Gradient Studio) ───────────────────────────────────────────
async function renderBlob(t: number): Promise<Blob> {
  const base = baseImage.value!
  const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, config.value.resolution, { upscale: true })
  const cfg = animated.value ? applyMotion(config.value, t) : config.value
  shaderFx.render(composePasses(cfg, effectDef.value, t, texBundle(effectDef.value)), base, w, h)
  const c = shaderFx.outputCanvas!
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png', 0.95))
}

async function generateImage() {
  if (!baseImage.value) { bakeMsg.value = 'Add a source first'; return }
  baking.value = true; bakeMsg.value = 'Rendering…'; stopPreview()
  try {
    const blob = await renderBlob(0)
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'shader_img')
    if (filename) {
      saveConfig()
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('comfynext:shaderStudioOutput', { detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } } }))
      closeEditor()
    }
  } catch (e) { console.error('[shader-studio] image failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

async function generateVideo() {
  if (!baseImage.value) { bakeMsg.value = 'Add a source first'; return }
  baking.value = true; stopPreview()
  try {
    const base = baseImage.value
    const m = config.value.motion
    const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, config.value.resolution, { upscale: true })
    const total = Math.max(1, Math.round(m.fps * m.duration))
    const bakeCfg = { fps: m.fps, loopDuration: m.duration, W: w, H: h, seed: 'shader', sig: JSON.stringify(config.value) }
    const bake = await ensureSpaceTypeBake(bakeCfg as any, undefined, {
      renderFrame: async (i) => { bakeMsg.value = `Baking ${i + 1}/${total}`; return await renderBlob(i / m.fps) },
    })
    bakeMsg.value = 'Encoding…'
    const res = await fetch('/comfynext/spacetype_encode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frames: bake.frames, fps: m.fps, width: w, height: h }) })
    const data = await res.json().catch(() => ({}))
    if (data.filename) {
      await recordAsset(activeTab.value?.projectUuid, 'video', data.filename)
      window.dispatchEvent(new CustomEvent('comfynext:shaderStudioOutput', { detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: data.filename } } }))
      closeEditor()
    } else { bakeMsg.value = 'Encode failed — restart ComfyUI to load the encoder.'; console.error('[shader-studio] encode failed', data) }
  } catch (e) { console.error('[shader-studio] video failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

const RESOLUTIONS = [1024, 1536, 2048, 4096]

// Live readout of the baked output size (the preview is a fixed-size proxy, so
// this is the only place the resolution choice is visible before exporting).
const outputSizeLabel = computed(() => {
  const base = baseImage.value
  if (!base) return null
  const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, config.value.resolution, { upscale: true })
  return `${w} × ${h}`
})

onMounted(async () => { loadConfig(); catalog.value = await fetchShaderFxCatalog().catch(() => null); startPreview() })
onBeforeUnmount(() => { saveConfig(); stopPreview() })

function setParam(uniform: string, value: number) { config.value.effect.params = { ...config.value.effect.params, [uniform]: value } }
</script>

<template>
  <StudioModalShell
    title="Shader studio" :breadcrumb="effectDef?.name"
    :agent="shaderAgent"
    agent-placeholder="Describe the look — e.g. punchier, warmer, more glow…"
    @close="closeEditor"
  >
    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg shadow-2xl" />
        <!-- Focus point overlay when lens blur is on -->
        <div v-if="config.post.blur.enabled"
          class="nopan nodrag absolute size-3 -ml-1.5 -mt-1.5 cursor-move rounded-full border-2 border-white bg-black/30"
          :style="{ left: `${config.post.blur.focusX * 100}%`, top: `${config.post.blur.focusY * 100}%` }"
          @pointerdown="onFocusDown" @pointermove="onFocusMove" @pointerup="onFocusUp" />
        <span v-if="!baseImage" class="absolute text-xs text-white/40">Add a source image to begin</span>
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
        <template #badge><StudioSwitch v-model="config.effect.enabled" /></template>
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
              v-model="config.effect.customChars" type="text" spellcheck="false" placeholder=" .:-=+*#%@"
              class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 font-mono text-xs tracking-wider"
            />
          </div>
        </div>
      </StudioSection>

      <!-- Duotone -->
      <StudioSection title="Duotone" :open="false">
        <template #badge><StudioSwitch v-model="config.duotone.enabled" /></template>
        <div class="mb-2 flex items-center gap-2">
          <label class="text-[11px] text-white/60">Ink</label><StudioColor v-model="config.duotone.ink" />
          <label class="text-[11px] text-white/60">Paper</label><StudioColor v-model="config.duotone.paper" />
        </div>
        <div class="grid grid-cols-4 gap-1">
          <button v-for="p in DUOTONE_PRESETS" :key="p.name" class="h-7 overflow-hidden rounded border border-white/10" :title="p.name" @click="pickDuotone(p)">
            <span class="flex h-full w-full"><span class="h-full w-1/2" :style="{ background: p.ink }" /><span class="h-full w-1/2" :style="{ background: p.paper }" /></span>
          </button>
        </div>
      </StudioSection>

      <!-- Adjustments -->
      <StudioSection title="Adjustments" :open="false">
        <template #badge><StudioSwitch v-model="config.adjust.enabled" /></template>
        <select class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs" @change="pickAdjustPreset(($event.target as HTMLSelectElement).value)">
          <option v-for="p in ADJUST_PRESETS" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
        <template v-for="f in ([['exposure','Exposure',-2,2],['brightness','Brightness',-1,1],['contrast','Contrast',-1,1],['saturation','Saturation',-1,1],['hue','Hue',-180,180],['temperature','Temperature',-1,1],['tint','Tint',-1,1]] as const)" :key="f[0]">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>{{ f[1] }}</span><span class="text-white/40">{{ (config.adjust as any)[f[0]].toFixed(2) }}</span></label>
          <input v-model.number="(config.adjust as any)[f[0]]" type="range" :min="f[2]" :max="f[3]" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
      </StudioSection>

      <!-- Post-processing -->
      <StudioSection title="Post-processing" :open="false">
        <div class="mb-1 flex items-center justify-between"><span class="text-xs text-white/70">Lens Blur</span><StudioSwitch v-model="config.post.blur.enabled" /></div>
        <template v-if="config.post.blur.enabled">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Focus range</span><span class="text-white/40">{{ config.post.blur.range.toFixed(2) }}</span></label>
          <input v-model.number="config.post.blur.range" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Aperture</span><span class="text-white/40">{{ config.post.blur.aperture.toFixed(2) }}</span></label>
          <input v-model.number="config.post.blur.aperture" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Max blur</span><span class="text-white/40">{{ config.post.blur.maxBlur.toFixed(0) }}</span></label>
          <input v-model.number="config.post.blur.maxBlur" type="range" min="0" max="40" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <div class="mb-1 mt-2 flex items-center justify-between"><span class="text-xs text-white/70">Chromatic</span><StudioSwitch v-model="config.post.chromatic.enabled" /></div>
        <template v-if="config.post.chromatic.enabled">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Amount</span><span class="text-white/40">{{ config.post.chromatic.amount.toFixed(2) }}</span></label>
          <input v-model.number="config.post.chromatic.amount" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
        </template>

        <div class="mb-1 mt-2 flex items-center justify-between"><span class="text-xs text-white/70">Bloom</span><StudioSwitch v-model="config.post.bloom.enabled" /></div>
        <template v-if="config.post.bloom.enabled">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Threshold</span><span class="text-white/40">{{ config.post.bloom.threshold.toFixed(2) }}</span></label>
          <input v-model.number="config.post.bloom.threshold" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Intensity</span><span class="text-white/40">{{ config.post.bloom.intensity.toFixed(2) }}</span></label>
          <input v-model.number="config.post.bloom.intensity" type="range" min="0" max="3" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Radius</span><span class="text-white/40">{{ config.post.bloom.radius.toFixed(0) }}</span></label>
          <input v-model.number="config.post.bloom.radius" type="range" min="4" max="200" step="2" v-studio-reset class="studio-range w-full" />
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
          <div><label class="mb-1 flex justify-between text-[11px] text-white/60"><span>Duration</span><span class="text-white/40">{{ config.motion.duration }}s</span></label><input v-studio-reset v-model.number="config.motion.duration" type="range" min="1" max="12" step="0.5" class="studio-range w-full" /></div>
          <div><label class="mb-1 block text-[11px] text-white/60">FPS</label><select v-model.number="config.motion.fps" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]"><option :value="24">24</option><option :value="30">30</option><option :value="60">60</option></select></div>
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>

  <CatalogModal :open="pickerOpen" title="Shader Effects" subtitle="Pick an effect to apply"
    :items="pickerItems" :selected-id="config.effect.id" :filters="pickerFilters" :active-filter-id="pickerFilter" :search-query="pickerSearch"
    search-placeholder="Search effects…" confirm-label="Use effect" empty-message="No effects match your search."
    @close="pickerOpen = false" @confirm="pickEffect(($event as EffectDef).id)" @update:active-filter-id="pickerFilter = $event" @update:search-query="pickerSearch = $event">
    <template #card="{ item }">
      <div class="aspect-video overflow-hidden bg-black/20"><img v-if="thumbs[(item as EffectDef).id]" :src="thumbs[(item as EffectDef).id]" class="h-full w-full object-cover" /></div>
      <div class="px-2 py-1.5"><div class="truncate text-[11px] text-white/85">{{ (item as EffectDef).name }}</div><div class="text-[10px] capitalize text-white/35">{{ (item as EffectDef).category }}</div></div>
    </template>
  </CatalogModal>
</template>
