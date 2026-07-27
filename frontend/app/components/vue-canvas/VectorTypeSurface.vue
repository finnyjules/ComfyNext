<script setup lang="ts">
/**
 * Full-screen editor for the Vector Type node — real glyph OUTLINES from a
 * variable font, animated as geometry.
 *
 * Modelled on ShapeStudioSurface/GradientStudioSurface: StudioModalShell chrome,
 * a schema-driven StudioControlPanel inspector, useStudioAgent for the tune bar,
 * useStudioVarBindings + useStudioVarMenu for Collection bindings and sweeps, and
 * the same recordAsset -> `sailor:*StudioOutput` emit for the image output path.
 *
 * Two things here are NOT copied from those surfaces, and both are deliberate:
 *
 * 1. The preview loop uses `schedule()`, not a bare `requestAnimationFrame`.
 *    rAF is throttled to ZERO in a hidden tab — exactly the state a headless or
 *    offscreen capture runs in — so a pure rAF loop silently never advances
 *    there. `schedule()` falls back to a timer when `document.hidden`, and it is
 *    called BEFORE the early returns so one empty frame while the font loads
 *    cannot kill the loop forever. (The dev demo at /dev/vectortype established
 *    this pattern; it is the reference implementation.)
 *
 * 2. Every pixel goes through `drawVectorType` in `~/lib/vectortype/canvas`, the
 *    same function the node card, the cascade baker and the frame source call.
 *    Four render surfaces that each grew their own copy is a failure this repo
 *    has already paid for more than once.
 */
import { computed, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { mergeConfig, type VectorTypeConfig } from '~/lib/vectortype/config'
import { VT_CONTROLS, VT_SECTIONS, derivedAxisControls, type VtControl } from '~/lib/vectortype/controls'
import { VT_GUIDANCE, vtAgentControls } from '~/lib/vectortype/agentControls'
import { animatableTargets } from '~/lib/vectortype/motion'
import { loadVariableFont, type VtAxis, type VtFont } from '~/lib/vectortype/font'
import { drawVectorTypeToCanvas, vtIsAnimated } from '~/lib/vectortype/canvas'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import StudioSelect from '~/components/vue-canvas/studio/StudioSelect.vue'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'
import StudioControlPanel from '~/components/vue-canvas/studio/StudioControlPanel.vue'
import CanvasContextMenu from '~/components/vue-canvas/CanvasContextMenu.vue'
import SweepPopover from '~/components/vue-canvas/studio/SweepPopover.vue'
import { useStudioAgent } from '~/composables/useStudioAgent'
import { useStudioVarBindings } from '~/composables/useStudioVarBindings'
import { useStudioVarMenu } from '~/composables/useStudioVarMenu'
import { makeConfigParams } from '~/lib/agent/configParams'
import { controlsForStudio } from '~/lib/collection/studioControls'
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'

const props = withDefaults(defineProps<{ nodeId: string; nodes?: any[]; edges?: any[] }>(), {
  nodes: () => [], edges: () => [],
})
const emit = defineEmits<{ (e: 'close'): void }>()

const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()

function currentNode(): any | undefined {
  return props.nodes?.find((n: any) => String(n?.id) === String(props.nodeId))
}

// ── persisted blob ──────────────────────────────────────────────────────────
// A WRAPPER, like Shape Studio's: canvas size and background live OUTSIDE the
// config in every studio, and Task 5 deliberately declared no control for them.
const persisted = currentNode()?.data?.properties?.sailor_vectorType as
  { config?: unknown; canvasW?: number; canvasH?: number; aspectKey?: string; background?: string | null } | undefined

const ASPECTS: Record<string, number> = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16, '3:2': 3 / 2, '2:3': 2 / 3 }
const ASPECT_OPTIONS = Object.keys(ASPECTS)

