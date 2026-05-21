<script setup lang="ts">
// force HMR reload
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { fetchObjectInfo, getWidgetDefs, isSubgraphType, subgraphToLiteGraph } from '~/composables/useVueNodes'
import { useSubgraphNavigation } from '~/composables/useSubgraphNavigation'
import { useCanvasHistory } from '~/composables/useCanvasHistory'
import ComfyNode from '~/components/vue-canvas/ComfyNode.vue'
import ComfyNoteNode from '~/components/vue-canvas/ComfyNoteNode.vue'
import ComfyEdge from '~/components/vue-canvas/ComfyEdge.vue'
import ComfyGateNode from '~/components/vue-canvas/ComfyGateNode.vue'
import SubgraphIONode from '~/components/vue-canvas/SubgraphIONode.vue'
import SubgraphBreadcrumb from '~/components/vue-canvas/SubgraphBreadcrumb.vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'

const props = defineProps<{
  workflow: any
  activeTool?: string // 'select' | 'hand'
}>()

const { nodes, edges, objectInfo, convertFromLiteGraph, convertToLiteGraph } = useVueNodes()

// Make the live graph available to child nodes that need to look up upstream
// data (e.g. MaskExtractor showing its source image as a fallback preview).
provide('vueFlowNodes', nodes)
provide('vueFlowEdges', edges)
const { onConnect, addEdges, fitView, zoomIn: vfZoomIn, zoomOut: vfZoomOut, project } = useVueFlow()

// Undo / redo — snapshots nodes+edges on a short debounce. The `isRestoring`
// guard prevents the watcher from snapshotting our own programmatic restore.
const history = useCanvasHistory()
let isRestoringHistory = false
let snapshotTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSnapshot() {
  if (isRestoringHistory) return
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    history.snapshot({ nodes: nodes.value as any[], edges: edges.value as any[] })
  }, 350)
}

watch([nodes, edges], scheduleSnapshot, { deep: true })

async function applyHistoryState(state: { nodes: any[], edges: any[] } | null) {
  if (!state) return
  isRestoringHistory = true
  // Splice in place so Vue Flow's reactivity picks up the change cleanly.
  nodes.value.splice(0, nodes.value.length, ...state.nodes)
  edges.value.splice(0, edges.value.length, ...state.edges)
  await nextTick()
  // Give the debounced snapshot a beat to skip, then release the guard.
  setTimeout(() => { isRestoringHistory = false }, 50)
}

function handleHistoryKey(e: KeyboardEvent) {
  const isUndo = (e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey
  const isRedo = (e.metaKey || e.ctrlKey) && ((e.key === 'Z' && e.shiftKey) || e.key === 'y')
  if (!isUndo && !isRedo) return

  // Don't hijack undo inside text inputs — native input-undo is more useful there.
  const ae = document.activeElement
  if (ae instanceof Element
    && (ae.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      || ae.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) {
    return
  }
  e.preventDefault()
  applyHistoryState(isUndo ? history.undo() : history.redo())
}

// Tool mode: select vs hand
// Vue Flow's selection box requires selectionKeyCode === true AND panOnDrag === false
const isHandMode = computed(() => props.activeTool === 'hand')
const panOnDrag = computed(() => isHandMode.value)          // hand: left-click pans; select: false
const selectionKeyCode = computed(() => isHandMode.value ? null : true) // select: enable drag-selection; hand: disable

// Subgraph navigation
const { isInsideSubgraph, breadcrumbs, enterSubgraph, exitToLevel, saveCurrentSubgraph, reset: resetNav } = useSubgraphNavigation()
const rootWorkflow = ref<any>(null) // Full workflow with definitions

// Handle node drop from sidebar
async function handleDrop(event: DragEvent) {
  event.preventDefault()
  const nodeType = event.dataTransfer?.getData('text/plain')
  if (!nodeType) return

  // Refresh schema if we don't know this node type — protects against the
  // common case of "ComfyUI was restarted with new nodes but the cache is
  // stale," which results in a node rendering without any ports.
  if (!objectInfo.value[nodeType]) {
    await fetchObjectInfo()
  }

  const canvasEl = (event.currentTarget as HTMLElement)
  const rect = canvasEl.getBoundingClientRect()
  const position = project({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  })

  const newId = String(Date.now())
  const info = objectInfo.value[nodeType]
  const widgetDefs = getWidgetDefs(nodeType)

  // Gate nodes use a dedicated component type
  const vueFlowType = nodeType === 'ComfyGateNode' ? 'gate' : 'comfy'

  nodes.value.push({
    id: newId,
    type: vueFlowType,
    position,
    data: {
      nodeType,
      title: info?.display_name || nodeType,
      inputs: [
        ...Object.entries((info?.input?.required ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: false })),
        ...Object.entries((info?.input?.optional ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: true })),
      ]
        .filter(({ s }) => {
          // Same rule as above: non-widget types become ports, and widget-typed
          // inputs marked forceInput become ports too.
          const specArr = Array.isArray(s) ? s : [s]
          const type = specArr[0]
          const cfg = specArr[1] || {}
          if (Array.isArray(type)) return false
          if (cfg.forceInput) return true
          return !['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'].includes(String(type))
        })
        .map(({ n, s, optional }) => ({
          name: n,
          type: Array.isArray(s) ? String(s[0]) : String(s),
          link: null,
          optional,
        })),
      outputs: (info?.output || []).map((type: string, i: number) => ({
        name: info?.output_name?.[i] || type,
        type,
        links: null,
      })),
      widgetsValues: widgetDefs.map((w: any) => w.default ?? null),
      widgetDefs,
      properties: {},
      mode: 0,
      size: [220, 120],
      category: info?.category || '',
      priceBadge: info?.price_badge || null,
      ...(nodeType === 'ComfyGateNode' ? { paused: false, promptId: null } : {}),
    },
  } as any)
}

