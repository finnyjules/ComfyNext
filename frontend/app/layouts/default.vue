<script setup lang="ts">
import {
  House, X, Plus, Play, Check, Minus, ExternalLink, AlertCircle,
  MousePointer2, Hand, LayoutGrid, GitFork, Image, Workflow, AppWindow, LayoutTemplate, Sparkles, Toolbox, WandSparkles, Boxes,
  ZoomIn, ZoomOut, Maximize2, Map, Globe, Square, PanelRight, Wand, Library,
  AudioWaveform, Film, Box, Type, Frame, Clapperboard,
  StickyNote, ListChecks, ArrowRight, MessageSquareDashed, Drama,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { healDanglingLinks } from '~/composables/useFilteredPrompt'
import { brandKitToKv } from '~~/shared/brand/resolve'
import { Sonner } from '~/components/ui/sonner'
import AssetsHistory from '~/components/AssetsHistory.vue'
import CommunityHome from '~/components/community/CommunityHome.vue'
import LoraTrainerSurface from '~/components/LoraTrainerSurface.vue'
import AllProjectsView from '~/components/AllProjectsView.vue'
import StartProjectModal from '~/components/StartProjectModal.vue'
import CanvasStatusBar, { type RunResult } from '~/components/CanvasStatusBar.vue'
import { ARTIFACT_NODE_FOR_INPUT, type Capability } from '~/data/node-capabilities'
import { estimateUsdForNodes, vueNodesToEstimateInput, type CostEstimate } from '~/lib/costEstimate'
import { summarizeNodeErrors } from '~/lib/validationErrors'
import { extractOutputFiles, type GenOutput, type GenerationRecord } from '~/lib/generations'
import {
  BLANK_WORKFLOW, activeCanvasOf, docHasContent, isProjectDoc,
  makeBlankWorkflow, makeCanvasId, nextCanvasName, toProjectDoc,
  type ProjectCanvas, type ProjectDoc,
} from '~/lib/projectDoc'

const { tabs, activeTabId, activeTab, setActiveTab, closeTab, openTab, updateTabStatus, renameTab, runningCount } = useTabs()
const { vueNodesEnabled } = useVueNodesEnabled()

// Inline tab rename
const editingTabId = ref<string | null>(null)
const editingLabel = ref('')

function startRenaming(tabId: string, currentLabel: string) {
  editingTabId.value = tabId
  editingLabel.value = currentLabel
  nextTick(() => {
    const input = document.querySelector('[data-tab-rename-input]') as HTMLInputElement
    input?.focus()
    input?.select()
  })
}

function finishRenaming() {
  if (editingTabId.value && editingLabel.value.trim()) {
    renameTab(editingTabId.value, editingLabel.value)
    // Also persist the name for the home page recent projects
    const tab = tabs.value.find((t) => t.id === editingTabId.value)
    if (tab?.workflowId) {
      const { setProjectName } = useRecentProjects()
      setProjectName(tab.workflowId, editingLabel.value)
    }
  }
  editingTabId.value = null
}

function cancelRenaming() {
  editingTabId.value = null
}
const { explainActive, activateExplain, deactivateExplain, highlightedNodeId } = useExplain()
const { openNodeSearch } = useNodeSearch()

// Send highlight/clear to iframe when hovered node changes
watch(highlightedNodeId, (nodeId, oldNodeId) => {
  if (nodeId != null) {
    sendToActiveProjectIframe('highlightNode', { nodeId })
  }
  else if (oldNodeId != null) {
    sendToActiveProjectIframe('clearHighlight')
  }
})

// Ordered roughly along a typical session:
//   tools → sources → make/edit → power-user → help.
// `dividerBefore` draws a vertical separator before the item, marking
// the boundary between groups.
const sidebarItems = [
  // Tools
  { label: 'Select', icon: MousePointer2, tool: 'select' },
  { label: 'Hand', icon: Hand, tool: 'hand' },
  // Sources
  { label: 'Add', icon: Plus, submenu: 'load', dividerBefore: true },
  { label: 'Assets', icon: LayoutGrid, panel: 'assets' },
  // Make + edit
  { label: 'Generators', icon: WandSparkles, panel: 'generators', dividerBefore: true },
  { label: 'Styles', icon: Library, panel: 'loras' },
  { label: 'Characters', icon: Drama, panel: 'characters' },
  { label: 'Toolbox', icon: Toolbox, panel: 'toolbox' },
  { label: 'Annotate', icon: MessageSquareDashed, submenu: 'annotate' },
  // Power-user
  { label: 'Nodes', icon: GitFork, tabId: 'node-library', dividerBefore: true },
  { label: 'Blocks', icon: Boxes, panel: 'blocks' },
  // Hidden for now. Re-add to restore.
  // { label: 'Apps', icon: AppWindow, tabId: 'apps' },
  // { label: 'Templates', icon: LayoutTemplate },
  // Help
  { label: 'Explain', icon: Sparkles, tool: 'explain', dividerBefore: true },
]

// Submenu shown when "Load…" is active. Each option drops the matching
// unified artifact node onto the canvas via the standard addNode event.
// 3D is here as a placeholder — the Mesh artifact node isn't shipped yet,
// so its option stays disabled until that lands.
const loadOptions = [
  // Composition surfaces — spatial (Frame) + temporal (Timeline) — grouped up top.
  { label: 'Frame',    icon: Frame,        nodeType: 'Compositor' },
  { label: 'Slate',    icon: Clapperboard, special: 'slate-gallery' },
  { label: 'Timeline', icon: Clapperboard, nodeType: 'Timeline', dividerAfter: true },
  { label: 'Image', icon: Image,          nodeType: 'Image' },
  { label: 'Text',  icon: Type,           nodeType: 'Text' },
  { label: 'Audio', icon: AudioWaveform,  nodeType: 'Audio' },
  { label: 'Video', icon: Film,           nodeType: 'Video' },
  { label: '3D',    icon: Box,            nodeType: 'Mesh', disabled: true, hint: 'coming soon' },
]
const loadMenuOpen = ref(false)

function addLoadNode(nodeType: string) {
  window.dispatchEvent(new CustomEvent('comfynext:addNode', { detail: { nodeType } }))
  loadMenuOpen.value = false
}

// Load submenu click: most items drop their artifact node, but "Slate" is a
// special entry that opens the slate gallery instead of dispatching addNode.
const slateGalleryOpen = ref(false)
function onLoadOption(opt: { nodeType?: string; special?: string }) {
  loadMenuOpen.value = false
  if (opt.special === 'slate-gallery') { slateGalleryOpen.value = true; return }
  if (opt.nodeType) addLoadNode(opt.nodeType)
}

// Gallery → canvas: a placed slate is a Compositor (Frame) node whose
// properties carry the instantiated local layers + motion doc. VueNodeCanvas's
// handleAddNode already applies `propertyOverrides`, so we just dispatch.
function onCreateSlate(payload: { layers: unknown[]; motion: unknown }) {
  slateGalleryOpen.value = false
  window.dispatchEvent(new CustomEvent('comfynext:addNode', {
    detail: {
      nodeType: 'Compositor',
      propertyOverrides: {
        comfynext_localLayers: payload.layers,
        comfynext_motion: payload.motion,
      },
    },
  }))
}

// Annotate submenu — FigJam-style overlays on the canvas. Each option fires
// `comfynext:addAnnotation`; VueNodeCanvas owns the spawn position and
// per-kind logic (file picker for image, two-click flow for arrow).
const annotateOptions = [
  { label: 'Sticky note', icon: StickyNote, kind: 'sticky',    hint: 'S' },
  { label: 'Checklist',   icon: ListChecks, kind: 'checklist', hint: 'C' },
  { label: 'Image pin',   icon: Image,      kind: 'image' },
  { label: 'Arrow',       icon: ArrowRight, kind: 'arrow',     hint: 'A' },
]
const annotateMenuOpen = ref(false)

function addAnnotation(kind: string) {
  window.dispatchEvent(new CustomEvent('comfynext:addAnnotation', { detail: { kind } }))
  annotateMenuOpen.value = false
}

// "Get Started" modal: pops up once per fresh blank project. We track the
// target tab id so the modal is bound to a single tab — switch away and it
// disappears, switch back and it stays gone (once dismissed). Tabs that
// open with a workflowId (recent project, community workflow) skip the
// modal entirely.
const startModalTabId = ref<string | null>(null)
const seenStartModalTabIds = new Set<string>()

watch(() => activeTabId.value, (id) => {
  if (!id) { startModalTabId.value = null; return }
  const tab = tabs.value.find((t) => t.id === id) as any
  // A tab that already has a workflow on the canvas (saved nodes) is NOT blank,
  // even if it was opened without a workflowId (e.g. "Use in new workflow",
  // a generation in progress). Tying the modal to real content — not just the
  // volatile seen-Set — stops it re-appearing over an existing generation.
  const hasSavedContent = docHasContent(savedWorkflows[id])
  const isFreshBlankProject = tab?.type === 'project' && !tab?.workflowId
    && !seenStartModalTabIds.has(id) && !hasSavedContent
  if (isFreshBlankProject) {
    seenStartModalTabIds.add(id)
    if (tab.seedNodeType) {
      // Opened from a homepage medium card — skip the picker and drop the
      // chosen starter generator straight onto the new canvas.
      startModalTabId.value = null
      seedStarterGraph(tab.seedNodeType)
    } else {
      startModalTabId.value = id
    }
  } else {
    // Tab switch → hide the modal (without re-triggering on switch-back).
    startModalTabId.value = null
  }
})

// Drop a starter generator onto a freshly-opened project. The canvas mounts a
// tick or two after the tab activates, so retry until materializeStartGraph is
// available, then ensure the schema is loaded (it reads object_info) before
// seeding — mirrors the Run path's refreshSchema safety.
async function seedStarterGraph(nodeType: string, tries = 0) {
  const canvas = vueCanvasRef.value
  if (canvas?.materializeStartGraph) {
    await canvas.refreshSchema?.()
    canvas.materializeStartGraph({ generatorNodeType: nodeType })
  } else if (tries < 40) {
    setTimeout(() => seedStarterGraph(nodeType, tries + 1), 50)
  }
}

function onStartModalPick(payload: { capability: Capability }) {
  const cap = payload.capability
  const sourceNodeType = cap.from === 'prompt'
    ? undefined
    : ARTIFACT_NODE_FOR_INPUT[cap.from]
  startModalTabId.value = null
  // Defer one tick so the modal unmounts before we touch the canvas — keeps
  // any focus/scroll state clean and ensures the canvas is fully mounted.
  nextTick(() => {
    vueCanvasRef.value?.materializeStartGraph?.({
      sourceNodeType,
      generatorNodeType: cap.nodeType,
    })
  })
}
function onStartModalSkip() {
  startModalTabId.value = null
}

const activeTool = ref<string>('select')

const activeSidebarItem = ref<string | null>(null)
const vueSidebarOpen = ref(false) // tracks whether ComfyUI left sidebar panel is visible in Vue mode
const vueNodesSidebarOpen = ref(false) // tracks whether the native Nodes sidebar is open in Vue mode
const vueRightPanelOpen = ref(false) // tracks whether Vue right panel (Workflow Overview) is visible
const toolboxPanelOpen = ref(false) // tracks whether the Toolbox right panel is visible
const generatorsPanelOpen = ref(false) // tracks whether the Generators panel is visible
const loraLibraryPanelOpen = ref(false) // tracks whether the LoRA Library panel is visible
const charactersPanelOpen = ref(false) // tracks whether the Character Library panel is visible
const blockLibraryPanelOpen = ref(false) // tracks whether the Block Library panel is visible
const assetsPanelOpen = ref(false) // tracks whether the Assets panel is visible

// Whether a sidebar item is currently the "active" one (highlighted).
// Single source of truth for the chevron/button highlight logic — used by
// the template instead of nested ternaries that got unreadable as we added
// more panel types.
function isSidebarItemActive(item: any): boolean {
  if (item?.tool) return activeTool.value === item.tool
  if (item?.panel === 'toolbox') return toolboxPanelOpen.value
  if (item?.panel === 'generators') return generatorsPanelOpen.value
  if (item?.panel === 'loras') return loraLibraryPanelOpen.value
  if (item?.panel === 'characters') return charactersPanelOpen.value
  if (item?.panel === 'blocks') return blockLibraryPanelOpen.value
  if (item?.panel === 'assets') return assetsPanelOpen.value
  if (item?.submenu === 'load') return loadMenuOpen.value
  if (item?.submenu === 'annotate') return annotateMenuOpen.value
  return activeSidebarItem.value === item?.label
}

function toggleSidebarItem(label: string) {
  const item = sidebarItems.find((i) => i.label === label)
  if (item?.action === 'openAssets') {
    openTab({ type: 'assets', label: 'Assets' })
    return
  }
  if (item?.submenu === 'load') {
    // Close other open panels so the popup isn't competing with them.
    toolboxPanelOpen.value = false
    generatorsPanelOpen.value = false
    loraLibraryPanelOpen.value = false
    charactersPanelOpen.value = false
    blockLibraryPanelOpen.value = false
    annotateMenuOpen.value = false
    loadMenuOpen.value = !loadMenuOpen.value
    return
  }
  if (item?.submenu === 'annotate') {
    toolboxPanelOpen.value = false
    generatorsPanelOpen.value = false
    loraLibraryPanelOpen.value = false
    charactersPanelOpen.value = false
    blockLibraryPanelOpen.value = false
    loadMenuOpen.value = false
    annotateMenuOpen.value = !annotateMenuOpen.value
    return
  }
  // Any other sidebar item closes both popups.
  loadMenuOpen.value = false
  annotateMenuOpen.value = false
  if (item?.tool) {
    // Deactivate explain if switching away
    if (activeTool.value === 'explain' && item.tool !== 'explain') {
      deactivateExplain()
    }
    activeTool.value = item.tool
    if (item.tool === 'explain') {
      activateExplain()
    }
    else if (!vueNodesEnabled.value) {
      sendToActiveProjectIframe('setCanvasTool', { tool: item.tool })
    }
    // In Vue mode, Select/Hand work natively via Vue Flow
  }
  else if (item?.panel === 'toolbox' || item?.panel === 'generators' || item?.panel === 'loras' || item?.panel === 'characters' || item?.panel === 'blocks' || item?.panel === 'assets') {
    // Left canvas panels are mutually exclusive — opening one closes the rest.
    const refs = {
      toolbox: toolboxPanelOpen,
      generators: generatorsPanelOpen,
      loras: loraLibraryPanelOpen,
      characters: charactersPanelOpen,
      blocks: blockLibraryPanelOpen,
      assets: assetsPanelOpen,
    }
    const target = refs[item.panel as keyof typeof refs]
    const wasOpen = target.value
    for (const r of Object.values(refs)) r.value = false
    target.value = !wasOpen
  }
  else if (item?.tabId) {
    const wasActive = activeSidebarItem.value === label
    activeSidebarItem.value = wasActive ? null : label

    if (vueNodesEnabled.value) {
      // Vue mode: use native panels where available, iframe for the rest
      if (item.tabId === 'node-library') {
        vueNodesSidebarOpen.value = !wasActive
        vueSidebarOpen.value = false
      } else {
        vueNodesSidebarOpen.value = false
        sendToActiveProjectIframe('toggleSidebarTab', { tabId: item.tabId })
        vueSidebarOpen.value = !wasActive
      }
    } else {
      sendToActiveProjectIframe('toggleSidebarTab', { tabId: item.tabId })
    }
  }
}

const minimapActive = ref(false)

function zoomIn() {
  if (vueNodesEnabled.value) { vueCanvasRef.value?.zoomIn?.() }
  else { sendToActiveProjectIframe('canvasZoom', { direction: 'in' }) }
}
function zoomOut() {
  if (vueNodesEnabled.value) { vueCanvasRef.value?.zoomOut?.() }
  else { sendToActiveProjectIframe('canvasZoom', { direction: 'out' }) }
}
function zoomReset() {
  if (vueNodesEnabled.value) { vueCanvasRef.value?.fitView?.() }
  else { sendToActiveProjectIframe('canvasZoom', { direction: 'reset' }) }
}
function toggleMinimap() {
  minimapActive.value = !minimapActive.value
  if (!vueNodesEnabled.value) sendToActiveProjectIframe('toggleMinimap')
}

function sendToActiveProjectIframe(action: string, payload?: any) {
  const iframe = getSharedIframe()
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'comfynext', action, ...payload }, '*')
  }
}

