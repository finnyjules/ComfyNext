<script setup lang="ts">
/**
 * Full-screen modal that mounts the visual layout editor (EditorShell) over
 * the canvas. Reads the SmartLayout node's `layout` widget JSON as the
 * initial state, writes it back when the user clicks Save.
 *
 * The editor inside is identical to what the standalone tab used to mount,
 * just with a different data source + lifecycle.
 */
import { X } from 'lucide-vue-next'

import type { AnyTemplate, Template } from '~~/server/templates/schema'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const props = defineProps<{
  nodeId: string
  nodes: any[]
  edges: any[]
}>()

const emit = defineEmits<{ close: [] }>()

// -- Find the node + its layout widget -------------------------------------

const node = computed(() => props.nodes.find((n: any) => n.id === props.nodeId))

function widgetIdx(name: string): number {
  return (node.value?.data?.widgetDefs as any[] | undefined)
    ?.findIndex((d: any) => d.name === name) ?? -1
}

function readLayout(): AnyTemplate {
  const i = widgetIdx('layout')
  if (i < 0 || !node.value) return makeStarter()
  const raw = String(node.value.data.widgetsValues?.[i] ?? '').trim()
  if (!raw) return makeStarter()
  try {
    return JSON.parse(raw) as AnyTemplate
  } catch {
    return makeStarter()
  }
}

function writeLayout(layout: AnyTemplate) {
  const i = widgetIdx('layout')
  if (i < 0 || !node.value) return
  node.value.data.widgetsValues[i] = JSON.stringify(layout, null, 2)
}

// Starter layout for a freshly-dropped SmartLayout: the v2 Swiss-grid starter,
// mirroring the Python _STARTER_LAYOUT so editor + execution agree on defaults.
function makeStarter(): AnyTemplate {
  return makeStarterTemplate(`layout_${Math.random().toString(36).slice(2, 8)}`)
}

const isV2 = computed(() => (initial.value as any)?.version === 2)

/** v2 twin of the Python _autopopulate_elements_v2: one grid-region element
 * per connected layer socket, only when the template has none yet.
 * Strip/skyscraper placement comes from the resolver's default class layouts. */
function autopopulateV2(layout: TemplateV2, connected: Record<string, string>) {
  if (layout.elements.length) return
  const keys = Object.keys(connected).sort()
  for (const key of keys) {
    if (key.startsWith('image_layer_')) {
      const idx = Number(key.slice('image_layer_'.length))
      if (idx === 1) {
        layout.elements.push({
          id: key, type: 'image', role: `IMAGE_LAYER_${idx}`, priority: 4,
          region: { col: 1, colSpan: 6, row: 1, rowSpan: 6 },
          focal: { x: 0.5, y: 0.5 },
          style: { fit: 'cover' },
          content: `{{ props.${key} }}`,
        })
      } else {
        layout.elements.push({
          id: key, type: 'image', role: `IMAGE_LAYER_${idx}`, priority: 5 + idx,
          region: { col: 6, colSpan: 1, row: Math.min(6, idx - 1), rowSpan: 1 },
          collapse: 'mark',
          style: { fit: 'cover' },
          content: `{{ props.${key} }}`,
        })
      }
    } else if (key.startsWith('text_layer_')) {
      const idx = Number(key.slice('text_layer_'.length))
      if (idx === 1) {
        layout.elements.push({
          id: key, type: 'text', role: `TEXT_LAYER_${idx}`, priority: 1,
          level: 'display',
          region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 },
          overflow: 'shrink-then-truncate',
          style: { fontWeight: 700, color: '#ffffff' },
          content: `{{ props.${key} }}`,
        })
      } else {
        layout.elements.push({
          id: key, type: 'text', role: `TEXT_LAYER_${idx}`, priority: 5,
          level: 'subhead',
          region: { col: 1, colSpan: 4, row: 6, rowSpan: 1 },
          style: { color: '#ffffff' },
          content: `{{ props.${key} }}`,
        })
      }
    }
  }
}