// Load workflow when prop changes (ensure object_info is ready first)
// Track the workflow identity to avoid re-processing the same object
let lastWorkflowRef: any = null
watch(
  () => props.workflow,
  async (wf) => {
    if (!wf) return
    // Skip if we're inside a subgraph (canvas is self-managing)
    // or if the workflow object hasn't actually changed
    if (isInsideSubgraph.value || wf === lastWorkflowRef) return
    lastWorkflowRef = wf
    rootWorkflow.value = wf
    resetNav()
    await fetchObjectInfo()
    convertFromLiteGraph(wf, wf.definitions)
    nextTick(() => fitView({ padding: 0.2 }))
  },
  { immediate: true },
)

// Re-apply widget defs and sync outputs if object_info loads after the initial conversion
watch(objectInfo, (info) => {
  if (!info || !Object.keys(info).length) return
  for (const n of nodes.value as any[]) {
    if (!n.data?.nodeType) continue
    const nodeInfo = info[n.data.nodeType]
    if (!nodeInfo) continue

    const updates: Record<string, any> = {}

    if (!n.data.widgetDefs?.length) {
      const defs = getWidgetDefs(n.data.nodeType)
      if (defs.length) updates.widgetDefs = defs
    }

    // Sync outputs from object_info if the node has fewer outputs than defined
    const expectedOutputs = (nodeInfo.output || []).map((type: string, i: number) => ({
      name: nodeInfo.output_name?.[i] || type,
      type,
      links: null,
    }))
    if (expectedOutputs.length > (n.data.outputs?.length || 0)) {
      // Preserve existing link data for outputs that already exist
      const merged = expectedOutputs.map((eo: any, i: number) => n.data.outputs?.[i] || eo)
      updates.outputs = merged
    }

    if (!n.data.category && nodeInfo.category) {
      updates.category = nodeInfo.category
    }
    if (!n.data.priceBadge && nodeInfo.price_badge) {
      updates.priceBadge = nodeInfo.price_badge
    }

    if (Object.keys(updates).length) {
      n.data = { ...n.data, ...updates }
    }
  }
})

// Handle new connections
onConnect((params) => {
  const sourceNode = (nodes.value as any[]).find(n => n.id === params.source)
  const outputIndex = parseInt(params.sourceHandle?.replace('output-', '') || '0')
  const dataType = sourceNode?.data?.outputs?.[outputIndex]?.type || '*'
  addEdges([{ ...params, type: 'comfy', data: { dataType } }])
})

// Listen for addNode events from NodeSearchDialog
async function handleAddNode(e: Event) {
  const detail = (e as CustomEvent<{ nodeType: string, widgetOverrides?: Record<string, unknown> }>).detail
  const { nodeType, widgetOverrides } = detail

  // Refresh schema if we don't know this node type.
  if (!objectInfo.value[nodeType]) {
    await fetchObjectInfo()
  }

  // Get viewport center for placement
  const center = project({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const newId = String(Date.now())
  const info = objectInfo.value[nodeType]
  const widgetDefs = getWidgetDefs(nodeType)
  const vueFlowType = nodeType === 'ComfyGateNode' ? 'gate' : 'comfy'

  // Apply any name-based overrides supplied by the caller (used by the LoRA
  // Library to pre-fill `lora_url`, etc.). Widget order is whatever
  // getWidgetDefs returns — we look up positions by name.
  const widgetsValues = widgetDefs.map((w: any) => w.default ?? null)
  if (widgetOverrides) {
    for (const [name, value] of Object.entries(widgetOverrides)) {
      const idx = widgetDefs.findIndex((w: any) => w.name === name)
      if (idx >= 0) widgetsValues[idx] = value
    }
  }

  nodes.value.push({
    id: newId,
    type: vueFlowType,
    position: { x: center.x, y: center.y },
    data: {
      nodeType,
      title: info?.display_name || nodeType,
      inputs: [
        ...Object.entries((info?.input?.required ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: false })),
        ...Object.entries((info?.input?.optional ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: true })),
      ]
        .filter(({ s }) => {
          // Non-widget input types (IMAGE, MODEL, AUDIO, …) always become ports.
          // Widget-typed inputs marked `forceInput` become ports too — Comfy's
          // opt-in for "render this connectable, not as a text field".
          const specArr = Array.isArray(s) ? s : [s]
          const type = specArr[0]
          const cfg = specArr[1] || {}
          if (Array.isArray(type)) return false
          if (cfg.forceInput) return true
          return !['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'].includes(String(type))
        })
        .map(({ n, s, optional }) => ({
          name: n,
          type: Array.isArray(s) ? String(s[0]) : String(s),
          link: null,
          optional,
        })),
      outputs: (info?.output || []).map((type: string, i: number) => ({
        name: info?.output_name?.[i] || type,
        type,
        links: null,
      })),
      widgetsValues,
      widgetDefs,
      properties: {},
      mode: 0,
      size: [220, 120],
      category: info?.category || '',
      priceBadge: info?.price_badge || null,
      ...(nodeType === 'ComfyGateNode' ? { paused: false, promptId: null } : {}),
    },
  } as any)
}