// Run workflow from Vue canvas — loads into bridge iframe, then queues via bridge.
// When `targetIds` is provided, runs only that subset (plus upstream deps).
// Forgiving filtering happens via buildFilteredWorkflow which mutes everything
// outside the keep set; LiteGraph already honors mode=2 at queue time.
// FluxLoRARemoteNode keeps its style/aesthetic in a node PROPERTY
// (`properties.aesthetic`) rather than a ComfyUI input — that keeps the node
// schema stable (a new input would de-sync the embedded canvas and scramble
// widget positions). Here, at submit time, we fold it into the prompt widget
// (index 0) on the outgoing workflow copy only.
function injectLoraStyleIntoPrompt(workflow: any) {
  for (const node of workflow?.nodes || []) {
    if (node?.type !== 'FluxLoRARemoteNode' && node?.type !== 'FluxMultiLoRARemoteNode') continue
    // Both keep `prompt` at widget index 0, so the same fold applies.
    // `tasteProfile` fallback keeps workflows saved before the rename working.
    const style = String(node.properties?.aesthetic || node.properties?.tasteProfile || '').trim()
    if (!style) continue
    const wv = node.widgets_values
    if (!Array.isArray(wv)) continue
    const prompt = String(wv[0] ?? '')
    wv[0] = prompt ? `${style} ${prompt}` : style
  }
}

async function runVueWorkflow(
  targetIds?: string[],
  opts: { rerollScope?: 'self', live?: boolean, skipCostConfirm?: boolean, costConfirmIterations?: number } = {},
): Promise<boolean> {
  if (!vueCanvasRef.value?.getWorkflow) {
    console.warn('[Run] no getWorkflow on vueCanvasRef')
    toast.error('Canvas not ready', { description: 'Give it a moment and try again.' })
    return false
  }

  // Ensure the cached /object_info schema is current (the mount-time fetch can
  // predate the backend registering Compositor z/mask inputs) and heal any
  // Compositor whose saved widget array drifted, before we build the workflow.
  try {
    await vueCanvasRef.value.refreshSchema?.()
  } catch (err) {
    console.error('[Run] schema refresh failed', err)
  }

  // Auto-materialize Image sinks for any node with a dangling IMAGE output.
  // For full-graph Run (no targetIds), every active node is a candidate; the
  // canvas's own guards (skip Image self, skip already-wired outputs) keep
  // this from being too aggressive. handleRunFiltered does the same dance for
  // targeted Runs before calling this function — the global Run button skips
  // that wrapper and calls us directly, so we have to handle it here too.
  if (!targetIds?.length) {
    const all = vueCanvasRef.value.getNodes?.() || []
    const activeIds = all
      .filter((n: any) => (n.data?.mode ?? 0) !== 2)
      .map((n: any) => n.id)
    vueCanvasRef.value.materializeAutoImageSinks?.(activeIds)
  }

  const workflow = targetIds?.length && vueCanvasRef.value.getFilteredWorkflow
    ? vueCanvasRef.value.getFilteredWorkflow(targetIds, opts)
    : vueCanvasRef.value.getWorkflow(opts.live ? { reroll: false } : undefined)
  if (!workflow?.nodes?.length) {
    console.warn('[Run] workflow has no nodes')
    toast.error('Nothing to run', { description: 'No runnable nodes were found for this action.' })
    return false
  }

  // Deep-copy to strip Vue reactivity proxies (postMessage can't clone Proxy objects)
  const plainWorkflow = JSON.parse(JSON.stringify(workflow))

  // Stamp the tab's stable project UUID so history entries can be grouped
  if (activeTab.value.projectUuid) {
    plainWorkflow.extra = { ...(plainWorkflow.extra || {}), projectUuid: activeTab.value.projectUuid }
  }

  // Cost guard: estimate the exact set of nodes about to run and confirm
  // expensive runs before any side-effecting prep (compositor uploads) or
  // queueing. Live-preview runs never prompt.
  if (!opts.skipCostConfirm && !opts.live) {
    const vnodes = vueCanvasRef.value.getNodes?.() || []
    const estInput = (plainWorkflow.nodes as any[])
      .filter((n: any) => (n.mode ?? 0) !== 2)
      .map((wn: any) => {
        const vn = vnodes.find((v: any) => String(v.id) === String(wn.id))
        return {
          id: String(wn.id),
          type: String(wn.type || vn?.data?.nodeType || ''),
          title: vn?.data?.title,
          badgeExpr: vn?.data?.priceBadge?.expr ?? null,
        }
      })
    const single = estimateUsdForNodes(estInput)
    if (single) {
      const iterations = Math.max(1, opts.costConfirmIterations || 1)
      const est: CostEstimate = { ...single, usd: single.usd * iterations }
      if (est.usd >= costConfirmThresholdUsd() && !(await confirmRunCost(est, iterations))) {
        return false
      }
    }
  }

  // Prepend each FluxLoRARemoteNode's "Style" field (a node property, NOT a
  // ComfyUI input — keeps the schema stable) into its prompt widget at submit
  // time. The live node's prompt stays clean (we only mutate this copy).
  injectLoraStyleIntoPrompt(plainWorkflow)

  // Bake any Compositor text/shape overlays into uploaded image layers and
  // wire them into the workflow (mutates plainWorkflow in place).
  try {
    await vueCanvasRef.value.injectCompositorOverlays?.(plainWorkflow)
  } catch (err) {
    console.error('[Run] compositor overlay injection failed', err)
    toast.error('Frame compositing failed', { description: String((err as any)?.message || err).slice(0, 120) })
  }

  // Auto-wire any "protect in blend" layers into a downstream Blend Scene.
  try {
    vueCanvasRef.value.injectProtectMaskWiring?.(plainWorkflow)
  } catch (err) {
    console.error('[Run] protect-mask wiring failed', err)
  }

  // Push each Timeline node's editor state (keyframes, multi-track clips) into
  // its edit_state widget so node-run renders what the editor shows. Async:
  // it may force a fresh /object_info fetch to self-heal a stale schema cache,
  // and throws (→ toast with the remedy) if the widget is still missing.
  try {
    await vueCanvasRef.value.injectTimelineEditState?.(plainWorkflow)
  } catch (err) {
    console.error('[Run] timeline edit_state injection failed', err)
    toast.error('Timeline state failed', { description: String((err as any)?.message || err).slice(0, 160) })
  }

  // Push each Compositor node's baked motion (Kinetic Slates PNG sequence)
  // into its motion_params widget so the backend returns the baked animation
  // as its image batch + video output instead of the static composite.
  try {
    await vueCanvasRef.value.injectCompositorMotionParams?.(plainWorkflow)
  } catch (err) {
    console.error('[Run] compositor motion_params injection failed', err)
    toast.error('Frame motion state failed', { description: String((err as any)?.message || err).slice(0, 160) })
  }

  // Fold the project's active brand kit under every SmartLayout node's wired
  // brand, so Run output matches the kit-themed editor preview. No active
  // kit ⇒ no-op (widgets untouched, byte-identical submit).
  try {
    const kit = brandLib.activeKit.value
    await vueCanvasRef.value.injectSmartLayoutBrand?.(plainWorkflow, kit ? brandKitToKv(kit) : '')
  } catch (err) {
    console.error('[Run] smart layout brand_kit injection failed', err)
    toast.error('Brand kit injection failed', { description: String((err as any)?.message || err).slice(0, 160) })
  }

  // Pick the worker for the tab being run (always 0 when the pool is off), so
  // separate canvases queue to separate ComfyUI servers and run concurrently.
  const runTabId = activeTab.value?.id || ''
  const workerIdx = workerForTab(runTabId)
  if (poolEnabled.value && runTabId) workerRunningTab[workerIdx] = runTabId
  // Runs are always queued from the displayed canvas of the run tab.
  const runDoc = savedWorkflows[runTabId]
  runningCanvasByWorker[workerIdx] = isProjectDoc(runDoc) ? runDoc.activeCanvasId : null

  // Load workflow into that worker's LiteGraph, then queue
  const iframe = getWorkerIframe(workerIdx)
  if (!iframe?.contentWindow) {
    console.error('[Run] bridge iframe not found or not ready')
    toast.error('ComfyUI not ready', { description: 'Lost the canvas connection — try reloading the page.' })
    return false
  }
  const activeCount = (plainWorkflow.nodes as any[]).filter((n: any) => (n.mode ?? 0) !== 2).length
  console.log('[Run] sending workflow with', plainWorkflow.nodes.length, 'nodes to worker', workerIdx,
    targetIds?.length ? `(filtered: ${activeCount} active, ${targetIds.length} targets)` : '')
  await sendLoadWorkflow(plainWorkflow, workerIdx)
  await new Promise(r => setTimeout(r, 800))
  console.log('[Run] sending queuePrompt to worker', workerIdx)
  iframe.contentWindow?.postMessage({ type: 'comfynext', action: 'queuePrompt' }, '*')
  // Explicit (non-live) runs get a no-response watchdog. Live-preview runs fire
  // continuously and silently by design, so they're exempt from the toast.
  if (!opts.live) armQueueWatchdog(runTabId)

  // Bring focus back to the Vue Flow canvas. Without this, the hidden bridge
  // iframe sometimes retains focus after the postMessage handshake, and on
  // macOS the OS routes subsequent pinch-zoom gestures to whatever frame
  // holds focus — meaning the Vue canvas silently loses pinch-zoom until
  // a full reload. The canvas root carries tabindex="-1" specifically so
  // we can pull focus here without the iframe holding on. Skip if the user
  // is actively typing — that intent overrides ours.
  requestAnimationFrame(() => {
    const ae = document.activeElement
    if (ae instanceof Element && ae.matches('input, textarea, [contenteditable]')) return
    const root = document.querySelector('.vue-node-canvas-root') as HTMLElement | null
    root?.focus({ preventScroll: true })
  })
  return true
}

// Filtered-run events from the canvas context menu (Run Group, Run Selection).
// Also fired by per-node Run buttons on individual nodes. Before queueing,
// we ask the canvas to materialize an `Image` artifact card for every
// dangling IMAGE output among the targets — that's where the execution
// result lands. No-op for targets whose outputs are already wired.
async function handleRunFiltered(e: Event) {
  const detail = (e as CustomEvent).detail
  const targetIds = detail?.targetIds as string[] | undefined
  if (!targetIds?.length) return
  const rerollScope = detail?.rerollScope as 'self' | undefined
  const expanded = vueCanvasRef.value?.materializeAutoImageSinks?.(targetIds) ?? targetIds
  if (await maybeRunWithTextAutofill(expanded, { rerollScope })) return
  runVueWorkflow(expanded, { rerollScope })
}
async function handleRunAll() {
  // Auto-sink materialization lives inside runVueWorkflow now (so the
  // top-right Run button, which calls it directly, also benefits).
  if (await maybeRunWithTextAutofill(undefined)) return
  runVueWorkflow()
}

// Awaits the next `execution_complete` event from the bridge. Resolves on
// the first one that arrives — callers must invoke this *before* queueing
// the prompt they care about, or they'll latch onto a stale completion.
function awaitExecutionComplete(timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error('execution_complete timeout'))
    }, timeoutMs)
    function handler(event: MessageEvent) {
      if (event.data?.type !== 'comfynext-bridge') return
      if (event.data.event !== 'execution_complete' && event.data.event !== 'execution_error') return
      clearTimeout(timer)
      window.removeEventListener('message', handler)
      resolve()
    }
    window.addEventListener('message', handler)
  })
}

// Auto-fill on Run: if the workflow contains a Text artifact node whose
// `source` input is wired AND has empty entry slots, run the workflow once
// per empty slot — each iteration clears the text widget so the upstream
// value flows through, then we capture the executed text into entries[i].
// Returns true if it handled the run (caller should skip its normal path).
let textAutofillRunning = false
async function maybeRunWithTextAutofill(targetIds?: string[], opts: { rerollScope?: 'self' } = {}): Promise<boolean> {
  if (textAutofillRunning) return false
  const canvas = vueCanvasRef.value
  if (!canvas?.getNodes || !canvas?.getEdges) return false

  const all = canvas.getNodes() as any[]
  const edges = canvas.getEdges() as any[]

  // Candidate: Text node with `source` connected + ≥1 empty slot. If the
  // user explicitly filtered the run (Run from Selection etc.), restrict
  // candidates to the kept set so we don't surprise them with side-effects
  // on unrelated parts of the graph.
  const allowed = targetIds && targetIds.length ? new Set(targetIds) : null
  const candidates = all.filter((n: any) => {
    if (n.data?.nodeType !== 'Text') return false
    if (allowed && !allowed.has(n.id)) return false
    const inputs: any[] = n.data?.inputs || []
    const srcIdx = inputs.findIndex(i => i.name === 'source')
    if (srcIdx < 0) return false
    const wired = inputs[srcIdx]?.link != null
      || edges.some(e => e.target === n.id && e.targetHandle === `input-${srcIdx}`)
    if (!wired) return false
    const entries: string[] = n.data?.properties?.textEntries
      || [n.data?.widgetsValues?.[0] ?? '']
    return entries.some(s => !(s ?? '').trim())
  })
  if (candidates.length === 0) return false

  // Multiple candidates: pick the one with the most empty slots. Predictable
  // and matches user intent ("the node I just added a bunch of empty rows to").
  const target = candidates.reduce((best: any, n: any) => {
    const empties = (n.data?.properties?.textEntries || []).filter((s: string) => !(s ?? '').trim()).length || 1
    const bestEmpties = best ? ((best.data?.properties?.textEntries || []).filter((s: string) => !(s ?? '').trim()).length || 1) : 0
    return empties > bestEmpties ? n : best
  }, null as any)

  const widgetDefs: any[] = target.data?.widgetDefs || []
  const textIdx = widgetDefs.findIndex((w: any) => w?.name === 'text')
  if (textIdx < 0) return false
  if (!Array.isArray(target.data.widgetsValues)) target.data.widgetsValues = []
  if (!target.data.properties) target.data.properties = {}
  if (!Array.isArray(target.data.properties.textEntries)) {
    // Seed entries from the legacy widget value so we always have an array
    // to write into. Single-slot nodes still get auto-fill — the LLM result
    // lands in entries[0], persisting what previously was an ephemeral
    // data.text echo.
    target.data.properties.textEntries = [target.data.widgetsValues[textIdx] ?? '']
  }
  const entries: string[] = target.data.properties.textEntries
  const emptySlots: number[] = []
  for (let i = 0; i < entries.length; i++) {
    if (!(entries[i] ?? '').trim()) emptySlots.push(i)
  }
  if (emptySlots.length === 0) return false

  textAutofillRunning = true
  const origWidget = target.data.widgetsValues[textIdx]
  // Clear the widget so the backend's `text if text else source` falls
  // through to the upstream value for every iteration.
  target.data.widgetsValues[textIdx] = ''

  try {
    for (let iter = 0; iter < emptySlots.length; iter++) {
      const slotIdx = emptySlots[iter]!
      // Reset the prior result so we can detect the new one — without this
      // a failed iteration would silently inherit the previous text.
      delete target.data.text
      const completed = awaitExecutionComplete()
      const queued = await runVueWorkflow(targetIds, {
        ...opts,
        ...(iter === 0
          ? { costConfirmIterations: emptySlots.length }
          : { skipCostConfirm: true }),
      })
      if (queued === false) {
        completed.catch(() => {}) // listener self-cleans on its own timeout
        break
      }
      try {
        await completed
      } catch (err) {
        console.warn('[Text autofill] await execution_complete failed:', err)
        break
      }
      // Tiny grace period: the bridge's `executed` event for the Text node
      // and the `execution_complete` are not guaranteed to arrive in order,
      // so give the data.text writer a moment to land.
      await new Promise(r => setTimeout(r, 80))
      const result = target.data.text
      if (typeof result !== 'string' || result.length === 0) {
        await new Promise(r => setTimeout(r, 150))
        continue
      }
      // Multi-line shortcut: if the upstream returned a list of items
      // (Brainstorm-style: one per line) AND we still have multiple empty
      // slots to fill, distribute the lines across them in one shot
      // instead of looping. Saves N-1 LLM calls and is what the user
      // almost certainly intended when wiring a list-returning node into
      // an N-slot Text node.
      const lines = result.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      const remaining = emptySlots.slice(iter)
      if (lines.length >= 2 && remaining.length >= 2) {
        for (let k = 0; k < remaining.length && k < lines.length; k++) {
          entries[remaining[k]!] = lines[k]!
        }
        break
      }
      // Single-value result — assign and continue iterating.
      // Mutate via array index so Vue's reactivity picks it up.
      entries[slotIdx] = result
      // Pause briefly so the bridge / queue settles between submissions.
      await new Promise(r => setTimeout(r, 150))
    }
  } finally {
    target.data.widgetsValues[textIdx] = origWidget
    delete target.data.text
    textAutofillRunning = false
  }
  return true
}

