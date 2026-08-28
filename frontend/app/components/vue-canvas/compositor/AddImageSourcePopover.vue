<script setup lang="ts">
/** Source chooser for adding an image to a Frame: "Upload from computer" plus
 *  the canvas-image grid (FillImagePicker). Rendered via <Teleport to="body">
 *  with fixed positioning so it escapes the Frame node / Compositor modal's
 *  overflow:hidden clipping (same reason StudioColor teleports). The caller owns
 *  the trigger button and the `open` state. inject('vueFlowNodes') inside
 *  FillImagePicker still resolves — Teleport moves DOM, not the component tree. */
import { ImagePlus, FileUp } from 'lucide-vue-next'
import FillImagePicker from '~/components/vue-canvas/compositor/FillImagePicker.vue'

/** `showImportSvg` turns this into the Compositor toolbar's Insert menu (the
 *  standalone Import-SVG button folded in here). The Frame node leaves it off,
 *  so its chooser is still image-only. */
defineProps<{ open: boolean, showImportSvg?: boolean }>()
const emit = defineEmits<{ upload: []; pick: [src: string]; importSvg: []; close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      @click.self="emit('close')"
    >
      <div class="w-72 rounded-lg border border-white/10 bg-[#1a1a1a] p-3 shadow-2xl">
        <div class="mb-2 text-[12px] font-medium text-white/80">{{ showImportSvg ? 'Insert' : 'Add an image' }}</div>
        <button
          type="button"
          data-testid="insert-upload"
          class="mb-1.5 flex w-full items-center gap-2 rounded border border-white/10 px-2 py-1.5 text-[12px] text-white/80 hover:bg-white/10 cursor-pointer"
          @click="emit('upload')"
        >
          <ImagePlus class="size-3.5" /> Upload from computer
        </button>
        <button
          v-if="showImportSvg"
          type="button"
          data-testid="insert-import-svg"
          class="mb-1.5 flex w-full items-center gap-2 rounded border border-white/10 px-2 py-1.5 text-[12px] text-white/80 hover:bg-white/10 cursor-pointer"
          @click="emit('importSvg')"
        >
          <FileUp class="size-3.5" /> Import SVG
        </button>
        <div class="mb-1 mt-1.5 text-[10px] uppercase tracking-wide text-white/40">On the canvas</div>
        <FillImagePicker @pick="(s: string) => emit('pick', s)" />
      </div>
    </div>
  </Teleport>
</template>
