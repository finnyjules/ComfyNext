<script setup lang="ts">
// Full-screen editor for the Shape Studio node — a procedural 2D-vector
// "clone and arrange" logo generator (geoshape). Modeled on
// VectorTypeSurface/GradientStudioSurface for the shell wiring (StudioModalShell,
// StudioControlPanel, useStudioAutosave, useStudioAgent, the sailor:*StudioOutput
// image-output path) but the RENDERER is entirely different: this used to be a
// three.js `ShapeEngine` on a WebGL canvas with an orbit camera and a persistent
// rAF loop; it is now a plain 2D `<canvas>` painted by `drawToCanvas` off the
// `geoshape/render.ts` pipeline, re-run on an 80ms-debounced watcher rather than
// a frame loop — see that watcher's own comment for why (2D is cheap and this is
// event-driven state, not a continuous animation; a rAF loop that re-reads config
// every frame is the exact anti-pattern the "per-frame writes stomp event state"
// lesson warns about).
//
// Collection variable-binding (promote/bind/sweep, the pink glyph + var menu every
// other studio wires) is deliberately NOT wired here — out of scope for this pass.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Dices } from 'lucide-vue-next'
import type { ControlSpec } from '~/lib/spacetype/effect'
import type { VectorPaint } from '~/lib/vector/svg'
import { DEFAULT_CONFIG, mergeConfig, type GeoShapeConfig } from '~/lib/geoshape/config'
import { renderShapes, toSvg, drawToCanvas } from '~/lib/geoshape/render'
import { reroll } from '~/lib/geoshape/randomize'
import { GEO_CONTROLS, GEO_SECTIONS, visibleGeoControls, type GeoControl } from '~/lib/geoshape/controls'
import { geoAgentControls, GEO_GUIDANCE } from '~/lib/geoshape/agentControls'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioActionsFooter from '~/components/vue-canvas/studio/StudioActionsFooter.vue'
import StudioColorField from '~/components/vue-canvas/studio/StudioColorField.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import StudioControlPanel from '~/components/vue-canvas/studio/StudioControlPanel.vue'
import { useStudioAgent } from '~/composables/useStudioAgent'
import { makeConfigParams } from '~/lib/agent/configParams'
import { useStudioAutosave } from '~/lib/studio/autosave'
import { downloadBlobAsFile } from '~/lib/studio/downloadBlob'

// `nodes` is optional (defaults to []) so this surface can be smoke-tested standalone
// before it is wired into VueNodeCanvas as `nodeId` + the live `nodes` array — same
// posture ShapeStudioSurface always had, kept verbatim.
const props = withDefaults(defineProps<{ nodeId: string; nodes?: any[]; edges?: any[] }>(), { nodes: () => [] })
const emit = defineEmits<{ (e: 'close'): void }>()

// Record generated stills as the current project's assets (Assets panel) — identical
// composables every other studio's image output uses.
const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

function currentNode(): any | undefined {
  return props.nodes?.find((n: any) => String(n?.id) === String(props.nodeId))
}

// ── canvas dimensions (NOT part of GeoShapeConfig — mirrors every other studio's
// separate W/H/aspectKey persisted alongside the effect config rather than inside it) ──
const ASPECTS: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16, '3:2': 3 / 2, '2:3': 2 / 3 }
const ASPECT_OPTIONS = Object.keys(ASPECTS)

// ── config (single source of truth) — hydrate synchronously from the node's persisted
// blob if present, else DEFAULT_CONFIG. mergeConfig deep-defends against partial/old/junk
// JSON, so this is safe even if the schema grows later. The old blob's `orbit` (camera
// state, meaningless to a 2D renderer) is simply not read here.
const persisted = currentNode()?.data?.properties?.sailor_shapeStudio as
  { config?: unknown; canvasW?: number; canvasH?: number; aspectKey?: string } | undefined

const config = ref<GeoShapeConfig>(mergeConfig(persisted?.config))
const aspectKey = ref<string>(persisted?.aspectKey && ASPECTS[persisted.aspectKey] ? persisted.aspectKey : '1:1')
const canvasW = ref<number>(typeof persisted?.canvasW === 'number' ? persisted.canvasW : 1024)
const canvasH = ref<number>(
  typeof persisted?.canvasH === 'number' ? persisted.canvasH : Math.round(1024 / (ASPECTS[aspectKey.value] ?? 1)),
)
// Only the aspect SELECT drives H from W (a convenience) — editing W/H directly is
// left free-form, same as Shape/Vector Type's own posture.
watch(aspectKey, (k) => { canvasH.value = Math.max(16, Math.round(canvasW.value / (ASPECTS[k] ?? 1))) })

