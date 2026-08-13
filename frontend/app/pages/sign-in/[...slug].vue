<!-- frontend/app/pages/sign-in/[...slug].vue -->
<script setup lang="ts">
// Hosted mode only: in local mode there is no login (deployMode contract),
// so this page sends you home instead of rendering a dead Clerk widget.
import { hostedModeEnabled } from '~/lib/hostedMode'
const hosted = hostedModeEnabled(useRuntimeConfig().public)
if (!hosted) navigateTo('/', { replace: true })
</script>

<template>
  <div v-if="hosted" class="flex min-h-screen items-center justify-center bg-background">
    <SignIn />
  </div>
</template>
