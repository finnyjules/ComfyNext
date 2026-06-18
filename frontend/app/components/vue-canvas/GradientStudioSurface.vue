<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Dices, Lock, Palette, Plus, Shapes, Sparkles, Trash2, Unlock, X } from 'lucide-vue-next'
import { gradientFx } from '~/lib/gradientfx/renderer'
import { buildConfig, defaultConfig, reroll, rippleConfig, type RerollScope } from '~/lib/gradientfx/randomize'
import { randomSeed } from '~/lib/gradientfx/rng'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { ANIMATABLE } from '~/lib/gradientfx/motion'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import {
  ASPECTS, BLEND_MODES, DIRECTIONS, GRADIENT_DIRS, LAYOUTS, MAPPINGS, MIRROR_KINDS, SHAPE_KINDS,
  aspectRatio, cloneConfig, ensureConfigDefaults, type GradientConfig, type LayoutKind, type ShapeKind,
} from '~/lib/gradientfx/types'

const props = defineProps<{ nodeId: string; nodes: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills/videos as the current project's assets (Assets panel).
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

// ── config (single source of truth) ─────────────────────────────────────────
const config = ref<GradientConfig>(defaultConfig('#default0'))
const activeLayer = ref(0)
const layer = computed(() => config.value.layers[activeLayer.value] ?? config.value.layers[0]!)
const isRadial = computed(() => config.value.canvas.layout !== 'linear')

// Proxies for the optional center/light fields so v-model stays simple and type-safe
// (the fields are backfilled by ensureConfigDefaults, but typed optional).
const centerX = computed({
  get: () => config.value.canvas.center?.x ?? 0,
  set: (v: number) => { (config.value.canvas.center ??= { x: 0, y: 0 }).x = v },
})
const centerY = computed({
  get: () => config.value.canvas.center?.y ?? 0,
  set: (v: number) => { (config.value.canvas.center ??= { x: 0, y: 0 }).y = v },
})
const lightAz = computed({
  get: () => config.value.relief.light?.azimuth ?? 135,
  set: (v: number) => { (config.value.relief.light ??= { azimuth: 135, elevation: 45 }).azimuth = v },
})
const lightEl = computed({
  get: () => config.value.relief.light?.elevation ?? 45,
  set: (v: number) => { (config.value.relief.light ??= { azimuth: 135, elevation: 45 }).elevation = v },
})

// ── rolls history (session-scoped) ──────────────────────────────────────────
interface Roll { seed: string; thumb: string; cfg: GradientConfig }
const rolls = reactive<Roll[]>([])
const ROLL_CAP = 48

// ── preview ─────────────────────────────────────────────────────────────────
const canvas = ref<HTMLCanvasElement | null>(null)
const baking = ref(false)
const bakeMsg = ref('')
const glError = ref<string | null>(null)
let raf = 0
let start = 0
const PREVIEW_MAX_W = 880

function previewDims() {
  const ar = aspectRatio(config.value.canvas.aspect)
  const w = PREVIEW_MAX_W
  return { w, h: Math.round(w / ar) }
}

function renderFrame(t: number) {
  const el = canvas.value
  if (!el) return
  const { w, h } = previewDims()
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try { el.getContext('2d')!.drawImage(gradientFx.render(config.value, w, h, t), 0, 0); glError.value = null }
  catch (e: any) { glError.value = String(e?.message ?? e) }
}

const animated = computed(() => (config.value.motion?.tracks?.length ?? 0) > 0)
function loop(ts: number) {
  if (!start) start = ts
  const dur = Math.max(0.1, config.value.motion?.duration ?? 4)
  renderFrame(((ts - start) / 1000) % dur)
  raf = requestAnimationFrame(loop)
}
function startPreview() {
  cancelAnimationFrame(raf); start = 0
  if (animated.value) raf = requestAnimationFrame(loop)
  else renderFrame(0)
}
function stopPreview() { cancelAnimationFrame(raf); raf = 0 }

watch(config, () => { if (!animated.value) renderFrame(0) }, { deep: true })
watch(animated, startPreview)

// ── randomize + rolls ────────────────────────────────────────────────────────
function makeThumb(cfg: GradientConfig): string {
  try { return gradientFx.render(cfg, 132, Math.round(132 / aspectRatio(cfg.canvas.aspect)), 0).toDataURL('image/jpeg', 0.7) }
  catch { return '' }
}
function pushRoll(cfg: GradientConfig) {
  rolls.unshift({ seed: cfg.seed, thumb: makeThumb(cfg), cfg: cloneConfig(cfg) })
  if (rolls.length > ROLL_CAP) rolls.length = ROLL_CAP
}
function randomize(scope: RerollScope) {
  config.value = reroll(config.value, scope, randomSeed())
  pushRoll(config.value)
}
function restoreRoll(r: Roll) { config.value = cloneConfig(r.cfg) }
function clearRolls() { rolls.splice(0, rolls.length) }

// Preset: the 3D-embossed rainbow orbit (the reference look).
function applyRipple() {
  config.value = rippleConfig(randomSeed())
  activeLayer.value = 0
  pushRoll(config.value)
}

// ── locks ─────────────────────────────────────────────────────────────────
function toggleLock(key: string) {
  const locks = (config.value.locks ||= {})
  locks[key] = !locks[key]
}
const locked = (key: string) => !!config.value.locks?.[key]

// ── layers ──────────────────────────────────────────────────────────────────
function addLayer() {
  if (config.value.layers.length >= 2) return
  const extra = buildConfig(randomSeed()).layers[0]!
  // Normal blend at partial opacity so the new layer is immediately visible over
  // layer 1 (a random dark palette under 'lighten' looked invisible — its controls
  // then appeared to do nothing). The user can switch to lighten/screen/etc.
  extra.blend = 'normal'; extra.opacity = 0.65
  config.value.layers.push(extra)
  activeLayer.value = config.value.layers.length - 1
}
function removeLayer(i: number) {
  if (config.value.layers.length <= 1) return
  config.value.layers.splice(i, 1)
  activeLayer.value = Math.min(activeLayer.value, config.value.layers.length - 1)
}

// ── color stops ─────────────────────────────────────────────────────────────
function addStop() {
  const stops = layer.value.color.stops
  stops.push({ color: '#ffffff', pos: stops.length ? 1 : 0 })
}
function removeStop(i: number) {
  const stops = layer.value.color.stops
  if (stops.length > 2) stops.splice(i, 1)
}

// ── motion tracks ─────────────────────────────────────────────────────────────
function addTrack() {
  config.value.motion.tracks.push({
    layer: activeLayer.value, param: 'phase', from: 0, to: 1,
    easing: 'pingpong', loops: 1, hold: 0, cycleOffset: 0, delay: 0,
  })
}
function removeTrack(i: number) { config.value.motion.tracks.splice(i, 1) }

// ── export ────────────────────────────────────────────────────────────────────
const EXPORT_RES = [{ label: '2K', w: 2048 }, { label: '4K', w: 4096 }, { label: '8K', w: 8192 }]
const exportFormat = ref<'png' | 'jpg'>('png')
const exportResW = ref(2048)
const exportDims = computed(() => {
  const ar = aspectRatio(config.value.canvas.aspect)
  return { w: exportResW.value, h: Math.round(exportResW.value / ar) }
})
function downloadExport() {
  const { w, h } = exportDims.value
  const out = gradientFx.render(config.value, w, h, 0)
  const a = document.createElement('a')
  a.href = out.toDataURL(exportFormat.value === 'png' ? 'image/png' : 'image/jpeg', 0.95)
  a.download = `gradient-${config.value.seed.replace('#', '')}.${exportFormat.value}`
  a.click()
}

// ── config persistence ────────────────────────────────────────────────────────
function loadConfig() {
  const c = currentNode()?.data?.properties?.comfynext_gradientStudio
  if (c && typeof c === 'object') config.value = ensureConfigDefaults(cloneConfig(c))
}
function saveConfig() {
  const n = currentNode(); if (!n) return
  if (!n.data) n.data = {}
  if (!n.data.properties) n.data.properties = {}
  n.data.properties.comfynext_gradientStudio = cloneConfig(config.value)
}
// Save must never block closing — swallow any persistence error so the user can
// always exit the modal.
function closeEditor() {
  try { saveConfig() } catch (e) { console.error('[gradient] saveConfig failed', e) }
  emit('close')
}

// ── outputs (mirror Space Type) ───────────────────────────────────────────────
async function generateImage() {
  baking.value = true; bakeMsg.value = 'Rendering…'
  stopPreview()
  try {
    const { w, h } = exportDims.value
    const blob = await gradientFx.renderToBlob(config.value, Math.min(w, 4096), Math.min(h, 4096), 0)
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'gradient_img')
    if (filename) {
      const n = currentNode()
      if (n) { n.data ||= {}; n.data.properties ||= {}; saveConfig() }
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('comfynext:gradientStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } catch (e) { console.error('[gradient] image generate failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

async function generateVideo() {
  baking.value = true
  stopPreview()
  try {
    const m = config.value.motion
    const { w, h } = { w: m.size && aspectRatio(config.value.canvas.aspect) >= 1 ? Math.round(m.size * aspectRatio(config.value.canvas.aspect)) : m.size, h: m.size }
    const total = Math.max(1, Math.round(m.fps * m.duration))
    const bakeCfg = { fps: m.fps, loopDuration: m.duration, W: w, H: h, seed: config.value.seed, sig: JSON.stringify(config.value) }
    const bake = await ensureSpaceTypeBake(bakeCfg as any, undefined, {
      renderFrame: async (i) => {
        bakeMsg.value = `Baking ${i + 1}/${total}`
        return gradientFx.renderToBlob(config.value, w, h, (i / m.fps))
      },
    })
    bakeMsg.value = 'Encoding…'
    const res = await fetch('/comfynext/spacetype_encode', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ frames: bake.frames, fps: m.fps, width: w, height: h }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.filename) {
      await recordAsset(activeTab.value?.projectUuid, 'video', data.filename)
      window.dispatchEvent(new CustomEvent('comfynext:gradientStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: data.filename } },
      }))
      closeEditor()
    } else { bakeMsg.value = 'Encode failed — restart ComfyUI to load the encoder.'; console.error('[gradient] encode failed', data) }
  } catch (e) { console.error('[gradient] video generate failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

// ── keyboard shortcuts ────────────────────────────────────────────────────────
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.code === 'Space') { e.preventDefault(); randomize('all') }
  else if (e.key === 'c' || e.key === 'C') randomize('colors')
  else if (e.key === 's' || e.key === 'S') randomize('structure')
  else if (e.key === 'e' || e.key === 'E') downloadExport()
  else if (e.key === 'Escape') closeEditor()
}

onMounted(() => {
  loadConfig()
  startPreview()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => { saveConfig(); stopPreview(); window.removeEventListener('keydown', onKey) })

function setLayout(l: LayoutKind) { config.value.canvas.layout = l }
function setShape(s: ShapeKind) { layer.value.shape.type = s }
</script>

<template>
  <StudioModalShell title="Gradient studio" @close="closeEditor">
    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg shadow-2xl" />
        <!-- Floating randomize toolbar -->
        <div class="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-neutral-900/80 p-1 shadow-lg backdrop-blur">
          <button class="flex items-center gap-1.5 rounded-md bg-white/90 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-white" @click="randomize('all')">
            <Dices class="h-3.5 w-3.5" /> Randomize <span class="text-black/40">Space</span>
          </button>
          <button class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-white/80 transition hover:bg-white/10" @click="randomize('colors')">
            <Palette class="h-3.5 w-3.5" /> Colors <span class="text-white/30">C</span>
          </button>
          <button class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-white/80 transition hover:bg-white/10" @click="randomize('structure')">
            <Shapes class="h-3.5 w-3.5" /> Structure <span class="text-white/30">S</span>
          </button>
          <div class="mx-0.5 h-5 w-px bg-white/10" />
          <button class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-white/80 transition hover:bg-white/10" title="Apply the 3D rainbow-ripple preset" @click="applyRipple">
            <Sparkles class="h-3.5 w-3.5" /> Ripple
          </button>
        </div>
      </div>
    </template>

    <template #actions>
      <StudioButton variant="primary" :disabled="baking" @click="generateImage">
        {{ baking ? (bakeMsg || 'Working…') : 'Generate as image' }}
      </StudioButton>
      <StudioButton variant="secondary" :disabled="baking" @click="generateVideo">
        {{ baking ? (bakeMsg || 'Working…') : 'Generate as video' }}
      </StudioButton>
      <span v-if="glError" class="ml-2 truncate text-xs text-red-300/80">{{ glError }}</span>
    </template>

    <template #controls>
      <!-- Canvas -->
      <StudioSection title="Canvas" badge="both layers">
        <label class="mb-1 flex items-center justify-between text-xs text-white/60">
          <span>Aspect ratio</span>
          <button class="text-white/30 hover:text-white/70" @click="toggleLock('aspect')"><component :is="locked('aspect') ? Lock : Unlock" class="h-3 w-3" /></button>
        </label>
        <select v-model="config.canvas.aspect" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs">
          <option v-for="a in ASPECTS" :key="a" :value="a">{{ a }}</option>
        </select>
        <label class="mb-1 flex items-center justify-between text-xs text-white/60">
          <span>Layout</span>
          <button class="text-white/30 hover:text-white/70" @click="toggleLock('layout')"><component :is="locked('layout') ? Lock : Unlock" class="h-3 w-3" /></button>
        </label>
        <div class="mb-2 grid grid-cols-3 gap-1">
          <button v-for="l in LAYOUTS" :key="l" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="config.canvas.layout === l ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="setLayout(l)">{{ l }}</button>
        </div>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Margin</span><span class="text-white/40">{{ config.canvas.margin.toFixed(2) }}</span></label>
        <input v-model.number="config.canvas.margin" type="range" min="0" max="0.45" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <template v-if="isRadial">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Inner radius</span><span class="text-white/40">{{ config.canvas.innerRadius.toFixed(2) }}</span></label>
          <input v-model.number="config.canvas.innerRadius" type="range" min="0" max="0.9" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Center X</span><span class="text-white/40">{{ centerX.toFixed(2) }}</span></label>
          <input v-model.number="centerX" type="range" min="-0.5" max="0.5" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Center Y</span><span class="text-white/40">{{ centerY.toFixed(2) }}</span></label>
          <input v-model.number="centerY" type="range" min="-0.5" max="0.5" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <label class="mb-1 block text-xs text-white/60">Background</label>
        <input v-model="config.canvas.background" type="color" class="h-7 w-full rounded" />
      </StudioSection>

      <!-- Relief & grain -->
      <StudioSection title="Relief & grain" badge="both layers" :open="false">
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Grain</span><span class="text-white/40">{{ config.relief.grain.toFixed(2) }}</span></label>
        <input v-model.number="config.relief.grain" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Relief</span><span class="text-white/40">{{ config.relief.relief.toFixed(2) }}</span></label>
        <input v-model.number="config.relief.relief" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Light angle</span><span class="text-white/40">{{ Math.round(lightAz) }}°</span></label>
        <input v-model.number="lightAz" type="range" min="0" max="360" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Light height</span><span class="text-white/40">{{ Math.round(lightEl) }}°</span></label>
        <input v-model.number="lightEl" type="range" min="0" max="90" step="1" v-studio-reset class="studio-range w-full" />
      </StudioSection>

      <!-- Layers -->
      <StudioSection title="Layers" :open="false">
        <div class="mb-2 flex gap-1">
          <button v-for="(_, i) in config.layers" :key="i" class="flex-1 rounded px-2 py-1 text-xs transition"
                  :class="activeLayer === i ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="activeLayer = i">{{ i + 1 }}</button>
          <button v-if="config.layers.length < 2" class="rounded bg-white/[0.04] px-2 py-1 text-white/55 hover:bg-white/10" @click="addLayer"><Plus class="h-3.5 w-3.5" /></button>
          <button v-if="config.layers.length > 1" class="rounded bg-white/[0.04] px-2 py-1 text-white/55 hover:bg-white/10" @click="removeLayer(activeLayer)"><X class="h-3.5 w-3.5" /></button>
        </div>
        <template v-if="activeLayer > 0">
          <label class="mb-1 block text-xs text-white/60">Blend</label>
          <select v-model="layer.blend" class="mb-2 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs capitalize">
            <option v-for="b in BLEND_MODES" :key="b" :value="b">{{ b }}</option>
          </select>
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Opacity</span><span class="text-white/40">{{ layer.opacity.toFixed(2) }}</span></label>
          <input v-model.number="layer.opacity" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
        </template>
      </StudioSection>

      <!-- Shape -->
      <StudioSection title="Shape" :badge="`Layer ${activeLayer + 1}`">
        <div class="mb-2 grid grid-cols-4 gap-1">
          <button v-for="s in SHAPE_KINDS" :key="s" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.shape.type === s ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="setShape(s)">{{ s }}</button>
        </div>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Count</span><span class="text-white/40">{{ Math.round(layer.shape.count) }}</span></label>
        <input v-model.number="layer.shape.count" type="range" min="2" max="64" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <template v-if="layer.shape.type === 'wave' || layer.shape.type === 'bands'">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Peaks</span><span class="text-white/40">{{ Math.round(layer.shape.peaks) }}</span></label>
          <input v-model.number="layer.shape.peaks" type="range" min="1" max="12" step="1" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Wave phase</span><span class="text-white/40">{{ layer.shape.phase.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.phase" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <template v-else-if="layer.shape.type === 'noise'">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Detail</span><span class="text-white/40">{{ Math.round(layer.shape.detail) }}</span></label>
          <input v-model.number="layer.shape.detail" type="range" min="1" max="8" step="1" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Scrub</span><span class="text-white/40">{{ layer.shape.scrub.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.scrub" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <template v-else>
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Valley position</span><span class="text-white/40">{{ layer.shape.valley.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.valley" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Min depth</span><span class="text-white/40">{{ layer.shape.minDepth.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.minDepth" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Curve exponent</span><span class="text-white/40">{{ layer.shape.curveExp.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.curveExp" type="range" min="0.2" max="3" step="0.05" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>{{ layer.shape.type === 'bands' ? 'Randomness' : 'Jitter' }}</span><span class="text-white/40">{{ layer.shape.jitter.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.jitter" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Gap</span><span class="text-white/40">{{ layer.shape.gap.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.gap" type="range" min="0" max="0.8" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Rounding</span><span class="text-white/40">{{ layer.shape.rounding.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.rounding" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        <template v-if="isRadial">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Sweep</span><span class="text-white/40">{{ Math.round(layer.shape.sweep) }}°</span></label>
          <input v-model.number="layer.shape.sweep" type="range" min="20" max="360" step="1" v-studio-reset class="studio-range mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Scrub / rotate</span><span class="text-white/40">{{ layer.shape.scrub.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.scrub" type="range" min="0" max="1" step="0.01" v-studio-reset class="studio-range mb-2 w-full" />
        </template>
        <template v-else>
          <label class="mb-1 block text-xs text-white/60">Direction</label>
          <div class="mb-2 grid grid-cols-4 gap-1">
            <button v-for="d in DIRECTIONS" :key="d" class="rounded py-1 text-xs transition"
                    :class="layer.shape.direction === d ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                    @click="layer.shape.direction = d">{{ { up: '↑', right: '→', down: '↓', left: '←' }[d] }}</button>
          </div>
        </template>
        <label class="mb-1 block text-xs text-white/60">Mirror</label>
        <div class="grid grid-cols-4 gap-1">
          <button v-for="mk in MIRROR_KINDS" :key="mk" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.shape.mirror === mk ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="layer.shape.mirror = mk">{{ mk === 'horizontal' ? 'Horiz' : mk === 'vertical' ? 'Vert' : mk }}</button>
        </div>
      </StudioSection>

      <!-- Color -->
      <StudioSection title="Color" :badge="`Layer ${activeLayer + 1}`">
        <div class="mb-2 space-y-1">
          <div v-for="(stop, i) in layer.color.stops" :key="i" class="flex items-center gap-1.5">
            <input v-model="stop.color" type="color" class="h-7 w-8 shrink-0 rounded" />
            <input v-model.number="stop.pos" type="range" min="0" max="1" step="0.01" class="min-w-0 flex-1" />
            <span class="w-9 shrink-0 text-right text-[10px] text-white/40">{{ Math.round(stop.pos * 100) }}%</span>
            <button v-if="layer.color.stops.length > 2" class="shrink-0 text-white/30 hover:text-white/70" @click="removeStop(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <button class="mt-1 flex items-center gap-1 rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/60 hover:text-white" @click="addStop"><Plus class="h-3 w-3" /> Add stop</button>
        </div>
        <label class="mb-1 block text-xs text-white/60">Gradient direction</label>
        <div class="mb-2 grid grid-cols-2 gap-1">
          <button v-for="gd in GRADIENT_DIRS" :key="gd" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.color.gradientDir === gd ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="layer.color.gradientDir = gd">{{ gd }}</button>
        </div>
        <label class="mb-1 block text-xs text-white/60">Mapping</label>
        <div class="mb-2 grid grid-cols-3 gap-1">
          <button v-for="mp in MAPPINGS" :key="mp" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.color.mapping === mp ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="layer.color.mapping = mp">{{ mp }}</button>
        </div>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Steps</span><span class="text-white/40">{{ layer.color.steps || 'off' }}</span></label>
        <input v-model.number="layer.color.steps" type="range" min="0" max="24" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Hue drift</span><span class="text-white/40">{{ Math.round(layer.color.hueDrift) }}°</span></label>
        <input v-model.number="layer.color.hueDrift" type="range" min="-180" max="180" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Hue rotate</span><span class="text-white/40">{{ Math.round(layer.color.hueRotate) }}°</span></label>
        <input v-model.number="layer.color.hueRotate" type="range" min="0" max="360" step="1" v-studio-reset class="studio-range w-full" />
      </StudioSection>

      <!-- Motion -->
      <StudioSection title="Motion" :open="false">
        <template #badge>
          <button class="flex items-center gap-1 normal-case text-white/40 hover:text-white" @click.stop="addTrack"><Plus class="h-3 w-3" /> Track</button>
        </template>
        <p v-if="!config.motion.tracks.length" class="text-[11px] text-white/30">Add a track to animate a parameter and export video.</p>
        <div v-for="(tk, i) in config.motion.tracks" :key="i" class="mb-2 rounded border border-white/10 p-2">
          <div class="mb-1 flex items-center gap-1">
            <select v-model.number="tk.layer" class="rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option v-for="(_, li) in config.layers" :key="li" :value="li">L{{ li + 1 }}</option>
            </select>
            <select v-model="tk.param" class="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option v-for="p in ANIMATABLE" :key="p.key" :value="p.key">{{ p.label }}</option>
            </select>
            <button class="text-white/30 hover:text-white/70" @click="removeTrack(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <div class="mb-1 flex items-center gap-1 text-[11px] text-white/50">
            <span>from</span><input v-model.number="tk.from" type="number" step="0.05" class="w-14 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5" />
            <span>to</span><input v-model.number="tk.to" type="number" step="0.05" class="w-14 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5" />
          </div>
          <div class="flex items-center gap-1">
            <select v-model="tk.easing" class="rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option value="linear">Linear</option><option value="pingpong">Ping-pong</option><option value="easeinout">Ease</option>
            </select>
            <select v-model.number="tk.loops" class="rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
            </select>
            <span class="text-[11px] text-white/40">loops</span>
          </div>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label class="mb-1 flex justify-between text-[11px] text-white/60"><span>Duration</span><span class="text-white/40">{{ config.motion.duration }}s</span></label>
            <input v-model.number="config.motion.duration" type="range" min="1" max="12" step="0.5" v-studio-reset class="studio-range w-full" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/60">FPS</label>
            <select v-model.number="config.motion.fps" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
              <option :value="24">24</option><option :value="30">30</option><option :value="60">60</option>
            </select>
          </div>
        </div>
        <div class="mt-1 text-[10px] text-white/30">{{ Math.round(config.motion.fps * config.motion.duration) }} frames</div>
      </StudioSection>

      <!-- Rolls -->
      <StudioSection title="Rolls" :open="false">
        <template #badge>
          <button v-if="rolls.length" class="normal-case text-white/40 hover:text-white/80" @click.stop="clearRolls">Clear · {{ rolls.length }}</button>
        </template>
        <p v-if="!rolls.length" class="text-[11px] text-white/30">Hit Space — every roll lands here.</p>
        <div v-else class="grid grid-cols-3 gap-1.5">
          <button v-for="(r, i) in rolls" :key="i" class="overflow-hidden rounded border border-white/10 transition hover:border-white/40"
                  :class="{ 'ring-1 ring-white/60': r.seed === config.seed }" :title="r.seed" @click="restoreRoll(r)">
            <img v-if="r.thumb" :src="r.thumb" class="block aspect-video w-full object-cover" />
            <div v-else class="aspect-video w-full bg-white/5" />
          </button>
        </div>
      </StudioSection>

      <!-- Export -->
      <StudioSection title="Export" :open="false">
        <div class="grid grid-cols-2 gap-1.5">
          <button v-for="f in (['png', 'jpg'] as const)" :key="f" class="rounded border px-2 py-1.5 text-xs transition"
                  :class="exportFormat === f ? 'border-white/30 bg-white/15 text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'"
                  @click="exportFormat = f">{{ f.toUpperCase() }}</button>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button v-for="r in EXPORT_RES" :key="r.w" class="rounded border px-1 py-1.5 text-xs transition"
                  :class="exportResW === r.w ? 'border-white/30 bg-white/15 text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'"
                  @click="exportResW = r.w">{{ r.label }}</button>
        </div>
        <div class="text-[10px] text-white/30">{{ exportDims.w }} × {{ exportDims.h }} · {{ exportFormat.toUpperCase() }}</div>
        <button class="w-full rounded-lg bg-white/10 px-3 py-2 text-xs text-white/80 transition hover:bg-white/20" @click="downloadExport">
          Export {{ exportFormat.toUpperCase() }} <span class="text-white/30">E</span>
        </button>
      </StudioSection>
    </template>
  </StudioModalShell>
</template>
