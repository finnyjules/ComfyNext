<script setup lang="ts">
// Dev harness for CharacterLibraryPanel — renders it against the real local
// registry so the Looks / Dress / cover-badge UI can be inspected. Not shipped.
import CharacterLibraryPanel from '~/components/vue-canvas/CharacterLibraryPanel.vue'
</script>

<template>
  <div class="flex min-h-screen bg-neutral-950">
    <div class="w-[340px] shrink-0">
      <CharacterLibraryPanel @close="() => {}" />
    </div>
  </div>
</template>
