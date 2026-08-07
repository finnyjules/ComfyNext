<script setup lang="ts">
/**
 * WidgetMoodboardChip — compact moodboard row on the Generate-an-image node
 * face (moodboards Plan B, Task B2). Not a schema widget: the node's
 * `style_block`/`style_refs` inputs stay `sailor_widget: "internal"` (hidden),
 * and the chip's state lives entirely in node PROPERTIES
 * (`sailor_moodboard` + `aesthetic` — see lib/graph/moodboardApply.ts).
 *
 * Empty state: a small "＋ Moodboard" affordance that opens the LoRA gallery
 * on the Moodboards tab. Filled: the board's name + first image + ✕ to clear.
 * Name/thumb resolution mirrors WidgetLoraPicker's moodboard slot (the entry
 * only stores its folder; the first file comes from the guarded list route).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Sparkles, Plus, X } from 'lucide-vue-next'
import { useMoodboards } from '~/composables/useMoodboards'

const props = defineProps<{
  // Applied board id (properties.sailor_moodboard), empty/undefined when none.
  moodboardId?: string
}>()
const emit = defineEmits<{ open: []; clear: [] }>()

const { byId: moodboardById, loaded: moodboardsLoaded, refresh: refreshMoodboards } = useMoodboards()
onMounted(() => { if (props.moodboardId && !moodboardsLoaded.value) void refreshMoodboards() })
watch(() => props.moodboardId, (id) => { if (id && !moodboardsLoaded.value) void refreshMoodboards() })
const entry = computed(() => (props.moodboardId ? moodboardById(props.moodboardId) : undefined))

const thumb = ref<string | null>(null)
watch(() => entry.value?.folder, async (folder) => {
  thumb.value = null
  if (!folder) return
  try {
    const res = await fetch(`/api/moodboards/images?folder=${encodeURIComponent(folder)}`)
    if (!res.ok) return
    const first = ((await res.json()).files ?? [])[0]
    if (first) thumb.value =
      `/api/moodboards/images?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(first)}`
  } catch { /* offline dev — sparkle fallback */ }
}, { immediate: true })
const thumbError = ref(false)
watch(() => props.moodboardId, () => { thumbError.value = false })
</script>

<template>
  <div class="nopan nodrag" data-testid="generate-moodboard-chip">
    <!-- Filled: name + thumb + ✕ -->
    <div
      v-if="moodboardId"
      class="w-full flex items-center gap-2 px-2 py-1 rounded-[6px] bg-white/[0.05] group"
    >
      <button
        class="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
        :title="`${entry?.name ?? 'Moodboard'} — click to change moodboard`"
        data-testid="generate-moodboard-chip-open"
        @click="emit('open')"
      >
        <span class="size-5 rounded-[4px] shrink-0 flex items-center justify-center bg-white/[0.06] overflow-hidden ring-1 ring-inset ring-white/10">
          <img
            v-if="thumb && !thumbError"
            :src="thumb"
            class="w-full h-full object-cover"
            loading="lazy"
            @error="thumbError = true"
          />
          <Sparkles v-else class="size-2.5 text-white/70" />
        </span>
        <span class="flex flex-col min-w-0 flex-1 leading-tight">
          <span class="text-[10.5px] font-medium text-white/85 truncate">{{ entry?.name ?? 'Moodboard' }}</span>
          <span class="text-[8.5px] uppercase tracking-[0.06em] text-white/40">Moodboard</span>
        </span>
      </button>
      <button
        type="button"
        class="shrink-0 size-4 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.12] transition-colors cursor-pointer"
        aria-label="Remove this moodboard"
        title="Remove this moodboard"
        data-testid="generate-moodboard-chip-clear"
        @click.stop="emit('clear')"
        @mousedown.stop
      >
        <X class="size-2.5" />
      </button>
    </div>

    <!-- Empty: small "+ Moodboard" affordance -->
    <button
      v-else
      class="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] text-white/45 hover:text-white/80 bg-white/[0.03] hover:bg-white/[0.07] transition-colors cursor-pointer"
      title="Apply a moodboard's style to this generation"
      data-testid="generate-moodboard-chip-add"
      @click="emit('open')"
    >
      <Plus class="size-2.5" /> Moodboard
    </button>
  </div>
</template>
