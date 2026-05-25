<script setup lang="ts">
import {
  X, Toolbox,
  // Chrome & UI
  Search as SearchIcon, ChevronDown,
  // Download chip states
  Loader2, CloudDownload,
} from 'lucide-vue-next'
import { useNodeSearch } from '~/composables/useNodeSearch'
import {
  TOOLBOX_SECTIONS, TOOLBOX_DOMAINS, DEFAULT_COLLAPSED,
  type Domain, type ModelBundleKey, type ToolboxItem, type ToolboxSection,
} from '~/data/toolbox-items'

defineEmits<{ close: [] }>()

// Domain list aliased to its original local name so the rest of this file
// (rendering logic, filter loops) keeps reading naturally.
const DOMAINS = TOOLBOX_DOMAINS


// Apply default domain to any section that didn't set one explicitly.
const sections = computed<Required<ToolboxSection>[]>(() =>
  TOOLBOX_SECTIONS.map(s => ({ ...s, domain: s.domain ?? 'image' })),
)

const activeDomain = ref<Domain>('image')
const searchQuery = ref('')

function domainItemCount(d: Domain): number {
  return sections.value
    .filter(s => s.domain === d)
    .reduce((sum, s) => sum + s.items.length, 0)
}

// Visible sections = current domain + (if searching) filtered items per section.
const visibleSections = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return sections.value
    .filter(s => s.domain === activeDomain.value)
    .map(s => {
      if (!q) return s
      const items = s.items.filter(it =>
        it.label.toLowerCase().includes(q)
        || it.description.toLowerCase().includes(q)
        || it.nodeType.toLowerCase().includes(q),
      )
      return { ...s, items }
    })
    .filter(s => s.items.length > 0)
})

// Collapsed sections, persisted to localStorage.
const STORAGE_KEY = 'toolbox.collapsedSections'
const collapsedKeys = ref<Set<string>>(new Set())

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw != null) {
      collapsedKeys.value = new Set(JSON.parse(raw))
    } else {
      // First load: apply our default-collapsed set.
      collapsedKeys.value = new Set(DEFAULT_COLLAPSED)
    }
  } catch {
    collapsedKeys.value = new Set(DEFAULT_COLLAPSED)
  }
}
function saveCollapsed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedKeys.value]))
  } catch {}
}
onMounted(loadCollapsed)

function sectionKey(s: { domain: Domain; title: string }): string {
  return `${s.domain}:${s.title}`
}
function isCollapsed(s: { domain: Domain; title: string }): boolean {
  // While searching, force-expand every section so matches are visible.
  if (searchQuery.value.trim()) return false
  return collapsedKeys.value.has(sectionKey(s))
}
function toggleSection(s: { domain: Domain; title: string }) {
  const key = sectionKey(s)
  const next = new Set(collapsedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedKeys.value = next
  saveCollapsed()
}

const { addNode } = useNodeSearch()

// -- Model pre-download orchestration ---------------------------------------
// Some nodes (FaceSwap) need hundreds of MB of weights. We pre-fetch when the
// card is first clicked so the first prompt isn't a "why is this hanging" moment.

interface DownloadState {
  active: boolean
  label: string                      // "Face Swap" — what's installing
  file: string                       // current file being fetched
  downloaded: number                 // bytes
  total: number                      // bytes
  phase: 'checking' | 'downloading' | 'preparing' | 'error'
  message?: string                   // populated on error
}
const download = reactive<DownloadState>({
  active: false, label: '', file: '', downloaded: 0, total: 0, phase: 'checking',
})

// Per-key in-flight promise so repeated clicks dedupe to a single download.
const inflight = new Map<string, Promise<boolean>>()

// Which model bundles are already on disk — drives the cloud-icon badge on
// cards. Probed on mount and after each successful download.
const modelsReady = reactive<Set<string>>(new Set())

async function probeModelStatus(key: ModelBundleKey) {
  try {
    const status = await (await fetch(`/comfynext/models/status?key=${key}`)).json()
    if (status.ready) modelsReady.add(key)
    else modelsReady.delete(key)
  } catch { /* offline — leave as not-ready; click will surface the error */ }
}
const ALL_BUNDLES: ModelBundleKey[] = [
  'faceswap', 'bgremove', 'upscale',
  'frameinterp', 'subjecttrack',
  'facerestore', 'lipsync', 'objectremove',
  'whisper', 'demucs',
]
onMounted(() => { for (const k of ALL_BUNDLES) probeModelStatus(k) })

// Card-level helpers used by the template.
function isModelMissing(item: ToolboxItem): boolean {
  return !!item.requiresModels && !modelsReady.has(item.requiresModels)
}
function isCardDownloading(item: ToolboxItem): boolean {
  return !!item.requiresModels && download.active && inflight.has(item.requiresModels)
}
function cardProgress(): number {
  if (!download.total) return 0
  return download.downloaded / download.total
}

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0)
}

