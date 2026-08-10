<script setup lang="ts">
/** Source chooser for adding an image to a Frame: "Upload from computer" plus
 *  the canvas-image grid (FillImagePicker). Content-only popover — the caller
 *  owns the trigger button and the `open` state, and must wrap both in a
 *  positioned (`relative`) container. */
import { ImagePlus } from 'lucide-vue-next'
import FillImagePicker from '~/components/vue-canvas/compositor/FillImagePicker.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ upload: []; pick: [src: string]; close: [] }>()
</script>

<template>
  <template v-if="open">
    <!-- click-away backdrop (below the panel) -->
    <div class="fixed inset-0 z-40" @click="emit('close')" />
    <div class="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-white/10 bg-[#1a1a1a] p-2 shadow-xl">
      <button
        type="button"
        class="mb-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-white/80 hover:bg-white/10 cursor-pointer"
        @click="emit('upload')"
      >
        <ImagePlus class="size-3.5" /> Upload from computer
      </button>
      <div class="mb-1 px-1 text-[10px] uppercase tracking-wide text-white/40">On the canvas</div>
      <FillImagePicker @pick="(s: string) => emit('pick', s)" />
    </div>
  </template>
</template>
