<script setup lang="ts">
/**
 * VersionsPanel — left canvas panel: save named snapshots of the current
 * project and restore them. Mirrors the AssetsPanel shell. The rolling "current"
 * autosave is hidden; this lists manual save points only. Restore is delegated
 * to the parent (which owns the canvas) via the `restore` emit.
 */
import { ref, watch, onMounted } from 'vue'
import { History, X, Save, RotateCcw, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  projectId: string | null
  projectName: string
  getWorkflow: () => any
}>()
const emit = defineEmits<{ close: []; restore: [workflow: any] }>()

const { versions, loading, refresh, saveNamed, getVersionWorkflow } = useVersions()

const saving = ref(false)
const restoringId = ref<string | null>(null)
const newName = ref('')

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

async function onSave() {
  if (!props.projectId || saving.value) return
  const wf = props.getWorkflow?.()
  if (!wf || !(wf.nodes?.length > 0)) return
  saving.value = true
  try {
    await saveNamed(props.projectId, newName.value.trim(), wf, props.projectName)
    newName.value = ''
  } finally {
    saving.value = false
  }
}

async function onRestore(vid: string) {
  if (!props.projectId || restoringId.value) return
  restoringId.value = vid
  try {
    const wf = await getVersionWorkflow(props.projectId, vid)
    if (wf) emit('restore', wf)
  } finally {
    restoringId.value = null
  }
}

watch(() => props.projectId, (id) => refresh(id))
onMounted(() => refresh(props.projectId))
</script>

<template>
  <div class="h-full bg-[#1a1a1a]/95 backdrop-blur-md border-r border-white/10 flex flex-col shadow-2xl">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <div class="flex items-center gap-2">
        <History class="size-4 text-white/70" />
        <span class="text-sm font-semibold text-white/90">Versions</span>
      </div>
      <button
        class="flex items-center justify-center size-6 rounded hover:bg-white/10 transition-colors cursor-pointer"
        @click="emit('close')"
      >
        <X class="size-4 text-white/60" />
      </button>
    </div>

    <!-- Save a version -->
    <div class="px-3 pt-3 pb-2 flex items-center gap-2">
      <input
        v-model="newName"
        type="text"
        placeholder="Name this version…"
        :disabled="!projectId"
        class="flex-1 min-w-0 bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-xs text-white/85 placeholder-white/30 outline-none focus:border-white/20 disabled:opacity-50"
        @keydown.enter="onSave"
      />
      <button
        class="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-white/85 transition-colors cursor-pointer disabled:opacity-50"
        :disabled="!projectId || saving"
        title="Save the current canvas as a named version"
        @click="onSave"
      >
        <Loader2 v-if="saving" class="size-3.5 animate-spin" /><Save v-else class="size-3.5" />
        Save
      </button>
    </div>

    <!-- List -->
    <div class="flex-1 overflow-y-auto px-2 pb-3">
      <div v-if="!projectId" class="px-4 py-12 text-center text-xs text-white/40 leading-relaxed">
        Open or run a project to start saving versions.
      </div>
      <div v-else-if="loading && !versions.length" class="px-2 py-12 text-center text-xs text-white/40">
        <Loader2 class="size-5 animate-spin mx-auto mb-2" /> Loading…
      </div>
      <div v-else-if="!versions.length" class="px-4 py-12 text-center text-xs text-white/40 leading-relaxed">
        No saved versions yet. Name one above and hit Save to snapshot the current canvas.
      </div>
      <div v-else class="flex flex-col gap-1">
        <div
          v-for="v in versions"
          :key="v.id"
          class="group flex items-center gap-2 rounded-lg px-2.5 py-2 bg-white/[0.03] border border-white/[0.06] hover:border-white/15 transition-colors"
        >
          <div class="min-w-0 flex-1">
            <div class="text-xs text-white/90 truncate">{{ v.name || 'Untitled version' }}</div>
            <div class="text-[10px] text-white/40 tabular-nums">{{ timeAgo(v.createdAt) }}</div>
          </div>
          <button
            class="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] text-white/70 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] transition-colors cursor-pointer disabled:opacity-50"
            :disabled="restoringId === v.id"
            title="Restore this version onto the canvas"
            @click="onRestore(v.id)"
          >
            <Loader2 v-if="restoringId === v.id" class="size-3 animate-spin" /><RotateCcw v-else class="size-3" />
            Restore
          </button>
        </div>
      </div>
    </div>

    <div class="px-3 py-2 border-t border-white/[0.06] text-[10px] text-white/35 leading-snug">
      Versions are manual snapshots of the whole canvas. Your latest work autosaves separately.
    </div>
  </div>
</template>