function saveConfig() {
  const n = currentNode(); if (!n) return
  n.data ||= {}; n.data.properties ||= {}
  n.data.properties.sailor_shapeStudio = {
    config: JSON.parse(JSON.stringify(config.value)),
    canvasW: canvasW.value, canvasH: canvasH.value, aspectKey: aspectKey.value,
  }
}
function closeEditor() {
  try { saveConfig() } catch (e) { console.error('[shape-studio] saveConfig failed', e) }
  emit('close')
}

// Sticky footer status (StudioActionsFooter): real Saving…/Saved ✓ driven by
// useStudioAutosave, debounced off everything saveConfig persists.
const { saving: autoSaving, saved: autoSaved } = useStudioAutosave(
  () => ({ config: config.value, canvasW: canvasW.value, canvasH: canvasH.value, aspectKey: aspectKey.value }),
  saveConfig,
)

// ── in-product agent — "tune" the mark in natural language, following every other
// studio's useStudioAgent wiring exactly. geoshape's control keys are already flat
// (1:1 with GeoShapeConfig's own leaves), so no per-layer indirection is needed.
const { getLocalSetting } = useLocalSettings()
const paramsProxy = makeConfigParams(() => config.value)
const activeAgentControls = computed(() => geoAgentControls(config.value))
const shapeAgent = useStudioAgent({
  controls: () => activeAgentControls.value, params: paramsProxy, label: () => 'Shape studio',
  apiKey: () => getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '',
  guidance: () => GEO_GUIDANCE,
})

// ── StudioControlPanel wiring — GEO_CONTROLS/GEO_SECTIONS is the single source for
// every slider/select/switch/color below except the three bespoke paint slots (fill/
// stroke/overlapFill, which can hold a VectorPaint the generic string-only color row
// can't render) and the seed/re-roll row. `visibleGeoControls` is the schema's own
// `when`-gate (control.ts's export) — mirrored into a Set so StudioControlPanel's
// per-control `visible` callback is an O(1) lookup rather than re-deriving the
// filtered list on every one of the ~30 controls it asks about.
//
// `seed` is deliberately excluded from the array handed to StudioControlPanel: the
// bespoke Seed + Re-roll row above already displays it, and `cfg.seed` itself is never
// read by the render pipeline (only the Re-roll button's `reroll`/`nextSeed` path uses
// it) — an auto-generated slider for it would be a second, dead control for the same
// field. `seed` stays in GEO_CONTROLS itself (the drift-guard test and the agent's
// vocabulary both need it there); it is only dropped from this surface's own panel.
const panelGeoControls = GEO_CONTROLS.filter((c) => c.key !== 'seed')
const visibleControlSet = computed(() => new Set<GeoControl>(visibleGeoControls(config.value)))
function controlVisible(c: ControlSpec): boolean {
  return visibleControlSet.value.has(c as GeoControl)
}
function setGeoControl(key: string, value: string | number | boolean) {
  paramsProxy[key] = value as string | number
}
function paramValue(key: string): string | number | boolean {
  return paramsProxy[key] as string | number | boolean
}

// ── re-roll — geoshape's own deterministic reroll(cfg, locks): regenerates every
// UNLOCKED section from a fresh derived seed. `config.value.locks` starts empty
// (nothing locked), so a plain click re-rolls the whole mark; per-section lock
// toggles are not exposed in this pass (the schema supports them; the inspector
// doesn't surface them yet).
function rerollConfig() { config.value = reroll(config.value, config.value.locks) }

// ── Paint — fill/stroke/overlapFill reduced to plain hex for THIS editor. `fill`/
// `overlapFill` are VectorPaint (string | gradient | pattern); a full gradient/
// pattern editor is out of scope here (geoshape/paint.ts's own header scopes the
// richer knockout-invert case out the same way) — editing always writes back a
// solid string, same posture controls.ts's `paintDefault` reduction takes for the
// agent's view of these same keys. `stroke` is nullable (no stroke drawn at all);
// the switch mirrors Shape Studio's transparent-background toggle exactly, so
// turning it off remembers the last color instead of losing it.
function paintToHex(p: VectorPaint): string { return typeof p === 'string' ? p : DEFAULT_CONFIG.fill as string }
const fillHex = computed<string>({
  get: () => paintToHex(config.value.fill),
  set: (v: string) => setGeoControl('fill', v),
})
const overlapFillHex = computed<string>({
  get: () => paintToHex(config.value.overlapFill),
  set: (v: string) => setGeoControl('overlapFill', v),
})
const lastStrokeColor = ref(config.value.stroke ?? '#000000')
const strokeEnabled = computed<boolean>({
  get: () => config.value.stroke !== null,
  set: (v: boolean) => {
    if (v) { config.value.stroke = lastStrokeColor.value } else { config.value.stroke = null }
  },
})
const strokeHex = computed<string>({
  get: () => config.value.stroke ?? lastStrokeColor.value,
  set: (v: string) => { lastStrokeColor.value = v; config.value.stroke = v },
})