// Subgraph navigation: double-click to enter
function handleNodeDoubleClick({ node }: { node: any }) {
  if (!node.data?.isSubgraph || !node.data?.subgraphId) return
  if (!rootWorkflow.value?.definitions) return

  const innerWorkflow = enterSubgraph(
    node.data.subgraphId,
    node.data.subgraphName || node.data.title,
    JSON.parse(JSON.stringify(nodes.value)),
    JSON.parse(JSON.stringify(edges.value)),
    rootWorkflow.value.definitions,
  )
  if (!innerWorkflow) return

  // Render the inner subgraph workflow
  convertFromLiteGraph(innerWorkflow, rootWorkflow.value.definitions)
  nextTick(() => fitView({ padding: 0.2 }))
}

// Subgraph navigation: breadcrumb click to exit
function handleBreadcrumbNavigate(index: number) {
  if (!rootWorkflow.value?.definitions) return

  const restored = exitToLevel(
    index,
    JSON.parse(JSON.stringify(nodes.value)),
    JSON.parse(JSON.stringify(edges.value)),
    rootWorkflow.value.definitions,
    convertToLiteGraph,
  )
  if (!restored) return

  if (index === -1) {
    // Going back to root: re-convert from the root workflow (with updated definitions)
    convertFromLiteGraph(rootWorkflow.value, rootWorkflow.value.definitions)
  } else {
    // Restore the snapshotted state
    nodes.value = restored.nodes
    edges.value = restored.edges
  }
  nextTick(() => fitView({ padding: 0.2 }))
}

// Get workflow with subgraph awareness
function getWorkflowWithSubgraphs() {
  // If inside a subgraph, save current state back to definitions first
  if (isInsideSubgraph.value && rootWorkflow.value?.definitions) {
    saveCurrentSubgraph(
      nodes.value as any[],
      edges.value as any[],
      rootWorkflow.value.definitions,
      convertToLiteGraph,
    )
  }

  // Always return the root workflow with updated definitions
  if (rootWorkflow.value) {
    // If we're at root level, get the current state
    if (!isInsideSubgraph.value) {
      const wf = convertToLiteGraph()
      // Preserve definitions from root
      if (rootWorkflow.value.definitions) {
        ;(wf as any).definitions = rootWorkflow.value.definitions
      }
      return wf
    }
    // If inside a subgraph, return the root workflow (definitions already updated above)
    return rootWorkflow.value
  }

  return convertToLiteGraph()
}

// Listen for execution progress from bridge (via postMessage)
function handleBridgeMessage(event: MessageEvent) {
  if (event.data?.type !== 'comfynext-bridge') return

  const { event: evt, node_id, node, percent, progress: prog } = event.data
  const nodeId = node_id || node // bridge sends node_id, normalize
  if (evt === 'executing') {
    // Clear all running states on nodes and edges
    for (const n of nodes.value) {
      if (n.data?.running) {
        n.data = { ...n.data, running: false }
      }
    }
    for (const e of edges.value) {
      if (e.data?.running) {
        e.data = { ...e.data, running: false }
      }
    }
    if (nodeId) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
      if (target) {
        target.data = { ...target.data, running: true, error: false }
        // Mark outgoing edges from this node as running
        for (const e of edges.value) {
          if (e.source === String(nodeId)) {
            e.data = { ...e.data, running: true }
          }
        }
      }
    }
  }

  if (evt === 'progress') {
    // Update progress on the currently running node
    const running = (nodes.value as any[]).find((n: any) => n.data?.running)
    if (running) {
      // Bridge sends percent directly, or prog.value/prog.max
      const pct = percent ?? (prog ? Math.round((prog.value / prog.max) * 100) : undefined)
      if (pct !== undefined) running.data = { ...running.data, progress: pct }
    }
  }

  if (evt === 'executed') {
    // Store output images/videos/audio on the node (for PreviewImage, PreviewVideo, PreviewAudio, SaveImage etc.)
    const output = event.data.output
    if (nodeId && output) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
      if (target) {
        const toUrl = (f: any) => {
          const params = new URLSearchParams({ filename: f.filename, type: f.type })
          if (f.subfolder) params.set('subfolder', f.subfolder)
          // Cache-buster: live-preview nodes reuse a fixed filename, so without
          // a unique query the browser would serve the stale cached file.
          params.set('t', String(Date.now()))
          return `/view?${params}`
        }
        const next: any = { ...target.data }
        if (Array.isArray(output.images) && output.images.length) {
          next.images = output.images.map(toUrl)
          next.animated = output.animated?.[0] === true
        }
        if (Array.isArray(output.audio) && output.audio.length) {
          next.audios = output.audio.map(toUrl)
        }
        // PreviewAny / "Preview as Text" nodes return { ui: { text: [string] } }
        // which ComfyUI's execution events surface as `output.text`. Same goes
        // for any node that exposes a debug-style text payload.
        if (Array.isArray(output.text) && output.text.length) {
          next.text = output.text.map((t: any) => String(t)).join('\n\n')
        }
        target.data = next
      }
    }
  }

  if (evt === 'execution_error') {
    if (nodeId) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
      if (target) {
        target.data = { ...target.data, running: false, error: true }
      }
    }
  }

  if (evt === 'execution_complete') {
    // Clear all running/progress states on nodes and edges
    for (const n of nodes.value) {
      if (n.data?.running || n.data?.progress) {
        n.data = { ...n.data, running: false, progress: undefined }
      }
    }
    for (const e of edges.value) {
      if (e.data?.running) {
        e.data = { ...e.data, running: false }
      }
    }
  }

  if (evt === 'gate_paused') {
    const promptId = event.data.prompt_id
    const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
    console.log('[Gate] gate_paused handler:', { nodeId, promptId, found: !!target })
    if (target) {
      target.data = { ...target.data, paused: true, promptId, running: false }
      console.log('[Gate] node data after update:', { paused: target.data.paused, promptId: target.data.promptId })
    }
  }

  if (evt === 'execution_start') {
    // Reset gate paused state but keep promptId so the user can
    // re-trigger from the gate after execution completes.
    const startPromptId = event.data.prompt_id
    for (const n of nodes.value) {
      if (n.data?.paused && (!startPromptId || n.data.promptId === startPromptId)) {
        n.data = { ...n.data, paused: false }
      }
    }
  }
}

