<script setup lang="ts">
/**
 * ProjectMenu — floating chip at the top-left of the canvas. Shows
 * "Project / Canvas" and opens a dropdown with:
 *   - the project name (pencil to rename),
 *   - the project's canvases: click to switch, double-click to rename,
 *     trash (two-step confirm) to delete, "+ New canvas" to add,
 *   - named version snapshots of the WHOLE project doc (save + restore),
 *     replacing the old left-side VersionsPanel.
 * All state lives in the parent (which owns the doc and the canvas) — this
 * component only renders and emits. Version persistence goes through
 * useVersions; the version body is whatever getProjectDoc returns.
 */
import { ref, computed, watch, nextTick } from 'vue'
import {
  ChevronDown, Check, Pencil, Plus, Trash2, Save, RotateCcw, Loader2, History, Frame,
} from 'lucide-vue-next'
import { docHasContent, type ProjectDoc } from '~/lib/projectDoc'

const props = defineProps<{
  projectId: string | null
  projectName: string
  doc: ProjectDoc | null
  switching: boolean
  getProjectDoc: () => Promise<any | null>
  brandKitId?: string | null
  brandKitName?: string | null
  brandSwatches?: string[]
  deliverablesCount?: number
}>()
const emit = defineEmits<{
  renameProject: [name: string]
  switchCanvas: [canvasId: string]
  addCanvas: []
  showDeliverables: []
  renameCanvas: [canvasId: string, name: string]
  deleteCanvas: [canvasId: string]
  restore: [body: any]
  setBrandKit: [id: string | null]
}>()

const open = ref(false)

const activeCanvas = computed(() => {
  const doc = props.doc
  if (!doc?.canvases?.length) return null
  return doc.canvases.find((c) => c.id === doc.activeCanvasId) ?? doc.canvases[0]!
})

// ── Renames (project + canvas) ──────────────────────────────────────────────
const editingProject = ref(false)
const editingCanvasId = ref<string | null>(null)
const editValue = ref('')

