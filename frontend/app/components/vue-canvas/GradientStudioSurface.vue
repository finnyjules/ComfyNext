<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Dices, Lock, Palette, Plus, Shapes, Trash2, Unlock, X } from 'lucide-vue-next'
import { gradientFx } from '~/lib/gradientfx/renderer'
import { buildConfig, defaultConfig, reroll, type RerollScope } from '~/lib/gradientfx/randomize'
import { randomSeed } from '~/lib/gradientfx/rng'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { ANIMATABLE } from '~/lib/gradientfx/motion'
import {
  ASPECTS, BLEND_MODES, DIRECTIONS, LAYOUTS, MAPPINGS, SHAPE_KINDS,
  aspectRatio, cloneConfig, type GradientConfig, type LayoutKind, type ShapeKind,
} from '~/lib/gradientfx/types'

const props = defineProps<{ nodeId: string; nodes: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

// ── config (single source of truth) ─────────────────────────────────────────
const config = ref<GradientConfig>(defaultConfig('#default0'))
const activeLayer = ref(0)
const layer = computed(() => config.value.layers[activeLayer.value] ?? config.value.layers[0]!)
const isRadial = computed(() => config.value.canvas.layout !== 'linear')

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

// ── locks ─────────────────────────────────────────────────────────────────
function toggleLock(key: string) {
  const locks = (config.value.locks ||= {})
  locks[key] = !locks[key]
}
const locked = (key: string) => !!config.value.locks?.[key]

// ── layers ──────────────────────────────────────────────────────────────────
function addLayer() {
  if (config.value.layers.length >= 2) return
  const seed = randomSeed()
  const extra = buildConfig(seed).layers[0]!
  extra.blend = 'lighten'; extra.opacity = 1
  config.value.layers.push(extra)
  activeLayer.value = config.value.layers.length - 1
}
function removeLayer(i: number) {
  if (config.value.layers.length <= 1) return
  config.value.layers.splice(i, 1)
  activeLayer.value = Math.min(activeLayer.value, config.value.layers.length - 1)
}

// ── colour stops ─────────────────────────────────────────────────────────────
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
  if (c && typeof c === 'object') config.value = cloneConfig(c)
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
  else if (e.key === 'c' || e.key === 'C') randomize('colours')
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
  <div class="fixed inset-0 z-50 flex bg-neutral-950 text-white">
    <!-- ── Left rail: randomize, rolls, export ── -->
    <div class="flex w-64 shrink-0 flex-col border-r border-white/10 bg-neutral-900">
      <div class="space-y-2 p-3">
        <button class="flex w-full items-center justify-center gap-2 rounded-lg bg-white/90 px-3 py-2.5 text-sm font-semibold text-black transition hover:bg-white"
                @click="randomize('all')">
          <Dices class="h-4 w-4" /> Randomize <span class="ml-1 text-xs text-black/40">Space</span>
        </button>
        <div class="grid grid-cols-2 gap-2">
          <button class="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-xs text-white/80 transition hover:bg-white/[0.1]"
                  @click="randomize('colours')"><Palette class="h-3.5 w-3.5" /> Colours <span class="text-white/30">C</span></button>
          <button class="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2 text-xs text-white/80 transition hover:bg-white/[0.1]"
                  @click="randomize('structure')"><Shapes class="h-3.5 w-3.5" /> Structure <span class="text-white/30">S</span></button>
        </div>
      </div>

      <!-- Rolls -->
      <div class="flex items-center justify-between px-3 pb-1 pt-2 text-[11px] text-white/50">
        <span>Rolls <span class="text-white/30">{{ rolls.length }}</span></span>
        <button v-if="rolls.length" class="text-white/40 hover:text-white/80" @click="clearRolls">CLEAR</button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <p v-if="!rolls.length" class="px-1 py-4 text-[11px] text-white/30">Hit Space — every roll lands here.</p>
        <div v-else class="grid grid-cols-3 gap-1.5">
          <button v-for="(r, i) in rolls" :key="i" class="overflow-hidden rounded border border-white/10 transition hover:border-emerald-400/70"
                  :class="{ 'ring-1 ring-emerald-400': r.seed === config.seed }" :title="r.seed" @click="restoreRoll(r)">
            <img v-if="r.thumb" :src="r.thumb" class="block aspect-video w-full object-cover" />
            <div v-else class="aspect-video w-full bg-white/5" />
          </button>
        </div>
      </div>

      <!-- Export -->
      <div class="space-y-2 border-t border-white/10 p-3">
        <div class="text-[11px] uppercase tracking-wide text-white/40">Export</div>
        <div class="grid grid-cols-2 gap-1.5">
          <button v-for="f in (['png', 'jpg'] as const)" :key="f"
                  class="rounded border px-2 py-1.5 text-xs transition"
                  :class="exportFormat === f ? 'border-emerald-400/60 bg-emerald-400/10 text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'"
                  @click="exportFormat = f">{{ f.toUpperCase() }}</button>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button v-for="r in EXPORT_RES" :key="r.w"
                  class="rounded border px-1 py-1.5 text-xs transition"
                  :class="exportResW === r.w ? 'border-emerald-400/60 bg-emerald-400/10 text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'"
                  @click="exportResW = r.w">{{ r.label }}</button>
        </div>
        <div class="text-[10px] text-white/30">{{ exportDims.w }} × {{ exportDims.h }} · {{ exportFormat.toUpperCase() }}</div>
        <button class="w-full rounded-lg bg-white/10 px-3 py-2 text-xs text-white/80 transition hover:bg-white/20" @click="downloadExport">
          Export {{ exportFormat.toUpperCase() }} <span class="text-white/30">E</span>
        </button>
      </div>
    </div>

    <!-- ── Center: preview ── -->
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span class="h-2.5 w-2.5 rounded-sm bg-emerald-400" />
        <span class="text-sm font-semibold tracking-wide">GRADIENT STUDIO</span>
        <span class="ml-auto font-mono text-xs text-white/40">{{ exportDims.w }} × {{ exportDims.h }}</span>
        <span class="font-mono text-xs text-white/40">{{ config.seed }}</span>
        <button class="ml-2 rounded p-1 text-white/50 hover:bg-white/10 hover:text-white" @click="closeEditor"><X class="h-4 w-4" /></button>
      </div>
      <div class="flex min-h-0 flex-1 items-center justify-center p-6">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg shadow-2xl" />
      </div>
      <div class="flex shrink-0 items-center gap-2 border-t border-white/10 px-4 py-3">
        <button class="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/85 hover:bg-white/20" :disabled="baking" @click="generateImage">
          {{ baking ? (bakeMsg || 'Working…') : 'Generate as image' }}
        </button>
        <button class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500" :disabled="baking" @click="generateVideo">
          {{ baking ? (bakeMsg || 'Working…') : 'Generate as video' }}
        </button>
        <span v-if="glError" class="ml-2 truncate text-xs text-red-300/80">{{ glError }}</span>
        <button class="ml-auto rounded-lg bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10" @click="closeEditor">Close</button>
      </div>
    </div>

    <!-- ── Right: controls ── -->
    <div class="w-72 shrink-0 space-y-2 overflow-y-auto border-l border-white/10 bg-neutral-900 p-3">
      <!-- Canvas -->
      <section class="rounded-lg bg-white/5 p-3">
        <div class="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-white/50">
          <span>Canvas</span><span class="text-white/30">both layers</span>
        </div>
        <label class="mb-1 flex items-center justify-between text-xs text-white/60">
          <span>Aspect ratio</span>
          <button class="text-white/30 hover:text-white/70" @click="toggleLock('aspect')"><component :is="locked('aspect') ? Lock : Unlock" class="h-3 w-3" /></button>
        </label>
        <select v-model="config.canvas.aspect" class="mb-2 w-full rounded bg-white/10 px-2 py-1 text-xs">
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
        <input v-model.number="config.canvas.margin" type="range" min="0" max="0.45" step="0.01" class="mb-2 w-full" />
        <template v-if="isRadial">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Inner radius</span><span class="text-white/40">{{ config.canvas.innerRadius.toFixed(2) }}</span></label>
          <input v-model.number="config.canvas.innerRadius" type="range" min="0" max="0.9" step="0.01" class="mb-2 w-full" />
        </template>
        <label class="mb-1 block text-xs text-white/60">Background</label>
        <input v-model="config.canvas.background" type="color" class="h-7 w-full rounded" />
      </section>

      <!-- Relief & grain -->
      <section class="rounded-lg bg-white/5 p-3">
        <div class="mb-2 text-[11px] uppercase tracking-wide text-white/50">Relief &amp; grain</div>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Grain</span><span class="text-white/40">{{ config.relief.grain.toFixed(2) }}</span></label>
        <input v-model.number="config.relief.grain" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Relief</span><span class="text-white/40">{{ config.relief.relief.toFixed(2) }}</span></label>
        <input v-model.number="config.relief.relief" type="range" min="0" max="1" step="0.01" class="w-full" />
      </section>

      <!-- Layers -->
      <section class="rounded-lg bg-white/5 p-3">
        <div class="mb-2 text-[11px] uppercase tracking-wide text-white/50">Layers</div>
        <div class="mb-2 flex gap-1">
          <button v-for="(_, i) in config.layers" :key="i" class="flex-1 rounded px-2 py-1 text-xs transition"
                  :class="activeLayer === i ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="activeLayer = i">{{ i + 1 }}</button>
          <button v-if="config.layers.length < 2" class="rounded bg-white/[0.04] px-2 py-1 text-white/55 hover:bg-white/10" @click="addLayer"><Plus class="h-3.5 w-3.5" /></button>
          <button v-if="config.layers.length > 1" class="rounded bg-white/[0.04] px-2 py-1 text-white/55 hover:bg-white/10" @click="removeLayer(activeLayer)"><X class="h-3.5 w-3.5" /></button>
        </div>
        <template v-if="activeLayer > 0">
          <label class="mb-1 block text-xs text-white/60">Blend</label>
          <select v-model="layer.blend" class="mb-2 w-full rounded bg-white/10 px-2 py-1 text-xs capitalize">
            <option v-for="b in BLEND_MODES" :key="b" :value="b">{{ b }}</option>
          </select>
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Opacity</span><span class="text-white/40">{{ layer.opacity.toFixed(2) }}</span></label>
          <input v-model.number="layer.opacity" type="range" min="0" max="1" step="0.01" class="w-full" />
        </template>
      </section>

      <!-- Shape -->
      <section class="rounded-lg bg-white/5 p-3">
        <div class="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-white/50">
          <span>Shape</span><span class="text-white/30">Layer {{ activeLayer + 1 }}</span>
        </div>
        <div class="mb-2 grid grid-cols-4 gap-1">
          <button v-for="s in SHAPE_KINDS" :key="s" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.shape.type === s ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="setShape(s)">{{ s }}</button>
        </div>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Count</span><span class="text-white/40">{{ Math.round(layer.shape.count) }}</span></label>
        <input v-model.number="layer.shape.count" type="range" min="2" max="64" step="1" class="mb-2 w-full" />
        <template v-if="layer.shape.type === 'wave' || layer.shape.type === 'bands'">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Peaks</span><span class="text-white/40">{{ Math.round(layer.shape.peaks) }}</span></label>
          <input v-model.number="layer.shape.peaks" type="range" min="1" max="12" step="1" class="mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Wave phase</span><span class="text-white/40">{{ layer.shape.phase.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.phase" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
        </template>
        <template v-else-if="layer.shape.type === 'noise'">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Detail</span><span class="text-white/40">{{ Math.round(layer.shape.detail) }}</span></label>
          <input v-model.number="layer.shape.detail" type="range" min="1" max="8" step="1" class="mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Scrub</span><span class="text-white/40">{{ layer.shape.scrub.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.scrub" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
        </template>
        <template v-else>
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Valley position</span><span class="text-white/40">{{ layer.shape.valley.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.valley" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
        </template>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Min depth</span><span class="text-white/40">{{ layer.shape.minDepth.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.minDepth" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Curve exponent</span><span class="text-white/40">{{ layer.shape.curveExp.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.curveExp" type="range" min="0.2" max="3" step="0.05" class="mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Jitter</span><span class="text-white/40">{{ layer.shape.jitter.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.jitter" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Gap</span><span class="text-white/40">{{ layer.shape.gap.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.gap" type="range" min="0" max="0.8" step="0.01" class="mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Rounding</span><span class="text-white/40">{{ layer.shape.rounding.toFixed(2) }}</span></label>
        <input v-model.number="layer.shape.rounding" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
        <template v-if="isRadial">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Sweep</span><span class="text-white/40">{{ Math.round(layer.shape.sweep) }}°</span></label>
          <input v-model.number="layer.shape.sweep" type="range" min="20" max="360" step="1" class="mb-2 w-full" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Scrub / rotate</span><span class="text-white/40">{{ layer.shape.scrub.toFixed(2) }}</span></label>
          <input v-model.number="layer.shape.scrub" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
        </template>
        <template v-else>
          <label class="mb-1 block text-xs text-white/60">Direction</label>
          <div class="mb-2 grid grid-cols-4 gap-1">
            <button v-for="d in DIRECTIONS" :key="d" class="rounded py-1 text-xs transition"
                    :class="layer.shape.direction === d ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                    @click="layer.shape.direction = d">{{ { up: '↑', right: '→', down: '↓', left: '←' }[d] }}</button>
          </div>
        </template>
        <label class="flex items-center gap-2 text-xs text-white/60"><input v-model="layer.shape.mirror" type="checkbox" /> Mirror</label>
      </section>

      <!-- Colour -->
      <section class="rounded-lg bg-white/5 p-3">
        <div class="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-white/50">
          <span>Colour</span><span class="text-white/30">Layer {{ activeLayer + 1 }}</span>
        </div>
        <div class="mb-2 space-y-1">
          <div v-for="(stop, i) in layer.color.stops" :key="i" class="flex items-center gap-1.5">
            <input v-model="stop.color" type="color" class="h-7 w-8 shrink-0 rounded" />
            <input v-model.number="stop.pos" type="range" min="0" max="1" step="0.01" class="min-w-0 flex-1" />
            <span class="w-9 shrink-0 text-right text-[10px] text-white/40">{{ Math.round(stop.pos * 100) }}%</span>
            <button v-if="layer.color.stops.length > 2" class="shrink-0 text-white/30 hover:text-white/70" @click="removeStop(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <button class="mt-1 flex items-center gap-1 rounded bg-white/[0.06] px-2 py-1 text-[11px] text-white/60 hover:text-white" @click="addStop"><Plus class="h-3 w-3" /> Add stop</button>
        </div>
        <label class="mb-1 block text-xs text-white/60">Mapping</label>
        <div class="mb-2 grid grid-cols-3 gap-1">
          <button v-for="mp in MAPPINGS" :key="mp" class="rounded px-1 py-1 text-[11px] capitalize transition"
                  :class="layer.color.mapping === mp ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="layer.color.mapping = mp">{{ mp }}</button>
        </div>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Steps</span><span class="text-white/40">{{ layer.color.steps || 'off' }}</span></label>
        <input v-model.number="layer.color.steps" type="range" min="0" max="24" step="1" class="mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Hue drift</span><span class="text-white/40">{{ Math.round(layer.color.hueDrift) }}°</span></label>
        <input v-model.number="layer.color.hueDrift" type="range" min="-180" max="180" step="1" class="mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Hue rotate</span><span class="text-white/40">{{ Math.round(layer.color.hueRotate) }}°</span></label>
        <input v-model.number="layer.color.hueRotate" type="range" min="0" max="360" step="1" class="w-full" />
      </section>

      <!-- Motion -->
      <section class="rounded-lg bg-white/5 p-3">
        <div class="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-white/50">
          <span>Motion</span>
          <button class="flex items-center gap-1 text-white/40 hover:text-white" @click="addTrack"><Plus class="h-3 w-3" /> Track</button>
        </div>
        <p v-if="!config.motion.tracks.length" class="mb-2 text-[11px] text-white/30">Add a track to animate a parameter and export video.</p>
        <div v-for="(tk, i) in config.motion.tracks" :key="i" class="mb-2 rounded border border-white/10 p-2">
          <div class="mb-1 flex items-center gap-1">
            <select v-model.number="tk.layer" class="rounded bg-white/10 px-1 py-0.5 text-[11px]">
              <option v-for="(_, li) in config.layers" :key="li" :value="li">L{{ li + 1 }}</option>
            </select>
            <select v-model="tk.param" class="min-w-0 flex-1 rounded bg-white/10 px-1 py-0.5 text-[11px]">
              <option v-for="p in ANIMATABLE" :key="p.key" :value="p.key">{{ p.label }}</option>
            </select>
            <button class="text-white/30 hover:text-white/70" @click="removeTrack(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <div class="mb-1 flex items-center gap-1 text-[11px] text-white/50">
            <span>from</span><input v-model.number="tk.from" type="number" step="0.05" class="w-14 rounded bg-white/10 px-1 py-0.5" />
            <span>to</span><input v-model.number="tk.to" type="number" step="0.05" class="w-14 rounded bg-white/10 px-1 py-0.5" />
          </div>
          <div class="flex items-center gap-1">
            <select v-model="tk.easing" class="rounded bg-white/10 px-1 py-0.5 text-[11px]">
              <option value="linear">Linear</option><option value="pingpong">Ping-pong</option><option value="easeinout">Ease</option>
            </select>
            <select v-model.number="tk.loops" class="rounded bg-white/10 px-1 py-0.5 text-[11px]">
              <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="4">4</option>
            </select>
            <span class="text-[11px] text-white/40">loops</span>
          </div>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label class="mb-1 flex justify-between text-[11px] text-white/60"><span>Duration</span><span class="text-white/40">{{ config.motion.duration }}s</span></label>
            <input v-model.number="config.motion.duration" type="range" min="1" max="12" step="0.5" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/60">FPS</label>
            <select v-model.number="config.motion.fps" class="w-full rounded bg-white/10 px-1 py-0.5 text-[11px]">
              <option :value="24">24</option><option :value="30">30</option><option :value="60">60</option>
            </select>
          </div>
        </div>
        <div class="mt-1 text-[10px] text-white/30">{{ Math.round(config.motion.fps * config.motion.duration) }} frames</div>
      </section>
    </div>
  </div>
</template>
