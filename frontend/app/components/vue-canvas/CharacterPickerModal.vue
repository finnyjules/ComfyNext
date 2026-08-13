<script setup lang="ts">
// Cast picker: choose a character from the registry. Emits pick(slug, name, stateId);
// the caller owns adding it to sheet.cast. Cards with >1 look expand an inline
// look chip row on click instead of picking immediately; single-look cards
// pick directly (stateId: null — the default state is implied).
import { computed, ref } from 'vue'
import { Check, X } from 'lucide-vue-next'
import { useCharacters } from '~/composables/useCharacters'
import { normalizeStateId, identityRefs, sortStatesLockedFirst, type CharacterRecord, type CharacterState } from '#shared/characters/types'
import { readiness } from '~/lib/characters/readiness'

const props = defineProps<{ excludeSlugs: string[] }>()
const emit = defineEmits<{ pick: [slug: string, name: string, stateId: string | null], close: [] }>()

const { characters, loading, coverUrl, portraitUrl, refresh } = useCharacters()
void refresh()
const q = ref('')
const visible = computed<CharacterRecord[]>(() => {
  const query = q.value.trim().toLowerCase()
  return characters.value
    .filter(c => !props.excludeSlugs.includes(c.slug))
    .filter(c => !query || c.name.toLowerCase().includes(query))
})

/** slug of the card whose look row is expanded, if any. */
const expandedSlug = ref<string | null>(null)

function toneClass(tone: 'grey' | 'amber' | 'blue'): string {
  if (tone === 'amber') return 'bg-amber-300/10 text-amber-300'
  if (tone === 'blue') return 'bg-action/15 text-action'
  return 'bg-white/10 text-white/50'
}

/** Identity assets across every look (sheet + refs), not just refImages — a
 *  sheet-only look casts fine but has no refImages, so counting refImages
 *  alone would misreport a perfectly castable character as "0 references". */
function refCount(c: CharacterRecord): number {
  return c.states.reduce((n, v) => n + identityRefs(v).length, 0)
}

/** Look chip row order: readiest looks lead. */
function sortedLooks(c: CharacterRecord): CharacterState[] {
  return sortStatesLockedFirst(c.states)
}

function onCardClick(c: CharacterRecord) {
  if (c.states.length > 1) {
    expandedSlug.value = expandedSlug.value === c.slug ? null : c.slug
    return
  }
  emit('pick', c.slug, c.name, null)
}

function pickLook(c: CharacterRecord, stateId: string) {
  emit('pick', c.slug, c.name, normalizeStateId(stateId))
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
              <img v-if="portraitUrl(c) ?? coverUrl(c)" :src="portraitUrl(c) ?? coverUrl(c)!" class="h-full w-full object-cover" :alt="c.name">
            </div>
            <div class="mt-1.5 truncate text-[12px] text-white/85">{{ c.name }}</div>
            <div class="text-[10px] text-white/40">
              {{ refCount(c) }} reference{{ refCount(c) === 1 ? '' : 's' }}
              <span v-if="c.states.length > 1">· {{ c.states.length }} looks</span>
            </div>
            <!-- Single-look cards pick directly (no expand row) — readiness badge right on the card. -->
            <div
              v-if="c.states.length === 1"
              class="mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-medium"
              :class="toneClass(readiness(c.states[0]!).tone)"
            >
              {{ readiness(c.states[0]!).label }}
            </div>
          </button>
          <!-- Look chip row: only for multi-look cards, expanded on click -->
          <div v-if="expandedSlug === c.slug" class="col-span-3 -mt-1 flex flex-wrap gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-2">
            <button
              v-for="v in sortedLooks(c)" :key="v.id"
              class="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] py-0.5 pl-0.5 pr-2 text-[11px] text-white/80 hover:border-white/25"
              @click="pickLook(c, v.id)"
            >
              <img v-if="portraitUrl(c, v.id) ?? coverUrl(c, v.id)" :src="portraitUrl(c, v.id) ?? coverUrl(c, v.id)!" class="h-5 w-5 rounded-full object-cover" :alt="v.label">
              {{ v.label }}
              <Check v-if="readiness(v).key === 'ready'" class="size-3 text-action" />
              <span v-else class="text-[9px]" :class="toneClass(readiness(v).tone)">{{ readiness(v).label }}</span>
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