async function ensureModels(key: ModelBundleKey): Promise<boolean> {
  if (inflight.has(key)) return inflight.get(key)!
  const p = (async (): Promise<boolean> => {
    download.active = true
    download.label = key  // overwritten by `start` event with the bundle's pretty label
    download.phase = 'checking'
    download.file = ''
    download.downloaded = 0
    download.total = 0
    download.message = undefined

    let status: any
    try {
      status = await (await fetch(`/comfynext/models/status?key=${key}`)).json()
      if (status.label) download.label = status.label
      if (status.ready) {
        download.active = false
        return true
      }
    } catch (err) {
      download.phase = 'error'
      download.message = 'Could not reach the model server. Is ComfyUI running?'
      return false
    }

    // SSE stream of `data: {json}\n\n` lines from /comfynext/models/download.
    return new Promise<boolean>((resolve) => {
      const es = new EventSource(`/comfynext/models/download?key=${key}`)
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.phase === 'start' && msg.label) {
            download.label = msg.label
          } else if (msg.phase === 'downloading') {
            download.phase = 'downloading'
            download.file = msg.file
            download.downloaded = msg.downloaded
            download.total = msg.total
          } else if (msg.phase === 'preparing') {
            download.phase = 'preparing'
            download.file = msg.file
          } else if (msg.phase === 'done') {
            download.active = false
            modelsReady.add(key)
            es.close()
            resolve(true)
          } else if (msg.phase === 'error') {
            download.phase = 'error'
            download.message = msg.message || 'Download failed.'
            es.close()
            resolve(false)
          }
        } catch {}
      }
      es.onerror = () => {
        // Browser closes EventSource on the stream's final byte — only flag a real
        // error if we never reached `done`.
        if (download.active && download.phase !== 'error') {
          download.phase = 'error'
          download.message = 'Lost connection to the model server.'
        }
        es.close()
        resolve(download.phase !== 'error')
      }
    })
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

function dismissDownload() {
  download.active = false
}

async function handleAdd(item: ToolboxItem) {
  if (item.requiresModels) {
    const ok = await ensureModels(item.requiresModels)
    if (!ok) return  // toast already shows the error; user can retry by clicking again
  }
  addNode(item.nodeType)
}

const panelRef = ref<HTMLDivElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const hoveredItem = ref<ToolboxItem | null>(null)
const hoverPos = ref({ top: 0, left: 0 })
let enterTimer: ReturnType<typeof setTimeout> | null = null

function clearSearch() {
  searchQuery.value = ''
  searchInputRef.value?.focus()
}

// Native HTML5 drag → drop onto the VueFlow canvas. VueNodeCanvas already
// listens for `dragover`/`drop` and creates the node at the cursor position.
function onCardDragStart(event: DragEvent, item: ToolboxItem) {
  if (!event.dataTransfer) return
  // Nodes that need weights downloaded can't be dragged onto the canvas (the
  // canvas drop handler would try to instantiate immediately). Cancel the drag
  // and kick off the download instead — the user can drag once it's installed.
  if (item.requiresModels) {
    event.preventDefault()
    handleAdd(item)
    return
  }
  event.dataTransfer.setData('text/plain', item.nodeType)
  event.dataTransfer.effectAllowed = 'copy'
  // Hide the hover-preview tooltip while a drag is in flight.
  if (enterTimer) clearTimeout(enterTimer)
  hoveredItem.value = null
}