const config = ref<VectorTypeConfig>(mergeConfig(persisted?.config))
const aspectKey = ref<string>(persisted?.aspectKey && ASPECTS[persisted.aspectKey] ? persisted.aspectKey : '16:9')
const canvasW = ref<number>(typeof persisted?.canvasW === 'number' ? persisted.canvasW : 1280)
const canvasH = ref<number>(
  typeof persisted?.canvasH === 'number' ? persisted.canvasH : Math.round(1280 / (ASPECTS[aspectKey.value] ?? 1)),
)
const background = ref<string | null>(
  persisted?.background === null ? null : (typeof persisted?.background === 'string' ? persisted.background : '#0b0d12'),
)
const lastBgColor = ref(background.value ?? '#0b0d12')
const bgTransparent = computed({
  get: () => background.value === null,
  set: (v: boolean) => {
    if (v) { if (background.value) lastBgColor.value = background.value; background.value = null }
    else background.value = lastBgColor.value
  },
})
watch(aspectKey, (k) => { canvasH.value = Math.max(16, Math.round(canvasW.value / (ASPECTS[k] ?? 1))) })

function saveConfig() {
  const n = currentNode(); if (!n) return
  n.data ||= {}; n.data.properties ||= {}
  n.data.properties.sailor_vectorType = {
    config: JSON.parse(JSON.stringify(config.value)),
    canvasW: canvasW.value, canvasH: canvasH.value, aspectKey: aspectKey.value,
    background: background.value,
  }
}
function closeEditor() {
  try { saveConfig() } catch (e) { console.error('[vector-type] saveConfig failed', e) }
  emit('close')
}

// ── the font ────────────────────────────────────────────────────────────────
// The axis sliders are DERIVED from the loaded file's own `fvar`, so nothing
// below exists until this resolves. `loadVariableFont` caches the promise, so
// the card, the baker and this surface share one fetch per family.
// shallowRef + markRaw, NOT ref — see the note in VectorTypeNode.vue: Vue's deep
// reactive proxy over a fontkit font object throws on its non-configurable
// `parent` property as soon as a glyph outline is read.
const font = shallowRef<VtFont | null>(null)
const fontError = ref('')
const fontLoading = ref(false)
const fontAxes = computed<VtAxis[]>(() => font.value?.axes ?? [])

async function loadFont(id: string) {
  fontLoading.value = true
  fontError.value = ''
  try {
    const f = await loadVariableFont(id)
    // A slow load for a family the user has since switched away from must not
    // win the race and repaint with the wrong outlines.
    if (config.value.fontId === id) font.value = markRaw(f)
  } catch (e: any) {
    if (config.value.fontId === id) { font.value = null; fontError.value = String(e?.message ?? e) }
  } finally {
    if (config.value.fontId === id) fontLoading.value = false
  }
}
watch(() => config.value.fontId, id => { void loadFont(id) }, { immediate: true })

// ── inspector ───────────────────────────────────────────────────────────────
const inspectorTab = ref<'design' | 'motion'>('design')
const onDesign = computed(() => inspectorTab.value === 'design')
const onMotion = computed(() => inspectorTab.value === 'motion')

const DESIGN_SECTIONS = VT_SECTIONS.filter(s => s !== 'Motion')
const MOTION_SECTIONS = ['Motion'] as const

/** The full inspector vocabulary: the declared frame plus the loaded font's own
 *  axes. One list, so the panel, the agent and the sweep menu cannot drift. */
const allControls = computed<ControlSpec[]>(() => [...VT_CONTROLS, ...derivedAxisControls(fontAxes.value)])
const activeAgentControls = computed(() => vtAgentControls(config.value, fontAxes.value))
/** Motion targets, grouped by the target's OWN group — `Glyph` is not a
 *  VT_SECTIONS member (per-glyph offsets are animation outputs, not config
 *  leaves), so grouping strictly by section would drop them silently. */
const animatable = computed(() => animatableTargets(config.value, fontAxes.value))
const animatableGroups = computed(() => {
  const groups = new Map<string, typeof animatable.value>()
  for (const t of animatable.value) {
    const arr = groups.get(t.group)
    if (arr) arr.push(t); else groups.set(t.group, [t])
  }
  return [...groups.entries()]
})

