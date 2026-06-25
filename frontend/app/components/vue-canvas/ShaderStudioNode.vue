<!-- frontend/app/components/vue-canvas/ShaderStudioNode.vue -->
<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Pencil, Sparkles } from 'lucide-vue-next'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { shaderFx } from '~/lib/shaderfx/renderer'
import type { ShaderFxCatalog, EffectDef } from '~/lib/shaderfx/types'
import { composePasses } from '~/lib/shaderstudio/passes'
import { applyMotion } from '~/lib/shaderstudio/motion'
import { loadImage, resolveWiredInput } from '~/lib/shaderstudio/source'
import { hydrateConfig, outputDims, type ShaderStudioConfig } from '~/lib/shaderstudio/types'

const props = defineProps<{
  id: string
  data: { nodeType: string; title?: string; mode?: number; properties?: Record<string, any> }
}>()

const PREVIEW_W = 220
const injectedEdges = inject<any>('vueFlowEdges', null)
const injectedNodes = inject<any>('vueFlowNodes', null)

const config = computed<ShaderStudioConfig>(
  () => hydrateConfig(props.data?.properties?.comfynext_shaderStudio),
)
const animated = computed(() => (config.value.motion?.tracks?.length ?? 0) > 0)

const canvasEl = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)
const catalog = ref<ShaderFxCatalog | null>(null)
const baseImage = ref<HTMLImageElement | null>(null)

const wiredUrl = computed(() =>
  resolveWiredInput(props.id, injectedNodes?.value ?? [], injectedEdges?.value ?? []))
const sourceUrl = computed(() => wiredUrl.value ?? config.value.source.dataUrl
  ?? (config.value.source.asset ? `/view?${new URLSearchParams({ filename: config.value.source.asset, type: 'input' })}` : null))

watch(sourceUrl, async (url) => {
  baseImage.value = null
  if (!url) { renderFrame(0); return }
  try { baseImage.value = await loadImage(url); renderFrame(0) } catch { baseImage.value = null }
}, { immediate: true })

function effectDef(id: string): EffectDef | null {
  return catalog.value?.effects.find(e => e.id === id) ?? null
}

function renderFrame(t: number) {
  const el = canvasEl.value
  if (!el) return
  const base = baseImage.value
  if (!base) { el.width = PREVIEW_W; el.height = Math.round(PREVIEW_W * 9 / 16); el.getContext('2d')!.clearRect(0, 0, el.width, el.height); return }
  const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, PREVIEW_W)
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try {
    const cfg = animated.value ? applyMotion(config.value, t) : config.value
    const passes = composePasses(cfg, effectDef(cfg.effect.id), t)
    el.getContext('2d')!.drawImage(shaderFx.render(passes, base, w, h), 0, 0)
    glError.value = null
  } catch (e: any) { glError.value = String(e?.message ?? e) }
}

let raf = 0, start = 0
function loop(ts: number) {
  if (!start) start = ts
  const dur = Math.max(0.1, config.value.motion?.duration ?? 4)
  renderFrame(((ts - start) / 1000) % dur)
  raf = requestAnimationFrame(loop)
}
function startLoop() {
  cancelAnimationFrame(raf); start = 0
  if (animated.value) raf = requestAnimationFrame(loop)
  else renderFrame(0)
}

onMounted(async () => {
  catalog.value = await fetchShaderFxCatalog().catch(() => null)
  startLoop()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

let timer: ReturnType<typeof setTimeout> | null = null
watch(config, () => { if (timer) clearTimeout(timer); timer = setTimeout(startLoop, 60) }, { deep: true })
watch(animated, startLoop)

function openEditor() {
  window.dispatchEvent(new CustomEvent('comfynext:openShaderStudio', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="relative w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg"
    @dblclick.stop="openEditor"
  >
    <!-- Input handle (image in) -->
    <Handle id="input-0" type="target" :position="Position.Left"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/40 !bg-[#1a1a1a]" :style="{ top: '50%' }" />
    <!-- Output handle (provenance to generated Image/Video) -->
    <Handle id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]" :style="{ top: '50%' }" />

    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Sparkles class="h-3.5 w-3.5 text-white/70" />
      <span class="text-xs font-medium text-white/80">Shader Studio</span>
      <span class="ml-auto truncate text-[10px] uppercase tracking-wide text-white/40">{{ config.effect.id || 'no effect' }}</span>
    </div>

    <div class="flex items-center justify-center bg-neutral-950 aspect-video">
      <canvas ref="canvasEl" class="block max-h-full max-w-full" />
      <span v-if="!baseImage" class="absolute text-[10px] text-white/30">Connect or add an image</span>
    </div>
    <div v-if="glError" class="px-3 py-1 text-[10px] text-red-300/90 truncate" :title="glError">{{ glError }}</div>

    <div class="border-t border-white/10 p-2">
      <button
        class="flex w-full items-center justify-center gap-1.5 rounded bg-white/10 px-2 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="openEditor"
      >
        <Pencil class="h-3 w-3" /> Edit
      </button>
    </div>
  </div>
</template>