// Snapshot the initial layout once on mount — the editor mutates its own copy
// and we only commit back on Save.
const initial = ref<AnyTemplate | null>(null)
onMounted(() => {
  const layout = readLayout()
  if ((layout as any).version === 2) {
    autopopulateV2(layout as TemplateV2, initialProps.value)
    initial.value = layout
    jsonDraft.value = JSON.stringify(layout, null, 2)
    return
  }
  // Auto-create one element per connected layer socket if the user hasn't
  // already added one. Images stack on the top half (so they read as the
  // hero area); text stacks on the bottom half. Both centered horizontally.
  // Each element references its own `{{ props.<socket> }}` placeholder and
  // is editable like any other element afterwards.
  for (const key of Object.keys(initialProps.value)) {
    if (layout.elements.find((e: any) => e.id === key)) continue

    if (key.startsWith('text_layer_')) {
      const idx = Number(key.slice('text_layer_'.length))
      layout.elements.push({
        id: key,
        type: 'text',
        role: `TEXT_LAYER_${idx}`,
        anchor: 'top-center',
        // Text starts at ~58% of canvas height, each layer ~12% below.
        offset: { x: 0, y: `${58 + (idx - 1) * 12}%` },
        size: { w: '84%', h: 'auto' },
        style: {
          fontFamily: 'Inter',
          fontSize: idx === 1 ? 72 : 44,
          fontWeight: idx === 1 ? 700 : 400,
          color: '#ffffff',
          align: 'center',
          lineHeight: 1.1,
        },
        content: `{{ props.${key} }}`,
      } as any)
    } else if (key.startsWith('image_layer_')) {
      const idx = Number(key.slice('image_layer_'.length))
      if (idx === 1) {
        // First image fills the canvas as a background. Text layers overlay
        // on top. Matches the Python autopopulate defaults so the editor's
        // canvas preview and the server-side satori render agree.
        layout.elements.push({
          id: key,
          type: 'image',
          role: `IMAGE_LAYER_${idx}`,
          anchor: 'top-left',
          offset: { x: 0, y: 0 },
          size: { w: '100%', h: '100%' },
          style: { fit: 'cover', borderRadius: 0 },
          content: `{{ props.${key} }}`,
        } as any)
      } else {
        // Additional images sit as smaller corner thumbnails.
        layout.elements.push({
          id: key,
          type: 'image',
          role: `IMAGE_LAYER_${idx}`,
          anchor: 'top-right',
          offset: { x: '4%', y: `${4 + (idx - 2) * 14}%` },
          size: { w: '20%', h: '12%' },
          style: { fit: 'cover', borderRadius: 12 },
          content: `{{ props.${key} }}`,
        } as any)
      }
    }
  }
  initial.value = layout
})

/**
 * Walk back from one of this SmartLayout's named inputs to whatever's wired
 * into it. Returns the upstream Text node's widget value, or null if nothing
 * is wired or the upstream isn't a Text node.
 *
 * Only Text nodes are introspectable today — pulling live values from
 * Claude/Gemini/Whisper would require running the upstream graph. Defer.
 */
function readUpstreamText(inputName: string): string | null {
  const node = props.nodes.find((n: any) => n.id === props.nodeId)
  if (!node) return null
  const inputs = node.data?.inputs as any[] | undefined
  if (!inputs) return null

  const idx = inputs.findIndex((i: any) => i.name === inputName)
  if (idx < 0) return null

  const edge = props.edges.find((e: any) =>
    e.target === props.nodeId && e.targetHandle === `input-${idx}`)
  if (!edge) return null

  const source = props.nodes.find((n: any) => n.id === edge.source)
  if (!source || source.data?.nodeType !== 'Text') return null

  const defs = source.data.widgetDefs as any[] | undefined
  const wv = source.data.widgetsValues as any[] | undefined
  if (!defs || !wv) return null
  const textIdx = defs.findIndex((d: any) => d.name === 'text')
  if (textIdx < 0) return null
  const raw = String(wv[textIdx] ?? '').trim()
  return raw || null
}