// Text-iterator run: a Text artifact node holds N entries; we want to run
// the workflow once per entry, swapping the node's widget value before each
// queue submission. We can't just dispatch N runFiltered events back-to-back
// because runVueWorkflow reads the live canvas state every time — so we
// mutate the canvas node's widget value, await the run, then move on.
let textIteratorRunning = false
async function handleRunTextIterator(e: Event) {
  if (textIteratorRunning) {
    console.warn('[Iterator] already running, ignoring re-entry')
    return
  }
  const detail = (e as CustomEvent).detail as { nodeId?: string; entries?: string[] } | undefined
  const nodeId = detail?.nodeId
  const entries = (detail?.entries || []).filter(s => typeof s === 'string')
  if (!nodeId || entries.length === 0) return
  const canvas = vueCanvasRef.value
  if (!canvas?.getNodes) return

  const all = canvas.getNodes() as any[]
  const node = all.find(n => n.id === nodeId)
  if (!node) {
    console.warn('[Iterator] node not found:', nodeId)
    return
  }

  // Resolve the position of the `text` widget in this node's widget defs.
  // We mutate widgetsValues[idx] before each run so the workflow snapshot
  // picks up the iteration's entry value.
  const widgetDefs: any[] = node.data?.widgetDefs || []
  const textIdx = widgetDefs.findIndex((w: any) => w?.name === 'text')
  if (textIdx < 0) {
    console.warn('[Iterator] no `text` widget on node', nodeId)
    return
  }
  if (!Array.isArray(node.data.widgetsValues)) node.data.widgetsValues = []

  textIteratorRunning = true
  // Stash original so we can restore on completion — otherwise the last
  // entry would stick as the "active" widget value, which is surprising
  // when the user goes back to single-shot Run.
  const original = node.data.widgetsValues[textIdx]
  try {
    for (let i = 0; i < entries.length; i++) {
      node.data.widgetsValues[textIdx] = entries[i]
      // Materialize downstream sinks before queuing — same dance as
      // handleRunFiltered. Iterator only ever runs from this one node.
      const expanded = canvas.materializeAutoImageSinks?.([nodeId]) ?? [nodeId]
      const queued = await runVueWorkflow(expanded, i === 0
        ? { costConfirmIterations: entries.length }
        : { skipCostConfirm: true })
      if (queued === false) break // user declined the cost confirm
      // Small breather so the bridge / queue settles before the next.
      await new Promise(r => setTimeout(r, 250))
    }
  } finally {
    node.data.widgetsValues[textIdx] = original
    textIteratorRunning = false
  }
}

onMounted(() => {
  window.addEventListener('comfynext:runFiltered', handleRunFiltered)
  window.addEventListener('comfynext:runAll', handleRunAll)
  window.addEventListener('comfynext:runTextIterator', handleRunTextIterator)
  window.addEventListener('comfynext:reloadCanvas', forceReloadCanvas)
  runEstimateTimer = setInterval(updateRunEstimate, 2000)
  // Escape hatch: force-reload the embedded ComfyUI canvas from the console
  // (`__reloadCanvas()`) when its node schema goes stale after a backend change.
  ;(window as any).__reloadCanvas = forceReloadCanvas
})
onBeforeUnmount(() => {
  window.removeEventListener('comfynext:runFiltered', handleRunFiltered)
  window.removeEventListener('comfynext:runAll', handleRunAll)
  window.removeEventListener('comfynext:runTextIterator', handleRunTextIterator)
  window.removeEventListener('comfynext:reloadCanvas', forceReloadCanvas)
  if (runEstimateTimer) clearInterval(runEstimateTimer)
})