function onCardEnter(event: MouseEvent, item: ToolboxItem) {
  const cardRect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const panelRect = panelRef.value?.getBoundingClientRect()
  if (enterTimer) clearTimeout(enterTimer)
  // Tiny delay so quick mouse-overs don't flash a preview.
  enterTimer = setTimeout(() => {
    hoveredItem.value = item
    hoverPos.value = {
      top: cardRect.top + cardRect.height / 2,
      left: (panelRect?.right ?? cardRect.right) + 8,
    }
  }, 120)
}
function onCardLeave() {
  if (enterTimer) clearTimeout(enterTimer)
  hoveredItem.value = null
}
</script>

<template>
  <div ref="panelRef" class="h-full bg-[#1a1a1a]/95 backdrop-blur-md border-r border-white/10 flex flex-col shadow-2xl">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div class="flex items-center gap-2">
        <Toolbox class="size-4 text-white/70" />
        <span class="text-sm font-semibold text-white/90">Toolbox</span>
      </div>
      <button
        class="flex items-center justify-center size-6 rounded hover:bg-white/10 transition-colors cursor-pointer"
        @click="$emit('close')"
      >
        <X class="size-4 text-white/60" />
      </button>
    </div>

    <!-- Search input -->
    <div class="px-3 pt-3 pb-2">
      <div class="relative">
        <SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-white/40 pointer-events-none" />
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          placeholder="Search the toolbox…"
          class="w-full bg-white/[0.04] border border-white/10 rounded pl-7 pr-7 py-1.5 text-xs text-white/85 placeholder-white/30 outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
          @keydown.esc="clearSearch"
        />
        <button
          v-if="searchQuery"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 size-4 rounded hover:bg-white/10 flex items-center justify-center cursor-pointer"
          title="Clear search"
          @click="clearSearch"
        >
          <X class="size-3 text-white/50" />
        </button>
      </div>
    </div>

    <!-- Domain tabs -->
    <div class="px-2 pb-2 flex gap-1">
      <button
        v-for="d in DOMAINS"
        :key="d.id"
        class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        :class="activeDomain === d.id
          ? 'font-medium'
          : 'text-white/55 hover:bg-white/[0.04] hover:text-white/85'"
        :style="activeDomain === d.id
          ? { backgroundColor: `${d.color}26`, color: d.color }
          : undefined"
        :disabled="domainItemCount(d.id) === 0 && activeDomain !== d.id"
        :title="d.label"
        @click="activeDomain = d.id"
      >
        <component :is="d.icon" class="size-3.5" :stroke-width="1.75" />
        <span>{{ d.label }}</span>
      </button>
    </div>

    <!-- Sections / empty state -->
    <div class="flex-1 overflow-y-auto pb-3">
      <div
        v-if="visibleSections.length === 0"
        class="px-4 py-12 text-center text-xs text-white/40"
      >
        <template v-if="searchQuery.trim()">
          No nodes match <span class="text-white/70">"{{ searchQuery }}"</span>.
          <button class="block mx-auto mt-2 text-white/70 hover:text-white underline underline-offset-2 cursor-pointer" @click="clearSearch">
            Clear search
          </button>
        </template>
        <template v-else>
          No tools in this category yet.
        </template>
      </div>

      <div v-for="section in visibleSections" :key="sectionKey(section)" class="px-2 pt-2">
        <button
          class="w-full flex items-center justify-between px-1 pb-1.5 group cursor-pointer"
          @click="toggleSection(section)"
        >
          <span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40 group-hover:text-white/65 transition-colors">
            {{ section.title }}
            <span class="ml-1 text-white/25 normal-case tracking-normal">{{ section.items.length }}</span>
          </span>
          <ChevronDown
            class="size-3 text-white/30 group-hover:text-white/55 transition-all"
            :class="isCollapsed(section) ? '-rotate-90' : ''"
          />
        </button>
        <div v-if="!isCollapsed(section)" class="grid grid-cols-3 gap-1">
          <button
            v-for="item in section.items"
            :key="item.nodeType"
            draggable="true"
            class="relative group flex flex-col items-center justify-center gap-2.5 aspect-square rounded-md bg-white/[0.025] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/10 transition-colors cursor-grab active:cursor-grabbing p-2"
            :title="isModelMissing(item) ? 'Click to download model weights, then add' : 'Click to add, or drag onto the canvas'"
            @click="handleAdd(item)"
            @dragstart="(e) => onCardDragStart(e, item)"
            @mouseenter="(e) => onCardEnter(e, item)"
            @mouseleave="onCardLeave"
          >
            <!-- Cloud badge: weights not yet on disk. Hidden once downloaded
                 (or while a download is in progress — the ring around the icon
                 carries the state at that point). -->
            <CloudDownload
              v-if="isModelMissing(item) && !isCardDownloading(item)"
              class="absolute top-1 right-1 size-3 text-white/40 group-hover:text-white/70 transition-colors"
              :stroke-width="1.75"
            />

            <!-- Icon + optional progress ring -->
            <div class="relative size-6 flex items-center justify-center">
              <!-- SVG ring: stroke-dashoffset gives us the partial arc. -->
              <svg
                v-if="isCardDownloading(item)"
                class="absolute inset-0 size-full -rotate-90"
                viewBox="0 0 36 36"
              >
                <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2.5" />
                <circle
                  cx="18" cy="18" r="16" fill="none"
                  stroke="#96b4ff" stroke-width="2.5" stroke-linecap="round"
                  :stroke-dasharray="2 * Math.PI * 16"
                  :stroke-dashoffset="2 * Math.PI * 16 * (1 - cardProgress())"
                  class="transition-[stroke-dashoffset] duration-200 ease-linear"
                />
              </svg>
              <component
                :is="item.icon"
                class="size-6 text-white/65 group-hover:text-white/95 transition-colors"
                :stroke-width="1.5"
              />
            </div>
            <span class="text-[11px] text-white/65 group-hover:text-white/90 text-center leading-tight transition-colors line-clamp-2">{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      enter-from-class="opacity-0 -translate-x-1"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition-opacity duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="hoveredItem"
        class="fixed z-[60] w-64 bg-[#1f1f1f]/95 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl p-3 pointer-events-none"
        :style="{ top: hoverPos.top + 'px', left: hoverPos.left + 'px', transform: 'translateY(-50%)' }"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <div class="flex items-center justify-center size-7 rounded-md bg-white/5">
            <component :is="hoveredItem.icon" class="size-3.5 text-white/80" />
          </div>
          <span class="text-sm font-semibold text-white/90">{{ hoveredItem.label }}</span>
        </div>
        <p class="text-xs text-white/60 leading-relaxed">{{ hoveredItem.description }}</p>
      </div>
    </Transition>
  </Teleport>

  <!-- Model download toast: sticky bottom-right, shows progress for nodes that
       need weights (FaceSwap, etc.) before they can be added. -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="download.active"
        class="fixed bottom-6 right-6 z-[70] w-80 rounded-lg border border-white/10 bg-[#1a1a1a]/95 backdrop-blur-md shadow-2xl p-4"
      >
        <div class="flex items-center gap-2 mb-2">
          <Loader2 v-if="download.phase !== 'error'" class="size-4 text-white/70 animate-spin" />
          <X v-else class="size-4 text-rose-400" @click="dismissDownload" />
          <span class="text-sm font-medium text-white/90">
            Installing {{ download.label }}
          </span>
        </div>
        <p v-if="download.phase === 'checking'" class="text-xs text-white/55">
          Checking what's already downloaded…
        </p>
        <p v-else-if="download.phase === 'preparing'" class="text-xs text-white/55">
          Loading {{ download.file }}…
        </p>
        <p v-else-if="download.phase === 'error'" class="text-xs text-rose-400/90">
          {{ download.message }}
        </p>
        <template v-else>
          <div class="flex items-center justify-between text-[11px] text-white/55 mb-1.5 tabular-nums">
            <span class="truncate">{{ download.file }}</span>
            <span>{{ fmtMB(download.downloaded) }} / {{ fmtMB(download.total) }} MB</span>
          </div>
          <div class="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              class="h-full bg-[#96b4ff] transition-[width] duration-200 ease-linear"
              :style="{ width: download.total ? `${(download.downloaded / download.total * 100).toFixed(1)}%` : '5%' }"
            />
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
