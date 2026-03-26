<script setup lang="ts">
import {
  House, X, Plus, Play, Check, Minus, ExternalLink, AlertCircle,
  MousePointer2, Hand, LayoutGrid, GitFork, Image, Workflow, AppWindow, LayoutTemplate, Sparkles,
  ZoomIn, ZoomOut, Maximize2, Map, Globe, Square, PanelRight,
} from 'lucide-vue-next'
import AssetsHistory from '~/components/AssetsHistory.vue'
import CommunityHome from '~/components/community/CommunityHome.vue'

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
  { label: 'Nodes', icon: GitFork, tabId: 'node-library' },
  { label: 'Workflows', icon: Workflow, tabId: 'workflows' },
  { label: 'Apps', icon: AppWindow, tabId: 'apps' },
  { label: 'Templates', icon: LayoutTemplate },
  { label: 'Explain', icon: Sparkles, tool: 'explain' },
]

const activeTool = ref<string>('select')

const activeSidebarItem = ref<string | null>(null)

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
    else {
      sendToActiveProjectIframe('setCanvasTool', { tool: item.tool })
    }
  }
  else if (item?.tabId) {
    activeSidebarItem.value = activeSidebarItem.value === label ? null : label
    sendToActiveProjectIframe('toggleSidebarTab', { tabId: item.tabId })
  }
}

const minimapActive = ref(false)

function zoomIn() { sendToActiveProjectIframe('canvasZoom', { direction: 'in' }) }
function zoomOut() { sendToActiveProjectIframe('canvasZoom', { direction: 'out' }) }
function zoomReset() { sendToActiveProjectIframe('canvasZoom', { direction: 'reset' }) }
function toggleMinimap() {
  minimapActive.value = !minimapActive.value
  sendToActiveProjectIframe('toggleMinimap')
}

function sendToActiveProjectIframe(action: string, payload?: any) {
  const iframe = getSharedIframe()
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'comfynext', action, ...payload }, '*')
  }
}

// Run workflow from Vue canvas (bypasses iframe, POSTs directly to ComfyUI)
async function runVueWorkflow() {
  if (!vueCanvasRef.value?.getWorkflow) return
  const workflow = vueCanvasRef.value.getWorkflow()
  if (!workflow?.nodes?.length) return

  // Strategy: load workflow into iframe, then queue via two methods:
  // 1. Try bridge queuePrompt (native, handles everything)
  // 2. Fallback: POST to /prompt API directly using iframe's graph serialization
  sendLoadWorkflow(workflow)

  // Wait for iframe to process the loaded workflow
  await new Promise(r => setTimeout(r, 800))

  // Try bridge first (requires ComfyUI restart after bridge update)
  sendToActiveProjectIframe('queuePrompt')

  // Also try getting the prompt from the iframe and POSTing directly
  // This works even without the bridge update
  try {
    const iframe = getSharedIframe()
    if (iframe?.contentWindow) {
      // Ask the iframe to serialize its graph as a prompt
      const promptData = await new Promise<any>((resolve) => {
        let resolved = false
        const handler = (event: MessageEvent) => {
          if (resolved) return
          if (event.data?.type === 'comfynext-bridge' && event.data?.event === 'prompt_data') {
            resolved = true
            window.removeEventListener('message', handler)
            resolve(event.data.prompt)
          }
        }
        window.addEventListener('message', handler)
        iframe.contentWindow!.postMessage({ type: 'comfynext', action: 'getPrompt' }, '*')
        // Timeout: if bridge doesn't support getPrompt, the queuePrompt action should have already worked
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            window.removeEventListener('message', handler)
            resolve(null)
          }
        }, 2000)
      })

      if (promptData) {
        await fetch('/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(promptData),
        })
      }
    }
  }
  catch (err) {
    console.error('[VueNodes] runVueWorkflow fallback error:', err)
  }
}

// Stop/interrupt the current ComfyUI execution
async function stopVueWorkflow() {
  try {
    await fetch('/interrupt', { method: 'POST' })
  }
  catch (err) {
    console.error('[VueNodes] Failed to interrupt:', err)
  }
}

// Single shared ComfyUI iframe — all project tabs share one iframe
const BLANK_WORKFLOW = { last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 }
const savedWorkflows = reactive<Record<string, any>>({}) // tabId → workflow JSON
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
  }

  // Restore workflow when entering a project tab
  if (newTab?.type === 'project') {
    await loadWorkflowForTab(newTab)
  }
})

