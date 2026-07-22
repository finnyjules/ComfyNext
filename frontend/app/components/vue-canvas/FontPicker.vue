<script setup lang="ts">
/**
 * FontPicker — shared searchable Google Fonts dropdown (extracted from Type
 * Studio). Trigger button opens an inline panel: search + ✨ describe-a-font AI
 * suggest (with in-face previews), an optional "Variable fonts only" toggle, an
 * optional caller-provided pinned list shown above the catalog under a small
 * "Sailor" header, and the filtered Google catalog (capped at 120 rows) with
 * `var` badges for variable faces. Owns all open/search/suggest state
 * internally; closes + clears the search on select.
 */
import { loadGoogleCatalog, type GoogleFont } from '~/data/google-fonts'
import StudioSwitch from '~/components/vue-canvas/studio/StudioSwitch.vue'

withDefaults(defineProps<{
  modelValue: string
  pinned?: { label: string; value: string }[]
  showVariableToggle?: boolean
}>(), {
  showVariableToggle: true,
})

const emit = defineEmits<{
  (e: 'select', payload: { kind: 'google'; family: string } | { kind: 'pinned'; value: string }): void
}>()

// Full Google Fonts catalog (~1900 families), fetched once via the shared proxy and
// used to populate the searchable font picker.
const fontCatalog = ref<GoogleFont[]>([])
loadGoogleCatalog().then((c) => { fontCatalog.value = c })

// Custom searchable font dropdown (a native <select> can't show 1900 options nicely,
// and a datalist has no visible affordance). Open/close + live filter, capped for perf.
const fontPickerOpen = ref(false)
const fontSearch = ref('')
const variableOnly = ref(false)
// A font is variable when it has a registered axis with an actual range (max > min).
const isVar = (f: GoogleFont) => f.axes.some(a => a.max > a.min)
const varAxes = (f: GoogleFont) => f.axes.filter(a => a.max > a.min).map(a => a.tag).join(' ')
const filteredFonts = computed(() => {
  const q = fontSearch.value.trim().toLowerCase()
  let list = fontCatalog.value
  if (variableOnly.value) list = list.filter(isVar)
  const matched = q ? list.filter(f => f.family.toLowerCase().includes(q)) : list
  return matched.slice(0, 120)
})
function closePicker() {
  fontPickerOpen.value = false
  fontSearch.value = ''
}
function selectGoogle(family: string) {
  emit('select', { kind: 'google', family })
  closePicker()
}
function selectPinned(value: string) {
  emit('select', { kind: 'pinned', value })
  closePicker()
}

// ✨ Describe-a-font search: type a description ("fonts like the Knicks logo"),
// an LLM suggests real Google families (grounded against fontCatalog), shown atop
// the literal list. Faces are loaded so each suggestion row previews in-face.
const { suggestions: fontSuggestions, loading: fontSuggestLoading, error: fontSuggestError, hasRun: fontSuggestRan, suggest: runFontSuggestApi, clear: clearFontSuggest } = useFontSuggest()
const { ensure: ensureFontFace } = useGoogleFontPreview()
function runFontSuggest() { runFontSuggestApi(fontSearch.value) }
watch(fontSuggestions, (list) => { for (const s of list) ensureFontFace(s.family) })
watch(fontSearch, () => { if (fontSuggestRan.value) clearFontSuggest() })
// Reset suggestions whenever the picker closes so a stale list doesn't reappear.
watch(fontPickerOpen, (open) => { if (!open && fontSuggestRan.value) clearFontSuggest() })
</script>

<template>
  <button type="button" @click="fontPickerOpen = !fontPickerOpen"
          class="flex w-full items-center justify-between rounded bg-white/10 px-2 py-1 text-left">
    <span class="truncate">{{ modelValue || 'Select font…' }}</span>
    <span class="ml-2 shrink-0 text-white/40">{{ fontPickerOpen ? '▴' : '▾' }}</span>
  </button>
  <div v-if="fontPickerOpen" class="mt-1 rounded bg-black/40 p-1">
    <div class="mb-1 flex items-center gap-1">
      <input v-model="fontSearch" placeholder="Search or describe fonts…" autofocus
             @keydown.enter.prevent="runFontSuggest"
             class="w-full flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1" />
      <button type="button" title="Suggest fonts from a description"
              :disabled="fontSuggestLoading" @click="runFontSuggest"
              class="shrink-0 whitespace-nowrap rounded border border-white/[0.08] bg-white/[0.04] px-2 py-1 hover:border-white/25 disabled:opacity-40">✨ Ask AI</button>
    </div>
    <label v-if="showVariableToggle" class="mb-1 flex items-center justify-between px-1 py-0.5 text-[11px] text-white/55">
      <span>Variable fonts only</span>
      <StudioSwitch v-model="variableOnly" />
    </label>
    <!-- ✨ Suggested (from a description) -->
    <div v-if="fontSuggestLoading || fontSuggestError || fontSuggestions.length || fontSuggestRan" class="mb-1">
      <p class="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wider text-white/40">✨ Suggested</p>
      <p v-if="fontSuggestLoading" class="px-2 py-1 text-white/40">Finding fonts…</p>
      <p v-else-if="fontSuggestError" class="px-2 py-1 text-white/40">{{ fontSuggestError }}</p>
      <p v-else-if="!fontSuggestions.length" class="px-2 py-1 text-white/40">No matches — try describing the style differently.</p>
      <button v-for="s in fontSuggestions" :key="'s' + s.family" type="button"
              @click="selectGoogle(s.family)"
              class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10"
              :class="{ 'bg-white/15': modelValue === s.family }">
        <span class="min-w-0 flex-1">
          <span class="block truncate" :style="{ fontFamily: s.family }">{{ s.family }}</span>
          <span class="block truncate text-[10px] text-white/40">{{ s.reason }}</span>
        </span>
        <span class="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-white/40">{{ s.category }}</span>
      </button>
      <div class="mx-2 my-1 border-t border-white/10" />
    </div>
    <!-- Pinned (caller-provided, e.g. Sailor house fonts) — above the catalog. -->
    <div v-if="pinned?.length" class="mb-1">
      <p class="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wider text-white/40">Sailor</p>
      <button v-for="p in pinned" :key="'p' + p.value" type="button"
              @click="selectPinned(p.value)"
              class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10"
              :class="{ 'bg-white/15': modelValue === p.value }">
        <span class="truncate">{{ p.label }}</span>
      </button>
    </div>
    <div class="max-h-48 overflow-y-auto">
      <button v-for="f in filteredFonts" :key="f.family" type="button"
              @click="selectGoogle(f.family)"
              class="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/10"
              :class="{ 'bg-white/15': modelValue === f.family }">
        <span class="truncate">{{ f.family }}</span>
        <span v-if="isVar(f)" :title="`Variable axes: ${varAxes(f)}`"
              class="ml-auto shrink-0 rounded bg-white/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-white/70">var</span>
      </button>
      <p v-if="!fontCatalog.length" class="px-2 py-1 text-white/40">Loading fonts…</p>
      <p v-else-if="!filteredFonts.length" class="px-2 py-1 text-white/40">No matches</p>
    </div>
  </div>
</template>