const { getLocalSetting } = useLocalSettings()
const agentParams = makeConfigParams(() => config.value, () => 0)
const vtAgent = useStudioAgent({
  controls: () => activeAgentControls.value,
  params: agentParams,
  label: () => 'Vector Type',
  apiKey: () => getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '',
  guidance: () => VT_GUIDANCE,
})

// ── Collection variable bindings + sweeps ───────────────────────────────────
const studioControls = ref<StudioControlDesc[]>([])
async function refreshStudioControls() { studioControls.value = await controlsForStudio(currentNode()) }
onMounted(() => { void refreshStudioControls() })
// The axis controls only exist once the font has parsed, so the bindable list
// has to be re-resolved then — otherwise `axes.wght` is unbindable forever.
watch(fontAxes, () => { void refreshStudioControls() })

const paramsProxy = makeConfigParams(() => config.value, () => 0)

/**
 * Read a control's live value, falling back to its declared default.
 *
 * `config.axes` is SPARSE BY DESIGN — an absent tag means "the font's own
 * default for that axis" — so `paramsProxy['axes.wght']` is `undefined` until
 * something writes one, and a slider fed `Number(undefined)` shows NaN and
 * refuses to drag. The derived control's `default` IS the font's declared
 * default, so this is not a guess: it is the same value `resolveCoords` will
 * use at render time.
 */
const controlDefaults = computed(() => {
  const m = new Map<string, string | number>()
  for (const c of allControls.value) m.set(c.key, (c as { default: string | number }).default)
  return m
})
function controlValue(key: string): string | number {
  const v = paramsProxy[key]
  if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) {
    return controlDefaults.value.get(key) ?? 0
  }
  return v as string | number
}

const { boundColumnFor, boundColumnKeyFor, onEdit, promote, unbind } = useStudioVarBindings(
  props.nodeId,
  () => studioControls.value,
  (key, value) => { paramsProxy[key] = value },
  { nodes: () => props.nodes ?? [], edges: () => props.edges ?? [] },
)
// `boundColumnKeyFor` is handed straight through: the sweep writer needs the
// column's stable KEY, and passing the display label instead is the bug that
// silently baked N identical frames across five surfaces.
const { sweepPopover, applySweep, varMenu, openVarMenu, goToCollection } = useStudioVarMenu({
  nodeId: () => props.nodeId,
  nodes: () => props.nodes ?? [],
  edges: () => props.edges ?? [],
  liveValue: controlValue,
  boundColumnFor, boundColumnKeyFor, promote, unbind,
})

function setControl(key: string, value: string | number) {
  paramsProxy[key] = value
  onEdit(key, value)
}
function promoteControl(c: ControlSpec) { promote(c, paramsProxy[c.key] as string | number) }
function controlVisible(c: ControlSpec): boolean {
  const vc = c as VtControl
  return !vc.when || vc.when(config.value)
}
function slotControl(slotProps: unknown): ControlSpec {
  return (slotProps as { control: ControlSpec }).control
}

// ── motion tracks ───────────────────────────────────────────────────────────
function addTrack() {
  const target = animatable.value.find(a => a.path.startsWith('axes.')) ?? animatable.value[0]
  if (!target) return
  config.value.motion.tracks.push({
    path: target.path, from: target.min, to: target.max,
    // pingpong loops seamlessly (frame 0 === frame N) — a linear default would
    // hard-cut at the loop boundary of an exported clip.
    easing: 'pingpong', loops: 1, hold: 0, cycleOffset: 0, delay: 0,
  })
  onEdit('motion.tracks', config.value.motion.tracks.length)
  playing.value = true
}
function removeTrack(i: number) { config.value.motion.tracks.splice(i, 1) }

// ── preview loop ────────────────────────────────────────────────────────────
const canvas = ref<HTMLCanvasElement | null>(null)
const playing = ref(true)
const stats = ref({ glyphs: 0, shapings: 0, staggered: false, commands: 0 })
const previewTime = ref(0)
let timer = 0
let startedAt = 0
let disposed = false
const PREVIEW_MAX = 900

const animated = computed(() => vtIsAnimated(config.value))

