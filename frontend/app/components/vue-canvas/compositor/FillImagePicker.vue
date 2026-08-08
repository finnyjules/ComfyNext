<script setup lang="ts">
/** Grid of the canvas's image-bearing nodes; picking one emits its current
 *  image URL (snapshot). Reads the live node list injected by VueNodeCanvas. */
import { computed, inject, type Ref } from 'vue'

const emit = defineEmits<{ pick: [src: string] }>()
const nodes = inject<Ref<any[]>>('vueFlowNodes')

interface Choice { id: string; src: string; label: string }
const choices = computed<Choice[]>(() => {
  const list = nodes?.value ?? []
  const out: Choice[] = []
  for (const n of list) {
    const src = n?.data?.images?.[0]
    if (typeof src === 'string' && src) out.push({ id: n.id, src, label: n?.data?.label || n?.type || n.id })
  }
  return out
})
</script>

<template>
  <div>
    <div v-if="!choices.length" class="rounded border border-white/10 bg-[#141414] p-3 text-[11px] text-white/40">
      No images on the canvas yet.
    </div>
    <div v-else class="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
      <button
        v-for="c in choices" :key="c.id" type="button"
        class="aspect-square rounded border border-white/10 overflow-hidden bg-[#1a1a1a] hover:border-white/40 cursor-pointer"
        :title="c.label" @click="emit('pick', c.src)"
      >
        <img :src="c.src" class="h-full w-full object-cover" alt="" />
      </button>
    </div>
  </div>
</template>
