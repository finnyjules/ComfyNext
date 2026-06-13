<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- App-boot overlay. Rendered server-side so it appears in the very first
       HTML (no JS needed) and its CSS spinner animates immediately. Removed once
       the client app has mounted/hydrated — i.e. once it's actually interactive.
       Covers the cold-start window (Vite compile + hydration in dev) where the
       SSR'd homepage looks normal but its buttons don't respond yet. -->
  <div v-if="!appReady" class="app-boot-overlay">
    <div class="app-boot-spinner" />
    <span class="app-boot-label">Loading ComfyNext…</span>
  </div>
</template>

<script setup lang="ts">
// Starts false (so the overlay is server-rendered into the initial HTML and the
// client's first render matches — no hydration mismatch), flips true once the
// whole app tree has mounted on the client.
const appReady = ref(false)
onMounted(() => { appReady.value = true })
</script>

<style scoped>
.app-boot-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #121212;
}
.app-boot-spinner {
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: rgba(255, 255, 255, 0.5);
  animation: app-boot-spin 0.8s linear infinite;
  will-change: transform;
}
.app-boot-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.01em;
}
@keyframes app-boot-spin {
  to { transform: rotate(360deg); }
}
</style>