// Stop/interrupt the current ComfyUI execution and clear the queue
async function stopVueWorkflow() {
  try {
    await Promise.all([
      fetch('/interrupt', { method: 'POST' }),
      fetch('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }),
    ])
  }
  catch (err) {
    console.error('[VueNodes] Failed to interrupt:', err)
  }
}

// Single shared ComfyUI iframe — all project tabs share one iframe
const WORKFLOWS_STORAGE_KEY = 'comfynext:workflows'

// Restore persisted workflows from sessionStorage. Older sessions stored a
// bare workflow per tab — wrap those into one-canvas docs on the way in.
function loadPersistedWorkflows(): Record<string, any> {
  if (import.meta.server) return {}
  try {
    const saved = sessionStorage.getItem(WORKFLOWS_STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : {}
    for (const key of Object.keys(parsed)) parsed[key] = toProjectDoc(parsed[key])
    return parsed
  }
  catch { return {} }
}

const savedWorkflows = reactive<Record<string, any>>(loadPersistedWorkflows()) // tabId → ProjectDoc

// The workflow the Vue canvas should display: the active canvas of the active
// tab's doc. Switching canvases (or restoring a version) swaps this to a new
// object reference, which is what VueNodeCanvas's prop watch keys on.
const activeTabWorkflow = computed(() => {
  const doc = savedWorkflows[activeTab.value.id]
  if (!doc) return undefined
  return isProjectDoc(doc) ? activeCanvasOf(doc).workflow : doc
})

function persistWorkflows() {
  if (import.meta.server) return
  try {
    sessionStorage.setItem(WORKFLOWS_STORAGE_KEY, JSON.stringify(savedWorkflows))
  }
  catch {}
}

// Phase 0 (3a): mirror the session snapshot into a durable server-side Project
// version, IN ADDITION to sessionStorage. Strictly additive and best-effort —
// useProjects swallows all errors, and we never await it in a save path, so this
// can't affect the existing (sync) sessionStorage persistence or block a tab
// switch. Uses a single rolling "current" version id per project, so repeated
// saves update in place instead of piling up versions. The body is the whole
// ProjectDoc (every canvas) — the backend treats it as opaque JSON.
function saveDurableVersion(tab: any, doc: any) {
  if (!tab?.projectUuid || !docHasContent(doc)) return
  const name = tab.label || 'Untitled project'
  useProjects().saveVersion(tab.projectUuid, { id: 'current', name, workflow: doc }, name)
}

// Snapshot the live canvas into its slot in the tab's doc. The single choke
// point for "what's on screen → what's saved":
//   - reroll:false so serializing never mutates live seed widgets (a re-roll
//     would re-trip live-run watchers);
//   - refuses to write while the canvas is still applying a workflow prop —
//     getWorkflow() would return the PREVIOUS canvas and clobber this slot;
//   - refuses empty snapshots (canvas mid-unmount), matching the old guard.
// The workflow write goes through toRaw so saving the ACTIVE canvas doesn't
// swap the :workflow prop reference and trigger a pointless graph rebuild.
// Returns the (normalized) doc, or null if the tab has no doc and nothing to
// save (so a not-yet-loaded tab keeps its durable-load path on revisit).
function snapshotActiveCanvasIntoDoc(tabId: string): ProjectDoc | null {
  const canvas = vueCanvasRef.value
  const settled = canvas?.getWorkflow && !canvas.isApplyingWorkflow?.()
  const snapshot = settled ? canvas.getWorkflow({ reroll: false }) : null
  const hasSnapshot = !!snapshot && (snapshot.nodes?.length ?? 0) > 0
  if (!savedWorkflows[tabId] && !hasSnapshot) return null
  const doc = toProjectDoc(savedWorkflows[tabId])
  savedWorkflows[tabId] = doc
  if (hasSnapshot) activeCanvasOf(toRaw(doc)).workflow = snapshot
  return doc
}

// Restore a saved version (from the project menu) onto the canvas. The body
// may be a whole ProjectDoc (new versions) or a bare workflow (old ones) —
// either way it replaces the tab's entire doc. Assigning a fresh object into
// reactive savedWorkflows swaps the canvas's :workflow prop reference, which
// triggers VueNodeCanvas's prop watch to rebuild the graph. The restored state
// becomes the working state and autosaves to the rolling 'current' on the
// next switch/unload.
function onRestoreVersion(body: any) {
  const tab = activeTab.value
  if (!tab || !docHasContent(body)) return
  savedWorkflows[tab.id] = toProjectDoc(body)
  persistWorkflows()
  if (!vueNodesEnabled.value) {
    sendLoadWorkflow(JSON.parse(JSON.stringify(activeCanvasOf(savedWorkflows[tab.id]).workflow)))
  }
}

// ── Multi-canvas operations (project menu) ──────────────────────────────────
// The active tab's doc, for the project menu's canvas list. Normalized lazily:
// a tab that hasn't loaded yet has no doc and the menu shows nothing to switch.
const activeProjectDoc = computed<ProjectDoc | null>(() => {
  if (activeTab.value.type !== 'project') return null
  const doc = savedWorkflows[activeTab.value.id]
  return isProjectDoc(doc) ? doc : null
})

// Re-entrancy guard: a switch serializes the outgoing canvas, swaps the doc's
// active id, and (in LiteGraph mode) pushes the target into the iframe. Block
// further switches until that completes so two rapid clicks can't interleave.
const canvasSwitching = ref(false)

async function switchProjectCanvas(canvasId: string) {
  const tab = activeTab.value
  if (tab.type !== 'project' || canvasSwitching.value) return
  const doc = toProjectDoc(savedWorkflows[tab.id])
  savedWorkflows[tab.id] = doc
  if (doc.activeCanvasId === canvasId) return
  const target = doc.canvases.find((c) => c.id === canvasId)
  if (!target) return
  canvasSwitching.value = true
  try {
    if (vueNodesEnabled.value) {
      // Serialize the outgoing canvas first (guarded against mid-load/empty
      // snapshots), then swap the active id — the activeTabWorkflow computed
      // changes reference and the canvas prop watch rebuilds the graph.
      snapshotActiveCanvasIntoDoc(tab.id)
      doc.activeCanvasId = canvasId
    }
    else {
      const workflow = await getWorkflowFromIframe()
      if (workflow && (workflow.nodes?.length ?? 0) > 0) {
        activeCanvasOf(doc).workflow = workflow
      }
      doc.activeCanvasId = canvasId
      await sendLoadWorkflow(JSON.parse(JSON.stringify(target.workflow || BLANK_WORKFLOW)))
    }
    persistWorkflows()
    saveDurableVersion(tab, doc)
  } finally {
    canvasSwitching.value = false
  }
}

async function addProjectCanvas() {
  const tab = activeTab.value
  if (tab.type !== 'project' || canvasSwitching.value) return
  const doc = toProjectDoc(savedWorkflows[tab.id])
  savedWorkflows[tab.id] = doc
  const canvas: ProjectCanvas = { id: makeCanvasId(), name: nextCanvasName(doc), workflow: makeBlankWorkflow() }
  doc.canvases.push(canvas)
  await switchProjectCanvas(canvas.id)
}

function renameProjectCanvas(canvasId: string, name: string) {
  const doc = activeProjectDoc.value
  const canvas = doc?.canvases.find((c) => c.id === canvasId)
  if (!canvas || !name.trim()) return
  canvas.name = name.trim()
  persistWorkflows()
}

async function deleteProjectCanvas(canvasId: string) {
  const tab = activeTab.value
  const doc = activeProjectDoc.value
  if (!doc || doc.canvases.length <= 1 || canvasSwitching.value) return
  const idx = doc.canvases.findIndex((c) => c.id === canvasId)
  if (idx === -1) return
  // Deleting the canvas on screen: move to a neighbor first so the doc never
  // points at a canvas that no longer exists.
  if (doc.activeCanvasId === canvasId) {
    const neighbor = doc.canvases[idx + 1] ?? doc.canvases[idx - 1]
    if (!neighbor) return
    await switchProjectCanvas(neighbor.id)
  }
  const at = doc.canvases.findIndex((c) => c.id === canvasId)
  if (at !== -1) doc.canvases.splice(at, 1)
  persistWorkflows()
  saveDurableVersion(tab, doc)
}

// ── Brand kit (project menu) ────────────────────────────────────────────────
// The doc owns brandKitId; the library composable resolves it to a kit entry.
// Setting flows through the same doc-mutation + persistence path as the other
// canvas edits (mutate the reactive doc, persistWorkflows, durable mirror).
const brandLib = useBrandLibrary(computed(() => activeProjectDoc.value?.brandKitId))
const brandKitName = computed(() => brandLib.activeEntry.value?.name ?? null)
const brandSwatches = computed(() => {
  const k = brandLib.activeEntry.value?.kit
  return k ? [k.primary, k.accent, k.accent2].filter(Boolean) as string[] : []
})
function setBrandKit(id: string | null) {
  const tab = activeTab.value
  if (tab.type !== 'project') return
  const doc = toProjectDoc(savedWorkflows[tab.id])
  savedWorkflows[tab.id] = doc
  doc.brandKitId = id
  persistWorkflows()
  saveDurableVersion(tab, doc)
}

// Descendants (e.g. the Smart Layout editor modal in the canvas) read the
// project's active kit through this — same merge inputs everywhere.
provide('comfynext:brand', {
  activeKit: brandLib.activeKit,
  activeKitId: computed(() => activeProjectDoc.value?.brandKitId ?? null),
  setBrandKit,
})

// Rename the project from the menu: tab label + recent-projects name +
// durable project record, mirroring what the tab double-click rename does.
function renameActiveProject(name: string) {
  const tab = activeTab.value
  if (tab.type !== 'project' || !name.trim()) return
  renameTab(tab.id, name)
  if (tab.workflowId) useRecentProjects().setProjectName(tab.workflowId, name.trim())
  if (tab.projectUuid) useProjects().renameProject(tab.projectUuid, name.trim())
}

// The full doc with the live canvas serialized in, deep-copied — what a named
// version snapshot should contain. Async because the LiteGraph path has to
// round-trip through the iframe.
async function getProjectDocForVersionSave(): Promise<any | null> {
  const tab = activeTab.value
  if (tab.type !== 'project') return null
  if (vueNodesEnabled.value) {
    const doc = snapshotActiveCanvasIntoDoc(tab.id)
    return doc ? JSON.parse(JSON.stringify(toRaw(doc))) : null
  }
  const doc = toProjectDoc(savedWorkflows[tab.id])
  savedWorkflows[tab.id] = doc
  const workflow = await getWorkflowFromIframe()
  if (workflow && (workflow.nodes?.length ?? 0) > 0) {
    activeCanvasOf(doc).workflow = workflow
  }
  return JSON.parse(JSON.stringify(toRaw(doc)))
}

// Autosave: snapshot current canvas and persist to sessionStorage.
// Only called on specific events (beforeunload, tab switch) — never on a timer.
function autosaveCurrentWorkflow() {
  const tab = activeTab.value
  if (tab?.type !== 'project') return
  if (vueNodesEnabled.value && vueCanvasRef.value?.getWorkflow) {
    const doc = snapshotActiveCanvasIntoDoc(tab.id)
    if (doc && docHasContent(doc)) {
      try { sessionStorage.setItem(WORKFLOWS_STORAGE_KEY, JSON.stringify(toRaw(savedWorkflows))) }
      catch {}
      saveDurableVersion(tab, doc)
    }
  }
}

// Prompts queued by live-run should not surface "started" / "completed" toasts
// or the canvas status bar — slider drags would flicker that surface dozens of
// times a second. The bridge synthesizes execution_complete without a prompt_id,
// so we can't match by id. ComfyUI executes one prompt at a time, so we track
// a single flag set at execution_start and consumed at execution_complete/error.
// (Ref rather than `let` so the status bar's `running` prop can react.)
const pendingLiveRuns = ref(0)
const currentRunSilent = ref(false)
let pendingLiveRunsResetTimer: ReturnType<typeof setTimeout> | null = null

// No-response watchdog for the queuePrompt handshake. We postMessage
// `queuePrompt` to the bridge iframe and return immediately — but if the
// iframe's LiteGraph registry is stale after a ComfyUI restart (it silently
// drops nodes / no-ops the queue) or the message lands on a half-loaded frame,
// the run fails with ZERO feedback: no /prompt POST, status stuck Idle, no
// toast. The bridge posts a terminal event for every outcome it reaches
// (`queued` on success, `queue_error` on any failure) — so silence past the
// timeout means the handler never ran. Surface it instead of hanging.
const QUEUE_WATCHDOG_MS = 8000
let queueWatchdogTimer: ReturnType<typeof setTimeout> | null = null
function clearQueueWatchdog() {
  if (queueWatchdogTimer) { clearTimeout(queueWatchdogTimer); queueWatchdogTimer = null }
}
function armQueueWatchdog(tabId: string) {
  clearQueueWatchdog()
  queueWatchdogTimer = setTimeout(() => {
    queueWatchdogTimer = null
    console.error('[Run] no bridge response after queuePrompt — stale canvas or dropped message')
    toast.error('Run didn’t start', {
      description: 'The ComfyUI canvas didn’t respond — it can go stale after a restart. Reload the page and try again.',
    })
    if (tabId) updateTabStatus(tabId, 'idle')
  }, QUEUE_WATCHDOG_MS)
}

function handleLiveRun() {
  pendingLiveRuns.value++
  // Safety: drop the counter if no execution_start arrives (e.g. queue rejected the prompt).
  if (pendingLiveRunsResetTimer) clearTimeout(pendingLiveRunsResetTimer)
  pendingLiveRunsResetTimer = setTimeout(() => { pendingLiveRuns.value = 0 }, 10000)
  runVueWorkflow(undefined, { live: true })
}

onMounted(() => {
  window.addEventListener('beforeunload', autosaveCurrentWorkflow)
  window.addEventListener('comfynext:liveRun', handleLiveRun)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', autosaveCurrentWorkflow)
  window.removeEventListener('comfynext:liveRun', handleLiveRun)
})
let sharedIframeReady = false
const iframeReady = ref(false) // reactive for template
// True while a workflow is being pushed into the canvas (incl. waiting for the
// bridge to become ready on a cold start). Drives the loading overlay so the
// wait reads as "initializing", not a dead/broken button.
const workflowLoading = ref(false)
let workflowLoadingTimer: ReturnType<typeof setTimeout> | null = null
const vueCanvasRef = ref<any>(null)
let currentProjectTabId: string | null = null // tracks which project tab's workflow is loaded

// Bridge readiness handshake: the bridge posts { status: 'ready' } once ComfyUI's
// app + node defs are fully initialized. We gate workflow loads on this instead of
// a fixed delay, so "new workflow" works the instant the canvas is usable (cold
// starts can take ~a minute) rather than silently dropping early messages.
let bridgeIsReady = false
let bridgeReadyResolve: (() => void) | null = null
let bridgeReadyPromise: Promise<void> = new Promise((r) => { bridgeReadyResolve = r })

function resetBridgeReady() {
  bridgeIsReady = false
  bridgeReadyPromise = new Promise((r) => { bridgeReadyResolve = r })
}

// The embedded ComfyUI canvas (iframe) fetches its node schema ONCE at load.
// After a backend node-schema change it goes stale — it maps widget values to
// the OLD widget order (e.g. a taste_profile value landing in the prompt_strength
// slot → "could not convert string to float" → 400). A plain page refresh in dev
// (HMR) often doesn't remount the iframe, so we force it: reset the bridge-ready
// handshake AND reload the iframe with a cache-bust. Exposed on window so it can
// be triggered from the console; also wired to the "Reload canvas" control.
// Public origin the ComfyUI canvas iframe loads from. In production this is set
// to the app's ComfyUI origin via NUXT_PUBLIC_COMFY_ORIGIN; in dev it falls back
// to the local ComfyUI server on :8188.
const comfyOrigin = useRuntimeConfig().public.comfyOrigin || 'http://127.0.0.1:8188'
const comfyIframeSrc = ref(`${comfyOrigin}/`)
function forceReloadCanvas() {
  resetBridgeReady()
  endWorkflowLoading()
  comfyIframeSrc.value = `${comfyOrigin}/?_cb=${Date.now()}`
}
// Assign at setup time too (HMR re-runs setup but not always onMounted) so the
// console escape hatch is always present.
if (import.meta.client) (globalThis as any).__reloadCanvas = forceReloadCanvas

// ───────────────────────────────────────────────────────────────────────────
// Parallel-run worker pool (prototype). OFF by default → a single worker,
// identical to today's behavior. Enable in the browser console with:
//   localStorage['comfynext:pool'] = 'on'   // uses :8188 + :8189
//   localStorage['comfynext:pool'] = 'http://127.0.0.1:8188,http://127.0.0.1:8189'
// then reload. Each project tab is round-robin assigned to a worker; runs on
// different tabs hit different ComfyUI servers and execute concurrently.
// ───────────────────────────────────────────────────────────────────────────
const comfyWorkers = ref<string[]>([comfyOrigin])
if (import.meta.client) {
  try {
    const raw = localStorage.getItem('comfynext:pool')
    let desired: string[] | null = null
    if (raw === 'on') desired = [comfyOrigin, comfyOrigin.replace(/:\d+/, ':8189')]
    else if (raw) {
      const list = raw.split(',').map(s => s.trim()).filter(Boolean)
      if (list.length > 1) desired = list
    }
    // The pool flag can outlive the extra servers it points at (it lives in
    // localStorage; the :8189 worker is something you start by hand). A dead
    // worker is worse than no worker — every run round-robined onto it waits
    // ~2 minutes for a bridge that never loads, then silently does nothing.
    // So probe each extra worker first and only enable the ones that answer.
    // no-cors because the extra workers are cross-origin without CORS headers:
    // a resolved fetch (even opaque) means a server is listening; a network
    // error means it isn't. Until the probe lands we stay single-worker, which
    // is always safe (worker 0 = the shared iframe).
    if (desired && desired.length > 1) {
      Promise.all(desired.slice(1).map(async (origin) => {
        try {
          await fetch(`${origin}/`, { mode: 'no-cors', signal: AbortSignal.timeout(3000) })
          return origin
        } catch { return null }
      })).then((probed) => {
        const alive = probed.filter((o): o is string => !!o)
        const dead = desired!.slice(1).filter((o) => !alive.includes(o))
        if (dead.length) console.warn('[pool] ignoring unreachable worker(s):', dead.join(', '), '— runs stay on the primary server')
        if (alive.length) comfyWorkers.value = [desired![0], ...alive]
      })
    }
  } catch { /* ignore */ }
}
const poolEnabled = computed(() => comfyWorkers.value.length > 1)

// tabId → worker index (round-robin in assignment order). Worker 0 always = the
// existing shared iframe, so single-worker callers get index 0 unchanged.
const tabWorker = reactive<Record<string, number>>({})
function workerForTab(tabId?: string | null): number {
  if (!poolEnabled.value || !tabId) return 0
  if (tabWorker[tabId] == null) {
    tabWorker[tabId] = Object.keys(tabWorker).length % comfyWorkers.value.length
  }
  return tabWorker[tabId]
}
// worker index → the tab currently running on it (set at submit; a worker runs
// one prompt at a time, so this is enough to route that worker's events back).
const workerRunningTab = reactive<Record<number, string>>({})
// worker index → which doc canvas the in-flight run was queued from. Lets the
// canvas component scope run events/animations to the right canvas — node ids
// collide across a project's canvases, so worker alone isn't enough.
const runningCanvasByWorker = reactive<Record<number, string | null>>({})
// The worker the *currently viewed* canvas runs on — lets the canvas ignore
// other workers' run events (so a background tab's run doesn't clear the active
// tab's animation) and re-apply the right running node when you switch tabs.
const activeWorker = computed(() => workerForTab(activeTab.value?.id))

function getWorkerIframe(idx: number): HTMLIFrameElement | null {
  if (idx === 0) return getSharedIframe()
  return document.querySelector(`iframe[data-worker="${idx}"]`) as HTMLIFrameElement | null
}
function workerIndexOfFrame(win: Window | null): number | null {
  if (!win) return null
  if (getSharedIframe()?.contentWindow === win) return 0
  for (const f of document.querySelectorAll('iframe[data-worker]')) {
    if ((f as HTMLIFrameElement).contentWindow === win) return Number((f as HTMLIFrameElement).dataset.worker)
  }
  return null
}

// Per-worker bridge-ready (the global bridgeIsReady stays for the worker-0 /
// single-worker path; this tracks the extra pool workers).
const workerReady = reactive<Record<number, boolean>>({})
const workerReadyResolvers: Record<number, Array<() => void>> = {}
function markWorkerReady(idx: number) {
  if (workerReady[idx]) return
  workerReady[idx] = true
  ;(workerReadyResolvers[idx] || []).forEach(r => r())
  workerReadyResolvers[idx] = []
}
function waitForWorkerReady(idx: number, timeoutMs = 120000): Promise<void> {
  if (idx === 0) return waitForBridgeReady(timeoutMs) // reuse existing global handshake
  if (workerReady[idx]) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (done) return; done = true; clearInterval(poll); clearTimeout(to); resolve() }
    ;(workerReadyResolvers[idx] ||= []).push(finish)
    const nudge = () => getWorkerIframe(idx)?.contentWindow?.postMessage({ type: 'comfynext', action: 'requestStatus' }, '*')
    nudge()
    const poll = setInterval(() => { if (workerReady[idx]) finish(); else nudge() }, 500)
    const to = setTimeout(finish, timeoutMs)
  })
}

function markBridgeReady() {
  if (bridgeIsReady) return
  bridgeIsReady = true
  bridgeReadyResolve?.()
}

// Resolve once the bridge signals ready. Nudges the bridge with requestStatus in
// case our listener attached after it already broadcast (e.g. a frontend-only
// reload while ComfyUI stays loaded). Falls back after timeoutMs so we never hang.
function waitForBridgeReady(timeoutMs = 120000): Promise<void> {
  if (bridgeIsReady) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearInterval(poll)
      clearTimeout(to)
      resolve()
    }
    bridgeReadyPromise.then(finish)
    const nudge = () => {
      getSharedIframe()?.contentWindow?.postMessage({ type: 'comfynext', action: 'requestStatus' }, '*')
    }
    nudge()
    const poll = setInterval(() => { if (bridgeIsReady) finish(); else nudge() }, 500)
    const to = setTimeout(finish, timeoutMs)
  })
}

function getSharedIframe(): HTMLIFrameElement | null {
  return document.querySelector('[data-tab-id="comfyui-shared"] iframe') as HTMLIFrameElement | null
}

function beginWorkflowLoading() {
  workflowLoading.value = true
  if (workflowLoadingTimer) clearTimeout(workflowLoadingTimer)
  // Safety net: never let the overlay get stuck if the bridge never confirms.
  workflowLoadingTimer = setTimeout(() => { workflowLoading.value = false }, 125000)
}

function endWorkflowLoading() {
  workflowLoading.value = false
  if (workflowLoadingTimer) { clearTimeout(workflowLoadingTimer); workflowLoadingTimer = null }
}

async function sendLoadWorkflow(workflow: any, workerIdx = 0) {
  // Final-boundary invariant: null any input.link that doesn't resolve to a
  // link in links[]. ComfyUI's graphToPrompt aborts the whole run on the first
  // dangling ref ("No link found in parent graph for id [N] slot [S]"), so we
  // heal here — the last place the workflow is ours before it crosses into the
  // bridge iframe. The warn surfaces the exact node/link when it fires so a
  // recurring source can be traced.
  const healed = healDanglingLinks(workflow)
  if (healed.length) {
    console.warn('[ComfyNext] healed dangling input link(s) before load:', healed,
      '| has definitions:', !!workflow?.definitions,
      '| nodes:', workflow?.nodes?.length, '| links:', workflow?.links?.length)
  }
  beginWorkflowLoading()
  await waitForWorkerReady(workerIdx)
  const iframe = getWorkerIframe(workerIdx)
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'comfynext', action: 'loadWorkflow', workflow }, '*')
  }
  else {
    endWorkflowLoading()
  }
  // Otherwise cleared when the bridge confirms via the 'workflow_loaded' event.
}

function getWorkflowFromIframe(): Promise<any> {
  return new Promise((resolve) => {
    const iframe = getSharedIframe()
    if (!iframe?.contentWindow) { resolve(null); return }

    let resolved = false
    const handler = (event: MessageEvent) => {
      if (resolved) return
      if (event.data?.type === 'comfynext-bridge' && event.data?.event === 'workflow_data') {
        resolved = true
        window.removeEventListener('message', handler)
        resolve(event.data.workflow)
      }
    }
    window.addEventListener('message', handler)
    iframe.contentWindow.postMessage({ type: 'comfynext', action: 'getWorkflow' }, '*')
    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        window.removeEventListener('message', handler)
        resolve(null)
      }
    }, 2000)
  })
}

async function fetchWorkflowFromHistory(promptId: string): Promise<any> {
  try {
    const res = await fetch(`/history/${promptId}`)
    const data = await res.json()
    const entry = data?.[promptId]
    return entry?.prompt?.[3]?.extra_pnginfo?.workflow || null
  }
  catch { return null }
}