// Compositor modal state.
const compositorOpenForId = ref<string | null>(null)
function handleOpenCompositor(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) compositorOpenForId.value = String(detail.nodeId)
}

// ASCII options drawer state.
const asciiOpenForId = ref<string | null>(null)
function handleOpenAscii(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) asciiOpenForId.value = String(detail.nodeId)
}

// Timeline editor modal state.
const timelineOpenForId = ref<string | null>(null)
function handleOpenTimeline(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) timelineOpenForId.value = String(detail.nodeId)
}

// Crossfade editor modal state.
const crossfadeOpenForId = ref<string | null>(null)
function handleOpenCrossfade(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) crossfadeOpenForId.value = String(detail.nodeId)
}

// SmartLayout editor modal state — the visual layout editor that mounts over
// the canvas when the user clicks "Edit layout" on a SmartLayout node.
const smartLayoutOpenForId = ref<string | null>(null)
function handleOpenSmartLayout(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) smartLayoutOpenForId.value = String(detail.nodeId)
}

// Paste an image directly onto the canvas → uploads it to ComfyUI's input/
// folder and spawns a LoadImage node with the filename pre-filled. Supports
// clipboard image blobs (screenshots) and copied image files (from Finder/
// Explorer). Ignored when focus is in an editable element so Cmd+V in
// widget inputs still pastes text normally.
async function handlePaste(e: ClipboardEvent) {
  // Don't hijack paste when the user's typing in a widget/field. `e.target`
  // can be window (for synthetic dispatches) or non-Element nodes; guard
  // before calling Element methods on it.
  const t = e.target as Element | null
  const isEditableTarget =
    t instanceof Element
    && (t.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      || t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
  if (isEditableTarget) return

  // Skip when the active element is editable (covers focused-but-untargeted
  // inputs, e.g. a focused textarea anywhere on the page).
  const ae = document.activeElement
  if (ae instanceof Element
    && (ae.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      || ae.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) {
    return
  }

  // Pull image from items (screenshots, copied images) or files (file drag).
  const items = Array.from(e.clipboardData?.items ?? [])
  let imageFile: File | null = null
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      imageFile = it.getAsFile()
      if (imageFile) break
    }
  }
  if (!imageFile && e.clipboardData?.files?.length) {
    const f = e.clipboardData.files[0]
    if (f.type.startsWith('image/')) imageFile = f
  }
  if (!imageFile) return

  e.preventDefault()

  // Upload to ComfyUI's input folder. Name is best-effort — screenshots arrive
  // as image.png; we prefix a timestamp so multiple pastes don't collide.
  const ts = Date.now()
  const safeName = (imageFile.name && imageFile.name !== 'image.png')
    ? imageFile.name
    : `pasted-${ts}.png`
  const renamed = new File([imageFile], `${ts}_${safeName.replace(/[^\w.-]+/g, '_')}`, {
    type: imageFile.type,
  })

  const fd = new FormData()
  fd.append('image', renamed)
  fd.append('overwrite', 'true')

  let uploadedName: string
  try {
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(await res.text() || `upload ${res.status}`)
    const data = await res.json()
    uploadedName = data?.name || renamed.name
  } catch (err: any) {
    console.error('[paste] upload failed:', err)
    return
  }

  // Refresh object_info so the LoadImage combo includes the just-uploaded
  // file. Cached by default; force a re-fetch.
  await fetchObjectInfo(true)

  // Spawn a LoadImage node centered in the viewport with the new filename.
  window.dispatchEvent(new CustomEvent('comfynext:addNode', {
    detail: {
      nodeType: 'LoadImage',
      widgetOverrides: { image: uploadedName },
    },
  }))
}

onMounted(() => {
  window.addEventListener('comfynext:addNode', handleAddNode)
  window.addEventListener('message', handleBridgeMessage)
  window.addEventListener('comfynext:openCompositor', handleOpenCompositor)
  window.addEventListener('comfynext:openAsciiOptions', handleOpenAscii)
  window.addEventListener('comfynext:openTimeline', handleOpenTimeline)
  window.addEventListener('comfynext:openCrossfade', handleOpenCrossfade)
  window.addEventListener('comfynext:openSmartLayout', handleOpenSmartLayout)
  window.addEventListener('paste', handlePaste)
  window.addEventListener('keydown', handleHistoryKey)
  // Fetch object_info on mount so widget defs are available
  fetchObjectInfo()
})
onUnmounted(() => {
  window.removeEventListener('comfynext:addNode', handleAddNode)
  window.removeEventListener('message', handleBridgeMessage)
  window.removeEventListener('comfynext:openCompositor', handleOpenCompositor)
  window.removeEventListener('comfynext:openAsciiOptions', handleOpenAscii)
  window.removeEventListener('comfynext:openTimeline', handleOpenTimeline)
  window.removeEventListener('comfynext:openCrossfade', handleOpenCrossfade)
  window.removeEventListener('comfynext:openSmartLayout', handleOpenSmartLayout)
  window.removeEventListener('paste', handlePaste)
  window.removeEventListener('keydown', handleHistoryKey)
  // Revoke any held blob URLs from the client-side compositor previews.
  for (const url of compositorPreviewUrls.values()) URL.revokeObjectURL(url)
  compositorPreviewUrls.clear()
  // Same for Timeline previews; also tear down the hidden <video> elements.
  for (const url of timelinePreviewUrls.values()) URL.revokeObjectURL(url)
  timelinePreviewUrls.clear()
  for (const v of timelinePreviewVideos.values()) {
    try { v.pause(); v.removeAttribute('src'); v.load() } catch {}
  }
  timelinePreviewVideos.clear()
})