/**
 * requestAnimationFrame is throttled to ZERO in a hidden/background tab — which
 * is exactly the state a headless or offscreen render runs in — so a pure rAF
 * loop silently never advances there. Fall back to a timer when the document is
 * hidden. Called BEFORE `draw`'s early returns, so a frame skipped while the
 * font loads cannot kill the loop permanently.
 */
function schedule() {
  if (disposed) return
  if (typeof document !== 'undefined' && document.hidden) {
    timer = window.setTimeout(draw, 1000 / 30) as unknown as number
  } else {
    timer = requestAnimationFrame(draw)
  }
}
function stopLoop() {
  cancelAnimationFrame(timer)
  clearTimeout(timer)
  timer = 0
}

function previewBox() {
  const el = canvas.value
  const wrap = el?.parentElement
  const ar = Math.max(0.05, canvasW.value / Math.max(1, canvasH.value))
  const availW = wrap?.clientWidth || PREVIEW_MAX
  const availH = wrap?.clientHeight || Math.round(PREVIEW_MAX / ar)
  let cssW = Math.min(availW, PREVIEW_MAX)
  let cssH = cssW / ar
  if (cssH > availH) { cssH = availH; cssW = availH * ar }
  return { cssW: Math.max(1, Math.round(cssW)), cssH: Math.max(1, Math.round(cssH)) }
}

function draw() {
  schedule()
  const el = canvas.value
  const f = font.value
  if (!el || !f) return

  if (animated.value && playing.value) {
    if (!startedAt) startedAt = performance.now()
    const dur = Math.max(0.1, config.value.motion?.duration ?? 4)
    previewTime.value = ((performance.now() - startedAt) / 1000) % dur
  }

  const { cssW, cssH } = previewBox()
  el.style.width = `${cssW}px`
  el.style.height = `${cssH}px`
  const dpr = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 2)
  // Render the LOGICAL output box scaled down to the preview, so what you see is
  // the composition the bake produces — not a differently laid-out one.
  const k = (cssW / Math.max(1, canvasW.value)) * dpr
  try {
    const frame = drawVectorTypeToCanvas(el, f, config.value, previewTime.value, {
      width: canvasW.value, height: canvasH.value, background: background.value, pixelRatio: k,
    })
    if (frame) {
      let cmds = 0
      for (const g of frame.outlines.glyphs) cmds += g.commands.length
      stats.value = {
        glyphs: frame.outlines.glyphs.length,
        shapings: frame.shapings,
        staggered: frame.staggered,
        commands: cmds,
      }
    }
  } catch (e) {
    console.error('[vector-type] preview render failed', e)
  }
}

watch([animated, playing], () => { startedAt = 0; if (!animated.value || !playing.value) previewTime.value = 0 })

onMounted(() => {
  registerStudioParamBaker(props.nodeId, renderBlobWithOverrides)
  schedule()
})
onBeforeUnmount(() => {
  saveConfig()
  disposed = true
  stopLoop()
  unregisterStudioParamBaker(props.nodeId)
})

// ── outputs ─────────────────────────────────────────────────────────────────
const exporting = ref(false)
const actionError = ref('')
let actionErrorTimer: ReturnType<typeof setTimeout> | null = null
function setActionError(msg: string) {
  actionError.value = msg
  if (actionErrorTimer) clearTimeout(actionErrorTimer)
  actionErrorTimer = setTimeout(() => { actionError.value = '' }, 5000)
}

/** Full-res render into a throwaway canvas. Shared by Export PNG and the
 *  Collection param baker, so the two can never disagree about framing. */
async function renderFullResBlob(t: number): Promise<Blob | null> {
  const f = font.value ?? await loadVariableFont(config.value.fontId)
  const off = document.createElement('canvas')
  drawVectorTypeToCanvas(off, f, config.value, t, {
    width: canvasW.value, height: canvasH.value, background: background.value,
  })
  return await new Promise<Blob | null>(resolve => off.toBlob(b => resolve(b), 'image/png'))
}

