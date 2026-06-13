<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- App-boot indicator. SSR-rendered (it's in the initial HTML, so its spinner
       animates without JS) and removed once the client app is interactive. Reuses
       the canvas status pill (CanvasStatusBar's backend view) so the loading cue
       matches the rest of the app, and leaves the homepage visible behind it. -->
  <div v-if="!appReady" class="fixed inset-x-0 top-0 z-[99999] pointer-events-none">
    <CanvasStatusBar
      :backend-busy="true"
      backend-label="Loading ComfyNext…"
      :running="false"
      current-node=""
      :progress="{ completed: 0, total: 0 }"
      :percent="0"
      :started-at="null"
      :last-result="null"
    />
  </div>
</template>

<script setup lang="ts">
// Starts false (so the pill is server-rendered into the initial HTML and the
// client's first render matches — no hydration mismatch), flips true once the
// whole app tree has mounted on the client.
const appReady = ref(false)
onMounted(() => { appReady.value = true })
</script>