/** Same as readUpstreamText but parses the result as key=value pairs (for brand). */
function readUpstreamKv(inputName: string): Record<string, string> {
  const raw = readUpstreamText(inputName)
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const [k, v] = t.split('=', 2)
    out[k.trim()] = v.trim()
  }
  return out
}

// One placeholder per connected text_layer_<N> socket. Indexed by socket id
// (text_layer_1, text_layer_2, …). The editor auto-creates a text element
// per entry below, and the renderer substitutes via `{{ props.text_layer_N }}`.
const _MAX_TEXT_LAYERS = 8
const _MAX_IMAGE_LAYERS = 8

/** All entries of an upstream multi-entry Text node (the canvas Text artifact
 * stores them on data.properties.textEntries), falling back to the single
 * widget value. At run time the node fans out one render per entry; in the
 * editor the active variant drives the preview via the cycler. */
function readUpstreamTextVariants(inputName: string): string[] {
  const node = props.nodes.find((n: any) => n.id === props.nodeId)
  if (!node) return []
  const inputs = node.data?.inputs as any[] | undefined
  if (!inputs) return []
  const idx = inputs.findIndex((i: any) => i.name === inputName)
  if (idx < 0) return []
  const edge = props.edges.find((e: any) =>
    e.target === props.nodeId && e.targetHandle === `input-${idx}`)
  if (!edge) return []
  const source = props.nodes.find((n: any) => n.id === edge.source)
  if (!source || source.data?.nodeType !== 'Text') return []
  const entries = (source.data.properties?.textEntries as unknown[] | undefined)
    ?.map(s => String(s ?? '').trim()).filter(Boolean)
  if (entries?.length) return entries
  const single = readUpstreamText(inputName)
  return single ? [single] : []
}

const variantsByLayer = computed<Record<string, string[]>>(() => {
  const out: Record<string, string[]> = {}
  for (let i = 1; i <= _MAX_TEXT_LAYERS; i++) {
    const v = readUpstreamTextVariants(`text_layer_${i}`)
    if (v.length) out[`text_layer_${i}`] = v
  }
  return out
})
const activeVariantByLayer = ref<Record<string, number>>({})

// Consumed by the variant cycler in both property panels (v1 + grid).
provide('smartLayoutVariants', { variantsByLayer, activeVariantByLayer })

const initialProps = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  for (let i = 1; i <= _MAX_TEXT_LAYERS; i++) {
    const key = `text_layer_${i}`
    const variants = variantsByLayer.value[key]
    if (variants?.length) {
      const idx = Math.min(variants.length - 1, Math.max(0, activeVariantByLayer.value[key] ?? 0))
      out[key] = variants[idx]
    }
  }
  // For image layers, the editor doesn't actually need the upstream URL to
  // *create* the element — the renderer fills it at execution time. We only
  // care whether each image_layer_<N> socket is *connected*, so we can
  // auto-create a matching element. The placeholder URL falls back to a
  // gray box; LoadImage upstream gets a real preview via readUpstreamImage.
  for (let i = 1; i <= _MAX_IMAGE_LAYERS; i++) {
    const url = readUpstreamImageUrl(`image_layer_${i}`)
    if (url !== null) out[`image_layer_${i}`] = url
  }
  return out
})

/**
 * Best-effort URL extraction for an upstream IMAGE source. Today we only
 * recognise LoadImage (we can read its filename widget). Anything else is
 * opaque (a generated tensor) and gets a placeholder — the actual render at
 * execution time will use the real image. Returns null if not connected,
 * '' if connected but unknown source (caller renders a placeholder tile).
 */
