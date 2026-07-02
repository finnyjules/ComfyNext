<script setup lang="ts">
// Cast picker: choose a character from the registry. Emits pick(slug, name);
// the caller owns adding it to sheet.cast.
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useCharacters, type CharacterClient } from '~/composables/useCharacters'

const props = defineProps<{ excludeSlugs: string[] }>()
const emit = defineEmits<{ pick: [slug: string, name: string], close: [] }>()

const { characters, loading, coverUrl, refresh } = useCharacters()
void refresh()
const q = ref('')
const visible = computed<CharacterClient[]>(() => {
  const query = q.value.trim().toLowerCase()
  return characters.value
    .filter(c => !props.excludeSlugs.includes(c.slug))
    .filter(c => !query || c.name.toLowerCase().includes(query))
})
</script>

<template>
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" @click.self="emit('close')">
    <div class="w-[520px] max-h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-[#111] p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[13px] font-medium text-white/90">Cast a character</h3>
        <button class="text-white/40 hover:text-white/80" @click="emit('close')"><X :size="14" /></button>
      </div>
      <input
        v-model="q" placeholder="Search characters…"
        class="w-full rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/90 placeholder:text-white/25 outline-none focus:border-white/25"
      >
      <div class="grid grid-cols-3 gap-2 overflow-y-auto">
        <button
          v-for="c in visible" :key="c.slug"
          class="group rounded-lg border border-white/10 bg-white/[0.03] p-2 text-left hover:border-white/25"
          @click="emit('pick', c.slug, c.name)"
        >
          <div class="aspect-square w-full overflow-hidden rounded bg-white/[0.05]">
            <img v-if="coverUrl(c)" :src="coverUrl(c)!" class="h-full w-full object-cover" :alt="c.name">
          </div>
          <div class="mt-1.5 truncate text-[12px] text-white/85">{{ c.name }}</div>
          <div class="text-[10px] text-white/40">{{ c.refImages.length }} reference{{ c.refImages.length === 1 ? '' : 's' }}</div>
        </button>
      </div>
      <p v-if="!loading && !visible.length" class="py-6 text-center text-[11px] text-white/40">
        No castable characters yet — create one in the Characters panel or save one from any image.
      </p>
    </div>
  </div>
</template>