async function exportPng() {
  exporting.value = true
  actionError.value = ''
  try {
    const blob = await renderFullResBlob(previewTime.value)
    if (!blob) throw new Error('canvas produced no blob')
    const { uploadFrameBatch } = await import('~/lib/studio/frameUpload')
    const [filename] = await uploadFrameBatch([blob], 'vectortype_img')
    if (filename) {
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:vectorTypeStudioOutput', {
        detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } },
      }))
      closeEditor()
    }
  } catch (e) {
    console.error('[vector-type] export failed', e)
    setActionError('Export failed — please try again')
  } finally {
    exporting.value = false
  }
}

/**
 * Collection sweep baker: apply one row's `params.*` overrides, render one
 * full-res frame, restore in `finally`. Reference:
 * GradientStudioSurface.renderBlobWithOverrides — with two departures, both
 * found by watching a real sweep produce five identical PNGs.
 *
 * 1. **A swept path's motion track is suppressed for the bake.** This studio's
 *    headline animatable parameters are exactly the ones a user is most likely
 *    to sweep — the font axes. With an `axes.wght` track present, `applyMotion`
 *    runs AFTER the override is written and overwrites it with the track's value
 *    at t=0, so all N rows bake the same frame. The sweep is the more specific
 *    instruction ("render these five weights"), so it wins for the paths it
 *    names; every other track keeps animating and is evaluated at t=0 as before.
 *
 * 2. **The whole config is snapshotted, not just the overridden keys.** A
 *    per-key restore cannot undo a sparse axis: `config.axes.GRAD` legitimately
 *    has NO value until something writes one, so its snapshot is `undefined`,
 *    the "restore only if defined" rule skips it, and the last row's value stays
 *    behind in the user's config forever. Deep-cloning a config this small costs
 *    nothing and restores sparseness exactly.
 */
async function renderBlobWithOverrides(overrides: Record<string, string | number>): Promise<Blob | null> {
  const keys = Object.keys(overrides)
  const snapshot = JSON.parse(JSON.stringify(config.value)) as VectorTypeConfig
  try {
    // Suppress tracks aimed at a swept path (see 1 above) BEFORE the overrides
    // land, so nothing can re-derive them mid-render.
    const swept = new Set(keys)
    config.value.motion.tracks = config.value.motion.tracks.filter(t => !swept.has(t.path))
    for (const key of keys) paramsProxy[key] = overrides[key]!
    // A row may sweep `fontId` — the new family must be parsed before it can be
    // shaped, and the loaded `font` ref still holds the old one.
    const f = await loadVariableFont(config.value.fontId).catch(() => font.value)
    if (!f) return null
    const off = document.createElement('canvas')
    drawVectorTypeToCanvas(off, f, config.value, 0, {
      width: canvasW.value, height: canvasH.value, background: background.value,
    })
    return await new Promise<Blob | null>(resolve => off.toBlob(b => resolve(b), 'image/png'))
  } catch (e) {
    console.error('[vector-type] param-baker render failed', e)
    return null
  } finally {
    config.value = snapshot
  }
}

