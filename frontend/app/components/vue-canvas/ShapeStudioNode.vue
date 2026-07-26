<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Gem, Pencil } from 'lucide-vue-next'
import { ShapeEngine } from '~/lib/shapefx/engine'
import { mergeConfig } from '~/lib/shapefx/config'
import { detectWebGL } from '~/lib/spacetype/webgl'
import { registerStudioBaker, unregisterStudioBaker } from '~/lib/studio/cascade'
import StudioRenderButton from '~/components/vue-canvas/StudioRenderButton.vue'

// Shape Studio — a frontend-only config node (no backend class_type, never
// executes). Modeled on GradientStudioNode.vue/TextureStudioNode.vue, but
// unlike those studios (which render their preview with a cheap headless 2D
// canvas function), Shape Studio's engine is a full Three.js WebGL scene tied
// to a live <canvas> (see ShapeStudioSurface.vue / lib/shapefx/engine.ts) —
// too heavy to mount one LIVE instance per card. So the card shows a still
// (the last export, or the last Render's bake) rather than an animated preview.
// It DOES register a studio-cascade baker: `bakeOutput()` spins a short-lived
// offscreen ShapeEngine, renders one frame at the persisted framing, reads back
// a PNG, and disposes — the same one-shot pattern Space Type's bake uses. That
// baker powers the footer StudioRenderButton and pre-run baking. "Edit" opens
// the full ShapeStudioSurface, which writes config back to
// node.data.properties.sailor_shapeStudio.
const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    mode?: number
    properties?: Record<string, any>
    studioBusy?: boolean
    inputs?: { name?: string }[]
  }
}>()

// Last exported filename, learned live from this node's own output event —
// not persisted, so it resets on reload (acceptable v1: "if present").
const lastExportedFile = ref<string | null>(null)
// A direct object-URL of the most recent in-card bake (footer Render), shown for
// instant feedback: the cascade uploads+publishes to the DOWNSTREAM image node,
// so it never round-trips a filename back to this card. Preferred over the
// exported /view URL when present; revoked before it's replaced.
const bakedThumb = ref<string | null>(null)
const thumbUrl = computed(() =>
  bakedThumb.value
    ?? (lastExportedFile.value
      ? `/view?${new URLSearchParams({ filename: lastExportedFile.value, type: 'input' })}`
      : null),
)

function onOutput(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail || String(detail.sourceNodeId) !== String(props.id)) return
  const filename = detail.widgetOverrides?.image
  if (filename) lastExportedFile.value = String(filename)
}

// Default camera framing — keep in sync with ShapeStudioSurface's orbit defaults.
const DEFAULT_ORBIT = { yaw: 0.6, pitch: 0.32, zoom: 1 }

// Headless full-res bake for the render cascade (generative — no input). Spins a
// throwaway offscreen ShapeEngine at the persisted output dims + framing, reads
// back one PNG, and disposes. Also refreshes the card's own still for instant
// feedback (see bakedThumb).
async function bakeOutput(): Promise<Blob | null> {
  if (!detectWebGL()) return null
  const blob = props.data?.properties?.sailor_shapeStudio as
    { config?: unknown; canvasW?: number; canvasH?: number
      orbit?: { yaw?: number; pitch?: number; zoom?: number } } | undefined
  const cfg = mergeConfig(blob?.config)
  const w = typeof blob?.canvasW === 'number' ? blob.canvasW : 1024
  const h = typeof blob?.canvasH === 'number' ? blob.canvasH : 1024
  const orbit = {
    yaw: blob?.orbit?.yaw ?? DEFAULT_ORBIT.yaw,
    pitch: blob?.orbit?.pitch ?? DEFAULT_ORBIT.pitch,
    zoom: blob?.orbit?.zoom ?? DEFAULT_ORBIT.zoom,
  }
  const canvas = document.createElement('canvas')
  let engine: ShapeEngine | null = null
  try {
    engine = new ShapeEngine(canvas, w, h)
    // Important 5 (final review): unclamp any shader fill to this bake's actual output size
    // instead of the live-preview clamp — setConfig hardcoded `bake: false` until ShapeEngine
    // grew a setBake() method for exactly this call. This is a throwaway engine (disposed in
    // the finally below), so there's no live-preview state to restore afterward.
    engine.setBake(true)
    engine.setConfig(cfg)
    engine.render(orbit)
    const out = await engine.frameToBlob(w, h)
    if (bakedThumb.value) URL.revokeObjectURL(bakedThumb.value)
    bakedThumb.value = URL.createObjectURL(out)
    return out
  } catch (e) {
    console.error('[shape-studio] bake failed', e)
    return null
  } finally {
    engine?.dispose()
  }
}

onMounted(() => {
  window.addEventListener('sailor:shapeStudioOutput', onOutput)
  registerStudioBaker(props.id, bakeOutput)
})
onBeforeUnmount(() => {
  window.removeEventListener('sailor:shapeStudioOutput', onOutput)
  unregisterStudioBaker(props.id)
  if (bakedThumb.value) URL.revokeObjectURL(bakedThumb.value)
})

function openEditor() {
  window.dispatchEvent(new CustomEvent('sailor:openShapeStudio', { detail: { nodeId: props.id } }))
}

// Index of the optional `vars` input a Collection's VARS output wires into.
// Rendering its port (below) is what lets that edge anchor and survive reload.
const varsInputIndex = computed(() =>
  ((props.data?.inputs as { name?: string }[] | undefined) ?? []).findIndex(i => i?.name === 'vars'))
</script>

<template>
  <!-- Ports live outside the card: the card clips its own content
       (overflow-hidden), which would otherwise cut the dots and their hit
       areas in half. As siblings they also tuck in behind it. -->
  <div class="studio-node relative w-fit">
    <!-- Variables input: a Collection's VARS output wires here. Rendering this
         port lets the VARS edge anchor so it survives reload. -->
    <VueCanvasNodePort
      v-if="varsInputIndex >= 0"
      :id="`input-${varsInputIndex}`" type="target" side="left" :index="0"
      data-type="VARS" label="variables"
    />

    <!-- Output handle: anchors the provenance edge to a generated Image node. -->
    <VueCanvasNodePort
      id="output-0" type="source" side="right" :index="0"
      data-type="IMAGE" label="image"
    />

  <div
    class="relative z-10 w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg"
    @dblclick.stop="openEditor"
  >
    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Gem class="h-3.5 w-3.5 text-white/70" />
      <span class="text-xs font-medium text-white/80">Shape Studio</span>
    </div>

    <!-- Last exported thumbnail (no live preview — see note above) -->
    <div class="flex aspect-video items-center justify-center bg-neutral-950">
      <img v-if="thumbUrl" :src="thumbUrl" class="block max-h-full max-w-full object-contain" alt="" />
      <span v-else class="text-[10px] text-white/30">No export yet</span>
    </div>

    <!-- Edit + Render -->
    <div class="border-t border-white/10 p-2 flex items-center gap-1.5">
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="openEditor"
      >
        <Pencil class="h-3 w-3" /> Edit
      </button>
      <StudioRenderButton class="flex-1" :node-id="id" :busy="!!data?.studioBusy" />
    </div>
  </div>
  </div>
</template>