// ── Client-side Compositor preview ──────────────────────────────────────────
// The Compositor is just affine transforms + blend ops — we can render it
// instantly in the browser via Canvas instead of running the whole workflow.
// The result becomes the node's preview image via `data.images`.

const compositorPreviewUrls = new Map<string, string>()
const compositorRenderTokens = new Map<string, number>()
const compositorImageCache = new Map<string, HTMLImageElement>()
let compositorRendering = false
let compositorDirty = false
let compositorRafHandle = 0

const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  soft_light: 'soft-light',
  hard_light: 'hard-light',
  difference: 'difference',
  lighten: 'lighten',
  darken: 'darken',
  add: 'lighter',
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = compositorImageCache.get(url)
  if (cached && cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { compositorImageCache.set(url, img); resolve(img) }
    img.onerror = reject
    img.src = url
  })
}

function getUpstreamImageUrl(srcNode: any): string | null {
  if (srcNode?.data?.images?.length) return srcNode.data.images[0]
  if (srcNode?.data?.nodeType === 'LoadImage' && srcNode?.data?.widgetsValues?.[0]) {
    const filename = srcNode.data.widgetsValues[0]
    return `/view?${new URLSearchParams({ filename, type: 'input' })}`
  }
  return null
}

function collectCompositorLayers(node: any): any[] {
  const defs = node.data?.widgetDefs as any[]
  const wv = node.data?.widgetsValues as any[]
  if (!defs || !wv) return []
  const widgetIdx = (name: string) => defs.findIndex((d: any) => d.name === name)
  const out: any[] = []
  for (let i = 1; i <= 4; i++) {
    const port = node.data.inputs?.find((p: any) => p.name === `layer${i}`)
    if (!port?.link) continue
    const edge = (edges.value as any[]).find((e: any) =>
      e.target === node.id && e.targetHandle === `input-${i - 1}`)
    if (!edge) continue
    const src = (nodes.value as any[]).find((n: any) => n.id === edge.source)
    const url = getUpstreamImageUrl(src)
    if (!url) continue
    out.push({
      url,
      x: wv[widgetIdx(`layer${i}_x`)] ?? 0,
      y: wv[widgetIdx(`layer${i}_y`)] ?? 0,
      rotation: wv[widgetIdx(`layer${i}_rotation`)] ?? 0,
      scale: wv[widgetIdx(`layer${i}_scale`)] ?? 1,
      opacity: wv[widgetIdx(`layer${i}_opacity`)] ?? 1,
      blend: wv[widgetIdx(`layer${i}_blend`)] ?? 'normal',
    })
  }
  return out
}

async function renderComposite(layers: any[]): Promise<string> {
  const images = await Promise.all(layers.map(l => loadImage(l.url)))
  // Canvas dims follow layer 1 (the base).
  const base = images[0]
  const maxDim = 512
  const aspect = base.naturalWidth / base.naturalHeight
  let w: number, h: number
  if (aspect >= 1) { w = maxDim; h = Math.round(maxDim / aspect) }
  else            { h = maxDim; w = Math.round(maxDim * aspect) }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const img = images[i]
    // Aspect-preserving fit into canvas (matches backend `_fit_to_canvas`).
    const cAspect = w / h
    const iAspect = img.naturalWidth / img.naturalHeight
    let fitW: number, fitH: number
    if (iAspect > cAspect) { fitW = w; fitH = w / iAspect }
    else                   { fitH = h; fitW = h * iAspect }

    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.globalCompositeOperation = BLEND_MAP[layer.blend] || 'source-over'
    const cx = w / 2 + layer.x * w
    const cy = h / 2 + layer.y * h
    ctx.translate(cx, cy)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    ctx.scale(layer.scale, layer.scale)
    ctx.drawImage(img, -fitW / 2, -fitH / 2, fitW, fitH)
    ctx.restore()
  }

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob returned null'))
      resolve(URL.createObjectURL(blob))
    }, 'image/png')
  })
}

async function renderOneCompositor(node: any) {
  const layers = collectCompositorLayers(node)
  if (!layers.length) {
    const oldUrl = compositorPreviewUrls.get(node.id)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    compositorPreviewUrls.delete(node.id)
    if (node.data.images?.length) node.data = { ...node.data, images: [] }
    return
  }
  const token = (compositorRenderTokens.get(node.id) || 0) + 1
  compositorRenderTokens.set(node.id, token)
  try {
    const url = await renderComposite(layers)
    if (compositorRenderTokens.get(node.id) !== token) {
      URL.revokeObjectURL(url)
      return
    }
    const oldUrl = compositorPreviewUrls.get(node.id)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    compositorPreviewUrls.set(node.id, url)
    node.data = { ...node.data, images: [url] }
  } catch (err) {
    console.warn('[Compositor preview] render failed:', err)
  }
}