async function loadWorkflowForTab(tab: any) {
  if (currentProjectTabId === tab.id && savedWorkflows[tab.id]) return // already loaded

  const saved = savedWorkflows[tab.id]

  if (vueNodesEnabled.value) {
    // Vue mode: store the doc directly (no iframe needed) — the canvas reads
    // its active canvas via the activeTabWorkflow computed.
    if (!saved) {
      // Phase 0 (3b): if this tab is tied to a durable Project, prefer its saved
      // version — it's the freshest cross-session state (written by 3a on
      // switch/unload), fresher than /history. Strictly a fallback: only runs
      // when there's no in-session sessionStorage snapshot, and degrades to the
      // existing history/blank path if the project or its version is absent.
      // The durable body may be a whole ProjectDoc (new saves) or a bare
      // workflow (old ones) — toProjectDoc normalizes either.
      let durableBody: any = null
      if (tab.projectUuid) {
        const loaded = await useProjects().loadProject(tab.projectUuid)
        durableBody = loaded?.currentVersion?.workflow || null
      }
      if (docHasContent(durableBody)) {
        savedWorkflows[tab.id] = toProjectDoc(durableBody)
      }
      else if (tab.promptId) {
        const workflow = await fetchWorkflowFromHistory(tab.promptId)
        savedWorkflows[tab.id] = toProjectDoc(workflow || makeBlankWorkflow())
      }
      else if (tab.workflowId) {
        // Try to load from recent workflows API
        try {
          const res = await fetch(`/api/workflows/${tab.workflowId}`)
          const data = await res.json()
          savedWorkflows[tab.id] = toProjectDoc(data?.workflow || makeBlankWorkflow())
        }
        catch { savedWorkflows[tab.id] = toProjectDoc(makeBlankWorkflow()) }
      }
      else {
        savedWorkflows[tab.id] = toProjectDoc(makeBlankWorkflow())
      }
    }
  }
  else {
    // LiteGraph mode: send the doc's active canvas to the iframe
    if (saved) {
      await sendLoadWorkflow(JSON.parse(JSON.stringify(activeCanvasOf(toProjectDoc(saved)).workflow)))
    }
    else if (tab.promptId) {
      const workflow = await fetchWorkflowFromHistory(tab.promptId)
      await sendLoadWorkflow(workflow || BLANK_WORKFLOW)
    }
    else {
      await sendLoadWorkflow(BLANK_WORKFLOW)
    }
  }
  currentProjectTabId = tab.id
  persistWorkflows()
}

// Handle workflow loaded from community template
function handleLoadTabWorkflow(e: Event) {
  const { tabId, workflow } = (e as CustomEvent).detail
  savedWorkflows[tabId] = toProjectDoc(workflow)
  persistWorkflows()
  // This tab now has real content — never treat it as a "fresh blank project"
  // (would otherwise pop the Get Started modal over the loaded workflow).
  seenStartModalTabIds.add(tabId)
  // If this tab is already active, load it now
  const tab = tabs.value.find((t: any) => t.id === tabId)
  if (tab && activeTabId.value === tabId) {
    currentProjectTabId = null // force reload
    loadWorkflowForTab(tab)
  }
}

async function onSharedIframeLoad(event: Event) {
  const iframe = event.target as HTMLIFrameElement
  if (!iframe?.contentWindow) return

  // A fresh iframe load means the bridge will (re)announce readiness.
  resetBridgeReady()
  // Wait for the bridge to signal ComfyUI is actually usable (window.app + node
  // defs loaded) instead of guessing with a fixed delay. Vue mode doesn't drive
  // workflows through the iframe, so it doesn't need to block on this.
  if (!vueNodesEnabled.value) {
    await waitForBridgeReady()
  }
  sharedIframeReady = true
  iframeReady.value = true

  // Load the workflow for the currently active project tab
  const tab = activeTab.value
  if (tab.type === 'project') {
    await loadWorkflowForTab(tab)
  }
}

// Save/restore workflows when switching between tabs
watch(activeTabId, async (newId, oldId) => {
  const oldTab = tabs.value.find((t) => t.id === oldId)
  const newTab = tabs.value.find((t) => t.id === newId)

  // Save current workflow when leaving a project tab — into the active
  // canvas's slot of the tab's doc. snapshotActiveCanvasIntoDoc guards
  // against empty/mid-load snapshots clobbering a good saved canvas.
  if (oldTab?.type === 'project') {
    if (vueNodesEnabled.value) {
      snapshotActiveCanvasIntoDoc(oldTab.id)
    }
    else if (sharedIframeReady) {
      const workflow = await getWorkflowFromIframe()
      if (workflow && (workflow.nodes?.length ?? 0) > 0) {
        const doc = toProjectDoc(savedWorkflows[oldTab.id])
        savedWorkflows[oldTab.id] = doc
        activeCanvasOf(doc).workflow = workflow
      }
    }
    persistWorkflows()
    saveDurableVersion(oldTab, savedWorkflows[oldTab.id])
  }

  // Restore workflow when entering a project tab
  if (newTab?.type === 'project') {
    await loadWorkflowForTab(newTab)
  }
})

// When Vue mode is toggled, transfer the workflow between iframe ↔ Vue canvas
watch(vueNodesEnabled, async (enabled) => {
  const tab = activeTab.value
  if (tab.type !== 'project') return

  if (enabled) {
    // ALWAYS fetch fresh — don't trust cache (may be BLANK_WORKFLOW from earlier failure)
    if (tab.promptId) {
      const wf = await fetchWorkflowFromHistory(tab.promptId)
      if (wf) savedWorkflows[tab.id] = toProjectDoc(wf)
    }
    if (!savedWorkflows[tab.id]) {
      savedWorkflows[tab.id] = toProjectDoc(makeBlankWorkflow())
    }
    currentProjectTabId = null
    await loadWorkflowForTab(tab)
  }
})

// ComfyUI sidebar width and tab bar height to crop via CSS
const COMFY_SIDEBAR_W = 0
const COMFY_TABBAR_H = 0

// Status indicator colors
const statusColor = (status?: string) => {
  if (status === 'idle') return '#4ade80'
  if (status === 'running') return '#818cf8'
  if (status === 'done') return '#4ade80'
  return 'transparent'
}

const queueOpen = ref(false)
const queueData = ref<{ running: any[], pending: any[] }>({ running: [], pending: [] })

// Rich history items for the queue modal
interface HistoryItem {
  promptId: string
  status: 'completed' | 'failed'
  images: { filename: string, subfolder: string, type: string }[]
  executionTime: number | null // seconds
  timestamp: number // ms since epoch
}
const historyItems = ref<HistoryItem[]>([])

// Per-prompt progress and executing node info from bridge events
const promptProgress = ref<Record<string, number>>({})
const tabNodeProgress = ref({ completed: 0, total: 0 })
const currentRunningNode = ref('')
const executionStartTime = ref<number | null>(null)
const currentRunProgressPct = ref(0)

// Latest result for the canvas status bar. Cleared when a new run starts;
// success auto-clears after a few seconds via the timeout below; errors
// persist until the user dismisses or the next run starts.
const lastRunResult = ref<RunResult | null>(null)
let successClearTimer: ReturnType<typeof setTimeout> | null = null

function setRunResult(r: RunResult | null) {
  if (successClearTimer) { clearTimeout(successClearTimer); successClearTimer = null }
  lastRunResult.value = r
  if (r?.kind === 'success') {
    successClearTimer = setTimeout(() => {
      if (lastRunResult.value?.kind === 'success') lastRunResult.value = null
    }, 6000)
  }
}

// Credits accounting for the run cost display.
//   - runStartCredits: balance at execution_start (the "before" number).
//   - runCostDeadline: stop watching for a delta after this timestamp.
//   - executedNodeIds: every node id that fired an `executing` event during
//     the current run. Used to estimate the Replicate dollar cost from the
//     price_badge of each node that ran (BYOK Replicate doesn't show up in
//     Comfy's credit balance, so we can't use the delta there).
// We can't know either cost synchronously — Comfy/Replicate deduct mid-run
// and Pinia's balance only refreshes after we refetch. So at execution_complete
// we trigger a refresh and watch `credits` until the deadline. The watch()
// call lives further down, after `credits` is declared, to avoid TDZ.
let runStartCredits: number | null = null
const runCostDeadline = ref(0)
const executedNodeIds = new Set<string>()

// Output files collected from `executed` events during the current run — the
// durable generation record is assembled from these at execution_complete.
const runOutputs: GenOutput[] = []

// A record waiting for its cost. Replicate-billed runs flush immediately
// (Comfy's balance won't move); credit-billed runs wait for the balance
// watcher's delta (or the deadline timer) so the record carries real credits.
let pendingGen: {
  projectUuid: string
  projectName?: string
  record: GenerationRecord
  flushed: boolean
  timer: ReturnType<typeof setTimeout> | null
} | null = null

function flushPendingGen(creditsDelta?: number | null) {
  if (!pendingGen || pendingGen.flushed) return
  pendingGen.flushed = true
  if (pendingGen.timer) clearTimeout(pendingGen.timer)
  if (typeof creditsDelta === 'number' && creditsDelta > 0) pendingGen.record.credits = creditsDelta
  useProjects().saveGeneration(pendingGen.projectUuid, pendingGen.record, pendingGen.projectName)
  pendingGen = null
}

// Tally USD cost from the price_badge of every Replicate node that ran.
// The badge parsing/summing lives in lib/costEstimate.ts (shared with the
// pre-run estimate). Returns null when no priced Replicate node ran (so the
// credit-delta path can win for Comfy-native workflows).
function estimateReplicateUsd(): { usd: number; approximate: boolean } | null {
  const nodes = vueCanvasRef.value?.getNodes?.() || []
  const ran = nodes.filter((n: any) => executedNodeIds.has(String(n.id)))
  const est = estimateUsdForNodes(vueNodesToEstimateInput(ran))
  return est ? { usd: est.usd, approximate: est.approximate } : null
}

const promptNodeInfo = ref<Record<string, { nodeId: string, nodeType: string }>>({})

let queuePollTimer: ReturnType<typeof setInterval> | null = null
const credits = ref<number | null>(null)

// Watch credits for the post-run delta. Must come after `credits` is declared.
watch(credits, (newVal) => {
  if (newVal == null) return
  if (Date.now() > runCostDeadline.value) return
  if (runStartCredits == null) return
  const result = lastRunResult.value
  if (result?.kind !== 'success') return
  if (result.cost != null || result.usd != null) return // already accounted for
  const delta = runStartCredits - newVal
  if (delta > 0) {
    lastRunResult.value = { ...result, cost: delta }
    flushPendingGen(delta)
  }
})
const userProfile = ref<{ email?: string | null, displayName?: string | null, photoURL?: string | null, uid?: string | null, providerId?: string | null } | null>(null)
const userPopupOpen = ref(false)

// Pre-run cost guard — promise-based confirm so runVueWorkflow can await it.
const costConfirm = ref<{ estimate: CostEstimate; iterations: number; resolve: (ok: boolean) => void } | null>(null)
function confirmRunCost(estimate: CostEstimate, iterations = 1): Promise<boolean> {
  return new Promise((resolve) => { costConfirm.value = { estimate, iterations, resolve } })
}
function resolveCostConfirm(ok: boolean) {
  costConfirm.value?.resolve(ok)
  costConfirm.value = null
}
function costConfirmThresholdUsd(): number {
  const raw = useLocalSettings().getLocalSetting('ComfyNext.Cost.ConfirmThresholdUsd')
  const n = parseFloat(raw ?? '')
  return Number.isFinite(n) && n >= 0 ? n : 1
}

// Rolling estimate for the Run button. Polled (not computed) because the
// canvas nodes live behind a component ref, outside our reactivity graph.
const runEstimate = ref<CostEstimate | null>(null)
let runEstimateTimer: ReturnType<typeof setInterval> | null = null
function updateRunEstimate() {
  if (!vueNodesEnabled.value || activeTab.value?.type !== 'project') {
    runEstimate.value = null
    return
  }
  const nodes = vueCanvasRef.value?.getNodes?.() || []
  runEstimate.value = estimateUsdForNodes(vueNodesToEstimateInput(nodes))
}

// Credits modal (native Vue — no iframe needed)
const creditsModalOpen = ref(false)
const creditsAmount = ref(50)
const creditsBuying = ref(false)
const creditsPresets = [10, 25, 50, 100]
const CREDITS_PER_DOLLAR = 211

const creditsDisplay = computed(() => Math.round(creditsAmount.value * CREDITS_PER_DOLLAR).toLocaleString())

function adjustCreditsAmount(delta: number) {
  const step = creditsAmount.value < 100 ? 5 : creditsAmount.value < 1000 ? 50 : 100
  creditsAmount.value = Math.max(5, Math.min(10000, creditsAmount.value + delta * step))
}

function openAddCredits() {
  creditsAmount.value = 50
  creditsModalOpen.value = true
}

function sendToBridgeIframe(action: string, payload?: any) {
  const bridgeIframe = document.getElementById('comfynext-bridge-iframe') as HTMLIFrameElement
  if (bridgeIframe?.contentWindow) {
    bridgeIframe.contentWindow.postMessage({ type: 'comfynext', action, ...payload }, '*')
  }
}

async function handleContinueToPayment() {
  creditsBuying.value = true
  sendToBridgeIframe('purchaseCredits', { amount: creditsAmount.value })
}


// Provide user state for sidebar avatar
provide('userProfile', userProfile)
provide('userPopupOpen', userPopupOpen)
provide('toggleUserPopup', () => { userPopupOpen.value = !userPopupOpen.value })

function toggleQueue() {
  queueOpen.value = !queueOpen.value
  if (queueOpen.value) {
    fetchQueueAndHistory()
    queuePollTimer = setInterval(fetchQueueAndHistory, 2000)
  } else {
    if (queuePollTimer) { clearInterval(queuePollTimer); queuePollTimer = null }
  }
}

async function fetchQueueAndHistory() {
  const [queueRes, historyRes] = await Promise.allSettled([
    fetch('/queue').then(r => r.json()),
    fetch('/history').then(r => r.json()),
  ])

  if (queueRes.status === 'fulfilled') {
    queueData.value = {
      running: queueRes.value.queue_running ?? [],
      pending: queueRes.value.queue_pending ?? [],
    }
  }

  if (historyRes.status === 'fulfilled') {
    const data = historyRes.value as Record<string, any>
    const items: HistoryItem[] = []
    for (const [promptId, entry] of Object.entries(data)) {
      const status = entry.status?.completed ? 'completed' : 'failed'
      // Collect all output images across nodes
      const images: { filename: string, subfolder: string, type: string }[] = []
      if (entry.outputs) {
        for (const nodeOutput of Object.values(entry.outputs) as any[]) {
          if (nodeOutput.images) images.push(...nodeOutput.images)
        }
      }
      // Calculate execution time from messages
      let executionTime: number | null = null
      const messages = entry.status?.messages ?? []
      const startMsg = messages.find((m: any) => m[0] === 'execution_start')
      const endMsg = messages.find((m: any) => m[0] === 'execution_success' || m[0] === 'execution_error')
      if (startMsg?.[1]?.timestamp && endMsg?.[1]?.timestamp) {
        executionTime = (endMsg[1].timestamp - startMsg[1].timestamp) / 1000
      }
      const timestamp = startMsg?.[1]?.timestamp ?? 0
      // Skip live-preview entries (temp-only images from UI.PreviewImage) so
      // the queue history panel isn't flooded by slider-drag runs.
      const savedImages = images.filter(img => img.type !== 'temp')
      if (savedImages.length > 0) {
        items.push({ promptId, status, images: savedImages, executionTime, timestamp })
      }
    }
    // Sort newest first
    items.sort((a, b) => b.timestamp - a.timestamp)
    historyItems.value = items
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return ''
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function queueItemProgress(_promptId: string): number {
  // Use the active tab's progress — single source of truth
  const tab = tabs.value.find(t => t.type === 'project' && t.status === 'running')
  return tab?.progress ?? 0
}

function runningWorkflowName(promptId: string): string {
  // Find which tab is running this prompt by checking which tab has 'running' status
  const runningTab = tabs.value.find(t => t.type === 'project' && t.status === 'running')
  return runningTab?.label ?? 'Running'
}

function thumbnailUrl(img: { filename: string, subfolder: string, type: string }): string {
  const params = new URLSearchParams({ filename: img.filename, type: img.type })
  if (img.subfolder) params.set('subfolder', img.subfolder)
  return `/view?${params}`
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  if (date >= today) return 'Today'
  if (date >= yesterday) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Group history items by day
const groupedHistory = computed(() => {
  const groups: { label: string, items: HistoryItem[] }[] = []
  let currentLabel = ''
  for (const item of historyItems.value) {
    const label = dayLabel(item.timestamp)
    if (label !== currentLabel) {
      currentLabel = label
      groups.push({ label, items: [] })
    }
    groups[groups.length - 1].items.push(item)
  }
  return groups
})

// Listen for bridge messages from ComfyUI iframes
onMounted(async () => {
  // Vue mode: load workflow for the active project tab immediately (no iframe needed)
  if (vueNodesEnabled.value && activeTab.value.type === 'project') {
    await loadWorkflowForTab(activeTab.value)
  }

  // Debug: log ALL postMessages to find bridge issues
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'comfynext-bridge') {
      console.log('[ComfyNext] Bridge message received:', e.data.event || e.data.status, e.data)
    }
  })
  window.addEventListener('message', handleBridgeMessage)
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('comfynext:loadTabWorkflow', handleLoadTabWorkflow)

  // Also check bridge iframe loaded after delay and request client ID
  setTimeout(() => {
    const bridge = document.getElementById('comfynext-bridge-iframe') as HTMLIFrameElement
    console.log('[ComfyNext] Bridge iframe check:', {
      exists: !!bridge,
      src: bridge?.src,
      display: bridge ? getComputedStyle(bridge).display : 'N/A',
    })
  }, 5000)
})