// When Vue mode is toggled, transfer the workflow between iframe ↔ Vue canvas
watch(vueNodesEnabled, async (enabled) => {
  const tab = activeTab.value
  console.log('[VueNodes toggle]', { enabled, tabType: tab.type, tabId: tab.id, promptId: tab.promptId, hasSaved: !!savedWorkflows[tab.id] })
  if (tab.type !== 'project') return

  if (enabled) {
    // ALWAYS fetch fresh — don't trust cache (may be BLANK_WORKFLOW from earlier failure)
    if (tab.promptId) {
      console.log('[VueNodes] fetching from history:', tab.promptId)
      const wf = await fetchWorkflowFromHistory(tab.promptId)
      console.log('[VueNodes] history returned:', wf ? `${wf.nodes?.length} nodes` : 'null')
      if (wf) savedWorkflows[tab.id] = wf
    }
    if (!savedWorkflows[tab.id]) {
      savedWorkflows[tab.id] = BLANK_WORKFLOW
    }
    console.log('[VueNodes] savedWorkflows set:', savedWorkflows[tab.id]?.nodes?.length, 'nodes')
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
      items.push({ promptId, status, images, executionTime, timestamp })
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

  // Also check bridge iframe loaded after delay
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

  if (!tabId) return

  const { event: evt, percent, prompt_id, node_id } = event.data

  if (evt === 'execution_start') {
    updateTabStatus(tabId, 'running', 0)
    if (prompt_id) promptProgress.value[prompt_id] = 0
  } else if (evt === 'progress') {
    updateTabStatus(tabId, 'running', percent)
    if (prompt_id) promptProgress.value[prompt_id] = percent
  } else if (evt === 'executing' && node_id) {
    // Look up node class_type from the running queue data
    const runningItem = queueData.value.running.find((item: any) => item[1] === prompt_id)
    const prompt = runningItem?.[2] // prompt dict
    const nodeType = prompt?.[node_id]?.class_type ?? ''
    if (prompt_id) {
      promptNodeInfo.value[prompt_id] = { nodeId: node_id, nodeType }
    }
  } else if (evt === 'execution_complete') {
    updateTabStatus(tabId, 'done')
    if (prompt_id) {
      delete promptProgress.value[prompt_id]
      delete promptNodeInfo.value[prompt_id]
    }
    // Refresh history if queue panel is open
    if (queueOpen.value) fetchQueueAndHistory()
    // Reset to idle after a brief moment
    setTimeout(() => {
      updateTabStatus(tabId!, 'idle')
    }, 3000)
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
              @click.stop="closeTab(tab.id)"
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
        <!-- Vue Node Canvas (when Modern node design enabled) -->
        <div
          v-if="vueNodesEnabled && tabs.some((t) => t.type === 'project')"
          v-show="activeTab.type === 'project'"
          class="absolute inset-0"
        >
          <VueCanvasVueNodeCanvas
            ref="vueCanvasRef"
            :workflow="savedWorkflows[activeTab.id] || undefined"
          />
        </div>

        <!-- Vue canvas top-right toolbar (Run / Stop / Panel) -->
        <div
          v-if="vueNodesEnabled && activeTab.type === 'project'"
          class="absolute top-3 right-3 flex items-center gap-1.5 z-10"
        >
          <button
            class="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 rounded-lg px-4 py-2 cursor-pointer transition-colors shadow-lg"
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
            <Square class="size-3.5 text-white/70 fill-white/70" />
          </button>
          <div class="w-px h-5 bg-white/10" />
          <button
            class="flex items-center justify-center size-9 bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg border border-[#2a2a2a] cursor-pointer hover:bg-[#2a2a2a] transition-colors shadow-lg"
            title="Toggle right panel"
          >
            <PanelRight class="size-4 text-white/70" />
          </button>
        </div>

        <!-- LiteGraph iframe (always loaded for execution; hidden in Vue mode) -->
        <div
          v-if="tabs.some((t) => t.type === 'project')"
          v-show="!vueNodesEnabled && activeTab.type === 'project'"
          data-tab-id="comfyui-shared"
          class="absolute inset-0 overflow-hidden"
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
          class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#1a1a1a]/90 backdrop-blur-sm rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg z-10"
        >
          <template v-for="(item, index) in sidebarItems" :key="item.label">
            <div
              v-if="index === 2 || item.label === 'Explain'"
              class="w-px h-8 bg-white/10 mx-0.5"
            />
            <button
              class="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-[8px] cursor-pointer transition-colors group"
              :class="(item.tool ? activeTool === item.tool : activeSidebarItem === item.label) ? 'bg-white/10' : 'hover:bg-white/5'"
              @click="toggleSidebarItem(item.label)"
            >
              <component :is="item.icon" class="size-5 text-white/70 group-hover:text-white transition-colors" :class="{ 'text-white': item.tool ? activeTool === item.tool : activeSidebarItem === item.label }" />
              <span class="text-[10px] text-white/50 group-hover:text-white/70 transition-colors" :class="{ 'text-white/80': item.tool ? activeTool === item.tool : activeSidebarItem === item.label }">
                {{ item.label }}
              </span>
            </button>
          </template>
        </div>
        <!-- Floating zoom/map toolbar (bottom-right, only on project tabs) -->
        <div
          v-if="activeTab.type === 'project'"
          class="absolute bottom-3 right-3 flex items-center gap-1 bg-[#1a1a1a]/90 backdrop-blur-sm rounded-[12px] p-1.5 border border-[#2a2a2a] shadow-lg z-10"
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
                    <span class="text-xs text-white/40 ml-auto shrink-0">{{ promptProgress[item[1]] ?? 0 }}%</span>
                  </div>
                  <div v-if="promptNodeInfo[item[1]]?.nodeType" class="text-[11px] text-white/40 mb-2 ml-4 truncate">
                    {{ promptNodeInfo[item[1]].nodeType }}
                  </div>
                  <!-- Progress bar -->
                  <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      v-if="(promptProgress[item[1]] ?? 0) > 0"
                      class="h-full bg-[#818cf8] rounded-full transition-all duration-300"
                      :style="{ width: `${promptProgress[item[1]]}%` }"
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
