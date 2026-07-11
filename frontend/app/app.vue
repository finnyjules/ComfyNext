<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- App-boot indicator. SSR-rendered (it's in the initial HTML, so its spinner
       animates without JS) and reuses the canvas status pill so the cue matches
       the rest of the app, leaving the homepage visible behind it. Once the app
       is interactive it flashes a brief "Ready to go" success, then fades out. -->
  <div v-if="bootPhase !== 'gone'" class="fixed inset-x-0 top-0 z-[99999] pointer-events-none">
    <CanvasStatusBar
      :backend-busy="bootPhase === 'loading'"
      backend-label="Loading Sailor…"
      :backend-success="bootPhase === 'ready'"
      backend-success-label="Ready to go"
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
// SSR renders 'loading' (the pill is in the initial HTML; the client's first
// render matches → no hydration mismatch). Once the app has mounted/hydrated and
// is interactive, flash a brief "Ready to go" success, then let the pill fade out
// (view → null triggers CanvasStatusBar's leave transition) and remove the wrapper.
const bootPhase = ref<'loading' | 'ready' | 'done' | 'gone'>('loading')
onMounted(() => {
  bootPhase.value = 'ready'
  setTimeout(() => { bootPhase.value = 'done' }, 1600) // success shown, then fade out
  setTimeout(() => { bootPhase.value = 'gone' }, 2000) // remove wrapper after the fade
})
</script>