onUnmounted(() => {
  window.removeEventListener('message', handleBridgeMessage)
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('comfynext:loadTabWorkflow', handleLoadTabWorkflow)
  if (queuePollTimer) { clearInterval(queuePollTimer); queuePollTimer = null }
})

const { settingsOpen, openSettings, closeSettings } = useSettingsModal()

function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (creditsModalOpen.value) creditsModalOpen.value = false
    else if (settingsOpen.value) closeSettings()
    else if (userPopupOpen.value) userPopupOpen.value = false
  }

  // Space key: open Vue node search dialog
  if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (activeTab.value.type !== 'project') return
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return
    if ((e.target as HTMLElement)?.isContentEditable) return
    e.preventDefault()
    openNodeSearch()
  }
}

function handleSignOut() {
  sendToBridgeIframe('signOut')
}

function handleOpenBilling() {
  sendToBridgeIframe('openBillingPortal')
  userPopupOpen.value = false
}

function handleBridgeMessage(event: MessageEvent) {
  if (!event.data || event.data.type !== 'comfynext-bridge') return

  // Bridge signals ComfyUI is fully initialized and ready for workflow loads
  if (event.data.status === 'ready') {
    markBridgeReady() // global (worker-0 / single-worker path)
    if (poolEnabled.value) {
      const w = workerIndexOfFrame(event.source as Window)
      if (w != null) markWorkerReady(w)
    }
    return
  }

  // Bridge confirms a workflow finished loading into the canvas
  if (event.data.event === 'workflow_loaded') {
    endWorkflowLoading()
    return
  }

  // Handle credit updates (not tab-specific)
  if (event.data.event === 'credits_update') {
    credits.value = event.data.credits
    return
  }

  // Handle user profile data
  if (event.data.event === 'user_profile') {
    userProfile.value = event.data.profile
    return
  }

  // Handle sign out confirmation
  if (event.data.event === 'signed_out') {
    userProfile.value = null
    credits.value = null
    userPopupOpen.value = false
    return
  }

  // Handle checkout URL from bridge (after purchaseCredits)
  if (event.data.event === 'checkout_url') {
    creditsBuying.value = false
    creditsModalOpen.value = false
    if (event.data.url) {
      window.open(event.data.url, '_blank')
    }
    return
  }

  // Handle purchase error
  if (event.data.event === 'purchase_error') {
    creditsBuying.value = false
    return
  }

  // Queue failed inside the canvas (validation / unknown node / serialization)
  // before anything ran — surface it instead of failing silently. When the
  // bridge forwards ComfyUI's structured node_errors map (prompt validation:
  // type mismatches, missing inputs, bad combo values), show a per-node
  // summary. The offending nodes get their red rings via VueNodeCanvas, which
  // listens to the same bridge postMessage directly (the exact path
  // execution_error events take — no re-dispatch needed).
  if (event.data.event === 'queue_error') {
    clearQueueWatchdog()
    const { description } = summarizeNodeErrors(event.data.node_errors)
    if (description) {
      toast.error('Workflow validation failed', { description })
    } else {
      const msg = event.data.message || 'The canvas could not start this run.'
      toast.error('Couldn’t start run', { description: String(msg).slice(0, 160) })
    }
    // Clear any pending run state so spinners don't hang.
    if (activeTab.value?.type === 'project') updateTabStatus(activeTab.value.id, 'idle')
    currentRunSilent.value = false
    return
  }

  // Bridge acked a successful queue (POST /prompt returned a prompt_id) — the
  // run is on its way, so cancel the no-response watchdog. (Bridges predating
  // this event fall back to the execution_start clear below.)
  if (event.data.event === 'queued') {
    clearQueueWatchdog()
    return
  }

  // Non-fatal bridge diagnostics that the user must act on — e.g. the iframe's
  // LiteGraph node registry is stale after a ComfyUI restart (it dropped a
  // Timeline's edit_state at configure) and only a page reload can fix it.
  if (event.data.event === 'bridge_warning') {
    const msg = String(event.data.message || 'The ComfyUI canvas reported a problem.')
    toast.warning('ComfyUI needs a reload', { description: msg.slice(0, 160) })
    return
  }

  // Space key forwarded from iframe → open Vue node search dialog
  if (event.data.event === 'open_node_search') {
    if (activeTab.value.type === 'project') {
      openNodeSearch()
    }
    return
  }

  // Debug messages from bridge
  if (event.data.event === 'debug') {
    console.log('[ComfyNext Debug]', event.data.msg)
    return
  }

  // Find which tab this iframe belongs to
  const sourceFrame = event.source as Window
  const projectTabs = tabs.value.filter((t) => t.type === 'project')

  let tabId: string | null = null

  // Pool: route by the worker that sent the event → the tab running on it. This
  // lets a background canvas (not the active one) keep updating while another
  // runs. Only when the pool is enabled — single-worker keeps the logic below.
  if (poolEnabled.value) {
    const w = workerIndexOfFrame(sourceFrame)
    if (w != null && workerRunningTab[w]) tabId = workerRunningTab[w]
  }

  // Find matching tab by checking iframes
  if (!tabId) {
    for (const tab of projectTabs) {
      const iframe = document.querySelector(`[data-tab-id="${tab.id}"] iframe`) as HTMLIFrameElement
      if (iframe?.contentWindow === sourceFrame) {
        tabId = tab.id
        break
      }
    }
  }

  // Fallback: use active project tab
  if (!tabId) {
    const activeProject = projectTabs.find((t) => t.id === activeTabId.value)
    if (activeProject) tabId = activeProject.id
  }

  const { event: evt, percent, prompt_id, node_id } = event.data

  // TEMP DEBUG: surface bridge events so we can see why the tab indicator
  // sometimes doesn't update during a Run. Remove once the cause is found.
  if (evt && evt !== 'progress') {
    console.log('[bridge]', evt,
      'tabId=', tabId,
      'pendingLiveRuns=', pendingLiveRuns.value,
      'currentRunSilent=', currentRunSilent.value,
      'prompt_id=', prompt_id,
      'node_id=', node_id)
  }

  if (!tabId) return

  if (evt === 'execution_start') {
    clearQueueWatchdog() // run reached the server — fallback clear for older bridges
    // Claim this run as silent if a live-run is pending — must happen
    // before any UI updates so the tab indicator can skip too.
    if (pendingLiveRuns.value > 0) {
      pendingLiveRuns.value--
      currentRunSilent.value = true
    } else {
      currentRunSilent.value = false
    }
    tabNodeProgress.value = { completed: 0, total: 0 }
    executionStartTime.value = Date.now()
    currentRunProgressPct.value = 0
    if (prompt_id) {
      promptProgress.value[prompt_id] = 0
    }
    // Snapshot the credits balance so we can show "−N credits" on success.
    // Done regardless of silent so the math is right even if the user's
    // first live-run is followed by a real Run.
    runStartCredits = credits.value
    executedNodeIds.clear()
    runOutputs.length = 0
    flushPendingGen() // a previous run still waiting on credits records as-is
    // New run wipes any prior result from the status bar — the user wants
    // to know about THIS run, not the last one.
    if (!currentRunSilent.value) {
      updateTabStatus(tabId, 'running', 0)
      setRunResult(null)
    }
  } else if (evt === 'progress') {
    if (!currentRunSilent.value) updateTabStatus(tabId, 'running', percent)
    if (prompt_id) promptProgress.value[prompt_id] = percent
    if (typeof percent === 'number') currentRunProgressPct.value = percent
  } else if (evt === 'executing' && node_id) {
    // Count total nodes for coarse progress
    tabNodeProgress.value.total++
    // Remember which nodes ran — needed for the Replicate USD cost estimate
    // at execution_complete (BYOK runs don't move Comfy's credit balance).
    executedNodeIds.add(String(node_id))
    // Look up display name from Vue canvas nodes
    const vueNodes = vueCanvasRef.value?.getNodes?.() || []
    const vueNode = vueNodes.find((n: any) => n.id === String(node_id))
    const displayName = vueNode?.data?.title || node_id
    if (prompt_id) {
      promptNodeInfo.value[prompt_id] = { nodeId: node_id, nodeType: displayName }
    }
    currentRunningNode.value = displayName
  } else if (evt === 'executed') {
    if (event.data.output) runOutputs.push(...extractOutputFiles(event.data.output))
    // Track node completion for coarse progress
    tabNodeProgress.value.completed++
    const np = tabNodeProgress.value
    if (np.total > 0) {
      const coarsePct = Math.round((np.completed / np.total) * 100)
      if (!currentRunSilent.value) updateTabStatus(tabId, 'running', coarsePct)
      if (prompt_id) promptProgress.value[prompt_id] = coarsePct
    }
  } else if (evt === 'execution_complete') {
    const durationMs = executionStartTime.value
      ? (Date.now() - executionStartTime.value)
      : 0
    // Detect a silent failure: complete fired but Comfy validation rejected
    // the prompt (no executed nodes, no node ran). Don't show "success" then.
    const validatedRun = tabNodeProgress.value.completed > 0
    tabNodeProgress.value = { completed: 0, total: 0 }
    currentRunningNode.value = ''
    executionStartTime.value = null
    currentRunProgressPct.value = 0
    if (prompt_id) {
      delete promptProgress.value[prompt_id]
      delete promptNodeInfo.value[prompt_id]
    }
    const wasSilent = currentRunSilent.value
    currentRunSilent.value = false
    // Durable generation record — silent/live runs count too (they spend real
    // money). Fire-and-forget; never blocks the UI path.
    const runProjectUuid = projectTabs.find((t) => t.id === tabId)?.projectUuid || null
    const replicateEstimate = validatedRun ? estimateReplicateUsd() : null
    if (runProjectUuid && validatedRun && (runOutputs.length || replicateEstimate)) {
      const runDoc = savedWorkflows[tabId]
      const vueNodes = vueCanvasRef.value?.getNodes?.() || []
      const ranTypes = [...executedNodeIds]
        .map((id) => vueNodes.find((n: any) => n.id === id)?.data?.nodeType)
        .filter(Boolean) as string[]
      pendingGen = {
        projectUuid: runProjectUuid,
        projectName: projectTabs.find((t) => t.id === tabId)?.label,
        record: {
          promptId: prompt_id || `local_${Date.now().toString(36)}`,
          ts: Date.now(),
          canvasId: isProjectDoc(runDoc) ? runDoc.activeCanvasId : null,
          outputs: [...runOutputs],
          usd: replicateEstimate?.usd ?? null,
          usdApproximate: replicateEstimate?.approximate ?? false,
          credits: null,
          nodes: [...new Set(ranTypes)],
        },
        flushed: false,
        timer: null,
      }
      if (replicateEstimate) {
        flushPendingGen()
      } else {
        pendingGen.timer = setTimeout(() => flushPendingGen(), 9000)
      }
    }
    runOutputs.length = 0
    if (!wasSilent) {
      updateTabStatus(tabId, 'done')
      if (validatedRun && lastRunResult.value?.kind !== 'error') {
        // Did any Replicate (BYOK, dollar-billed) node run? If yes, that's
        // the user's true cost surface — Comfy's credit balance won't change.
        // Otherwise, lean on the credit-delta watcher below for the number.
        const replicate = replicateEstimate
        setRunResult({
          kind: 'success',
          durationMs,
          at: Date.now(),
          usd: replicate?.usd ?? null,
          usdApproximate: replicate?.approximate ?? false,
        })
        if (replicate) {
          // Replicate run — don't bother chasing the credit balance.
          runCostDeadline.value = 0
        } else {
          // Comfy-native run — kick off the credit refresh. Pinia's cached
          // balance won't know about the deduction until we refetch. Two-stage
          // refresh covers Firestore propagation latency.
          runCostDeadline.value = Date.now() + 8000
          sendToBridgeIframe('refreshCredits')
          setTimeout(() => sendToBridgeIframe('refreshCredits'), 2500)
        }
      }
      // Reset to idle after a brief moment
      setTimeout(() => {
        updateTabStatus(tabId!, 'idle')
      }, 3000)
    }
    // Refresh history if queue panel is open
    if (queueOpen.value) fetchQueueAndHistory()
  } else if (evt === 'execution_error') {
    if (!currentRunSilent.value) updateTabStatus(tabId, 'idle')
    tabNodeProgress.value = { completed: 0, total: 0 }
    currentRunningNode.value = ''
    executionStartTime.value = null
    currentRunProgressPct.value = 0
    const wasSilent = currentRunSilent.value
    currentRunSilent.value = false
    if (!wasSilent) {
      const nodeName = event.data.node_type || event.data.node_id || 'Unknown node'
      const reason = event.data.exception_message || 'Unknown error'
      setRunResult({ kind: 'error', nodeName, message: reason, at: Date.now() })
      toast.error(`${nodeName} failed`, { description: String(reason).slice(0, 200) })
    }
  }
}

function stopFromStatusBar() {
  stopVueWorkflow()
}
function dismissRunResult() {
  setRunResult(null)
}
</script>

