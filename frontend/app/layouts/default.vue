<script setup lang="ts">
import {
  House, X, Plus, Play, Check, Minus, ExternalLink, AlertCircle,
  MousePointer2, Hand, LayoutGrid, GitFork, Image, Workflow, AppWindow, LayoutTemplate, Sparkles, Toolbox, WandSparkles, Boxes,
  ZoomIn, ZoomOut, Maximize2, Map, Globe, Square, PanelRight, Wand, Library,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Sonner } from '~/components/ui/sonner'
import AssetsHistory from '~/components/AssetsHistory.vue'
import CommunityHome from '~/components/community/CommunityHome.vue'
import LoraTrainerSurface from '~/components/LoraTrainerSurface.vue'

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

const sidebarItems = [
  { label: 'Select', icon: MousePointer2, tool: 'select' },
  { label: 'Hand', icon: Hand, tool: 'hand' },
  { label: 'Assets', icon: LayoutGrid, tabId: 'assets' },
  { label: 'Toolbox', icon: Toolbox, panel: 'toolbox' },
  { label: 'Generators', icon: WandSparkles, panel: 'generators' },
  { label: 'LoRAs', icon: Library, panel: 'loras' },
  { label: 'Nodes', icon: GitFork, tabId: 'node-library' },
  { label: 'Blocks', icon: Boxes, panel: 'blocks' },
  { label: 'Apps', icon: AppWindow, tabId: 'apps' },
  { label: 'Templates', icon: LayoutTemplate },
  { label: 'Explain', icon: Sparkles, tool: 'explain' },
]

const activeTool = ref<string>('select')

const activeSidebarItem = ref<string | null>(null)
const vueSidebarOpen = ref(false) // tracks whether ComfyUI left sidebar panel is visible in Vue mode
const vueNodesSidebarOpen = ref(false) // tracks whether the native Nodes sidebar is open in Vue mode
const vueRightPanelOpen = ref(false) // tracks whether Vue right panel (Workflow Overview) is visible
const toolboxPanelOpen = ref(false) // tracks whether the Toolbox right panel is visible
const generatorsPanelOpen = ref(false) // tracks whether the Generators panel is visible
const loraLibraryPanelOpen = ref(false) // tracks whether the LoRA Library panel is visible
const blockLibraryPanelOpen = ref(false) // tracks whether the Block Library panel is visible

// Whether a sidebar item is currently the "active" one (highlighted).
// Single source of truth for the chevron/button highlight logic — used by
// the template instead of nested ternaries that got unreadable as we added
// more panel types.
function isSidebarItemActive(item: any): boolean {
  if (item?.tool) return activeTool.value === item.tool
  if (item?.panel === 'toolbox') return toolboxPanelOpen.value
  if (item?.panel === 'generators') return generatorsPanelOpen.value
  if (item?.panel === 'loras') return loraLibraryPanelOpen.value
  if (item?.panel === 'blocks') return blockLibraryPanelOpen.value
  return activeSidebarItem.value === item?.label
}

