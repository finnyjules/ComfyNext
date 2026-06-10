<script setup lang="ts">
/**
 * AssetsPanel — left-side canvas panel listing a project's generations (every
 * saved run, incl. takes) plus imported files. Drag a card onto the canvas to
 * add a loader node for it (handled by VueNodeCanvas), or click to add at
 * center. Mirrors the LoRALibraryPanel / GeneratorsPanel shell.
 */
import { ref, computed, onMounted } from 'vue'
import { LayoutGrid, Search as SearchIcon, X, Upload, Image as ImageIcon, Video as VideoIcon, Music as AudioIcon, Loader2 } from 'lucide-vue-next'
import { useProjectGenerations, type GenAsset } from '~/composables/useProjectGenerations'

defineEmits<{ close: [] }>()

const { generationsByProject, loading, fetchGenerations, viewUrl } = useProjectGenerations()
const { fetchInputFiles } = useAssetLibrary()
const { activeTab } = useTabs()

const currentProjectId = computed(() => activeTab.value.projectUuid || activeTab.value.workflowId || null)

// ── Scope (which project, or imports) ──────────────────────────────────────
const scope = ref<string>('current')
const searchQuery = ref('')
type Media = 'all' | 'image' | 'video' | 'audio'
const mediaFilter = ref<Media>('all')

function classify(filename: string): GenAsset['kind'] {
  const f = filename.toLowerCase()
  if (/\.(mp4|webm|mov|avi|mkv|m4v)$/.test(f)) return 'video'
  if (/\.(mp3|wav|flac|ogg|m4a|aac)$/.test(f)) return 'audio'
  return 'image'
}

// ── Imports (ComfyUI input folder) ─────────────────────────────────────────
const importAssets = ref<GenAsset[]>([])
const importing = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

async function loadImports() {
  const items = await fetchInputFiles()
  importAssets.value = items.map((it) => ({
    kind: classify(it.filename),
    filename: it.filename,
    subfolder: '',
    type: 'input',
    promptId: '',
    timestamp: 0,
  }))
}

async function uploadFiles(files: FileList | File[]) {
  importing.value = true
  try {
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('overwrite', 'true')
      try { await fetch('/upload/image', { method: 'POST', body: fd }) }
      catch { /* skip this file */ }
    }
    await loadImports()
    scope.value = 'imports'
  } finally {
    importing.value = false
  }
}

function onPickFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) uploadFiles(files)
  ;(e.target as HTMLInputElement).value = ''
}

// OS file drop onto the panel body → import.
function onPanelDrop(e: DragEvent) {
  if (e.dataTransfer?.files?.length) {
    e.preventDefault()
    uploadFiles(e.dataTransfer.files)
  }
}

onMounted(async () => {
  // Force a fresh read each time the panel opens. fetchGenerations caches on a
  // module-level `fetchedOnce`, so a plain call returns stale data after the
  // first open — meaning generations produced since (a run, another tab) never
  // show up until a full page reload.
  await fetchGenerations(true)
  await loadImports()
  // Default to the current project if it has generations, else show all.
  const hasCurrent = currentProjectId.value
    && generationsByProject.value.some((p) => p.workflowId === currentProjectId.value)
  scope.value = hasCurrent ? 'current' : 'all'
})

// ── Resolve scope → asset list ─────────────────────────────────────────────
const allGenerations = computed<GenAsset[]>(() =>
  generationsByProject.value.flatMap((p) => p.generations).sort((a, b) => b.timestamp - a.timestamp),
)

const scopedAssets = computed<GenAsset[]>(() => {
  if (scope.value === 'imports') return importAssets.value
  if (scope.value === 'all') return allGenerations.value
  const wf = scope.value === 'current' ? currentProjectId.value : scope.value
  return generationsByProject.value.find((p) => p.workflowId === wf)?.generations ?? []
})

const visibleAssets = computed<GenAsset[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return scopedAssets.value.filter((a) =>
    (mediaFilter.value === 'all' || a.kind === mediaFilter.value)
    && (!q || a.filename.toLowerCase().includes(q)),
  )
})

const mediaTabs: { key: Media; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Video' },
  { key: 'audio', label: 'Audio' },
]
function mediaCount(m: Media): number {
  return m === 'all' ? scopedAssets.value.length : scopedAssets.value.filter((a) => a.kind === m).length
}

// ── Add to canvas (drag + click) ───────────────────────────────────────────
function payload(a: GenAsset) {
  return { kind: a.kind, filename: a.filename, subfolder: a.subfolder, type: a.type }
}
function onCardDragStart(e: DragEvent, a: GenAsset) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('application/x-comfynext-asset', JSON.stringify(payload(a)))
  e.dataTransfer.effectAllowed = 'copy'
}
function addToCanvas(a: GenAsset) {
  window.dispatchEvent(new CustomEvent('comfynext:addAssetNode', { detail: payload(a) }))
}
</script>