<template>
  <div class="flex h-screen bg-sidebar">
    <!-- Hidden bridge iframe: always mounted so credits/auth work on all pages -->
    <iframe
      id="comfynext-bridge-iframe"
      :src="`${comfyOrigin}/`"
      class="fixed w-[10px] h-[10px] -left-[100px] -top-[100px] opacity-0 pointer-events-none"
      aria-hidden="true"
      tabindex="-1"
    />

    <!-- Parallel-run prototype: one hidden execution iframe per extra worker
         (index >= 1). Worker 0 is the main comfyui-shared canvas iframe below.
         Rendered only when the pool is enabled, so single-worker is untouched. -->
    <iframe
      v-for="i in (comfyWorkers.length - 1)"
      :key="`worker-${i}`"
      :data-worker="i"
      :src="`${comfyWorkers[i]}/`"
      class="fixed w-[10px] h-[10px] -left-[300px] -top-[300px] opacity-0 pointer-events-none"
      aria-hidden="true"
      tabindex="-1"
    />

    <!-- Pre-run cost confirm -->
    <div
      v-if="costConfirm"
      class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
      @click.self="resolveCostConfirm(false)"
    >
      <div class="w-[360px] bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl p-4">
        <div class="text-sm font-semibold text-white mb-1">
          This run costs ~${{ costConfirm.estimate.usd.toFixed(2) }}
        </div>
        <div v-if="costConfirm.iterations > 1" class="text-[11px] text-white/50 mb-2">
          {{ costConfirm.iterations }} runs × ~${{ (costConfirm.estimate.usd / costConfirm.iterations).toFixed(2) }} each
        </div>
        <div class="max-h-[160px] overflow-y-auto mb-3 space-y-1">
          <div
            v-for="item in costConfirm.estimate.breakdown"
            :key="item.id"
            class="flex items-center justify-between gap-3 text-[11px] text-white/60"
          >
            <span class="truncate">{{ item.label }}</span>
            <span class="tabular-nums shrink-0">${{ item.usd.toFixed(2) }}</span>
          </div>
        </div>
        <div class="flex items-center justify-end gap-2">
          <button
            class="px-3 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/10 transition-colors cursor-pointer"
            @click="resolveCostConfirm(false)"
          >Cancel</button>
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-action hover:bg-comfy-blue/80 transition-colors cursor-pointer"
            @click="resolveCostConfirm(true)"
          >Run anyway</button>
        </div>
      </div>
    </div>

    <!-- Credits modal -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="creditsModalOpen"
        class="fixed inset-0 z-[10000] flex items-center justify-center"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="creditsModalOpen = false" />
        <!-- Modal -->
        <div class="relative w-[380px] bg-[#1e1e1e] border border-[#3a3a3a] rounded-[16px] shadow-2xl p-6">
          <!-- Header -->
          <div class="flex items-center justify-between mb-5">
            <h2 class="text-base font-semibold text-white">Add more credits</h2>
            <button class="text-white/40 hover:text-white transition-colors cursor-pointer" @click="creditsModalOpen = false">
              <X class="size-4" />
            </button>
          </div>

          <!-- Preset amounts -->
          <div class="mb-4">
            <label class="text-xs text-white/50 mb-2 block">Select amount</label>
            <div class="grid grid-cols-4 gap-2">
              <button
                v-for="preset in creditsPresets"
                :key="preset"
                class="py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer border"
                :class="creditsAmount === preset
                  ? 'bg-white/10 border-white/30 text-white'
                  : 'bg-[#2a2a2a] border-[#3a3a3a] text-white/70 hover:bg-[#333]'"
                @click="creditsAmount = preset"
              >
                ${{ preset }}
              </button>
            </div>
          </div>

          <!-- Amount + Credits inputs -->
          <div class="grid grid-cols-2 gap-3 mb-5">
            <div>
              <label class="text-xs text-white/50 mb-1.5 block">Amount (USD)</label>
              <div class="flex items-center bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg">
                <button class="px-2.5 py-2 text-white/50 hover:text-white transition-colors cursor-pointer" @click="adjustCreditsAmount(-1)">
                  <Minus class="size-3.5" />
                </button>
                <span class="flex-1 text-center text-sm font-medium text-white">$ {{ creditsAmount }}</span>
                <button class="px-2.5 py-2 text-white/50 hover:text-white transition-colors cursor-pointer" @click="adjustCreditsAmount(1)">
                  <Plus class="size-3.5" />
                </button>
              </div>
            </div>
            <div>
              <label class="text-xs text-white/50 mb-1.5 block">Credits</label>
              <div class="flex items-center bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg px-3 py-2">
                <span class="text-sm font-medium text-white">✦ {{ creditsDisplay }}</span>
              </div>
            </div>
          </div>

          <!-- Continue to payment -->
          <button
            class="w-full py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            :class="creditsBuying
              ? 'bg-blue-500/50 text-white/50 cursor-wait'
              : 'bg-blue-500 hover:bg-blue-600 text-white'"
            :disabled="creditsBuying"
            @click="handleContinueToPayment"
          >
            {{ creditsBuying ? 'Processing...' : 'Continue to payment' }}
          </button>

          <!-- Pricing link -->
          <a
            href="https://www.comfy.org/pricing"
            target="_blank"
            class="flex items-center justify-center gap-1 mt-3 text-xs text-white/40 hover:text-white/60 transition-colors"
          >
            View pricing details
            <ExternalLink class="size-3" />
          </a>
        </div>
      </div>
    </Transition>

    <!-- Settings modal -->
    <SettingsModal />

    <!-- User popup -->
    <UserPopup
      :open="userPopupOpen"
      :user="userProfile"
      :credits="credits"
      @close="userPopupOpen = false"
      @sign-out="handleSignOut"
      @open-settings="openSettings(); userPopupOpen = false"
      @open-billing="handleOpenBilling"
      @open-add-credits="openAddCredits"
    />

    <AppSidebar />
    <div class="flex flex-1 flex-col min-w-0">
      <!-- Tab bar -->
      <div class="flex items-center pt-[19px] bg-[#0a0a0a]">
        <!-- Tabs -->
        <div class="tab-strip flex items-end flex-1 min-w-0 overflow-x-auto">
          <template v-for="(tab, index) in tabs" :key="tab.id">
            <!-- Separator between inactive tabs -->
            <div
              v-if="index > 0 && tab.id !== activeTabId && tabs[index - 1]?.id !== activeTabId"
              class="w-px h-4 bg-white/15 shrink-0 self-center"
            />
            <button
              class="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors shrink-0"
              :class="[
                tab.id === activeTabId
                  ? 'bg-[#121212] rounded-t-[16px] relative -mb-px z-10'
                  : 'bg-transparent hover:bg-white/5',
              ]"
              :style="tab.id === activeTabId
                ? 'border: 1px solid rgba(255,255,255,0.06); border-bottom: none;'
                : 'border: none; border-radius: 0;'"
              @click="setActiveTab(tab.id)"
            >
            <!-- Tab icon / status -->
            <div class="flex items-center gap-2">
              <!-- Home tab: house icon -->
              <House v-if="tab.type === 'home'" class="size-4" :class="tab.id === activeTabId ? 'text-white' : 'text-white/50'" />
              <Globe v-else-if="tab.type === 'community'" class="size-4" :class="tab.id === activeTabId ? 'text-white' : 'text-white/50'" />
              <Image v-else-if="tab.type === 'assets'" class="size-4" :class="tab.id === activeTabId ? 'text-white' : 'text-white/50'" />
              <AppWindow v-else-if="tab.type === 'app'" class="size-4" :class="tab.id === activeTabId ? 'text-white' : 'text-white/50'" />
              <Wand v-else-if="tab.type === 'train'" class="size-4" :class="tab.id === activeTabId ? 'text-white' : 'text-white/50'" />
              <LayoutGrid v-else-if="tab.type === 'all-projects'" class="size-4" :class="tab.id === activeTabId ? 'text-white' : 'text-white/50'" />
              <!-- Project tab: status indicator -->
              <template v-else>
                <!-- Idle: green dot -->
                <span
                  v-if="tab.status === 'idle' || !tab.status"
                  class="size-2.5 rounded-full bg-white"
                />
                <!-- Running: circular progress spinner -->
                <svg
                  v-else-if="tab.status === 'running'"
                  class="size-4"
                  viewBox="0 0 16 16"
                >
                  <circle
                    cx="8" cy="8" r="6"
                    fill="none"
                    stroke="#3f3f46"
                    stroke-width="2"
                  />
                  <circle
                    cx="8" cy="8" r="6"
                    fill="none"
                    stroke="#818cf8"
                    stroke-width="2"
                    stroke-linecap="round"
                    :stroke-dasharray="`${(tab.progress ?? 0) * 0.377} 37.7`"
                    transform="rotate(-90 8 8)"
                  />
                </svg>
                <!-- Done: green check -->
                <div
                  v-else-if="tab.status === 'done'"
                  class="size-4 rounded-full bg-[#4ade80] flex items-center justify-center"
                >
                  <Check class="size-2.5 text-black" :stroke-width="3" />
                </div>
              </template>
              <!-- Inline rename input -->
              <input
                v-if="editingTabId === tab.id"
                v-model="editingLabel"
                data-tab-rename-input
                class="text-xs font-medium text-white bg-white/10 rounded px-1 py-0.5 outline-none border border-white/20 w-[120px]"
                @blur="finishRenaming"
                @keydown.enter="finishRenaming"
                @keydown.escape="cancelRenaming"
                @click.stop
              />
              <!-- Normal label (double-click to rename) -->
              <span
                v-else
                class="text-xs font-medium text-white whitespace-nowrap max-w-[160px] truncate"
                :class="{ 'opacity-50': tab.id !== activeTabId }"
                @dblclick.stop="startRenaming(tab.id, tab.label)"
              >
                {{ tab.label }}
              </span>
              <!-- Status text: "Idle" or "76%" -->
              <template v-if="tab.type === 'project'">
                <span
                  v-if="tab.status === 'running'"
                  class="text-xs font-medium text-white/60"
                >
                  {{ tab.progress ?? 0 }}%
                </span>
                <span
                  v-else-if="tab.status === 'idle' || !tab.status"
                  class="text-xs font-medium text-white/40"
                >
                  Idle
                </span>
              </template>
            </div>
            <!-- Close button -->
            <X
              v-if="tab.closable"
              class="size-3.5 text-white/40 hover:text-white transition-opacity shrink-0"
              @click.stop="() => { delete savedWorkflows[tab.id]; persistWorkflows(); closeTab(tab.id) }"
            />
          </button>
          </template>

          <!-- Add tab button -->
          <button
            class="flex items-center justify-center size-8 mx-2 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            @click="openTab({ type: 'project' })"
          >
            <Plus class="size-4" />
          </button>
        </div>

        <!-- Right side: credits + run + running count -->
        <div class="flex items-center gap-2 pr-4 shrink-0">
          <button
            class="flex items-center gap-1.5 bg-[#1a1a1a] rounded-full px-3 py-1.5 border border-[#2a2a2a] cursor-pointer hover:bg-[#222] transition-colors"
            @click="openAddCredits"
          >
            <span class="text-xs font-medium text-white/70">{{ credits !== null ? `${credits.toLocaleString()} credits` : '— credits' }}</span>
          </button>
          <button
            class="flex items-center gap-1.5 bg-[#1a1a1a] rounded-full px-3 py-1.5 border border-[#2a2a2a] cursor-pointer hover:bg-[#222] transition-colors"
            @click="toggleQueue"
          >
            <Play class="size-3 text-white/70" />
            <span class="text-xs font-medium text-white/70">{{ runningCount }} running</span>
          </button>
        </div>
      </div>

      <!-- Main content -->
      <main class="flex-1 overflow-auto bg-[#121212] border-t border-l border-[rgba(255,255,255,0.06)] relative">
        <div v-show="activeTab.type === 'home'" class="h-full">
          <slot />
        </div>
        <!-- Assets history tab -->
        <div
          v-for="tab in tabs.filter((t) => t.type === 'assets')"
          :key="tab.id"
          v-show="tab.id === activeTabId"
          class="h-full"
        >
          <AssetsHistory />
        </div>
        <!-- Community (ComfyHub) tab -->
        <div
          v-for="tab in tabs.filter((t) => t.type === 'community')"
          :key="tab.id"
          v-show="tab.id === activeTabId"
          class="h-full overflow-auto"
        >
          <CommunityHome />
        </div>
        <!-- App tabs (single-purpose pages built on top of the same node engine) -->
        <div
          v-for="tab in tabs.filter((t) => t.type === 'app')"
          :key="tab.id"
          v-show="tab.id === activeTabId"
          class="h-full"
        >
          <AppsFaceSwapApp v-if="tab.appId === 'face-swap'" />
          <AppsAutoSubtitleApp v-else-if="tab.appId === 'auto-subtitle'" />
          <AppsKaraokeMakerApp v-else-if="tab.appId === 'karaoke-maker'" />
          <AppsProductShotApp v-else-if="tab.appId === 'product-shot'" />
        </div>
        <!-- Train LoRA tab -->
        <div
          v-for="tab in tabs.filter((t) => t.type === 'train')"
          :key="tab.id"
          v-show="tab.id === activeTabId"
          class="h-full"
        >
          <LoraTrainerSurface />
        </div>
        <!-- All projects tab (full grid of every project) -->
        <div
          v-for="tab in tabs.filter((t) => t.type === 'all-projects')"
          :key="tab.id"
          v-show="tab.id === activeTabId"
          class="h-full overflow-auto"
        >
          <AllProjectsView />
        </div>
        <!-- Vue Node Canvas (when Modern node design enabled) -->
        <div
          v-if="vueNodesEnabled && tabs.some((t) => t.type === 'project')"
          v-show="activeTab.type === 'project'"
          class="absolute inset-0 z-20"
        >
          <!-- Canvas area (always full-width) -->
          <div class="absolute inset-0">
            <VueCanvasVueNodeCanvas
              ref="vueCanvasRef"
              :workflow="activeTabWorkflow"
              :active-tool="activeTool"
              :active-worker="activeWorker"
              :displayed-canvas-id="activeProjectDoc?.activeCanvasId ?? null"
              :running-canvas-id="runningCanvasByWorker[activeWorker] ?? null"
            />
            <ExplainOverlay :vue-canvas="vueCanvasRef" />
          </div>
          <!-- Native Nodes sidebar (overlays canvas from left) -->
          <Transition
            enter-active-class="transition-transform duration-300 ease-out"
            enter-from-class="-translate-x-full"
            enter-to-class="translate-x-0"
            leave-active-class="transition-transform duration-300 ease-in"
            leave-from-class="translate-x-0"
            leave-to-class="-translate-x-full"
          >
            <div v-if="vueNodesSidebarOpen" class="absolute top-0 left-0 bottom-0 w-[320px] z-30">
              <VueCanvasNodesSidebar @close="vueNodesSidebarOpen = false; activeSidebarItem = null" />
            </div>
          </Transition>
        </div>
        <!-- Workflow Overview right panel (overlays canvas) -->
        <Transition
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-300 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="translate-x-full"
        >
          <div v-if="vueRightPanelOpen" class="absolute top-0 right-0 bottom-0 w-[350px] z-30">
            <VueCanvasWorkflowOverview
              :nodes="vueCanvasRef?.getNodes?.() || []"
              @close="vueRightPanelOpen = false"
            />
          </div>
        </Transition>
        <!-- Toolbox left panel (overlays canvas) -->
        <Transition
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-300 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div v-if="toolboxPanelOpen" class="absolute top-0 left-0 bottom-0 w-[350px] z-40">
            <VueCanvasToolboxPanel @close="toolboxPanelOpen = false" />
          </div>
        </Transition>

        <!-- Generators left panel (mutually exclusive with Toolbox) -->
        <Transition
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-300 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div v-if="generatorsPanelOpen" class="absolute top-0 left-0 bottom-0 w-[350px] z-40">
            <VueCanvasGeneratorsPanel @close="generatorsPanelOpen = false" />
          </div>
        </Transition>

        <!-- LoRA Library left panel (mutually exclusive with Toolbox/Generators) -->
        <Transition
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-300 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div v-if="loraLibraryPanelOpen" class="absolute top-0 left-0 bottom-0 w-[350px] z-40">
            <VueCanvasLoRALibraryPanel @close="loraLibraryPanelOpen = false" />
          </div>
        </Transition>

        <!-- Character Library left panel (mutually exclusive with the others) -->
        <Transition
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-300 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div v-if="charactersPanelOpen" class="absolute top-0 left-0 bottom-0 w-[350px] z-40">
            <VueCanvasCharacterLibraryPanel @close="charactersPanelOpen = false" />
          </div>
        </Transition>

        <!-- Block Library left panel (mutually exclusive with the others) -->
        <Transition
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-300 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div v-if="blockLibraryPanelOpen" class="absolute top-0 left-0 bottom-0 w-[350px] z-40">
            <VueCanvasBlockLibraryPanel @close="blockLibraryPanelOpen = false" />
          </div>
        </Transition>

        <!-- Assets left panel (mutually exclusive with the others) -->
        <Transition
          enter-active-class="transition-transform duration-300 ease-out"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition-transform duration-300 ease-in"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div v-if="assetsPanelOpen" class="absolute top-0 left-0 bottom-0 w-[350px] z-40">
            <VueCanvasAssetsPanel @close="assetsPanelOpen = false" />
          </div>
        </Transition>

        <!-- Project menu: floating chip at top-left — project name, canvas
             switcher, and version snapshots (replaces the Versions panel). -->
        <VueCanvasProjectMenu
          v-if="activeTab.type === 'project'"
          :project-id="activeTab.projectUuid || activeTab.workflowId || null"
          :project-name="activeTab.label || 'Untitled project'"
          :doc="activeProjectDoc"
          :switching="canvasSwitching"
          :get-project-doc="getProjectDocForVersionSave"
          :brand-kit-id="activeProjectDoc?.brandKitId ?? null"
          :brand-kit-name="brandKitName"
          :brand-swatches="brandSwatches"
          @set-brand-kit="setBrandKit"
          @rename-project="renameActiveProject"
          @switch-canvas="switchProjectCanvas"
          @add-canvas="addProjectCanvas"
          @rename-canvas="renameProjectCanvas"
          @delete-canvas="deleteProjectCanvas"
          @restore="onRestoreVersion"
        />

        <!-- Slate gallery: pick a Kinetic Slate template, fill its slots, and
             drop a pre-animated Frame (Compositor) node onto the canvas. -->
        <VueCanvasSlateGalleryModal
          v-if="slateGalleryOpen"
          :active-kit="brandLib.activeKit.value ?? null"
          @close="slateGalleryOpen = false"
          @create="onCreateSlate"
        />

        <!-- Vue canvas top-right toolbar (Run / Stop / Panel) -->
        <div
          v-if="vueNodesEnabled && activeTab.type === 'project'"
          class="absolute top-3 right-3 flex items-center gap-1.5 z-40"
        >
          <button
            class="flex items-center gap-1.5 bg-action hover:bg-comfy-blue/80 rounded-lg px-4 py-2 cursor-pointer transition-colors shadow-lg"
            @click="() => runVueWorkflow()"
          >
            <Play class="size-3.5 text-white fill-white" />
            <span class="text-sm font-semibold text-white">Run</span>
            <span v-if="runEstimate" class="text-[11px] font-medium text-white/75 tabular-nums">
              ~${{ runEstimate.usd.toFixed(2) }}
            </span>
          </button>
          <button
            class="flex items-center justify-center size-9 bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg border border-[#2a2a2a] cursor-pointer hover:bg-[#2a2a2a] transition-colors shadow-lg"
            title="Stop"
            @click="stopVueWorkflow"
          >
            <Square class="size-3.5 text-comfy-coral fill-comfy-coral" />
          </button>
          <div class="w-px h-5 bg-white/10" />
          <button
            class="flex items-center justify-center size-9 bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg border border-[#2a2a2a] cursor-pointer hover:bg-[#2a2a2a] transition-colors shadow-lg"
            :class="{ '!bg-[#2a2a2a] border-white/20': vueRightPanelOpen }"
            title="Toggle workflow overview"
            @click="vueRightPanelOpen = !vueRightPanelOpen"
          >
            <PanelRight class="size-4 text-white/70" />
          </button>
        </div>

        <!-- Toast notifications (anchored below Run bar) -->
        <Sonner />

        <!-- LiteGraph iframe (always loaded for execution; sidebar panels reused in Vue mode) -->
        <div
          v-if="tabs.some((t) => t.type === 'project')"
          v-show="(!vueNodesEnabled && activeTab.type === 'project') || (vueNodesEnabled && vueSidebarOpen)"
          data-tab-id="comfyui-shared"
          class="absolute inset-0 overflow-hidden z-30"
          :style="vueNodesEnabled && vueSidebarOpen ? { width: '320px', right: 'auto' } : {}"
        >
          <iframe
            :src="comfyIframeSrc"
            class="border-0 absolute"
            @load="onSharedIframeLoad"
            :style="{
              left: `-${COMFY_SIDEBAR_W}px`,
              top: `-${COMFY_TABBAR_H}px`,
              width: `calc(100% + ${COMFY_SIDEBAR_W}px)`,
              height: `calc(100% + ${COMFY_TABBAR_H}px)`,
            }"
          />
          <!-- Explain drag overlay -->
          <ExplainOverlay />
          <!-- Loading cover -->
          <Transition
            leave-active-class="transition-opacity duration-500 ease-out"
            leave-to-class="opacity-0"
          >
            <div
              v-if="!iframeReady || workflowLoading"
              class="absolute inset-0 z-30 bg-[#121212] flex flex-col items-center justify-center gap-3"
            >
              <div class="size-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
              <span class="text-xs text-white/30">
                {{ !iframeReady ? 'Starting ComfyUI…' : 'Loading workflow…' }}
              </span>
            </div>
          </Transition>
        </div>

        <!-- Backdrop closes the Load popup on outside click. Sits below the
             toolbar (z-40) but above the canvas, so clicks pass through to
             the close handler instead of the canvas behind. -->
        <div
          v-if="loadMenuOpen && activeTab.type === 'project'"
          class="absolute inset-0 z-30"
          @click="loadMenuOpen = false"
        />
        <!-- Same backdrop pattern for the Annotate popup. -->
        <div
          v-if="annotateMenuOpen && activeTab.type === 'project'"
          class="absolute inset-0 z-30"
          @click="annotateMenuOpen = false"
        />
        <!-- Workflow status bar: replaces the start/complete/error toasts
             with one persistent surface for "what's the workflow doing."
             Skipped for silent live-runs (slider previews) so the bar
             doesn't flicker on every drag tick. -->
        <CanvasStatusBar
          v-if="activeTab.type === 'project'"
          :running="executionStartTime !== null && !currentRunSilent"
          :current-node="currentRunningNode"
          :progress="tabNodeProgress"
          :percent="currentRunProgressPct"
          :started-at="executionStartTime"
          :last-result="lastRunResult"
          @stop="stopFromStatusBar"
          @dismiss-result="dismissRunResult"
        />

        <!-- Floating toolbar overlay (only visible on project tabs) -->
        <div
          v-if="activeTab.type === 'project'"
          class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#1a1a1a]/90 backdrop-blur-sm rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg z-40"
        >
          <template v-for="(item) in sidebarItems" :key="item.label">
            <div
              v-if="item.dividerBefore"
              class="w-px h-8 bg-white/10 mx-0.5"
            />
            <div class="relative">
              <button
                class="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-[8px] cursor-pointer transition-colors group"
                :class="isSidebarItemActive(item) ? 'bg-white/10' : 'hover:bg-white/5'"
                @click="toggleSidebarItem(item.label)"
              >
                <component :is="item.icon" class="size-5 text-white/70 group-hover:text-white transition-colors" :class="{ 'text-white': isSidebarItemActive(item) }" />
                <span class="text-[10px] text-white/50 group-hover:text-white/70 transition-colors" :class="{ 'text-white/80': isSidebarItemActive(item) }">
                  {{ item.label }}
                </span>
              </button>
              <!-- Popup anchored above the Load… button. Drops the matching
                   unified artifact node onto the canvas. -->
              <div
                v-if="item.submenu === 'load' && loadMenuOpen"
                class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col gap-0.5 min-w-[160px] bg-[#1a1a1a]/95 backdrop-blur-sm border border-[#2a2a2a] rounded-[12px] p-1.5 shadow-xl whitespace-nowrap"
                @click.stop
              >
                <template v-for="opt in loadOptions" :key="opt.label">
                  <button
                    class="flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-left transition-colors"
                    :class="opt.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/[0.08] cursor-pointer'"
                    :disabled="opt.disabled"
                    @click="!opt.disabled && onLoadOption(opt)"
                  >
                    <component :is="opt.icon" class="size-4 text-white/70" :stroke-width="1.75" />
                    <span class="text-xs text-white/85 flex-1">{{ opt.label }}</span>
                    <span v-if="opt.hint" class="text-[9px] uppercase tracking-wider text-white/35">{{ opt.hint }}</span>
                  </button>
                  <div v-if="opt.dividerAfter" class="h-px bg-white/10 mx-1 my-1" />
                </template>
              </div>
              <!-- Popup anchored above the Annotate button. Each entry fires
                   a window-level event the canvas listens for. -->
              <div
                v-if="item.submenu === 'annotate' && annotateMenuOpen"
                class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col gap-0.5 min-w-[180px] bg-[#1a1a1a]/95 backdrop-blur-sm border border-[#2a2a2a] rounded-[12px] p-1.5 shadow-xl whitespace-nowrap"
                @click.stop
              >
                <button
                  v-for="opt in annotateOptions"
                  :key="opt.label"
                  class="flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-left transition-colors hover:bg-white/[0.08] cursor-pointer"
                  @click="addAnnotation(opt.kind)"
                >
                  <component :is="opt.icon" class="size-4 text-white/70" :stroke-width="1.75" />
                  <span class="text-xs text-white/85 flex-1">{{ opt.label }}</span>
                  <span v-if="opt.hint" class="text-[9px] uppercase tracking-wider text-white/40 bg-white/10 px-1.5 py-0.5 rounded">{{ opt.hint }}</span>
                </button>
              </div>
            </div>
          </template>
        </div>
        <!-- Floating zoom/map toolbar (bottom-right, only on project tabs) -->
        <div
          v-if="activeTab.type === 'project'"
          class="absolute bottom-3 right-3 flex items-center gap-1 bg-[#1a1a1a]/90 backdrop-blur-sm rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg z-50"
        >
          <button
            class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer transition-colors group hover:bg-white/5"
            @click="zoomOut"
          >
            <ZoomOut class="size-4 text-white/70 group-hover:text-white transition-colors" />
          </button>
          <button
            class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer transition-colors group hover:bg-white/5"
            @click="zoomReset"
          >
            <Maximize2 class="size-4 text-white/70 group-hover:text-white transition-colors" />
          </button>
          <button
            class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer transition-colors group hover:bg-white/5"
            @click="zoomIn"
          >
            <ZoomIn class="size-4 text-white/70 group-hover:text-white transition-colors" />
          </button>
          <div class="w-px h-5 bg-white/10 mx-0.5" />
          <button
            class="flex items-center justify-center size-8 rounded-[8px] cursor-pointer transition-colors group"
            :class="minimapActive ? 'bg-white/10' : 'hover:bg-white/5'"
            @click="toggleMinimap"
          >
            <Map class="size-4 text-white/70 group-hover:text-white transition-colors" :class="{ 'text-white': minimapActive }" />
          </button>
        </div>
        <!-- Queue panel overlay -->
        <Transition
          enter-active-class="transition-all duration-200 ease-out"
          leave-active-class="transition-all duration-150 ease-in"
          enter-from-class="opacity-0 translate-y-2"
          leave-to-class="opacity-0 translate-y-2"
        >
          <div
            v-if="queueOpen"
            class="fixed right-4 top-14 w-[380px] max-h-[70vh] bg-[#1a1a1a] border border-[#2a2a2a] rounded-[12px] shadow-2xl z-[9999] flex flex-col overflow-hidden"
          >
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
              <span class="text-sm font-medium text-white">Queue</span>
              <button
                class="text-white/40 hover:text-white transition-colors cursor-pointer"
                @click="queueOpen = false"
              >
                <X class="size-4" />
              </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto">
              <!-- Running -->
              <div v-if="queueData.running.length" class="px-4 pt-3 pb-1">
                <div
                  v-for="(item, i) in queueData.running"
                  :key="`r-${i}`"
                  class="bg-[#252525] rounded-lg p-3 mb-2"
                >
                  <div class="flex items-center gap-2 mb-1">
                    <div class="size-2 rounded-full bg-[#818cf8] animate-pulse shrink-0" />
                    <span class="text-xs font-medium text-white/90 truncate">{{ runningWorkflowName(item[1]) }}</span>
                    <span class="text-xs text-white/40 ml-auto shrink-0">{{ queueItemProgress(item[1]) }}%</span>
                  </div>
                  <div v-if="promptNodeInfo[item[1]]?.nodeType || currentRunningNode" class="text-[11px] text-white/40 mb-2 ml-4 truncate">
                    {{ promptNodeInfo[item[1]]?.nodeType || currentRunningNode }}
                  </div>
                  <!-- Progress bar -->
                  <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      v-if="queueItemProgress(item[1]) > 0"
                      class="h-full bg-[#818cf8] rounded-full transition-all duration-300"
                      :style="{ width: `${queueItemProgress(item[1])}%` }"
                    />
                    <div
                      v-else
                      class="h-full w-full rounded-full animate-queue-shimmer"
                      style="background: linear-gradient(90deg, transparent 0%, #818cf8 50%, transparent 100%); background-size: 200% 100%;"
                    />
                  </div>
                </div>
              </div>

              <!-- Pending -->
              <div v-if="queueData.pending.length" class="px-4 pt-2 pb-1">
                <div
                  v-for="(item, i) in queueData.pending"
                  :key="`p-${i}`"
                  class="flex items-center gap-2 py-2 px-3 bg-[#252525] rounded-lg mb-2"
                >
                  <div class="size-2 rounded-full bg-white/20 shrink-0" />
                  <span class="text-xs text-white/50 truncate">Pending</span>
                </div>
              </div>

              <!-- Divider between queue and history -->
              <div v-if="(queueData.running.length || queueData.pending.length) && groupedHistory.length" class="border-t border-[#2a2a2a] mx-4" />

              <!-- History -->
              <div v-if="groupedHistory.length" class="px-4 pt-2 pb-3">
                <div v-for="group in groupedHistory" :key="group.label" class="mb-3 last:mb-0">
                  <div class="text-[11px] font-medium text-white/30 uppercase tracking-wider mb-2">{{ group.label }}</div>
                  <div
                    v-for="item in group.items"
                    :key="item.promptId"
                    class="flex items-center gap-3 py-2 rounded-lg"
                  >
                    <!-- Thumbnail or status icon -->
                    <div v-if="item.status === 'failed'" class="size-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                      <AlertCircle class="size-4 text-red-400" />
                    </div>
                    <img
                      v-else-if="item.images.length"
                      :src="thumbnailUrl(item.images[0])"
                      class="size-10 rounded-lg object-cover bg-[#252525] shrink-0"
                      loading="lazy"
                    />
                    <div v-else class="size-10 rounded-lg bg-[#252525] shrink-0" />

                    <!-- Info -->
                    <div class="flex-1 min-w-0">
                      <div v-if="item.status === 'failed'" class="text-xs font-medium text-red-400">Failed</div>
                      <div v-else-if="item.images.length" class="text-xs text-white/80 truncate">{{ item.images[0].filename }}</div>
                      <div v-else class="text-xs text-white/50 truncate">No output</div>
                      <div class="text-[11px] text-white/30 mt-0.5">
                        <template v-if="item.status === 'failed'">Failed</template>
                        <template v-else-if="item.executionTime !== null">{{ formatDuration(item.executionTime) }}</template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Empty state -->
              <div
                v-if="!queueData.running.length && !queueData.pending.length && !groupedHistory.length"
                class="flex flex-col items-center justify-center py-8 text-center"
              >
                <Play class="size-8 text-white/20 mb-2" />
                <span class="text-sm text-white/40">No items in queue</span>
                <span class="text-xs text-white/25 mt-1">Run a workflow to see it here</span>
              </div>
            </div>
          </div>
        </Transition>

        <!-- Explain panel -->
        <ExplainPanel />
      </main>
    </div>

    <!-- Node search dialog (Space key) -->
    <NodeSearchDialog />

    <!-- "Get Started" modal: shows once per fresh blank project. Pre-builds
         a runnable graph from the user's intent (output × input × model). -->
    <StartProjectModal
      v-if="startModalTabId && activeTabId === startModalTabId"
      @start="onStartModalPick"
      @skip="onStartModalSkip"
    />
  </div>
</template>

<style scoped>
/* Tab strip scrolls horizontally when tabs overflow, instead of spilling over
   the credits/run controls. Hide the scrollbar to keep the bar clean. */
.tab-strip {
  scrollbar-width: none;
}
.tab-strip::-webkit-scrollbar {
  display: none;
}
</style>
