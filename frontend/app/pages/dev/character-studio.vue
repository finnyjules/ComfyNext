<script setup lang="ts">
// Dev harness for the Character Studio workbench modal (Task 3). Mounts it
// open against the first character in the local registry, or in createMode
// when there are none yet. Not shipped UI.
import CharacterStudioModal from '~/components/vue-canvas/CharacterStudioModal.vue'
import { useCharacters } from '~/composables/useCharacters'

const { characters } = useCharacters()
</script>

<template>
  <div class="min-h-screen bg-neutral-950">
    <CharacterStudioModal
      :slug="characters[0]?.slug ?? null"
      :create-mode="!characters.length"
      @close="() => {}"
    />
  </div>
</template>
