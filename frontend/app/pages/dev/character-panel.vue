<script setup lang="ts">
// Dev harness for CharacterRosterPanel — renders it against the real local
// registry so the roster cards / studio modal can be inspected. Not shipped.
import CharacterRosterPanel from '~/components/vue-canvas/CharacterRosterPanel.vue'
</script>

<template>
  <div class="flex min-h-screen bg-neutral-950">
    <div class="w-[340px] shrink-0">
      <CharacterRosterPanel @close="() => {}" />
    </div>
  </div>
</template>
