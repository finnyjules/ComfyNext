<script setup lang="ts">
// Full-screen gate for a signed-in account that is not on the beta
// allowlist (Stage 8). No waitlist capture — the beta is hand-invited.
// useUser/useClerk are auto-imported by the @clerk/nuxt module
// (addImportsDir('./runtime/composables'), which re-exports from @clerk/vue) —
// no explicit import needed, matching how the rest of the codebase relies on
// the module's auto-registered <UserButton /> in app/pages/account.vue.
const { user } = useUser()
const clerk = useClerk()
</script>

<template>
  <div class="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
    <h1 class="text-xl font-semibold">Sailor is in private beta</h1>
    <p class="max-w-sm text-sm opacity-70">
      This account<template v-if="user?.primaryEmailAddress"> ({{ user.primaryEmailAddress.emailAddress }})</template>
      isn't on the invite list yet. If you're expecting access, reach out to the person who invited you.
    </p>
    <StudioButton @click="clerk?.signOut()">Sign out</StudioButton>
    <div class="mt-6 flex gap-4 text-xs opacity-50">
      <NuxtLink to="/terms" class="hover:underline">Terms</NuxtLink>
      <NuxtLink to="/privacy" class="hover:underline">Privacy</NuxtLink>
      <NuxtLink to="/content-policy" class="hover:underline">Content policy</NuxtLink>
    </div>
  </div>
</template>
