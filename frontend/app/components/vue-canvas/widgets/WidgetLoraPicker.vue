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
  // The paired strength slider, folded into the card. When scaleMax is set the
  // strength row renders below the picker button; otherwise the card is just the
  // launcher (backward-compatible with pickers that have no scale).
  scaleValue?: number
  scaleMin?: number
  scaleMax?: number
  scaleStep?: number
}>()
defineEmits<{
  'update:modelValue': [value: string]
  'update:scale': [value: number]
}>()

// Strength row shows only when a paired scale exists.
const hasScale = computed(() => props.scaleMax != null)
// Trim trailing zeros: 1 → "1", 0.9 → "0.9", 1.05 → "1.05".
const fmtScale = computed(() => String(parseFloat(Number(props.scaleValue ?? 1).toFixed(2))))

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
  <!-- Card owns the border/bg so the (interactive) strength slider can live
       inside it — a range input can't be nested in a <button>. -->
  <div class="nopan nodrag w-full rounded border border-white/10 bg-white/[0.04] hover:border-white/20 transition-colors">
    <button
      class="w-full flex items-center gap-2 px-2 py-1.5 rounded-t-[3px] hover:bg-white/[0.05] cursor-pointer text-left group transition-colors"
      :class="hasScale ? '' : 'rounded-b-[3px]'"
      :title="selected ? `${selected} — click to change ${noun}` : `Browse your ${noun === 'Character' ? 'Characters' : 'Styles'}`"
      @click="openGallery"
    >
      <span class="size-7 rounded-md shrink-0 flex items-center justify-center bg-white/[0.06] overflow-hidden ring-1 ring-inset ring-white/10">
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

    <!-- Folded strength slider -->
    <div v-if="hasScale" class="flex items-center gap-2 px-2 pb-1.5 pt-0.5">
      <span class="text-[8px] uppercase tracking-[0.06em] text-white/30 shrink-0">strength</span>
      <input
        type="range"
        class="lora-strength nopan nodrag nowheel flex-1 min-w-0"
        :min="scaleMin ?? 0"
        :max="scaleMax ?? 1.5"
        :step="scaleStep ?? 0.05"
        :value="scaleValue ?? 1"
        @input="$emit('update:scale', Number(($event.target as HTMLInputElement).value))"
        @mousedown.stop
        @click.stop
      />
      <span class="text-[9.5px] tabular-nums text-white/70 shrink-0 w-7 text-right">{{ fmtScale }}</span>
    </div>
  </div>
</template>

<style scoped>
.lora-strength {
  -webkit-appearance: none;
  appearance: none;
  height: 3px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.14);
  outline: none;
  cursor: pointer;
}
.lora-strength::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  transition: transform 0.1s ease;
}
.lora-strength:active::-webkit-slider-thumb { transform: scale(1.15); }
.lora-strength::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid rgba(0, 0, 0, 0.35);
  cursor: pointer;
}
</style>
