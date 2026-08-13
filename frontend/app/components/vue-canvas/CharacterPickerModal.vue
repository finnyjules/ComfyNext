<script setup lang="ts">
// Cast picker: choose a character from the registry. Emits pick(slug, name, variantId?);
// the caller owns adding it to sheet.cast. Cards with >1 variant expand an inline
// variant chip row on click instead of picking immediately; single-variant cards
// pick directly (variantId omitted — the default variant is implied).
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useCharacters } from '~/composables/useCharacters'
import type { CharacterRecord } from '#shared/characters/types'

const props = defineProps<{ excludeSlugs: string[] }>()
// TODO(T6): variantId param stays name-compatible with existing callers
// (CharacterNode.vue's pick()) until the CastMember/property rename lands.
const emit = defineEmits<{ pick: [slug: string, name: string, variantId?: string], close: [] }>()

const { characters, loading, coverUrl, refresh } = useCharacters()
void refresh()
const q = ref('')
const visible = computed<CharacterRecord[]>(() => {
  const query = q.value.trim().toLowerCase()
  return characters.value
    .filter(c => !props.excludeSlugs.includes(c.slug))
    .filter(c => !query || c.name.toLowerCase().includes(query))
})

/** slug of the card whose variant row is expanded, if any. */
const expandedSlug = ref<string | null>(null)

function refCount(c: CharacterRecord): number {
  return c.states.reduce((n, v) => n + v.refImages.length, 0)
}

function onCardClick(c: CharacterRecord) {
  if (c.states.length > 1) {
    expandedSlug.value = expandedSlug.value === c.slug ? null : c.slug
    return
  }
  emit('pick', c.slug, c.name)
}

function pickVariant(c: CharacterRecord, variantId: string) {
  emit('pick', c.slug, c.name, variantId === 'default' ? undefined : variantId)
}
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
        <div v-for="c in visible" :key="c.slug" class="contents">
          <button
            class="group rounded border border-white/10 bg-white/[0.03] p-2 text-left hover:border-white/25"
            :class="{ 'border-white/30': expandedSlug === c.slug }"
            @click="onCardClick(c)"
          >
            <div class="aspect-square w-full overflow-hidden rounded bg-white/[0.05]">
              <img v-if="coverUrl(c)" :src="coverUrl(c)!" class="h-full w-full object-cover" :alt="c.name">
            </div>
            <div class="mt-1.5 truncate text-[12px] text-white/85">{{ c.name }}</div>
            <div class="text-[10px] text-white/40">
              {{ refCount(c) }} reference{{ refCount(c) === 1 ? '' : 's' }}
              <span v-if="c.states.length > 1">· {{ c.states.length }} variants</span>
            </div>
          </button>
          <!-- Variant chip row: only for multi-variant cards, expanded on click -->
          <div v-if="expandedSlug === c.slug" class="col-span-3 -mt-1 flex flex-wrap gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-2">
            <button
              v-for="v in c.states" :key="v.id"
              class="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] py-0.5 pl-0.5 pr-2 text-[11px] text-white/80 hover:border-white/25"
              @click="pickVariant(c, v.id)"
            >
              <img v-if="coverUrl(c, v.id)" :src="coverUrl(c, v.id)!" class="h-5 w-5 rounded-full object-cover" :alt="v.label">
              {{ v.label }}
            </button>
          </div>
        </div>
      </div>
      <p v-if="!loading && !visible.length" class="py-6 text-center text-[11px] text-white/40">
        No castable characters yet — create one in the Characters panel or save one from any image.
      </p>
    </div>
  </div>
</template>