// ── preview: a plain 2D canvas, event-driven ────────────────────────────────────
// No requestAnimationFrame loop — geoshape has no animation, so a per-frame render
// would just re-run an unchanged pipeline forever for no reason. `renderPreview()`
// is invoked directly on mount and again whenever `config`/canvasW/canvasH change,
// through a small trailing debounce (matches VectorTypeSurface's solid-union
// debounce posture: collapse a slider drag's ~200 intermediate `input` events into
// one render fired after the value settles, not 200 renders mid-drag).
const canvas = ref<HTMLCanvasElement | null>(null)
const exporting = ref(false)
const svgExporting = ref(false)
const actionError = ref('')
let actionErrorTimer: ReturnType<typeof setTimeout> | null = null
function setActionError(msg: string) {
  actionError.value = msg
  if (actionErrorTimer) clearTimeout(actionErrorTimer)
  actionErrorTimer = setTimeout(() => { actionError.value = '' }, 5000)
}

const PREVIEW_MAX = 620
function previewDims() {
  const el = canvas.value
  const ar = Math.max(0.1, canvasW.value / Math.max(1, canvasH.value))
  const dpr = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 2)
  const wrap = el?.parentElement
  const availW = wrap?.clientWidth || PREVIEW_MAX
  const availH = wrap?.clientHeight || Math.round(PREVIEW_MAX / ar)
  let cssW = Math.min(availW, PREVIEW_MAX)
  let cssH = cssW / ar
  if (cssH > availH) { cssH = availH; cssW = availH * ar }
  cssW = Math.max(1, Math.round(cssW)); cssH = Math.max(1, Math.round(cssH))
  return { cssW, cssH, w: Math.max(1, Math.round(cssW * dpr)), h: Math.max(1, Math.round(cssH * dpr)) }
}

let lastW = 0, lastH = 0
// Bumped on every render start; a stale in-flight `renderShapes` that resolves
// after a newer one has already painted is dropped rather than allowed to
// overwrite a fresher frame — `renderShapes` is async (boolean folding), so two
// overlapping calls can resolve out of order under a fast slider drag.
let renderToken = 0
async function renderPreview() {
  const el = canvas.value
  if (!el) return
  const { cssW, cssH, w, h } = previewDims()
  el.style.width = `${cssW}px`
  el.style.height = `${cssH}px`
  if (w !== lastW || h !== lastH) { el.width = w; el.height = h; lastW = w; lastH = h }
  const ctx = el.getContext('2d')
  if (!ctx) return
  const token = ++renderToken
  try {
    const shapes = await renderShapes(config.value)
    if (token !== renderToken) return // superseded by a later render
    drawToCanvas(shapes, ctx, el.width, el.height)
  } catch (e) {
    console.error('[shape-studio] preview render failed', e)
  }
}

const RENDER_DEBOUNCE_MS = 80
let renderTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => { renderTimer = null; void renderPreview() }, RENDER_DEBOUNCE_MS)
}
watch(config, scheduleRender, { deep: true })
watch([canvasW, canvasH], scheduleRender)

function onWindowResize() { scheduleRender() }

