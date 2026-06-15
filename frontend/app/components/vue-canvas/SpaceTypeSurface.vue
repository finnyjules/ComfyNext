<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { buildRibbonLabel } from '~/lib/spacetype/effects/ribbon'
import { SPACE_TYPE_EFFECTS, getEffect } from '~/lib/spacetype/effects'
import { defaultsFromControls, type Params } from '~/lib/spacetype/effect'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { VARIABLE_FONTS } from '~/data/variable-fonts'
import type { GradientStop } from '~/lib/spacetype/gradient'

const props = defineProps<{ nodeId: string; nodes: any[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

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
const dimsKey = ref('960 × 540 (16:9)')
const W = ref(960)
const H = ref(540)
const effectId = ref('ribbon')
const effect = computed(() => getEffect(effectId.value))
const params = reactive<Params>(defaultsFromControls(effect.value.controls))
const loopDuration = ref(6)
const transparent = ref(false)
const bgColor = ref('#0e0e10')

const canvas = ref<HTMLCanvasElement | null>(null)
let engine: SpaceTypeEngine | null = null
let raf = 0
let previewFrame = 0
let previewStart = 0
const baking = ref(false)

// Collapsible control sections. Effect controls declare their `group`; surface-only
// controls (gradient stops, loop, dimensions, transparent) are injected per section.
const SECTION_ORDER = ['Type', 'Ribbon', 'Snake', 'Color', 'Shadow', 'Motion', 'Transform', 'Output'] as const
const openSections = reactive<Record<string, boolean>>({
  Type: true, Ribbon: true, Color: true, Snake: false, Shadow: false, Motion: false, Transform: false, Output: false,
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

const loadedFontIds = new Set<string>()
async function ensureFont(id: string) {
  const f = VARIABLE_FONTS.find(v => v.id === id) ?? VARIABLE_FONTS[0]
  if (!f) return
  if (!loadedFontIds.has(f.id)) {
    if (!document.querySelector(`link[data-stg-font="${f.id}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = f.cssUrl; link.setAttribute('data-stg-font', f.id)
      document.head.appendChild(link)
    }
    loadedFontIds.add(f.id)
  }
  try { await document.fonts.load(`700 32px "${f.family}"`) } catch { /* best-effort */ }
}

function texOpts() {
  const f = VARIABLE_FONTS.find(v => v.id === String(params.font)) ?? VARIABLE_FONTS[0]
  return {
    label: buildRibbonLabel(String(params.text), 'upper'),
    fontFamily: f?.family ?? 'Inter',
    fontWeight: 700,
    axes: { wght: 700 },
    typeColor: String(params.typeColor),
    fontSizePx: Number(params.typeHeight),
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
  if (typeof c.dimsKey === 'string' && DIMS[c.dimsKey]) {
    dimsKey.value = c.dimsKey
    const d = DIMS[c.dimsKey]!
    W.value = d[0]; H.value = d[1]
  }
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
    dimsKey: dimsKey.value, transparent: transparent.value, bgColor: bgColor.value,
  }
}

function closeEditor() { saveConfig(); emit('close') }

onMounted(async () => {
  if (!canvas.value) return
  // Restore saved config BEFORE building the engine so the first render is
  // already the user's authored state (not the defaults).
  loadConfig()
  engine = new SpaceTypeEngine(canvas.value, {
    effect: effect.value, width: W.value, height: H.value, fps: fps.value, loopDuration: loopDuration.value,
    alpha: transparent.value, bgColor: bgColor.value,
  })
  await ensureFont(String(params.font))
  rebuild()
  startPreview()
})

onBeforeUnmount(() => { saveConfig(); stopPreview(); engine?.dispose(); engine = null })

// Most v2 params change geometry/material/texture and need a rebuild; only speed,
// scale, rotateX/Y/Z are live (read per-frame). Watch a structural signature.
watch(
  () => JSON.stringify({ ...params, speed: 0, scale: 0, rotateX: 0, rotateY: 0, rotateZ: 0, ribbonRotateX: 0, ribbonRotateY: 0, ribbonRotateZ: 0 }) + JSON.stringify(gradientStops),
  async () => { await ensureFont(String(params.font)); rebuild() },
)
// Switching effect: reset params to the new effect's defaults, but carry over any
// param values the two effects share (text/font/typeColor/etc.) so they persist
// across the switch. Then point the engine at the new effect and rebuild.
watch(effectId, async () => {
  const next = defaultsFromControls(effect.value.controls)
  for (const k of Object.keys(next)) if (k in params) next[k] = (params as any)[k]
  for (const k of Object.keys(params)) delete (params as any)[k]
  Object.assign(params, next)
  await ensureFont(String(params.font))
  engine?.setEffect(effect.value)
  rebuild()
})
// Transparency + background apply live via render-time clear settings (no renderer rebuild).
watch([transparent, bgColor], () => engine?.setBackground(transparent.value, bgColor.value))
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

const cfg = computed(() => ({
  effectId: effect.value.id, params: { ...params }, fps: fps.value, loopDuration: loopDuration.value,
  W: W.value, H: H.value, alpha: transparent.value, bgColor: bgColor.value,
}))

async function generateImage() {
  if (!engine) return
  baking.value = true
  stopPreview()
  try {
    await ensureFont(String(params.font))
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
    await ensureFont(String(params.font))
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
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div class="flex h-[620px] max-h-[92vh] w-[1100px] max-w-[95vw] gap-4 rounded-xl bg-neutral-900 p-4 text-white">
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex min-h-0 flex-1 items-center justify-center">
          <canvas ref="canvas" class="max-h-full max-w-full rounded-lg" style="background:#0e0e10" />
        </div>
        <div class="mt-3 flex shrink-0 gap-2">
          <button class="rounded bg-blue-600 px-3 py-1.5 text-sm" :disabled="baking" @click="generateImage">
            {{ baking ? 'Generating…' : 'Generate as image' }}
          </button>
          <button class="rounded bg-emerald-600 px-3 py-1.5 text-sm" :disabled="baking" @click="generateVideo">
            {{ baking ? 'Generating…' : 'Generate as video' }}
          </button>
          <button class="ml-auto rounded bg-white/10 px-3 py-1.5 text-sm" @click="closeEditor">Close</button>
        </div>
      </div>
      <div class="w-72 shrink-0 space-y-2 overflow-y-auto pr-1 min-h-0">
        <div class="rounded-lg bg-white/5 px-3 py-2">
          <label class="mb-1 block text-xs text-white/60">Effect</label>
          <select v-model="effectId" class="w-full rounded bg-white/10 px-2 py-1 text-xs">
            <option v-for="e in SPACE_TYPE_EFFECTS" :key="e.id" :value="e.id">{{ e.label }}</option>
          </select>
        </div>
        <details
          v-for="section in sections" :key="section.name"
          :open="openSections[section.name]"
          @toggle="openSections[section.name] = ($event.target as HTMLDetailsElement).open"
          class="rounded-lg bg-white/5"
        >
          <summary class="cursor-pointer select-none px-3 py-2 text-xs font-medium text-white/80">
            {{ section.name }}
          </summary>
          <div class="space-y-3 px-3 pb-3">
            <div v-for="c in section.controls" :key="c.key" data-control class="text-xs">
              <label class="mb-1 block text-white/60">{{ c.label }}</label>
              <input v-if="c.kind === 'slider'" type="range" :min="c.min" :max="c.max" :step="c.step"
                     v-model.number="params[c.key]" class="w-full" />
              <input v-else-if="c.kind === 'text'" type="text" v-model="params[c.key]"
                     class="w-full rounded bg-white/10 px-2 py-1" @input="rebuild" />
              <input v-else-if="c.kind === 'color'" type="color" v-model="params[c.key]" @input="rebuild" />
              <select v-else-if="c.kind === 'select'" v-model="params[c.key]"
                      class="w-full rounded bg-white/10 px-2 py-1" @change="rebuild">
                <option v-for="o in c.options" :key="o" :value="o">{{ o }}</option>
              </select>
              <select v-else-if="c.kind === 'font'" v-model="params[c.key]"
                      class="w-full rounded bg-white/10 px-2 py-1">
                <option v-for="f in VARIABLE_FONTS" :key="f.id" :value="f.id">{{ f.label }}</option>
              </select>
            </div>

            <div v-if="section.name === 'Color'" data-control class="text-xs">
              <label class="mb-1 block text-white/60">Gradient stops</label>
              <div v-for="(s, i) in gradientStops" :key="i" class="mb-1 flex items-center gap-2">
                <input type="checkbox" v-model="s.on" />
                <input type="color" v-model="s.color" />
              </div>
            </div>

            <template v-if="section.name === 'Output'">
              <div data-control class="text-xs">
                <label class="mb-1 block text-white/60">Dimensions</label>
                <select v-model="dimsKey" class="w-full rounded bg-white/10 px-2 py-1">
                  <option v-for="k in Object.keys(DIMS)" :key="k" :value="k">{{ k }}</option>
                </select>
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
                <input type="range" min="1" max="15" step="0.5" v-model.number="loopDuration" class="w-full" />
              </div>
              <label data-control class="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" v-model="transparent" /> Transparent background
              </label>
            </template>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>
