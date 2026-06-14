<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { ribbonEffect, buildRibbonLabel } from '~/lib/spacetype/effects/ribbon'
import { defaultsFromControls, type Params } from '~/lib/spacetype/effect'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { ensureSpaceTypeBake, type SpaceTypeBake } from '~/lib/spacetype/bake'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'add-clip', bake: SpaceTypeBake): void; (e: 'save-poster', blob: Blob): void }>()

const W = 960, H = 540, FPS = 30
const effect = ribbonEffect
const params = reactive<Params>(defaultsFromControls(effect.controls))
const loopDuration = ref(4)
const transparent = ref(false)
const bgColor = ref('#0e0e10')

const canvas = ref<HTMLCanvasElement | null>(null)
let engine: SpaceTypeEngine | null = null
let raf = 0
let previewFrame = 0
const baking = ref(false)

function texOpts() {
  return {
    label: buildRibbonLabel(String(params.text), params.case === 'upper' ? 'upper' as const : 'as-typed' as const),
    fontFamily: 'Inter', fontWeight: 700, axes: { wght: 700 }, typeColor: String(params.typeColor),
  }
}

function rebuild() {
  previewFrame = 0
  engine?.build(params, texOpts())
}

function startPreview() {
  const tick = () => {
    previewFrame = (previewFrame + 1) % Math.max(1, Math.round(FPS * loopDuration.value))
    engine?.renderFrame(previewFrame, params)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

function stopPreview() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

onMounted(() => {
  if (!canvas.value) return
  engine = new SpaceTypeEngine(canvas.value, {
    effect, width: W, height: H, fps: FPS, loopDuration: loopDuration.value,
    alpha: transparent.value, bgColor: bgColor.value,
  })
  rebuild()
  startPreview()
})

onBeforeUnmount(() => { stopPreview(); engine?.dispose(); engine = null })

// Row count is structural — it changes the number of meshes, so rebuild the scene.
watch(() => params.rows, () => rebuild())
// Transparency + background apply live via render-time clear settings (no renderer rebuild).
watch([transparent, bgColor], () => engine?.setBackground(transparent.value, bgColor.value))
// Loop length affects the engine's frameCount used during bake.
watch(loopDuration, d => engine?.setLoopDuration(d))

const cfg = computed(() => ({
  effectId: effect.id, params: { ...params }, fps: FPS, loopDuration: loopDuration.value,
  W, H, alpha: transparent.value, bgColor: bgColor.value,
}))

async function addToTimeline() {
  if (!engine) return
  baking.value = true
  stopPreview()
  try {
    rebuild()
    const bake = await ensureSpaceTypeBake(cfg.value, undefined, {
      renderFrame: async (i) => { engine!.renderFrame(i, params); return engine!.frameToBlob() },
    })
    emit('add-clip', bake)
  } finally {
    baking.value = false
    startPreview()
  }
}

async function savePoster() {
  if (!engine) return
  stopPreview()
  try {
    engine.renderFrame(0, params)
    emit('save-poster', await engine.frameToBlob())
  } finally {
    startPreview()
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div class="flex max-h-[90vh] w-[1100px] max-w-[95vw] gap-4 rounded-xl bg-neutral-900 p-4 text-white">
      <div class="flex-1">
        <canvas ref="canvas" :width="W" :height="H" class="w-full rounded-lg" style="background:#0e0e10" />
        <div class="mt-3 flex gap-2">
          <button class="rounded bg-emerald-600 px-3 py-1.5 text-sm" :disabled="baking" @click="addToTimeline">
            {{ baking ? 'Baking…' : 'Add to timeline' }}
          </button>
          <button class="rounded bg-white/10 px-3 py-1.5 text-sm" @click="savePoster">Save poster</button>
          <button class="ml-auto rounded bg-white/10 px-3 py-1.5 text-sm" @click="emit('close')">Close</button>
        </div>
      </div>
      <div class="w-72 shrink-0 space-y-3 overflow-y-auto pr-1">
        <div v-for="c in effect.controls" :key="c.key" data-control class="text-xs">
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
        </div>
        <div data-control class="text-xs">
          <label class="mb-1 block text-white/60">Loop seconds</label>
          <input type="range" min="1" max="10" step="0.5" v-model.number="loopDuration" class="w-full" />
        </div>
        <label data-control class="flex items-center gap-2 text-xs text-white/60">
          <input type="checkbox" v-model="transparent" /> Transparent background
        </label>
      </div>
    </div>
  </div>
</template>