// Build a reactive snapshot that includes upstream image identities so the
// watcher fires when LoadImage filenames change or when upstream nodes finish.
function compositorSnapshot(node: any) {
  const inputs = node.data.inputs as any[]
  const sources = inputs.map((port, idx) => {
    if (port?.link == null) return null
    const edge = (edges.value as any[]).find((e: any) =>
      e.target === node.id && e.targetHandle === `input-${idx}`)
    if (!edge) return null
    const src = (nodes.value as any[]).find((n: any) => n.id === edge.source)
    return src?.data?.images?.[0] ?? src?.data?.widgetsValues?.[0] ?? null
  })
  return { id: node.id, widgets: [...(node.data.widgetsValues as any[])], inputs: inputs.map(i => i.link), sources }
}

// Coalesce renders to one per animation frame, with a dirty flag so changes
// during an in-flight render trigger another render immediately after.
// This keeps the preview updating live during a continuous drag — unlike a
// debounce, which would never fire as long as the drag keeps resetting it.
async function maybeRenderCompositors() {
  if (compositorRendering) { compositorDirty = true; return }
  compositorRendering = true
  compositorDirty = false
  try {
    const compositors = (nodes.value as any[]).filter(n => n.data?.nodeType === 'Compositor')
    await Promise.all(compositors.map(renderOneCompositor))
  } finally {
    compositorRendering = false
    if (compositorDirty) maybeRenderCompositors()
  }
}

// Vue's deep watch fires on every reactive change reached by the source,
// *including* our own writes to `node.data.images` — which would feedback-loop
// into another render. JSON-stringifying the snapshot makes Vue compare via
// `===`, so the watch only fires when something we actually care about changes.
watch(
  () => JSON.stringify(
    (nodes.value as any[]).filter(n => n.data?.nodeType === 'Compositor').map(compositorSnapshot)
  ),
  () => {
    if (compositorRafHandle) return
    compositorRafHandle = requestAnimationFrame(() => {
      compositorRafHandle = 0
      maybeRenderCompositors()
    })
  },
  { immediate: true },
)

// ── Client-side Timeline preview ────────────────────────────────────────────
// Mirrors the Compositor pattern but for video sources: each connected clip
// has a hidden <video>; we seek each one to the timeline's middle frame and
// composite them with the same transform/blend math the backend uses. The
// resulting still becomes the node-body preview via `data.images`.

const TIMELINE_FPS = 30
const timelinePreviewUrls = new Map<string, string>()
const timelinePreviewVideos = new Map<string, HTMLVideoElement>()  // keyed `${nodeId}-${slot}`
const timelineRenderTokens = new Map<string, number>()
let timelineRendering = false
let timelineDirty = false
let timelineRafHandle = 0

function getTimelineClipUrl(node: any, slot: number): string | null {
  const edge = (edges.value as any[]).find((e: any) =>
    e.target === node.id && e.targetHandle === `input-${slot - 1}`)
  if (!edge) return null
  const src = (nodes.value as any[]).find((n: any) => n.id === edge.source)
  if (!src) return null
  const type = src.data?.nodeType
  if (type === 'LoadVideoFrames' || type === 'LoadVideo') {
    const fileIdx = src.data.widgetDefs?.findIndex((d: any) => d.name === 'file') ?? 0
    const filename = src.data.widgetsValues?.[fileIdx >= 0 ? fileIdx : 0]
    if (filename) return `/view?${new URLSearchParams({ filename: String(filename), type: 'input' })}`
  }
  return null
}

function collectTimelineLayers(node: any): any[] {
  const defs = node.data?.widgetDefs as any[]
  const wv = node.data?.widgetsValues as any[]
  if (!defs || !wv) return []
  const idx = (name: string) => defs.findIndex((d: any) => d.name === name)
  const out: any[] = []
  for (let i = 1; i <= 4; i++) {
    const url = getTimelineClipUrl(node, i)
    if (!url) continue
    out.push({
      slot: i, url,
      start:   Number(wv[idx(`clip${i}_start`)]    ?? 0),
      length:  Number(wv[idx(`clip${i}_length`)]   ?? 30),
      x:       Number(wv[idx(`clip${i}_x`)]        ?? 0),
      y:       Number(wv[idx(`clip${i}_y`)]        ?? 0),
      rot:     Number(wv[idx(`clip${i}_rotation`)] ?? 0),
      scl:     Number(wv[idx(`clip${i}_scale`)]    ?? 1),
      op:      Number(wv[idx(`clip${i}_opacity`)]  ?? 1),
      blend:   String(wv[idx(`clip${i}_blend`)]    ?? 'normal'),
      fadeIn:  Number(wv[idx(`clip${i}_fade_in`)]  ?? 0),
      fadeOut: Number(wv[idx(`clip${i}_fade_out`)] ?? 0),
    })
  }
  return out
}

function loadVideoForPreview(key: string, url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    let v = timelinePreviewVideos.get(key)
    const targetSrc = new URL(url, window.location.href).href
    if (v && v.src === targetSrc && v.readyState >= 2 && v.videoWidth > 0) {
      resolve(v); return
    }
    if (!v) {
      v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      v.crossOrigin = 'anonymous'
      timelinePreviewVideos.set(key, v)
    }
    const cleanup = () => {
      v!.removeEventListener('loadeddata', onLoaded)
      v!.removeEventListener('error', onError)
    }
    const onLoaded = () => { cleanup(); resolve(v!) }
    const onError = () => { cleanup(); reject(new Error('video load failed')) }
    v.addEventListener('loadeddata', onLoaded)
    v.addEventListener('error', onError)
    if (v.src !== targetSrc) {
      v.src = url
      v.load()
    }
    // If already loaded enough, fire the resolve directly on next tick.
    if (v.readyState >= 2 && v.videoWidth > 0) {
      cleanup()
      resolve(v)
    }
  })
}

