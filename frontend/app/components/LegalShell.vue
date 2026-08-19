<!-- frontend/app/components/LegalShell.vue -->
<script setup lang="ts">
defineProps<{ title: string; updated: string }>()
</script>

<template>
  <div class="min-h-screen bg-background">
    <div class="mx-auto max-w-2xl px-6 py-16">
      <NuxtLink to="/" class="text-xs opacity-50 hover:underline">← Sailor</NuxtLink>
      <h1 class="mt-4 text-2xl font-semibold">{{ title }}</h1>
      <p class="mt-1 text-xs opacity-50">Last updated {{ updated }}</p>
      <p class="mt-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
        Beta draft — this document will be reviewed by counsel before public launch.
      </p>
      <div class="legal-prose mt-8 space-y-4 text-sm leading-relaxed opacity-90">
        <slot />
      </div>
      <div class="mt-12 flex gap-4 text-xs opacity-50">
        <NuxtLink to="/terms" class="hover:underline">Terms</NuxtLink>
        <NuxtLink to="/privacy" class="hover:underline">Privacy</NuxtLink>
        <NuxtLink to="/content-policy" class="hover:underline">Content policy</NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legal-prose :deep(h2) { font-size: 1rem; font-weight: 600; margin-top: 1.5rem; }
.legal-prose :deep(ul) { list-style: disc; padding-left: 1.25rem; }
</style>
