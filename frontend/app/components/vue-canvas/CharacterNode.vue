<script setup lang="ts">
// Character — canvas card. A castable person from the registry (Task 5);
// wires its CHARACTER output into a Shot Director's cast_1/2/3 inputs.
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Drama } from 'lucide-vue-next'
import { useCharacters } from '~/composables/useCharacters'
import CharacterPickerModal from '~/components/vue-canvas/CharacterPickerModal.vue'

const props = defineProps<{
  id: string
  data: {
    nodeType: string
    title?: string
    properties?: Record<string, any>
  }
}>()

const { characters, coverUrl } = useCharacters()
const pickerOpen = ref(false)

const slug = computed<string | null>(() => props.data?.properties?.comfynext_characterSlug ?? null)
const character = computed(() => characters.value.find(c => c.slug === slug.value) ?? null)
const variantId = computed<string | null>(() => props.data?.properties?.comfynext_characterVariantId ?? null)
const refCount = computed(() => character.value?.variants.reduce((n, v) => n + v.refImages.length, 0) ?? 0)

function pick(s: string, name: string, pickedVariantId?: string) {
  if (!props.data.properties) props.data.properties = {}
  props.data.properties.comfynext_characterSlug = s
  props.data.properties.comfynext_characterName = name
  props.data.properties.comfynext_characterVariantId = pickedVariantId ?? null
  pickerOpen.value = false
  // Nudge any wired Shot Directors to re-sync their cast (Task 11 listens).
  window.dispatchEvent(new CustomEvent('comfynext:castEdgesChanged'))
}

function onVariantChange(e: Event) {
  if (!props.data.properties) props.data.properties = {}
  const v = (e.target as HTMLSelectElement).value
  props.data.properties.comfynext_characterVariantId = (v && v !== 'default') ? v : null
  window.dispatchEvent(new CustomEvent('comfynext:castEdgesChanged'))
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
            v-if="coverUrl(character, variantId ?? undefined)" :src="coverUrl(character, variantId ?? undefined)!" :alt="character.name"
            class="h-10 w-10 shrink-0 rounded object-cover"
          >
          <div v-else class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/[0.06]">
            <Drama class="h-4 w-4 text-white/30" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-[12px] text-white/90" :title="character.name">{{ character.name }}</p>
            <p class="text-[10px] text-white/40">{{ refCount }} reference{{ refCount === 1 ? '' : 's' }}</p>
          </div>
        </div>
        <!-- Variant select: only when the character has more than one variant -->
        <select
          v-if="character.variants.length > 1"
          :value="variantId ?? character.variants.find(v => v.id === 'default')?.id ?? ''"
          class="mt-2 w-full rounded border border-white/10 bg-[#0e0e10] px-1.5 py-1 text-[11px] text-white/70 outline-none focus:border-white/25"
          @change="onVariantChange"
        >
          <option v-for="v in character.variants" :key="v.id" :value="v.id" class="bg-neutral-900">{{ v.label }}</option>
        </select>
        <p v-if="!refCount" class="mt-1.5 text-[10px] leading-tight text-amber-400/80">
          No reference photos — add some in the Characters panel.
        </p>
      </template>
      <p v-else-if="slug" class="text-[11px] leading-tight text-red-400/80">
        Character "{{ data?.properties?.comfynext_characterName || slug }}" was deleted.
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
