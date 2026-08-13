<script setup lang="ts">
// Character — canvas card. A castable person from the registry (Task 5);
// wires its CHARACTER output into a Shot Director's cast_1/2/3 inputs.
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Drama } from 'lucide-vue-next'
import { useCharacters } from '~/composables/useCharacters'
import CharacterPickerModal from '~/components/vue-canvas/CharacterPickerModal.vue'
import { emitCharacterEvent } from '~/lib/characters/bus'
import { normalizeStateId, pickState, identityRefs, sortStatesLockedFirst, type CharacterState } from '#shared/characters/types'
import { readiness } from '~/lib/characters/readiness'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    properties?: Record<string, any>
  }
}>()

const { characters, coverUrl, portraitUrl } = useCharacters()
const pickerOpen = ref(false)

/** Reads the single sailor_characterBinding property, falling back to the
 *  three legacy sailor_character{Slug,Name,VariantId} props for nodes saved
 *  before the binding existed. Writes only ever produce the binding. */
const binding = computed<{ slug: string; name: string; stateId: string | null } | null>(() => {
  const b = props.data?.properties?.sailor_characterBinding
  if (b && typeof b.slug === 'string') {
    return { slug: b.slug, name: typeof b.name === 'string' ? b.name : b.slug, stateId: normalizeStateId(b.stateId ?? null) }
  }
  const legacySlug = props.data?.properties?.sailor_characterSlug
  if (typeof legacySlug === 'string') {
    return {
      slug: legacySlug,
      name: props.data?.properties?.sailor_characterName || legacySlug,
      stateId: normalizeStateId(props.data?.properties?.sailor_characterVariantId ?? null),
    }
  }
  return null
})

const slug = computed<string | null>(() => binding.value?.slug ?? null)
const character = computed(() => characters.value.find(c => c.slug === slug.value) ?? null)
const stateId = computed<string | null>(() => binding.value?.stateId ?? null)
/** The state this card actually casts (binding's stateId, falling back to default) — same resolution the caster uses. */
const activeState = computed<CharacterState | undefined>(() => character.value ? pickState(character.value, stateId.value) : undefined)
/** Castable check must count identity assets (sheet + refs), not just refImages — a
 *  sheet-only look (refImages: []) casts fine but would otherwise read as "0 references". */
const identityCount = computed(() => identityRefs(activeState.value).length)

/** Look select order: readiest looks lead. */
const sortedLookStates = computed<CharacterState[]>(() => sortStatesLockedFirst(character.value?.states ?? []))

/** Native <select> can't carry an icon or tone color, so readiness is text on the option itself. */
function lookOptionLabel(v: CharacterState): string {
  const r = readiness(v)
  return r.key === 'ready' ? `${v.label} ✓ ${r.label}` : `${v.label} — ${r.label}`
}

function pick(s: string, name: string, pickedStateId: string | null) {
  if (!props.data.properties) props.data.properties = {}
  props.data.properties.sailor_characterBinding = { slug: s, name, stateId: normalizeStateId(pickedStateId) }
  pickerOpen.value = false
  // Nudge any wired Shot Directors to re-sync their cast.
  emitCharacterEvent('castEdgesChanged')
}

function onLookChange(e: Event) {
  if (!props.data.properties) props.data.properties = {}
  const b = binding.value
  if (!b) return
  const v = (e.target as HTMLSelectElement).value
  props.data.properties.sailor_characterBinding = { slug: b.slug, name: b.name, stateId: normalizeStateId(v) }
  emitCharacterEvent('castEdgesChanged')
}
</script>

<template>
  <div class="relative w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg">
    <!-- Output handle -->
    <Handle
      id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]"
      :style="{ top: '50%' }"
    />

    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Drama class="h-3.5 w-3.5 text-white/70" />
      <span class="text-xs font-medium text-white/80">Character</span>
    </div>

    <!-- Body -->
    <div class="px-3 py-2.5">
      <template v-if="character">
        <div class="flex items-center gap-2">
          <img
            v-if="portraitUrl(character, stateId ?? undefined) ?? coverUrl(character, stateId ?? undefined)"
            :src="portraitUrl(character, stateId ?? undefined) ?? coverUrl(character, stateId ?? undefined)!" :alt="character.name"
            class="h-10 w-10 shrink-0 rounded object-cover"
          >
          <div v-else class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/[0.06]">
            <Drama class="h-4 w-4 text-white/30" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-[12px] text-white/90" :title="character.name">{{ character.name }}</p>
            <p class="text-[10px] text-white/40">{{ identityCount }} identity source{{ identityCount === 1 ? '' : 's' }}</p>
          </div>
        </div>
        <!-- Look select: only when the character has more than one look -->
        <select
          v-if="character.states.length > 1"
          :value="stateId ?? character.states.find(v => v.id === 'default')?.id ?? ''"
          class="mt-2 w-full rounded border border-white/10 bg-[#0e0e10] px-1.5 py-1 text-[11px] text-white/70 outline-none focus:border-white/25"
          @change="onLookChange"
        >
          <option v-for="v in sortedLookStates" :key="v.id" :value="v.id" class="bg-neutral-900">{{ lookOptionLabel(v) }}</option>
        </select>
        <p v-if="!identityCount" class="mt-1.5 text-[10px] leading-tight text-amber-400/80">
          No reference photos — add some in the Characters panel.
        </p>
      </template>
      <p v-else-if="slug" class="text-[11px] leading-tight text-red-400/80">
        Character "{{ binding?.name || slug }}" was deleted.
      </p>
      <p v-else class="text-[11px] text-white/40">No character picked.</p>

      <button
        class="mt-2 w-full rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="pickerOpen = true"
      >
        {{ character ? 'Change' : 'Pick character' }}
      </button>
    </div>

    <CharacterPickerModal v-if="pickerOpen" :exclude-slugs="[]" @pick="pick" @close="pickerOpen = false" />
  </div>
</template>
