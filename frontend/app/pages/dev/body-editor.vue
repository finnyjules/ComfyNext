<script setup lang="ts">
// Dev harness for the Body editor modal (Task 5). Mounts it open against the
// first character in the local registry. Not shipped UI.
import BodyEditorModal from '~/components/vue-canvas/BodyEditorModal.vue'
import { useCharacters } from '~/composables/useCharacters'

const { characters } = useCharacters()
</script>

<template>
  <div class="min-h-screen bg-neutral-950">
    <BodyEditorModal v-if="characters[0]" :slug="characters[0].slug" @close="() => {}" />
  </div>
</template>