function readUpstreamImageUrl(inputName: string): string | null {
  const node = props.nodes.find((n: any) => n.id === props.nodeId)
  if (!node) return null
  const inputs = node.data?.inputs as any[] | undefined
  if (!inputs) return null
  const idx = inputs.findIndex((i: any) => i.name === inputName)
  if (idx < 0) return null
  const edge = props.edges.find((e: any) =>
    e.target === props.nodeId && e.targetHandle === `input-${idx}`)
  if (!edge) return null

  const source = props.nodes.find((n: any) => n.id === edge.source)
  if (!source) return null

  // LoadImage: surface the picked filename via /view so the editor shows a
  // realistic preview while authoring.
  if (source.data?.nodeType === 'LoadImage') {
    const defs = source.data.widgetDefs as any[] | undefined
    const wv = source.data.widgetsValues as any[] | undefined
    const wIdx = defs?.findIndex((d: any) => d.name === 'image') ?? -1
    const filename = wIdx >= 0 ? wv?.[wIdx] : undefined
    if (filename) return `/view?${new URLSearchParams({ filename: String(filename), type: 'input' })}`
  }
  // Generated images: once the upstream node has executed, its output lands
  // in data.images (same source the node-body thumbnails use) — borrow the
  // latest frame so the editor previews real campaign imagery.
  if (source.data?.images?.length) return String(source.data.images[0])
  // Connected but never run and not introspectable — return empty so the
  // editor places a placeholder element. Actual image fills at render time.
  return ''
}

// What `{{ brand.x }}` placeholders see. Wire `primary=#0a0a0a\naccent=…`
// into the brand socket.
const initialBrand = computed<Record<string, string>>(() =>
  readUpstreamKv('brand'),
)

// Close on Escape.
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// The EditorShell saves via fetch — but we want it to save to the node, not
// to a file. So we listen for a custom save event the shell dispatches.
function onLayoutSaved(layout: AnyTemplate) {
  writeLayout(layout)
  emit('close')
}

// -- v2 (Swiss grid) editing --------------------------------------------------
// Default view is the visual grid editor; the JSON panel stays available as
// an escape hatch (per-format-key overrides have no UI yet).

const v2View = ref<'visual' | 'json'>('visual')
const gridShellKey = ref(0)

/** One-way v1 → v2 conversion. Only persists when the user saves afterwards;
 * closing without saving leaves the node's v1 layout untouched. */
function convertToGrid() {
  if (!initial.value || (initial.value as any).version === 2) return
  const converted = convertV1toV2(initial.value as Template)
  initial.value = converted
  jsonDraft.value = JSON.stringify(converted, null, 2)
  v2View.value = 'visual'
  gridShellKey.value++
}

function showJsonView() {
  // Pick up whatever the visual editor changed before showing the draft.
  jsonDraft.value = JSON.stringify(initial.value, null, 2)
  v2View.value = 'json'
}

function showVisualView() {
  // Remount the shell so it picks up a JSON draft applied in the meantime.
  gridShellKey.value++
  v2View.value = 'visual'
}

const jsonDraft = ref('')
const jsonError = ref('')

/** Parse the draft and refresh the previews without closing the modal. */
function applyV2Draft(): TemplateV2 | null {
  try {
    const parsed = JSON.parse(jsonDraft.value)
    if (parsed?.version !== 2 || typeof parsed.formats !== 'object') {
      jsonError.value = 'Template must have "version": 2 and a "formats" object.'
      return null
    }
    jsonError.value = ''
    initial.value = parsed
    return parsed as TemplateV2
  } catch (e: any) {
    jsonError.value = `Invalid JSON: ${e?.message ?? e}`
    return null
  }
}

function saveV2() {
  const parsed = applyV2Draft()
  if (!parsed) return
  writeLayout(parsed)
  emit('close')
}

/** Props for the preview renders: wired text/image values where readable. */
const v2RenderProps = computed<Record<string, unknown>>(() => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(initialProps.value)) {
    // Empty string means "connected but not introspectable" — skip so the
    // preview shows the slot culled/empty rather than a broken image.
    if (v) out[k] = k.startsWith('image_layer_') ? new URL(v, window.location.origin).toString() : v
  }
  return out
})
</script>