onMounted(() => {
  void renderPreview()
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => {
  saveConfig()
  window.removeEventListener('resize', onWindowResize)
  if (renderTimer) clearTimeout(renderTimer)
  if (actionErrorTimer) clearTimeout(actionErrorTimer)
})

// ── outputs ──────────────────────────────────────────────────────────────────────
// Rasterize at the FULL export resolution (canvasW × canvasH), not the (possibly
// smaller, DPR-scaled) preview backing store — same reasoning ShapeStudioSurface's
// old `frameToBlob(canvasW, canvasH)` bake always applied.
async function rasterizePng(): Promise<Blob | null> {
  const shapes = await renderShapes(config.value)
  const off = document.createElement('canvas')
  off.width = Math.max(1, Math.round(canvasW.value))
  off.height = Math.max(1, Math.round(canvasH.value))
  const ctx = off.getContext('2d')
  if (!ctx) return null
  drawToCanvas(shapes, ctx, off.width, off.height)
  return await new Promise<Blob | null>((resolve) => off.toBlob(resolve, 'image/png'))
}

// "As image": rasterize → upload → drop an Image node on the canvas — the existing
// sailor:shapeStudioOutput path every studio's canvas-output button uses.
async function exportPng() {
  exporting.value = true
  actionError.value = ''
  try {
    const blob = await rasterizePng()
    if (!blob) throw new Error('rasterize failed')
    const { uploadFrameBatch } = await import('~/lib/studio/frameUpload')
    const [filename] = await uploadFrameBatch([blob], 'shape_img')
    if (filename) {
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:shapeStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } catch (e) {
    console.error('[shape-studio] export failed', e)
    setActionError('Export failed — please try again')
  } finally {
    exporting.value = false
  }
}

// Real file download (distinct from exportPng, which uploads + drops an Image node
// + closes the studio) — just saves a PNG.
async function downloadPng() {
  try {
    const blob = await rasterizePng()
    if (blob) downloadBlobAsFile(blob, `shape_${Date.now()}.png`)
  } catch (e) {
    console.error('[shape-studio] PNG download failed', e)
    setActionError('PNG download failed — please try again')
  }
}

// Download SVG: real vector output, sized to the actual rendered geometry (see
// toSvg's own doc — it derives the box from contentBounds, not a static formula).
async function exportSvg() {
  svgExporting.value = true
  actionError.value = ''
  try {
    const svg = await toSvg(config.value)
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    downloadBlobAsFile(blob, `shape-studio-${config.value.seed}.svg`)
  } catch (e) {
    console.error('[shape-studio] SVG export failed', e)
    setActionError('SVG export failed — please try again')
  } finally {
    svgExporting.value = false
  }
}
</script>

<template>
  <StudioModalShell
    title="Shape studio"
    :agent="shapeAgent"
    agent-placeholder="Describe the mark — e.g. more clones, sharper overlap, warmer fill…"
    @close="closeEditor"
  >
    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center">
        <!-- Checkered backdrop (cosmetic only — the exported PNG/SVG stay transparent):
             both a near-black default fill and a carved even-odd hole would otherwise
             be nearly invisible against the modal's own near-black chrome. -->
        <canvas
          ref="canvas"
          class="max-h-full max-w-full rounded-lg shadow-2xl"
          style="background-image:linear-gradient(45deg,#3a3a3f 25%,transparent 25%),linear-gradient(-45deg,#3a3a3f 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#3a3a3f 75%),linear-gradient(-45deg,transparent 75%,#3a3a3f 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0px;background-color:#242427"
        />
      </div>
    </template>
    <template #actions>
      <StudioActionsFooter :spec="{
        status: { saving: autoSaving, saved: autoSaved, error: actionError || null },
        downloads: [
          { label: 'Download SVG', onClick: exportSvg, busy: svgExporting },
          { label: 'Download PNG', onClick: downloadPng },
        ],
        canvas: [{ label: 'As image', onClick: exportPng, busy: exporting }],
      }" />
    </template>
    <template #controls>
      <!-- Seed + Re-roll -->
      <div class="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
        <div class="flex flex-col">
          <span class="text-[10px] uppercase tracking-wide text-white/30">Seed</span>
          <span class="font-mono text-[11px] text-white/70">{{ config.seed }}</span>
        </div>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded bg-action px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-action/85"
          @click="rerollConfig"
        >
          <Dices class="h-3.5 w-3.5" /> Re-roll
        </button>
      </div>

      <!-- Schema-driven inspector: every slider/select/switch declared in GEO_CONTROLS,
           grouped into Shape/Layout/Transform/Composite/Symmetry/Clip/Style/Paint cards
           per GEO_SECTIONS. The three paint fields get bespoke slots (below) since they
           can hold a VectorPaint the generic string-only color row can't render. -->
      <StudioControlPanel
        :controls="panelGeoControls"
        :order="GEO_SECTIONS"
        :value="paramValue"
        :visible="controlVisible"
        @set="setGeoControl"
      >
        <template #control-fill>
          <StudioColorField label="Fill" v-model="fillHex" />
        </template>
        <template #control-overlapFill>
          <StudioColorField label="Overlap fill" v-model="overlapFillHex" />
        </template>
        <template #control-stroke>
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Stroke</span>
            <StudioSwitch v-model="strokeEnabled" />
          </div>
          <StudioColorField v-if="strokeEnabled" label="Stroke color" v-model="strokeHex" />
        </template>
      </StudioControlPanel>

      <!-- Canvas (export dimensions — not part of GeoShapeConfig) -->
      <StudioSection title="Canvas">
        <StudioSelect label="Aspect" v-model="aspectKey" :options="ASPECT_OPTIONS" />
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Width</label>
            <input v-model.number="canvasW" type="number" min="64" max="4096" step="1"
                   class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Height</label>
            <input v-model.number="canvasH" type="number" min="64" max="4096" step="1"
                   class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20" />
          </div>
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>
</template>
