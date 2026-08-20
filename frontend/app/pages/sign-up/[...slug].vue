<!-- frontend/app/pages/sign-up/[...slug].vue -->
<script setup lang="ts">
// Hosted mode only: in local mode there is no login (deployMode contract),
// so this page sends you home instead of rendering a dead Clerk widget.
import { hostedModeEnabled } from '~/lib/hostedMode'
definePageMeta({ layout: false })
const hosted = hostedModeEnabled(useRuntimeConfig().public)
if (!hosted) navigateTo('/', { replace: true })
</script>

<template>
  <div v-if="hosted" class="relative flex min-h-screen flex-col items-center justify-center bg-background">
    <SignUp />
    <div class="absolute bottom-6 flex gap-4 text-xs opacity-50">
      <NuxtLink to="/terms" class="hover:underline">Terms</NuxtLink>
      <NuxtLink to="/privacy" class="hover:underline">Privacy</NuxtLink>
      <NuxtLink to="/content-policy" class="hover:underline">Content policy</NuxtLink>
    </div>
  </div>
</template>
