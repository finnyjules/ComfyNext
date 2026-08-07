<script setup lang="ts">
/**
 * WidgetLoraPicker — node-body launcher button that opens the LoRA gallery.
 * Replaces the standard Combo dropdown for the `lora_name` input (marked
 * `extra_dict={"sailor_widget": "lora_picker"}` on FluxLoRARemoteNode).
 * The combo still serializes a plain filename string, so workflows stay
 * portable; the gallery modal writes lora_name + aesthetic + prompt back
 * to the node.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Sparkles, ChevronRight, X } from 'lucide-vue-next'
import { useMoodboards } from '~/composables/useMoodboards'
// By path, not auto-import: Nuxt collapses a duplicated path segment, so
// `studio/StudioSlider.vue` is `VueCanvasStudioSlider` — and a name that does not
// resolve renders NOTHING, silently. Bit us once already in ComfyNodeWidget.
import StudioSlider from '~/components/vue-canvas/studio/StudioSlider.vue'

const props = defineProps<{
  modelValue: string   // selected LoRA filename, or "[None]"/empty
  nodeId?: string
  widgetName?: string  // which input this picker edits (default lora_name)
  kind?: 'character' | 'style'  // 'character' → Characters gallery + label
  // The paired strength slider, folded into the card. When scaleMax is set the
  // strength row renders below the picker button; otherwise the card is just the
  // launcher (backward-compatible with pickers that have no scale).
  scaleValue?: number
  scaleMin?: number
  scaleMax?: number
  scaleStep?: number
  // Moodboard entry id when this slot holds a moodboard instead of a LoRA
  // (properties.sailor_moodboard_<letter> — moodboards plan 2026-08-06, Task
  // A7). The pick is weightless, so modelValue stays '[None]': this prop is
  // what flips the card from the empty state to the board's name + first image.
  moodboardId?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:scale': [value: number]
  clear: []
}>()

// Moodboard slot: resolve the entry (name) from the app-level library and the
// board's FIRST image (the entry only stores its folder) from the guarded list
// route — the MoodboardNode.vue pattern.
const { byId: moodboardById, loaded: moodboardsLoaded, refresh: refreshMoodboards } = useMoodboards()
onMounted(() => { if (props.moodboardId && !moodboardsLoaded.value) void refreshMoodboards() })
watch(() => props.moodboardId, (id) => { if (id && !moodboardsLoaded.value) void refreshMoodboards() })
const moodboardEntry = computed(() => (props.moodboardId ? moodboardById(props.moodboardId) : undefined))
const moodboardThumb = ref<string | null>(null)
watch(() => moodboardEntry.value?.folder, async (folder) => {
  moodboardThumb.value = null
  if (!folder) return
  try {
    const res = await fetch(`/api/moodboards/images?folder=${encodeURIComponent(folder)}`)
    if (!res.ok) return
    const first = ((await res.json()).files ?? [])[0]
    if (first) moodboardThumb.value =
      `/api/moodboards/images?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(first)}`
  } catch { /* offline dev — sparkle fallback */ }
}, { immediate: true })

// Strength row shows only when a paired scale exists — and never for a
// moodboard slot: a moodboard is weightless, there is no strength to scale.
// (ComfyNode already withholds scaleDef for moodboard slots; this guard keeps
// the invariant local to the card too.)
const hasScale = computed(() => props.scaleMax != null && !props.moodboardId)
// Name the folded scale by what it drives, so it reads clearly (and stops
// colliding with the node's other "strength" sliders) instead of a bare "strength".
const scaleLabel = computed(() =>
  props.kind === 'character' ? 'Character strength'
  : props.kind === 'style' ? 'Style strength'
  : 'Strength')

// Noun shown on the button + used to title the gallery. A 'character' picker
// (e.g. the multi-LoRA node's slot A) browses your characters, not your styles.
const noun = computed(() => (props.kind === 'character' ? 'Character' : 'Style'))
// What the FILLED card actually holds — a moodboard slot says so, whatever the
// slot's own kind framing is.
const heldNoun = computed(() => (props.moodboardId ? 'Moodboard' : noun.value))

const selected = computed(() => {
  // Moodboard slot: the picker widget itself is '[None]' (weightless pick), so
  // the board's name IS the selection. Fall back to a generic label while the
  // library list is still loading rather than flashing the empty state.
  if (props.moodboardId) return moodboardEntry.value?.name ?? 'Moodboard'
  const v = (props.modelValue || '').trim()
  if (!v || v === '[None]') return null
  return v.replace(/\.safetensors$/i, '').replace(/_/g, ' ')
})

