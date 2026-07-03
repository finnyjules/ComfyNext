<script setup lang="ts">
/**
 * Top-level shell for the v2 (Swiss grid) editor: format tabs, canvas,
 * reused LayersPanel, grid property panel, worst-case copy toggle, save.
 *
 * Owns the useGridEditor composable and provides it under BOTH 'gridEditor'
 * (the v2 components) and 'templateEditor' (LayersPanel reuse — it only
 * touches template/selectedId/moveElement/moveElementTo, which the grid
 * context exposes with identical contracts).
 */
import { BookmarkPlus, CaseSensitive, Download, Grid3x3, ImagePlus, Layers2, PaintBucket, Palette, Redo2, Save, Square, Type as TypeIcon, Undo2 } from 'lucide-vue-next'

import { useGoogleFontPreview } from '~/composables/useTemplateFonts'
import { useGridEditor } from '~/composables/useGridEditor'
import { allElements } from '~~/shared/template-grid/sections'
import { BRAND_COLOR_KEYS, isV3 } from '~~/shared/template-grid/types'
import type { AnyGridTemplate, BrandKit, TemplateV2, TemplateV3 } from '~~/shared/template-grid/types'
import { useLayoutAgent } from '~/composables/useLayoutAgent'
import AgentBar from '~/components/agent/AgentBar.vue'
import AgentProposal from '~/components/agent/AgentProposal.vue'
import AgentProgress from '~/components/agent/AgentProgress.vue'
import AgentSweep from '~/components/agent/AgentSweep.vue'

const props = defineProps<{
  initial: AnyGridTemplate
  initialProps?: Record<string, string>
  initialBrand?: Record<string, string>
  /** Legacy aspects CSV — migrates a pre-outputs template into an outputs list. */
  aspects?: string
  /** The project's active brand kit — slots between template defaults and
   *  the wired socket brand in the shared effectiveBrand merge. */
  activeKit?: BrandKit
}>()

const emit = defineEmits<{ save: [layout: AnyGridTemplate] }>()

const ctx = useGridEditor(props.initial, { activeKit: toRef(props, 'activeKit'), aspects: props.aspects })
provide('gridEditor', ctx)
provide('templateEditor', ctx as any)
// Optional per-layer controls consumed by the reused LayersPanel — present
// only in the grid editor, so the v1 editor's panel stays unchanged.
provide('layerControls', {
  toggleHidden: ctx.toggleHidden,
  toggleLocked: ctx.toggleLocked,
  isHidden: ctx.isHidden,
  isLocked: ctx.isLocked,
})

const { template, dirty, worstCase, selectedElement, selectedId, sampleProps, sampleBrand, selectedStack, wrapSelectionInStack } = ctx

// In-product agent (last-mile of F1): drives the template through the command
// surface. Gated to v3 templates in the UI below.
const { getLocalSetting } = useLocalSettings()
const {
  busy: agentBusy, error: agentError, notice: agentNotice, issues: agentIssues, review: agentReview, reviewing: agentReviewing, changes: agentChanges, hasProposal: agentHasProposal, hovered: agentHovered,
  ask: agentAsk, acceptChange, rejectChange, reroll: agentReroll,
  keep: agentKeep, revert: agentRevert,
} = useLayoutAgent({
  template: template as unknown as Ref<TemplateV3>,
  apiKey: () => getLocalSetting('ComfyNext.AI.AnthropicApiKey') ?? '',
  sampleProps: () => sampleProps.value,
  sampleBrand: () => sampleBrand.value as BrandKit,
})
function onAgentHover(i: number | null) { agentHovered.value = i }
// The agent's progress / proposal take over the right panel while it's active.
const agentPanelActive = computed(() => agentBusy.value || agentReviewing.value || agentHasProposal.value)
// The right panel is shown when the agent is working or an element/stack is selected.
const rightPanelOpen = computed(() => agentPanelActive.value || !!selectedElement.value || !!selectedStack.value)

// Opening step: a fresh, empty layout shows the format picker first (pick the
// deliverables, then design on a blank canvas). An existing layout — any
// elements or sections — skips straight into editing.
const started = ref(allElements(template.value).length > 0 || ctx.sections.value.length > 0)
function onFormatsChosen(keys: string[]) {
  ctx.setWorkingFormats(keys)
  ctx.convertToV3()   // design on the fine grid from the start
  started.value = true
}

