<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { Sparkles } from 'lucide-vue-next'
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getTypeColor } from '~/composables/useVueNodes'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { walkShaderChain } from '~/lib/shaderfx/chain'
import { parseParams, resolveUniforms, serializeParams } from '~/lib/shaderfx/params'
import { shaderFx } from '~/lib/shaderfx/renderer'
import type { EffectDef, ShaderFxCatalog } from '~/lib/shaderfx/types'

// ShaderEffect artifact node: live WebGL preview (shared singleton renderer)
// + manifest-driven param sliders. Only selected/hovered nodes animate; the
// rest keep their last rendered frame on a plain 2D canvas.
const props = defineProps<{
  id: string
  selected?: boolean
  data: {
    nodeType: string
    title: string
    inputs: { name: string; type: string; link: number | null }[]
    outputs: { name: string; type: string; links: number[] | null }[]
    widgetsValues: any[]
    widgetDefs?: any[]
    properties?: Record<string, any>
    mode: number
    running?: boolean
    error?: boolean
    images?: string[]
  }
}>()

const isMuted = computed(() => props.data.mode === 2)
const isBypassed = computed(() => props.data.mode === 4)
const imageColor = computed(() => getTypeColor('IMAGE'))

function inputIdx(name: string): number { const i = props.data.inputs?.findIndex(inp => inp.name === name) ?? -1; return i >= 0 ? i : 0 }
function outputIdx(name: string): number { const i = props.data.outputs?.findIndex(o => o.name === name) ?? -1; return i >= 0 ? i : 0 }
const imageInIdx = computed(() => inputIdx('image'))
const imageOutIdx = computed(() => outputIdx('image'))

const injectedEdges = inject<any>('vueFlowEdges', null)
const injectedNodes = inject<any>('vueFlowNodes', null)

const catalog = ref<ShaderFxCatalog | null>(null)
const hovered = ref(false)
const playing = ref(true)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)

// ---- widgets ----------------------------------------------------------------
function widgetIdx(name: string): number {
  return props.data.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
}
function widgetVal(name: string): any {
  const i = widgetIdx(name)
  return i >= 0 ? props.data.widgetsValues?.[i] : undefined
}
function setWidget(name: string, value: any) {
  const i = widgetIdx(name)
  if (i >= 0) props.data.widgetsValues[i] = value
}

const effectId = computed<string>(() => String(widgetVal('effect') ?? ''))
const effectDef = computed<EffectDef | null>(
  () => catalog.value?.effects.find(e => e.id === effectId.value) ?? null,
)
const uniforms = computed<Record<string, number>>(() =>
  effectDef.value ? resolveUniforms(effectDef.value, parseParams(String(widgetVal('params') ?? '{}'))) : {},
)
const seed = computed<number>(() => Number(widgetVal('seed') ?? 42) % 10000)

function setParam(uniform: string, value: number) {
  if (!effectDef.value) return
  const next = { ...uniforms.value, [uniform]: value }
  setWidget('params', serializeParams(effectDef.value, next))
  window.dispatchEvent(new CustomEvent('comfynext:shaderfx-changed', { detail: { id: props.id } }))
  if (!animating.value) renderOnce()
}

// ---- preview rendering --------------------------------------------------------
const PREVIEW_W = 288
const baseImage = ref<HTMLImageElement | null>(null)
const placeholder = makePlaceholder()
let lastChainIds: string[] = []

function makePlaceholder(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 288; c.height = 162
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 288, 162)
  g.addColorStop(0, '#3b2a68'); g.addColorStop(0.55, '#1f6f8b'); g.addColorStop(1, '#e8a33d')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 288, 162)
  return c
}

const chain = computed(() => walkShaderChain(props.id, injectedNodes?.value ?? [], injectedEdges?.value ?? []))

watch(() => chain.value.baseUrl, (url) => {
  baseImage.value = null
  if (!url) return
  const img = new Image()
  img.onload = () => { baseImage.value = img; if (!animating.value) renderOnce() }
  img.src = url
}, { immediate: true })

let epoch = performance.now()
let frozenTime = 0.7

function buildPasses(t: number) {
  if (!catalog.value) return []
  return chain.value.passes
    .map((p) => {
      const def = catalog.value!.effects.find(e => e.id === p.effectId)
      if (!def) return null
      return {
        id: def.id,
        source: def.source,
        uniforms: { ...resolveUniforms(def, p.params), u_time: t, u_seed: p.seed % 10000, ...textureUniforms(def) },
        textures: textureSources(def),
      }
    })
    .filter(Boolean) as any[]
}

// Catalog textures (e.g. glyph atlas) — loaded lazily, cached module-wide
const textureImages = new Map<string, HTMLImageElement>()
function textureSources(def: EffectDef): Record<string, TexImageSource> {
  const out: Record<string, TexImageSource> = {}
  for (const t of def.textures) {
    const img = textureImages.get(t.file)
    if (img?.complete) out[t.uniform] = img
    else if (!img) {
      const el = new Image()
      el.onload = () => { if (!animating.value) renderOnce() }
      el.src = `/comfynext/shader_effects/assets/${encodeURIComponent(t.file)}`
      textureImages.set(t.file, el)
    }
  }
  return out
}
function textureUniforms(def: EffectDef): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of def.textures) for (const [k, v] of Object.entries(t.extraUniforms ?? {})) out[k] = v
  return out
}

