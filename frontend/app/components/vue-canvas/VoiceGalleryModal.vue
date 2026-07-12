<script setup lang="ts">
/**
 * VoiceGalleryModal — voice picker for the "Generate speech" node. Wraps
 * CatalogModal with voice-specific cards so the user can audition each MiniMax
 * voice (pre-baked clips under /voice-samples/) before committing.
 *
 * State path:
 *   node.widgetsValues[voice_idx] = selected voice id  (Combo widget)
 *
 * Only one preview plays at a time — a single shared <audio> element; starting
 * a new voice replaces the previous. Audio is torn down when the modal closes.
 */
import { computed, ref, onBeforeUnmount, onMounted } from 'vue'
import { Play, Pause, Mic, VolumeX } from 'lucide-vue-next'
import { galleryVoices, type VoiceMeta, type VoiceCategory, type ClonedVoice } from '~/lib/voiceCatalog'

const props = defineProps<{
  nodeId: string
  nodes: any[]
  widgetName?: string   // which input this picker edits (default voice_id)
  options?: string[]    // the combo's voice ids
}>()

const emit = defineEmits<{ close: [] }>()

const node = computed(() => props.nodes.find(n => n.id === props.nodeId))

const voiceWidgetIdx = computed(() => {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex(d => d.name === (props.widgetName || 'voice_id'))
})

const currentVoiceId = computed<string | null>(() => {
  const idx = voiceWidgetIdx.value
  if (idx < 0) return null
  const val = node.value?.data?.widgetsValues?.[idx]
  return typeof val === 'string' ? val : null
})

// Voice ids come from the launcher; fall back to the node's own combo options.
const optionIds = computed<string[]>(() => {
  if (props.options?.length) return props.options
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  const def = defs.find(d => d.name === (props.widgetName || 'voice_id'))
  return (def?.options ?? []) as string[]
})

// -- Cloned ("Your") voices, fetched from the backend store ------------------

const clonedVoices = ref<ClonedVoice[]>([])
async function loadCloned() {
  try {
    const r = await $fetch<{ voices: ClonedVoice[] }>('/api/voices-local')
    clonedVoices.value = r.voices ?? []
  } catch { clonedVoices.value = [] }
}
onMounted(() => {
  loadCloned()
  // A clone just finished in the Train tab → refresh "Your voices".
  window.addEventListener('sailor:voicesUpdated', loadCloned)
})
onBeforeUnmount(() => window.removeEventListener('sailor:voicesUpdated', loadCloned))

const allVoices = computed<VoiceMeta[]>(() => galleryVoices(optionIds.value, clonedVoices.value))

// -- Filter + search ---------------------------------------------------------

const searchQuery = ref('')
const activeFilterId = ref<string>('all')

// Source-based pills: All · Default voices · Your voices. "Your voices" always
// shows (even at 0) so the empty state can nudge toward the Train tab.
const filters = computed(() => {
  const defaults = allVoices.value.filter(v => v.source === 'default').length
  const yours = allVoices.value.filter(v => v.source === 'cloned').length
  return [
    { id: 'all', label: 'All', count: allVoices.value.length },
    { id: 'default', label: 'Default voices', count: defaults },
    { id: 'cloned', label: 'Your voices', count: yours },
  ]
})

const emptyMessage = computed(() => activeFilterId.value === 'cloned'
  ? 'No cloned voices yet — Train a voice in the Train tab.'
  : 'No voices match those filters.')

const visibleItems = computed<VoiceMeta[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return allVoices.value.filter((v) => {
    if (activeFilterId.value === 'default' && v.source !== 'default') return false
    if (activeFilterId.value === 'cloned' && v.source !== 'cloned') return false
    if (!q) return true
    return v.label.toLowerCase().includes(q) || v.id.toLowerCase().includes(q)
  })
})

// -- Preview audio (single element, one at a time) ---------------------------

const previewAudio = ref<HTMLAudioElement | null>(null)
const playingId = ref<string | null>(null)
const broken = ref<Set<string>>(new Set())  // sample urls that failed to load

function ensureAudio(): HTMLAudioElement {
  if (!previewAudio.value) {
    const el = new Audio()
    el.addEventListener('ended', () => { playingId.value = null })
    previewAudio.value = el
  }
  return previewAudio.value
}

function stop() {
  if (previewAudio.value) {
    previewAudio.value.pause()
    previewAudio.value.currentTime = 0
  }
  playingId.value = null
}

function togglePreview(v: VoiceMeta) {
  if (!v.sampleUrl || broken.value.has(v.id)) return
  if (playingId.value === v.id) { stop(); return }
  const el = ensureAudio()
  el.src = v.sampleUrl
  playingId.value = v.id
  el.play().catch(() => {
    broken.value = new Set(broken.value).add(v.id)
    if (playingId.value === v.id) playingId.value = null
  })
}

function isPlayable(v: VoiceMeta): boolean {
  return !!v.sampleUrl && !broken.value.has(v.id)
}

onBeforeUnmount(stop)

// -- Commit ------------------------------------------------------------------

