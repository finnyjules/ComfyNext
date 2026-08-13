<!-- frontend/app/pages/account.vue -->
<script setup lang="ts">
// Minimal hosted account surface: who you are + your wallet. This is the
// Stage-1 smoke-test destination; the full account/billing UI comes with
// the launch-surfaces stage.
import { ArrowLeft } from 'lucide-vue-next'
import { hostedModeEnabled } from '~/lib/hostedMode'

const hosted = hostedModeEnabled(useRuntimeConfig().public)
if (!hosted) navigateTo('/', { replace: true })

const { data: wallet } = await useFetch<{ mode: string; balance?: number; available?: number }>(
  '/api/wallet', { server: false })
</script>

<template>
  <div v-if="hosted" class="min-h-screen bg-background text-white">
    <div class="mx-auto max-w-md px-6 py-10">
      <NuxtLink to="/" class="mb-8 inline-flex items-center gap-1.5 text-[12px] text-white/40 transition hover:text-white/80">
        <ArrowLeft class="size-3.5" />
        Back to Sailor
      </NuxtLink>
      <div class="flex items-center justify-between">
        <h1 class="text-[20px] font-semibold tracking-tight">Account</h1>
        <UserButton />
      </div>
      <div class="mt-6 rounded-[8px] border border-white/10 bg-white/[0.04] p-4">
        <div class="text-[11px] font-medium uppercase tracking-wide text-white/50">Credits</div>
        <div v-if="wallet?.mode === 'hosted'" class="mt-1 text-[26px] font-semibold tabular-nums">
          {{ wallet.available }}
          <span class="text-[13px] font-normal text-white/40">available · {{ wallet.balance }} total</span>
        </div>
        <div v-else class="mt-1 text-[13px] text-white/40">Wallet unavailable.</div>
      </div>
    </div>
  </div>
</template>
