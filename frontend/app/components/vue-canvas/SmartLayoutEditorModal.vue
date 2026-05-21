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

import type { Template } from '~~/server/templates/schema'

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

function readLayout(): Template {
  const i = widgetIdx('layout')
  if (i < 0 || !node.value) return makeStarter()
  const raw = String(node.value.data.widgetsValues?.[i] ?? '').trim()
  if (!raw) return makeStarter()
  try {
    return JSON.parse(raw) as Template
  } catch {
    return makeStarter()
  }
}

function writeLayout(layout: Template) {
  const i = widgetIdx('layout')
  if (i < 0 || !node.value) return
  node.value.data.widgetsValues[i] = JSON.stringify(layout, null, 2)
}

// Starter layout for a freshly-dropped SmartLayout. Mirrors what the Python
// _STARTER_LAYOUT looks like so visual editor + execution agree on defaults.
// Ships with a centered headline placeholder so a wired Text node has
// somewhere to land — same reasoning as the Python side.
function makeStarter(): Template {
  return {
    version: 1,
    id: `layout_${Math.random().toString(36).slice(2, 8)}`,
    name: 'New Layout',
    aspects: {
      '1x1':  { w: 1080, h: 1080, label: 'Square' },
      '9x16': { w: 1080, h: 1920, label: 'Vertical' },
      '16x9': { w: 1920, h: 1080, label: 'Horizontal' },
    },
    defaultAspect: '1x1',
    background: { fill: '#0a0a0a' },
    elements: [
      {
        id: 'headline',
        type: 'text',
        role: 'HEADLINE',
        anchor: 'center',
        offset: { x: 0, y: 0 },
        size: { w: '84%', h: 'auto' },
        style: {
          fontFamily: 'Inter',
          fontSize: 96,
          fontWeight: 700,
          color: '#ffffff',
          align: 'center',
          lineHeight: 1.1,
        },
        content: '{{ props.headline }}',
      } as any,
    ],
  }
}

// Snapshot the initial layout once on mount — the editor mutates its own copy
// and we only commit back on Save.
const initial = ref<Template | null>(null)
onMounted(() => {
  const layout = readLayout()
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

const initialProps = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  for (let i = 1; i <= _MAX_TEXT_LAYERS; i++) {
    const raw = readUpstreamText(`text_layer_${i}`)
    if (raw) out[`text_layer_${i}`] = raw
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
  // Connected but the source isn't introspectable — return empty so the
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
function onLayoutSaved(layout: Template) {
  writeLayout(layout)
  emit('close')
}
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

    <!-- The editor itself. EditorShell receives `initial` and mutates its
         own composable state; we re-read on Save via the @save event. -->
    <TemplatesEditorShell
      v-if="initial"
      :key="nodeId"
      :initial="initial"
      :initial-props="initialProps"
      :initial-brand="initialBrand"
      embedded
      @save="onLayoutSaved"
    />
  </div>
</template>