function startProjectRename() {
  editingProject.value = true
  editingCanvasId.value = null
  editValue.value = props.projectName
  focusRenameInput()
}
function startCanvasRename(id: string, current: string) {
  editingCanvasId.value = id
  editingProject.value = false
  editValue.value = current
  focusRenameInput()
}
function focusRenameInput() {
  nextTick(() => {
    const input = document.querySelector('[data-project-menu-rename]') as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}
function commitRename() {
  const name = editValue.value.trim()
  if (name) {
    if (editingProject.value) emit('renameProject', name)
    else if (editingCanvasId.value) emit('renameCanvas', editingCanvasId.value, name)
  }
  cancelRename()
}
function cancelRename() {
  editingProject.value = false
  editingCanvasId.value = null
}

// ── Canvas actions ──────────────────────────────────────────────────────────
// Two-step delete: first trash click arms the confirm, second click deletes.
const confirmDeleteId = ref<string | null>(null)

function onCanvasClick(id: string) {
  if (props.switching || editingCanvasId.value === id) return
  confirmDeleteId.value = null
  emit('switchCanvas', id)
}
function onDeleteClick(id: string) {
  if (confirmDeleteId.value === id) {
    confirmDeleteId.value = null
    emit('deleteCanvas', id)
  } else {
    confirmDeleteId.value = id
  }
}

// ── Brand kit ───────────────────────────────────────────────────────────────
// Inline brand-library popover; the parent owns the doc's brandKitId.
const brandOpen = ref(false)

// ── Versions ────────────────────────────────────────────────────────────────
const { versions, loading, refresh, saveNamed, getVersionWorkflow } = useVersions()
const saving = ref(false)
const restoringId = ref<string | null>(null)
const newVersionName = ref('')

async function onSaveVersion() {
  if (!props.projectId || saving.value) return
  saving.value = true
  try {
    const doc = await props.getProjectDoc()
    if (!docHasContent(doc)) return
    await saveNamed(props.projectId, newVersionName.value.trim(), doc, props.projectName)
    newVersionName.value = ''
  } finally {
    saving.value = false
  }
}

async function onRestoreVersion(vid: string) {
  if (!props.projectId || restoringId.value) return
  restoringId.value = vid
  try {
    const body = await getVersionWorkflow(props.projectId, vid)
    if (body) {
      emit('restore', body)
      open.value = false
    }
  } finally {
    restoringId.value = null
  }
}

// ── Spend (read-only) ───────────────────────────────────────────────────────
const { fetchSpendSummary } = useProjects()
const spend = ref<Awaited<ReturnType<typeof fetchSpendSummary>>>(null)
const projectUsd = computed(() => {
  if (!spend.value || !props.projectId) return 0
  return spend.value.byProject.find((p) => p.uuid === props.projectId)?.usd ?? 0
})

function timeAgo(ts: number | null): string {
  if (!ts) return ''
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'Yesterday' : `${d}d ago`
}

watch(open, (o) => {
  confirmDeleteId.value = null
  brandOpen.value = false
  cancelRename()
  if (o) {
    refresh(props.projectId)
    fetchSpendSummary().then((s) => { spend.value = s })
  }
})
watch(() => props.projectId, (id) => {
  if (open.value) refresh(id)
})
</script>

<template>
  <div class="absolute top-3 left-3 z-40">
    <!-- Chip: "Project / Canvas ▾" -->
    <button
      class="flex items-center gap-1.5 max-w-[340px] bg-[#1a1a1a]/90 backdrop-blur-sm rounded-[12px] px-3 py-2 border border-[#2a2a2a] shadow-lg cursor-pointer hover:bg-[#222] transition-colors"
      :class="{ '!bg-[#222] border-white/20': open }"
      @click="open = !open"
    >
      <span class="text-xs font-medium text-white truncate">{{ projectName }}</span>
      <template v-if="activeCanvas && (doc?.canvases?.length ?? 0) > 0">
        <span class="text-xs text-white/30 shrink-0">/</span>
        <span class="text-xs text-white/60 truncate shrink-0 max-w-[120px]">{{ activeCanvas.name }}</span>
      </template>
      <ChevronDown class="size-3.5 text-white/50 shrink-0 transition-transform" :class="{ 'rotate-180': open }" />
    </button>

    <!-- Click-away backdrop -->
    <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />

    <!-- Dropdown -->
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      leave-active-class="transition-all duration-100 ease-in"
      enter-from-class="opacity-0 -translate-y-1"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="open"
        class="absolute top-full left-0 mt-2 w-[300px] max-h-[80vh] bg-[#1a1a1a]/95 backdrop-blur-md border border-[#2a2a2a] rounded-[12px] shadow-2xl z-50 flex flex-col overflow-x-hidden overflow-y-auto"
      >
        <!-- Project name + rename -->
        <div class="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
          <input
            v-if="editingProject"
            v-model="editValue"
            data-project-menu-rename
            class="flex-1 min-w-0 text-xs font-semibold text-white bg-white/10 rounded px-1.5 py-1 outline-none border border-white/20"
            @blur="commitRename"
            @keydown.enter="commitRename"
            @keydown.escape="cancelRename"
          />
          <span v-else class="flex-1 min-w-0 text-xs font-semibold text-white/90 truncate">{{ projectName }}</span>
          <button
            v-if="!editingProject"
            class="shrink-0 flex items-center justify-center size-6 rounded hover:bg-white/10 transition-colors cursor-pointer"
            title="Rename project"
            @click="startProjectRename"
          >
            <Pencil class="size-3 text-white/50" />
          </button>
        </div>

        <!-- Deliverables (pinned project view, not a canvas) -->
        <button
          class="mb-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-white/[0.04]"
          @click="emit('showDeliverables')"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" class="text-emerald-400/80"><path d="M20 7L9 18l-5-5" /></svg>
          <span class="flex-1 text-xs text-white/80">Ready to deliver</span>
          <span v-if="deliverablesCount" class="font-mono text-[10px] text-white/40">{{ deliverablesCount }}</span>
        </button>

        <!-- Canvases -->
        <div class="px-2 pt-2 pb-1">
          <div class="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-white/35">Canvases</div>
          <div v-if="!doc?.canvases?.length" class="px-1.5 pb-2 text-[11px] text-white/40">
            Open or run this project to start.
          </div>
          <div
            v-for="canvas in doc?.canvases ?? []"
            :key="canvas.id"
            class="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
            :class="[
              canvas.id === doc!.activeCanvasId ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
              switching ? 'opacity-60' : 'cursor-pointer',
            ]"
            @click="onCanvasClick(canvas.id)"
          >
            <Frame class="size-3.5 shrink-0" :class="canvas.id === doc!.activeCanvasId ? 'text-white/80' : 'text-white/35'" />
            <input
              v-if="editingCanvasId === canvas.id"
              v-model="editValue"
              data-project-menu-rename
              class="flex-1 min-w-0 text-xs text-white bg-white/10 rounded px-1.5 py-0.5 outline-none border border-white/20"
              @blur="commitRename"
              @keydown.enter="commitRename"
              @keydown.escape="cancelRename"
              @click.stop
            />
            <span
              v-else
              class="flex-1 min-w-0 text-xs truncate"
              :class="canvas.id === doc!.activeCanvasId ? 'text-white' : 'text-white/70'"
              @dblclick.stop="startCanvasRename(canvas.id, canvas.name)"
            >
              {{ canvas.name }}
            </span>
            <Check v-if="canvas.id === doc!.activeCanvasId" class="size-3.5 text-white/60 shrink-0" />
            <button
              v-if="(doc?.canvases?.length ?? 0) > 1"
              class="shrink-0 flex items-center justify-center h-5 rounded transition-all cursor-pointer"
              :class="confirmDeleteId === canvas.id
                ? 'px-1.5 bg-red-500/20 text-red-400 text-[10px] font-medium'
                : 'w-5 opacity-0 group-hover:opacity-100 hover:bg-white/10 text-white/40 hover:text-red-400'"
              :title="confirmDeleteId === canvas.id ? 'Click again to delete' : 'Delete canvas'"
              @click.stop="onDeleteClick(canvas.id)"
            >
              <template v-if="confirmDeleteId === canvas.id">Delete?</template>
              <Trash2 v-else class="size-3" />
            </button>
          </div>
          <button
            class="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-xs text-white/50 hover:text-white hover:bg-white/[0.04] transition-colors cursor-pointer disabled:opacity-50"
            :disabled="switching || !doc"
            @click="emit('addCanvas')"
          >
            <Plus class="size-3.5 shrink-0" />
            New canvas
          </button>
        </div>

        <!-- Brand -->
        <div class="border-t border-white/[0.06] px-2 pt-2 pb-2">
          <button
            class="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-colors cursor-pointer text-left"
            @click.stop="brandOpen = !brandOpen"
          >
            <span class="flex items-center gap-2 min-w-0">
              <span v-if="brandSwatches?.length" class="flex gap-0.5 shrink-0">
                <span
                  v-for="(c, i) in brandSwatches"
                  :key="i"
                  class="size-3 rounded-sm border border-white/10"
                  :style="{ background: c }"
                />
              </span>
              <span class="text-xs truncate" :class="brandKitName ? 'text-white/85' : 'text-white/40'">
                {{ brandKitName ?? 'No brand kit' }}
              </span>
            </span>
            <span class="text-[10px] font-medium uppercase tracking-wider text-white/35 shrink-0">Brand</span>
          </button>
          <BrandLibraryPopover
            v-if="brandOpen"
            class="mt-1 !w-full"
            :active-kit-id="brandKitId"
            @set-active="(id) => emit('setBrandKit', id)"
          />
        </div>

        <!-- Versions -->
        <div class="border-t border-white/[0.06] px-2 pt-2 pb-2">
          <div class="flex items-center gap-1.5 px-1.5 pb-1.5">
            <History class="size-3 text-white/35" />
            <span class="text-[10px] font-medium uppercase tracking-wider text-white/35">Versions</span>
          </div>
          <div class="flex items-center gap-1.5 px-1.5 pb-2">
            <input
              v-model="newVersionName"
              type="text"
              placeholder="Name this version…"
              :disabled="!projectId"
              class="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[11px] text-white/85 placeholder-white/30 outline-none focus:border-white/20 disabled:opacity-50"
              @keydown.enter="onSaveVersion"
            />
            <button
              class="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[10px] text-white/85 transition-colors cursor-pointer disabled:opacity-50"
              :disabled="!projectId || saving"
              title="Save the whole project (all canvases) as a named version"
              @click="onSaveVersion"
            >
              <Loader2 v-if="saving" class="size-3 animate-spin" /><Save v-else class="size-3" />
              Save
            </button>
          </div>
          <div class="max-h-[180px] overflow-y-auto">
            <div v-if="!projectId" class="px-1.5 pb-1 text-[11px] text-white/40">
              Run this project once to start saving versions.
            </div>
            <div v-else-if="loading && !versions.length" class="px-1.5 py-3 text-center text-[11px] text-white/40">
              <Loader2 class="size-4 animate-spin mx-auto" />
            </div>
            <div v-else-if="!versions.length" class="px-1.5 pb-1 text-[11px] text-white/40">
              No saved versions yet.
            </div>
            <div
              v-for="v in versions"
              :key="v.id"
              class="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-colors"
            >
              <div class="min-w-0 flex-1">
                <div class="text-[11px] text-white/85 truncate">{{ v.name || 'Untitled version' }}</div>
                <div class="text-[10px] text-white/35 tabular-nums">{{ timeAgo(v.createdAt) }}</div>
              </div>
              <button
                class="shrink-0 inline-flex items-center gap-1 h-6 px-1.5 rounded text-[10px] text-white/60 hover:text-white opacity-0 group-hover:opacity-100 bg-white/[0.06] hover:bg-white/[0.12] transition-all cursor-pointer disabled:opacity-50"
                :disabled="restoringId === v.id"
                title="Restore this version (replaces all canvases)"
                @click="onRestoreVersion(v.id)"
              >
                <Loader2 v-if="restoringId === v.id" class="size-2.5 animate-spin" /><RotateCcw v-else class="size-2.5" />
                Restore
              </button>
            </div>
          </div>
        </div>

        <!-- Spend -->
        <div
          v-if="spend && (projectUsd > 0 || spend.month.usd > 0)"
          class="border-t border-white/[0.06] px-3.5 py-2 flex items-center justify-between text-[10px] text-white/40 tabular-nums"
        >
          <span>This project · ~${{ projectUsd.toFixed(2) }}</span>
          <span>This month · ~${{ spend.month.usd.toFixed(2) }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>