// ── settings import / export ────────────────────────────────────────────────
function exportSettings() {
  const blob = new Blob([JSON.stringify(config.value)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `vector-type-${config.value.fontId}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
const importInput = ref<HTMLInputElement | null>(null)
function triggerImport() { importInput.value?.click() }
async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    config.value = mergeConfig(JSON.parse(await file.text()))
    actionError.value = ''
  } catch (err) {
    console.error('[vector-type] import settings failed', err)
    setActionError('Could not read settings file')
  } finally {
    input.value = ''
  }
}

const frameCount = computed(() => Math.round((config.value.motion.fps || 30) * (config.value.motion.duration || 4)))
</script>

<template>
  <StudioModalShell
    title="Vector Type"
    :agent="vtAgent"
    agent-placeholder="Describe the type — e.g. heavier and wider, letters cascading in…"
    @close="closeEditor"
  >
    <template #preview>
      <div class="relative flex h-full w-full flex-col items-center justify-center gap-2">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg shadow-2xl" />
        <div v-if="fontError" class="absolute inset-x-3 top-3 rounded-md border border-red-400/30 bg-black/70 px-3 py-2 text-[11px] text-red-200/90">
          Font failed to load — {{ fontError }}
        </div>
        <div v-else-if="fontLoading && !font" class="absolute inset-0 flex items-center justify-center text-[11px] text-white/40">
          Loading outlines…
        </div>
        <!-- Not decoration: `shapings` is how many DISTINCT axis positions this
             frame shaped. 1 means the whole word shares one clock; anything more
             means the per-glyph stagger path really ran. -->
        <div class="pointer-events-none flex shrink-0 gap-3 font-mono text-[10px] text-white/35">
          <span>{{ stats.glyphs }} glyphs</span>
          <span>{{ stats.commands }} commands</span>
          <span>{{ stats.shapings }} shaping{{ stats.shapings === 1 ? '' : 's' }}</span>
          <span v-if="stats.staggered" class="text-white/60">wave</span>
          <span>t {{ previewTime.toFixed(2) }}s</span>
        </div>
      </div>
    </template>

    <template #actions>
      <button
        v-if="animated"
        type="button"
        class="rounded border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] text-white/80 transition hover:bg-white/[0.12]"
        @click="playing = !playing"
      >{{ playing ? 'Pause' : 'Play' }}</button>
      <button type="button" class="rounded border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] text-white/70 transition hover:bg-white/[0.12]" @click="triggerImport">Import settings</button>
      <button type="button" class="rounded border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] text-white/70 transition hover:bg-white/[0.12]" @click="exportSettings">Export settings</button>
      <input ref="importInput" type="file" accept="application/json" class="hidden" @change="onImportFile" />
      <span v-if="actionError" class="text-[11px] text-red-400/90">{{ actionError }}</span>
      <span class="flex-1" />
      <button
        type="button"
        class="rounded bg-action px-3.5 py-1.5 text-[12px] font-medium text-white transition enabled:hover:bg-action/85 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!font || exporting"
        @click="exportPng"
      >{{ exporting ? 'Exporting…' : 'Export PNG' }}</button>
    </template>

    <template #controls>
      <!-- Design | Motion — the same split Gradient, Space Type and 3D use. -->
      <div class="flex gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-1">
        <button type="button" class="flex-1 rounded px-2 py-1 text-[11px] transition"
                :class="onDesign ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="inspectorTab = 'design'">Design</button>
        <button type="button" class="flex-1 rounded px-2 py-1 text-[11px] transition"
                :class="onMotion ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                @click="inspectorTab = 'motion'">
          Motion<span v-if="config.motion.tracks.length" class="ml-1 text-white/40">{{ config.motion.tracks.length }}</span>
        </button>
      </div>

      <!-- Design: Text · Font · Axes · Layout · Paint. The Axes section is
           declared empty in VT_SECTIONS and filled by the loaded font's own
           fvar — that is the "declare the frame, derive the contents" rule. -->
      <template v-if="onDesign">
        <StudioControlPanel
          :controls="allControls"
          :order="DESIGN_SECTIONS"
          :value="controlValue"
          :visible="controlVisible"
          :bound-for="boundColumnFor"
          :go-to-collection="goToCollection"
          @set="setControl"
          @promote="promoteControl"
          @menu="(e: MouseEvent, c: ControlSpec) => openVarMenu(e, c)"
        >
          <!-- `kind: 'text'` has no default renderer in StudioControlPanel. -->
          <template #control-text="slotProps">
            <label class="mb-1 block text-[11px] text-white/55">{{ slotControl(slotProps).label }}</label>
            <div v-if="boundColumnFor('text')" class="flex items-center justify-between gap-2 rounded bg-white/[0.04] px-2 py-1.5">
              <span class="truncate text-[12px]" style="color: var(--var-accent-text)">{{ boundColumnFor('text') }}</span>
              <button type="button" class="shrink-0 rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white" @click="goToCollection?.()">Edit in table</button>
            </div>
            <input
              v-else
              :value="config.text"
              type="text"
              maxlength="120"
              placeholder="Type something"
              class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              @input="setControl('text', ($event.target as HTMLInputElement).value)"
            />
          </template>

          <template #section-Axes>
            <p v-if="fontLoading && !fontAxes.length" class="text-[11px] text-white/30">Reading the font's axes…</p>
            <p v-else-if="!fontAxes.length" class="text-[11px] text-white/30">This font declares no variable axes.</p>
            <p v-else class="text-[10px] leading-snug text-white/30">
              {{ fontAxes.length }} axes from the file's own fvar. These interpolate the OUTLINE, not a bitmap.
            </p>
          </template>
        </StudioControlPanel>

        <StudioSection title="Canvas">
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Aspect</label>
            <StudioSelect v-model="aspectKey" :options="ASPECT_OPTIONS" />
          </div>
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
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Transparent background</span>
            <StudioSwitch v-model="bgTransparent" />
          </div>
          <div v-if="!bgTransparent" class="flex items-center gap-2">
            <label class="text-[11px] text-white/55">Background</label>
            <StudioColor v-model="lastBgColor" @update:model-value="(v: string) => { background = v }" />
          </div>
        </StudioSection>
      </template>

      <!-- Motion: the stagger controls come from the schema; the track list is a
           bespoke block (a repeater is not a ControlSpec). -->
      <template v-else>
        <StudioControlPanel
          :controls="allControls"
          :order="MOTION_SECTIONS"
          :value="controlValue"
          :visible="controlVisible"
          :bound-for="boundColumnFor"
          :go-to-collection="goToCollection"
          @set="setControl"
          @promote="promoteControl"
          @menu="(e: MouseEvent, c: ControlSpec) => openVarMenu(e, c)"
        >
          <template #section-Motion>
            <p class="text-[10px] leading-snug text-white/30">
              Stagger shifts the clock each glyph reads the tracks at — raise it and one axis track
              becomes a wave travelling across the word.
            </p>
          </template>
        </StudioControlPanel>

        <StudioSection title="Tracks">
          <template #badge>
            <button class="flex items-center gap-1 normal-case text-white/40 hover:text-white" @click.stop="addTrack">
              <Plus class="h-3 w-3" /> Track
            </button>
          </template>
          <p v-if="!config.motion.tracks.length" class="text-[11px] text-white/30">
            Add a track to animate an axis (or a per-glyph offset) over the clip.
          </p>
          <div v-for="(tk, i) in config.motion.tracks" :key="i" class="mb-2 rounded border border-white/10 p-2">
            <div class="mb-1 flex items-center gap-1">
              <select v-model="tk.path" class="min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
                <option v-if="tk.path && !animatable.some(a => a.path === tk.path)" :value="tk.path">{{ tk.path }}</option>
                <optgroup v-for="[group, targets] in animatableGroups" :key="group" :label="group">
                  <option v-for="a in targets" :key="a.path" :value="a.path">{{ a.label }}</option>
                </optgroup>
              </select>
              <button class="text-white/30 hover:text-white/70" @click="removeTrack(i)"><Trash2 class="h-3 w-3" /></button>
            </div>
            <div class="mb-1 flex items-center gap-1 text-[11px] text-white/50">
              <span>from</span><input v-model.number="tk.from" type="number" step="1" class="w-16 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5" />
              <span>to</span><input v-model.number="tk.to" type="number" step="1" class="w-16 rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5" />
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
              <input v-model.number="config.motion.duration" type="range" min="1" max="12" step="0.5" class="studio-range w-full" />
            </div>
            <div>
              <label class="mb-1 block text-[11px] text-white/60">FPS</label>
              <select v-model.number="config.motion.fps" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-1 py-0.5 text-[11px]">
                <option :value="24">24</option><option :value="30">30</option><option :value="60">60</option>
              </select>
            </div>
          </div>
          <div class="mt-1 text-[10px] text-white/30">{{ frameCount }} frames</div>
        </StudioSection>
      </template>
    </template>
  </StudioModalShell>

  <CanvasContextMenu v-if="varMenu" :x="varMenu.x" :y="varMenu.y" :items="varMenu.items" @close="varMenu = null" />
  <SweepPopover
    v-if="sweepPopover"
    :control="sweepPopover.control"
    :anchor="sweepPopover.anchor"
    @apply="applySweep"
    @close="sweepPopover = null"
  />
</template>
