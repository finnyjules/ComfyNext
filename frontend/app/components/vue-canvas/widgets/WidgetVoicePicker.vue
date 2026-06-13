<script setup lang="ts">
/**
 * WidgetVoicePicker — node-body launcher button that opens the voice gallery.
 * Replaces the standard Combo dropdown for the `voice_id` input on the
 * "Generate speech" node (marked extra_dict={"comfynext_widget":"voice_picker"}).
 * The combo still serializes a plain voice-id string, so workflows stay portable;
 * the gallery lets the user audition each voice before committing.
 */
import { computed } from 'vue'
import { Mic, ChevronRight } from 'lucide-vue-next'
import { voiceMetaFor } from '~/lib/voiceCatalog'

const props = defineProps<{
  modelValue: string        // selected voice id (e.g. "Wise_Woman")
  nodeId?: string
  widgetName?: string       // which input this picker edits (default voice_id)
  options?: string[]        // the combo's voice ids, forwarded to the gallery
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()

const meta = computed(() => {
  const v = (props.modelValue || '').trim()
  return v ? voiceMetaFor(v) : null
})

function openGallery() {
  window.dispatchEvent(new CustomEvent('comfynext:openVoiceGallery', {
    detail: {
      nodeId: props.nodeId,
      widgetName: props.widgetName,
      options: props.options ?? [],
    },
  }))
}
</script>

<template>
  <label class="text-[9px] text-muted-foreground tracking-normal mb-0.5 block">Voice</label>
  <button
    class="nopan nodrag w-full flex items-center gap-2 px-2 py-1.5 rounded border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-colors cursor-pointer text-left group"
    :title="meta ? `${meta.label} — click to change voice` : 'Browse and preview voices'"
    @click="openGallery"
  >
    <span class="size-7 rounded-md shrink-0 flex items-center justify-center bg-white/[0.06]">
      <Mic class="size-3.5 text-white/70" />
    </span>
    <span class="flex flex-col min-w-0 flex-1">
      <span class="text-[11px] font-medium truncate leading-tight" :class="meta ? 'text-white/90' : 'text-white/55'">
        {{ meta?.label ?? 'Choose a voice' }}
      </span>
      <span class="text-[9px] text-white/40 truncate uppercase tracking-[0.06em] leading-tight">
        {{ meta ? `${meta.category} · preview` : 'open gallery' }}
      </span>
    </span>
    <ChevronRight class="size-3.5 text-white/30 group-hover:text-white/55 shrink-0 transition-colors" />
  </button>
</template>