<template>
  <div
    class="h-full bg-[#1a1a1a]/95 backdrop-blur-md border-r border-white/10 flex flex-col shadow-2xl"
    @dragover.prevent
    @drop="onPanelDrop"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div class="flex items-center gap-2">
        <LayoutGrid class="size-4 text-white/70" />
        <span class="text-sm font-semibold text-white/90">Assets</span>
      </div>
      <button
        class="flex items-center justify-center size-6 rounded hover:bg-white/10 transition-colors cursor-pointer"
        @click="$emit('close')"
      >
        <X class="size-4 text-white/60" />
      </button>
    </div>

    <!-- Scope selector + import -->
    <div class="px-3 pt-3 pb-2 flex items-center gap-2">
      <select
        v-model="scope"
        class="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-xs text-white/85 outline-none focus:border-white/20 cursor-pointer"
      >
        <option value="current">This project</option>
        <option value="all">All projects</option>
        <option value="imports">Imported files</option>
        <option v-for="p in generationsByProject" :key="p.workflowId" :value="p.workflowId">{{ p.name }}</option>
      </select>
      <button
        class="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-white/85 transition-colors cursor-pointer"
        title="Import files into your input folder"
        :disabled="importing"
        @click="fileInput?.click()"
      >
        <Loader2 v-if="importing" class="size-3.5 animate-spin" /><Upload v-else class="size-3.5" />
        Import
      </button>
      <input ref="fileInput" type="file" multiple accept="image/*,video/*,audio/*" class="hidden" @change="onPickFiles" />
    </div>

    <!-- Search -->
    <div class="px-3 pb-2">
      <div class="relative">
        <SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-white/40 pointer-events-none" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search assets…"
          class="w-full bg-white/[0.04] border border-white/10 rounded pl-7 pr-7 py-1.5 text-xs text-white/85 placeholder-white/30 outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
          @keydown.esc="searchQuery = ''"
        />
        <button
          v-if="searchQuery"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 size-4 rounded hover:bg-white/10 flex items-center justify-center cursor-pointer"
          @click="searchQuery = ''"
        >
          <X class="size-3 text-white/50" />
        </button>
      </div>
    </div>

    <!-- Media filter chips -->
    <div class="px-2 pb-2 flex flex-wrap gap-1">
      <button
        v-for="m in mediaTabs"
        :key="m.key"
        class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[11px] transition-colors cursor-pointer"
        :class="mediaFilter === m.key ? 'bg-white/[0.12] text-white font-medium' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]'"
        @click="mediaFilter = m.key"
      >
        <span>{{ m.label }}</span>
        <span class="text-white/35 tabular-nums">{{ mediaCount(m.key) }}</span>
      </button>
    </div>

    <!-- Grid -->
    <div class="flex-1 overflow-y-auto px-2 pb-3">
      <div v-if="loading && !generationsByProject.length" class="px-2 py-12 text-center text-xs text-white/40">
        <Loader2 class="size-5 animate-spin mx-auto mb-2" /> Loading…
      </div>
      <div v-else-if="!visibleAssets.length" class="px-4 py-12 text-center text-xs text-white/40 leading-relaxed">
        <template v-if="scope === 'imports'">No imported files yet. Hit Import or drop files here.</template>
        <template v-else>No generations here yet. Run a workflow and they'll show up.</template>
      </div>
      <div v-else class="grid grid-cols-2 gap-2">
        <div
          v-for="(a, i) in visibleAssets"
          :key="`${a.promptId}-${a.subfolder}-${a.filename}-${i}`"
          class="group relative aspect-square rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.06] hover:border-white/20 cursor-grab active:cursor-grabbing transition-colors"
          draggable="true"
          :title="a.filename"
          @dragstart="onCardDragStart($event, a)"
          @click="addToCanvas(a)"
        >
          <img v-if="a.kind === 'image'" :src="viewUrl(a)" class="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          <video v-else-if="a.kind === 'video'" :src="viewUrl(a)" class="absolute inset-0 w-full h-full object-cover" muted preload="metadata" />
          <div v-else class="absolute inset-0 flex items-center justify-center text-white/40">
            <AudioIcon class="size-6" />
          </div>
          <!-- media badge -->
          <div class="absolute top-1 left-1 size-5 rounded bg-black/55 backdrop-blur-sm flex items-center justify-center text-white/80">
            <VideoIcon v-if="a.kind === 'video'" class="size-3" />
            <AudioIcon v-else-if="a.kind === 'audio'" class="size-3" />
            <ImageIcon v-else class="size-3" />
          </div>
        </div>
      </div>
    </div>

    <!-- Footer hint -->
    <div class="px-3 py-2 border-t border-white/[0.06] text-[10px] text-white/35 leading-snug">
      Drag any asset onto the canvas to add it as a source, or click to drop it at center.
    </div>
  </div>
</template>