// Reserve space for the floating panels so the artboard fits the gap between
// them (left: formats panel; right: inspector, only when an element is
// selected; bottom: tool toolbar). The canvas measures this padded box.
const canvasArea = computed(() => ({
  top: '24px',
  left: '272px',                                     // left-4 + w-60 + gap
  // Right column (agent results and/or the element inspector) is w-80 = 320px.
  right: rightPanelOpen.value ? '344px' : '32px', // right-4 + w-80 + gap
  bottom: '88px',                                    // bottom toolbar + gap
}))

if (props.initialProps && Object.keys(props.initialProps).length > 0) {
  Object.assign(sampleProps.value, props.initialProps)
}
if (props.initialBrand && Object.keys(props.initialBrand).length > 0) {
  Object.assign(sampleBrand.value, props.initialBrand)
}
watch(() => props.initialProps, (next) => {
  if (next && Object.keys(next).length > 0) Object.assign(sampleProps.value, next)
}, { deep: true })

// Make sure the browser can render every family the template references —
// curated families are bundled; anything else lazy-loads from Google Fonts.
const { ensure: ensureFont } = useGoogleFontPreview()
watch(template, (tpl) => {
  for (const el of allElements(tpl)) {
    if (el.type === 'text' && el.style?.fontFamily) ensureFont(el.style.fontFamily)
  }
}, { immediate: true, deep: true })

function handleSave() {
  emit('save', JSON.parse(JSON.stringify(template.value)))
  dirty.value = false
}

// -- Save as reusable template ------------------------------------------------

const saveAsOpen = ref(false)
const saveAsName = ref('')
const saveAsState = ref<'idle' | 'saving' | 'done' | 'error'>('idle')

function openSaveAs() {
  saveAsName.value = template.value.name && template.value.name !== 'New Layout' ? template.value.name : ''
  saveAsState.value = 'idle'
  saveAsOpen.value = true
}