// Show the LoRA's generated cover (or the moodboard's first board image) as
// the button thumbnail; the <img> errors to the sparkle fallback when no
// cover exists yet.
const coverError = ref(false)
const coverSrc = computed(() => {
  if (props.moodboardId) return moodboardThumb.value
  const v = (props.modelValue || '').trim()
  return v && v !== '[None]' ? `/api/lora-cover?name=${encodeURIComponent(v)}` : null
})
watch(() => [props.modelValue, props.moodboardId], () => { coverError.value = false })

function openGallery() {
  window.dispatchEvent(new CustomEvent('sailor:openLoraGallery', {
    detail: { nodeId: props.nodeId, widgetName: props.widgetName, kind: props.kind },
  }))
}

function clearSlot(event: MouseEvent) {
  // Stop propagation: the × is a SIBLING of the launcher <button> (you can't nest a
  // button in a button), overlapping its top-right corner, so a click here must not
  // also open the gallery.
  event.stopPropagation()
  emit('clear')
}
</script>

<template>
  <!-- No card border and no card fill. The wrapper is now only what the clear (×)
       needs — it can't nest inside the launcher <button>, so it renders as an
       absolutely-positioned SIBLING and something has to be `relative`. The launcher
       and the strength row carry their own fill instead, at the app's 6px control
       radius, and sit 6px apart like any two items in a group. A bordered box holding
       a fill holding a row was three nested surfaces for two controls. -->
  <div class="nopan nodrag relative flex w-full flex-col gap-1.5">
    <button
      class="w-full flex items-center gap-2 px-2 py-1.5 rounded-[6px] bg-white/[0.05] hover:bg-white/[0.08] cursor-pointer text-left group transition-colors"
      :title="selected ? `${selected} — click to change ${heldNoun}` : `Browse your ${noun === 'Character' ? 'Characters' : 'Styles'}`"
      @click="openGallery"
    >
      <span class="size-7 rounded-[6px] shrink-0 flex items-center justify-center bg-white/[0.06] overflow-hidden ring-1 ring-inset ring-white/10">
        <img
          v-if="coverSrc && !coverError"
          :src="coverSrc"
          class="w-full h-full object-cover"
          loading="lazy"
          @error="coverError = true"
        />
        <Sparkles v-else class="size-3 text-white/70" />
      </span>
      <span class="flex flex-col min-w-0 flex-1">
        <span class="text-[11px] font-medium truncate leading-tight" :class="selected ? 'text-white/90' : 'text-white/55'">
          {{ selected ?? `Choose a ${noun}` }}
        </span>
        <!-- Only when something is selected, where it names the KIND of thing the row
             holds. Empty, this used to read "OPEN GALLERY" — which "Choose a Style" and
             the chevron already say twice over. The height does not move between the two
             states: the 28px tile governs it, not the text. -->
        <span
          v-if="selected"
          class="text-[9px] text-white/40 truncate uppercase tracking-[0.06em] leading-tight"
        >{{ heldNoun }}</span>
      </span>
      <ChevronRight class="size-3.5 text-white/30 group-hover:text-white/55 shrink-0 transition-colors" />
    </button>

    <!-- Clear affordance — only when this slot actually holds a LoRA. Sibling
         of the launcher <button>, not nested inside it. -->
    <button
      v-if="selected"
      type="button"
      class="nopan nodrag absolute -top-1.5 -right-1.5 z-10 size-4 rounded-full bg-[#1c1c1c] border border-white/15 flex items-center justify-center text-white/50 hover:text-white hover:border-white/40 hover:bg-[#2a2a2a] transition-colors cursor-pointer"
      :aria-label="`Remove this ${heldNoun.toLowerCase()}`"
      :title="`Remove this ${heldNoun.toLowerCase()}`"
      @click="clearSlot"
      @mousedown.stop
    >
      <X class="size-2.5" />
    </button>

    <!-- The folded strength, as the same 28px row every other control in the node is.
         It was the last label-above-a-rail control on a node, which is what made this
         card look older than what surrounds it. `:bindable="false"` because nodes bind
         by wire, not by Collection column — see ComfyNodeWidget for the same reason. -->
    <div v-if="hasScale" class="nopan nodrag nowheel">
      <StudioSlider
        :label="scaleLabel"
        :min="scaleMin ?? 0"
        :max="scaleMax ?? 1.5"
        :step="scaleStep ?? 0.05"
        :default="1"
        :bindable="false"
        :model-value="scaleValue ?? 1"
        @update:model-value="$emit('update:scale', Number($event))"
      />
    </div>
  </div>
</template>