function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const dur = v.duration
    if (!isFinite(dur) || dur <= 0) { resolve(); return }
    const target = Math.max(0, Math.min(dur, t))
    if (Math.abs(v.currentTime - target) < 0.05) { resolve(); return }
    let done = false
    const finish = () => { if (done) return; done = true; v.removeEventListener('seeked', finish); resolve() }
    v.addEventListener('seeked', finish)
    try { v.currentTime = target } catch { finish(); return }
    // Belt-and-suspenders: don't hang if seek doesn't fire.
    setTimeout(finish, 800)
  })
}

async function renderTimeline(node: any, layers: any[]): Promise<string | null> {
  const defs = node.data?.widgetDefs as any[]
  const wv = node.data?.widgetsValues as any[]
  const idx = (name: string) => defs.findIndex((d: any) => d.name === name)
  const explicit = Number(wv[idx('total_duration')] ?? 0)
  const total = explicit > 0
    ? explicit
    : layers.reduce((m, L) => Math.max(m, L.start + L.length), 1)
  const previewFrame = Math.floor(total / 2)
  const bgColor = String(wv[idx('bg_color')] ?? '#000000')

  // Load all clip videos in parallel, then seek to this layer's local time.
  const videos: HTMLVideoElement[] = await Promise.all(
    layers.map(L => loadVideoForPreview(`${node.id}-${L.slot}`, L.url)),
  )
  await Promise.all(layers.map((L, i) => {
    const v = videos[i]!
    const inWindow = previewFrame >= L.start && previewFrame < L.start + L.length
    if (!inWindow) return Promise.resolve()
    const localSec = (previewFrame - L.start) / TIMELINE_FPS
    const dur = v.duration
    if (!isFinite(dur) || dur <= 0) return Promise.resolve()
    const t = ((localSec % dur) + dur) % dur
    return seekVideo(v, t)
  }))

  // Canvas size from the first valid video, scaled down for thumbnail use.
  const ref = videos.find(v => v.videoWidth > 0)
  if (!ref) return null
  const maxDim = 384
  const aspect = ref.videoWidth / ref.videoHeight
  const w = aspect >= 1 ? maxDim : Math.round(maxDim * aspect)
  const h = aspect >= 1 ? Math.round(maxDim / aspect) : maxDim

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < layers.length; i++) {
    const L = layers[i]!
    const v = videos[i]!
    if (!v.videoWidth) continue
    if (previewFrame < L.start || previewFrame >= L.start + L.length) continue

    // Fade
    const localFrame = previewFrame - L.start
    let fadeAlpha = 1
    if (L.fadeIn > 0 && localFrame < L.fadeIn) fadeAlpha *= localFrame / L.fadeIn
    if (L.fadeOut > 0 && localFrame > L.length - L.fadeOut) {
      fadeAlpha *= (L.length - localFrame) / L.fadeOut
    }
    fadeAlpha = Math.max(0, Math.min(1, fadeAlpha))

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, L.op * fadeAlpha))
    ctx.globalCompositeOperation = BLEND_MAP[L.blend] || 'source-over'
    // Object-contain fit (matches backend `_fit_to_canvas`).
    const cAspect = w / h
    const vAspect = v.videoWidth / v.videoHeight
    let fitW: number, fitH: number
    if (vAspect > cAspect) { fitW = w; fitH = w / vAspect }
    else                   { fitH = h; fitW = h * vAspect }
    const cx = w / 2 + L.x * w
    const cy = h / 2 + L.y * h
    ctx.translate(cx, cy)
    ctx.rotate((L.rot * Math.PI) / 180)
    ctx.scale(L.scl, L.scl)
    try { ctx.drawImage(v, -fitW / 2, -fitH / 2, fitW, fitH) } catch {}
    ctx.restore()
  }

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob returned null'))
      resolve(URL.createObjectURL(blob))
    }, 'image/png')
  })
}

async function renderOneTimeline(node: any) {
  const layers = collectTimelineLayers(node)
  if (!layers.length) {
    const oldUrl = timelinePreviewUrls.get(node.id)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    timelinePreviewUrls.delete(node.id)
    if (node.data.images?.length) node.data = { ...node.data, images: [] }
    return
  }
  const token = (timelineRenderTokens.get(node.id) || 0) + 1
  timelineRenderTokens.set(node.id, token)
  try {
    const url = await renderTimeline(node, layers)
    if (url == null) return
    if (timelineRenderTokens.get(node.id) !== token) {
      URL.revokeObjectURL(url)
      return
    }
    const oldUrl = timelinePreviewUrls.get(node.id)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    timelinePreviewUrls.set(node.id, url)
    node.data = { ...node.data, images: [url] }
  } catch (err) {
    console.warn('[Timeline preview] render failed:', err)
  }
}

function timelineSnapshot(node: any) {
  const inputs = node.data.inputs as any[]
  const sources = inputs.map((port, i) => {
    if (port?.link == null) return null
    const edge = (edges.value as any[]).find((e: any) =>
      e.target === node.id && e.targetHandle === `input-${i}`)
    if (!edge) return null
    const src = (nodes.value as any[]).find((n: any) => n.id === edge.source)
    // Track file widget value (filename) since that's what changes when the user picks a new clip.
    if (src?.data?.nodeType === 'LoadVideoFrames' || src?.data?.nodeType === 'LoadVideo') {
      const fileIdx = src.data.widgetDefs?.findIndex((d: any) => d.name === 'file') ?? 0
      return src.data.widgetsValues?.[fileIdx >= 0 ? fileIdx : 0] ?? null
    }
    return src?.data?.images?.[0] ?? null
  })
  return { id: node.id, widgets: [...(node.data.widgetsValues as any[])], inputs: inputs.map(i => i.link), sources }
}