async function confirmSaveAs() {
  const name = saveAsName.value.trim()
  if (!name) return
  // Slugify to a filesystem-safe id; the saved template keeps its own id so it
  // can be reloaded from the gallery without colliding with the node's id.
  const id = `user-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'template'}`
  const payload = { ...JSON.parse(JSON.stringify(template.value)), id, name }
  saveAsState.value = 'saving'
  try {
    const res = await fetch(`/api/templates/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    saveAsState.value = res.ok ? 'done' : 'error'
    if (res.ok) setTimeout(() => { saveAsOpen.value = false }, 900)
  } catch {
    saveAsState.value = 'error'
  }
}

// -- Keyboard shortcuts -------------------------------------------------------
// Scoped to the editor root; ignored while typing in a field so the property
// panel's inputs keep working.

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  // While typing in a field, let the browser own Cmd+Z (native text undo) and
  // arrow keys (caret movement) — don't hijack them for the canvas.
  if (isTyping(e.target)) return

  if (mod && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    if (e.shiftKey) ctx.redo()
    else ctx.undo()
    return
  }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); ctx.redo(); return }

  const id = selectedId.value
  if (mod && (e.key === 'd' || e.key === 'D')) {
    if (id) { e.preventDefault(); ctx.duplicateElement(id) }
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && id && !ctx.isLocked(id)) {
    e.preventDefault(); ctx.removeElement(id); return
  }
  const nudges: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  }
  if (id && nudges[e.key] && !ctx.isLocked(id)) {
    e.preventDefault()
    ctx.nudgeSelected(...nudges[e.key])
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// -- Grid settings popover ----------------------------------------------------

const gridPanelOpen = ref(false)
const { currentFormat, format, formatClass, metrics } = ctx

/** Class default dims, shown as placeholders so "unset" reads as automatic. */
const classDefaultDims = computed(() => {
  const d = { square: [6, 6], portrait: [4, 8], landscape: [8, 4], strip: [12, 1], skyscraper: [3, 10] }[formatClass.value]
  return { cols: d[0], rows: d[1] }
})

function onDims(field: 'cols' | 'rows', raw: string) {
  ctx.setFormatDims(currentFormat.value, { [field]: raw === '' ? undefined : Number(raw) })
}
function onGrid(field: 'gutter' | 'margin', raw: string) {
  const v = Number(raw)
  if (Number.isFinite(v)) ctx.setGridSpec({ [field]: v })
}

// -- Brand kit popover --------------------------------------------------------

const brandPanelOpen = ref(false)
const COLOR_KEYS = BRAND_COLOR_KEYS
const COLOR_LABELS: Record<string, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent', accent2: 'Accent 2',
  foreground: 'Text', background: 'Background',
}
function brandVal(key: string): string {
  return (template.value.brand as any)?.[key] ?? ''
}

// -- Background popover --------------------------------------------------------

const bgPanelOpen = ref(false)
const bgFill = computed(() => template.value.background?.fill ?? '')
const hasBgImage = computed(() => !!template.value.background?.image)
const bgColorHex = computed(() => (/^#[0-9a-f]{6}$/i.test(bgFill.value) ? bgFill.value : '#000000'))
/** A fill (colour/gradient) replaces any image so it actually shows. */
function setBgFill(v: string) { ctx.setBackground({ fill: v, image: '' }) }
function clearBackground() { ctx.setBackground({ fill: '', image: '' }) }

const exportOpen = ref(false)
function setBrandFont(key: 'fontDisplay' | 'fontBody', family: string) {
  ensureFont(family)
  ctx.setBrand({ [key]: family })
}
</script>

<template>
  <div class="h-full w-full flex flex-col bg-[#0a0a0a]">
    <!-- Top bar. pr-12 keeps the host modal's absolute close button clear. -->
    <div class="shrink-0 h-14 pl-4 pr-12 border-b border-white/[0.06] flex items-center gap-3">
      <input
        :value="template.name"
        class="w-40 h-8 px-2 bg-transparent border border-transparent hover:border-white/[0.06] focus:border-white/30 rounded text-[13px] text-white font-medium focus:outline-none"
        @change="(e: any) => { template.name = e.target.value; dirty = true }"
      >

      <div class="flex items-center gap-0.5 shrink-0">
        <button
          class="size-8 rounded-md flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-white/65 hover:text-white hover:bg-white/[0.08]"
          title="Undo (⌘Z)"
          :disabled="!ctx.canUndo.value"
          @click="ctx.undo()"
        >
          <Undo2 class="size-4" />
        </button>
        <button
          class="size-8 rounded-md flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed text-white/65 hover:text-white hover:bg-white/[0.08]"
          title="Redo (⇧⌘Z)"
          :disabled="!ctx.canRedo.value"
          @click="ctx.redo()"
        >
          <Redo2 class="size-4" />
        </button>
      </div>

      <div class="flex-1 min-w-0" />

      <div class="flex items-center gap-2">
        <span v-if="dirty" class="size-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
        <button
          class="h-8 px-2.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] flex items-center gap-1.5 text-[12px] text-white/65 hover:text-white transition-colors cursor-pointer disabled:opacity-30"
          title="Export the ad set (PNG/JPEG/WebP, ZIP)"
          :disabled="allElements(template).length === 0"
          @click="exportOpen = true"
        >
          <Download class="size-4" /> Export
        </button>
        <div class="relative">
          <button
            class="size-8 rounded-md bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-white/65 hover:text-white transition-colors cursor-pointer"
            title="Save as a reusable template"
            @click="saveAsOpen ? (saveAsOpen = false) : openSaveAs()"
          >
            <BookmarkPlus class="size-4" />
          </button>
          <div
            v-if="saveAsOpen"
            class="absolute top-10 right-0 z-20 w-64 rounded-lg bg-[#161616] border border-white/10 shadow-2xl p-3"
          >
            <p class="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-1.5">Save as template</p>
            <input
              v-model="saveAsName"
              placeholder="Template name"
              class="w-full h-8 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-white/30"
              @keydown.enter="confirmSaveAs"
            >
            <div class="flex items-center gap-2 mt-2">
              <button
                class="px-3 h-7 rounded-md bg-white/10 hover:bg-white/20 text-[12px] text-white transition-colors cursor-pointer disabled:opacity-40"
                :disabled="!saveAsName.trim() || saveAsState === 'saving'"
                @click="confirmSaveAs"
              >
                {{ saveAsState === 'saving' ? 'Saving…' : saveAsState === 'done' ? 'Saved ✓' : 'Save' }}
              </button>
              <span v-if="saveAsState === 'error'" class="text-[11px] text-red-400">Save failed</span>
              <span class="text-[10px] text-white/30">Appears in the gallery.</span>
            </div>
          </div>
        </div>
        <button
          class="h-8 px-3 rounded-md bg-white hover:bg-white/90 flex items-center gap-1.5 text-[12px] text-black transition-colors cursor-pointer"
          @click="handleSave"
        >
          <Save class="size-3.5" /> Save & close
        </button>
        <slot name="topbar-end" />
      </div>
    </div>

    <!-- Body: canvas fills; panels float over it; tools in a bottom toolbar. -->
    <div class="flex-1 relative min-h-0 overflow-hidden bg-[#121212]">
      <div class="absolute transition-all duration-150" :style="canvasArea">
        <TemplatesGridEditorCanvas />
        <!-- Glimm "citrus" sweep over the artboard while the agent is working. -->
        <AgentSweep :active="agentBusy" />
      </div>
      <TemplatesFormatPicker v-if="!started" @confirm="onFormatsChosen" />
      <TemplatesExportPanel v-if="exportOpen" @close="exportOpen = false" />

      <!-- Left floating panel: formats + elements (only once designing) -->
      <div
        v-if="started"
        class="absolute top-4 left-4 bottom-4 z-20 w-60 flex flex-col rounded-xl border border-white/10 bg-[#0e0e10]/80 backdrop-blur-md shadow-2xl overflow-hidden"
      >
        <div class="flex-1 min-h-0 overflow-y-auto">
          <TemplatesFormatList />
          <div class="border-t border-white/[0.06]" />
          <TemplatesLayersPanel />
        </div>
      </div>

      <!-- Right panel: the agent's progress / proposal take it over while active
           (Assistant), otherwise it hosts the element / stack inspector. The prompt
           itself lives in the bottom cluster, above the toolbar. -->
      <div
        v-if="started && rightPanelOpen"
        class="absolute top-4 right-4 bottom-4 z-30 flex w-80 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0e0e10]/80 shadow-2xl backdrop-blur-md"
      >
        <template v-if="agentPanelActive">
          <div class="shrink-0 border-b border-white/[0.06] px-4 py-3 flex items-center gap-2">
            <span class="text-white/70">✦</span>
            <span class="text-sm font-medium">Assistant</span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-3">
            <AgentProgress v-if="agentBusy" :active="agentBusy" />
            <div v-else-if="agentReviewing && !agentHasProposal" class="flex items-center gap-1.5 text-[11.5px] text-white/55">
              <span class="text-white/75">✦</span> Looking at the result<span class="animate-pulse">…</span>
            </div>
            <AgentProposal
              v-else-if="agentHasProposal"
              :changes="agentChanges" :busy="agentBusy" :issues="agentIssues"
              :review="agentReview" :reviewing="agentReviewing"
              @accept="acceptChange" @reject="rejectChange" @reroll="agentReroll"
              @keep="agentKeep" @revert="agentRevert" @hover="onAgentHover"
            />
          </div>
        </template>
        <div v-else class="min-h-0 flex-1 overflow-y-auto pt-2">
          <TemplatesGridPropertyPanel v-if="selectedElement" />
          <TemplatesStackInspector v-if="selectedStack" />
        </div>
      </div>

      <!-- Bottom cluster: the agent prompt (v3) sits above the tools + zoom toolbars.
           The column shrink-wraps to the toolbar row, so the bare prompt matches its
           width — the same layout the Compositor uses. -->
      <div v-if="started" class="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-stretch gap-2">
        <div v-if="isV3(template)">
          <AgentBar :busy="agentBusy" :error="agentError" :notice="agentNotice" :chips="[]" @submit="agentAsk" @chip="agentAsk" />
        </div>
        <div class="flex items-center gap-2">
        <div class="flex items-center gap-1 bg-[#1a1a1a]/95 rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg">
        <!-- Grid -->
        <div class="relative">
          <button
            class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] transition-colors cursor-pointer"
            :class="gridPanelOpen ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
            title="Grid settings — columns, rows, gutter, margin"
            @click="gridPanelOpen = !gridPanelOpen"
          >
            <Grid3x3 class="size-4" /> Grid
          </button>
          <div
            v-if="gridPanelOpen"
            class="absolute bottom-full mb-2 left-0 z-30 w-64 rounded-lg bg-[#161616] border border-white/10 shadow-2xl p-3 flex flex-col gap-3"
          >
            <div>
              <p class="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-1.5">
                {{ currentFormat }} grid <span class="text-white/25 normal-case tracking-normal">· {{ formatClass }} default {{ classDefaultDims.cols }}×{{ classDefaultDims.rows }}</span>
              </p>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex items-center gap-1.5">
                  <span class="text-[11px] text-white/40 w-8">Cols</span>
                  <input
                    type="number" min="1" max="24" :value="format.cols ?? ''" :placeholder="String(classDefaultDims.cols)"
                    class="w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-white/30"
                    @change="(e: any) => onDims('cols', e.target.value)"
                  >
                </label>
                <label class="flex items-center gap-1.5">
                  <span class="text-[11px] text-white/40 w-8">Rows</span>
                  <input
                    type="number" min="1" max="24" :value="format.rows ?? ''" :placeholder="String(classDefaultDims.rows)"
                    class="w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-white/30"
                    @change="(e: any) => onDims('rows', e.target.value)"
                  >
                </label>
              </div>
              <button
                v-if="format.cols != null || format.rows != null"
                class="mt-1.5 text-[11px] text-white/60 hover:text-white transition-colors cursor-pointer underline underline-offset-2"
                @click="ctx.setFormatDims(currentFormat, { cols: undefined, rows: undefined })"
              >
                Reset to class default
              </button>
              <p class="mt-1 text-[10px] text-white/30 leading-snug">
                Applies to this format only. Clear a field to go back to automatic.
              </p>
            </div>
            <div>
              <p class="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-1.5">Spacing <span class="text-white/25 normal-case tracking-normal">· master px, scales per format</span></p>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex items-center gap-1.5">
                  <span class="text-[11px] text-white/40 w-11">Gutter</span>
                  <input
                    type="number" min="0" :value="template.grid.gutter"
                    class="w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-white/30"
                    @change="(e: any) => onGrid('gutter', e.target.value)"
                  >
                </label>
                <label class="flex items-center gap-1.5">
                  <span class="text-[11px] text-white/40 w-11">Margin</span>
                  <input
                    type="number" min="0" :value="template.grid.margin"
                    class="w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[12px] text-white focus:outline-none focus:border-white/30"
                    @change="(e: any) => onGrid('margin', e.target.value)"
                  >
                </label>
              </div>
              <p class="mt-1 text-[10px] text-white/30 leading-snug tabular-nums">
                Here: gutter {{ Math.round(metrics.gutter) }}px · margin {{ Math.round(metrics.margin) }}px · cell {{ Math.round(metrics.cellW) }}×{{ Math.round(metrics.cellH) }}px
              </p>
            </div>
          </div>
        </div>

        <!-- Background -->
        <div class="relative">
          <button
            class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] transition-colors cursor-pointer"
            :class="bgPanelOpen ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
            title="Canvas background — colour or gradient"
            @click="bgPanelOpen = !bgPanelOpen"
          >
            <PaintBucket class="size-4" /> Background
          </button>
          <div
            v-if="bgPanelOpen"
            class="absolute bottom-full mb-2 left-0 z-30 w-72 rounded-lg bg-[#161616] border border-white/10 shadow-2xl p-3 flex flex-col gap-2.5"
          >
            <p class="text-[10px] uppercase tracking-[0.12em] text-white/35">Canvas background</p>
            <div class="flex items-center gap-2">
              <input
                type="color" :value="bgColorHex" title="Background colour"
                class="h-8 w-9 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent"
                @input="(e: any) => setBgFill(e.target.value)"
              >
              <input
                type="text" :value="bgFill" placeholder="#0a0a0a or linear-gradient(135deg,#FF6EB4,#FF8C42)"
                class="h-8 w-full rounded border border-white/[0.06] bg-white/[0.04] px-2 text-[12px] text-white focus:border-white/30 focus:outline-none"
                @change="(e: any) => setBgFill(e.target.value)"
              >
            </div>
            <p v-if="hasBgImage" class="text-[11px] text-white/45">
              An image background is set —
              <button class="cursor-pointer text-white/70 underline underline-offset-2 hover:text-white" @click="setBgFill(bgFill || '#0a0a0a')">replace with colour</button>.
            </p>
            <div class="flex items-center justify-between">
              <p class="text-[10px] leading-snug text-white/30">Solid colour or any CSS gradient.</p>
              <button
                v-if="bgFill || hasBgImage"
                class="cursor-pointer text-[11px] text-white/55 underline underline-offset-2 hover:text-white"
                @click="clearBackground()"
              >Clear</button>
            </div>
          </div>
        </div>

        <!-- Brand -->
        <div class="relative">
          <button
            class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] transition-colors cursor-pointer"
            :class="brandPanelOpen ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
            title="Brand kit — colours, fonts and logo bound across every format"
            @click="brandPanelOpen = !brandPanelOpen"
          >
            <Palette class="size-4" /> Brand
          </button>
          <div
            v-if="brandPanelOpen"
            class="absolute bottom-full mb-2 left-0 z-30 w-72 rounded-lg bg-[#161616] border border-white/10 shadow-2xl p-3 flex flex-col gap-3"
          >
            <div v-if="activeKit" class="text-[10px] text-white/40 px-1">
              Project kit overrides these template defaults.
            </div>
            <div>
              <p class="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-2">Brand colours</p>
              <div class="flex flex-col gap-1.5">
                <label v-for="k in COLOR_KEYS" :key="k" class="flex items-center gap-2">
                  <input
                    type="color" :value="brandVal(k) || '#888888'"
                    class="size-6 shrink-0 rounded border border-white/[0.06] bg-transparent cursor-pointer"
                    @input="(e: any) => ctx.setBrand({ [k]: e.target.value })"
                  >
                  <span class="text-[11px] text-white/55 w-20">{{ COLOR_LABELS[k] }}</span>
                  <input
                    :value="brandVal(k)" placeholder="unset"
                    class="flex-1 h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white focus:outline-none focus:border-white/30 font-mono"
                    @change="(e: any) => ctx.setBrand({ [k]: e.target.value })"
                  >
                </label>
              </div>
            </div>
            <div>
              <p class="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-1.5">Brand fonts</p>
              <div class="flex flex-col gap-1.5">
                <div>
                  <span class="text-[10px] text-white/40">Display</span>
                  <TemplatesFontPicker :model-value="brandVal('fontDisplay') || 'Inter'" @update:model-value="(f) => setBrandFont('fontDisplay', f)" />
                </div>
                <div>
                  <span class="text-[10px] text-white/40">Body</span>
                  <TemplatesFontPicker :model-value="brandVal('fontBody') || 'Inter'" @update:model-value="(f) => setBrandFont('fontBody', f)" />
                </div>
              </div>
            </div>
            <div>
              <p class="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-1.5">Logo URL</p>
              <input
                :value="brandVal('logo')" placeholder="https://…  (bind on an image element)"
                class="w-full h-7 px-2 bg-white/[0.04] border border-white/[0.06] rounded text-[11px] text-white focus:outline-none focus:border-white/30"
                @change="(e: any) => ctx.setBrand({ logo: e.target.value })"
              >
            </div>
            <p class="text-[10px] text-white/30 leading-snug">
              Bind an element's colour/font to a brand slot in its properties — swap the kit here and every format re-skins.
            </p>
          </div>
        </div>

        <!-- Long copy -->
        <button
          class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] transition-colors cursor-pointer"
          :class="worstCase ? 'bg-amber-500/15 text-amber-200' : 'text-white/70 hover:bg-white/10 hover:text-white'"
          title="Preview with worst-case copy length — stress-test shrinking and truncation"
          @click="worstCase = !worstCase"
        >
          <CaseSensitive class="size-4" /> Long copy
        </button>

        <div class="w-px h-5 bg-white/10 mx-0.5" />

        <button
          class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          @click="ctx.addText()"
        >
          <TypeIcon class="size-3.5" /> Text
        </button>
        <button
          class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          @click="ctx.addImage()"
        >
          <ImagePlus class="size-3.5" /> Image
        </button>
        <button
          class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          @click="ctx.addShape()"
        >
          <Square class="size-3.5" /> Shape
        </button>
        <button
          class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-[12px] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          :class="selectedId ? 'text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200' : 'text-white/70'"
          :disabled="!selectedId"
          title="Wrap selected element in a Stack (auto-layout group)"
          @click="wrapSelectionInStack()"
        >
          <Layers2 class="size-3.5" /> Stack
        </button>
        </div>

        <!-- Zoom -->
        <div class="flex items-center gap-0.5 bg-[#1a1a1a]/95 rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg">
          <button
            class="size-8 rounded-md flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer text-base leading-none"
            title="Zoom out"
            @click="ctx.zoomBy(1 / 1.2)"
          >−</button>
          <button
            class="px-2 h-8 rounded-md flex items-center justify-center text-[11px] tabular-nums text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer min-w-[3rem]"
            :title="ctx.isZoomFitted.value ? 'Fitted to view' : 'Click to fit to view'"
            @click="ctx.zoomFit()"
          >
            {{ Math.round(ctx.scale.value * 100) }}%
          </button>
          <button
            class="size-8 rounded-md flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer text-base leading-none"
            title="Zoom in"
            @click="ctx.zoomBy(1.2)"
          >+</button>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Crossfade the agent progress line out and the proposed changes in. */
.agent-fade-enter-active,
.agent-fade-leave-active { transition: opacity 0.25s ease; }
.agent-fade-enter-from,
.agent-fade-leave-to { opacity: 0; }
</style>