function onConfirm(item: VoiceMeta) {
  const idx = voiceWidgetIdx.value
  if (idx >= 0 && node.value?.data?.widgetsValues) {
    node.value.data.widgetsValues[idx] = item.id
  }
  emit('close')
}

const CATEGORY_ICON: Record<VoiceCategory, any> = { Female: Mic, Male: Mic, Character: Mic, Cloned: Mic }
</script>

<template>
  <CatalogModal
    :open="true"
    title="Choose a voice"
    :subtitle="`${allVoices.length} voices · MiniMax Speech-02 · click ▶ to preview`"
    :items="visibleItems"
    :selected-id="currentVoiceId"
    :filters="filters"
    :active-filter-id="activeFilterId"
    :search-query="searchQuery"
    search-placeholder="Search voices…"
    :confirm-label="'Use voice'"
    :empty-message="emptyMessage"
    @close="emit('close')"
    @confirm="(item: any) => onConfirm(item as VoiceMeta)"
    @update:selected-id="() => {}"
    @update:active-filter-id="(id: string) => activeFilterId = id"
    @update:search-query="(q: string) => searchQuery = q"
  >
    <!-- Card -->
    <template #card="{ item, focused }">
      <div class="p-3 flex items-center gap-3">
        <!-- Play / pause preview — a non-button (cards are themselves buttons),
             click.stop so auditioning doesn't change the focused selection. -->
        <div
          role="button"
          :tabindex="isPlayable(item as VoiceMeta) ? 0 : -1"
          class="size-10 rounded-full shrink-0 flex items-center justify-center border transition-colors"
          :class="!isPlayable(item as VoiceMeta)
            ? 'border-white/[0.06] bg-white/[0.02] text-white/25 cursor-not-allowed'
            : playingId === (item as VoiceMeta).id
              ? 'border-action/40 bg-action/15 text-action cursor-pointer'
              : 'border-white/15 bg-white/[0.05] text-white/80 hover:bg-white/[0.1] hover:border-white/30 cursor-pointer'"
          :title="isPlayable(item as VoiceMeta)
            ? (playingId === (item as VoiceMeta).id ? 'Stop' : 'Preview voice')
            : 'No preview available'"
          @click.stop="togglePreview(item as VoiceMeta)"
          @keydown.enter.stop.prevent="togglePreview(item as VoiceMeta)"
        >
          <VolumeX v-if="!isPlayable(item as VoiceMeta)" class="size-4" />
          <Pause v-else-if="playingId === (item as VoiceMeta).id" class="size-4" />
          <Play v-else class="size-4 translate-x-px" />
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <span class="text-[13px] font-semibold text-white/90 truncate leading-tight">
            {{ (item as VoiceMeta).label }}
          </span>
          <span class="mt-1 self-start inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.08em] font-medium px-1.5 py-0.5 rounded leading-none bg-white/[0.05] text-white/55">
            <component :is="CATEGORY_ICON[(item as VoiceMeta).category]" class="size-2.5" />
            {{ (item as VoiceMeta).category }}
          </span>
        </div>
        <!-- Animated equalizer while this voice is playing -->
        <div v-if="playingId === (item as VoiceMeta).id" class="flex items-end gap-0.5 h-4 pr-1">
          <span v-for="b in 3" :key="b" class="w-0.5 bg-action/80 rounded-full voice-eq-bar" :style="{ animationDelay: `${b * 120}ms` }" />
        </div>
      </div>
    </template>

    <!-- Detail pane -->
    <template #detail="{ item }">
      <div class="p-5 flex flex-col items-center text-center gap-5">
        <div class="text-sm font-semibold text-white/95">{{ (item as VoiceMeta).label }}</div>
        <button
          class="size-20 rounded-full flex items-center justify-center border transition-colors"
          :class="!isPlayable(item as VoiceMeta)
            ? 'border-white/[0.06] bg-white/[0.02] text-white/25 cursor-not-allowed'
            : playingId === (item as VoiceMeta).id
              ? 'border-action/40 bg-action/15 text-action cursor-pointer'
              : 'border-white/15 bg-white/[0.05] text-white/85 hover:bg-white/[0.1] hover:border-white/30 cursor-pointer'"
          :disabled="!isPlayable(item as VoiceMeta)"
          @click="togglePreview(item as VoiceMeta)"
        >
          <Pause v-if="playingId === (item as VoiceMeta).id" class="size-7" />
          <Play v-else class="size-7 translate-x-0.5" />
        </button>
        <p class="text-[11px] text-white/45 leading-relaxed">
          <template v-if="isPlayable(item as VoiceMeta)">
            Sample says: <span class="text-white/65">“Hi there — this is what I sound like.”</span>
          </template>
          <template v-else>No preview clip is available for this voice yet.</template>
        </p>
        <span class="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] px-2 py-1 rounded bg-white/[0.05] text-white/55">
          {{ (item as VoiceMeta).category }}
        </span>
      </div>
    </template>
  </CatalogModal>
</template>

<style scoped>
.voice-eq-bar {
  height: 35%;
  animation: voice-eq 0.6s ease-in-out infinite alternate;
}
@keyframes voice-eq {
  from { height: 25%; }
  to { height: 100%; }
}
</style>
