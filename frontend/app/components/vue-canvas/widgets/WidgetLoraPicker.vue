<script setup lang="ts">
/**
 * WidgetLoraPicker — node-body launcher button that opens the LoRA gallery.
 * Replaces the standard Combo dropdown for the `lora_name` input (marked
 * `extra_dict={"comfynext_widget": "lora_picker"}` on FluxLoRARemoteNode).
 * The combo still serializes a plain filename string, so workflows stay
 * portable; the gallery modal writes lora_name + aesthetic + prompt back
 * to the node.
 */
import { computed, ref, watch } from 'vue'
import { Sparkles, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string   // selected LoRA filename, or "[None]"/empty
  nodeId?: string
  widgetName?: string  // which input this picker edits (default lora_name)
  kind?: 'character' | 'style'  // 'character' → Characters gallery + label
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()

// Noun shown on the button + used to title the gallery. A 'character' picker
// (e.g. the multi-LoRA node's slot A) browses your characters, not your styles.
const noun = computed(() => (props.kind === 'character' ? 'Character' : 'Style'))

const selected = computed(() => {
  const v = (props.modelValue || '').trim()
  if (!v || v === '[None]') return null
  return v.replace(/\.safetensors$/i, '').replace(/_/g, ' ')
})

// Show the LoRA's generated cover (if any) as the button thumbnail; the <img>
// errors to the sparkle fallback when no cover exists yet.
const coverError = ref(false)
const coverSrc = computed(() => {
  const v = (props.modelValue || '').trim()
  return v && v !== '[None]' ? `/api/lora-cover?name=${encodeURIComponent(v)}` : null
})
watch(() => props.modelValue, () => { coverError.value = false })

function openGallery() {
  window.dispatchEvent(new CustomEvent('comfynext:openLoraGallery', {
    detail: { nodeId: props.nodeId, widgetName: props.widgetName, kind: props.kind },
  }))
}
</script>

<template>
  <button
    class="nopan nodrag w-full flex items-center gap-2 px-2 py-1.5 rounded border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-colors cursor-pointer text-left group"
    :title="selected ? `${selected} — click to change ${noun}` : `Browse your ${noun === 'Character' ? 'Characters' : 'Styles'}`"
    @click="openGallery"
  >
    <span class="size-7 rounded-md shrink-0 flex items-center justify-center bg-white/[0.06] overflow-hidden">
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
      <span class="text-[9px] text-white/40 truncate uppercase tracking-[0.06em] leading-tight">
        {{ selected ? noun : 'open gallery' }}
      </span>
    </span>
    <ChevronRight class="size-3.5 text-white/30 group-hover:text-white/55 shrink-0 transition-colors" />
  </button>
</template>