async function maybeRenderTimelines() {
  if (timelineRendering) { timelineDirty = true; return }
  timelineRendering = true
  timelineDirty = false
  try {
    const tls = (nodes.value as any[]).filter(n => n.data?.nodeType === 'Timeline')
    await Promise.all(tls.map(renderOneTimeline))
  } finally {
    timelineRendering = false
    if (timelineDirty) maybeRenderTimelines()
  }
}

// Note: the static Timeline preview renderer is left in place but disabled —
// the Timeline node body uses TimelineNodePreview.vue (an embedded animated
// canvas) instead. Helpers above remain available if a future use needs a
// single-frame snapshot.

// Track whether any node is currently running (for background animation)
const isRunning = computed(() => (nodes.value as any[]).some((n: any) => n.data?.running))

// Expose methods and state for parent layout
defineExpose({
  getWorkflow: getWorkflowWithSubgraphs,
  getNodes: () => nodes.value,
  getEdges: () => edges.value,
  getObjectInfo: () => objectInfo.value,
  zoomIn: () => vfZoomIn(),
  zoomOut: () => vfZoomOut(),
  fitView: () => fitView({ padding: 0.2 }),
})
</script>

<template>
  <div
    class="w-full h-full relative bg-[#0a0a0a]"
    @dragover.prevent
  >
    <!-- Dot grid behind everything -->
    <VueCanvasAnimatedDotGrid :running="isRunning" />

    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="{ comfy: markRaw(ComfyNode), note: markRaw(ComfyNoteNode), gate: markRaw(ComfyGateNode), 'subgraph-io': markRaw(SubgraphIONode) }"
      :edge-types="{ comfy: markRaw(ComfyEdge) }"
      :default-edge-options="{ type: 'comfy' }"
      :pan-on-drag="panOnDrag"
      :selection-key-code="selectionKeyCode"
      pan-on-scroll
      :zoom-on-pinch="true"
      :zoom-on-scroll="true"
      :prevent-scrolling="true"
      :snap-to-grid="true"
      :snap-grid="[16, 16]"
      :min-zoom="0.1"
      :max-zoom="4"
      :connection-line-style="{ stroke: '#818cf8', strokeWidth: 2 }"
      :delete-key-code="['Backspace', 'Delete']"
      class="vue-node-canvas"
      fit-view-on-init
      @drop="handleDrop"
      @dragover.prevent
      @node-double-click="handleNodeDoubleClick"
    >
      <MiniMap
        class="!bg-[#1a1a1a] !border-[#2a2a2a] comfy-minimap"
        :node-color="() => '#2a2a2a'"
        :mask-color="'rgba(0, 0, 0, 0.6)'"
      />
    </VueFlow>

    <!-- Subgraph breadcrumb navigation -->
    <div v-if="isInsideSubgraph" class="absolute top-3 left-3 z-40">
      <SubgraphBreadcrumb :breadcrumbs="breadcrumbs" @navigate="handleBreadcrumbNavigate" />
    </div>

    <!-- Compositor editor modal -->
    <Teleport to="body">
      <VueCanvasCompositorModal
        v-if="compositorOpenForId"
        :node-id="compositorOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="compositorOpenForId = null"
      />
    </Teleport>

    <!-- ASCII options right drawer -->
    <Teleport to="body">
      <VueCanvasAsciiPanel
        v-if="asciiOpenForId"
        :node-id="asciiOpenForId"
        :nodes="nodes as any[]"
        @close="asciiOpenForId = null"
      />
    </Teleport>

    <!-- Timeline editor modal -->
    <Teleport to="body">
      <VueCanvasTimelineModal
        v-if="timelineOpenForId"
        :node-id="timelineOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="timelineOpenForId = null"
      />
    </Teleport>

    <!-- Crossfade editor modal -->
    <Teleport to="body">
      <VueCanvasCrossfadeModal
        v-if="crossfadeOpenForId"
        :node-id="crossfadeOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="crossfadeOpenForId = null"
      />
    </Teleport>

    <!-- SmartLayout visual editor modal -->
    <Teleport to="body">
      <VueCanvasSmartLayoutEditorModal
        v-if="smartLayoutOpenForId"
        :node-id="smartLayoutOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="smartLayoutOpenForId = null"
      />
    </Teleport>
  </div>
</template>

<style>
/* Override Vue Flow defaults to match ComfyNext dark theme */
.vue-node-canvas .vue-flow__node {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}

.vue-node-canvas .vue-flow__node.selected .comfy-node {
  outline: 2px solid #818cf8;
  outline-offset: 1px;
}

.vue-node-canvas .vue-flow__edge.selected path {
  filter: drop-shadow(0 0 4px currentColor);
}

.vue-node-canvas .vue-flow__handle {
  background: transparent;
  border: none;
}

.vue-node-canvas {
  background-color: transparent;
}

/* Connection line while dragging */
.vue-node-canvas .vue-flow__connection-line path {
  stroke: #818cf8;
  stroke-width: 2;
  stroke-dasharray: 5;
}

/* MiniMap positioning: sit above the zoom toolbar, right-aligned */
.vue-node-canvas .comfy-minimap.vue-flow__panel {
  bottom: 52px !important;
  right: 0 !important;
  margin-right: 12px !important;
  margin-bottom: 0 !important;
  border-radius: 12px !important;
  overflow: hidden;
}

</style>