function toggleSidebarItem(label: string) {
  const item = sidebarItems.find((i) => i.label === label)
  if (item?.action === 'openAssets') {
    openTab({ type: 'assets', label: 'Assets' })
    return
  }
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
  else if (item?.panel === 'toolbox') {
    const wasOpen = toolboxPanelOpen.value
    generatorsPanelOpen.value = false
    loraLibraryPanelOpen.value = false
    toolboxPanelOpen.value = !wasOpen
  }
  else if (item?.panel === 'generators') {
    const wasOpen = generatorsPanelOpen.value
    toolboxPanelOpen.value = false
    loraLibraryPanelOpen.value = false
    generatorsPanelOpen.value = !wasOpen
  }
  else if (item?.panel === 'loras') {
    const wasOpen = loraLibraryPanelOpen.value
    toolboxPanelOpen.value = false
    generatorsPanelOpen.value = false
    blockLibraryPanelOpen.value = false
    loraLibraryPanelOpen.value = !wasOpen
  }
  else if (item?.panel === 'blocks') {
    const wasOpen = blockLibraryPanelOpen.value
    toolboxPanelOpen.value = false
    generatorsPanelOpen.value = false
    loraLibraryPanelOpen.value = false
    blockLibraryPanelOpen.value = !wasOpen
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
async function runVueWorkflow(targetIds?: string[]) {
  if (!vueCanvasRef.value?.getWorkflow) {
    console.warn('[Run] no getWorkflow on vueCanvasRef')
    return
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
    ? vueCanvasRef.value.getFilteredWorkflow(targetIds)
    : vueCanvasRef.value.getWorkflow()
  if (!workflow?.nodes?.length) {
    console.warn('[Run] workflow has no nodes')
    return
  }

  // Deep-copy to strip Vue reactivity proxies (postMessage can't clone Proxy objects)
  const plainWorkflow = JSON.parse(JSON.stringify(workflow))

  // Stamp the tab's stable project UUID so history entries can be grouped
  if (activeTab.value.projectUuid) {
    plainWorkflow.extra = { ...(plainWorkflow.extra || {}), projectUuid: activeTab.value.projectUuid }
  }

  // Load workflow into the bridge iframe's LiteGraph, then queue
  const iframe = getSharedIframe()
  if (!iframe?.contentWindow) {
    console.error('[Run] bridge iframe not found or not ready')
    return
  }
  const activeCount = (plainWorkflow.nodes as any[]).filter((n: any) => (n.mode ?? 0) !== 2).length
  console.log('[Run] sending workflow with', plainWorkflow.nodes.length, 'nodes to bridge',
    targetIds?.length ? `(filtered: ${activeCount} active, ${targetIds.length} targets)` : '')
  sendLoadWorkflow(plainWorkflow)
  await new Promise(r => setTimeout(r, 800))
  console.log('[Run] sending queuePrompt')
  sendToActiveProjectIframe('queuePrompt')
}

// Filtered-run events from the canvas context menu (Run Group, Run Selection).
// Also fired by per-node Run buttons on individual nodes. Before queueing,
// we ask the canvas to materialize an `Image` artifact card for every
// dangling IMAGE output among the targets — that's where the execution
// result lands. No-op for targets whose outputs are already wired.
function handleRunFiltered(e: Event) {
  const detail = (e as CustomEvent).detail
  const targetIds = detail?.targetIds as string[] | undefined
  if (!targetIds?.length) return
  const expanded = vueCanvasRef.value?.materializeAutoImageSinks?.(targetIds) ?? targetIds
  runVueWorkflow(expanded)
}
function handleRunAll() {
  // Auto-sink materialization lives inside runVueWorkflow now (so the
  // top-right Run button, which calls it directly, also benefits).
  runVueWorkflow()
}
onMounted(() => {
  window.addEventListener('comfynext:runFiltered', handleRunFiltered)
  window.addEventListener('comfynext:runAll', handleRunAll)
})
onBeforeUnmount(() => {
  window.removeEventListener('comfynext:runFiltered', handleRunFiltered)
  window.removeEventListener('comfynext:runAll', handleRunAll)
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
const BLANK_WORKFLOW = { last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 }
const WORKFLOWS_STORAGE_KEY = 'comfynext:workflows'

// Restore persisted workflows from sessionStorage
function loadPersistedWorkflows(): Record<string, any> {
  if (import.meta.server) return {}
  try {
    const saved = sessionStorage.getItem(WORKFLOWS_STORAGE_KEY)
    return saved ? JSON.parse(saved) : {}
  }
  catch { return {} }
}

const savedWorkflows = reactive<Record<string, any>>(loadPersistedWorkflows()) // tabId → workflow JSON

function persistWorkflows() {
  if (import.meta.server) return
  try {
    sessionStorage.setItem(WORKFLOWS_STORAGE_KEY, JSON.stringify(savedWorkflows))
  }
  catch {}
}

// Autosave: snapshot current canvas and persist to sessionStorage.
// Only called on specific events (beforeunload, tab switch) — never on a timer.
function autosaveCurrentWorkflow() {
  const tab = activeTab.value
  if (tab?.type !== 'project') return
  if (vueNodesEnabled.value && vueCanvasRef.value?.getWorkflow) {
    const workflow = vueCanvasRef.value.getWorkflow()
    if (workflow && workflow.nodes?.length > 0) {
      const raw = toRaw(savedWorkflows)
      raw[tab.id] = workflow
      try { sessionStorage.setItem(WORKFLOWS_STORAGE_KEY, JSON.stringify(raw)) }
      catch {}
    }
  }
}

// Prompts queued by live-run should not surface "started" / "completed" toasts.
// The bridge synthesizes execution_complete without a prompt_id, so we can't
// match by id. ComfyUI executes one prompt at a time, so we track a single
// flag set at execution_start and consumed at execution_complete/error.
const pendingLiveRuns = ref(0)
let currentRunSilent = false
let pendingLiveRunsResetTimer: ReturnType<typeof setTimeout> | null = null

function handleLiveRun() {
  pendingLiveRuns.value++
  // Safety: drop the counter if no execution_start arrives (e.g. queue rejected the prompt).
  if (pendingLiveRunsResetTimer) clearTimeout(pendingLiveRunsResetTimer)
  pendingLiveRunsResetTimer = setTimeout(() => { pendingLiveRuns.value = 0 }, 10000)
  runVueWorkflow()
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
const vueCanvasRef = ref<any>(null)
let currentProjectTabId: string | null = null // tracks which project tab's workflow is loaded

function getSharedIframe(): HTMLIFrameElement | null {
  return document.querySelector('[data-tab-id="comfyui-shared"] iframe') as HTMLIFrameElement | null
}

function sendLoadWorkflow(workflow: any) {
  const iframe = getSharedIframe()
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'comfynext', action: 'loadWorkflow', workflow }, '*')
  }
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
    // Vue mode: store workflow directly (no iframe needed)
    if (!saved) {
      if (tab.promptId) {
        const workflow = await fetchWorkflowFromHistory(tab.promptId)
        savedWorkflows[tab.id] = workflow || BLANK_WORKFLOW
      }
      else if (tab.workflowId) {
        // Try to load from recent workflows API
        try {
          const res = await fetch(`/api/workflows/${tab.workflowId}`)
          const data = await res.json()
          savedWorkflows[tab.id] = data?.workflow || BLANK_WORKFLOW
        }
        catch { savedWorkflows[tab.id] = BLANK_WORKFLOW }
      }
      else {
        savedWorkflows[tab.id] = BLANK_WORKFLOW
      }
    }
  }
  else {
    // LiteGraph mode: send to iframe
    if (saved) {
      sendLoadWorkflow(saved)
    }
    else if (tab.promptId) {
      const workflow = await fetchWorkflowFromHistory(tab.promptId)
      sendLoadWorkflow(workflow || BLANK_WORKFLOW)
    }
    else {
      sendLoadWorkflow(BLANK_WORKFLOW)
    }
  }
  currentProjectTabId = tab.id
  persistWorkflows()
}

// Handle workflow loaded from community template
function handleLoadTabWorkflow(e: Event) {
  const { tabId, workflow } = (e as CustomEvent).detail
  savedWorkflows[tabId] = workflow
  persistWorkflows()
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

  // Wait for ComfyUI JS to fully initialize
  await new Promise((r) => setTimeout(r, 3000))
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

  // Save current workflow when leaving a project tab
  if (oldTab?.type === 'project') {
    if (vueNodesEnabled.value) {
      // Vue mode: serialize from Vue canvas
      if (vueCanvasRef.value?.getWorkflow) {
        savedWorkflows[oldTab.id] = vueCanvasRef.value.getWorkflow()
      }
    }
    else if (sharedIframeReady) {
      const workflow = await getWorkflowFromIframe()
      if (workflow) savedWorkflows[oldTab.id] = workflow
    }
    persistWorkflows()
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
      if (wf) savedWorkflows[tab.id] = wf
    }
    if (!savedWorkflows[tab.id]) {
      savedWorkflows[tab.id] = BLANK_WORKFLOW
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
const promptNodeInfo = ref<Record<string, { nodeId: string, nodeType: string }>>({})

let queuePollTimer: ReturnType<typeof setInterval> | null = null
const credits = ref<number | null>(null)
const userProfile = ref<{ email?: string | null, displayName?: string | null, photoURL?: string | null, uid?: string | null, providerId?: string | null } | null>(null)
const userPopupOpen = ref(false)

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

  // Find matching tab by checking iframes
  let tabId: string | null = null
  for (const tab of projectTabs) {
    const iframe = document.querySelector(`[data-tab-id="${tab.id}"] iframe`) as HTMLIFrameElement
    if (iframe?.contentWindow === sourceFrame) {
      tabId = tab.id
      break
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
      'currentRunSilent=', currentRunSilent,
      'prompt_id=', prompt_id,
      'node_id=', node_id)
  }

  if (!tabId) return

  if (evt === 'execution_start') {
    // Claim this run as silent if a live-run is pending — must happen
    // before any UI updates so the tab indicator can skip too.
    if (pendingLiveRuns.value > 0) {
      pendingLiveRuns.value--
      currentRunSilent = true
    } else {
      currentRunSilent = false
    }
    tabNodeProgress.value = { completed: 0, total: 0 }
    executionStartTime.value = Date.now()
    if (prompt_id) {
      promptProgress.value[prompt_id] = 0
    }
    if (!currentRunSilent) {
      updateTabStatus(tabId, 'running', 0)
      const tabLabel = tabs.value.find(t => t.id === tabId)?.label || 'Workflow'
      toast('Workflow started', { description: tabLabel })
    }
  } else if (evt === 'progress') {
    if (!currentRunSilent) updateTabStatus(tabId, 'running', percent)
    if (prompt_id) promptProgress.value[prompt_id] = percent
  } else if (evt === 'executing' && node_id) {
    // Count total nodes for coarse progress
    tabNodeProgress.value.total++
    // Look up display name from Vue canvas nodes
    const vueNodes = vueCanvasRef.value?.getNodes?.() || []
    const vueNode = vueNodes.find((n: any) => n.id === String(node_id))
    const displayName = vueNode?.data?.title || node_id
    if (prompt_id) {
      promptNodeInfo.value[prompt_id] = { nodeId: node_id, nodeType: displayName }
    }
    currentRunningNode.value = displayName
  } else if (evt === 'executed') {
    // Track node completion for coarse progress
    tabNodeProgress.value.completed++
    const np = tabNodeProgress.value
    if (np.total > 0) {
      const coarsePct = Math.round((np.completed / np.total) * 100)
      if (!currentRunSilent) updateTabStatus(tabId, 'running', coarsePct)
      if (prompt_id) promptProgress.value[prompt_id] = coarsePct
    }
  } else if (evt === 'execution_complete') {
    const elapsed = executionStartTime.value
      ? ((Date.now() - executionStartTime.value) / 1000).toFixed(1)
      : null
    tabNodeProgress.value = { completed: 0, total: 0 }
    currentRunningNode.value = ''
    executionStartTime.value = null
    if (prompt_id) {
      delete promptProgress.value[prompt_id]
      delete promptNodeInfo.value[prompt_id]
    }
    const wasSilent = currentRunSilent
    currentRunSilent = false
    if (!wasSilent) {
      updateTabStatus(tabId, 'done')
      const tabLabel = tabs.value.find(t => t.id === tabId)?.label || 'Workflow'
      toast.success('Workflow completed', {
        description: elapsed ? `${tabLabel} — ${elapsed}s` : tabLabel,
      })
      // Reset to idle after a brief moment
      setTimeout(() => {
        updateTabStatus(tabId!, 'idle')
      }, 3000)
    }
    // Refresh history if queue panel is open
    if (queueOpen.value) fetchQueueAndHistory()
  } else if (evt === 'execution_error') {
    if (!currentRunSilent) updateTabStatus(tabId, 'idle')
    tabNodeProgress.value = { completed: 0, total: 0 }
    currentRunningNode.value = ''
    executionStartTime.value = null
    const wasSilent = currentRunSilent
    currentRunSilent = false
    if (!wasSilent) {
      const nodeName = event.data.node_type || event.data.node_id || 'Unknown node'
      toast.error('Workflow failed', { description: nodeName })
    }
  }
}
</script>

<template>
  <div class="flex h-screen bg-sidebar">
    <!-- Hidden bridge iframe: always mounted so credits/auth work on all pages -->
    <iframe
      id="comfynext-bridge-iframe"
      src="http://127.0.0.1:8188/"
      class="fixed w-[10px] h-[10px] -left-[100px] -top-[100px] opacity-0 pointer-events-none"
      aria-hidden="true"
      tabindex="-1"
    />

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
        <div class="flex items-end flex-1 min-w-0">
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
              :workflow="savedWorkflows[activeTab.id] || undefined"
              :active-tool="activeTool"
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

        <!-- Vue canvas top-right toolbar (Run / Stop / Panel) -->
        <div
          v-if="vueNodesEnabled && activeTab.type === 'project'"
          class="absolute top-3 right-3 flex items-center gap-1.5 z-40"
        >
          <button
            class="flex items-center gap-1.5 bg-action hover:bg-comfy-blue/80 rounded-lg px-4 py-2 cursor-pointer transition-colors shadow-lg"
            @click="runVueWorkflow"
          >
            <Play class="size-3.5 text-white fill-white" />
            <span class="text-sm font-semibold text-white">Run</span>
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
            src="http://127.0.0.1:8188/"
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
              v-if="!iframeReady"
              class="absolute inset-0 z-30 bg-[#121212] flex flex-col items-center justify-center gap-3"
            >
              <div class="size-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
              <span class="text-xs text-white/30">Loading workspace...</span>
            </div>
          </Transition>
        </div>

        <!-- Floating toolbar overlay (only visible on project tabs) -->
        <div
          v-if="activeTab.type === 'project'"
          class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#1a1a1a]/90 backdrop-blur-sm rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg z-40"
        >
          <template v-for="(item, index) in sidebarItems" :key="item.label">
            <div
              v-if="index === 2 || item.label === 'Explain'"
              class="w-px h-8 bg-white/10 mx-0.5"
            />
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
  </div>
</template>
