<script setup lang="ts">
/**
 * /dev/image-search — harness for the web-image-search picker (the "pick" half
 * of the canvas agent's searchImages command), exercised without an LLM
 * round-trip. Type a query, open the picker, select + import; imports upload
 * to the ComfyUI input folder and the addAssetNode events are logged below
 * (on the real canvas, VueNodeCanvas turns each into an Image node).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ImageSearchPickerModal from '~/components/agent/ImageSearchPickerModal.vue'

const query = ref('kylian mbappe full body france jersey')
const open = ref(false)
const log = ref<string[]>([])

function onAsset(e: Event) {
  const d = (e as CustomEvent).detail
  log.value.push(`addAssetNode → ${JSON.stringify(d)}`)
}
onMounted(() => window.addEventListener('comfynext:addAssetNode', onAsset))
onBeforeUnmount(() => window.removeEventListener('comfynext:addAssetNode', onAsset))

function onDone(imported: number, failed: number) {
  open.value = false
  log.value.push(`done → imported ${imported}, failed ${failed}`)
}
</script>

<template>
  <div class="min-h-screen bg-[#101010] p-8 text-white/85">
    <h1 class="mb-4 text-[15px] font-medium">Web image search picker — dev harness</h1>
    <div class="mb-6 flex max-w-xl items-center gap-2">
      <input
        v-model="query" type="text"
        class="min-w-0 flex-1 rounded-[8px] bg-white/6 px-3 py-2 text-[13px] outline-none ring-1 ring-white/10 focus:ring-white/30"
        @keydown.enter="open = true"
      >
      <button class="shrink-0 rounded-[8px] bg-white px-3.5 py-2 text-[12.5px] font-medium text-neutral-900 hover:bg-white/90" @click="open = true">
        Open picker
      </button>
    </div>
    <div class="max-w-3xl space-y-1 font-mono text-[11px] text-white/50">
      <p v-for="(line, i) in log" :key="i">{{ line }}</p>
    </div>
    <ImageSearchPickerModal :open="open" :query="query" @close="open = false" @done="onDone" />
  </div>
</template>