<template>
  <div class="fixed inset-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-sm flex">
    <!-- Close button — Escape also works -->
    <button
      class="absolute top-3 right-3 z-10 size-8 rounded-md bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
      title="Close (Esc)"
      @click="emit('close')"
    >
      <X class="size-4" />
    </button>

    <!-- The v1 editor. EditorShell receives `initial` and mutates its
         own composable state; we re-read on Save via the @save event. -->
    <TemplatesEditorShell
      v-if="initial && !isV2"
      :key="nodeId"
      :initial="initial as any"
      :initial-props="initialProps"
      :initial-brand="initialBrand"
      embedded
      @save="onLayoutSaved"
    />

    <!-- v1 → v2 conversion affordance -->
    <button
      v-if="initial && !isV2"
      class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 h-8 px-3 rounded-full bg-[#96b4ff]/15 hover:bg-[#96b4ff]/25 border border-[#96b4ff]/25 text-[12px] text-[#c9d6ff] transition-colors cursor-pointer"
      title="One-way conversion to the Swiss grid system (auto-reflow to every ad format). Takes effect when you save."
      @click="convertToGrid"
    >
      Convert to grid layout
    </button>

    <!-- The v2 visual grid editor -->
    <TemplatesGridEditorShell
      v-else-if="initial && v2View === 'visual'"
      :key="`${nodeId}-grid-${gridShellKey}`"
      :initial="initial as any"
      :initial-props="initialProps"
      :initial-brand="initialBrand"
      @save="onLayoutSaved"
    >
      <template #topbar-end>
        <button
          class="h-8 px-2.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-white/50 transition-colors cursor-pointer"
          title="Edit the raw layout JSON (escape hatch)"
          @click="showJsonView"
        >
          JSON
        </button>
      </template>
    </TemplatesGridEditorShell>

    <!-- v2 JSON escape hatch: live per-format previews + raw JSON -->
    <div v-else-if="initial" class="flex w-full h-full p-6 gap-4">
      <div class="flex-1 min-w-0 flex flex-col rounded-xl bg-[#121212] border border-white/[0.06] overflow-hidden">
        <div class="px-4 py-3 border-b border-white/[0.06] flex items-baseline gap-2">
          <span class="text-[13px] text-white/85 font-medium">Format previews</span>
          <span class="text-[11px] text-white/35">Swiss grid · one master, every format reflows</span>
        </div>
        <TemplatesGridFormatPreviews
          :template="initial as any"
          :render-props="v2RenderProps"
          :brand="initialBrand"
          class="flex-1"
        />
      </div>
      <div class="w-[420px] shrink-0 flex flex-col rounded-xl bg-[#121212] border border-white/[0.06] overflow-hidden">
        <div class="px-4 py-3 border-b border-white/[0.06]">
          <span class="text-[13px] text-white/85 font-medium">Layout JSON</span>
          <p class="text-[11px] text-white/35 mt-0.5">Visual grid editing is coming; for now edit regions here.</p>
        </div>
        <textarea
          v-model="jsonDraft"
          spellcheck="false"
          class="flex-1 w-full resize-none bg-transparent text-[12px] font-mono text-white/80 p-4 outline-none"
        />
        <div class="px-4 py-3 border-t border-white/[0.06] flex items-center gap-2">
          <button
            class="px-3 h-8 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-xs text-white/80 transition-colors cursor-pointer"
            @click="showVisualView"
          >
            Back to visual
          </button>
          <button
            class="px-3 h-8 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-xs text-white/80 transition-colors cursor-pointer"
            @click="applyV2Draft"
          >
            Apply to previews
          </button>
          <button
            class="px-3 h-8 rounded-md bg-[#96b4ff]/20 hover:bg-[#96b4ff]/30 text-xs text-[#c9d6ff] transition-colors cursor-pointer"
            @click="saveV2"
          >
            Save to node
          </button>
          <span v-if="jsonError" class="text-[11px] text-red-400 truncate">{{ jsonError }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
