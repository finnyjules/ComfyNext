<!-- frontend/app/pages/account.vue -->
<script setup lang="ts">
// Minimal hosted account surface: who you are + your wallet. This is the
// Stage-1 smoke-test destination; the full account/billing UI comes with
// the launch-surfaces stage.
import { ArrowLeft } from 'lucide-vue-next'
import { hostedModeEnabled } from '~/lib/hostedMode'

const hosted = hostedModeEnabled(useRuntimeConfig().public)
if (!hosted) navigateTo('/', { replace: true })

const { data: wallet, refresh: refreshWallet } = await useFetch<{ mode: string; balance?: number; available?: number }>(
  '/api/wallet', { server: false })

const { data: packsData } = await useFetch<{ packs: { id: string; usd: number; credits: number; baseCredits: number; bonusCredits: number; label: string; caption: string }[] }>(
  '/api/billing/packs', { server: false })
const packs = computed(() => packsData.value?.packs ?? [])

const route = useRoute()
const purchaseState = computed(() => route.query.purchase === 'success' ? 'success' : route.query.purchase === 'cancelled' ? 'cancelled' : null)

const buying = ref<string | null>(null)
const checkoutError = ref<string | null>(null)
async function buy(packId: string) {
  buying.value = packId
  checkoutError.value = null
  try {
    const res = await $fetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { packId } })
    window.location.href = res.url
  } catch (e: any) {
    console.error('checkout failed', e)
    const status = e?.statusCode ?? e?.response?.status
    checkoutError.value = status === 401
      ? 'Your session expired — reload the page and sign in again.'
      : `Checkout could not start${status ? ` (error ${status})` : ''}. Nothing was charged — try again in a moment.`
    buying.value = null
  }
}

// After a success redirect, poll the wallet a few times so the webhook's
// grant appears without a manual reload (webhook may lag the redirect).
if (import.meta.client) {
  watch(purchaseState, (s) => {
    if (s !== 'success') return
    let tries = 0
    const t = setInterval(async () => {
      tries += 1
      await refreshWallet()
      if (tries >= 10) clearInterval(t)
    }, 2000)
  }, { immediate: true })
}
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

      <div v-if="purchaseState === 'success'" class="mt-4 rounded-[8px] border border-emerald-400/40 bg-emerald-400/10 p-3 text-[12.5px] text-emerald-200/90">
        Payment received — your credits are on the way (a few seconds; this page refreshes automatically).
      </div>
      <div v-else-if="purchaseState === 'cancelled'" class="mt-4 rounded-[8px] border border-white/10 bg-white/[0.04] p-3 text-[12.5px] text-white/55">
        Checkout cancelled — nothing was charged.
      </div>

      <h2 class="mt-8 text-[11px] font-medium uppercase tracking-wide text-white/50">Add credits</h2>
      <div v-if="checkoutError" class="mt-3 rounded-[8px] border border-red-400/40 bg-red-400/10 p-3 text-[12.5px] text-red-200/90">
        {{ checkoutError }}
      </div>
      <div class="mt-3 grid grid-cols-1 gap-2.5">
        <!-- Cards are inert; the explicit Buy button is the only affordance
             (user feedback: card-as-button hid the affordance, and the
             accent border on Creator read as a SELECTED state). Emphasis
             now lives in the button variant, not the card chrome. -->
        <div
          v-for="pack in packs" :key="pack.id"
          class="flex items-center gap-4 rounded-[8px] border border-white/10 bg-white/[0.04] p-4"
        >
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[14px] font-semibold">{{ pack.label }}</span>
              <span v-if="pack.id === 'creator'" class="rounded-full border border-action/50 px-2 py-px font-mono text-[9px] uppercase tracking-wider text-action">Most popular</span>
            </div>
            <div class="text-[12px] text-white/55">{{ pack.caption }}</div>
            <div class="mt-1 text-[12px] tabular-nums text-white/70">
              {{ pack.credits.toLocaleString('en-US') }} credits
              <span v-if="pack.bonusCredits" class="text-emerald-300/80">— includes {{ pack.bonusCredits.toLocaleString('en-US') }} free</span>
            </div>
          </div>
          <StudioButton
            :variant="pack.id === 'creator' ? 'primary' : 'secondary'"
            :disabled="buying !== null"
            @click="buy(pack.id)"
          >
            {{ buying === pack.id ? 'Opening…' : `Buy for $${pack.usd}` }}
          </StudioButton>
        </div>
      </div>
      <p class="mt-3 text-[11px] leading-relaxed text-white/35">
        1 credit = 1¢, always. Bonus credits expire after 30 days; purchased credits after 12 months.
        Payments are processed by Stripe — Sailor never sees your card.
      </p>
    </div>
  </div>
</template>