function renderFrame(t: number) {
  const canvas = previewCanvas.value
  if (!canvas || !catalog.value) return
  const base = baseImage.value ?? placeholder
  const w = PREVIEW_W
  const h = Math.max(16, Math.round((base.height / base.width) * w))
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  try {
    const out = shaderFx.render(buildPasses(t), base, w, h)
    canvas.getContext('2d')!.drawImage(out, 0, 0)
    glError.value = null
  } catch (e: any) {
    glError.value = String(e?.message ?? e)
  }
}

function renderOnce() { renderFrame(frozenTime) }

// ---- animation lifecycle: only selected/hovered nodes run a rAF loop ---------
const animating = computed(() => (props.selected || hovered.value) && playing.value && !glError.value)
let raf = 0
function loop() {
  frozenTime = (performance.now() - epoch) / 1000
  renderFrame(frozenTime)
  raf = requestAnimationFrame(loop)
}
watch(animating, (on) => {
  cancelAnimationFrame(raf)
  if (on) raf = requestAnimationFrame(loop)
}, { immediate: false })

// Upstream param changes: single-frame refresh so chained previews never go stale
function onUpstreamChange(ev: Event) {
  const changedId = (ev as CustomEvent).detail?.id
  if (changedId === props.id) return
  if (lastChainIds.includes(changedId) && !animating.value) renderOnce()
}

onMounted(async () => {
  catalog.value = await fetchShaderFxCatalog().catch(() => null)
  lastChainIds = chain.value.nodeIds
  watch(() => chain.value.nodeIds, ids => { lastChainIds = ids; if (!animating.value) renderOnce() })
  window.addEventListener('comfynext:shaderfx-changed', onUpstreamChange)
  renderOnce()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('comfynext:shaderfx-changed', onUpstreamChange)
})
</script>

<template>
  <div
    class="shader-effect-node relative select-none w-[288px]"
    :class="{ 'opacity-45 grayscale': isMuted, 'opacity-85': isBypassed }"
    :style="{ '--port-color': imageColor } as any"
    :data-running="data.running || undefined"
  >
    <Handle
      :id="`input-${imageInIdx}`" type="target" :position="Position.Left"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />
    <Handle
      :id="`output-${imageOutIdx}`" type="source" :position="Position.Right"
      class="!w-3 !h-3 !rounded-full !border-2 !bg-[#1a1a1a]"
      :style="{ borderColor: imageColor, top: '50%' }"
    />

    <div
      class="shader-shell rounded-lg overflow-hidden bg-[#0e0e0e] border backdrop-blur-sm"
      :class="data.error ? 'border-red-500 ring-2 ring-red-500' : 'border-white/10'"
    >
      <!-- Header -->
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/5">
        <Sparkles class="size-3.5 text-cyan-400 shrink-0" />
        <span class="text-[11px] text-white/70 font-medium truncate">{{ effectDef?.name || 'Shader Effect' }}</span>
        <button
          class="nopan nodrag ml-auto text-[10px] text-white/50 hover:text-white/80 opacity-70 cursor-pointer"
          :title="playing ? 'Pause preview' : 'Play preview'" @click.stop="playing = !playing"
        >{{ playing ? 'Pause' : 'Play' }}</button>
      </div>

      <!-- Live preview -->
      <div @mouseenter="hovered = true" @mouseleave="hovered = false">
        <canvas ref="previewCanvas" class="w-full block bg-checker" />
        <div v-if="glError" class="text-xs text-red-400 p-1">{{ glError }}</div>

        <!-- Manifest-driven param sliders -->
        <div v-if="effectDef" class="space-y-1 p-2">
          <div v-for="p in effectDef.params" :key="p.uniform" class="flex items-center gap-2 text-xs text-white/80">
            <span class="w-20 truncate opacity-70">{{ p.label }}</span>
            <input
              type="range" class="nopan nodrag flex-1 accent-cyan-400" :min="p.min" :max="p.max" :step="p.step"
              :value="uniforms[p.uniform]"
              @input="setParam(p.uniform, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="w-10 text-right tabular-nums">{{ (uniforms[p.uniform] ?? 0).toFixed(2) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shader-shell { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2); }
.shader-effect-node[data-running] .shader-shell { box-shadow: 0 0 0 2px var(--port-color, #fff), 0 4px 16px rgba(0, 0, 0, 0.4); }
.bg-checker {
  background-color: #141414;
  background-image:
    linear-gradient(45deg, #1c1c1c 25%, transparent 25%),
    linear-gradient(-45deg, #1c1c1c 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1c1c1c 75%),
    linear-gradient(-45deg, transparent 75%, #1c1c1c 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
</style>
